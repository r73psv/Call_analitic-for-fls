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
