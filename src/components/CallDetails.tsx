/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { 
  AlertTriangle, Check, ShieldAlert, Star, 
  ThumbsUp, Volume2, MessageSquare, 
  MessageCircle, Database, Download, ExternalLink, Zap,
  ShieldCheck, Lock, Clock, Mic, FileText, FileSpreadsheet, Smartphone, HeartHandshake,
  CheckCircle2, XCircle, HelpCircle, Tag, Tags, Plus, X, Bookmark, Trash2,
  Scissors, Calendar, UserCheck, Sparkles, ListTodo, CheckSquare, Square, Copy, ArrowRight,
  MessageSquareQuote, Send, Target, Banknote, CalendarClock, ArrowRightCircle,
  Award, Gauge, BarChart3, Filter, CheckCheck, MinusCircle, ChevronDown, ChevronUp, Info, Sparkle, RefreshCw
} from 'lucide-react';
import { CallRecord, NextStepItem, ContextClarification, StructuredCallSummary, CallEvaluation, CallEvaluationCriterion } from '../types.js';
import { ReanalyzeButton } from './ReanalyzeButton.js';
import { refineTranscriptRoles } from '../services/transcriptUtils.js';
import { extractStructuredCallSummary } from '../services/summaryUtils.js';
import { extractCallEvaluation, EVALUATION_CRITERIA_DEFINITIONS, harmonizeMistakesAndEvaluation } from '../services/evaluationUtils.js';

interface CallDetailsProps {
  call: CallRecord;
  onSendVk: (id: string) => Promise<{ success: boolean; error?: string }>;
  onSendYclients: (id: string) => Promise<boolean>;
  onReanalyze?: (id: string) => Promise<boolean>;
  onCallUpdated?: (updated: CallRecord) => void;
  onDeleteCall?: (id: string) => Promise<void>;
  userRole?: string;
}

const PRESET_TAGS = [
  { name: 'Запись', color: 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100' },
  { name: 'Продажа', color: 'bg-blue-50 text-blue-800 border-blue-300 hover:bg-blue-100' },
  { name: 'Жалоба', color: 'bg-rose-50 text-rose-800 border-rose-300 hover:bg-rose-100' },
  { name: 'Конфликт', color: 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100' },
  { name: 'VIP-клиент', color: 'bg-purple-50 text-purple-800 border-purple-300 hover:bg-purple-100' },
  { name: 'Перезвонить', color: 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100' },
  { name: 'Консультация', color: 'bg-sky-50 text-sky-800 border-sky-300 hover:bg-sky-100' },
  { name: 'Спам', color: 'bg-slate-100 text-slate-800 border-slate-300 hover:bg-slate-200' },
  { name: 'Срочно', color: 'bg-red-50 text-red-800 border-red-300 hover:bg-red-100' },
];

export function getTagBadgeStyle(tag: string) {
  const lower = tag.toLowerCase();
  if (lower.includes('жалоб') || lower.includes('конфликт') || lower.includes('претензи') || lower.includes('срочн') || lower.includes('отказ')) {
    return 'bg-rose-50 text-rose-700 border-rose-200';
  }
  if (lower.includes('запис') || lower.includes('соглас') || lower.includes('успешн')) {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }
  if (lower.includes('продаж') || lower.includes('сертификат') || lower.includes('допродаж')) {
    return 'bg-blue-50 text-blue-700 border-blue-200';
  }
  if (lower.includes('vip') || lower.includes('вип') || lower.includes('лояльн') || lower.includes('постоян')) {
    return 'bg-purple-50 text-purple-700 border-purple-200';
  }
  if (lower.includes('перезвон') || lower.includes('уточн') || lower.includes('в работ')) {
    return 'bg-amber-50 text-amber-700 border-amber-200';
  }
  if (lower.includes('спам') || lower.includes('ошиб')) {
    return 'bg-slate-100 text-slate-700 border-slate-300';
  }
  return 'bg-indigo-50 text-indigo-700 border-indigo-200';
}

export function CallDetails({ 
  call, 
  onSendVk, 
  onSendYclients, 
  onReanalyze,
  onCallUpdated,
  onDeleteCall,
  userRole = 'admin',
}: CallDetailsProps) {
  const [sendingVk, setSendingVk] = useState(false);
  const [sentVk, setSentVk] = useState(false);
  const [sendingYc, setSendingYc] = useState(false);
  const [sentYc, setSentYc] = useState(false);
  const [vkError, setVkError] = useState<string | null>(null);
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'csv' | null>(null);
  const [exportSuccessFormat, setExportSuccessFormat] = useState<'pdf' | 'csv' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Next Steps AI state
  const [generatingNextSteps, setGeneratingNextSteps] = useState(false);
  const [nextStepsError, setNextStepsError] = useState<string | null>(null);
  const [nextStepsSuccess, setNextStepsSuccess] = useState<string | null>(null);
  const [copiedSteps, setCopiedSteps] = useState(false);
  const [newStepInput, setNewStepInput] = useState('');
  const [isAddingStep, setIsAddingStep] = useState(false);

  // Состояние фильтрации по 10 критериям оценки
  const [criteriaFilter, setCriteriaFilter] = useState<'all' | 'applicable' | 'not_applicable' | 'low'>('all');
  const [criteriaSearch, setCriteriaSearch] = useState('');
  const [expandedCriteriaId, setExpandedCriteriaId] = useState<string | null>(null);

  // Состояние аудиоплеера
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioReloadKey, setAudioReloadKey] = useState(0);

  useEffect(() => {
    setAudioError(null);
    setAudioReloadKey(0);
  }, [call.call_id, call.audio_url]);

  const proxiedAudioSrc = useMemo(() => {
    if (!call.audio_url) return '';
    if (
      call.audio_url.startsWith('data:') ||
      call.audio_url.startsWith('blob:') ||
      call.audio_url.startsWith('/api/')
    ) {
      return call.audio_url;
    }
    const base = `/api/megafon-ats/record-proxy?url=${encodeURIComponent(call.audio_url)}&callId=${encodeURIComponent(call.call_id)}`;
    return audioReloadKey > 0 ? `${base}&r=${audioReloadKey}` : base;
  }, [call.audio_url, call.call_id, audioReloadKey]);

  // Оценка звонка по 10 критериям (валидируется на противоречия и факты стенограммы)
  const callEvaluation = useMemo<CallEvaluation>(() => {
    const existingEval =
      call.evaluation && Array.isArray(call.evaluation.criteria) && call.evaluation.criteria.length >= 10
        ? call.evaluation
        : call.criteria_scores && Array.isArray(call.criteria_scores) && call.criteria_scores.length >= 10
        ? { criteria: call.criteria_scores }
        : call.key_facts?.evaluation && Array.isArray(call.key_facts.evaluation.criteria) && call.key_facts.evaluation.criteria.length >= 10
        ? call.key_facts.evaluation
        : call.evaluation || null;

    return extractCallEvaluation(
      call.transcript || '',
      call.summary || '',
      existingEval,
      call.operator_score,
      call.operator_mistakes,
      Array.isArray(call.recommendations) ? call.recommendations : [call.recommendations].filter(Boolean) as string[]
    );
  }, [call]);

  const filteredCriteria = useMemo(() => {
    let list = callEvaluation.criteria;
    if (criteriaFilter === 'applicable') {
      list = list.filter(c => c.is_applicable !== false && c.score !== null);
    } else if (criteriaFilter === 'not_applicable') {
      list = list.filter(c => c.is_applicable === false || c.score === null);
    } else if (criteriaFilter === 'low') {
      list = list.filter(c => c.is_applicable !== false && c.score !== null && c.score < 7);
    }
    if (criteriaSearch.trim()) {
      const q = criteriaSearch.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.explanation.toLowerCase().includes(q));
    }
    return list;
  }, [callEvaluation, criteriaFilter, criteriaSearch]);

  // Извлечение параметров сути обращения (услуга, дата, время, мастер)
  const essence = useMemo(() => {
    const kf = (call.key_facts || {}) as any;
    let service = kf.service || null;
    let date = kf.date || null;
    let time = kf.time || null;
    let master = kf.master || null;

    const summary = call.summary || '';
    if (!service) {
      const m = summary.match(/(?:услуга|процедура)\s*[—–:\-]\s*([^,\n;.]+)/i);
      if (m && !m[1].toLowerCase().includes('не указан')) service = m[1].trim();
    }
    if (!date) {
      const m = summary.match(/дата\s*[—–:\-]\s*([^,\n;.]+)/i);
      if (m && !m[1].toLowerCase().includes('не указан')) date = m[1].trim();
    }
    if (!time) {
      const m = summary.match(/время\s*[—–:\-]\s*([^,\n;.]+)/i);
      if (m && !m[1].toLowerCase().includes('не указан')) time = m[1].trim();
    }
    if (!master) {
      const m = summary.match(/мастер\s*[—–:\-]\s*([^,\n;.]+)/i);
      if (m && !m[1].toLowerCase().includes('не выбран')) master = m[1].trim();
    }

    return { service, date, time, master };
  }, [call]);

  // Разделение резюме на 4 блока:
  // 1) суть обращения; 2) пересказ диалога (2-4 предложения); 3) выводы; 4) разбор работы менеджера (оценка, ошибки, советы по оптимизации)
  const summaryParts = useMemo(() => {
    const summary = (call.summary || '').trim();
    if (!summary) {
      return {
        essence: '',
        retelling: '',
        conclusion: '',
        managerEvaluation: '',
        mistakes: [] as string[],
        advice: [] as string[],
        score: call.operator_score ?? null,
        hasEvaluation: false,
        raw: 'Резюме не сформировано'
      };
    }

    // 1. Попытка выделить 4-й блок: разбор работы менеджера
    const managerMatch = summary.match(
      /(?:разбор работы менеджера(?:\s*\([^)]*\))?|оценка и разбор работы менеджера|разбор работы оператора)\s*:\s*([\s\S]*)$/i
    );
    const summaryClean = summary
      .replace(/(?:разбор работы менеджера(?:\s*\([^)]*\))?|оценка и разбор работы менеджера|разбор работы оператора)\s*:[\s\S]*$/i, '')
      .trim();

    const regex = /суть обращения\s*:\s*([\s\S]*?)(?:(?:пересказ диалога|краткий пересказ(?: разговора)?|пересказ разговора)\s*:\s*([\s\S]*?))?(?:вывод\s*:\s*([\s\S]*))?$/i;
    const match = summaryClean.match(regex);

    let essence = '';
    let retelling = '';
    let conclusion = '';

    if (match) {
      essence = match[1]?.trim() || '';
      retelling = match[2]?.trim() || '';
      conclusion = match[3]?.trim() || '';
    } else {
      conclusion = summaryClean;
    }

    // Извлечение оценки
    let score: number | null = typeof call.operator_score === 'number' ? call.operator_score : null;
    const scoreMatch = summary.match(/оценка\s*(\d{1,2})\s*\/\s*10/i);
    if (score === null && scoreMatch) {
      score = parseInt(scoreMatch[1], 10);
    }

    // Извлечение конкретных ошибок
    let mistakes: string[] = [];
    if (Array.isArray(call.operator_mistakes) && call.operator_mistakes.length > 0) {
      mistakes = call.operator_mistakes.map(m => String(m).trim()).filter(Boolean);
    } else if (managerMatch) {
      const mistakesSubMatch = managerMatch[1].match(
        /(?:ошибки и недочеты|ошибки|недочеты)\s*:\s*([\s\S]*?)(?=(?:советы по оптимизации|советы|рекомендации)\s*:|$)/i
      );
      if (mistakesSubMatch) {
        const raw = mistakesSubMatch[1].trim();
        const split = raw
          .split(/(?:^|\n)\s*[-•*0-9.)]+\s*/g)
          .map(s => s.trim().replace(/^;\s*/, ''))
          .filter(s => s.length > 3);
        mistakes = split.length > 0 ? split : [raw];
      }
    }

    // Извлечение советов по оптимизации
    let advice: string[] = [];
    const rawRecs: unknown = call.recommendations;
    if (Array.isArray(rawRecs) && rawRecs.length > 0) {
      advice = rawRecs.map(r => String(r).trim()).filter(Boolean);
    } else if (typeof rawRecs === 'string' && (rawRecs as string).trim().length > 0) {
      advice = [(rawRecs as string).trim()];
    } else if (managerMatch) {
      const adviceSubMatch = managerMatch[1].match(
        /(?:советы по оптимизации|советы|рекомендации)\s*:\s*([\s\S]*)$/i
      );
      if (adviceSubMatch) {
        const raw = adviceSubMatch[1].trim();
        const split = raw
          .split(/(?:^|\n)\s*[-•*0-9.)]+\s*/g)
          .map(s => s.trim().replace(/^;\s*/, ''))
          .filter(s => s.length > 3);
        advice = split.length > 0 ? split : [raw];
      }
    }

    // Синхронизация ошибок и советов с оценкой по 10 критериям
    const harmonized = harmonizeMistakesAndEvaluation(mistakes, advice, callEvaluation, call.transcript);
    mistakes = harmonized.mistakes;
    advice = harmonized.advice;

    const hasEvaluation = Boolean(
      managerMatch ||
      (score !== null && score !== undefined) ||
      mistakes.length > 0 ||
      advice.length > 0
    );

    const computedStructured = extractStructuredCallSummary(
      call.transcript || '',
      summary,
      call.key_facts,
      undefined,
      call.booking_status
    );
    const savedStructured = call.structured_summary || call.key_facts?.structured_summary;
    const savedStepsStr = Array.isArray(savedStructured?.manager_next_steps)
      ? savedStructured.manager_next_steps.join(' ').toLowerCase()
      : '';
    const savedBookedLower = String(savedStructured?.booking_status_text || '').toLowerCase();
    const computedBookedLower = String(computedStructured.booking_status_text || '').toLowerCase();
    const isSavedStructuredStale =
      !savedStructured ||
      (computedBookedLower.includes('запись состоялась') && !savedBookedLower.includes('запись состоялась')) ||
      ((savedStepsStr.includes('консультац') || savedStepsStr.includes('прайс-лист') || savedStepsStr.includes('онлайн-запись')) &&
        !computedStructured.manager_next_steps.join(' ').toLowerCase().includes('прайс-лист'));

    const structured: StructuredCallSummary = isSavedStructuredStale ? computedStructured : savedStructured;

    return {
      essence,
      structured,
      retelling,
      conclusion,
      managerEvaluation: managerMatch ? managerMatch[1].trim() : '',
      mistakes,
      advice,
      score,
      hasEvaluation,
      raw: summary
    };
  }, [call, callEvaluation]);

  // Categorical Tag Management State
  const [customTagInput, setCustomTagInput] = useState('');
  const [isTagSubmitting, setIsTagSubmitting] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);

  const handleAddTag = async (tagToAdd: string) => {
    const clean = tagToAdd.trim().replace(/^#/, '');
    if (!clean) return;
    const currentTags = call.tags || [];
    if (currentTags.includes(clean)) return;

    setIsTagSubmitting(true);
    setTagError(null);
    try {
      const response = await fetch(`/api/calls/${call.call_id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: clean }),
      });
      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        throw new Error(errJson?.error || 'Не удалось сохранить тег');
      }
      const data = await response.json();
      const updatedCall: CallRecord = {
        ...call,
        tags: data.tags || [...currentTags, clean],
      };
      if (onCallUpdated) onCallUpdated(updatedCall);
      setCustomTagInput('');
    } catch (err: any) {
      console.error('Ошибка добавления тега:', err);
      setTagError(err.message || 'Ошибка добавления тега');
      setTimeout(() => setTagError(null), 4000);
    } finally {
      setIsTagSubmitting(false);
    }
  };

  const handleRemoveTag = async (tagToRemove: string) => {
    setIsTagSubmitting(true);
    setTagError(null);
    try {
      const response = await fetch(`/api/calls/${call.call_id}/tags/${encodeURIComponent(tagToRemove)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        throw new Error(errJson?.error || 'Не удалось удалить тег');
      }
      const data = await response.json();
      const updatedCall: CallRecord = {
        ...call,
        tags: data.tags || (call.tags || []).filter(t => t !== tagToRemove),
      };
      if (onCallUpdated) onCallUpdated(updatedCall);
    } catch (err: any) {
      console.error('Ошибка удаления тега:', err);
      setTagError(err.message || 'Ошибка удаления тега');
      setTimeout(() => setTagError(null), 4000);
    } finally {
      setIsTagSubmitting(false);
    }
  };

  // Clarify Context State (Yandex.GPT)
  const [clarifyQuestion, setClarifyQuestion] = useState('');
  const [isClarifying, setIsClarifying] = useState(false);
  const [clarifyError, setClarifyError] = useState<string | null>(null);
  const [copiedClarifyId, setCopiedClarifyId] = useState<string | null>(null);

  React.useEffect(() => {
    setVkError(null);
    setExportError(null);
    setTagError(null);
    setNextStepsError(null);
    setNextStepsSuccess(null);
    setCopiedSteps(false);
    setIsAddingStep(false);
    setNewStepInput('');
    setClarifyError(null);
    setClarifyQuestion('');
    setCopiedClarifyId(null);
  }, [call.call_id]);

  const handleClarifyContext = async (questionToAsk?: string) => {
    const q = (questionToAsk || clarifyQuestion).trim();
    if (!q || isClarifying) return;

    setIsClarifying(true);
    setClarifyError(null);
    try {
      const res = await fetch(`/api/calls/${call.call_id}/clarify-context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Ошибка сервера (${res.status})`);
      }
      const data = await res.json();
      if (onCallUpdated && data.call) {
        onCallUpdated(data.call);
      }
      setClarifyQuestion('');
    } catch (err: any) {
      setClarifyError(err.message || 'Не удалось получить ответ от GigaChat');
    } finally {
      setIsClarifying(false);
    }
  };

  const scrollToClarify = () => {
    const el = document.getElementById('clarify-context-ai-container');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => {
        const input = document.getElementById('clarify-context-question-input');
        if (input) input.focus();
      }, 250);
    }
  };

  const currentNextStepsItems = useMemo<NextStepItem[]>(() => {
    if (call.next_steps_items && call.next_steps_items.length > 0) {
      return call.next_steps_items;
    }
    if (call.next_steps && call.next_steps.length > 0) {
      return call.next_steps.map((text, idx) => ({
        id: `step-${idx + 1}`,
        text,
        completed: false,
      }));
    }
    return [];
  }, [call.next_steps_items, call.next_steps]);

  const completedCount = useMemo(() => {
    return currentNextStepsItems.filter(i => i.completed).length;
  }, [currentNextStepsItems]);

  const handleGenerateNextSteps = async () => {
    setGeneratingNextSteps(true);
    setNextStepsError(null);
    setNextStepsSuccess(null);
    try {
      const res = await fetch(`/api/calls/${call.call_id}/generate-next-steps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Ошибка сервера (${res.status})`);
      }
      const data = await res.json();
      if (onCallUpdated && data.call) {
        onCallUpdated(data.call);
      }
      setNextStepsSuccess(`Сформировано ${data.next_steps?.length || 0} задач Next Steps`);
      setTimeout(() => setNextStepsSuccess(null), 4000);
    } catch (err: any) {
      setNextStepsError(err.message || 'Не удалось сформировать следующие шаги');
      setTimeout(() => setNextStepsError(null), 6000);
    } finally {
      setGeneratingNextSteps(false);
    }
  };

  const handleToggleStep = async (stepId: string) => {
    const updatedItems = currentNextStepsItems.map(item =>
      item.id === stepId ? { ...item, completed: !item.completed } : item
    );
    if (onCallUpdated) {
      onCallUpdated({
        ...call,
        next_steps_items: updatedItems,
        next_steps: updatedItems.map(i => i.text),
      });
    }

    try {
      await fetch(`/api/calls/${call.call_id}/next-steps`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ next_steps_items: updatedItems }),
      });
    } catch (err) {
      console.error('Ошибка сохранения статуса задачи:', err);
    }
  };

  const handleAddNewStep = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newStepInput.trim()) return;

    const newItem: NextStepItem = {
      id: `manual-${Date.now()}`,
      text: newStepInput.trim(),
      completed: false,
    };
    const updatedItems = [...currentNextStepsItems, newItem];
    setNewStepInput('');
    setIsAddingStep(false);

    if (onCallUpdated) {
      onCallUpdated({
        ...call,
        next_steps_items: updatedItems,
        next_steps: updatedItems.map(i => i.text),
      });
    }

    try {
      await fetch(`/api/calls/${call.call_id}/next-steps`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ next_steps_items: updatedItems }),
      });
    } catch (err) {
      console.error('Ошибка добавления задачи:', err);
    }
  };

  const handleDeleteStep = async (stepId: string) => {
    const updatedItems = currentNextStepsItems.filter(item => item.id !== stepId);
    if (onCallUpdated) {
      onCallUpdated({
        ...call,
        next_steps_items: updatedItems,
        next_steps: updatedItems.map(i => i.text),
      });
    }

    try {
      await fetch(`/api/calls/${call.call_id}/next-steps`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ next_steps_items: updatedItems }),
      });
    } catch (err) {
      console.error('Ошибка удаления задачи:', err);
    }
  };

  const handleCopySteps = () => {
    if (currentNextStepsItems.length === 0) return;
    const textToCopy = currentNextStepsItems
      .map((item, idx) => `${idx + 1}. [${item.completed ? 'X' : ' '}] ${item.text}`)
      .join('\n');
    navigator.clipboard.writeText(textToCopy);
    setCopiedSteps(true);
    setTimeout(() => setCopiedSteps(false), 2500);
  };

  const handleExport = async (format: 'pdf' | 'csv') => {
    setExportingFormat(format);
    setExportError(null);
    try {
      const endpoint = format === 'pdf' 
        ? `/api/calls/${call.call_id}/export-pdf`
        : `/api/calls/${call.call_id}/export-csv`;
      const response = await fetch(endpoint);
      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        throw new Error(errJson?.error || `Сбой сервера при формировании ${format.toUpperCase()} (${response.status})`);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Otchet_Audita_${call.call_id}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setExportSuccessFormat(format);
      setTimeout(() => setExportSuccessFormat(null), 3000);
    } catch (err: any) {
      console.error(`Ошибка экспорта ${format}:`, err);
      setExportError(err.message || `Не удалось сформировать ${format.toUpperCase()}-отчет`);
      setTimeout(() => setExportError(null), 6000);
    } finally {
      setExportingFormat(null);
    }
  };

  const handleVk = async () => {
    setSendingVk(true);
    setVkError(null);
    const result = await onSendVk(call.call_id);
    setSendingVk(false);
    if (result.success) {
      setSentVk(true);
      setTimeout(() => setSentVk(false), 3000);
    } else {
      setVkError(result.error || 'Произошла ошибка при отправке в VK');
    }
  };

  const handleYc = async () => {
    setSendingYc(true);
    const success = await onSendYclients(call.call_id);
    setSendingYc(false);
    if (success) {
      setSentYc(true);
      setTimeout(() => setSentYc(false), 3000);
    }
  };

  const getScoreColor = (score: number | null | undefined) => {
    if (score === null || score === undefined) return 'text-slate-500 bg-slate-50 border-slate-200';
    if (score >= 8) return 'text-green-600 bg-green-50 border-green-200';
    if (score >= 5) return 'text-amber-600 bg-amber-50 border-amber-200';
    return 'text-red-600 bg-red-50 border-red-200';
  };

  const getOutcomeColor = (outcome: string) => {
    const o = (outcome || '').toLowerCase();
    if (o === 'запись' || o === 'успешно') return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    if (o === 'консультация' || o === 'перезвон' || o === 'перенесён') return 'bg-blue-50 text-blue-800 border-blue-200';
    if (o === 'отказ' || o === 'отмена') return 'bg-amber-50 text-amber-800 border-amber-200';
    if (o === 'автоответчик') return 'bg-slate-100 text-slate-700 border-slate-200';
    return 'bg-red-50 text-red-800 border-red-200';
  };

  // Считывание статуса записи из нового JSON-поля анализа ИИ (call.booking_status / call.key_facts?.booking_status)
  const bookingStatusRaw = useMemo(() => {
    const direct = (call.booking_status || call.key_facts?.booking_status || '').toLowerCase().trim();
    if (direct) return direct;
    const outcome = (call.key_facts?.call_outcome || '').toLowerCase().trim();
    if (outcome === 'запись') return 'согласие';
    if (outcome === 'отказ') return 'отказ';
    if (outcome === 'автоответчик') return 'не применимо';
    return '';
  }, [call.booking_status, call.key_facts]);

  const bookingStatusConfig = useMemo(() => {
    if (!bookingStatusRaw) return null;

    if (bookingStatusRaw === 'согласие' || bookingStatusRaw.includes('соглас')) {
      return {
        type: 'consent' as const,
        label: 'Согласие на запись',
        badgeText: '✓ Согласие на запись',
        shortText: 'Согласие',
        badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-300 ring-1 ring-emerald-500/20 shadow-3xs',
        solidClass: 'bg-emerald-600 text-white',
        icon: CheckCircle2,
        desc: 'Клиент согласился на предложенное время, запись подтверждена'
      };
    }

    if (bookingStatusRaw === 'отказ' || bookingStatusRaw.includes('отказ')) {
      return {
        type: 'decline' as const,
        label: 'Отказ от записи',
        badgeText: '✗ Отказ от записи',
        shortText: 'Отказ',
        badgeClass: 'bg-rose-50 text-rose-800 border-rose-300 ring-1 ring-rose-500/20 shadow-3xs',
        solidClass: 'bg-rose-600 text-white',
        icon: XCircle,
        desc: 'Клиент отказался от предложенных вариантов записи'
      };
    }

    if (bookingStatusRaw === 'не применимо') {
      return {
        type: 'na' as const,
        label: 'Запись: Не применимо',
        badgeText: '— Не применимо',
        shortText: 'Н/Д',
        badgeClass: 'bg-slate-100 text-slate-700 border-slate-300 shadow-3xs',
        solidClass: 'bg-slate-500 text-white',
        icon: HelpCircle,
        desc: 'Разговор не состоялся / автоответчик / короткий вызов'
      };
    }

    return {
      type: 'consult' as const,
      label: 'Консультация (без записи)',
      badgeText: 'ℹ Консультация',
      shortText: 'Консультация',
      badgeClass: 'bg-sky-50 text-sky-800 border-sky-300 ring-1 ring-sky-500/20 shadow-3xs',
      solidClass: 'bg-sky-600 text-white',
      icon: HelpCircle,
      desc: 'Справочный диалог без фиксации слота записи'
    };
  }, [bookingStatusRaw]);

  const parsedTranscriptLines = useMemo(() => {
    if (!call.transcript) return [];
    const refined = refineTranscriptRoles(call.transcript);
    const lines = refined.split('\n').filter(line => line.trim().length > 0);

    const clean: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const textOnly = line
        .replace(/^(Менеджер:|Клиент:|Администратор:|Оператор:|Автоинформатор:|Неизвестный:)\s*/i, '')
        .trim()
        .toLowerCase();

      if (clean.length > 0) {
        const prevText = clean[clean.length - 1]
          .replace(/^(Менеджер:|Клиент:|Администратор:|Оператор:|Автоинформатор:|Неизвестный:)\s*/i, '')
          .trim()
          .toLowerCase();

        // Если фраза идентична предыдущей (эхо двух каналов), пропускаем дубликат
        if (textOnly === prevText && textOnly.length > 0) {
          continue;
        }
      }
      clean.push(line);
    }
    return clean;
  }, [call.transcript]);

  const STATUS_DETAILS: Record<string, { title: string; badge: string; desc: string; colorClass: string }> = {
    missed: {
      title: 'Пропущенный звонок',
      badge: 'Пропущенный звонок',
      desc: 'Вызов не был принят оператором, либо исходящий звонок остался без ответа. Запись разговора и стенограмма отсутствуют.',
      colorClass: 'bg-amber-50 text-amber-700 border-amber-200'
    },
    Cancel: {
      title: 'Звонок отменен',
      badge: 'Звонок отменен',
      desc: 'Входящий или исходящий звонок был отменен одной из сторон до установки соединения.',
      colorClass: 'bg-rose-50 text-rose-700 border-rose-200'
    },
    Busy: {
      title: 'Линия занята',
      badge: 'Ответ «Занято»',
      desc: 'Вызываемый абонент занят другим разговором.',
      colorClass: 'bg-amber-50 text-amber-700 border-amber-200'
    },
    NotAvailable: {
      title: 'Абонент недоступен',
      badge: 'Недоступен',
      desc: 'Телефон клиента выключен или находится вне зоны действия сети.',
      colorClass: 'bg-slate-50 text-slate-700 border-slate-200'
    },
    NotAllowed: {
      title: 'Звонки запрещены',
      badge: 'Запрещено',
      desc: 'Направление вызова заблокировано правилами маршрутизации АТС.',
      colorClass: 'bg-red-50 text-red-700 border-red-200'
    },
    NotFound: {
      title: 'Абонент не найден',
      badge: 'Не найден',
      desc: 'Номер не существует в сети оператора связи.',
      colorClass: 'bg-purple-50 text-purple-700 border-purple-200'
    }
  };

  const isUnsuccessful = call.status !== 'completed' && STATUS_DETAILS[call.status];

  if (isUnsuccessful) {
    const details = STATUS_DETAILS[call.status];
    return (
      <div className="bg-white border border-slate-100 rounded-2xl shadow-xs overflow-hidden flex flex-col h-full text-left" id="call-details-panel">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono font-medium text-slate-400 uppercase tracking-wide">
                {call.call_id}
              </span>
              <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider border ${details.colorClass}`}>
                {details.badge}
              </span>
              <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                152-ФЗ: Н/Д (Звонок не состоялся)
              </span>
              {call.tags && call.tags.length > 0 && call.tags.map((tag) => (
                <span
                  key={tag}
                  className={`text-[11px] px-2 py-0.5 rounded-full font-semibold border inline-flex items-center gap-1 shadow-3xs ${getTagBadgeStyle(tag)}`}
                >
                  <Tag className="w-3 h-3 opacity-70" />
                  <span>{tag}</span>
                </span>
              ))}
            </div>
            <h1 className="text-lg font-bold text-slate-800">
              {call.client_phone_masked || call.client_name || 'Клиент'} ↔ {call.operator_name || 'Оператор'}
            </h1>
          </div>

          <div className="text-xs text-slate-500 font-medium">
            {new Date(call.timestamp).toLocaleString('ru-RU', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Europe/Samara'
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8 flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-6">
          <div className={`p-4 rounded-full border shadow-xs animate-pulse ${details.colorClass}`}>
            <Volume2 className="w-10 h-10" />
          </div>

          <div className="space-y-2">
            <h2 className="text-base font-bold text-slate-800">
              {details.title}
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed font-normal">
              {details.desc}
            </p>
          </div>

          <div className="w-full bg-slate-50 rounded-2xl p-5 border border-slate-100/80 text-left space-y-4">
            <div>
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Рекомендация для администратора</span>
              <ul className="space-y-2">
                {call.recommendations && call.recommendations.length > 0 ? (
                  call.recommendations.map((rec, idx) => (
                    <li key={idx} className="text-xs text-slate-700 flex items-start gap-2 leading-relaxed">
                      <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0 text-[10px] mt-0.5">!</span>
                      <span>{rec}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-xs text-slate-500">Рекомендаций нет</li>
                )}
              </ul>
            </div>

            {/* Quick Tagging for Unsuccessful Calls */}
            <div className="pt-3 border-t border-slate-200/60">
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Теги вызова:</span>
              <div className="flex flex-wrap gap-1.5 mb-2.5">
                {call.tags && call.tags.length > 0 ? (
                  call.tags.map((tag) => (
                    <span
                      key={tag}
                      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md border ${getTagBadgeStyle(tag)}`}
                    >
                      <span>{tag}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        disabled={isTagSubmitting}
                        className="hover:opacity-70 p-0.5"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))
                ) : (
                  <span className="text-[11px] text-slate-400 italic">Теги не установлены</span>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {['Перезвонить', 'Спам', 'Жалоба', 'Срочно'].map((preset) => {
                  const hasTag = call.tags?.includes(preset);
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => hasTag ? handleRemoveTag(preset) : handleAddTag(preset)}
                      disabled={isTagSubmitting}
                      className={`text-[11px] font-medium px-2 py-0.5 rounded-md border transition-all ${
                        hasTag ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200'
                      }`}
                    >
                      {hasTag ? `✓ ${preset}` : `+ ${preset}`}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-100 rounded-2xl shadow-xs overflow-hidden flex flex-col h-full text-left" id="call-details-panel">
      {/* Detail Header */}
      <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <span className="text-xs font-mono font-medium text-slate-400 uppercase tracking-wide">
              {call.call_id}
            </span>

            {(call.is_demo || call.call_id.startsWith('megafon-call-8910')) && (
              <span className="text-[11px] bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-0.5 rounded-full font-bold">
                Демо-образец
              </span>
            )}

            {/* Model Badge */}
            <span className="text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-semibold">
              {call.model_used || 'GigaChat:Lite'}
            </span>

            {/* Visual Indicator (Badge) статуса записи из JSON-анализа ИИ */}
            {bookingStatusConfig && (
              <span 
                id={`booking-status-badge-${call.call_id}`}
                className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold inline-flex items-center gap-1 border transition-all ${bookingStatusConfig.badgeClass}`}
                title={`Результат анализа ИИ: ${bookingStatusConfig.desc}`}
              >
                <bookingStatusConfig.icon className="w-3.5 h-3.5 shrink-0" />
                <span>{bookingStatusConfig.label}</span>
              </span>
            )}

            {/* 152-FZ Consent Pill */}
            {call.consent_status === 'active' ? (
              <span className="text-[11px] bg-emerald-100 text-emerald-900 border border-emerald-300 px-2 py-0.5 rounded-full font-semibold inline-flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-700" /> Согласие 152-ФЗ активно
              </span>
            ) : call.consent_status === 'revoked' ? (
              <span className="text-[11px] bg-rose-100 text-rose-800 border border-rose-200 px-2 py-0.5 rounded-full font-semibold">
                Согласие отозвано
              </span>
            ) : (
              <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                Н/Д
              </span>
            )}

            {/* Loyalty indicator */}
            {call.consent_purposes?.includes('loyalty_program') && (
              <span className="text-[11px] bg-pink-50 text-pink-700 border border-pink-200 px-2 py-0.5 rounded-full font-semibold inline-flex items-center gap-0.5">
                <HeartHandshake className="w-3 h-3" /> Программа лояльности
              </span>
            )}

            {/* Token count */}
            <span className="text-[11px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-mono font-medium inline-flex items-center gap-1">
              <Zap className="w-3 h-3 text-amber-500" />
              {(call.tokens_used?.total_tokens || 1200).toLocaleString('ru-RU')} токенов
            </span>

            {/* Manager Tags Badges in Header */}
            {call.tags && call.tags.length > 0 && call.tags.map((tag) => (
              <span
                key={tag}
                className={`text-[11px] px-2 py-0.5 rounded-full font-semibold border inline-flex items-center gap-1 shadow-3xs ${getTagBadgeStyle(tag)}`}
                title={`Тег менеджера: ${tag}`}
              >
                <Tag className="w-3 h-3 opacity-70" />
                <span>{tag}</span>
              </span>
            ))}
          </div>

          <h1 className="text-lg font-bold text-slate-800">
            {call.client_phone_masked || call.client_name || 'Клиент'} ↔ {call.operator_name || 'Оператор'}
          </h1>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          {/* GigaChat Reanalyze Button with Model Dropdown */}
          <ReanalyzeButton
            callId={call.call_id}
            currentModel={call.model_used}
            onReanalyzed={(updated) => {
              if (onCallUpdated) onCallUpdated(updated);
            }}
            userRole={userRole}
          />

          {/* AI Next Steps Toolbar Button */}
          <button
            onClick={handleGenerateNextSteps}
            disabled={generatingNextSteps || !call.transcript}
            id="btn-generate-next-steps"
            className={`text-xs font-semibold px-3.5 py-1.5 rounded-lg border flex items-center gap-1.5 transition-all cursor-pointer ${
              generatingNextSteps
                ? 'bg-purple-100 text-purple-800 border-purple-300 animate-pulse'
                : currentNextStepsItems.length > 0
                ? 'bg-purple-50 hover:bg-purple-100 text-purple-800 border-purple-200'
                : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white border-transparent shadow-xs'
            }`}
            title="Использовать ИИ для формирования отдельного списка 'Next Steps' (следующих шагов) для администратора"
          >
            <Sparkles className={`w-3.5 h-3.5 ${generatingNextSteps ? 'animate-spin text-purple-600' : currentNextStepsItems.length > 0 ? 'text-purple-600' : 'text-purple-200'}`} />
            <span>
              {generatingNextSteps
                ? 'Генерация Next Steps...'
                : currentNextStepsItems.length > 0
                ? `Next Steps (${completedCount}/${currentNextStepsItems.length})`
                : 'Next Steps (ИИ)'}
            </span>
          </button>

          {/* Clarify Context with GigaChat Button */}
          <button
            onClick={scrollToClarify}
            disabled={!call.transcript}
            id="btn-clarify-context-gigachat"
            className={`text-xs font-semibold px-3.5 py-1.5 rounded-lg border flex items-center gap-1.5 transition-all cursor-pointer shadow-3xs ${
              isClarifying
                ? 'bg-rose-100 text-rose-800 border-rose-300 animate-pulse'
                : call.context_clarifications && call.context_clarifications.length > 0
                ? 'bg-rose-50 hover:bg-rose-100 text-rose-900 border-rose-200'
                : 'bg-gradient-to-r from-rose-50 via-white to-amber-50 hover:bg-rose-100 text-rose-900 border-rose-200'
            }`}
            title="Отправить дополнительный вопрос по конкретному звонку в GigaChat для получения уточненной выжимки или проверки фактов"
          >
            <MessageSquareQuote className="w-3.5 h-3.5 text-rose-600" />
            <span>Уточнить контекст у ИИ</span>
            {call.context_clarifications && call.context_clarifications.length > 0 && (
              <span className="text-[10px] bg-rose-200/80 text-rose-900 font-bold px-1.5 py-0.2 rounded-full border border-rose-300">
                {call.context_clarifications.length}
              </span>
            )}
          </button>

          <button
            onClick={handleVk}
            disabled={sendingVk || call.status !== 'completed'}
            className={`text-xs font-medium px-3.5 py-1.5 rounded-lg border flex items-center gap-1.5 transition-all ${
              sentVk 
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
            }`}
          >
            {sentVk ? <Check className="w-3.5 h-3.5" /> : <MessageCircle className="w-3.5 h-3.5 text-sky-500" />}
            {sentVk ? 'Отправлено в VK' : 'ВКонтакте (152-ФЗ)'}
          </button>

          <button
            onClick={handleYc}
            disabled={sendingYc || call.status !== 'completed'}
            className={`text-xs font-medium px-3.5 py-1.5 rounded-lg border flex items-center gap-1.5 transition-all ${
              sentYc 
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
            }`}
          >
            {sentYc ? <Check className="w-3.5 h-3.5" /> : <Database className="w-3.5 h-3.5 text-amber-500" />}
            {sentYc ? 'В Yclients' : 'В Yclients CRM'}
          </button>

          {/* 152-ФЗ Export Suite (PDF / CSV) */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-3xs" id="export-actions-group">
            {/* PDF Export Button */}
            <button
              onClick={() => handleExport('pdf')}
              disabled={exportingFormat !== null}
              id="export-pdf-report-btn"
              className={`text-xs font-medium px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-all ${
                exportSuccessFormat === 'pdf'
                  ? 'bg-emerald-50 text-emerald-800 font-semibold'
                  : 'text-slate-700 hover:text-indigo-900 hover:bg-slate-50'
              }`}
              title="Экспорт официального отчета аудита оператора в PDF (А4, с графиками и подписью управляющего, 152-ФЗ)"
            >
              {exportingFormat === 'pdf' ? (
                <Zap className="w-3.5 h-3.5 text-amber-500 animate-spin" />
              ) : exportSuccessFormat === 'pdf' ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <FileText className="w-3.5 h-3.5 text-rose-600" />
              )}
              <span>{exportingFormat === 'pdf' ? 'Создание PDF...' : exportSuccessFormat === 'pdf' ? 'PDF скачан' : 'PDF'}</span>
            </button>

            <div className="h-4 w-px bg-slate-200 mx-0.5" />

            {/* CSV Export Button */}
            <button
              onClick={() => handleExport('csv')}
              disabled={exportingFormat !== null}
              id="export-csv-report-btn"
              className={`text-xs font-medium px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-all ${
                exportSuccessFormat === 'csv'
                  ? 'bg-emerald-50 text-emerald-800 font-semibold'
                  : 'text-slate-700 hover:text-emerald-900 hover:bg-slate-50'
              }`}
              title="Экспорт детального отчета в CSV формат для Excel/CRM (с маскированием данных по 152-ФЗ)"
            >
              {exportingFormat === 'csv' ? (
                <Zap className="w-3.5 h-3.5 text-amber-500 animate-spin" />
              ) : exportSuccessFormat === 'csv' ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              )}
              <span>{exportingFormat === 'csv' ? 'Создание CSV...' : exportSuccessFormat === 'csv' ? 'CSV скачан' : 'CSV (152-ФЗ)'}</span>
            </button>
          </div>

          {/* Delete Call Button for Admin & Manager */}
          {onDeleteCall && (userRole === 'admin' || userRole === 'manager') && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Вы уверены, что хотите удалить звонок ${call.call_id} из базы данных?`)) {
                  onDeleteCall(call.call_id);
                }
              }}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 flex items-center gap-1.5 transition-all cursor-pointer shadow-3xs"
              title="Удалить запись звонка"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-600" />
              <span>Удалить</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {vkError && (
          <div className="lg:col-span-12 bg-rose-50 border border-rose-200 rounded-xl p-4 text-xs text-rose-800 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Ошибка отправки в VK:</p>
              <p className="mt-0.5">{vkError}</p>
            </div>
          </div>
        )}

        {exportError && (
          <div className="lg:col-span-12 bg-rose-50 border border-rose-200 rounded-xl p-4 text-xs text-rose-800 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Ошибка экспорта отчета:</p>
              <p className="mt-0.5">{exportError}</p>
            </div>
          </div>
        )}

        {/* Left column (Analysis & Recommendations) */}
        <div className="lg:col-span-7 space-y-5">
          {/* Categorical Manager Tags Card */}
          <div className="border border-slate-200/90 rounded-2xl p-4 bg-linear-to-r from-slate-50/70 via-white to-indigo-50/20 shadow-xs space-y-3.5" id="call-tags-management-card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg border border-indigo-200 shadow-3xs">
                  <Tags className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <span>Категориальные теги звонка</span>
                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                      {call.tags?.length || 0}
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-500">Метки для категоризации, поиска и последующего анализа управляющим</p>
                </div>
              </div>
            </div>

            {/* Currently assigned tags */}
            <div className="flex flex-wrap items-center gap-1.5 min-h-[38px] p-2.5 bg-white rounded-xl border border-slate-200/80 shadow-3xs">
              {call.tags && call.tags.length > 0 ? (
                call.tags.map((tag) => (
                  <span
                    key={tag}
                    id={`tag-badge-${tag}`}
                    className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border shadow-3xs transition-all ${getTagBadgeStyle(tag)}`}
                  >
                    <Tag className="w-3 h-3 opacity-70" />
                    <span>{tag}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      disabled={isTagSubmitting}
                      title={`Удалить тег «${tag}»`}
                      className="hover:opacity-75 hover:scale-115 transition-transform p-0.5 rounded-full cursor-pointer text-current ml-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))
              ) : (
                <span className="text-xs text-slate-400 italic flex items-center gap-1.5 py-0.5">
                  <Bookmark className="w-3.5 h-3.5 text-slate-300" />
                  Теги еще не присвоены. Выберите из частых тегов ниже или добавьте свой.
                </span>
              )}
            </div>

            {/* Quick Presets */}
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                Быстрые теги (нажмите для добавления/удаления):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_TAGS.map((preset) => {
                  const isAlreadyAdded = call.tags?.includes(preset.name);
                  return (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => isAlreadyAdded ? handleRemoveTag(preset.name) : handleAddTag(preset.name)}
                      disabled={isTagSubmitting}
                      id={`preset-tag-btn-${preset.name}`}
                      className={`text-xs font-medium px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1 cursor-pointer ${
                        isAlreadyAdded
                          ? 'bg-slate-900 text-white border-slate-900 shadow-3xs font-semibold'
                          : preset.color
                      }`}
                      title={isAlreadyAdded ? `Удалить тег «${preset.name}»` : `Добавить тег «${preset.name}»`}
                    >
                      {isAlreadyAdded ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span>{preset.name}</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-3 h-3" />
                          <span>{preset.name}</span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom Tag Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAddTag(customTagInput);
              }}
              className="flex items-center gap-2 pt-0.5"
            >
              <div className="relative flex-1">
                <input
                  type="text"
                  value={customTagInput}
                  onChange={(e) => setCustomTagInput(e.target.value)}
                  placeholder="Добавить свой тег (например: Предоплата, Корпоративный, Экспресс)..."
                  className="w-full text-xs bg-white border border-slate-200 rounded-lg pl-3 pr-8 py-2 text-slate-800 placeholder-slate-400 focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20"
                  maxLength={40}
                  disabled={isTagSubmitting}
                />
                {customTagInput && (
                  <button
                    type="button"
                    onClick={() => setCustomTagInput('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={isTagSubmitting || !customTagInput.trim()}
                id="btn-add-custom-tag"
                className="text-xs font-semibold px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg transition-all flex items-center gap-1.5 shadow-3xs shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Добавить</span>
              </button>
            </form>

            {tagError && (
              <p className="text-xs text-rose-600 font-medium">{tagError}</p>
            )}
          </div>

          {/* Summary Box */}
          <div className="border border-slate-200/80 rounded-xl p-4 bg-white shadow-3xs">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Краткое содержание (Резюме диалога)
                </h3>
              </div>
              {bookingStatusConfig && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-slate-400 font-medium">Статус записи:</span>
                  <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold inline-flex items-center gap-1 border ${bookingStatusConfig.badgeClass}`}>
                    <bookingStatusConfig.icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{bookingStatusConfig.shortText}</span>
                  </span>
                </div>
              )}
            </div>

            {/* 8 обязательных параметров структурированного резюме звонка */}
            <div className="mb-4 bg-linear-to-br from-slate-50 via-white to-indigo-50/20 border border-slate-200/90 rounded-xl p-3.5 shadow-3xs space-y-3" id="structured-call-summary-8-items">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse"></span>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-800">
                    Обязательные параметры резюме звонка (8 пунктов)
                  </span>
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                  Регламент качества
                </span>
              </div>

              {/* Сетка параметров 1 - 5 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {/* 1. Цель обращения */}
                <div className="bg-white/90 border border-slate-200/80 rounded-lg p-2.5 flex items-start gap-2.5 shadow-3xs sm:col-span-2 lg:col-span-3">
                  <div className="p-1.5 rounded-md bg-purple-100/80 text-purple-700 shrink-0 mt-0.5">
                    <Target className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">
                      1. Цель обращения
                    </span>
                    <span className="text-xs font-semibold text-slate-900 leading-snug block">
                      {summaryParts.structured.call_purpose || 'Консультация и запись на услуги салона'}
                    </span>
                  </div>
                </div>

                {/* 2. Какую услугу хотел получить гость */}
                <div className="bg-white/90 border border-slate-200/80 rounded-lg p-2.5 flex items-start gap-2.5 shadow-3xs">
                  <div className="p-1.5 rounded-md bg-indigo-100/80 text-indigo-700 shrink-0 mt-0.5">
                    <Scissors className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">
                      2. Желаемая услуга
                    </span>
                    <span className="text-xs font-semibold text-slate-900 block truncate" title={summaryParts.structured.requested_service}>
                      {summaryParts.structured.requested_service || 'Не указана'}
                    </span>
                  </div>
                </div>

                {/* 3. Какого мастера предложил менеджер */}
                <div className="bg-white/90 border border-slate-200/80 rounded-lg p-2.5 flex items-start gap-2.5 shadow-3xs">
                  <div className="p-1.5 rounded-md bg-emerald-100/80 text-emerald-700 shrink-0 mt-0.5">
                    <UserCheck className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">
                      3. Предложенный мастер
                    </span>
                    <span className={`text-xs font-bold block truncate ${
                      summaryParts.structured.offered_master.includes('Не выбран')
                        ? 'text-slate-500'
                        : 'text-emerald-700'
                    }`} title={summaryParts.structured.offered_master}>
                      {summaryParts.structured.offered_master || 'Не выбран'}
                    </span>
                  </div>
                </div>

                {/* 4. Какую стоимость озвучили */}
                <div className="bg-white/90 border border-slate-200/80 rounded-lg p-2.5 flex items-start gap-2.5 shadow-3xs">
                  <div className="p-1.5 rounded-md bg-amber-100/80 text-amber-700 shrink-0 mt-0.5">
                    <Banknote className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">
                      4. Озвученная стоимость
                    </span>
                    <span className="text-xs font-semibold text-slate-900 block truncate" title={summaryParts.structured.offered_price}>
                      {summaryParts.structured.offered_price || 'Не озвучивалась'}
                    </span>
                  </div>
                </div>

                {/* 5. Какие даты и время предложили */}
                <div className="bg-white/90 border border-slate-200/80 rounded-lg p-2.5 flex items-start gap-2.5 shadow-3xs sm:col-span-2 lg:col-span-3">
                  <div className="p-1.5 rounded-md bg-blue-100/80 text-blue-700 shrink-0 mt-0.5">
                    <CalendarClock className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">
                      5. Предложенные дата и время
                    </span>
                    <span className="text-xs font-semibold text-slate-900 block" title={summaryParts.structured.offered_date_time}>
                      {summaryParts.structured.offered_date_time || 'Не предложены'}
                    </span>
                  </div>
                </div>

                {/* 6. Состоялась ли запись */}
                <div className="bg-white/90 border border-slate-200/80 rounded-lg p-2.5 flex items-start gap-2.5 shadow-3xs sm:col-span-1">
                  <div className={`p-1.5 rounded-md shrink-0 mt-0.5 ${
                    summaryParts.structured.booking_status_text.toLowerCase().includes('состоялась') && !summaryParts.structured.booking_status_text.toLowerCase().includes('не состоялась')
                      ? 'bg-emerald-100 text-emerald-700'
                      : summaryParts.structured.booking_status_text.toLowerCase().includes('сохранена прежняя')
                      ? 'bg-blue-100 text-blue-700'
                      : summaryParts.structured.booking_status_text.toLowerCase().includes('не состоялась')
                      ? 'bg-rose-100 text-rose-700'
                      : 'bg-slate-100 text-slate-700'
                  }`}>
                    {summaryParts.structured.booking_status_text.toLowerCase().includes('состоялась') && !summaryParts.structured.booking_status_text.toLowerCase().includes('не состоялась') ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : summaryParts.structured.booking_status_text.toLowerCase().includes('не состоялась') ? (
                      <XCircle className="w-4 h-4" />
                    ) : (
                      <HelpCircle className="w-4 h-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">
                      6. Состоялась ли запись
                    </span>
                    <span className={`text-xs font-bold block leading-snug ${
                      summaryParts.structured.booking_status_text.toLowerCase().includes('состоялась') && !summaryParts.structured.booking_status_text.toLowerCase().includes('не состоялась')
                        ? 'text-emerald-700'
                        : summaryParts.structured.booking_status_text.toLowerCase().includes('сохранена')
                        ? 'text-blue-700'
                        : summaryParts.structured.booking_status_text.toLowerCase().includes('не состоялась')
                        ? 'text-rose-700'
                        : 'text-slate-800'
                    }`}>
                      {summaryParts.structured.booking_status_text}
                    </span>
                  </div>
                </div>

                {/* 7. Если запись не состоялась — по какой причине */}
                <div className="bg-white/90 border border-slate-200/80 rounded-lg p-2.5 flex items-start gap-2.5 shadow-3xs sm:col-span-1 lg:col-span-2">
                  <div className="p-1.5 rounded-md bg-amber-100/80 text-amber-700 shrink-0 mt-0.5">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">
                      7. Причина (если запись не состоялась)
                    </span>
                    <span className="text-xs font-medium text-slate-800 block leading-snug">
                      {summaryParts.structured.unbooked_reason || 'Запись успешно состоялась'}
                    </span>
                  </div>
                </div>

                {/* 8. Какие дальнейшие действия необходимо выполнить менеджеру */}
                <div className="bg-white/90 border border-indigo-200/70 rounded-lg p-2.5 flex items-start gap-2.5 shadow-3xs sm:col-span-2 lg:col-span-3">
                  <div className="p-1.5 rounded-md bg-indigo-100/80 text-indigo-700 shrink-0 mt-0.5">
                    <ArrowRightCircle className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="block text-[10px] font-bold text-indigo-900 uppercase tracking-wider">
                        8. Дальнейшие действия менеджера
                      </span>
                      <span className="text-[10px] text-indigo-600 font-semibold">
                        {summaryParts.structured.manager_next_steps?.length || 0} действия
                      </span>
                    </div>
                    {summaryParts.structured.manager_next_steps && summaryParts.structured.manager_next_steps.length > 0 ? (
                      <ul className="space-y-1 pl-3.5 list-disc marker:text-indigo-500 text-xs text-slate-800">
                        {summaryParts.structured.manager_next_steps.map((step, idx) => (
                          <li key={idx} className="leading-snug">{step}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-500 italic">Специальных действий не требуется.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Текст резюме с выделением сути обращения, пересказа диалога (2-4 предложения), выводов и разбора работы менеджера */}
            {summaryParts.essence || summaryParts.retelling || summaryParts.conclusion || summaryParts.hasEvaluation ? (
              <div className="space-y-2.5 text-xs leading-relaxed">
                {summaryParts.essence && (
                  <div className="p-3 bg-slate-50/90 rounded-lg border border-slate-200/70">
                    <div className="font-semibold text-slate-700 mb-1 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block"></span>
                        <span>Суть обращения:</span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-medium">Параметры записи</span>
                    </div>
                    <p className="text-slate-800 leading-normal">{summaryParts.essence}</p>
                  </div>
                )}

                {summaryParts.retelling && (
                  <div className="p-3 bg-indigo-50/40 rounded-lg border border-indigo-200/70">
                    <div className="font-semibold text-indigo-950 mb-1 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Краткий пересказ разговора:</span>
                      </div>
                      <span className="text-[10px] bg-indigo-100/90 text-indigo-800 font-bold px-1.5 py-0.5 rounded-full">
                        2–4 предложения
                      </span>
                    </div>
                    <p className="text-slate-800 leading-normal">{summaryParts.retelling}</p>
                  </div>
                )}

                {summaryParts.conclusion && (
                  <div className="p-3 bg-emerald-50/60 rounded-lg border border-emerald-200/70">
                    <div className="font-semibold text-emerald-950 mb-1 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 inline-block"></span>
                        <span>Вывод:</span>
                      </div>
                      <span className="text-[10px] text-emerald-700/80 font-medium">Результат диалога</span>
                    </div>
                    <p className="text-slate-800 leading-normal">{summaryParts.conclusion}</p>
                  </div>
                )}

                {summaryParts.hasEvaluation && (
                  <div className="p-3 bg-gradient-to-br from-amber-50/40 via-white to-slate-50/70 rounded-lg border border-amber-200/80 space-y-2.5">
                    <div className="font-semibold text-slate-800 flex items-center justify-between pb-1.5 border-b border-amber-100">
                      <div className="flex items-center gap-1.5">
                        <UserCheck className="w-4 h-4 text-amber-600" />
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-800">Разбор работы менеджера</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-500 font-medium">Оценка:</span>
                        <span className={`text-[11px] font-black px-2 py-0.5 rounded-md border font-mono ${
                          (summaryParts.score ?? 0) >= 9
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                            : (summaryParts.score ?? 0) >= 7
                            ? 'bg-amber-100 text-amber-800 border-amber-300'
                            : 'bg-rose-100 text-rose-800 border-rose-300'
                        }`}>
                          {summaryParts.score !== null ? `${summaryParts.score} / 10` : '—'}
                        </span>
                      </div>
                    </div>

                    {/* Ошибки и недочеты */}
                    <div className="p-2.5 bg-rose-50/70 rounded-lg border border-rose-200/70 text-xs">
                      <div className="flex items-center gap-1.5 font-bold text-rose-900 mb-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                        <span>Ошибки и недочёты, повлиявшие на снижение оценки:</span>
                      </div>
                      {summaryParts.mistakes.length > 0 ? (
                        <ul className="space-y-1 pl-4 list-disc marker:text-rose-500 text-rose-950">
                          {summaryParts.mistakes.map((mistake, idx) => (
                            <li key={idx} className="leading-snug">{mistake}</li>
                          ))}
                        </ul>
                      ) : (
                        <div className="flex items-center gap-1.5 text-emerald-700 font-medium pl-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span>Грубых ошибок не допущено, регламент общения соблюден в полном объеме.</span>
                        </div>
                      )}
                    </div>

                    {/* Советы по оптимизации */}
                    {summaryParts.advice.length > 0 && (
                      <div className="p-2.5 bg-emerald-50/60 rounded-lg border border-emerald-200/70 text-xs">
                        <div className="flex items-center gap-1.5 font-bold text-emerald-950 mb-1.5">
                          <Sparkles className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span>Советы по оптимизации работы менеджера:</span>
                        </div>
                        <ul className="space-y-1 pl-4 list-disc marker:text-emerald-500 text-emerald-950">
                          {summaryParts.advice.map((adv, idx) => (
                            <li key={idx} className="leading-snug">{adv}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-200/60">
                {call.summary || 'Резюме не сформировано'}
              </p>
            )}
          </div>

          {/* Карточка: Оценка каждого звонка по 10 критериям качества */}
          <div
            className="border border-indigo-200/90 rounded-2xl p-4 bg-gradient-to-br from-indigo-50/30 via-white to-purple-50/20 shadow-xs space-y-4"
            id="call-evaluation-10-criteria-card"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 flex-wrap pb-3 border-b border-indigo-100/90">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-indigo-600 text-white shrink-0 shadow-3xs">
                  <Award className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                      <span>Оценка звонка по 10 критериям</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-100 text-indigo-800 border border-indigo-200 uppercase">
                        Стандарт сервиса
                      </span>
                    </h3>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Детальная шкала аудита от 0 до 10 баллов по каждому параметру с обоснованием и исключением неприменимых пунктов
                  </p>
                </div>
              </div>

              {/* Overall Score Pill */}
              <div className="flex items-center gap-2">
                <div className={`px-3 py-1.5 rounded-xl border flex items-center gap-2 shadow-3xs ${
                  callEvaluation.overall_score === null
                    ? 'bg-slate-50 border-slate-200 text-slate-600'
                    : callEvaluation.overall_score >= 8.5
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                    : callEvaluation.overall_score >= 7.0
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-800'
                    : callEvaluation.overall_score >= 5.0
                    ? 'bg-amber-50 border-amber-300 text-amber-800'
                    : 'bg-rose-50 border-rose-300 text-rose-800'
                }`}>
                  <Gauge className="w-4 h-4 shrink-0 opacity-80" />
                  <div className="text-left leading-none">
                    <span className="block text-[9px] uppercase tracking-wider font-bold opacity-70">
                      Общий балл
                    </span>
                    <span className="text-sm font-black font-mono">
                      {callEvaluation.overall_score !== null ? `${callEvaluation.overall_score} / 10` : 'Без оценки'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* KPI Summary Strip: применимость критериев */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="p-2.5 bg-white/90 rounded-xl border border-slate-200/80 shadow-3xs flex items-center justify-between">
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Применимо к звонку
                  </span>
                  <span className="text-xs font-bold text-slate-800">
                    {callEvaluation.applicable_count} из 10 критериев
                  </span>
                </div>
                <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold text-xs border border-emerald-200">
                  {callEvaluation.applicable_count}
                </div>
              </div>

              <div className="p-2.5 bg-white/90 rounded-xl border border-slate-200/80 shadow-3xs flex items-center justify-between">
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Не применимо
                  </span>
                  <span className="text-xs font-bold text-slate-800">
                    {10 - callEvaluation.applicable_count} (не снижают балл)
                  </span>
                </div>
                <div className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center font-bold text-xs border border-slate-200">
                  {10 - callEvaluation.applicable_count}
                </div>
              </div>

              <div className="p-2.5 bg-white/90 rounded-xl border border-slate-200/80 shadow-3xs flex items-center justify-between">
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Правило расчета
                  </span>
                  <span className="text-xs font-medium text-slate-700 leading-snug">
                    Строго среднее по применимым
                  </span>
                </div>
                <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center font-bold text-xs border border-indigo-200">
                  %
                </div>
              </div>
            </div>

            {/* Вердикт аудита */}
            {callEvaluation.summary_verdict && (
              <div className="p-2.5 bg-indigo-50/60 rounded-xl border border-indigo-200/70 text-xs text-indigo-950 flex items-start gap-2">
                <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <strong className="font-semibold">Вердикт аудитора: </strong>
                  <span>{callEvaluation.summary_verdict}</span>
                </div>
              </div>
            )}

            {/* Фильтры и быстрый поиск по критериям */}
            <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                {[
                  { id: 'all', label: `Все (10)` },
                  { id: 'applicable', label: `Применимые (${callEvaluation.applicable_count})` },
                  { id: 'not_applicable', label: `Не применимые (${10 - callEvaluation.applicable_count})` },
                  { id: 'low', label: `Требуют внимания (<7)` }
                ].map(tab => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setCriteriaFilter(tab.id as any)}
                    className={`text-xs px-2.5 py-1 rounded-lg border transition-all cursor-pointer font-medium ${
                      criteriaFilter === tab.id
                        ? 'bg-slate-900 text-white border-slate-900 shadow-3xs font-semibold'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Поиск по критерию */}
              <div className="relative">
                <input
                  type="text"
                  value={criteriaSearch}
                  onChange={e => setCriteriaSearch(e.target.value)}
                  placeholder="Поиск по критерию..."
                  className="text-xs bg-white border border-slate-200 rounded-lg pl-2.5 pr-6 py-1 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 w-36 sm:w-48"
                />
                {criteriaSearch && (
                  <button
                    type="button"
                    onClick={() => setCriteriaSearch('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Список критериев */}
            <div className="space-y-2.5 pt-1">
              {filteredCriteria.length > 0 ? (
                filteredCriteria.map((crit, idx) => {
                  const isApplicable = crit.is_applicable !== false && crit.score !== null;
                  const score = crit.score;
                  const isExpanded = expandedCriteriaId === crit.id;

                  // Определение цвета оценки
                  let scoreBadgeClass = 'bg-slate-100 text-slate-600 border-slate-300';
                  let barColorClass = 'bg-slate-300';
                  if (isApplicable && score !== null) {
                    if (score >= 9) {
                      scoreBadgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-300';
                      barColorClass = 'bg-emerald-500';
                    } else if (score >= 7) {
                      scoreBadgeClass = 'bg-indigo-100 text-indigo-800 border-indigo-300';
                      barColorClass = 'bg-indigo-500';
                    } else if (score >= 5) {
                      scoreBadgeClass = 'bg-amber-100 text-amber-800 border-amber-300';
                      barColorClass = 'bg-amber-500';
                    } else {
                      scoreBadgeClass = 'bg-rose-100 text-rose-800 border-rose-300';
                      barColorClass = 'bg-rose-500';
                    }
                  }

                  return (
                    <div
                      key={crit.id}
                      className={`p-3 rounded-xl border transition-all ${
                        !isApplicable
                          ? 'bg-slate-50/70 border-slate-200/80 text-slate-600'
                          : score !== null && score < 6
                          ? 'bg-rose-50/30 border-rose-200/80'
                          : 'bg-white border-slate-200/90 hover:border-indigo-300 hover:shadow-3xs'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0 flex-1">
                          {/* Номер критерия */}
                          <div className={`w-6 h-6 rounded-lg font-bold text-xs flex items-center justify-center shrink-0 mt-0.5 ${
                            !isApplicable
                              ? 'bg-slate-200 text-slate-600'
                              : 'bg-indigo-100 text-indigo-800'
                          }`}>
                            {idx + 1}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="text-xs font-bold text-slate-900 leading-snug">
                                {crit.name}
                              </h4>

                              {/* Бейдж применимости */}
                              {isApplicable ? (
                                <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded-md inline-flex items-center gap-0.5">
                                  <Check className="w-2.5 h-2.5" />
                                  <span>Применим</span>
                                </span>
                              ) : (
                                <span className="text-[10px] font-semibold text-slate-600 bg-slate-100 border border-slate-300 px-1.5 py-0.2 rounded-md inline-flex items-center gap-0.5">
                                  <MinusCircle className="w-2.5 h-2.5" />
                                  <span>Не применим (не снижает оценку)</span>
                                </span>
                              )}
                            </div>

                            {/* Прогресс-бар оценки */}
                            <div className="mt-2 flex items-center gap-2.5">
                              <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                {isApplicable && score !== null ? (
                                  <div
                                    className={`${barColorClass} h-1.5 rounded-full transition-all duration-300`}
                                    style={{ width: `${(score / 10) * 100}%` }}
                                  />
                                ) : (
                                  <div className="w-full h-1.5 bg-slate-200 border-dashed" />
                                )}
                              </div>
                              <span className="text-[10px] font-mono font-semibold text-slate-500 shrink-0">
                                {isApplicable && score !== null ? `${(score / 10) * 100}%` : 'Исключен'}
                              </span>
                            </div>

                            {/* Обоснование оценки */}
                            <div className="mt-2 p-2 rounded-lg bg-slate-50 border border-slate-100/90 text-[11px] text-slate-700 leading-relaxed">
                              <span className="font-semibold text-slate-800 mr-1">Обоснование:</span>
                              <span>{crit.explanation}</span>
                            </div>
                          </div>
                        </div>

                        {/* Бейдж балла */}
                        <div className="shrink-0 text-right">
                          <span className={`text-xs font-black font-mono px-2.5 py-1 rounded-lg border inline-block shadow-3xs ${scoreBadgeClass}`}>
                            {isApplicable && score !== null ? `${score} / 10` : 'Не применим'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-4 bg-white/70 rounded-xl border border-dashed border-slate-200 text-xs text-slate-500">
                  По выбранному фильтру критерии не найдены.
                </div>
              )}
            </div>
          </div>

          {/* Clarify Context with Yandex.GPT Card */}
          <div 
            className="border border-rose-200/90 rounded-2xl p-4 bg-gradient-to-br from-rose-50/40 via-white to-amber-50/20 shadow-xs space-y-3.5"
            id="clarify-context-ai-container"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 flex-wrap pb-2.5 border-b border-rose-100">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-rose-600 text-white shrink-0 shadow-3xs">
                  <MessageSquareQuote className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                      <span>Уточнить контекст у ИИ</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-200 uppercase">
                        GigaChat
                      </span>
                    </h3>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Задайте дополнительный вопрос по конкретному звонку в GigaChat для получения уточненной выжимки или проверки фактов
                  </p>
                </div>
              </div>

              {call.context_clarifications && call.context_clarifications.length > 0 && (
                <span className="text-[11px] text-rose-800 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md font-medium">
                  Ответов: <strong>{call.context_clarifications.length}</strong>
                </span>
              )}
            </div>

            {/* Suggested Prompt Chips */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                Быстрые вопросы для проверки фактов:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  'Была ли названа точная цена услуги и порядок оплаты?',
                  'На какую дату, время и к какому мастеру договорились?',
                  'Какие обязательства или обещания дал оператор?',
                  'Были ли упомянуты скидки, акции или условия отмены?',
                  'Были ли признаки конфликта или недовольства клиента?'
                ].map((presetQ, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setClarifyQuestion(presetQ);
                      handleClarifyContext(presetQ);
                    }}
                    disabled={isClarifying || !call.transcript}
                    className="text-[11px] text-slate-700 bg-white hover:bg-rose-50 hover:text-rose-900 hover:border-rose-300 border border-slate-200/90 rounded-lg px-2.5 py-1 text-left transition-all cursor-pointer shadow-3xs disabled:opacity-50"
                  >
                    💬 {presetQ}
                  </button>
                ))}
              </div>
            </div>

            {/* Input & Submit Form */}
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                handleClarifyContext();
              }}
              className="space-y-2 pt-1"
            >
              <div className="relative">
                <input
                  type="text"
                  id="clarify-context-question-input"
                  value={clarifyQuestion}
                  onChange={(e) => setClarifyQuestion(e.target.value)}
                  placeholder="Задайте любой вопрос по звонку (например: 'Какая предоплата требуется и в какой банк?')..."
                  disabled={isClarifying || !call.transcript}
                  className="w-full pl-3.5 pr-28 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={isClarifying || !clarifyQuestion.trim() || !call.transcript}
                  id="btn-submit-clarify-question"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-3xs cursor-pointer"
                >
                  {isClarifying ? (
                    <>
                      <Zap className="w-3.5 h-3.5 animate-spin text-rose-200" />
                      <span>Анализ...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>Спросить</span>
                    </>
                  )}
                </button>
              </div>

              {clarifyError && (
                <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <p>{clarifyError}</p>
                </div>
              )}
            </form>

            {/* Existing clarifications list for this call */}
            {call.context_clarifications && call.context_clarifications.length > 0 && (
              <div className="space-y-3 pt-2 border-t border-rose-100">
                <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">
                  История уточнений по звонку:
                </span>

                <div className="space-y-3">
                  {call.context_clarifications.map((item) => (
                    <div 
                      key={item.id}
                      className="bg-white border border-rose-200/70 rounded-xl p-3.5 shadow-3xs space-y-2 hover:border-rose-300 transition-colors"
                    >
                      {/* Question Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2">
                          <span className="p-1 rounded-md bg-rose-100 text-rose-800 font-bold text-[10px] mt-0.5 shrink-0">
                            Вопрос
                          </span>
                          <span className="text-xs font-bold text-slate-900 leading-snug">
                            {item.question}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono shrink-0">
                          {item.timestamp ? new Date(item.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                      </div>

                      {/* Answer Content */}
                      <div className="p-3 bg-slate-50/80 rounded-lg border border-slate-200/80 text-xs text-slate-800 leading-relaxed whitespace-pre-line font-normal">
                        {item.answer}
                      </div>

                      {/* Footer: Provider badge & Copy Button */}
                      <div className="flex items-center justify-between text-[11px] pt-1 text-slate-500">
                        <span className="inline-flex items-center gap-1 font-medium text-slate-600">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                          <span>Провайдер: <strong>{item.provider || item.model}</strong></span>
                        </span>

                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(`Вопрос: ${item.question}\nОтвет: ${item.answer}`);
                            setCopiedClarifyId(item.id);
                            setTimeout(() => setCopiedClarifyId(null), 3000);
                          }}
                          className="px-2 py-0.5 rounded text-[11px] text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-transparent hover:border-slate-200 flex items-center gap-1 transition-all cursor-pointer"
                        >
                          {copiedClarifyId === item.id ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-600" />
                              <span className="text-emerald-700 font-semibold">Скопировано</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3 text-slate-400" />
                              <span>Копировать</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Next Steps for Administrator (Interactive AI Checklist) */}
          <div className="border border-purple-200/80 rounded-2xl p-4 bg-gradient-to-br from-purple-50/40 via-white to-indigo-50/20 shadow-xs space-y-3" id="next-steps-container">
            {/* Header */}
            <div className="flex items-center justify-between gap-2 flex-wrap pb-2 border-b border-purple-100">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-purple-600 text-white shrink-0">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      Следующие шаги для администратора (Next Steps)
                    </h3>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-700 border border-purple-200">
                      ИИ GigaChat
                    </span>
                  </div>
                  {call.next_steps_generated_at ? (
                    <p className="text-[10px] text-slate-500">
                      Сформировано ИИ: {new Date(call.next_steps_generated_at).toLocaleString('ru-RU', { timeZone: 'Europe/Samara', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} (Самара)
                    </p>
                  ) : (
                    <p className="text-[10px] text-slate-500">
                      Индивидуальный пошаговый чек-лист задач по итогам диалога
                    </p>
                  )}
                </div>
              </div>

              {/* Header Action Buttons */}
              <div className="flex items-center gap-1.5">
                {currentNextStepsItems.length > 0 && (
                  <>
                    <span className="text-[11px] font-semibold text-purple-800 bg-purple-100/70 px-2 py-0.5 rounded-full border border-purple-200/60">
                      {completedCount} из {currentNextStepsItems.length} выполнено
                    </span>
                    <button
                      type="button"
                      onClick={handleCopySteps}
                      id="btn-copy-next-steps"
                      className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 flex items-center gap-1 transition-colors cursor-pointer"
                      title="Скопировать список задач в буфер обмена"
                    >
                      {copiedSteps ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
                      <span>{copiedSteps ? 'Скопировано!' : 'Копировать'}</span>
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={handleGenerateNextSteps}
                  disabled={generatingNextSteps || !call.transcript}
                  id="btn-regenerate-next-steps"
                  className="text-xs px-2.5 py-1 rounded-lg border border-purple-300 bg-purple-50 hover:bg-purple-100 text-purple-800 font-semibold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                  title="Сформировать или пересчитать список следующих шагов с помощью ИИ"
                >
                  <Sparkles className={`w-3.5 h-3.5 text-purple-600 ${generatingNextSteps ? 'animate-spin' : ''}`} />
                  <span>{generatingNextSteps ? 'Генерация...' : currentNextStepsItems.length > 0 ? 'Обновить ИИ' : 'Сформировать ИИ'}</span>
                </button>
              </div>
            </div>

            {/* Notification alerts */}
            {nextStepsSuccess && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 flex items-center justify-between text-xs text-emerald-900 animate-in fade-in">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{nextStepsSuccess}</span>
                </div>
                <button onClick={() => setNextStepsSuccess(null)} className="p-0.5 text-emerald-700 hover:text-emerald-900 cursor-pointer">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {nextStepsError && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-2.5 flex items-center justify-between text-xs text-rose-900 animate-in fade-in">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{nextStepsError}</span>
                </div>
                <button onClick={() => setNextStepsError(null)} className="p-0.5 text-rose-700 hover:text-rose-900 cursor-pointer">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Progress bar if tasks exist */}
            {currentNextStepsItems.length > 0 && (
              <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-purple-500 to-emerald-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${(completedCount / currentNextStepsItems.length) * 100}%` }}
                />
              </div>
            )}

            {/* Tasks list or Empty state */}
            {currentNextStepsItems.length > 0 ? (
              <div className="space-y-1.5">
                {currentNextStepsItems.map((item, idx) => (
                  <div
                    key={item.id}
                    className={`group flex items-start justify-between gap-3 p-2.5 rounded-xl border transition-all ${
                      item.completed
                        ? 'bg-emerald-50/40 border-emerald-200/80 text-slate-500'
                        : 'bg-white border-slate-200 hover:border-purple-300 hover:shadow-3xs text-slate-800'
                    }`}
                  >
                    <div
                      className="flex items-start gap-2.5 flex-1 cursor-pointer select-none"
                      onClick={() => handleToggleStep(item.id)}
                    >
                      <button
                        type="button"
                        className="mt-0.5 shrink-0 focus:outline-none cursor-pointer"
                        aria-label={item.completed ? 'Отметить невыполненной' : 'Отметить выполненной'}
                      >
                        {item.completed ? (
                          <div className="w-4 h-4 rounded bg-emerald-600 text-white flex items-center justify-center">
                            <Check className="w-3 h-3 stroke-[3]" />
                          </div>
                        ) : (
                          <div className="w-4 h-4 rounded border-2 border-slate-300 group-hover:border-purple-500 bg-white" />
                        )}
                      </button>
                      <div className="text-xs leading-snug">
                        <span className={`font-semibold mr-1.5 ${item.completed ? 'text-slate-400' : 'text-purple-700'}`}>
                          {idx + 1}.
                        </span>
                        <span className={item.completed ? 'line-through text-slate-400' : 'text-slate-800'}>
                          {item.text}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDeleteStep(item.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-600 rounded transition-opacity cursor-pointer shrink-0"
                      title="Удалить этот шаг"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}

                {/* Add custom step inline */}
                {isAddingStep ? (
                  <form onSubmit={handleAddNewStep} className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      value={newStepInput}
                      onChange={(e) => setNewStepInput(e.target.value)}
                      placeholder="Введите дополнительную задачу для администратора..."
                      className="flex-1 text-xs px-3 py-1.5 rounded-lg border border-purple-300 focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
                      autoFocus
                    />
                    <button
                      type="submit"
                      className="text-xs px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg cursor-pointer"
                    >
                      Добавить
                    </button>
                    <button
                      type="button"
                      onClick={() => { setIsAddingStep(false); setNewStepInput(''); }}
                      className="text-xs px-2 py-1.5 text-slate-500 hover:text-slate-800 cursor-pointer"
                    >
                      Отмена
                    </button>
                  </form>
                ) : (
                  <div className="pt-1 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setIsAddingStep(true)}
                      id="btn-add-custom-next-step"
                      className="text-xs text-purple-700 hover:text-purple-900 font-semibold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Добавить свой шаг вручную</span>
                    </button>
                    <span className="text-[10px] text-slate-400">
                      Нажмите на задачу, чтобы отметить её выполненной
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-4 px-3 bg-white/70 border border-dashed border-purple-200 rounded-xl space-y-2.5">
                <div className="w-9 h-9 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center mx-auto">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-800">
                    Список следующих шагов ещё не сформирован
                  </p>
                  <p className="text-[11px] text-slate-500 max-w-md mx-auto mt-0.5 leading-relaxed">
                    Нажмите кнопку ниже, чтобы искусственный интеллект проанализировал диалог и составил пошаговый чек-лист задач для дежурного администратора (бронирование в CRM, отправка подтверждения, напоминание, контроль мастера).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleGenerateNextSteps}
                  disabled={generatingNextSteps || !call.transcript}
                  id="btn-cta-generate-next-steps"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white text-xs font-semibold rounded-xl shadow-xs cursor-pointer transition-all disabled:opacity-50"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${generatingNextSteps ? 'animate-spin' : ''}`} />
                  <span>{generatingNextSteps ? 'ИИ формирует шаги...' : 'Сформировать Next Steps с помощью ИИ'}</span>
                </button>
              </div>
            )}
          </div>

          {/* Key Facts Box */}
          <div className="border border-slate-100 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3.5">Ключевые факты</h3>

            {/* Визуальный индикатор (badge) статуса записи из JSON-анализа ИИ */}
            {bookingStatusConfig && (
              <div className={`mb-4 p-3 rounded-xl border flex items-start justify-between gap-3 ${
                bookingStatusConfig.type === 'consent'
                  ? 'bg-emerald-50/70 border-emerald-200'
                  : bookingStatusConfig.type === 'decline'
                  ? 'bg-rose-50/70 border-rose-200'
                  : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="flex items-start gap-2.5">
                  <div className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${bookingStatusConfig.solidClass}`}>
                    <bookingStatusConfig.icon className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Статус записи (ИИ-анализ):
                      </span>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${bookingStatusConfig.badgeClass}`}>
                        {bookingStatusConfig.badgeText}
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 mt-1 font-normal leading-relaxed">
                      {bookingStatusConfig.desc}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div>
                  <span className="block text-[11px] font-medium text-slate-400 uppercase mb-1">Итог разговора</span>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-md border ${getOutcomeColor(call.key_facts?.call_outcome || 'успешно')}`}>
                    {call.key_facts?.call_outcome?.toUpperCase() || 'УСПЕШНО'}
                  </span>
                </div>

                <div>
                  <span className="block text-[11px] font-medium text-slate-400 uppercase mb-1">Конфликт / Спор</span>
                  {call.key_facts?.is_dispute ? (
                    <div className="flex items-center gap-1.5 bg-red-50 border border-red-100 text-red-700 px-2.5 py-1.5 rounded-lg text-xs font-medium">
                      <ShieldAlert className="w-4 h-4" />
                      <div>
                        <span className="font-semibold block">Обнаружен спор</span>
                        <span className="text-[11px] text-red-600 font-normal">{call.key_facts.dispute_reason}</span>
                      </div>
                    </div>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-600 bg-slate-50 border border-slate-100 px-2.5 py-1 rounded-md font-medium">
                      <ThumbsUp className="w-3.5 h-3.5 text-emerald-500" /> Конфликты отсутствуют
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-3 border-t sm:border-t-0 sm:border-l border-slate-100 sm:pl-4">
                <div>
                  <span className="block text-[11px] font-medium text-slate-400 mb-1.5">Тональность</span>
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Клиент:</span>
                      <span className="font-semibold px-2 py-0.5 rounded-sm capitalize bg-slate-100 text-slate-700">
                        {call.key_facts?.tone_client || 'нейтральный'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Администратор:</span>
                      <span className="font-semibold px-2 py-0.5 rounded-sm capitalize bg-slate-100 text-slate-700">
                        {call.key_facts?.tone_manager || 'спокойный'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {call.key_facts?.promises && call.key_facts.promises.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <span className="block text-[11px] font-medium text-slate-400 uppercase mb-2">Обещания клиенту:</span>
                <ul className="space-y-1.5 text-xs">
                  {call.key_facts.promises.map((p, idx) => (
                    <li key={idx} className="flex items-start gap-1.5 text-slate-700">
                      <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Trigger phrases */}
          {call.trigger_phrases && call.trigger_phrases.length > 0 && (
            <div className="border border-slate-100 rounded-xl p-4 bg-rose-50/20">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-rose-500" /> Выявленные триггеры недовольства ({call.trigger_phrases.length})
              </h3>
              <div className="space-y-1.5">
                {call.trigger_phrases.map((phrase, idx) => (
                  <div key={idx} className="text-xs italic bg-rose-50 border border-rose-100 text-rose-900 p-2.5 rounded-lg border-l-4 border-l-rose-500">
                    «{phrase}»
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          <div className="border border-slate-100 rounded-xl p-4 bg-blue-50/10">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2.5">
              Рекомендации для администратора
            </h3>
            <ul className="space-y-2 text-xs">
              {call.recommendations && call.recommendations.length > 0 ? (
                call.recommendations.map((rec, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-slate-700 leading-relaxed">
                    <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0 text-[10px]">
                      {idx + 1}
                    </span>
                    <span>{rec}</span>
                  </li>
                ))
              ) : (
                <p className="text-slate-400">Рекомендаций нет</p>
              )}
            </ul>
          </div>
        </div>

        {/* Right column */}
        <div className="lg:col-span-5 space-y-5">
          {/* Operator Score */}
          <div className={`border rounded-xl p-4 space-y-3 ${getScoreColor(call.operator_score)}`}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Оценка качества</h3>
              <div className="flex items-baseline gap-0.5">
                <span className="text-2xl font-black font-mono">
                  {call.operator_score !== null && call.operator_score !== undefined ? call.operator_score : '—'}
                </span>
                {call.operator_score !== null && call.operator_score !== undefined && (
                  <span className="text-xs text-slate-400">/ 10</span>
                )}
              </div>
            </div>
            
            {call.operator_comment ? (
              <div className="text-xs text-slate-700 leading-relaxed bg-white/70 p-3 rounded-lg border border-slate-200/50">
                <span className="block font-semibold mb-1 text-slate-900">Комментарий аудитора:</span>
                {call.operator_comment}
              </div>
            ) : (
              <div className="text-xs text-slate-500 italic">Комментарии к оценке не зафиксированы</div>
            )}

            {/* Ошибки, повлиявшие на снижение оценки */}
            {summaryParts.mistakes.length > 0 && (
              <div className="p-3 bg-rose-50/90 rounded-lg border border-rose-200/80 text-xs text-rose-950">
                <div className="flex items-center gap-1.5 font-bold text-rose-900 mb-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                  <span>Причины снижения оценки (ошибки менеджера):</span>
                </div>
                <ul className="space-y-1 pl-4 list-disc marker:text-rose-500">
                  {summaryParts.mistakes.map((m, idx) => (
                    <li key={idx} className="leading-snug">{m}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Советы по оптимизации */}
            {summaryParts.advice.length > 0 && (
              <div className="p-3 bg-emerald-50/90 rounded-lg border border-emerald-200/80 text-xs text-emerald-950">
                <div className="flex items-center gap-1.5 font-bold text-emerald-900 mb-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Советы по оптимизации работы менеджера:</span>
                </div>
                <ul className="space-y-1 pl-4 list-disc marker:text-emerald-500">
                  {summaryParts.advice.map((r, idx) => (
                    <li key={idx} className="leading-snug">{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Audio recording & TTL */}
          <div className="border border-slate-100 rounded-xl p-4 bg-slate-50/50 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Volume2 className="w-4 h-4 text-indigo-500" /> Аудиозапись звонка (152-ФЗ)
              </h3>
              {!call.audio_deleted && call.audio_url && (
                <a
                  href={`${proxiedAudioSrc}${proxiedAudioSrc.includes('?') ? '&' : '?'}download=1`}
                  download={`call-${call.call_id}.mp3`}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/80 rounded-md transition-colors"
                  title="Скачать аудиозапись"
                >
                  <Download className="w-3 h-3" />
                  Скачать
                </a>
              )}
            </div>

            {call.audio_deleted ? (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start gap-2">
                <Clock className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                <div>
                  <div className="font-semibold">Аудиозапись удалена по регламенту</div>
                  <div className="text-[11px] text-amber-700 mt-0.5">
                    Срок хранения аудиозаписи (30 дней) истек. Запись безвозвратно удалена из хранилища в соответствии с 152-ФЗ.
                  </div>
                </div>
              </div>
            ) : call.audio_url ? (
              <div className="space-y-2">
                <audio 
                  key={`${call.call_id}-${audioReloadKey}`}
                  src={proxiedAudioSrc} 
                  controls 
                  className="w-full h-9 rounded-lg"
                  preload="metadata"
                  onLoadedData={() => setAudioError(null)}
                  onError={() => {
                    setAudioError('Не удалось воспроизвести аудиозапись напрямую через прокси АТС. Проверьте домен/токен ВАТС или попробуйте повторить загрузку.');
                  }}
                />
                {audioError && (
                  <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-[11px] text-rose-800 flex flex-wrap items-center justify-between gap-2">
                    <span>{audioError}</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setAudioError(null);
                          setAudioReloadKey(k => k + 1);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-rose-300 rounded text-rose-700 hover:bg-rose-100 font-semibold"
                      >
                        <RefreshCw className="w-3 h-3" /> Повторить
                      </button>
                      {call.audio_url.startsWith('http') && (
                        <a
                          href={call.audio_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-slate-300 rounded text-slate-700 hover:bg-slate-100 font-semibold"
                        >
                          <ExternalLink className="w-3 h-3" /> Оригинал АТС
                        </a>
                      )}
                    </div>
                  </div>
                )}
                <div className="text-[10px] text-slate-400">
                  * Запись хранится не более 30 дней, затем автоматически очищается ежедневным фоновым заданием.
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-400 italic">Аудиозапись не прикреплена</div>
            )}
          </div>

          {/* Transcript / Privacy Restriction */}
          <div className="border border-slate-100 rounded-xl flex flex-col h-[400px]">
            <div className="p-3.5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-slate-400" /> Стенограмма разговора
              </h3>
              <span className="text-[10px] font-mono font-semibold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-sm">
                SpeechKit ролевой
              </span>
            </div>

            {userRole === 'viewer' ? (
              <div className="flex-1 p-6 flex flex-col items-center justify-center text-center bg-slate-50/30">
                <div className="p-3 bg-slate-100 rounded-full text-slate-500 mb-3">
                  <Lock className="w-6 h-6" />
                </div>
                <h4 className="text-xs font-bold text-slate-800 mb-1">
                  Доступ к расшифровке ограничен
                </h4>
                <p className="text-[11px] text-slate-500 max-w-xs leading-relaxed">
                  Согласно политике обработки ПДн (152-ФЗ) и разделению ролей, для роли «Наблюдатель» доступ к дословному транскрипту закрыт. Доступ открыт для управляющих и администраторов.
                </p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/10">
                {parsedTranscriptLines.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-400 text-xs">
                    Стенограмма отсутствует
                  </div>
                ) : (
                  parsedTranscriptLines.map((line, idx) => {
                    const isIvr = /^Автоинформатор:/i.test(line);
                    const isManager = line.startsWith('Менеджер:') || line.startsWith('Администратор:') || line.startsWith('Оператор:');
                    const cleanLine = line.replace(/^(Менеджер:|Клиент:|Администратор:|Оператор:|Автоинформатор:|Неизвестный:)\s*/i, '');
                    const speakerLabel = line.match(/^(Менеджер:|Клиент:|Администратор:|Оператор:|Автоинформатор:|Неизвестный:)/i)?.[0] || 'Неизвестный:';

                    if (isIvr) {
                      return (
                        <div key={idx} className="flex flex-col items-center my-1">
                          <span className="text-[10px] font-medium text-slate-400 mb-0.5">
                            Автоинформатор (АТС)
                          </span>
                          <div className="px-3 py-1.5 rounded-lg text-[11px] leading-relaxed bg-slate-100/80 border border-slate-200/80 text-slate-500 italic text-center max-w-[92%]">
                            {cleanLine}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div 
                        key={idx} 
                        className={`flex flex-col max-w-[85%] ${isManager ? 'ml-auto items-end' : 'mr-auto items-start'}`}
                      >
                        <span className="text-[10px] font-medium text-slate-400 mb-0.5 capitalize">
                          {speakerLabel.replace(':', '')}
                        </span>
                        <div className={`p-2.5 rounded-xl text-xs leading-relaxed ${
                          isManager 
                            ? 'bg-indigo-600 text-white rounded-br-none' 
                            : 'bg-white border border-slate-200 text-slate-800 rounded-bl-none shadow-3xs'
                        }`}>
                          {cleanLine}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
