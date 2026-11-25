/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  PhoneCall, Settings, Activity, RefreshCw, 
  ShieldAlert, AlertCircle, HardDrive, Shield, ShieldCheck,
  Lock, Unlock, UserCheck, HeartHandshake, Sparkles, 
  CheckCircle2, LogOut, User, Key, KeyRound, BarChart3, Pencil, BookOpen, ListTodo, Headphones
} from 'lucide-react';

import { StatsGrid } from './components/StatsGrid.js';
import { CallList } from './components/CallList.js';
import { CallDetails } from './components/CallDetails.js';
import { RecordingNotice } from './components/RecordingNotice.js';
import { ConsentsTable } from './components/ConsentsTable.js';
import { ModelSelector } from './components/ModelSelector.js';
import { TranscriptionModelSelector, getSttEngineDisplayName } from './components/TranscriptionModelSelector.js';
import { LoginModal } from './components/LoginModal.js';
import { UserPasswordChangeModal } from './components/UserPasswordChangeModal.js';
import { AdminPasswordPromptModal } from './components/AdminPasswordPromptModal.js';
import { AdminPanel } from './components/AdminPanel.js';
import { NotificationToastContainer } from './components/NotificationToastContainer.js';
import { NotificationsBell } from './components/NotificationsBell.js';
import { EditSalonNameModal } from './components/EditSalonNameModal.js';
import { UserGuide } from './components/UserGuide.js';
import { PendingTasksList } from './components/PendingTasksList.js';
import { NextStepsReminderToast } from './components/NextStepsReminderToast.js';
import { SystemPromptEditor } from './components/SystemPromptEditor.js';
import { UsersManagement } from './components/admin/UsersManagement.js';

import { CallRecord, DashboardStats, SystemConfig, LogEntry, GigaChatModel, SttProvider, UserRole } from './types.js';
import { deduplicateCalls } from './services/callUtils.js';
import { DEFAULT_SALON_NAME, SalonThemeId, detectSalonTheme } from './services/salonBranding.js';

interface CurrentUserInfo {
  id: string;
  username: string;
  name: string;
  role: UserRole;
}

async function safeFetchJson<T = any>(
  url: string, 
  options?: RequestInit, 
  authToken?: string | null,
  userRole?: UserRole,
  retries = 4, 
  delay = 1200
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> || {}),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  if (userRole) {
    headers['x-user-role'] = userRole;
  }

  const reqOptions: RequestInit = {
    ...options,
    headers,
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, reqOptions);
      if (!response.ok) {
        if (response.status === 401) {
          const errorData = await response.json().catch(() => ({}));
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('callqa-session-expired', {
              detail: errorData.error || 'Сессия завершена из-за отсутствия активности более 4 часов (152-ФЗ)'
            }));
          }
          const err401: any = new Error(errorData.error || 'Требуется авторизация в системе (401)');
          err401.nonRetryable = true;
          throw err401;
        }
        if (response.status === 429) {
          if (attempt < retries) {
            const retryAfterRaw = response.headers.get('Retry-After');
            const retryAfterSec = retryAfterRaw && /^\d+$/.test(retryAfterRaw.trim())
              ? parseInt(retryAfterRaw.trim(), 10)
              : 0;
            const backoffMs = retryAfterSec > 0
              ? Math.min(retryAfterSec * 1000, 15000)
              : Math.min(2500 * Math.pow(2, attempt - 1), 15000) + Math.floor(Math.random() * 600);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            continue;
          }
          const err429: any = new Error('Слишком много запросов к серверу (429). Пожалуйста, подождите несколько секунд.');
          err429.nonRetryable = true;
          throw err429;
        }
        if (response.status >= 500 && attempt < retries) {
          const waitTime = Math.min(delay * attempt, 4500);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        const errorData = await response.json().catch(() => ({}));
        const clientErr: any = new Error(errorData.error || `Ошибка (${response.status}): ${response.statusText}`);
        if (response.status >= 400 && response.status < 500) {
          clientErr.nonRetryable = true;
        }
        throw clientErr;
      }
      const text = await response.text();
      if (text.trim().startsWith('<')) {
        if (attempt < retries) {
          const waitTime = Math.min(delay * attempt, 4500);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        throw new Error('Сервер вернул HTML вместо JSON. Идет перезапуск.');
      }
      return JSON.parse(text) as T;
    } catch (err: any) {
      if (!err?.nonRetryable && attempt < retries) {
        const waitTime = Math.min(delay * attempt, 4500);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Не удалось установить соединение с сервером.');
}

export default function App() {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    totalCalls: 0,
    disputeRate: 0,
    averageScore: 0,
    successRate: 0,
    toneStats: {
      client: { neutral: 0, discontent: 0, aggressive: 0 },
      manager: { neutral: 0, calm: 0, defensive: 0 }
    }
  });
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'list' | 'details' | 'tasks' | 'stats' | 'consents' | 'prompt' | 'reception' | 'admin' | 'guide'>('list');

  // Count of calls with uncompleted next steps
  const pendingNextStepsCount = React.useMemo(() => {
    return calls.filter(c => {
      if (Array.isArray(c.next_steps_items) && c.next_steps_items.length > 0) {
        return c.next_steps_items.some(i => !i.completed);
      }
      if (Array.isArray(c.next_steps) && c.next_steps.length > 0) {
        return true;
      }
      return false;
    }).length;
  }, [calls]);

  // 4 hours inactivity threshold (152-ФЗ)
  const INACTIVITY_TIMEOUT_MS = 4 * 60 * 60 * 1000;

  // Session expired notice (shown on login screen)
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState<string | null>(() => {
    const token = localStorage.getItem('callqa_auth_token');
    const lastActive = localStorage.getItem('callqa_last_activity');
    if (token && lastActive) {
      if (Date.now() - Number(lastActive) >= 4 * 60 * 60 * 1000) {
        localStorage.removeItem('callqa_auth_token');
        localStorage.removeItem('callqa_user_info');
        localStorage.removeItem('callqa_user_role');
        return 'Сессия завершена из-за отсутствия активности в течение 4 часов (152-ФЗ). Пожалуйста, выполните вход.';
      }
    }
    return null;
  });

  // Auth & Session state
  const [authToken, setAuthToken] = useState<string | null>(() => {
    const lastActive = localStorage.getItem('callqa_last_activity');
    if (lastActive && Date.now() - Number(lastActive) >= 4 * 60 * 60 * 1000) {
      return null;
    }
    return localStorage.getItem('callqa_auth_token') || null;
  });

  const [currentUser, setCurrentUser] = useState<CurrentUserInfo | null>(() => {
    try {
      const lastActive = localStorage.getItem('callqa_last_activity');
      if (lastActive && Date.now() - Number(lastActive) >= 4 * 60 * 60 * 1000) {
        return null;
      }
      const token = localStorage.getItem('callqa_auth_token');
      if (!token) return null;
      const saved = localStorage.getItem('callqa_user_info');
      if (saved) return JSON.parse(saved);
    } catch {}
    // Mandatory authentication: never default to admin without an authenticated session
    return null;
  });

  const userRole: UserRole = currentUser?.role || 'operator';

  // Public branding fetched from server env (SALON_NAME) even before login
  const [publicBranding, setPublicBranding] = useState<{
    salonName: string;
    envSalonName?: string;
    theme: SalonThemeId;
  } | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/public/branding')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        const resolvedName = typeof data.salonName === 'string' && data.salonName.trim()
          ? data.salonName.trim()
          : DEFAULT_SALON_NAME;
        setPublicBranding({
          salonName: resolvedName,
          envSalonName: typeof data.envSalonName === 'string' ? data.envSalonName : '',
          theme: data.theme === 'liq28' ? 'liq28' : detectSalonTheme(resolvedName),
        });
      })
      .catch(() => {
        // Non-fatal fallback
      });
    return () => {
      active = false;
    };
  }, []);

  // Admin gate protection
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [isAdminPasswordModalOpen, setIsAdminPasswordModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(() => !localStorage.getItem('callqa_auth_token'));
  const [isChangePasswordModalOpen, setIsChangePasswordModalOpen] = useState(false);
  const [isEditSalonModalOpen, setIsEditSalonModalOpen] = useState(false);

  // Notification sound preference (for Toast chimes)
  const [soundEnabled, setSoundEnabled] = useState(() => {
    return localStorage.getItem('callqa_sound_enabled') !== 'false';
  });

  const handleToggleSound = () => {
    setSoundEnabled(prev => {
      const next = !prev;
      localStorage.setItem('callqa_sound_enabled', String(next));
      return next;
    });
  };

  const handleSelectCallFromNotification = (callId: string) => {
    setSelectedCallId(callId);
    setActiveTab('details');
    loadData(true);
  };

  const isLoadingDataRef = React.useRef(false);
  const selectedCallIdRef = React.useRef<string | null>(selectedCallId);
  selectedCallIdRef.current = selectedCallId;

  // Synchronize state with backend APIs
  const loadData = async (silent = false) => {
    if (!authToken || !currentUser) return;
    if (isLoadingDataRef.current) return;
    isLoadingDataRef.current = true;
    if (!silent) setLoading(true);
    try {
      const [callsData, statsData, configData, logsData] = await Promise.all([
        safeFetchJson<CallRecord[]>('/api/calls', {}, authToken, userRole),
        safeFetchJson<DashboardStats>('/api/stats', {}, authToken, userRole),
        safeFetchJson<SystemConfig>('/api/config', {}, authToken, userRole),
        safeFetchJson<LogEntry[]>('/api/logs', {}, authToken, userRole).catch(() => [])
      ]);

      const uniqueCalls = deduplicateCalls(callsData || []);
      setCalls(uniqueCalls);
      setStats(statsData);
      setConfig(configData);
      setLogs(logsData || []);

      if (uniqueCalls.length > 0 && !selectedCallIdRef.current) {
        setSelectedCallId(uniqueCalls[0].call_id);
      }
      setError(null);
    } catch (err: any) {
      console.warn('Data loading error:', err?.message || err);
      // Only set visible error if we don't have calls loaded yet, or during explicit (non-silent) manual fetch
      if (!silent || calls.length === 0) {
        setError(err.message || 'Ошибка подключения к серверу');
      }
    } finally {
      isLoadingDataRef.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authToken || !currentUser?.id) return;
    loadData();
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      loadData(true);
    }, 30000);
    return () => clearInterval(timer);
  }, [userRole, authToken, currentUser?.id]);

  const handleLogout = async (reason?: string) => {
    try {
      if (authToken) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${authToken}` },
        });
      }
    } catch {}
    localStorage.removeItem('callqa_auth_token');
    localStorage.removeItem('callqa_user_info');
    localStorage.removeItem('callqa_user_role');
    localStorage.removeItem('callqa_last_activity');
    setAuthToken(null);
    setCurrentUser(null);
    setIsAdminUnlocked(false);
    setIsLoginModalOpen(true);
    if (reason && typeof reason === 'string') {
      setSessionExpiredNotice(reason);
    }
  };

  const handleLoginSuccess = (user: CurrentUserInfo, token: string) => {
    setCurrentUser(user);
    setAuthToken(token);
    setIsLoginModalOpen(false);
    setSessionExpiredNotice(null);
    localStorage.setItem('callqa_last_activity', String(Date.now()));
    // Reset admin lock on user change
    setIsAdminUnlocked(false);
    if (user.role !== 'admin' && activeTab === 'admin') {
      setActiveTab('list');
    }
  };

  // 4-Hour Inactivity Tracker (152-ФЗ)
  useEffect(() => {
    if (!authToken || !currentUser) return;

    if (!localStorage.getItem('callqa_last_activity')) {
      localStorage.setItem('callqa_last_activity', String(Date.now()));
    }

    let lastRecorded = Date.now();

    const handleUserActivity = () => {
      const now = Date.now();
      // Throttle localStorage updates to at most once per 10 seconds
      if (now - lastRecorded > 10000) {
        lastRecorded = now;
        localStorage.setItem('callqa_last_activity', String(now));
      }
    };

    const activityEvents = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
    activityEvents.forEach(evt => window.addEventListener(evt, handleUserActivity, { passive: true }));

    // Periodic check every 30 seconds for 4 hours inactivity timeout
    const interval = setInterval(() => {
      const stored = localStorage.getItem('callqa_last_activity');
      const lastActive = stored ? Number(stored) : lastRecorded;
      const elapsed = Date.now() - lastActive;

      if (elapsed >= INACTIVITY_TIMEOUT_MS) {
        handleLogout('Сессия завершена автоматически из-за отсутствия активности в течение 4 часов (152-ФЗ). Пожалуйста, выполните вход снова.');
      }
    }, 30000);

    return () => {
      activityEvents.forEach(evt => window.removeEventListener(evt, handleUserActivity));
      clearInterval(interval);
    };
  }, [authToken, currentUser]);

  // Session verification on mount & listener for 401 events
  useEffect(() => {
    const handleExpiredEvent = (e: any) => {
      handleLogout(e.detail || 'Сессия завершена из-за отсутствия активности (4 часа)');
    };
    window.addEventListener('callqa-session-expired', handleExpiredEvent);

    if (authToken) {
      fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      })
      .then(res => {
        if (!res.ok) throw new Error('Unauthorized');
        return res.json();
      })
      .then(data => {
        if (!data.authenticated || !data.user) {
          handleLogout('Сессия завершена или истек срок действия. Пожалуйста, выполните вход.');
        } else {
          setCurrentUser(prev => {
            if (
              prev &&
              prev.id === data.user.id &&
              prev.role === data.user.role &&
              prev.username === data.user.username &&
              prev.name === data.user.name
            ) {
              return prev;
            }
            return data.user;
          });
          localStorage.setItem('callqa_last_activity', String(Date.now()));
        }
      })
      .catch(() => {
        // network issue or server restart
      });
    }

    return () => {
      window.removeEventListener('callqa-session-expired', handleExpiredEvent);
    };
  }, []);

  const handleOpenAdminTab = () => {
    if (userRole !== 'admin') {
      alert('Доступ в панель администратора разрешен только пользователям с ролью «Администратор»');
      return;
    }

    if (!isAdminUnlocked) {
      setIsAdminPasswordModalOpen(true);
    } else {
      setActiveTab('admin');
    }
  };

  const handleAdminPasswordSuccess = () => {
    setIsAdminUnlocked(true);
    setIsAdminPasswordModalOpen(false);
    setActiveTab('admin');
  };

  const handleModelChange = async (newModel: GigaChatModel) => {
    if (userRole !== 'admin') return;
    try {
      await safeFetchJson('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_gigachat_model: newModel }),
      }, authToken, userRole);
      if (config) {
        setConfig({
          ...config,
          activeModel: newModel,
          default_gigachat_model: newModel,
        });
      }
      await loadData(true);
    } catch (err: any) {
      console.error('Failed to update model:', err);
    }
  };

  const handleTranscriptionModelChange = async (newStt: SttProvider) => {
    if (userRole !== 'admin') return;
    try {
      await safeFetchJson('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcriptionModel: newStt }),
      }, authToken, userRole);
      if (config) {
        setConfig({
          ...config,
          transcriptionModel: newStt,
        });
      }
      await loadData(true);
    } catch (err: any) {
      console.error('Failed to update transcription model:', err);
      setError(err?.message || 'Не удалось обновить модель транскрибации речи');
    }
  };

  const handleSaveSalonName = async (newName: string): Promise<boolean> => {
    try {
      await safeFetchJson('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonName: newName }),
      }, authToken, userRole);
      if (config) {
        setConfig({
          ...config,
          salonName: newName,
        });
      }
      await loadData(true);
      return true;
    } catch (err: any) {
      console.error('Failed to update salon name:', err);
      alert(`Ошибка обновления названия салона: ${err.message}`);
      return false;
    }
  };

  const handleSendVk = async (id: string) => {
    try {
      const result = await safeFetchJson<any>(`/api/calls/${id}/send-vk`, { 
        method: 'POST',
      }, authToken, userRole);
      await loadData(true);
      return result;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  const handleReanalyze = async (id: string) => {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-user-role': userRole,
      };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      const res = await fetch(`/api/calls/${id}/reanalyze`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config?.default_gigachat_model || 'GigaChat:Lite',
          ...(config?.transcriptionModel
            ? { sttProvider: config.transcriptionModel, forceRetranscribe: false }
            : {}),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (payload?.call && !payload?.preserved_previous_result) {
          setCalls(prev => prev.map(c => c.call_id === id ? payload.call : c));
          await loadData(true);
        }
        console.error('[Reanalyze Error]', payload?.error || `HTTP ${res.status}`);
        return false;
      }
      const updated = payload as CallRecord;
      setCalls(prev => prev.map(c => c.call_id === id ? updated : c));
      await loadData(true);
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  };

  const handleDeleteCall = async (id: string) => {
    try {
      await safeFetchJson(`/api/calls/${id}`, { method: 'DELETE' }, authToken, userRole);
      setCalls(prev => prev.filter(c => c.call_id !== id));
      if (selectedCallId === id) {
        setSelectedCallId(null);
        setActiveTab('list');
      }
      await loadData(true);
    } catch (err: any) {
      alert(`Ошибка удаления звонка: ${err.message}`);
    }
  };

  const handleClearDemoCalls = async () => {
    try {
      await safeFetchJson('/api/calls/clear-demo', { method: 'POST' }, authToken, userRole);
      setCalls(prev => prev.filter(c => !c.is_demo && c.call_id !== 'megafon-call-89101' && c.call_id !== 'megafon-call-89102'));
      if (selectedCallId === 'megafon-call-89101' || selectedCallId === 'megafon-call-89102') {
        setSelectedCallId(null);
        setActiveTab('list');
      }
      await loadData(true);
    } catch (err: any) {
      alert(`Ошибка очистки демо-звонков: ${err.message}`);
    }
  };

  const handleClearLogs = async () => {
    if (userRole !== 'admin') return;
    try {
      await safeFetchJson('/api/logs', { 
        method: 'DELETE',
      }, authToken, userRole);
      setLogs([]);
    } catch (err: any) {
      alert(`Ошибка очистки логов: ${err.message}`);
    }
  };

  const selectedCall = calls.find(c => c.call_id === selectedCallId);

  const getRoleBadgeStyle = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return 'bg-red-50 text-red-700 border-red-200';
      case 'manager':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'operator':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'viewer':
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getRoleLabel = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return '👑 Администратор салона';
      case 'manager':
        return '👔 Управляющий';
      case 'operator':
        return '🎧 Администратор ресепшена';
      case 'viewer':
        return '👁️ Наблюдатель';
    }
  };

  const currentSalonName =
    config?.salonName?.trim() ||
    publicBranding?.salonName?.trim() ||
    DEFAULT_SALON_NAME;
  const salonTheme: SalonThemeId = detectSalonTheme(currentSalonName);
  const isLiq28Theme = salonTheme === 'liq28';

  useEffect(() => {
    document.documentElement.setAttribute('data-salon-theme', salonTheme);
    document.title = `Аудит звонков — ${currentSalonName}`;
  }, [salonTheme, currentSalonName]);

  // Strict Authentication Gate on Launch & 4-Hour Inactivity Timeout (152-ФЗ)
  if (!currentUser || !authToken) {
    return (
      <div
        className={
          isLiq28Theme
            ? 'min-h-screen flex flex-col justify-center items-center p-4 bg-[#FAF7F2]'
            : 'min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4'
        }
        id="applet-auth-gate"
      >
        <LoginModal
          isOpen={true}
          onLoginSuccess={handleLoginSuccess}
          onOpenChangePassword={() => setIsChangePasswordModalOpen(true)}
          salonName={currentSalonName}
          theme={salonTheme}
          sessionExpiredNotice={sessionExpiredNotice}
        />
        {isChangePasswordModalOpen && (
          <UserPasswordChangeModal
            isOpen={isChangePasswordModalOpen}
            onClose={() => setIsChangePasswordModalOpen(false)}
            currentUser={currentUser}
            authToken={authToken}
          />
        )}
      </div>
    );
  }

  return (
    <div
      className={
        isLiq28Theme
          ? 'min-h-screen bg-[#FAF7F2] flex flex-col text-[#1F1B18]'
          : 'min-h-screen bg-slate-50/70 flex flex-col text-slate-800'
      }
      id="applet-viewport"
    >
      {/* App Header */}
      <header
        className={
          isLiq28Theme
            ? 'bg-white/95 border-b border-[#E6DDD1] px-6 py-3.5 sticky top-0 z-40'
            : 'bg-white border-b border-slate-200/80 px-6 py-3.5 sticky top-0 z-40 shadow-xs'
        }
        id="applet-main-header"
      >
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex items-center gap-3">
            {isLiq28Theme ? (
              <div className="bg-[#231F1C] text-[#FAF7F2] px-3 py-2 rounded-xl border border-[#9A7B56]/40 shadow-xs flex items-center justify-center">
                <span className="liq28-display text-base font-semibold tracking-[0.14em] leading-none">
                  LIQ.28
                </span>
              </div>
            ) : (
              <div className="bg-emerald-600 text-white p-2.5 rounded-xl shadow-xs">
                <PhoneCall className="w-5 h-5" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1
                  className={
                    isLiq28Theme
                      ? 'text-base font-semibold text-[#1F1B18] tracking-tight'
                      : 'text-base font-bold text-slate-900 tracking-tight'
                  }
                >
                  {isLiq28Theme ? 'Аудит телефонных звонков' : 'Remix CallQA AI_RU'}
                </h1>
                <span
                  className={
                    isLiq28Theme
                      ? 'text-[#7D6140] text-[10px] font-semibold tracking-wide flex items-center gap-1 border-l border-[#E6DDD1] pl-2'
                      : 'bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1'
                  }
                >
                  <ShieldCheck className={`w-3 h-3 ${isLiq28Theme ? 'text-[#9A7B56]' : 'text-emerald-600'}`} /> 152-ФЗ
                </span>
                <button
                  type="button"
                  onClick={() => setIsEditSalonModalOpen(true)}
                  className={
                    isLiq28Theme
                      ? 'group bg-[#FAF7F2] hover:bg-[#F3ECE2] text-[#2C2621] border border-[#E6DDD1] hover:border-[#9A7B56] text-[11px] font-medium px-2.5 py-0.5 rounded-md transition-all flex items-center gap-1.5 cursor-pointer'
                      : 'group bg-slate-100 hover:bg-emerald-50 text-slate-700 hover:text-emerald-800 border border-slate-200/80 hover:border-emerald-300 text-[10px] font-mono font-medium px-2 py-0.5 rounded-md transition-all flex items-center gap-1 cursor-pointer shadow-3xs'
                  }
                  title="Нажмите, чтобы ввести или изменить название салона красоты"
                  id="header-edit-salon-name-btn"
                >
                  <span>салон «{currentSalonName}»</span>
                  <Pencil
                    className={`w-2.5 h-2.5 transition-colors ${
                      isLiq28Theme
                        ? 'text-[#9A8B7A] group-hover:text-[#7D6140]'
                        : 'text-slate-400 group-hover:text-emerald-600'
                    }`}
                  />
                </button>
              </div>
              <p className={`text-[11px] ${isLiq28Theme ? 'text-[#6B6157]' : 'text-slate-500'}`}>
                {getSttEngineDisplayName(config?.transcriptionModel)} + GigaChat (Сбер) + Шифрование AES-256-GCM + RBAC доступ
              </p>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-2.5">
            {/* Active STT Transcription Engine Selector (compact) */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs">
              <span className="text-[11px] text-slate-500 font-medium whitespace-nowrap">Речь:</span>
              <TranscriptionModelSelector
                currentModel={config?.transcriptionModel || 'yandex_speechkit'}
                onSelectModel={handleTranscriptionModelChange}
                disabled={userRole !== 'admin'}
                compact
                statusMap={{
                  yandex_speechkit: config?.yandexSpeechKit?.configured,
                  tbank_voicekit: config?.tbankVoiceKit?.configured,
                  gigaam_v3: config?.gigaamV3?.configured,
                }}
              />
            </div>

            {/* Active GigaChat Model Selector (compact) */}
            <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs">
              <span className="text-[11px] text-slate-500 font-medium whitespace-nowrap">ИИ:</span>
              <ModelSelector
                currentModel={config?.default_gigachat_model || 'GigaChat:Lite'}
                onSelectModel={handleModelChange}
                disabled={userRole !== 'admin'}
                compact
              />
            </div>

            {/* Current Authenticated User Badge, Change Password & Logout */}
            {currentUser && (
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200/90 rounded-xl px-2.5 py-1 text-xs">
                <div className="flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-slate-500" />
                  <span className="font-bold text-slate-800">{currentUser.name}</span>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getRoleBadgeStyle(currentUser.role)}`}>
                  {getRoleLabel(currentUser.role)}
                </span>
                <button
                  type="button"
                  onClick={() => setIsChangePasswordModalOpen(true)}
                  className="p-1 hover:bg-indigo-100 text-slate-500 hover:text-indigo-700 rounded-md transition-colors"
                  title="Сменить свой пароль"
                  id="user-change-password-btn"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="p-1 hover:bg-slate-200 text-slate-500 hover:text-slate-800 rounded-md transition-colors"
                  title="Выйти / Сменить пользователя"
                  id="user-logout-btn"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Quick Login button if not logged in */}
            {!currentUser && (
              <button
                type="button"
                onClick={() => setIsLoginModalOpen(true)}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs transition-colors"
              >
                Войти по паролю
              </button>
            )}

            {/* Notifications Center Bell (Admins and Managers) */}
            {(userRole === 'admin' || userRole === 'manager') && (
              <NotificationsBell
                userRole={userRole}
                authToken={authToken}
                onSelectCall={handleSelectCallFromNotification}
                soundEnabled={soundEnabled}
                onToggleSound={handleToggleSound}
              />
            )}

            <button
              onClick={() => loadData(true)}
              className="p-1.5 hover:bg-slate-100 rounded-lg border border-slate-200 text-slate-600 transition-colors"
              title="Обновить данные"
              id="refresh-all-data-btn"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-4 md:p-6 max-w-7xl mx-auto w-full space-y-5" id="applet-main-container">
        
        {/* 152-FZ Auto-Inform Notification Notice */}
        <RecordingNotice salonName={currentSalonName} />

        {/* Error Alert */}
        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 text-rose-900 text-xs" id="global-error-banner">
            <div className="flex gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold block">Сбой связи с сервером</span>
                {error}
              </div>
            </div>
            <button
              onClick={() => loadData()}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold text-xs transition-colors shrink-0"
            >
              Повторить попытку
            </button>
          </div>
        )}

        {/* Role Warning / Notice */}
        {userRole !== 'admin' && (
          <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-3 flex items-center justify-between text-xs text-blue-900">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-600 shrink-0" />
              <span>
                <strong>Режим ограниченного доступа ({getRoleLabel(userRole)}):</strong> Персональные данные маскированы в соответствии со статьей 7 Федерального закона № 152-ФЗ.
              </span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setIsChangePasswordModalOpen(true)}
                className="text-[11px] font-bold text-indigo-700 hover:underline flex items-center gap-1"
                id="role-banner-change-password-btn"
              >
                <KeyRound className="w-3 h-3" /> Сменить пароль
              </button>
              <button
                type="button"
                onClick={() => setIsLoginModalOpen(true)}
                className="text-[11px] font-bold text-blue-700 hover:underline shrink-0"
              >
                Сменить пользователя
              </button>
            </div>
          </div>
        )}

        {/* Workspace Card with Navigation Tabs */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden min-h-[600px] flex flex-col" id="unified-workspace-container">
          
          {/* Main Navigation Tabs */}
          <div className="flex flex-wrap border-b border-slate-200 bg-slate-50/50" id="main-workspace-tabs-header">
            <button
              id="tab-btn-list"
              onClick={() => setActiveTab('list')}
              className={`px-5 py-3.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
                activeTab === 'list'
                  ? 'border-emerald-600 text-emerald-700 bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <PhoneCall className="w-4 h-4" /> Журнал звонков ({calls.length})
            </button>

            <button
              id="tab-btn-details"
              onClick={() => setActiveTab('details')}
              className={`px-5 py-3.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
                activeTab === 'details'
                  ? 'border-emerald-600 text-emerald-700 bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Activity className="w-4 h-4" /> Анализ & Оценка звонка
            </button>

            <button
              id="tab-btn-tasks"
              onClick={() => setActiveTab('tasks')}
              className={`px-5 py-3.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
                activeTab === 'tasks'
                  ? 'border-purple-600 text-purple-700 bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <ListTodo className="w-4 h-4 text-purple-600" />
              <span>Задачи Next Steps</span>
              {pendingNextStepsCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-purple-100 text-purple-700 border border-purple-200">
                  {pendingNextStepsCount}
                </span>
              )}
            </button>

            <button
              id="tab-btn-stats"
              onClick={() => setActiveTab('stats')}
              className={`px-5 py-3.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
                activeTab === 'stats'
                  ? 'border-emerald-600 text-emerald-700 bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <BarChart3 className="w-4 h-4" /> Аналитика & Статистика
            </button>

            <button
              id="tab-btn-consents"
              onClick={() => setActiveTab('consents')}
              className={`px-5 py-3.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
                activeTab === 'consents'
                  ? 'border-emerald-600 text-emerald-700 bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <ShieldCheck className="w-4 h-4" /> Реестр согласий (152-ФЗ)
            </button>

            {/* Системный промпт ИИ (доступно управляющему и администратору) */}
            {(userRole === 'admin' || userRole === 'manager') && (
              <button
                id="tab-btn-prompt"
                onClick={() => setActiveTab('prompt')}
                className={`px-5 py-3.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
                  activeTab === 'prompt'
                    ? 'border-indigo-600 text-indigo-700 bg-white'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Sparkles className="w-4 h-4 text-indigo-600" />
                <span>Системный промпт ИИ</span>
                {Boolean((config?.customSystemPrompt || (config as any)?.credentials?.customSystemPrompt || '').trim()) && (
                  <span
                    className="text-[10px] bg-amber-100 text-amber-800 border border-amber-300 font-bold px-1.5 py-0.5 rounded-md"
                    title="Активен пользовательский промпт (перекрывает встроенный эталон)"
                  >
                    Кастомный
                  </span>
                )}
              </button>
            )}

            {/* Администраторы ресепшена: добавление, логины и пароли (доступно управляющему и администратору) */}
            {(userRole === 'admin' || userRole === 'manager') && (
              <button
                id="tab-btn-reception"
                onClick={() => setActiveTab('reception')}
                className={`px-5 py-3.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
                  activeTab === 'reception'
                    ? 'border-purple-600 text-purple-700 bg-white'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Headphones className="w-4 h-4 text-purple-600" />
                <span>Администраторы ресепшена</span>
              </button>
            )}

            <button
              id="tab-btn-guide"
              onClick={() => setActiveTab('guide')}
              className={`px-5 py-3.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
                activeTab === 'guide'
                  ? 'border-indigo-600 text-indigo-700 bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <BookOpen className="w-4 h-4 text-indigo-600" /> Руководство пользователя
            </button>

            {/* Protected Admin Panel Tab */}
            {userRole === 'admin' && (
              <button
                id="tab-btn-admin"
                onClick={handleOpenAdminTab}
                className={`px-5 py-3.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
                  activeTab === 'admin'
                    ? 'border-amber-600 text-amber-800 bg-amber-50/50'
                    : 'border-transparent text-slate-600 hover:text-amber-800'
                }`}
              >
                {isAdminUnlocked ? (
                  <Unlock className="w-4 h-4 text-emerald-600" />
                ) : (
                  <Lock className="w-4 h-4 text-amber-600" />
                )}
                <span>Панель администратора</span>
                {!isAdminUnlocked && (
                  <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.2 rounded-md">
                    Пароль
                  </span>
                )}
              </button>
            )}
          </div>

          {/* Active Tab Workspace Panel */}
          <div className="flex-1 p-5" id="active-tab-workspace-panel">
            <AnimatePresence mode="wait">
              {activeTab === 'list' && (
                <motion.div
                  key="tab-workspace-list"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.12 }}
                  className="min-h-[500px]"
                >
                  <CallList 
                    calls={calls} 
                    selectedCallId={selectedCallId} 
                    onSelectCall={(id) => {
                      setSelectedCallId(id);
                      setActiveTab('details');
                    }}
                    onClearDemoCalls={handleClearDemoCalls}
                    userRole={userRole}
                  />
                </motion.div>
              )}

              {activeTab === 'details' && (
                <motion.div
                  key="tab-workspace-details"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.12 }}
                  className="min-h-[500px]"
                >
                  {selectedCall ? (
                    <CallDetails 
                      call={selectedCall} 
                      onSendVk={handleSendVk}
                      onReanalyze={handleReanalyze}
                      onCallUpdated={(updated) => {
                        setCalls(prev => prev.map(c => c.call_id === updated.call_id ? updated : c));
                      }}
                      onDeleteCall={handleDeleteCall}
                      userRole={userRole}
                      activeSttModel={config?.transcriptionModel}
                    />
                  ) : (
                    <div className="bg-white border border-slate-100 rounded-2xl shadow-xs py-16 flex flex-col items-center justify-center p-8 text-center text-slate-400">
                      <PhoneCall className="w-12 h-12 text-slate-300 mb-3" />
                      <h3 className="text-sm font-semibold text-slate-700 mb-1">Звонок не выбран</h3>
                      <p className="text-xs mb-4">Для детального просмотра аналитики сначала выберите звонок в Журнале звонков.</p>
                      <button 
                        onClick={() => setActiveTab('list')}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
                      >
                        Перейти к Журналу звонков
                      </button>
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'tasks' && (
                <motion.div
                  key="tab-workspace-tasks"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.12 }}
                  className="min-h-[500px]"
                >
                  <PendingTasksList
                    calls={calls}
                    onSelectCall={(id) => {
                      setSelectedCallId(id);
                      setActiveTab('details');
                    }}
                    onCallUpdated={(updated) => {
                      setCalls(prev => prev.map(c => c.call_id === updated.call_id ? updated : c));
                    }}
                    userRole={userRole}
                    salonName={currentSalonName}
                  />
                </motion.div>
              )}

              {activeTab === 'stats' && (
                <motion.div
                  key="tab-workspace-stats"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.12 }}
                  className="min-h-[500px]"
                >
                  <StatsGrid stats={stats} calls={calls} authToken={authToken} userRole={userRole} salonName={currentSalonName} />
                </motion.div>
              )}

              {activeTab === 'consents' && (
                <motion.div
                  key="tab-workspace-consents"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.12 }}
                  className="min-h-[500px]"
                >
                  <ConsentsTable userRole={userRole} salonName={currentSalonName} />
                </motion.div>
              )}

              {/* System Prompt Editor for Managers and Admins */}
              {activeTab === 'prompt' && (userRole === 'admin' || userRole === 'manager') && (
                <motion.div
                  key="tab-workspace-prompt"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.12 }}
                  className="min-h-[500px]"
                >
                  <SystemPromptEditor
                    authToken={authToken}
                    userRole={userRole}
                    salonName={currentSalonName}
                    onPromptSaved={(newPrompt) => {
                      if (config) {
                        setConfig({
                          ...config,
                          customSystemPrompt: newPrompt,
                        });
                      }
                    }}
                  />
                </motion.div>
              )}

              {/* Receptionists Management for Managers and Admins */}
              {activeTab === 'reception' && (userRole === 'admin' || userRole === 'manager') && (
                <motion.div
                  key="tab-workspace-reception"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.12 }}
                  className="min-h-[500px]"
                >
                  <UsersManagement
                    authToken={authToken}
                    currentUserId={currentUser?.id}
                    userRole={userRole}
                  />
                </motion.div>
              )}

              {activeTab === 'guide' && (
                <motion.div
                  key="tab-workspace-guide"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.12 }}
                  className="min-h-[500px]"
                >
                  <UserGuide salonName={currentSalonName} />
                </motion.div>
              )}

              {/* Admin Panel (Tokens, Users, Passwords) */}
              {activeTab === 'admin' && userRole === 'admin' && (
                <motion.div
                  key="tab-workspace-admin"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.12 }}
                >
                  <AdminPanel
                    authToken={authToken}
                    currentUserId={currentUser?.id}
                    adminUsername={currentUser?.username}
                    logs={logs}
                    onClearLogs={handleClearLogs}
                    onSelectCall={(callId) => {
                      setSelectedCallId(callId);
                      setActiveTab('details');
                    }}
                    onConfigUpdated={() => loadData(true)}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

        </div>

      </main>

      {/* Login Modal */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onLoginSuccess={handleLoginSuccess}
        onOpenChangePassword={() => setIsChangePasswordModalOpen(true)}
        salonName={currentSalonName}
        sessionExpiredNotice={sessionExpiredNotice}
      />

      {/* User Self-Service Password Change Modal */}
      <UserPasswordChangeModal
        isOpen={isChangePasswordModalOpen}
        onClose={() => setIsChangePasswordModalOpen(false)}
        currentUser={currentUser}
        authToken={authToken}
      />

      {/* Admin Gate Master Password Prompt Modal */}
      <AdminPasswordPromptModal
        isOpen={isAdminPasswordModalOpen}
        authToken={authToken}
        onSuccess={handleAdminPasswordSuccess}
        onCancel={() => setIsAdminPasswordModalOpen(false)}
        salonName={currentSalonName}
      />

      {/* Real-time Toast Notifications for Admins and Managers */}
      <NotificationToastContainer
        userRole={userRole}
        authToken={authToken}
        onSelectCall={handleSelectCallFromNotification}
        onNewNotification={() => loadData(true)}
        soundEnabled={soundEnabled}
      />

      {/* Floating Next Steps Reminder Toast (Bottom-Right) */}
      <NextStepsReminderToast
        calls={calls}
        onOpenTasksTab={() => setActiveTab('tasks')}
        onOpenCallDetails={(callId) => {
          setSelectedCallId(callId);
          setActiveTab('details');
        }}
        userRole={userRole}
        soundEnabled={soundEnabled}
      />

      {/* Manual Salon Name Editing Modal */}
      <EditSalonNameModal
        isOpen={isEditSalonModalOpen}
        onClose={() => setIsEditSalonModalOpen(false)}
        currentName={currentSalonName}
        onSave={handleSaveSalonName}
        userRole={userRole}
      />

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-4 text-center text-xs text-slate-500 mt-auto" id="applet-main-footer">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row justify-between items-center gap-2">
          <p>© 2026 Салон красоты «{currentSalonName}». Все права защищены. Обработка ПДн в строгом соответствии с 152-ФЗ.</p>
          <div className="flex items-center gap-3 font-mono text-[11px] text-slate-600">
            <span className="flex items-center gap-1 text-emerald-700">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> AES-256-GCM
            </span>
            <span>•</span>
            <span>{getSttEngineDisplayName(config?.transcriptionModel)} + GigaChat</span>
            <span>•</span>
            <span className="text-amber-700">Admin RBAC Gate</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
