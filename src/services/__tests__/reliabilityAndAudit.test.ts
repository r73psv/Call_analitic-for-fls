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
import {
  parseGigaChatJson,
  getSystemPrompt,
  buildUserPrompt,
  FEW_SHOT_EXTENDED_CASES,
  hasSubstantiveLiveDialogue,
  enforceSummaryQuoteRoleControl,
} from '../gigachat.js';
import { isCallWithoutLiveManager } from '../transcriptUtils.js';
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

    const parsed = parseGigaChatJson(rawJson, 'Fashion Look Studio', sampleTranscript);
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

    const parsed = parseGigaChatJson(rawJson, 'Fashion Look Studio', sampleTranscript);
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

    const parsed = parseGigaChatJson(rawJson, 'Fashion Look Studio', sampleTranscript);
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

describe('Criterion 9 confirmation class, not-reaching-manager detector, and generator quote-role control', () => {
  it('enforces Criterion 9 score 9-10 and strips forbidden phrases for booking_status="запись подтверждена" when client confirms visit', () => {
    const incomingConfirmTranscript =
      'Менеджер: Добрый день, салон красоты Fashion Look Studio, администратор Светлана.\n' +
      'Клиент: Здравствуйте, я записана на завтра в 11:00 на окрашивание к Елене, да, я буду, подтверждаю.\n' +
      'Менеджер: Спасибо, отметила подтверждение вашей записи, ждём вас завтра в 11:00!\n' +
      'Клиент: Спасибо, до свидания.';

    const rawJson = JSON.stringify({
      is_conversation: true,
      booking_status: 'запись подтверждена',
      summary: {
        goal: 'Подтверждение существующей записи на окрашивание',
        service: 'окрашивание',
        master: 'Елена',
        price: 'не озвучено',
        date_time: 'завтра в 11:00',
        booking_done: 'Подтверждение существующей записи',
        reason_if_not: 'не применимо',
        manager_next_steps: ['Отметить подтверждение в CRM'],
        short_summary: 'Клиент подтвердила существующую запись на окрашивание на завтра в 11:00 к мастеру Елене.',
      },
      audit: {
        criteria: [
          { name: 'Приветствие и представление', score: 10, applicable: true, reasoning: 'Полное приветствие.' },
          { name: 'Закрытие на запись', score: 4, applicable: true, reasoning: 'Попытка закрытия отсутствовала, бронь не оформлена.' },
          { name: 'Качество коммуникации и завершение разговора', score: 10, applicable: true, reasoning: 'Вежливо.' },
        ],
        overall_score: 8,
        mistakes: ['Попытка закрытия отсутствовала, бронь не оформлена'],
      },
      recommendations: ['Не допускать ситуаций, когда бронь не оформлена.'],
    });

    const parsed = parseGigaChatJson(rawJson, 'Fashion Look Studio', incomingConfirmTranscript);
    assert.equal(parsed.booking_status, 'согласие');
    const c9 = (parsed.criteria_scores || []).find((c) => c.id === 'closing' || /закрытие на запись/i.test(c.name));
    assert.ok(c9);
    assert.equal(c9!.is_applicable, true);
    assert.ok(typeof c9!.score === 'number' && c9!.score >= 9 && c9!.score <= 10);
    assert.doesNotMatch(c9!.explanation, /попытка закрытия отсутствовала|бронь не оформлена/i);
    assert.equal(
      (parsed.operator_mistakes || []).some((m) => /попытка закрытия отсутствовала|бронь не оформлена/i.test(m)),
      false
    );
    assert.doesNotMatch(parsed.transcript_summary, /попытка закрытия отсутствовала|бронь не оформлена/i);
  });

  it('detects "звонок не дошёл до менеджера" (IVR/queue/beeps + 1-2 short non-substantive utterances) and suppresses audit with score null', () => {
    const queueAndShortUtterances =
      'Автоинформатор: Здравствуйте, вы позвонили в салон красоты. Обращаем ваше внимание, разговор может быть записан. Ваш звонок очень важен для нас, оставайтесь на линии, все операторы сейчас заняты.\n' +
      '[гудки]\n' +
      'Клиент: Алло? Здравствуйте?\n' +
      '[гудки]\n' +
      'Менеджер: Алло.';

    assert.equal(isCallWithoutLiveManager(queueAndShortUtterances), true);
    assert.equal(hasSubstantiveLiveDialogue(queueAndShortUtterances), false);

    // Even if model hallucinates a conversation + score, parseGigaChatJson MUST override to "не применимо" & null
    const hallucinatedModelJson = JSON.stringify({
      is_conversation: true,
      booking_status: 'Консультация',
      summary: {
        goal: 'Консультация',
        short_summary: 'Клиент поздоровался с менеджером.',
      },
      audit: {
        criteria: [{ name: 'Приветствие и представление', score: 6, applicable: true, reasoning: 'Сказал алло' }],
        overall_score: 6,
        mistakes: ['Не представился'],
      },
    });

    const parsed = parseGigaChatJson(hallucinatedModelJson, 'Fashion Look Studio', queueAndShortUtterances);
    assert.equal(parsed.is_conversation, false);
    assert.equal(parsed.booking_status, 'не применимо');
    assert.equal(parsed.operator_score, null);
    assert.deepEqual(parsed.criteria_scores, []);
    assert.equal(parsed.evaluation?.overall_score, null);
    assert.deepEqual(parsed.operator_mistakes, []);

    // Sanity check: genuine short dialogue after IVR (like ПРИМЕР 7) is NOT falsely flagged
    const realShortDialogueAfterIvr =
      'Автоинформатор: Обращаем ваше внимание, разговор может быть записан.\n' +
      'Менеджер: Алло.\n' +
      'Клиент: Ага, доброе утро. К тебе уже девушка подошла.\n' +
      'Менеджер: Ага. Сейчас буду.\n' +
      'Клиент: Угу.';
    assert.equal(isCallWithoutLiveManager(realShortDialogueAfterIvr), false);
    assert.equal(hasSubstantiveLiveDialogue(realShortDialogueAfterIvr), true);
  });

  it('includes valid ПРИМЕР 10 (confirmation call) and ПРИМЕР 11 (call did not reach manager) in prompt without removing ПРИМЕР 1–9', () => {
    const sysPrompt = getSystemPrompt('Fashion Look Studio');
    assert.match(sysPrompt, /подтверждение существующей записи/i);
    assert.match(sysPrompt, /звонок не дошёл до менеджера/i);
    assert.match(sysPrompt, /требует проверки/i);

    const userPrompt = buildUserPrompt('Тест', 20);
    for (let i = 1; i <= 11; i++) {
      assert.ok(userPrompt.includes(`ПРИМЕР ${i}`), `Должен присутствовать ПРИМЕР ${i}`);
    }

    const ex10Idx = FEW_SHOT_EXTENDED_CASES.indexOf('ПРИМЕР 10');
    const ex11Idx = FEW_SHOT_EXTENDED_CASES.indexOf('ПРИМЕР 11');
    assert.ok(ex10Idx >= 0 && ex11Idx > ex10Idx);

    const ex10Chunk = FEW_SHOT_EXTENDED_CASES.slice(ex10Idx, ex11Idx);
    const parsed10 = JSON.parse(ex10Chunk.slice(ex10Chunk.indexOf('{'), ex10Chunk.lastIndexOf('}') + 1));
    assert.equal(parsed10.is_conversation, true);
    assert.equal(parsed10.booking_status, 'Запись состоялась');
    const c9Ex10 = parsed10.audit.criteria.find((c: any) => /закрытие на запись/i.test(c.name));
    assert.equal(c9Ex10?.applicable, true);
    assert.ok(c9Ex10?.score >= 9);

    const ex11Chunk = FEW_SHOT_EXTENDED_CASES.slice(ex11Idx);
    const parsed11 = JSON.parse(ex11Chunk.slice(ex11Chunk.indexOf('{'), ex11Chunk.lastIndexOf('}') + 1));
    assert.equal(parsed11.is_conversation, false);
    assert.equal(parsed11.booking_status, 'Не применимо');
    assert.equal(parsed11.audit.overall_score, null);
    assert.deepEqual(parsed11.audit.criteria, []);
  });

  it('checks speaker-attributed quotes in generator, logs [Generator WARNING] цитата не совпадает с меткой роли, and marks field "требует проверки" without emitting false quote', () => {
    const transcript =
      'Менеджер: Добрый день, салон Fashion Look Studio, администратор Анна. Мы работаем до девяти вечера.\n' +
      'Клиент: Здравствуйте, запишите меня на маникюр завтра в 18:00.\n' +
      'Менеджер: Записала вас на маникюр завтра в 18:00 к мастеру Ольге.\n' +
      'Клиент: Отлично, да, я буду.';

    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => {
      warnings.push(args.map(String).join(' '));
    };

    try {
      const mismatchedJson = JSON.stringify({
        is_conversation: true,
        booking_status: 'Запись состоялась',
        summary: {
          goal: 'Клиент сказал «мы работаем до девяти вечера» и попросил запись',
          service: 'маникюр',
          master: 'Ольга',
          price: 'не озвучено',
          date_time: 'завтра в 18:00',
          booking_done: 'Запись состоялась',
          reason_if_not: 'не применимо',
          manager_next_steps: ['Подтвердить запись'],
          short_summary:
            'В ходе звонка клиент сказал «мы работаем до девяти вечера», а затем попросил записать на маникюр. Клиент подтвердил «отлично, да, я буду».',
        },
        audit: {
          criteria: [
            { name: 'Приветствие и представление', score: 10, applicable: true, reasoning: 'Ок' },
            { name: 'Закрытие на запись', score: 10, applicable: true, reasoning: 'Запись оформлена' },
          ],
          overall_score: 10,
          mistakes: [],
        },
        recommendations: ['Сохранять вежливый стиль общения.'],
      });

      const parsed = parseGigaChatJson(mismatchedJson, 'Fashion Look Studio', transcript);

      assert.ok(
        warnings.some((w) => w.includes('[Generator WARNING] цитата не совпадает с меткой роли')),
        `Ожидался лог [Generator WARNING] цитата не совпадает с меткой роли, получено: ${warnings.join(' | ')}`
      );
      assert.equal(parsed.structured_summary?.call_purpose, 'требует проверки');
      assert.equal(parsed.transcript_summary.includes('мы работаем до девяти вечера'), false);
      assert.ok(parsed.transcript_summary.includes('требует проверки'));
      // Valid client quote ("отлично, да, я буду") must NOT be removed
      assert.ok(parsed.transcript_summary.includes('отлично, да, я буду'));
      assert.ok((parsed.verification_flags || []).includes('call_purpose'));
      assert.ok((parsed.verification_flags || []).includes('short_summary'));
    } finally {
      console.warn = origWarn;
    }

    // Valid attribution must produce zero warnings and preserve fields untouched
    const cleanWarnings: string[] = [];
    const origWarn2 = console.warn;
    console.warn = (...args: any[]) => {
      cleanWarnings.push(args.map(String).join(' '));
    };
    try {
      const check = enforceSummaryQuoteRoleControl(
        {
          short_summary: 'Менеджер сообщил «мы работаем до девяти вечера», а клиент ответил «отлично, да, я буду».',
          call_purpose: 'Клиент попросил «запишите меня на маникюр завтра в 18:00»',
        },
        transcript
      );
      assert.equal(check.mismatches.length, 0);
      assert.deepEqual(check.flaggedFields, []);
      assert.equal(cleanWarnings.length, 0);
      assert.match(check.fields.short_summary || '', /мы работаем до девяти вечера/);
      assert.match(check.fields.call_purpose || '', /запишите меня на маникюр/);
    } finally {
      console.warn = origWarn2;
    }
  });
});

