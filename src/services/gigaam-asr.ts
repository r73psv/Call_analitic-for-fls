/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import axios from 'axios';
import { AsrCatalogVerdict, AsrFailReason, CallRecord, GigaamModelVariant } from '../types.js';
import { readStoreSync } from '../store/store.js';
import {
  detectAudioFormat,
  getAudioDuration,
  convertToWav16kMono,
  splitAudioIntoWavChunks,
  splitAudioIntoOpusChunks,
  refineTranscriptRoles,
  fixDuplicatedTranscript,
  probeAudioChannels,
  splitStereoToMonoWavChannels,
  mergeDualChannelTranscripts,
  TimedUtterance,
} from './speechkit.js';
import {
  withSttRetry,
  fetchWithSttRetry,
  isTransientSttError,
  formatSttNetworkError,
  extractHttpStatus,
} from './sttRetry.js';

export const CLOUDRU_GIGAASR_TRANSCRIPTIONS_URL =
  'https://foundation-models.api.cloud.ru/v1/audio/transcriptions';

export const DEFAULT_CLOUDRU_ASR_MODEL = 'GigaChat/GigaASR';

const SELF_HOSTED_GIGAAM_VARIANTS = new Set<string>(['e2e_rnnt', 'e2e_ctc', 'rnnt', 'ctc']);

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

/**
 * Экспоненциальный бэкофф для HTTP 429 (rate_limit_exceeded): 30 → 60 → 120 сек.
 */
export const ASR_RATE_LIMIT_BACKOFF_MS = [30_000, 60_000, 120_000] as const;

/**
 * Плавающий интервал авто-повтора для HTTP 404 (временная недоступность сервиса ASR):
 * 30 мин → 1 ч → 3 ч (после первого успешного ответа сбрасывается до 15 мин).
 */
export const ASR_404_SERVICE_UNAVAILABLE_BACKOFF_MINUTES = [30, 60, 180] as const;

/**
 * Начальный интервал авто-повтора после первого успешного восстановления сервиса ASR (15 мин).
 */
export const ASR_404_POST_RECOVERY_RESET_MINUTES = 15;

/**
 * Плавающий интервал авто-повтора для HTTP 404 (алиас для обратной совместимости): 30 → 60 → 180 мин.
 */
export const ASR_404_BACKOFF_MINUTES = ASR_404_SERVICE_UNAVAILABLE_BACKOFF_MINUTES;

/**
 * Порог подряд идущих неудач HTTP 404 для отправки алерта администратору в VK-чат (первые 2 подряд).
 */
export const ASR_404_ALERT_CONSECUTIVE_THRESHOLD = 2;

/**
 * Промежуточный (не финальный) статус звонка при временной недоступности сервиса ASR (HTTP 404).
 */
export const ASR_SERVICE_UNAVAILABLE_STATUS_LABEL = 'Ожидает расшифровки (сервис ASR недоступен)';

/**
 * Понятный текст в карточке звонка для администратора салона без технических деталей.
 */
export const ASR_CLIENT_FRIENDLY_WAITING_TEXT =
  'Звонок будет обработан после восстановления сервиса расшифровки';

export interface AsrHealthCheckResult {
  ok: boolean;
  status: number;
  endpointPath: string;
  model: string;
  requestId?: string;
  logLine: string;
  error?: string;
  durationMs: number;
  audioBytes: number;
}

export interface Asr404CatalogProbeResult {
  status: number;
  modelsUrl: string;
  modelVisibleInCatalog: boolean | null;
  fallbackVisibleModels: string[];
  availableAudioModels: string[];
  totalModels: number;
  verdict: AsrCatalogVerdict;
  diagnosticSummary: string;
}

export interface AsrHttpAttemptResponse {
  status: number;
  ok: boolean;
  statusText: string;
  rawBody: string;
  requestId?: string;
  endpointPath?: string;
  responseHeaders?: Record<string, string>;
}

export interface GigaAmTranscribeOptions {
  callId?: string;
  isPreparedWav?: boolean;
  onPreparedWav?: (wavBuffer: Buffer) => void;
  onAttemptCount?: (attempts: number) => void;
  /** Логировать сводную строку [GigaASR] Звонок <id>: ... внутри сервиса (по умолчанию true для успеха, false при передаче в server.ts). */
  emitIncidentSummary?: boolean;
  fetchImpl?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
}

interface AsrRequestContext {
  callId?: string;
  isPreparedWav?: boolean;
  onPreparedWav?: (wavBuffer: Buffer) => void;
  attempts: number;
  fetchImpl?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
}

/**
 * Возвращает лимит одновременных запросов к ASR из переменной окружения ASR_MAX_CONCURRENT.
 * По умолчанию — 1 (строгий FIFO-семафор, как для GigaChat).
 */
export function getAsrMaxConcurrent(): number {
  const raw = (process.env.ASR_MAX_CONCURRENT || '').trim();
  if (!raw) return 1;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

/**
 * Определяет, является ли ошибка ограничением частоты запросов (HTTP 429 / rate_limit_exceeded).
 */
export function isAsrRateLimitError(error: unknown, statusOverride?: number, rawBody?: string): boolean {
  const status = statusOverride ?? extractHttpStatus(error);
  if (status === 429) return true;
  const msg = `${typeof (error as any)?.message === 'string' ? (error as any).message : ''} ${rawBody || ''}`;
  return /rate[_ ]?limit|too many requests|\b429\b/i.test(msg);
}

/**
 * Определяет, является ли ошибка временной недоступностью сервиса ASR (HTTP 404 от эндпоинта транскрибации).
 */
export function isAsrServiceUnavailableError(error: unknown, statusOverride?: number, rawBody?: string): boolean {
  const errObj = error as any;
  if (errObj?.asrFailReason === 'service_unavailable') return true;
  const status = statusOverride ?? extractHttpStatus(error);
  if (status === 404) return true;
  const msg = `${typeof errObj?.message === 'string' ? errObj.message : ''} ${rawBody || ''}`;
  return /service[_ ]unavailable|\bhttp\s*404\b/i.test(msg);
}

/**
 * Определяет, является ли ошибка отсутствием модели / маршрута транскрибации (HTTP 404 / model_not_found).
 */
export function isAsrModelNotFoundError(error: unknown, statusOverride?: number, rawBody?: string): boolean {
  const errObj = error as any;
  if (errObj?.asrFailReason === 'model_not_found') return true;
  const status = statusOverride ?? extractHttpStatus(error);
  if (status === 404) return true;
  const msg = `${typeof errObj?.message === 'string' ? errObj.message : ''} ${rawBody || ''}`;
  return /model[_ ]not[_ ]found|unknown model|\bhttp\s*404\b/i.test(msg);
}

/**
 * Классифицирует причину сбоя расшифровки ASR для поля asr_fail_reason.
 * HTTP 404 от эндпоинта транскрибации классифицируется как service_unavailable (внутренняя ошибка провайдера, не ошибка звонка).
 */
export function classifyAsrFailReason(error: unknown, statusOverride?: number, rawBody?: string): AsrFailReason {
  const errObj = error as any;
  if (typeof errObj?.asrFailReason === 'string' && errObj.asrFailReason.trim()) {
    return errObj.asrFailReason.trim() as AsrFailReason;
  }
  const status = statusOverride ?? extractHttpStatus(error);
  const msg = `${typeof errObj?.message === 'string' ? errObj.message : ''} ${rawBody || ''}`;

  if (status === 404 || isAsrServiceUnavailableError(error, status, rawBody)) {
    return 'service_unavailable';
  }
  if (isAsrModelNotFoundError(error, status, rawBody)) {
    return 'model_not_found';
  }
  if (isAsrRateLimitError(error, status, rawBody)) {
    return 'rate_limit';
  }
  if (
    status === 401 ||
    status === 403 ||
    /unauthorized|forbidden|ошибка авторизации|укажите api[- ]?ключ|не настроен/i.test(msg)
  ) {
    return 'auth_error';
  }
  if (status === 400 || status === 413 || status === 415 || status === 422) {
    return 'bad_request';
  }
  if (typeof status === 'number' && status >= 500) {
    return 'server_error';
  }
  if (/timeout|timed out|abort|econn|enotfound|fetch failed|network|socket|und_err/i.test(msg)) {
    return 'timeout_or_network';
  }
  return 'unknown';
}

/**
 * Вычисляет плавающий интервал авто-повтора для HTTP 404:
 * - стандартный режим: 30 мин → 1 ч (60 мин) → 3 ч (180 мин);
 * - после первого успешного восстановления (afterRecoveryReset=true): сброс до 15 мин → 30 мин → 1 ч → 3 ч.
 */
export function computeAsr404RetryDelayMs(
  attemptNumber: number,
  options?: { afterRecoveryReset?: boolean }
): number {
  const safeAttempt = Number.isFinite(attemptNumber) && attemptNumber >= 1 ? Math.floor(attemptNumber) : 1;
  const schedule = options?.afterRecoveryReset
    ? [ASR_404_POST_RECOVERY_RESET_MINUTES, ...ASR_404_SERVICE_UNAVAILABLE_BACKOFF_MINUTES]
    : [...ASR_404_SERVICE_UNAVAILABLE_BACKOFF_MINUTES];
  const idx = Math.min(safeAttempt - 1, schedule.length - 1);
  return schedule[idx] * 60 * 1000;
}

/**
 * Извлекает идентификатор запроса (x-request-id и аналоги) из заголовков ответа Cloud.ru / прокси.
 */
export function extractRequestIdFromHeaders(headers?: Headers | Record<string, string> | null): string | undefined {
  if (!headers) return undefined;
  const candidateKeys = [
    'x-request-id',
    'x-amzn-requestid',
    'x-correlation-id',
    'x-trace-id',
    'request-id',
    'cf-ray',
  ];
  if (typeof (headers as Headers).get === 'function') {
    const h = headers as Headers;
    for (const key of candidateKeys) {
      const val = h.get(key);
      if (val && val.trim()) return val.trim();
    }
    return undefined;
  }
  const obj = headers as Record<string, string>;
  const entries = Object.entries(obj);
  for (const key of candidateKeys) {
    const found = entries.find(([k]) => k.toLowerCase() === key);
    if (found && found[1] && String(found[1]).trim()) {
      return String(found[1]).trim();
    }
  }
  return undefined;
}

/**
 * Собирает первые безопасные заголовки ответа (до maxCount, без чувствительных cookie/authorization)
 * с обязательным включением x-request-id, если он присутствует.
 */
export function collectFirstResponseHeaders(
  headers?: Headers | null,
  maxCount: number = 8
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers || typeof headers.forEach !== 'function') return result;

  const redacted = new Set(['set-cookie', 'authorization', 'proxy-authorization']);
  const reqId = extractRequestIdFromHeaders(headers);
  if (reqId) {
    result['x-request-id'] = reqId;
  }

  let count = Object.keys(result).length;
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (redacted.has(lower)) return;
    if (lower in result) return;
    if (count >= maxCount) return;
    result[lower] = value;
    count++;
  });
  return result;
}

/**
 * Извлекает путь эндпоинта (например /v1/audio/transcriptions) из полного URL.
 */
export function extractEndpointPath(apiUrl: string): string {
  try {
    return new URL(apiUrl).pathname || '/v1/audio/transcriptions';
  } catch {
    return apiUrl || '/v1/audio/transcriptions';
  }
}

/**
 * Формирует обязательную строку логирования x-request-id для КАЖДОГО ответа ASR (200, 404, 429, 5xx).
 */
export function formatAsrResponseRequestIdLog(details: {
  method: string;
  endpointPath: string;
  status: number;
  model: string;
  requestId?: string;
}): string {
  return `[GigaASR] HTTP ${details.status} (${details.method} ${details.endpointPath}, model=${details.model}): x-request-id=${details.requestId || 'none'}`;
}

/**
 * Формирует развёрнутую диагностическую строку при HTTP 404:
 * метод, полный путь, имя файла, размер, Content-Type, x-request-id и первые заголовки ответа.
 */
export function formatAsr404DiagnosticLog(details: {
  method: string;
  url: string;
  model: string;
  fileName: string;
  sizeBytes: number;
  requestContentType: string;
  responseContentType?: string;
  requestId?: string;
  firstHeaders?: Record<string, string>;
}): string {
  const headersStr = details.firstHeaders && Object.keys(details.firstHeaders).length > 0
    ? Object.entries(details.firstHeaders)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')
    : 'none';
  return (
    `[GigaASR] HTTP 404 диагностика: method=${details.method} url=${details.url} model=${details.model} ` +
    `file=${details.fileName} size=${details.sizeBytes}B contentType=${details.requestContentType} ` +
    `respContentType=${details.responseContentType || 'unknown'} x-request-id=${details.requestId || 'none'} ` +
    `headers={${headersStr}}`
  );
}

/**
 * Формирует текст уведомления администратору в VK-чат при недоступности модели ASR (HTTP 404 / model_not_found).
 */
export function formatAsrModelNotFoundVkAlert(
  modelName: string,
  details?: {
    fallbackModels?: string[];
    callId?: string;
    salonName?: string;
  }
): string {
  const cleanModel = (modelName || '').trim() || getConfiguredAsrModel();
  const lines: string[] = [`ASR недоступен: модель ${cleanModel} не найдена`];
  if (details?.salonName) {
    lines.push(`Салон: ${details.salonName}`);
  }
  if (details?.callId) {
    lines.push(`Звонок: ${details.callId} (сохранён со статусом «Требует расшифровки», авто-повтор остановлен)`);
  }
  if (details?.fallbackModels && details.fallbackModels.length > 0) {
    lines.push(`Проверенные резервные модели (ASR_MODEL_FALLBACK): ${details.fallbackModels.join(', ')}`);
  }
  lines.push('Действие: проверьте и обновите переменную окружения ASR_MODEL (и при необходимости ASR_MODEL_FALLBACK).');
  return lines.join('\n');
}

/**
 * Формирует алерт в VK-чат после трёх подряд неудач HTTP 404:
 * «ASR недоступен: /v1/audio/transcriptions возвращает 404, x-request-id: …»
 */
export function formatAsr404ConsecutiveVkAlert(details: {
  endpointPath?: string;
  requestId?: string;
  modelName?: string;
  fallbackModels?: string[];
  consecutiveFailures?: number;
  catalogVerdict?: AsrCatalogVerdict | string;
  catalogSummary?: string;
  callId?: string;
  salonName?: string;
}): string {
  const endpointPath = (details.endpointPath || '/v1/audio/transcriptions').trim();
  const reqIdLabel = (details.requestId || '').trim() || 'отсутствует';
  const lines: string[] = [
    `ASR недоступен: ${endpointPath} возвращает 404, x-request-id: ${reqIdLabel}`,
  ];
  if (details.salonName) {
    lines.push(`Салон: ${details.salonName}`);
  }
  if (details.modelName) {
    lines.push(`Модель ASR_MODEL: ${details.modelName}`);
  }
  if (details.fallbackModels && details.fallbackModels.length > 0) {
    lines.push(`Резервные ASR_MODEL_FALLBACK: ${details.fallbackModels.join(', ')}`);
  }
  if (typeof details.consecutiveFailures === 'number' && details.consecutiveFailures > 0) {
    lines.push(`Подряд неудач 404: ${details.consecutiveFailures}`);
  }
  if (details.catalogSummary) {
    lines.push(`Проверка GET /v1/models: ${details.catalogSummary}`);
  } else if (details.catalogVerdict === 'model_present_endpoint_issue') {
    lines.push('Проверка GET /v1/models: модель есть в каталоге → проблема в эндпоинте');
  } else if (details.catalogVerdict === 'model_missing_catalog_issue') {
    lines.push('Проверка GET /v1/models: модель исчезла → проблема в каталоге');
  }
  if (details.callId) {
    lines.push(`Последний звонок: ${details.callId} (поставлен на повтор 30 → 60 → 180 мин)`);
  }
  return lines.join('\n');
}

/**
 * Формирует алерт в VK-чат при первых двух подряд HTTP 404 от эндпоинта транскрибации:
 * «ASR недоступен: /v1/audio/transcriptions возвращает 404 для всех моделей. Тикет в поддержку Cloud.ru отправлен.
 *  Звонки накапливаются, будут расшифрованы автоматически после восстановления» + последний x-request-id.
 */
export function formatAsrServiceUnavailableVkAlert(details: {
  endpointPath?: string;
  requestId?: string;
  modelName?: string;
  consecutiveFailures?: number;
  catalogSummary?: string;
  salonName?: string;
}): string {
  const endpointPath = (details.endpointPath || '/v1/audio/transcriptions').trim();
  const reqIdLabel = (details.requestId || '').trim() || 'отсутствует';
  const lines: string[] = [
    `ASR недоступен: ${endpointPath} возвращает 404 для всех моделей. Тикет в поддержку Cloud.ru отправлен. Звонки накапливаются, будут расшифрованы автоматически после восстановления.`,
    `Последний x-request-id: ${reqIdLabel}`,
  ];
  if (details.salonName) {
    lines.push(`Салон: ${details.salonName}`);
  }
  if (typeof details.consecutiveFailures === 'number' && details.consecutiveFailures > 0) {
    lines.push(`Подряд ответов 404: ${details.consecutiveFailures}`);
  }
  if (details.modelName) {
    lines.push(`Модель ASR_MODEL: ${details.modelName}`);
  }
  if (details.catalogSummary) {
    lines.push(`Диагностика GET /v1/models: ${details.catalogSummary}`);
  }
  return lines.join('\n');
}

/**
 * Проверяет, следует ли планировщику автоматически повторять расшифровку отложенного звонка.
 * Различает классы ошибок:
 * - service_unavailable (HTTP 404 от транскрибации): временная недоступность провайдера, не финальный статус,
 *   повторяется без отбрасывания по maxAttempts с плавающим интервалом 30 мин → 1 ч → 3 ч (сброс до 15 мин после первого успеха);
 * - стандартные временные ошибки (429/5xx/сеть): обычный повтор;
 * - устаревший model_not_found: повтор по запланированному окну pending_asr_retry_after.
 */
export function shouldAutoRetryPendingAsrCall(
  call: Pick<
    CallRecord,
    'status' | 'transcription_status' | 'asr_fail_reason' | 'pending_asr_retry_after' | 'pending_asr_attempts'
  >,
  nowMs: number = Date.now(),
  maxAttempts?: number,
  options?: { afterRecoveryReset?: boolean; forceImmediateServiceUnavailable?: boolean }
): {
  shouldRetry: boolean;
  skipReason?: 'not_pending' | 'model_not_found' | 'not_due_yet' | 'max_attempts_reached';
  retryClass?: 'standard_transient' | 'http_404_backoff' | 'service_unavailable_404';
  nextRetryDelayMs?: number;
} {
  const isPending =
    call.status === 'needs_transcription' ||
    call.transcription_status === 'Требует расшифровки' ||
    call.transcription_status === ASR_SERVICE_UNAVAILABLE_STATUS_LABEL;
  if (!isPending) {
    return { shouldRetry: false, skipReason: 'not_pending' };
  }

  const normalizedReason = (call.asr_fail_reason || '').trim().toLowerCase();
  const isServiceUnavailable =
    normalizedReason === 'service_unavailable' ||
    call.transcription_status === ASR_SERVICE_UNAVAILABLE_STATUS_LABEL;

  if (isServiceUnavailable) {
    const retryClass = 'service_unavailable_404' as const;
    const nextAttempt = (call.pending_asr_attempts || 0) + 1;
    const nextRetryDelayMs = computeAsr404RetryDelayMs(nextAttempt, {
      afterRecoveryReset: options?.afterRecoveryReset,
    });
    if (options?.forceImmediateServiceUnavailable) {
      return { shouldRetry: true, retryClass, nextRetryDelayMs };
    }
    if (call.pending_asr_retry_after) {
      const retryAt = Date.parse(call.pending_asr_retry_after);
      if (!Number.isNaN(retryAt) && retryAt > nowMs) {
        return { shouldRetry: false, skipReason: 'not_due_yet', retryClass, nextRetryDelayMs };
      }
    }
    return { shouldRetry: true, retryClass, nextRetryDelayMs };
  }

  const isModelNotFound = normalizedReason === 'model_not_found';
  const retryClass: 'standard_transient' | 'http_404_backoff' = isModelNotFound
    ? 'http_404_backoff'
    : 'standard_transient';

  if (
    typeof maxAttempts === 'number' &&
    maxAttempts > 0 &&
    typeof call.pending_asr_attempts === 'number' &&
    call.pending_asr_attempts >= maxAttempts
  ) {
    return { shouldRetry: false, skipReason: 'max_attempts_reached', retryClass };
  }

  if (isModelNotFound) {
    // Для устаревших записей model_not_found авто-повтор запускается только по явно запланированному окну.
    if (!call.pending_asr_retry_after) {
      return { shouldRetry: false, skipReason: 'model_not_found', retryClass };
    }
    const retryAt = Date.parse(call.pending_asr_retry_after);
    if (Number.isNaN(retryAt) || retryAt > nowMs) {
      return { shouldRetry: false, skipReason: 'not_due_yet', retryClass };
    }
    const nextAttempt = (call.pending_asr_attempts || 0) + 1;
    return {
      shouldRetry: true,
      retryClass,
      nextRetryDelayMs: computeAsr404RetryDelayMs(nextAttempt, {
        afterRecoveryReset: options?.afterRecoveryReset,
      }),
    };
  }

  if (call.pending_asr_retry_after) {
    const retryAt = Date.parse(call.pending_asr_retry_after);
    if (!Number.isNaN(retryAt) && retryAt > nowMs) {
      return { shouldRetry: false, skipReason: 'not_due_yet', retryClass };
    }
  }
  return { shouldRetry: true, retryClass };
}

/**
 * Рассчитывает паузу ретрая по классу ошибки:
 * - HTTP 429 (rate_limit_exceeded): 30 → 60 → 120 сек (или Retry-After, если он больше)
 * - HTTP 504 / fetch failed / прочие 5xx: стандартный бэкофф (или Retry-After)
 */
export function computeAsrErrorClassBackoff(
  attempt: number,
  error: unknown,
  defaultDelayMs: number,
  retryAfterMs: number | null
): { delayMs: number; isRateLimit: boolean } {
  const isRateLimit = isAsrRateLimitError(error);
  if (isRateLimit) {
    const idx = Math.min(Math.max(0, attempt - 1), ASR_RATE_LIMIT_BACKOFF_MS.length - 1);
    const floorMs = ASR_RATE_LIMIT_BACKOFF_MS[idx];
    const delayMs =
      typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0
        ? Math.max(floorMs, retryAfterMs)
        : floorMs;
    return { delayMs, isRateLimit: true };
  }
  const delayMs =
    typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0
      ? Math.max(defaultDelayMs, retryAfterMs)
      : defaultDelayMs;
  return { delayMs, isRateLimit: false };
}

/**
 * Глобальный FIFO-семафор для всех обращений к ASR (прямые запросы, сегменты WAV,
 * каналы стерео, ретраи). Поддерживает глобальную паузу очереди при получении 429.
 */
interface AsrQueueEntry {
  grant: () => void;
  sleepFn?: (ms: number) => Promise<void>;
}

let asrActiveCount = 0;
let asrPausedUntil = 0;
let asrPauseTimer: ReturnType<typeof setTimeout> | null = null;
let asrPauseWaitInFlight = false;
const asrWaitQueue: AsrQueueEntry[] = [];
let asrQueueTotalDispatched = 0;
let asrQueuePeakConcurrent = 0;
let asrLastPauseMs = 0;
let asrGlobalSleepOverride: ((ms: number) => Promise<void>) | null = null;

function scheduleAsrQueueResume(remainingMs: number, preferredSleepFn?: (ms: number) => Promise<void>): void {
  const customSleep = preferredSleepFn || asrGlobalSleepOverride;
  if (customSleep) {
    if (asrPauseWaitInFlight) return;
    asrPauseWaitInFlight = true;
    Promise.resolve(customSleep(remainingMs))
      .catch(() => {})
      .finally(() => {
        asrPauseWaitInFlight = false;
        asrPausedUntil = 0;
        drainAsrQueue();
      });
    return;
  }

  if (asrPauseTimer) return;
  asrPauseTimer = setTimeout(() => {
    asrPauseTimer = null;
    drainAsrQueue();
  }, Math.max(10, remainingMs));
  if (typeof (asrPauseTimer as any).unref === 'function') {
    (asrPauseTimer as any).unref();
  }
}

function drainAsrQueue(): void {
  const limit = getAsrMaxConcurrent();
  while (asrActiveCount < limit && asrWaitQueue.length > 0) {
    const now = Date.now();
    if (asrPausedUntil > now) {
      const remainingMs = asrPausedUntil - now;
      const headSleepFn = asrWaitQueue[0]?.sleepFn;
      scheduleAsrQueueResume(remainingMs, headSleepFn);
      return;
    }
    const next = asrWaitQueue.shift();
    if (!next) return;
    asrActiveCount++;
    asrQueueTotalDispatched++;
    if (asrActiveCount > asrQueuePeakConcurrent) {
      asrQueuePeakConcurrent = asrActiveCount;
    }
    next.grant();
  }
}

/**
 * Приостанавливает отправку всех новых ASR-сегментов и запросов на время паузы (429 cooldown).
 */
export function pauseAsrQueue(delayMs: number, reason?: string): void {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;
  const targetUntil = Date.now() + Math.round(delayMs);
  if (targetUntil > asrPausedUntil) {
    asrPausedUntil = targetUntil;
    asrLastPauseMs = Math.round(delayMs);
    if (asrPauseTimer) {
      clearTimeout(asrPauseTimer);
      asrPauseTimer = null;
    }
    console.warn(
      `[GigaASR Queue] Глобальная пауза очереди ASR на ${(delayMs / 1000).toFixed(1)}с${reason ? ` (${reason})` : ''}. В очереди: ${asrWaitQueue.length}, активных: ${asrActiveCount}.`
    );
  }
}

/**
 * Выполняет один сетевой запрос к ASR строго через глобальный FIFO-семафор
 * с учётом лимита ASR_MAX_CONCURRENT и глобальной паузы после 429.
 */
export async function runWithAsrSemaphore<T>(
  task: () => Promise<T>,
  opts?: { sleepFn?: (ms: number) => Promise<void> }
): Promise<T> {
  await new Promise<void>((resolve) => {
    asrWaitQueue.push({ grant: resolve, sleepFn: opts?.sleepFn });
    drainAsrQueue();
  });
  try {
    return await task();
  } finally {
    asrActiveCount = Math.max(0, asrActiveCount - 1);
    drainAsrQueue();
  }
}

export function getAsrQueueStatus(): {
  maxConcurrent: number;
  active: number;
  queued: number;
  pausedForMs: number;
  peakConcurrent: number;
  totalDispatched: number;
  lastPauseMs: number;
} {
  return {
    maxConcurrent: getAsrMaxConcurrent(),
    active: asrActiveCount,
    queued: asrWaitQueue.length,
    pausedForMs: Math.max(0, asrPausedUntil - Date.now()),
    peakConcurrent: asrQueuePeakConcurrent,
    totalDispatched: asrQueueTotalDispatched,
    lastPauseMs: asrLastPauseMs,
  };
}

/**
 * Сбрасывает состояние очереди ASR (используется исключительно в юнит-тестах).
 */
export function resetAsrQueueForTest(options?: { sleepFn?: ((ms: number) => Promise<void>) | null }): void {
  if (asrPauseTimer) {
    clearTimeout(asrPauseTimer);
    asrPauseTimer = null;
  }
  asrActiveCount = 0;
  asrPausedUntil = 0;
  asrPauseWaitInFlight = false;
  asrWaitQueue.length = 0;
  asrQueueTotalDispatched = 0;
  asrQueuePeakConcurrent = 0;
  asrLastPauseMs = 0;
  asrGlobalSleepOverride = options?.sleepFn ?? null;
  cloudRuModelsCache.clear();
  cloudRuWorkingModelOverrides.clear();
  chatCompletionsFallbackUrls.clear();
  transcriptionsFallbackUrls.clear();
}

/**
 * Формирует единую итоговую строку инцидента по звонку:
 * [GigaASR] Звонок <id>: расшифровка завершена после N попыток / отложена на повтор / не удалась (причина).
 */
export function formatGigaAsrIncidentSummary(
  callId: string | undefined,
  outcome: 'completed' | 'deferred' | 'failed',
  details: { attempts?: number; reason?: string } = {}
): string {
  const idLabel = (callId || '').trim() || 'unknown';
  if (outcome === 'completed') {
    const n = Math.max(1, Math.round(details.attempts ?? 1));
    return `[GigaASR] Звонок ${idLabel}: расшифровка завершена после ${n} попыток`;
  }
  const cleanReason = (details.reason || 'неизвестная ошибка').replace(/\s+/g, ' ').trim();
  if (outcome === 'deferred') {
    return `[GigaASR] Звонок ${idLabel}: отложена на повтор (${cleanReason})`;
  }
  return `[GigaASR] Звонок ${idLabel}: не удалась (${cleanReason})`;
}
const VALID_VARIANTS: GigaamModelVariant[] = [
  'GigaChat/GigaASR',
  'GigaChat/SaluteSpeech',
  'openai/whisper-large-v3',
  'sber/GigaASR',
  'e2e_rnnt',
  'e2e_ctc',
  'rnnt',
  'ctc',
];

// Кэш URL-адресов для автопереключения между /v1/audio/transcriptions и /v1/chat/completions
const chatCompletionsFallbackUrls = new Set<string>();
const transcriptionsFallbackUrls = new Set<string>();

// Кэш рабочих аудио-моделей при автопереключении внутри Cloud.ru каталога (TTL 10 минут)
const cloudRuWorkingModelOverrides = new Map<string, { model: GigaamModelVariant; expiresAt: number }>();

interface CloudRuCatalogInfo {
  models: string[];
  audioToTextModels: string[];
  ttsOnlyModels: string[];
  endpointsByModel: Record<string, string[]>;
  expiresAt: number;
}

// Кэш списка моделей Cloud.ru /v1/models (TTL 10 минут)
const cloudRuModelsCache = new Map<string, CloudRuCatalogInfo>();

export function isCloudRuModelVariant(variant?: GigaamModelVariant | string): boolean {
  if (!variant) return false;
  const trimmed = String(variant).trim();
  if (!trimmed) return false;
  return trimmed.includes('/') || !SELF_HOSTED_GIGAAM_VARIANTS.has(trimmed);
}

/**
 * Возвращает основную модель ASR из env (ASR_MODEL -> GIGAAM_MODEL_VARIANT -> дефолт Cloud.ru).
 */
export function getConfiguredAsrModel(variantOverride?: GigaamModelVariant | string): string {
  if (variantOverride && String(variantOverride).trim()) {
    return normalizeGigaamVariant(String(variantOverride));
  }
  const envAsrModel = (process.env.ASR_MODEL || '').trim();
  if (envAsrModel) {
    return normalizeGigaamVariant(envAsrModel);
  }
  const envLegacy = (process.env.GIGAAM_MODEL_VARIANT || '').trim();
  if (envLegacy && !SELF_HOSTED_GIGAAM_VARIANTS.has(envLegacy.toLowerCase())) {
    return normalizeGigaamVariant(envLegacy);
  }
  return DEFAULT_CLOUDRU_ASR_MODEL;
}

/**
 * Возвращает список резервных моделей ASR из env (ASR_MODEL_FALLBACK) и/или настроек хранилища.
 * Поддерживает один идентификатор или список через запятую / точку с запятой.
 */
export function getConfiguredAsrFallbackModels(primaryModel?: string, storeFallbackOverride?: string): string[] {
  let storeFallback = storeFallbackOverride ?? '';
  if (storeFallbackOverride === undefined) {
    try {
      const store = readStoreSync();
      storeFallback = store.config?.credentials?.asrModelFallback || '';
    } catch {
      // ignore early boot store read errors
    }
  }
  const raw = (process.env.ASR_MODEL_FALLBACK || '').trim() || storeFallback.trim();
  if (!raw) return [];

  const primaryLower = (primaryModel || '').trim().toLowerCase();
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of raw.split(/[,;]+/)) {
    const cleaned = part.trim();
    if (!cleaned) continue;
    const normalized = normalizeGigaamVariant(cleaned);
    const key = normalized.toLowerCase();
    if (key === primaryLower || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

export interface GigaAmConfig {
  apiUrl: string;
  apiKey: string;
  variant: GigaamModelVariant;
  isCloudRu: boolean;
  fallbackModels?: string[];
}

export function normalizeGigaamVariant(raw?: string): GigaamModelVariant {
  if (!raw) return 'e2e_rnnt';
  const trimmed = raw.trim();
  if (!trimmed) return 'e2e_rnnt';
  const lower = trimmed.toLowerCase();
  if (lower === 'gigachat/gigaasr' || lower === 'gigaasr') {
    return 'GigaChat/GigaASR';
  }
  if (lower === 'gigachat/salutespeech' || lower === 'salutespeech') {
    return 'GigaChat/SaluteSpeech';
  }
  if (lower === 'openai/whisper-large-v3' || lower === 'whisper-large-v3' || lower === 'whisper') {
    return 'openai/whisper-large-v3';
  }
  if (VALID_VARIANTS.includes(trimmed as GigaamModelVariant)) {
    return trimmed as GigaamModelVariant;
  }
  // Сохраняем любые пользовательские идентификаторы моделей из ASR_MODEL / ASR_MODEL_FALLBACK без хардкода
  return trimmed as GigaamModelVariant;
}

export function isCloudRuEvolutionEndpoint(url: string, variant?: GigaamModelVariant): boolean {
  const lower = (url || '').toLowerCase();
  return (
    lower.includes('cloud.ru') ||
    lower.includes('/v1/audio/transcriptions') ||
    lower.includes('/v1/audio/transcription') ||
    isCloudRuModelVariant(variant)
  );
}

export function normalizeGigaAmEndpointUrl(rawUrl: string, variant?: GigaamModelVariant): string {
  let clean = (rawUrl || '').trim().replace(/[/.,;:\s]+$/, '');
  if (!clean) {
    return isCloudRuModelVariant(variant) ? CLOUDRU_GIGAASR_TRANSCRIPTIONS_URL : '';
  }

  // Частая опечатка: /audio/transcription в единственном числе вместо /audio/transcriptions
  if (/\/audio\/transcription$/i.test(clean)) {
    clean = clean.replace(/\/audio\/transcription$/i, '/audio/transcriptions');
  }

  try {
    const parsed = new URL(clean);
    if (parsed.hostname.toLowerCase() === 'foundation-models.api.cloud.ru') {
      const pathLower = parsed.pathname.toLowerCase().replace(/\/+$/, '');
      if (pathLower === '/v1/chat/completions') {
        return `${parsed.origin}/v1/chat/completions`;
      }
      // Любой базовый или неполный путь для foundation-models.api.cloud.ru приводим к /v1/audio/transcriptions
      if (
        pathLower === '' ||
        pathLower === '/v1' ||
        pathLower === '/v1/audio' ||
        pathLower === '/audio' ||
        pathLower === '/audio/transcriptions' ||
        pathLower === '/audio/transcription' ||
        pathLower === '/v1/audio/transcription' ||
        pathLower === '/v1/audio/transcriptions' ||
        pathLower === '/v1/models' ||
        pathLower === '/v1/realtime'
      ) {
        return CLOUDRU_GIGAASR_TRANSCRIPTIONS_URL;
      }
    }
  } catch {
    // non-URL strings pass through after basic sanitization
  }

  if (/^https?:\/\/foundation-models\.api\.cloud\.ru(\/v1)?$/i.test(clean)) {
    return CLOUDRU_GIGAASR_TRANSCRIPTIONS_URL;
  }
  return clean;
}

export function getGigaAmConfig(
  apiUrlOverride?: string,
  apiKeyOverride?: string,
  variantOverride?: GigaamModelVariant
): GigaAmConfig {
  let storeUrl = '';
  let storeKey = '';
  let storeVariant: GigaamModelVariant | undefined;
  let storeFallback = '';

  try {
    const store = readStoreSync();
    storeUrl = store.config?.credentials?.gigaamApiUrl || '';
    storeKey = store.config?.credentials?.gigaamApiKey || '';
    storeVariant = store.config?.credentials?.gigaamVariant;
    storeFallback = store.config?.credentials?.asrModelFallback || '';
  } catch {
    // ignore early boot store read errors
  }

  const rawUrl = apiUrlOverride !== undefined
    ? apiUrlOverride
    : ((process.env.GIGAAM_API_URL || '').trim() || storeUrl);
  const apiKey = (
    apiKeyOverride !== undefined
      ? apiKeyOverride
      : ((process.env.GIGAAM_API_KEY || '').trim() || storeKey)
  ).trim();

  const envAsrModel = (process.env.ASR_MODEL || '').trim();
  const envVariant = (process.env.GIGAAM_MODEL_VARIANT || '').trim();
  // Приоритет: явный override -> env ASR_MODEL -> env GIGAAM_MODEL_VARIANT (если не дефолтный e2e_rnnt для Cloud.ru) -> storeVariant
  const isRawCloudRu = (rawUrl || '').toLowerCase().includes('cloud.ru') || (rawUrl || '').toLowerCase().includes('/v1/audio/transcription');
  const effectiveLegacyEnv = isRawCloudRu && envVariant.toLowerCase() === 'e2e_rnnt' && !envAsrModel ? '' : envVariant;
  const rawVariant = variantOverride || envAsrModel || effectiveLegacyEnv || storeVariant || envVariant;
  let variant = normalizeGigaamVariant(rawVariant);
  const apiUrl = normalizeGigaAmEndpointUrl(rawUrl, variant);
  const isCloudRu = isCloudRuEvolutionEndpoint(apiUrl, variant);

  // Если URL указывает на Cloud.ru Evolution, а вариант остался дефолтным (e2e_rnnt) и ASR_MODEL не задан — берём дефолт Cloud.ru
  if (
    apiUrl.toLowerCase().includes('cloud.ru') &&
    !variantOverride &&
    !envAsrModel &&
    (!storeVariant || SELF_HOSTED_GIGAAM_VARIANTS.has(String(storeVariant).toLowerCase())) &&
    SELF_HOSTED_GIGAAM_VARIANTS.has(String(variant).toLowerCase())
  ) {
    variant = DEFAULT_CLOUDRU_ASR_MODEL;
  }

  const fallbackModels = getConfiguredAsrFallbackModels(variant, storeFallback);

  return {
    apiUrl,
    apiKey,
    variant,
    isCloudRu,
    fallbackModels,
  };
}

export function isGigaAmConfigured(): boolean {
  const { apiUrl, apiKey, isCloudRu } = getGigaAmConfig();
  if (!apiUrl) return false;
  if (isCloudRu && apiUrl.includes('cloud.ru') && !apiKey) return false;
  return true;
}

function getFileMeta(audioFormat: 'mp3' | 'oggopus' | 'lpcm', mimeType?: string): { ext: string; mime: string } {
  if (audioFormat === 'oggopus') return { ext: 'ogg', mime: 'audio/ogg' };
  if (audioFormat === 'lpcm') return { ext: 'wav', mime: 'audio/wav' };
  const lowerMime = (mimeType || '').toLowerCase();
  if (lowerMime.includes('wav')) return { ext: 'wav', mime: 'audio/wav' };
  if (lowerMime.includes('ogg')) return { ext: 'ogg', mime: 'audio/ogg' };
  if (lowerMime.includes('flac')) return { ext: 'flac', mime: 'audio/flac' };
  if (lowerMime.includes('webm')) return { ext: 'webm', mime: 'audio/webm' };
  if (lowerMime.includes('mp4') || lowerMime.includes('m4a')) return { ext: 'm4a', mime: 'audio/mp4' };
  return { ext: 'mp3', mime: 'audio/mpeg' };
}

export function extractTextFromGigaAmResponse(data: any): string {
  if (!data) return '';
  if (typeof data === 'string') return data.trim();

  if (typeof data.text === 'string' && data.text.trim()) return data.text.trim();
  if (typeof data.transcription === 'string' && data.transcription.trim()) return data.transcription.trim();
  if (typeof data.transcript === 'string' && data.transcript.trim()) return data.transcript.trim();
  if (typeof data.result === 'string' && data.result.trim()) return data.result.trim();
  if (typeof data.output === 'string' && data.output.trim()) return data.output.trim();

  const segmentList = Array.isArray(data.segments)
    ? data.segments
    : Array.isArray(data.utterances)
    ? data.utterances
    : null;

  if (segmentList && segmentList.length > 0) {
    const lines = segmentList
      .map((seg: any) => {
        const text = String(seg?.text || seg?.transcript || seg?.utterance || '').trim();
        if (!text) return '';
        if (seg?.speaker !== undefined && seg?.speaker !== null && String(seg.speaker).trim() !== '') {
          const sp = String(seg.speaker).toLowerCase();
          const role = sp.includes('1') || sp.includes('manager') || sp.includes('менедж') || sp.includes('oper')
            ? 'Менеджер'
            : 'Клиент';
          return `${role}: ${text}`;
        }
        return text;
      })
      .filter(Boolean);
    if (lines.length > 0) return lines.join('\n');
  }

  const listField = Array.isArray(data.results)
    ? data.results
    : Array.isArray(data.hypotheses)
    ? data.hypotheses
    : Array.isArray(data.predictions)
    ? data.predictions
    : null;

  if (listField && listField.length > 0) {
    const lines = listField
      .map((r: any) => {
        if (typeof r === 'string') return r.trim();
        return String(
          r?.text ||
            r?.transcript ||
            r?.transcription ||
            r?.alternatives?.[0]?.transcript ||
            r?.alternatives?.[0]?.text ||
            ''
        ).trim();
      })
      .filter(Boolean);
    if (lines.length > 0) return lines.join('\n');
  }

  if (Array.isArray(data.choices) && data.choices.length > 0) {
    const msgContent = data.choices[0]?.message?.content;
    if (typeof msgContent === 'string' && msgContent.trim()) return msgContent.trim();
    if (Array.isArray(msgContent)) {
      const joined = msgContent
        .map((p: any) => (typeof p === 'string' ? p : p?.text || ''))
        .filter(Boolean)
        .join('\n')
        .trim();
      if (joined) return joined;
    }
    const choiceText = data.choices[0]?.text;
    if (typeof choiceText === 'string' && choiceText.trim()) return choiceText.trim();
  }

  if (data.data && typeof data.data === 'object') {
    const nested = extractTextFromGigaAmResponse(data.data);
    if (nested) return nested;
  }

  if (data.result && typeof data.result === 'object') {
    const nested = extractTextFromGigaAmResponse(data.result);
    if (nested) return nested;
  }

  return '';
}

export function extractSegmentsFromGigaAmResponse(rawBody: string, offsetSec: number = 0): TimedUtterance[] {
  if (!rawBody || !rawBody.trim()) return [];
  try {
    const parsed = JSON.parse(rawBody);
    const segs = Array.isArray(parsed?.segments)
      ? parsed.segments
      : Array.isArray(parsed?.utterances)
      ? parsed.utterances
      : null;

    if (segs && segs.length > 0) {
      const out = segs
        .map((seg: any) => {
          const text = String(seg?.text || seg?.transcript || seg?.utterance || '').trim();
          if (!text) return null;
          const start = typeof seg?.start === 'number'
            ? seg.start + offsetSec
            : typeof seg?.start_time === 'number'
            ? seg.start_time + offsetSec
            : undefined;
          const end = typeof seg?.end === 'number'
            ? seg.end + offsetSec
            : typeof seg?.end_time === 'number'
            ? seg.end_time + offsetSec
            : undefined;
          return { text, start, end } satisfies TimedUtterance;
        })
        .filter((s: TimedUtterance | null): s is TimedUtterance => s !== null);
      if (out.length > 0) return out;
    }

    const plainText = extractTextFromGigaAmResponse(parsed);
    if (plainText) {
      return [{ text: plainText, start: offsetSec > 0 ? offsetSec : undefined }];
    }
    return [];
  } catch {
    return rawBody.trim() ? [{ text: rawBody.trim(), start: offsetSec > 0 ? offsetSec : undefined }] : [];
  }
}

interface CloudRuAttemptOpts {
  responseFormat?: 'verbose_json' | 'json';
  includeLanguage?: boolean;
}

function getModelParamForRequest(config: GigaAmConfig): string {
  const trimmed = String(config.variant || '').trim();
  if (config.isCloudRu) {
    if (trimmed && !SELF_HOSTED_GIGAAM_VARIANTS.has(trimmed.toLowerCase())) {
      return trimmed;
    }
    return getConfiguredAsrModel();
  }
  if (isCloudRuModelVariant(trimmed)) {
    return trimmed;
  }
  return `gigaam-v3-${trimmed || 'e2e_rnnt'}`;
}

async function fetchCloudRuCatalogModels(
  origin: string,
  apiKey: string,
  bypassCache: boolean = false
): Promise<{
  status: number;
  models: string[];
  audioToTextModels: string[];
  ttsOnlyModels: string[];
  endpointsByModel: Record<string, string[]>;
}> {
  const cacheKey = `${origin}::${apiKey.slice(0, 12)}`;
  const cached = cloudRuModelsCache.get(cacheKey);
  if (!bypassCache && cached && cached.expiresAt > Date.now()) {
    return {
      status: 200,
      models: cached.models,
      audioToTextModels: cached.audioToTextModels,
      ttsOnlyModels: cached.ttsOnlyModels,
      endpointsByModel: cached.endpointsByModel,
    };
  }
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers['Authorization'] = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
  }
  const res = await fetchWithSttRetry(
    `${origin}/v1/models`,
    () => ({
      headers,
      signal: AbortSignal.timeout(10000),
    }),
    {
      providerName: 'GigaASR (Cloud.ru)',
      operationName: 'v1/models',
      maxAttempts: 3,
      baseDelayMs: 600,
      maxDelayMs: 4000,
    }
  );
  if (!res.ok) {
    return {
      status: res.status,
      models: [],
      audioToTextModels: [],
      ttsOnlyModels: [],
      endpointsByModel: {},
    };
  }
  const data: any = await res.json().catch(() => ({}));
  const rawList: any[] = Array.isArray(data?.data) ? data.data : [];
  const models: string[] = [];
  const audioToTextModels: string[] = [];
  const ttsOnlyModels: string[] = [];
  const endpointsByModel: Record<string, string[]> = {};

  for (const m of rawList) {
    const id = String(m?.id || '').trim();
    if (!id) continue;
    models.push(id);
    const metaType = String(m?.metadata?.type || '').toLowerCase();
    const rawEndpoints: any[] = Array.isArray(m?.metadata?.endpoints) ? m.metadata.endpoints : [];
    const paths = rawEndpoints
      .map((ep: any) => String(ep?.path || '').trim())
      .filter(Boolean);
    if (paths.length > 0) {
      endpointsByModel[id] = paths;
    }
    if (metaType === 'audio-to-text' || paths.some((p) => p.includes('/audio/transcriptions'))) {
      audioToTextModels.push(id);
    } else if (metaType === 'tts') {
      ttsOnlyModels.push(id);
    }
  }

  cloudRuModelsCache.set(cacheKey, {
    models,
    audioToTextModels,
    ttsOnlyModels,
    endpointsByModel,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  return { status: 200, models, audioToTextModels, ttsOnlyModels, endpointsByModel };
}

function pickCloudRuModelFromCatalog(desired: GigaamModelVariant, catalogModels: string[]): GigaamModelVariant {
  const fallbackDefault = getConfiguredAsrModel();
  if (catalogModels.length === 0) {
    return isCloudRuModelVariant(desired) ? desired : (fallbackDefault as GigaamModelVariant);
  }
  const exact = catalogModels.find((id) => id.toLowerCase() === desired.toLowerCase());
  if (exact) return exact as GigaamModelVariant;

  // Если явно задан конкретный идентификатор модели (например через ASR_MODEL), не подменяем его молча —
  // отправляем его на эндпоинт, чтобы при 404 сработали диагностика и ASR_MODEL_FALLBACK.
  if (isCloudRuModelVariant(desired)) {
    return desired;
  }

  const lower = desired.toLowerCase();
  if (lower.includes('salutespeech')) {
    const m = catalogModels.find((id) => id.toLowerCase().includes('salutespeech'));
    if (m) return m as GigaamModelVariant;
  }
  if (lower.includes('whisper')) {
    const m = catalogModels.find((id) => id.toLowerCase().includes('whisper'));
    if (m) return m as GigaamModelVariant;
  }
  const gigaAsr = catalogModels.find((id) => id.toLowerCase().includes('gigaasr'));
  if (gigaAsr) return gigaAsr as GigaamModelVariant;

  return fallbackDefault as GigaamModelVariant;
}

function getAlternateCloudRuAudioModels(
  primaryModel: string,
  catalogModels: string[],
  audioToTextModels: string[],
  configuredFallbackModels: string[] = []
): GigaamModelVariant[] {
  const candidates = new Set<string>();
  const primaryLower = primaryModel.toLowerCase();

  // 1. В первую очередь — явно сконфигурированные фолбэк-модели (ASR_MODEL_FALLBACK)
  for (const fb of configuredFallbackModels) {
    const clean = fb.trim();
    if (clean && clean.toLowerCase() !== primaryLower) {
      candidates.add(clean);
    }
  }

  // 2. Затем — реально доступные audio-to-text модели из каталога Cloud.ru /v1/models
  for (const id of audioToTextModels) {
    if (id.toLowerCase() !== primaryLower) {
      candidates.add(id);
    }
  }

  // 3. Дополнительные модели из каталога, только если каталог реально вернулся и содержит их
  if (catalogModels.length > 0) {
    for (const candidate of [getConfiguredAsrModel(), 'openai/whisper-large-v3']) {
      if (candidate.toLowerCase() !== primaryLower) {
        const exact = catalogModels.find((id) => id.toLowerCase() === candidate.toLowerCase());
        if (exact) {
          candidates.add(exact);
        }
      }
    }
  }
  return Array.from(candidates) as GigaamModelVariant[];
}

/**
 * Одиночный быстрый запрос GET /v1/models при HTTP 404 (без ретраев),
 * чтобы получить готовый диагностический сниппет:
 * «модель есть → проблема в эндпоинте» или «модель исчезла → проблема в каталоге».
 */
export async function probeCloudRuCatalogOn404(
  apiUrl: string,
  apiKey: string,
  primaryModel: string,
  fallbackModels: string[] = [],
  fetchImpl?: typeof fetch
): Promise<Asr404CatalogProbeResult> {
  let origin = 'https://foundation-models.api.cloud.ru';
  let endpointPath = '/v1/audio/transcriptions';
  try {
    const parsed = new URL(apiUrl);
    origin = parsed.origin;
    endpointPath = parsed.pathname || endpointPath;
  } catch {
    // use defaults
  }
  const modelsUrl = `${origin}/v1/models`;
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers['Authorization'] = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
  }

  const doFetch = fetchImpl ?? fetch;
  try {
    const res = await doFetch(modelsUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const bodyPreview = (await res.text().catch(() => '')).slice(0, 200);
      const diagnosticSummary = `GET ${modelsUrl} вернул HTTP ${res.status}${bodyPreview ? `: ${bodyPreview}` : ''}`;
      console.warn(`[GigaASR] Проверка каталога при 404: ${diagnosticSummary}`);
      return {
        status: res.status,
        modelsUrl,
        modelVisibleInCatalog: null,
        fallbackVisibleModels: [],
        availableAudioModels: [],
        totalModels: 0,
        verdict: 'catalog_probe_failed',
        diagnosticSummary,
      };
    }

    const data: any = await res.json().catch(() => ({}));
    const rawList: any[] = Array.isArray(data?.data) ? data.data : [];
    const models: string[] = [];
    const availableAudioModels: string[] = [];

    for (const m of rawList) {
      const id = String(m?.id || '').trim();
      if (!id) continue;
      models.push(id);
      const metaType = String(m?.metadata?.type || '').toLowerCase();
      const rawEndpoints: any[] = Array.isArray(m?.metadata?.endpoints) ? m.metadata.endpoints : [];
      const paths = rawEndpoints.map((ep: any) => String(ep?.path || '').trim());
      if (
        metaType === 'audio-to-text' ||
        paths.some((p) => p.includes('/audio/transcriptions')) ||
        /asr|whisper|gigaam|speech/i.test(id)
      ) {
        availableAudioModels.push(id);
      }
    }

    const primaryLower = primaryModel.trim().toLowerCase();
    const primaryExact = models.find((id) => id.toLowerCase() === primaryLower);
    const modelVisibleInCatalog = Boolean(primaryExact);
    const fallbackVisibleModels = fallbackModels
      .map((fb) => models.find((id) => id.toLowerCase() === fb.trim().toLowerCase()))
      .filter((id): id is string => Boolean(id));

    const audioListLabel = availableAudioModels.length > 0 ? availableAudioModels.join(', ') : 'не найдены';
    const fallbackNote =
      fallbackModels.length > 0
        ? `; фолбэк в каталоге: ${fallbackVisibleModels.length > 0 ? fallbackVisibleModels.join(', ') : 'нет'}`
        : '';

    const verdict: AsrCatalogVerdict = modelVisibleInCatalog
      ? 'model_present_endpoint_issue'
      : 'model_missing_catalog_issue';

    const diagnosticSummary = modelVisibleInCatalog
      ? `модель ${primaryExact} ЕСТЬ в каталоге → проблема в эндпоинте (${endpointPath})${fallbackNote}. Аудио-модели: ${audioListLabel}`
      : `модель ${primaryModel} ИСЧЕЗЛА из каталога → проблема в каталоге${fallbackNote}. Доступные аудио-модели: ${audioListLabel}`;

    console.warn(
      `[GigaASR] Проверка каталога GET ${modelsUrl} (HTTP 200, моделей: ${models.length}): ${diagnosticSummary}`
    );

    return {
      status: 200,
      modelsUrl,
      modelVisibleInCatalog,
      fallbackVisibleModels,
      availableAudioModels,
      totalModels: models.length,
      verdict,
      diagnosticSummary,
    };
  } catch (probeErr: any) {
    const errMsg = probeErr?.message || String(probeErr);
    const diagnosticSummary = `не удалось опросить ${modelsUrl} (${errMsg})`;
    console.warn(`[GigaASR] Проверка каталога при 404: ${diagnosticSummary}`);
    return {
      status: 0,
      modelsUrl,
      modelVisibleInCatalog: null,
      fallbackVisibleModels: [],
      availableAudioModels: [],
      totalModels: 0,
      verdict: 'catalog_probe_failed',
      diagnosticSummary,
    };
  }
}

async function resolveCloudRuConfig(
  config: GigaAmConfig,
  bypassCache: boolean = false,
  skipCatalogFetch: boolean = false
): Promise<{
  config: GigaAmConfig;
  catalogModels: string[];
  audioToTextModels: string[];
  ttsOnlyModels: string[];
  endpointsByModel: Record<string, string[]>;
}> {
  if (!config.isCloudRu) {
    return {
      config,
      catalogModels: [],
      audioToTextModels: [],
      ttsOnlyModels: [],
      endpointsByModel: {},
    };
  }
  const overrideKey = `${config.apiUrl}::${config.variant}`;
  const cachedOverride = !bypassCache ? cloudRuWorkingModelOverrides.get(overrideKey) : undefined;
  if (!skipCatalogFetch) {
    try {
      const origin = new URL(config.apiUrl).origin;
      const cat = await fetchCloudRuCatalogModels(origin, config.apiKey, bypassCache);
      if (cat.status === 200 && cat.models.length > 0) {
        let picked = pickCloudRuModelFromCatalog(config.variant, cat.models);
        // Если пользователь выбрал TTS-модель (SaluteSpeech), автоматически берём реальную STT-модель (GigaASR / whisper)
        if (
          cat.ttsOnlyModels.some((id) => id.toLowerCase() === picked.toLowerCase()) &&
          cat.audioToTextModels.length > 0
        ) {
          const gigaAsr = cat.audioToTextModels.find((id) => id.toLowerCase().includes('gigaasr'));
          picked = (gigaAsr || cat.audioToTextModels[0]) as GigaamModelVariant;
        }
        // Подставляем точные актуальные идентификаторы из каталога Cloud.ru и для резервных моделей ASR_MODEL_FALLBACK
        const resolvedFallbacks = (config.fallbackModels || []).map((fb) => {
          const exactFb = cat.models.find((id) => id.toLowerCase() === fb.toLowerCase());
          return exactFb || fb;
        });
        if (cachedOverride && cachedOverride.expiresAt > Date.now()) {
          picked = cachedOverride.model;
        }
        return {
          config: { ...config, variant: picked, fallbackModels: resolvedFallbacks },
          catalogModels: cat.models,
          audioToTextModels: cat.audioToTextModels,
          ttsOnlyModels: cat.ttsOnlyModels,
          endpointsByModel: cat.endpointsByModel,
        };
      }
    } catch {
      // ignore catalog discovery errors during transcription
    }
  }
  const fallbackVariant =
    cachedOverride && cachedOverride.expiresAt > Date.now()
      ? cachedOverride.model
      : isCloudRuModelVariant(config.variant)
      ? config.variant
      : (getConfiguredAsrModel() as GigaamModelVariant);
  return {
    config: { ...config, variant: fallbackVariant },
    catalogModels: [],
    audioToTextModels: [],
    ttsOnlyModels: [],
    endpointsByModel: {},
  };
}

async function sendMultipartOnce(
  audioBuffer: Buffer,
  meta: { ext: string; mime: string },
  config: GigaAmConfig,
  fieldName: 'file' | 'audio',
  cloudRuOpts?: CloudRuAttemptOpts,
  ctx?: AsrRequestContext
): Promise<AsrHttpAttemptResponse> {
  const modelParam = getModelParamForRequest(config);
  const fileName = `call.${meta.ext}`;
  const endpointPath = extractEndpointPath(config.apiUrl);
  const headers: Record<string, string> = {};
  if (config.apiKey) {
    headers['Authorization'] = config.apiKey.startsWith('Bearer ') ? config.apiKey : `Bearer ${config.apiKey}`;
  }

  const audioBytes = new Uint8Array(audioBuffer);
  const response = await fetchWithSttRetry(
    config.apiUrl,
    () => {
      const form = new FormData();
      const blob = new Blob([audioBytes], { type: meta.mime });
      form.append(fieldName, blob, fileName);
      form.append('model', modelParam);

      if (config.isCloudRu) {
        if (cloudRuOpts?.includeLanguage !== false) {
          form.append('language', 'ru');
        }
        if (cloudRuOpts?.responseFormat) {
          form.append('response_format', cloudRuOpts.responseFormat);
        }
      } else {
        form.append('language', 'ru');
        form.append('variant', config.variant);
      }

      return {
        method: 'POST',
        headers,
        body: form,
        signal: AbortSignal.timeout(120000),
      };
    },
    {
      providerName: config.isCloudRu ? 'GigaASR (Cloud.ru)' : 'GigaAM v3',
      operationName: 'audio/transcriptions',
      maxAttempts: 4,
      baseDelayMs: 1000,
      maxDelayMs: 12000,
      sleepFn: ctx?.sleepFn,
      onAttempt: () => {
        if (ctx) ctx.attempts++;
      },
      wrapAttempt: (fn) => runWithAsrSemaphore(fn, { sleepFn: ctx?.sleepFn }),
      getDelayMs: (attempt, err, defaultDelayMs, retryAfterMs) => {
        const calc = computeAsrErrorClassBackoff(attempt, err, defaultDelayMs, retryAfterMs);
        if (calc.isRateLimit) {
          pauseAsrQueue(calc.delayMs, `HTTP 429 попытка ${attempt}`);
        }
        return calc.delayMs;
      },
    },
    ctx?.fetchImpl ?? fetch
  );

  const rawBody = await response.text().catch(() => '');
  const requestId = extractRequestIdFromHeaders(response.headers);
  const firstHeaders = collectFirstResponseHeaders(response.headers, 8);
  const reqIdLogLine = formatAsrResponseRequestIdLog({
    method: 'POST',
    endpointPath,
    status: response.status,
    model: modelParam,
    requestId,
  });
  if (response.ok) {
    console.log(reqIdLogLine);
  } else {
    console.warn(reqIdLogLine);
  }
  if (response.status === 404) {
    console.error(`[GigaASR] HTTP 404: ${rawBody || response.statusText || '(empty body)'}`);
    console.error(
      formatAsr404DiagnosticLog({
        method: 'POST',
        url: config.apiUrl,
        model: modelParam,
        fileName: `${fieldName}=${fileName}`,
        sizeBytes: audioBuffer.length,
        requestContentType: `multipart/form-data (file=${meta.mime})`,
        responseContentType: response.headers?.get('content-type') || undefined,
        requestId,
        firstHeaders,
      })
    );
  }
  if (!response.ok && isAsrRateLimitError(null, response.status, rawBody)) {
    const finalPause = ASR_RATE_LIMIT_BACKOFF_MS[ASR_RATE_LIMIT_BACKOFF_MS.length - 1];
    pauseAsrQueue(finalPause, 'HTTP 429 после исчерпания попыток');
  }
  return {
    status: response.status,
    ok: response.ok,
    statusText: response.statusText,
    rawBody,
    requestId,
    endpointPath,
    responseHeaders: firstHeaders,
  };
}

function getChatCompletionsUrlFromConfig(apiUrl: string): string {
  try {
    const u = new URL(apiUrl);
    if (u.pathname.endsWith('/chat/completions')) return apiUrl;
    return `${u.origin}/v1/chat/completions`;
  } catch {
    return 'https://foundation-models.api.cloud.ru/v1/chat/completions';
  }
}

function getTranscriptionsUrlFromConfig(apiUrl: string): string {
  try {
    const u = new URL(apiUrl);
    if (u.pathname.endsWith('/audio/transcriptions')) return apiUrl;
    return `${u.origin}/v1/audio/transcriptions`;
  } catch {
    return CLOUDRU_GIGAASR_TRANSCRIPTIONS_URL;
  }
}

async function sendChatAudioOnce(
  audioBuffer: Buffer,
  meta: { ext: string; mime: string },
  config: GigaAmConfig,
  mode: 'input_audio' | 'audio_url',
  includeTextPrompt: boolean = true,
  ctx?: AsrRequestContext
): Promise<AsrHttpAttemptResponse> {
  const chatUrl = getChatCompletionsUrlFromConfig(config.apiUrl);
  const modelParam = getModelParamForRequest(config);

  const b64 = audioBuffer.toString('base64');
  const audioPart =
    mode === 'input_audio'
      ? {
          type: 'input_audio',
          input_audio: {
            data: b64,
            format: meta.ext === 'wav' ? 'wav' : meta.ext === 'mp3' ? 'mp3' : meta.ext,
          },
        }
      : {
          type: 'audio_url',
          audio_url: {
            url: `data:${meta.mime};base64,${b64}`,
          },
        };

  const contentParts = includeTextPrompt
    ? [
        {
          type: 'text',
          text: 'Расшифруй аудиозапись телефонного разговора дословно на русском языке. Выведи только текст стенограммы без пояснений.',
        },
        audioPart,
      ]
    : [audioPart];

  const payload: Record<string, any> = {
    model: modelParam,
    messages: [
      {
        role: 'user',
        content: contentParts,
      },
    ],
  };
  if (includeTextPrompt) {
    payload.temperature = 0;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey) {
    headers['Authorization'] = config.apiKey.startsWith('Bearer ') ? config.apiKey : `Bearer ${config.apiKey}`;
  }

  const bodyJson = JSON.stringify(payload);
  const response = await fetchWithSttRetry(
    chatUrl,
    () => ({
      method: 'POST',
      headers,
      body: bodyJson,
      signal: AbortSignal.timeout(120000),
    }),
    {
      providerName: config.isCloudRu ? 'GigaASR (Cloud.ru)' : 'GigaAM v3',
      operationName: 'chat/completions',
      maxAttempts: 4,
      baseDelayMs: 1000,
      maxDelayMs: 12000,
      sleepFn: ctx?.sleepFn,
      onAttempt: () => {
        if (ctx) ctx.attempts++;
      },
      wrapAttempt: (fn) => runWithAsrSemaphore(fn, { sleepFn: ctx?.sleepFn }),
      getDelayMs: (attempt, err, defaultDelayMs, retryAfterMs) => {
        const calc = computeAsrErrorClassBackoff(attempt, err, defaultDelayMs, retryAfterMs);
        if (calc.isRateLimit) {
          pauseAsrQueue(calc.delayMs, `HTTP 429 chat/completions попытка ${attempt}`);
        }
        return calc.delayMs;
      },
    },
    ctx?.fetchImpl ?? fetch
  );

  const rawBody = await response.text().catch(() => '');
  const requestId = extractRequestIdFromHeaders(response.headers);
  const firstHeaders = collectFirstResponseHeaders(response.headers, 8);
  const endpointPath = extractEndpointPath(chatUrl);
  const reqIdLogLine = formatAsrResponseRequestIdLog({
    method: 'POST',
    endpointPath,
    status: response.status,
    model: modelParam,
    requestId,
  });
  if (response.ok) {
    console.log(reqIdLogLine);
  } else {
    console.warn(reqIdLogLine);
  }
  if (response.status === 404) {
    console.error(`[GigaASR] HTTP 404: ${rawBody || response.statusText || '(empty body)'}`);
    console.error(
      formatAsr404DiagnosticLog({
        method: 'POST',
        url: chatUrl,
        model: modelParam,
        fileName: `call.${meta.ext}`,
        sizeBytes: audioBuffer.length,
        requestContentType: 'application/json',
        responseContentType: response.headers?.get('content-type') || undefined,
        requestId,
        firstHeaders,
      })
    );
  }
  if (!response.ok && isAsrRateLimitError(null, response.status, rawBody)) {
    const finalPause = ASR_RATE_LIMIT_BACKOFF_MS[ASR_RATE_LIMIT_BACKOFF_MS.length - 1];
    pauseAsrQueue(finalPause, 'HTTP 429 chat/completions после исчерпания попыток');
  }
  return {
    status: response.status,
    ok: response.ok,
    statusText: response.statusText,
    rawBody,
    requestId,
    endpointPath,
    responseHeaders: firstHeaders,
  };
}

async function tryChatAudioFallback(
  audioBuffer: Buffer,
  meta: { ext: string; mime: string },
  config: GigaAmConfig,
  label: string,
  ctx?: AsrRequestContext
): Promise<{ ok: boolean; status: number; statusText: string; rawBody: string; text: string }> {
  // Для Cloud.ru сразу перекодируем MP3/OGG и любые не-WAV контейнеры в чистый WAV 16кГц моно PCM,
  // чтобы не получать HTTP 400 на первой отправке (пропускаем если WAV уже подготовлен).
  let effectiveBuf = audioBuffer;
  let effectiveMeta = meta;
  let wasConvertedToWav = Boolean(ctx?.isPreparedWav);
  if (!wasConvertedToWav && ((config.isCloudRu && meta.ext !== 'wav') || (meta.ext !== 'wav' && meta.ext !== 'mp3'))) {
    const wavBuf = convertToWav16kMono(audioBuffer);
    if (wavBuf && wavBuf.length > 44) {
      effectiveBuf = wavBuf;
      effectiveMeta = { ext: 'wav', mime: 'audio/wav' };
      wasConvertedToWav = true;
      ctx?.onPreparedWav?.(wavBuf);
    }
  }

  const attempts: Array<{ mode: 'input_audio' | 'audio_url'; includeText: boolean }> = [
    { mode: 'input_audio', includeText: true },
    { mode: 'audio_url', includeText: true },
    { mode: 'input_audio', includeText: false },
    { mode: 'audio_url', includeText: false },
  ];
  let lastRes: { status: number; ok: boolean; statusText: string; rawBody: string } | null = null;

  for (const attempt of attempts) {
    const res = await sendChatAudioOnce(
      effectiveBuf,
      effectiveMeta,
      config,
      attempt.mode,
      attempt.includeText,
      ctx
    );
    lastRes = res;
    if (res.ok) {
      return {
        ...res,
        text: parseTranscriptionBody(res.rawBody, label),
      };
    }
    if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 429) {
      break;
    }
  }

  // Если первый формат (например mp3 или нестандартный WAV) отклонён с 400/415/422 — перекодируем в чистый WAV 16кГц моно PCM
  if (
    !wasConvertedToWav &&
    lastRes &&
    (lastRes.status === 400 || lastRes.status === 415 || lastRes.status === 422)
  ) {
    const wavBuf = convertToWav16kMono(audioBuffer);
    if (wavBuf && wavBuf.length > 44) {
      ctx?.onPreparedWav?.(wavBuf);
      for (const attempt of attempts.slice(0, 2)) {
        const res = await sendChatAudioOnce(
          wavBuf,
          { ext: 'wav', mime: 'audio/wav' },
          config,
          attempt.mode,
          attempt.includeText,
          ctx
        );
        lastRes = res;
        if (res.ok) {
          return {
            ...res,
            text: parseTranscriptionBody(res.rawBody, label),
          };
        }
        if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 429) {
          break;
        }
      }
    }
  }

  return {
    ok: false,
    status: lastRes?.status || 500,
    statusText: lastRes?.statusText || 'Error',
    rawBody: lastRes?.rawBody || '',
    text: '',
  };
}

function parseTranscriptionBody(rawBody: string, label: string): string {
  if (!rawBody || !rawBody.trim()) return '';
  try {
    const parsed = JSON.parse(rawBody);
    const extracted = extractTextFromGigaAmResponse(parsed);
    if (!extracted && parsed && typeof parsed === 'object') {
      console.warn(`[${label}] Ответ 200 OK, но текст не извлечён. Ключи JSON: ${Object.keys(parsed).join(', ')}`);
    }
    return extracted;
  } catch {
    return rawBody.trim();
  }
}

async function postAudioToGigaAm(
  audioBuffer: Buffer,
  mimeType: string,
  config: GigaAmConfig,
  fieldName: 'file' | 'audio' = 'file',
  allowWavFallback: boolean = true,
  preferVerboseJson: boolean = false,
  onRawSegments?: (segs: TimedUtterance[]) => void,
  ctx?: AsrRequestContext
): Promise<string> {
  const meta = ctx?.isPreparedWav
    ? { ext: 'wav', mime: 'audio/wav' }
    : getFileMeta(detectAudioFormat(audioBuffer), mimeType);
  const label = config.isCloudRu ? 'GigaASR (Cloud.ru)' : 'GigaAM v3';

  if (config.isCloudRu) {
    // Cloud.ru GigaASR стабильно отклоняет MP3/OGG с HTTP 400 — сразу конвертируем в WAV 16кГц моно PCM
    // перед первым запросом (пропускаем конвертацию, если WAV уже подготовлен заранее).
    let cloudBuffer = audioBuffer;
    let cloudMeta = meta;
    let cloudAllowWavFallback = ctx?.isPreparedWav ? false : allowWavFallback;
    if (!ctx?.isPreparedWav && meta.ext !== 'wav') {
      const wavBuf = convertToWav16kMono(audioBuffer);
      if (wavBuf && wavBuf.length > 44) {
        console.log(
          `[${label}] Конвертация ${meta.ext} -> WAV 16кГц моно (${Math.round(wavBuf.length / 1024)} КБ) до отправки в Cloud.ru`
        );
        cloudBuffer = wavBuf;
        cloudMeta = { ext: 'wav', mime: 'audio/wav' };
        cloudAllowWavFallback = false;
        ctx?.onPreparedWav?.(wavBuf);
      }
    } else if (meta.ext === 'wav') {
      ctx?.onPreparedWav?.(audioBuffer);
    }

    const {
      config: resolvedConfig,
      catalogModels,
      audioToTextModels,
      endpointsByModel,
    } = await resolveCloudRuConfig(config, false, Boolean(ctx?.fetchImpl));
    const isDirectChatUrl = resolvedConfig.apiUrl.toLowerCase().endsWith('/chat/completions');
    const overrideKey = `${config.apiUrl}::${config.variant}`;

    if (
      (isDirectChatUrl || chatCompletionsFallbackUrls.has(resolvedConfig.apiUrl)) &&
      !transcriptionsFallbackUrls.has(resolvedConfig.apiUrl)
    ) {
      const chatRes = await tryChatAudioFallback(cloudBuffer, cloudMeta, resolvedConfig, label, ctx);
      if (chatRes.ok) {
        if (onRawSegments && chatRes.text) {
          onRawSegments([{ text: chatRes.text }]);
        }
        return chatRes.text;
      }

      // Если пользователь указал /v1/chat/completions, но аудио-модель работает на /v1/audio/transcriptions — переключимся автоматически
      if (isDirectChatUrl && (chatRes.status === 400 || chatRes.status === 404 || chatRes.status === 405 || chatRes.status === 422)) {
        const txUrl = getTranscriptionsUrlFromConfig(resolvedConfig.apiUrl);
        const txRes = await sendMultipartOnce(
          cloudBuffer,
          cloudMeta,
          { ...resolvedConfig, apiUrl: txUrl },
          fieldName,
          { responseFormat: preferVerboseJson ? 'verbose_json' : 'json', includeLanguage: true },
          ctx
        );
        if (txRes.ok) {
          transcriptionsFallbackUrls.add(resolvedConfig.apiUrl);
          const parsedText = parseTranscriptionBody(txRes.rawBody, label);
          if (parsedText) {
            if (onRawSegments) onRawSegments(extractSegmentsFromGigaAmResponse(txRes.rawBody));
            return parsedText;
          }
        }
        const txMinimalRes = !txRes.ok && txRes.status !== 401 && txRes.status !== 403 && txRes.status !== 404 && txRes.status !== 429
          ? await sendMultipartOnce(
              cloudBuffer,
              cloudMeta,
              { ...resolvedConfig, apiUrl: txUrl },
              fieldName,
              { includeLanguage: false },
              ctx
            )
          : txRes;
        if (txMinimalRes.ok) {
          transcriptionsFallbackUrls.add(resolvedConfig.apiUrl);
          if (onRawSegments) onRawSegments(extractSegmentsFromGigaAmResponse(txMinimalRes.rawBody));
          return parseTranscriptionBody(txMinimalRes.rawBody, label);
        }
      }

      const err: any = new Error(
        `${label} /chat/completions HTTP ${chatRes.status}: ${
          chatRes.rawBody.slice(0, 300) || chatRes.statusText
        }`
      );
      err.status = chatRes.status;
      if (isAsrRateLimitError(err, chatRes.status, chatRes.rawBody)) {
        err.rateLimited = true;
        err.asrAttemptsExhausted = true;
      }
      throw err;
    }

    const effectiveTxConfig = isDirectChatUrl
      ? { ...resolvedConfig, apiUrl: getTranscriptionsUrlFromConfig(resolvedConfig.apiUrl) }
      : resolvedConfig;

    const paramProfiles: CloudRuAttemptOpts[] = preferVerboseJson
      ? [
          { responseFormat: 'verbose_json', includeLanguage: true },
          { responseFormat: 'json', includeLanguage: true },
          { includeLanguage: false },
        ]
      : [
          { responseFormat: 'json', includeLanguage: true },
          { responseFormat: 'verbose_json', includeLanguage: true },
          { includeLanguage: false },
        ];

    let lastRes: AsrHttpAttemptResponse | null = null;
    for (const profile of paramProfiles) {
      const res = await sendMultipartOnce(cloudBuffer, cloudMeta, effectiveTxConfig, fieldName, profile, ctx);
      lastRes = res;

      if (res.ok) {
        const parsedText = parseTranscriptionBody(res.rawBody, label);
        if (parsedText) {
          if (onRawSegments) onRawSegments(extractSegmentsFromGigaAmResponse(res.rawBody));
          return parsedText;
        }
        // Если ответ 200 OK с пустым текстом, пробуем следующий профиль или WAV fallback
        continue;
      }

      // Ошибки авторизации, лимитов или отсутствия маршрута (404/405/429) не исправятся сменой полей multipart
      if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 405 || res.status === 429) {
        break;
      }

      // При 400 / 415 / 422 пробуем более простой набор параметров
      if (res.status !== 400 && res.status !== 415 && res.status !== 422 && res.status !== 500) {
        break;
      }
    }

    // Если /v1/audio/transcriptions вернул HTTP 404:
    // Авто-фолбэк на вторую модель при 404 убран (бессмыслен при недоступности всего эндпоинта).
    // 1) Полное тело ответа, x-request-id и развёрнутая диагностика уже залогированы.
    // 2) Выполняем одиночный диагностический GET /v1/models («модель есть → проблема в эндпоинте» / «модель исчезла → проблема в каталоге»).
    // 3) Классифицируем как service_unavailable (внутренняя ошибка провайдера, не ошибка звонка), без немедленных ретраев.
    if (lastRes && lastRes.status === 404) {
      const configuredFallbacks =
        effectiveTxConfig.fallbackModels && effectiveTxConfig.fallbackModels.length > 0
          ? effectiveTxConfig.fallbackModels.filter((m) => m.toLowerCase() !== String(effectiveTxConfig.variant).toLowerCase())
          : getConfiguredAsrFallbackModels(effectiveTxConfig.variant);

      const catalogProbe = await probeCloudRuCatalogOn404(
        effectiveTxConfig.apiUrl,
        effectiveTxConfig.apiKey,
        effectiveTxConfig.variant,
        configuredFallbacks,
        ctx?.fetchImpl
      );

      const effectiveRequestId = lastRes.requestId;
      const endpointPath = lastRes.endpointPath || extractEndpointPath(effectiveTxConfig.apiUrl);
      const reqIdSuffix = effectiveRequestId ? ` [x-request-id: ${effectiveRequestId}]` : '';
      const err: any = new Error(
        `${label}: сервис транскрибации ${endpointPath} временно недоступен (HTTP 404, service_unavailable, модель ${effectiveTxConfig.variant})${reqIdSuffix}: ${
          (lastRes.rawBody || '').slice(0, 300) || lastRes.statusText
        }`
      );
      err.status = 404;
      err.asrFailReason = 'service_unavailable' satisfies AsrFailReason;
      err.asrModel = effectiveTxConfig.variant;
      err.asrFallbackModelsTried = [];
      err.asrRequestId = effectiveRequestId;
      err.asrEndpointPath = endpointPath;
      err.asrCatalogVerdict = catalogProbe.verdict;
      err.asrCatalogSummary = catalogProbe.diagnosticSummary;
      err.asrCatalogCheck = catalogProbe;
      err.http404Body = lastRes.rawBody;
      err.noRetry = true;
      err.asrAttemptsExhausted = true;
      throw err;
    }

    // Если /v1/audio/transcriptions вернул HTTP 405 (Method Not Allowed):
    // 1) Пробуем альтернативные audio-to-text модели из каталога,
    // 2) Пробуем /v1/chat/completions если модель поддерживает chat-эндпоинт.
    if (lastRes && lastRes.status === 405) {
      const configuredFallbacks =
        config.fallbackModels && config.fallbackModels.length > 0
          ? config.fallbackModels
          : getConfiguredAsrFallbackModels(effectiveTxConfig.variant);
      const altModels = getAlternateCloudRuAudioModels(
        effectiveTxConfig.variant,
        catalogModels,
        audioToTextModels,
        configuredFallbacks
      );
      for (const altModel of altModels) {
        console.warn(
          `[${label}] Модель ${effectiveTxConfig.variant} вернула HTTP ${lastRes.status} на ${effectiveTxConfig.apiUrl}, пробуем резервную аудио-модель ${altModel}...`
        );
        const altCfg: GigaAmConfig = { ...effectiveTxConfig, variant: altModel };
        for (const profile of [{ responseFormat: 'json', includeLanguage: true }, { includeLanguage: false }] as CloudRuAttemptOpts[]) {
          const altRes = await sendMultipartOnce(cloudBuffer, cloudMeta, altCfg, fieldName, profile, ctx);
          if (altRes.ok) {
            const parsedText = parseTranscriptionBody(altRes.rawBody, label);
            if (parsedText) {
              cloudRuWorkingModelOverrides.set(overrideKey, {
                model: altModel,
                expiresAt: Date.now() + 10 * 60 * 1000,
              });
              return parsedText;
            }
          }
          if (altRes.status === 401 || altRes.status === 403 || altRes.status === 404 || altRes.status === 405 || altRes.status === 429) {
            break;
          }
        }
      }

      const modelPaths = endpointsByModel[effectiveTxConfig.variant] || [];
      const supportsChat = modelPaths.length === 0 || modelPaths.some((p) => p.includes('/chat/completions'));
      if (supportsChat) {
        console.warn(
          `[${label}] ${effectiveTxConfig.apiUrl} вернул HTTP ${lastRes.status}, переключение на ${getChatCompletionsUrlFromConfig(effectiveTxConfig.apiUrl)}...`
        );
        const chatRes = await tryChatAudioFallback(cloudBuffer, cloudMeta, effectiveTxConfig, label, ctx);
        if (chatRes.ok) {
          chatCompletionsFallbackUrls.add(resolvedConfig.apiUrl);
          return chatRes.text;
        }
        const err: any = new Error(
          `${label}: ${effectiveTxConfig.apiUrl} вернул HTTP ${lastRes.status} (${lastRes.statusText}), а ${getChatCompletionsUrlFromConfig(effectiveTxConfig.apiUrl)} вернул HTTP ${chatRes.status}: ${
            chatRes.rawBody.slice(0, 220) || chatRes.statusText
          }`
        );
        err.status = chatRes.status;
        if (chatRes.status === 404) {
          err.asrFailReason = 'service_unavailable' satisfies AsrFailReason;
          err.asrModel = effectiveTxConfig.variant;
          err.noRetry = true;
          err.asrAttemptsExhausted = true;
        } else if (isAsrRateLimitError(err, chatRes.status, chatRes.rawBody)) {
          err.rateLimited = true;
          err.asrAttemptsExhausted = true;
        }
        throw err;
      }

      const err: any = new Error(
        `${label}: ${effectiveTxConfig.apiUrl} (модель ${effectiveTxConfig.variant}) вернул HTTP ${lastRes.status}: ${
          (lastRes.rawBody || '').slice(0, 220) || lastRes.statusText
        }`
      );
      err.status = lastRes.status;
      throw err;
    }

    // Если запрос прошёл (200 OK), но текст пустой — не считаем это HTTP-ошибкой
    if (lastRes?.ok) {
      if (cloudAllowWavFallback && cloudMeta.ext !== 'wav') {
        const wavBuf = convertToWav16kMono(cloudBuffer);
        if (wavBuf && wavBuf.length > 44) {
          console.log(`[${label}] Повторная отправка в универсальном формате WAV 16кГц моно...`);
          ctx?.onPreparedWav?.(wavBuf);
          return postAudioToGigaAm(wavBuf, 'audio/wav', config, fieldName, false, preferVerboseJson, onRawSegments, ctx);
        }
      }
      return '';
    }

    // Если шлюз отклонил нестандартный WAV (например GSM WAV или не 16кГц) — перекодируем в WAV 16kHz PCM
    if (
      cloudAllowWavFallback &&
      lastRes &&
      (lastRes.status === 400 || lastRes.status === 415 || lastRes.status === 422 || lastRes.status === 500)
    ) {
      const wavBuf = convertToWav16kMono(cloudBuffer);
      if (wavBuf && wavBuf.length > 44) {
        console.warn(
          `[${label}] Ответ HTTP ${lastRes.status} для ${cloudMeta.ext}. Конвертация в стандартный WAV 16кГц моно и повтор...`
        );
        ctx?.onPreparedWav?.(wavBuf);
        return postAudioToGigaAm(wavBuf, 'audio/wav', config, fieldName, false, preferVerboseJson, onRawSegments, ctx);
      }
    }

    const err: any = new Error(
      `${label} HTTP ${lastRes?.status || 500}: ${
        (lastRes?.rawBody || '').slice(0, 300) || lastRes?.statusText || 'Неизвестная ошибка'
      }`
    );
    err.status = lastRes?.status || 500;
    if (isAsrRateLimitError(err, lastRes?.status, lastRes?.rawBody)) {
      err.rateLimited = true;
      err.asrAttemptsExhausted = true;
    } else if (lastRes?.status === 504 || lastRes?.status === 502 || lastRes?.status === 503) {
      err.asrAttemptsExhausted = true;
    }
    throw err;
  }

  // Self-hosted GigaAM v3
  const res = await sendMultipartOnce(audioBuffer, meta, config, fieldName, undefined, ctx);

  if (res.status === 422 && fieldName === 'file') {
    return postAudioToGigaAm(audioBuffer, mimeType, config, 'audio', allowWavFallback, preferVerboseJson, onRawSegments, ctx);
  }

  if (res.status === 415) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) {
      headers['Authorization'] = config.apiKey.startsWith('Bearer ') ? config.apiKey : `Bearer ${config.apiKey}`;
    }
    const jsonPayload = {
      audio_base64: audioBuffer.toString('base64'),
      model: `gigaam-v3-${config.variant}`,
      variant: config.variant,
      language: 'ru',
      mime_type: meta.mime,
    };
    const jsonRes = await withSttRetry(
      () => axios.post(config.apiUrl, jsonPayload, { headers, timeout: 120000 }),
      {
        providerName: label,
        operationName: 'json-fallback',
        maxAttempts: 4,
        baseDelayMs: 1000,
        maxDelayMs: 12000,
        sleepFn: ctx?.sleepFn,
        onAttempt: () => {
          if (ctx) ctx.attempts++;
        },
        wrapAttempt: (fn) => runWithAsrSemaphore(fn, { sleepFn: ctx?.sleepFn }),
        getDelayMs: (attempt, err, defaultDelayMs, retryAfterMs) => {
          const calc = computeAsrErrorClassBackoff(attempt, err, defaultDelayMs, retryAfterMs);
          if (calc.isRateLimit) {
            pauseAsrQueue(calc.delayMs, `HTTP 429 json-fallback попытка ${attempt}`);
          }
          return calc.delayMs;
        },
      }
    );
    return extractTextFromGigaAmResponse(jsonRes.data);
  }

  if (!res.ok) {
    if (res.status === 404) {
      const effectiveRequestId = res.requestId;
      const endpointPath = res.endpointPath || extractEndpointPath(config.apiUrl);
      const err: any = new Error(
        `${label}: сервис транскрибации ${endpointPath} временно недоступен (HTTP 404, service_unavailable, модель ${config.variant}): ${res.rawBody.slice(0, 300) || res.statusText}`
      );
      err.status = 404;
      err.asrFailReason = 'service_unavailable' satisfies AsrFailReason;
      err.asrModel = config.variant;
      err.asrFallbackModelsTried = [];
      err.asrRequestId = effectiveRequestId;
      err.asrEndpointPath = endpointPath;
      err.http404Body = res.rawBody;
      err.noRetry = true;
      err.asrAttemptsExhausted = true;
      throw err;
    }
    if (allowWavFallback && !ctx?.isPreparedWav && meta.ext !== 'wav' && (res.status === 400 || res.status === 422 || res.status === 500)) {
      const wavBuf = convertToWav16kMono(audioBuffer);
      if (wavBuf && wavBuf.length > 44) {
        ctx?.onPreparedWav?.(wavBuf);
        return postAudioToGigaAm(wavBuf, 'audio/wav', config, fieldName, false, preferVerboseJson, onRawSegments, ctx);
      }
    }
    const err: any = new Error(
      `${label} HTTP ${res.status}: ${res.rawBody.slice(0, 300) || res.statusText}`
    );
    err.status = res.status;
    if (isAsrRateLimitError(err, res.status, res.rawBody)) {
      err.rateLimited = true;
      err.asrAttemptsExhausted = true;
    } else if (res.status === 504 || res.status === 502 || res.status === 503) {
      err.asrAttemptsExhausted = true;
    }
    throw err;
  }

  return parseTranscriptionBody(res.rawBody, label);
}

async function transcribeMonoAudioSegmentsWithGigaAm(
  audioBuffer: Buffer,
  mimeType: string,
  cfg: GigaAmConfig,
  label: string,
  preferVerboseJson: boolean = false,
  ctx?: AsrRequestContext
): Promise<TimedUtterance[]> {
  const duration = getAudioDuration(audioBuffer);
  let directError: Error | null = null;

  try {
    let capturedSegments: TimedUtterance[] = [];
    const directText = await postAudioToGigaAm(
      audioBuffer,
      mimeType,
      cfg,
      'file',
      !ctx?.isPreparedWav,
      preferVerboseJson,
      (segs) => {
        capturedSegments = segs;
      },
      ctx
    );
    if (capturedSegments.length > 0) {
      return capturedSegments;
    }
    if (directText && directText.trim()) {
      return [{ text: directText.trim(), start: 0 }];
    }
  } catch (err: any) {
    directError = err;
    const isAuthOrRateLimitError =
      err.status === 401 ||
      err.status === 403 ||
      err.status === 404 ||
      err.status === 429 ||
      Boolean(err.rateLimited) ||
      Boolean(err.noRetry) ||
      err.asrFailReason === 'service_unavailable' ||
      err.asrFailReason === 'model_not_found';
    if (isAuthOrRateLimitError) {
      throw err;
    }
    const canTryChunking =
      duration >= 20 ||
      (duration === 0 && audioBuffer.length > 256 * 1024) ||
      err.status === 400 ||
      err.status === 413 ||
      err.status === 415 ||
      err.status === 422 ||
      err.status === 500 ||
      /too long|duration|length|size|limit|timeout/i.test(err.message);
    if (!canTryChunking) {
      throw err;
    }
    console.warn(`[${label}] Прямая отправка не принята (${err.message}), переключение на последовательную сегментацию WAV 16кГц...`);
  }

  const shouldChunk = duration >= 20 || (duration === 0 && audioBuffer.length > 256 * 1024) || Boolean(directError);
  if (shouldChunk) {
    let chunks = splitAudioIntoWavChunks(audioBuffer, 22);
    let chunkMime = 'audio/wav';
    if (chunks.length === 0) {
      chunks = splitAudioIntoOpusChunks(audioBuffer, 22);
      chunkMime = 'audio/ogg';
    }

    if (chunks.length > 0) {
      const allSegments: TimedUtterance[] = [];
      let lastChunkErr: Error | null = null;
      let offsetSec = 0;
      // Строго последовательная отправка сегментов: следующий запускается ТОЛЬКО после завершения предыдущего
      for (let i = 0; i < chunks.length; i++) {
        const chunkDur = getAudioDuration(chunks[i]) || 22;
        try {
          let captured: TimedUtterance[] = [];
          const chunkCtx: AsrRequestContext | undefined = ctx
            ? {
                ...ctx,
                isPreparedWav: chunkMime === 'audio/wav',
                // не перетираем целый подготовленный WAV отдельным фрагментом
                onPreparedWav: undefined,
              }
            : undefined;
          const text = await postAudioToGigaAm(
            chunks[i],
            chunkMime,
            cfg,
            'file',
            chunkMime !== 'audio/wav',
            preferVerboseJson,
            (segs) => {
              captured = segs.map((s) => ({
                ...s,
                start: typeof s.start === 'number' ? s.start + offsetSec : offsetSec,
                end: typeof s.end === 'number' ? s.end + offsetSec : undefined,
              }));
            },
            chunkCtx
          );
          if (ctx && chunkCtx) {
            ctx.attempts = chunkCtx.attempts;
          }
          if (captured.length > 0) {
            allSegments.push(...captured);
          } else if (text && text.trim()) {
            allSegments.push({ text: text.trim(), start: offsetSec });
          }
        } catch (chunkErr: any) {
          lastChunkErr = chunkErr;
          console.warn(`[${label}] Ошибка сегмента ${i + 1}/${chunks.length}:`, chunkErr.message);
          if (
            chunkErr.status === 429 ||
            chunkErr.rateLimited ||
            chunkErr.status === 401 ||
            chunkErr.status === 403 ||
            chunkErr.status === 404 ||
            chunkErr.noRetry ||
            chunkErr.asrFailReason === 'service_unavailable' ||
            chunkErr.asrFailReason === 'model_not_found'
          ) {
            throw chunkErr;
          }
        }
        offsetSec += chunkDur;
      }
      if (allSegments.length > 0) {
        return allSegments;
      }
      if (lastChunkErr) {
        throw lastChunkErr;
      }
    }
  }

  if (directError) {
    throw directError;
  }

  return [];
}

export async function transcribeWithGigaAm(
  audioBuffer: Buffer,
  mimeType: string = 'audio/mpeg',
  variantOverride?: GigaamModelVariant,
  options?: GigaAmTranscribeOptions
): Promise<string> {
  const cfg = getGigaAmConfig(undefined, undefined, variantOverride);
  if (!cfg.apiUrl) {
    throw new Error(
      'GigaASR / GigaAM v3 не настроен: укажите URL эндпоинта (например Cloud.ru Evolution) в настройках системы'
    );
  }
  if (cfg.apiUrl.includes('cloud.ru') && !cfg.apiKey) {
    throw new Error(
      'GigaASR (Cloud.ru Evolution): укажите API-ключ сервисного аккаунта Cloud.ru (GIGAAM_API_KEY) в настройках системы'
    );
  }

  const ctx: AsrRequestContext = {
    callId: options?.callId,
    isPreparedWav: Boolean(options?.isPreparedWav),
    onPreparedWav: options?.onPreparedWav,
    attempts: 0,
    fetchImpl: options?.fetchImpl,
    sleepFn: options?.sleepFn,
  };

  const duration = getAudioDuration(audioBuffer);
  const label = cfg.isCloudRu ? 'GigaASR Cloud.ru' : 'GigaAM v3';
  const channels = ctx.isPreparedWav ? 1 : probeAudioChannels(audioBuffer);
  console.log(
    `[${label}] Отправка аудио${ctx.callId ? ` (звонок ${ctx.callId})` : ''} (${Math.round(audioBuffer.length / 1024)} КБ, ${duration.toFixed(1)} сек., каналов: ${channels}, WAV готов: ${ctx.isPreparedWav ? 'да' : 'нет'}, модель: ${cfg.variant}, лимит ASR_MAX_CONCURRENT=${getAsrMaxConcurrent()}) -> ${cfg.apiUrl}`
  );

  try {
    // П. 2: Если запись стерео (Мегафон) — разделяем на два моно-канала, распознаём СТРОГО ПОСЛЕДОВАТЕЛЬНО (не параллельно) через общий семафор
    if (channels >= 2) {
      const split = splitStereoToMonoWavChannels(audioBuffer);
      if (split && !split.isDualMono) {
        console.log(`[${label}] Истинное стерео: последовательное распознавание 2 моно-каналов (CH0 → CH1) через общий семафор ASR...`);
        const ch0Segs = await transcribeMonoAudioSegmentsWithGigaAm(split.ch0, 'audio/wav', cfg, `${label} [CH0]`, true, ctx);
        const ch1Segs = await transcribeMonoAudioSegmentsWithGigaAm(split.ch1, 'audio/wav', cfg, `${label} [CH1]`, true, ctx);
        const merged = mergeDualChannelTranscripts(ch0Segs, ch1Segs);
        if (merged.trim()) {
          return merged;
        }
      } else if (split?.isDualMono) {
        console.log(`[${label}] Обнаружен dual-mono (одинаковые каналы) — используем стандартную моно-схему с разметкой ролей по смыслу.`);
      }
    }

    // Моно-режим (или dual-mono / заранее подготовленный WAV): стандартный пайплайн, роли разметит модель по смыслу
    const segs = await transcribeMonoAudioSegmentsWithGigaAm(audioBuffer, mimeType, cfg, label, false, ctx);
    const joined = segs.map((s) => s.text).filter(Boolean).join('\n').trim();
    return joined ? fixDuplicatedTranscript(refineTranscriptRoles(joined)) : '';
  } finally {
    options?.onAttemptCount?.(Math.max(1, ctx.attempts));
  }
}

export async function transcribeWithGigaAmRetry(
  audioBuffer: Buffer,
  mimeType: string = 'audio/mpeg',
  variantOverride?: GigaamModelVariant,
  options?: GigaAmTranscribeOptions
): Promise<string> {
  let totalAttempts = 0;
  try {
    const text = await withSttRetry(
      () =>
        transcribeWithGigaAm(audioBuffer, mimeType, variantOverride, {
          ...options,
          onAttemptCount: (n) => {
            totalAttempts += n;
            options?.onAttemptCount?.(totalAttempts);
          },
        }),
      {
        providerName: 'GigaASR / GigaAM v3',
        operationName: 'transcribe',
        maxAttempts: MAX_RETRIES,
        baseDelayMs: BASE_DELAY_MS,
        maxDelayMs: 16000,
        sleepFn: options?.sleepFn,
        shouldRetry: (err: any) => {
          // HTTP 404 (service_unavailable / model_not_found) не тратит немедленные ретраи — звонок уходит в плавающий планировщик 30м → 1ч → 3ч.
          if (
            err?.noRetry ||
            err?.status === 404 ||
            err?.asrFailReason === 'service_unavailable' ||
            err?.asrFailReason === 'model_not_found'
          ) {
            return false;
          }
          // Если внутренний sendMultipartOnce уже исчерпал все попытки по 429/504 с глобальным бэкоффом,
          // не запускаем вложенный цикл повторных штурмов эндпоинта.
          if (err?.asrAttemptsExhausted || err?.rateLimited) {
            return false;
          }
          return isTransientSttError(err);
        },
        getDelayMs: (attempt, err, defaultDelayMs, retryAfterMs) => {
          const calc = computeAsrErrorClassBackoff(attempt, err, defaultDelayMs, retryAfterMs);
          if (calc.isRateLimit) {
            pauseAsrQueue(calc.delayMs, `внешний ретрай HTTP 429 попытка ${attempt}`);
          }
          return calc.delayMs;
        },
      }
    );
    if (options?.emitIncidentSummary !== false) {
      console.log(
        formatGigaAsrIncidentSummary(options?.callId, 'completed', {
          attempts: Math.max(1, totalAttempts),
        })
      );
    }
    return text;
  } catch (error: any) {
    const detail = formatSttNetworkError(error);
    const resolvedStatus =
      typeof error?.status === 'number'
        ? error.status
        : typeof error?.response?.status === 'number'
        ? error.response.status
        : undefined;
    const failReason = classifyAsrFailReason(error, resolvedStatus, error?.http404Body);
    const failedModel =
      typeof error?.asrModel === 'string' && error.asrModel.trim()
        ? error.asrModel.trim()
        : getGigaAmConfig(undefined, undefined, variantOverride).variant;
    const isHttp404 =
      failReason === 'service_unavailable' ||
      failReason === 'model_not_found' ||
      resolvedStatus === 404;

    const attempts = Math.max(
      1,
      totalAttempts || (typeof error?.sttAttempts === 'number' ? error.sttAttempts : isHttp404 ? 1 : MAX_RETRIES)
    );
    options?.onAttemptCount?.(attempts);
    if (options?.emitIncidentSummary === true) {
      console.error(
        formatGigaAsrIncidentSummary(options?.callId, 'failed', {
          attempts,
          reason: isHttp404 ? `${failReason} (${failedModel}): ${detail}` : detail,
        })
      );
    } else if (isHttp404) {
      console.error(`[GigaASR / GigaAM v3] Сервис транскрибации недоступен (HTTP 404, ${failReason}, модель ${failedModel}, без ретраев):`, detail);
    } else {
      console.error(`[GigaASR / GigaAM v3] Транскрибация завершилась ошибкой (попыток: ${attempts}):`, detail);
    }
    const wrapped: any = new Error(
      isHttp404
        ? `GigaASR / GigaAM v3: сервис транскрибации недоступен (HTTP 404, ${failReason}, модель ${failedModel}): ${detail}`
        : attempts > 1
        ? `GigaASR / GigaAM v3 недоступен после ${attempts} попыток: ${detail}`
        : `GigaASR / GigaAM v3 недоступен: ${detail}`
    );
    if (resolvedStatus !== undefined) wrapped.status = resolvedStatus;
    if (error?.code) wrapped.code = error.code;
    wrapped.sttAttempts = attempts;
    wrapped.asrFailReason = failReason;
    wrapped.asrModel = failedModel;
    if (Array.isArray(error?.asrFallbackModelsTried)) {
      wrapped.asrFallbackModelsTried = error.asrFallbackModelsTried;
    }
    if (typeof error?.asrRequestId === 'string' && error.asrRequestId.trim()) {
      wrapped.asrRequestId = error.asrRequestId.trim();
    }
    if (typeof error?.asrEndpointPath === 'string' && error.asrEndpointPath.trim()) {
      wrapped.asrEndpointPath = error.asrEndpointPath.trim();
    }
    if (typeof error?.asrCatalogVerdict === 'string' && error.asrCatalogVerdict.trim()) {
      wrapped.asrCatalogVerdict = error.asrCatalogVerdict.trim();
    }
    if (typeof error?.asrCatalogSummary === 'string' && error.asrCatalogSummary.trim()) {
      wrapped.asrCatalogSummary = error.asrCatalogSummary.trim();
    }
    if (error?.asrCatalogCheck) {
      wrapped.asrCatalogCheck = error.asrCatalogCheck;
    }
    if (typeof error?.http404Body === 'string') {
      wrapped.http404Body = error.http404Body;
    }
    wrapped.noRetry = Boolean(error?.noRetry || isHttp404);
    wrapped.rateLimited = Boolean(error?.rateLimited || isAsrRateLimitError(error));
    wrapped.cause = error;
    throw wrapped;
  }
}

/**
 * Генерирует валидный WAV-файл тишины заданной длительности (16 кГц моно 16-bit PCM)
 * для фоновой проверки доступности эндпоинта ASR (по умолчанию 1 секунда = 32044 байта).
 */
export function createSilentWavBuffer(durationSec: number = 1.0): Buffer {
  const safeDuration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 1.0;
  const sampleRate = 16000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = Math.max(1, Math.floor(sampleRate * safeDuration));
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

/**
 * Генерирует минимальный валидный WAV-файл (0.2 сек тишины, 16 кГц моно 16-bit PCM)
 * для реальной проверки эндпоинта транскрибации.
 */
function createSilentWavProbeBuffer(): Buffer {
  return createSilentWavBuffer(0.2);
}

/**
 * Фоновая ежечасная проверка доступности ASR одним дешёвым POST с 1-секундным silence WAV.
 * Логирует результат: «ASR check: OK» / «ASR check: 404 (x-request-id: …)» и фиксирует x-request-id.
 */
export async function runAsrHealthCheckProbe(options?: {
  apiUrlOverride?: string;
  apiKeyOverride?: string;
  variantOverride?: GigaamModelVariant;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<AsrHealthCheckResult> {
  const startedAt = Date.now();
  const cfg = getGigaAmConfig(options?.apiUrlOverride, options?.apiKeyOverride, options?.variantOverride);
  const endpointPath = extractEndpointPath(cfg.apiUrl || CLOUDRU_GIGAASR_TRANSCRIPTIONS_URL);
  const modelParam = getModelParamForRequest(cfg);
  const silentWav = createSilentWavBuffer(1.0);

  if (!cfg.apiUrl || (cfg.apiUrl.includes('cloud.ru') && !cfg.apiKey)) {
    const logLine = 'ASR check: skipped (ASR не настроен)';
    return {
      ok: false,
      status: 0,
      endpointPath,
      model: modelParam,
      logLine,
      error: 'ASR не настроен',
      durationMs: Date.now() - startedAt,
      audioBytes: silentWav.length,
    };
  }

  const headers: Record<string, string> = {};
  if (cfg.apiKey) {
    headers['Authorization'] = cfg.apiKey.startsWith('Bearer ') ? cfg.apiKey : `Bearer ${cfg.apiKey}`;
  }

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(silentWav)], { type: 'audio/wav' }), 'silence-1s.wav');
  form.append('model', modelParam);
  form.append('language', 'ru');
  if (cfg.isCloudRu) {
    form.append('response_format', 'json');
  } else {
    form.append('variant', cfg.variant);
  }

  const doFetch = options?.fetchImpl ?? fetch;
  const timeoutMs = options?.timeoutMs ?? 15000;

  try {
    const res = await doFetch(cfg.apiUrl, {
      method: 'POST',
      headers,
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const rawBody = await res.text().catch(() => '');
    const requestId = extractRequestIdFromHeaders(res.headers);
    const reqIdLogLine = formatAsrResponseRequestIdLog({
      method: 'POST',
      endpointPath,
      status: res.status,
      model: modelParam,
      requestId,
    });
    if (res.ok) {
      console.log(reqIdLogLine);
      const logLine = 'ASR check: OK';
      console.log(logLine);
      return {
        ok: true,
        status: res.status,
        endpointPath,
        model: modelParam,
        requestId,
        logLine,
        durationMs: Date.now() - startedAt,
        audioBytes: silentWav.length,
      };
    }

    console.warn(reqIdLogLine);
    if (res.status === 404) {
      console.error(`[GigaASR] HTTP 404: ${rawBody || res.statusText || '(empty body)'}`);
      const logLine = `ASR check: 404 (x-request-id: ${requestId || 'none'})`;
      console.warn(logLine);
      return {
        ok: false,
        status: 404,
        endpointPath,
        model: modelParam,
        requestId,
        logLine,
        error: rawBody.slice(0, 300) || res.statusText,
        durationMs: Date.now() - startedAt,
        audioBytes: silentWav.length,
      };
    }

    const logLine = `ASR check: HTTP ${res.status} (x-request-id: ${requestId || 'none'})`;
    console.warn(logLine);
    return {
      ok: false,
      status: res.status,
      endpointPath,
      model: modelParam,
      requestId,
      logLine,
      error: rawBody.slice(0, 300) || res.statusText,
      durationMs: Date.now() - startedAt,
      audioBytes: silentWav.length,
    };
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    const logLine = `ASR check: ERROR (${errMsg})`;
    console.warn(logLine);
    return {
      ok: false,
      status: 0,
      endpointPath,
      model: modelParam,
      logLine,
      error: errMsg,
      durationMs: Date.now() - startedAt,
      audioBytes: silentWav.length,
    };
  }
}

export async function testGigaAmConnection(
  apiUrlOverride?: string,
  apiKeyOverride?: string,
  variantOverride?: GigaamModelVariant
): Promise<{ success: boolean; message: string }> {
  const cfg = getGigaAmConfig(apiUrlOverride, apiKeyOverride, variantOverride);
  if (!cfg.apiUrl) {
    throw new Error('Не указан URL эндпоинта GigaASR / GigaAM v3 (GIGAAM_API_URL)');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(cfg.apiUrl);
  } catch {
    throw new Error(`Некорректный URL эндпоинта GigaASR / GigaAM v3: "${cfg.apiUrl}"`);
  }

  if (cfg.apiUrl.includes('cloud.ru') && !cfg.apiKey) {
    throw new Error('Для Cloud.ru Evolution GigaASR необходимо указать API-ключ сервисного аккаунта');
  }

  const headers: Record<string, string> = {};
  if (cfg.apiKey) {
    headers['Authorization'] = cfg.apiKey.startsWith('Bearer ') ? cfg.apiKey : `Bearer ${cfg.apiKey}`;
  }

  // 1. Для Cloud.ru Evolution / OpenAI-compatible API проверяем /v1/models и тестовую транскрибацию
  if (cfg.isCloudRu) {
    let catalogModels: string[] = [];
    let audioModelsList: string[] = [];
    let endpointsByModel: Record<string, string[]> = {};
    let ttsOnlyModels: string[] = [];
    try {
      const cat = await fetchCloudRuCatalogModels(parsedUrl.origin, cfg.apiKey, true);
      if (cat.status === 401 || cat.status === 403) {
        throw new Error(`Ошибка авторизации Cloud.ru Evolution (${cat.status}): проверьте API-ключ`);
      }
      catalogModels = cat.models;
      audioModelsList = cat.audioToTextModels.length > 0
        ? cat.audioToTextModels
        : catalogModels.filter((id) => /asr|whisper|gigaasr/i.test(id));
      endpointsByModel = cat.endpointsByModel;
      ttsOnlyModels = cat.ttsOnlyModels;
    } catch (err: any) {
      if (/авторизац/i.test(err.message)) throw err;
    }

    let resolvedModelId = pickCloudRuModelFromCatalog(cfg.variant, catalogModels);
    let saluteRedirectNote = '';
    if (ttsOnlyModels.some((id) => id.toLowerCase() === resolvedModelId.toLowerCase()) && audioModelsList.length > 0) {
      const nextStt = audioModelsList.find((id) => id.toLowerCase().includes('gigaasr')) || audioModelsList[0];
      saluteRedirectNote = ` (модель ${resolvedModelId} — это TTS, для распознавания речи используется ${nextStt})`;
      resolvedModelId = nextStt as GigaamModelVariant;
    }
    const resolvedCfg: GigaAmConfig = { ...cfg, variant: resolvedModelId };
    const hasSelectedOrGigaAsr =
      catalogModels.some((id) => id.toLowerCase() === resolvedModelId.toLowerCase()) ||
      audioModelsList.some((id) => id.toLowerCase().includes('gigaasr'));

    const probeWav = createSilentWavProbeBuffer();
    const isDirectChatUrl = resolvedCfg.apiUrl.toLowerCase().endsWith('/chat/completions');

    // Реальная проверка инференса эндпоинта транскрибации коротким тихим WAV
    let transcriptionsStatus: number | null = null;
    let transcriptionsErrBody = '';

    if (!isDirectChatUrl) {
      const probeRes = await sendMultipartOnce(
        probeWav,
        { ext: 'wav', mime: 'audio/wav' },
        resolvedCfg,
        'file',
        { responseFormat: 'json', includeLanguage: true }
      );
      if (probeRes.status === 401 || probeRes.status === 403) {
        throw new Error(`Ошибка авторизации при обращении к ${resolvedCfg.apiUrl} (HTTP ${probeRes.status})`);
      }
      if (probeRes.ok) {
        return {
          success: true,
          message: `Подключение к Cloud.ru Evolution установлено! Модель ${resolvedModelId} доступна и /v1/audio/transcriptions отвечает.${saluteRedirectNote}`,
        };
      }

      if (probeRes.status !== 404 && probeRes.status !== 405) {
        const minimalProbe = await sendMultipartOnce(
          probeWav,
          { ext: 'wav', mime: 'audio/wav' },
          resolvedCfg,
          'file',
          { includeLanguage: false }
        );
        if (minimalProbe.ok) {
          return {
            success: true,
            message: `Подключение к Cloud.ru Evolution установлено! Модель ${resolvedModelId} готова к транскрибации.${saluteRedirectNote}`,
          };
        }
        transcriptionsStatus = minimalProbe.status;
        transcriptionsErrBody = minimalProbe.rawBody.slice(0, 180) || minimalProbe.statusText;
      } else {
        transcriptionsStatus = probeRes.status;
        transcriptionsErrBody = probeRes.rawBody.slice(0, 180) || probeRes.statusText;
      }
    }

    // Если выбранная модель вернула 404/405 на /v1/audio/transcriptions — пробуем ASR_MODEL_FALLBACK и альтернативные audio-to-text модели каталога
    if (!isDirectChatUrl && (transcriptionsStatus === 404 || transcriptionsStatus === 405)) {
      const altModels = getAlternateCloudRuAudioModels(
        resolvedModelId,
        catalogModels,
        audioModelsList,
        resolvedCfg.fallbackModels || []
      );
      for (const altModel of altModels) {
        const altCfg: GigaAmConfig = { ...resolvedCfg, variant: altModel };
        const altProbe = await sendMultipartOnce(
          probeWav,
          { ext: 'wav', mime: 'audio/wav' },
          altCfg,
          'file',
          { responseFormat: 'json', includeLanguage: true }
        );
        if (altProbe.ok) {
          cloudRuWorkingModelOverrides.set(`${cfg.apiUrl}::${cfg.variant}`, {
            model: altModel,
            expiresAt: Date.now() + 10 * 60 * 1000,
          });
          return {
            success: true,
            message: `Подключение установлено! Модель ${resolvedModelId} вернула HTTP ${transcriptionsStatus}, активировано автоматическое переключение на аудио-модель ${altModel}.`,
          };
        }
      }
    }

    // Если /v1/audio/transcriptions вернул 404/405 (для моделей с поддержкой chat) или указан /v1/chat/completions
    const modelPaths = endpointsByModel[resolvedModelId] || [];
    const modelSupportsChat = isDirectChatUrl || modelPaths.length === 0 || modelPaths.some((p) => p.includes('/chat/completions'));
    if (isDirectChatUrl || ((transcriptionsStatus === 404 || transcriptionsStatus === 405) && modelSupportsChat)) {
      const chatProbe = await tryChatAudioFallback(
        probeWav,
        { ext: 'wav', mime: 'audio/wav' },
        resolvedCfg,
        'GigaASR Probe'
      );
      if (chatProbe.ok) {
        if (!isDirectChatUrl) {
          chatCompletionsFallbackUrls.add(resolvedCfg.apiUrl);
        }
        return {
          success: true,
          message: `Подключение к Cloud.ru Evolution установлено! Модель ${resolvedModelId} работает через /v1/chat/completions (аудио-режим).`,
        };
      }

      // Если пользователь явно указал /v1/chat/completions, но он не принял аудио — проверим также /v1/audio/transcriptions
      if (isDirectChatUrl && transcriptionsStatus === null) {
        const txUrl = getTranscriptionsUrlFromConfig(resolvedCfg.apiUrl);
        const txCfg: GigaAmConfig = { ...resolvedCfg, apiUrl: txUrl };
        let txProbe = await sendMultipartOnce(
          probeWav,
          { ext: 'wav', mime: 'audio/wav' },
          txCfg,
          'file',
          { responseFormat: 'json', includeLanguage: true }
        );
        if (!txProbe.ok && txProbe.status !== 401 && txProbe.status !== 403 && txProbe.status !== 404) {
          txProbe = await sendMultipartOnce(
            probeWav,
            { ext: 'wav', mime: 'audio/wav' },
            txCfg,
            'file',
            { includeLanguage: false }
          );
        }
        if (txProbe.ok) {
          transcriptionsFallbackUrls.add(resolvedCfg.apiUrl);
          return {
            success: true,
            message: `Подключение установлено! Модель ${resolvedModelId} работает через ${txUrl} (рекомендуется указать этот URL вместо /v1/chat/completions).`,
          };
        }
        transcriptionsStatus = txProbe.status;
        transcriptionsErrBody = txProbe.rawBody.slice(0, 180) || txProbe.statusText;
      }

      const audioHint = audioModelsList.length > 0
        ? ` Audio-to-Text модели в каталоге: ${audioModelsList.join(', ')}.`
        : '';
      const txUrlLabel = isDirectChatUrl ? getTranscriptionsUrlFromConfig(resolvedCfg.apiUrl) : resolvedCfg.apiUrl;
      const txPart = transcriptionsStatus
        ? `${txUrlLabel} -> HTTP ${transcriptionsStatus} (${transcriptionsErrBody}); `
        : '';
      const prefix = hasSelectedOrGigaAsr
        ? `Модель ${resolvedModelId} видна в /v1/models`
        : `Каталог /v1/models проверен (запрошена ${resolvedModelId})`;
      throw new Error(
        `${prefix}, но транскрибация недоступна: ${txPart}${getChatCompletionsUrlFromConfig(resolvedCfg.apiUrl)} -> HTTP ${chatProbe.status} (${
          chatProbe.rawBody.slice(0, 180) || chatProbe.statusText
        }).${audioHint}`
      );
    }

    const audioHint = audioModelsList.length > 0
      ? ` Audio-to-Text модели в каталоге: ${audioModelsList.join(', ')}.`
      : '';
    throw new Error(
      `Модель ${resolvedModelId} видна в /v1/models, но эндпоинт транскрибации ${resolvedCfg.apiUrl} вернул HTTP ${transcriptionsStatus}: ${transcriptionsErrBody}.${audioHint}`
    );
  }

  // 2. Попытка проверить /health на том же хосте (self-hosted GigaAM v3)
  const healthUrl = `${parsedUrl.origin}/health`;
  try {
    const res = await fetch(healthUrl, { headers, signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      return {
        success: true,
        message: `Сервер GigaAM v3 (${parsedUrl.host}, модель ${cfg.variant}) доступен и готов к работе!`,
      };
    }
  } catch {
    // ignore, fallback to checking endpoint itself
  }

  // 3. Попытка OPTIONS на сам endpoint
  try {
    const res = await fetch(cfg.apiUrl, {
      method: 'OPTIONS',
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Ошибка авторизации GigaASR / GigaAM v3 (${res.status}): проверьте API-ключ`);
    }
    if (res.status < 500) {
      return {
        success: true,
        message: `Эндпоинт GigaASR / GigaAM v3 (${parsedUrl.host}, модель ${cfg.variant}) отвечает (HTTP ${res.status}).`,
      };
    }
    throw new Error(`Сервер GigaASR / GigaAM v3 вернул ошибку HTTP ${res.status}`);
  } catch (err: any) {
    throw new Error(`Не удалось подключиться к серверу GigaASR / GigaAM v3 (${cfg.apiUrl}): ${err.message}`);
  }
}
