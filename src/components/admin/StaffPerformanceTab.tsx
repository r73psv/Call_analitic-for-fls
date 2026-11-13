/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Users, UserCheck, Calendar, Star, TrendingUp, PhoneCall, 
  CheckCircle2, XCircle, AlertCircle, RefreshCw, ChevronRight,
  Headphones, Award, Clock, ArrowUpRight, Flame, BarChart3,
  SlidersHorizontal, X, FileText, Sparkles
} from 'lucide-react';

interface StaffRecentCall {
  call_id: string;
  timestamp: string;
  client_name: string;
  client_phone_masked?: string;
  duration_seconds: number;
  score: number | null;
  call_outcome: string;
  booking_status?: string;
  summary: string;
}

interface StaffMember {
  id: string;
  username: string;
  name: string;
  role: string;
  isActive: boolean;
  isOnline: boolean;
  lastLoginAt?: string;
  notes?: string;
  totalCalls: number;
  averageScore: number | null;
  starsScore: number | null;
  bookingsCount: number;
  conversionRate: number;
  consultationsCount: number;
  refusalsCount: number;
  disputesCount: number;
  averageDurationSeconds: number;
  criteriaAverages: Record<string, number | null>;
  recentCalls: StaffRecentCall[];
}

interface StaffPerformanceData {
  period: string;
  totalStaff: number;
  activeStaff: number;
  onlineStaff: number;
  totalCallsAnalyzed: number;
  salonAverageScore: number | null;
  salonConversionRate: number;
  staff: StaffMember[];
  source: string;
  dataSourceDescription: string;
}

interface StaffPerformanceTabProps {
  authToken?: string | null;
  onSelectCall?: (callId: string) => void;
}

export function StaffPerformanceTab({ authToken, onSelectCall }: StaffPerformanceTabProps) {
  const [data, setData] = useState<StaffPerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [period, setPeriod] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);

  const getHeaders = () => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) h['Authorization'] = `Bearer ${authToken}`;
    return h;
  };

  const loadPerformanceData = async () => {
    setLoading(true);
    setError(null);
    try {
      let url = `/api/settings/staff-performance?period=${period}`;
      if (period === 'custom' && startDate) {
        url += `&startDate=${startDate}`;
        if (endDate) url += `&endDate=${endDate}`;
      }

      let res = await fetch(url, { headers: getHeaders() });
      if (!res.ok) {
        // Fallback to /api/admin/staff-performance if settings route unavailable
        res = await fetch(`/api/admin/staff-performance?period=${period}`, { headers: getHeaders() });
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Ошибка загрузки данных персонала');
      }
      const json: StaffPerformanceData = await res.json();
      setData(json);

      // If a staff member was selected, keep selection updated
      if (selectedStaff) {
        const updated = json.staff.find(s => s.id === selectedStaff.id || s.name === selectedStaff.name);
        if (updated) setSelectedStaff(updated);
      }
    } catch (err: any) {
      setError(err.message || 'Не удалось получить данные о работе персонала');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPerformanceData();
  }, [period]);

  const handleApplyCustomDates = (e: React.FormEvent) => {
    e.preventDefault();
    if (period === 'custom') {
      loadPerformanceData();
    }
  };

  const getScoreBadgeColor = (score: number | null) => {
    if (score === null) return 'bg-slate-100 text-slate-500 border-slate-200';
    if (score >= 8.5) return 'bg-emerald-50 text-emerald-800 border-emerald-300 font-bold';
    if (score >= 7.0) return 'bg-teal-50 text-teal-800 border-teal-300 font-bold';
    if (score >= 5.5) return 'bg-amber-50 text-amber-800 border-amber-300 font-bold';
    return 'bg-rose-50 text-rose-800 border-rose-300 font-bold';
  };

  const criteriaLabels: Record<string, string> = {
    greeting: 'Приветствие и представление',
    needsDiscovery: 'Выявление потребности гостя',
    servicePresentation: 'Презентация услуги и мастера',
    pricePresentation: 'Презентация стоимости',
    objections: 'Работа с возражениями',
    extraServices: 'Предложение доп. услуг',
    parallelBooking: 'Параллельная запись',
    alternativeOptions: 'Альтернативные варианты',
    closing: 'Закрытие на запись',
    communicationQuality: 'Качество коммуникации',
  };

  return (
    <div className="space-y-5" id="staff-performance-tab">
      {/* Top Banner & Header */}
      <div className="bg-gradient-to-r from-teal-900 via-emerald-900 to-slate-900 rounded-2xl p-5 text-white shadow-md relative overflow-hidden border border-emerald-700/30">
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-200 border border-emerald-400/30 text-[11px] font-bold">
              <Flame className="w-3.5 h-3.5 text-amber-400" />
              Firestore Data Sync • Речевая аналитика
            </div>
            <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              <Users className="w-5 h-5 text-emerald-300" />
              Персонал: Администраторы ресепшена и оценка качества работы
            </h3>
            <p className="text-xs text-emerald-100/90 max-w-2xl leading-relaxed">
              Мониторинг текущих статусов администраторов стойки ресепшена, объема обработанных звонков за период, средней оценки по 10 критериям речевого стандарта и конверсии в запись.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadPerformanceData}
              disabled={loading}
              className="px-3.5 py-2 bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2 border border-emerald-500/40"
              id="refresh-staff-btn"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Обновить данные</span>
            </button>
          </div>
        </div>

        {/* Firestore Source Indicator */}
        <div className="mt-4 pt-3 border-t border-white/10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 text-[11px] text-emerald-200/90 font-mono">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Источник данных: {data?.dataSourceDescription || 'Коллекции staff, calls, evaluations'}</span>
          </div>
          <div className="text-[10px] text-emerald-300/80">
            Защита ПДн по 152-ФЗ • Таймаут сессии 4 часа
          </div>
        </div>
      </div>

      {/* Period Filter Bar */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5 mr-1">
            <Calendar className="w-3.5 h-3.5 text-emerald-600" /> Период:
          </span>
          <button
            type="button"
            onClick={() => setPeriod('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              period === 'all'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            За всё время
          </button>
          <button
            type="button"
            onClick={() => setPeriod('today')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              period === 'today'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            Сегодня
          </button>
          <button
            type="button"
            onClick={() => setPeriod('7days')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              period === '7days'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            Последние 7 дней
          </button>
          <button
            type="button"
            onClick={() => setPeriod('this_month')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              period === 'this_month'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            Текущий месяц
          </button>
          <button
            type="button"
            onClick={() => setPeriod('30days')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              period === '30days'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            30 дней
          </button>
          <button
            type="button"
            onClick={() => setPeriod('custom')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
              period === 'custom'
                ? 'bg-purple-700 text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <SlidersHorizontal className="w-3 h-3" />
            Выбрать даты
          </button>
        </div>

        {period === 'custom' && (
          <form onSubmit={handleApplyCustomDates} className="flex items-center gap-2 text-xs w-full lg:w-auto">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs"
              required
            />
            <span className="text-slate-400">—</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs"
            />
            <button
              type="submit"
              className="px-3 py-1.5 bg-purple-700 hover:bg-purple-800 text-white font-bold rounded-lg transition-colors"
            >
              Применить
            </button>
          </form>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-xs font-bold text-slate-500 flex items-center justify-between">
            <span>Администраторы ресепшена</span>
            <Headphones className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2">
            {data?.totalStaff || 0} <span className="text-xs font-normal text-slate-500">сотрудников</span>
          </div>
          <div className="flex items-center gap-2 mt-1 text-[11px] text-emerald-700 font-medium">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
            {data?.onlineStaff || 0} сейчас на смене / активны
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-xs font-bold text-slate-500 flex items-center justify-between">
            <span>Проанализировано звонков</span>
            <PhoneCall className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2">
            {data?.totalCallsAnalyzed || 0} <span className="text-xs font-normal text-slate-500">звонков</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            За выбранный период: {period === 'all' ? 'всё время' : period}
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-xs font-bold text-slate-500 flex items-center justify-between">
            <span>Средняя оценка работы</span>
            <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2 flex items-baseline gap-2">
            <span>{data?.salonAverageScore !== null ? data?.salonAverageScore : '—'}</span>
            <span className="text-xs font-normal text-slate-500">/ 10 баллов</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
            <Award className="w-3.5 h-3.5 text-amber-500" />
            {data?.salonAverageScore ? `${((data.salonAverageScore / 10) * 5).toFixed(1)} из 5 звезд` : 'Нет звонков'}
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-xs font-bold text-slate-500 flex items-center justify-between">
            <span>Конверсия в запись</span>
            <TrendingUp className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2">
            {data?.salonConversionRate || 0}%
          </div>
          <div className="text-[11px] text-blue-700 mt-1 font-medium">
            Доля звонков, завершившихся записью
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 flex items-start gap-2.5 text-xs text-rose-800">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Staff Members Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <div>
            <h4 className="font-bold text-xs text-slate-900 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-emerald-600" />
              Список администраторов ресепшена и показатели эффективности
            </h4>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Нажмите на строку сотрудника для просмотра подробной детализации по 10 критериям
            </p>
          </div>
          <span className="text-[11px] font-mono text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
            Всего: {data?.staff.length || 0} сотр.
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs" id="staff-performance-table">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
              <tr>
                <th className="px-4 py-3">Администратор ресепшена</th>
                <th className="px-4 py-3">Текущий статус</th>
                <th className="px-4 py-3 text-center">Звонков за период</th>
                <th className="px-4 py-3 text-center">Конверсия в запись</th>
                <th className="px-4 py-3 text-center">Средняя оценка работы</th>
                <th className="px-4 py-3 text-right">Детализация</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data && data.staff.length > 0 ? (
                data.staff.map((member) => {
                  const isSelected = selectedStaff?.id === member.id;
                  return (
                    <tr 
                      key={member.id} 
                      onClick={() => setSelectedStaff(member)}
                      className={`cursor-pointer transition-colors ${
                        isSelected 
                          ? 'bg-emerald-50/80 hover:bg-emerald-50' 
                          : 'hover:bg-slate-50/80'
                      }`}
                    >
                      {/* Name & Login */}
                      <td className="px-4 py-3.5">
                        <div className="font-bold text-slate-900 flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-xs shrink-0">
                            {member.name.charAt(0)}
                          </div>
                          <div>
                            <div className="text-slate-900">{member.name}</div>
                            <div className="font-mono text-[11px] text-slate-400">@{member.username}</div>
                          </div>
                        </div>
                        {member.notes && (
                          <div className="text-[10px] text-slate-400 mt-1 truncate max-w-xs pl-9">
                            {member.notes}
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5">
                        <div className="space-y-1">
                          {member.isOnline ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-bold">
                              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                              На смене (активен)
                            </span>
                          ) : member.isActive ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-medium">
                              <span className="w-2 h-2 rounded-full bg-slate-400" />
                              Не на смене
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-50 text-rose-800 border border-rose-200 text-[11px] font-medium">
                              <XCircle className="w-3 h-3 text-rose-600" />
                              Заблокирован
                            </span>
                          )}
                          <div className="text-[10px] text-slate-400 flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                            {member.lastLoginAt 
                              ? `Вход: ${new Date(member.lastLoginAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}`
                              : 'Ещё не входил'}
                          </div>
                        </div>
                      </td>

                      {/* Calls Count */}
                      <td className="px-4 py-3.5 text-center">
                        <div className="font-bold text-sm text-slate-900">
                          {member.totalCalls}
                        </div>
                        <div className="flex items-center justify-center gap-2 mt-1 text-[10px]">
                          <span className="text-emerald-700 font-medium" title="Записи">
                            📅 {member.bookingsCount}
                          </span>
                          <span className="text-slate-400">•</span>
                          <span className="text-blue-700 font-medium" title="Консультации">
                            💬 {member.consultationsCount}
                          </span>
                          {member.disputesCount > 0 && (
                            <>
                              <span className="text-slate-400">•</span>
                              <span className="text-rose-700 font-bold" title="Споры/конфликты">
                                ⚠️ {member.disputesCount}
                              </span>
                            </>
                          )}
                        </div>
                      </td>

                      {/* Conversion */}
                      <td className="px-4 py-3.5 text-center">
                        <div className="font-bold text-xs text-slate-800">
                          {member.conversionRate}%
                        </div>
                        <div className="w-20 bg-slate-100 h-1.5 rounded-full mx-auto mt-1 overflow-hidden">
                          <div 
                            className="bg-emerald-600 h-full rounded-full transition-all"
                            style={{ width: `${Math.min(100, member.conversionRate)}%` }}
                          />
                        </div>
                      </td>

                      {/* Average Score */}
                      <td className="px-4 py-3.5 text-center">
                        {member.averageScore !== null ? (
                          <div className="inline-flex flex-col items-center">
                            <span className={`px-2.5 py-0.5 rounded-full border text-xs ${getScoreBadgeColor(member.averageScore)}`}>
                              {member.averageScore} / 10
                            </span>
                            <div className="flex items-center gap-0.5 text-amber-500 mt-1">
                              {[1, 2, 3, 4, 5].map((starIdx) => (
                                <Star 
                                  key={starIdx} 
                                  className={`w-3 h-3 ${
                                    (member.starsScore || 0) >= starIdx 
                                      ? 'fill-amber-400 text-amber-400' 
                                      : 'text-slate-200'
                                  }`} 
                                />
                              ))}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400 text-xs italic">Нет оценок</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedStaff(member);
                          }}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-emerald-50 text-slate-700 hover:text-emerald-800 rounded-lg text-xs font-bold transition-all border border-slate-200 hover:border-emerald-300 inline-flex items-center gap-1"
                        >
                          <span>Разбор</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-xs text-slate-500">
                    {loading ? (
                      <div className="flex items-center justify-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
                        <span>Загрузка данных о персонале...</span>
                      </div>
                    ) : (
                      'Администраторы ресепшена не найдены за выбранный период'
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* DETAILED MODAL: ПЕРСОНАЛЬНЫЙ РАЗБОР АДМИНИСТРАТОРА            */}
      {/* ───────────────────────────────────────────────────────────── */}
      {selectedStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4" id="staff-details-modal">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-purple-800 to-indigo-900 p-5 text-white flex justify-between items-start shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center text-lg font-bold">
                  {selectedStaff.name.charAt(0)}
                </div>
                <div>
                  <h4 className="font-bold text-base flex items-center gap-2">
                    {selectedStaff.name}
                    <span className="font-mono text-xs font-normal text-purple-200 bg-white/10 px-2 py-0.5 rounded">
                      @{selectedStaff.username}
                    </span>
                  </h4>
                  <p className="text-xs text-purple-200/90 mt-0.5">
                    {selectedStaff.notes || 'Администратор стойки ресепшена'} • {selectedStaff.isOnline ? '🟢 Сейчас на смене' : '⚪ Не на смене'}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedStaff(null)} 
                className="text-purple-200 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Scrollable Content */}
            <div className="p-6 overflow-y-auto space-y-5">
              {/* Performance Summary Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="text-slate-500 font-medium">Звонков за период:</div>
                  <div className="text-xl font-bold text-slate-900 mt-1">{selectedStaff.totalCalls}</div>
                  <div className="text-[10px] text-emerald-700 mt-0.5">📅 Записей: {selectedStaff.bookingsCount}</div>
                </div>

                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="text-slate-500 font-medium">Средняя оценка:</div>
                  <div className="text-xl font-bold text-slate-900 mt-1 flex items-baseline gap-1">
                    <span>{selectedStaff.averageScore !== null ? selectedStaff.averageScore : '—'}</span>
                    <span className="text-xs font-normal text-slate-400">/ 10</span>
                  </div>
                  <div className="text-[10px] text-amber-600 mt-0.5">
                    {selectedStaff.starsScore ? `★ ${selectedStaff.starsScore} из 5` : 'Без оценок'}
                  </div>
                </div>

                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="text-slate-500 font-medium">Конверсия в запись:</div>
                  <div className="text-xl font-bold text-blue-700 mt-1">{selectedStaff.conversionRate}%</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">От общего числа звонков</div>
                </div>

                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="text-slate-500 font-medium">Длительность:</div>
                  <div className="text-xl font-bold text-slate-900 mt-1">
                    {Math.floor(selectedStaff.averageDurationSeconds / 60)}м {selectedStaff.averageDurationSeconds % 60}с
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Среднее время звонка</div>
                </div>
              </div>

              {/* 10 Criteria Breakdown */}
              <div>
                <h5 className="font-bold text-xs text-slate-900 flex items-center gap-1.5 mb-2.5">
                  <BarChart3 className="w-4 h-4 text-emerald-600" />
                  Средний балл по 10 критериям оценки работы администратора:
                </h5>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {Object.keys(criteriaLabels).map((key) => {
                    const score = selectedStaff.criteriaAverages[key];
                    return (
                      <div key={key} className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 flex items-center justify-between">
                        <span className="text-slate-700 font-medium text-[11px]">
                          {criteriaLabels[key]}
                        </span>
                        <div className="flex items-center gap-2">
                          {score !== null ? (
                            <>
                              <div className="w-16 bg-slate-200 h-1.5 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full rounded-full ${
                                    score >= 8 ? 'bg-emerald-500' : score >= 6 ? 'bg-amber-500' : 'bg-rose-500'
                                  }`}
                                  style={{ width: `${Math.min(100, score * 10)}%` }}
                                />
                              </div>
                              <span className="font-bold text-slate-900 font-mono w-7 text-right">
                                {score}
                              </span>
                            </>
                          ) : (
                            <span className="text-slate-400 font-mono text-[11px]">—</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Recent Calls by this Staff Member */}
              <div>
                <h5 className="font-bold text-xs text-slate-900 flex items-center gap-1.5 mb-2.5">
                  <FileText className="w-4 h-4 text-purple-600" />
                  Последние звонки администратора ({selectedStaff.recentCalls.length}):
                </h5>
                <div className="space-y-2">
                  {selectedStaff.recentCalls.length > 0 ? (
                    selectedStaff.recentCalls.map((c) => (
                      <div 
                        key={c.call_id} 
                        className="p-3 bg-slate-50 rounded-xl border border-slate-200 hover:bg-slate-100/80 transition-colors flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 text-xs"
                      >
                        <div className="space-y-0.5">
                          <div className="font-bold text-slate-900 flex items-center gap-2">
                            <span>{c.client_phone_masked || c.client_name || 'Гость'}</span>
                            <span className="text-slate-400 font-normal font-mono text-[10px]">
                              {new Date(c.timestamp).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold ${
                              c.booking_status === 'согласие' || c.call_outcome === 'запись'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-200 text-slate-700'
                            }`}>
                              {c.booking_status === 'согласие' || c.call_outcome === 'запись' ? 'Запись оформлена' : c.call_outcome}
                            </span>
                          </div>
                          {c.summary && (
                            <p className="text-[11px] text-slate-600 line-clamp-1 max-w-xl">
                              {c.summary}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                          {c.score !== null && (
                            <span className={`px-2 py-0.5 rounded text-[11px] border ${getScoreBadgeColor(c.score)}`}>
                              {c.score} / 10
                            </span>
                          )}
                          {onSelectCall && (
                            <button
                              type="button"
                              onClick={() => {
                                onSelectCall(c.call_id);
                                setSelectedStaff(null);
                              }}
                              className="px-2 py-1 bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-800 border border-slate-200 rounded text-[11px] font-bold flex items-center gap-1"
                            >
                              <span>Открыть</span>
                              <ArrowUpRight className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-4 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
                      Нет звонков за выбранный период
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setSelectedStaff(null)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl"
              >
                Закрыть разбор
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
