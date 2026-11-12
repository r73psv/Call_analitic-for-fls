/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  ShieldCheck, History, Search, Filter, RefreshCw, Key, Settings, 
  Trash2, UserCheck, ShieldAlert, ArrowUpDown, Calendar, Download, 
  CheckCircle2, Clock, Smartphone, User, FileText, ChevronDown, Check,
  AlertTriangle
} from 'lucide-react';
import { AccessLogEntry } from '../../types.js';

interface ActionAuditTabProps {
  authToken?: string | null;
}

interface AuditStats {
  total: number;
  passwordChanges: number;
  settingsChanges: number;
  deletions: number;
  userManagement: number;
  recentCount24h: number;
}

export function ActionAuditTab({ authToken }: ActionAuditTabProps) {
  const [logs, setLogs] = useState<AccessLogEntry[]>([]);
  const [stats, setStats] = useState<AuditStats>({
    total: 0,
    passwordChanges: 0,
    settingsChanges: 0,
    deletions: 0,
    userManagement: 0,
    recentCount24h: 0,
  });
  const [uniqueUsers, setUniqueUsers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedUser, setSelectedUser] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  const fetchAuditLogs = async (silent = false) => {
    if (!silent) setLoading(true);
    setIsRefreshing(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedCategory !== 'all') params.set('category', selectedCategory);
      if (selectedUser !== 'all') params.set('user', selectedUser);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());

      const headers: Record<string, string> = {
        'x-user-role': 'admin',
      };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const res = await fetch(`/api/admin/audit-log?${params.toString()}`, { headers });
      if (!res.ok) {
        throw new Error(`Ошибка сервера (${res.status}): ${res.statusText}`);
      }
      const data = await res.json();
      if (data.success) {
        setLogs(data.logs || []);
        if (data.stats) setStats(data.stats);
        if (Array.isArray(data.uniqueUsers)) setUniqueUsers(data.uniqueUsers);
      } else {
        throw new Error(data.error || 'Не удалось получить журнал аудита');
      }
    } catch (err: any) {
      console.error('Audit fetch error:', err);
      setError(err.message || 'Ошибка загрузки журнала аудита действий');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchAuditLogs();
  }, [selectedCategory, selectedUser]);

  // Handle manual search submit / Enter
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchAuditLogs();
  };

  const handleClearAudit = async () => {
    setIsClearing(true);
    setError(null);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-user-role': 'admin',
      };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      const res = await fetch('/api/admin/audit-log/clear', {
        method: 'POST',
        headers,
      });
      if (!res.ok) {
        throw new Error(`Не удалось очистить журнал (${res.status})`);
      }
      setShowClearConfirm(false);
      setNotification('Журнал аудита очищен. Факт очистки зафиксирован в системе.');
      setTimeout(() => setNotification(null), 5000);
      await fetchAuditLogs(true);
    } catch (err: any) {
      setError(err.message || 'Ошибка очистки аудита');
    } finally {
      setIsClearing(false);
    }
  };

  // Export to CSV
  const handleExportCsv = () => {
    if (logs.length === 0) return;
    const header = ['ID', 'Дата и время', 'Администратор', 'Роль', 'Категория', 'Действие', 'Описание / Ресурс', 'Детали', 'IP адрес'];
    const rows = logs.map(l => [
      l.id || '',
      l.timestamp,
      `"${(l.user || '').replace(/"/g, '""')}"`,
      `"${(l.role || '').replace(/"/g, '""')}"`,
      `"${(l.category || '').replace(/"/g, '""')}"`,
      l.action,
      `"${(l.resource || '').replace(/"/g, '""')}"`,
      `"${(l.details || '').replace(/"/g, '""')}"`,
      l.ip
    ]);

    const csvContent = '\uFEFF' + [header.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit_log_${new Date().toISOString().substring(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getCategoryMeta = (category?: string, action?: string) => {
    switch (category) {
      case 'password':
        return {
          label: 'Смена пароля',
          badgeClass: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/40',
          icon: <Key className="w-3.5 h-3.5 text-amber-600" />
        };
      case 'settings':
        return {
          label: 'Настройки и ключи',
          badgeClass: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/40',
          icon: <Settings className="w-3.5 h-3.5 text-blue-600" />
        };
      case 'delete':
        return {
          label: 'Удаление записей',
          badgeClass: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/40',
          icon: <Trash2 className="w-3.5 h-3.5 text-rose-600" />
        };
      case 'user_management':
        return {
          label: 'Персонал & Доступ',
          badgeClass: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800/40',
          icon: <UserCheck className="w-3.5 h-3.5 text-purple-600" />
        };
      case 'consent':
        return {
          label: 'Согласие 152-ФЗ',
          badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/40',
          icon: <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
        };
      case 'call':
        return {
          label: 'Звонки & Записи',
          badgeClass: 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800/40',
          icon: <Smartphone className="w-3.5 h-3.5 text-teal-600" />
        };
      default:
        if (action === 'delete') {
          return {
            label: 'Удаление',
            badgeClass: 'bg-rose-100 text-rose-800 border-rose-200',
            icon: <Trash2 className="w-3.5 h-3.5 text-rose-600" />
          };
        }
        return {
          label: 'Системное действие',
          badgeClass: 'bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
          icon: <ShieldAlert className="w-3.5 h-3.5 text-slate-500" />
        };
    }
  };

  const formatTimestamp = (iso: string) => {
    try {
      const d = new Date(iso);
      return {
        date: d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        time: d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      };
    } catch {
      return { date: iso, time: '' };
    }
  };

  return (
    <div className="space-y-6" id="audit-log-tab-root">
      {/* Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-medium">
            <History className="w-4 h-4 text-slate-700" /> Всего событий
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1">{stats.total}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">в журнале аудита</div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center gap-2 text-amber-700 text-xs font-medium">
            <Key className="w-4 h-4 text-amber-500" /> Пароли
          </div>
          <div className="text-xl font-bold text-amber-900 mt-1">{stats.passwordChanges}</div>
          <div className="text-[10px] text-amber-600/80 mt-0.5">смена паролей</div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center gap-2 text-blue-700 text-xs font-medium">
            <Settings className="w-4 h-4 text-blue-500" /> Настройки
          </div>
          <div className="text-xl font-bold text-blue-900 mt-1">{stats.settingsChanges}</div>
          <div className="text-[10px] text-blue-600/80 mt-0.5">ключи и конфиг</div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center gap-2 text-rose-700 text-xs font-medium">
            <Trash2 className="w-4 h-4 text-rose-500" /> Удаления
          </div>
          <div className="text-xl font-bold text-rose-900 mt-1">{stats.deletions}</div>
          <div className="text-[10px] text-rose-600/80 mt-0.5">записи и логи</div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center gap-2 text-purple-700 text-xs font-medium">
            <UserCheck className="w-4 h-4 text-purple-500" /> Персонал
          </div>
          <div className="text-xl font-bold text-purple-900 mt-1">{stats.userManagement}</div>
          <div className="text-[10px] text-purple-600/80 mt-0.5">доступ и учетки</div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center gap-2 text-emerald-700 text-xs font-medium">
            <Clock className="w-4 h-4 text-emerald-500" /> За 24 часа
          </div>
          <div className="text-xl font-bold text-emerald-900 mt-1">{stats.recentCount24h}</div>
          <div className="text-[10px] text-emerald-600/80 mt-0.5">свежие действия</div>
        </div>
      </div>

      {notification && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{notification}</span>
        </div>
      )}

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button 
            type="button" 
            onClick={() => fetchAuditLogs()}
            className="text-xs underline font-semibold hover:text-rose-950"
          >
            Повторить
          </button>
        </div>
      )}

      {/* Main Container */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {/* Controls Bar */}
        <div className="p-4 border-b border-slate-200 bg-slate-50/70 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Category Select */}
            <div className="relative">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="appearance-none bg-white border border-slate-300 text-slate-700 text-xs font-medium rounded-xl pl-3 pr-8 py-2 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 shadow-2xs"
                id="audit-category-filter"
              >
                <option value="all">Все категории ({stats.total})</option>
                <option value="password">Смена паролей ({stats.passwordChanges})</option>
                <option value="settings">Настройки и ключи ({stats.settingsChanges})</option>
                <option value="delete">Удаления записей ({stats.deletions})</option>
                <option value="user_management">Управление персоналом ({stats.userManagement})</option>
                <option value="call">Звонки и записи</option>
                <option value="consent">Согласия 152-ФЗ</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* User Select */}
            <div className="relative">
              <select
                value={selectedUser}
                onChange={(e) => setSelectedUser(e.target.value)}
                className="appearance-none bg-white border border-slate-300 text-slate-700 text-xs font-medium rounded-xl pl-3 pr-8 py-2 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 shadow-2xs"
                id="audit-user-filter"
              >
                <option value="all">Все администраторы ({uniqueUsers.length})</option>
                {uniqueUsers.map(u => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* Search Input */}
            <form onSubmit={handleSearchSubmit} className="relative flex-1 min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Поиск по описанию, IP или деталям..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white border border-slate-300 text-slate-800 text-xs rounded-xl pl-8 pr-3 py-2 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 shadow-2xs"
                id="audit-search-input"
              />
            </form>
          </div>

          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={() => fetchAuditLogs()}
              disabled={isRefreshing}
              className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors shadow-2xs disabled:opacity-50"
              title="Обновить журнал аудита"
              id="audit-refresh-button"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-600' : ''}`} />
              <span>Обновить</span>
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              disabled={logs.length === 0}
              className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors shadow-2xs disabled:opacity-50"
              title="Экспорт в CSV для отчетности 152-ФЗ"
              id="audit-export-button"
            >
              <Download className="w-3.5 h-3.5 text-slate-600" />
              <span>CSV</span>
            </button>

            <button
              type="button"
              onClick={() => setShowClearConfirm(true)}
              className="px-3 py-2 bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors shadow-2xs"
              title="Очистить журнал (с фиксацией факта)"
              id="audit-clear-button"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-600" />
              <span>Очистить</span>
            </button>
          </div>
        </div>

        {/* Modal: Clear Confirmation */}
        {showClearConfirm && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-2xs">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
              <div className="flex items-center gap-3 text-rose-600 mb-3">
                <div className="p-3 bg-rose-100 rounded-xl">
                  <AlertTriangle className="w-6 h-6 text-rose-600" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Очистить журнал аудита?</h3>
                  <p className="text-xs text-slate-500">Действие будет зафиксировано в журнале безопасности</p>
                </div>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed mb-5">
                Вы собираетесь очистить текущие записи действий администраторов. 
                В соответствии с требованиями 152-ФЗ, сам факт и время очистки журнала с вашим именем будет сохранён первой записью нового журнала.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowClearConfirm(false)}
                  disabled={isClearing}
                  className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-medium rounded-xl hover:bg-slate-100 transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleClearAudit}
                  disabled={isClearing}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium rounded-xl transition-colors flex items-center gap-1.5"
                  id="confirm-clear-audit-button"
                >
                  {isClearing && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  Подтвердить очистку
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Table Content */}
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center text-slate-400 gap-3">
            <RefreshCw className="w-8 h-8 animate-spin text-emerald-600" />
            <p className="text-xs">Загрузка журнала аудита действий...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="py-20 text-center text-slate-500">
            <ShieldCheck className="w-12 h-12 text-slate-300 mx-auto mb-2" />
            <h4 className="text-sm font-semibold text-slate-700">Записей аудита не найдено</h4>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              {searchQuery || selectedCategory !== 'all' || selectedUser !== 'all'
                ? 'По заданным фильтрам событий не обнаружено. Попробуйте сбросить параметры поиска.'
                : 'Важные изменения (смена паролей, настройки, удаление записей) будут автоматически фиксироваться здесь с привязкой к администратору.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600 border-collapse">
              <thead className="bg-slate-100/70 border-b border-slate-200 text-slate-700 text-[11px] font-bold uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4 w-44">Дата и время</th>
                  <th className="py-3 px-4 w-52">Администратор</th>
                  <th className="py-3 px-4 w-44">Категория</th>
                  <th className="py-3 px-4">Событие / Описание изменения</th>
                  <th className="py-3 px-4 w-32 text-right">IP-адрес</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((entry, index) => {
                  const meta = getCategoryMeta(entry.category, entry.action);
                  const dt = formatTimestamp(entry.timestamp);
                  return (
                    <tr 
                      key={entry.id || index}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      {/* Date & Time */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="font-semibold text-slate-900">{dt.date}</span>
                          <span className="text-[10px] text-slate-400 font-mono">{dt.time}</span>
                        </div>
                      </td>

                      {/* Administrator User */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center text-[11px] shrink-0">
                            {entry.user ? entry.user.charAt(0).toUpperCase() : 'A'}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="font-semibold text-slate-800 truncate" title={entry.user}>
                              {entry.user || 'Главный Администратор'}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {entry.role === 'admin' ? 'Администратор' : (entry.role === 'manager' ? 'Управляющий' : (entry.role || 'Сотрудник'))}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Category Badge */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${meta.badgeClass}`}>
                          {meta.icon}
                          <span>{meta.label}</span>
                        </span>
                      </td>

                      {/* Event / Action Description */}
                      <td className="py-3 px-4">
                        <div className="space-y-0.5">
                          <p className="font-medium text-slate-900 text-xs">
                            {entry.resource}
                          </p>
                          {entry.details && (
                            <p className="text-[11px] text-slate-500 font-mono bg-slate-50 px-2 py-0.5 rounded-md inline-block border border-slate-200/60">
                              {entry.details}
                            </p>
                          )}
                        </div>
                      </td>

                      {/* IP address */}
                      <td className="py-3 px-4 text-right whitespace-nowrap font-mono text-[11px] text-slate-500">
                        {entry.ip}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer info */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center text-[11px] text-slate-500 gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Журнал аудита юридически значим по 152-ФЗ. Срок хранения логов доступа: 365 дней.</span>
          </div>
          <div>
            Отображено записей: <strong className="text-slate-800">{logs.length}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
