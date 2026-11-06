/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  ListTodo, CheckSquare, Square, CheckCircle2, Clock, 
  Sparkles, ExternalLink, Copy, Plus, Check, Filter, 
  Search, User, Phone, Calendar, Scissors, AlertCircle, 
  ArrowRight, RefreshCw, BarChart2, ShieldCheck, ChevronDown
} from 'lucide-react';
import { CallRecord, NextStepItem, UserRole } from '../types.js';

interface PendingTasksListProps {
  calls: CallRecord[];
  onSelectCall: (callId: string) => void;
  onCallUpdated: (updatedCall: CallRecord) => void;
  userRole: UserRole;
  salonName?: string;
}

export function PendingTasksList({
  calls,
  onSelectCall,
  onCallUpdated,
  userRole,
  salonName = 'Фэшн Лук Студио'
}: PendingTasksListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOperator, setSelectedOperator] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all_pending' | 'zero_progress' | 'in_progress'>('all_pending');
  const [copiedCallId, setCopiedCallId] = useState<string | null>(null);
  const [savingCallId, setSavingCallId] = useState<string | null>(null);
  const [addingTaskForCallId, setAddingTaskForCallId] = useState<string | null>(null);
  const [newTaskText, setNewTaskText] = useState('');

  const canEdit = userRole === 'admin' || userRole === 'manager' || userRole === 'operator';

  // Helper to extract items from call, synthesizing if only legacy next_steps array exists
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

  // Helper to check if call has uncompleted tasks
  const hasUncompletedTasks = (c: CallRecord): boolean => {
    const items = getCallItems(c);
    if (items.length === 0) return false;
    return items.some(item => !item.completed);
  };

  // All calls that have next steps generated and have at least 1 incomplete task
  const pendingCalls = useMemo(() => {
    return calls.filter(hasUncompletedTasks);
  }, [calls]);

  // Unique operators from pending calls
  const operators = useMemo(() => {
    const set = new Set<string>();
    pendingCalls.forEach(c => {
      if (c.operator_name) set.add(c.operator_name);
    });
    return Array.from(set).sort();
  }, [pendingCalls]);

  // Filtered pending calls based on search, operator, and status
  const filteredCalls = useMemo(() => {
    return pendingCalls.filter(call => {
      const items = getCallItems(call);
      const completedCount = items.filter(i => i.completed).length;
      const totalCount = items.length;

      // Status filter
      if (statusFilter === 'zero_progress' && completedCount > 0) return false;
      if (statusFilter === 'in_progress' && (completedCount === 0 || completedCount === totalCount)) return false;

      // Operator filter
      if (selectedOperator !== 'all' && call.operator_name !== selectedOperator) return false;

      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const clientName = (call.client_name || '').toLowerCase();
        const phone = (call.client_phone_masked || call.client_phone || '').toLowerCase();
        const operator = (call.operator_name || '').toLowerCase();
        const service = (call.key_facts?.service || '').toLowerCase();
        const master = (call.key_facts?.master || '').toLowerCase();
        const callId = (call.call_id || '').toLowerCase();
        const hasMatchingTask = items.some(i => i.text.toLowerCase().includes(query));

        if (!clientName.includes(query) &&
            !phone.includes(query) &&
            !operator.includes(query) &&
            !service.includes(query) &&
            !master.includes(query) &&
            !callId.includes(query) &&
            !hasMatchingTask) {
          return false;
        }
      }

      return true;
    });
  }, [pendingCalls, selectedOperator, statusFilter, searchQuery]);

  // Overall statistics
  const stats = useMemo(() => {
    let totalPendingSteps = 0;
    let totalCompletedSteps = 0;
    let totalCallsWithSteps = 0;

    calls.forEach(c => {
      const items = getCallItems(c);
      if (items.length > 0) {
        totalCallsWithSteps++;
        items.forEach(i => {
          if (i.completed) totalCompletedSteps++;
          else totalPendingSteps++;
        });
      }
    });

    const totalSteps = totalPendingSteps + totalCompletedSteps;
    const completionRate = totalSteps > 0 ? Math.round((totalCompletedSteps / totalSteps) * 100) : 100;

    return {
      pendingCallsCount: pendingCalls.length,
      totalPendingSteps,
      totalCompletedSteps,
      totalSteps,
      completionRate,
      totalCallsWithSteps
    };
  }, [calls, pendingCalls]);

  // Handle checking/unchecking a step item
  const handleToggleItem = async (call: CallRecord, stepId: string) => {
    if (!canEdit) return;

    const currentItems = getCallItems(call);
    const updatedItems = currentItems.map(item => 
      item.id === stepId ? { ...item, completed: !item.completed } : item
    );

    const updatedCall: CallRecord = {
      ...call,
      next_steps_items: updatedItems,
      next_steps: updatedItems.map(i => i.text)
    };

    onCallUpdated(updatedCall);
    setSavingCallId(call.call_id);

    try {
      await fetch(`/api/calls/${call.call_id}/next-steps`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ next_steps_items: updatedItems })
      });
    } catch (err) {
      console.error('Ошибка сохранения задачи:', err);
    } finally {
      setTimeout(() => setSavingCallId(null), 500);
    }
  };

  // One-click: mark all tasks in a call as completed
  const handleCompleteAll = async (call: CallRecord) => {
    if (!canEdit) return;

    const currentItems = getCallItems(call);
    const updatedItems = currentItems.map(item => ({ ...item, completed: true }));

    const updatedCall: CallRecord = {
      ...call,
      next_steps_items: updatedItems,
      next_steps: updatedItems.map(i => i.text)
    };

    onCallUpdated(updatedCall);
    setSavingCallId(call.call_id);

    try {
      await fetch(`/api/calls/${call.call_id}/next-steps`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ next_steps_items: updatedItems })
      });
    } catch (err) {
      console.error('Ошибка закрытия задач:', err);
    } finally {
      setTimeout(() => setSavingCallId(null), 500);
    }
  };

  // Add manual step to a call
  const handleAddManualTask = async (call: CallRecord) => {
    if (!newTaskText.trim() || !canEdit) return;

    const currentItems = getCallItems(call);
    const newItem: NextStepItem = {
      id: `task-${Date.now()}`,
      text: newTaskText.trim(),
      completed: false
    };

    const updatedItems = [...currentItems, newItem];
    const updatedCall: CallRecord = {
      ...call,
      next_steps_items: updatedItems,
      next_steps: updatedItems.map(i => i.text)
    };

    onCallUpdated(updatedCall);
    setNewTaskText('');
    setAddingTaskForCallId(null);
    setSavingCallId(call.call_id);

    try {
      await fetch(`/api/calls/${call.call_id}/next-steps`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ next_steps_items: updatedItems })
      });
    } catch (err) {
      console.error('Ошибка добавления задачи:', err);
    } finally {
      setTimeout(() => setSavingCallId(null), 500);
    }
  };

  // Copy tasks for this call
  const handleCopyCallTasks = (call: CallRecord) => {
    const items = getCallItems(call);
    if (items.length === 0) return;

    const textToCopy = [
      `Задачи Next Steps по звонку ${call.call_id}`,
      `Клиент: ${call.client_name || 'Не указан'} (${call.client_phone_masked || call.client_phone || 'Номер скрыт'})`,
      `Услуга: ${call.key_facts?.service || 'Не указана'}, Мастер: ${call.key_facts?.master || 'Не указан'}, Дата: ${call.key_facts?.date || ''} ${call.key_facts?.time || ''}`,
      '----------------------------------------',
      ...items.map((i, idx) => `${idx + 1}. [${i.completed ? 'X' : ' '}] ${i.text}`)
    ].join('\n');

    navigator.clipboard.writeText(textToCopy);
    setCopiedCallId(call.call_id);
    setTimeout(() => setCopiedCallId(null), 3000);
  };

  const maskPhone = (phone?: string) => {
    if (!phone) return '—';
    if (userRole === 'admin' || userRole === 'manager') return phone;
    if (phone.length <= 4) return '****' + phone;
    return '****' + phone.slice(-4);
  };

  return (
    <div className="space-y-6" id="pending-tasks-list-component">
      {/* Top Banner / Metrics Overview */}
      <div className="bg-gradient-to-br from-purple-900 via-indigo-900 to-slate-900 rounded-2xl p-6 text-white shadow-md relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-purple-500/20 border border-purple-400/30 rounded-lg text-purple-200 text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5 text-purple-300" />
              <span>Контроль исполнения «Next Steps» ИИ</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
              <ListTodo className="w-6 h-6 text-purple-300" />
              <span>Звонки с открытыми шагами для администратора</span>
            </h2>
            <p className="text-slate-300 text-xs sm:text-sm max-w-2xl leading-relaxed">
              Реестр звонков салона «{salonName}», по которым сформированы целевые действия (перезвонить клиенту, подтвердить бронирование, направить реквизиты, зафиксировать в расписании), но выполнены ещё не все пункты.
            </p>
          </div>

          {/* Quick Metrics Badges */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 shrink-0">
            <div className="bg-white/10 backdrop-blur-sm border border-white/15 rounded-xl p-3.5 text-center">
              <span className="text-2xl sm:text-3xl font-extrabold text-amber-300 block">
                {stats.pendingCallsCount}
              </span>
              <span className="text-[11px] text-slate-300 font-medium">Звонков в работе</span>
            </div>

            <div className="bg-white/10 backdrop-blur-sm border border-white/15 rounded-xl p-3.5 text-center">
              <span className="text-2xl sm:text-3xl font-extrabold text-purple-200 block">
                {stats.totalPendingSteps}
              </span>
              <span className="text-[11px] text-slate-300 font-medium">Открытых задач</span>
            </div>

            <div className="bg-white/10 backdrop-blur-sm border border-white/15 rounded-xl p-3.5 text-center col-span-2 sm:col-span-1">
              <span className="text-2xl sm:text-3xl font-extrabold text-emerald-300 block">
                {stats.completionRate}%
              </span>
              <span className="text-[11px] text-slate-300 font-medium">
                {stats.totalCompletedSteps} из {stats.totalSteps} решено
              </span>
            </div>
          </div>
        </div>

        {/* Total Progress Bar */}
        {stats.totalSteps > 0 && (
          <div className="mt-5 pt-4 border-t border-white/10 flex items-center gap-4">
            <div className="text-xs text-slate-300 font-medium shrink-0 flex items-center gap-1.5">
              <BarChart2 className="w-4 h-4 text-purple-300" />
              <span>Общий прогресс закрытия задач:</span>
            </div>
            <div className="flex-1 bg-white/10 rounded-full h-2.5 overflow-hidden">
              <div 
                className="bg-gradient-to-r from-purple-400 via-indigo-400 to-emerald-400 h-full rounded-full transition-all duration-500 ease-out"
                style={{ width: `${stats.completionRate}%` }}
              />
            </div>
            <div className="text-xs font-bold text-white shrink-0 font-mono">
              {stats.totalCompletedSteps}/{stats.totalSteps}
            </div>
          </div>
        )}
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3" id="pending-tasks-filter-bar">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
          
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              id="search-pending-tasks-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск по клиенту, телефону, тексту задачи, услуге, мастеру..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
              >
                Очистить
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Status Filter */}
            <div className="flex items-center bg-slate-100 p-1 rounded-xl text-xs font-semibold text-slate-600">
              <button
                onClick={() => setStatusFilter('all_pending')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  statusFilter === 'all_pending'
                    ? 'bg-white text-purple-700 shadow-xs'
                    : 'hover:text-slate-900'
                }`}
              >
                Все открытые ({pendingCalls.length})
              </button>
              <button
                onClick={() => setStatusFilter('zero_progress')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  statusFilter === 'zero_progress'
                    ? 'bg-white text-rose-700 shadow-xs'
                    : 'hover:text-slate-900'
                }`}
              >
                Не начаты
              </button>
              <button
                onClick={() => setStatusFilter('in_progress')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  statusFilter === 'in_progress'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'hover:text-slate-900'
                }`}
              >
                В процессе
              </button>
            </div>

            {/* Operator Filter */}
            {operators.length > 0 && (
              <div className="relative">
                <select
                  value={selectedOperator}
                  onChange={(e) => setSelectedOperator(e.target.value)}
                  className="appearance-none bg-slate-50 border border-slate-200 rounded-xl pl-3 pr-8 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 cursor-pointer"
                >
                  <option value="all">Все операторы ({operators.length})</option>
                  {operators.map(op => (
                    <option key={op} value={op}>{op}</option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            )}
          </div>
        </div>

        {/* Filter Summary & Count */}
        <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100">
          <span>Найдено звонков с открытыми задачами: <strong className="text-slate-800">{filteredCalls.length}</strong></span>
          {canEdit && (
            <span className="text-[11px] text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md font-medium">
              ✓ Отмечайте задачи чекбоксами прямо в списке для синхронизации
            </span>
          )}
        </div>
      </div>

      {/* Main List of Calls with Pending Tasks */}
      {filteredCalls.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-xs space-y-4">
          <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto border border-emerald-100 shadow-xs">
            {searchQuery || selectedOperator !== 'all' || statusFilter !== 'all_pending' ? (
              <Filter className="w-8 h-8 text-slate-400" />
            ) : (
              <CheckCircle2 className="w-8 h-8 text-emerald-600" />
            )}
          </div>
          <div className="space-y-1.5 max-w-md mx-auto">
            <h3 className="text-base font-bold text-slate-800">
              {searchQuery || selectedOperator !== 'all' || statusFilter !== 'all_pending' 
                ? 'Нет звонков по выбранным фильтрам'
                : 'Все задачи Next Steps выполнены!'}
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              {searchQuery || selectedOperator !== 'all' || statusFilter !== 'all_pending'
                ? 'Попробуйте сбросить фильтры поиска или выбрать другого оператора.'
                : 'Отличная работа команды администраторов! Нет звонков с зависшими действиями. Новые задачи формируются автоматически или по кнопке «Сформировать Next Steps» в деталях любого звонка.'}
            </p>
          </div>
          {(searchQuery || selectedOperator !== 'all' || statusFilter !== 'all_pending') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedOperator('all');
                setStatusFilter('all_pending');
              }}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all"
            >
              Сбросить фильтры
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4" id="pending-tasks-cards-container">
          {filteredCalls.map((call) => {
            const items = getCallItems(call);
            const totalTasks = items.length;
            const completedTasks = items.filter(i => i.completed).length;
            const pendingTasksCount = totalTasks - completedTasks;
            const percent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
            const isSaving = savingCallId === call.call_id;
            const isAdding = addingTaskForCallId === call.call_id;

            return (
              <div 
                key={call.call_id}
                className="bg-white border border-slate-200 hover:border-purple-300 rounded-2xl p-5 shadow-xs hover:shadow-md transition-all space-y-4"
                id={`pending-task-card-${call.call_id}`}
              >
                {/* Header Row: Call metadata & Quick Actions */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                        <User className="w-4 h-4 text-purple-600" />
                        {call.client_name || 'Клиент'}
                      </span>
                      <span className="text-xs text-slate-500 font-mono bg-slate-100 px-2 py-0.5 rounded-md flex items-center gap-1">
                        <Phone className="w-3 h-3 text-slate-400" />
                        {maskPhone(call.client_phone_masked || call.client_phone)}
                      </span>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {call.call_id}
                      </span>
                      {call.is_demo && (
                        <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">
                          Демо
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        {call.timestamp ? new Date(call.timestamp).toLocaleString('ru-RU', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit'
                        }) : '—'}
                      </span>
                      <span>•</span>
                      <span>Оператор: <strong className="text-slate-700 font-semibold">{call.operator_name || 'Не указан'}</strong></span>
                      {call.duration_seconds > 0 && (
                        <>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            {Math.floor(call.duration_seconds / 60)} мин {call.duration_seconds % 60} сек
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Badges & Open Call Button */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {call.key_facts?.booking_status && (
                      <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border ${
                        call.key_facts.booking_status === 'согласие'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : call.key_facts.booking_status === 'отказ'
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}>
                        Запись: {call.key_facts.booking_status}
                      </span>
                    )}

                    {call.key_facts?.service && (
                      <span className="text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-200 px-2.5 py-1 rounded-lg flex items-center gap-1">
                        <Scissors className="w-3 h-3 text-purple-600" />
                        {call.key_facts.service}
                      </span>
                    )}

                    {call.key_facts?.master && (
                      <span className="text-[11px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 px-2.5 py-1 rounded-lg">
                        Мастер: {call.key_facts.master}
                      </span>
                    )}

                    <button
                      onClick={() => onSelectCall(call.call_id)}
                      className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer ml-auto sm:ml-0"
                      title="Открыть детальный анализ звонка"
                    >
                      <span>Открыть звонок</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Progress Bar & Counter */}
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="flex items-center gap-1.5 font-bold text-xs text-slate-800 shrink-0">
                      <ListTodo className="w-4 h-4 text-purple-600" />
                      <span>{completedTasks} из {totalTasks} выполнено</span>
                      <span className="text-purple-600 font-mono">({percent}%)</span>
                    </div>

                    <div className="flex-1 bg-slate-200 rounded-full h-2 overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all duration-300 ${
                          percent === 100 
                            ? 'bg-emerald-500' 
                            : percent > 0 
                            ? 'bg-purple-600' 
                            : 'bg-rose-400'
                        }`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                    {isSaving && (
                      <span className="text-[11px] text-purple-600 flex items-center gap-1 animate-pulse font-medium">
                        <RefreshCw className="w-3 h-3 animate-spin" /> Сохранение...
                      </span>
                    )}

                    {canEdit && percent < 100 && (
                      <button
                        onClick={() => handleCompleteAll(call)}
                        className="px-2.5 py-1 bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-300 hover:border-emerald-400 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                        title="Отметить все шаги звонка как выполненные"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Отметить все</span>
                      </button>
                    )}

                    <button
                      onClick={() => handleCopyCallTasks(call)}
                      className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-lg text-xs font-medium transition-all flex items-center gap-1 cursor-pointer"
                      title="Скопировать список задач в буфер обмена"
                    >
                      {copiedCallId === call.call_id ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="text-emerald-700 font-bold">Скопировано!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-slate-400" />
                          <span>Копировать</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Tasks Interactive Checklist */}
                <div className="space-y-2">
                  {items.map((item, idx) => (
                    <div
                      key={item.id}
                      onClick={() => handleToggleItem(call, item.id)}
                      className={`group flex items-start gap-3 p-3 rounded-xl border transition-all ${
                        item.completed 
                          ? 'bg-emerald-50/40 border-emerald-200/60 text-slate-500' 
                          : 'bg-white border-slate-200/90 hover:border-purple-300 hover:bg-purple-50/20 text-slate-800'
                      } ${canEdit ? 'cursor-pointer' : ''}`}
                    >
                      <button
                        type="button"
                        disabled={!canEdit}
                        className={`mt-0.5 shrink-0 transition-transform ${
                          item.completed 
                            ? 'text-emerald-600' 
                            : 'text-slate-300 group-hover:text-purple-600 group-hover:scale-110'
                        }`}
                        aria-label={item.completed ? 'Отметить невыполненной' : 'Отметить выполненной'}
                      >
                        {item.completed ? (
                          <CheckSquare className="w-5 h-5 fill-emerald-100 text-emerald-600" />
                        ) : (
                          <Square className="w-5 h-5" />
                        )}
                      </button>

                      <div className="flex-1 text-xs sm:text-sm leading-relaxed">
                        <span className={`inline-block mr-2 font-mono text-[11px] font-bold px-1.5 py-0.5 rounded ${
                          item.completed 
                            ? 'bg-emerald-100/70 text-emerald-800' 
                            : 'bg-purple-100 text-purple-800'
                        }`}>
                          #{idx + 1}
                        </span>
                        <span className={item.completed ? 'line-through text-slate-400' : 'font-medium text-slate-800'}>
                          {item.text}
                        </span>
                      </div>

                      {item.completed && (
                        <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-md shrink-0">
                          Выполнено
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Add Custom Step Section */}
                {canEdit && (
                  <div className="pt-2">
                    {isAdding ? (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newTaskText}
                          onChange={(e) => setNewTaskText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddManualTask(call);
                            } else if (e.key === 'Escape') {
                              setAddingTaskForCallId(null);
                              setNewTaskText('');
                            }
                          }}
                          placeholder="Новая задача для администратора (нажмите Enter для добавления)..."
                          className="flex-1 px-3 py-2 text-xs bg-slate-50 border border-purple-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-500/20 text-slate-800 placeholder-slate-400"
                          autoFocus
                        />
                        <button
                          onClick={() => handleAddManualTask(call)}
                          disabled={!newTaskText.trim()}
                          className="px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shrink-0"
                        >
                          Добавить
                        </button>
                        <button
                          onClick={() => {
                            setAddingTaskForCallId(null);
                            setNewTaskText('');
                          }}
                          className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-medium transition-all shrink-0"
                        >
                          Отмена
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <button
                          onClick={() => {
                            setAddingTaskForCallId(call.call_id);
                            setNewTaskText('');
                          }}
                          className="text-xs text-purple-700 hover:text-purple-900 font-semibold flex items-center gap-1.5 py-1 transition-colors cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Добавить задачу к этому звонку</span>
                        </button>

                        {call.next_steps_generated_at && (
                          <span className="text-[10px] text-slate-400 font-mono">
                            Сформировано ИИ: {new Date(call.next_steps_generated_at).toLocaleString('ru-RU', {
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
