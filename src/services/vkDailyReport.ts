/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CallRecord } from '../types.js';
import { resolveSalonName } from './salonBranding.js';

export const DEFAULT_SALON_TIMEZONE = 'Europe/Samara';
export const DEFAULT_DAILY_REPORT_TIME = '21:05';
export const VK_MESSAGE_MAX_LENGTH = 3900;

export interface BreakdownItem {
  name: string;
  count: number;
}

export interface OperatorDailyStat {
  name: string;
  totalCalls: number;
  answeredCalls: number;
  bookings: number;
  avgScore: number | null;
}

export interface DailyVkReportMetrics {
  dateStr: string;
  formattedDate: string;
  timeZone: string;
  salonName: string;
  totalCalls: number;
  incomingCalls: number;
  outgoingCalls: number;
  answeredCalls: number;
  missedCalls: number;
  missedIncomingCalls: number;
  missedRatePct: number;
  bookingsCount: number;
  conversionFromTotalPct: number;
  conversionFromAnsweredPct: number;
  consultationsCount: number;
  postponedCount: number;
  refusalsCount: number;
  disputesCount: number;
  needsTranscriptionCount: number;
  avgOperatorScore: number | null;
  scoredCallsCount: number;
  avgDurationSeconds: number;
  bookingsByService: BreakdownItem[];
  bookingsByMaster: BreakdownItem[];
  requestedServicesAll: BreakdownItem[];
  operatorStats: OperatorDailyStat[];
}

export interface DailyReportScheduleCheck {
  due: boolean;
  todayStr: string;
  currentTime: string;
  scheduledTime: string;
  timeZone: string;
  reason: 'due' | 'already_sent_today' | 'before_scheduled_time';
}

export interface LocalDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dateStr: string; // YYYY-MM-DD
  formattedDate: string; // DD.MM.YYYY
  timeStr: string; // HH:MM
}

const MISSED_STATUSES = new Set([
  'missed',
  'cancel',
  'busy',
  'notavailable',
  'notallowed',
  'notfound',
]);

const EMPTY_PLACEHOLDERS = new Set([
  '',
  '-',
  '—',
  '–',
  'нет',
  'н/д',
  'n/a',
  'null',
  'undefined',
  'не указано',
  'не указан',
  'не указана',
  'не озвучено',
  'не озвучен',
  'не озвучена',
  'не определено',
  'не определен',
  'не определён',
  'не определена',
  'не применимо',
  'неизвестно',
  'не уточнено',
  'не уточнена',
  'отсутствует',
]);

const MASTER_PLACEHOLDERS = new Set([
  ...EMPTY_PLACEHOLDERS,
  'любой',
  'любой мастер',
  'свободный мастер',
  'любой свободный мастер',
  'администратор',
  'менеджер',
  'оператор',
  'клиент',
  'сотрудник',
  'мастер',
]);

/**
 * Resolves the salon timezone used for daily cutoffs and aggregation.
 * Defaults to Europe/Samara (UTC+4), matching dashboard and PDF/CSV reports.
 */
export function resolveReportTimeZone(override?: string): string {
  const candidate = (override || process.env.SALON_TIMEZONE || DEFAULT_SALON_TIMEZONE).trim();
  if (!candidate) return DEFAULT_SALON_TIMEZONE;
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_SALON_TIMEZONE;
  }
}

/**
 * Normalizes daily report send time (HH:MM).
 * Enforces sending after 21:00 (21:00..23:59), falling back to 21:05.
 */
export function normalizeDailyReportTime(value?: string): string {
  if (!value || typeof value !== 'string') return DEFAULT_DAILY_REPORT_TIME;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return DEFAULT_DAILY_REPORT_TIME;
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (isNaN(hour) || isNaN(minute) || hour < 21 || hour > 23 || minute < 0 || minute > 59) {
    return DEFAULT_DAILY_REPORT_TIME;
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Validates strict YYYY-MM-DD date strings.
 */
export function isValidIsoDateString(dateStr?: string): dateStr is string {
  if (!dateStr || typeof dateStr !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

/**
 * Extracts local date/time components in the specified IANA timezone.
 */
export function getLocalDateParts(date: Date = new Date(), timeZone?: string): LocalDateParts {
  const tz = resolveReportTimeZone(timeZone);
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
    const year = parseInt(get('year'), 10);
    const month = parseInt(get('month'), 10);
    const day = parseInt(get('day'), 10);
    // Intl can return "24" for midnight in some environments
    const rawHour = parseInt(get('hour'), 10);
    const hour = rawHour === 24 ? 0 : rawHour;
    const minute = parseInt(get('minute'), 10);

    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const hh = String(hour).padStart(2, '0');
    const min = String(minute).padStart(2, '0');

    return {
      year,
      month,
      day,
      hour,
      minute,
      dateStr: `${year}-${mm}-${dd}`,
      formattedDate: `${dd}.${mm}.${year}`,
      timeStr: `${hh}:${min}`,
    };
  } catch {
    // Fallback to UTC+4 (Europe/Samara)
    const shifted = new Date(date.getTime() + 4 * 3600 * 1000);
    const year = shifted.getUTCFullYear();
    const month = shifted.getUTCMonth() + 1;
    const day = shifted.getUTCDate();
    const hour = shifted.getUTCHours();
    const minute = shifted.getUTCMinutes();
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const hh = String(hour).padStart(2, '0');
    const min = String(minute).padStart(2, '0');

    return {
      year,
      month,
      day,
      hour,
      minute,
      dateStr: `${year}-${mm}-${dd}`,
      formattedDate: `${dd}.${mm}.${year}`,
      timeStr: `${hh}:${min}`,
    };
  }
}

export function formatIsoDateToRu(dateStr: string): string {
  if (!isValidIsoDateString(dateStr)) return dateStr;
  const [y, m, d] = dateStr.split('-');
  return `${d}.${m}.${y}`;
}

/**
 * Checks whether the automatic daily VK summary is due right now (after 21:00 local time
 * and not yet sent for today's date).
 */
export function isDailyReportDue(
  now: Date = new Date(),
  options: { reportTime?: string; timeZone?: string; lastSentDate?: string } = {}
): DailyReportScheduleCheck {
  const timeZone = resolveReportTimeZone(options.timeZone);
  const scheduledTime = normalizeDailyReportTime(options.reportTime);
  const local = getLocalDateParts(now, timeZone);

  if (options.lastSentDate && options.lastSentDate === local.dateStr) {
    return {
      due: false,
      todayStr: local.dateStr,
      currentTime: local.timeStr,
      scheduledTime,
      timeZone,
      reason: 'already_sent_today',
    };
  }

  const [targetHour, targetMinute] = scheduledTime.split(':').map(Number);
  const currentTotalMin = local.hour * 60 + local.minute;
  const targetTotalMin = targetHour * 60 + targetMinute;

  if (currentTotalMin < targetTotalMin) {
    return {
      due: false,
      todayStr: local.dateStr,
      currentTime: local.timeStr,
      scheduledTime,
      timeZone,
      reason: 'before_scheduled_time',
    };
  }

  return {
    due: true,
    todayStr: local.dateStr,
    currentTime: local.timeStr,
    scheduledTime,
    timeZone,
    reason: 'due',
  };
}

/**
 * Determines whether a call record represents a missed / unanswered call.
 */
export function isMissedCall(call: CallRecord): boolean {
  const statusLower = String(call.status || '').toLowerCase();
  if (MISSED_STATUSES.has(statusLower)) return true;
  if (call.is_answered === false) return true;
  if (
    (call.duration_seconds === 0 || call.duration_seconds === undefined || call.duration_seconds === null) &&
    statusLower !== 'processing' &&
    statusLower !== 'needs_transcription'
  ) {
    return true;
  }
  return false;
}

/**
 * Determines whether a call resulted in a confirmed or rescheduled booking.
 */
export function isBookedCall(call: CallRecord): boolean {
  if (isMissedCall(call)) return false;

  const bookingStatus = String(call.booking_status || call.key_facts?.booking_status || '')
    .trim()
    .toLowerCase();
  const outcome = String(call.key_facts?.call_outcome || '')
    .trim()
    .toLowerCase();
  const bookingText = String(
    call.structured_summary?.booking_status_text || call.key_facts?.is_booked_text || ''
  )
    .trim()
    .toLowerCase();

  if (bookingStatus === 'согласие') return true;
  if (outcome === 'запись' || outcome === 'успешно') return true;

  if (
    bookingText &&
    !/(не\s+состоялась|отказ|отменил|не\s+записал|не\s+оформлен)/i.test(bookingText) &&
    /(запись\s+состоялась|запись\s+подтверждена|запись\s+перенесена|успешно\s+записан)/i.test(bookingText)
  ) {
    return true;
  }

  return false;
}

function isDeclinedCall(call: CallRecord): boolean {
  if (isMissedCall(call) || isBookedCall(call)) return false;
  const bookingStatus = String(call.booking_status || call.key_facts?.booking_status || '')
    .trim()
    .toLowerCase();
  const outcome = String(call.key_facts?.call_outcome || '')
    .trim()
    .toLowerCase();
  return bookingStatus === 'отказ' || outcome === 'отказ' || outcome === 'не успешно';
}

function isPostponedCall(call: CallRecord): boolean {
  if (isMissedCall(call) || isBookedCall(call) || isDeclinedCall(call)) return false;
  const outcome = String(call.key_facts?.call_outcome || '')
    .trim()
    .toLowerCase();
  const bookingText = String(
    call.structured_summary?.booking_status_text || call.key_facts?.is_booked_text || ''
  )
    .trim()
    .toLowerCase();
  return (
    outcome === 'перезвон' ||
    outcome === 'перенесён' ||
    outcome === 'перенесен' ||
    /отсроч|подума|перезвон/i.test(bookingText)
  );
}

function isConsultationCall(call: CallRecord): boolean {
  if (isMissedCall(call) || isBookedCall(call) || isDeclinedCall(call) || isPostponedCall(call)) {
    return false;
  }
  const bookingStatus = String(call.booking_status || call.key_facts?.booking_status || '')
    .trim()
    .toLowerCase();
  const outcome = String(call.key_facts?.call_outcome || '')
    .trim()
    .toLowerCase();
  return bookingStatus === 'консультация' || outcome === 'консультация';
}

/**
 * Strips any accidental phone-like digit sequences from labels (152-ФЗ safety net).
 */
export function stripPhoneNumbers(text: string): string {
  return text
    .replace(/(?:\+?7|8)?[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-()]*\d{2}[\s\-()]*\d{2}/g, '[скрыто]')
    .replace(/\b\d{7,}\b/g, '[скрыто]');
}

function capitalizeFirst(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Extracts and normalizes the service name from a call record.
 */
export function extractNormalizedService(call: CallRecord): string {
  const candidates = [
    call.structured_summary?.requested_service,
    call.key_facts?.requested_service,
    call.key_facts?.service,
  ];

  for (const raw of candidates) {
    if (!raw || typeof raw !== 'string') continue;
    const cleaned = stripPhoneNumbers(raw)
      .replace(/\s+/g, ' ')
      .replace(/^[\s.,;:—–-]+|[\s.,;:—–-]+$/g, '')
      .trim();
    const lower = cleaned.toLowerCase();
    if (!cleaned || EMPTY_PLACEHOLDERS.has(lower)) continue;
    if (/^(не\s+озвуч|не\s+указан|не\s+определ|не\s+применим|нет\s+данных)/i.test(lower)) continue;
    const capped = cleaned.length > 65 ? `${cleaned.slice(0, 62).trim()}...` : cleaned;
    return capitalizeFirst(capped);
  }

  return 'Не уточнена';
}

/**
 * Extracts and normalizes the master name from a call record.
 */
export function extractNormalizedMaster(call: CallRecord): string {
  const candidates = [
    call.structured_summary?.offered_master,
    call.key_facts?.offered_master,
    call.key_facts?.master,
  ];

  for (const raw of candidates) {
    if (!raw || typeof raw !== 'string') continue;
    let cleaned = stripPhoneNumbers(raw)
      .replace(/\s+/g, ' ')
      .replace(/^(?:к\s+)?(?:мастеру|мастер|топ-мастеру|топ-мастер|специалисту|специалист|стилисту|стилист)\s+/i, '')
      .replace(/^[\s.,;:—–-]+|[\s.,;:—–-]+$/g, '')
      .trim();
    const lower = cleaned.toLowerCase();
    if (!cleaned || MASTER_PLACEHOLDERS.has(lower)) continue;
    if (/^(не\s+озвуч|не\s+указан|не\s+определ|не\s+применим|любой|без\s+предпочтен)/i.test(lower)) {
      continue;
    }
    const capped = cleaned.length > 50 ? `${cleaned.slice(0, 47).trim()}...` : cleaned;
    return capitalizeFirst(capped);
  }

  return 'Не указан / любой мастер';
}

function mapToSortedBreakdown(counts: Map<string, { label: string; count: number }>): BreakdownItem[] {
  return Array.from(counts.values())
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.label.localeCompare(b.label, 'ru');
    })
    .map(({ label, count }) => ({ name: label, count }));
}

function incrementCanonical(
  map: Map<string, { label: string; count: number }>,
  rawLabel: string
): void {
  const key = rawLabel.toLowerCase();
  const existing = map.get(key);
  if (existing) {
    existing.count += 1;
  } else {
    map.set(key, { label: rawLabel, count: 1 });
  }
}

/**
 * Aggregates anonymized daily KPIs for a target calendar day (YYYY-MM-DD in salon timezone).
 */
export function aggregateDailyCallsReport(
  calls: CallRecord[],
  dateStr: string,
  options: { timeZone?: string; salonName?: string; includeDemo?: boolean } = {}
): DailyVkReportMetrics {
  const timeZone = resolveReportTimeZone(options.timeZone);
  const salonName = resolveSalonName({ configSalonName: options.salonName, envSalonName: process.env.SALON_NAME });
  const includeDemo = options.includeDemo === true;

  const dayCalls = (calls || []).filter((c) => {
    if (!c || !c.timestamp) return false;
    if (!includeDemo && c.is_demo) return false;
    const d = new Date(c.timestamp);
    if (isNaN(d.getTime())) return false;
    const local = getLocalDateParts(d, timeZone);
    return local.dateStr === dateStr;
  });

  let incomingCalls = 0;
  let outgoingCalls = 0;
  let answeredCalls = 0;
  let missedCalls = 0;
  let missedIncomingCalls = 0;
  let bookingsCount = 0;
  let consultationsCount = 0;
  let postponedCount = 0;
  let refusalsCount = 0;
  let disputesCount = 0;
  let needsTranscriptionCount = 0;
  let totalScore = 0;
  let scoredCallsCount = 0;
  let answeredDurationTotal = 0;
  let answeredWithDurationCount = 0;

  const bookingsByServiceMap = new Map<string, { label: string; count: number }>();
  const bookingsByMasterMap = new Map<string, { label: string; count: number }>();
  const requestedServicesAllMap = new Map<string, { label: string; count: number }>();
  const operatorMap = new Map<
    string,
    { name: string; totalCalls: number; answeredCalls: number; bookings: number; scoreSum: number; scoreCount: number }
  >();

  for (const call of dayCalls) {
    if (call.type === 'outgoing') {
      outgoingCalls++;
    } else {
      incomingCalls++;
    }

    const missed = isMissedCall(call);
    const booked = isBookedCall(call);
    const statusLower = String(call.status || '').toLowerCase();

    if (statusLower === 'needs_transcription' || statusLower === 'transcription_failed') {
      needsTranscriptionCount++;
    }

    if (missed) {
      missedCalls++;
      if (call.type !== 'outgoing') {
        missedIncomingCalls++;
      }
    } else {
      answeredCalls++;
      if (typeof call.duration_seconds === 'number' && !isNaN(call.duration_seconds) && call.duration_seconds > 0) {
        answeredDurationTotal += call.duration_seconds;
        answeredWithDurationCount++;
      }

      const serviceLabel = extractNormalizedService(call);
      if (serviceLabel !== 'Не уточнена') {
        incrementCanonical(requestedServicesAllMap, serviceLabel);
      }

      if (booked) {
        bookingsCount++;
        incrementCanonical(bookingsByServiceMap, serviceLabel);
        incrementCanonical(bookingsByMasterMap, extractNormalizedMaster(call));
      } else if (isDeclinedCall(call)) {
        refusalsCount++;
      } else if (isPostponedCall(call)) {
        postponedCount++;
      } else if (isConsultationCall(call)) {
        consultationsCount++;
      }
    }

    if (call.key_facts?.is_dispute) {
      disputesCount++;
    }

    const hasValidScore =
      typeof call.operator_score === 'number' &&
      call.operator_score !== null &&
      !isNaN(call.operator_score);
    if (hasValidScore) {
      totalScore += call.operator_score as number;
      scoredCallsCount++;
    }

    // Operator breakdown (excluding raw phone numbers if operator_name accidentally contains one)
    const opNameRaw = (call.operator_name || '').trim();
    const opName = opNameRaw && !/^\+?\d{7,}$/.test(opNameRaw.replace(/\D/g, ''))
      ? stripPhoneNumbers(opNameRaw)
      : 'Дежурный администратор';
    const opKey = opName.toLowerCase();
    let opEntry = operatorMap.get(opKey);
    if (!opEntry) {
      opEntry = {
        name: opName,
        totalCalls: 0,
        answeredCalls: 0,
        bookings: 0,
        scoreSum: 0,
        scoreCount: 0,
      };
      operatorMap.set(opKey, opEntry);
    }
    opEntry.totalCalls++;
    if (!missed) opEntry.answeredCalls++;
    if (booked) opEntry.bookings++;
    if (hasValidScore) {
      opEntry.scoreSum += call.operator_score as number;
      opEntry.scoreCount++;
    }
  }

  const totalCalls = dayCalls.length;
  const missedRatePct = totalCalls > 0 ? Math.round((missedCalls / totalCalls) * 100) : 0;
  const conversionFromTotalPct = totalCalls > 0 ? Math.round((bookingsCount / totalCalls) * 100) : 0;
  const conversionFromAnsweredPct = answeredCalls > 0 ? Math.round((bookingsCount / answeredCalls) * 100) : 0;
  const avgOperatorScore =
    scoredCallsCount > 0 ? Number((totalScore / scoredCallsCount).toFixed(1)) : null;
  const avgDurationSeconds =
    answeredWithDurationCount > 0 ? Math.round(answeredDurationTotal / answeredWithDurationCount) : 0;

  const operatorStats: OperatorDailyStat[] = Array.from(operatorMap.values())
    .sort((a, b) => {
      if (b.bookings !== a.bookings) return b.bookings - a.bookings;
      if (b.totalCalls !== a.totalCalls) return b.totalCalls - a.totalCalls;
      return a.name.localeCompare(b.name, 'ru');
    })
    .map((o) => ({
      name: o.name,
      totalCalls: o.totalCalls,
      answeredCalls: o.answeredCalls,
      bookings: o.bookings,
      avgScore: o.scoreCount > 0 ? Number((o.scoreSum / o.scoreCount).toFixed(1)) : null,
    }));

  return {
    dateStr,
    formattedDate: formatIsoDateToRu(dateStr),
    timeZone,
    salonName,
    totalCalls,
    incomingCalls,
    outgoingCalls,
    answeredCalls,
    missedCalls,
    missedIncomingCalls,
    missedRatePct,
    bookingsCount,
    conversionFromTotalPct,
    conversionFromAnsweredPct,
    consultationsCount,
    postponedCount,
    refusalsCount,
    disputesCount,
    needsTranscriptionCount,
    avgOperatorScore,
    scoredCallsCount,
    avgDurationSeconds,
    bookingsByService: mapToSortedBreakdown(bookingsByServiceMap),
    bookingsByMaster: mapToSortedBreakdown(bookingsByMasterMap),
    requestedServicesAll: mapToSortedBreakdown(requestedServicesAllMap),
    operatorStats,
  };
}

function formatDurationShortRu(seconds: number): string {
  if (!seconds || seconds <= 0) return '0 сек.';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins === 0) return `${secs} сек.`;
  return `${mins} мин. ${secs} сек.`;
}

function formatBreakdownSection(items: BreakdownItem[], maxItems: number): string[] {
  if (items.length === 0) return ['• Нет данных'];
  const lines: string[] = [];
  const visible = items.slice(0, maxItems);
  for (const item of visible) {
    lines.push(`• ${item.name} — ${item.count}`);
  }
  if (items.length > maxItems) {
    const restCount = items.slice(maxItems).reduce((acc, i) => acc + i.count, 0);
    lines.push(`• Прочие (${items.length - maxItems} поз.) — ${restCount}`);
  }
  return lines;
}

/**
 * Formats aggregated daily KPIs into a concise, readable VK message.
 * Strictly 152-ФЗ anonymized: contains no client phones or client names.
 */
export function formatVkDailyReportMessage(metrics: DailyVkReportMetrics): string {
  const tzLabel = metrics.timeZone === 'Europe/Samara' ? 'Europe/Samara, UTC+4' : metrics.timeZone;
  const lines: string[] = [
    `📊 Итоги дня: «${metrics.salonName}»`,
    `📅 Дата: ${metrics.formattedDate} (${tzLabel})`,
    '',
  ];

  if (metrics.totalCalls === 0) {
    lines.push('📞 За этот день звонков не зафиксировано.');
    lines.push('');
    lines.push('🔒 Отчёт сформирован автоматически и обезличен по 152-ФЗ.');
    return lines.join('\n');
  }

  lines.push('📞 Звонки:');
  lines.push(`• Всего: ${metrics.totalCalls} (входящих: ${metrics.incomingCalls}, исходящих: ${metrics.outgoingCalls})`);
  lines.push(
    `• Принято: ${metrics.answeredCalls} | Пропущено: ${metrics.missedCalls} (${metrics.missedRatePct}%)`
  );
  if (metrics.missedIncomingCalls > 0 && metrics.missedIncomingCalls !== metrics.missedCalls) {
    lines.push(`• В том числе пропущено входящих: ${metrics.missedIncomingCalls}`);
  }
  if (metrics.avgDurationSeconds > 0) {
    lines.push(`• Средняя длительность разговора: ${formatDurationShortRu(metrics.avgDurationSeconds)}`);
  }

  lines.push('');
  lines.push('✅ Итоги обращений:');
  lines.push(
    `• Записей: ${metrics.bookingsCount} (конверсия: ${metrics.conversionFromAnsweredPct}% от принятых / ${metrics.conversionFromTotalPct}% от всех)`
  );
  lines.push(
    `• Консультаций: ${metrics.consultationsCount} | Отсрочка/перезвон: ${metrics.postponedCount} | Отказов: ${metrics.refusalsCount}`
  );
  if (metrics.disputesCount > 0) {
    lines.push(`• ⚠️ Конфликтных звонков: ${metrics.disputesCount}`);
  }
  if (metrics.needsTranscriptionCount > 0) {
    lines.push(`• ⏳ Ожидают расшифровки: ${metrics.needsTranscriptionCount}`);
  }

  if (metrics.bookingsByService.length > 0) {
    lines.push('');
    lines.push('💅 Записи по видам услуг:');
    lines.push(...formatBreakdownSection(metrics.bookingsByService, 12));
  } else if (metrics.requestedServicesAll.length > 0) {
    lines.push('');
    lines.push('💅 Запрашиваемые услуги (без подтверждённых записей):');
    lines.push(...formatBreakdownSection(metrics.requestedServicesAll, 8));
  }

  if (metrics.bookingsByMaster.length > 0) {
    lines.push('');
    lines.push('👩‍🎨 Записи по мастерам:');
    lines.push(...formatBreakdownSection(metrics.bookingsByMaster, 12));
  }

  lines.push('');
  lines.push('⭐ Качество работы администраторов:');
  if (metrics.avgOperatorScore !== null) {
    lines.push(`• Средняя оценка за день: ${metrics.avgOperatorScore}/10 (оценено звонков: ${metrics.scoredCallsCount})`);
  } else {
    lines.push('• Средняя оценка за день: нет оценённых звонков');
  }
  if (metrics.operatorStats.length > 0) {
    const visibleOps = metrics.operatorStats.slice(0, 8);
    for (const op of visibleOps) {
      const scorePart = op.avgScore !== null ? `, ср. балл: ${op.avgScore}/10` : '';
      lines.push(`• ${op.name}: ${op.totalCalls} зв., записей: ${op.bookings}${scorePart}`);
    }
    if (metrics.operatorStats.length > 8) {
      lines.push(`• И ещё сотрудников: ${metrics.operatorStats.length - 8}`);
    }
  }

  lines.push('');
  lines.push('🔒 Отчёт обезличен в соответствии со 152-ФЗ.');

  // Final safety pass: ensure no phone numbers leaked and length stays below VK API limit
  let message = stripPhoneNumbers(lines.join('\n'));
  if (message.length > VK_MESSAGE_MAX_LENGTH) {
    message = `${message.slice(0, VK_MESSAGE_MAX_LENGTH - 36).trim()}\n…\n🔒 Отчёт обезличен (152-ФЗ).`;
  }
  return message;
}

/**
 * Sends a text message to a VK chat or user via VK REST API messages.send.
 * Never logs or exposes access_token.
 */
export async function sendVkTextMessage(
  message: string,
  token: string,
  chatId: string
): Promise<{ success: boolean; messageId?: number; error?: string }> {
  const cleanToken = (token || '').trim();
  const cleanChatId = (chatId || '').trim();

  if (!cleanToken) {
    return { success: false, error: 'Не указан токен сообщества VK (VK_TOKEN)' };
  }
  if (!cleanChatId) {
    return { success: false, error: 'Не указан ID чата или диалога VK (VK_CHAT_ID)' };
  }

  try {
    const response = await fetch('https://api.vk.com/method/messages.send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        access_token: cleanToken,
        peer_id: cleanChatId,
        message,
        random_id: String(Math.floor(Math.random() * 2147483647)),
        v: '5.131',
      }),
      signal: AbortSignal.timeout(15000),
    });

    const result: any = await response.json();
    if (result?.error) {
      let errorMsg = `Ошибка VK API Code ${result.error.error_code}: ${result.error.error_msg}`;
      if (result.error.error_code === 901) {
        errorMsg += ` (Пользователь/чат peer_id ${cleanChatId} должен сначала разрешить сообщения от сообщества или добавить бота в беседу с правами администратора.)`;
      }
      return { success: false, error: errorMsg };
    }

    return {
      success: true,
      messageId: typeof result?.response === 'number' ? result.response : undefined,
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Ошибка соединения с VK API: ${err?.message || String(err)}`,
    };
  }
}
