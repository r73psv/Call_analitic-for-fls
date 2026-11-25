/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateDailyCallsReport,
  formatVkDailyReportMessage,
  isDailyReportDue,
  isValidIsoDateString,
  normalizeDailyReportTime,
  VK_MESSAGE_MAX_LENGTH,
} from '../vkDailyReport.js';
import type { CallRecord } from '../../types.js';

function makeCall(overrides: Partial<CallRecord>): CallRecord {
  return {
    call_id: overrides.call_id || `call-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: overrides.timestamp || '2026-11-24T10:00:00.000Z',
    duration_seconds: overrides.duration_seconds ?? 120,
    model_used: 'GigaChat:Lite',
    transcript: overrides.transcript || 'Менеджер: Добрый день. Клиент: Запишите на маникюр.',
    summary: overrides.summary || 'Клиент записался на услугу.',
    booking_status: overrides.booking_status,
    key_facts: {
      is_dispute: false,
      dispute_reason: null,
      promises: [],
      tone_client: 'нейтральный',
      tone_manager: 'спокойный',
      call_outcome: 'запись',
      ...(overrides.key_facts || {}),
    },
    trigger_phrases: [],
    recommendations: [],
    operator_score: overrides.operator_score !== undefined ? overrides.operator_score : 9,
    operator_comment: 'Хорошая работа',
    status: overrides.status || 'completed',
    type: overrides.type || 'incoming',
    is_answered: overrides.is_answered !== undefined ? overrides.is_answered : true,
    client_name: overrides.client_name || 'Елена Смирнова',
    client_phone: overrides.client_phone || '+79271234567',
    full_phone: overrides.full_phone || '+79271234567',
    operator_name: overrides.operator_name || 'Алёна',
    structured_summary: overrides.structured_summary,
    is_demo: overrides.is_demo,
  };
}

test('aggregateDailyCallsReport computes calls, missed, bookings by service & master, and respects UTC+4 boundaries', () => {
  const calls: CallRecord[] = [
    // 1. Booking: Маникюр, мастер Анна (Samara 2026-11-24 00:30 = 2026-11-23T20:30:00Z)
    makeCall({
      call_id: 'c-1',
      timestamp: '2026-11-23T20:30:00.000Z',
      type: 'incoming',
      duration_seconds: 180,
      booking_status: 'согласие',
      operator_name: 'Алёна',
      operator_score: 9,
      structured_summary: {
        call_purpose: 'Запись',
        requested_service: 'маникюр с покрытием',
        offered_master: 'мастер Анна',
        offered_price: '2000',
        offered_date_time: 'завтра 14:00',
        booking_status_text: 'Запись состоялась',
        unbooked_reason: '',
        manager_next_steps: [],
      },
    }),
    // 2. Booking: Маникюр (different case), Анна
    makeCall({
      call_id: 'c-2',
      timestamp: '2026-11-24T08:15:00.000Z',
      type: 'incoming',
      duration_seconds: 120,
      booking_status: 'согласие',
      operator_name: 'Алёна',
      operator_score: 8,
      structured_summary: {
        call_purpose: 'Запись',
        requested_service: 'Маникюр с покрытием',
        offered_master: 'Анна',
        offered_price: '2000',
        offered_date_time: 'сегодня 17:00',
        booking_status_text: 'Запись состоялась',
        unbooked_reason: '',
        manager_next_steps: [],
      },
    }),
    // 3. Booking: Окрашивание волос, no master specified (outgoing confirmation call)
    makeCall({
      call_id: 'c-3',
      timestamp: '2026-11-24T11:00:00.000Z',
      type: 'outgoing',
      duration_seconds: 60,
      booking_status: 'согласие',
      operator_name: 'Елена',
      operator_score: 10,
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        promises: [],
        tone_client: 'позитивный',
        tone_manager: 'спокойный',
        call_outcome: 'запись',
        service: 'Окрашивание волос',
        master: 'не озвучено',
      },
    }),
    // 4. Missed incoming call
    makeCall({
      call_id: 'c-4',
      timestamp: '2026-11-24T12:00:00.000Z',
      type: 'incoming',
      status: 'missed',
      is_answered: false,
      duration_seconds: 0,
      operator_name: 'Елена',
      operator_score: null,
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        promises: [],
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'не успешно',
      },
    }),
    // 5. Consultation + dispute
    makeCall({
      call_id: 'c-5',
      timestamp: '2026-11-24T14:00:00.000Z',
      type: 'incoming',
      duration_seconds: 240,
      booking_status: 'консультация',
      operator_name: 'Алёна',
      operator_score: 6,
      key_facts: {
        is_dispute: true,
        dispute_reason: 'Недовольство ценой',
        promises: [],
        tone_client: 'недовольный',
        tone_manager: 'спокойный',
        call_outcome: 'консультация',
        service: 'Педикюр',
      },
    }),
    // 6. Demo call on same day — MUST be excluded
    makeCall({
      call_id: 'c-demo',
      timestamp: '2026-11-24T09:00:00.000Z',
      is_demo: true,
      booking_status: 'согласие',
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        promises: [],
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'запись',
        service: 'Демо-услуга',
      },
    }),
    // 7. Next calendar day in Samara (2026-11-24T20:30:00Z = 2026-11-25 00:30 UTC+4) — MUST be excluded
    makeCall({
      call_id: 'c-next-day',
      timestamp: '2026-11-24T20:30:00.000Z',
      booking_status: 'согласие',
    }),
  ];

  const metrics = aggregateDailyCallsReport(calls, '2026-11-24', {
    timeZone: 'Europe/Samara',
    salonName: 'Лик 28',
  });

  assert.equal(metrics.totalCalls, 5);
  assert.equal(metrics.incomingCalls, 4);
  assert.equal(metrics.outgoingCalls, 1);
  assert.equal(metrics.answeredCalls, 4);
  assert.equal(metrics.missedCalls, 1);
  assert.equal(metrics.missedRatePct, 20);
  assert.equal(metrics.bookingsCount, 3);
  assert.equal(metrics.conversionFromAnsweredPct, 75);
  assert.equal(metrics.conversionFromTotalPct, 60);
  assert.equal(metrics.consultationsCount, 1);
  assert.equal(metrics.disputesCount, 1);
  assert.equal(metrics.avgOperatorScore, 8.3);
  assert.equal(metrics.avgDurationSeconds, 150);

  assert.deepEqual(metrics.bookingsByService, [
    { name: 'Маникюр с покрытием', count: 2 },
    { name: 'Окрашивание волос', count: 1 },
  ]);
  assert.deepEqual(metrics.bookingsByMaster, [
    { name: 'Анна', count: 2 },
    { name: 'Не указан / любой мастер', count: 1 },
  ]);
  assert.equal(metrics.operatorStats.length, 2);
  assert.equal(metrics.operatorStats[0].name, 'Алёна');
  assert.equal(metrics.operatorStats[0].bookings, 2);
});

test('formatVkDailyReportMessage complies strictly with 152-ФЗ anonymization (no phones or client names)', () => {
  const calls: CallRecord[] = [
    makeCall({
      call_id: 'c-pii',
      timestamp: '2026-11-24T10:00:00.000Z',
      client_name: 'Ирина Константиновна Волкова',
      client_phone: '+79275559988',
      full_phone: '+79275559988',
      booking_status: 'согласие',
      operator_name: 'Мария',
      structured_summary: {
        call_purpose: 'Запись',
        requested_service: 'Стрижка (звонила с +7 927 555-99-88)',
        offered_master: 'Кристина',
        offered_price: '2500',
        offered_date_time: '15:00',
        booking_status_text: 'Запись состоялась',
        unbooked_reason: '',
        manager_next_steps: [],
      },
    }),
  ];

  const metrics = aggregateDailyCallsReport(calls, '2026-11-24', {
    timeZone: 'Europe/Samara',
    salonName: 'Лик 28',
  });
  const msg = formatVkDailyReportMessage(metrics);

  assert.ok(msg.includes('Итоги дня: «Лик 28»'));
  assert.ok(msg.includes('24.11.2026'));
  assert.ok(msg.includes('Записи по видам услуг'));
  assert.ok(msg.includes('Записи по мастерам'));
  assert.ok(msg.includes('Кристина — 1'));
  assert.ok(msg.includes('152-ФЗ'));
  assert.equal(msg.includes('Волкова'), false, 'Client surname must not appear in VK report');
  assert.equal(msg.includes('Ирина'), false, 'Client first name must not appear in VK report');
  assert.equal(msg.includes('9275559988'), false, 'Raw phone must not appear in VK report');
  assert.equal(msg.includes('555-99-88'), false, 'Formatted phone must be stripped from VK report');
  assert.ok(msg.length <= VK_MESSAGE_MAX_LENGTH);
});

test('isDailyReportDue enforces after-21:00 cutoff and once-per-day deduplication', () => {
  // 20:59 in Europe/Samara (UTC+4) = 16:59Z
  const beforeCutoff = new Date('2026-11-24T16:59:00.000Z');
  const r1 = isDailyReportDue(beforeCutoff, {
    reportTime: '21:05',
    timeZone: 'Europe/Samara',
  });
  assert.equal(r1.due, false);
  assert.equal(r1.reason, 'before_scheduled_time');
  assert.equal(r1.todayStr, '2026-11-24');

  // 21:05 in Europe/Samara (UTC+4) = 17:05Z
  const atCutoff = new Date('2026-11-24T17:05:00.000Z');
  const r2 = isDailyReportDue(atCutoff, {
    reportTime: '21:05',
    timeZone: 'Europe/Samara',
  });
  assert.equal(r2.due, true);
  assert.equal(r2.reason, 'due');

  // Already sent for 2026-11-24 -> skip at 21:30
  const afterSent = new Date('2026-11-24T17:30:00.000Z');
  const r3 = isDailyReportDue(afterSent, {
    reportTime: '21:05',
    timeZone: 'Europe/Samara',
    lastSentDate: '2026-11-24',
  });
  assert.equal(r3.due, false);
  assert.equal(r3.reason, 'already_sent_today');

  // Next day at 21:10 -> due again
  const nextDay = new Date('2026-11-25T17:10:00.000Z');
  const r4 = isDailyReportDue(nextDay, {
    reportTime: '21:05',
    timeZone: 'Europe/Samara',
    lastSentDate: '2026-11-24',
  });
  assert.equal(r4.due, true);
  assert.equal(r4.todayStr, '2026-11-25');
});

test('normalizeDailyReportTime clamps invalid/pre-21:00 values to 21:05 and validates ISO dates', () => {
  assert.equal(normalizeDailyReportTime('18:00'), '21:05');
  assert.equal(normalizeDailyReportTime('20:59'), '21:05');
  assert.equal(normalizeDailyReportTime('21:00'), '21:00');
  assert.equal(normalizeDailyReportTime('22:30'), '22:30');
  assert.equal(normalizeDailyReportTime('invalid'), '21:05');

  assert.equal(isValidIsoDateString('2026-11-24'), true);
  assert.equal(isValidIsoDateString('2026-02-31'), false);
  assert.equal(isValidIsoDateString('24.11.2026'), false);
});

test('formatVkDailyReportMessage handles zero-call days gracefully', () => {
  const metrics = aggregateDailyCallsReport([], '2026-11-24', {
    timeZone: 'Europe/Samara',
    salonName: 'Fashion Look Studio',
  });
  const msg = formatVkDailyReportMessage(metrics);
  assert.ok(msg.includes('звонков не зафиксировано'));
  assert.ok(msg.includes('152-ФЗ'));
});
