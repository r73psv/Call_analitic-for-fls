/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AsrFailReason, GigaamModelVariant, SttProvider } from '../types.js';
import { readStoreSync } from '../store/store.js';
import { isYandexAuthConfigured } from './yandex-auth.js';
import { transcribeWithRetry, refineTranscriptRoles, fixDuplicatedTranscript } from './speechkit.js';
import { isTbankVoiceKitConfigured, transcribeWithTbankVoiceKitRetry } from './tbank-voicekit.js';
import {
  isGigaAmConfigured,
  transcribeWithGigaAmRetry,
  classifyAsrFailReason,
  getGigaAmConfig,
} from './gigaam-asr.js';

export type TranscriptionEngine = SttProvider | 'speechkit' | 'none';

export interface TranscriptionResult {
  text: string;
  engine: TranscriptionEngine;
  attemptedProvider: SttProvider;
  error?: string;
  attempts?: number;
  preparedWav?: Buffer;
  rateLimited?: boolean;
  httpStatus?: number;
  asrFailReason?: AsrFailReason | string;
  failedModel?: string;
  fallbackModelsTried?: string[];
  requestId?: string;
  endpointPath?: string;
  catalogVerdict?: string;
  catalogSummary?: string;
}

export interface TranscribeAudioOptions {
  callId?: string;
  isPreparedWav?: boolean;
  emitIncidentSummary?: boolean;
}

export function normalizeSttProvider(raw?: string | null): SttProvider {
  const val = (raw || '').trim().toLowerCase();
  if (val === 'tbank_voicekit' || val === 'tbank') return 'tbank_voicekit';
  if (val === 'gigaam_v3' || val === 'gigaam' || val === 'gigaasr') return 'gigaam_v3';
  return 'yandex_speechkit';
}

export function resolveActiveSttProvider(override?: SttProvider | string): SttProvider {
  if (override && String(override).trim()) return normalizeSttProvider(String(override));
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
  gigaamVariantOverride?: GigaamModelVariant,
  options?: TranscribeAudioOptions
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
      return { text: '', engine: 'none', attemptedProvider: provider, error: errorMsg };
    }

    try {
      log('info', `[STT] Запуск распознавания аудиозаписи через ${providerLabel}...`);
      const rawText = await transcribeWithTbankVoiceKitRetry(audioBuffer);
      if (rawText && rawText.trim().length > 0) {
        const cleaned = fixDuplicatedTranscript(refineTranscriptRoles(rawText.trim()));
        log('success', `[STT] Речь успешно расшифрована ${providerLabel} (${cleaned.length} симв.)`);
        return { text: cleaned, engine: 'tbank_voicekit', attemptedProvider: provider };
      }
      const emptyMsg = 'Аудиозапись не содержит разборчивой речи (тишина или звуковой сигнал).';
      log('info', `[STT] ${providerLabel}: ${emptyMsg}`);
      return { text: '', engine: 'tbank_voicekit', attemptedProvider: provider, error: emptyMsg };
    } catch (err: any) {
      const errMsg = err.message || String(err);
      log('error', `[STT] Ошибка распознавания речи ${providerLabel}: ${errMsg}`);
      return { text: '', engine: 'none', attemptedProvider: provider, error: errMsg };
    }
  }

  if (provider === 'gigaam_v3') {
    if (!isGigaAmConfigured()) {
      const errorMsg =
        'GigaASR / GigaAM v3 не настроен (отсутствует URL эндпоинта или API-ключ Cloud.ru Evolution). Настройте параметры в панели администратора.';
      log('warning', `[STT] ${errorMsg}`);
      return { text: '', engine: 'none', attemptedProvider: provider, error: errorMsg };
    }

    let preparedWav: Buffer | undefined = options?.isPreparedWav ? audioBuffer : undefined;
    let attempts = 0;

    try {
      log('info', `[STT] Запуск распознавания аудиозаписи через ${providerLabel}...`);
      const rawText = await transcribeWithGigaAmRetry(audioBuffer, mimeType, gigaamVariantOverride, {
        callId: options?.callId,
        isPreparedWav: options?.isPreparedWav,
        emitIncidentSummary: options?.emitIncidentSummary ?? false,
        onPreparedWav: (wavBuf) => {
          preparedWav = wavBuf;
        },
        onAttemptCount: (n) => {
          attempts = n;
        },
      });
      if (rawText && rawText.trim().length > 0) {
        const cleaned = fixDuplicatedTranscript(refineTranscriptRoles(rawText.trim()));
        log('success', `[STT] Речь успешно расшифрована ${providerLabel} (${cleaned.length} симв.)`);
        return {
          text: cleaned,
          engine: 'gigaam_v3',
          attemptedProvider: provider,
          attempts: Math.max(1, attempts),
          preparedWav,
        };
      }
      const emptyMsg = 'Аудиозапись не содержит разборчивой речи (тишина или звуковой сигнал).';
      log('info', `[STT] ${providerLabel}: ${emptyMsg}`);
      return {
        text: '',
        engine: 'gigaam_v3',
        attemptedProvider: provider,
        error: emptyMsg,
        attempts: Math.max(1, attempts),
        preparedWav,
      };
    } catch (err: any) {
      const errMsg = err.message || String(err);
      const httpStatus = typeof err?.status === 'number' ? err.status : undefined;
      const asrFailReason = classifyAsrFailReason(err, httpStatus, err?.http404Body);
      const failedModel =
        typeof err?.asrModel === 'string' && err.asrModel.trim()
          ? err.asrModel.trim()
          : getGigaAmConfig(undefined, undefined, gigaamVariantOverride).variant;
      log('error', `[STT] Ошибка распознавания речи ${providerLabel}: ${errMsg}`);
      return {
        text: '',
        engine: 'none',
        attemptedProvider: provider,
        error: errMsg,
        attempts: Math.max(1, attempts || (typeof err?.sttAttempts === 'number' ? err.sttAttempts : 1)),
        preparedWav,
        rateLimited: Boolean(err?.rateLimited || httpStatus === 429),
        httpStatus,
        asrFailReason,
        failedModel,
        fallbackModelsTried: Array.isArray(err?.asrFallbackModelsTried) ? err.asrFallbackModelsTried : undefined,
        requestId: typeof err?.asrRequestId === 'string' ? err.asrRequestId : undefined,
        endpointPath: typeof err?.asrEndpointPath === 'string' ? err.asrEndpointPath : undefined,
        catalogVerdict: typeof err?.asrCatalogVerdict === 'string' ? err.asrCatalogVerdict : undefined,
        catalogSummary: typeof err?.asrCatalogSummary === 'string' ? err.asrCatalogSummary : undefined,
      };
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
      attemptedProvider: provider,
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
        attemptedProvider: provider,
      };
    } else {
      const emptyMsg = 'Аудиозапись не содержит разборчивой речи (тишина или звуковой сигнал).';
      log('info', `[STT] Yandex SpeechKit: ${emptyMsg}`);
      return {
        text: '',
        engine: 'yandex_speechkit',
        attemptedProvider: provider,
        error: emptyMsg,
      };
    }
  } catch (err: any) {
    const skError = err.message || String(err);
    log('error', `[STT] Ошибка распознавания речи Yandex SpeechKit: ${skError}`);
    return {
      text: '',
      engine: 'none',
      attemptedProvider: provider,
      error: skError,
    };
  }
}
