/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type SalonThemeId = 'default' | 'liq28';

export const DEFAULT_SALON_NAME = 'Салон красоты';
export const LOGIN_FORM_TITLE = 'Вход в программу аудита телефонных звонков';

const LIQ28_NAME_PATTERN = /(?:liq|лик)[\s._-]*28/i;

/**
 * Определяет тему оформления интерфейса по названию салона.
 * Для салона «Лик28» / «LIQ28» / «LIQ.28» активируется фирменная светлая
 * минималистичная премиум-тема в эстетике https://vk.ru/liq28.
 */
export function detectSalonTheme(salonName?: string | null): SalonThemeId {
  const normalized = (salonName || '').trim();
  if (!normalized) return 'default';
  return LIQ28_NAME_PATTERN.test(normalized) ? 'liq28' : 'default';
}

export function isLiq28Salon(salonName?: string | null): boolean {
  return detectSalonTheme(salonName) === 'liq28';
}

/**
 * Единая резолюция названия салона с приоритетом переменной окружения SALON_NAME.
 */
export function resolveSalonName(options?: {
  envSalonName?: string | null;
  configSalonName?: string | null;
  credentialsSalonName?: string | null;
  fallback?: string;
}): string {
  const candidates = [
    options?.envSalonName,
    options?.configSalonName,
    options?.credentialsSalonName,
  ];

  for (const raw of candidates) {
    if (typeof raw === 'string') {
      const cleaned = raw.trim();
      if (cleaned) return cleaned;
    }
  }

  return (options?.fallback || DEFAULT_SALON_NAME).trim();
}
