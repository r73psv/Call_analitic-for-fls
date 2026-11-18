/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import axios from 'axios';
import * as fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { readStoreSync } from '../store/store.js';
import {
  detectAudioFormat,
  getAudioDuration,
  detectSilenceMidpoints,
  computeSilenceCutPoints,
  refineTranscriptRoles,
  fixDuplicatedTranscript,
  probeAudioChannels,
  splitStereoToMonoWavChannels,
  mergeDualChannelTranscripts,
  TimedUtterance,
} from './speechkit.js';

const TBANK_STT_BASE_URL = process.env.TBANK_VOICEKIT_ENDPOINT || 'https://api.tbank.ru';
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;
const SEGMENT_SECONDS = 24;

export interface TbankVoiceKitCredentials {
  apiKey: string;
  secretKey: string;
}

export function getTbankVoiceKitCredentials(
  apiKeyOverride?: string,
  secretKeyOverride?: string
): TbankVoiceKitCredentials {
  let storeApiKey = '';
  let storeSecretKey = '';
  try {
    const store = readStoreSync();
    storeApiKey = store.config?.credentials?.tbankApiKey || '';
    storeSecretKey = store.config?.credentials?.tbankSecretKey || '';
  } catch {
    // ignore store read errors during early boot
  }

  return {
    apiKey: (apiKeyOverride ?? storeApiKey ?? process.env.TBANK_VOICEKIT_API_KEY ?? '').trim(),
    secretKey: (secretKeyOverride ?? storeSecretKey ?? process.env.TBANK_VOICEKIT_SECRET_KEY ?? '').trim(),
  };
}

export function isTbankVoiceKitConfigured(): boolean {
  const { apiKey, secretKey } = getTbankVoiceKitCredentials();
  return Boolean(apiKey && secretKey);
}

function decodeSecretKey(secretKey: string): Buffer {
  const clean = secretKey.trim();
  // T-Bank VoiceKit secret keys are typically base64-encoded strings.
  const normalized = clean.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const b64Buf = Buffer.from(padded, 'base64');
  // Re-encode to check whether secretKey was valid base64
  if (b64Buf.length > 0 && b64Buf.toString('base64').replace(/=+$/, '') === normalized.replace(/=+$/, '')) {
    return b64Buf;
  }
  return Buffer.from(clean, 'utf-8');
}

/**
 * Генерация HS256 JWT для авторизации в T-Bank VoiceKit (tinkoff.cloud.stt).
 */
export function createTbankVoiceKitJwt(
  apiKey: string,
  secretKey: string,
  scope: string = 'tinkoff.cloud.stt',
  ttlSeconds: number = 600
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'HS256',
    typ: 'JWT',
    kid: apiKey,
  };
  const payload = {
    iss: 'callqa',
    sub: 'stt',
    aud: scope,
    iat: now,
    nbf: now,
    exp: now + ttlSeconds,
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const keyBuf = decodeSecretKey(secretKey);
  const signature = crypto.createHmac('sha256', keyBuf).update(signingInput).digest('base64url');

  return `${signingInput}.${signature}`;
}

function getEncodingConfig(
  audioFormat: 'mp3' | 'oggopus' | 'lpcm'
): { encoding: string; sample_rate_hertz: number } {
  if (audioFormat === 'lpcm') {
    return { encoding: 'LINEAR16', sample_rate_hertz: 16000 };
  }
  if (audioFormat === 'oggopus') {
    return { encoding: 'RAW_OPUS', sample_rate_hertz: 16000 };
  }
  return { encoding: 'MPEG_AUDIO', sample_rate_hertz: 16000 };
}

function convertToLinear16Mono(buffer: Buffer): Buffer | null {
  let tempDir = '';
  try {
    tempDir = path.join(process.cwd(), 'temp', `tb-cv-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const inPath = path.join(tempDir, 'input.tmp');
    const outPath = path.join(tempDir, 'out.pcm');
    fs.writeFileSync(inPath, buffer);
    execSync(`ffmpeg -y -i "${inPath}" -vn -f s16le -acodec pcm_s16le -ar 16000 -ac 1 "${outPath}" 2>/dev/null`, {
      timeout: 30000,
    });
    if (fs.existsSync(outPath)) {
      return fs.readFileSync(outPath);
    }
  } catch (err: any) {
    console.warn('[T-Bank VoiceKit] Ошибка конвертации аудио в LINEAR16 PCM:', err.message);
  } finally {
    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  }
  return null;
}

function splitAudioIntoLinear16Chunks(buffer: Buffer, chunkSeconds: number = SEGMENT_SECONDS): Buffer[] {
  const chunks: Buffer[] = [];
  let tempDir = '';
  try {
    tempDir = path.join(process.cwd(), 'temp', `tb-chunks-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const inPath = path.join(tempDir, 'source.tmp');
    fs.writeFileSync(inPath, buffer);

    const duration = getAudioDuration(buffer);
    const midpoints = duration > 0 ? detectSilenceMidpoints(buffer) : [];
    const cutPoints = midpoints.length > 0 ? computeSilenceCutPoints(midpoints, duration) : [];

    // Сначала конвертируем в WAV 16kHz mono, затем нарезаем на raw s16le куски
    const wavPath = path.join(tempDir, 'mono16k.wav');
    execSync(`ffmpeg -y -i "${inPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${wavPath}" 2>/dev/null`, {
      timeout: 45000,
    });

    if (cutPoints.length > 0) {
      const timesArg = cutPoints.join(',');
      execSync(
        `ffmpeg -y -i "${wavPath}" -f segment -segment_times ${timesArg} -c:a pcm_s16le -f s16le "${path.join(tempDir, 'chunk_%03d.pcm')}" 2>/dev/null`,
        { timeout: 60000 }
      );
    } else {
      execSync(
        `ffmpeg -y -i "${wavPath}" -f segment -segment_time ${chunkSeconds} -c:a pcm_s16le -f s16le "${path.join(tempDir, 'chunk_%03d.pcm')}" 2>/dev/null`,
        { timeout: 60000 }
      );
    }

    const files = fs
      .readdirSync(tempDir)
      .filter((f) => f.startsWith('chunk_') && f.endsWith('.pcm'))
      .sort();
    for (const f of files) {
      const buf = fs.readFileSync(path.join(tempDir, f));
      if (buf.length > 0) chunks.push(buf);
    }
  } catch (err: any) {
    console.warn('[T-Bank VoiceKit] Ошибка разбиения аудио на PCM-сегменты:', err.message);
  } finally {
    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  }
  return chunks;
}

function parseVoiceKitResults(results: any[]): string {
  if (!Array.isArray(results) || results.length === 0) return '';

  const items = results
    .map((r) => {
      const alt = Array.isArray(r?.alternatives) ? r.alternatives[0] : null;
      const text = (alt?.transcript || '').trim();
      const startSec = r?.start_time ? parseFloat(String(r.start_time).replace('s', '')) || 0 : 0;
      const channel = r?.channel !== undefined ? Number(r.channel) : r?.channel_tag !== undefined ? Number(r.channel_tag) : 0;
      return { text, startSec, channel };
    })
    .filter((i) => i.text.length > 0);

  if (items.length === 0) return '';

  const channels = new Set(items.map((i) => i.channel).filter((c) => c > 0));
  if (channels.size >= 2) {
    const sorted = [...items].sort((a, b) => a.startSec - b.startSec);
    return sorted
      .map((i) => `${i.channel === 1 ? 'Менеджер' : 'Клиент'}: ${i.text}`)
      .join('\n');
  }

  return items.map((i) => i.text).join('\n');
}

function parseVoiceKitUtterances(results: any[], offsetSec: number = 0): TimedUtterance[] {
  if (!Array.isArray(results) || results.length === 0) return [];
  const mapped: (TimedUtterance | null)[] = results.map((r) => {
    const alt = Array.isArray(r?.alternatives) ? r.alternatives[0] : null;
    const text = String(alt?.transcript || '').trim();
    const startSec = r?.start_time ? parseFloat(String(r.start_time).replace('s', '')) || 0 : 0;
    const endSec = r?.end_time ? parseFloat(String(r.end_time).replace('s', '')) || 0 : undefined;
    return text
      ? { text, start: startSec + offsetSec, end: endSec !== undefined ? endSec + offsetSec : undefined }
      : null;
  });
  return mapped.filter((u): u is TimedUtterance => u !== null);
}

async function recognizeSyncRaw(
  audioBuffer: Buffer,
  encoding: string,
  sampleRateHertz: number,
  creds: TbankVoiceKitCredentials
): Promise<any[]> {
  const jwt = createTbankVoiceKitJwt(creds.apiKey, creds.secretKey);
  const res = await axios.post(
    `${TBANK_STT_BASE_URL}/v1/stt:recognize`,
    {
      config: {
        encoding,
        sample_rate_hertz: sampleRateHertz,
        num_channels: 1,
        enable_automatic_punctuation: true,
        language_code: 'ru-RU',
      },
      audio: {
        content: audioBuffer.toString('base64'),
      },
    },
    {
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000,
    }
  );

  return res.data?.results || res.data?.response?.results || [];
}

async function recognizeSync(
  audioBuffer: Buffer,
  encoding: string,
  sampleRateHertz: number,
  creds: TbankVoiceKitCredentials
): Promise<string> {
  const results = await recognizeSyncRaw(audioBuffer, encoding, sampleRateHertz, creds);
  return parseVoiceKitResults(results);
}

async function transcribeMonoChannelWithTbank(
  wavOrBuffer: Buffer,
  creds: TbankVoiceKitCredentials
): Promise<TimedUtterance[]> {
  const dur = getAudioDuration(wavOrBuffer);
  if (dur > 0 && dur < 45 && wavOrBuffer.length <= 8 * 1024 * 1024) {
    const pcm = convertToLinear16Mono(wavOrBuffer);
    if (pcm && pcm.length > 0) {
      const results = await recognizeSyncRaw(pcm, 'LINEAR16', 16000, creds);
      const utts = parseVoiceKitUtterances(results, 0);
      if (utts.length > 0) return utts;
    }
  }
  const chunks = splitAudioIntoLinear16Chunks(wavOrBuffer);
  const out: TimedUtterance[] = [];
  for (let i = 0; i < chunks.length; i++) {
    try {
      const results = await recognizeSyncRaw(chunks[i], 'LINEAR16', 16000, creds);
      out.push(...parseVoiceKitUtterances(results, i * SEGMENT_SECONDS));
    } catch (chunkErr: any) {
      console.warn(`[T-Bank VoiceKit Channel] Ошибка сегмента ${i + 1}/${chunks.length}:`, chunkErr.message);
    }
  }
  return out;
}

export async function transcribeWithTbankVoiceKit(audioBuffer: Buffer): Promise<string> {
  const creds = getTbankVoiceKitCredentials();
  if (!creds.apiKey || !creds.secretKey) {
    throw new Error(
      'T-Bank VoiceKit не настроен: укажите API Key и Secret Key в разделе настроек системы (или переменные TBANK_VOICEKIT_API_KEY / TBANK_VOICEKIT_SECRET_KEY)'
    );
  }

  const audioFormat = detectAudioFormat(audioBuffer);
  const duration = getAudioDuration(audioBuffer);
  const channels = probeAudioChannels(audioBuffer);
  console.log(
    `[T-Bank VoiceKit] Подготовка аудио (${Math.round(audioBuffer.length / 1024)} КБ, ${duration.toFixed(1)} сек., каналов: ${channels}, формат: ${audioFormat})`
  );

  if (channels >= 2) {
    const split = splitStereoToMonoWavChannels(audioBuffer);
    if (split && !split.isDualMono) {
      console.log('[T-Bank VoiceKit] Стереозапись: разделение на 2 моно-канала для раздельного распознавания...');
      const [ch0Utts, ch1Utts] = await Promise.all([
        transcribeMonoChannelWithTbank(split.ch0, creds),
        transcribeMonoChannelWithTbank(split.ch1, creds),
      ]);
      const merged = mergeDualChannelTranscripts(ch0Utts, ch1Utts);
      if (merged.trim()) {
        return merged;
      }
    }
  }

  // Для коротких записей (< 45 сек. и <= 8 МБ) отправляем напрямую в :recognize
  if (duration > 0 && duration < 45 && audioBuffer.length <= 8 * 1024 * 1024) {
    try {
      const enc = getEncodingConfig(audioFormat);
      const rawText = await recognizeSync(audioBuffer, enc.encoding, enc.sample_rate_hertz, creds);
      if (rawText.trim()) {
        return fixDuplicatedTranscript(refineTranscriptRoles(rawText.trim()));
      }
    } catch (directErr: any) {
      console.warn('[T-Bank VoiceKit] Прямое распознавание завершилось ошибкой, переключение на PCM:', directErr.message);
      const pcm = convertToLinear16Mono(audioBuffer);
      if (pcm && pcm.length > 0) {
        const rawText = await recognizeSync(pcm, 'LINEAR16', 16000, creds);
        if (rawText.trim()) {
          return fixDuplicatedTranscript(refineTranscriptRoles(rawText.trim()));
        }
      }
    }
  }

  // Для длинных записей: нарезка по паузам на 24-сек. PCM LINEAR16 16kHz сегменты
  console.log(`[T-Bank VoiceKit] Разделение аудио (${duration.toFixed(1)} сек.) на сегменты для пошагового распознавания...`);
  const chunks = splitAudioIntoLinear16Chunks(audioBuffer);
  if (chunks.length > 0) {
    const chunkTexts: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      try {
        const text = await recognizeSync(chunks[i], 'LINEAR16', 16000, creds);
        if (text && text.trim()) {
          chunkTexts.push(text.trim());
        }
      } catch (chunkErr: any) {
        console.warn(`[T-Bank VoiceKit] Ошибка распознавания сегмента ${i + 1}/${chunks.length}:`, chunkErr.message);
      }
    }
    if (chunkTexts.length > 0) {
      const fullText = chunkTexts.join('\n');
      return fixDuplicatedTranscript(refineTranscriptRoles(fullText));
    }
  }

  // Финальная попытка для короткого или нестандартного файла
  const pcmFallback = convertToLinear16Mono(audioBuffer);
  if (pcmFallback && pcmFallback.length > 0) {
    const text = await recognizeSync(pcmFallback, 'LINEAR16', 16000, creds);
    if (text.trim()) {
      return fixDuplicatedTranscript(refineTranscriptRoles(text.trim()));
    }
  }

  return '';
}

export async function transcribeWithTbankVoiceKitRetry(audioBuffer: Buffer): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await transcribeWithTbankVoiceKit(audioBuffer);
    } catch (error: any) {
      lastError = error as Error;
      const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      console.error(`[T-Bank VoiceKit] Попытка ${attempt}/${MAX_RETRIES} неудачна:`, detail);
      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw new Error(`T-Bank VoiceKit недоступен после ${MAX_RETRIES} попыток: ${lastError?.message}`);
}

export async function testTbankVoiceKitConnection(
  apiKeyOverride?: string,
  secretKeyOverride?: string
): Promise<{ success: boolean; message: string }> {
  const creds = getTbankVoiceKitCredentials(apiKeyOverride, secretKeyOverride);
  if (!creds.apiKey || !creds.secretKey) {
    throw new Error('Не указаны API Key и Secret Key для T-Bank VoiceKit');
  }

  const jwt = createTbankVoiceKitJwt(creds.apiKey, creds.secretKey);
  // Отправляем минимальный тестовый буфер тишины (LINEAR16 16kHz 0.2s)
  const silenceBuf = Buffer.alloc(6400);

  try {
    await axios.post(
      `${TBANK_STT_BASE_URL}/v1/stt:recognize`,
      {
        config: {
          encoding: 'LINEAR16',
          sample_rate_hertz: 16000,
          num_channels: 1,
        },
        audio: {
          content: silenceBuf.toString('base64'),
        },
      },
      {
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    return {
      success: true,
      message: 'Соединение с T-Bank VoiceKit успешно подтверждено! JWT-авторизация пройдена.',
    };
  } catch (err: any) {
    const status = err.response?.status;
    if (status === 401 || status === 403 || status === 407) {
      const detail = err.response?.data?.message || err.response?.data?.error || 'Неверный API Key или Secret Key';
      throw new Error(`Ошибка авторизации T-Bank VoiceKit (${status}): ${detail}`);
    }
    if (status === 400) {
      return {
        success: true,
        message: 'Ключи T-Bank VoiceKit подтверждены сервером (JWT-подпись принята).',
      };
    }
    throw new Error(err.response?.data?.message || err.message);
  }
}
