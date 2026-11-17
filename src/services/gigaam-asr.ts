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
  convertToWav16kMono,
  splitAudioIntoWavChunks,
  splitAudioIntoOpusChunks,
  refineTranscriptRoles,
  fixDuplicatedTranscript,
} from './speechkit.js';

export const CLOUDRU_GIGAASR_TRANSCRIPTIONS_URL =
  'https://foundation-models.api.cloud.ru/v1/audio/transcriptions';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;
const VALID_VARIANTS: GigaamModelVariant[] = ['sber/GigaASR', 'e2e_rnnt', 'e2e_ctc', 'rnnt', 'ctc'];

// Кэш URL-адресов, для которых /v1/audio/transcriptions вернул 404/405, но сработал /v1/chat/completions
const chatCompletionsFallbackUrls = new Set<string>();

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

  const rawVariant = variantOverride || storeVariant || process.env.GIGAAM_MODEL_VARIANT;
  let variant = normalizeGigaamVariant(rawVariant);
  const apiUrl = normalizeGigaAmEndpointUrl(rawUrl, variant);
  const isCloudRu = isCloudRuEvolutionEndpoint(apiUrl, variant);

  // Если URL указывает на Cloud.ru Evolution, а вариант остался дефолтным (e2e_rnnt), используем sber/GigaASR
  if (apiUrl.toLowerCase().includes('cloud.ru') && !variantOverride && !storeVariant && variant === 'e2e_rnnt') {
    variant = 'sber/GigaASR';
  }

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
  const lowerMime = (mimeType || '').toLowerCase();
  if (lowerMime.includes('wav')) return { ext: 'wav', mime: 'audio/wav' };
  if (lowerMime.includes('ogg')) return { ext: 'ogg', mime: 'audio/ogg' };
  if (lowerMime.includes('flac')) return { ext: 'flac', mime: 'audio/flac' };
  if (lowerMime.includes('webm')) return { ext: 'webm', mime: 'audio/webm' };
  if (lowerMime.includes('mp4') || lowerMime.includes('m4a')) return { ext: 'm4a', mime: 'audio/mp4' };
  return { ext: 'mp3', mime: 'audio/mpeg' };
}

export function extractTextFromGigaAmResponse(data: any): string {
  if (!data) return '';
  if (typeof data === 'string') return data.trim();

  if (typeof data.text === 'string' && data.text.trim()) return data.text.trim();
  if (typeof data.transcription === 'string' && data.transcription.trim()) return data.transcription.trim();
  if (typeof data.transcript === 'string' && data.transcript.trim()) return data.transcript.trim();
  if (typeof data.result === 'string' && data.result.trim()) return data.result.trim();
  if (typeof data.output === 'string' && data.output.trim()) return data.output.trim();

  const segmentList = Array.isArray(data.segments)
    ? data.segments
    : Array.isArray(data.utterances)
    ? data.utterances
    : null;

  if (segmentList && segmentList.length > 0) {
    const lines = segmentList
      .map((seg: any) => {
        const text = String(seg?.text || seg?.transcript || seg?.utterance || '').trim();
        if (!text) return '';
        if (seg?.speaker !== undefined && seg?.speaker !== null && String(seg.speaker).trim() !== '') {
          const sp = String(seg.speaker).toLowerCase();
          const role = sp.includes('1') || sp.includes('manager') || sp.includes('менедж') || sp.includes('oper')
            ? 'Менеджер'
            : 'Клиент';
          return `${role}: ${text}`;
        }
        return text;
      })
      .filter(Boolean);
    if (lines.length > 0) return lines.join('\n');
  }

  const listField = Array.isArray(data.results)
    ? data.results
    : Array.isArray(data.hypotheses)
    ? data.hypotheses
    : Array.isArray(data.predictions)
    ? data.predictions
    : null;

  if (listField && listField.length > 0) {
    const lines = listField
      .map((r: any) => {
        if (typeof r === 'string') return r.trim();
        return String(
          r?.text ||
            r?.transcript ||
            r?.transcription ||
            r?.alternatives?.[0]?.transcript ||
            r?.alternatives?.[0]?.text ||
            ''
        ).trim();
      })
      .filter(Boolean);
    if (lines.length > 0) return lines.join('\n');
  }

  if (Array.isArray(data.choices) && data.choices.length > 0) {
    const msgContent = data.choices[0]?.message?.content;
    if (typeof msgContent === 'string' && msgContent.trim()) return msgContent.trim();
    if (Array.isArray(msgContent)) {
      const joined = msgContent
        .map((p: any) => (typeof p === 'string' ? p : p?.text || ''))
        .filter(Boolean)
        .join('\n')
        .trim();
      if (joined) return joined;
    }
    const choiceText = data.choices[0]?.text;
    if (typeof choiceText === 'string' && choiceText.trim()) return choiceText.trim();
  }

  if (data.data && typeof data.data === 'object') {
    const nested = extractTextFromGigaAmResponse(data.data);
    if (nested) return nested;
  }

  if (data.result && typeof data.result === 'object') {
    const nested = extractTextFromGigaAmResponse(data.result);
    if (nested) return nested;
  }

  return '';
}

interface CloudRuAttemptOpts {
  responseFormat?: 'verbose_json' | 'json';
  includeLanguage?: boolean;
}

async function sendMultipartOnce(
  audioBuffer: Buffer,
  meta: { ext: string; mime: string },
  config: GigaAmConfig,
  fieldName: 'file' | 'audio',
  cloudRuOpts?: CloudRuAttemptOpts
): Promise<{ status: number; ok: boolean; statusText: string; rawBody: string }> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: meta.mime });
  form.append(fieldName, blob, `call.${meta.ext}`);

  const modelParam =
    config.variant === 'sber/GigaASR' || config.apiUrl.includes('cloud.ru')
      ? 'sber/GigaASR'
      : `gigaam-v3-${config.variant}`;
  form.append('model', modelParam);

  if (config.isCloudRu) {
    if (cloudRuOpts?.includeLanguage !== false) {
      form.append('language', 'ru');
    }
    if (cloudRuOpts?.responseFormat) {
      form.append('response_format', cloudRuOpts.responseFormat);
    }
  } else {
    form.append('language', 'ru');
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

  const rawBody = await response.text().catch(() => '');
  return {
    status: response.status,
    ok: response.ok,
    statusText: response.statusText,
    rawBody,
  };
}

function getChatCompletionsUrlFromConfig(apiUrl: string): string {
  try {
    const u = new URL(apiUrl);
    if (u.pathname.endsWith('/chat/completions')) return apiUrl;
    return `${u.origin}/v1/chat/completions`;
  } catch {
    return 'https://foundation-models.api.cloud.ru/v1/chat/completions';
  }
}

async function sendChatAudioOnce(
  audioBuffer: Buffer,
  meta: { ext: string; mime: string },
  config: GigaAmConfig,
  mode: 'input_audio' | 'audio_url',
  includeTextPrompt: boolean = true
): Promise<{ status: number; ok: boolean; statusText: string; rawBody: string }> {
  const chatUrl = getChatCompletionsUrlFromConfig(config.apiUrl);
  const modelParam =
    config.variant === 'sber/GigaASR' || config.apiUrl.includes('cloud.ru')
      ? 'sber/GigaASR'
      : `gigaam-v3-${config.variant}`;

  const b64 = audioBuffer.toString('base64');
  const audioPart =
    mode === 'input_audio'
      ? {
          type: 'input_audio',
          input_audio: {
            data: b64,
            format: meta.ext === 'wav' ? 'wav' : meta.ext === 'mp3' ? 'mp3' : meta.ext,
          },
        }
      : {
          type: 'audio_url',
          audio_url: {
            url: `data:${meta.mime};base64,${b64}`,
          },
        };

  const contentParts = includeTextPrompt
    ? [
        {
          type: 'text',
          text: 'Расшифруй аудиозапись телефонного разговора дословно на русском языке. Выведи только текст стенограммы без пояснений.',
        },
        audioPart,
      ]
    : [audioPart];

  const payload: Record<string, any> = {
    model: modelParam,
    messages: [
      {
        role: 'user',
        content: contentParts,
      },
    ],
  };
  if (includeTextPrompt) {
    payload.temperature = 0;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey) {
    headers['Authorization'] = config.apiKey.startsWith('Bearer ') ? config.apiKey : `Bearer ${config.apiKey}`;
  }

  const response = await fetch(chatUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000),
  });

  const rawBody = await response.text().catch(() => '');
  return {
    status: response.status,
    ok: response.ok,
    statusText: response.statusText,
    rawBody,
  };
}

async function tryChatAudioFallback(
  audioBuffer: Buffer,
  meta: { ext: string; mime: string },
  config: GigaAmConfig,
  label: string
): Promise<{ ok: boolean; status: number; statusText: string; rawBody: string; text: string }> {
  // Для OpenAI-совместимого input_audio гарантированно принимаются wav/mp3
  let effectiveBuf = audioBuffer;
  let effectiveMeta = meta;
  let wasConvertedToWav = false;
  if (meta.ext !== 'wav' && meta.ext !== 'mp3') {
    const wavBuf = convertToWav16kMono(audioBuffer);
    if (wavBuf && wavBuf.length > 44) {
      effectiveBuf = wavBuf;
      effectiveMeta = { ext: 'wav', mime: 'audio/wav' };
      wasConvertedToWav = true;
    }
  }

  const attempts: Array<{ mode: 'input_audio' | 'audio_url'; includeText: boolean }> = [
    { mode: 'input_audio', includeText: true },
    { mode: 'audio_url', includeText: true },
    { mode: 'input_audio', includeText: false },
    { mode: 'audio_url', includeText: false },
  ];
  let lastRes: { status: number; ok: boolean; statusText: string; rawBody: string } | null = null;

  for (const attempt of attempts) {
    const res = await sendChatAudioOnce(
      effectiveBuf,
      effectiveMeta,
      config,
      attempt.mode,
      attempt.includeText
    );
    lastRes = res;
    if (res.ok) {
      return {
        ...res,
        text: parseTranscriptionBody(res.rawBody, label),
      };
    }
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      break;
    }
  }

  // Если первый формат (например mp3 или нестандартный WAV) отклонён с 400/415/422 — перекодируем в чистый WAV 16кГц моно PCM
  if (
    !wasConvertedToWav &&
    lastRes &&
    (lastRes.status === 400 || lastRes.status === 415 || lastRes.status === 422)
  ) {
    const wavBuf = convertToWav16kMono(audioBuffer);
    if (wavBuf && wavBuf.length > 44) {
      for (const attempt of attempts.slice(0, 2)) {
        const res = await sendChatAudioOnce(
          wavBuf,
          { ext: 'wav', mime: 'audio/wav' },
          config,
          attempt.mode,
          attempt.includeText
        );
        lastRes = res;
        if (res.ok) {
          return {
            ...res,
            text: parseTranscriptionBody(res.rawBody, label),
          };
        }
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          break;
        }
      }
    }
  }

  return {
    ok: false,
    status: lastRes?.status || 500,
    statusText: lastRes?.statusText || 'Error',
    rawBody: lastRes?.rawBody || '',
    text: '',
  };
}

function parseTranscriptionBody(rawBody: string, label: string): string {
  if (!rawBody || !rawBody.trim()) return '';
  try {
    const parsed = JSON.parse(rawBody);
    const extracted = extractTextFromGigaAmResponse(parsed);
    if (!extracted && parsed && typeof parsed === 'object') {
      console.warn(`[${label}] Ответ 200 OK, но текст не извлечён. Ключи JSON: ${Object.keys(parsed).join(', ')}`);
    }
    return extracted;
  } catch {
    return rawBody.trim();
  }
}

async function postAudioToGigaAm(
  audioBuffer: Buffer,
  mimeType: string,
  config: GigaAmConfig,
  fieldName: 'file' | 'audio' = 'file',
  allowWavFallback: boolean = true
): Promise<string> {
  const format = detectAudioFormat(audioBuffer);
  const meta = getFileMeta(format, mimeType);
  const label = config.isCloudRu ? 'GigaASR (Cloud.ru)' : 'GigaAM v3';

  if (config.isCloudRu) {
    const isDirectChatUrl = config.apiUrl.toLowerCase().endsWith('/chat/completions');
    if (isDirectChatUrl || chatCompletionsFallbackUrls.has(config.apiUrl)) {
      const chatRes = await tryChatAudioFallback(audioBuffer, meta, config, label);
      if (chatRes.ok) {
        return chatRes.text;
      }
      const err: any = new Error(
        `${label} /chat/completions HTTP ${chatRes.status}: ${
          chatRes.rawBody.slice(0, 300) || chatRes.statusText
        }`
      );
      err.status = chatRes.status;
      throw err;
    }

    const paramProfiles: CloudRuAttemptOpts[] = [
      { responseFormat: 'json', includeLanguage: true },
      { responseFormat: 'verbose_json', includeLanguage: true },
      { includeLanguage: false },
    ];

    let lastRes: { status: number; ok: boolean; statusText: string; rawBody: string } | null = null;
    for (const profile of paramProfiles) {
      const res = await sendMultipartOnce(audioBuffer, meta, config, fieldName, profile);
      lastRes = res;

      if (res.ok) {
        const parsedText = parseTranscriptionBody(res.rawBody, label);
        if (parsedText) return parsedText;
        // Если ответ 200 OK с пустым текстом, пробуем следующий профиль или WAV fallback
        continue;
      }

      // Ошибки авторизации, лимитов или отсутствия маршрута (404/405) не исправятся сменой полей multipart
      if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 405 || res.status === 429) {
        break;
      }

      // При 400 / 415 / 422 пробуем более простой набор параметров
      if (res.status !== 400 && res.status !== 415 && res.status !== 422 && res.status !== 500) {
        break;
      }
    }

    // Если /v1/audio/transcriptions вернул 404 или 405, пробуем Cloud.ru /v1/chat/completions (input_audio / audio_url)
    if (lastRes && (lastRes.status === 404 || lastRes.status === 405)) {
      console.warn(
        `[${label}] ${config.apiUrl} вернул HTTP ${lastRes.status}, переключение на ${getChatCompletionsUrlFromConfig(config.apiUrl)}...`
      );
      const chatRes = await tryChatAudioFallback(audioBuffer, meta, config, label);
      if (chatRes.ok) {
        chatCompletionsFallbackUrls.add(config.apiUrl);
        return chatRes.text;
      }
      const err: any = new Error(
        `${label}: ${config.apiUrl} вернул HTTP ${lastRes.status} (${lastRes.statusText}), а ${getChatCompletionsUrlFromConfig(config.apiUrl)} вернул HTTP ${chatRes.status}: ${
          chatRes.rawBody.slice(0, 220) || chatRes.statusText
        }`
      );
      err.status = chatRes.status;
      throw err;
    }

    // Если запрос прошёл (200 OK), но текст пустой — не считаем это HTTP-ошибкой
    if (lastRes?.ok) {
      if (allowWavFallback && meta.ext !== 'wav') {
        const wavBuf = convertToWav16kMono(audioBuffer);
        if (wavBuf && wavBuf.length > 44) {
          console.log(`[${label}] Повторная отправка в универсальном формате WAV 16кГц моно...`);
          return postAudioToGigaAm(wavBuf, 'audio/wav', config, fieldName, false);
        }
      }
      return '';
    }

    // Если шлюз отклонил формат контейнера (например GSM WAV, OGG или нестандартный MP3) — перекодируем в WAV 16kHz PCM
    if (
      allowWavFallback &&
      lastRes &&
      (lastRes.status === 400 || lastRes.status === 415 || lastRes.status === 422 || lastRes.status === 500)
    ) {
      const wavBuf = convertToWav16kMono(audioBuffer);
      if (wavBuf && wavBuf.length > 44) {
        console.warn(
          `[${label}] Ответ HTTP ${lastRes.status} для ${meta.ext}. Конвертация в стандартный WAV 16кГц моно и повтор...`
        );
        return postAudioToGigaAm(wavBuf, 'audio/wav', config, fieldName, false);
      }
    }

    const err: any = new Error(
      `${label} HTTP ${lastRes?.status || 500}: ${
        (lastRes?.rawBody || '').slice(0, 300) || lastRes?.statusText || 'Неизвестная ошибка'
      }`
    );
    err.status = lastRes?.status || 500;
    throw err;
  }

  // Self-hosted GigaAM v3
  const res = await sendMultipartOnce(audioBuffer, meta, config, fieldName);

  if (res.status === 422 && fieldName === 'file') {
    return postAudioToGigaAm(audioBuffer, mimeType, config, 'audio', allowWavFallback);
  }

  if (res.status === 415) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) {
      headers['Authorization'] = config.apiKey.startsWith('Bearer ') ? config.apiKey : `Bearer ${config.apiKey}`;
    }
    const jsonRes = await axios.post(
      config.apiUrl,
      {
        audio_base64: audioBuffer.toString('base64'),
        model: `gigaam-v3-${config.variant}`,
        variant: config.variant,
        language: 'ru',
        mime_type: meta.mime,
      },
      { headers, timeout: 120000 }
    );
    return extractTextFromGigaAmResponse(jsonRes.data);
  }

  if (!res.ok) {
    if (allowWavFallback && meta.ext !== 'wav' && (res.status === 400 || res.status === 422 || res.status === 500)) {
      const wavBuf = convertToWav16kMono(audioBuffer);
      if (wavBuf && wavBuf.length > 44) {
        return postAudioToGigaAm(wavBuf, 'audio/wav', config, fieldName, false);
      }
    }
    const err: any = new Error(
      `${label} HTTP ${res.status}: ${res.rawBody.slice(0, 300) || res.statusText}`
    );
    err.status = res.status;
    throw err;
  }

  return parseTranscriptionBody(res.rawBody, label);
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
  let directError: Error | null = null;
  try {
    const directText = await postAudioToGigaAm(audioBuffer, mimeType, cfg);
    if (directText && directText.trim()) {
      return fixDuplicatedTranscript(refineTranscriptRoles(directText.trim()));
    }
  } catch (err: any) {
    directError = err;
    const isAuthOrQuotaError = err.status === 401 || err.status === 403 || err.status === 404;
    if (isAuthOrQuotaError) {
      throw err;
    }
    const canTryChunking =
      duration >= 20 ||
      (duration === 0 && audioBuffer.length > 256 * 1024) ||
      err.status === 400 ||
      err.status === 413 ||
      err.status === 415 ||
      err.status === 422 ||
      err.status === 500 ||
      /too long|duration|length|size|limit|timeout/i.test(err.message);
    if (!canTryChunking) {
      throw err;
    }
    console.warn(`[${label}] Прямая отправка не принята (${err.message}), переключение на сегментацию WAV 16кГц...`);
  }

  // Режим сегментации по паузам в стандартном WAV 16kHz mono (или fallback в OGG Opus)
  const shouldChunk = duration >= 20 || (duration === 0 && audioBuffer.length > 256 * 1024) || Boolean(directError);
  if (shouldChunk) {
    let chunks = splitAudioIntoWavChunks(audioBuffer, 22);
    let chunkMime = 'audio/wav';
    if (chunks.length === 0) {
      chunks = splitAudioIntoOpusChunks(audioBuffer, 22);
      chunkMime = 'audio/ogg';
    }

    if (chunks.length > 0) {
      const chunkTexts: string[] = [];
      let lastChunkErr: Error | null = null;
      for (let i = 0; i < chunks.length; i++) {
        try {
          const text = await postAudioToGigaAm(chunks[i], chunkMime, cfg, 'file', chunkMime !== 'audio/wav');
          if (text && text.trim()) {
            chunkTexts.push(text.trim());
          }
        } catch (chunkErr: any) {
          lastChunkErr = chunkErr;
          console.warn(`[${label}] Ошибка сегмента ${i + 1}/${chunks.length}:`, chunkErr.message);
        }
      }
      if (chunkTexts.length > 0) {
        return fixDuplicatedTranscript(refineTranscriptRoles(chunkTexts.join('\n')));
      }
      if (lastChunkErr) {
        throw lastChunkErr;
      }
    }
  }

  if (directError) {
    throw directError;
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
      // Ошибки авторизации и 404 не имеют смысла для ретраев
      if (error.status === 401 || error.status === 403 || error.status === 404) {
        break;
      }
      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw new Error(`GigaASR / GigaAM v3 недоступен: ${lastError?.message}`);
}

/**
 * Генерирует минимальный валидный WAV-файл (0.2 сек тишины, 16 кГц моно 16-bit PCM)
 * для реальной проверки эндпоинта транскрибации.
 */
function createSilentWavProbeBuffer(): Buffer {
  const sampleRate = 16000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = Math.floor(sampleRate * 0.2);
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  buf.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  return buf;
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

  // 1. Для Cloud.ru Evolution / OpenAI-compatible API проверяем /v1/models и тестовую транскрибацию
  if (cfg.isCloudRu) {
    let hasGigaAsr = false;
    let audioModelsList: string[] = [];
    const modelsUrl = `${parsedUrl.origin}/v1/models`;
    try {
      const res = await fetch(modelsUrl, { headers, signal: AbortSignal.timeout(10000) });
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Ошибка авторизации Cloud.ru Evolution (${res.status}): проверьте API-ключ`);
      }
      if (res.ok) {
        const data: any = await res.json().catch(() => ({}));
        const models: any[] = Array.isArray(data?.data) ? data.data : [];
        hasGigaAsr = models.some((m) => String(m?.id || '').toLowerCase().includes('gigaasr'));
        audioModelsList = models
          .map((m) => String(m?.id || ''))
          .filter((id) => /asr|whisper|audio|speech|gigaasr/i.test(id));
      }
    } catch (err: any) {
      if (/авторизац/i.test(err.message)) throw err;
    }

    const probeWav = createSilentWavProbeBuffer();
    const isDirectChatUrl = cfg.apiUrl.toLowerCase().endsWith('/chat/completions');

    // Реальная проверка инференса эндпоинта транскрибации коротким тихим WAV
    let transcriptionsStatus: number | null = null;
    let transcriptionsErrBody = '';

    if (!isDirectChatUrl) {
      const probeRes = await sendMultipartOnce(
        probeWav,
        { ext: 'wav', mime: 'audio/wav' },
        cfg,
        'file',
        { responseFormat: 'json', includeLanguage: true }
      );
      if (probeRes.status === 401 || probeRes.status === 403) {
        throw new Error(`Ошибка авторизации при обращении к ${cfg.apiUrl} (HTTP ${probeRes.status})`);
      }
      if (probeRes.ok) {
        return {
          success: true,
          message: hasGigaAsr
            ? `Подключение к Cloud.ru Evolution установлено! Модель sber/GigaASR доступна и /v1/audio/transcriptions отвечает.`
            : `Подключение к Cloud.ru Evolution (${parsedUrl.host}) и эндпоинт транскрибации работают корректно.`,
        };
      }

      if (probeRes.status !== 404 && probeRes.status !== 405) {
        const minimalProbe = await sendMultipartOnce(
          probeWav,
          { ext: 'wav', mime: 'audio/wav' },
          cfg,
          'file',
          { includeLanguage: false }
        );
        if (minimalProbe.ok) {
          return {
            success: true,
            message: hasGigaAsr
              ? `Подключение к Cloud.ru Evolution установлено! Модель sber/GigaASR готова к транскрибации.`
              : `Эндпоинт транскрибации Cloud.ru Evolution (${parsedUrl.host}) работает корректно.`,
          };
        }
        transcriptionsStatus = minimalProbe.status;
        transcriptionsErrBody = minimalProbe.rawBody.slice(0, 180) || minimalProbe.statusText;
      } else {
        transcriptionsStatus = probeRes.status;
        transcriptionsErrBody = probeRes.rawBody.slice(0, 180) || probeRes.statusText;
      }
    }

    // Если /v1/audio/transcriptions вернул 404/405 или указан /v1/chat/completions — проверяем аудио-режим через /v1/chat/completions
    if (isDirectChatUrl || transcriptionsStatus === 404 || transcriptionsStatus === 405) {
      const chatProbe = await tryChatAudioFallback(
        probeWav,
        { ext: 'wav', mime: 'audio/wav' },
        cfg,
        'GigaASR Probe'
      );
      if (chatProbe.ok) {
        if (!isDirectChatUrl) {
          chatCompletionsFallbackUrls.add(cfg.apiUrl);
        }
        return {
          success: true,
          message: hasGigaAsr
            ? `Подключение к Cloud.ru Evolution установлено! Модель sber/GigaASR работает через /v1/chat/completions (аудио-режим).`
            : `Подключение к Cloud.ru Evolution (${parsedUrl.host}) через /v1/chat/completions установлено.`,
        };
      }

      // Если пользователь явно указал /v1/chat/completions, но он не принял аудио — проверим также /v1/audio/transcriptions
      if (isDirectChatUrl && transcriptionsStatus === null) {
        const txUrl = `${parsedUrl.origin}/v1/audio/transcriptions`;
        const txProbe = await sendMultipartOnce(
          probeWav,
          { ext: 'wav', mime: 'audio/wav' },
          { ...cfg, apiUrl: txUrl },
          'file',
          { includeLanguage: false }
        );
        if (txProbe.ok) {
          return {
            success: true,
            message: `Подключение установлено! Для транскрибации используйте эндпоинт ${txUrl} (а не /v1/chat/completions).`,
          };
        }
        transcriptionsStatus = txProbe.status;
        transcriptionsErrBody = txProbe.rawBody.slice(0, 180) || txProbe.statusText;
      }

      const audioHint = audioModelsList.length > 0
        ? ` Аудио-модели в каталоге: ${audioModelsList.join(', ')}.`
        : '';
      const txUrlLabel = isDirectChatUrl ? `${parsedUrl.origin}/v1/audio/transcriptions` : cfg.apiUrl;
      const txPart = transcriptionsStatus
        ? `${txUrlLabel} -> HTTP ${transcriptionsStatus} (${transcriptionsErrBody}); `
        : '';
      throw new Error(
        `Модель видна в /v1/models, но транскрибация недоступна: ${txPart}${getChatCompletionsUrlFromConfig(cfg.apiUrl)} -> HTTP ${chatProbe.status} (${
          chatProbe.rawBody.slice(0, 180) || chatProbe.statusText
        }).${audioHint}`
      );
    }

    const audioHint = audioModelsList.length > 0
      ? ` Аудио-модели в каталоге: ${audioModelsList.join(', ')}.`
      : '';
    throw new Error(
      `Модель видна в /v1/models, но эндпоинт транскрибации ${cfg.apiUrl} вернул HTTP ${transcriptionsStatus}: ${transcriptionsErrBody}.${audioHint}`
    );
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
