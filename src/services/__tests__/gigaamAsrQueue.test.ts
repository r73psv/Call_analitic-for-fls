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

  beforeEach(() => {
    delete process.env.ASR_MAX_CONCURRENT;
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
});
