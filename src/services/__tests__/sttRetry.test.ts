import test from 'node:test';
import assert from 'node:assert/strict';
import {
  withSttRetry,
  fetchWithSttRetry,
  isTransientSttError,
  extractRetryAfterMs,
  computeBackoffDelayMs,
  formatSttNetworkError,
} from '../sttRetry.js';

test('withSttRetry recovers from transient "fetch failed" with exponential backoff', async () => {
  let calls = 0;
  const delays: number[] = [];

  const result = await withSttRetry(
    async () => {
      calls++;
      if (calls < 4) {
        const err: any = new TypeError('fetch failed');
        err.cause = { code: 'ECONNRESET', message: 'read ECONNRESET' };
        throw err;
      }
      return 'Менеджер: Добрый день!';
    },
    {
      providerName: 'GigaAM / GigaASR',
      operationName: 'audio/transcriptions',
      maxAttempts: 4,
      baseDelayMs: 1000,
      maxDelayMs: 12000,
      jitterRatio: 0,
      silent: true,
      sleepFn: async (ms) => {
        delays.push(ms);
      },
    }
  );

  assert.equal(result, 'Менеджер: Добрый день!');
  assert.equal(calls, 4);
  assert.deepEqual(delays, [1000, 2000, 4000]);
});

test('withSttRetry fast-fails on non-retryable 401/403/400/404 and config errors without sleeping', async () => {
  const nonRetryableCases: Array<{ label: string; error: any }> = [
    { label: 'HTTP 401', error: Object.assign(new Error('Unauthorized'), { status: 401 }) },
    { label: 'HTTP 403 Axios', error: Object.assign(new Error('Forbidden'), { response: { status: 403 } }) },
    { label: 'HTTP 400', error: Object.assign(new Error('Bad Request'), { status: 400 }) },
    { label: 'HTTP 404', error: Object.assign(new Error('Not Found'), { status: 404 }) },
    {
      label: 'Missing config',
      error: new Error('Yandex Cloud SpeechKit не настроен: укажите API-ключ'),
    },
  ];

  for (const tc of nonRetryableCases) {
    let calls = 0;
    const delays: number[] = [];
    await assert.rejects(
      () =>
        withSttRetry(
          async () => {
            calls++;
            throw tc.error;
          },
          {
            providerName: 'TestSTT',
            maxAttempts: 4,
            baseDelayMs: 500,
            silent: true,
            sleepFn: async (ms) => {
              delays.push(ms);
            },
          }
        )
    );
    assert.equal(calls, 1, `${tc.label} should not be retried`);
    assert.equal(delays.length, 0, `${tc.label} should not sleep`);
  }
});

test('withSttRetry respects Retry-After header on HTTP 429 and retries 503/ETIMEDOUT', async () => {
  let calls = 0;
  const delays: number[] = [];

  const result = await withSttRetry(
    async () => {
      calls++;
      if (calls === 1) {
        const err: any = new Error('Too Many Requests');
        err.response = { status: 429, headers: { 'retry-after': '5' } };
        throw err;
      }
      if (calls === 2) {
        const err: any = new Error('connect ETIMEDOUT');
        err.code = 'ETIMEDOUT';
        throw err;
      }
      if (calls === 3) {
        const err: any = new Error('Service Unavailable');
        err.status = 503;
        throw err;
      }
      return 'ok';
    },
    {
      providerName: 'T-Bank VoiceKit',
      operationName: 'stt:recognize',
      maxAttempts: 4,
      baseDelayMs: 1000,
      maxDelayMs: 12000,
      jitterRatio: 0,
      silent: true,
      sleepFn: async (ms) => {
        delays.push(ms);
      },
    }
  );

  assert.equal(result, 'ok');
  assert.equal(calls, 4);
  assert.deepEqual(delays, [5000, 2000, 4000]);
});

test('fetchWithSttRetry retries thrown fetch failed & HTTP 503, rebuilds init each attempt, and returns final non-2xx unchanged', async () => {
  const seenAttempts: number[] = [];
  const delays: number[] = [];

  const fakeFetch: typeof fetch = (async (_url, init) => {
    const attemptHeader = (init?.headers as Record<string, string>)?.['X-Attempt'];
    seenAttempts.push(Number(attemptHeader));
    if (seenAttempts.length === 1) {
      const err: any = new TypeError('fetch failed');
      err.cause = { code: 'UND_ERR_SOCKET', message: 'other side closed' };
      throw err;
    }
    if (seenAttempts.length === 2) {
      return new Response('rate limited', {
        status: 429,
        headers: { 'Retry-After': '3' },
      });
    }
    return new Response(JSON.stringify({ text: 'Привет' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const response = await fetchWithSttRetry(
    'https://foundation-models.api.cloud.ru/v1/audio/transcriptions',
    (attempt) => ({
      method: 'POST',
      headers: { 'X-Attempt': String(attempt) },
    }),
    {
      providerName: 'GigaASR (Cloud.ru)',
      operationName: 'audio/transcriptions',
      maxAttempts: 4,
      baseDelayMs: 1000,
      maxDelayMs: 12000,
      jitterRatio: 0,
      silent: true,
      sleepFn: async (ms) => {
        delays.push(ms);
      },
    },
    fakeFetch
  );

  assert.equal(response.status, 200);
  assert.deepEqual(seenAttempts, [1, 2, 3]);
  assert.deepEqual(delays, [1000, 3000]);

  // Persistent 503 returns actual Response on final attempt so downstream fallbacks still inspect status/body
  let calls503 = 0;
  const always503Fetch: typeof fetch = (async () => {
    calls503++;
    return new Response('upstream down', { status: 503, statusText: 'Service Unavailable' });
  }) as typeof fetch;

  const finalRes = await fetchWithSttRetry(
    'https://foundation-models.api.cloud.ru/v1/audio/transcriptions',
    () => ({ method: 'POST' }),
    {
      providerName: 'GigaASR (Cloud.ru)',
      maxAttempts: 3,
      baseDelayMs: 500,
      jitterRatio: 0,
      silent: true,
      sleepFn: async () => {},
    },
    always503Fetch
  );
  assert.equal(calls503, 3);
  assert.equal(finalRes.status, 503);
  assert.equal(await finalRes.text(), 'upstream down');

  // Non-retryable 400 returns immediately on attempt 1
  let calls400 = 0;
  const badReqFetch: typeof fetch = (async () => {
    calls400++;
    return new Response('bad audio', { status: 400 });
  }) as typeof fetch;

  const res400 = await fetchWithSttRetry(
    'https://foundation-models.api.cloud.ru/v1/audio/transcriptions',
    () => ({ method: 'POST' }),
    {
      providerName: 'GigaASR (Cloud.ru)',
      maxAttempts: 4,
      baseDelayMs: 500,
      silent: true,
      sleepFn: async () => {},
    },
    badReqFetch
  );
  assert.equal(calls400, 1);
  assert.equal(res400.status, 400);
});

test('isTransientSttError, computeBackoffDelayMs, extractRetryAfterMs, and formatSttNetworkError work accurately', () => {
  const undiciErr: any = new TypeError('fetch failed');
  undiciErr.cause = { code: 'UND_ERR_CONNECT_TIMEOUT', message: 'Connect Timeout Error' };
  assert.equal(isTransientSttError(undiciErr), true);

  const formatted = formatSttNetworkError(undiciErr);
  assert.match(formatted, /fetch failed/);
  assert.match(formatted, /UND_ERR_CONNECT_TIMEOUT/);

  // Exponential backoff caps at maxDelayMs and applies bounded jitter
  const lowJitter = computeBackoffDelayMs(2, {
    baseDelayMs: 1000,
    maxDelayMs: 8000,
    jitterRatio: 0.25,
    randomFn: () => 0,
  });
  const highJitter = computeBackoffDelayMs(2, {
    baseDelayMs: 1000,
    maxDelayMs: 8000,
    jitterRatio: 0.25,
    randomFn: () => 1,
  });
  const capped = computeBackoffDelayMs(10, {
    baseDelayMs: 1000,
    maxDelayMs: 8000,
    jitterRatio: 0,
  });
  assert.equal(lowJitter, 1500);
  assert.equal(highJitter, 2500);
  assert.equal(capped, 8000);

  // Retry-After extraction from Headers
  const headers = new Headers({ 'Retry-After': '4' });
  assert.equal(extractRetryAfterMs(headers), 4000);
});
