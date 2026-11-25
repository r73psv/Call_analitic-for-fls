/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BatchAnalysisQueueState, SttProvider } from '../types.js';

export interface StartBatchQueueOptions {
  modelOverride?: string;
  sttProvider?: SttProvider;
  forceRetranscribe?: boolean;
  now?: string;
}

/**
 * Creates a new persisted batch analysis queue or merges new candidate IDs into
 * an already-running queue without re-queuing calls already processed in the run.
 */
export function createOrMergeBatchQueue(
  existing: BatchAnalysisQueueState | undefined | null,
  candidateCallIds: string[],
  options: StartBatchQueueOptions = {}
): BatchAnalysisQueueState {
  const now = options.now || new Date().toISOString();
  const uniqueCandidates = Array.from(
    new Set((candidateCallIds || []).map((id) => String(id || '').trim()).filter(Boolean))
  );

  if (existing && existing.status === 'running') {
    const processedSet = new Set(existing.processedCallIds || []);
    const pendingSet = new Set(existing.pendingCallIds || []);
    const mergedPending = [...(existing.pendingCallIds || [])];

    for (const id of uniqueCandidates) {
      if (!processedSet.has(id) && !pendingSet.has(id) && existing.currentCallId !== id) {
        mergedPending.push(id);
        pendingSet.add(id);
      }
    }

    const totalCount =
      mergedPending.length +
      (existing.processedCallIds?.length || 0) +
      (existing.failedCallIds?.length || 0) +
      (existing.currentCallId && !pendingSet.has(existing.currentCallId) && !processedSet.has(existing.currentCallId)
        ? 1
        : 0);

    return {
      ...existing,
      status: mergedPending.length > 0 || existing.currentCallId ? 'running' : 'completed',
      updatedAt: now,
      modelOverride: options.modelOverride ?? existing.modelOverride,
      sttProvider: options.sttProvider ?? existing.sttProvider,
      forceRetranscribe: options.forceRetranscribe ?? existing.forceRetranscribe ?? true,
      pendingCallIds: mergedPending,
      totalCount: Math.max(existing.totalCount || 0, totalCount),
    };
  }

  return {
    id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    status: uniqueCandidates.length > 0 ? 'running' : 'completed',
    startedAt: now,
    updatedAt: now,
    completedAt: uniqueCandidates.length === 0 ? now : undefined,
    modelOverride: options.modelOverride,
    sttProvider: options.sttProvider,
    forceRetranscribe: options.forceRetranscribe ?? true,
    pendingCallIds: uniqueCandidates,
    processedCallIds: [],
    failedCallIds: [],
    currentCallId: null,
    totalCount: uniqueCandidates.length,
    resumeCount: 0,
  };
}

/**
 * Recovers an unfinished persisted batch queue after a server restart.
 * If a call was in-flight (`currentCallId`) when the process died, returns it to
 * the front of `pendingCallIds` without touching already-processed calls.
 */
export function recoverInterruptedBatchQueue(
  queue: BatchAnalysisQueueState | undefined | null,
  now: string = new Date().toISOString()
): { recovered: boolean; queue: BatchAnalysisQueueState | null } {
  if (!queue || queue.status !== 'running') {
    return { recovered: false, queue: queue || null };
  }

  const processedSet = new Set(queue.processedCallIds || []);
  const pending = (queue.pendingCallIds || []).filter((id) => id && !processedSet.has(id));

  if (queue.currentCallId && !processedSet.has(queue.currentCallId) && !pending.includes(queue.currentCallId)) {
    pending.unshift(queue.currentCallId);
  }

  if (pending.length === 0) {
    return {
      recovered: false,
      queue: {
        ...queue,
        status: 'completed',
        currentCallId: null,
        pendingCallIds: [],
        updatedAt: now,
        completedAt: queue.completedAt || now,
      },
    };
  }

  return {
    recovered: true,
    queue: {
      ...queue,
      status: 'running',
      currentCallId: null,
      pendingCallIds: pending,
      updatedAt: now,
      resumeCount: (queue.resumeCount || 0) + 1,
      lastResumedAt: now,
    },
  };
}

export function markBatchItemStarted(
  queue: BatchAnalysisQueueState,
  callId: string,
  now: string = new Date().toISOString()
): BatchAnalysisQueueState {
  return {
    ...queue,
    status: 'running',
    currentCallId: callId,
    updatedAt: now,
  };
}

export function markBatchItemCompleted(
  queue: BatchAnalysisQueueState,
  callId: string,
  now: string = new Date().toISOString()
): BatchAnalysisQueueState {
  const pending = (queue.pendingCallIds || []).filter((id) => id !== callId);
  const processed = (queue.processedCallIds || []).includes(callId)
    ? [...(queue.processedCallIds || [])]
    : [...(queue.processedCallIds || []), callId];
  const failed = (queue.failedCallIds || []).filter((f) => f.callId !== callId);

  return {
    ...queue,
    pendingCallIds: pending,
    processedCallIds: processed,
    failedCallIds: failed,
    currentCallId: queue.currentCallId === callId ? null : queue.currentCallId,
    updatedAt: now,
  };
}

export function markBatchItemFailed(
  queue: BatchAnalysisQueueState,
  callId: string,
  error: string,
  now: string = new Date().toISOString()
): BatchAnalysisQueueState {
  const pending = (queue.pendingCallIds || []).filter((id) => id !== callId);
  const failed = [
    ...(queue.failedCallIds || []).filter((f) => f.callId !== callId),
    { callId, error: String(error || 'Unknown error').slice(0, 300), failedAt: now },
  ];

  return {
    ...queue,
    pendingCallIds: pending,
    failedCallIds: failed,
    currentCallId: queue.currentCallId === callId ? null : queue.currentCallId,
    updatedAt: now,
  };
}

export function finalizeBatchQueueIfDone(
  queue: BatchAnalysisQueueState,
  now: string = new Date().toISOString()
): BatchAnalysisQueueState {
  if ((queue.pendingCallIds || []).length === 0) {
    return {
      ...queue,
      status: 'completed',
      currentCallId: null,
      updatedAt: now,
      completedAt: now,
    };
  }
  return {
    ...queue,
    updatedAt: now,
  };
}
