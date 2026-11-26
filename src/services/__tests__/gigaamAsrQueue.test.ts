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
  shouldAutoRetryPendingAsrCall,
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

  it('HTTP 404 логирует тело ответа целиком [GigaASR] HTTP 404: <тело>, не тратит ретраи и выставляет asrFailReason=model_not_found', async () => {
    process.env.GIGAAM_API_URL = 'https://foundation-models.api.cloud.ru/v1/audio/transcriptions';
    process.env.GIGAAM_API_KEY = 'test-key';
    process.env.ASR_MODEL = 'GigaChat/RenamedModel-404';
    delete process.env.ASR_MODEL_FALLBACK;

    const full404Body = JSON.stringify({
      error: {
        message: 'unknown model: GigaChat/RenamedModel-404. Available models: [sber/GigaAM-v3, openai/whisper-large-v3]',
        type: 'invalid_request_error',
        code: 'model_not_found',
      },
    });

    const requestedModels: string[] = [];
    const loggedErrors: string[] = [];
    const origConsoleError = console.error;
    console.error = (...args: any[]) => {
      loggedErrors.push(args.map(String).join(' '));
    };

    const mockFetch: typeof fetch = (async (_url: any, init?: RequestInit) => {
      const form = init?.body as FormData;
      requestedModels.push(String(form?.get('model') || ''));
      return new Response(full404Body, { status: 404, statusText: 'Not Found' });
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
      assert.equal(requestedModels.length, 1, `HTTP 404 не должен тратить ретраи, но выполнено запросов: ${requestedModels.length}`);
      assert.equal(requestedModels[0], 'GigaChat/RenamedModel-404');
      assert.equal(caughtErr.status, 404);
      assert.equal(caughtErr.asrFailReason, 'model_not_found');
      assert.equal(caughtErr.asrModel, 'GigaChat/RenamedModel-404');
      assert.equal(caughtErr.noRetry, true);
      assert.doesNotMatch(caughtErr.message, /после 2 попыток/);
      assert.ok(
        loggedErrors.some((line) => line === `[GigaASR] HTTP 404: ${full404Body}`),
        `Ожидался полный лог [GigaASR] HTTP 404: <тело>, получено: ${JSON.stringify(loggedErrors)}`
      );
    } finally {
      console.error = origConsoleError;
    }
  });

  it('при HTTP 404 от основной модели пробует ASR_MODEL_FALLBACK и сохраняет расшифровку звонка', async () => {
    process.env.GIGAAM_API_URL = 'https://foundation-models.api.cloud.ru/v1/audio/transcriptions';
    process.env.GIGAAM_API_KEY = 'test-key';
    process.env.ASR_MODEL = 'GigaChat/OldModelName';
    process.env.ASR_MODEL_FALLBACK = 'openai/whisper-large-v3';

    const requestedModels: string[] = [];
    const mockFetch: typeof fetch = (async (_url: any, init?: RequestInit) => {
      const form = init?.body as FormData;
      const model = String(form?.get('model') || '');
      requestedModels.push(model);
      if (model === 'GigaChat/OldModelName') {
        return new Response('{"error":"model not found: GigaChat/OldModelName"}', {
          status: 404,
          statusText: 'Not Found',
        });
      }
      if (model === 'openai/whisper-large-v3') {
        return new Response(JSON.stringify({ text: 'Здравствуйте, хочу записаться на маникюр.' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('unexpected model', { status: 500 });
    }) as typeof fetch;

    const wav = createTinyValidWav(0.1);
    const text = await transcribeWithGigaAmRetry(wav, 'audio/wav', undefined, {
      callId: 'call-404-fallback-ok',
      isPreparedWav: true,
      emitIncidentSummary: false,
      fetchImpl: mockFetch,
      sleepFn: async () => {},
    });

    assert.deepEqual(requestedModels, ['GigaChat/OldModelName', 'openai/whisper-large-v3']);
    assert.match(text, /маникюр/);
  });

  it('если и основная, и ASR_MODEL_FALLBACK вернули 404 — по 1 запросу на каждую, без ретраев, model_not_found', async () => {
    process.env.GIGAAM_API_URL = 'https://foundation-models.api.cloud.ru/v1/audio/transcriptions';
    process.env.GIGAAM_API_KEY = 'test-key';
    process.env.ASR_MODEL = 'GigaChat/MissingPrimary';
    process.env.ASR_MODEL_FALLBACK = 'GigaChat/MissingFallback';

    const requestedModels: string[] = [];
    const mockFetch: typeof fetch = (async (_url: any, init?: RequestInit) => {
      const form = init?.body as FormData;
      const model = String(form?.get('model') || '');
      requestedModels.push(model);
      return new Response(`{"error":"unknown model: ${model}"}`, { status: 404, statusText: 'Not Found' });
    }) as typeof fetch;

    const wav = createTinyValidWav(0.1);
    let caughtErr: any = null;
    try {
      await transcribeWithGigaAmRetry(wav, 'audio/wav', undefined, {
        callId: 'call-404-both-missing',
        isPreparedWav: true,
        emitIncidentSummary: false,
        fetchImpl: mockFetch,
        sleepFn: async () => {},
      });
    } catch (err) {
      caughtErr = err;
    }

    assert.ok(caughtErr);
    assert.deepEqual(requestedModels, ['GigaChat/MissingPrimary', 'GigaChat/MissingFallback']);
    assert.equal(caughtErr.status, 404);
    assert.equal(caughtErr.asrFailReason, 'model_not_found');
    assert.equal(caughtErr.asrModel, 'GigaChat/MissingPrimary');
    assert.deepEqual(caughtErr.asrFallbackModelsTried, ['GigaChat/MissingFallback']);
  });

  it('планировщик пропускает авто-повтор при asr_fail_reason=model_not_found, но повторяет временные сбои; VK-сигнал содержит точную фразу', () => {
    const now = Date.now();
    const blocked = shouldAutoRetryPendingAsrCall(
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
    assert.equal(blocked.shouldRetry, false);
    assert.equal(blocked.skipReason, 'model_not_found');

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

    assert.equal(classifyAsrFailReason({ status: 404, message: 'Not Found' }), 'model_not_found');
    assert.equal(classifyAsrFailReason({ status: 429, message: 'Too Many Requests' }), 'rate_limit');
    assert.equal(classifyAsrFailReason({ status: 504, message: 'Gateway Timeout' }), 'server_error');

    const alertText = formatAsrModelNotFoundVkAlert('GigaChat/GigaASR', {
      callId: 'megafon-777',
      fallbackModels: ['openai/whisper-large-v3'],
    });
    assert.ok(alertText.startsWith('ASR недоступен: модель GigaChat/GigaASR не найдена'));
    assert.match(alertText, /openai\/whisper-large-v3/);
  });
});
