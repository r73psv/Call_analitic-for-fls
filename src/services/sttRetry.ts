/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const RETRYABLE_HTTP_STATUSES = new Set<number>([
  408, // Request Timeout
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
  520, // Unknown / Upstream Error
  521, // Web Server Is Down
  522, // Connection Timed Out
  523, // Origin Is Unreachable
  524, // A Timeout Occurred
]);

export const NON_RETRYABLE_HTTP_STATUSES = new Set<number>([
  400, // Bad Request
  401, // Unauthorized
  403, // Forbidden
  404, // Not Found
  405, // Method Not Allowed
  407, // Proxy Authentication Required
  413, // Payload Too Large
  415, // Unsupported Media Type
  422, // Unprocessable Entity
]);

export const TRANSIENT_NETWORK_ERROR_CODES = new Set<string>([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ECONNABORTED',
  'ERR_NETWORK',
  'ERR_SOCKET_CLOSED',
  'ERR_HTTP2_GOAWAY_SESSION',
  'ERR_HTTP2_SESSION_ERROR',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_CLOSED',
  'UND_ERR_DESTROYED',
  'UND_ERR_ABORTED',
  'ABORT_ERR',
]);

const NON_RETRYABLE_CONFIG_MESSAGE_RE =
  /не настроен|не указан|укажите api[- ]?ключ|укажите api key|ошибка авторизации|некорректный url|unauthorized|forbidden|invalid api key|permission denied|unauthenticated/i;

const TRANSIENT_MESSAGE_RE =
  /fetch failed|network error|socket hang up|econnreset|etimedout|econnrefused|enotfound|eai_again|epipe|ehostunreach|enetunreach|econnaborted|connection reset|connection closed|client network socket disconnected|tls connection|other side closed|terminated|timeout|timed out|too many requests|rate limit|service unavailable|bad gateway|gateway timeout|temporarily unavailable|upstream|aborted/i;

const MAX_RETRY_AFTER_MS = 60_000;

export interface SttRetryInfo {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: unknown;
  detail: string;
}

export interface SttRetryOptions {
  providerName: string;
  operationName?: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (info: SttRetryInfo) => void;
  sleepFn?: (ms: number) => Promise<void>;
  randomFn?: () => number;
  silent?: boolean;
}

export interface FetchWithSttRetryOptions extends SttRetryOptions {
  /** HTTP statuses to treat as transient and retry automatically. Defaults to RETRYABLE_HTTP_STATUSES. */
  retryOnStatuses?: Iterable<number>;
}

interface InternalRetryableHttpError extends Error {
  status: number;
  retryAfterMs?: number | null;
  responseHeaders?: Headers;
  isRetryableHttpStatus: true;
}

export function isRetryableHttpStatus(status: number): boolean {
  return RETRYABLE_HTTP_STATUSES.has(status);
}

export function extractHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const err = error as Record<string, any>;
  const candidates = [
    err.status,
    err.statusCode,
    err.response?.status,
    err.cause?.status,
    err.cause?.statusCode,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c >= 100 && c <= 599) {
      return c;
    }
  }
  return null;
}

export function extractErrorCodes(error: unknown): string[] {
  const codes: string[] = [];
  let current: any = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    for (const key of ['code', 'errno', 'name']) {
      const val = current[key];
      if (typeof val === 'string' && val.trim()) {
        codes.push(val.trim());
      }
    }
    current = current.cause;
  }
  return codes;
}

function collectErrorMessages(error: unknown): string {
  const parts: string[] = [];
  if (typeof error === 'string') return error;
  let current: any = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    if (typeof current.message === 'string' && current.message.trim()) {
      parts.push(current.message.trim());
    }
    current = current.cause;
  }
  return parts.join(' | ');
}

export function isNonRetryableSttConfigError(error: unknown): boolean {
  const status = extractHttpStatus(error);
  if (status !== null && NON_RETRYABLE_HTTP_STATUSES.has(status)) {
    return true;
  }
  const combinedMessage = collectErrorMessages(error);
  if (combinedMessage && NON_RETRYABLE_CONFIG_MESSAGE_RE.test(combinedMessage)) {
    return true;
  }
  return false;
}

/**
 * Determines whether an STT API error is transient (network glitch, undici `fetch failed`,
 * TLS/socket drop, timeout, HTTP 408/429/5xx) and safe to retry with exponential backoff.
 */
export function isTransientSttError(error: unknown): boolean {
  if (!error) return false;

  if (isNonRetryableSttConfigError(error)) {
    return false;
  }

  const status = extractHttpStatus(error);
  if (status !== null) {
    return isRetryableHttpStatus(status);
  }

  const codes = extractErrorCodes(error);
  for (const code of codes) {
    const upper = code.toUpperCase();
    if (
      TRANSIENT_NETWORK_ERROR_CODES.has(upper) ||
      upper.startsWith('UND_ERR_') ||
      code === 'AbortError' ||
      code === 'TimeoutError'
    ) {
      return true;
    }
  }

  const combinedMessage = collectErrorMessages(error);
  if (combinedMessage && TRANSIENT_MESSAGE_RE.test(combinedMessage)) {
    return true;
  }

  return false;
}

function readHeaderValue(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const h = headers as Record<string, any>;
  if (typeof h.get === 'function') {
    const val = h.get(name);
    return typeof val === 'string' ? val : null;
  }
  const lowerTarget = name.toLowerCase();
  for (const [k, v] of Object.entries(h)) {
    if (k.toLowerCase() === lowerTarget) {
      if (typeof v === 'string') return v;
      if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
    }
  }
  return null;
}

/**
 * Parses `Retry-After` header (seconds or HTTP-date) from a Response, Headers,
 * Axios error, or custom error object. Returns delay in milliseconds or null.
 */
export function extractRetryAfterMs(source: unknown): number | null {
  if (!source || typeof source !== 'object') return null;
  const obj = source as Record<string, any>;

  if (typeof obj.retryAfterMs === 'number' && Number.isFinite(obj.retryAfterMs) && obj.retryAfterMs > 0) {
    return Math.min(Math.round(obj.retryAfterMs), MAX_RETRY_AFTER_MS);
  }

  const raw =
    readHeaderValue(obj.response?.headers, 'retry-after') ??
    readHeaderValue(obj.responseHeaders, 'retry-after') ??
    readHeaderValue(obj.headers, 'retry-after') ??
    readHeaderValue(obj, 'retry-after');

  if (!raw || !raw.trim()) return null;

  const trimmed = raw.trim();
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.min(Math.round(asNumber * 1000), MAX_RETRY_AFTER_MS);
  }

  const parsedDate = Date.parse(trimmed);
  if (Number.isFinite(parsedDate)) {
    const delta = parsedDate - Date.now();
    if (delta > 0) {
      return Math.min(Math.round(delta), MAX_RETRY_AFTER_MS);
    }
  }

  return null;
}

/**
 * Formats STT network/HTTP errors into concise diagnostic text, surfacing hidden
 * Node/undici `error.cause` codes (e.g. `fetch failed (UND_ERR_SOCKET / ECONNRESET)`).
 */
export function formatSttNetworkError(error: unknown): string {
  if (!error) return 'Неизвестная ошибка';
  if (typeof error === 'string') return error;

  const err = error as Record<string, any>;
  const status = extractHttpStatus(error);
  const baseMessage = typeof err.message === 'string' && err.message.trim() ? err.message.trim() : String(error);

  const causeParts: string[] = [];
  if (typeof err.code === 'string' && err.code && !baseMessage.includes(err.code)) {
    causeParts.push(err.code);
  }
  let cause: any = err.cause;
  for (let depth = 0; depth < 3 && cause && typeof cause === 'object'; depth++) {
    const cCode = typeof cause.code === 'string' ? cause.code.trim() : '';
    const cMsg = typeof cause.message === 'string' ? cause.message.trim() : '';
    if (cCode && !causeParts.includes(cCode) && !baseMessage.includes(cCode)) {
      causeParts.push(cCode);
    }
    if (cMsg && cMsg !== baseMessage && !causeParts.includes(cMsg)) {
      causeParts.push(cMsg.slice(0, 140));
    }
    cause = cause.cause;
  }

  let responseSnippet = '';
  const respData = err.response?.data;
  if (respData !== undefined && respData !== null) {
    try {
      const raw = typeof respData === 'string' ? respData : JSON.stringify(respData);
      if (raw && raw.trim()) {
        responseSnippet = raw.trim().slice(0, 240);
      }
    } catch {
      // ignore serialization failure
    }
  }

  const segments: string[] = [];
  if (status !== null && !baseMessage.includes(String(status))) {
    segments.push(`HTTP ${status}`);
  }
  segments.push(baseMessage);
  if (causeParts.length > 0) {
    segments.push(`(${causeParts.join(': ')})`);
  }
  if (responseSnippet && !baseMessage.includes(responseSnippet.slice(0, 40))) {
    segments.push(`— ${responseSnippet}`);
  }

  return segments.join(' ');
}

export function computeBackoffDelayMs(
  attempt: number,
  options: {
    baseDelayMs: number;
    maxDelayMs: number;
    jitterRatio?: number;
    retryAfterMs?: number | null;
    randomFn?: () => number;
  }
): number {
  const { baseDelayMs, maxDelayMs, retryAfterMs, randomFn = Math.random } = options;
  const jitterRatio = options.jitterRatio ?? 0.25;

  const exponential = Math.min(baseDelayMs * Math.pow(2, Math.max(0, attempt - 1)), maxDelayMs);

  let delay = exponential;
  if (jitterRatio > 0) {
    const r = Math.min(1, Math.max(0, randomFn()));
    const factor = 1 + (r * 2 - 1) * jitterRatio; // [1 - jitterRatio, 1 + jitterRatio]
    delay = Math.round(exponential * factor);
  }

  const minFloor = Math.min(200, baseDelayMs);
  delay = Math.max(minFloor, Math.min(delay, maxDelayMs));

  if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    delay = Math.max(delay, Math.min(retryAfterMs, MAX_RETRY_AFTER_MS));
  }

  return delay;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Executes an async STT API operation with exponential backoff, jitter, and
 * `Retry-After` support for transient network and HTTP errors.
 */
export async function withSttRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: SttRetryOptions
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  const baseDelayMs = Math.max(50, options.baseDelayMs ?? 1000);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 15_000);
  const jitterRatio = options.jitterRatio ?? 0.25;
  const shouldRetry = options.shouldRetry ?? ((err) => isTransientSttError(err));
  const sleepFn = options.sleepFn ?? defaultSleep;
  const randomFn = options.randomFn ?? Math.random;
  const opSuffix = options.operationName ? ` [${options.operationName}]` : '';

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error: unknown) {
      lastError = error;
      const detail = formatSttNetworkError(error);
      const canRetry = attempt < maxAttempts && shouldRetry(error, attempt);

      if (!canRetry) {
        if (error && typeof error === 'object') {
          try {
            (error as Record<string, any>).sttAttempts = attempt;
          } catch {
            // ignore non-extensible errors
          }
        }
        throw error;
      }

      const retryAfterMs = extractRetryAfterMs(error);
      const delayMs = computeBackoffDelayMs(attempt, {
        baseDelayMs,
        maxDelayMs,
        jitterRatio,
        retryAfterMs,
        randomFn,
      });

      if (!options.silent) {
        console.warn(
          `[${options.providerName}]${opSuffix} Попытка ${attempt}/${maxAttempts} не удалась (${detail}). Повтор через ${(delayMs / 1000).toFixed(2)}с...`
        );
      }

      options.onRetry?.({
        attempt,
        maxAttempts,
        delayMs,
        error,
        detail,
      });

      await sleepFn(delayMs);
    }
  }

  throw lastError;
}

/**
 * Wrapper around `fetch()` for STT providers that rebuilds RequestInit (including
 * fresh FormData and AbortSignal.timeout) on each attempt and retries both thrown
 * network errors (`TypeError: fetch failed`, timeouts, socket drops) AND retryable
 * HTTP statuses (408, 429, 500, 502, 503, 504).
 *
 * On the final attempt, non-2xx responses are returned unchanged so caller-level
 * fallback logic (e.g. WAV conversion or endpoint switching) still receives the
 * full HTTP response body and status.
 */
export async function fetchWithSttRetry(
  url: string,
  initFactory: (attempt: number) => RequestInit,
  options: FetchWithSttRetryOptions,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  const retryStatuses = options.retryOnStatuses
    ? new Set<number>(options.retryOnStatuses)
    : RETRYABLE_HTTP_STATUSES;

  return withSttRetry<Response>(
    async (attempt) => {
      const response = await fetchImpl(url, initFactory(attempt));

      if (!response.ok && retryStatuses.has(response.status) && attempt < maxAttempts) {
        const retryAfterMs = extractRetryAfterMs(response.headers);
        // Drain/cancel body to release underlying undici socket before retrying
        try {
          await response.body?.cancel();
        } catch {
          // ignore body cancel error
        }

        const retryErr = new Error(
          `HTTP ${response.status} ${response.statusText || ''}`.trim()
        ) as InternalRetryableHttpError;
        retryErr.status = response.status;
        retryErr.retryAfterMs = retryAfterMs;
        retryErr.responseHeaders = response.headers;
        retryErr.isRetryableHttpStatus = true;
        throw retryErr;
      }

      return response;
    },
    {
      ...options,
      maxAttempts,
      shouldRetry: (error, attempt) => {
        if ((error as InternalRetryableHttpError)?.isRetryableHttpStatus) {
          return true;
        }
        return options.shouldRetry ? options.shouldRetry(error, attempt) : isTransientSttError(error);
      },
    }
  );
}
