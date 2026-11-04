/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import axios from 'axios';

export interface MegafonWcgpAccount {
  name: string;
  realName: string;
  ext?: string;
  telnum?: string;
}

export interface MegafonWcgpGroup {
  id: string;
  realName: string;
  ext?: number | string;
}

export interface MegafonWcgpCall {
  uid: string;
  type: 'in' | 'out' | 'missed';
  client: string;
  account: string;
  via?: string;
  start: string;
  wait?: number;
  duration: number;
  record?: string;
  quality_control?: number;
}

export interface MegafonWebhookHistoryPayload {
  cmd: 'history';
  type: 'in' | 'out';
  status: 'Success' | 'Missed' | 'Cancel' | 'Busy' | 'NotAvailable' | 'NotAllowed' | 'NotFound' | string;
  phone: string;
  user: string;
  ext?: string;
  groupRealName?: string;
  telnum?: string;
  diversion?: string;
  start: string;
  duration: number | string;
  callid: string;
  link?: string;
  rating?: number | string;
  crm_token: string;
}

export interface MegafonWebhookEventPayload {
  cmd: 'event';
  type: 'INCOMING' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED' | 'OUTGOING' | 'TRANSFERRED' | string;
  phone: string;
  diversion?: string;
  user: string;
  groupRealName?: string;
  ext?: string;
  telnum?: string;
  direction: 'in' | 'out';
  callid: string;
  crm_token: string;
}

/**
 * Normalizes domain for WCGP requests (strips protocol, path, port)
 */
export function normalizeWcgpDomain(rawDomain: string): string {
  if (!rawDomain) return '';
  let d = rawDomain.trim();
  d = d.replace(/^https?:\/\//i, '');
  d = d.replace(/\/.*$/, '');
  return d;
}

/**
 * Resolves candidate endpoints in priority order (e.g. /crmapi/v1 vs /sys/crm_api.wcgp)
 */
export function resolveWcgpEndpoints(rawInput: string): string[] {
  if (!rawInput) return [];
  const s = rawInput.trim();
  const host = normalizeWcgpDomain(s);
  if (!host) return [];

  const candidates: string[] = [];

  // If user provided a specific path (such as /crmapi/v1)
  if (s.includes('/crmapi/v1')) {
    candidates.push(`https://${host}/crmapi/v1`);
    candidates.push(`https://${host}/sys/crm_api.wcgp`);
  } else if (s.includes('/sys/crm_api.wcgp')) {
    candidates.push(`https://${host}/sys/crm_api.wcgp`);
    candidates.push(`https://${host}/crmapi/v1`);
  } else {
    // Default order: try /crmapi/v1 first (modern REST), then /sys/crm_api.wcgp
    candidates.push(`https://${host}/crmapi/v1`);
    candidates.push(`https://${host}/sys/crm_api.wcgp`);
  }

  return [...new Set(candidates)];
}

/**
 * Converts UTC format YYYYmmddTHHMMSSZ (e.g. 20170703T121110Z) into standard ISO 8601 string
 */
export function parseWcgpDate(dateStr: string): string {
  if (!dateStr) return new Date().toISOString();
  const trimmed = String(dateStr).trim();

  // Pattern: 20170703T121110Z or 20170703T121110
  const match = trimmed.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/i);
  if (match) {
    const [, y, m, d, hh, mm, ss] = match;
    const iso = `${y}-${m}-${d}T${hh}:${mm}:${ss}.000Z`;
    const dt = new Date(iso);
    if (!isNaN(dt.getTime())) {
      return dt.toISOString();
    }
  }

  const dt = new Date(trimmed);
  if (!isNaN(dt.getTime())) {
    return dt.toISOString();
  }

  return new Date().toISOString();
}

/**
 * Converts a Date to Megafon WCGP UTC string YYYYmmddTHHMMSSZ
 */
export function formatDateToWcgpUtc(date: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  const y = date.getUTCFullYear();
  const m = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  const h = pad(date.getUTCHours());
  const min = pad(date.getUTCMinutes());
  const s = pad(date.getUTCSeconds());
  return `${y}${m}${d}T${h}${min}${s}Z`;
}

/**
 * Parses the CSV response returned by `cmd=history`
 * Header: UID,type,client,account,via,start,wait,duration,record,quality_control
 */
export function parseWcgpCsvHistory(csvText: string): MegafonWcgpCall[] {
  if (!csvText || typeof csvText !== 'string') return [];
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length <= 1) return [];

  // Verify header line
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const uidIdx = header.indexOf('uid');
  const typeIdx = header.indexOf('type');
  const clientIdx = header.indexOf('client');
  const accountIdx = header.indexOf('account');
  const viaIdx = header.indexOf('via');
  const startIdx = header.indexOf('start');
  const waitIdx = header.indexOf('wait');
  const durationIdx = header.indexOf('duration');
  const recordIdx = header.indexOf('record');
  const qualityIdx = header.indexOf('quality_control');

  const results: MegafonWcgpCall[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // CSV with potential commas in quotes or simple split
    const parts = line.split(',');
    if (parts.length < 4) continue;

    const uid = parts[uidIdx !== -1 ? uidIdx : 0]?.trim();
    if (!uid) continue;

    const type = (parts[typeIdx !== -1 ? typeIdx : 1]?.trim().toLowerCase() || 'in') as 'in' | 'out' | 'missed';
    const client = parts[clientIdx !== -1 ? clientIdx : 2]?.trim() || '';
    const account = parts[accountIdx !== -1 ? accountIdx : 3]?.trim() || '';
    const via = viaIdx !== -1 ? parts[viaIdx]?.trim() : undefined;
    const start = startIdx !== -1 ? parts[startIdx]?.trim() : '';
    const wait = waitIdx !== -1 ? parseInt(parts[waitIdx]?.trim() || '0', 10) : 0;
    const duration = durationIdx !== -1 ? parseInt(parts[durationIdx]?.trim() || '0', 10) : 0;
    const record = recordIdx !== -1 ? parts[recordIdx]?.trim() : undefined;
    const qc = qualityIdx !== -1 && parts[qualityIdx] ? parseFloat(parts[qualityIdx].trim()) : undefined;

    results.push({
      uid,
      type,
      client,
      account,
      via,
      start: parseWcgpDate(start),
      wait: isNaN(wait) ? 0 : wait,
      duration: isNaN(duration) ? 0 : duration,
      record: record && record.startsWith('http') ? record : undefined,
      quality_control: isNaN(qc as number) ? undefined : qc,
    });
  }

  return results;
}

/**
 * Sends a command to Megafon VATS REST/WCGP API:
 * Tries the primary endpoint (e.g. /crmapi/v1 or /sys/crm_api.wcgp) and falls back if needed.
 */
export async function sendWcgpRequest(
  domain: string,
  token: string,
  cmd: string,
  params: Record<string, any> = {}
): Promise<{ ok: boolean; status: number; data: any; rawText: string; error?: string; endpointUsed?: string }> {
  const normDomain = normalizeWcgpDomain(domain);
  if (!normDomain) {
    return { ok: false, status: 400, data: null, rawText: '', error: 'Домен или адрес ВАТС не указан' };
  }
  if (!token) {
    return { ok: false, status: 400, data: null, rawText: '', error: 'Токен авторизации ВАТС не указан' };
  }

  const endpoints = resolveWcgpEndpoints(domain);
  const payload = new URLSearchParams();
  payload.append('cmd', cmd);
  payload.append('token', token.trim());

  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      payload.append(k, String(v));
    }
  }

  let lastError = '';
  let lastStatus = 0;

  for (const endpoint of endpoints) {
    try {
      const res = await axios.post(endpoint, payload.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'CallQA-Megafon-REST-Client/1.0',
        },
        timeout: 10000,
        responseType: 'text',
        validateStatus: () => true, // capture all HTTP statuses
      });

      const rawText = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      let parsedJson: any = null;
      try {
        parsedJson = JSON.parse(rawText);
      } catch {
        parsedJson = null;
      }

      // If success (200)
      if (res.status === 200) {
        return {
          ok: true,
          status: 200,
          data: parsedJson !== null ? parsedJson : rawText,
          rawText,
          endpointUsed: endpoint,
        };
      }

      // If valid error returned by Megafon PBX logic (400 or 401 as per docs)
      if (res.status === 400 || res.status === 401) {
        const errMsg = parsedJson?.error || `HTTP ${res.status}: ${rawText.substring(0, 150)}`;
        return {
          ok: false,
          status: res.status,
          data: parsedJson,
          rawText,
          error: errMsg,
          endpointUsed: endpoint,
        };
      }

      // 404 or other gateway error - try next candidate endpoint
      lastStatus = res.status;
      lastError = `HTTP ${res.status}: ${rawText.substring(0, 120)}`;
    } catch (err: any) {
      lastStatus = 0;
      if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
        lastError = `Таймаут подключения к ${endpoint} (10 сек). Проверьте доступность хоста.`;
      } else {
        lastError = err.message || String(err);
      }
    }
  }

  return {
    ok: false,
    status: lastStatus,
    data: null,
    rawText: '',
    error: lastError || 'Не удалось получить ответ от ВАТС Мегафон'
  };
}

/**
 * cmd=accounts: Retrieves list of PBX employees
 */
export async function getWcgpAccounts(domain: string, token: string): Promise<MegafonWcgpAccount[]> {
  const res = await sendWcgpRequest(domain, token, 'accounts');
  if (!res.ok) {
    throw new Error(res.error || 'Не удалось получить список пользователей АТС');
  }
  if (Array.isArray(res.data)) {
    return res.data;
  }
  return [];
}

/**
 * cmd=groups: Retrieves list of PBX departments
 */
export async function getWcgpGroups(domain: string, token: string, user?: string): Promise<MegafonWcgpGroup[]> {
  const params: Record<string, string> = {};
  if (user) params.user = user;
  const res = await sendWcgpRequest(domain, token, 'groups', params);
  if (!res.ok) {
    throw new Error(res.error || 'Не удалось получить список отделов АТС');
  }
  if (Array.isArray(res.data)) {
    return res.data;
  }
  return [];
}

/**
 * cmd=makeCall: Initiates click-to-call from manager to client
 */
export async function makeWcgpCall(
  domain: string,
  token: string,
  user: string,
  phone: string
): Promise<{ success: boolean; callId?: string; error?: string }> {
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  const res = await sendWcgpRequest(domain, token, 'makeCall', {
    user: user.trim(),
    phone: cleanPhone,
  });

  if (res.ok) {
    const callId = typeof res.data === 'string' ? res.data.trim() : (res.data?.CallID || res.data?.callid || 'initiated');
    return { success: true, callId };
  }

  return { success: false, error: res.error || 'Ошибка вызова' };
}

/**
 * cmd=history: Pulls call history CSV for specified period
 */
export async function getWcgpHistory(
  domain: string,
  token: string,
  options: {
    period?: 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month';
    start?: Date;
    end?: Date;
    type?: 'all' | 'in' | 'out' | 'missed';
    limit?: number;
  } = {}
): Promise<MegafonWcgpCall[]> {
  const params: Record<string, any> = {};

  if (options.period) {
    params.period = options.period;
  } else if (options.start) {
    params.start = formatDateToWcgpUtc(options.start);
    if (options.end) {
      params.end = formatDateToWcgpUtc(options.end);
    }
  } else {
    params.period = 'today';
  }

  if (options.type) {
    params.type = options.type;
  }

  if (options.limit) {
    params.limit = options.limit;
  }

  const res = await sendWcgpRequest(domain, token, 'history', params);
  if (!res.ok) {
    throw new Error(res.error || 'Не удалось выгрузить историю звонков из АТС');
  }

  return parseWcgpCsvHistory(res.rawText);
}
