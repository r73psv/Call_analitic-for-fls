/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isQuotePresentInTranscript,
  hasSequentialWordCoverage,
  hasSoftSubstringCoverage,
  applyVerdicts,
} from '../callVerifier.js';
import type { AnalysisResult } from '../../types.js';

function normalizeRelaxedForTest(s: string): string {
  return s
    .replace(
      /(?:^|[\n\r.!?]\s*|\s+)(?:менеджер|клиент|оператор|администратор|автоинформатор|сотрудник|гость)\s*:\s*/gi,
      ' '
    )
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»„“”"''`‚‘’]/g, '')
    .replace(/[\u2010-\u2015\u2212\-]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('isQuotePresentInTranscript', () => {
  it('(1) позитив: находит цитату со склейкой ролей и вставными словами', () => {
    const quote = 'Уже иду по улице, через 3 минуты буду';

    // Склейка ролей прямо посередине фразы
    const transcriptSpliced =
      'Клиент: Уже иду Менеджер: по улице Клиент: через 3 минуты буду.';
    assert.equal(isQuotePresentInTranscript(transcriptSpliced, quote), true);

    // Склейка ролей + вставные слова / междометия в середине реплики
    const transcriptWithFillers =
      'Клиент: Уже иду, ну, Менеджер: прямо по улице, Клиент: да, через 3 минуты буду.';
    assert.equal(isQuotePresentInTranscript(transcriptWithFillers, quote), true);
  });

  it('(2) негатив: шаблонная цитата «Будем ожидать вас.» из few-shot примера не проходит при ответе «Все хорошо, ожидаем вас.»', () => {
    const transcript = 'Менеджер: Все хорошо, ожидаем вас.';
    const fewShotQuote = 'Будем ожидать вас.';

    assert.equal(isQuotePresentInTranscript(transcript, fewShotQuote), false);

    // Проверяем все три слоя по отдельности
    const normT = normalizeRelaxedForTest(transcript);
    const normQ = normalizeRelaxedForTest(fewShotQuote);
    assert.equal(normT.includes(normQ), false);
    assert.equal(hasSequentialWordCoverage(normT, normQ, 0.7, 4), false);
    assert.equal(hasSoftSubstringCoverage(normT, normQ, 0.7, 6), false);

    // Защита от коротких шаблонных фраз (< 6 слов), даже если 2 из 3 слов совпадают
    assert.equal(
      isQuotePresentInTranscript('Менеджер: Хорошо, будем ожидать.', fewShotQuote),
      false
    );
  });

  it('(3) негатив: полностью выдуманная фраза не проходит ни один из трёх слоёв', () => {
    const transcript =
      'Автоинформатор: Разговор может быть записан.\nМенеджер: Добрый день, салон красоты.\nКлиент: Сколько стоит маникюр?\nМенеджер: От двух тысяч рублей.';
    const fabricatedQuote = 'Запись оформлена к мастеру Елене на субботу в 15:00';

    assert.equal(isQuotePresentInTranscript(transcript, fabricatedQuote), false);

    const normT = normalizeRelaxedForTest(transcript);
    const normQ = normalizeRelaxedForTest(fabricatedQuote);
    assert.equal(normT.includes(normQ), false);
    assert.equal(hasSequentialWordCoverage(normT, normQ, 0.7, 4), false);
    assert.equal(hasSoftSubstringCoverage(normT, normQ, 0.7, 6), false);
  });
});

describe('applyVerdicts suspected false positive', () => {
  it('повышает unconfirmed до confirmed и не сбрасывает оценку критерия в 0, если цитата есть в стенограмме', () => {
    const transcript =
      'Менеджер: Добрый день, салон Fashion Look Studio.\nКлиент: Хочу на маникюр завтра в 14:00.\nМенеджер: Хорошо, записала вас на маникюр завтра в 14:00.';
    const draft: AnalysisResult = {
      is_conversation: true,
      transcript_summary: 'Запись на маникюр',
      booking_status: 'согласие',
      formatted_transcript: transcript,
      structured_summary: {
        call_purpose: 'Запись на маникюр',
        requested_service: 'маникюр',
        offered_master: 'не озвучено',
        offered_price: 'не озвучено',
        offered_date_time: 'завтра в 14:00',
        booking_status_text: 'Записана на маникюр',
        unbooked_reason: 'не применимо',
        manager_next_steps: ['Подтвердить бронь'],
      },
      criteria_scores: [
        {
          id: 'greeting',
          name: 'Приветствие и представление',
          score: 9,
          is_applicable: true,
          explanation: 'Вежливое приветствие с названием салона.',
          evidence_quote: 'Добрый день, салон Fashion Look Studio.',
        },
      ],
      evaluation: {
        overall_score: 9,
        max_score: 10,
        applicable_count: 1,
        total_criteria_count: 10,
        summary_verdict: 'Отлично',
        criteria: [
          {
            id: 'greeting',
            name: 'Приветствие и представление',
            score: 9,
            is_applicable: true,
            explanation: 'Вежливое приветствие с названием салона.',
            evidence_quote: 'Добрый день, салон Fashion Look Studio.',
          },
        ],
      },
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        promises: [],
        tone_client: 'нейтральный',
        tone_manager: 'дружелюбный',
        call_outcome: 'запись',
        booking_status: 'согласие',
        client_issue: 'маникюр',
      },
      operator_score: 9,
      operator_mistakes: [],
      operator_comment: 'Хорошая работа',
      recommendations: [],
    };

    const result = applyVerdicts(
      draft,
      [
        {
          field: 'requested_service',
          draft_value: 'маникюр',
          verdict: 'unconfirmed',
          quote: null,
          corrected_value: null,
        },
      ],
      [
        {
          id: 'greeting',
          verdict: 'unconfirmed',
          quote: null,
        },
      ],
      0,
      transcript
    );

    assert.equal(result.structured_summary?.requested_service, 'маникюр');
    const verifiedField = result.verification_report?.fields.find(
      (f) => f.field === 'requested_service'
    );
    assert.equal(verifiedField?.verdict, 'confirmed');
    assert.equal(verifiedField?.suspected_false_positive, true);

    const verifiedCriterionItem = result.verification_report?.criteria_items?.find(
      (c) => c.id === 'greeting'
    );
    assert.equal(verifiedCriterionItem?.verdict, 'confirmed');
    assert.equal(verifiedCriterionItem?.quote, 'Добрый день, салон Fashion Look Studio.');

    const updatedCrit = result.criteria_scores?.find((c) => c.id === 'greeting');
    assert.equal(updatedCrit?.score, 9);
    assert.equal(result.operator_score, 9);
  });

  it('синтез-поля (booking_done, booking_status_text, short_summary) подтверждаются при confirmed составных фактах (booking_markers, дата/время, мастер)', () => {
    const transcript =
      'Менеджер: Добрый день, Ольга, салон ЛИК 28, меня зовут Кристина. Перенесём вашу запись на завтра в 12:00 к мастеру Дарье Прибытковой?\n' +
      'Клиент: Да, конечно, подойду.\n' +
      'Менеджер: Отлично, перенесла запись на завтра в 12:00 к Дарье Прибытковой.';

    const draft: any = {
      transcript_summary: 'Запись перенесена к другому мастеру без изменения времени: завтра в 12:00 к Дарье Прибытковой.',
      formatted_transcript: transcript,
      booking_status: 'согласие',
      structured_summary: {
        call_purpose: 'Перенос записи',
        requested_service: 'не озвучено',
        offered_master: 'Дарья Прибыткова',
        offered_price: 'не озвучено',
        offered_date_time: 'завтра в 12:00',
        booking_status_text: 'Запись перенесена к другому мастеру без изменения времени',
        unbooked_reason: 'не применимо',
        manager_next_steps: [],
      },
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        promises: [],
        tone_client: 'позитивный',
        tone_manager: 'дружелюбный',
        call_outcome: 'запись',
        booking_status: 'согласие',
        booking_markers_quotes: ['Отлично, перенесла запись на завтра в 12:00 к Дарье Прибытковой.'],
        date_time_offered_quote: 'на завтра в 12:00',
      },
      operator_score: 10,
      operator_mistakes: [],
      operator_comment: 'Отлично',
      recommendations: [],
    };

    const result = applyVerdicts(
      draft,
      [
        {
          field: 'offered_date_time',
          draft_value: 'завтра в 12:00',
          verdict: 'confirmed',
          quote: 'на завтра в 12:00',
          corrected_value: null,
        },
        {
          field: 'offered_master',
          draft_value: 'Дарья Прибыткова',
          verdict: 'confirmed',
          quote: 'к мастеру Дарье Прибытковой',
          corrected_value: null,
        },
        {
          field: 'booking_done',
          draft_value: 'Запись перенесена к другому мастеру без изменения времени',
          verdict: 'unconfirmed',
          quote: null,
          corrected_value: null,
        },
        {
          field: 'booking_status_text',
          draft_value: 'Запись перенесена к другому мастеру без изменения времени',
          verdict: 'unconfirmed',
          quote: null,
          corrected_value: null,
        },
        {
          field: 'short_summary',
          draft_value: 'Запись перенесена к другому мастеру без изменения времени: завтра в 12:00 к Дарье Прибытковой.',
          verdict: 'unconfirmed',
          quote: null,
          corrected_value: null,
        },
      ],
      [],
      0,
      transcript
    );

    for (const synthField of ['booking_done', 'booking_status_text', 'short_summary']) {
      const f = result.verification_report?.fields.find((x) => x.field === synthField);
      assert.equal(f?.verdict, 'confirmed', `Синтез-поле ${synthField} должно стать confirmed при подтверждённых составных фактах`);
      assert.ok(f?.quote, `Синтез-поле ${synthField} должно получить подтверждающую цитату составного факта`);
    }
    assert.equal(result.verification_report?.summary_verdict, 'ок');
    assert.deepEqual(result.verification_flags, []);
    assert.equal(
      result.structured_summary?.booking_status_text,
      'Запись перенесена к другому мастеру без изменения времени'
    );
  });
});
