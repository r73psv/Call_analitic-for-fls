/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import type { AppDatabase } from '../store/store.js';
import type { GigaChatModel, GigaamModelVariant } from '../types.js';
import { hashPassword } from '../store/user-store.js';

export type EnvValueSource = 'deploy_env' | 'root_env_file' | 'runtime_env_file' | 'app_runtime' | 'store_migration';

/**
 * Strict allowlist of server environment variables that can be read into application
 * secrets/configuration and persisted back to the server `.env` file when updated
 * through the application after deployment.
 */
export const MANAGED_SERVER_ENV_KEYS = new Set<string>([
  // General & Security
  'ADMIN_PASSWORD',
  'ADMIN_INITIAL_PASSWORD',
  'STORE_ENCRYPTION_KEY',
  'SALON_NAME',

  // GigaChat (Sber)
  'GIGACHAT_AUTH_KEY',
  'GIGACHAT_CREDENTIALS',
  'GIGACHAT_SCOPE',
  'GIGACHAT_MODEL',
  'GIGACHAT_DEFAULT_MODEL',

  // STT selection
  'STT_PROVIDER',

  // Yandex Cloud SpeechKit & IAM
  'YC_API_KEY',
  'YC_FOLDER_ID',
  'YC_SERVICE_ACCOUNT_ID',
  'YC_SERVICE_ACCOUNT_KEY_FILE',
  'YC_SERVICE_ACCOUNT_KEY_JSON',

  // T-Bank VoiceKit
  'TBANK_VOICEKIT_API_KEY',
  'TBANK_VOICEKIT_SECRET_KEY',
  'TBANK_VOICEKIT_ENDPOINT',

  // GigaASR / GigaAM v3
  'GIGAAM_API_URL',
  'GIGAAM_API_KEY',
  'GIGAAM_MODEL_VARIANT',

  // Yandex Object Storage (SpeechKit async audio)
  'YC_STORAGE_BUCKET',
  'YC_STORAGE_ACCESS_KEY',
  'YC_STORAGE_SECRET_KEY',
  'YC_S3_KEY_ID',
  'YC_S3_SECRET_KEY',
  'YC_STORAGE_ENDPOINT',
  'YC_STORAGE_REGION',

  // S3 Timeweb Cloud (152-FZ encrypted DB backups)
  'S3_ENDPOINT',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'S3_BUCKET_NAME',
  'S3_KEY_PREFIX',
  'S3_REGION',

  // Megafon VATS
  'MEGAFON_API_VERSION',
  'MEGAFON_TOKEN',
  'MEGAFON_REST_DOMAIN',
  'MEGAFON_REST_TOKEN',
  'MEGAFON_CRM_TOKEN',
  'MEGAFON_LK_LOGIN',
  'MEGAFON_LK_PASSWORD',

  // VK notifications
  'VK_TOKEN',
  'VK_CHAT_ID',

  // YClients CRM (строго чтение списка мастеров)
  'YCLIENTS_LOGIN',
  'YCLIENTS_PASSWORD',
  'YCLIENTS_PARTNER_TOKEN',
  'YCLIENTS_SALON_ID',
  'YCLIENTS_USER_TOKEN',
]);

/** Canonical alias pairs kept in sync when either side is loaded or updated. */
const ALIAS_GROUPS: Array<string[]> = [
  ['GIGACHAT_AUTH_KEY', 'GIGACHAT_CREDENTIALS'],
  ['GIGACHAT_MODEL', 'GIGACHAT_DEFAULT_MODEL'],
  ['YC_STORAGE_ACCESS_KEY', 'YC_S3_KEY_ID'],
  ['YC_STORAGE_SECRET_KEY', 'YC_S3_SECRET_KEY'],
  ['ADMIN_PASSWORD', 'ADMIN_INITIAL_PASSWORD'],
];

const PLACEHOLDER_SECRETS = new Set<string>([
  '<ключ-авторизации-GigaChat>',
  'megafon_ats_auth_token_example_123',
  'vk_group_api_token_example_xyz',
  'yclients_user_token_example_777',
  'yclients_partner_token_example_888',
]);

const VALID_GIGACHAT_MODELS = new Set<GigaChatModel>([
  'GigaChat:Lite',
  'GigaChat:Pro',
  'GigaChat:Max',
  'GigaChat:Ultra',
]);

const VALID_GIGAAM_VARIANTS = new Set<string>([
  'GigaChat/GigaASR',
  'GigaChat/SaluteSpeech',
  'openai/whisper-large-v3',
  'sber/GigaASR',
  'e2e_rnnt',
  'e2e_ctc',
  'rnnt',
  'ctc',
]);

const envSources = new Map<string, EnvValueSource>();
let hasLoadedServerEnv = false;

export function isPlaceholderSecret(val?: string | null): boolean {
  if (!val) return true;
  const trimmed = val.trim();
  if (!trimmed) return true;
  return PLACEHOLDER_SECRETS.has(trimmed);
}

export function getEnvValue(...names: string[]): string {
  for (const name of names) {
    const raw = process.env[name];
    if (typeof raw === 'string' && !isPlaceholderSecret(raw)) {
      return raw.trim();
    }
  }
  return '';
}

/**
 * Resolves the primary persistent server `.env` file path and optional workspace `.env` mirror.
 *
 * In Docker deployments, `ENV_FILE_PATH` defaults to `/app/data/.env` (stored on the
 * mounted `/app/data` volume so secrets entered in the UI survive container restarts).
 */
export function resolveServerEnvPaths(overrides?: {
  primaryEnvPath?: string;
  workspaceEnvPath?: string;
}): { primaryEnvPath: string; workspaceEnvPath: string } {
  const workspaceEnvPath = overrides?.workspaceEnvPath
    ? path.resolve(overrides.workspaceEnvPath)
    : path.resolve(process.cwd(), '.env');

  if (overrides?.primaryEnvPath) {
    return {
      primaryEnvPath: path.resolve(overrides.primaryEnvPath),
      workspaceEnvPath,
    };
  }

  const explicitEnvFile = (process.env.ENV_FILE_PATH || '').trim();
  if (explicitEnvFile) {
    return {
      primaryEnvPath: path.resolve(explicitEnvFile),
      workspaceEnvPath,
    };
  }

  const dataRef = (process.env.DATA_PATH_ENC || process.env.DATA_PATH || '').trim();
  if (dataRef) {
    return {
      primaryEnvPath: path.resolve(path.dirname(dataRef), '.env'),
      workspaceEnvPath,
    };
  }

  return {
    primaryEnvPath: path.resolve(process.cwd(), 'data', '.env'),
    workspaceEnvPath,
  };
}

/**
 * Escapes a value into a single-line `.env` assignment safely parseable by `dotenv.parse`.
 * Prevents newline injection or accidental comment truncation (`#`).
 */
export function formatEnvValue(value: string): string {
  const str = String(value ?? '');
  if (str === '') return '';

  // Simple alphanumeric / URL-safe tokens without whitespace, quotes, #, $, \, or newlines
  if (/^[A-Za-z0-9_./:@+-]+$/.test(str)) {
    return str;
  }

  const hasRawNewline = /[\r\n]/.test(str);

  // Single quotes in dotenv.parse preserve the exact literal string (including JSON \" and \\n)
  if (!hasRawNewline && !str.includes("'")) {
    return `'${str}'`;
  }

  // Backticks in dotenv.parse preserve the exact literal string even when containing both ' and "
  if (!hasRawNewline && !str.includes('`')) {
    return `\`${str}\``;
  }

  // Fallback for strings with raw newlines: flatten to single line inside double quotes
  // so every key=value stays strictly one line and cannot inject new env keys.
  const escaped = str
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Updates or inserts key=value pairs in an existing `.env` file string while preserving
 * existing comments, blank lines, and unrelated deployment variables.
 */
export function mergeEnvFileContent(
  existingContent: string,
  updates: Record<string, string>
): string {
  const keysToApply = Object.keys(updates).filter((k) => MANAGED_SERVER_ENV_KEYS.has(k));
  if (keysToApply.length === 0) {
    return existingContent;
  }

  const remaining = new Map<string, string>();
  for (const k of keysToApply) {
    remaining.set(k, updates[k]);
  }

  const lines = existingContent ? existingContent.replace(/\r\n/g, '\n').split('\n') : [];
  // Remove trailing empty line caused by final newline so we don't accumulate blank lines
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  const outLines: string[] = [];
  const keyLineRe = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

  for (const line of lines) {
    const match = line.match(keyLineRe);
    if (match && remaining.has(match[1])) {
      const key = match[1];
      const nextVal = remaining.get(key)!;
      remaining.delete(key);
      outLines.push(`${key}=${formatEnvValue(nextVal)}`);
    } else {
      outLines.push(line);
    }
  }

  if (remaining.size > 0) {
    if (outLines.length > 0 && outLines[outLines.length - 1].trim() !== '') {
      outLines.push('');
    }
    const hasManagedHeader = outLines.some((l) => l.includes('# Saved via CallQA Server Runtime'));
    if (!hasManagedHeader) {
      outLines.push('# Saved via CallQA Server Runtime');
    }
    for (const [key, val] of remaining.entries()) {
      outLines.push(`${key}=${formatEnvValue(val)}`);
    }
  }

  return outLines.join('\n') + '\n';
}

function writeEnvFileAtomic(filePath: string, updates: Record<string, string>): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
  const merged = mergeEnvFileContent(existing, updates);
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmpPath, merged, { encoding: 'utf-8', mode: 0o600 });
  try {
    fs.chmodSync(tmpPath, 0o600);
  } catch {
    // ignore on filesystems that don't support chmod
  }
  fs.renameSync(tmpPath, filePath);
}

function syncCanonicalAliases(targetKeys?: Iterable<string>): void {
  const filterSet = targetKeys ? new Set(targetKeys) : null;
  for (const group of ALIAS_GROUPS) {
    const primary = group[0];
    const secondary = group[1];
    if (filterSet && !filterSet.has(primary) && !filterSet.has(secondary)) {
      continue;
    }
    const primaryVal = (process.env[primary] || '').trim();
    const secondaryVal = (process.env[secondary] || '').trim();

    if (filterSet?.has(primary) && !filterSet?.has(secondary)) {
      process.env[secondary] = primaryVal;
      continue;
    }
    if (filterSet?.has(secondary) && !filterSet?.has(primary)) {
      process.env[primary] = secondaryVal;
      continue;
    }

    if (primaryVal && !secondaryVal) {
      process.env[secondary] = primaryVal;
    } else if (secondaryVal && !primaryVal) {
      process.env[primary] = secondaryVal;
    }
  }
}

export interface LoadServerEnvOptions {
  primaryEnvPath?: string;
  workspaceEnvPath?: string;
  forceReload?: boolean;
  silent?: boolean;
}

/**
 * Loads server environment variables on startup in deterministic order:
 * 1. Deployment server environment variables already present in `process.env`.
 * 2. Workspace `.env` file (populates keys that are undefined or empty `""` such as Dockerfile `ENV KEY=` stubs).
 * 3. Persistent runtime `.env` file (`ENV_FILE_PATH` / `/app/data/.env`) containing secrets saved
 *    in the application after deployment — applied for all managed keys saved in that file.
 */
export function loadServerEnvironment(options: LoadServerEnvOptions = {}): {
  primaryEnvPath: string;
  workspaceEnvPath: string;
  loadedFromDeployEnv: string[];
  loadedFromRootFile: string[];
  loadedFromRuntimeFile: string[];
} {
  const { primaryEnvPath, workspaceEnvPath } = resolveServerEnvPaths(options);

  if (hasLoadedServerEnv && !options.forceReload) {
    return {
      primaryEnvPath,
      workspaceEnvPath,
      loadedFromDeployEnv: Array.from(envSources.entries()).filter(([, s]) => s === 'deploy_env').map(([k]) => k),
      loadedFromRootFile: Array.from(envSources.entries()).filter(([, s]) => s === 'root_env_file').map(([k]) => k),
      loadedFromRuntimeFile: Array.from(envSources.entries()).filter(([, s]) => s === 'runtime_env_file').map(([k]) => k),
    };
  }

  envSources.clear();
  const loadedFromDeployEnv: string[] = [];
  const loadedFromRootFile: string[] = [];
  const loadedFromRuntimeFile: string[] = [];

  // 1. Record non-empty deployment server env variables already in process.env
  for (const key of MANAGED_SERVER_ENV_KEYS) {
    const val = process.env[key];
    if (typeof val === 'string' && !isPlaceholderSecret(val)) {
      envSources.set(key, 'deploy_env');
      loadedFromDeployEnv.push(key);
    }
  }

  // 2. Load workspace .env (fills missing or empty-string Dockerfile placeholders)
  if (fs.existsSync(workspaceEnvPath)) {
    try {
      const parsedRoot = dotenv.parse(fs.readFileSync(workspaceEnvPath, 'utf-8'));
      for (const [key, val] of Object.entries(parsedRoot)) {
        const existing = process.env[key];
        const isExistingEmpty = existing === undefined || existing.trim() === '' || isPlaceholderSecret(existing);
        if (isExistingEmpty && typeof val === 'string' && val.trim() !== '') {
          process.env[key] = val.trim();
          if (MANAGED_SERVER_ENV_KEYS.has(key)) {
            envSources.set(key, 'root_env_file');
            loadedFromRootFile.push(key);
          }
        }
      }
    } catch (err: any) {
      if (!options.silent) {
        console.warn(`[ServerEnv] Не удалось прочитать ${workspaceEnvPath}: ${err.message}`);
      }
    }
  }

  // 3. Load persistent runtime .env (secrets entered in the app after deployment)
  if (primaryEnvPath !== workspaceEnvPath && fs.existsSync(primaryEnvPath)) {
    try {
      const parsedRuntime = dotenv.parse(fs.readFileSync(primaryEnvPath, 'utf-8'));
      for (const [key, val] of Object.entries(parsedRuntime)) {
        if (!MANAGED_SERVER_ENV_KEYS.has(key)) {
          // For non-managed vars only fill if unset/empty
          if (process.env[key] === undefined || process.env[key] === '') {
            process.env[key] = val;
          }
          continue;
        }
        const trimmed = typeof val === 'string' ? val.trim() : '';
        if (trimmed !== '') {
          process.env[key] = trimmed;
          envSources.set(key, 'runtime_env_file');
          loadedFromRuntimeFile.push(key);
        }
      }
    } catch (err: any) {
      if (!options.silent) {
        console.warn(`[ServerEnv] Не удалось прочитать ${primaryEnvPath}: ${err.message}`);
      }
    }
  }

  syncCanonicalAliases();
  hasLoadedServerEnv = true;

  if (!options.silent) {
    console.log(
      `[ServerEnv] Инициализация переменных окружения завершена ` +
      `(deploy_env: ${loadedFromDeployEnv.length}, .env: ${loadedFromRootFile.length}, ` +
      `runtime ${primaryEnvPath}: ${loadedFromRuntimeFile.length})`
    );
  }

  return {
    primaryEnvPath,
    workspaceEnvPath,
    loadedFromDeployEnv,
    loadedFromRootFile,
    loadedFromRuntimeFile,
  };
}

export interface PersistServerEnvOptions {
  primaryEnvPath?: string;
  workspaceEnvPath?: string;
  mirrorToWorkspace?: boolean;
  silent?: boolean;
}

export interface PersistServerEnvResult {
  savedKeys: string[];
  persistedFiles: string[];
  warnings: string[];
}

/**
 * Updates `process.env` immediately and persists the given managed secret/config variables
 * to the server's `.env` file(s) so secrets entered in the app after deploy survive restarts.
 */
export function persistServerEnvVars(
  rawUpdates: Record<string, string | undefined | null>,
  options: PersistServerEnvOptions = {}
): PersistServerEnvResult {
  const sanitized: Record<string, string> = {};

  for (const [key, rawVal] of Object.entries(rawUpdates)) {
    if (rawVal === undefined || rawVal === null) continue;
    if (!MANAGED_SERVER_ENV_KEYS.has(key)) continue;
    const cleaned = String(rawVal).trim();
    sanitized[key] = cleaned;
  }

  // Keep alias pairs synchronized in both process.env and persisted .env
  for (const [primary, secondary] of ALIAS_GROUPS) {
    if (primary in sanitized && !(secondary in sanitized)) {
      sanitized[secondary] = sanitized[primary];
    } else if (secondary in sanitized && !(primary in sanitized)) {
      sanitized[primary] = sanitized[secondary];
    }
  }

  const savedKeys = Object.keys(sanitized);
  if (savedKeys.length === 0) {
    return { savedKeys: [], persistedFiles: [], warnings: [] };
  }

  // 1. Update live server process.env immediately
  for (const [key, val] of Object.entries(sanitized)) {
    process.env[key] = val;
    envSources.set(key, 'app_runtime');
  }
  syncCanonicalAliases(savedKeys);

  // 2. Persist atomically to server .env file(s) with 0o600 permissions
  const { primaryEnvPath, workspaceEnvPath } = resolveServerEnvPaths(options);
  const persistedFiles: string[] = [];
  const warnings: string[] = [];

  try {
    writeEnvFileAtomic(primaryEnvPath, sanitized);
    persistedFiles.push(primaryEnvPath);
  } catch (err: any) {
    const msg = `Не удалось записать серверный env-файл ${primaryEnvPath}: ${err.message}`;
    warnings.push(msg);
    if (!options.silent) {
      console.warn(`[ServerEnv] ${msg}`);
    }
  }

  const shouldMirror = options.mirrorToWorkspace !== false && workspaceEnvPath !== primaryEnvPath;
  if (shouldMirror) {
    try {
      // Only mirror to workspace .env if directory is writable (bare-metal / VPS / dev).
      // In read-only container filesystems, primaryEnvPath (/app/data/.env) is the persistent store.
      fs.accessSync(path.dirname(workspaceEnvPath), fs.constants.W_OK);
      writeEnvFileAtomic(workspaceEnvPath, sanitized);
      persistedFiles.push(workspaceEnvPath);
    } catch {
      // Non-fatal in containerized / read-only app root environments
    }
  }

  if (!options.silent) {
    console.log(
      `[ServerEnv] Сохранены переменные окружения на сервере (${savedKeys.join(', ')}) -> ${persistedFiles.join(', ') || 'только в памяти'}`
    );
  }

  return { savedKeys, persistedFiles, warnings };
}

/**
 * Returns non-sensitive metadata about where each managed environment variable was loaded from.
 */
export function getServerEnvStatus(overrides?: {
  primaryEnvPath?: string;
  workspaceEnvPath?: string;
}): {
  primaryEnvPath: string;
  workspaceEnvPath: string;
  primaryEnvExists: boolean;
  configuredKeys: string[];
  sources: Record<string, EnvValueSource>;
} {
  const { primaryEnvPath, workspaceEnvPath } = resolveServerEnvPaths(overrides);
  const configuredKeys: string[] = [];
  const sources: Record<string, EnvValueSource> = {};

  for (const key of MANAGED_SERVER_ENV_KEYS) {
    const val = process.env[key];
    if (typeof val === 'string' && !isPlaceholderSecret(val)) {
      configuredKeys.push(key);
      sources[key] = envSources.get(key) || 'deploy_env';
    }
  }

  return {
    primaryEnvPath,
    workspaceEnvPath,
    primaryEnvExists: fs.existsSync(primaryEnvPath),
    configuredKeys,
    sources,
  };
}

/**
 * Synchronizes `db.config` and `db.config.credentials` with server `process.env`.
 *
 * Precedence rules:
 * 1. Any non-empty server `process.env` variable ALWAYS hydrates into `db.config` so secrets
 *    configured on the deployment server take immediate effect even on existing databases or
 *    after S3 snapshot restores.
 * 2. Legacy upgrade safety: if `process.env` is empty for a secret, and an existing `data-store.enc`
 *    already holds a non-placeholder value, it is backfilled into `process.env` and persisted once
 *    to the server `.env` file so upgrades never lose previously entered keys.
 */
export function hydrateStoreFromServerEnv(
  db: AppDatabase,
  options: { persistLegacyMigration?: boolean; silent?: boolean } = {}
): { hydratedFromEnv: string[]; migratedFromStore: string[] } {
  if (!db.config) {
    return { hydratedFromEnv: [], migratedFromStore: [] };
  }
  if (!db.config.credentials) {
    db.config.credentials = {};
  }
  if (!db.config.megafon) {
    db.config.megafon = {
      apiVersion: 'json_rpc',
      token: '',
      webhookUrl: '/api/calls/webhook',
      autoImport: false,
      active: false,
      pollingEnabled: false,
      pollingIntervalMinutes: 5,
    };
  }
  if (!db.config.vk) {
    db.config.vk = {
      token: '',
      chatId: '',
      enabled: false,
      template: '',
    };
  }
  if (!db.config.yclients) {
    db.config.yclients = {
      login: '',
      password: '',
      partnerToken: '',
      salonId: '',
      enabled: false,
      readOnly: true,
    };
  } else {
    db.config.yclients.readOnly = true;
  }

  const creds = db.config.credentials;
  const hydratedFromEnv: string[] = [];
  const legacyToPersist: Record<string, string> = {};

  const syncField = (
    envNames: string[],
    getStoreVal: () => string | undefined,
    setStoreVal: (val: string) => void,
    cleanPlaceholders: boolean = true
  ) => {
    const primaryEnvName = envNames[0];
    const envVal = getEnvValue(...envNames);
    const rawStoreVal = (getStoreVal() || '').trim();
    const validStoreVal = cleanPlaceholders && isPlaceholderSecret(rawStoreVal) ? '' : rawStoreVal;

    if (cleanPlaceholders && rawStoreVal && !validStoreVal) {
      // Scrub hardcoded example placeholder tokens
      setStoreVal('');
    }

    if (envVal) {
      if (validStoreVal !== envVal) {
        setStoreVal(envVal);
      }
      hydratedFromEnv.push(primaryEnvName);
    } else if (validStoreVal) {
      // Backfill legacy secret from store into server process.env
      for (const envName of envNames) {
        process.env[envName] = validStoreVal;
      }
      envSources.set(primaryEnvName, 'store_migration');
      legacyToPersist[primaryEnvName] = validStoreVal;
    }
  };

  // Salon name
  syncField(
    ['SALON_NAME'],
    () => db.config.salonName || creds.salonName,
    (v) => {
      db.config.salonName = v;
      creds.salonName = v;
    },
    false
  );

  // GigaChat
  syncField(
    ['GIGACHAT_AUTH_KEY', 'GIGACHAT_CREDENTIALS'],
    () => creds.gigachatAuthKey,
    (v) => {
      creds.gigachatAuthKey = v;
    }
  );
  syncField(
    ['GIGACHAT_SCOPE'],
    () => creds.gigachatScope,
    (v) => {
      creds.gigachatScope = v;
    },
    false
  );
  syncField(
    ['GIGACHAT_MODEL', 'GIGACHAT_DEFAULT_MODEL'],
    () => creds.gigachatModel || db.config.default_gigachat_model,
    (v) => {
      if (VALID_GIGACHAT_MODELS.has(v as GigaChatModel)) {
        creds.gigachatModel = v as GigaChatModel;
        db.config.default_gigachat_model = v as GigaChatModel;
        db.config.activeModel = v as GigaChatModel;
      }
    },
    false
  );

  // STT Provider
  syncField(
    ['STT_PROVIDER'],
    () => creds.transcriptionModel || db.config.transcriptionModel,
    (v) => {
      if (v === 'yandex_speechkit' || v === 'tbank_voicekit' || v === 'gigaam_v3') {
        db.config.transcriptionModel = v;
        creds.transcriptionModel = v;
      }
    },
    false
  );

  // Yandex SpeechKit & IAM
  syncField(['YC_API_KEY'], () => creds.yandexApiKey, (v) => { creds.yandexApiKey = v; });
  syncField(['YC_FOLDER_ID'], () => creds.yandexFolderId, (v) => { creds.yandexFolderId = v; }, false);
  syncField(['YC_SERVICE_ACCOUNT_ID'], () => creds.yandexServiceAccountId, (v) => { creds.yandexServiceAccountId = v; }, false);
  syncField(['YC_SERVICE_ACCOUNT_KEY_FILE'], () => creds.yandexServiceAccountKeyFile, (v) => { creds.yandexServiceAccountKeyFile = v; }, false);
  syncField(['YC_SERVICE_ACCOUNT_KEY_JSON'], () => creds.yandexServiceAccountKeyJson, (v) => { creds.yandexServiceAccountKeyJson = v; });

  // T-Bank VoiceKit
  syncField(['TBANK_VOICEKIT_API_KEY'], () => creds.tbankApiKey, (v) => { creds.tbankApiKey = v; });
  syncField(['TBANK_VOICEKIT_SECRET_KEY'], () => creds.tbankSecretKey, (v) => { creds.tbankSecretKey = v; });

  // GigaAM / GigaASR
  syncField(['GIGAAM_API_URL'], () => creds.gigaamApiUrl, (v) => { creds.gigaamApiUrl = v; }, false);
  syncField(['GIGAAM_API_KEY'], () => creds.gigaamApiKey, (v) => { creds.gigaamApiKey = v; });
  syncField(
    ['GIGAAM_MODEL_VARIANT'],
    () => creds.gigaamVariant,
    (v) => {
      if (VALID_GIGAAM_VARIANTS.has(v)) {
        creds.gigaamVariant = v as GigaamModelVariant;
      }
    },
    false
  );

  // 152-FZ Store encryption key
  syncField(['STORE_ENCRYPTION_KEY'], () => creds.storeEncryptionKey, (v) => { creds.storeEncryptionKey = v; });

  // Yandex Object Storage
  syncField(['YC_STORAGE_BUCKET'], () => creds.yandexStorageBucket, (v) => { creds.yandexStorageBucket = v; }, false);
  syncField(['YC_STORAGE_ACCESS_KEY', 'YC_S3_KEY_ID'], () => creds.yandexStorageAccessKey, (v) => { creds.yandexStorageAccessKey = v; });
  syncField(['YC_STORAGE_SECRET_KEY', 'YC_S3_SECRET_KEY'], () => creds.yandexStorageSecretKey, (v) => { creds.yandexStorageSecretKey = v; });
  syncField(['YC_STORAGE_ENDPOINT'], () => creds.yandexStorageEndpoint, (v) => { creds.yandexStorageEndpoint = v; }, false);
  syncField(['YC_STORAGE_REGION'], () => creds.yandexStorageRegion, (v) => { creds.yandexStorageRegion = v; }, false);

  // S3 Timeweb Cloud
  syncField(['S3_ENDPOINT'], () => creds.s3Endpoint, (v) => { creds.s3Endpoint = v; }, false);
  syncField(['S3_ACCESS_KEY'], () => creds.s3AccessKey, (v) => { creds.s3AccessKey = v; });
  syncField(['S3_SECRET_KEY'], () => creds.s3SecretKey, (v) => { creds.s3SecretKey = v; });
  syncField(['S3_BUCKET_NAME'], () => creds.s3BucketName, (v) => { creds.s3BucketName = v; }, false);
  syncField(['S3_KEY_PREFIX'], () => creds.s3KeyPrefix, (v) => { creds.s3KeyPrefix = v; }, false);
  syncField(['S3_REGION'], () => creds.s3Region, (v) => { creds.s3Region = v; }, false);

  // Megafon VATS
  syncField(
    ['MEGAFON_API_VERSION'],
    () => creds.megafonApiVersion || db.config.megafon.apiVersion,
    (v) => {
      const normalized = v === 'rest_wcgp' ? 'rest_wcgp' : 'json_rpc';
      creds.megafonApiVersion = normalized;
      db.config.megafon.apiVersion = normalized;
    },
    false
  );
  syncField(
    ['MEGAFON_TOKEN'],
    () => creds.megafonToken || db.config.megafon.token,
    (v) => {
      creds.megafonToken = v;
      db.config.megafon.token = v;
      if (v) db.config.megafon.active = true;
    }
  );
  syncField(
    ['MEGAFON_REST_DOMAIN'],
    () => creds.megafonRestDomain || db.config.megafon.restDomain,
    (v) => {
      creds.megafonRestDomain = v;
      db.config.megafon.restDomain = v;
    },
    false
  );
  syncField(
    ['MEGAFON_REST_TOKEN'],
    () => creds.megafonRestToken || db.config.megafon.restToken,
    (v) => {
      creds.megafonRestToken = v;
      db.config.megafon.restToken = v;
      if (v) db.config.megafon.active = true;
    }
  );
  syncField(
    ['MEGAFON_CRM_TOKEN'],
    () => creds.megafonCrmToken || db.config.megafon.crmToken,
    (v) => {
      creds.megafonCrmToken = v;
      db.config.megafon.crmToken = v;
    }
  );
  syncField(
    ['MEGAFON_LK_LOGIN'],
    () => creds.megafonLkLogin || db.config.megafon.lkLogin,
    (v) => {
      creds.megafonLkLogin = v;
      db.config.megafon.lkLogin = v;
    },
    false
  );
  syncField(
    ['MEGAFON_LK_PASSWORD'],
    () => creds.megafonLkPassword || db.config.megafon.lkPassword,
    (v) => {
      creds.megafonLkPassword = v;
      db.config.megafon.lkPassword = v;
    }
  );

  // VK
  syncField(
    ['VK_TOKEN'],
    () => creds.vkToken || db.config.vk.token,
    (v) => {
      creds.vkToken = v;
      db.config.vk.token = v;
    }
  );
  syncField(
    ['VK_CHAT_ID'],
    () => creds.vkChatId || db.config.vk.chatId,
    (v) => {
      creds.vkChatId = v;
      db.config.vk.chatId = v;
    },
    false
  );

  // YClients (только чтение мастеров: логин, пароль, Partner Token, ID салона)
  syncField(
    ['YCLIENTS_LOGIN'],
    () => creds.yclientsLogin || db.config.yclients.login,
    (v) => {
      creds.yclientsLogin = v;
      db.config.yclients.login = v;
    },
    false
  );
  syncField(
    ['YCLIENTS_PASSWORD'],
    () => creds.yclientsPassword || db.config.yclients.password,
    (v) => {
      creds.yclientsPassword = v;
      db.config.yclients.password = v;
    }
  );
  syncField(
    ['YCLIENTS_USER_TOKEN'],
    () => creds.yclientsUserToken || db.config.yclients.userToken,
    (v) => {
      creds.yclientsUserToken = v;
      db.config.yclients.userToken = v;
    }
  );
  syncField(
    ['YCLIENTS_PARTNER_TOKEN'],
    () => creds.yclientsPartnerToken || db.config.yclients.partnerToken,
    (v) => {
      creds.yclientsPartnerToken = v;
      db.config.yclients.partnerToken = v;
    }
  );
  syncField(
    ['YCLIENTS_SALON_ID'],
    () => creds.yclientsSalonId || db.config.yclients.salonId,
    (v) => {
      creds.yclientsSalonId = v;
      db.config.yclients.salonId = v;
    },
    false
  );
  db.config.yclients.readOnly = true;

  // Sync admin user password hash when ADMIN_PASSWORD is supplied from server environment
  const envAdminPwd = getEnvValue('ADMIN_PASSWORD', 'ADMIN_INITIAL_PASSWORD');
  if (envAdminPwd && Array.isArray(db.users)) {
    const adminUser = db.users.find((u) => u.username === 'admin' && u.role === 'admin');
    const source = envSources.get('ADMIN_PASSWORD') || envSources.get('ADMIN_INITIAL_PASSWORD');
    // Only override stored hash automatically when ADMIN_PASSWORD is non-default or comes from runtime env file
    if (adminUser && (envAdminPwd !== 'admin123' || source === 'runtime_env_file')) {
      const hashed = hashPassword(envAdminPwd, adminUser.salt);
      if (hashed.hash !== adminUser.passwordHash) {
        const fresh = hashPassword(envAdminPwd);
        adminUser.passwordHash = fresh.hash;
        adminUser.salt = fresh.salt;
        creds.adminPasswordHash = fresh.hash;
        creds.adminPasswordSalt = fresh.salt;
      }
    }
  }

  const migratedFromStore = Object.keys(legacyToPersist);
  const isNodeTestRunner = process.execArgv.includes('--test') || process.argv.includes('--test');
  if (migratedFromStore.length > 0 && options.persistLegacyMigration !== false && !isNodeTestRunner) {
    persistServerEnvVars(legacyToPersist, { silent: options.silent });
  }

  return { hydratedFromEnv, migratedFromStore };
}

/** Test-only helper to reset loader state between isolated unit test cases. */
export function resetServerEnvStateForTests(): void {
  envSources.clear();
  hasLoadedServerEnv = false;
}
