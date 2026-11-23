/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSttProvider,
  resolveActiveSttProvider,
  transcribeAudio,
  getSttProviderLabel,
} from '../transcriptionService.js';

describe('transcriptionService provider routing & isolation', () => {
  it('normalizeSttProvider корректно нормализует все алиасы провайдеров', () => {
    assert.equal(normalizeSttProvider('yandex_speechkit'), 'yandex_speechkit');
    assert.equal(normalizeSttProvider('speechkit'), 'yandex_speechkit');
    assert.equal(normalizeSttProvider('gigaam_v3'), 'gigaam_v3');
    assert.equal(normalizeSttProvider('gigaam'), 'gigaam_v3');
    assert.equal(normalizeSttProvider('gigaasr'), 'gigaam_v3');
    assert.equal(normalizeSttProvider('tbank_voicekit'), 'tbank_voicekit');
    assert.equal(normalizeSttProvider('tbank'), 'tbank_voicekit');
  });

  it('resolveActiveSttProvider с явным override yandex_speechkit игнорирует глобальный gigaam_v3', () => {
    const prevEnv = process.env.STT_PROVIDER;
    process.env.STT_PROVIDER = 'gigaam_v3';
    try {
      assert.equal(resolveActiveSttProvider('yandex_speechkit'), 'yandex_speechkit');
      assert.equal(resolveActiveSttProvider('speechkit'), 'yandex_speechkit');
    } finally {
      if (prevEnv === undefined) delete process.env.STT_PROVIDER;
      else process.env.STT_PROVIDER = prevEnv;
    }
  });

  it('transcribeAudio с override yandex_speechkit возвращает attemptedProvider=yandex_speechkit и никогда не обращается к GigaASR', async () => {
    const prevStt = process.env.STT_PROVIDER;
    const prevYcKey = process.env.YC_API_KEY;
    const prevYcSaFile = process.env.YC_SERVICE_ACCOUNT_KEY_FILE;
    const prevYcSaJson = process.env.YC_SERVICE_ACCOUNT_KEY_JSON;

    process.env.STT_PROVIDER = 'gigaam_v3';
    process.env.YC_API_KEY = '';
    process.env.YC_SERVICE_ACCOUNT_KEY_FILE = '/nonexistent/authorized_key.json';
    process.env.YC_SERVICE_ACCOUNT_KEY_JSON = '';

    try {
      const res = await transcribeAudio(Buffer.from('fake-audio'), 'audio/mp3', undefined, 'yandex_speechkit');
      assert.equal(res.attemptedProvider, 'yandex_speechkit');
      assert.equal(getSttProviderLabel(res.attemptedProvider), 'Yandex SpeechKit');
      assert.ok(res.error && !/GigaASR|GigaAM/i.test(res.error), `Неожиданная ошибка GigaASR при вызове Yandex: ${res.error}`);
    } finally {
      if (prevStt === undefined) delete process.env.STT_PROVIDER;
      else process.env.STT_PROVIDER = prevStt;
      if (prevYcKey === undefined) delete process.env.YC_API_KEY;
      else process.env.YC_API_KEY = prevYcKey;
      if (prevYcSaFile === undefined) delete process.env.YC_SERVICE_ACCOUNT_KEY_FILE;
      else process.env.YC_SERVICE_ACCOUNT_KEY_FILE = prevYcSaFile;
      if (prevYcSaJson === undefined) delete process.env.YC_SERVICE_ACCOUNT_KEY_JSON;
      else process.env.YC_SERVICE_ACCOUNT_KEY_JSON = prevYcSaJson;
    }
  });
});
