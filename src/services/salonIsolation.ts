/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import { normalizeWcgpDomain } from './megafonRest.js';

export interface SalonIsolationContext {
  salonName?: string;
  apiVersion?: string;
  restDomain?: string;
  crmToken?: string;
  vatsId?: string | null;
}

export interface WcgpWebhookValidationResult {
  allowed: boolean;
  httpStatus?: 401 | 403;
  reason?:
    | 'ok'
    | 'missing_crm_token'
    | 'invalid_crm_token'
    | 'wcgp_not_configured'
    | 'vats_domain_mismatch';
  message?: string;
  detectedVatsHost?: string;
}

export interface CallOwnershipResult {
  belongs: boolean;
  reason?: 'ok' | 'foreign_vats_domain' | 'foreign_record_host' | 'foreign_salon_scope';
  detectedHost?: string;
  expectedHost?: string;
}

export interface S3SnapshotValidationResult {
  allowed: boolean;
  reason?: 'ok' | 's3_snapshot_foreign_vats' | 's3_snapshot_foreign_salon';
  message?: string;
}

/**
 * Constant-time string comparison using SHA-256 digests so token checks
 * do not leak length or prefix timing information.
 */
export function timingSafeTokenEqual(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(String(a || ''), 'utf8').digest();
  const hashB = crypto.createHash('sha256').update(String(b || ''), 'utf8').digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Normalizes a salon display name into a stable ASCII slug suitable for
 * isolated S3 prefixes and cross-salon scope comparison.
 */
export function normalizeSalonScope(salonName?: string | null): string {
  const raw = String(salonName || '').trim().toLowerCase();
  if (!raw) return '';

  const translitMap: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh',
    з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
    п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
    ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };

  let out = '';
  for (const ch of raw) {
    if (ch in translitMap) {
      out += translitMap[ch];
    } else if (/[a-z0-9]/.test(ch)) {
      out += ch;
    } else if (out.length > 0 && !out.endsWith('-')) {
      out += '-';
    }
  }
  const slug = out.replace(/^-+|-+$/g, '');

  // Treat "лик-28", "лик28", "liq-28", "liq28" as the same canonical slug
  if (/^(?:liq|lik)-?28$/.test(slug)) {
    return 'liq28';
  }
  return slug;
}

/**
 * Extracts normalized lowercase hostname (without port/path) from a URL or bare domain.
 */
export function extractVatsHostFromUrl(rawUrl?: string | null): string {
  const raw = String(rawUrl || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw) || raw.startsWith('//')) {
    try {
      const normalized = raw.startsWith('//') ? `https:${raw}` : raw;
      const parsed = new URL(normalized);
      return parsed.hostname.toLowerCase();
    } catch {
      return '';
    }
  }
  // Bare domain or host/path
  const host = normalizeWcgpDomain(raw).split(':')[0].trim().toLowerCase();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) ? host : '';
}

/**
 * Checks whether a hostname is a Megafon VATS host (e.g., vatsXXXXX.megapbx.ru or vatsXXXXX.cp.megafon.ru).
 */
export function isMegapbxVatsHost(host?: string | null): boolean {
  const h = String(host || '').trim().toLowerCase();
  if (!h) return false;
  return (
    /(?:^|\.)megapbx\.ru$/i.test(h) ||
    /^vats\d+\./i.test(h) ||
    /^vats\d+\.cp\.megafon\.ru$/i.test(h)
  );
}

/**
 * Validates that a WCGP target host is a safe public hostname (prevents SSRF to loopback/private IPs).
 */
export function isSafeWcgpHost(rawDomain?: string | null): boolean {
  const host = extractVatsHostFromUrl(rawDomain);
  if (!host) return false;
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ||
    host.includes(':')
  ) {
    return false;
  }
  return true;
}

/**
 * Extracts numeric Megafon VATS ID (e.g. "123456") from a domain, login, or URL when present.
 */
export function extractVatsNumericId(value?: string | null): string | null {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  const match = raw.match(/vats(\d{4,10})/i);
  return match ? match[1] : null;
}

/**
 * Strict validation for incoming Megafon REST CRM API (WCGP) webhooks.
 * Guarantees that another salon's VATS cannot push calls into this salon's call list:
 * 1. When `crm_token` is configured, incoming `crm_token` is REQUIRED (empty token is rejected with 401).
 * 2. When neither `crm_token` nor `restDomain` is configured, incoming WCGP webhooks are rejected with 401.
 * 3. When `restDomain` is configured, any incoming recording URL or explicit domain pointing to a
 *    different Megafon VATS host (`*.megapbx.ru` / `vats*`) is rejected with 403.
 */
export function validateWcgpWebhookOrigin(params: {
  cmd: string;
  incomingCrmToken?: string | null;
  incomingRecordUrl?: string | null;
  incomingDomain?: string | null;
  expectedCrmToken?: string | null;
  expectedRestDomain?: string | null;
}): WcgpWebhookValidationResult {
  const expectedToken = String(params.expectedCrmToken || '').trim();
  const incomingToken = String(params.incomingCrmToken || '').trim();
  const expectedHost = extractVatsHostFromUrl(params.expectedRestDomain);

  // 1. Strict crm_token check (no bypass when incoming token is empty)
  if (expectedToken) {
    if (!incomingToken) {
      return {
        allowed: false,
        httpStatus: 401,
        reason: 'missing_crm_token',
        message: 'Отсутствует обязательный ключ авторизации crm_token',
      };
    }
    if (!timingSafeTokenEqual(incomingToken, expectedToken)) {
      return {
        allowed: false,
        httpStatus: 401,
        reason: 'invalid_crm_token',
        message: 'Неверный ключ авторизации crm_token',
      };
    }
  } else if (!expectedHost) {
    // Neither crm_token nor WCGP restDomain is configured for this salon — do not accept unauthenticated WCGP webhooks
    return {
      allowed: false,
      httpStatus: 401,
      reason: 'wcgp_not_configured',
      message: 'REST CRM API (WCGP) не настроен для этого салона (укажите домен ВАТС и crm_token)',
    };
  }

  // 2. Cross-salon VATS host isolation check on incoming recording link / domain
  const candidateHosts = [
    extractVatsHostFromUrl(params.incomingDomain),
    extractVatsHostFromUrl(params.incomingRecordUrl),
  ].filter(Boolean);

  const detectedVatsHost = candidateHosts.find((h) => isMegapbxVatsHost(h)) || candidateHosts[0] || '';

  if (expectedHost && detectedVatsHost && isMegapbxVatsHost(detectedVatsHost) && detectedVatsHost !== expectedHost) {
    return {
      allowed: false,
      httpStatus: 403,
      reason: 'vats_domain_mismatch',
      detectedVatsHost,
      message: `Звонок отклонён: домен ВАТС (${detectedVatsHost}) не совпадает с настроенным доменом салона (${expectedHost})`,
    };
  }

  return {
    allowed: true,
    reason: 'ok',
    detectedVatsHost: detectedVatsHost || expectedHost || undefined,
  };
}

/**
 * Determines whether a call record belongs to the currently configured salon/VATS.
 * Rejects calls whose `vats_domain` or `audio_url`/`record_play_uri` host belongs to a
 * different Megafon VATS (`vatsXXXXX.megapbx.ru`) than the configured `MEGAFON_REST_DOMAIN`.
 */
export function validateCallBelongsToSalon(
  call: {
    vats_domain?: string | null;
    salon_scope?: string | null;
    audio_url?: string | null;
    record_play_uri?: string | null;
    is_demo?: boolean;
  },
  context: SalonIsolationContext
): CallOwnershipResult {
  // Demo calls are synthetic local fixtures
  if (call.is_demo) {
    return { belongs: true, reason: 'ok' };
  }

  const expectedHost = extractVatsHostFromUrl(context.restDomain);
  const callVatsHost = extractVatsHostFromUrl(call.vats_domain);
  const recordHost =
    extractVatsHostFromUrl(call.record_play_uri) || extractVatsHostFromUrl(call.audio_url);

  if (expectedHost && isMegapbxVatsHost(expectedHost)) {
    if (callVatsHost && isMegapbxVatsHost(callVatsHost) && callVatsHost !== expectedHost) {
      return {
        belongs: false,
        reason: 'foreign_vats_domain',
        detectedHost: callVatsHost,
        expectedHost,
      };
    }
    if (recordHost && isMegapbxVatsHost(recordHost) && recordHost !== expectedHost) {
      return {
        belongs: false,
        reason: 'foreign_record_host',
        detectedHost: recordHost,
        expectedHost,
      };
    }
  }

  // If the salon uses JSON-RPC with a known numeric VATS ID (e.g. vatsXXXXX) and no WCGP restDomain,
  // still reject calls whose recording URL explicitly belongs to a DIFFERENT numeric megapbx VATS ID.
  const expectedVatsId = context.vatsId || extractVatsNumericId(expectedHost);
  const detectedVatsId = extractVatsNumericId(callVatsHost) || extractVatsNumericId(recordHost);
  if (expectedVatsId && detectedVatsId && expectedVatsId !== detectedVatsId) {
    return {
      belongs: false,
      reason: 'foreign_record_host',
      detectedHost: recordHost || callVatsHost || `vats${detectedVatsId}`,
      expectedHost: expectedHost || `vats${expectedVatsId}`,
    };
  }

  const expectedScope = normalizeSalonScope(context.salonName);
  const callScope = normalizeSalonScope(call.salon_scope);
  if (expectedScope && callScope && expectedScope !== callScope) {
    return {
      belongs: false,
      reason: 'foreign_salon_scope',
      detectedHost: callScope,
      expectedHost: expectedScope,
    };
  }

  return { belongs: true, reason: 'ok' };
}

/**
 * Validates that an S3 backup snapshot belongs to the same salon/VATS before hydrating it
 * on startup — prevents two salons sharing an S3 bucket from overwriting each other's calls.
 */
export function validateS3SnapshotForSalon(
  snapshot: { config?: { salonName?: string; megafon?: { restDomain?: string } } } | null | undefined,
  currentContext: { envSalonName?: string; envRestDomain?: string }
): S3SnapshotValidationResult {
  if (!snapshot || !snapshot.config) {
    return { allowed: true, reason: 'ok' };
  }

  const envHost = extractVatsHostFromUrl(currentContext.envRestDomain);
  const snapHost = extractVatsHostFromUrl(snapshot.config.megafon?.restDomain);
  if (envHost && snapHost && isMegapbxVatsHost(envHost) && isMegapbxVatsHost(snapHost) && envHost !== snapHost) {
    return {
      allowed: false,
      reason: 's3_snapshot_foreign_vats',
      message: `Отклонён S3-снимок другого салона: в снимке домен ВАТС "${snapHost}", а текущему салону задан "${envHost}". Укажите уникальный S3_KEY_PREFIX для каждого салона.`,
    };
  }

  const envSalonScope = normalizeSalonScope(currentContext.envSalonName);
  const snapSalonScope = normalizeSalonScope(snapshot.config.salonName);
  if (
    envSalonScope &&
    snapSalonScope &&
    envSalonScope !== 'salon-krasoty' &&
    snapSalonScope !== 'salon-krasoty' &&
    envSalonScope !== snapSalonScope
  ) {
    return {
      allowed: false,
      reason: 's3_snapshot_foreign_salon',
      message: `Отклонён S3-снимок другого салона: в снимке салон "${snapshot.config.salonName}", а текущему экземпляру задан "${currentContext.envSalonName}". Укажите уникальный S3_KEY_PREFIX для каждого салона.`,
    };
  }

  return { allowed: true, reason: 'ok' };
}

/**
 * Resolves an isolated S3 key prefix per salon when `S3_KEY_PREFIX` is not explicitly configured.
 * Prevents multiple salon deployments sharing a bucket from colliding on a hardcoded default prefix.
 */
export function resolveSalonS3KeyPrefix(options: {
  explicitPrefix?: string | null;
  salonName?: string | null;
  restDomain?: string | null;
}): string {
  const explicit = String(options.explicitPrefix || '').trim();
  if (explicit) {
    return explicit.endsWith('/') ? explicit : `${explicit}/`;
  }

  const vatsId = extractVatsNumericId(options.restDomain);
  const salonSlug = normalizeSalonScope(options.salonName);

  if (salonSlug && salonSlug !== 'salon-krasoty') {
    return vatsId ? `salons/${salonSlug}-vats${vatsId}/data/` : `salons/${salonSlug}/data/`;
  }
  if (vatsId) {
    return `salons/vats${vatsId}/data/`;
  }
  return 'app/data/';
}
