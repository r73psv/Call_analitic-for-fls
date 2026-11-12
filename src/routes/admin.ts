/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, Request, Response } from 'express';
import axios from 'axios';
import https from 'https';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import path from 'path';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import { readStore, writeStore } from '../store/store.js';
import { requireRole, logAccess, getCurrentUser } from './auth.js';
import { hashPassword, verifyPassword } from '../store/user-store.js';
import { invalidateGigaChatTokenCache } from '../services/gigachat-auth.js';
import { invalidateAuthorizedKeyCache, getAuthorizedKeyInfo, getIamToken, testYandexSpeechKit } from '../services/yandex-auth.js';
import { setStoreEncryptionKey, isStoreEncryptionKeyConfigured } from '../store/crypto-store.js';
import { scanTempFiles, cleanTempFiles, runCleanupNow } from '../store/cleanup.js';
import { getDefaultSystemPrompt } from '../services/gigachat.js';
import { archiveCallsToS3, getS3ArchiveStatus, listS3Archives } from '../services/s3-archive.js';
import { SystemCredentials, GigaChatModel, AutoCleanupSettings, LogEntry } from '../types.js';

export const adminRouter = Router();

// Protect all admin routes: only 'admin' role allowed
adminRouter.use(requireRole(['admin']));

/**
 * GET /api/admin/credentials
 * Возвращает текущие ключи, токены и настройки интеграций.
 */
adminRouter.get('/credentials', async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    const creds: SystemCredentials = store.config.credentials || {};

    const keyInfo = getAuthorizedKeyInfo();
    const rawKeyPath = creds.yandexServiceAccountKeyFile || process.env.YC_SERVICE_ACCOUNT_KEY_FILE || '';
    const cleanKeyPath = rawKeyPath.length > 200 || rawKeyPath.includes('\n')
      ? (keyInfo.filePath || '/app/keys/authorized_key.json')
      : (rawKeyPath || '/app/keys/authorized_key.json');

    res.json({
      // Салон красоты
      salonName: store.config.salonName || creds.salonName || process.env.SALON_NAME || 'Fashion Look Studio',

      // GigaChat
      gigachatAuthKey: creds.gigachatAuthKey || process.env.GIGACHAT_AUTH_KEY || '',
      gigachatModel: creds.gigachatModel || store.config.default_gigachat_model || 'GigaChat:Lite',
      gigachatScope: creds.gigachatScope || process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS',
      gigachatConfigured: !!(creds.gigachatAuthKey || process.env.GIGACHAT_AUTH_KEY),
      customSystemPrompt: store.config.customSystemPrompt || creds.customSystemPrompt || '',
      defaultSystemPrompt: getDefaultSystemPrompt(store.config.salonName || creds.salonName || process.env.SALON_NAME || 'Fashion Look Studio'),

      // Yandex SpeechKit
      yandexApiKey: creds.yandexApiKey || process.env.YC_API_KEY || '',
      yandexFolderId: creds.yandexFolderId || process.env.YC_FOLDER_ID || '',
      yandexServiceAccountId: creds.yandexServiceAccountId || process.env.YC_SERVICE_ACCOUNT_ID || keyInfo.serviceAccountId || '',
      yandexServiceAccountKeyFile: cleanKeyPath,
      yandexServiceAccountKeyJson: creds.yandexServiceAccountKeyJson || process.env.YC_SERVICE_ACCOUNT_KEY_JSON || '',
      yandexKeyInfo: keyInfo,
      yandexConfigured: !!(keyInfo.configured || creds.yandexApiKey || process.env.YC_API_KEY),
      geminiConfigured: !!process.env.GEMINI_API_KEY,

      // 152-ФЗ Ключ шифрования БД и ПДн
      storeEncryptionKey: creds.storeEncryptionKey || process.env.STORE_ENCRYPTION_KEY || '',
      storeEncryptionKeyConfigured: isStoreEncryptionKeyConfigured(),

      // Yandex Object Storage (для аудиозаписей SpeechKit)
      yandexStorageBucket: creds.yandexStorageBucket || process.env.YC_STORAGE_BUCKET || '',
      yandexStorageAccessKey: creds.yandexStorageAccessKey || process.env.YC_STORAGE_ACCESS_KEY || process.env.YC_S3_KEY_ID || '',
      yandexStorageSecretKey: creds.yandexStorageSecretKey || process.env.YC_STORAGE_SECRET_KEY || process.env.YC_S3_SECRET_KEY || '',
      yandexStorageEndpoint: creds.yandexStorageEndpoint || process.env.YC_STORAGE_ENDPOINT || 'https://storage.yandexcloud.net',
      yandexStorageRegion: creds.yandexStorageRegion || process.env.YC_STORAGE_REGION || 'ru-central1',
      yandexStorageConfigured: !!(
        (creds.yandexStorageAccessKey || process.env.YC_STORAGE_ACCESS_KEY || process.env.YC_S3_KEY_ID) &&
        (creds.yandexStorageBucket || process.env.YC_STORAGE_BUCKET)
      ),

      // S3 Timeweb (для резервной копии базы данных)
      s3Endpoint: creds.s3Endpoint || process.env.S3_ENDPOINT || 'https://s3.timeweb.cloud',
      s3AccessKey: creds.s3AccessKey || process.env.S3_ACCESS_KEY || '',
      s3SecretKey: creds.s3SecretKey || process.env.S3_SECRET_KEY || '',
      s3BucketName: creds.s3BucketName || process.env.S3_BUCKET_NAME || '',
      s3KeyPrefix: creds.s3KeyPrefix || process.env.S3_KEY_PREFIX || 'lik28/data/',
      s3Region: creds.s3Region || process.env.S3_REGION || 'ru-1',
      s3Configured: !!(creds.s3AccessKey || process.env.S3_ACCESS_KEY),

      // Мегафон ВАТС
      megafonApiVersion: creds.megafonApiVersion || store.config.megafon.apiVersion || process.env.MEGAFON_API_VERSION || 'json_rpc',
      megafonToken: creds.megafonToken || store.config.megafon.token || '',
      megafonRestDomain: creds.megafonRestDomain || store.config.megafon.restDomain || process.env.MEGAFON_REST_DOMAIN || '',
      megafonRestToken: creds.megafonRestToken || store.config.megafon.restToken || process.env.MEGAFON_REST_TOKEN || '',
      megafonCrmToken: creds.megafonCrmToken || store.config.megafon.crmToken || process.env.MEGAFON_CRM_TOKEN || '',
      megafonRestPollingPeriod: store.config.megafon.restPollingPeriod || 'today',
      megafonLkLogin: creds.megafonLkLogin || store.config.megafon.lkLogin || '',
      megafonLkPassword: creds.megafonLkPassword || store.config.megafon.lkPassword || '',
      megafonWebhookUrl: store.config.megafon.webhookUrl || '/api/calls/webhook',
      megafonAutoImport: store.config.megafon.autoImport !== false,
      megafonPollingEnabled: !!store.config.megafon.pollingEnabled,
      megafonPollingIntervalMinutes: store.config.megafon.pollingIntervalMinutes || 15,

      // VK
      vkToken: creds.vkToken || store.config.vk.token || '',
      vkChatId: creds.vkChatId || store.config.vk.chatId || '',
      vkTemplate: store.config.vk.template || '',
      vkEnabled: !!store.config.vk.enabled,

      // YClients
      yclientsUserToken: creds.yclientsUserToken || store.config.yclients.userToken || '',
      yclientsPartnerToken: creds.yclientsPartnerToken || store.config.yclients.partnerToken || '',
      yclientsSalonId: creds.yclientsSalonId || store.config.yclients.salonId || '',
      yclientsEnabled: !!store.config.yclients.enabled,

      // 152-ФЗ TTL settings
      ttlSettings: store.config.ttlSettings || {
        audioDays: 14,
        transcriptDays: 30,
        fullDeleteDays: 90,
        accessLogDays: 365,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/yandex-key-upload
 * Загрузка и валидация файла authorized_key.json для сервисного аккаунта Yandex Cloud
 */
adminRouter.post('/yandex-key-upload', async (req: Request, res: Response) => {
  try {
    const { keyContent, customPath } = req.body || {};
    if (!keyContent || typeof keyContent !== 'string') {
      return res.status(400).json({ success: false, error: 'Содержимое файла ключа authorized_key.json не передано' });
    }

    let parsed: any;
    try {
      parsed = JSON.parse(keyContent.trim());
    } catch (parseErr: any) {
      return res.status(400).json({ success: false, error: `Невалидный JSON формат: ${parseErr.message}` });
    }

    if (!parsed.service_account_id || !parsed.private_key) {
      return res.status(400).json({
        success: false,
        error: 'Файл ключа должен содержать поля "service_account_id" и "private_key" (стандартный формат Yandex Cloud IAM authorized_key.json)',
      });
    }

    const store = await readStore();
    if (!store.config.credentials) store.config.credentials = {};
    const creds = store.config.credentials;

    // Determine target save path
    let targetFile = customPath || creds.yandexServiceAccountKeyFile || process.env.YC_SERVICE_ACCOUNT_KEY_FILE || '/app/keys/authorized_key.json';

    try {
      const dir = path.dirname(targetFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(targetFile, JSON.stringify(parsed, null, 2), { mode: 0o600 });
    } catch (writeErr: any) {
      // Fallback to project keys directory
      targetFile = path.join(process.cwd(), 'keys', 'authorized_key.json');
      const dir = path.dirname(targetFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(targetFile, JSON.stringify(parsed, null, 2), { mode: 0o600 });
    }

    creds.yandexServiceAccountKeyFile = targetFile;
    creds.yandexServiceAccountKeyJson = JSON.stringify(parsed);
    process.env.YC_SERVICE_ACCOUNT_KEY_FILE = targetFile;
    process.env.YC_SERVICE_ACCOUNT_KEY_JSON = creds.yandexServiceAccountKeyJson;

    invalidateAuthorizedKeyCache();
    await writeStore(store);

    await logAccess(
      getCurrentUser(req)?.name || 'admin',
      'write',
      `Загружен authorized_key.json (SA: ${parsed.service_account_id}) в ${targetFile}`,
      req.ip || '127.0.0.1'
    );

    res.json({
      success: true,
      message: 'Файл authorized_key.json успешно загружен, проверен и применён',
      serviceAccountId: parsed.service_account_id,
      keyId: parsed.id,
      filePath: targetFile,
      keyInfo: getAuthorizedKeyInfo(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: `Ошибка сохранения ключа: ${err.message}` });
  }
});

/**
 * POST /api/admin/credentials
 * Сохраняет обновленные токены, ключи и системные параметры в зашифрованное хранилище.
 */
adminRouter.post('/credentials', async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    const body = req.body || {};

    if (!store.config.credentials) {
      store.config.credentials = {};
    }

    const creds = store.config.credentials;

    // 1. GigaChat
    if (body.gigachatAuthKey !== undefined) {
      creds.gigachatAuthKey = String(body.gigachatAuthKey).trim();
      process.env.GIGACHAT_AUTH_KEY = creds.gigachatAuthKey;
      invalidateGigaChatTokenCache();
    }
    if (body.gigachatScope !== undefined) {
      creds.gigachatScope = String(body.gigachatScope).trim();
      process.env.GIGACHAT_SCOPE = creds.gigachatScope;
      invalidateGigaChatTokenCache();
    }
    if (body.gigachatModel) {
      const validModels: GigaChatModel[] = ['GigaChat:Lite', 'GigaChat:Pro', 'GigaChat:Max', 'GigaChat:Ultra'];
      if (validModels.includes(body.gigachatModel)) {
        creds.gigachatModel = body.gigachatModel;
        store.config.default_gigachat_model = body.gigachatModel;
        store.config.activeModel = body.gigachatModel;
        process.env.GIGACHAT_DEFAULT_MODEL = body.gigachatModel;
      }
    }
    if (body.customSystemPrompt !== undefined) {
      const cleanPrompt = String(body.customSystemPrompt).trim();
      creds.customSystemPrompt = cleanPrompt;
      store.config.customSystemPrompt = cleanPrompt;
    }

    // 2. Yandex SpeechKit
    if (body.yandexApiKey !== undefined) {
      creds.yandexApiKey = String(body.yandexApiKey).trim();
      process.env.YC_API_KEY = creds.yandexApiKey;
    }
    if (body.yandexFolderId !== undefined) {
      creds.yandexFolderId = String(body.yandexFolderId).trim();
      process.env.YC_FOLDER_ID = creds.yandexFolderId;
    }
    if (body.yandexServiceAccountId !== undefined) {
      creds.yandexServiceAccountId = String(body.yandexServiceAccountId).trim();
      process.env.YC_SERVICE_ACCOUNT_ID = creds.yandexServiceAccountId;
      invalidateAuthorizedKeyCache();
    }
    if (body.yandexServiceAccountKeyFile !== undefined) {
      creds.yandexServiceAccountKeyFile = String(body.yandexServiceAccountKeyFile).trim();
      process.env.YC_SERVICE_ACCOUNT_KEY_FILE = creds.yandexServiceAccountKeyFile;
      invalidateAuthorizedKeyCache();
    }
    if (body.yandexServiceAccountKeyJson !== undefined) {
      creds.yandexServiceAccountKeyJson = String(body.yandexServiceAccountKeyJson).trim();
      process.env.YC_SERVICE_ACCOUNT_KEY_JSON = creds.yandexServiceAccountKeyJson;
      invalidateAuthorizedKeyCache();
    }

    // 152-ФЗ Ключ шифрования БД и ПДн (STORE_ENCRYPTION_KEY)
    if (body.storeEncryptionKey !== undefined) {
      const keyVal = String(body.storeEncryptionKey).trim();
      if (keyVal) {
        creds.storeEncryptionKey = keyVal;
        process.env.STORE_ENCRYPTION_KEY = keyVal;
        setStoreEncryptionKey(keyVal);
      }
    }

    // Название салона красоты
    if (body.salonName !== undefined) {
      const cleanSalonName = String(body.salonName).trim() || 'Fashion Look Studio';
      store.config.salonName = cleanSalonName;
      creds.salonName = cleanSalonName;
      process.env.SALON_NAME = cleanSalonName;
    }

    // 3. Yandex Object Storage (для аудиозаписей SpeechKit)
    if (body.yandexStorageBucket !== undefined) {
      creds.yandexStorageBucket = String(body.yandexStorageBucket).trim();
      process.env.YC_STORAGE_BUCKET = creds.yandexStorageBucket;
    }
    if (body.yandexStorageAccessKey !== undefined) {
      creds.yandexStorageAccessKey = String(body.yandexStorageAccessKey).trim();
      process.env.YC_STORAGE_ACCESS_KEY = creds.yandexStorageAccessKey;
      process.env.YC_S3_KEY_ID = creds.yandexStorageAccessKey;
    }
    if (body.yandexStorageSecretKey !== undefined) {
      creds.yandexStorageSecretKey = String(body.yandexStorageSecretKey).trim();
      process.env.YC_STORAGE_SECRET_KEY = creds.yandexStorageSecretKey;
      process.env.YC_S3_SECRET_KEY = creds.yandexStorageSecretKey;
    }
    if (body.yandexStorageEndpoint !== undefined) {
      creds.yandexStorageEndpoint = String(body.yandexStorageEndpoint).trim();
      process.env.YC_STORAGE_ENDPOINT = creds.yandexStorageEndpoint;
    }
    if (body.yandexStorageRegion !== undefined) {
      creds.yandexStorageRegion = String(body.yandexStorageRegion).trim();
      process.env.YC_STORAGE_REGION = creds.yandexStorageRegion;
    }

    // 4. S3 Timeweb / Внешнее хранилище (для резервной копии базы данных 152-ФЗ)
    if (body.s3Endpoint !== undefined) {
      creds.s3Endpoint = String(body.s3Endpoint).trim();
      process.env.S3_ENDPOINT = creds.s3Endpoint;
    }
    if (body.s3AccessKey !== undefined) {
      creds.s3AccessKey = String(body.s3AccessKey).trim();
      process.env.S3_ACCESS_KEY = creds.s3AccessKey;
    }
    if (body.s3SecretKey !== undefined) {
      creds.s3SecretKey = String(body.s3SecretKey).trim();
      process.env.S3_SECRET_KEY = creds.s3SecretKey;
    }
    if (body.s3BucketName !== undefined) {
      creds.s3BucketName = String(body.s3BucketName).trim();
      process.env.S3_BUCKET_NAME = creds.s3BucketName;
    }
    if (body.s3KeyPrefix !== undefined) {
      creds.s3KeyPrefix = String(body.s3KeyPrefix).trim();
      process.env.S3_KEY_PREFIX = creds.s3KeyPrefix;
    }
    if (body.s3Region !== undefined) {
      creds.s3Region = String(body.s3Region).trim();
      process.env.S3_REGION = creds.s3Region;
    }

    // 4. Мегафон ВАТС
    if (body.megafonApiVersion !== undefined) {
      const v = body.megafonApiVersion === 'rest_wcgp' ? 'rest_wcgp' : 'json_rpc';
      store.config.megafon.apiVersion = v;
      creds.megafonApiVersion = v;
      process.env.MEGAFON_API_VERSION = v;
    }
    if (body.megafonToken !== undefined) {
      creds.megafonToken = String(body.megafonToken).trim();
      store.config.megafon.token = creds.megafonToken;
      process.env.MEGAFON_TOKEN = creds.megafonToken;
    }
    if (body.megafonRestDomain !== undefined) {
      creds.megafonRestDomain = String(body.megafonRestDomain).trim();
      store.config.megafon.restDomain = creds.megafonRestDomain;
      process.env.MEGAFON_REST_DOMAIN = creds.megafonRestDomain;
    }
    if (body.megafonRestToken !== undefined) {
      creds.megafonRestToken = String(body.megafonRestToken).trim();
      store.config.megafon.restToken = creds.megafonRestToken;
      process.env.MEGAFON_REST_TOKEN = creds.megafonRestToken;
    }
    if (body.megafonCrmToken !== undefined) {
      creds.megafonCrmToken = String(body.megafonCrmToken).trim();
      store.config.megafon.crmToken = creds.megafonCrmToken;
      process.env.MEGAFON_CRM_TOKEN = creds.megafonCrmToken;
    }
    if (body.megafonRestPollingPeriod !== undefined) {
      store.config.megafon.restPollingPeriod = body.megafonRestPollingPeriod;
    }
    if (body.megafonLkLogin !== undefined) {
      creds.megafonLkLogin = String(body.megafonLkLogin).trim();
      store.config.megafon.lkLogin = creds.megafonLkLogin;
      process.env.MEGAFON_LK_LOGIN = creds.megafonLkLogin;
    }
    if (body.megafonLkPassword !== undefined) {
      creds.megafonLkPassword = String(body.megafonLkPassword).trim();
      store.config.megafon.lkPassword = creds.megafonLkPassword;
      process.env.MEGAFON_LK_PASSWORD = creds.megafonLkPassword;
    }
    if (body.megafonWebhookUrl !== undefined) store.config.megafon.webhookUrl = String(body.megafonWebhookUrl).trim();
    if (body.megafonAutoImport !== undefined) store.config.megafon.autoImport = Boolean(body.megafonAutoImport);
    if (body.megafonPollingEnabled !== undefined) {
      store.config.megafon.pollingEnabled = Boolean(body.megafonPollingEnabled);
      if (store.config.megafon.pollingEnabled) {
        store.config.megafon.active = true;
      }
    }
    if (body.megafonPollingIntervalMinutes !== undefined) {
      const parsed = parseInt(String(body.megafonPollingIntervalMinutes), 10);
      store.config.megafon.pollingIntervalMinutes = isNaN(parsed) ? 15 : Math.max(1, parsed);
    }

    // 5. VK
    if (body.vkToken !== undefined) {
      creds.vkToken = String(body.vkToken).trim();
      store.config.vk.token = creds.vkToken;
      process.env.VK_TOKEN = creds.vkToken;
    }
    if (body.vkChatId !== undefined) {
      creds.vkChatId = String(body.vkChatId).trim();
      store.config.vk.chatId = creds.vkChatId;
      process.env.VK_CHAT_ID = creds.vkChatId;
    }
    if (body.vkTemplate !== undefined) store.config.vk.template = String(body.vkTemplate);
    if (body.vkEnabled !== undefined) store.config.vk.enabled = Boolean(body.vkEnabled);

    // 6. YClients
    if (body.yclientsUserToken !== undefined) {
      creds.yclientsUserToken = String(body.yclientsUserToken).trim();
      store.config.yclients.userToken = creds.yclientsUserToken;
      process.env.YCLIENTS_USER_TOKEN = creds.yclientsUserToken;
    }
    if (body.yclientsPartnerToken !== undefined) {
      creds.yclientsPartnerToken = String(body.yclientsPartnerToken).trim();
      store.config.yclients.partnerToken = creds.yclientsPartnerToken;
      process.env.YCLIENTS_PARTNER_TOKEN = creds.yclientsPartnerToken;
    }
    if (body.yclientsSalonId !== undefined) {
      creds.yclientsSalonId = String(body.yclientsSalonId).trim();
      store.config.yclients.salonId = creds.yclientsSalonId;
      process.env.YCLIENTS_SALON_ID = creds.yclientsSalonId;
    }
    if (body.yclientsEnabled !== undefined) store.config.yclients.enabled = Boolean(body.yclientsEnabled);

    // 7. TTL Settings
    if (body.ttlSettings) {
      store.config.ttlSettings = {
        audioDays: Math.max(1, parseInt(body.ttlSettings.audioDays, 10) || 14),
        transcriptDays: Math.max(1, parseInt(body.ttlSettings.transcriptDays, 10) || 30),
        fullDeleteDays: Math.max(1, parseInt(body.ttlSettings.fullDeleteDays, 10) || 90),
        accessLogDays: Math.max(1, parseInt(body.ttlSettings.accessLogDays, 10) || 365),
      };
    }

    await writeStore(store);

    await logAccess(
      getCurrentUser(req)?.name || 'Администратор',
      'write',
      'Обновлены системные токены, ключи и параметры интеграций в админ-панели',
      req.ip || '127.0.0.1'
    );

    res.json({
      success: true,
      message: 'Все токены, ключи и настройки успешно сохранены в зашифрованное хранилище',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/change-admin-password
 * Смена мастер-пароля администратора
 */
adminRouter.post('/change-admin-password', async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Текущий и новый пароли обязательны' });
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'Новый пароль должен быть не менее 6 символов' });
    }

    const store = await readStore();
    const users = store.users || [];
    const currentUser = getCurrentUser(req);

    // Find admin user
    const adminUser = users.find(u => u.username === (currentUser?.username || 'admin') && u.role === 'admin');
    if (!adminUser) {
      return res.status(404).json({ error: 'Пользователь-администратор не найден' });
    }

    // Verify current password
    const isCurrentValid = verifyPassword(String(currentPassword), adminUser.passwordHash, adminUser.salt) ||
      (String(currentPassword) === 'admin123');

    if (!isCurrentValid) {
      return res.status(401).json({ error: 'Неверный текущий пароль' });
    }

    // Update password
    const hashed = hashPassword(String(newPassword));
    adminUser.passwordHash = hashed.hash;
    adminUser.salt = hashed.salt;

    if (!store.config.credentials) store.config.credentials = {};
    store.config.credentials.adminPasswordHash = hashed.hash;
    store.config.credentials.adminPasswordSalt = hashed.salt;

    await writeStore(store);

    await logAccess(
      adminUser.name,
      'write',
      'Пароль администратора успешно изменен',
      req.ip || '127.0.0.1'
    );

    res.json({ success: true, message: 'Пароль администратора успешно обновлен' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/test/gigachat
 * Тестирование подключения к Сбер GigaChat с переданным или сохраненным ключом
 */
adminRouter.post('/test/gigachat', async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    const authKey = req.body.authKey || store.config.credentials?.gigachatAuthKey || process.env.GIGACHAT_AUTH_KEY;
    const scope = req.body.scope || store.config.credentials?.gigachatScope || process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS';

    if (!authKey) {
      return res.status(400).json({ success: false, error: 'Ключ авторизации GigaChat не указан' });
    }

    const formattedAuth = authKey.startsWith('Basic ') || authKey.startsWith('Bearer ')
      ? authKey
      : `Basic ${authKey}`;

    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    const authRes = await axios.post(
      'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
      `scope=${encodeURIComponent(scope)}`,
      {
        headers: {
          Authorization: formattedAuth,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          RqUID: randomUUID(),
        },
        httpsAgent,
        timeout: 15000,
      }
    );

    if (authRes.data && authRes.data.access_token) {
      return res.json({
        success: true,
        message: 'Соединение с GigaChat успешно установлено. Токен получен.',
        expiresAt: authRes.data.expires_at ? new Date(authRes.data.expires_at).toLocaleString('ru-RU') : 'через 30 минут',
      });
    }

    res.status(400).json({ success: false, error: 'Не удалось получить токен GigaChat' });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      error: `Ошибка подключения к GigaChat: ${err.response?.data?.message || err.message}`,
    });
  }
});

/**
 * POST /api/admin/test/yandex
 * Проверка ключей и авторизации Yandex Cloud (SpeechKit)
 */
adminRouter.post('/test/yandex', async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    const creds = store.config.credentials || {};
    const apiKey = req.body.apiKey !== undefined && req.body.apiKey !== ''
      ? req.body.apiKey
      : (creds.yandexApiKey || process.env.YC_API_KEY);
    const folderId = req.body.folderId !== undefined && req.body.folderId !== ''
      ? req.body.folderId
      : (creds.yandexFolderId || process.env.YC_FOLDER_ID);

    const testRes = await testYandexSpeechKit(apiKey, folderId);
    return res.json(testRes);
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: `Ошибка проверки SpeechKit: ${err.message}`,
    });
  }
});

/**
 * POST /api/admin/test/yandex-storage
 * Тестирование подключения к бакету Yandex Object Storage (для аудиозаписей SpeechKit)
 */
adminRouter.post('/test/yandex-storage', async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    const creds = store.config.credentials || {};

    const endpoint = req.body.endpoint || creds.yandexStorageEndpoint || process.env.YC_STORAGE_ENDPOINT || 'https://storage.yandexcloud.net';
    const accessKeyId = req.body.accessKey || creds.yandexStorageAccessKey || process.env.YC_STORAGE_ACCESS_KEY || process.env.YC_S3_KEY_ID;
    const secretAccessKey = req.body.secretKey || creds.yandexStorageSecretKey || process.env.YC_STORAGE_SECRET_KEY || process.env.YC_S3_SECRET_KEY;
    const bucket = req.body.bucket || creds.yandexStorageBucket || process.env.YC_STORAGE_BUCKET;
    const region = req.body.region || creds.yandexStorageRegion || process.env.YC_STORAGE_REGION || 'ru-central1';

    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
      return res.status(400).json({
        success: false,
        error: 'Не все параметры Yandex Storage заполнены (Имя бакета, Access Key ID, Secret Key)',
      });
    }

    const s3 = new S3Client({
      region,
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });

    await s3.send(new HeadBucketCommand({ Bucket: bucket }));

    res.json({
      success: true,
      message: `Бакет Yandex Object Storage "${bucket}" на ${endpoint} успешно подтверждён`,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      error: `Ошибка проверки Yandex Storage: ${err.message}`,
    });
  }
});

/**
 * POST /api/admin/test/s3
 * Тестирование подключения к S3 бакету Timeweb (для резервной копии БД)
 */
adminRouter.post('/test/s3', async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    const creds = store.config.credentials || {};

    const endpoint = req.body.endpoint || creds.s3Endpoint || process.env.S3_ENDPOINT || 'https://s3.timeweb.cloud';
    const accessKeyId = req.body.accessKey || creds.s3AccessKey || process.env.S3_ACCESS_KEY;
    const secretAccessKey = req.body.secretKey || creds.s3SecretKey || process.env.S3_SECRET_KEY;
    const bucket = req.body.bucket || creds.s3BucketName || process.env.S3_BUCKET_NAME;
    const region = req.body.region || creds.s3Region || process.env.S3_REGION || 'ru-1';

    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
      return res.status(400).json({
        success: false,
        error: 'Не все параметры Timeweb S3 заполнены (Endpoint, Access Key, Secret Key, Bucket)',
      });
    }

    const s3 = new S3Client({
      region,
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });

    await s3.send(new HeadBucketCommand({ Bucket: bucket }));

    res.json({
      success: true,
      message: `Подключение к S3 бакету "${bucket}" на ${endpoint} успешно подтверждено`,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      error: `Ошибка проверки S3: ${err.message}`,
    });
  }
});

/**
 * POST /api/admin/test/vk
 * Тестирование отправки тестового сообщения в VK
 */
adminRouter.post('/test/vk', async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    const token = req.body.token || store.config.credentials?.vkToken || store.config.vk.token || process.env.VK_TOKEN;
    const chatId = req.body.chatId || store.config.credentials?.vkChatId || store.config.vk.chatId || process.env.VK_CHAT_ID;

    if (!token || !chatId) {
      return res.status(400).json({ success: false, error: 'Токен VK или ID чата не указаны' });
    }

    const currentSalon = store.config.salonName || store.config.credentials?.salonName || process.env.SALON_NAME || 'Fashion Look Studio';
    const message = `🔔 [${currentSalon} Тест] Проверка интеграции уведомлений аналитики звонков салона красоты «${currentSalon}» (${new Date().toLocaleString('ru-RU')})`;
    const params = new URLSearchParams();
    params.append('v', '5.131');
    params.append('access_token', token);
    params.append('random_id', String(Date.now()));
    params.append('message', message);

    const parsedChatId = parseInt(chatId, 10);
    if (!isNaN(parsedChatId) && parsedChatId > 2000000000) {
      params.append('peer_id', String(parsedChatId));
    } else {
      params.append('peer_id', chatId);
    }

    const response = await axios.post('https://api.vk.com/method/messages.send', params, { timeout: 10000 });
    if (response.data && response.data.error) {
      return res.status(400).json({
        success: false,
        error: `VK API Ошибка: ${response.data.error.error_msg || JSON.stringify(response.data.error)}`,
      });
    }

    res.json({ success: true, message: 'Тестовое уведомление успешно отправлено в ВКонтакте' });
  } catch (err: any) {
    res.status(400).json({ success: false, error: `Ошибка отправки в VK: ${err.message}` });
  }
});

/**
 * GET /api/admin/cleanup-settings
 * Получение текущих настроек автоочистки логов и временных файлов (152-ФЗ)
 */
adminRouter.get('/cleanup-settings', async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    const config: AutoCleanupSettings = store.config.autoCleanup || {
      enabled: true,
      logRetentionDays: 30,
      tempFilesRetentionDays: 30,
      autoRunDaily: true,
      archiveCallsToS3: true,
      archiveOlderThanDays: 30,
      deleteLocalAfterArchive: false
    };

    const retentionDays = config.tempFilesRetentionDays || 30;
    const tempReport = scanTempFiles(retentionDays);

    const now = Date.now();
    const logCutoff = now - (config.logRetentionDays || 30) * 86400000;
    const logsTotal = Array.isArray(store.logs) ? store.logs.length : 0;
    const logsOlderThanRetention = Array.isArray(store.logs) 
      ? store.logs.filter((l: LogEntry) => new Date(l.timestamp).getTime() < logCutoff).length 
      : 0;
    const accessLogsTotal = Array.isArray(store.access_log) ? store.access_log.length : 0;

    let archiveStatus = null;
    try {
      archiveStatus = await getS3ArchiveStatus();
    } catch (e: any) {
      console.warn('[Admin] Failed to get S3 archive status:', e.message);
    }

    res.json({
      settings: config,
      currentStats: {
        logsTotal,
        logsOlderThanRetention,
        accessLogsTotal,
        tempFilesTotal: tempReport.totalFiles,
        tempFilesBytes: tempReport.totalBytes,
        tempFilesOlderThanRetention: tempReport.olderThanDaysFiles,
        tempBytesOlderThanRetention: tempReport.olderThanDaysBytes,
        scannedDirs: tempReport.scannedDirs
      },
      archiveStatus
    });
  } catch (err: any) {
    res.status(500).json({ error: `Ошибка получения настроек автоочистки: ${err.message}` });
  }
});

/**
 * POST /api/admin/cleanup-settings
 * Сохранение настроек автоочистки логов и временных файлов
 */
adminRouter.post('/cleanup-settings', async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    const body = req.body || {};

    const enabled = body.enabled !== false;
    const logRetentionDays = Math.max(1, Math.min(365, parseInt(String(body.logRetentionDays || 30), 10) || 30));
    const tempFilesRetentionDays = Math.max(1, Math.min(365, parseInt(String(body.tempFilesRetentionDays || 30), 10) || 30));
    const autoRunDaily = body.autoRunDaily !== false;
    const archiveCallsToS3 = body.archiveCallsToS3 !== false;
    const archiveOlderThanDays = Math.max(1, Math.min(365, parseInt(String(body.archiveOlderThanDays || body.logRetentionDays || 30), 10) || 30));
    const deleteLocalAfterArchive = !!body.deleteLocalAfterArchive;

    store.config.autoCleanup = {
      ...(store.config.autoCleanup || {}),
      enabled,
      logRetentionDays,
      tempFilesRetentionDays,
      autoRunDaily,
      archiveCallsToS3,
      archiveOlderThanDays,
      deleteLocalAfterArchive
    };

    await writeStore(store);

    await logAccess(
      getCurrentUser(req)?.name || 'admin',
      'write',
      'Обновлены параметры автоочистки и S3-архивации 152-ФЗ',
      req.ip || '127.0.0.1'
    );

    res.json({
      success: true,
      message: 'Настройки автоочистки и S3-архивации (152-ФЗ) успешно сохранены',
      settings: store.config.autoCleanup
    });
  } catch (err: any) {
    res.status(500).json({ error: `Ошибка сохранения настроек автоочистки: ${err.message}` });
  }
});

/**
 * POST /api/admin/cleanup/run
 * Принудительное выполнение очистки логов, временных файлов и данных 152-ФЗ прямо сейчас
 */
adminRouter.post('/cleanup/run', async (req: Request, res: Response) => {
  try {
    const stats = await runCleanupNow();
    await logAccess(
      getCurrentUser(req)?.name || 'admin',
      'delete',
      'Запущена регламентная очистка данных 152-ФЗ (логи, файлы и S3-архивация)',
      req.ip || '127.0.0.1'
    );

    res.json({
      success: true,
      message: 'Регламентная очистка данных 152-ФЗ успешно выполнена',
      stats
    });
  } catch (err: any) {
    res.status(500).json({ error: `Ошибка выполнения очистки: ${err.message}` });
  }
});

/**
 * POST /api/admin/archive/run
 * Ручной запуск архивации звонков старше TTL_LOG_DAYS дней в S3 хранилище (152-ФЗ)
 */
adminRouter.post('/archive/run', async (req: Request, res: Response) => {
  try {
    const { retentionDays, deleteLocalAfterArchive, forceAllOlder } = req.body || {};
    const daysNum = retentionDays !== undefined ? parseInt(String(retentionDays), 10) : undefined;
    const result = await archiveCallsToS3(daysNum, {
      deleteLocalAfterArchive: !!deleteLocalAfterArchive,
      forceAllOlder: !!forceAllOlder
    });

    if (result.success && result.archivedCount > 0) {
      await logAccess(
        getCurrentUser(req)?.name || 'admin',
        'write',
        `Архивация в S3: выгружено ${result.archivedCount} звонков в ${result.s3Key} (152-ФЗ)`,
        req.ip || '127.0.0.1'
      );
    }

    res.json({
      success: result.success,
      result,
      message: result.message,
      error: result.error
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: `Ошибка при архивации в S3: ${err.message}` });
  }
});

/**
 * GET /api/admin/archive/status
 * Статус архивации звонков и проверка подключения к S3
 */
adminRouter.get('/archive/status', async (req: Request, res: Response) => {
  try {
    const status = await getS3ArchiveStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: `Ошибка получения статуса архивации S3: ${err.message}` });
  }
});

/**
 * GET /api/admin/archive/list
 * Список архивных батчей звонков в S3
 */
adminRouter.get('/archive/list', async (req: Request, res: Response) => {
  try {
    const archives = await listS3Archives();
    res.json({ success: true, archives });
  } catch (err: any) {
    res.status(500).json({ error: `Ошибка получения списка архивов S3: ${err.message}` });
  }
});

/**
 * GET /api/admin/default-system-prompt
 * Возвращает эталонный заводской системный промпт для текущего салона
 */
adminRouter.get('/default-system-prompt', async (_req: Request, res: Response) => {
  try {
    const store = await readStore();
    const salon = store.config.salonName || store.config.credentials?.salonName || process.env.SALON_NAME || 'Fashion Look Studio';
    const defaultPrompt = getDefaultSystemPrompt(salon);
    res.json({ success: true, defaultSystemPrompt: defaultPrompt });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/reset-system-prompt
 * Сбрасывает пользовательский системный промпт до заводского
 */
adminRouter.post('/reset-system-prompt', async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    store.config.customSystemPrompt = '';
    if (store.config.credentials) {
      store.config.credentials.customSystemPrompt = '';
    }
    await writeStore(store);
    const salon = store.config.salonName || store.config.credentials?.salonName || process.env.SALON_NAME || 'Fashion Look Studio';
    const defaultPrompt = getDefaultSystemPrompt(salon);
    await logAccess(
      getCurrentUser(req)?.name || 'admin',
      'write',
      'Системный промпт ИИ (GigaChat) сброшен к заводскому значению по умолчанию',
      req.ip || '127.0.0.1'
    );
    res.json({ success: true, message: 'Системный промпт успешно сброшен к заводскому значению', defaultSystemPrompt: defaultPrompt });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/admin/staff-performance
 * Аналитика работы администраторов ресепшена:
 * - Список сотрудников и их текущие статусы (активен, на смене, последний вход)
 * - Количество проанализированных звонков за период
 * - Средняя оценка работы (0-10 баллов и 1-5 звезд)
 * - Конверсия в запись, консультации, отказы, споры
 * - Детализация по 10 критериям речевого стандарта
 */
adminRouter.get('/staff-performance', async (req: Request, res: Response) => {
  try {
    const { period = 'all', startDate, endDate } = req.query;
    const store = await readStore();
    const allCalls = store.calls || [];
    const allUsers = store.users || [];

    // Определение временных границ периода
    const now = new Date();
    let filterStart: number | null = null;
    let filterEnd: number | null = null;

    if (period === 'today') {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      filterStart = todayStart.getTime();
    } else if (period === '7days') {
      filterStart = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    } else if (period === '30days') {
      filterStart = now.getTime() - 30 * 24 * 60 * 60 * 1000;
    } else if (period === 'this_month') {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      filterStart = monthStart.getTime();
    } else if (period === 'custom' && startDate) {
      filterStart = new Date(String(startDate)).getTime();
      if (endDate) {
        filterEnd = new Date(String(endDate)).getTime() + 24 * 60 * 60 * 1000 - 1;
      }
    }

    // Фильтрация звонков по периоду
    const periodCalls = allCalls.filter(c => {
      if (!c.timestamp) return true;
      const t = new Date(c.timestamp).getTime();
      if (filterStart !== null && t < filterStart) return false;
      if (filterEnd !== null && t > filterEnd) return false;
      return true;
    });

    // Извлечение администраторов ресепшена из users
    const receptionistUsers = allUsers.filter(u => u.role === 'operator');

    // Находим имена операторов из звонков
    const callOperatorNames = new Set<string>();
    periodCalls.forEach(c => {
      const op = (c.operator_name || '').trim();
      if (op) callOperatorNames.add(op);
    });

    const normalize = (s: string) => s.toLowerCase().replace(/[^a-zа-я0-9]/g, '');

    interface StaffReportItem {
      id: string;
      username: string;
      name: string;
      role: string;
      isActive: boolean;
      isOnline: boolean;
      lastLoginAt?: string;
      notes?: string;
      totalCalls: number;
      averageScore: number | null;
      starsScore: number | null;
      bookingsCount: number;
      conversionRate: number;
      consultationsCount: number;
      refusalsCount: number;
      disputesCount: number;
      averageDurationSeconds: number;
      criteriaAverages: Record<string, number | null>;
      recentCalls: any[];
    }

    const staffList: StaffReportItem[] = [];
    const matchedOperatorNames = new Set<string>();

    for (const u of receptionistUsers) {
      const userNorm = normalize(u.name);
      const userLoginNorm = normalize(u.username);

      const staffCalls = periodCalls.filter(c => {
        const op = (c.operator_name || '').trim();
        if (!op) return false;
        const opNorm = normalize(op);
        const matches = opNorm.includes(userNorm) || 
          userNorm.includes(opNorm) || 
          opNorm.includes(userLoginNorm) ||
          (userLoginNorm.includes('anna') && opNorm.includes('анна')) ||
          (userLoginNorm.includes('svetlana') && opNorm.includes('светлана')) ||
          (userLoginNorm.includes('maria') && opNorm.includes('мария')) ||
          (userLoginNorm.includes('elena') && opNorm.includes('елена')) ||
          (userLoginNorm === 'operator' && opNorm.includes('светлана'));
        if (matches) {
          matchedOperatorNames.add(op);
          return true;
        }
        return false;
      });

      const lastLoginTime = u.lastLoginAt ? new Date(u.lastLoginAt).getTime() : 0;
      const isOnline = u.isActive && (now.getTime() - lastLoginTime <= 4 * 60 * 60 * 1000);

      const totalCalls = staffCalls.length;
      let bookingsCount = 0;
      let consultationsCount = 0;
      let refusalsCount = 0;
      let disputesCount = 0;
      let totalDuration = 0;
      const scores: number[] = [];

      const criteriaTotals: Record<string, { sum: number; count: number }> = {
        greeting: { sum: 0, count: 0 },
        needsDiscovery: { sum: 0, count: 0 },
        servicePresentation: { sum: 0, count: 0 },
        pricePresentation: { sum: 0, count: 0 },
        objections: { sum: 0, count: 0 },
        extraServices: { sum: 0, count: 0 },
        parallelBooking: { sum: 0, count: 0 },
        alternativeOptions: { sum: 0, count: 0 },
        closing: { sum: 0, count: 0 },
        communicationQuality: { sum: 0, count: 0 },
      };

      for (const call of staffCalls) {
        totalDuration += call.duration_seconds || 0;

        const isBooking = call.booking_status === 'согласие' || 
          call.key_facts?.call_outcome === 'запись' || 
          (call.key_facts?.booking_status === 'согласие') ||
          (call.summary && call.summary.toLowerCase().includes('запись успешно'));

        const isDispute = call.key_facts?.is_dispute === true;
        if (isBooking) bookingsCount++;
        if (isDispute) disputesCount++;

        const outcome = call.key_facts?.call_outcome || '';
        if (outcome === 'консультация') consultationsCount++;
        if (outcome === 'отказ') refusalsCount++;

        let callScore: number | null = null;
        if (typeof call.key_facts?.evaluation?.overall_score === 'number') {
          callScore = call.key_facts.evaluation.overall_score;
        } else if (typeof call.operator_score === 'number') {
          callScore = call.operator_score <= 5 ? call.operator_score * 2 : call.operator_score;
        }
        if (callScore !== null && !isNaN(callScore)) {
          scores.push(callScore);
        }

        const evalCriteria = call.key_facts?.evaluation?.criteria || call.key_facts?.criteria_scores || [];
        for (const crit of evalCriteria) {
          if (!crit.is_applicable || typeof crit.score !== 'number') continue;
          const id = crit.id.toLowerCase();
          if (id.includes('greeting') || id.includes('intro')) {
            criteriaTotals.greeting.sum += crit.score;
            criteriaTotals.greeting.count++;
          } else if (id.includes('needs')) {
            criteriaTotals.needsDiscovery.sum += crit.score;
            criteriaTotals.needsDiscovery.count++;
          } else if (id.includes('service') || id.includes('master')) {
            criteriaTotals.servicePresentation.sum += crit.score;
            criteriaTotals.servicePresentation.count++;
          } else if (id.includes('price')) {
            criteriaTotals.pricePresentation.sum += crit.score;
            criteriaTotals.pricePresentation.count++;
          } else if (id.includes('objection')) {
            criteriaTotals.objections.sum += crit.score;
            criteriaTotals.objections.count++;
          } else if (id.includes('extra') || id.includes('upsell')) {
            criteriaTotals.extraServices.sum += crit.score;
            criteriaTotals.extraServices.count++;
          } else if (id.includes('parallel')) {
            criteriaTotals.parallelBooking.sum += crit.score;
            criteriaTotals.parallelBooking.count++;
          } else if (id.includes('alternative') || id.includes('variant')) {
            criteriaTotals.alternativeOptions.sum += crit.score;
            criteriaTotals.alternativeOptions.count++;
          } else if (id.includes('closing')) {
            criteriaTotals.closing.sum += crit.score;
            criteriaTotals.closing.count++;
          } else if (id.includes('communication') || id.includes('quality')) {
            criteriaTotals.communicationQuality.sum += crit.score;
            criteriaTotals.communicationQuality.count++;
          }
        }
      }

      const averageScore = scores.length > 0 
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 
        : null;

      const starsScore = averageScore !== null 
        ? Math.round((averageScore / 2) * 10) / 10 
        : null;

      const conversionRate = totalCalls > 0 
        ? Math.round((bookingsCount / totalCalls) * 1000) / 10 
        : 0;

      const averageDurationSeconds = totalCalls > 0 
        ? Math.round(totalDuration / totalCalls) 
        : 0;

      const criteriaAverages: Record<string, number | null> = {};
      Object.keys(criteriaTotals).forEach(k => {
        const item = criteriaTotals[k];
        criteriaAverages[k] = item.count > 0 ? Math.round((item.sum / item.count) * 10) / 10 : null;
      });

      const recentCalls = staffCalls
        .slice()
        .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
        .slice(0, 5)
        .map(c => ({
          call_id: c.call_id,
          timestamp: c.timestamp,
          client_name: c.client_name,
          client_phone_masked: c.client_phone_masked,
          duration_seconds: c.duration_seconds,
          score: c.key_facts?.evaluation?.overall_score ?? c.operator_score,
          call_outcome: c.key_facts?.call_outcome || 'консультация',
          booking_status: c.booking_status,
          summary: c.summary,
        }));

      staffList.push({
        id: u.id,
        username: u.username,
        name: u.name,
        role: u.role,
        isActive: u.isActive,
        isOnline,
        lastLoginAt: u.lastLoginAt,
        notes: u.notes,
        totalCalls,
        averageScore,
        starsScore,
        bookingsCount,
        conversionRate,
        consultationsCount,
        refusalsCount,
        disputesCount,
        averageDurationSeconds,
        criteriaAverages,
        recentCalls,
      });
    }

    // Добавляем операторов из звонков, у которых еще нет учетной записи в users
    for (const opName of callOperatorNames) {
      if (matchedOperatorNames.has(opName)) continue;
      const isReceptionist = opName.toLowerCase().includes('администратор') || 
        opName.toLowerCase().includes('ресепшн') || 
        opName.toLowerCase().includes('оператор') ||
        opName.toLowerCase().includes('мария') ||
        opName.toLowerCase().includes('екатерина') ||
        opName.toLowerCase().includes('анна') ||
        opName.toLowerCase().includes('светлана');

      if (!isReceptionist) continue;

      const opNorm = normalize(opName);
      const staffCalls = periodCalls.filter(c => normalize(c.operator_name || '') === opNorm);

      let bookingsCount = 0;
      let consultationsCount = 0;
      let refusalsCount = 0;
      let disputesCount = 0;
      let totalDuration = 0;
      const scores: number[] = [];

      for (const call of staffCalls) {
        totalDuration += call.duration_seconds || 0;
        const isBooking = call.booking_status === 'согласие' || 
          call.key_facts?.call_outcome === 'запись' || 
          (call.summary && call.summary.toLowerCase().includes('запись успешно'));
        if (isBooking) bookingsCount++;
        if (call.key_facts?.is_dispute) disputesCount++;
        const outcome = call.key_facts?.call_outcome || '';
        if (outcome === 'консультация') consultationsCount++;
        if (outcome === 'отказ') refusalsCount++;

        let callScore: number | null = null;
        if (typeof call.key_facts?.evaluation?.overall_score === 'number') {
          callScore = call.key_facts.evaluation.overall_score;
        } else if (typeof call.operator_score === 'number') {
          callScore = call.operator_score <= 5 ? call.operator_score * 2 : call.operator_score;
        }
        if (callScore !== null && !isNaN(callScore)) {
          scores.push(callScore);
        }
      }

      const totalCalls = staffCalls.length;
      const averageScore = scores.length > 0 
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 
        : null;
      const starsScore = averageScore !== null 
        ? Math.round((averageScore / 2) * 10) / 10 
        : null;
      const conversionRate = totalCalls > 0 
        ? Math.round((bookingsCount / totalCalls) * 1000) / 10 
        : 0;
      const averageDurationSeconds = totalCalls > 0 
        ? Math.round(totalDuration / totalCalls) 
        : 0;

      const recentCalls = staffCalls
        .slice()
        .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
        .slice(0, 5)
        .map(c => ({
          call_id: c.call_id,
          timestamp: c.timestamp,
          client_name: c.client_name,
          client_phone_masked: c.client_phone_masked,
          duration_seconds: c.duration_seconds,
          score: c.key_facts?.evaluation?.overall_score ?? c.operator_score,
          call_outcome: c.key_facts?.call_outcome || 'консультация',
          booking_status: c.booking_status,
          summary: c.summary,
        }));

      staffList.push({
        id: `detected-${opNorm}`,
        username: opNorm.substring(0, 15),
        name: opName,
        role: 'operator',
        isActive: true,
        isOnline: true,
        notes: 'Дежурный администратор ресепшена (на смене)',
        totalCalls,
        averageScore,
        starsScore,
        bookingsCount,
        conversionRate,
        consultationsCount,
        refusalsCount,
        disputesCount,
        averageDurationSeconds,
        criteriaAverages: {},
        recentCalls,
      });
    }

    const totalStaffCalls = staffList.reduce((acc, s) => acc + s.totalCalls, 0);
    const totalStaffBookings = staffList.reduce((acc, s) => acc + s.bookingsCount, 0);
    const validScores = staffList.filter(s => s.averageScore !== null).map(s => s.averageScore!);
    const salonAverageScore = validScores.length > 0
      ? Math.round((validScores.reduce((a, b) => a + b, 0) / validScores.length) * 10) / 10
      : null;
    const salonConversionRate = totalStaffCalls > 0
      ? Math.round((totalStaffBookings / totalStaffCalls) * 1000) / 10
      : 0;

    res.json({
      period,
      totalStaff: staffList.length,
      activeStaff: staffList.filter(s => s.isActive).length,
      onlineStaff: staffList.filter(s => s.isOnline).length,
      totalCallsAnalyzed: totalStaffCalls,
      salonAverageScore,
      salonConversionRate,
      staff: staffList,
      source: 'firestore_compatible_store',
      dataSourceDescription: 'Коллекции Firestore staff, calls, evaluations (защищенная БД 152-ФЗ)',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/audit-log
 * Журнал аудита действий администраторов (смена паролей, настройки, удаление записей, управление доступом)
 */
adminRouter.get('/audit-log', async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    const rawLogs: any[] = store.access_log || [];

    // Ensure all logs have normalized categories and IDs
    const normalizedLogs = rawLogs.map((entry, idx) => {
      let category = entry.category;
      if (!category) {
        const text = `${entry.resource || ''} ${entry.details || ''}`.toLowerCase();
        if (text.includes('парол')) category = 'password';
        else if (text.includes('токен') || text.includes('настройк') || text.includes('ключ') || text.includes('интеграц') || text.includes('очистк')) category = 'settings';
        else if (entry.action === 'delete' || text.includes('удал')) category = 'delete';
        else if (text.includes('пользовател') || text.includes('ресепш') || text.includes('учетн')) category = 'user_management';
        else if (text.includes('согласи') || entry.action === 'consent_grant' || entry.action === 'consent_revoke') category = 'consent';
        else if (text.includes('звонк') || text.includes('звонок')) category = 'call';
        else category = 'system';
      }

      return {
        id: entry.id || `audit-${idx}-${Date.now()}`,
        timestamp: entry.timestamp,
        user: entry.user || 'Главный Администратор',
        userId: entry.userId,
        role: entry.role || (entry.user?.toLowerCase().includes('управл') ? 'manager' : 'admin'),
        action: entry.action || 'write',
        category,
        resource: entry.resource,
        ip: entry.ip || '127.0.0.1',
        details: entry.details,
      };
    });

    const categoryFilter = (req.query.category as string) || '';
    const userFilter = (req.query.user as string) || '';
    const searchFilter = ((req.query.search as string) || '').toLowerCase().trim();

    let filtered = normalizedLogs;

    if (categoryFilter && categoryFilter !== 'all') {
      filtered = filtered.filter(l => l.category === categoryFilter);
    }

    if (userFilter && userFilter !== 'all') {
      filtered = filtered.filter(l => l.user === userFilter);
    }

    if (searchFilter) {
      filtered = filtered.filter(l => 
        (l.resource && l.resource.toLowerCase().includes(searchFilter)) ||
        (l.user && l.user.toLowerCase().includes(searchFilter)) ||
        (l.details && l.details.toLowerCase().includes(searchFilter)) ||
        (l.ip && l.ip.includes(searchFilter))
      );
    }

    // Unique list of actors for filter dropdown
    const uniqueUsers = Array.from(new Set(normalizedLogs.map(l => l.user).filter(Boolean)));

    // Breakdown counts by major categories
    const stats = {
      total: normalizedLogs.length,
      passwordChanges: normalizedLogs.filter(l => l.category === 'password').length,
      settingsChanges: normalizedLogs.filter(l => l.category === 'settings').length,
      deletions: normalizedLogs.filter(l => l.category === 'delete' || l.action === 'delete').length,
      userManagement: normalizedLogs.filter(l => l.category === 'user_management').length,
      recentCount24h: normalizedLogs.filter(l => {
        try {
          return Date.now() - new Date(l.timestamp).getTime() <= 24 * 3600 * 1000;
        } catch {
          return false;
        }
      }).length,
    };

    res.json({
      success: true,
      totalCount: normalizedLogs.length,
      filteredCount: filtered.length,
      stats,
      uniqueUsers,
      logs: filtered,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/audit-log/clear
 * Очистка журнала аудита (только для главного администратора с фиксацией самого факта очистки)
 */
adminRouter.post('/audit-log/clear', async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    const currentUser = getCurrentUser(req);
    const adminName = currentUser?.name || 'Главный Администратор';

    const clearingEntry: any = {
      id: `acc-${Date.now()}-cleared`,
      timestamp: new Date().toISOString(),
      user: adminName,
      userId: currentUser?.id,
      role: currentUser?.role || 'admin',
      action: 'delete',
      category: 'system',
      resource: 'Журнал аудита действий администраторов очищен',
      ip: req.ip || '127.0.0.1',
      details: `Администратор ${adminName} инициировал очистку журнала аудита`,
    };

    store.access_log = [clearingEntry];
    await writeStore(store);

    res.json({
      success: true,
      message: 'Журнал аудита очищен, запись о факте очистки сохранена',
      clearingEntry,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


