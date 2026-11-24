/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  preprocessMalformedJson,
  parseJsonWithDiagnostics,
  hasSubstantiveLiveDialogue,
  generateLocalFallbackAnalysis,
  getSystemPrompt,
  FEW_SHOT_EXAMPLES,
  FEW_SHOT_EDGE_CASES,
  buildUserPrompt,
  validateResult,
  parseGigaChatJson,
} from '../gigachat.js';
import { isCallWithoutLiveManager } from '../transcriptUtils.js';
import { classifyCallContext } from '../summaryUtils.js';

describe('JSON preprocessing & diagnostics', () => {
  it('чинит десятичные запятые, неэкранированные кавычки внутри строк и хвостовые запятые', () => {
    const malformed = `{
      "summary": "Клиент сказал "хорошо", но потом попросил перезвонить",
      "quote": "Он ответил "буду завтра" в 10:00",
      "audit": {
        "criteria": [
          {"name": "Приветствие", "score": 8,3},
          {"name": "Коммуникация", "score": 5,9},
        ],
        "overall_score": 7,1,
      },
      "tags": ["маникюр", "запись",],
    }`;

    const { fixed, appliedFixes } = preprocessMalformedJson(malformed);
    assert.ok(appliedFixes.length >= 3);

    const parsed = parseJsonWithDiagnostics(malformed);
    assert.equal(parsed.audit.criteria[0].score, 8.3);
    assert.equal(parsed.audit.criteria[1].score, 5.9);
    assert.equal(parsed.audit.overall_score, 7.1);
    assert.match(parsed.summary, /"хорошо"/);
    assert.deepEqual(parsed.tags, ['маникюр', 'запись']);
    assert.ok(fixed.includes('8.3'));
  });

  it('не портит корректный JSON с массивами чисел и вложенными объектами', () => {
    const valid = JSON.stringify({
      is_conversation: true,
      scores: [8, 3, 5.9],
      summary: 'Клиент сказал «да», потом "ок".',
      audit: { overall_score: 8.5, criteria: [{ score: 9 }, { score: 8 }] },
    });

    const { fixed, appliedFixes } = preprocessMalformedJson(valid);
    assert.equal(appliedFixes.length, 0);
    assert.equal(fixed, valid);
  });

  it('обогащает синтаксическую ошибку JSON позицией, фрагментом ±200 символов и префиксом [GigaChat JSON-ERR]', () => {
    const broken = '{"a": 1, "b": 2, "broken": [1, 2, }';
    const logged: string[] = [];
    const origError = console.error;
    console.error = (...args: any[]) => {
      logged.push(args.map(String).join(' '));
    };
    try {
      assert.throws(
        () => parseJsonWithDiagnostics(broken),
        (err: any) => {
          assert.equal(err.isJsonFormatError, true);
          assert.equal(typeof err.jsonErrorPos, 'number');
          assert.ok(err.jsonErrorSnippet.includes('<<<ERROR_POS_'));
          assert.ok(err.jsonFirst100.startsWith('{"a": 1'));
          return true;
        }
      );
      assert.ok(logged.some((line) => line.startsWith('[GigaChat JSON-ERR]')));
    } finally {
      console.error = origError;
    }
  });
});

describe('Детектор «звонок не дошёл до менеджера» (очередь / автоответчик)', () => {
  it('распознаёт звонок в очереди/автоответчике даже при метке «Менеджер:» и возвращает статус «не применимо»', () => {
    const queueTranscript =
      'Менеджер: Здравствуйте! Оставайтесь на линии, вам ответит свободный администратор.\n' +
      'Менеджер: Все администраторы сейчас заняты. Оставьте сообщение после гудка или перезвоните позже.';

    assert.equal(isCallWithoutLiveManager(queueTranscript), true);
    assert.equal(hasSubstantiveLiveDialogue(queueTranscript), false);
    assert.equal(classifyCallContext(queueTranscript).category, 'not_happened');

    const res = generateLocalFallbackAnalysis(
      queueTranscript,
      'GigaChat:Lite',
      28,
      'Fashion Look Studio',
      'GigaChat не настроен (ключ отсутствует)'
    );

    assert.equal(res.is_conversation, false);
    assert.equal(res.booking_status, 'не применимо');
    assert.equal(res.key_facts.call_outcome, 'не состоялся');
    assert.equal(res.operator_score, null);
    assert.deepEqual(res.criteria_scores, []);
    assert.deepEqual(res.evaluation?.criteria, []);
    assert.equal(res.evaluation?.overall_score, null);
    assert.deepEqual(res.operator_mistakes, []);
    const recs = Array.isArray(res.recommendations)
      ? res.recommendations
      : [res.recommendations];
    assert.ok(recs.some((r) => /повторить попытку дозвона/i.test(r)));
  });

  it('не считает несостоявшимся звонок, где после ожидания в очереди ответил живой менеджер', () => {
    const liveAfterQueue =
      'Автоинформатор: Оставайтесь на линии, вам ответит первый освободившийся администратор.\n' +
      'Менеджер: Добрый день, салон красоты Fashion Look, слушаю вас.\n' +
      'Клиент: Здравствуйте, запишите меня на маникюр завтра в 15:00.\n' +
      'Менеджер: Хорошо, записала вас на маникюр завтра в 15:00.';

    assert.equal(isCallWithoutLiveManager(liveAfterQueue), false);
    assert.equal(hasSubstantiveLiveDialogue(liveAfterQueue), true);
    assert.equal(classifyCallContext(liveAfterQueue).category, 'confirmed_booking');
  });
});

describe('Промпт, ПРИМЕР 8, авто-ремонт критериев 8–9 и защита fallback-ошибок', () => {
  it('getSystemPrompt содержит правила восстановления ролей SpeechKit одной строкой и критерий 9 для исходящих подтверждений', () => {
    const prompt = getSystemPrompt('Fashion Look Studio');
    assert.match(prompt, /меня зовут/i);
    assert.match(prompt, /вы к нам записаны на/i);
    assert.match(prompt, /formatted_transcript/i);
    assert.match(prompt, /бронь не оформлена/i);
    assert.match(prompt, /попытка закрытия отсутствовала/i);
    assert.match(prompt, /9–10/);
  });

  it('FEW_SHOT_EXAMPLES и FEW_SHOT_EDGE_CASES сохраняют ПРИМЕРЫ 1–7 и содержат валидный ПРИМЕР 8 для исходящего подтверждения одной строкой', () => {
    const combinedPrompt = buildUserPrompt('Тестовый транскрипт', 20);
    for (let i = 1; i <= 8; i++) {
      assert.ok(combinedPrompt.includes(`ПРИМЕР ${i}`), `Должен присутствовать ПРИМЕР ${i}`);
    }
    assert.ok(FEW_SHOT_EXAMPLES.includes('ПРИМЕР 1'));
    const ex8Idx = FEW_SHOT_EDGE_CASES.indexOf('ПРИМЕР 8');
    assert.ok(ex8Idx >= 0, 'ПРИМЕР 8 должен присутствовать в FEW_SHOT_EDGE_CASES');
    const ex8Chunk = FEW_SHOT_EDGE_CASES.slice(ex8Idx);
    const jsonStart = ex8Chunk.indexOf('{');
    const jsonEnd = ex8Chunk.lastIndexOf('}');
    assert.ok(jsonStart >= 0 && jsonEnd > jsonStart);
    const parsedEx8 = JSON.parse(ex8Chunk.slice(jsonStart, jsonEnd + 1));

    assert.equal(parsedEx8.is_conversation, true);
    assert.equal(parsedEx8.booking_status, 'Запись состоялась');
    assert.match(parsedEx8.formatted_transcript, /Менеджер:/);
    assert.match(parsedEx8.formatted_transcript, /Клиент:/);
    assert.equal(parsedEx8.summary.booking_done, 'Подтверждение ранее сделанной записи');

    const crit8 = parsedEx8.audit.criteria.find((c: any) => /альтернатив/i.test(c.name));
    const crit9 = parsedEx8.audit.criteria.find((c: any) => /закрытие на запись/i.test(c.name));
    assert.equal(crit8?.applicable, false);
    assert.equal(crit8?.score, null);
    assert.equal(crit9?.applicable, true);
    assert.ok(crit9?.score >= 9);
  });

  it('validateResult автоматически переводит Критерий 8 в applicable: false, если в стенограмме нет отказа или несогласия клиента', () => {
    const cleanTranscript =
      'Менеджер: Добрый день, салон красоты Fashion Look Studio, меня зовут Анна. Вы к нам записаны на завтра в 14:00 на маникюр, подтверждаете визит?\n' +
      'Клиент: Да, буду.\n' +
      'Менеджер: Отлично, будем ждать вас завтра в 14:00.\n' +
      'Клиент: Спасибо, до свидания.';

    const criteria: any[] = [
      { id: 'greeting_intro', name: 'Приветствие и представление', is_applicable: true, score: 10, explanation: 'Полное приветствие.' },
      { id: 'alternatives', name: 'Предложение альтернативных вариантов', is_applicable: true, score: 4, explanation: 'Не предложены альтернативы.' },
      { id: 'closing', name: 'Закрытие на запись', is_applicable: true, score: 4, explanation: 'Попытка закрытия отсутствовала, бронь не оформлена.' },
      { id: 'communication', name: 'Качество коммуникации и завершение разговора', is_applicable: true, score: 10, explanation: 'Вежливо.' },
    ];

    const mockResult: any = {
      is_conversation: true,
      booking_status: 'согласие',
      transcript_summary: 'Разбор работы менеджера (оценка 7/10):\n- Ошибки и недочеты: Попытка закрытия отсутствовала, бронь не оформлена; Не предложены альтернативные варианты\n- Советы по оптимизации: не требуются',
      formatted_transcript: cleanTranscript,
      operator_score: 7,
      operator_mistakes: ['Попытка закрытия отсутствовала, бронь не оформлена', 'Не предложены альтернативные варианты'],
      operator_comment: 'Ок',
      recommendations: [],
      criteria_scores: criteria,
      evaluation: { overall_score: 7, max_score: 10, applicable_count: 4, total_criteria_count: 10, criteria },
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        tone_client: 'позитивный',
        tone_manager: 'позитивный',
        call_outcome: 'запись',
        booking_status: 'согласие',
        criteria_scores: criteria,
        evaluation: { overall_score: 7, max_score: 10, applicable_count: 4, total_criteria_count: 10, criteria },
      },
    };

    const check = validateResult(mockResult, cleanTranscript);
    assert.equal(check.valid, true, `Неожиданные ошибки валидации: ${check.errors.join('; ')}`);

    const repairedC8 = mockResult.criteria_scores.find((c: any) => c.id === 'alternatives');
    assert.equal(repairedC8.is_applicable, false);
    assert.equal(repairedC8.score, null);

    const repairedC9 = mockResult.criteria_scores.find((c: any) => c.id === 'closing');
    assert.equal(repairedC9.is_applicable, true);
    assert.ok(repairedC9.score >= 9);
    assert.doesNotMatch(repairedC9.explanation, /бронь не оформлена|попытка закрытия отсутствовала/i);
    assert.deepEqual(mockResult.operator_mistakes, []);
    assert.equal(mockResult.operator_score, 10);
  });

  it('validateResult НЕ отключает Критерий 8, если в стенограмме реально был отказ или несогласие клиента', () => {
    const refusalTranscript =
      'Менеджер: Добрый день, салон Fashion Look.\n' +
      'Клиент: Здравствуйте, мне это время не подходит, слишком поздно, тогда не надо.\n' +
      'Менеджер: Хорошо, до свидания.';

    const criteria: any[] = [
      { id: 'greeting_intro', name: 'Приветствие и представление', is_applicable: true, score: 8, explanation: 'Вежливо.' },
      { id: 'alternatives', name: 'Предложение альтернативных вариантов', is_applicable: true, score: 4, explanation: 'Не предложены альтернативные даты.' },
      { id: 'communication', name: 'Качество коммуникации и завершение разговора', is_applicable: true, score: 8, explanation: 'Вежливо.' },
    ];

    const mockResult: any = {
      is_conversation: true,
      booking_status: 'отказ',
      transcript_summary: 'Разбор работы менеджера (оценка 7/10):\n- Ошибки и недочеты: Не предложены альтернативные даты\n- Советы по оптимизации: Предлагать другие слоты',
      formatted_transcript: refusalTranscript,
      operator_score: 7,
      operator_mistakes: ['Не предложены альтернативные даты'],
      operator_comment: 'Отказ',
      recommendations: ['Предлагать другие слоты'],
      criteria_scores: criteria,
      evaluation: { overall_score: 7, max_score: 10, applicable_count: 3, total_criteria_count: 10, criteria },
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'отказ',
        booking_status: 'отказ',
        criteria_scores: criteria,
        evaluation: { overall_score: 7, max_score: 10, applicable_count: 3, total_criteria_count: 10, criteria },
      },
    };

    validateResult(mockResult, refusalTranscript);
    const crit8 = mockResult.criteria_scores.find((c: any) => c.id === 'alternatives');
    assert.equal(crit8.is_applicable, true);
    assert.equal(crit8.score, 4);
  });

  it('generateLocalFallbackAnalysis при отсутствии ошибок не подставляет шаблонный набор «не назвал имя / не задал вопросы / не презентовал / не предложил сопутствующие»', () => {
    const normalBookingTranscript =
      'Менеджер: Здравствуйте!\n' +
      'Клиент: Здравствуйте, запишите меня на маникюр завтра в 15:00.\n' +
      'Менеджер: Хорошо, записала вас на маникюр завтра в 15:00, ждём вас, до свидания.\n' +
      'Клиент: Спасибо, до свидания.';

    const res = generateLocalFallbackAnalysis(
      normalBookingTranscript,
      'GigaChat:Lite',
      25,
      'Fashion Look Studio',
      'Таймаут модели'
    );

    const mistakes = res.operator_mistakes || [];
    const joined = mistakes.join(' | ');
    assert.doesNotMatch(joined, /не назвал собственное имя/i);
    assert.doesNotMatch(joined, /не заданы уточняющие вопросы/i);
    assert.doesNotMatch(joined, /квалификация мастера не раскрыты/i);
    assert.doesNotMatch(joined, /не предложил сопутствующие процедуры/i);
  });

  it('parseGigaChatJson переводит источник блока ошибок при модельном ответе с template на «модель → fallback»', () => {
    const transcript =
      'Менеджер: Добрый день, салон Fashion Look Studio, меня зовут Анна. Вы к нам записаны на завтра в 14:00 на маникюр, подтверждаете визит?\n' +
      'Клиент: Да, буду. Спасибо, до свидания.';

    const modelJsonWithoutMistakesField = JSON.stringify({
      is_conversation: true,
      formatted_transcript: transcript,
      booking_status: 'Запись состоялась',
      summary: {
        goal: 'Подтверждение существующей записи на маникюр',
        service: 'маникюр',
        master: 'не озвучено',
        price: 'не озвучено',
        date_time: 'завтра в 14:00',
        booking_done: 'Подтверждение ранее сделанной записи',
        reason_if_not: 'не применимо',
        manager_next_steps: ['Отметить подтверждение в CRM'],
        short_summary: 'Менеджер напомнила о записи на маникюр завтра в 14:00, клиент подтвердил визит.',
        quotes_support: ['Да, буду.'],
      },
      audit: {
        criteria: [
          { name: 'Приветствие и представление', score: 10, applicable: true, reasoning: 'Полное приветствие.', quote: 'Добрый день, салон Fashion Look Studio, меня зовут Анна.' },
          { name: 'Закрытие на запись', score: 10, applicable: true, reasoning: 'Визит подтверждён.', quote: 'Да, буду.' },
          { name: 'Качество коммуникации и завершение разговора', score: 10, applicable: true, reasoning: 'Вежливое завершение.', quote: 'Спасибо, до свидания.' },
        ],
        overall_score: 10,
      },
      recommendations: [],
    });

    const parsed = parseGigaChatJson(modelJsonWithoutMistakesField, transcript, 'Fashion Look Studio');
    assert.equal(parsed.summary_source, 'model');
    assert.equal(parsed.mistakes_source, 'модель → fallback');
  });
});
