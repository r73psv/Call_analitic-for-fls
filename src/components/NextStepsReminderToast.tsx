/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ListTodo, Clock, CheckCircle2, ChevronUp, ChevronDown, 
  X, ArrowRight, Sparkles, User, Bell, BellOff, Scissors
} from 'lucide-react';
import { CallRecord, NextStepItem, UserRole } from '../types.js';

interface NextStepsReminderToastProps {
  calls: CallRecord[];
  onOpenTasksTab: () => void;
  onOpenCallDetails: (callId: string) => void;
  userRole: UserRole;
  soundEnabled?: boolean;
}

export function NextStepsReminderToast({
  calls,
  onOpenTasksTab,
  onOpenCallDetails,
  userRole,
  soundEnabled = true
}: NextStepsReminderToastProps) {
  const [isDismissed, setIsDismissed] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [snoozeUntil, setSnoozeUntil] = useState<number | null>(() => {
    try {
      const stored = sessionStorage.getItem('next_steps_snooze_until');
      if (stored) {
        const val = parseInt(stored, 10);
        return val > Date.now() ? val : null;
      }
    } catch {
      // ignore
    }
    return null;
  });

  const hasPlayedSound = useRef(false);

  // Helper to extract items from call
  const getCallItems = (c: CallRecord): NextStepItem[] => {
    if (Array.isArray(c.next_steps_items) && c.next_steps_items.length > 0) {
      return c.next_steps_items;
    }
    if (Array.isArray(c.next_steps) && c.next_steps.length > 0) {
      return c.next_steps.map((text, idx) => ({
        id: `synth-${c.call_id}-${idx}`,
        text,
        completed: false
      }));
    }
    return [];
  };

  // Find all calls with uncompleted steps
  const pendingCalls = useMemo(() => {
    return calls.filter(c => {
      const items = getCallItems(c);
      return items.length > 0 && items.some(i => !i.completed);
    });
  }, [calls]);

  // Overall counts
  const { totalPendingSteps, urgentCall, urgentItem } = useMemo(() => {
    let pendingCount = 0;
    let mostUrgentCall: CallRecord | null = null;
    let firstIncompleteItem: NextStepItem | null = null;

    for (const c of pendingCalls) {
      const items = getCallItems(c);
      const uncompleted = items.filter(i => !i.completed);
      pendingCount += uncompleted.length;

      if (!mostUrgentCall && uncompleted.length > 0) {
        mostUrgentCall = c;
        firstIncompleteItem = uncompleted[0];
      }
    }

    return {
      totalPendingSteps: pendingCount,
      urgentCall: mostUrgentCall,
      urgentItem: firstIncompleteItem
    };
  }, [pendingCalls]);

  // Check snooze expiry periodically
  useEffect(() => {
    if (!snoozeUntil) return;
    const interval = setInterval(() => {
      if (Date.now() >= snoozeUntil) {
        setSnoozeUntil(null);
        try {
          sessionStorage.removeItem('next_steps_snooze_until');
        } catch {
          // ignore
        }
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [snoozeUntil]);

  // Play subtle chime on first discovery of pending tasks
  useEffect(() => {
    if (pendingCalls.length > 0 && !hasPlayedSound.current && !snoozeUntil && !isDismissed && soundEnabled) {
      hasPlayedSound.current = true;
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          if (ctx.state === 'suspended') ctx.resume().catch(() => {});
          const now = ctx.currentTime;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(440, now); // A4
          osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.15); // E5
          gain.gain.setValueAtTime(0.08, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.35);
        }
      } catch {
        // audio policy fallback
      }
    }
  }, [pendingCalls.length, snoozeUntil, isDismissed, soundEnabled]);

  const handleSnooze = (minutes = 15) => {
    const until = Date.now() + minutes * 60 * 1000;
    setSnoozeUntil(until);
    try {
      sessionStorage.setItem('next_steps_snooze_until', until.toString());
    } catch {
      // ignore
    }
  };

  // If there are no pending calls, or snoozed, or user dismissed for this view
  if (pendingCalls.length === 0 || isDismissed) {
    return null;
  }

  // If currently snoozed
  if (snoozeUntil && Date.now() < snoozeUntil) {
    const remainingMin = Math.max(1, Math.ceil((snoozeUntil - Date.now()) / 60000));
    return (
      <div 
        className="fixed bottom-4 right-4 z-[9990] flex items-center gap-2 bg-slate-900/90 text-slate-300 backdrop-blur-md px-3 py-1.5 rounded-full shadow-lg border border-slate-700 text-xs"
        id="next-steps-snoozed-badge"
      >
        <BellOff className="w-3.5 h-3.5 text-amber-400" />
        <span>Напоминания приостановлены ({remainingMin} мин)</span>
        <button
          onClick={() => {
            setSnoozeUntil(null);
            try { sessionStorage.removeItem('next_steps_snooze_until'); } catch {}
          }}
          className="text-[11px] text-purple-300 hover:text-white underline ml-1 cursor-pointer"
        >
          Включить
        </button>
      </div>
    );
  }

  return (
    <div 
      className="fixed bottom-4 right-4 z-[9990] max-w-sm sm:max-w-md w-full pointer-events-auto"
      id="next-steps-floating-reminder"
      role="alert"
      aria-live="polite"
    >
      <AnimatePresence mode="wait">
        {isMinimized ? (
          /* Minimized Compact Floating Pill */
          <motion.div
            key="minimized-pill"
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            onClick={() => setIsMinimized(false)}
            className="cursor-pointer bg-gradient-to-r from-purple-950 via-slate-900 to-indigo-950 border border-purple-500/50 hover:border-purple-400 text-white p-3 rounded-2xl shadow-xl flex items-center justify-between gap-3 group transition-all"
          >
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-purple-500" />
              </span>
              <ListTodo className="w-4 h-4 text-purple-300" />
              <div className="text-xs font-semibold">
                <span>{pendingCalls.length} {pendingCalls.length === 1 ? 'звонок требует' : 'звонка требуют'} действий</span>
                <span className="text-purple-300 font-normal ml-1">({totalPendingSteps} задач)</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-purple-300 group-hover:text-white">
              <span className="text-[11px]">Развернуть</span>
              <ChevronUp className="w-3.5 h-3.5" />
            </div>
          </motion.div>
        ) : (
          /* Full Interactive Alert Card */
          <motion.div
            key="full-reminder-card"
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            className="bg-slate-900/95 backdrop-blur-md border border-purple-500/40 hover:border-purple-400 text-white rounded-2xl p-4 shadow-[0_12px_36px_rgba(147,51,234,0.35)] space-y-3 relative overflow-hidden"
          >
            {/* Ambient subtle glow */}
            <div className="absolute -top-12 -right-12 w-32 h-32 bg-purple-500/20 rounded-full blur-2xl pointer-events-none" />

            {/* Top row: Title, Counter Badges, Minimize, Close */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-purple-500/20 border border-purple-400/40 text-purple-300 flex items-center justify-center shrink-0">
                  <ListTodo className="w-4 h-4 text-purple-300" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>Напоминание: Next Steps</span>
                    <span className="bg-purple-500/30 text-purple-200 border border-purple-400/40 text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                      {pendingCalls.length} {pendingCalls.length === 1 ? 'звонок' : 'звонка'}
                    </span>
                  </h4>
                  <p className="text-[11px] text-purple-300/90 font-medium">
                    Осталось выполнить: <strong className="text-white">{totalPendingSteps}</strong> {totalPendingSteps === 1 ? 'шаг' : totalPendingSteps < 5 ? 'шага' : 'шагов'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setIsMinimized(true)}
                  className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                  title="Свернуть напоминание"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setIsDismissed(true)}
                  className="p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                  title="Закрыть"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Urgent Task Preview */}
            {urgentCall && urgentItem && (
              <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span className="flex items-center gap-1 font-semibold text-slate-200 truncate">
                    <User className="w-3 h-3 text-purple-400" />
                    {urgentCall.client_name || 'Клиент'}
                    {urgentCall.key_facts?.service && (
                      <span className="text-purple-300 font-normal">
                        ({urgentCall.key_facts.service})
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400 shrink-0">
                    {urgentCall.operator_name || 'Оператор'}
                  </span>
                </div>

                <div className="flex items-start gap-2 text-xs text-slate-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0 animate-pulse" />
                  <p className="line-clamp-2 leading-relaxed">
                    {urgentItem.text}
                  </p>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                onClick={() => {
                  onOpenTasksTab();
                }}
                className="flex-1 py-2 px-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>Открыть задачи ({pendingCalls.length})</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => handleSnooze(15)}
                className="py-2 px-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-medium transition-all flex items-center gap-1 cursor-pointer shrink-0"
                title="Напомнить через 15 минут"
              >
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>+15 мин</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
