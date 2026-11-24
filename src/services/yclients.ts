/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import { readStoreSync } from '../store/store.js';
import { getEnvValue } from './serverEnv.js';

/**
 * Интеграция YClients работает СТРОГО в режиме «только чтение» (read-only)
 * исключительно для получения списка мастеров салона.
 * Любая запись/модификация данных в YClients запрещена.
 */
export const YCLIENTS_READ_ONLY = true as const;

const YCLIENTS_API_BASE = 'https://api.yclients.com/api/v1';
const YCLIENTS_ACCEPT_HEADER = 'application/vnd.yclients.v2+json';
const AUTH_TOKEN_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MASTERS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const REQUEST_TIMEOUT_MS = 10_000;

export interface YclientsCredentialsInput {
  login?: string;
  password?: string;
  partnerToken?: string;
  salonId?: string;
  enabled?: boolean;
}

export interface EffectiveYclientsConfig {
  login: string;
  password: string;
  partnerToken: string;
  salonId: string;
  enabled: boolean;
  readOnly: true;
}

export interface YclientsMaster {
  id: number;
  name: string;
  specialization?: string;
  position?: string;
  bookable?: boolean;
}

export interface YclientsReadOnlyTestResult {
  success: boolean;
  readOnly: true;
  message?: string;
  error?: string;
  mastersCount?: number;
  masters?: YclientsMaster[];
}

type FetchLike = typeof fetch;

interface CachedAuthToken {
  fingerprint: string;
  userToken: string;
  obtainedAt: number;
}

interface CachedMasters {
  fingerprint: string;
  masters: YclientsMaster[];
  fetchedAt: number;
}

let cachedAuthToken: CachedAuthToken | null = null;
let cachedMasters: CachedMasters | null = null;

function isPlaceholderValue(value: string): boolean {
  const v = value.trim().toLowerCase();
  return !v || v.includes('example') || v === '••••••••';
}

function buildConfigFingerprint(cfg: Pick<EffectiveYclientsConfig, 'login' | 'password' | 'partnerToken' | 'salonId'>): string {
  return crypto
    .createHash('sha256')
    .update(`${cfg.login}\0${cfg.password}\0${cfg.partnerToken}\0${cfg.salonId}`)
    .digest('hex');
}

function buildAuthFingerprint(cfg: Pick<EffectiveYclientsConfig, 'login' | 'password' | 'partnerToken'>): string {
  return crypto
    .createHash('sha256')
    .update(`${cfg.login}\0${cfg.password}\0${cfg.partnerToken}`)
    .digest('hex');
}

/**
 * Строгая валидация ID салона YClients (допустимы только цифры),
 * предотвращающая подстановку произвольных путей в URL API.
 */
export function isValidYclientsSalonId(salonId: string): boolean {
  return /^\d{1,15}$/.test(salonId.trim());
}

/**
 * Очищает кэш авторизации и кэш списка мастеров YClients
 * (вызывается при обновлении учётных данных).
 */
export function clearYclientsCache(): void {
  cachedAuthToken = null;
  cachedMasters = null;
}

/**
 * Разрешает эффективные настройки YClients с приоритетом серверных
 * переменных окружения (`YCLIENTS_LOGIN`, `YCLIENTS_PASSWORD`,
 * `YCLIENTS_PARTNER_TOKEN`, `YCLIENTS_SALON_ID`).
 */
export function getEffectiveYclientsConfig(overrides?: YclientsCredentialsInput): EffectiveYclientsConfig {
  let storeCreds: Record<string, any> = {};
  let storeYc: Record<string, any> = {};

  try {
    const store = readStoreSync();
    storeCreds = (store?.config?.credentials || {}) as Record<string, any>;
    storeYc = (store?.config?.yclients || {}) as Record<string, any>;
  } catch {
    // Store may be unavailable during early bootstrap or isolated unit tests
  }

  const pick = (overrideVal: string | undefined, envName: string, storeCredVal: unknown, storeYcVal: unknown): string => {
    if (overrideVal !== undefined && overrideVal.trim() !== '' && overrideVal.trim() !== '••••••••') {
      return overrideVal.trim();
    }
    const envVal = getEnvValue(envName);
    if (envVal) return envVal;
    const fromCreds = typeof storeCredVal === 'string' ? storeCredVal.trim() : '';
    if (fromCreds && !isPlaceholderValue(fromCreds)) return fromCreds;
    const fromYc = typeof storeYcVal === 'string' ? storeYcVal.trim() : '';
    if (fromYc && !isPlaceholderValue(fromYc)) return fromYc;
    return '';
  };

  const login = pick(overrides?.login, 'YCLIENTS_LOGIN', storeCreds.yclientsLogin, storeYc.login);
  const password = pick(overrides?.password, 'YCLIENTS_PASSWORD', storeCreds.yclientsPassword, storeYc.password);
  const partnerToken = pick(
    overrides?.partnerToken,
    'YCLIENTS_PARTNER_TOKEN',
    storeCreds.yclientsPartnerToken,
    storeYc.partnerToken
  );
  const salonId = pick(overrides?.salonId, 'YCLIENTS_SALON_ID', storeCreds.yclientsSalonId, storeYc.salonId);

  const hasCredentials = Boolean(login && password && salonId);
  const enabled =
    overrides?.enabled !== undefined
      ? Boolean(overrides.enabled)
      : storeYc.enabled !== undefined
        ? Boolean(storeYc.enabled)
        : hasCredentials;

  return {
    login,
    password,
    partnerToken,
    salonId,
    enabled,
    readOnly: true,
  };
}

function extractYclientsErrorMessage(status: number, body: any): string {
  const metaMsg =
    typeof body?.meta?.message === 'string'
      ? body.meta.message.trim()
      : Array.isArray(body?.meta?.errors) && body.meta.errors.length > 0
        ? body.meta.errors.map((e: any) => (typeof e === 'string' ? e : e?.message || '')).filter(Boolean).join('; ')
        : '';
  const topMsg = typeof body?.message === 'string' ? body.message.trim() : '';
  const detail = metaMsg || topMsg;
  if (detail) {
    return `YClients API (HTTP ${status}): ${detail}`;
  }
  return `YClients API вернул ошибку HTTP ${status}`;
}

/**
 * Аутентификация в YClients API v1 по логину и паролю (+ YCLIENTS_PARTNER_TOKEN).
 * Возвращает временный `user_token` в памяти процесса для последующих read-only запросов.
 */
export async function authenticateYclients(
  config: Pick<EffectiveYclientsConfig, 'login' | 'password' | 'partnerToken'>,
  options?: { forceRefresh?: boolean; fetchFn?: FetchLike }
): Promise<string> {
  const login = (config.login || '').trim();
  const password = (config.password || '').trim();
  const partnerToken = (config.partnerToken || '').trim();

  if (!login || !password) {
    throw new Error('Для доступа к YClients укажите логин и пароль (YCLIENTS_LOGIN и YCLIENTS_PASSWORD).');
  }
  if (!partnerToken) {
    throw new Error(
      'Для аутентификации в YClients API требуется партнерский токен (YCLIENTS_PARTNER_TOKEN).'
    );
  }

  const fingerprint = buildAuthFingerprint({ login, password, partnerToken });
  if (
    !options?.forceRefresh &&
    cachedAuthToken &&
    cachedAuthToken.fingerprint === fingerprint &&
    Date.now() - cachedAuthToken.obtainedAt < AUTH_TOKEN_TTL_MS
  ) {
    return cachedAuthToken.userToken;
  }

  const fetchImpl = options?.fetchFn || fetch;
  const res = await fetchImpl(`${YCLIENTS_API_BASE}/auth`, {
    method: 'POST',
    headers: {
      Accept: YCLIENTS_ACCEPT_HEADER,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${partnerToken}`,
    },
    body: JSON.stringify({ login, password }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok || json?.success === false) {
    throw new Error(extractYclientsErrorMessage(res.status, json));
  }

  const userToken = typeof json?.data?.user_token === 'string' ? json.data.user_token.trim() : '';
  if (!userToken) {
    throw new Error('YClients API не вернул user_token после аутентификации.');
  }

  cachedAuthToken = {
    fingerprint,
    userToken,
    obtainedAt: Date.now(),
  };

  return userToken;
}

/**
 * Извлекает активных мастеров из ответа YClients `GET /api/v1/staff/{company_id}`.
 */
export function normalizeYclientsStaffList(rawData: unknown): YclientsMaster[] {
  const staffList = Array.isArray(rawData) ? rawData : [];
  const seenNames = new Set<string>();
  const masters: YclientsMaster[] = [];

  for (const member of staffList) {
    if (!member || typeof member !== 'object') continue;
    const rec = member as Record<string, any>;
    // Пропускаем уволенных и скрытых сотрудников
    if (rec.fired === 1 || rec.fired === true || rec.hidden === 1 || rec.hidden === true) {
      continue;
    }
    const cleanName = typeof rec.name === 'string' ? rec.name.trim() : '';
    if (cleanName.length < 2) continue;

    const dedupeKey = cleanName.toLowerCase();
    if (seenNames.has(dedupeKey)) continue;
    seenNames.add(dedupeKey);

    const idNum = Number(rec.id);
    const specialization = typeof rec.specialization === 'string' ? rec.specialization.trim() : '';
    const positionTitle =
      typeof rec.position?.title === 'string'
        ? rec.position.title.trim()
        : typeof rec.position === 'string'
          ? rec.position.trim()
          : '';

    masters.push({
      id: Number.isFinite(idNum) ? idNum : 0,
      name: cleanName,
      ...(specialization ? { specialization } : {}),
      ...(positionTitle ? { position: positionTitle } : {}),
      ...(rec.bookable !== undefined ? { bookable: Boolean(rec.bookable) } : {}),
    });
  }

  return masters;
}

/**
 * Чтение списка активных мастеров салона из YClients CRM (строго GET, read-only).
 * При 401/403 автоматически обновляет user_token через POST /api/v1/auth и повторяет чтение 1 раз.
 */
export async function fetchYclientsMasters(options?: {
  overrides?: YclientsCredentialsInput;
  bypassCache?: boolean;
  ignoreEnabledFlag?: boolean;
  fetchFn?: FetchLike;
}): Promise<YclientsMaster[]> {
  const cfg = getEffectiveYclientsConfig(options?.overrides);

  if (!options?.ignoreEnabledFlag && !cfg.enabled) {
    return [];
  }

  if (!cfg.salonId || !cfg.login || !cfg.password) {
    return [];
  }

  if (!isValidYclientsSalonId(cfg.salonId)) {
    throw new Error('Некорректный ID салона YClients: ожидается числовой идентификатор.');
  }

  const fingerprint = buildConfigFingerprint(cfg);
  if (
    !options?.bypassCache &&
    cachedMasters &&
    cachedMasters.fingerprint === fingerprint &&
    Date.now() - cachedMasters.fetchedAt < MASTERS_CACHE_TTL_MS
  ) {
    return cachedMasters.masters;
  }

  const fetchImpl = options?.fetchFn || fetch;

  const requestStaff = async (userToken: string) => {
    const authHeader = `Bearer ${cfg.partnerToken}, User ${userToken}`;
    return fetchImpl(`${YCLIENTS_API_BASE}/staff/${encodeURIComponent(cfg.salonId)}`, {
      method: 'GET',
      headers: {
        Accept: YCLIENTS_ACCEPT_HEADER,
        Authorization: authHeader,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  };

  let userToken = await authenticateYclients(cfg, {
    forceRefresh: Boolean(options?.bypassCache),
    fetchFn: fetchImpl,
  });

  let res = await requestStaff(userToken);

  // При истечении user_token — однократная переаутентификация по логину и паролю
  if (res.status === 401 || res.status === 403) {
    cachedAuthToken = null;
    userToken = await authenticateYclients(cfg, {
      forceRefresh: true,
      fetchFn: fetchImpl,
    });
    res = await requestStaff(userToken);
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok || json?.success === false) {
    throw new Error(extractYclientsErrorMessage(res.status, json));
  }

  const masters = normalizeYclientsStaffList(json?.data);

  cachedMasters = {
    fingerprint,
    masters,
    fetchedAt: Date.now(),
  };

  return masters;
}

/**
 * Проверка подключения к YClients в режиме «только чтение» (аутентификация по логину/паролю
 * + YCLIENTS_PARTNER_TOKEN и чтение списка мастеров салона).
 */
export async function testYclientsReadOnlyConnection(
  overrides?: YclientsCredentialsInput,
  fetchFn?: FetchLike
): Promise<YclientsReadOnlyTestResult> {
  const cfg = getEffectiveYclientsConfig(overrides);

  if (!cfg.salonId) {
    return {
      success: false,
      readOnly: true,
      error: 'Укажите ID салона YClients (YCLIENTS_SALON_ID).',
    };
  }
  if (!isValidYclientsSalonId(cfg.salonId)) {
    return {
      success: false,
      readOnly: true,
      error: 'ID салона YClients должен содержать только цифры.',
    };
  }
  if (!cfg.login || !cfg.password) {
    return {
      success: false,
      readOnly: true,
      error: 'Укажите логин и пароль YClients (YCLIENTS_LOGIN и YCLIENTS_PASSWORD).',
    };
  }
  if (!cfg.partnerToken) {
    return {
      success: false,
      readOnly: true,
      error: 'Укажите Partner Token YClients (YCLIENTS_PARTNER_TOKEN) — он необходим для аутентификации API.',
    };
  }

  try {
    const masters = await fetchYclientsMasters({
      overrides: cfg,
      bypassCache: true,
      ignoreEnabledFlag: true,
      fetchFn,
    });

    return {
      success: true,
      readOnly: true,
      mastersCount: masters.length,
      masters,
      message:
        masters.length > 0
          ? `Успешно (только чтение): получено мастеров — ${masters.length}. Запись в YClients отключена.`
          : 'Авторизация успешна (только чтение), но список активных мастеров для этого салона пуст.',
    };
  } catch (err: any) {
    return {
      success: false,
      readOnly: true,
      error: err?.message || 'Не удалось выполнить чтение мастеров из YClients.',
    };
  }
}
