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

export interface WcgpResponseInfo {
  ok: boolean;
  status: number;
  data: any;
  rawText: string;
  error?: string;
  endpointUsed?: string;
  methodUsed?: 'GET' | 'POST';
  diagnostics?: string[];
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
 * Resolves candidate endpoints in priority order:
 * 1. /sys/crm_api.wcgp — официальный шлюз ВАТС Мегафон по спецификации REST/WCGP
 * 2. /crmapi/v1 — альтернативный алиас или прямой REST-эндпоинт
 * 3. /crmapi/v1/${cmd} — path-based REST маршрут (например /crmapi/v1/accounts)
 * 4. http:// fallback в случае проблем с TLS
 */
export function resolveWcgpEndpoints(rawInput: string, cmd?: string): string[] {
  if (!rawInput) return [];
  const s = rawInput.trim();
  const host = normalizeWcgpDomain(s);
  if (!host) return [];

  const candidates: string[] = [];

  // Официальный путь из документации Мегафон (стр. 10-18): https://<domain>/sys/crm_api.wcgp
  candidates.push(`https://${host}/sys/crm_api.wcgp`);

  // Если пользователь явно указал путь /crmapi/v1 или это REST-шлюз
  if (s.includes('/crmapi/v1')) {
    candidates.push(`https://${host}/crmapi/v1`);
    if (cmd) {
      candidates.push(`https://${host}/crmapi/v1/${cmd}`);
    }
  } else {
    candidates.push(`https://${host}/crmapi/v1`);
    if (cmd) {
      candidates.push(`https://${host}/crmapi/v1/${cmd}`);
    }
  }

  // Не-TLS фоллбек (для нестандартных инсталляций)
  candidates.push(`http://${host}/sys/crm_api.wcgp`);

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
 * Safely parses JSON if possible, otherwise returns null
 */
function tryParseJson(text: string): any {
  if (!text || typeof text !== 'string') return null;
  const clean = text.replace(/^\uFEFF/, '').trim();
  if (!clean.startsWith('{') && !clean.startsWith('[')) return null;
  try {
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

/**
 * Parses the CSV response returned by `cmd=history`
 * Header: UID,type,client,account,via,start,wait,duration,record,quality_control
 * Supports both comma (,) and semicolon (;) delimiters, BOM markers, quotes, and JSON fallback.
 */
export function parseWcgpCsvHistory(csvText: string): MegafonWcgpCall[] {
  if (!csvText || typeof csvText !== 'string') return [];
  const clean = csvText.replace(/^\uFEFF/, '').trim();
  if (!clean) return [];

  // Check if response is actually JSON array or object
  if (clean.startsWith('[') || clean.startsWith('{')) {
    const json = tryParseJson(clean);
    if (json) {
      const arr = Array.isArray(json) ? json : (json.history || json.calls || json.data || json.items || []);
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.map((item: any) => ({
          uid: String(item.uid || item.callid || item.id || `call-${Date.now()}`),
          type: (String(item.type || 'in').toLowerCase()) as any,
          client: String(item.client || item.phone || ''),
          account: String(item.account || item.user || item.realName || ''),
          via: item.via ? String(item.via) : undefined,
          start: parseWcgpDate(item.start || item.timestamp || ''),
          wait: Number(item.wait || 0),
          duration: Number(item.duration || 0),
          record: item.record || item.link,
          quality_control: item.quality_control !== undefined ? Number(item.quality_control) : (item.rating !== undefined ? Number(item.rating) : undefined)
        }));
      }
    }
  }

  const rawLines = clean.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (rawLines.length === 0) return [];

  // Detect delimiter: semicolon (;) vs comma (,)
  const firstLine = rawLines[0];
  const semiCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const delim = semiCount >= commaCount && semiCount >= tabCount ? ';' : (tabCount > commaCount ? '\t' : ',');

  const splitCols = (line: string): string[] => {
    return line.split(delim).map(col => col.replace(/^["']|["']$/g, '').trim());
  };

  const firstParts = splitCols(firstLine).map(h => h.toLowerCase());
  const hasHeader = firstParts.some(h => [
    'uid', 'type', 'client', 'account', 'start', 'duration',
    'тип', 'клиент', 'сотрудник', 'начало', 'длительность'
  ].includes(h));

  let startRow = 0;
  let uidIdx = 0;
  let typeIdx = 1;
  let clientIdx = 2;
  let accountIdx = 3;
  let viaIdx = 4;
  let startIdx = 5;
  let waitIdx = 6;
  let durationIdx = 7;
  let recordIdx = 8;
  let qualityIdx = 9;

  if (hasHeader) {
    startRow = 1;
    uidIdx = firstParts.findIndex(h => h === 'uid' || h === 'callid' || h === 'id');
    typeIdx = firstParts.findIndex(h => h === 'type' || h === 'тип');
    clientIdx = firstParts.findIndex(h => h === 'client' || h === 'клиент' || h === 'phone' || h === 'номер');
    accountIdx = firstParts.findIndex(h => h === 'account' || h === 'сотрудник' || h === 'аккаунт' || h === 'user');
    viaIdx = firstParts.findIndex(h => h === 'via' || h === 'линия' || h === 'номер_атс');
    startIdx = firstParts.findIndex(h => h === 'start' || h === 'начало' || h === 'время' || h === 'date');
    waitIdx = firstParts.findIndex(h => h === 'wait' || h === 'ожидание');
    durationIdx = firstParts.findIndex(h => h === 'duration' || h === 'длительность');
    recordIdx = firstParts.findIndex(h => h === 'record' || h === 'запись' || h === 'link');
    qualityIdx = firstParts.findIndex(h => h === 'quality_control' || h === 'оценка' || h === 'rating' || h === 'quality');
  }

  const results: MegafonWcgpCall[] = [];

  for (let i = startRow; i < rawLines.length; i++) {
    const parts = splitCols(rawLines[i]);
    if (parts.length < 3) continue;

    const uid = parts[uidIdx !== -1 ? uidIdx : 0];
    if (!uid) continue;

    const rawType = (parts[typeIdx !== -1 ? typeIdx : 1] || 'in').toLowerCase();
    const type: 'in' | 'out' | 'missed' = rawType.includes('out') || rawType.includes('исх')
      ? 'out'
      : (rawType.includes('miss') || rawType.includes('проп') ? 'missed' : 'in');

    const client = parts[clientIdx !== -1 ? clientIdx : 2] || '';
    const account = parts[accountIdx !== -1 ? accountIdx : 3] || '';
    const via = viaIdx !== -1 && parts[viaIdx] ? parts[viaIdx] : undefined;
    const start = parts[startIdx !== -1 ? startIdx : 5] || '';
    const wait = waitIdx !== -1 && parts[waitIdx] ? parseInt(parts[waitIdx], 10) : 0;
    const duration = durationIdx !== -1 && parts[durationIdx] ? parseInt(parts[durationIdx], 10) : 0;
    const record = recordIdx !== -1 && parts[recordIdx] ? parts[recordIdx] : undefined;
    const qc = qualityIdx !== -1 && parts[qualityIdx] ? parseFloat(parts[qualityIdx]) : undefined;

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
 * Extracts and normalizes MegafonWcgpAccount list from JSON or CSV responses
 */
export function extractAccountsFromResponse(data: any, rawText: string): MegafonWcgpAccount[] {
  let list: any[] = [];

  if (Array.isArray(data)) {
    list = data;
  } else if (data && typeof data === 'object') {
    if (Array.isArray(data.accounts)) list = data.accounts;
    else if (Array.isArray(data.users)) list = data.users;
    else if (Array.isArray(data.data)) list = data.data;
    else if (Array.isArray(data.items)) list = data.items;
    else if (Array.isArray(data.result)) list = data.result;
    else {
      // Check for object with numerical keys e.g. { "0": {...}, "1": {...} }
      const values = Object.values(data).filter(
        v => v && typeof v === 'object' && ((v as any).name || (v as any).realName || (v as any).login || (v as any).fio)
      );
      if (values.length > 0) list = values;
    }
  }

  // If still empty but rawText is CSV or plain lines
  if (list.length === 0 && rawText && typeof rawText === 'string') {
    const clean = rawText.replace(/^\uFEFF/, '').trim();
    if (!clean.startsWith('<')) {
      const lines = clean.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length > 0) {
        const firstLine = lines[0];
        const delim = firstLine.includes(';') ? ';' : ',';
        const parts0 = firstLine.split(delim).map(s => s.trim().toLowerCase());
        const isHeader = parts0.some(p => ['name', 'login', 'realname', 'имя', 'пользователь'].includes(p));
        const startI = isHeader ? 1 : 0;
        for (let i = startI; i < lines.length; i++) {
          const cols = lines[i].split(delim).map(s => s.replace(/^["']|["']$/g, '').trim());
          if (cols.length >= 1 && cols[0]) {
            list.push({
              name: cols[0],
              realName: cols[1] || cols[0],
              ext: cols[2] || undefined,
              telnum: cols[3] || undefined
            });
          }
        }
      }
    }
  }

  // Normalize
  return list
    .filter(item => item && typeof item === 'object')
    .map(item => ({
      name: String(item.name || item.login || item.user || item.id || '').trim(),
      realName: String(item.realName || item.real_name || item.fio || item.name || item.login || '').trim(),
      ext: item.ext !== undefined ? String(item.ext).trim() : (item.extension ? String(item.extension).trim() : undefined),
      telnum: item.telnum ? String(item.telnum).trim() : (item.phone ? String(item.phone).trim() : undefined)
    }))
    .filter(acc => acc.name.length > 0 || acc.realName.length > 0);
}

/**
 * Checks if a response contains real data for the requested command
 */
function isResponseSubstantive(cmd: string, data: any, rawText: string): boolean {
  if (!rawText || !rawText.trim()) return false;
  const clean = rawText.trim();

  // If HTML document returned, it is definitely a gateway error or default page
  if (clean.toLowerCase().includes('<!doctype') || clean.toLowerCase().includes('<html')) {
    return false;
  }

  if (cmd === 'accounts') {
    const accs = extractAccountsFromResponse(data, rawText);
    return accs.length > 0;
  }

  if (cmd === 'history') {
    const calls = parseWcgpCsvHistory(rawText);
    return calls.length > 0;
  }

  if (cmd === 'groups') {
    if (Array.isArray(data) && data.length > 0) return true;
    if (data?.groups && Array.isArray(data.groups) && data.groups.length > 0) return true;
    return false;
  }

  return clean.length > 0;
}

/**
 * Sends a command to Megafon VATS REST/WCGP API:
 * Tries candidates in priority order (POST then GET on /sys/crm_api.wcgp, then /crmapi/v1).
 * Verifies that the response actually contains substantive data before stopping.
 */
export async function sendWcgpRequest(
  domain: string,
  token: string,
  cmd: string,
  params: Record<string, any> = {}
): Promise<WcgpResponseInfo> {
  const normDomain = normalizeWcgpDomain(domain);
  if (!normDomain) {
    return { ok: false, status: 400, data: null, rawText: '', error: 'Домен или адрес ВАТС не указан' };
  }
  if (!token) {
    return { ok: false, status: 400, data: null, rawText: '', error: 'Токен авторизации ВАТС не указан' };
  }

  const endpoints = resolveWcgpEndpoints(domain, cmd);
  const diagnostics: string[] = [];

  const postPayload = new URLSearchParams();
  postPayload.append('cmd', cmd);
  postPayload.append('token', token.trim());
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      postPayload.append(k, String(v));
    }
  }

  let lastError = '';
  let lastStatus = 0;
  let bestEmptySuccess: WcgpResponseInfo | null = null;

  for (const endpoint of endpoints) {
    // 1. Attempt POST with form-urlencoded body (Official Megafon documentation method)
    try {
      const resPost = await axios.post(endpoint, postPayload.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'CallQA-Megafon-REST-Client/1.0',
        },
        timeout: 10000,
        responseType: 'text',
        validateStatus: () => true,
      });

      const rawText = typeof resPost.data === 'string' ? resPost.data : JSON.stringify(resPost.data);
      const parsedJson = tryParseJson(rawText);
      diagnostics.push(`POST ${endpoint} => HTTP ${resPost.status} (${rawText.length} байт)`);

      if (resPost.status === 200) {
        const data = parsedJson !== null ? parsedJson : rawText;
        if (isResponseSubstantive(cmd, data, rawText)) {
          return {
            ok: true,
            status: 200,
            data,
            rawText,
            endpointUsed: endpoint,
            methodUsed: 'POST',
            diagnostics,
          };
        }
        // Remember as fallback if no endpoint returns populated data
        if (!bestEmptySuccess) {
          bestEmptySuccess = {
            ok: true,
            status: 200,
            data,
            rawText,
            endpointUsed: endpoint,
            methodUsed: 'POST',
            diagnostics,
          };
        }
      } else if (resPost.status === 400 || resPost.status === 401) {
        lastStatus = resPost.status;
        lastError = parsedJson?.error || `HTTP ${resPost.status}: ${rawText.substring(0, 150)}`;
      } else {
        lastStatus = resPost.status;
        lastError = `HTTP ${resPost.status}: ${rawText.substring(0, 100)}`;
      }
    } catch (err: any) {
      lastStatus = 0;
      const errMsg = err.code === 'ECONNABORTED' || err.message?.includes('timeout')
        ? `Таймаут подключения (10с)`
        : err.message || String(err);
      diagnostics.push(`POST ${endpoint} => Ошибка: ${errMsg}`);
      lastError = errMsg;
    }

    // 2. Attempt GET with query parameters (Documentation states: GET / POST for accounts, history, groups, etc.)
    try {
      const getParams = { cmd, token: token.trim(), ...params };
      const resGet = await axios.get(endpoint, {
        params: getParams,
        headers: {
          'User-Agent': 'CallQA-Megafon-REST-Client/1.0',
        },
        timeout: 10000,
        responseType: 'text',
        validateStatus: () => true,
      });

      const rawText = typeof resGet.data === 'string' ? resGet.data : JSON.stringify(resGet.data);
      const parsedJson = tryParseJson(rawText);
      diagnostics.push(`GET ${endpoint} => HTTP ${resGet.status} (${rawText.length} байт)`);

      if (resGet.status === 200) {
        const data = parsedJson !== null ? parsedJson : rawText;
        if (isResponseSubstantive(cmd, data, rawText)) {
          return {
            ok: true,
            status: 200,
            data,
            rawText,
            endpointUsed: endpoint,
            methodUsed: 'GET',
            diagnostics,
          };
        }
        if (!bestEmptySuccess) {
          bestEmptySuccess = {
            ok: true,
            status: 200,
            data,
            rawText,
            endpointUsed: endpoint,
            methodUsed: 'GET',
            diagnostics,
          };
        }
      } else if (resGet.status === 400 || resGet.status === 401) {
        lastStatus = resGet.status;
        lastError = parsedJson?.error || `HTTP ${resGet.status}: ${rawText.substring(0, 150)}`;
      }
    } catch (err: any) {
      const errMsg = err.message || String(err);
      diagnostics.push(`GET ${endpoint} => Ошибка: ${errMsg}`);
    }
  }

  // If we had a 200 OK from any endpoint (even if data array was empty)
  if (bestEmptySuccess) {
    return bestEmptySuccess;
  }

  return {
    ok: false,
    status: lastStatus,
    data: null,
    rawText: '',
    error: lastError || 'Не удалось получить ответ от ВАТС Мегафон',
    diagnostics,
  };
}

/**
 * cmd=accounts: Retrieves list of PBX employees with normalized properties
 */
export async function getWcgpAccounts(
  domain: string,
  token: string
): Promise<{ accounts: MegafonWcgpAccount[]; endpointUsed?: string; methodUsed?: string; diagnostics?: string[] }> {
  const res = await sendWcgpRequest(domain, token, 'accounts');
  if (!res.ok) {
    throw new Error(res.error || 'Не удалось получить список пользователей АТС');
  }

  const accounts = extractAccountsFromResponse(res.data, res.rawText);
  return {
    accounts,
    endpointUsed: res.endpointUsed,
    methodUsed: res.methodUsed,
    diagnostics: res.diagnostics,
  };
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
  if (res.data?.groups && Array.isArray(res.data.groups)) {
    return res.data.groups;
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
): Promise<{ success: boolean; callId?: string; error?: string; endpointUsed?: string }> {
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  const res = await sendWcgpRequest(domain, token, 'makeCall', {
    user: user.trim(),
    phone: cleanPhone,
  });

  if (res.ok) {
    const callId = typeof res.data === 'string'
      ? res.data.trim()
      : (res.data?.CallID || res.data?.callid || res.data?.id || 'initiated');
    return { success: true, callId, endpointUsed: res.endpointUsed };
  }

  return { success: false, error: res.error || 'Ошибка вызова' };
}

/**
 * cmd=history: Pulls call history CSV for specified period
 * If 'today' returns 0 rows (e.g. timezone mismatch in UTC), automatically tries fallback to explicit UTC 24h range.
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
): Promise<{ calls: MegafonWcgpCall[]; endpointUsed?: string; methodUsed?: string; rawPreview?: string }> {
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

  let calls = parseWcgpCsvHistory(res.rawText);

  // Fallback: If 'today' returned 0 calls, try explicit start/end for the last 24h to avoid UTC boundary issues
  if (calls.length === 0 && (!options.period || options.period === 'today') && !options.start) {
    const fallbackStart = new Date(Date.now() - 24 * 3600 * 1000);
    const fallbackEnd = new Date();
    const fallbackParams: Record<string, any> = {
      start: formatDateToWcgpUtc(fallbackStart),
      end: formatDateToWcgpUtc(fallbackEnd),
    };
    if (options.type) fallbackParams.type = options.type;

    const resFallback = await sendWcgpRequest(domain, token, 'history', fallbackParams);
    if (resFallback.ok) {
      const fallbackCalls = parseWcgpCsvHistory(resFallback.rawText);
      if (fallbackCalls.length > 0) {
        calls = fallbackCalls;
        return {
          calls,
          endpointUsed: resFallback.endpointUsed,
          methodUsed: resFallback.methodUsed,
          rawPreview: resFallback.rawText.substring(0, 200),
        };
      }
    }
  }

  return {
    calls,
    endpointUsed: res.endpointUsed,
    methodUsed: res.methodUsed,
    rawPreview: res.rawText.substring(0, 200),
  };
}
