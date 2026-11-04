/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CallRecord } from '../types.js';

/**
 * Deduplicates an array of call records by call_id.
 * When duplicates exist, it retains and merges the richest record
 * (e.g., favoring completed calls with transcript, summary, operator score, and consent info).
 */
export function deduplicateCalls(calls: CallRecord[]): CallRecord[] {
  if (!Array.isArray(calls) || calls.length === 0) return [];

  const map = new Map<string, CallRecord>();

  for (const call of calls) {
    if (!call || !call.call_id) continue;
    const existing = map.get(call.call_id);
    if (!existing) {
      map.set(call.call_id, call);
      continue;
    }

    // Determine which record is more complete/up to date
    const isCurrentBetter =
      (call.status === 'completed' && existing.status !== 'completed') ||
      (!!call.transcript && !existing.transcript) ||
      (call.operator_score !== null && call.operator_score !== undefined && (existing.operator_score === null || existing.operator_score === undefined)) ||
      ((call.transcript?.length || 0) > (existing.transcript?.length || 0)) ||
      ((call.summary?.length || 0) > (existing.summary?.length || 0));

    if (isCurrentBetter) {
      map.set(call.call_id, {
        ...existing,
        ...call,
        audio_url: call.audio_url || existing.audio_url,
        consent_id: call.consent_id || existing.consent_id,
        consent_status: call.consent_status || existing.consent_status,
      });
    } else {
      map.set(call.call_id, {
        ...call,
        ...existing,
        audio_url: existing.audio_url || call.audio_url,
        consent_id: existing.consent_id || call.consent_id,
        consent_status: existing.consent_status || call.consent_status,
      });
    }
  }

  return Array.from(map.values());
}
