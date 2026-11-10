/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  Search, Filter, AlertTriangle, CheckCircle, Clock, XCircle, 
  RefreshCw, Download, ExternalLink, Zap, ShieldCheck, X, 
  RotateCcw, Flame, CheckCircle2, Star, PhoneMissed, SlidersHorizontal,
  ChevronDown, ChevronUp, PhoneIncoming, PhoneOutgoing, Tag, Tags,
  Calendar, User, Smile, Frown, Meh, Award, FileText, FileSpreadsheet, Check
} from 'lucide-react';
import { CallRecord } from '../types.js';
import { getTagBadgeStyle } from './CallDetails.js';
import { deduplicateCalls } from '../services/callUtils.js';

interface CallListProps {
  calls: CallRecord[];
  selectedCallId: string | null;
  onSelectCall: (id: string) => void;
  onClearDemoCalls?: () => Promise<void>;
  userRole?: string;
}

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  missed: { label: 'Пропущен', className: 'bg-amber-50 text-amber-600 border-amber-200' },
  Cancel: { label: 'Отменен', className: 'bg-rose-50 text-rose-600 border-rose-200' },
  Busy: { label: 'Занято', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  NotAvailable: { label: 'Недоступен', className: 'bg-slate-100 text-slate-600 border-slate-300' },
  NotAllowed: { label: 'Запрещен', className: 'bg-red-50 text-red-600 border-red-200' },
  NotFound: { label: 'Не найден', className: 'bg-purple-50 text-purple-600 border-purple-200' }
};

export function getCallStarRating(score: number | null | undefined): number | null {
  if (score === null || score === undefined || isNaN(score)) return null;
  return Math.max(1, Math.min(5, Math.ceil(score / 2)));
}

export const POPULAR_KEYWORDS = [
  'Маникюр',
  'Педикюр',
  'Шеллак',
  'Запись',
  'Оплата',
  'Претензия',
  'Скидка',
  'Перенос',
  'Озон',
  'Консультация',
  'Отказ'
];

export function CallList({ calls, selectedCallId, onSelectCall, onClearDemoCalls, userRole }: CallListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  
  // Primary Filter Criteria: Date Range, Star Rating (1-5), and Keywords
  const [datePreset, setDatePreset] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [starFilter, setStarFilter] = useState<number | 'all' | 'none'>('all');
  const [starFilterMode, setStarFilterMode] = useState<'exact' | 'min'>('exact');
  const [keywordFilter, setKeywordFilter] = useState<string>('');

  // Additional Filter Criteria
  const [operatorFilter, setOperatorFilter] = useState<string>('all');
  const [scoreFilter, setScoreFilter] = useState<string>('all');
  const [toneFilter, setToneFilter] = useState<string>('all');

  // Secondary filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [modelFilter, setModelFilter] = useState<string>('all');
  const [disputeFilter, setDisputeFilter] = useState<string>('all');
  const [tagFilter, setTagFilter] = useState<string>('all');
  const [quickPreset, setQuickPreset] = useState<string>('all');

  // Panel state
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState<boolean>(true);
  const [isClearingDemo, setIsClearingDemo] = useState(false);

  // Export state for reports
  const [isExportMenuOpen, setIsExportMenuOpen] = useState<boolean>(false);
  const [exportingType, setExportingType] = useState<string | null>(null);
  const [exportSuccessMsg, setExportSuccessMsg] = useState<string | null>(null);
  const [exportErrorMsg, setExportErrorMsg] = useState<string | null>(null);

  // Clean deduplicated calls list
  const uniqueCalls = useMemo(() => {
    return deduplicateCalls(calls || []);
  }, [calls]);

  // Check if any demo calls exist
  const hasDemoCalls = useMemo(() => {
    return uniqueCalls.some(c => c.is_demo || c.call_id === 'megafon-call-89101' || c.call_id === 'megafon-call-89102');
  }, [uniqueCalls]);

  // Available unique operators with call count
  const availableOperators = useMemo(() => {
    const map = new Map<string, number>();
    uniqueCalls.forEach(c => {
      const op = (c.operator_name || '').trim();
      if (op) {
        map.set(op, (map.get(op) || 0) + 1);
      }
    });
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'));
  }, [uniqueCalls]);

  // Available unique tags across all calls
  const availableTags = useMemo(() => {
    const tagSet = new Set<string>();
    uniqueCalls.forEach(c => {
      if (Array.isArray(c.tags)) {
        c.tags.forEach(t => {
          if (t && typeof t === 'string' && t.trim()) {
            tagSet.add(t.trim());
          }
        });
      }
    });
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [uniqueCalls]);

  // Quick statistics calculation for preset chip badges
  const presetStats = useMemo(() => {
    let disputes = 0;
    let booked = 0;
    let declined = 0;
    let lowScore = 0;
    let topScore = 0;
    let missed = 0;
    let processing = 0;

    uniqueCalls.forEach(call => {
      if (call.key_facts?.is_dispute) disputes++;
      if (call.booking_status === 'согласие' || call.key_facts?.call_outcome === 'запись') booked++;
      if (call.booking_status === 'отказ' || call.key_facts?.call_outcome === 'отказ') declined++;
      if (call.operator_score !== null && call.operator_score !== undefined) {
        if (call.operator_score < 5) lowScore++;
        if (call.operator_score >= 8) topScore++;
      }
      if (call.status === 'missed') missed++;
      if (call.status === 'processing') processing++;
    });

    return { disputes, booked, declined, lowScore, topScore, missed, processing };
  }, [uniqueCalls]);

  // Star rating distribution calculation for counter badges (1-5 stars)
  const starDistribution = useMemo(() => {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let unrated = 0;
    uniqueCalls.forEach(call => {
      const star = getCallStarRating(call.operator_score);
      if (star !== null) {
        counts[star] = (counts[star] || 0) + 1;
      } else {
        unrated++;
      }
    });
    return { counts, unrated };
  }, [uniqueCalls]);

  // Date preset helper synchronizing preset with startDate/endDate
  const handleDatePresetChange = (preset: string) => {
    setDatePreset(preset);
    const now = new Date();
    const formatYmd = (dateObj: Date) => {
      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    if (preset === 'all') {
      setStartDate('');
      setEndDate('');
    } else if (preset === 'today') {
      const today = formatYmd(now);
      setStartDate(today);
      setEndDate(today);
    } else if (preset === 'yesterday') {
      const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      const yestStr = formatYmd(yesterday);
      setStartDate(yestStr);
      setEndDate(yestStr);
    } else if (preset === 'week') {
      const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      setStartDate(formatYmd(weekAgo));
      setEndDate(formatYmd(now));
    } else if (preset === 'month') {
      const monthAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
      setStartDate(formatYmd(monthAgo));
      setEndDate(formatYmd(now));
    }
  };

  // Tone matching logic helper
  const matchesTone = (call: CallRecord, toneChoice: string): boolean => {
    if (toneChoice === 'all') return true;
    const clientTone = (call.key_facts?.tone_client || '').toLowerCase().trim();
    const managerTone = (call.key_facts?.tone_manager || '').toLowerCase().trim();
    const combined = `${clientTone} ${managerTone}`;

    if (toneChoice === 'positive') {
      return combined.includes('позитив') || combined.includes('довол') || combined.includes('радост') || combined.includes('вежлив');
    }

    if (toneChoice === 'neutral') {
      return (combined.includes('нейтрал') || combined.includes('спокойн')) &&
             !combined.includes('негатив') && !combined.includes('недовол') && !combined.includes('агресс');
    }

    if (toneChoice === 'negative') {
      return combined.includes('негатив') ||
             combined.includes('недовол') ||
             combined.includes('агресс') ||
             combined.includes('раздраж') ||
             combined.includes('претензи') ||
             combined.includes('жалоб') ||
             Boolean(call.key_facts?.is_dispute);
    }

    return true;
  };

  // Date range matching logic helper (Samara/Moscow timezone friendly)
  const matchesDate = (timestamp: string): boolean => {
    if (datePreset === 'all' && !startDate && !endDate) return true;
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return true;

    if (startDate) {
      const start = new Date(`${startDate}T00:00:00`);
      if (d < start) return false;
    }
    if (endDate) {
      const end = new Date(`${endDate}T23:59:59.999`);
      if (d > end) return false;
    }
    return true;
  };

  // Main filter engine with deduplication protection
  const filteredCalls = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    const kw = keywordFilter.toLowerCase().trim();
    const seenIds = new Set<string>();

    return uniqueCalls.filter(call => {
      if (!call || !call.call_id) return false;
      if (seenIds.has(call.call_id)) return false;

      // Helper function to match text across all relevant call facts and content
      const matchesSearch = (query: string): boolean => {
        if (!query) return true;
        const q = query.toLowerCase().trim();
        if (!q) return true;

        const maskedPhone = (call.client_phone_masked || '').toLowerCase();
        const clientName = (call.client_name || '').toLowerCase();
        const operatorName = (call.operator_name || '').toLowerCase();
        const callId = (call.call_id || '').toLowerCase();
        const summary = (call.summary || '').toLowerCase();
        const transcript = (call.transcript || '').toLowerCase();
        const comment = (call.operator_comment || '').toLowerCase();
        const issue = (call.key_facts?.client_issue || '').toLowerCase();
        const disputeReason = (call.key_facts?.dispute_reason || '').toLowerCase();
        const service = (call.key_facts?.service || '').toLowerCase();
        const master = (call.key_facts?.master || '').toLowerCase();
        const appointmentDate = (call.key_facts?.appointment_date || '').toLowerCase();
        const appointmentTime = (call.key_facts?.appointment_time || '').toLowerCase();
        const triggerPhrases = Array.isArray(call.trigger_phrases) ? call.trigger_phrases.join(' ').toLowerCase() : '';
        const promises = Array.isArray(call.key_facts?.promises) ? call.key_facts.promises.join(' ').toLowerCase() : '';
        const nextSteps = Array.isArray(call.next_steps) ? call.next_steps.join(' ').toLowerCase() : '';
        const mistakes = Array.isArray(call.operator_mistakes) 
          ? call.operator_mistakes.join(' ').toLowerCase() 
          : (typeof call.operator_mistakes === 'string' ? (call.operator_mistakes as string).toLowerCase() : '');
        const recommendations = Array.isArray(call.operator_recommendations) 
          ? call.operator_recommendations.join(' ').toLowerCase() 
          : (typeof call.operator_recommendations === 'string' ? (call.operator_recommendations as string).toLowerCase() : '');
        const tagText = Array.isArray(call.tags) ? call.tags.join(' ').toLowerCase() : '';

        return (
          maskedPhone.includes(q) ||
          clientName.includes(q) ||
          operatorName.includes(q) ||
          callId.includes(q) ||
          summary.includes(q) ||
          transcript.includes(q) ||
          comment.includes(q) ||
          issue.includes(q) ||
          disputeReason.includes(q) ||
          service.includes(q) ||
          master.includes(q) ||
          appointmentDate.includes(q) ||
          appointmentTime.includes(q) ||
          triggerPhrases.includes(q) ||
          promises.includes(q) ||
          nextSteps.includes(q) ||
          mistakes.includes(q) ||
          recommendations.includes(q) ||
          tagText.includes(q)
        );
      };

      // 1. Keyword and Search Term Filtering
      if (term && !matchesSearch(term)) return false;
      if (kw && !matchesSearch(kw)) return false;

      // 2. Date Filter (Параметр: диапазон дат)
      if (!matchesDate(call.timestamp)) {
        return false;
      }

      // 3. 1-5 Star Rating Filter (Параметр: оценка 1-5 звезд)
      if (starFilter !== 'all') {
        const callStar = getCallStarRating(call.operator_score);
        if (starFilter === 'none') {
          if (callStar !== null) return false;
        } else {
          if (callStar === null) return false;
          if (starFilterMode === 'min') {
            if (callStar < (starFilter as number)) return false;
          } else {
            if (callStar !== starFilter) return false;
          }
        }
      }

      // 4. Operator Name Filter (Параметр: по имени оператора)
      if (operatorFilter !== 'all') {
        const op = (call.operator_name || '').trim().toLowerCase();
        if (op !== operatorFilter.trim().toLowerCase()) return false;
      }

      // 5. Raw AI Score Filter (Параметр: по оценке ИИ)
      if (scoreFilter !== 'all') {
        const score = call.operator_score;
        if (scoreFilter === 'high') {
          if (score === null || score === undefined || score < 8) return false;
        } else if (scoreFilter === 'medium') {
          if (score === null || score === undefined || score < 5 || score > 7) return false;
        } else if (scoreFilter === 'low') {
          if (score === null || score === undefined || score >= 5) return false;
        } else if (scoreFilter === 'none') {
          if (score !== null && score !== undefined) return false;
        }
      }

      // 6. Conversation Tone Filter (Параметр: по тональности разговора)
      if (!matchesTone(call, toneFilter)) {
        return false;
      }

      // 7. Quick preset filter
      if (quickPreset !== 'all') {
        if (quickPreset === 'disputes' && !call.key_facts?.is_dispute) return false;
        if (quickPreset === 'booked' && call.booking_status !== 'согласие' && call.key_facts?.call_outcome !== 'запись') return false;
        if (quickPreset === 'declined' && call.booking_status !== 'отказ' && call.key_facts?.call_outcome !== 'отказ') return false;
        if (quickPreset === 'low_score') {
          const sc = call.operator_score;
          if (sc === null || sc === undefined || sc >= 5) return false;
        }
        if (quickPreset === 'top_score') {
          const sc = call.operator_score;
          if (sc === null || sc === undefined || sc < 8) return false;
        }
        if (quickPreset === 'missed' && call.status !== 'missed') return false;
        if (quickPreset === 'processing' && call.status !== 'processing') return false;
      }

      // 8. Status filter (Анализ и статус записи)
      if (statusFilter !== 'all') {
        if (statusFilter === 'completed' && call.status !== 'completed') return false;
        if (statusFilter === 'processing' && call.status !== 'processing') return false;
        if (statusFilter === 'failed' && call.status !== 'failed') return false;
        if (statusFilter === 'missed' && call.status !== 'missed') return false;
        if (statusFilter === 'booked') {
          const isBooked = call.booking_status === 'согласие' || call.key_facts?.call_outcome === 'запись';
          if (!isBooked) return false;
        }
        if (statusFilter === 'declined') {
          const isDeclined = call.booking_status === 'отказ' || call.key_facts?.call_outcome === 'отказ';
          if (!isDeclined) return false;
        }
        if (statusFilter === 'consultation') {
          const isConsult = call.booking_status === 'консультация' || call.key_facts?.call_outcome === 'консультация';
          if (!isConsult) return false;
        }
      }

      // 9. Model filter
      if (modelFilter !== 'all') {
        if (call.model_used !== modelFilter) return false;
      }

      // 10. Dispute filter
      if (disputeFilter !== 'all') {
        if (disputeFilter === 'dispute' && !call.key_facts?.is_dispute) return false;
        if (disputeFilter === 'no_dispute' && call.key_facts?.is_dispute) return false;
      }

      // 11. Categorical Tag filter
      if (tagFilter !== 'all') {
        if (!Array.isArray(call.tags) || !call.tags.includes(tagFilter)) return false;
      }

      seenIds.add(call.call_id);
      return true;
    });
  }, [uniqueCalls, searchTerm, keywordFilter, datePreset, startDate, endDate, starFilter, starFilterMode, operatorFilter, scoreFilter, toneFilter, quickPreset, statusFilter, modelFilter, disputeFilter, tagFilter]);

  // Count active filters
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (searchTerm.trim() !== '') count++;
    if (keywordFilter.trim() !== '') count++;
    if (datePreset !== 'all' || startDate !== '' || endDate !== '') count++;
    if (starFilter !== 'all') count++;
    if (operatorFilter !== 'all') count++;
    if (scoreFilter !== 'all') count++;
    if (toneFilter !== 'all') count++;
    if (quickPreset !== 'all') count++;
    if (statusFilter !== 'all') count++;
    if (modelFilter !== 'all') count++;
    if (disputeFilter !== 'all') count++;
    if (tagFilter !== 'all') count++;
    return count;
  }, [searchTerm, keywordFilter, datePreset, startDate, endDate, starFilter, operatorFilter, scoreFilter, toneFilter, quickPreset, statusFilter, modelFilter, disputeFilter, tagFilter]);

  const resetAllFilters = () => {
    setSearchTerm('');
    setKeywordFilter('');
    setDatePreset('all');
    setStartDate('');
    setEndDate('');
    setStarFilter('all');
    setStarFilterMode('exact');
    setOperatorFilter('all');
    setScoreFilter('all');
    setToneFilter('all');
    setQuickPreset('all');
    setStatusFilter('all');
    setModelFilter('all');
    setDisputeFilter('all');
    setTagFilter('all');
  };

  const getScoreColor = (score: number | null | undefined) => {
    if (score === null || score === undefined) return 'bg-slate-100 text-slate-500 border-slate-200';
    if (score >= 8) return 'bg-emerald-100 text-emerald-800 border-emerald-300';
    if (score >= 5) return 'bg-amber-100 text-amber-800 border-amber-300';
    return 'bg-rose-100 text-rose-800 border-rose-300';
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleString('ru-RU', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Samara'
    });
  };

  const handleExportTable = async (format: 'pdf' | 'csv', scope: 'filtered' | 'all') => {
    const targetCalls = scope === 'filtered' ? filteredCalls : uniqueCalls;
    if (targetCalls.length === 0) {
      setExportErrorMsg('Выборка пуста — нет звонков для экспорта');
      return;
    }
    const stateKey = `${scope}-${format}`;
    setExportingType(stateKey);
    setExportErrorMsg(null);
    setExportSuccessMsg(null);

    try {
      const endpoint = format === 'pdf' ? '/api/calls/export-table-pdf' : '/api/calls/export-table-csv';
      const filterDesc = scope === 'filtered' && activeFiltersCount > 0
        ? `Выборка (${targetCalls.length} звонков из ${uniqueCalls.length})`
        : `Полный реестр (${targetCalls.length} звонков)`;

      const callIds = targetCalls.map(c => c.call_id);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          call_ids: scope === 'filtered' ? callIds : undefined,
          filterTitle: filterDesc,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Ошибка сервера при формировании ${format.toUpperCase()} (${response.status})`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateStr = new Date().toISOString().slice(0, 10);
      a.download = `Reestr_Zvonkov_${scope === 'filtered' ? 'vyborka' : 'vse'}_${dateStr}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setExportSuccessMsg(`Файл ${format.toUpperCase()} (${scope === 'filtered' ? 'выборка' : 'вся таблица'}) успешно сформирован`);
      setIsExportMenuOpen(false);
      setTimeout(() => setExportSuccessMsg(null), 4000);
    } catch (err: any) {
      setExportErrorMsg(err.message || 'Ошибка формирования отчета');
    } finally {
      setExportingType(null);
    }
  };

  const handleExportSelectedCall = async (format: 'pdf' | 'csv') => {
    if (!selectedCallId) return;
    const stateKey = `selected-${format}`;
    setExportingType(stateKey);
    setExportErrorMsg(null);
    setExportSuccessMsg(null);

    try {
      const endpoint = format === 'pdf'
        ? `/api/calls/${selectedCallId}/export-pdf`
        : `/api/calls/${selectedCallId}/export-csv`;

      const response = await fetch(endpoint);
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Ошибка сервера (${response.status})`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Otchet_${selectedCallId}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setExportSuccessMsg(`Отчет звонка #${selectedCallId.length > 8 ? selectedCallId.slice(-6) : selectedCallId} в ${format.toUpperCase()} успешно сохранен`);
      setIsExportMenuOpen(false);
      setTimeout(() => setExportSuccessMsg(null), 4000);
    } catch (err: any) {
      setExportErrorMsg(err.message || 'Ошибка выгрузки звонка');
    } finally {
      setExportingType(null);
    }
  };

  const selectedCallObj = useMemo(() => {
    if (!selectedCallId) return null;
    return uniqueCalls.find(c => c.call_id === selectedCallId) || null;
  }, [uniqueCalls, selectedCallId]);

  return (
    <div className="flex flex-col h-full bg-white border border-slate-100 rounded-2xl shadow-xs overflow-hidden" id="call-list-panel">
      {/* 1. Header with Title, Search bar, Filter Panel Toggle, and Export Menu */}
      <div className="p-4 border-b border-slate-100 bg-slate-50/50 space-y-3">
        <div className="flex justify-between items-center gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-800 tracking-tight">Журнал звонков</h2>
            <span className="text-xs bg-slate-200/70 text-slate-700 font-semibold px-2 py-0.5 rounded-full">
              {filteredCalls.length} из {calls.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Export Reports Dropdown Button & Menu */}
            <div className="relative">
              <button
                type="button"
                id="btn-export-reports-menu"
                onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                className={`text-xs px-2.5 py-1.5 rounded-xl border flex items-center gap-1.5 font-semibold transition-all cursor-pointer ${
                  isExportMenuOpen
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-3xs'
                    : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200 shadow-3xs'
                }`}
                title="Экспорт отчетов управляющего: вся таблица, текущая выборка или выбранный звонок (CSV / PDF)"
              >
                {exportingType ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                ) : (
                  <Download className="w-3.5 h-3.5 text-indigo-600" />
                )}
                <span>Экспорт</span>
                <ChevronDown className={`w-3.5 h-3.5 opacity-70 transition-transform ${isExportMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {isExportMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIsExportMenuOpen(false)}
                  />
                  <div
                    className="absolute right-0 mt-1.5 w-80 bg-white rounded-xl shadow-xl border border-slate-200 z-50 p-2.5 text-xs divide-y divide-slate-100 animate-in fade-in zoom-in-95 duration-100"
                    id="export-dropdown-menu"
                  >
                    {/* Header in menu */}
                    <div className="pb-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 flex items-center gap-1.5">
                          <Download className="w-3.5 h-3.5 text-indigo-600" /> Экспорт отчетов
                        </span>
                        <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded font-mono">
                          152-ФЗ
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">
                        Отчеты для управляющего с маскированием персональных данных
                      </p>
                    </div>

                    {/* Section 1: CSV Export (Excel) */}
                    <div className="py-2 space-y-1">
                      <div className="text-[10px] uppercase font-bold text-slate-400 px-1 tracking-wider flex items-center justify-between">
                        <span className="flex items-center gap-1">
                          <FileSpreadsheet className="w-3 h-3 text-emerald-600" /> Таблица в CSV (Excel)
                        </span>
                        <span className="text-slate-400 font-normal">разделитель ;</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleExportTable('csv', 'filtered')}
                        disabled={exportingType !== null || filteredCalls.length === 0}
                        id="export-filtered-csv-btn"
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-emerald-50 text-slate-700 hover:text-emerald-900 transition-colors flex items-center justify-between group disabled:opacity-50 cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          <div>
                            <div className="font-medium">Текущая выборка</div>
                            <div className="text-[10px] text-slate-400">С учетом всех активных фильтров</div>
                          </div>
                        </div>
                        <span className="font-semibold text-emerald-700 bg-emerald-100/60 px-1.5 py-0.5 rounded text-[10px]">
                          {exportingType === 'filtered-csv' ? '...' : `${filteredCalls.length} зв.`}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleExportTable('csv', 'all')}
                        disabled={exportingType !== null || uniqueCalls.length === 0}
                        id="export-all-csv-btn"
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-emerald-50 text-slate-700 hover:text-emerald-900 transition-colors flex items-center justify-between group disabled:opacity-50 cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-400 group-hover:bg-emerald-500" />
                          <div>
                            <div className="font-medium">Вся таблица</div>
                            <div className="text-[10px] text-slate-400">Полный реестр базы звонков</div>
                          </div>
                        </div>
                        <span className="font-semibold text-slate-600 group-hover:text-emerald-700 bg-slate-100 px-1.5 py-0.5 rounded text-[10px]">
                          {exportingType === 'all-csv' ? '...' : `${uniqueCalls.length} зв.`}
                        </span>
                      </button>
                    </div>

                    {/* Section 2: PDF Export (Executive Landscape A4) */}
                    <div className="py-2 space-y-1">
                      <div className="text-[10px] uppercase font-bold text-slate-400 px-1 tracking-wider flex items-center justify-between">
                        <span className="flex items-center gap-1">
                          <FileText className="w-3 h-3 text-rose-600" /> Сводный реестр в PDF
                        </span>
                        <span className="text-slate-400 font-normal">А4 альбомный</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleExportTable('pdf', 'filtered')}
                        disabled={exportingType !== null || filteredCalls.length === 0}
                        id="export-filtered-pdf-btn"
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-rose-50 text-slate-700 hover:text-rose-900 transition-colors flex items-center justify-between group disabled:opacity-50 cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                          <div>
                            <div className="font-medium">Реестр текущей выборки</div>
                            <div className="text-[10px] text-slate-400">Сводка KPI + журнал выборки</div>
                          </div>
                        </div>
                        <span className="font-semibold text-rose-700 bg-rose-100/60 px-1.5 py-0.5 rounded text-[10px]">
                          {exportingType === 'filtered-pdf' ? '...' : `${filteredCalls.length} зв.`}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleExportTable('pdf', 'all')}
                        disabled={exportingType !== null || uniqueCalls.length === 0}
                        id="export-all-pdf-btn"
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-rose-50 text-slate-700 hover:text-rose-900 transition-colors flex items-center justify-between group disabled:opacity-50 cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-400 group-hover:bg-rose-500" />
                          <div>
                            <div className="font-medium">Реестр всей базы</div>
                            <div className="text-[10px] text-slate-400">Полный отчет управляющего</div>
                          </div>
                        </div>
                        <span className="font-semibold text-slate-600 group-hover:text-rose-700 bg-slate-100 px-1.5 py-0.5 rounded text-[10px]">
                          {exportingType === 'all-pdf' ? '...' : `${uniqueCalls.length} зв.`}
                        </span>
                      </button>
                    </div>

                    {/* Section 3: Selected Call Export */}
                    <div className="pt-2 space-y-1">
                      <div className="text-[10px] uppercase font-bold text-slate-400 px-1 tracking-wider flex items-center justify-between">
                        <span>Выбранный звонок</span>
                        {selectedCallObj && (
                          <span className="font-mono text-indigo-600 font-bold">
                            #{selectedCallObj.call_id.length > 8 ? selectedCallObj.call_id.slice(-6) : selectedCallObj.call_id}
                          </span>
                        )}
                      </div>

                      {selectedCallObj ? (
                        <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                          <button
                            type="button"
                            onClick={() => handleExportSelectedCall('pdf')}
                            disabled={exportingType !== null}
                            id="export-selected-pdf-btn"
                            className="px-2 py-1.5 rounded-lg border border-slate-200 hover:border-rose-300 hover:bg-rose-50 text-slate-700 hover:text-rose-900 transition-colors flex items-center justify-center gap-1.5 font-medium cursor-pointer"
                            title="Аудит выбранного звонка в PDF с подписью управляющего"
                          >
                            <FileText className="w-3.5 h-3.5 text-rose-600" />
                            <span>{exportingType === 'selected-pdf' ? 'Создание...' : 'Аудит в PDF'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleExportSelectedCall('csv')}
                            disabled={exportingType !== null}
                            id="export-selected-csv-btn"
                            className="px-2 py-1.5 rounded-lg border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 text-slate-700 hover:text-emerald-900 transition-colors flex items-center justify-center gap-1.5 font-medium cursor-pointer"
                            title="Паспорт выбранного звонка в CSV формат (Excel)"
                          >
                            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                            <span>{exportingType === 'selected-csv' ? 'Создание...' : 'Паспорт в CSV'}</span>
                          </button>
                        </div>
                      ) : (
                        <p className="text-[10px] text-slate-400 px-1 py-1 italic">
                          Выберите звонок в списке для персональной выгрузки аудита
                        </p>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Filter Panel Toggle Button */}
            <button
              type="button"
              id="btn-toggle-filter-panel"
              onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
              className={`text-xs px-2.5 py-1.5 rounded-xl border flex items-center gap-1.5 font-semibold transition-all cursor-pointer ${
                isFilterPanelOpen
                  ? 'bg-slate-900 text-white border-slate-900 shadow-3xs'
                  : activeFiltersCount > 0
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-300'
                  : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200'
              }`}
              title={isFilterPanelOpen ? 'Скрыть панель фильтров' : 'Открыть панель фильтрации звонков'}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Фильтры</span>
              {activeFiltersCount > 0 && (
                <span className="text-[10px] bg-indigo-600 text-white font-bold px-1.5 py-0.2 rounded-full">
                  {activeFiltersCount}
                </span>
              )}
              {isFilterPanelOpen ? (
                <ChevronUp className="w-3.5 h-3.5 opacity-70" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 opacity-70" />
              )}
            </button>

            {activeFiltersCount > 0 && (
              <button
                type="button"
                onClick={resetAllFilters}
                id="btn-reset-filters-top"
                className="text-xs text-rose-600 hover:text-rose-800 font-medium inline-flex items-center gap-1 transition-colors cursor-pointer"
                title="Сбросить все активные фильтры"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Сбросить</span>
              </button>
            )}
          </div>
        </div>

        {/* Export Notification / Alert messages */}
        {exportSuccessMsg && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 flex items-center justify-between gap-2 text-xs text-emerald-900 animate-in fade-in duration-200">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{exportSuccessMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setExportSuccessMsg(null)}
              className="text-emerald-700 hover:text-emerald-900 p-0.5 rounded cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {exportErrorMsg && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-2.5 flex items-center justify-between gap-2 text-xs text-rose-900 animate-in fade-in duration-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{exportErrorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setExportErrorMsg(null)}
              className="text-rose-700 hover:text-rose-900 p-0.5 rounded cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Demo Calls Notice Banner */}
        {hasDemoCalls && (
          <div className="bg-amber-50 border border-amber-200/80 rounded-xl p-2.5 flex items-center justify-between gap-3 text-xs text-amber-900">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
              <span>
                <strong>Демо-режим:</strong> Отображаются демонстрационные примеры звонков (добавлены по умолчанию до настройки АТС).
              </span>
            </div>
            {onClearDemoCalls && (userRole === 'admin' || userRole === 'manager') && (
              <button
                type="button"
                disabled={isClearingDemo}
                onClick={async () => {
                  if (window.confirm('Удалить демонстрационные примеры звонков из журнала?')) {
                    setIsClearingDemo(true);
                    try {
                      await onClearDemoCalls();
                    } finally {
                      setIsClearingDemo(false);
                    }
                  }
                }}
                className="shrink-0 text-[11px] font-bold px-2.5 py-1 bg-amber-200/90 hover:bg-amber-300 text-amber-950 rounded-lg transition-colors cursor-pointer"
              >
                {isClearingDemo ? 'Удаление...' : 'Очистить демо'}
              </button>
            )}
          </div>
        )}
        
        {/* Search Input with quick clear */}
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            id="search-calls-input"
            type="text"
            placeholder="Поиск по ключевым словам: клиент, оператор, тема, резюме, транскрипт..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-9 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all placeholder:text-slate-400"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 p-0.5 rounded-full"
              title="Очистить поиск"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 2. Quick Presets Bar (Чипы быстрой фильтрации) */}
      <div className="px-3.5 py-2.5 border-b border-slate-100 bg-white overflow-x-auto scrollbar-none" id="quick-filter-chips">
        <div className="flex items-center gap-1.5 min-w-max">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1 flex items-center gap-1">
            <SlidersHorizontal className="w-3 h-3 text-slate-400" /> Быстро:
          </span>

          {/* Все звонки */}
          <button
            onClick={() => setQuickPreset('all')}
            className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1.5 border cursor-pointer ${
              quickPreset === 'all'
                ? 'bg-slate-900 text-white border-slate-900 shadow-3xs'
                : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border-slate-200/80'
            }`}
          >
            <span>Все</span>
            <span className={`text-[10px] px-1 py-0.2 rounded-full ${quickPreset === 'all' ? 'bg-slate-700 text-slate-200' : 'bg-slate-200/60 text-slate-600'}`}>
              {uniqueCalls.length}
            </span>
          </button>

          {/* Согласие / Запись */}
          <button
            onClick={() => setQuickPreset(quickPreset === 'booked' ? 'all' : 'booked')}
            className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1.5 border cursor-pointer ${
              quickPreset === 'booked'
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-3xs'
                : 'bg-emerald-50/70 text-emerald-800 hover:bg-emerald-100/70 border-emerald-200'
            }`}
          >
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            <span>Запись</span>
            <span className={`text-[10px] px-1 py-0.2 rounded-full ${quickPreset === 'booked' ? 'bg-emerald-800 text-emerald-100' : 'bg-emerald-100 text-emerald-800 font-bold'}`}>
              {presetStats.booked}
            </span>
          </button>

          {/* Отказ */}
          <button
            onClick={() => setQuickPreset(quickPreset === 'declined' ? 'all' : 'declined')}
            className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1.5 border cursor-pointer ${
              quickPreset === 'declined'
                ? 'bg-rose-600 text-white border-rose-600 shadow-3xs'
                : 'bg-rose-50/70 text-rose-800 hover:bg-rose-100/70 border-rose-200'
            }`}
          >
            <XCircle className="w-3 h-3 text-rose-600" />
            <span>Отказ</span>
            <span className={`text-[10px] px-1 py-0.2 rounded-full ${quickPreset === 'declined' ? 'bg-rose-800 text-rose-100' : 'bg-rose-100 text-rose-800 font-bold'}`}>
              {presetStats.declined}
            </span>
          </button>

          {/* Споры / Конфликты */}
          <button
            onClick={() => setQuickPreset(quickPreset === 'disputes' ? 'all' : 'disputes')}
            className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1.5 border cursor-pointer ${
              quickPreset === 'disputes'
                ? 'bg-amber-600 text-white border-amber-600 shadow-3xs'
                : 'bg-amber-50/70 text-amber-800 hover:bg-amber-100/70 border-amber-200'
            }`}
          >
            <Flame className="w-3 h-3 text-amber-600" />
            <span>Споры</span>
            <span className={`text-[10px] px-1 py-0.2 rounded-full ${quickPreset === 'disputes' ? 'bg-amber-800 text-amber-100' : 'bg-amber-100 text-amber-800 font-bold'}`}>
              {presetStats.disputes}
            </span>
          </button>

          {/* Низкая оценка (< 5) */}
          <button
            onClick={() => setQuickPreset(quickPreset === 'low_score' ? 'all' : 'low_score')}
            className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1.5 border cursor-pointer ${
              quickPreset === 'low_score'
                ? 'bg-red-600 text-white border-red-600 shadow-3xs'
                : 'bg-red-50/70 text-red-800 hover:bg-red-100/70 border-red-200'
            }`}
          >
            <AlertTriangle className="w-3 h-3 text-red-600" />
            <span>Балл &lt; 5</span>
            <span className={`text-[10px] px-1 py-0.2 rounded-full ${quickPreset === 'low_score' ? 'bg-red-800 text-red-100' : 'bg-red-100 text-red-800 font-bold'}`}>
              {presetStats.lowScore}
            </span>
          </button>

          {/* Высокая оценка (>= 8) */}
          <button
            onClick={() => setQuickPreset(quickPreset === 'top_score' ? 'all' : 'top_score')}
            className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1.5 border cursor-pointer ${
              quickPreset === 'top_score'
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-3xs'
                : 'bg-indigo-50/70 text-indigo-800 hover:bg-indigo-100/70 border-indigo-200'
            }`}
          >
            <Star className="w-3 h-3 text-indigo-600" />
            <span>Топ (8–10)</span>
            <span className={`text-[10px] px-1 py-0.2 rounded-full ${quickPreset === 'top_score' ? 'bg-indigo-800 text-indigo-100' : 'bg-indigo-100 text-indigo-800 font-bold'}`}>
              {presetStats.topScore}
            </span>
          </button>

          {/* Пропущенные */}
          {presetStats.missed > 0 && (
            <button
              onClick={() => setQuickPreset(quickPreset === 'missed' ? 'all' : 'missed')}
              className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1.5 border cursor-pointer ${
                quickPreset === 'missed'
                  ? 'bg-slate-700 text-white border-slate-700 shadow-3xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-200'
              }`}
            >
              <PhoneMissed className="w-3 h-3 text-slate-500" />
              <span>Пропущенные</span>
              <span className={`text-[10px] px-1 py-0.2 rounded-full ${quickPreset === 'missed' ? 'bg-slate-800 text-slate-200' : 'bg-slate-200 text-slate-700 font-bold'}`}>
                {presetStats.missed}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* 3. Dedicated Call Filtering Panel (Панель фильтрации звонков: диапазон дат, 1-5 звезд, ключевые слова + доп. параметры) */}
      {isFilterPanelOpen && (
        <div className="p-3.5 border-b border-slate-200/80 bg-linear-to-b from-slate-50/90 via-white to-slate-50/30 space-y-3" id="call-filter-panel">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 uppercase tracking-wider">
              <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-600" />
              <span>Панель фильтрации звонков</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-slate-500">
                Показано: <span className="font-bold text-slate-800">{filteredCalls.length}</span> из {uniqueCalls.length}
              </span>
              {activeFiltersCount > 0 && (
                <button
                  type="button"
                  onClick={resetAllFilters}
                  className="text-[11px] text-rose-600 hover:text-rose-800 font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                  title="Сбросить все примененные фильтры"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Сбросить всё</span>
                </button>
              )}
            </div>
          </div>

          {/* 3 Core Filter Cards: Date Range, 1-5 Star Rating, and Keywords */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {/* 1. ДИАПАЗОН ДАТ */}
            <div className={`p-2.5 rounded-xl border transition-all flex flex-col justify-between ${
              datePreset !== 'all' || startDate || endDate ? 'bg-indigo-50/30 border-indigo-200 shadow-3xs' : 'bg-white border-slate-200/80 shadow-3xs'
            }`} id="filter-date-card">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-indigo-600" />
                    <span>Диапазон дат</span>
                  </span>
                  {(datePreset !== 'all' || startDate || endDate) && (
                    <button
                      type="button"
                      onClick={() => handleDatePresetChange('all')}
                      className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold cursor-pointer"
                      title="Сбросить диапазон дат"
                    >
                      × Сброс
                    </button>
                  )}
                </div>

                {/* Quick Date Presets */}
                <div className="flex flex-wrap items-center gap-1 mb-2">
                  {[
                    { id: 'all', label: 'Все' },
                    { id: 'today', label: 'Сегодня' },
                    { id: 'yesterday', label: 'Вчера' },
                    { id: 'week', label: '7 дней' },
                    { id: 'month', label: '30 дней' },
                  ].map((preset) => {
                    const isSelected = datePreset === preset.id && !startDate && !endDate;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleDatePresetChange(preset.id)}
                        className={`text-[10px] px-2 py-0.5 rounded-md font-medium transition-all cursor-pointer border ${
                          isSelected
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-3xs font-semibold'
                            : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border-slate-200'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Date pickers (from - to) */}
              <div className="pt-1 border-t border-slate-100 flex items-center gap-1.5">
                <div className="flex-1">
                  <label htmlFor="filter-start-date" className="block text-[9px] text-slate-400 font-semibold mb-0.5 uppercase">С даты</label>
                  <input
                    id="filter-start-date"
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      setDatePreset('custom');
                    }}
                    className="w-full text-[11px] p-1 bg-white border border-slate-200 rounded-md text-slate-700 focus:outline-hidden focus:border-indigo-500"
                    title="Дата начала периода"
                  />
                </div>
                <span className="text-slate-400 text-xs mt-3">—</span>
                <div className="flex-1">
                  <label htmlFor="filter-end-date" className="block text-[9px] text-slate-400 font-semibold mb-0.5 uppercase">По дату</label>
                  <input
                    id="filter-end-date"
                    type="date"
                    value={endDate}
                    onChange={(e) => {
                      setEndDate(e.target.value);
                      setDatePreset('custom');
                    }}
                    className="w-full text-[11px] p-1 bg-white border border-slate-200 rounded-md text-slate-700 focus:outline-hidden focus:border-indigo-500"
                    title="Дата конца периода"
                  />
                </div>
              </div>
            </div>

            {/* 2. ОЦЕНКА (1-5 ЗВЕЗД) */}
            <div className={`p-2.5 rounded-xl border transition-all flex flex-col justify-between ${
              starFilter !== 'all' ? 'bg-amber-50/30 border-amber-200 shadow-3xs' : 'bg-white border-slate-200/80 shadow-3xs'
            }`} id="filter-stars-card">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                    <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                    <span>Оценка (1–5 звезд)</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    {/* Star Mode Toggle: Exact vs Minimum */}
                    <button
                      type="button"
                      onClick={() => setStarFilterMode(starFilterMode === 'exact' ? 'min' : 'exact')}
                      className={`text-[9px] px-1.5 py-0.5 rounded font-semibold transition-colors cursor-pointer border ${
                        starFilterMode === 'min'
                          ? 'bg-amber-100 text-amber-900 border-amber-300'
                          : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                      }`}
                      title={starFilterMode === 'exact' ? 'Режим: точное совпадение звезд (нажмите для режима «от N звезд»)' : 'Режим: от N звезд и выше (нажмите для точного совпадения)'}
                    >
                      {starFilterMode === 'exact' ? '= Точно' : '≥ От N зв.'}
                    </button>
                    {starFilter !== 'all' && (
                      <button
                        type="button"
                        onClick={() => setStarFilter('all')}
                        className="text-[10px] text-amber-600 hover:text-amber-800 font-bold cursor-pointer"
                        title="Сбросить фильтр оценки"
                      >
                        × Сброс
                      </button>
                    )}
                  </div>
                </div>

                {/* Star Rating Buttons (1 to 5 stars) */}
                <div className="grid grid-cols-5 gap-1 mb-1.5">
                  {[5, 4, 3, 2, 1].map((stars) => {
                    const isSelected = starFilter === stars;
                    const count = starDistribution.counts[stars] || 0;
                    return (
                      <button
                        key={stars}
                        type="button"
                        onClick={() => setStarFilter(isSelected ? 'all' : stars)}
                        className={`p-1 rounded-lg text-center border transition-all cursor-pointer flex flex-col items-center justify-center ${
                          isSelected
                            ? stars >= 4
                              ? 'bg-amber-500 text-white border-amber-500 shadow-3xs font-bold'
                              : stars === 3
                              ? 'bg-amber-600 text-white border-amber-600 shadow-3xs font-bold'
                              : 'bg-rose-500 text-white border-rose-500 shadow-3xs font-bold'
                            : 'bg-slate-50 hover:bg-amber-50 text-slate-700 border-slate-200/80'
                        }`}
                        title={`${stars} звезд(ы)${starFilterMode === 'min' ? ' и выше' : ''}: ${count} звонков`}
                      >
                        <div className="flex items-center gap-0.5 text-xs leading-none">
                          <span className="font-bold">{stars}</span>
                          <Star className={`w-2.5 h-2.5 ${isSelected ? 'fill-current text-white' : 'fill-amber-400 text-amber-500'}`} />
                        </div>
                        <span className={`text-[9px] mt-0.5 leading-none ${isSelected ? 'text-white/90' : 'text-slate-400'}`}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Unrated & All ratings quick links */}
              <div className="pt-1 border-t border-slate-100 flex items-center justify-between text-[10px]">
                <button
                  type="button"
                  onClick={() => setStarFilter(starFilter === 'none' ? 'all' : 'none')}
                  className={`px-2 py-0.5 rounded-md border transition-all cursor-pointer flex items-center gap-1 ${
                    starFilter === 'none'
                      ? 'bg-slate-800 text-white border-slate-800 font-semibold'
                      : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border-slate-200'
                  }`}
                  title="Звонки без выставленной оценки"
                >
                  <span>Без оценки</span>
                  <span className={`text-[9px] ${starFilter === 'none' ? 'text-slate-300' : 'text-slate-400'}`}>
                    ({starDistribution.unrated})
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setStarFilter('all')}
                  className={`px-2 py-0.5 rounded-md border transition-all cursor-pointer ${
                    starFilter === 'all'
                      ? 'bg-indigo-50 text-indigo-700 border-indigo-200 font-semibold'
                      : 'bg-white text-slate-500 hover:text-slate-800 border-slate-200'
                  }`}
                >
                  Все оценки
                </button>
              </div>
            </div>

            {/* 3. КЛЮЧЕВЫЕ СЛОВА */}
            <div className={`p-2.5 rounded-xl border transition-all flex flex-col justify-between ${
              keywordFilter || searchTerm ? 'bg-emerald-50/30 border-emerald-200 shadow-3xs' : 'bg-white border-slate-200/80 shadow-3xs'
            }`} id="filter-keywords-card">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                    <Search className="w-3 h-3 text-emerald-600" />
                    <span>Ключевые слова</span>
                  </span>
                  {(keywordFilter || searchTerm) && (
                    <button
                      type="button"
                      onClick={() => { setKeywordFilter(''); setSearchTerm(''); }}
                      className="text-[10px] text-emerald-600 hover:text-emerald-800 font-bold cursor-pointer"
                      title="Сбросить ключевые слова"
                    >
                      × Сброс
                    </button>
                  )}
                </div>

                {/* Keyword input */}
                <div className="relative mb-2">
                  <input
                    type="text"
                    value={keywordFilter}
                    onChange={(e) => setKeywordFilter(e.target.value)}
                    placeholder="Услуга, мастер, жалоба, оплата..."
                    className="w-full text-xs pr-6 pl-2 py-1 bg-white border border-slate-200 rounded-lg text-slate-700 placeholder:text-slate-400 focus:outline-hidden focus:border-emerald-500 transition-colors"
                  />
                  {keywordFilter && (
                    <button
                      type="button"
                      onClick={() => setKeywordFilter('')}
                      className="absolute right-1.5 top-1.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                      title="Очистить ключевое слово"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Popular Salon Keyword Chips */}
              <div>
                <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Быстрый выбор:
                </span>
                <div className="flex flex-wrap gap-1 max-h-14 overflow-y-auto pr-1">
                  {POPULAR_KEYWORDS.map((kw) => {
                    const isSelected = keywordFilter.toLowerCase() === kw.toLowerCase() || searchTerm.toLowerCase() === kw.toLowerCase();
                    return (
                      <button
                        key={kw}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            setKeywordFilter('');
                            if (searchTerm.toLowerCase() === kw.toLowerCase()) setSearchTerm('');
                          } else {
                            setKeywordFilter(kw);
                          }
                        }}
                        className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-3xs font-semibold'
                            : 'bg-slate-50 text-slate-600 hover:bg-emerald-50 hover:text-emerald-800 border-slate-200'
                        }`}
                      >
                        {kw}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Secondary Filter Row: Operator, Tone, Booking/Call Status, Tag */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 border-t border-slate-100">
            {/* Operator */}
            <div>
              <label htmlFor="filter-operator-select" className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                👤 Оператор
              </label>
              <select
                id="filter-operator-select"
                value={operatorFilter}
                onChange={(e) => setOperatorFilter(e.target.value)}
                className={`w-full text-xs rounded-lg p-1.5 focus:outline-hidden transition-colors font-medium border ${
                  operatorFilter !== 'all' ? 'bg-blue-50 border-blue-300 text-blue-950 font-semibold' : 'bg-white border-slate-200 text-slate-700'
                }`}
              >
                <option value="all">Все операторы ({availableOperators.length})</option>
                {availableOperators.map((op) => (
                  <option key={op.name} value={op.name}>
                    {op.name} ({op.count})
                  </option>
                ))}
              </select>
            </div>

            {/* Conversation Tone */}
            <div>
              <label htmlFor="filter-tone-select" className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                💬 Тональность
              </label>
              <select
                id="filter-tone-select"
                value={toneFilter}
                onChange={(e) => setToneFilter(e.target.value)}
                className={`w-full text-xs rounded-lg p-1.5 focus:outline-hidden transition-colors font-medium border ${
                  toneFilter !== 'all' ? 'bg-emerald-50 border-emerald-300 text-emerald-950 font-semibold' : 'bg-white border-slate-200 text-slate-700'
                }`}
              >
                <option value="all">Все тональности</option>
                <option value="positive">🟢 Позитивная</option>
                <option value="neutral">🟡 Нейтральная</option>
                <option value="negative">🔴 Негативная / Жалоба</option>
              </select>
            </div>

            {/* Status */}
            <div>
              <label htmlFor="filter-status-select" className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                📋 Итог / Статус
              </label>
              <select
                id="filter-status-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className={`w-full text-xs rounded-lg p-1.5 focus:outline-hidden transition-colors font-medium border ${
                  statusFilter !== 'all' ? 'bg-indigo-50 border-indigo-300 text-indigo-950 font-semibold' : 'bg-white border-slate-200 text-slate-700'
                }`}
              >
                <option value="all">Все статусы</option>
                <option value="booked">✓ Запись (согласие)</option>
                <option value="declined">✗ Отказ от записи</option>
                <option value="consultation">ℹ Консультация</option>
                <option value="missed">📞 Пропущенный</option>
                <option value="completed">✓ Обработан</option>
                <option value="processing">⏳ В обработке</option>
              </select>
            </div>

            {/* Tags */}
            <div>
              <label htmlFor="filter-tag-select" className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                🏷️ Тег категории
              </label>
              <select
                id="filter-tag-select"
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
                className={`w-full text-xs rounded-lg p-1.5 focus:outline-hidden transition-colors font-medium border ${
                  tagFilter !== 'all' ? 'bg-indigo-50 border-indigo-300 text-indigo-950 font-semibold' : 'bg-white border-slate-200 text-slate-700'
                }`}
              >
                <option value="all">Все теги ({availableTags.length})</option>
                {availableTags.map((tag) => (
                  <option key={tag} value={tag}>#{tag}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 4. Active Criteria Tags & One-Click Dismiss */}
          {activeFiltersCount > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-200/80">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">
                Активно ({activeFiltersCount}):
              </span>

              {/* Date active tag */}
              {(datePreset !== 'all' || startDate || endDate) && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-indigo-50 text-indigo-800 border border-indigo-200 px-2 py-0.5 rounded-lg shadow-3xs">
                  <Calendar className="w-2.5 h-2.5" />
                  <span>
                    Дата: {datePreset === 'today' ? 'Сегодня' : datePreset === 'yesterday' ? 'Вчера' : datePreset === 'week' ? '7 дней' : datePreset === 'month' ? '30 дней' : `${startDate || '...'} — ${endDate || '...'}`}
                  </span>
                  <button type="button" onClick={() => handleDatePresetChange('all')} className="hover:opacity-70 ml-0.5 cursor-pointer">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              {/* Star Rating active tag */}
              {starFilter !== 'all' && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-lg shadow-3xs">
                  <Star className="w-2.5 h-2.5 fill-amber-500 text-amber-500" />
                  <span>
                    {starFilter === 'none' ? 'Без оценки' : `Оценка: ${starFilterMode === 'min' ? '≥ ' : ''}${starFilter} ★`}
                  </span>
                  <button type="button" onClick={() => setStarFilter('all')} className="hover:opacity-70 ml-0.5 cursor-pointer">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              {/* Keyword active tag */}
              {keywordFilter && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-lg shadow-3xs">
                  <Search className="w-2.5 h-2.5" />
                  <span>Ключ: «{keywordFilter}»</span>
                  <button type="button" onClick={() => setKeywordFilter('')} className="hover:opacity-70 ml-0.5 cursor-pointer">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              {/* General Search term active tag */}
              {searchTerm.trim() && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-slate-100 text-slate-800 border border-slate-300 px-2 py-0.5 rounded-lg shadow-3xs">
                  <Search className="w-2.5 h-2.5" />
                  <span>Поиск: «{searchTerm}»</span>
                  <button type="button" onClick={() => setSearchTerm('')} className="hover:opacity-70 ml-0.5 cursor-pointer">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              {/* Operator active tag */}
              {operatorFilter !== 'all' && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-blue-50 text-blue-800 border border-blue-200 px-2 py-0.5 rounded-lg shadow-3xs">
                  <User className="w-2.5 h-2.5" />
                  <span>Оператор: {operatorFilter}</span>
                  <button type="button" onClick={() => setOperatorFilter('all')} className="hover:opacity-70 ml-0.5 cursor-pointer">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              {/* Tone active tag */}
              {toneFilter !== 'all' && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-lg shadow-3xs">
                  <Smile className="w-2.5 h-2.5" />
                  <span>
                    Тон: {toneFilter === 'positive' ? 'Позитивный' : toneFilter === 'neutral' ? 'Нейтральный' : 'Негативный'}
                  </span>
                  <button type="button" onClick={() => setToneFilter('all')} className="hover:opacity-70 ml-0.5 cursor-pointer">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              {/* Status active tag */}
              {statusFilter !== 'all' && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-slate-100 text-slate-800 border border-slate-300 px-2 py-0.5 rounded-lg shadow-3xs">
                  <span>Статус: {statusFilter}</span>
                  <button type="button" onClick={() => setStatusFilter('all')} className="hover:opacity-70 ml-0.5 cursor-pointer">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              {/* Tag active tag */}
              {tagFilter !== 'all' && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-indigo-50 text-indigo-800 border border-indigo-200 px-2 py-0.5 rounded-lg shadow-3xs">
                  <Tag className="w-2.5 h-2.5" />
                  <span>#{tagFilter}</span>
                  <button type="button" onClick={() => setTagFilter('all')} className="hover:opacity-70 ml-0.5 cursor-pointer">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              <button
                type="button"
                onClick={resetAllFilters}
                className="text-[11px] text-rose-600 hover:text-rose-800 font-bold ml-auto hover:underline cursor-pointer flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Очистить всё</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* 5. Call Cards Container */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100" id="call-cards-scroll-container">
        {filteredCalls.length === 0 ? (
          <div className="p-10 text-center flex flex-col items-center justify-center space-y-3" id="empty-call-list-state">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
              <Filter className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-700">Ничего не найдено</p>
              <p className="text-xs text-slate-400 mt-1 max-w-[280px]">
                По выбранным параметрам фильтрации записей нет. Попробуйте изменить или сбросить фильтры.
              </p>
            </div>
            {activeFiltersCount > 0 && (
              <button
                onClick={resetAllFilters}
                className="mt-2 text-xs font-semibold px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 rounded-lg inline-flex items-center gap-1.5 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Сбросить все фильтры</span>
              </button>
            )}
          </div>
        ) : (
          filteredCalls.map((call, idx) => {
            const isSelected = call.call_id === selectedCallId;
            const displayName = call.client_phone_masked || call.client_name || 'Неизвестный клиент';

            return (
              <div
                key={`${call.call_id}-${idx}`}
                id={`call-card-${call.call_id}`}
                onClick={() => onSelectCall(call.call_id)}
                className={`p-4 cursor-pointer text-left transition-all duration-150 relative border-l-3 ${
                  isSelected 
                    ? 'bg-emerald-50/50 border-l-emerald-600 shadow-2xs' 
                    : 'hover:bg-slate-50 border-l-transparent'
                }`}
              >
                <div className="flex justify-between items-start mb-1.5">
                  <div className="space-y-0.5 w-[70%]">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-mono font-medium text-slate-400 uppercase">
                        {call.call_id.substring(0, 14)}
                      </span>
                      {(call.is_demo || call.call_id.startsWith('megafon-call-8910')) && (
                        <span className="text-[9px] font-bold text-amber-800 bg-amber-100 border border-amber-300 px-1.5 py-0.2 rounded" title="Демонстрационный пример звонка">
                          Демо-образец
                        </span>
                      )}
                      {call.consent_status === 'active' && (
                        <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1 py-0.2 rounded flex items-center gap-0.5">
                          <ShieldCheck className="w-2.5 h-2.5" /> 152-ФЗ
                        </span>
                      )}
                      {call.key_facts?.is_dispute && (
                        <span className="text-[9px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1 py-0.2 rounded flex items-center gap-0.5" title="Зафиксирован конфликт/спор">
                          <AlertTriangle className="w-2.5 h-2.5 text-rose-600" /> Спор
                        </span>
                      )}
                      {call.audio_deleted && (
                        <span className="text-[9px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1 py-0.2 rounded">
                          TTL audio
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-semibold text-slate-800 leading-tight flex items-center gap-1.5">
                      {call.type === 'outgoing' ? (
                        <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-1 py-0.5 rounded border border-blue-200/50 uppercase shrink-0 inline-flex items-center gap-0.5" title="Исходящий звонок">
                          <PhoneOutgoing className="w-2.5 h-2.5" /> Исх
                        </span>
                      ) : (
                        <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1 py-0.5 rounded border border-emerald-200/50 uppercase shrink-0 inline-flex items-center gap-0.5" title="Входящий звонок">
                          <PhoneIncoming className="w-2.5 h-2.5" /> Вх
                        </span>
                      )}
                      <span className="truncate">{displayName}</span>
                      {call.operator_name && (
                        <span className="text-[11px] font-normal text-slate-500 truncate" title={`Оператор: ${call.operator_name}`}>
                          ↔ {call.operator_name}
                        </span>
                      )}
                    </h3>
                  </div>
                  
                  {call.status === 'processing' ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700 animate-pulse flex items-center gap-1 shrink-0">
                      <RefreshCw className="w-2.5 h-2.5 animate-spin" /> Анализ...
                    </span>
                  ) : call.status === 'failed' ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700 flex items-center gap-1 shrink-0">
                      <XCircle className="w-2.5 h-2.5" /> Сбой
                    </span>
                  ) : STATUS_BADGES[call.status] ? (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border shrink-0 ${STATUS_BADGES[call.status].className}`} id={`status-badge-${call.status}-${call.call_id}`}>
                      {STATUS_BADGES[call.status].label}
                    </span>
                  ) : (
                    <span className={`text-xs px-2.5 py-0.5 rounded-full border font-bold shrink-0 ${getScoreColor(call.operator_score)}`}>
                      {call.operator_score !== null && call.operator_score !== undefined ? `${call.operator_score}/10` : '—'}
                    </span>
                  )}
                </div>

                <div className="text-xs text-slate-500 line-clamp-2 mb-2">
                  {call.summary || call.transcript || 'Загрузка...'}
                </div>

                {/* Categorical Tags Badges in Call Card */}
                {call.tags && call.tags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 mb-2.5">
                    {call.tags.map((tag) => (
                      <span
                        key={tag}
                        className={`text-[9px] px-1.5 py-0.5 rounded-md font-semibold border flex items-center gap-0.5 shadow-3xs ${getTagBadgeStyle(tag)}`}
                      >
                        <Tag className="w-2.5 h-2.5 opacity-70" />
                        <span>{tag}</span>
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex justify-between items-center text-[11px] text-slate-400">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {formatDuration(call.duration_seconds)}
                    </span>
                    <span className="font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60 px-1.5 py-0.2 rounded-sm text-[10px]">
                      {call.model_used || 'GigaChat:Lite'}
                    </span>
                    {(call.booking_status || call.key_facts?.booking_status) && (
                      <span className={`font-semibold px-1.5 py-0.2 rounded-sm text-[10px] border ${
                        (call.booking_status || call.key_facts?.booking_status) === 'согласие'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : (call.booking_status || call.key_facts?.booking_status) === 'отказ'
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : 'bg-slate-50 text-slate-600 border-slate-200'
                      }`}>
                        {(call.booking_status || call.key_facts?.booking_status) === 'согласие' ? 'Запись: да' :
                         (call.booking_status || call.key_facts?.booking_status) === 'отказ' ? 'Отказ' :
                         (call.booking_status || call.key_facts?.booking_status)}
                      </span>
                    )}
                    {/* Tone Badge */}
                    {call.key_facts?.tone_client && (
                      <span className={`font-semibold px-1.5 py-0.2 rounded-sm text-[10px] border flex items-center gap-0.5 ${
                        (call.key_facts.tone_client.toLowerCase().includes('позитив') || call.key_facts.tone_client.toLowerCase().includes('довол'))
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : (call.key_facts.tone_client.toLowerCase().includes('негатив') || call.key_facts.tone_client.toLowerCase().includes('недовол') || call.key_facts.is_dispute)
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : 'bg-slate-50 text-slate-600 border-slate-200'
                      }`} title={`Тональность: ${call.key_facts.tone_client}`}>
                        {(call.key_facts.tone_client.toLowerCase().includes('позитив') || call.key_facts.tone_client.toLowerCase().includes('довол')) ? (
                          <Smile className="w-2.5 h-2.5 text-emerald-600" />
                        ) : (call.key_facts.tone_client.toLowerCase().includes('негатив') || call.key_facts.tone_client.toLowerCase().includes('недовол') || call.key_facts.is_dispute) ? (
                          <Frown className="w-2.5 h-2.5 text-rose-600" />
                        ) : (
                          <Meh className="w-2.5 h-2.5 text-slate-400" />
                        )}
                        <span className="capitalize">{call.key_facts.tone_client}</span>
                      </span>
                    )}
                  </div>
                  <span>{formatDate(call.timestamp)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
