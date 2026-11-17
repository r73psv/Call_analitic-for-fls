/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GigaamModelVariant, SttProvider } from '../types.js';
import { readStoreSync } from '../store/store.js';
import { isYandexAuthConfigured } from './yandex-auth.js';
import { transcribeWithRetry, refineTranscriptRoles, fixDuplicatedTranscript } from './speechkit.js';
import { isTbankVoiceKitConfigured, transcribeWithTbankVoiceKitRetry } from './tbank-voicekit.js';
import { isGigaAmConfigured, transcribeWithGigaAmRetry } from './gigaam-asr.js';

export type TranscriptionEngine = SttProvider | 'speechkit' | 'none';

export interface TranscriptionResult {
  text: string;
  engine: TranscriptionEngine;
  error?: string;
}

export function normalizeSttProvider(raw?: string | null): SttProvider {
  if (raw === 'tbank_voicekit' || raw === 'tbank') return 'tbank_voicekit';
  if (raw === 'gigaam_v3' || raw === 'gigaam') return 'gigaam_v3';
  return 'yandex_speechkit';
}

export function resolveActiveSttProvider(override?: SttProvider | string): SttProvider {
  if (override) return normalizeSttProvider(override);
  try {
    const store = readStoreSync();
    const configured = store.config?.transcriptionModel || store.config?.credentials?.transcriptionModel;
    if (configured) return normalizeSttProvider(configured);
  } catch {
    // ignore
  }
  if (process.env.STT_PROVIDER) {
    return normalizeSttProvider(process.env.STT_PROVIDER);
  }
  return 'yandex_speechkit';
}

export function getSttProviderLabel(engine?: string): string {
  switch (engine) {
    case 'tbank_voicekit':
      return 'T-Bank VoiceKit';
    case 'gigaam_v3':
      return 'GigaASR / GigaAM v3';
    case 'yandex_speechkit':
    case 'speechkit':
      return 'Yandex SpeechKit';
    default:
      return 'Yandex SpeechKit';
  }
}

/**
 * Исключительно отечественный стек распознавания речи (152-ФЗ РФ):
 * Поддерживаемые модели:
 *  - Yandex SpeechKit (Yandex Cloud)
 *  - T-Bank VoiceKit (Т-Банк Облако)
 *  - GigaASR Cloud.ru Evolution / GigaAM v3 (SaluteDevices / Сбер ASR)
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string = 'audio/mp3',
  onLog?: (type: 'info' | 'success' | 'warning' | 'error', msg: string) => void,
  providerOverride?: SttProvider | string,
  gigaamVariantOverride?: GigaamModelVariant
): Promise<TranscriptionResult> {
  const log = (type: 'info' | 'success' | 'warning' | 'error', msg: string) => {
    if (onLog) {
      onLog(type, msg);
    }
  };

  const provider = resolveActiveSttProvider(providerOverride);
  const providerLabel = getSttProviderLabel(provider);

  if (provider === 'tbank_voicekit') {
    if (!isTbankVoiceKitConfigured()) {
      const errorMsg =
        'T-Bank VoiceKit не настроен (отсутствуют API Key или Secret Key). Укажите ключи в панели администратора.';
      log('warning', `[STT] ${errorMsg}`);
      return { text: '', engine: 'none', error: errorMsg };
    }

    try {
      log('info', `[STT] Запуск распознавания аудиозаписи через ${providerLabel}...`);
      const rawText = await transcribeWithTbankVoiceKitRetry(audioBuffer);
      if (rawText && rawText.trim().length > 0) {
        const cleaned = fixDuplicatedTranscript(refineTranscriptRoles(rawText.trim()));
        log('success', `[STT] Речь успешно расшифрована ${providerLabel} (${cleaned.length} симв.)`);
        return { text: cleaned, engine: 'tbank_voicekit' };
      }
      const emptyMsg = 'Аудиозапись не содержит разборчивой речи (тишина или звуковой сигнал).';
      log('info', `[STT] ${providerLabel}: ${emptyMsg}`);
      return { text: '', engine: 'tbank_voicekit', error: emptyMsg };
    } catch (err: any) {
      const errMsg = err.message || String(err);
      log('error', `[STT] Ошибка распознавания речи ${providerLabel}: ${errMsg}`);
      return { text: '', engine: 'none', error: `Ошибка ${providerLabel}: ${errMsg}` };
    }
  }

  if (provider === 'gigaam_v3') {
    if (!isGigaAmConfigured()) {
      const errorMsg =
        'GigaASR / GigaAM v3 не настроен (отсутствует URL эндпоинта или API-ключ Cloud.ru Evolution). Настройте параметры в панели администратора.';
      log('warning', `[STT] ${errorMsg}`);
      return { text: '', engine: 'none', error: errorMsg };
    }

    try {
      log('info', `[STT] Запуск распознавания аудиозаписи через ${providerLabel}...`);
      const rawText = await transcribeWithGigaAmRetry(audioBuffer, mimeType, gigaamVariantOverride);
      if (rawText && rawText.trim().length > 0) {
        const cleaned = fixDuplicatedTranscript(refineTranscriptRoles(rawText.trim()));
        log('success', `[STT] Речь успешно расшифрована ${providerLabel} (${cleaned.length} симв.)`);
        return { text: cleaned, engine: 'gigaam_v3' };
      }
      const emptyMsg = 'Аудиозапись не содержит разборчивой речи (тишина или звуковой сигнал).';
      log('info', `[STT] ${providerLabel}: ${emptyMsg}`);
      return { text: '', engine: 'gigaam_v3', error: emptyMsg };
    } catch (err: any) {
      const errMsg = err.message || String(err);
      log('error', `[STT] Ошибка распознавания речи ${providerLabel}: ${errMsg}`);
      return { text: '', engine: 'none', error: `Ошибка ${providerLabel}: ${errMsg}` };
    }
  }

  // По умолчанию: Yandex SpeechKit
  if (!isYandexAuthConfigured()) {
    const errorMsg =
      'Yandex SpeechKit не настроен (отсутствует authorized_key.json или API-ключ YC_API_KEY). Настройте сервисный аккаунт в панели управления.';
    log('warning', `[STT] ${errorMsg}`);
    return {
      text: '',
      engine: 'none',
      error: errorMsg,
    };
  }

  try {
    log('info', '[STT] Запуск распознавания аудиозаписи через российскую модель Yandex SpeechKit...');
    const skRaw = await transcribeWithRetry(audioBuffer);
    if (skRaw && skRaw.trim().length > 0) {
      const cleaned = fixDuplicatedTranscript(refineTranscriptRoles(skRaw.trim()));
      log('success', `[STT] Речь успешно расшифрована Yandex SpeechKit (${cleaned.length} симв.)`);
      return {
        text: cleaned,
        engine: 'yandex_speechkit',
      };
    } else {
      const emptyMsg = 'Аудиозапись не содержит разборчивой речи (тишина или звуковой сигнал).';
      log('info', `[STT] Yandex SpeechKit: ${emptyMsg}`);
      return {
        text: '',
        engine: 'yandex_speechkit',
        error: emptyMsg,
      };
    }
  } catch (err: any) {
    const skError = err.message || String(err);
    log('error', `[STT] Ошибка распознавания речи Yandex SpeechKit: ${skError}`);
    return {
      text: '',
      engine: 'none',
      error: `Ошибка Yandex SpeechKit: ${skError}`,
    };
  }
}
