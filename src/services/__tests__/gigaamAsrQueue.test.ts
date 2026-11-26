import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAsrMaxConcurrent,
  runWithAsrSemaphore,
  pauseAsrQueue,
  getAsrQueueStatus,
  resetAsrQueueForTest,
  computeAsrErrorClassBackoff,
  ASR_RATE_LIMIT_BACKOFF_MS,
  formatGigaAsrIncidentSummary,
  transcribeWithGigaAmRetry,
  getGigaAmConfig,
  getConfiguredAsrModel,
  getConfiguredAsrFallbackModels,
  classifyAsrFailReason,
  formatAsrModelNotFoundVkAlert,
  formatAsr404ConsecutiveVkAlert,
  formatAsrServiceUnavailableVkAlert,
  shouldAutoRetryPendingAsrCall,
  computeAsr404RetryDelayMs,
  probeCloudRuCatalogOn404,
  createSilentWavBuffer,
  runAsrHealthCheckProbe,
  ASR_404_BACKOFF_MINUTES,
  ASR_404_SERVICE_UNAVAILABLE_BACKOFF_MINUTES,
  ASR_404_POST_RECOVERY_RESET_MINUTES,
  ASR_404_ALERT_CONSECUTIVE_THRESHOLD,
  ASR_SERVICE_UNAVAILABLE_STATUS_LABEL,
  ASR_CLIENT_FRIENDLY_WAITING_TEXT,
} from '../gigaam-asr.js';

function createTinyValidWav(durationSec: number = 0.1): Buffer {
  const sampleRate = 16000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  buf.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

describe('GigaASR Global FIFO Semaphore, 429 Backoff & Incident Summary', () => {
  const origConcurrent = process.env.ASR_MAX_CONCURRENT;
  const origApiUrl = process.env.GIGAAM_API_URL;
  const origApiKey = process.env.GIGAAM_API_KEY;
  const origVariant = process.env.GIGAAM_MODEL_VARIANT;
  const origAsrModel = process.env.ASR_MODEL;
  const origAsrFallback = process.env.ASR_MODEL_FALLBACK;

  beforeEach(() => {
    delete process.env.ASR_MAX_CONCURRENT;
    delete process.env.ASR_MODEL;
    delete process.env.ASR_MODEL_FALLBACK;
    resetAsrQueueForTest();
  });

  afterEach(() => {
    if (origConcurrent === undefined) delete process.env.ASR_MAX_CONCURRENT;
    else process.env.ASR_MAX_CONCURRENT = origConcurrent;
    if (origApiUrl === undefined) delete process.env.GIGAAM_API_URL;
    else process.env.GIGAAM_API_URL = origApiUrl;
    if (origApiKey === undefined) delete process.env.GIGAAM_API_KEY;
    else process.env.GIGAAM_API_KEY = origApiKey;
    if (origVariant === undefined) delete process.env.GIGAAM_MODEL_VARIANT;
    else process.env.GIGAAM_MODEL_VARIANT = origVariant;
    if (origAsrModel === undefined) delete process.env.ASR_MODEL;
    else process.env.ASR_MODEL = origAsrModel;
    if (origAsrFallback === undefined) delete process.env.ASR_MODEL_FALLBACK;
    else process.env.ASR_MODEL_FALLBACK = origAsrFallback;
    resetAsrQueueForTest();
  });

  it('ASR_MAX_CONCURRENT по умолчанию = 1 и читается из env', () => {
    assert.equal(getAsrMaxConcurrent(), 1);
    process.env.ASR_MAX_CONCURRENT = '3';
    assert.equal(getAsrMaxConcurrent(), 3);
    process.env.ASR_MAX_CONCURRENT = '0';
    assert.equal(getAsrMaxConcurrent(), 1);
    process.env.ASR_MAX_CONCURRENT = 'invalid';
    assert.equal(getAsrMaxConcurrent(), 1);
  });

  it('глобальный FIFO-семафор пропускает строго 1 запрос одновременно при ASR_MAX_CONCURRENT=1', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const order: number[] = [];

    const tasks = [1, 2, 3, 4, 5].map((id) =>
      runWithAsrSemaphore(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        order.push(id);
        await new Promise((r) => setTimeout(r, 8));
        inFlight--;
        return id;
      })
    );

    const results = await Promise.all(tasks);
    assert.deepEqual(results, [1, 2, 3, 4, 5]);
    assert.deepEqual(order, [1, 2, 3, 4, 5]);
    assert.equal(maxInFlight, 1);
    assert.equal(getAsrQueueStatus().peakConcurrent, 1);
  });

  it('бэкофф по классам ошибок: 429 использует 30 → 60 → 120 сек и уважает Retry-After', () => {
    const err429: any = new Error('HTTP 429 rate_limit_exceeded');
    err429.status = 429;

    const a1 = computeAsrErrorClassBackoff(1, err429, 1000, null);
    const a2 = computeAsrErrorClassBackoff(2, err429, 2000, null);
    const a3 = computeAsrErrorClassBackoff(3, err429, 4000, null);
    assert.equal(a1.isRateLimit, true);
    assert.equal(a1.delayMs, ASR_RATE_LIMIT_BACKOFF_MS[0]); // 30_000
    assert.equal(a2.delayMs, ASR_RATE_LIMIT_BACKOFF_MS[1]); // 60_000
    assert.equal(a3.delayMs, ASR_RATE_LIMIT_BACKOFF_MS[2]); // 120_000

    // Retry-After больше базовой паузы -> используется Retry-After
    const a1RetryAfter = computeAsrErrorClassBackoff(1, err429, 1000, 95_000);
    assert.equal(a1RetryAfter.delayMs, 95_000);

    // 504 -> стандартный бэкофф
    const err504: any = new Error('HTTP 504 Gateway Timeout');
    err504.status = 504;
    const g504 = computeAsrErrorClassBackoff(1, err504, 1200, null);
    assert.equal(g504.isRateLimit, false);
    assert.equal(g504.delayMs, 1200);
  });

  it('при 429 глобальная пауза очереди блокирует отправку новых запросов и экспоненциально растёт (30 → 60 → 120 сек)', async () => {
    const recordedSleeps: number[] = [];
    const mockSleep = async (ms: number) => {
      recordedSleeps.push(ms);
    };
    resetAsrQueueForTest({ sleepFn: mockSleep });

    process.env.GIGAAM_API_URL = 'https://foundation-models.api.cloud.ru/v1/audio/transcriptions';
    process.env.GIGAAM_API_KEY = 'test-key';
    process.env.GIGAAM_MODEL_VARIANT = 'GigaChat/GigaASR';

    let callCount = 0;
    const mockFetch: typeof fetch = (async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ error: 'rate_limit_exceeded' }), {
          status: 429,
          statusText: 'Too Many Requests',
        });
      }
      if (callCount === 2) {
        return new Response(JSON.stringify({ error: 'rate_limit_exceeded' }), {
          status: 429,
          statusText: 'Too Many Requests',
          headers: { 'Retry-After': '75' },
        });
      }
      if (callCount === 3) {
        return new Response(JSON.stringify({ error: 'rate_limit_exceeded' }), {
          status: 429,
          statusText: 'Too Many Requests',
        });
      }
      return new Response(JSON.stringify({ text: 'Добрый день, салон ЛИК 28.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const wav = createTinyValidWav(0.1);
    let capturedAttempts = 0;
    const text = await transcribeWithGigaAmRetry(wav, 'audio/wav', 'GigaChat/GigaASR', {
      callId: 'call-429-test',
      isPreparedWav: true,
      emitIncidentSummary: false,
      fetchImpl: mockFetch,
      sleepFn: mockSleep,
      onAttemptCount: (n) => {
        capturedAttempts = n;
      },
    });

    assert.match(text, /Добрый день/);
    assert.equal(callCount, 4);
    assert.equal(capturedAttempts, 4);
    // Проверяем, что экспоненциальные паузы 30s -> 75s (Retry-After >= 60s) -> 120s реально применялись
    assert.ok(recordedSleeps.some((ms) => ms === 30_000), `Ожидалась пауза 30000 мс, получено: ${recordedSleeps}`);
    assert.ok(recordedSleeps.some((ms) => ms === 75_000), `Ожидалась пауза 75000 мс по Retry-After, получено: ${recordedSleeps}`);
    assert.ok(recordedSleeps.some((ms) => ms === 120_000), `Ожидалась пауза 120000 мс, получено: ${recordedSleeps}`);
  });

  it('pauseAsrQueue задерживает следующий запрос в глобальной очереди', async () => {
    const queueWaits: number[] = [];
    resetAsrQueueForTest({
      sleepFn: async (ms) => {
        queueWaits.push(ms);
      },
    });

    pauseAsrQueue(30_000, 'test 429');
    const result = await runWithAsrSemaphore(async () => 'ok');
    assert.equal(result, 'ok');
    assert.equal(queueWaits.length, 1);
    assert.ok(queueWaits[0] > 25_000 && queueWaits[0] <= 30_000);
  });

  it('formatGigaAsrIncidentSummary форматирует однострочную сводку для всех исходов', () => {
    assert.equal(
      formatGigaAsrIncidentSummary('megafon-123', 'completed', { attempts: 3 }),
      '[GigaASR] Звонок megafon-123: расшифровка завершена после 3 попыток'
    );
    assert.equal(
      formatGigaAsrIncidentSummary('megafon-123', 'deferred', { reason: 'HTTP 429 rate_limit_exceeded' }),
      '[GigaASR] Звонок megafon-123: отложена на повтор (HTTP 429 rate_limit_exceeded)'
    );
    assert.equal(
      formatGigaAsrIncidentSummary('megafon-123', 'failed', { reason: 'HTTP 401 Unauthorized' }),
      '[GigaASR] Звонок megafon-123: не удалась (HTTP 401 Unauthorized)'
    );
  });

  it('ASR_MODEL из env задаёт произвольный идентификатор модели без хардкода и имеет приоритет над GIGAAM_MODEL_VARIANT', () => {
    process.env.GIGAAM_API_URL = 'https://foundation-models.api.cloud.ru/v1/audio/transcriptions';
    process.env.GIGAAM_API_KEY = 'test-key';
    process.env.GIGAAM_MODEL_VARIANT = 'e2e_rnnt';
    process.env.ASR_MODEL = 'sber/GigaAM-v3-rnnt-custom';
    process.env.ASR_MODEL_FALLBACK = 'openai/whisper-large-v3, sber/GigaASR-alt';

    const cfg = getGigaAmConfig();
    assert.equal(cfg.variant, 'sber/GigaAM-v3-rnnt-custom');
    assert.equal(getConfiguredAsrModel(), 'sber/GigaAM-v3-rnnt-custom');
    assert.deepEqual(cfg.fallbackModels, ['openai/whisper-large-v3', 'sber/GigaASR-alt']);
    assert.deepEqual(
      getConfiguredAsrFallbackModels('sber/GigaAM-v3-rnnt-custom'),
      ['openai/whisper-large-v3', 'sber/GigaASR-alt']
    );
  });

  it('HTTP 404 классифицируется как service_unavailable без авто-фолбэка на вторую модель, логирует x-request-id, тело, диагностику и делает одиночный GET /v1/models', async () => {
    process.env.GIGAAM_API_URL = 'https://foundation-models.api.cloud.ru/v1/audio/transcriptions';
    process.env.GIGAAM_API_KEY = 'test-key';
    process.env.ASR_MODEL = 'GigaChat/RenamedModel-404';
    // Даже при заданной ASR_MODEL_FALLBACK при 404 фолбэк на вторую модель не выполняется
    process.env.ASR_MODEL_FALLBACK = 'openai/whisper-large-v3';

    const full404Body = JSON.stringify({
      error: {
        message: 'unknown model: GigaChat/RenamedModel-404. Available models: [sber/GigaAM-v3, openai/whisper-large-v3]',
        type: 'invalid_request_error',
        code: 'model_not_found',
      },
    });

    const postModels: string[] = [];
    const catalogGetUrls: string[] = [];
    const loggedErrors: string[] = [];
    const loggedWarns: string[] = [];
    const origConsoleError = console.error;
    const origConsoleWarn = console.warn;
    console.error = (...args: any[]) => {
      loggedErrors.push(args.map(String).join(' '));
    };
    console.warn = (...args: any[]) => {
      loggedWarns.push(args.map(String).join(' '));
    };

    const mockFetch: typeof fetch = (async (url: any, init?: RequestInit) => {
      const urlStr = String(url);
      if ((init?.method || 'GET').toUpperCase() === 'GET' && urlStr.endsWith('/v1/models')) {
        catalogGetUrls.push(urlStr);
        return new Response(
          JSON.stringify({
            data: [
              { id: 'GigaChat/RenamedModel-404', metadata: { type: 'audio-to-text' } },
              { id: 'openai/whisper-large-v3', metadata: { type: 'audio-to-text' } },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      const form = init?.body as FormData;
      postModels.push(String(form?.get('model') || ''));
      return new Response(full404Body, {
        status: 404,
        statusText: 'Not Found',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-cloudru-998877',
          server: 'cloudru-gateway',
        },
      });
    }) as typeof fetch;

    try {
      const wav = createTinyValidWav(0.1);
      let caughtErr: any = null;
      try {
        await transcribeWithGigaAmRetry(wav, 'audio/wav', undefined, {
          callId: 'call-404-no-retry',
          isPreparedWav: true,
          emitIncidentSummary: false,
          fetchImpl: mockFetch,
          sleepFn: async () => {},
        });
      } catch (err) {
        caughtErr = err;
      }

      assert.ok(caughtErr, 'Ожидалась ошибка при HTTP 404');
      assert.equal(postModels.length, 1, `HTTP 404 не должен тратить ретраи или пробовать вторую модель, но выполнено POST: ${postModels.length}`);
      assert.equal(postModels[0], 'GigaChat/RenamedModel-404');
      assert.equal(catalogGetUrls.length, 1, 'При 404 должен выполняться ровно один GET /v1/models');
      assert.equal(caughtErr.status, 404);
      assert.equal(caughtErr.asrFailReason, 'service_unavailable');
      assert.equal(caughtErr.asrModel, 'GigaChat/RenamedModel-404');
      assert.equal(caughtErr.asrRequestId, 'req-cloudru-998877');
      assert.equal(caughtErr.asrEndpointPath, '/v1/audio/transcriptions');
      assert.equal(caughtErr.asrCatalogVerdict, 'model_present_endpoint_issue');
      assert.deepEqual(caughtErr.asrFallbackModelsTried, []);
      assert.equal(caughtErr.noRetry, true);
      assert.doesNotMatch(caughtErr.message, /после 2 попыток/);
      assert.ok(
        loggedErrors.some((line) => line === `[GigaASR] HTTP 404: ${full404Body}`),
        `Ожидался полный лог [GigaASR] HTTP 404: <тело>, получено: ${JSON.stringify(loggedErrors)}`
      );
      assert.ok(
        loggedWarns.some((line) => line.includes('[GigaASR] HTTP 404') && line.includes('x-request-id=req-cloudru-998877')),
        `Ожидался лог x-request-id для ответа 404, получено: ${JSON.stringify(loggedWarns)}`
      );
      const diagLine = loggedErrors.find((line) => line.includes('[GigaASR] HTTP 404 диагностика:'));
      assert.ok(diagLine, 'Ожидалась развёрнутая диагностическая строка 404');
      assert.match(diagLine, /method=POST/);
      assert.match(diagLine, /url=https:\/\/foundation-models\.api\.cloud\.ru\/v1\/audio\/transcriptions/);
      assert.match(diagLine, /file=file=call\.wav/);
      assert.match(diagLine, /size=\d+B/);
      assert.match(diagLine, /contentType=multipart\/form-data/);
      assert.match(diagLine, /x-request-id=req-cloudru-998877/);
      assert.match(diagLine, /server=cloudru-gateway/);
      assert.ok(
        loggedWarns.some((line) => line.includes('ЕСТЬ в каталоге → проблема в эндпоинте')),
        `Ожидался сниппет диагностики каталога, получено: ${JSON.stringify(loggedWarns)}`
      );
    } finally {
      console.error = origConsoleError;
      console.warn = origConsoleWarn;
    }
  });

  it('логирует x-request-id каждого успешного ответа ASR (HTTP 200)', async () => {
    process.env.GIGAAM_API_URL = 'https://foundation-models.api.cloud.ru/v1/audio/transcriptions';
    process.env.GIGAAM_API_KEY = 'test-key';
    process.env.ASR_MODEL = 'GigaChat/GigaASR';

    const loggedInfos: string[] = [];
    const origConsoleLog = console.log;
    console.log = (...args: any[]) => {
      loggedInfos.push(args.map(String).join(' '));
    };

    const mockFetch: typeof fetch = (async () => {
      return new Response(JSON.stringify({ text: 'Добрый день, салон ЛИК 28.' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': 'req-ok-200-xyz',
        },
      });
    }) as typeof fetch;

    try {
      const wav = createTinyValidWav(0.1);
      const text = await transcribeWithGigaAmRetry(wav, 'audio/wav', undefined, {
        callId: 'call-200-reqid',
        isPreparedWav: true,
        emitIncidentSummary: false,
        fetchImpl: mockFetch,
        sleepFn: async () => {},
      });

      assert.match(text, /Добрый день/);
      assert.ok(
        loggedInfos.some((line) => line.includes('[GigaASR] HTTP 200') && line.includes('x-request-id=req-ok-200-xyz')),
        `Ожидался лог x-request-id для ответа 200, получено: ${JSON.stringify(loggedInfos)}`
      );
    } finally {
      console.log = origConsoleLog;
    }
  });

  it('при HTTP 404 без второй модели диагностирует исчезновение модели в GET /v1/models (модель исчезла → проблема в каталоге)', async () => {
    process.env.GIGAAM_API_URL = 'https://foundation-models.api.cloud.ru/v1/audio/transcriptions';
    process.env.GIGAAM_API_KEY = 'test-key';
    process.env.ASR_MODEL = 'GigaChat/MissingPrimary';
    process.env.ASR_MODEL_FALLBACK = 'GigaChat/MissingFallback';

    const requestedModels: string[] = [];
    let catalogCalls = 0;
    const mockFetch: typeof fetch = (async (url: any, init?: RequestInit) => {
      const urlStr = String(url);
      if ((init?.method || 'GET').toUpperCase() === 'GET' && urlStr.endsWith('/v1/models')) {
        catalogCalls++;
        return new Response(
          JSON.stringify({
            data: [{ id: 'openai/whisper-large-v3', metadata: { type: 'audio-to-text' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      const form = init?.body as FormData;
      const model = String(form?.get('model') || '');
      requestedModels.push(model);
      return new Response(`{"error":"unknown model: ${model}"}`, {
        status: 404,
        statusText: 'Not Found',
        headers: { 'x-request-id': `rid-${model}` },
      });
    }) as typeof fetch;

    const wav = createTinyValidWav(0.1);
    let caughtErr: any = null;
    try {
      await transcribeWithGigaAmRetry(wav, 'audio/wav', undefined, {
        callId: 'call-404-catalog-missing',
        isPreparedWav: true,
        emitIncidentSummary: false,
        fetchImpl: mockFetch,
        sleepFn: async () => {},
      });
    } catch (err) {
      caughtErr = err;
    }

    assert.ok(caughtErr);
    assert.deepEqual(requestedModels, ['GigaChat/MissingPrimary']);
    assert.equal(catalogCalls, 1);
    assert.equal(caughtErr.status, 404);
    assert.equal(caughtErr.asrFailReason, 'service_unavailable');
    assert.equal(caughtErr.asrModel, 'GigaChat/MissingPrimary');
    assert.equal(caughtErr.asrRequestId, 'rid-GigaChat/MissingPrimary');
    assert.equal(caughtErr.asrCatalogVerdict, 'model_missing_catalog_issue');
    assert.match(caughtErr.asrCatalogSummary, /ИСЧЕЗЛА из каталога → проблема в каталоге/);
    assert.deepEqual(caughtErr.asrFallbackModelsTried, []);
  });

  it('плавающий интервал 30 мин → 1 ч → 3 ч (сброс до 15 мин после первого успеха), нефинальный статус и алерт в VK после 2 подряд 404', async () => {
    assert.deepEqual([...ASR_404_SERVICE_UNAVAILABLE_BACKOFF_MINUTES], [30, 60, 180]);
    assert.deepEqual([...ASR_404_BACKOFF_MINUTES], [30, 60, 180]);
    assert.equal(ASR_404_POST_RECOVERY_RESET_MINUTES, 15);
    assert.equal(ASR_404_ALERT_CONSECUTIVE_THRESHOLD, 2);
    assert.equal(ASR_SERVICE_UNAVAILABLE_STATUS_LABEL, 'Ожидает расшифровки (сервис ASR недоступен)');
    assert.equal(
      ASR_CLIENT_FRIENDLY_WAITING_TEXT,
      'Звонок будет обработан после восстановления сервиса расшифровки'
    );

    // Стандартный плавающий интервал: 30 мин → 1 ч (60 мин) → 3 ч (180 мин)
    assert.equal(computeAsr404RetryDelayMs(1), 30 * 60 * 1000);
    assert.equal(computeAsr404RetryDelayMs(2), 60 * 60 * 1000);
    assert.equal(computeAsr404RetryDelayMs(3), 180 * 60 * 1000);
    assert.equal(computeAsr404RetryDelayMs(5), 180 * 60 * 1000);

    // После первого успешного ответа сброс до 15 мин → 30 мин → 1 ч → 3 ч
    assert.equal(computeAsr404RetryDelayMs(1, { afterRecoveryReset: true }), 15 * 60 * 1000);
    assert.equal(computeAsr404RetryDelayMs(2, { afterRecoveryReset: true }), 30 * 60 * 1000);
    assert.equal(computeAsr404RetryDelayMs(3, { afterRecoveryReset: true }), 60 * 60 * 1000);
    assert.equal(computeAsr404RetryDelayMs(4, { afterRecoveryReset: true }), 180 * 60 * 1000);

    const now = Date.now();
    // service_unavailable НЕ отбрасывается по maxAttempts и ждёт своего окна pending_asr_retry_after
    const waitingNotDue = shouldAutoRetryPendingAsrCall(
      {
        status: 'needs_transcription',
        transcription_status: ASR_SERVICE_UNAVAILABLE_STATUS_LABEL,
        asr_fail_reason: 'service_unavailable',
        pending_asr_retry_after: new Date(now + 60_000).toISOString(),
        pending_asr_attempts: 99,
      },
      now,
      5
    );
    assert.equal(waitingNotDue.shouldRetry, false);
    assert.equal(waitingNotDue.skipReason, 'not_due_yet');
    assert.equal(waitingNotDue.retryClass, 'service_unavailable_404');

    // Когда окно наступило — запускается даже при attempts >= maxAttempts
    const waitingDue = shouldAutoRetryPendingAsrCall(
      {
        status: 'needs_transcription',
        transcription_status: ASR_SERVICE_UNAVAILABLE_STATUS_LABEL,
        asr_fail_reason: 'service_unavailable',
        pending_asr_retry_after: new Date(now - 1000).toISOString(),
        pending_asr_attempts: 1,
      },
      now,
      5
    );
    assert.equal(waitingDue.shouldRetry, true);
    assert.equal(waitingDue.retryClass, 'service_unavailable_404');
    assert.equal(waitingDue.nextRetryDelayMs, 60 * 60 * 1000);

    // После восстановления (forceImmediateServiceUnavailable) очередь стартует немедленно, не дожидаясь retry_after
    const forcedAfterHealthOk = shouldAutoRetryPendingAsrCall(
      {
        status: 'needs_transcription',
        transcription_status: ASR_SERVICE_UNAVAILABLE_STATUS_LABEL,
        asr_fail_reason: 'service_unavailable',
        pending_asr_retry_after: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
        pending_asr_attempts: 12,
      },
      now,
      5,
      { afterRecoveryReset: true, forceImmediateServiceUnavailable: true }
    );
    assert.equal(forcedAfterHealthOk.shouldRetry, true);
    assert.equal(forcedAfterHealthOk.retryClass, 'service_unavailable_404');

    // Устаревшая запись model_not_found без retry_after -> не запускается
    const unscheduledLegacy404 = shouldAutoRetryPendingAsrCall(
      {
        status: 'needs_transcription',
        transcription_status: 'Требует расшифровки',
        asr_fail_reason: 'model_not_found',
        pending_asr_retry_after: undefined,
        pending_asr_attempts: 1,
      },
      now,
      5
    );
    assert.equal(unscheduledLegacy404.shouldRetry, false);
    assert.equal(unscheduledLegacy404.skipReason, 'model_not_found');
    assert.equal(unscheduledLegacy404.retryClass, 'http_404_backoff');

    const transientDue = shouldAutoRetryPendingAsrCall(
      {
        status: 'needs_transcription',
        transcription_status: 'Требует расшифровки',
        asr_fail_reason: 'rate_limit',
        pending_asr_retry_after: new Date(now - 1000).toISOString(),
        pending_asr_attempts: 1,
      },
      now,
      5
    );
    assert.equal(transientDue.shouldRetry, true);
    assert.equal(transientDue.retryClass, 'standard_transient');

    assert.equal(classifyAsrFailReason({ status: 404, message: 'Not Found' }), 'service_unavailable');
    assert.equal(classifyAsrFailReason({ status: 429, message: 'Too Many Requests' }), 'rate_limit');
    assert.equal(classifyAsrFailReason({ status: 504, message: 'Gateway Timeout' }), 'server_error');

    // Новый VK-алерт при 2 подряд 404
    const serviceAlert = formatAsrServiceUnavailableVkAlert({
      endpointPath: '/v1/audio/transcriptions',
      requestId: 'req-404-last-2',
      modelName: 'GigaChat/GigaASR',
      consecutiveFailures: 2,
      salonName: 'LIQ28',
    });
    assert.ok(
      serviceAlert.includes(
        'ASR недоступен: /v1/audio/transcriptions возвращает 404 для всех моделей. Тикет в поддержку Cloud.ru отправлен. Звонки накапливаются, будут расшифрованы автоматически после восстановления.'
      ),
      `Неожиданный текст VK-алерта: ${serviceAlert}`
    );
    assert.match(serviceAlert, /Последний x-request-id: req-404-last-2/);

    // Сохраняем обратную совместимость старых форматтеров
    const modelAlert = formatAsrModelNotFoundVkAlert('GigaChat/GigaASR', {
      callId: 'megafon-777',
      fallbackModels: ['openai/whisper-large-v3'],
    });
    assert.ok(modelAlert.startsWith('ASR недоступен: модель GigaChat/GigaASR не найдена'));

    const thresholdAlert = formatAsr404ConsecutiveVkAlert({
      endpointPath: '/v1/audio/transcriptions',
      requestId: 'req-abc-12345',
      modelName: 'GigaChat/GigaASR',
      fallbackModels: ['openai/whisper-large-v3'],
      consecutiveFailures: 2,
      catalogVerdict: 'model_present_endpoint_issue',
      callId: 'megafon-777',
    });
    assert.ok(
      thresholdAlert.startsWith('ASR недоступен: /v1/audio/transcriptions возвращает 404, x-request-id: req-abc-12345'),
      `Неожиданный заголовок VK-алерта: ${thresholdAlert}`
    );
    assert.match(thresholdAlert, /модель есть в каталоге → проблема в эндпоинте/);

    // Отдельная проверка probeCloudRuCatalogOn404 при сетевом сбое
    const probeFail = await probeCloudRuCatalogOn404(
      'https://foundation-models.api.cloud.ru/v1/audio/transcriptions',
      'key',
      'GigaChat/GigaASR',
      [],
      (async () => new Response('gateway error', { status: 502 })) as typeof fetch
    );
    assert.equal(probeFail.verdict, 'catalog_probe_failed');
    assert.equal(probeFail.status, 502);
  });

  it('ежечасная фоновая проверка ASR отправляет 1-секундный silence WAV и логирует «ASR check: OK» / «ASR check: 404 (x-request-id: …)»', async () => {
    const wav1s = createSilentWavBuffer(1.0);
    // 16000 samples/sec * 1 sec * 2 bytes/sample = 32000 bytes + 44 bytes RIFF/WAVE header
    assert.equal(wav1s.length, 32044);
    assert.equal(wav1s.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(wav1s.subarray(8, 12).toString('ascii'), 'WAVE');

    process.env.GIGAAM_API_URL = 'https://foundation-models.api.cloud.ru/v1/audio/transcriptions';
    process.env.GIGAAM_API_KEY = 'test-key';
    process.env.ASR_MODEL = 'GigaChat/GigaASR';

    const logs: string[] = [];
    const warns: string[] = [];
    const errors: string[] = [];
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    console.log = (...a: any[]) => logs.push(a.map(String).join(' '));
    console.warn = (...a: any[]) => warns.push(a.map(String).join(' '));
    console.error = (...a: any[]) => errors.push(a.map(String).join(' '));

    try {
      // 1. Случай 404
      let sentBytes = 0;
      const res404 = await runAsrHealthCheckProbe({
        fetchImpl: (async (_url: any, init?: RequestInit) => {
          const form = init?.body as FormData;
          const file = form?.get('file') as Blob | null;
          sentBytes = file ? file.size : 0;
          return new Response('{"error":"Not Found"}', {
            status: 404,
            statusText: 'Not Found',
            headers: { 'x-request-id': 'req-health-404-abc' },
          });
        }) as typeof fetch,
      });

      assert.equal(sentBytes, 32044);
      assert.equal(res404.ok, false);
      assert.equal(res404.status, 404);
      assert.equal(res404.requestId, 'req-health-404-abc');
      assert.equal(res404.logLine, 'ASR check: 404 (x-request-id: req-health-404-abc)');
      assert.ok(warns.includes('ASR check: 404 (x-request-id: req-health-404-abc)'));
      assert.ok(warns.some((l) => l.includes('x-request-id=req-health-404-abc')));

      // 2. Случай 200 OK
      const resOk = await runAsrHealthCheckProbe({
        fetchImpl: (async () => {
          return new Response(JSON.stringify({ text: '' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'x-request-id': 'req-health-ok-999' },
          });
        }) as typeof fetch,
      });

      assert.equal(resOk.ok, true);
      assert.equal(resOk.status, 200);
      assert.equal(resOk.requestId, 'req-health-ok-999');
      assert.equal(resOk.logLine, 'ASR check: OK');
      assert.ok(logs.includes('ASR check: OK'));
      assert.ok(logs.some((l) => l.includes('x-request-id=req-health-ok-999')));
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    }
  });
});

