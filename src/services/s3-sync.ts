/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { S3Client, GetObjectCommand, PutObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { encrypt, decrypt } from '../store/crypto-store.js';
import { readStoreSync } from '../store/store.js';
import { resolveSalonS3KeyPrefix } from './salonIsolation.js';

export const DEFAULT_S3_SYNC_DEBOUNCE_MS = 45_000; // 45s (окно 30–60 сек)
export const DEFAULT_S3_SYNC_MAX_WAIT_MS = 60_000; // гарантированный верхний предел ожидания
export const DEFAULT_S3_SYNC_BATCH_SIZE = 15; // пакетный сброс после N изменений
export const DEFAULT_S3_RETRY_DELAYS_MS = [5_000, 15_000, 30_000]; // 3 попытки с бэкоффом 5–15–30 сек

export interface FormattedS3Error {
  summary: string;
  details: {
    name: string;
    message: string;
    code?: string;
    httpStatusCode?: number;
    requestId?: string;
    extendedRequestId?: string;
    cfId?: string;
    attempts?: number;
    totalRetryDelay?: number;
    fault?: string;
    cause?: {
      name?: string;
      message?: string;
      code?: string;
      errno?: number | string;
      syscall?: string;
    };
    metadata?: Record<string, unknown>;
  };
}

/**
 * Extracts full structured diagnostic details from an AWS SDK v3 / network error
 * instead of collapsing to bare "UnknownError". Never includes credentials or auth headers.
 */
export function formatS3ErrorDetails(err: any): FormattedS3Error {
  const name = String(err?.name || 'Error');
  const message = String(err?.message || (typeof err === 'string' ? err : 'No error message'));
  const code =
    err?.Code !== undefined
      ? String(err.Code)
      : err?.code !== undefined
      ? String(err.code)
      : undefined;

  const rawMeta = err?.$metadata && typeof err.$metadata === 'object' ? err.$metadata : undefined;
  const httpStatusCode = typeof rawMeta?.httpStatusCode === 'number' ? rawMeta.httpStatusCode : undefined;
  const requestId = typeof rawMeta?.requestId === 'string' ? rawMeta.requestId : undefined;
  const extendedRequestId = typeof rawMeta?.extendedRequestId === 'string' ? rawMeta.extendedRequestId : undefined;
  const cfId = typeof rawMeta?.cfId === 'string' ? rawMeta.cfId : undefined;
  const attempts = typeof rawMeta?.attempts === 'number' ? rawMeta.attempts : undefined;
  const totalRetryDelay = typeof rawMeta?.totalRetryDelay === 'number' ? rawMeta.totalRetryDelay : undefined;
  const fault = typeof err?.$fault === 'string' ? err.$fault : undefined;

  let cause: FormattedS3Error['details']['cause'];
  if (err?.cause && typeof err.cause === 'object') {
    cause = {
      ...(err.cause.name ? { name: String(err.cause.name) } : {}),
      ...(err.cause.message ? { message: String(err.cause.message) } : {}),
      ...(err.cause.code ? { code: String(err.cause.code) } : {}),
      ...(err.cause.errno !== undefined ? { errno: err.cause.errno } : {}),
      ...(err.cause.syscall ? { syscall: String(err.cause.syscall) } : {}),
    };
  } else if (typeof err?.cause === 'string') {
    cause = { message: err.cause };
  }

  const sanitizedMeta: Record<string, unknown> | undefined = rawMeta
    ? {
        ...(httpStatusCode !== undefined ? { httpStatusCode } : {}),
        ...(requestId ? { requestId } : {}),
        ...(extendedRequestId ? { extendedRequestId } : {}),
        ...(cfId ? { cfId } : {}),
        ...(attempts !== undefined ? { attempts } : {}),
        ...(totalRetryDelay !== undefined ? { totalRetryDelay } : {}),
      }
    : undefined;

  const details: FormattedS3Error['details'] = {
    name,
    message,
    ...(code ? { code } : {}),
    ...(httpStatusCode !== undefined ? { httpStatusCode } : {}),
    ...(requestId ? { requestId } : {}),
    ...(extendedRequestId ? { extendedRequestId } : {}),
    ...(cfId ? { cfId } : {}),
    ...(attempts !== undefined ? { attempts } : {}),
    ...(totalRetryDelay !== undefined ? { totalRetryDelay } : {}),
    ...(fault ? { fault } : {}),
    ...(cause && Object.keys(cause).length > 0 ? { cause } : {}),
    ...(sanitizedMeta && Object.keys(sanitizedMeta).length > 0 ? { metadata: sanitizedMeta } : {}),
  };

  const parts: string[] = [`name=${name}`, `message="${message}"`];
  if (code) parts.push(`code=${code}`);
  if (httpStatusCode !== undefined) parts.push(`httpStatus=${httpStatusCode}`);
  if (fault) parts.push(`fault=${fault}`);
  if (requestId) parts.push(`requestId=${requestId}`);
  if (attempts !== undefined) parts.push(`sdkAttempts=${attempts}`);
  if (cause?.code || cause?.message) {
    parts.push(`cause=${[cause.name, cause.code, cause.message].filter(Boolean).join(':')}`);
  }

  return {
    summary: parts.join(', '),
    details,
  };
}

function getSyncDebounceMs(): number {
  const parsed = parseInt(process.env.S3_SYNC_DEBOUNCE_MS || '', 10);
  if (!isNaN(parsed) && parsed >= 5_000) return parsed;
  return DEFAULT_S3_SYNC_DEBOUNCE_MS;
}

function getSyncMaxWaitMs(): number {
  const debounce = getSyncDebounceMs();
  const parsed = parseInt(process.env.S3_SYNC_MAX_WAIT_MS || '', 10);
  if (!isNaN(parsed) && parsed >= debounce) return parsed;
  return Math.max(DEFAULT_S3_SYNC_MAX_WAIT_MS, debounce);
}

function getSyncBatchSize(): number {
  const parsed = parseInt(process.env.S3_SYNC_BATCH_SIZE || '', 10);
  if (!isNaN(parsed) && parsed >= 1) return parsed;
  return DEFAULT_S3_SYNC_BATCH_SIZE;
}

// ─── Клиент S3 timeweb.cloud ───
function getTimewebS3Client(): { s3: S3Client; bucket: string; storeKey: string; keyPrefix: string } | null {
  let endpoint = (process.env.S3_ENDPOINT || '').trim();
  let accessKeyId = (process.env.S3_ACCESS_KEY || '').trim();
  let secretAccessKey = (process.env.S3_SECRET_KEY || '').trim();
  let bucket = (process.env.S3_BUCKET_NAME || '').trim();
  let region = (process.env.S3_REGION || '').trim();
  let keyPrefix = (process.env.S3_KEY_PREFIX || '').trim();

  let salonName = (process.env.SALON_NAME || '').trim();
  let restDomain = (process.env.MEGAFON_REST_DOMAIN || '').trim();

  try {
    const store = readStoreSync();
    const creds = store.config?.credentials;
    if (!salonName && store.config?.salonName) salonName = store.config.salonName.trim();
    if (!restDomain && store.config?.megafon?.restDomain) restDomain = store.config.megafon.restDomain.trim();
    if (creds) {
      if (!endpoint && creds.s3Endpoint) endpoint = creds.s3Endpoint.trim();
      if (!accessKeyId && creds.s3AccessKey) accessKeyId = creds.s3AccessKey.trim();
      if (!secretAccessKey && creds.s3SecretKey) secretAccessKey = creds.s3SecretKey.trim();
      if (!bucket && creds.s3BucketName) bucket = creds.s3BucketName.trim();
      if (!region && creds.s3Region) region = creds.s3Region.trim();
      if (!keyPrefix && creds.s3KeyPrefix) keyPrefix = creds.s3KeyPrefix.trim();
    }
  } catch {
    // ignore
  }

  region = region || 'ru-1';
  keyPrefix = resolveSalonS3KeyPrefix({
    explicitPrefix: keyPrefix,
    salonName,
    restDomain,
  });

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    return null;
  }

  const s3 = new S3Client({
    region,
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true,
    requestHandler: new NodeHttpHandler({
      connectionTimeout: 10000,
      requestTimeout: 30000,
    }),
  });

  const storeKey = `${keyPrefix}data-store.enc`;

  return { s3, bucket, storeKey, keyPrefix };
}

let lastSyncedAt: string | null = null;
let lastSyncError: string | null = null;

// ─── Boot Hydration: загрузка при старте ───
export async function hydrateFromS3(): Promise<any> {
  const clientInfo = getTimewebS3Client();
  if (!clientInfo) {
    console.log('[S3] Переменные S3 timeweb.cloud не настроены. Hydration пропущен.');
    return null;
  }

  const { s3, bucket, storeKey, keyPrefix } = clientInfo;

  try {
    console.log(`[S3] Попытка загрузки зашифрованной базы из s3://${bucket}/${storeKey}...`);
    const res = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: storeKey })
    );
    const raw = await res.Body!.transformToString('utf-8');
    const payload = JSON.parse(raw);

    // Расшифровка AES-256-GCM
    const decrypted = decrypt(payload);
    const data = JSON.parse(decrypted);

    // Проверка наличия новых секций (для миграции)
    if (!data.consents) data.consents = [];
    if (!data.access_log) data.access_log = [];

    lastSyncedAt = new Date().toISOString();
    lastSyncError = null;

    console.log(
      `[S3] Hydration: загружено ${data.calls?.length || 0} звонков, ` +
      `${data.consents?.length || 0} согласий`
    );

    return data;
  } catch (err: any) {
    // Попытка загрузить старый формат (data-store.json) — для обратной совместимости
    const isNotFound = err.$metadata?.httpStatusCode === 404 || err.name === 'NoSuchKey' || err.Code === 'NoSuchKey';
    if (isNotFound) {
      console.log('[S3] Файл .enc не найден. Попытка загрузить старый формат...');

      try {
        const legacyRes = await s3.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: `${keyPrefix}data-store.json`,
          })
        );
        const legacyRaw = await legacyRes.Body!.transformToString('utf-8');
        const legacyData = JSON.parse(legacyRaw);

        // Миграция: добавляем недостающие секции
        if (!legacyData.consents) legacyData.consents = [];
        if (!legacyData.access_log) legacyData.access_log = [];

        lastSyncedAt = new Date().toISOString();
        lastSyncError = null;

        console.log(
          `[S3] Миграция: загружен старый формат, ` +
          `${legacyData.calls?.length || 0} звонков. ` +
          'Файл будет сохранён в новом формате .enc при первой синхронизации.'
        );

        return legacyData;
      } catch {
        console.log('[S3] Старый формат также не найден. Старт с локальной/пустой базой.');
        return null;
      }
    }

    const formatted = formatS3ErrorDetails(err);
    lastSyncError = formatted.summary;
    console.error('[S3] Ошибка при Hydration из S3:', formatted.summary, JSON.stringify(formatted.details));
    return null;
  }
}

export async function syncToS3(data: any): Promise<void> {
  const clientInfo = getTimewebS3Client();
  if (!clientInfo) {
    throw new Error('Конфигурация S3 timeweb.cloud не задана в .env');
  }

  const { s3, bucket, storeKey } = clientInfo;
  const json = JSON.stringify(data, null, 2);
  const payload = encrypt(json);

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: storeKey,
      Body: JSON.stringify(payload, null, 2),
      ContentType: 'application/octet-stream',
    })
  );

  lastSyncedAt = new Date().toISOString();
  lastSyncError = null;
  console.log(`[S3] Синхронизация завершена (${storeKey}):`, lastSyncedAt);
}

export interface S3RetryOptions {
  retryDelaysMs?: number[];
  uploader?: (data: any) => Promise<void>;
  sleepFn?: (ms: number) => Promise<void>;
  reason?: string;
}

/**
 * Executes an S3 upload with retry and backoff (default 3 retries: 5s -> 15s -> 30s)
 * and logs the full structured AWS SDK error object on every failure.
 */
export async function syncToS3WithRetry(
  data: any,
  options: S3RetryOptions = {}
): Promise<{ success: boolean; attempts: number; error?: FormattedS3Error }> {
  const retryDelays = options.retryDelaysMs ?? DEFAULT_S3_RETRY_DELAYS_MS;
  const maxAttempts = retryDelays.length + 1; // 1 основная + 3 повторных попытки с бэкоффом 5–15–30 сек
  const uploader = options.uploader ?? syncToS3;
  const sleepFn = options.sleepFn ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const reasonTag = options.reason ? ` [${options.reason}]` : '';

  let lastFormatted: FormattedS3Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await uploader(data);
      lastSyncError = null;
      if (attempt > 1) {
        console.log(`[S3] auto-sync${reasonTag} восстановлен на попытке ${attempt}/${maxAttempts}.`);
      }
      return { success: true, attempts: attempt };
    } catch (err: any) {
      lastFormatted = formatS3ErrorDetails(err);
      lastSyncError = lastFormatted.summary;
      console.error(
        `[S3] Ошибка auto-sync${reasonTag} (попытка ${attempt}/${maxAttempts}): ${lastFormatted.summary}`,
        JSON.stringify(lastFormatted.details)
      );

      if (attempt < maxAttempts) {
        const delayMs = retryDelays[attempt - 1] ?? 15_000;
        console.warn(
          `[S3] Повтор auto-sync${reasonTag} через ${(delayMs / 1000).toFixed(0)} сек (ретрай ${attempt}/${retryDelays.length})...`
        );
        await sleepFn(delayMs);
      }
    }
  }

  console.error(
    `[S3] auto-sync${reasonTag} окончательно не удался после ${maxAttempts} попыток (1 + ${retryDelays.length} ретраев): ${lastFormatted?.summary || 'unknown'}`
  );
  return { success: false, attempts: maxAttempts, error: lastFormatted };
}

// ─── Auto-sync: пакетная отложенная выгрузка (debounce + batch threshold + flush) ───
let debounceTimer: NodeJS.Timeout | null = null;
let maxWaitTimer: NodeJS.Timeout | null = null;
let pendingChanges = 0;
let pendingGetData: (() => any) | null = null;
let syncInFlightPromise: Promise<void> | null = null;
let dirtyWhileInFlight = false;

// Optional test overrides (null in production)
let testConfig: {
  debounceMs?: number;
  maxWaitMs?: number;
  batchSize?: number;
  retryDelaysMs?: number[];
  uploader?: (data: any) => Promise<void>;
  sleepFn?: (ms: number) => Promise<void>;
  isConfiguredOverride?: () => boolean;
} | null = null;

export function configureS3SyncForTesting(config: typeof testConfig): void {
  clearSyncTimers();
  pendingChanges = 0;
  pendingGetData = null;
  syncInFlightPromise = null;
  dirtyWhileInFlight = false;
  testConfig = config;
}

export function getS3SyncPendingState(): {
  pendingChanges: number;
  hasScheduledTimer: boolean;
  inFlight: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
} {
  return {
    pendingChanges,
    hasScheduledTimer: Boolean(debounceTimer || maxWaitTimer),
    inFlight: Boolean(syncInFlightPromise),
    lastSyncedAt,
    lastSyncError,
  };
}

function clearSyncTimers(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (maxWaitTimer) {
    clearTimeout(maxWaitTimer);
    maxWaitTimer = null;
  }
}

function isS3ConfiguredForAutoSync(): boolean {
  if (testConfig?.isConfiguredOverride) {
    return testConfig.isConfiguredOverride();
  }
  return Boolean(getTimewebS3Client());
}

async function executePendingBatchUpload(reason: string): Promise<void> {
  clearSyncTimers();

  if (!pendingGetData && pendingChanges === 0) {
    return;
  }

  if (syncInFlightPromise) {
    dirtyWhileInFlight = true;
    await syncInFlightPromise;
    return;
  }

  const getData = pendingGetData;
  const changesBatch = pendingChanges;
  pendingChanges = 0;
  dirtyWhileInFlight = false;

  if (!getData) return;

  const run = (async () => {
    try {
      const snapshot = getData();
      console.log(`[S3] Запуск пакетного auto-sync (${reason}, накоплено изменений: ${changesBatch})...`);
      await syncToS3WithRetry(snapshot, {
        reason: `${reason}, изменений=${changesBatch}`,
        retryDelaysMs: testConfig?.retryDelaysMs,
        uploader: testConfig?.uploader,
        sleepFn: testConfig?.sleepFn,
      });
    } finally {
      syncInFlightPromise = null;
      if (dirtyWhileInFlight && pendingGetData) {
        dirtyWhileInFlight = false;
        const followUpChanges = pendingChanges;
        pendingChanges = 0;
        const followUpGetData = pendingGetData;
        const followUpSnapshot = followUpGetData();
        syncInFlightPromise = (async () => {
          try {
            await syncToS3WithRetry(followUpSnapshot, {
              reason: `follow-up, изменений=${followUpChanges}`,
              retryDelaysMs: testConfig?.retryDelaysMs,
              uploader: testConfig?.uploader,
              sleepFn: testConfig?.sleepFn,
            });
          } finally {
            syncInFlightPromise = null;
          }
        })();
        await syncInFlightPromise;
      }
    }
  })();

  syncInFlightPromise = run;
  await run;
}

/**
 * Schedules a debounced/batched S3 upload instead of uploading on every single writeDb call.
 * Triggers after `S3_SYNC_DEBOUNCE_MS` (default 45s) of quiet, `S3_SYNC_MAX_WAIT_MS` (60s) max,
 * or immediately once `S3_SYNC_BATCH_SIZE` (default 15) changes accumulate.
 */
export function scheduleSyncToS3(getData: () => any): void {
  if (!isS3ConfiguredForAutoSync()) return;

  pendingGetData = getData;
  pendingChanges += 1;

  const debounceMs = testConfig?.debounceMs ?? getSyncDebounceMs();
  const maxWaitMs = testConfig?.maxWaitMs ?? getSyncMaxWaitMs();
  const batchSize = testConfig?.batchSize ?? getSyncBatchSize();

  if (syncInFlightPromise) {
    dirtyWhileInFlight = true;
    return;
  }

  if (pendingChanges >= batchSize) {
    void executePendingBatchUpload(`batch_threshold_${batchSize}`);
    return;
  }

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void executePendingBatchUpload('debounce_window');
  }, debounceMs);

  if (!maxWaitTimer) {
    maxWaitTimer = setTimeout(() => {
      void executePendingBatchUpload('max_wait_window');
    }, maxWaitMs);
  }
}

/**
 * Forces an immediate S3 sync of any pending changes (e.g., on batch queue completion or before server shutdown).
 */
export async function flushSyncToS3(
  reason: string = 'manual_flush',
  fallbackGetData?: () => any
): Promise<void> {
  if (!isS3ConfiguredForAutoSync()) return;

  if (fallbackGetData && !pendingGetData) {
    pendingGetData = fallbackGetData;
    if (pendingChanges === 0) pendingChanges = 1;
  }

  if (syncInFlightPromise) {
    await syncInFlightPromise;
  }

  if (pendingChanges > 0 && pendingGetData) {
    await executePendingBatchUpload(reason);
  } else {
    clearSyncTimers();
  }
}

// ─── Ручная синхронизация ───
export async function manualSync(getData: () => any): Promise<{
  ok: boolean;
  synced_at: string;
  size_bytes: number;
}> {
  const clientInfo = getTimewebS3Client();
  if (!clientInfo) {
    throw new Error('S3 timeweb.cloud не настроен в .env');
  }

  clearSyncTimers();
  pendingChanges = 0;

  const data = getData();
  const json = JSON.stringify(data, null, 2);
  const payload = encrypt(json);
  const payloadStr = JSON.stringify(payload, null, 2);

  try {
    await clientInfo.s3.send(
      new PutObjectCommand({
        Bucket: clientInfo.bucket,
        Key: clientInfo.storeKey,
        Body: payloadStr,
        ContentType: 'application/octet-stream',
      })
    );
  } catch (err: any) {
    const formatted = formatS3ErrorDetails(err);
    lastSyncError = formatted.summary;
    console.error('[S3] Ошибка ручной синхронизации:', formatted.summary, JSON.stringify(formatted.details));
    throw new Error(formatted.summary);
  }

  const sizeBytes = Buffer.byteLength(payloadStr, 'utf-8');
  lastSyncedAt = new Date().toISOString();
  lastSyncError = null;
  console.log('[S3] Ручная синхронизация завершена:', lastSyncedAt);

  return {
    ok: true,
    synced_at: lastSyncedAt,
    size_bytes: sizeBytes,
  };
}

// ─── Статус синхронизации для UI ───
export async function getSyncStatus(): Promise<{
  bucket: string;
  key: string;
  endpoint: string;
  connected: boolean;
  synced_at: string | null;
  error?: string | null;
  pending_changes?: number;
}> {
  const clientInfo = getTimewebS3Client();
  const bucketName = process.env.S3_BUCKET_NAME || '—';
  const prefix = process.env.S3_KEY_PREFIX || 'app/data/';
  const keyName = `${prefix}data-store.enc`;
  const endpoint = process.env.S3_ENDPOINT || '';

  if (!clientInfo) {
    return {
      bucket: bucketName,
      key: keyName,
      endpoint,
      connected: false,
      synced_at: lastSyncedAt,
      error: 'Переменные S3 timeweb.cloud не заданы',
      pending_changes: pendingChanges,
    };
  }

  try {
    await clientInfo.s3.send(new HeadBucketCommand({ Bucket: clientInfo.bucket }));
    return {
      bucket: clientInfo.bucket,
      key: clientInfo.storeKey,
      endpoint,
      connected: true,
      synced_at: lastSyncedAt,
      error: lastSyncError,
      pending_changes: pendingChanges,
    };
  } catch (err: any) {
    const formatted = formatS3ErrorDetails(err);
    return {
      bucket: clientInfo.bucket,
      key: clientInfo.storeKey,
      endpoint,
      connected: false,
      synced_at: lastSyncedAt,
      error: formatted.summary || lastSyncError,
      pending_changes: pendingChanges,
    };
  }
}
