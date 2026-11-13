/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, UserPlus, Shield, KeyRound, Edit2, Trash2, 
  CheckCircle2, XCircle, AlertCircle, RefreshCw, Sparkles, X,
  Headphones, Copy, Check, Eye, EyeOff, Key, ShieldCheck, Lock
} from 'lucide-react';
import { UserRole } from '../../types.js';

interface UserItem {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  createdAt: string;
  updatedAt?: string;
  lastLoginAt?: string;
  isActive: boolean;
  notes?: string;
}

interface UsersManagementProps {
  authToken?: string | null;
  currentUserId?: string;
  userRole?: UserRole;
}

export function UsersManagement({ authToken, currentUserId, userRole = 'admin' }: UsersManagementProps) {
  const isManager = userRole === 'manager';
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'reception' | 'management'>(isManager ? 'reception' : 'all');

  // Generic Create Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('operator');
  const [newNotes, setNewNotes] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createShowPassword, setCreateShowPassword] = useState(false);

  // Dedicated Receptionist Credentials Modal (Create or Edit login/password)
  const [isReceptionModalOpen, setIsReceptionModalOpen] = useState(false);
  const [receptionTargetUser, setReceptionTargetUser] = useState<UserItem | null>(null);
  const [receptionLogin, setReceptionLogin] = useState('');
  const [receptionName, setReceptionName] = useState('');
  const [receptionPassword, setReceptionPassword] = useState('');
  const [receptionNotes, setReceptionNotes] = useState('');
  const [receptionIsActive, setReceptionIsActive] = useState(true);
  const [receptionShowPassword, setReceptionShowPassword] = useState(false);
  const [receptionSubmitting, setReceptionSubmitting] = useState(false);
  const [copiedText, setCopiedText] = useState(false);

  // Edit Modal (general)
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('operator');
  const [editPassword, setEditPassword] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editNotes, setEditNotes] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editShowPassword, setEditShowPassword] = useState(false);

  const getHeaders = () => {
    const h: Record<string, string> = { 
      'Content-Type': 'application/json',
      'x-user-role': userRole,
    };
    if (authToken) h['Authorization'] = `Bearer ${authToken}`;
    return h;
  };

  const generateStrongPassword = () => {
    const prefixes = ['Salon', 'Beauty', 'Style', 'Look', 'Glow', 'Charm', 'Studio'];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const num = Math.floor(100 + Math.random() * 900);
    return `${prefix}#${num}!`;
  };

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/users', { headers: getHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Ошибка загрузки пользователей');
      }
      const data = await res.json();
      setUsers(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const receptionists = useMemo(() => {
    return users.filter(u => u.role === 'operator');
  }, [users]);

  const filteredUsers = useMemo(() => {
    if (activeTab === 'reception') {
      return users.filter(u => u.role === 'operator');
    }
    if (activeTab === 'management') {
      return users.filter(u => u.role === 'admin' || u.role === 'manager');
    }
    return users;
  }, [users, activeTab]);

  // Open modal to assign/edit login & password for a receptionist
  const openSetReceptionCredentials = (existing?: UserItem) => {
    setError(null);
    setSuccessMsg(null);
    setCopiedText(false);
    setReceptionShowPassword(true);

    if (existing) {
      setReceptionTargetUser(existing);
      setReceptionLogin(existing.username);
      setReceptionName(existing.name);
      setReceptionPassword('');
      setReceptionNotes(existing.notes || '');
      setReceptionIsActive(existing.isActive);
    } else {
      const count = receptionists.length + 1;
      setReceptionTargetUser(null);
      setReceptionLogin(`reception_${count}`);
      setReceptionName(`Администратор ресепшена ${count}`);
      setReceptionPassword(generateStrongPassword());
      setReceptionNotes('Прием звонков, запись клиентов к мастерам (смена 2/2)');
      setReceptionIsActive(true);
    }
    setIsReceptionModalOpen(true);
  };

  const handleSaveReceptionCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setReceptionSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      if (receptionTargetUser) {
        // Update existing receptionist
        const body: any = {
          username: receptionLogin.trim().toLowerCase(),
          name: receptionName.trim(),
          role: 'operator',
          isActive: receptionIsActive,
          notes: receptionNotes.trim(),
        };
        if (receptionPassword.trim().length >= 6) {
          body.password = receptionPassword.trim();
        }

        const res = await fetch(`/api/admin/users/${receptionTargetUser.id}/set-credentials`, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify(body),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ошибка сохранения учетных данных');

        setSuccessMsg(data.message || `Логин и пароль для «${receptionName}» успешно обновлены`);
      } else {
        // Create brand new receptionist
        if (!receptionPassword || receptionPassword.trim().length < 6) {
          throw new Error('Пароль администратора ресепшена должен содержать не менее 6 знаков');
        }

        const res = await fetch('/api/admin/users', {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({
            username: receptionLogin.trim().toLowerCase(),
            name: receptionName.trim(),
            password: receptionPassword.trim(),
            role: 'operator',
            notes: receptionNotes.trim(),
          }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ошибка создания администратора ресепшена');

        setSuccessMsg(`Администратор ресепшена «${data.name}» (логин: @${data.username}) успешно создан`);
      }

      setIsReceptionModalOpen(false);
      await loadUsers();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setReceptionSubmitting(false);
    }
  };

  const handleCopyCredentials = () => {
    const text = `Вход в систему Remix CallQA:\nЛогин: ${receptionLogin}\nПароль: ${receptionPassword || '(текущий пароль без изменений)'}\nРоль: Администратор ресепшена`;
    navigator.clipboard.writeText(text);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 3000);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          username: newUsername.trim().toLowerCase(),
          name: newName.trim(),
          password: newPassword.trim(),
          role: newRole,
          notes: newNotes.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка создания пользователя');

      setIsCreateOpen(false);
      setNewUsername('');
      setNewName('');
      setNewPassword('');
      setNewNotes('');
      setSuccessMsg(`Пользователь «${data.username}» успешно создан`);
      await loadUsers();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreateSubmitting(false);
    }
  };

  const startEdit = (u: UserItem) => {
    setEditingUser(u);
    setEditUsername(u.username);
    setEditName(u.name);
    setEditRole(u.role);
    setEditPassword('');
    setEditIsActive(u.isActive);
    setEditNotes(u.notes || '');
    setEditShowPassword(false);
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setEditSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const body: any = {
        username: editUsername.trim().toLowerCase(),
        name: editName.trim(),
        role: editRole,
        isActive: editIsActive,
        notes: editNotes.trim(),
      };
      if (editPassword.trim().length >= 6) {
        body.password = editPassword.trim();
      }

      const res = await fetch(`/api/admin/users/${editingUser.id}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка обновления пользователя');

      setEditingUser(null);
      setSuccessMsg(`Данные пользователя «${data.username}» обновлены`);
      await loadUsers();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDeleteUser = async (u: UserItem) => {
    if (!confirm(`Вы действительно хотите удалить пользователя @${u.username} (${u.name})?`)) {
      return;
    }

    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка удаления пользователя');

      setSuccessMsg(data.message || 'Пользователь удален');
      await loadUsers();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return <span className="bg-red-50 text-red-700 border border-red-200 px-2.5 py-0.5 rounded-full text-[11px] font-bold">👑 Администратор салона</span>;
      case 'manager':
        return <span className="bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-0.5 rounded-full text-[11px] font-bold">👔 Управляющий</span>;
      case 'operator':
        return <span className="bg-purple-50 text-purple-700 border border-purple-200 px-2.5 py-0.5 rounded-full text-[11px] font-bold">🎧 Администратор ресепшена</span>;
      case 'viewer':
        return <span className="bg-slate-100 text-slate-700 border border-slate-200 px-2.5 py-0.5 rounded-full text-[11px] font-bold">👁️ Наблюдатель</span>;
    }
  };

  return (
    <div className="space-y-5" id="users-management-section">
      {/* Receptionist Quick Feature Spotlight Banner */}
      <div className="bg-gradient-to-r from-purple-900 via-indigo-900 to-slate-900 rounded-2xl p-5 text-white shadow-md relative overflow-hidden border border-purple-700/40">
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-200 border border-purple-400/30 text-[11px] font-bold">
              <Headphones className="w-3.5 h-3.5 text-purple-300" />
              {isManager ? 'Управление ресепшеном (Управляющий / Администратор)' : 'Функционал администратора салона'}
            </div>
            <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              Логины и пароли администраторов ресепшена
            </h3>
            <p className="text-xs text-purple-200/90 max-w-2xl leading-relaxed">
              Назначайте и меняйте логины и пароли для сотрудников стойки ресепшена. Администраторы ресепшена получают доступ к карточкам звонков, дословным стенограммам и рекомендациям речевых стандартов.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => openSetReceptionCredentials()}
              className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 active:bg-purple-700 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-2 border border-purple-400/40"
              id="btn-add-receptionist"
            >
              <KeyRound className="w-4 h-4 text-purple-200" />
              Задать логин и пароль новому администратору
            </button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4 pt-4 border-t border-white/10 text-xs">
          <div className="bg-white/5 rounded-xl p-2.5 border border-white/10">
            <div className="text-[10px] text-purple-200">Администраторов ресепшена:</div>
            <div className="text-base font-bold text-white mt-0.5">{receptionists.length} сотр.</div>
          </div>
          <div className="bg-white/5 rounded-xl p-2.5 border border-white/10">
            <div className="text-[10px] text-purple-200">Активных учетных записей:</div>
            <div className="text-base font-bold text-emerald-300 mt-0.5">
              {receptionists.filter(r => r.isActive).length} активны
            </div>
          </div>
          <div className="bg-white/5 rounded-xl p-2.5 border border-white/10">
            <div className="text-[10px] text-purple-200">Таймаут неактивности:</div>
            <div className="text-base font-bold text-amber-300 mt-0.5">4 часа (152-ФЗ)</div>
          </div>
          <div className="bg-white/5 rounded-xl p-2.5 border border-white/10">
            <div className="text-[10px] text-purple-200">Шифрование паролей:</div>
            <div className="text-base font-bold text-teal-300 mt-0.5">PBKDF2-SHA512</div>
          </div>
        </div>
      </div>

      {/* Top Controls & Navigation Tabs */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-3 rounded-xl border border-slate-200">
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'all'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Все сотрудники ({users.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('reception')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeTab === 'reception'
                ? 'bg-purple-600 text-white shadow-xs'
                : 'text-purple-700 bg-purple-50 hover:bg-purple-100'
            }`}
          >
            <Headphones className="w-3.5 h-3.5" />
            Администраторы ресепшена ({receptionists.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('management')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'management'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Управляющие и руководство ({users.filter(u => u.role === 'admin' || u.role === 'manager').length})
          </button>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <button
            type="button"
            onClick={loadUsers}
            disabled={loading}
            className="p-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-600 transition-colors"
            title="Обновить список пользователей"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
            id="add-other-user-btn"
          >
            <UserPlus className="w-4 h-4" /> Другой пользователь
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-rose-800">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-emerald-800">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Users Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs" id="users-table">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
              <tr>
                <th className="px-4 py-3">Сотрудник / ФИО</th>
                <th className="px-4 py-3">Логин в системе</th>
                <th className="px-4 py-3">Роль доступа</th>
                <th className="px-4 py-3">Статус</th>
                <th className="px-4 py-3">Последний вход</th>
                <th className="px-4 py-3 text-right">Назначить логин / пароль</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.map((u) => {
                const isReception = u.role === 'operator';
                const canManageRow = !isManager || (u.role !== 'admin' && u.role !== 'manager');
                const restrictedTitle = 'Редактирование руководства доступно только главному администратору';
                return (
                  <tr key={u.id} className={`hover:bg-slate-50/70 transition-colors ${isReception ? 'bg-purple-50/20' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900 flex items-center gap-1.5">
                        {isReception && <Headphones className="w-3.5 h-3.5 text-purple-600" />}
                        {u.name}
                      </div>
                      {u.notes && <div className="text-[11px] text-slate-400 truncate max-w-xs">{u.notes}</div>}
                    </td>
                    <td className="px-4 py-3 font-mono font-medium text-slate-800">
                      <span className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded-md border border-slate-200">
                        @{u.username}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {getRoleBadge(u.role)}
                    </td>
                    <td className="px-4 py-3">
                      {u.isActive ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Активен
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-700 font-medium">
                          <XCircle className="w-3.5 h-3.5 text-rose-600" /> Заблокирован
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-[11px]">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('ru-RU') : 'Ещё не входил'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Direct Set Login & Password Button */}
                        <button
                          type="button"
                          onClick={() => openSetReceptionCredentials(u)}
                          disabled={!canManageRow}
                          className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all flex items-center gap-1 ${
                            !canManageRow
                              ? 'bg-slate-50 text-slate-300 border border-slate-100 cursor-not-allowed'
                              : isReception
                                ? 'bg-purple-100 text-purple-800 hover:bg-purple-200 border border-purple-200'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                          }`}
                          title={!canManageRow ? restrictedTitle : `Задать логин и пароль для ${u.name}`}
                        >
                          <KeyRound className="w-3 h-3" />
                          <span>Задать пароль</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => startEdit(u)}
                          disabled={!canManageRow}
                          className={`p-1.5 rounded-lg transition-colors ${
                            !canManageRow
                              ? 'text-slate-300 cursor-not-allowed'
                              : 'text-slate-600 hover:text-emerald-700 hover:bg-emerald-50'
                          }`}
                          title={!canManageRow ? restrictedTitle : 'Редактировать профиль пользователя'}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteUser(u)}
                          disabled={u.role === 'admin' || !canManageRow}
                          className={`p-1.5 rounded-lg transition-colors ${
                            u.role === 'admin' || !canManageRow
                              ? 'text-slate-300 cursor-not-allowed'
                              : 'text-slate-500 hover:text-rose-700 hover:bg-rose-50'
                          }`}
                          title={
                            u.role === 'admin'
                              ? 'Администратора нельзя удалить'
                              : !canManageRow
                                ? restrictedTitle
                                : 'Удалить учетную запись'
                          }
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Info note about 4-hour inactivity & self-service password changes */}
      <div className="bg-indigo-50/70 border border-indigo-200/80 rounded-xl p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-indigo-900">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-indigo-600 shrink-0" />
          <span>
            <strong>Политика безопасности 152-ФЗ:</strong> Сессия любого пользователя автоматически завершается через 4 часа отсутствия активности. При запуске приложения обязателен ввод логина и пароля.
          </span>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* MODAL: ЗАДАТЬ ЛОГИН И ПАРОЛЬ АДМИНИСТРАТОРА РЕСЕПШЕНА          */}
      {/* ───────────────────────────────────────────────────────────── */}
      {isReceptionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4" id="receptionist-credentials-modal">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-purple-800 to-indigo-900 p-5 text-white flex justify-between items-start">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                  <Headphones className="w-5 h-5 text-purple-200" />
                </div>
                <div>
                  <h4 className="font-bold text-sm">
                    {receptionTargetUser 
                      ? `Логин и пароль: ${receptionTargetUser.name}`
                      : 'Новый администратор ресепшена'}
                  </h4>
                  <p className="text-[11px] text-purple-200/90 mt-0.5">
                    Управление доступом к стойке и входящим звонкам
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setIsReceptionModalOpen(false)} 
                className="text-purple-200 hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSaveReceptionCredentials} className="p-5 space-y-4">
              {/* ФИО администратора */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  ФИО администратора ресепшена*
                </label>
                <input
                  type="text"
                  required
                  value={receptionName}
                  onChange={(e) => setReceptionName(e.target.value)}
                  placeholder="например, Анна Васильева (Ресепшен)"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-purple-500 focus:bg-white focus:outline-hidden"
                  id="receptionist-name-input"
                />
              </div>

              {/* Логин */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-700">
                    Логин для входа в систему*
                  </label>
                  <span className="text-[10px] text-slate-400">латинские буквы и цифры</span>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-slate-400 font-mono text-xs">@</span>
                  <input
                    type="text"
                    required
                    minLength={3}
                    value={receptionLogin}
                    onChange={(e) => setReceptionLogin(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                    placeholder="reception_anna"
                    className="w-full pl-7 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-purple-500 focus:bg-white focus:outline-hidden"
                    id="receptionist-login-input"
                  />
                </div>
              </div>

              {/* Пароль */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-700">
                    {receptionTargetUser ? 'Задать новый пароль (не менее 6 знаков)' : 'Пароль учетной записи*'}
                  </label>
                  <button
                    type="button"
                    onClick={() => setReceptionPassword(generateStrongPassword())}
                    className="text-[11px] font-bold text-purple-700 hover:text-purple-800 flex items-center gap-1"
                    title="Сгенерировать надежный пароль"
                  >
                    <Sparkles className="w-3 h-3 text-amber-500" /> Сгенерировать
                  </button>
                </div>

                <div className="relative">
                  <Key className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type={receptionShowPassword ? 'text' : 'password'}
                    required={!receptionTargetUser}
                    minLength={receptionPassword ? 6 : undefined}
                    value={receptionPassword}
                    onChange={(e) => setReceptionPassword(e.target.value)}
                    placeholder={receptionTargetUser ? 'Оставьте пустым, чтобы не менять пароль' : 'Введите надежный пароль'}
                    className="w-full pl-9 pr-10 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-purple-500 focus:bg-white focus:outline-hidden"
                    id="receptionist-password-input"
                  />
                  <button
                    type="button"
                    onClick={() => setReceptionShowPassword(p => !p)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 p-0.5"
                    title={receptionShowPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  >
                    {receptionShowPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {receptionPassword && (
                  <div className="flex items-center justify-between mt-1.5 bg-slate-50 border border-slate-200 rounded-lg p-2 text-[11px]">
                    <span className="font-mono text-purple-800 font-bold">{receptionPassword}</span>
                    <button
                      type="button"
                      onClick={handleCopyCredentials}
                      className="px-2 py-0.5 bg-white hover:bg-slate-100 border border-slate-200 rounded text-slate-700 font-medium flex items-center gap-1"
                    >
                      {copiedText ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-600" />
                          <span className="text-emerald-700 font-bold">Скопировано!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3 text-slate-500" />
                          <span>Скопировать логин и пароль</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* Рабочая смена / Примечание */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Рабочая смена / Примечание</label>
                <input
                  type="text"
                  value={receptionNotes}
                  onChange={(e) => setReceptionNotes(e.target.value)}
                  placeholder="например, Смена 2/2, запись к топ-мастерам"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-purple-500 focus:bg-white focus:outline-hidden"
                />
              </div>

              {/* Статус активности */}
              <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                <span className="text-xs font-bold text-slate-800">Статус учетной записи:</span>
                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-800">
                  <input
                    type="checkbox"
                    checked={receptionIsActive}
                    onChange={(e) => setReceptionIsActive(e.target.checked)}
                    className="rounded text-purple-600 focus:ring-purple-500 w-4 h-4"
                  />
                  {receptionIsActive ? (
                    <span className="text-emerald-700 font-bold">Активен (вход разрешен)</span>
                  ) : (
                    <span className="text-rose-700 font-bold">Заблокирован</span>
                  )}
                </label>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsReceptionModalOpen(false)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={receptionSubmitting}
                  className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-400 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-1.5"
                  id="receptionist-save-btn"
                >
                  {receptionSubmitting ? (
                    <span>Сохранение...</span>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Сохранить логин и пароль</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* MODAL: СОЗДАНИЕ ДРУГОГО ПОЛЬЗОВАТЕЛЯ (Управляющий, Аудитор)  */}
      {/* ───────────────────────────────────────────────────────────── */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 p-4 text-white flex justify-between items-center">
              <h4 className="font-bold text-sm flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-emerald-400" /> Добавление нового пользователя
              </h4>
              <button onClick={() => setIsCreateOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateUser} className="p-5 space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Имя пользователя (Логин)*</label>
                <input
                  type="text"
                  required
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                  placeholder="например, manager_elena"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-slate-900 focus:bg-white focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ФИО / Отображаемое имя*</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="например, Елена Маркова (Управляющий)"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-slate-900 focus:bg-white focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Роль доступа*</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-slate-900 focus:bg-white focus:outline-hidden"
                >
                  <option value="operator">🎧 Оператор (Администратор ресепшена салона)</option>
                  {!isManager && <option value="manager">👔 Управляющий (Контроль качества & Реестр согласий)</option>}
                  <option value="viewer">👁️ Наблюдатель (Аудитор, только сводная аналитика)</option>
                  {!isManager && <option value="admin">👑 Администратор (Полный доступ к системе и API-ключам)</option>}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-700">Пароль (не менее 6 символов)*</label>
                  <button
                    type="button"
                    onClick={() => setNewPassword(generateStrongPassword())}
                    className="text-[11px] font-bold text-purple-700 hover:text-purple-800 flex items-center gap-1"
                  >
                    <Sparkles className="w-3 h-3 text-amber-500" /> Сгенерировать
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={createShowPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Задайте надежный пароль"
                    className="w-full px-3 pr-10 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-slate-900 focus:bg-white focus:outline-hidden"
                  />
                  <button
                    type="button"
                    onClick={() => setCreateShowPassword(p => !p)}
                    className="absolute right-3 top-2 text-slate-400 hover:text-slate-600 p-0.5"
                  >
                    {createShowPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Примечание / Должность</label>
                <input
                  type="text"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="например, Управление сервисом"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-slate-900 focus:bg-white focus:outline-hidden"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={createSubmitting}
                  className="flex-1 py-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white font-bold text-xs rounded-xl shadow-xs"
                >
                  {createSubmitting ? 'Сохранение...' : 'Создать пользователя'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* MODAL: РЕДАКТИРОВАНИЕ ПОЛЬЗОВАТЕЛЯ                             */}
      {/* ───────────────────────────────────────────────────────────── */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 p-4 text-white flex justify-between items-center">
              <h4 className="font-bold text-sm flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-emerald-400" /> Редактирование: @{editingUser.username}
              </h4>
              <button onClick={() => setEditingUser(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleUpdateUser} className="p-5 space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Имя пользователя (Логин)</label>
                <input
                  type="text"
                  required
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-slate-900 focus:bg-white focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ФИО / Отображаемое имя</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-slate-900 focus:bg-white focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Роль доступа</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-slate-900 focus:bg-white focus:outline-hidden"
                >
                  <option value="operator">🎧 Оператор (Администратор ресепшена)</option>
                  {!isManager && <option value="manager">👔 Управляющий</option>}
                  <option value="viewer">👁️ Наблюдатель (Аудитор)</option>
                  {!isManager && <option value="admin">👑 Администратор</option>}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-700">
                    Новый пароль (оставьте пустым, если не меняется)
                  </label>
                  <button
                    type="button"
                    onClick={() => setEditPassword(generateStrongPassword())}
                    className="text-[11px] font-bold text-purple-700 hover:text-purple-800 flex items-center gap-1"
                  >
                    <Sparkles className="w-3 h-3 text-amber-500" /> Сгенерировать
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={editShowPassword ? 'text' : 'password'}
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    placeholder="Минимум 6 знаков для смены пароля"
                    className="w-full px-3 pr-10 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-slate-900 focus:bg-white focus:outline-hidden"
                  />
                  <button
                    type="button"
                    onClick={() => setEditShowPassword(p => !p)}
                    className="absolute right-3 top-2 text-slate-400 hover:text-slate-600 p-0.5"
                  >
                    {editShowPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Статус учетной записи</label>
                <div className="flex items-center gap-4 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-800">
                    <input
                      type="radio"
                      name="editIsActive"
                      checked={editIsActive}
                      onChange={() => setEditIsActive(true)}
                      className="text-emerald-600 focus:ring-emerald-500"
                    />
                    Активен
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-800">
                    <input
                      type="radio"
                      name="editIsActive"
                      checked={!editIsActive}
                      onChange={() => setEditIsActive(false)}
                      className="text-rose-600 focus:ring-rose-500"
                    />
                    Заблокирован
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Заметки / Описание</label>
                <input
                  type="text"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-slate-900 focus:bg-white focus:outline-hidden"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting}
                  className="flex-1 py-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white font-bold text-xs rounded-xl shadow-xs"
                >
                  {editSubmitting ? 'Сохранение...' : 'Сохранить изменения'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
