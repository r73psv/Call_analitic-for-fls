/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAdministratorIntroNameFromTranscript,
  resolveCallAdministratorName,
  buildStaffPerformanceReport,
  UNIDENTIFIED_ADMINISTRATOR_LABEL,
} from '../administratorIdentity.js';
import type { CallRecord } from '../../types.js';

function makeCall(overrides: Partial<CallRecord>): CallRecord {
  return {
    call_id: overrides.call_id || `call-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: overrides.timestamp || '2026-11-24T10:00:00.000Z',
    duration_seconds: overrides.duration_seconds ?? 120,
    model_used: 'GigaChat:Ultra',
    transcript: overrides.transcript ?? '',
    summary: overrides.summary || 'Тестовый звонок.',
    booking_status: overrides.booking_status || 'консультация',
    key_facts: {
      is_dispute: false,
      dispute_reason: null,
      promises: [],
      tone_client: 'нейтральный',
      tone_manager: 'спокойный',
      call_outcome: 'консультация',
      ...(overrides.key_facts || {}),
    },
    trigger_phrases: [],
    recommendations: [],
    operator_score: overrides.operator_score !== undefined ? overrides.operator_score : 8,
    operator_comment: 'Ок',
    status: overrides.status || 'completed',
    type: overrides.type || 'incoming',
    is_answered: overrides.is_answered !== undefined ? overrides.is_answered : true,
    client_name: overrides.client_name || 'Клиент',
    client_phone_masked: overrides.client_phone_masked || '****123456',
    operator_name: overrides.operator_name ?? 'reception_701',
    spoken_operator_name: overrides.spoken_operator_name,
    evaluation: overrides.evaluation,
    is_demo: overrides.is_demo,
  };
}

test('extractAdministratorIntroNameFromTranscript handles common inbound and outbound Russian greetings', () => {
  const cases: Array<{ transcript: string; expected: string }> = [
    {
      transcript: 'Менеджер: Добрый день! Салон красоты LIQ28, меня зовут Алёна, чем могу помочь?\nКлиент: Здравствуйте.',
      expected: 'Алёна',
    },
    {
      transcript: 'Менеджер: Добрый день, салон красоты Fashion Look Studio, администратор Светлана.\nКлиент: Хочу на стрижку.',
      expected: 'Светлана',
    },
    {
      transcript: 'Менеджер: Алло, Динара, добрый день. От, а, 28. Меня зовут Алена.\nКлиент: Да, слушаю.',
      expected: 'Алёна', // нормализация е -> ё и НЕ перепутать с именем клиента Динара!
    },
    {
      transcript: 'Менеджер: Добрый день, Ольга, салон Fashion Look Studio, меня зовут Кристина.\nКлиент: Здравствуйте.',
      expected: 'Кристина', // НЕ Ольга (клиент)!
    },
    {
      transcript: 'Менеджер: Салон красоты Лик 28, Дарья, слушаю вас!\nКлиент: Можно записаться?',
      expected: 'Дарья',
    },
    {
      transcript: 'Менеджер: Добрый вечер, с вами говорит Юлия, салон Лик 28.\nКлиент: Здравствуйте.',
      expected: 'Юлия',
    },
    {
      transcript: 'Менеджер: Добрый день, салон LIQ28, Кристина, администратор.\nКлиент: Подскажите цену.',
      expected: 'Кристина',
    },
  ];

  for (const tc of cases) {
    const res = extractAdministratorIntroNameFromTranscript(tc.transcript);
    assert.equal(res.name, tc.expected, `Failed for transcript: ${tc.transcript}`);
  }
});

test('extractAdministratorIntroNameFromTranscript never confuses client or beauty master names with administrator', () => {
  // Клиент назван по имени, но сам администратор не представился
  const clientAddressedOnly = extractAdministratorIntroNameFromTranscript(
    'Менеджер: Добрый день, Михаил. Салон красоты Лук Студия. Вы записаны к мастеру Татьяне Валиуловой на 15:00.\nКлиент: Да, буду.'
  );
  assert.equal(clientAddressedOnly.name, null);

  // Вопрос к клиенту «Алло, это Динара?» не является самопредставлением администратора
  const askingClientName = extractAdministratorIntroNameFromTranscript(
    'Менеджер: Алло, это Динара? Вы записаны завтра на маникюр к мастеру Анне.\nКлиент: Да, это я.'
  );
  assert.equal(askingClientName.name, null);

  // Имя прозвучало только в реплике клиента
  const clientIntroOnly = extractAdministratorIntroNameFromTranscript(
    'Менеджер: Салон красоты Лик 28, добрый день!\nКлиент: Здравствуйте, меня зовут Екатерина, запишите меня на брови.'
  );
  assert.equal(clientIntroOnly.name, null);
});

test('resolveCallAdministratorName ignores shared ATS operator_name and classifies strictly by spoken intro', () => {
  // Под одним и тем же номером АТС («Анна (ресепшен)» / «user_701») работает другой администратор — Кристина
  const callByKristinaOnAnnaLine = makeCall({
    operator_name: 'Анна (ресепшен)',
    transcript: 'Менеджер: Добрый день, салон LIQ28, меня зовут Кристина.\nКлиент: Хочу на маникюр.',
  });
  const r1 = resolveCallAdministratorName(callByKristinaOnAnnaLine);
  assert.equal(r1.name, 'Кристина');
  assert.equal(r1.identified, true);

  // Если администратор НЕ представился в начале разговора — даже при заполненном operator_name АТС возвращаем «Не представился»
  const callWithoutIntro = makeCall({
    operator_name: 'Анна (ресепшен)',
    transcript: 'Менеджер: Добрый день, салон LIQ28, слушаю вас.\nКлиент: Сколько стоит стрижка?',
  });
  const r2 = resolveCallAdministratorName(callWithoutIntro);
  assert.equal(r2.name, UNIDENTIFIED_ADMINISTRATOR_LABEL);
  assert.equal(r2.identified, false);
});

test('buildStaffPerformanceReport splits calls from a single shared ATS number into distinct spoken administrators with 10-criteria averages', () => {
  const calls: CallRecord[] = [
    makeCall({
      call_id: 'c-a1',
      timestamp: '2026-11-24T09:00:00.000Z',
      operator_name: 'megafon_line_1',
      transcript: 'Менеджер: Добрый день! Салон LIQ28, меня зовут Алёна.\nКлиент: Запишите на маникюр.',
      booking_status: 'согласие',
      operator_score: 9,
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        promises: [],
        tone_client: 'позитивный',
        tone_manager: 'спокойный',
        call_outcome: 'запись',
      },
      evaluation: {
        overall_score: 9,
        max_score: 10,
        applicable_count: 2,
        total_criteria_count: 10,
        criteria: [
          { id: 'greeting_intro', name: 'Приветствие и представление', score: 10, is_applicable: true, explanation: 'Ок' },
          { id: 'booking_closure', name: 'Закрытие на запись', score: 8, is_applicable: true, explanation: 'Ок' },
        ],
      },
    }),
    makeCall({
      call_id: 'c-a2',
      timestamp: '2026-11-24T11:00:00.000Z',
      operator_name: 'megafon_line_1',
      transcript: 'Менеджер: Здравствуйте, салон Лик 28, администратор Алена.\nКлиент: Сколько стоит окрашивание?',
      booking_status: 'консультация',
      operator_score: 7,
      evaluation: {
        overall_score: 7,
        max_score: 10,
        applicable_count: 1,
        total_criteria_count: 10,
        criteria: [
          { id: 'greeting_intro', name: 'Приветствие и представление', score: 8, is_applicable: true, explanation: 'Ок' },
        ],
      },
    }),
    makeCall({
      call_id: 'c-k1',
      timestamp: '2026-11-24T13:00:00.000Z',
      operator_name: 'megafon_line_1',
      transcript: 'Менеджер: Добрый день, салон LIQ28, Кристина, слушаю вас.\nКлиент: Запишите на педикюр.',
      booking_status: 'согласие',
      operator_score: 10,
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        promises: [],
        tone_client: 'позитивный',
        tone_manager: 'спокойный',
        call_outcome: 'запись',
      },
    }),
    makeCall({
      call_id: 'c-u1',
      timestamp: '2026-11-24T15:00:00.000Z',
      operator_name: 'megafon_line_1',
      transcript: 'Менеджер: Алло, салон красоты.\nКлиент: Алло, не туда попал.',
      booking_status: 'не применимо',
      operator_score: null,
    }),
  ];

  const report = buildStaffPerformanceReport(calls, {
    period: 'all',
    now: new Date('2026-11-24T16:00:00.000Z'),
  });

  assert.equal(report.source, 'spoken_intro');
  assert.equal(report.identifiedStaffCount, 2); // Алёна и Кристина
  assert.equal(report.identifiedCallsCount, 3);
  assert.equal(report.unidentifiedCallsCount, 1);
  assert.equal(report.staff.length, 3); // Алёна, Кристина, Не представился (в конце)

  const alena = report.staff[0];
  assert.equal(alena.name, 'Алёна');
  assert.equal(alena.totalCalls, 2);
  assert.equal(alena.bookingsCount, 1);
  assert.equal(alena.conversionRate, 50);
  assert.equal(alena.averageScore, 8);
  assert.equal(alena.criteriaAverages.greeting, 9);
  assert.equal(alena.criteriaAverages.closing, 8);
  assert.equal(alena.isUnidentifiedBucket, false);

  const kristina = report.staff[1];
  assert.equal(kristina.name, 'Кристина');
  assert.equal(kristina.totalCalls, 1);
  assert.equal(kristina.bookingsCount, 1);
  assert.equal(kristina.conversionRate, 100);
  assert.equal(kristina.averageScore, 10);

  const unidentified = report.staff[2];
  assert.equal(unidentified.name, UNIDENTIFIED_ADMINISTRATOR_LABEL);
  assert.equal(unidentified.totalCalls, 1);
  assert.equal(unidentified.isUnidentifiedBucket, true);
});
