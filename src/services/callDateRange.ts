/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type CallDateRangePreset = 'all' | 'day' | 'yesterday' | 'week' | 'month' | 'this_month' | 'custom';

export interface ParsedCallDateRange {
  valid: boolean;
  raw: string;
  preset: CallDateRangePreset;
  startYmd: string | null;
  endYmd: string | null;
  error?: string;
}

const DEFAULT_TIME_ZONE = 'Europe/Samara';
const ISO_YMD_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidYmdDate(ymd: string): boolean {
  const match = ISO_YMD_REGEX.exec(ymd);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

export function formatTimestampToSalonYmd(
  dateInput: Date | string,
  timeZone: string = DEFAULT_TIME_ZONE
): string {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

function shiftYmdDays(baseYmd: string, deltaDays: number): string {
  const [yStr, mStr, dStr] = baseYmd.split('-');
  const baseUtc = new Date(Date.UTC(Number(yStr), Number(mStr) - 1, Number(dStr)));
  const shifted = new Date(baseUtc.getTime() + deltaDays * 24 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Parses and strictly validates the `date_range` query parameter for `/api/calls`.
 * Supported values:
 * - '' | 'all' — no date restriction
 * - 'day' | 'today' — current calendar day in salon timezone
 * - 'yesterday' — previous calendar day in salon timezone
 * - 'week' | '7d' — last 7 calendar days including today
 * - 'month' | '30d' — last 30 calendar days including today
 * - 'this_month' — from the 1st of current month to today
 * - 'YYYY-MM-DD' — specific calendar day
 * - 'YYYY-MM-DD:YYYY-MM-DD' | 'YYYY-MM-DD..YYYY-MM-DD' | 'YYYY-MM-DD,YYYY-MM-DD' — custom inclusive range
 *   (open-ended bounds like 'YYYY-MM-DD:' or ':YYYY-MM-DD' are also accepted)
 */
export function parseCallDateRange(
  rawValue?: string | null,
  timeZone: string = DEFAULT_TIME_ZONE,
  now: Date = new Date()
): ParsedCallDateRange {
  const raw = String(rawValue || '').trim();
  if (!raw || raw.toLowerCase() === 'all') {
    return { valid: true, raw: 'all', preset: 'all', startYmd: null, endYmd: null };
  }

  const lower = raw.toLowerCase();
  const todayYmd = formatTimestampToSalonYmd(now, timeZone);

  if (lower === 'day' || lower === 'today') {
    return { valid: true, raw: lower, preset: 'day', startYmd: todayYmd, endYmd: todayYmd };
  }

  if (lower === 'yesterday') {
    const yesterdayYmd = shiftYmdDays(todayYmd, -1);
    return { valid: true, raw: lower, preset: 'yesterday', startYmd: yesterdayYmd, endYmd: yesterdayYmd };
  }

  if (lower === 'week' || lower === '7d') {
    return {
      valid: true,
      raw: lower,
      preset: 'week',
      startYmd: shiftYmdDays(todayYmd, -6),
      endYmd: todayYmd,
    };
  }

  if (lower === 'month' || lower === '30d') {
    return {
      valid: true,
      raw: lower,
      preset: 'month',
      startYmd: shiftYmdDays(todayYmd, -29),
      endYmd: todayYmd,
    };
  }

  if (lower === 'this_month') {
    const [yStr, mStr] = todayYmd.split('-');
    return {
      valid: true,
      raw: lower,
      preset: 'this_month',
      startYmd: `${yStr}-${mStr}-01`,
      endYmd: todayYmd,
    };
  }

  // Single day: YYYY-MM-DD
  if (ISO_YMD_REGEX.test(raw)) {
    if (!isValidYmdDate(raw)) {
      return {
        valid: false,
        raw,
        preset: 'custom',
        startYmd: null,
        endYmd: null,
        error: `Некорректная дата в параметре date_range: "${raw}"`,
      };
    }
    return { valid: true, raw, preset: 'custom', startYmd: raw, endYmd: raw };
  }

  // Custom range: YYYY-MM-DD:YYYY-MM-DD | YYYY-MM-DD..YYYY-MM-DD | YYYY-MM-DD,YYYY-MM-DD
  const separatorMatch = raw.match(/^([^:.,]*)(?::|\.\.|,)([^:.,]*)$/);
  if (separatorMatch) {
    const startCandidate = separatorMatch[1].trim();
    const endCandidate = separatorMatch[2].trim();

    if (!startCandidate && !endCandidate) {
      return {
        valid: false,
        raw,
        preset: 'custom',
        startYmd: null,
        endYmd: null,
        error: 'Параметр date_range не содержит дат начала или окончания периода',
      };
    }

    if (startCandidate && !isValidYmdDate(startCandidate)) {
      return {
        valid: false,
        raw,
        preset: 'custom',
        startYmd: null,
        endYmd: null,
        error: `Некорректная дата начала в date_range: "${startCandidate}"`,
      };
    }

    if (endCandidate && !isValidYmdDate(endCandidate)) {
      return {
        valid: false,
        raw,
        preset: 'custom',
        startYmd: null,
        endYmd: null,
        error: `Некорректная дата окончания в date_range: "${endCandidate}"`,
      };
    }

    let startYmd = startCandidate || null;
    let endYmd = endCandidate || null;
    if (startYmd && endYmd && startYmd > endYmd) {
      [startYmd, endYmd] = [endYmd, startYmd];
    }

    return { valid: true, raw, preset: 'custom', startYmd, endYmd };
  }

  return {
    valid: false,
    raw,
    preset: 'custom',
    startYmd: null,
    endYmd: null,
    error: `Неподдерживаемое значение date_range "${raw}". Используйте: day, week, month, all или YYYY-MM-DD:YYYY-MM-DD`,
  };
}

export function filterCallsByDateRange<T extends { timestamp?: string | null }>(
  calls: T[],
  parsedRange: ParsedCallDateRange,
  timeZone: string = DEFAULT_TIME_ZONE
): T[] {
  if (!parsedRange.valid || (!parsedRange.startYmd && !parsedRange.endYmd)) {
    return calls;
  }

  return calls.filter((call) => {
    if (!call?.timestamp) return false;
    const callYmd = formatTimestampToSalonYmd(call.timestamp, timeZone);
    if (!callYmd) return false;
    if (parsedRange.startYmd && callYmd < parsedRange.startYmd) return false;
    if (parsedRange.endYmd && callYmd > parsedRange.endYmd) return false;
    return true;
  });
}
