/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CallRecord, VkConfig } from '../types.js';
import { stripIvrFromTranscript } from './transcriptUtils.js';

export const VK_CALL_MESSAGE_MAX_LENGTH = 4000;

export const DEFAULT_VK_CALL_TEMPLATE =
  `🔔 *Анализ звонка #{call_id}*\n` +
  `📅 *Дата:* {call_date_time}\n` +
  `⏱️ *Длительность:* {duration}\n` +
  `👤 *Клиент:* {client_name}\n` +
  `📞 *Оценка оператора:* {operator_score}\n` +
  `📝 *Краткий пересказ диалога:* {short_summary}\n` +
  `💬 *Резюме:* {summary}\n` +
  `⚠️ *Конфликт:* {is_dispute_text}\n` +
  `💡 *Рекомендации:* {recommendations}`;

const PHONE_PATTERN_RE =
  /(?:\+?\s*7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-()]*\d{2}[\s\-()]*\d{2}|\b\d{10,11}\b/g;

const PLACEHOLDER_EMPTY_RE =
  /^(?:не\s+(?:озвучено|указано|применимо|выбран[ао]?|выявлены|требуются)|нет|н\/д|—|-|\s)*$/i;

const TECHNICAL_TRANSCRIPT_MARKERS = [
  'загрузка аудиозаписи',
  'аудиозапись не была загружена',
  'запись разговора и стенограмма отсутствуют',
  'не удавалось скачать',
  'не сформирована',
  'не состоялся по технической причине',
];

function stripRawPhones(text: string): string {
  return text.replace(PHONE_PATTERN_RE, '[номер скрыт]');
}

function cleanWhitespace(text: string): string {
  return text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function isMeaningfulField(val?: string | null): boolean {
  if (!val || typeof val !== 'string') return false;
  const trimmed = val.trim();
  return trimmed.length > 0 && !PLACEHOLDER_EMPTY_RE.test(trimmed);
}

function formatUtc4DateTimeDefault(dateStr?: string): string {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  const utc4 = new Date(date.getTime() + 4 * 3600 * 1000);
  const dd = String(utc4.getUTCDate()).padStart(2, '0');
  const mm = String(utc4.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = utc4.getUTCFullYear();
  const hh = String(utc4.getUTCHours()).padStart(2, '0');
  const min = String(utc4.getUTCMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
}

function formatUtc4DateDefault(dateStr?: string): string {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  const utc4 = new Date(date.getTime() + 4 * 3600 * 1000);
  const dd = String(utc4.getUTCDate()).padStart(2, '0');
  const mm = String(utc4.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = utc4.getUTCFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function formatUtc4TimeDefault(dateStr?: string): string {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  const utc4 = new Date(date.getTime() + 4 * 3600 * 1000);
  const hh = String(utc4.getUTCHours()).padStart(2, '0');
  const min = String(utc4.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${min}`;
}

function formatDurationDefault(seconds?: number): string {
  if (seconds === undefined || seconds === null || isNaN(seconds)) return 'н/д';
  if (seconds <= 0) return '00:00 (0 сек.)';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins === 0) return `${secs} сек.`;
  return `${mins} мин. ${secs} сек. (${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')})`;
}

function formatDurationMmSsDefault(seconds?: number): string {
  if (seconds === undefined || seconds === null || isNaN(seconds)) return '00:00';
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function buildFallbackFromStructuredFacts(call: CallRecord): string {
  const struct = call.structured_summary || call.key_facts?.structured_summary;
  const kf = call.key_facts;

  const purpose = struct?.call_purpose || kf?.call_purpose || kf?.client_issue;
  const service = struct?.requested_service || kf?.requested_service || kf?.service;
  const master = struct?.offered_master || kf?.offered_master || kf?.master;
  const dateTime =
    struct?.offered_date_time ||
    kf?.offered_date_time ||
    [kf?.date, kf?.time].filter(Boolean).join(' ').trim();
  const bookingDone = struct?.booking_status_text || kf?.is_booked_text || call.booking_status;
  const reason = struct?.unbooked_reason || kf?.unbooked_reason;

  const parts: string[] = [];
  if (isMeaningfulField(purpose)) {
    parts.push(`Цель обращения: ${purpose!.trim().replace(/\.+$/, '')}.`);
  }
  const detailChunks: string[] = [];
  if (isMeaningfulField(service)) detailChunks.push(`услуга — ${service!.trim()}`);
  if (isMeaningfulField(master)) detailChunks.push(`мастер — ${master!.trim()}`);
  if (isMeaningfulField(dateTime)) detailChunks.push(`дата/время — ${dateTime!.trim()}`);
  if (detailChunks.length > 0) {
    parts.push(`Обсуждалось: ${detailChunks.join(', ')}.`);
  }
  if (isMeaningfulField(bookingDone)) {
    const statusClean = bookingDone!.trim().replace(/\.+$/, '');
    if (isMeaningfulField(reason)) {
      parts.push(`Итог: ${statusClean} (${reason!.trim().replace(/\.+$/, '')}).`);
    } else {
      parts.push(`Итог: ${statusClean}.`);
    }
  }
  return parts.join(' ').trim();
}

function buildFallbackFromTranscript(transcript?: string): string {
  if (!transcript || typeof transcript !== 'string') return '';
  const lower = transcript.toLowerCase();
  if (TECHNICAL_TRANSCRIPT_MARKERS.some((m) => lower.includes(m))) return '';

  const cleaned = stripIvrFromTranscript(transcript);
  if (!cleaned) return '';

  const lines = cleaned
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^автоинформатор\s*:/i.test(l));

  if (lines.length === 0) return '';

  const snippetLines: string[] = [];
  let totalLen = 0;
  for (const line of lines.slice(0, 6)) {
    if (totalLen + line.length > 420 && snippetLines.length > 0) break;
    snippetLines.push(line);
    totalLen += line.length + 1;
  }

  let joined = snippetLines.join(' / ');
  if (joined.length > 440) {
    joined = `${joined.slice(0, 437).trim()}...`;
  }
  return joined;
}

/**
 * Извлекает или формирует обязательный краткий пересказ диалога для отправки в VK.
 * Гарантирует непустой, читаемый и обезличенный (без номеров телефонов по 152-ФЗ) пересказ.
 */
export function extractBriefDialogueRetelling(call: CallRecord): string {
  const rawSummary = cleanWhitespace(String(call.summary || ''));

  if (rawSummary) {
    // 1. Приоритет: явная секция «Пересказ диалога: ...» / «Краткий пересказ диалога: ...»
    const explicitMatch = rawSummary.match(
      /(?:краткий\s+)?пересказ(?:\s+диалога)?\s*:\s*([\s\S]+?)(?=(?:\s*Вывод\s*:|\n\s*Разбор работы менеджера|\n\s*-\s*Ошибки и недочеты|\n\s*-\s*Советы по оптимизации|$))/i
    );
    if (explicitMatch && explicitMatch[1]) {
      const extracted = cleanWhitespace(explicitMatch[1]);
      if (extracted.length >= 12) {
        return stripRawPhones(extracted);
      }
    }

    // 2. Берём описательную часть summary без служебного блока «Разбор работы менеджера» и без дублирующего «Суть обращения»
    let narrative = rawSummary
      .replace(/\n?\s*Разбор работы менеджера[\s\S]*$/i, '')
      .replace(/^Суть обращения\s*:[^.\n]*\.\s*/i, '')
      .replace(/\s*Вывод\s*:\s*/gi, ' ')
      .trim();

    if (narrative.length >= 12) {
      if (narrative.length > 650) {
        narrative = `${narrative.slice(0, 647).trim()}...`;
      }
      return stripRawPhones(narrative);
    }
  }

  // 3. Резерв: структурированные поля резюме (8 параметров / key_facts)
  const fromFacts = buildFallbackFromStructuredFacts(call);
  if (fromFacts.length >= 10) {
    return stripRawPhones(fromFacts);
  }

  // 4. Резерв: выжимка первых реплик очищенной стенограммы
  const fromTranscript = buildFallbackFromTranscript(call.transcript);
  if (fromTranscript.length >= 6) {
    return stripRawPhones(fromTranscript);
  }

  // 5. Если даже summary был коротким (например, «Разговор не состоялся»)
  if (rawSummary) {
    return stripRawPhones(rawSummary);
  }

  return 'Диалог не состоялся или краткий пересказ отсутствует.';
}

export interface VkMessageFormatHelpers {
  formatUtc4DateTime?: (dateStr?: string) => string;
  formatUtc4Date?: (dateStr?: string) => string;
  formatUtc4Time?: (dateStr?: string) => string;
  formatCallDuration?: (seconds?: number) => string;
  formatDurationMmSs?: (seconds?: number) => string;
}

const SHORT_SUMMARY_PLACEHOLDERS_RE =
  /\{(?:short_summary|dialogue_summary|brief_summary|retelling)\}/i;

/**
 * Формирует итоговый текст уведомления о звонке для отправки в VK.
 * Обязательно включает блок «📝 *Краткий пересказ диалога:* ...» —
 * даже если пользовательский шаблон не содержит плейсхолдера {short_summary} или {summary}.
 */
export function formatVkCallMessage(
  call: CallRecord,
  config: Pick<VkConfig, 'template'>,
  helpers: VkMessageFormatHelpers = {}
): string {
  const kf = call.key_facts || ({} as CallRecord['key_facts']);
  const isDisputeText = kf.is_dispute ? '⚠️ ДА (Конфликтный звонок)' : '✅ Нет';
  const disputeReason = kf.dispute_reason || 'нет';
  const promisesArr = Array.isArray(kf.promises) ? kf.promises : [];
  const promisesText = promisesArr.length > 0 ? promisesArr.join(', ') : 'нет обещаний';
  const recsArr = Array.isArray(call.recommendations) ? call.recommendations : [];
  const recommendationsText = recsArr.length > 0 ? recsArr.join('\n- ') : 'нет';

  const callDateTimeUtc4 = (helpers.formatUtc4DateTime || formatUtc4DateTimeDefault)(call.timestamp);
  const callDateUtc4 = (helpers.formatUtc4Date || formatUtc4DateDefault)(call.timestamp);
  const callTimeUtc4 = (helpers.formatUtc4Time || formatUtc4TimeDefault)(call.timestamp);
  const durationText = (helpers.formatCallDuration || formatDurationDefault)(call.duration_seconds);
  const durationMmSs = (helpers.formatDurationMmSs || formatDurationMmSsDefault)(call.duration_seconds);
  const durationSecText =
    call.duration_seconds !== undefined && call.duration_seconds !== null
      ? `${call.duration_seconds} сек.`
      : 'н/д';

  const briefRetelling = extractBriefDialogueRetelling(call);
  const safeSummaryText = stripRawPhones(cleanWhitespace(String(call.summary || '')) || briefRetelling);

  let templateToUse = (config.template || '').trim() || DEFAULT_VK_CALL_TEMPLATE;

  // Гарантируем дату и время
  if (
    !templateToUse.includes('{call_date_time}') &&
    !templateToUse.includes('{call_date}') &&
    !templateToUse.includes('{call_time}') &&
    !templateToUse.includes('{date}') &&
    !templateToUse.includes('{time}') &&
    !templateToUse.includes('{timestamp}')
  ) {
    if (templateToUse.includes('\n')) {
      const firstLineEnd = templateToUse.indexOf('\n');
      templateToUse =
        templateToUse.slice(0, firstLineEnd) +
        `\n📅 *Дата и время (UTC+4):* {call_date_time}` +
        templateToUse.slice(firstLineEnd);
    } else {
      templateToUse = `📅 *Дата и время (UTC+4):* {call_date_time}\n` + templateToUse;
    }
  }

  // Гарантируем длительность
  if (
    !templateToUse.includes('{duration}') &&
    !templateToUse.includes('{call_duration}') &&
    !templateToUse.includes('{duration_seconds}') &&
    !templateToUse.includes('{duration_formatted}')
  ) {
    if (templateToUse.includes('{call_date_time}')) {
      templateToUse = templateToUse.replace(
        '{call_date_time}',
        '{call_date_time}\n⏱️ *Длительность:* {duration}'
      );
    } else if (templateToUse.includes('{call_date}')) {
      templateToUse = templateToUse.replace(
        '{call_date}',
        '{call_date}\n⏱️ *Длительность:* {duration}'
      );
    } else if (templateToUse.includes('\n')) {
      const firstLineEnd = templateToUse.indexOf('\n');
      templateToUse =
        templateToUse.slice(0, firstLineEnd) +
        `\n⏱️ *Длительность:* {duration}` +
        templateToUse.slice(firstLineEnd);
    } else {
      templateToUse = templateToUse + `\n⏱️ *Длительность:* {duration}`;
    }
  }

  // ОБЯЗАТЕЛЬНО гарантируем наличие отдельного блока «Краткий пересказ диалога» в каждом сообщении VK
  if (!SHORT_SUMMARY_PLACEHOLDERS_RE.test(templateToUse)) {
    const retellingLine = `📝 *Краткий пересказ диалога:* {short_summary}`;
    const summaryLineRe = /^.*\{summary\}.*$/m;
    if (summaryLineRe.test(templateToUse)) {
      templateToUse = templateToUse.replace(summaryLineRe, (match) => `${retellingLine}\n${match}`);
    } else if (templateToUse.includes('{operator_score}')) {
      templateToUse = templateToUse.replace(
        /(^.*\{operator_score\}.*$)/m,
        `$1\n${retellingLine}`
      );
    } else if (templateToUse.includes('{client_name}')) {
      templateToUse = templateToUse.replace(
        /(^.*\{client_name\}.*$)/m,
        `$1\n${retellingLine}`
      );
    } else {
      templateToUse = `${templateToUse}\n${retellingLine}`;
    }
  }

  const scoreText =
    call.operator_score !== null && call.operator_score !== undefined
      ? `${call.operator_score}/10`
      : 'не оценивалось';

  let message = templateToUse
    .replace(/\{call_id\}/g, call.call_id)
    .replace(/\{call_date_time\}/g, callDateTimeUtc4)
    .replace(/\{call_date\}/g, callDateUtc4)
    .replace(/\{call_time\}/g, callTimeUtc4)
    .replace(/\{date\}/g, callDateUtc4)
    .replace(/\{time\}/g, callTimeUtc4)
    .replace(/\{timestamp\}/g, callDateTimeUtc4)
    .replace(/\{duration\}/g, durationText)
    .replace(/\{call_duration\}/g, durationText)
    .replace(/\{duration_formatted\}/g, durationText)
    .replace(/\{duration_seconds\}/g, durationSecText)
    .replace(/\{duration_mmss\}/g, durationMmSs)
    .replace(/\{client_name\}/g, call.client_name || 'Неизвестный клиент')
    .replace(/\{operator_score\}\/10/g, scoreText)
    .replace(/\{operator_score\}/g, scoreText)
    .replace(/\{short_summary\}/gi, briefRetelling)
    .replace(/\{dialogue_summary\}/gi, briefRetelling)
    .replace(/\{brief_summary\}/gi, briefRetelling)
    .replace(/\{retelling\}/gi, briefRetelling)
    .replace(/\{summary\}/g, safeSummaryText)
    .replace(/\{is_dispute_text\}/g, isDisputeText)
    .replace(/\{dispute_reason\}/g, disputeReason)
    .replace(/\{promises\}/g, promisesText)
    .replace(/\{recommendations\}/g, recommendationsText);

  message = stripRawPhones(message);

  // Страховка по лимиту длины VK API (4096 символов): никогда не обрезаем «Краткий пересказ диалога»
  if (message.length > VK_CALL_MESSAGE_MAX_LENGTH) {
    message = `${message.slice(0, VK_CALL_MESSAGE_MAX_LENGTH - 3).trim()}...`;
  }

  return message;
}
