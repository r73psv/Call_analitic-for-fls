/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import axios from 'axios';
import { GigaamModelVariant } from '../types.js';
import { readStoreSync } from '../store/store.js';
import {
  detectAudioFormat,
  getAudioDuration,
  splitAudioIntoOpusChunks,
  refineTranscriptRoles,
  fixDuplicatedTranscript,
} from './speechkit.js';

export const CLOUDRU_GIGAASR_TRANSCRIPTIONS_URL =
  'https://foundation-models.api.cloud.ru/v1/audio/transcriptions';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;
const VALID_VARIANTS: GigaamModelVariant[] = ['sber/GigaASR', 'e2e_rnnt', 'e2e_ctc', 'rnnt', 'ctc'];

export interface GigaAmConfig {
  apiUrl: string;
  apiKey: string;
  variant: GigaamModelVariant;
  isCloudRu: boolean;
}

export function normalizeGigaamVariant(raw?: string): GigaamModelVariant {
  if (!raw) return 'e2e_rnnt';
  const trimmed = raw.trim();
  if (trimmed.toLowerCase() === 'sber/gigaasr' || trimmed.toLowerCase() === 'gigaasr') {
    return 'sber/GigaASR';
  }
  if (VALID_VARIANTS.includes(trimmed as GigaamModelVariant)) {
    return trimmed as GigaamModelVariant;
  }
  return 'e2e_rnnt';
}

export function isCloudRuEvolutionEndpoint(url: string, variant?: GigaamModelVariant): boolean {
  const lower = (url || '').toLowerCase();
  return lower.includes('cloud.ru') || lower.includes('/v1/audio/transcriptions') || variant === 'sber/GigaASR';
}

export function normalizeGigaAmEndpointUrl(rawUrl: string, variant?: GigaamModelVariant): string {
  const clean = (rawUrl || '').trim().replace(/\/+$/, '');
  if (!clean) {
    return variant === 'sber/GigaASR' ? CLOUDRU_GIGAASR_TRANSCRIPTIONS_URL : '';
  }
  if (/^https?:\/\/foundation-models\.api\.cloud\.ru(\/v1)?$/i.test(clean)) {
    return CLOUDRU_GIGAASR_TRANSCRIPTIONS_URL;
  }
  return clean;
}

export function getGigaAmConfig(
  apiUrlOverride?: string,
  apiKeyOverride?: string,
  variantOverride?: GigaamModelVariant
): GigaAmConfig {
  let storeUrl = '';
  let storeKey = '';
  let storeVariant: GigaamModelVariant | undefined;

  try {
    const store = readStoreSync();
    storeUrl = store.config?.credentials?.gigaamApiUrl || '';
    storeKey = store.config?.credentials?.gigaamApiKey || '';
    storeVariant = store.config?.credentials?.gigaamVariant;
  } catch {
    // ignore early boot store read errors
  }

  const rawUrl = apiUrlOverride !== undefined
    ? apiUrlOverride
    : (storeUrl || process.env.GIGAAM_API_URL || '');
  const apiKey = (
    apiKeyOverride !== undefined
      ? apiKeyOverride
      : (storeKey || process.env.GIGAAM_API_KEY || '')
  ).trim();
  const variant = normalizeGigaamVariant(
    variantOverride || storeVariant || process.env.GIGAAM_MODEL_VARIANT
  );
  const apiUrl = normalizeGigaAmEndpointUrl(rawUrl, variant);
  const isCloudRu = isCloudRuEvolutionEndpoint(apiUrl, variant);

  return {
    apiUrl,
    apiKey,
    variant,
    isCloudRu,
  };
}

export function isGigaAmConfigured(): boolean {
  const { apiUrl, apiKey, isCloudRu } = getGigaAmConfig();
  if (!apiUrl) return false;
  if (isCloudRu && apiUrl.includes('cloud.ru') && !apiKey) return false;
  return true;
}

function getFileMeta(audioFormat: 'mp3' | 'oggopus' | 'lpcm', mimeType?: string): { ext: string; mime: string } {
  if (audioFormat === 'oggopus') return { ext: 'ogg', mime: 'audio/ogg' };
  if (audioFormat === 'lpcm') return { ext: 'wav', mime: 'audio/wav' };
  return { ext: 'mp3', mime: mimeType || 'audio/mpeg' };
}

function extractTextFromGigaAmResponse(data: any): string {
  if (!data) return '';
  if (typeof data === 'string') return data.trim();

  if (typeof data.text === 'string' && data.text.trim()) return data.text.trim();
  if (typeof data.transcription === 'string' && data.transcription.trim()) return data.transcription.trim();
  if (typeof data.transcript === 'string' && data.transcript.trim()) return data.transcript.trim();
  if (typeof data.result === 'string' && data.result.trim()) return data.result.trim();

  if (Array.isArray(data.segments) && data.segments.length > 0) {
    const lines = data.segments
      .map((seg: any) => {
        const text = (seg?.text || seg?.transcript || '').trim();
        if (!text) return '';
        if (seg?.speaker) {
          const sp = String(seg.speaker).toLowerCase();
          const role = sp.includes('1') || sp.includes('manager') || sp.includes('менедж') ? 'Менеджер' : 'Клиент';
          return `${role}: ${text}`;
        }
        return text;
      })
      .filter(Boolean);
    if (lines.length > 0) return lines.join('\n');
  }

  if (Array.isArray(data.results) && data.results.length > 0) {
    const lines = data.results
      .map((r: any) => (r?.text || r?.transcript || r?.alternatives?.[0]?.transcript || '').trim())
      .filter(Boolean);
    if (lines.length > 0) return lines.join('\n');
  }

  if (data.result && typeof data.result === 'object') {
    return extractTextFromGigaAmResponse(data.result);
  }

  return '';
}

async function postAudioToGigaAm(
  audioBuffer: Buffer,
  mimeType: string,
  config: GigaAmConfig,
  fieldName: 'file' | 'audio' = 'file'
): Promise<string> {
  const format = detectAudioFormat(audioBuffer);
  const meta = getFileMeta(format, mimeType);
  const form = new FormData();
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: meta.mime });
  form.append(fieldName, blob, `call.${meta.ext}`);

  const modelParam =
    config.variant === 'sber/GigaASR' || config.apiUrl.includes('cloud.ru')
      ? 'sber/GigaASR'
      : `gigaam-v3-${config.variant}`;
  form.append('model', modelParam);
  form.append('language', 'ru');

  if (config.isCloudRu) {
    form.append('response_format', 'verbose_json');
  } else {
    form.append('variant', config.variant);
  }

  const headers: Record<string, string> = {};
  if (config.apiKey) {
    headers['Authorization'] = config.apiKey.startsWith('Bearer ') ? config.apiKey : `Bearer ${config.apiKey}`;
  }

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers,
    body: form,
    signal: AbortSignal.timeout(120000),
  });

  if (response.status === 422 && fieldName === 'file' && !config.isCloudRu) {
    // Некоторые FastAPI сервисы GigaAM ожидают поле "audio" вместо "file"
    return postAudioToGigaAm(audioBuffer, mimeType, config, 'audio');
  }

  if (response.status === 415 && !config.isCloudRu) {
    // Fallback на JSON с base64 если self-hosted сервер не принимает multipart
    const jsonRes = await axios.post(
      config.apiUrl,
      {
        audio_base64: audioBuffer.toString('base64'),
        model: modelParam,
        variant: config.variant,
        language: 'ru',
        mime_type: meta.mime,
      },
      {
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        timeout: 120000,
      }
    );
    return extractTextFromGigaAmResponse(jsonRes.data);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    const err: any = new Error(
      `${config.isCloudRu ? 'GigaASR (Cloud.ru)' : 'GigaAM v3'} HTTP ${response.status}: ${
        errText.slice(0, 300) || response.statusText
      }`
    );
    err.status = response.status;
    throw err;
  }

  const rawBody = await response.text();
  try {
    const parsed = JSON.parse(rawBody);
    return extractTextFromGigaAmResponse(parsed);
  } catch {
    return rawBody.trim();
  }
}

export async function transcribeWithGigaAm(
  audioBuffer: Buffer,
  mimeType: string = 'audio/mpeg',
  variantOverride?: GigaamModelVariant
): Promise<string> {
  const cfg = getGigaAmConfig(undefined, undefined, variantOverride);
  if (!cfg.apiUrl) {
    throw new Error(
      'GigaASR / GigaAM v3 не настроен: укажите URL эндпоинта (например Cloud.ru Evolution) в настройках системы'
    );
  }
  if (cfg.apiUrl.includes('cloud.ru') && !cfg.apiKey) {
    throw new Error(
      'GigaASR (Cloud.ru Evolution): укажите API-ключ сервисного аккаунта Cloud.ru (GIGAAM_API_KEY) в настройках системы'
    );
  }

  const duration = getAudioDuration(audioBuffer);
  const label = cfg.isCloudRu ? 'GigaASR Cloud.ru' : 'GigaAM v3';
  console.log(
    `[${label}] Отправка аудио (${Math.round(audioBuffer.length / 1024)} КБ, ${duration.toFixed(1)} сек., модель: ${cfg.variant}) -> ${cfg.apiUrl}`
  );

  // Сначала пробуем отправить файл целиком
  try {
    const directText = await postAudioToGigaAm(audioBuffer, mimeType, cfg);
    if (directText && directText.trim()) {
      return fixDuplicatedTranscript(refineTranscriptRoles(directText.trim()));
    }
  } catch (err: any) {
    const shouldChunk =
      duration >= 24 && (err.status === 400 || err.status === 413 || err.status === 422 || /too long|duration|length|size/i.test(err.message));
    if (!shouldChunk) {
      throw err;
    }
    console.warn(`[${label}] Прямая отправка не принята (${err.message}), переключение на сегментацию по паузам...`);
  }

  // Режим сегментации по паузам для слишком длинных записей
  if (duration >= 24) {
    const chunks = splitAudioIntoOpusChunks(audioBuffer, 22);
    if (chunks.length > 0) {
      const chunkTexts: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        try {
          const text = await postAudioToGigaAm(chunks[i], 'audio/ogg', cfg);
          if (text && text.trim()) {
            chunkTexts.push(text.trim());
          }
        } catch (chunkErr: any) {
          console.warn(`[${label}] Ошибка сегмента ${i + 1}/${chunks.length}:`, chunkErr.message);
        }
      }
      if (chunkTexts.length > 0) {
        return fixDuplicatedTranscript(refineTranscriptRoles(chunkTexts.join('\n')));
      }
    }
  }

  return '';
}

export async function transcribeWithGigaAmRetry(
  audioBuffer: Buffer,
  mimeType: string = 'audio/mpeg',
  variantOverride?: GigaamModelVariant
): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await transcribeWithGigaAm(audioBuffer, mimeType, variantOverride);
    } catch (error: any) {
      lastError = error as Error;
      console.error(`[GigaASR / GigaAM v3] Попытка ${attempt}/${MAX_RETRIES} неудачна:`, error.message);
      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw new Error(`GigaASR / GigaAM v3 недоступен после ${MAX_RETRIES} попыток: ${lastError?.message}`);
}

export async function testGigaAmConnection(
  apiUrlOverride?: string,
  apiKeyOverride?: string,
  variantOverride?: GigaamModelVariant
): Promise<{ success: boolean; message: string }> {
  const cfg = getGigaAmConfig(apiUrlOverride, apiKeyOverride, variantOverride);
  if (!cfg.apiUrl) {
    throw new Error('Не указан URL эндпоинта GigaASR / GigaAM v3 (GIGAAM_API_URL)');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(cfg.apiUrl);
  } catch {
    throw new Error(`Некорректный URL эндпоинта GigaASR / GigaAM v3: "${cfg.apiUrl}"`);
  }

  if (cfg.apiUrl.includes('cloud.ru') && !cfg.apiKey) {
    throw new Error('Для Cloud.ru Evolution GigaASR необходимо указать API-ключ сервисного аккаунта');
  }

  const headers: Record<string, string> = {};
  if (cfg.apiKey) {
    headers['Authorization'] = cfg.apiKey.startsWith('Bearer ') ? cfg.apiKey : `Bearer ${cfg.apiKey}`;
  }

  // 1. Для Cloud.ru Evolution / OpenAI-compatible API проверяем GET /v1/models
  if (cfg.isCloudRu) {
    const modelsUrl = `${parsedUrl.origin}/v1/models`;
    try {
      const res = await fetch(modelsUrl, { headers, signal: AbortSignal.timeout(10000) });
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Ошибка авторизации Cloud.ru Evolution (${res.status}): проверьте API-ключ`);
      }
      if (res.ok) {
        const data: any = await res.json().catch(() => ({}));
        const models: any[] = Array.isArray(data?.data) ? data.data : [];
        const hasGigaAsr = models.some((m) => String(m?.id || '').toLowerCase().includes('gigaasr'));
        return {
          success: true,
          message: hasGigaAsr
            ? `Подключение к Cloud.ru Evolution установлено! Модель sber/GigaASR доступна.`
            : `Подключение к Cloud.ru Evolution (${parsedUrl.host}) установлено и авторизовано (модель ${cfg.variant}).`,
        };
      }
    } catch (err: any) {
      if (/авторизац/i.test(err.message)) throw err;
    }
  }

  // 2. Попытка проверить /health на том же хосте (self-hosted GigaAM v3)
  const healthUrl = `${parsedUrl.origin}/health`;
  try {
    const res = await fetch(healthUrl, { headers, signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      return {
        success: true,
        message: `Сервер GigaAM v3 (${parsedUrl.host}, модель ${cfg.variant}) доступен и готов к работе!`,
      };
    }
  } catch {
    // ignore, fallback to checking endpoint itself
  }

  // 3. Попытка OPTIONS на сам endpoint
  try {
    const res = await fetch(cfg.apiUrl, {
      method: 'OPTIONS',
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Ошибка авторизации GigaASR / GigaAM v3 (${res.status}): проверьте API-ключ`);
    }
    if (res.status < 500) {
      return {
        success: true,
        message: `Эндпоинт GigaASR / GigaAM v3 (${parsedUrl.host}, модель ${cfg.variant}) отвечает (HTTP ${res.status}).`,
      };
    }
    throw new Error(`Сервер GigaASR / GigaAM v3 вернул ошибку HTTP ${res.status}`);
  } catch (err: any) {
    throw new Error(`Не удалось подключиться к серверу GigaASR / GigaAM v3 (${cfg.apiUrl}): ${err.message}`);
  }
}
