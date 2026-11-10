/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { S3Client, GetObjectCommand, PutObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { encrypt, decrypt } from '../store/crypto-store.js';
import { readStore, writeStore, readStoreSync } from '../store/store.js';
import { CallRecord, S3ArchiveBatch, S3ArchiveStatus } from '../types.js';

export interface S3ClientArchiveInfo {
  s3: S3Client;
  bucket: string;
  keyPrefix: string;
  endpoint: string;
}

/**
 * Получение настроенного S3 клиента (Timeweb S3 / S3-совместимое хранилище)
 */
export function getArchiveS3Client(): S3ClientArchiveInfo | null {
  let endpoint = process.env.S3_ENDPOINT || 'https://s3.timeweb.cloud';
  let accessKeyId = process.env.S3_ACCESS_KEY;
  let secretAccessKey = process.env.S3_SECRET_KEY;
  let bucket = process.env.S3_BUCKET_NAME;
  let region = process.env.S3_REGION || 'ru-1';
  let keyPrefix = process.env.S3_KEY_PREFIX || 'lik28/data/';

  try {
    const store = readStoreSync();
    const creds = store.config?.credentials;
    if (creds) {
      if (creds.s3Endpoint) endpoint = creds.s3Endpoint;
      if (creds.s3AccessKey) accessKeyId = creds.s3AccessKey;
      if (creds.s3SecretKey) secretAccessKey = creds.s3SecretKey;
      if (creds.s3BucketName) bucket = creds.s3BucketName;
      if (creds.s3Region) region = creds.s3Region;
      if (creds.s3KeyPrefix) keyPrefix = creds.s3KeyPrefix;
    }
  } catch {}

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    return null;
  }

  // Ensure trailing slash on keyPrefix
  if (keyPrefix && !keyPrefix.endsWith('/')) {
    keyPrefix += '/';
  }

  const s3 = new S3Client({
    region,
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true,
  });

  return { s3, bucket, keyPrefix, endpoint };
}

export interface ArchiveExecutionResult {
  success: boolean;
  archivedCount: number;
  skippedCount: number;
  totalEligible: number;
  s3Key?: string;
  s3Bucket?: string;
  archiveSizeBytes?: number;
  archiveId?: string;
  timestamp: string;
  message: string;
  error?: string;
}

/**
 * Архивация звонков старше TTL_LOG_DAYS дней в S3 хранилище с шифрованием AES-256-GCM (152-ФЗ)
 */
export async function archiveCallsToS3(
  overrideRetentionDays?: number,
  options?: { deleteLocalAfterArchive?: boolean; forceAllOlder?: boolean }
): Promise<ArchiveExecutionResult> {
  const store = await readStore();
  const now = Date.now();

  const retentionDays = overrideRetentionDays !== undefined && overrideRetentionDays >= 0
    ? overrideRetentionDays
    : (store.config.autoCleanup?.archiveOlderThanDays ||
       store.config.autoCleanup?.logRetentionDays ||
       parseInt(process.env.TTL_LOG_DAYS || '30', 10));

  const deleteLocal = options?.deleteLocalAfterArchive ?? store.config.autoCleanup?.deleteLocalAfterArchive ?? false;
  const cutoffTime = now - retentionDays * 86400000;

  // Поиск подходящих звонков старше срока хранения
  const calls = store.calls || [];
  const olderCalls = calls.filter((c: CallRecord) => {
    const callDate = new Date(c.timestamp).getTime();
    return !isNaN(callDate) && callDate < cutoffTime;
  });

  // Отделяем те, что уже заархивированы ранее
  const eligibleCalls = options?.forceAllOlder
    ? olderCalls
    : olderCalls.filter((c: CallRecord) => !c.is_archived);

  const alreadyArchivedCount = olderCalls.length - eligibleCalls.length;

  if (eligibleCalls.length === 0) {
    return {
      success: true,
      archivedCount: 0,
      skippedCount: alreadyArchivedCount,
      totalEligible: olderCalls.length,
      timestamp: new Date().toISOString(),
      message: olderCalls.length === 0
        ? `Нет звонков старше ${retentionDays} дней для архивации.`
        : `Все ${olderCalls.length} звонков старше ${retentionDays} дней уже ранее архивированы в S3.`
    };
  }

  // Проверка доступности S3
  const clientInfo = getArchiveS3Client();
  if (!clientInfo) {
    return {
      success: false,
      archivedCount: 0,
      skippedCount: alreadyArchivedCount,
      totalEligible: eligibleCalls.length,
      timestamp: new Date().toISOString(),
      message: 'S3 хранилище не настроено',
      error: 'Параметры S3 хранилища не заданы в конфигурации или .env'
    };
  }

  const { s3, bucket, keyPrefix } = clientInfo;
  const archiveId = `archive-${Date.now()}`;
  const dateStr = new Date().toISOString().slice(0, 10);
  const archiveKey = `${keyPrefix}archives/calls-${dateStr}-${archiveId}.json.enc`;

  // Сортировка звонков по времени (от старых к новым)
  const sortedEligible = [...eligibleCalls].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const archivePayload = {
    archive_id: archiveId,
    created_at: new Date().toISOString(),
    salon_name: store.config.salonName || 'Fashion Look Studio',
    retention_days: retentionDays,
    calls_count: sortedEligible.length,
    compliance: '152-ФЗ ст. 5, 21 — Регламентная архивация звонков и персональных данных в S3',
    date_range: {
      from: sortedEligible[0]?.timestamp || new Date(cutoffTime).toISOString(),
      to: sortedEligible[sortedEligible.length - 1]?.timestamp || new Date().toISOString(),
    },
    calls: sortedEligible,
  };

  // 152-ФЗ: Обязательное шифрование архива алгоритмом AES-256-GCM
  const jsonStr = JSON.stringify(archivePayload, null, 2);
  const encryptedArchive = encrypt(jsonStr);
  const encryptedPayloadStr = JSON.stringify(encryptedArchive, null, 2);
  const sizeBytes = Buffer.byteLength(encryptedPayloadStr, 'utf-8');

  // Выгрузка зашифрованного архива звонков в S3
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: archiveKey,
        Body: encryptedPayloadStr,
        ContentType: 'application/octet-stream',
        Metadata: {
          'x-archive-id': archiveId,
          'x-calls-count': String(sortedEligible.length),
          'x-retention-days': String(retentionDays),
          'x-compliance': '152-FZ'
        }
      })
    );
  } catch (err: any) {
    console.error('[S3 Archive] Ошибка отправки архива в S3:', err.message);
    return {
      success: false,
      archivedCount: 0,
      skippedCount: alreadyArchivedCount,
      totalEligible: eligibleCalls.length,
      timestamp: new Date().toISOString(),
      message: `Ошибка S3 PutObject: ${err.message}`,
      error: err.message
    };
  }

  // Обновление манифеста архивов в S3
  const manifestKey = `${keyPrefix}archives/manifest.json.enc`;
  let manifestList: S3ArchiveBatch[] = [];

  try {
    const getRes = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: manifestKey }));
    const rawManifest = await getRes.Body!.transformToString('utf-8');
    const decryptedManifest = decrypt(JSON.parse(rawManifest));
    manifestList = JSON.parse(decryptedManifest);
    if (!Array.isArray(manifestList)) manifestList = [];
  } catch {
    manifestList = [];
  }

  const newBatchInfo: S3ArchiveBatch = {
    archive_id: archiveId,
    created_at: new Date().toISOString(),
    s3_key: archiveKey,
    calls_count: sortedEligible.length,
    size_bytes: sizeBytes,
    retention_days: retentionDays,
    earliest_call: archivePayload.date_range.from,
    latest_call: archivePayload.date_range.to,
  };

  manifestList.unshift(newBatchInfo);
  // Сохраняем максимум 100 последних записей манифеста
  if (manifestList.length > 100) manifestList = manifestList.slice(0, 100);

  try {
    const encManifest = encrypt(JSON.stringify(manifestList, null, 2));
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: manifestKey,
        Body: JSON.stringify(encManifest, null, 2),
        ContentType: 'application/octet-stream',
      })
    );
  } catch (mErr: any) {
    console.warn('[S3 Archive] Предупреждение: не удалось обновить манифест архивов:', mErr.message);
  }

  // Обновление локальной базы данных
  const eligibleIds = new Set(sortedEligible.map((c) => c.call_id));
  for (const call of store.calls) {
    if (eligibleIds.has(call.call_id)) {
      call.is_archived = true;
      call.archived_at = new Date().toISOString();
      call.archive_s3_key = archiveKey;

      if (deleteLocal) {
        delete call.audio_url;
        call.audio_deleted = true;
        call.audio_deleted_at = new Date().toISOString();
        call.transcript = '[Архивировано в S3 хранилище согласно 152-ФЗ]';
        call.summary = '[Архивировано в S3 хранилище]';
        call.content_deleted = true;
        call.content_deleted_at = new Date().toISOString();
      }
    }
  }

  if (!store.config.autoCleanup) {
    store.config.autoCleanup = {
      enabled: true,
      logRetentionDays: retentionDays,
      tempFilesRetentionDays: 30,
      autoRunDaily: true
    };
  }

  store.config.autoCleanup.lastArchiveTimestamp = new Date().toISOString();
  store.config.autoCleanup.lastArchiveStats = {
    archivedCount: sortedEligible.length,
    s3Key: archiveKey,
    archiveSizeBytes: sizeBytes,
    timestamp: new Date().toISOString(),
  };

  await writeStore(store);

  console.log(
    `[S3 Archive 152-ФЗ] Успешно архивировано ${sortedEligible.length} звонков старше ${retentionDays} дней ` +
    `в s3://${bucket}/${archiveKey} (${(sizeBytes / 1024).toFixed(1)} КБ)`
  );

  return {
    success: true,
    archivedCount: sortedEligible.length,
    skippedCount: alreadyArchivedCount,
    totalEligible: olderCalls.length,
    s3Key: archiveKey,
    s3Bucket: bucket,
    archiveSizeBytes: sizeBytes,
    archiveId,
    timestamp: new Date().toISOString(),
    message: `Успешно заархивировано ${sortedEligible.length} звонков в S3 (${(sizeBytes / 1024).toFixed(1)} КБ).`
  };
}

/**
 * Получение текущего статуса архивации звонков в S3
 */
export async function getS3ArchiveStatus(): Promise<S3ArchiveStatus> {
  const store = await readStore();
  const now = Date.now();

  const retentionDays = store.config.autoCleanup?.archiveOlderThanDays ||
    store.config.autoCleanup?.logRetentionDays ||
    parseInt(process.env.TTL_LOG_DAYS || '30', 10);

  const cutoffTime = now - retentionDays * 86400000;
  const calls = store.calls || [];

  let olderThanTtlCalls = 0;
  let alreadyArchivedCalls = 0;
  let pendingArchiveCalls = 0;

  for (const call of calls) {
    const callDate = new Date(call.timestamp).getTime();
    if (!isNaN(callDate) && callDate < cutoffTime) {
      olderThanTtlCalls++;
      if (call.is_archived) {
        alreadyArchivedCalls++;
      } else {
        pendingArchiveCalls++;
      }
    } else if (call.is_archived) {
      alreadyArchivedCalls++;
    }
  }

  const clientInfo = getArchiveS3Client();
  const s3Configured = !!clientInfo;
  let s3Connected = false;
  let recentBatches: S3ArchiveBatch[] = [];

  if (clientInfo) {
    try {
      await clientInfo.s3.send(new HeadBucketCommand({ Bucket: clientInfo.bucket }));
      s3Connected = true;

      // Попытка загрузить манифест архивов
      const manifestKey = `${clientInfo.keyPrefix}archives/manifest.json.enc`;
      try {
        const getRes = await clientInfo.s3.send(new GetObjectCommand({ Bucket: clientInfo.bucket, Key: manifestKey }));
        const raw = await getRes.Body!.transformToString('utf-8');
        const dec = decrypt(JSON.parse(raw));
        recentBatches = JSON.parse(dec);
        if (!Array.isArray(recentBatches)) recentBatches = [];
      } catch {}
    } catch {
      s3Connected = false;
    }
  }

  return {
    totalCalls: calls.length,
    retentionDays,
    olderThanTtlCalls,
    alreadyArchivedCalls,
    pendingArchiveCalls,
    s3Configured,
    s3Bucket: clientInfo?.bucket || process.env.S3_BUCKET_NAME || '—',
    s3Endpoint: clientInfo?.endpoint || process.env.S3_ENDPOINT || '—',
    s3Connected,
    lastArchiveStats: store.config.autoCleanup?.lastArchiveStats,
    recentBatches: recentBatches.slice(0, 10),
  };
}

/**
 * Получение списка всех сохраненных архивов звонков в S3
 */
export async function listS3Archives(): Promise<S3ArchiveBatch[]> {
  const clientInfo = getArchiveS3Client();
  if (!clientInfo) return [];

  try {
    const manifestKey = `${clientInfo.keyPrefix}archives/manifest.json.enc`;
    const res = await clientInfo.s3.send(new GetObjectCommand({ Bucket: clientInfo.bucket, Key: manifestKey }));
    const raw = await res.Body!.transformToString('utf-8');
    const dec = decrypt(JSON.parse(raw));
    const list = JSON.parse(dec);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
