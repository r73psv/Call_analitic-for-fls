import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CallRecord } from '../../types.js';
import {
  DEFAULT_VK_CALL_TEMPLATE,
  extractBriefDialogueRetelling,
  formatVkCallMessage,
} from '../vkMessageFormatter.js';

function makeBaseCall(overrides: Partial<CallRecord> = {}): CallRecord {
  return {
    call_id: 'call-vk-101',
    timestamp: '2026-11-25T10:00:00.000Z',
    duration_seconds: 125,
    status: 'completed',
    model_used: 'GigaChat:Ultra',
    transcript:
      'Менеджер: Добрый день, салон LIQ28, администратор Анна.\n' +
      'Клиент: Здравствуйте, хочу записаться на маникюр завтра в 15:00 к Кристине.\n' +
      'Менеджер: Отлично, записала вас на завтра в 15:00 к Кристине, стоимость 2100 рублей.',
    summary:
      'Суть обращения: услуга — маникюр, дата — завтра, время — 15:00, мастер — Кристина. ' +
      'Пересказ диалога: Клиент позвонила для записи на маникюр к мастеру Кристине на завтра в 15:00. ' +
      'Администратор Анна подтвердила свободное время, озвучила стоимость 2100 рублей и оформила запись. ' +
      'Вывод: Запись состоялась.\n' +
      'Разбор работы менеджера (оценка 10/10):\n- Ошибки и недочеты: не выявлены\n- Советы по оптимизации: не требуются',
    booking_status: 'согласие',
    key_facts: {
      is_dispute: false,
      dispute_reason: null,
      promises: [],
      tone_client: 'позитивный',
      tone_manager: 'позитивный',
      call_outcome: 'запись',
      service: 'маникюр',
      master: 'Кристина',
      date: 'завтра',
      time: '15:00',
    },
    trigger_phrases: [],
    recommendations: ['Поддерживать высокий стандарт общения.'],
    operator_score: 10,
    operator_comment: 'Отличная работа.',
    client_name: 'Клиент (****001122)',
    ...overrides,
  };
}

describe('vkMessageFormatter — обязательный краткий пересказ диалога в VK', () => {
  it('извлекает чистый «Пересказ диалога» из полного summary', () => {
    const call = makeBaseCall();
    const retelling = extractBriefDialogueRetelling(call);
    assert.match(retelling, /Клиент позвонила для записи на маникюр к мастеру Кристине/i);
    assert.equal(/Разбор работы менеджера/i.test(retelling), false);
    assert.equal(/Суть обращения:/i.test(retelling), false);
  });

  it('шаблон по умолчанию включает «📝 *Краткий пересказ диалога:* ...»', () => {
    const call = makeBaseCall();
    const msg = formatVkCallMessage(call, { template: DEFAULT_VK_CALL_TEMPLATE });
    assert.match(msg, /📝 \*Краткий пересказ диалога:\* Клиент позвонила для записи на маникюр/i);
    assert.match(msg, /📞 \*Оценка оператора:\* 10\/10/);
  });

  it('автоматически добавляет краткий пересказ, даже если пользовательский шаблон не содержит {short_summary} и {summary}', () => {
    const call = makeBaseCall();
    const customTemplate = '🔔 Звонок #{call_id}\n👤 {client_name}\n⭐ Оценка: {operator_score}';
    const msg = formatVkCallMessage(call, { template: customTemplate });
    assert.match(msg, /📝 \*Краткий пересказ диалога:\* Клиент позвонила для записи на маникюр/i);
  });

  it('автоматически добавляет отдельный блок краткого пересказа в старый шаблон с {summary}', () => {
    const call = makeBaseCall();
    const legacyTemplate =
      '🔔 *Анализ звонка #{call_id}*\n📅 *Дата:* {call_date_time}\n⏱️ *Длительность:* {duration}\n💬 *Резюме:* {summary}';
    const msg = formatVkCallMessage(call, { template: legacyTemplate });
    const retellingIdx = msg.indexOf('📝 *Краткий пересказ диалога:*');
    const summaryIdx = msg.indexOf('💬 *Резюме:*');
    assert.ok(retellingIdx >= 0, 'Ожидался блок «Краткий пересказ диалога»');
    assert.ok(summaryIdx > retellingIdx, 'Краткий пересказ должен идти перед подробным резюме');
  });

  it('формирует краткий пересказ из structured_summary или стенограммы, если call.summary пуст', () => {
    const callNoSummary = makeBaseCall({
      summary: '',
      structured_summary: {
        call_purpose: 'Запись на окрашивание волос',
        requested_service: 'окрашивание',
        offered_master: 'Елена',
        offered_price: '4500 руб.',
        offered_date_time: 'суббота 12:00',
        booking_status_text: 'Запись состоялась',
        unbooked_reason: 'не применимо',
        manager_next_steps: ['Напомнить за день'],
      },
    });
    const msgFromFacts = formatVkCallMessage(callNoSummary, { template: '' });
    assert.match(msgFromFacts, /📝 \*Краткий пересказ диалога:\*.*Запись на окрашивание волос/i);

    const callOnlyTranscript = makeBaseCall({
      summary: '',
      structured_summary: undefined,
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        promises: [],
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'консультация',
      },
      booking_status: '',
    });
    const msgFromTranscript = formatVkCallMessage(callOnlyTranscript, { template: '' });
    assert.match(msgFromTranscript, /📝 \*Краткий пересказ диалога:\*.*маникюр/i);
  });

  it('соблюдает 152-ФЗ (маскирует номера телефонов) и не дублирует блок при явном {dialogue_summary}', () => {
    const callWithPhone = makeBaseCall({
      summary: 'Пересказ диалога: Клиент попросила перезвонить на +7 (927) 123-45-67 по поводу маникюра.',
    });
    const template = 'Звонок #{call_id}\nПересказ: {dialogue_summary}';
    const msg = formatVkCallMessage(callWithPhone, { template });
    assert.equal(msg.includes('123-45-67'), false);
    assert.ok(msg.includes('[номер скрыт]'));
    assert.equal(msg.includes('📝 *Краткий пересказ диалога:*'), false);
  });
});
