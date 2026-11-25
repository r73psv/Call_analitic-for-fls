/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatS3ErrorDetails,
  syncToS3WithRetry,
  scheduleSyncToS3,
  flushSyncToS3,
  configureS3SyncForTesting,
  getS3SyncPendingState,
  DEFAULT_S3_RETRY_DELAYS_MS,
} from '../s3-sync.js';
import {
  createOrMergeBatchQueue,
  recoverInterruptedBatchQueue,
  markBatchItemStarted,
  markBatchItemCompleted,
  markBatchItemFailed,
  finalizeBatchQueueIfDone,
} from '../batchQueue.js';
import { parseGigaChatJson } from '../gigachat.js';
import { harmonizeMistakesAndEvaluation, reconcileMistakesWithCriteria } from '../evaluationUtils.js';
import { CallEvaluation } from '../../types.js';

describe('S3 auto-sync diagnostics, retry backoff, and batch debouncing', () => {
  afterEach(() => {
    configureS3SyncForTesting(null);
  });

  it('extracts full AWS SDK error metadata without collapsing to bare UnknownError and never leaks credentials', () => {
    const awsErr = {
      name: 'SlowDown',
      message: 'UnknownError',
      Code: 'SlowDown',
      $fault: 'server',
      $metadata: {
        httpStatusCode: 503,
        requestId: 'req-998877',
        extendedRequestId: 'ext-1122',
        attempts: 3,
        totalRetryDelay: 1200,
        Authorization: 'AWS4-HMAC-SHA256 SecretShouldNeverBeLogged',
      },
      cause: {
        name: 'Error',
        code: 'ECONNRESET',
        errno: -104,
        syscall: 'read',
        message: 'socket hang up',
      },
    };

    const formatted = formatS3ErrorDetails(awsErr);
    assert.equal(formatted.details.name, 'SlowDown');
    assert.equal(formatted.details.code, 'SlowDown');
    assert.equal(formatted.details.httpStatusCode, 503);
    assert.equal(formatted.details.requestId, 'req-998877');
    assert.equal(formatted.details.cause?.code, 'ECONNRESET');
    assert.match(formatted.summary, /httpStatus=503/);
    assert.match(formatted.summary, /code=SlowDown/);
    assert.match(formatted.summary, /requestId=req-998877/);
    assert.match(formatted.summary, /ECONNRESET/);
    assert.equal(JSON.stringify(formatted).includes('SecretShouldNeverBeLogged'), false);
  });

  it('retries S3 auto-sync 3 times with 5s, 15s, 30s backoff delays before giving up', async () => {
    const delays: number[] = [];
    let uploadCalls = 0;

    const result = await syncToS3WithRetry(
      { calls: [] },
      {
        retryDelaysMs: DEFAULT_S3_RETRY_DELAYS_MS,
        sleepFn: async (ms) => {
          delays.push(ms);
        },
        uploader: async () => {
          uploadCalls++;
          const err: any = new Error('UnknownError');
          err.name = 'ServiceUnavailable';
          err.$metadata = { httpStatusCode: 503, requestId: `req-${uploadCalls}` };
          throw err;
        },
        reason: 'unit-test',
      }
    );

    assert.equal(result.success, false);
    assert.equal(uploadCalls, 4); // 1 initial + 3 retries
    assert.deepEqual(delays, [5000, 15000, 30000]);
    assert.equal(result.error?.details.httpStatusCode, 503);
  });

  it('succeeds on retry attempt without exhausting remaining retries', async () => {
    const delays: number[] = [];
    let attempts = 0;

    const result = await syncToS3WithRetry(
      { calls: [] },
      {
        retryDelaysMs: [5000, 15000, 30000],
        sleepFn: async (ms) => {
          delays.push(ms);
        },
        uploader: async () => {
          attempts++;
          if (attempts < 3) {
            const err: any = new Error('Timeout');
            err.$metadata = { httpStatusCode: 504 };
            throw err;
          }
        },
      }
    );

    assert.equal(result.success, true);
    assert.equal(result.attempts, 3);
    assert.deepEqual(delays, [5000, 15000]);
  });

  it('batches rapid scheduleSyncToS3 writes and flushes on threshold or explicit flushSyncToS3', async () => {
    const uploads: any[] = [];
    configureS3SyncForTesting({
      debounceMs: 60_000,
      maxWaitMs: 60_000,
      batchSize: 5,
      retryDelaysMs: [10],
      isConfiguredOverride: () => true,
      sleepFn: async () => {},
      uploader: async (data) => {
        uploads.push(data);
      },
    });

    // 4 rapid writes (< batchSize=5) should NOT upload immediately
    for (let i = 1; i <= 4; i++) {
      scheduleSyncToS3(() => ({ version: i }));
    }
    assert.equal(uploads.length, 0);
    assert.equal(getS3SyncPendingState().pendingChanges, 4);

    // 5th write hits batchSize=5 -> triggers single batched upload
    scheduleSyncToS3(() => ({ version: 5 }));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(uploads.length, 1);
    assert.deepEqual(uploads[0], { version: 5 });

    // Additional writes flushed deterministically via flushSyncToS3 (e.g. on queue end / shutdown)
    scheduleSyncToS3(() => ({ version: 6 }));
    scheduleSyncToS3(() => ({ version: 7 }));
    assert.equal(uploads.length, 1);
    await flushSyncToS3('batch_queue_complete');
    assert.equal(uploads.length, 2);
    assert.deepEqual(uploads[1], { version: 7 });
    assert.equal(getS3SyncPendingState().pendingChanges, 0);
  });
});

describe('Persisted batch analysis queue restart recovery', () => {
  it('resumes from exact stop point after restart without re-processing completed calls', () => {
    let q = createOrMergeBatchQueue(undefined, ['call-1', 'call-2', 'call-3', 'call-4'], {
      sttProvider: 'gigaam_v3',
      modelOverride: 'GigaChat:Lite',
    });

    // Process call-1 completely, start call-2, then simulate abrupt crash/restart
    q = markBatchItemStarted(q, 'call-1');
    q = markBatchItemCompleted(q, 'call-1');
    q = markBatchItemStarted(q, 'call-2');

    // Simulate server restart reading persisted state
    const { recovered, queue: resumed } = recoverInterruptedBatchQueue(q);
    assert.equal(recovered, true);
    assert.ok(resumed);
    assert.equal(resumed!.resumeCount, 1);
    assert.equal(resumed!.currentCallId, null);
    assert.deepEqual(resumed!.processedCallIds, ['call-1']);
    assert.deepEqual(resumed!.pendingCallIds, ['call-2', 'call-3', 'call-4']);

    // Finish remaining items (one fails, two succeed)
    let q2 = markBatchItemStarted(resumed!, 'call-2');
    q2 = markBatchItemFailed(q2, 'call-2', 'STT temporary failure');
    q2 = markBatchItemStarted(q2, 'call-3');
    q2 = markBatchItemCompleted(q2, 'call-3');
    q2 = markBatchItemStarted(q2, 'call-4');
    q2 = markBatchItemCompleted(q2, 'call-4');
    q2 = finalizeBatchQueueIfDone(q2);

    assert.equal(q2.status, 'completed');
    assert.deepEqual(q2.processedCallIds, ['call-1', 'call-3', 'call-4']);
    assert.equal(q2.failedCallIds.length, 1);
    assert.equal(q2.failedCallIds[0].callId, 'call-2');
  });
});

describe('Feedback source priority (model -> fallback) and non-verified mistakes reconciliation', () => {
  const sampleTranscript =
    'Менеджер: Добрый день, студия красоты Fashion Look Studio, администратор Анна.\n' +
    'Клиент: Здравствуйте, хочу записаться на маникюр с покрытием завтра.\n' +
    'Менеджер: Да, есть окошко завтра в 15:00 к мастеру Ольге, записала вас.\n' +
    'Клиент: Спасибо, до свидания.';

  it('keeps feedback_source="model" when model provides valid recommendations (top-level or nested audit.recommendations)', () => {
    const rawJson = JSON.stringify({
      is_conversation: true,
      booking_status: 'запись состоялась',
      summary: {
        goal: 'Запись на маникюр',
        requested_service: 'маникюр с покрытием',
        offered_master: 'Ольга',
        offered_price: 'не озвучено',
        offered_date_time: 'завтра в 15:00',
        booking_done: 'Запись состоялась на завтра в 15:00 к мастеру Ольге',
        unbooked_reason: null,
        short_summary: 'Клиент записался на маникюр к мастеру Ольге на завтра в 15:00.',
      },
      audit: {
        criteria: [
          { id: 1, name: 'Приветствие и представление', applicable: true, score: 10, comment: 'Поздоровалась и назвала салон и имя' },
          { id: 4, name: 'Презентация услуги и озвучивание цены', applicable: true, score: 6, comment: 'Не озвучена стоимость маникюра' },
          { id: 9, name: 'Закрытие на запись', applicable: true, score: 10, comment: 'Запись оформлена' },
        ],
        mistakes: ['Не озвучила стоимость услуги перед записью'],
        recommendations: ['Называть ориентировочную стоимость услуги при оформлении записи.'],
      },
    });

    const parsed = parseGigaChatJson(rawJson, sampleTranscript, 'Fashion Look Studio');
    assert.equal(parsed.feedback_source, 'model');
    assert.equal(parsed.feedback_reason, undefined);
    assert.deepEqual(parsed.recommendations, ['Называть ориентировочную стоимость услуги при оформлении записи.']);
  });

  it('falls back to feedback_source="template" with explicit feedback_reason when model omits recommendations', () => {
    const rawJson = JSON.stringify({
      is_conversation: true,
      booking_status: 'запись состоялась',
      summary: {
        goal: 'Запись на маникюр',
        requested_service: 'маникюр с покрытием',
        offered_master: 'Ольга',
        offered_price: 'не озвучено',
        offered_date_time: 'завтра в 15:00',
        booking_done: 'Запись состоялась',
        unbooked_reason: null,
        short_summary: 'Клиент записался на маникюр к мастеру Ольге.',
      },
      audit: {
        criteria: [
          { id: 1, name: 'Приветствие и представление', applicable: true, score: 10, comment: 'Ок' },
          { id: 4, name: 'Презентация услуги и озвучивание цены', applicable: true, score: 4, comment: 'Цена не озвучена' },
        ],
        mistakes: ['Не озвучила стоимость услуги'],
      },
    });

    const parsed = parseGigaChatJson(rawJson, sampleTranscript, 'Fashion Look Studio');
    assert.equal(parsed.feedback_source, 'template');
    assert.ok(parsed.feedback_reason && parsed.feedback_reason.length > 5);
  });

  it('reconciles "грубых ошибок не допущено" against a 4/10 criterion in normal non-verified parseGigaChatJson pipeline', () => {
    const rawJson = JSON.stringify({
      is_conversation: true,
      booking_status: 'запись состоялась',
      summary: {
        goal: 'Запись на маникюр',
        requested_service: 'маникюр с покрытием',
        offered_master: 'Ольга',
        offered_price: 'не озвучено',
        offered_date_time: 'завтра в 15:00',
        booking_done: 'Запись состоялась',
        unbooked_reason: null,
        short_summary: 'Клиент записался на маникюр.',
      },
      audit: {
        criteria: [
          { id: 1, name: 'Приветствие и представление', applicable: true, score: 10, comment: 'Ок' },
          { id: 4, name: 'Презентация услуги и озвучивание цены', applicable: true, score: 4, comment: 'Не озвучена стоимость услуги' },
          { id: 9, name: 'Закрытие на запись', applicable: true, score: 10, comment: 'Запись оформлена' },
        ],
        mistakes: ['Грубых ошибок не допущено'],
        recommendations: ['Озвучивать цену до подтверждения записи.'],
      },
    });

    const parsed = parseGigaChatJson(rawJson, sampleTranscript, 'Fashion Look Studio');
    const mistakesJoined = (parsed.operator_mistakes || []).join(' ').toLowerCase();
    assert.equal(mistakesJoined.includes('грубых ошибок не допущено'), false);
    assert.ok((parsed.operator_mistakes || []).length > 0);
    assert.match(mistakesJoined, /презентация услуги|стоимость|4\/10/);
    assert.equal(parsed.transcript_summary.toLowerCase().includes('грубых ошибок не допущено'), false);
  });

  it('reconciles error-free phrase inside harmonizeMistakesAndEvaluation when any criterion is 4/10', () => {
    const evaluation: CallEvaluation = {
      overall_score: 7.5,
      max_score: 10,
      applicable_count: 3,
      total_criteria_count: 10,
      summary_verdict: 'Есть недочёт по презентации цены',
      criteria: [
        { id: 'greeting', name: 'Приветствие и представление', is_applicable: true, score: 10, explanation: 'Ок' },
        { id: 'service_presentation', name: 'Презентация услуги и озвучивание цены', is_applicable: true, score: 4, explanation: 'Цена не названа' },
        { id: 'booking_close', name: 'Закрытие на запись', is_applicable: true, score: 9, explanation: 'Ок' },
      ],
    };

    const harmonized = harmonizeMistakesAndEvaluation(
      ['Грубых ошибок не допущено'],
      ['Озвучивать стоимость до подтверждения записи.'],
      evaluation,
      sampleTranscript
    );

    assert.ok(harmonized.mistakes.length > 0);
    assert.equal(
      harmonized.mistakes.some((m) => /грубых ошибок не допущено/i.test(m)),
      false
    );
    const direct = reconcileMistakesWithCriteria(['Нарушений нет'], evaluation.criteria);
    assert.ok(direct.mistakes.length > 0);
    assert.equal(direct.mistakes.some((m) => /нарушений нет/i.test(m)), false);
  });
});
