/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SALON_NAME,
  LOGIN_FORM_TITLE,
  detectSalonTheme,
  isLiq28Salon,
  resolveSalonName,
} from '../salonBranding.js';
import {
  DEFAULT_YCLIENTS_MASTERS_SYNC_TIME,
  isYclientsDailySyncDue,
  normalizeYclientsSyncTime,
} from '../yclients.js';
import {
  FALLBACK_SALON_MASTERS,
  getSystemPrompt,
  injectDynamicMastersIntoPrompt,
} from '../gigachat.js';

describe('salonBranding — динамическое название салона и тема LIQ28', () => {
  it('LOGIN_FORM_TITLE соответствует требуемому заголовку формы входа', () => {
    assert.equal(LOGIN_FORM_TITLE, 'Вход в программу аудита телефонных звонков');
  });

  it('resolveSalonName отдаёт приоритет переменной окружения SALON_NAME перед конфигом и резервом', () => {
    assert.equal(
      resolveSalonName({
        envSalonName: 'LIQ28',
        configSalonName: 'Старое название',
        credentialsSalonName: 'Ещё старее',
      }),
      'LIQ28'
    );

    assert.equal(
      resolveSalonName({
        envSalonName: '',
        configSalonName: '  Лик 28  ',
      }),
      'Лик 28'
    );

    assert.equal(resolveSalonName({}), DEFAULT_SALON_NAME);
  });

  it('detectSalonTheme активирует тему liq28 для всех написаний Лик28 / LIQ28 / LIQ.28', () => {
    for (const name of ['LIQ28', 'LIQ.28', 'LIQ 28', 'Лик28', 'Лик 28', 'ЛИК 28', 'Салон красоты Лик28']) {
      assert.equal(detectSalonTheme(name), 'liq28', `Ожидалась тема liq28 для «${name}»`);
      assert.equal(isLiq28Salon(name), true);
    }

    for (const name of ['Fashion Look Studio', 'Beauty Studio', 'Салон красоты', '']) {
      assert.equal(detectSalonTheme(name), 'default', `Ожидалась тема default для «${name}»`);
      assert.equal(isLiq28Salon(name), false);
    }
  });
});

describe('YClients ежедневная синхронизация мастеров в 08:00 и приоритет в промпте', () => {
  it('normalizeYclientsSyncTime возвращает 08:00 по умолчанию и валидирует HH:MM', () => {
    assert.equal(DEFAULT_YCLIENTS_MASTERS_SYNC_TIME, '08:00');
    assert.equal(normalizeYclientsSyncTime(undefined), '08:00');
    assert.equal(normalizeYclientsSyncTime('invalid'), '08:00');
    assert.equal(normalizeYclientsSyncTime('8:00'), '08:00');
    assert.equal(normalizeYclientsSyncTime('08:30'), '08:30');
  });

  it('isYclientsDailySyncDue срабатывает ровно один раз в день начиная с 08:00 по времени салона', () => {
    // 07:55 Europe/Samara (UTC+4 -> 03:55 UTC)
    const beforeEight = new Date('2026-11-25T03:55:00Z');
    const resBefore = isYclientsDailySyncDue(beforeEight, {
      syncTime: '08:00',
      timeZone: 'Europe/Samara',
      lastSyncDate: '2026-11-24',
    });
    assert.equal(resBefore.due, false);
    assert.equal(resBefore.reason, 'before_scheduled_time');

    // 08:00 Europe/Samara (UTC+4 -> 04:00 UTC)
    const atEight = new Date('2026-11-25T04:00:00Z');
    const resAtEight = isYclientsDailySyncDue(atEight, {
      syncTime: '08:00',
      timeZone: 'Europe/Samara',
      lastSyncDate: '2026-11-24',
    });
    assert.equal(resAtEight.due, true);
    assert.equal(resAtEight.reason, 'due');
    assert.equal(resAtEight.todayStr, '2026-11-25');

    // Повторный запуск в тот же день пропускается
    const resAlreadyDone = isYclientsDailySyncDue(new Date('2026-11-25T06:00:00Z'), {
      syncTime: '08:00',
      timeZone: 'Europe/Samara',
      lastSyncDate: '2026-11-25',
    });
    assert.equal(resAlreadyDone.due, false);
    assert.equal(resAlreadyDone.reason, 'already_synced_today');
  });

  it('getSystemPrompt использует динамический список мастеров YClients вместо жёсткого списка', () => {
    const dynamicYclientsMasters = ['Мария Соколова', 'Алина Волкова', 'Светлана Морозова'];
    const prompt = getSystemPrompt('LIQ28', dynamicYclientsMasters);

    assert.ok(prompt.includes('Мария Соколова, Алина Волкова, Светлана Морозова'));
    assert.ok(prompt.includes('ежедневно в 08:00'));
    // Старый резервный список не должен подменяться вместо YClients
    assert.equal(prompt.includes('Арина Егорова'), false);
    assert.equal(prompt.includes('Екатерина Кожевникова'), false);
  });

  it('injectDynamicMastersIntoPrompt заменяет жёстко зафиксированный список в кастомном промпте на список из YClients', () => {
    const customPromptWithHardcoded =
      `Ты аудитор салона.\n\n[СПИСОК МАСТЕРОВ]\nАктуальный список мастеров салона: ${FALLBACK_SALON_MASTERS.join(', ')}.\nРаботай строго по стенограмме.`;
    const yclientsMasters = ['Виктория Орлова', 'Полина Лебедева'];

    const updated = injectDynamicMastersIntoPrompt(customPromptWithHardcoded, yclientsMasters, 'yclients');
    assert.ok(updated.includes('Виктория Орлова, Полина Лебедева'));
    assert.equal(updated.includes('Арина Егорова'), false);
    assert.equal(updated.includes('Дарья Прибыткова'), false);

    // Если в кастомном промпте вообще не было блока [СПИСОК МАСТЕРОВ], он добавляется с приоритетом YClients
    const customWithoutBlock = 'Ты аудитор звонков салона LIQ28. Анализируй строго по фактам.';
    const appended = injectDynamicMastersIntoPrompt(customWithoutBlock, yclientsMasters, 'yclients');
    assert.ok(appended.includes('[СПИСОК МАСТЕРОВ]'));
    assert.ok(appended.includes('Виктория Орлова, Полина Лебедева'));
  });
});
