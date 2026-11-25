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
  verifyFieldQuoteSpeaker,
  applyVerdicts,
} from '../gigachat.js';
import { isGreetingOnlyQuote } from '../quoteRoleGuard.js';
import { findSynthesisSupportQuoteInTranscript } from '../callVerifier.js';
import {
  isCallWithoutLiveManager,
  isShortNoTopicCall,
  classifyPartialOrInquiryCall,
} from '../transcriptUtils.js';
import {
  harmonizeMistakesAndEvaluation,
  reconcileMistakesWithCriteria,
  hasClientRefusalPhrase,
  isShortOutboundRefusalCall,
} from '../evaluationUtils.js';
import { getDefaultConfig } from '../../store/store.js';
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
    const ex12Idx = FEW_SHOT_EXTENDED_CASES.indexOf('ПРИМЕР 12');
    assert.ok(ex10Idx >= 0 && ex11Idx > ex10Idx && ex12Idx > ex11Idx);

    const ex10Chunk = FEW_SHOT_EXTENDED_CASES.slice(ex10Idx, ex11Idx);
    const parsed10 = JSON.parse(ex10Chunk.slice(ex10Chunk.indexOf('{'), ex10Chunk.lastIndexOf('}') + 1));
    assert.equal(parsed10.is_conversation, true);
    assert.equal(parsed10.booking_status, 'Запись состоялась');
    const c9Ex10 = parsed10.audit.criteria.find((c: any) => /закрытие на запись/i.test(c.name));
    assert.equal(c9Ex10?.applicable, true);
    assert.ok(c9Ex10?.score >= 9);

    const ex11Chunk = FEW_SHOT_EXTENDED_CASES.slice(ex11Idx, ex12Idx);
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

describe('Short outbound outreach rule (ПРИМЕР 12), field-speaker quote check, and interest->refusal control', () => {
  it('includes valid ПРИМЕР 12 for short outbound outreach calls and removes harsh closing penalty in validateResult', () => {
    const sysPrompt = getSystemPrompt('Fashion Look Studio');
    assert.match(sysPrompt, /Консультация \/ отказ/i);
    assert.match(sysPrompt, /Запланировать повторный обзвон/i);
    assert.match(sysPrompt, /интерес → отказ/i);

    const userPrompt = buildUserPrompt('Тест', 14);
    for (let i = 1; i <= 12; i++) {
      assert.ok(userPrompt.includes(`ПРИМЕР ${i}`), `Должен присутствовать ПРИМЕР ${i}`);
    }

    const ex12Idx = FEW_SHOT_EXTENDED_CASES.indexOf('ПРИМЕР 12');
    const ex13Idx = FEW_SHOT_EXTENDED_CASES.indexOf('ПРИМЕР 13');
    assert.ok(ex12Idx >= 0);
    assert.ok(ex13Idx > ex12Idx);
    const ex12Chunk = FEW_SHOT_EXTENDED_CASES.slice(ex12Idx, ex13Idx);
    const parsed12 = JSON.parse(ex12Chunk.slice(ex12Chunk.indexOf('{'), ex12Chunk.lastIndexOf('}') + 1));
    assert.equal(parsed12.is_conversation, true);
    assert.equal(parsed12.booking_status, 'Консультация / отказ');
    assert.match(parsed12.summary.reason_if_not, /клиент отказался \/ не смогла разговаривать/i);
    assert.ok(parsed12.summary.manager_next_steps.some((s: string) => /запланировать повторный обзвон/i.test(s)));
    const c2Ex12 = parsed12.audit.criteria.find((c: any) => /выявление потребности/i.test(c.name));
    const c9Ex12 = parsed12.audit.criteria.find((c: any) => /закрытие на запись/i.test(c.name));
    assert.equal(c2Ex12?.applicable, false);
    assert.equal(c2Ex12?.score, null);
    assert.equal(c9Ex12?.applicable, false);
    assert.equal(c9Ex12?.score, null);

    // Programmatic repair on harsh model penalty for short outbound outreach refusal call
    const outboundTranscript =
      'Менеджер: Добрый день! Это салон Fashion Look Studio, администратор Анна, звоню по поводу записи.\n' +
      'Клиент: Увы, сейчас нет, не могу говорить.\n' +
      'Менеджер: Хорошо, извините за беспокойство, хорошего дня!\n' +
      'Клиент: До свидания.';

    assert.equal(isShortOutboundRefusalCall(outboundTranscript), true);
    assert.equal(hasClientRefusalPhrase(outboundTranscript), true);

    const harshModelJson = JSON.stringify({
      is_conversation: true,
      booking_status: 'Консультация / отказ',
      summary: {
        goal: 'Исходящий обзвон по поводу записи',
        service: 'маникюр',
        date_time: 'завтра в 15:00',
        booking_done: 'Консультация / отказ',
        reason_if_not: 'не применимо',
        manager_next_steps: [],
        short_summary: 'Администратор позвонила по поводу записи, клиент ответила, что не может говорить.',
      },
      audit: {
        criteria: [
          { name: 'Приветствие и представление', score: 10, applicable: true, reasoning: 'Отлично.' },
          { name: 'Выявление потребности гостя', score: 3, applicable: true, reasoning: 'Не выявил потребность.' },
          { name: 'Закрытие на запись', score: 2, applicable: true, reasoning: 'Бронь не оформлена, попытка закрытия отсутствовала.' },
          { name: 'Качество коммуникации и завершение разговора', score: 10, applicable: true, reasoning: 'Вежливо.' },
        ],
        overall_score: 6,
        mistakes: ['Бронь не оформлена', 'Не выявил потребность клиента'],
      },
      recommendations: ['Запланировать повторный обзвон'],
    });

    const parsed = parseGigaChatJson(harshModelJson, 'Fashion Look Studio', outboundTranscript);
    assert.equal(parsed.booking_status, 'отказ');
    assert.equal(parsed.structured_summary?.requested_service, 'не озвучено');
    assert.equal(parsed.structured_summary?.offered_date_time, 'не озвучено');
    assert.equal(parsed.key_facts.service, null);
    assert.equal(parsed.key_facts.date, null);
    assert.equal(parsed.key_facts.time, null);
    assert.match(parsed.structured_summary?.unbooked_reason || '', /клиент отказался \/ не смогла разговаривать/i);
    assert.ok(
      (parsed.structured_summary?.manager_next_steps || []).some((s) => /запланировать повторный обзвон/i.test(s))
    );

    const c2 = (parsed.criteria_scores || []).find((c) => c.id === 'needs_identification');
    const c9 = (parsed.criteria_scores || []).find((c) => c.id === 'closing');
    assert.equal(c2?.is_applicable, false);
    assert.equal(c2?.score, null);
    assert.equal(c9?.is_applicable, false);
    assert.equal(c9?.score, null);
    assert.ok(typeof parsed.operator_score === 'number' && parsed.operator_score >= 9);
    assert.equal((parsed.operator_mistakes || []).some((m) => /бронь не оформлена/i.test(m)), false);
  });

  it('verifies quote against field owner speaker and logs exact [Generator WARNING] when manager quote is bound to field "цель"', () => {
    const transcript =
      'Менеджер: Добрый день! Это салон Fashion Look Studio, администратор Анна, звоню по поводу записи.\n' +
      'Клиент: Здравствуйте, мне нужна стрижка на субботу.\n' +
      'Менеджер: Хорошо, записала вас на субботу в 12:00.\n' +
      'Клиент: Спасибо, до свидания.';

    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => {
      warnings.push(args.map(String).join(' '));
    };

    try {
      // Direct helper check
      const directCheck = verifyFieldQuoteSpeaker('call_purpose', 'звоню по поводу записи', transcript);
      assert.equal(directCheck.valid, false);
      assert.equal(directCheck.fieldLabelRu, 'цель');
      assert.equal(directCheck.actualRole, 'manager');
      assert.ok(
        warnings.some((w) =>
          w.includes('[Generator WARNING] цитата «звоню по поводу записи» привязана к полю «цель», но принадлежит реплике менеджера.')
        ),
        `Ожидался точный лог, получено: ${warnings.join(' | ')}`
      );

      // End-to-end inside parseGigaChatJson (quote embedded in goal field without explicit role verb)
      warnings.length = 0;
      const modelJson = JSON.stringify({
        is_conversation: true,
        booking_status: 'Запись состоялась',
        summary: {
          goal: 'Обращение: «звоню по поводу записи»',
          service: 'стрижка',
          master: 'не озвучено',
          price: 'не озвучено',
          date_time: 'суббота в 12:00',
          booking_done: 'Запись состоялась',
          reason_if_not: 'не применимо',
          manager_next_steps: ['Подтвердить запись'],
          short_summary: 'Клиент записалась на стрижку на субботу в 12:00.',
        },
        audit: {
          criteria: [
            { name: 'Приветствие и представление', score: 10, applicable: true, reasoning: 'Ок' },
            { name: 'Закрытие на запись', score: 10, applicable: true, reasoning: 'Запись оформлена' },
          ],
          overall_score: 10,
          mistakes: [],
        },
        recommendations: [],
      });

      const parsed = parseGigaChatJson(modelJson, 'Fashion Look Studio', transcript);
      assert.equal(parsed.structured_summary?.call_purpose, 'требует проверки');
      assert.ok((parsed.verification_flags || []).includes('call_purpose'));
      assert.ok(
        warnings.some((w) =>
          w.includes('[Generator WARNING] цитата «звоню по поводу записи» привязана к полю «цель», но принадлежит реплике менеджера.')
        ),
        `Ожидался точный лог в parseGigaChatJson, получено: ${warnings.join(' | ')}`
      );

      // Valid client quote bound to "цель" must pass without warnings
      warnings.length = 0;
      const validCheck = verifyFieldQuoteSpeaker('call_purpose', 'мне нужна стрижка на субботу', transcript);
      assert.equal(validCheck.valid, true);
      assert.equal(warnings.length, 0);
    } finally {
      console.warn = origWarn;
    }
  });

  it('enforces interest->refusal control: strips confirmed service/date/time and disables Criterion 2 on "нет" / "не могу" / "не сейчас"', () => {
    const refusalTranscript =
      'Менеджер: Добрый день, салон Fashion Look Studio, администратор Ольга. Хотели бы записаться на маникюр завтра в 14:00?\n' +
      'Клиент: Нет, не сейчас, спасибо.\n' +
      'Менеджер: Хорошо, всего доброго!\n' +
      'Клиент: До свидания.';

    const modelJson = JSON.stringify({
      is_conversation: true,
      booking_status: 'Отказ',
      summary: {
        goal: 'Предложение записи на маникюр',
        service: 'маникюр',
        master: 'не озвучено',
        price: 'не озвучено',
        date_time: 'завтра в 14:00',
        booking_done: 'Отказ',
        reason_if_not: 'Клиент отказалась записываться сейчас',
        manager_next_steps: ['Запланировать повторный контакт'],
        short_summary: 'Менеджер предложила запись, но клиент отказалась («Нет, не сейчас, спасибо»).',
      },
      audit: {
        criteria: [
          { name: 'Приветствие и представление', score: 10, applicable: true, reasoning: 'Ок' },
          { name: 'Выявление потребности гостя', score: 5, applicable: true, reasoning: 'Не выявил потребности' },
          { name: 'Качество коммуникации и завершение разговора', score: 9, applicable: true, reasoning: 'Вежливо' },
        ],
        overall_score: 8,
        mistakes: ['Не выявил потребность гостя'],
      },
      recommendations: [],
    });

    const parsed = parseGigaChatJson(modelJson, 'Fashion Look Studio', refusalTranscript);
    assert.equal(parsed.booking_status, 'отказ');
    assert.equal(parsed.structured_summary?.requested_service, 'не озвучено');
    assert.equal(parsed.structured_summary?.offered_date_time, 'не озвучено');
    assert.equal(parsed.key_facts.service, null);
    assert.equal(parsed.key_facts.date, null);
    assert.equal(parsed.key_facts.time, null);

    const crit2 = (parsed.criteria_scores || []).find((c) => c.id === 'needs_identification');
    assert.ok(crit2);
    assert.equal(crit2!.is_applicable, false);
    assert.equal(crit2!.score, null);
    assert.equal((parsed.operator_mistakes || []).some((m) => /потребност/i.test(m)), false);
  });
});

describe('Full specification acceptance criteria: Classes A/B/C, Dinara ASR distortion, Лазарчик transfer, greeting guard, GigaChat:Ultra default', () => {
  it('includes valid ПРИМЕР 1–17 in prompt (Class A short/autoresponder, Class B partial/master inquiry, Class C control)', () => {
    const sysPrompt = getSystemPrompt('LIQ28');
    assert.match(sysPrompt, /Fashion Look Studio/i);
    assert.match(sysPrompt, /LIQ28/i);
    assert.match(sysPrompt, /лис 28/i);
    assert.match(sysPrompt, /КЛАСС A/i);
    assert.match(sysPrompt, /КЛАСС B/i);
    assert.match(sysPrompt, /КЛАСС C/i);
    assert.match(sysPrompt, /цитату-приветствие/i);

    const userPrompt = buildUserPrompt('Тест', 20);
    for (let i = 1; i <= 17; i++) {
      assert.ok(userPrompt.includes(`ПРИМЕР ${i}`), `Должен присутствовать ПРИМЕР ${i}`);
    }

    const extractExampleJson = (num: number, nextNum?: number) => {
      const start = FEW_SHOT_EXTENDED_CASES.indexOf(`ПРИМЕР ${num}`);
      assert.ok(start >= 0, `ПРИМЕР ${num} не найден`);
      const end = nextNum ? FEW_SHOT_EXTENDED_CASES.indexOf(`ПРИМЕР ${nextNum}`) : FEW_SHOT_EXTENDED_CASES.length;
      const chunk = FEW_SHOT_EXTENDED_CASES.slice(start, end);
      return JSON.parse(chunk.slice(chunk.indexOf('{'), chunk.lastIndexOf('}') + 1));
    };

    const ex13 = extractExampleJson(13, 14);
    assert.equal(ex13.is_conversation, false);
    assert.equal(ex13.audit.overall_score, null);
    assert.deepEqual(ex13.audit.criteria, []);
    assert.equal(ex13.summary.booking_done, 'Не состоялся / короткий вызов');

    const ex14 = extractExampleJson(14, 15);
    assert.equal(ex14.is_conversation, false);
    assert.equal(ex14.audit.overall_score, null);

    const ex15 = extractExampleJson(15, 16);
    assert.equal(ex15.is_conversation, true);
    assert.equal(ex15.booking_status, 'Частичный контакт');
    const c9Ex15 = ex15.audit.criteria.find((c: any) => /закрытие на запись/i.test(c.name));
    assert.equal(c9Ex15?.applicable, false);

    const ex16 = extractExampleJson(16, 17);
    assert.equal(ex16.is_conversation, true);
    assert.equal(ex16.booking_status, 'Запись состоялась');

    const ex17 = extractExampleJson(17);
    assert.equal(ex17.is_conversation, true);
    assert.equal(ex17.booking_status, 'Справочный запрос');
    const c9Ex17 = ex17.audit.criteria.find((c: any) => /закрытие на запись/i.test(c.name));
    assert.equal(c9Ex17?.applicable, false);
  });

  it('Acceptance 1 — Dinara outbound confirmation with ASR salon distortion ("лис 28" / "от, а, 28"): C9=9-10, C8=not applicable, C1>=8, overall 8-10', () => {
    const dinaraTranscript =
      'Менеджер: Алло, Динара, добрый вечер! Салон лис 28, меня зовут Алёна. Вы к нам записаны завтра на 14:00 на маникюр к мастеру Анне.\n' +
      'Клиент: Да, я буду.\n' +
      'Менеджер: Отлично, будем вас ждать, до свидания!\n' +
      'Клиент: Спасибо, до свидания.';

    const flawedModelJson = JSON.stringify({
      is_conversation: true,
      booking_status: 'Запись подтверждена',
      summary: {
        goal: 'Исходящее подтверждение существующей записи на маникюр',
        service: 'маникюр',
        master: 'Анна',
        price: 'не озвучено',
        date_time: 'завтра в 14:00',
        booking_done: 'Подтверждение ранее сделанной записи',
        reason_if_not: 'не применимо',
        manager_next_steps: ['Отметить подтверждение записи в CRM'],
        short_summary: 'Администратор Алёна позвонила Динаре подтвердить запись на маникюр, клиент подтвердила визит.',
      },
      audit: {
        criteria: [
          { name: 'Приветствие и представление', score: 6, applicable: true, reasoning: 'Не назвала название салона корректно.' },
          { name: 'Предложение альтернативных вариантов', score: 3, applicable: true, reasoning: 'Не предложены альтернативные варианты.' },
          { name: 'Закрытие на запись', score: 4, applicable: true, reasoning: 'Бронь не оформлена, попытка закрытия отсутствовала.' },
          { name: 'Качество коммуникации и завершение разговора', score: 9, applicable: true, reasoning: 'Вежливое прощание.' },
        ],
        overall_score: 5,
        mistakes: ['Не назвала название салона', 'Бронь не оформлена', 'Не предложены альтернативные варианты'],
      },
      recommendations: ['Поддерживать вежливый тон общения.'],
    });

    const parsed = parseGigaChatJson(flawedModelJson, 'LIQ28', dinaraTranscript);
    assert.equal(parsed.booking_status, 'согласие');

    const c1 = (parsed.criteria_scores || []).find((c) => c.id === 'greeting_intro');
    const c8 = (parsed.criteria_scores || []).find((c) => c.id === 'alternatives');
    const c9 = (parsed.criteria_scores || []).find((c) => c.id === 'closing');

    assert.ok(c1 && typeof c1.score === 'number' && c1.score >= 8, `Ожидался C1 >= 8, получено ${c1?.score}`);
    assert.equal(c8?.is_applicable, false);
    assert.equal(c8?.score, null);
    assert.equal(c9?.is_applicable, true);
    assert.ok(c9 && typeof c9.score === 'number' && c9.score >= 9, `Ожидался C9 >= 9, получено ${c9?.score}`);
    assert.equal(/бронь не оформлена|попытка закрытия отсутствовала/i.test(c9?.explanation || ''), false);
    assert.ok(typeof parsed.operator_score === 'number' && parsed.operator_score >= 8, `Ожидался overall >= 8, получено ${parsed.operator_score}`);
    assert.equal((parsed.operator_mistakes || []).some((m) => /бронь не оформлена|название салона/i.test(m)), false);
  });

  it('Acceptance 2 — Class A short/empty calls ("Алло — Алло", "Добрый день, салон ЛИQ28... — Алло.", "Номер занят — До свидания"): score null, 0 criteria, no mistakes, no "требуется обучение"', () => {
    const classACalls = [
      'Клиент: Алло?\nМенеджер: Алло.',
      'Менеджер: Добрый день, салон ЛИQ28, администратор Анна.\nКлиент: Алло.\nМенеджер: Алло, слышно?',
      'Автоинформатор: Номер занят.\nМенеджер: До свидания.',
    ];

    for (const tr of classACalls) {
      assert.equal(isShortNoTopicCall(tr, 12), true, `Ожидался Класс A для: ${tr}`);
      assert.equal(hasSubstantiveLiveDialogue(tr), false);

      // Even if model erroneously scores it as 3/10 with mistakes, Repair zeroes audit
      const badModelJson = JSON.stringify({
        is_conversation: true,
        booking_status: 'Консультация',
        summary: {
          goal: 'Алло',
          booking_done: 'Консультация',
          short_summary: 'Короткий вызов.',
        },
        audit: {
          criteria: [
            { name: 'Закрытие на запись', score: 2, applicable: true, reasoning: 'Бронь не оформлена, попытка закрытия отсутствовала.' },
          ],
          overall_score: 2,
          mistakes: ['Бронь не оформлена'],
        },
      });

      const parsed = parseGigaChatJson(badModelJson, 'LIQ28', tr);
      assert.equal(parsed.is_conversation, false);
      assert.equal(parsed.booking_status, 'не применимо');
      assert.equal(parsed.operator_score, null);
      assert.deepEqual(parsed.criteria_scores, []);
      assert.deepEqual(parsed.operator_mistakes, []);
      assert.equal(parsed.evaluation?.applicable_count, 0);
      assert.match(parsed.evaluation?.summary_verdict || '', /оценка качества оператора не производится/i);
      assert.equal(/требуется обучение/i.test(parsed.evaluation?.summary_verdict || ''), false);
    }
  });

  it('Acceptance 3 — Class C protection ("мы пока предварительно забронировали с 12 до 2") is NEVER treated as Class A, and Class B ("Можно Елену? — Её сейчас нет") has no C9 penalty and no "требуется обучение"', () => {
    const classCPrebooked =
      'Менеджер: Добрый день, салон LIQ28.\n' +
      'Клиент: Мы пока предварительно забронировали с 12 до 2, всё в силе?\n' +
      'Менеджер: Да, подтверждаю, ждём вас.';
    assert.equal(isShortNoTopicCall(classCPrebooked, 15), false);
    assert.equal(hasSubstantiveLiveDialogue(classCPrebooked), true);

    const masterInquiry =
      'Менеджер: Добрый день, салон LIQ28, администратор Светлана.\n' +
      'Клиент: Здравствуйте, а можно Елену?\n' +
      'Менеджер: Её сейчас нет, она сегодня на выходном.\n' +
      'Клиент: Понятно, спасибо, до свидания.';
    assert.equal(isShortNoTopicCall(masterInquiry, 16), false);
    assert.equal(classifyPartialOrInquiryCall(masterInquiry), 'master_inquiry');

    const harshClassBJson = JSON.stringify({
      is_conversation: true,
      booking_status: 'Справочный запрос',
      summary: {
        goal: 'Справочный вопрос о наличии мастера Елены',
        service: 'не озвучено',
        master: 'Елена',
        price: 'не озвучено',
        date_time: 'не озвучено',
        booking_done: 'Справочный запрос',
        reason_if_not: 'Мастер на выходном',
        manager_next_steps: [],
        short_summary: 'Клиент спросила Елену, администратор сообщила что её нет.',
      },
      audit: {
        criteria: [
          { name: 'Приветствие и представление', score: 10, applicable: true, reasoning: 'Отлично.' },
          { name: 'Закрытие на запись', score: 2, applicable: true, reasoning: 'Бронь не оформлена, попытка закрытия отсутствовала.' },
          { name: 'Качество коммуникации и завершение разговора', score: 9, applicable: true, reasoning: 'Вежливо.' },
        ],
        overall_score: 4,
        mistakes: ['Бронь не оформлена'],
      },
      recommendations: ['Перезвонить, когда мастер будет доступен.'],
    });

    const parsedB = parseGigaChatJson(harshClassBJson, 'LIQ28', masterInquiry);
    const c9B = (parsedB.criteria_scores || []).find((c) => c.id === 'closing');
    assert.equal(c9B?.is_applicable, false);
    assert.equal(c9B?.score, null);
    assert.equal((parsedB.operator_mistakes || []).some((m) => /бронь не оформлена/i.test(m)), false);
    assert.equal(/требуется обучение/i.test(parsedB.evaluation?.summary_verdict || ''), false);
    assert.ok((parsedB.structured_summary?.manager_next_steps || []).length > 0);
  });

  it('Acceptance 4 — Greeting quote cannot be placed into call_purpose ("Цель обращения")', () => {
    assert.equal(isGreetingOnlyQuote('Добрый день, салон ЛИQ28, администратор Анна'), true);
    assert.equal(isGreetingOnlyQuote('Запись на маникюр завтра в 14:00'), false);

    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => warnings.push(args.map(String).join(' '));
    try {
      const checked = enforceSummaryQuoteRoleControl(
        {
          call_purpose: '«Добрый день, салон ЛИQ28, администратор Анна»',
        },
        'Менеджер: Добрый день, салон ЛИQ28, администратор Анна.\nКлиент: Мне бы стрижку.'
      );
      assert.equal(checked.fields.call_purpose, 'требует проверки');
      assert.ok(checked.flaggedFields.includes('call_purpose'));
      assert.ok(warnings.some((w) => w.includes('[Generator WARNING] цитата-приветствие')));
    } finally {
      console.warn = origWarn;
    }
  });

  it('Acceptance 5 — Transfer to master Лазарчик synthesis fields (booking_done / booking_status_text) produce 0 flags in Verifier', () => {
    const transcript =
      'Менеджер: Добрый день, салон LIQ28! Мы перенесли вашу запись к мастеру Лазарчик, без изменения в цене, без изменения времени, просто к другому мастеру.\n' +
      'Клиент: Да, хорошо, спасибо большое!\n' +
      'Менеджер: Ждём вас, до свидания.';

    const support = findSynthesisSupportQuoteInTranscript(
      transcript,
      'запись перенесена к мастеру Лазарчик без изменения'
    );
    assert.ok(support, 'Ожидалась подтверждающая цитата составных фактов в стенограмме');

    const draft = parseGigaChatJson(
      JSON.stringify({
        is_conversation: true,
        booking_status: 'Запись состоялась',
        summary: {
          goal: 'Уведомление о переносе записи к другому мастеру',
          service: 'не озвучено',
          master: 'Лазарчик',
          price: 'не озвучено',
          date_time: 'не озвучено',
          booking_done: 'запись перенесена к мастеру Лазарчик без изменения',
          reason_if_not: 'не применимо',
          manager_next_steps: ['Проверить запись у мастера Лазарчик в CRM'],
          short_summary: 'Администратор уведомила клиента о переносе записи к мастеру Лазарчик без изменения цены и времени, клиент согласилась.',
        },
        audit: {
          criteria: [
            { name: 'Приветствие и представление', score: 9, applicable: true, reasoning: 'Ок', quote: 'Добрый день, салон LIQ28!' },
            { name: 'Закрытие на запись', score: 10, applicable: true, reasoning: 'Перенос согласован', quote: 'Да, хорошо, спасибо большое!' },
          ],
          overall_score: 9.5,
          mistakes: [],
        },
        recommendations: [],
      }),
      'LIQ28',
      transcript
    );

    // Simulate Verifier model erroneously marking synthesis fields unconfirmed (because exact phrase isn't verbatim)
    const verified = applyVerdicts(
      draft,
      [
        {
          field: 'booking_done',
          draft_value: 'запись перенесена к мастеру Лазарчик без изменения',
          verdict: 'unconfirmed',
          quote: null,
          corrected_value: null,
        },
        {
          field: 'booking_status_text',
          draft_value: 'запись перенесена к мастеру Лазарчик без изменения',
          verdict: 'unconfirmed',
          quote: null,
          corrected_value: null,
        },
      ],
      [],
      0,
      transcript
    );

    assert.equal((verified.verification_flags || []).length, 0, `Ожидалось 0 флагов, получено: ${JSON.stringify(verified.verification_flags)}`);
    assert.equal(verified.verification_report?.summary_verdict, 'ок');
    assert.equal(verified.verification_report?.hallucinated_quotes_caught, 0);
    assert.equal(verified.structured_summary?.booking_status_text, 'запись перенесена к мастеру Лазарчик без изменения');
  });

  it('Acceptance 6 — Default analysis model is GigaChat:Ultra and fallback logs explicit reason for Summary source', () => {
    const prevModel = process.env.GIGACHAT_MODEL;
    const prevDefault = process.env.GIGACHAT_DEFAULT_MODEL;
    delete process.env.GIGACHAT_MODEL;
    delete process.env.GIGACHAT_DEFAULT_MODEL;
    try {
      const cfg = getDefaultConfig();
      assert.equal(cfg.default_gigachat_model, 'GigaChat:Ultra');
      assert.equal(cfg.activeModel, 'GigaChat:Ultra');
    } finally {
      if (prevModel !== undefined) process.env.GIGACHAT_MODEL = prevModel;
      if (prevDefault !== undefined) process.env.GIGACHAT_DEFAULT_MODEL = prevDefault;
    }

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.map(String).join(' '));
    try {
      parseGigaChatJson(
        JSON.stringify({
          is_conversation: true,
          booking_status: 'Консультация',
          summary: {},
          audit: { criteria: [], overall_score: 8, mistakes: [] },
        }),
        'Fashion Look Studio',
        'Менеджер: Добрый день, салон Fashion Look Studio.\nКлиент: Сколько стоит стрижка?\nМенеджер: Стрижка стоит 3000 рублей.\nКлиент: Спасибо, подумаю.'
      );
      assert.ok(
        logs.some((l) => /\[Summary source: template \(причина: .+\)\]/.test(l)),
        `Ожидался лог [Summary source: template (причина: ...)], получено: ${logs.join(' | ')}`
      );
    } finally {
      console.log = origLog;
    }
  });
});



