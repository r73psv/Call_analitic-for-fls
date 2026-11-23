/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import axios from 'axios';
import { randomUUID } from 'crypto';
import { readStoreSync } from '../store/store.js';

let gigaTokenCache: { token: string; expiresAt: number } | null = null;

function isUsableGigaChatKey(key?: string | null): boolean {
  const trimmed = (key || '').trim();
  return Boolean(trimmed && trimmed !== '<ключ-авторизации-GigaChat>');
}

export function getEffectiveGigaChatKey(): string {
  const envKey = process.env.GIGACHAT_AUTH_KEY || process.env.GIGACHAT_CREDENTIALS || '';
  if (isUsableGigaChatKey(envKey)) {
    return envKey.trim();
  }
  try {
    const store = readStoreSync();
    const storeKey = store.config?.credentials?.gigachatAuthKey;
    if (isUsableGigaChatKey(storeKey)) {
      return storeKey!.trim();
    }
  } catch (e) {
    // Ignore store read issues
  }
  return '';
}

export function getEffectiveGigaChatScope(): string {
  const envScope = (process.env.GIGACHAT_SCOPE || '').trim();
  if (envScope) {
    return envScope;
  }
  try {
    const store = readStoreSync();
    if (store.config?.credentials?.gigachatScope) {
      return store.config.credentials.gigachatScope.trim();
    }
  } catch (e) {
    // Ignore
  }
  return 'GIGACHAT_API_PERS';
}

export interface GigaChatConfigStatus {
  configured: boolean;
  source: 'store' | 'env' | 'both' | 'none';
  hasStoreKey: boolean;
  hasEnvKey: boolean;
  scope: string;
  missing: string[];
}

export function getGigaChatConfigStatus(): GigaChatConfigStatus {
  let hasStoreKey = false;
  try {
    const store = readStoreSync();
    hasStoreKey = isUsableGigaChatKey(store.config?.credentials?.gigachatAuthKey);
  } catch {
    hasStoreKey = false;
  }
  const hasEnvKey = isUsableGigaChatKey(process.env.GIGACHAT_AUTH_KEY || process.env.GIGACHAT_CREDENTIALS);
  const scope = getEffectiveGigaChatScope();
  const configured = hasStoreKey || hasEnvKey;
  const source: GigaChatConfigStatus['source'] =
    hasStoreKey && hasEnvKey ? 'both' : hasStoreKey ? 'store' : hasEnvKey ? 'env' : 'none';
  const missing: string[] = [];
  if (!configured) {
    missing.push('GIGACHAT_AUTH_KEY (отсутствует в env и в хранилище credentials)');
  }
  return {
    configured,
    source,
    hasStoreKey,
    hasEnvKey,
    scope,
    missing,
  };
}

export async function getGigaChatToken(): Promise<string> {
  const now = Date.now();
  if (gigaTokenCache && gigaTokenCache.expiresAt - now > 60000) {
    return gigaTokenCache.token;
  }

  const authKey = getEffectiveGigaChatKey();
  if (!authKey) {
    throw new Error('GIGACHAT_AUTH_KEY не задан в настройках админ-панели или .env');
  }

  const formattedAuth = authKey.startsWith('Basic ') || authKey.startsWith('Bearer ')
    ? authKey
    : `Basic ${authKey}`;

  const scope = getEffectiveGigaChatScope();
  const oauthUrl = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';

  const res = await axios.post(
    oauthUrl,
    `scope=${encodeURIComponent(scope)}`,
    {
      headers: {
        Authorization: formattedAuth,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        RqUID: randomUUID(),
      },
      timeout: 20000,
    }
  );

  if (!res.data || !res.data.access_token) {
    throw new Error('GigaChat не вернул access_token при авторизации');
  }

  const expiresInMs = (res.data.expires_at ? res.data.expires_at - now : 1800000);
  gigaTokenCache = {
    token: res.data.access_token,
    expiresAt: now + expiresInMs,
  };

  console.log('[GigaChat Auth] Новый токен успешно получен и сохранён в кэш');
  return gigaTokenCache.token;
}

export function invalidateGigaChatTokenCache(): void {
  gigaTokenCache = null;
  console.log('[GigaChat Auth] Кэш токена авторизации сброшен');
}

export function isGigaChatConfigured(): boolean {
  const key = getEffectiveGigaChatKey();
  return isUsableGigaChatKey(key);
}
