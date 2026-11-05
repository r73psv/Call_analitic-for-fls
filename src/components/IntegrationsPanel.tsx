/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Settings, Save, Server, Shield, MessageCircle, Database, 
  HelpCircle, Calendar, RefreshCw, Clock, Globe, Zap, 
  Key, Lock, CheckCircle2, AlertTriangle, Trash2, Cpu, Building2,
  Copy, Check, PhoneCall, PhoneForwarded, Users, Info, Radio
} from 'lucide-react';
import { SystemConfig, GigaChatModel, MegafonApiVersion } from '../types.js';
import { S3SyncPanel } from './S3SyncPanel.js';

interface IntegrationsPanelProps {
  config: SystemConfig;
  onSaveConfig: (newConfig: SystemConfig) => Promise<void>;
  userRole?: string;
}

export function IntegrationsPanel({ config, onSaveConfig, userRole = 'admin' }: IntegrationsPanelProps) {
  const [salonName, setSalonName] = useState(config.salonName || 'Fashion Look Studio');
  const [defaultModel, setDefaultModel] = useState<GigaChatModel>(
    config.default_gigachat_model || (config.activeModel as GigaChatModel) || 'GigaChat:Lite'
  );

  // Megafon ATS state
  const [megafonApiVersion, setMegafonApiVersion] = useState<MegafonApiVersion>(
    config.megafon?.apiVersion || 'json_rpc'
  );
  const [megafonToken, setMegafonToken] = useState(config.megafon?.token || '');
  const [megafonActive, setMegafonActive] = useState(config.megafon?.active ?? true);
  const [pollingEnabled, setPollingEnabled] = useState(config.megafon?.pollingEnabled ?? true);
  const [pollingIntervalMinutes, setPollingIntervalMinutes] = useState(config.megafon?.pollingIntervalMinutes || 15);
  const [megafonLkLogin, setMegafonLkLogin] = useState(config.megafon?.lkLogin || '');
  const [megafonLkPassword, setMegafonLkPassword] = useState(config.megafon?.lkPassword || '');

  // Megafon REST WCGP version state
  const [megafonRestDomain, setMegafonRestDomain] = useState(config.megafon?.restDomain || '');
  const [megafonRestToken, setMegafonRestToken] = useState(config.megafon?.restToken || '');
  const [megafonCrmToken, setMegafonCrmToken] = useState(config.megafon?.crmToken || '');
  const [megafonRestPollingPeriod, setMegafonRestPollingPeriod] = useState<
    'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month'
  >(config.megafon?.restPollingPeriod || 'today');

  // WCGP Connection test & click-to-call states
  const [testingWcgp, setTestingWcgp] = useState(false);
  const [wcgpTestResult, setWcgpTestResult] = useState<{ ok: boolean; message: string; count?: number; accounts?: any[] } | null>(null);
  const [syncingWcgpHistory, setSyncingWcgpHistory] = useState(false);
  const [wcgpHistoryResult, setWcgpHistoryResult] = useState<string | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [testCallUser, setTestCallUser] = useState('');
  const [testCallPhone, setTestCallPhone] = useState('');
  const [makingCall, setMakingCall] = useState(false);
  const [makeCallResult, setMakeCallResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Manual Period Sync
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date(Date.now() - 12 * 3600000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [toDate, setToDate] = useState(() => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [syncingPeriod, setSyncingPeriod] = useState(false);
  const [syncPeriodResult, setSyncPeriodResult] = useState<string | null>(null);

  // Immediate Polling Trigger
  const [pollingNow, setPollingNow] = useState(false);
  const [pollNowResult, setPollNowResult] = useState<string | null>(null);

  // TTL Manual Trigger
  const [runningCleanup, setRunningCleanup] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<any | null>(null);

  // GigaChat Queue & Test Status
  const [queueStatus, setQueueStatus] = useState<{ pending: number; isProcessing: boolean; totalProcessed: number } | null>(null);
  const [testingGiga, setTestingGiga] = useState(false);
  const [gigaTestResult, setGigaTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const fetchQueueStatus = async () => {
    try {
      const res = await fetch('/api/gigachat/queue');
      if (res.ok) {
        const data = await res.json();
        setQueueStatus(data.queue);
      }
    } catch {}
  };

  useEffect(() => {
    fetchQueueStatus();
    const interval = setInterval(fetchQueueStatus, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleTestGigaChat = async () => {
    setTestingGiga(true);
    setGigaTestResult(null);
    try {
      const res = await fetch('/api/gigachat/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: defaultModel })
      });
      const data = await res.json();
      if (data.success) {
        setGigaTestResult({ ok: true, msg: data.message || 'Тест успешен!' });
      } else {
        setGigaTestResult({ ok: false, msg: data.error || 'Ошибка подключения' });
      }
      fetchQueueStatus();
    } catch (err: any) {
      setGigaTestResult({ ok: false, msg: err.message || 'Сбой сети' });
    } finally {
      setTestingGiga(false);
    }
  };

  const [vkEnabled, setVkEnabled] = useState(config.vk?.enabled ?? true);
  const [vkToken, setVkToken] = useState(config.vk?.token || '');
  const [vkChatId, setVkChatId] = useState(config.vk?.chatId || '');
  const [vkTemplate, setVkTemplate] = useState(config.vk?.template || '');
  
  const [ycEnabled, setYcEnabled] = useState(config.yclients?.enabled ?? true);
  const [ycUserToken, setYcUserToken] = useState(config.yclients?.userToken || '');
  const [ycPartnerToken, setYcPartnerToken] = useState(config.yclients?.partnerToken || '');
  const [ycSalonId, setYcSalonId] = useState(config.yclients?.salonId || '');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Synchronize component state whenever config prop changes
  useEffect(() => {
    if (config) {
      if (config.default_gigachat_model) setDefaultModel(config.default_gigachat_model);
      setMegafonApiVersion(config.megafon?.apiVersion || 'json_rpc');
      setMegafonToken(config.megafon?.token || '');
      setMegafonActive(config.megafon?.active ?? true);
      setPollingEnabled(config.megafon?.pollingEnabled ?? false);
      setPollingIntervalMinutes(config.megafon?.pollingIntervalMinutes || 5);
      setMegafonLkLogin(config.megafon?.lkLogin || '');
      setMegafonLkPassword(config.megafon?.lkPassword || '');
      setMegafonRestDomain(config.megafon?.restDomain || '');
      setMegafonRestToken(config.megafon?.restToken || '');
      setMegafonCrmToken(config.megafon?.crmToken || '');
      setMegafonRestPollingPeriod(config.megafon?.restPollingPeriod || 'today');

      setVkEnabled(config.vk?.enabled ?? true);
      setVkToken(config.vk?.token || '');
      setVkChatId(config.vk?.chatId || '');
      setVkTemplate(config.vk?.template || '');

      setYcEnabled(config.yclients?.enabled ?? true);
      setYcUserToken(config.yclients?.userToken || '');
      setYcPartnerToken(config.yclients?.partnerToken || '');
      setYcSalonId(config.yclients?.salonId || '');
    }
  }, [config]);

  const handleCopyWebhookUrl = (path: string = '/crm_integration.php') => {
    try {
      const fullUrl = `${window.location.origin}${path}`;
      navigator.clipboard.writeText(fullUrl);
      setCopiedWebhook(true);
      setTimeout(() => setCopiedWebhook(false), 2500);
    } catch {}
  };

  const handleTestWcgpConnection = async () => {
    setTestingWcgp(true);
    setWcgpTestResult(null);
    try {
      const res = await fetch('/api/megafon/rest/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: megafonRestDomain,
          token: megafonRestToken || megafonToken
        })
      });
      const data = await res.json();
      if (data.success) {
        setWcgpTestResult({
          ok: true,
          message: data.message || `Связь с ВАТС успешна! Найдено сотрудников: ${data.count}`,
          count: data.count,
          accounts: data.accounts
        });
      } else {
        setWcgpTestResult({
          ok: false,
          message: data.error || 'Ошибка подключения к ВАТС',
          tip: data.tip
        });
      }
    } catch (err: any) {
      setWcgpTestResult({ ok: false, message: err.message || 'Ошибка сети' });
    } finally {
      setTestingWcgp(false);
    }
  };

  const handleFetchWcgpHistory = async () => {
    setSyncingWcgpHistory(true);
    setWcgpHistoryResult(null);
    try {
      const res = await fetch('/api/megafon/rest/fetch-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: megafonRestDomain,
          token: megafonRestToken || megafonToken,
          period: megafonRestPollingPeriod
        })
      });
      const data = await res.json();
      if (data.success) {
        setWcgpHistoryResult(data.message || `Выгружено звонков: ${data.found}, новых: ${data.importedCount}`);
        setTimeout(() => window.location.reload(), 2000);
      } else {
        setWcgpHistoryResult(`Ошибка: ${data.error || 'Не удалось выгрузить историю'}`);
      }
    } catch (err: any) {
      setWcgpHistoryResult(`Ошибка: ${err.message || err}`);
    } finally {
      setSyncingWcgpHistory(false);
    }
  };

  const handleMakeTestCall = async () => {
    if (!testCallUser || !testCallPhone) return;
    setMakingCall(true);
    setMakeCallResult(null);
    try {
      const res = await fetch('/api/megafon/rest/make-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: testCallUser,
          phone: testCallPhone,
          domain: megafonRestDomain,
          token: megafonRestToken || megafonToken
        })
      });
      const data = await res.json();
      if (data.success) {
        setMakeCallResult({ ok: true, message: `Вызов инициирован! ID: ${data.callId}` });
      } else {
        setMakeCallResult({ ok: false, message: data.error || 'Ошибка инициации звонка' });
      }
    } catch (err: any) {
      setMakeCallResult({ ok: false, message: err.message || 'Ошибка соединения' });
    } finally {
      setMakingCall(false);
    }
  };

  const handleImmediatePoll = async () => {
    setPollingNow(true);
    setPollNowResult(null);
    try {
      const res = await fetch('/api/calls/fetch-poll', { method: 'POST' });
      const text = await res.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(res.ok ? 'Некорректный формат ответа сервера' : `Ошибка сервера (${res.status}): ${text.slice(0, 120)}`);
      }

      if (res.ok && data.success) {
        setPollNowResult(`Опрос выполнен! Найдено звонков: ${data.imported ?? data.importedCount ?? 0}`);
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setPollNowResult(`Ошибка: ${data.error || 'Ошибка опроса АТС'}`);
      }
    } catch (err: any) {
      setPollNowResult(`Ошибка: ${err.message || err}`);
    } finally {
      setPollingNow(false);
    }
  };

  const handlePeriodSync = async () => {
    setSyncingPeriod(true);
    setSyncPeriodResult(null);
    try {
      const res = await fetch('/api/calls/fetch-period', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromDate, to: toDate })
      });
      const text = await res.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(res.ok ? 'Некорректный формат ответа сервера' : `Ошибка сервера (${res.status}): ${text.slice(0, 120)}`);
      }

      if (res.ok && data.success) {
        setSyncPeriodResult(data.message || `Успешно импортировано звонков: ${data.imported ?? 0}`);
        setTimeout(() => window.location.reload(), 2000);
      } else {
        setSyncPeriodResult(`Ошибка: ${data.error || 'Неизвестная ошибка'}`);
      }
    } catch (err: any) {
      setSyncPeriodResult(`Ошибка соединения: ${err.message || err}`);
    } finally {
      setSyncingPeriod(false);
    }
  };

  const handleRunCleanup = async () => {
    setRunningCleanup(true);
    setCleanupResult(null);
    try {
      const res = await fetch('/api/cleanup/run', {
        method: 'POST',
        headers: { 'x-user-role': userRole },
      });
      const data = await res.json();
      setCleanupResult(data.stats || data);
    } catch (err: any) {
      setCleanupResult({ error: err.message || 'Ошибка запуска' });
    } finally {
      setRunningCleanup(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updatedConfig: SystemConfig = {
        ...config,
        salonName: salonName.trim() || 'Fashion Look Studio',
        activeModel: defaultModel,
        default_gigachat_model: defaultModel,
        megafon: {
          ...config.megafon,
          apiVersion: megafonApiVersion,
          token: megafonToken,
          active: megafonActive,
          pollingEnabled,
          pollingIntervalMinutes: Number(pollingIntervalMinutes),
          lkLogin: megafonLkLogin,
          lkPassword: megafonLkPassword,
          restDomain: megafonRestDomain.trim(),
          restToken: megafonRestToken.trim(),
          crmToken: megafonCrmToken.trim(),
          restPollingPeriod: megafonRestPollingPeriod,
        },
        vk: {
          ...config.vk,
          enabled: vkEnabled,
          token: vkToken,
          chatId: vkChatId,
          template: vkTemplate,
        },
        yclients: {
          ...config.yclients,
          enabled: ycEnabled,
          userToken: ycUserToken,
          partnerToken: ycPartnerToken,
          salonId: ycSalonId,
        },
      };

      await onSaveConfig(updatedConfig);

      // Also update /api/settings
      await fetch('/api/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': userRole,
        },
        body: JSON.stringify({ default_gigachat_model: defaultModel }),
      });

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('Failed to save config:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex justify-between items-center bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-600" />
            Интеграции и соответствие 152-ФЗ
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Конфигурация Yandex Cloud, GigaChat, шифрования AES-256-GCM, АТС Мегафон, VK и YClients
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || userRole !== 'admin'}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow-xs transition-all disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Сохранение...' : saved ? 'Сохранено!' : 'Сохранить настройки'}
        </button>
      </div>

      {userRole !== 'admin' && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
          <span>Вы вошли с ролью <b>{userRole}</b>. Изменение глобальных настроек и выбор модели GigaChat доступны только администраторам.</span>
        </div>
      )}

      {/* 0. Название салона красоты */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
          <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center">
            <Building2 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">Наименование салона красоты</h3>
            <p className="text-xs text-slate-500">Официальное название бренда для отчетов и промптов ИИ</p>
          </div>
        </div>
        <div className="mt-3 space-y-2">
          <label className="block text-xs font-semibold text-slate-700">
            Название (ручной ввод)
          </label>
          <input
            type="text"
            value={salonName}
            disabled={userRole !== 'admin'}
            onChange={(e) => setSalonName(e.target.value)}
            placeholder="Например: Fashion Look Studio, FLS, Лик 28..."
            className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 disabled:opacity-60 transition-all"
          />
          <p className="text-[11px] text-slate-500">
            Отображается в шапке, реестре согласий, колонтитулах PDF/CSV отчетов аудита звонков и речевых стандартах.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. GigaChat (Сбер) */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-xs">
                GC
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">GigaChat (Сбер)</h3>
                <p className="text-xs text-slate-500">Анализ звонков для салона «{salonName || 'Fashion Look Studio'}»</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
              <CheckCircle2 className="w-3.5 h-3.5" /> РФ провайдер
            </span>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Базовая модель по умолчанию
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(['GigaChat:Lite', 'GigaChat:Pro', 'GigaChat:Max', 'GigaChat:Ultra'] as GigaChatModel[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={userRole !== 'admin'}
                    onClick={() => setDefaultModel(m)}
                    className={`py-2 px-3 text-xs font-medium rounded-lg border text-center transition-all ${
                      defaultModel === m
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {m.replace('GigaChat:', '')}
                    <span className="block text-[10px] opacity-75 mt-0.5">
                      {m === 'GigaChat:Lite'
                        ? 'Базовая'
                        : m === 'GigaChat:Pro'
                        ? 'Сложные диалоги'
                        : m === 'GigaChat:Max'
                        ? 'Флагман'
                        : 'Ultra Reasoning'}
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                * Любой звонок можно повторно проанализировать другой моделью индивидуально в карточке звонка.
              </p>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1.5 text-slate-600">
              <div className="flex justify-between items-center">
                <span>Очередь запросов (FIFO):</span>
                <span className="font-semibold inline-flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${queueStatus?.isProcessing ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`}></span>
                  {queueStatus?.isProcessing ? 'Выполняется (активен 1)' : 'Ожидание (0 активных)'}
                  {queueStatus && queueStatus.pending > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-mono">
                      +{queueStatus.pending} в очереди
                    </span>
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Ограничение параллелизма:</span>
                <span className="font-mono text-emerald-700 font-semibold">1 запрос одновременно (concurrency: 1)</span>
              </div>
              <div className="flex justify-between">
                <span>Защита от 429 (Rate Limit):</span>
                <span className="font-mono text-slate-700">Экспоненциальный retry (2с, 4с, 8с, 16с) + Retry-After</span>
              </div>
              <div className="flex justify-between">
                <span>Всего обработано очередью:</span>
                <span className="font-mono font-semibold text-slate-800">{queueStatus?.totalProcessed ?? 0}</span>
              </div>
            </div>

            {/* GigaChat connection & queue test */}
            <div className="pt-1">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleTestGigaChat}
                  disabled={testingGiga}
                  className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-700 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${testingGiga ? 'animate-spin' : ''}`} />
                  {testingGiga ? 'Проверка очереди...' : 'Проверить соединение и очередь'}
                </button>
                <span className="text-[11px] text-slate-400">
                  {queueStatus?.pending ? `В очереди: ${queueStatus.pending}` : 'Очередь пуста'}
                </span>
              </div>
              {gigaTestResult && (
                <div className={`mt-2 p-2 rounded text-xs border ${gigaTestResult.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                  {gigaTestResult.msg}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 2. Yandex Cloud (SpeechKit + Object Storage) */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center font-bold text-xs">
                YC
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">Yandex SpeechKit</h3>
                <p className="text-xs text-slate-500">Распознавание речи с разделением по ролям</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
              <Lock className="w-3.5 h-3.5" /> Сервисный аккаунт
            </span>
          </div>

          <div className="mt-4 space-y-3 text-xs text-slate-600">
            <div className="p-3 bg-purple-50/50 rounded-lg border border-purple-100 space-y-1.5">
              <div className="flex items-center gap-2 font-medium text-purple-900">
                <Key className="w-4 h-4 text-purple-600" />
                Авторизованный ключ (JSON):
              </div>
              <p className="font-mono text-[11px] text-purple-800 bg-white/70 p-1.5 rounded border border-purple-200">
                /app/keys/authorized_key.json (chmod 600)
              </p>
              <p className="text-[11px] text-purple-700">
                Безопасно монтируется через Docker Volume в режиме чтения (:ro). Никогда не попадает в образ.
              </p>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
              <div className="flex justify-between">
                <span>Стриминг / Буфер &lt; 1МБ:</span>
                <span className="font-semibold text-slate-700">Прямая передача Base64</span>
              </div>
              <div className="flex justify-between">
                <span>Аудио &ge; 1МБ:</span>
                <span className="font-semibold text-slate-700">Yandex Object Storage</span>
              </div>
              <div className="flex justify-between">
                <span>Очистка бакета:</span>
                <span className="font-semibold text-emerald-600">Немедленное удаление в finally</span>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Защита данных 152-ФЗ и Шифрование */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs lg:col-span-2">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <Shield className="w-5 h-5 text-indigo-600" />
              <div>
                <h3 className="text-sm font-bold text-slate-800">Защита данных (152-ФЗ) &amp; Хранилище AES-256-GCM</h3>
                <p className="text-xs text-slate-500">Шифрование базы звонков, реестр согласий и регламент автоудаления (TTL)</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Шифрование активно
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-xs font-semibold text-slate-700 mb-1">Файлы данных:</div>
              <div className="space-y-1 font-mono text-[11px] text-slate-600">
                <div>• /app/data/data-store.enc</div>
                <div>• /app/data/consents.enc</div>
              </div>
              <p className="text-[10px] text-slate-400 mt-2">
                При прямом открытии файлы зашифрованы ключом STORE_ENCRYPTION_KEY.
              </p>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-xs font-semibold text-slate-700 mb-1">Регламент TTL очистки:</div>
              <ul className="text-[11px] text-slate-600 space-y-1">
                <li>• <b>30 дней:</b> удаление ссылок на аудио</li>
                <li>• <b>90 дней:</b> удаление расшифровок и анализа</li>
                <li>• <b>3 года:</b> полное удаление звонка</li>
                <li>• <b>90 дней:</b> журнал доступа к ПДн</li>
              </ul>
            </div>

            <div className="p-3.5 bg-indigo-50/50 rounded-lg border border-indigo-100 flex flex-col justify-between">
              <div>
                <div className="text-xs font-semibold text-indigo-900 mb-1">Внеплановая TTL-очистка:</div>
                <p className="text-[11px] text-indigo-700">
                  Автоматический запуск происходит ежедневно в 03:00 ночи через node-cron.
                </p>
              </div>

              <div className="mt-3">
                <button
                  type="button"
                  onClick={handleRunCleanup}
                  disabled={runningCleanup || userRole !== 'admin'}
                  className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-medium transition-all shadow-xs disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${runningCleanup ? 'animate-spin' : ''}`} />
                  {runningCleanup ? 'Выполняется...' : 'Запустить очистку сейчас'}
                </button>
              </div>
            </div>
          </div>

          {cleanupResult && (
            <div className="mt-3 p-3 bg-slate-100 rounded-lg text-xs font-mono text-slate-700 border border-slate-200">
              Результат очистки: {JSON.stringify(cleanupResult)}
            </div>
          )}
        </div>

        {/* 4. Мегафон ВАТС */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs lg:col-span-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-green-50 text-green-700 rounded-lg border border-green-200">
                <Server className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <span>Интеграция с АТС Мегафон ВАТС</span>
                  <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md border ${
                    megafonApiVersion === 'rest_wcgp' 
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                      : 'bg-blue-50 text-blue-800 border-blue-200'
                  }`}>
                    {megafonApiVersion === 'rest_wcgp' ? 'REST CRM API (WCGP)' : 'JSON-RPC 2.0 (Классика)'}
                  </span>
                </h3>
                <p className="text-xs text-slate-500">Автоматический сбор звонков, запись разговоров и двухсторонний обмен данными</p>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer self-start sm:self-auto">
              <input
                type="checkbox"
                checked={megafonActive}
                onChange={(e) => setMegafonActive(e.target.checked)}
                className="w-4 h-4 rounded text-green-600 focus:ring-green-500"
              />
              <span className="text-xs font-semibold text-slate-700">Интеграция активна</span>
            </label>
          </div>

          <div className="mt-4 space-y-4 text-xs">
            {/* Переключатель версий API Мегафон */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Выберите версию протокола взаимодействия:
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-1.5 bg-slate-100/80 rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setMegafonApiVersion('json_rpc')}
                  className={`p-3 rounded-lg text-left transition-all border ${
                    megafonApiVersion === 'json_rpc'
                      ? 'bg-white text-slate-900 border-indigo-300 shadow-xs ring-1 ring-indigo-200'
                      : 'bg-transparent text-slate-600 border-transparent hover:bg-white/60'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                      <Radio className={`w-3.5 h-3.5 ${megafonApiVersion === 'json_rpc' ? 'text-indigo-600' : 'text-slate-400'}`} />
                      Версия 1: JSON-RPC 2.0
                    </span>
                    <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">data-api.cp.megafon.ru</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Текущая версия. Работает через отчеты <code>get.mgf_calls</code>, токен авторизации и фоновый сбор.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setMegafonApiVersion('rest_wcgp')}
                  className={`p-3 rounded-lg text-left transition-all border ${
                    megafonApiVersion === 'rest_wcgp'
                      ? 'bg-white text-slate-900 border-emerald-300 shadow-xs ring-1 ring-emerald-200'
                      : 'bg-transparent text-slate-600 border-transparent hover:bg-white/60'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                      <Radio className={`w-3.5 h-3.5 ${megafonApiVersion === 'rest_wcgp' ? 'text-emerald-600' : 'text-slate-400'}`} />
                      Версия 2: REST CRM API (WCGP)
                    </span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-mono font-bold">По документации</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Новая версия. Мгновенные вебхуки (<code>history</code>, <code>event</code>, <code>contact</code>, <code>rating</code>) и выгрузка CSV.
                  </p>
                </button>
              </div>
            </div>

            {/* Конфигурация для Версии 1: JSON-RPC */}
            {megafonApiVersion === 'json_rpc' && (
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between font-bold text-slate-800 pb-2 border-b border-slate-200/80">
                  <span>Параметры подключения JSON-RPC 2.0:</span>
                  <span className="text-[10px] font-mono font-medium text-slate-500">Эндпоинт: https://data-api.cp.megafon.ru/v2.0</span>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Токен авторизации ВАТС (API Token):</label>
                  <input
                    type="password"
                    value={megafonToken}
                    onChange={(e) => setMegafonToken(e.target.value)}
                    placeholder="Вставьте токен из ЛК Мегафон ВАТС..."
                    className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Ключ авторизации полученный в веб-кабинете Мегафон ВАТС в разделе «Интеграция с CRM».
                  </p>
                </div>
              </div>
            )}

            {/* Конфигурация для Версии 2: REST CRM API (WCGP) */}
            {megafonApiVersion === 'rest_wcgp' && (
              <div className="space-y-4">
                <div className="p-4 bg-emerald-50/50 rounded-xl border border-emerald-200/80 space-y-3">
                  <div className="flex items-center justify-between font-bold text-slate-800 pb-2 border-b border-emerald-200/60">
                    <span className="flex items-center gap-1.5 text-emerald-950 font-bold">
                      <Globe className="w-4 h-4 text-emerald-600" />
                      Параметры REST API Виртуальной АТС (WCGP):
                    </span>
                    <span className="text-[10px] font-mono text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded">
                      /sys/crm_api.wcgp
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Адрес API или домен Виртуальной АТС:
                      </label>
                      <input
                        type="text"
                        value={megafonRestDomain}
                        onChange={(e) => setMegafonRestDomain(e.target.value)}
                        placeholder="https://vats903670.megapbx.ru/crmapi/v1 или vats903670.megapbx.ru"
                        className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                      />
                      <p className="text-[10px] text-slate-500 mt-1">
                        Поддерживается полный адрес из ЛК Мегафон (<code>https://vatsXXXXX.megapbx.ru/crmapi/v1</code>) или домен (<code>vatsXXXXX.megapbx.ru</code>).
                      </p>
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Ключ (token) Виртуальной АТС:
                      </label>
                      <input
                        type="password"
                        value={megafonRestToken}
                        onChange={(e) => setMegafonRestToken(e.target.value)}
                        placeholder="Ключ (token) из веб-кабинета ВАТС..."
                        className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                      />
                      <p className="text-[10px] text-slate-500 mt-1">
                        Специальный ключ (token) для отправки запросов от нашей системы к ВАТС.
                      </p>
                    </div>

                    <div className="md:col-span-2">
                      <label className="block font-semibold text-slate-700 mb-1">
                        Ключ CRM (crm_token) для входящих вебхуков:
                      </label>
                      <input
                        type="password"
                        value={megafonCrmToken}
                        onChange={(e) => setMegafonCrmToken(e.target.value)}
                        placeholder="Сгенерируйте и вставьте ключ crm_token..."
                        className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                      />
                      <p className="text-[10px] text-slate-500 mt-1">
                        Этот ключ вы указываете в веб-кабинете ВАТС. АТС передает его в параметре <code>crm_token</code> при каждом входящем запросе.
                      </p>
                    </div>
                  </div>

                  {/* Кнопка проверки связи с REST WCGP */}
                  <div className="pt-2 border-t border-emerald-200/60 flex flex-wrap items-center gap-2 justify-between">
                    <button
                      type="button"
                      onClick={handleTestWcgpConnection}
                      disabled={testingWcgp}
                      className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold transition-all shadow-xs flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${testingWcgp ? 'animate-spin' : ''}`} />
                      {testingWcgp ? 'Проверка соединения...' : 'Проверить связь с ВАТС (список сотрудников)'}
                    </button>

                    {wcgpTestResult && (
                      <div className="flex flex-col gap-1 w-full sm:w-auto">
                        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-md ${
                          wcgpTestResult.ok ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                        }`}>
                          {wcgpTestResult.message}
                        </span>
                        {wcgpTestResult.tip && (
                          <p className="text-[10px] text-amber-700 bg-amber-50 p-2 rounded border border-amber-200 leading-relaxed max-w-xl">
                            💡 <strong>Пояснение:</strong> {wcgpTestResult.tip}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Список сотрудников, если загружен */}
                  {wcgpTestResult?.accounts && wcgpTestResult.accounts.length > 0 && (
                    <div className="mt-2 p-3 bg-white rounded-lg border border-emerald-200 space-y-1.5 max-h-40 overflow-y-auto">
                      <div className="font-bold text-slate-800 text-[11px] flex items-center gap-1">
                        <Users className="w-3.5 h-3.5 text-emerald-600" />
                        Сотрудники в АТС Мегафон ({wcgpTestResult.accounts.length}):
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {wcgpTestResult.accounts.map((acc: any, idx: number) => (
                          <div key={idx} className="p-1.5 bg-slate-50 rounded border border-slate-100 text-[11px] flex items-center justify-between">
                            <span className="font-medium text-slate-800">{acc.realName || acc.name}</span>
                            <span className="font-mono text-[10px] text-slate-500 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                              {acc.ext ? `доб. ${acc.ext}` : (acc.telnum || acc.name)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Адрес Webhook для веб-кабинета Мегафон */}
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                      <Key className="w-4 h-4 text-indigo-600" />
                      Webhook URL для настройки в веб-кабинете Мегафон ВАТС:
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyWebhookUrl('/crm_integration.php')}
                      className="px-2.5 py-1 bg-white hover:bg-slate-100 text-indigo-700 border border-slate-200 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-all"
                    >
                      {copiedWebhook ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedWebhook ? 'Скопировано!' : 'Скопировать URL'}
                    </button>
                  </div>

                  <div className="p-2 bg-white rounded-lg border border-slate-200 font-mono text-[11px] text-indigo-900 break-all select-all">
                    {typeof window !== 'undefined' ? `${window.location.origin}/crm_integration.php` : '/crm_integration.php'}
                  </div>

                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Скопируйте этот URL и вставьте в поле <b>«Адрес вашей CRM»</b> в личном кабинете Виртуальной АТС. Также поддерживаются адреса <code>/api/calls/webhook</code> и <code>/api/vats/webhook</code>.
                  </p>
                </div>

                {/* Ручная выгрузка истории звонков по REST (cmd=history CSV) */}
                <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-2.5">
                  <div className="flex items-center justify-between font-bold text-slate-800 text-xs">
                    <span className="flex items-center gap-1.5">
                      <Calendar className="w-4 h-4 text-slate-500" />
                      Выгрузка истории звонков из ВАТС (команда cmd=history CSV):
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={megafonRestPollingPeriod}
                      onChange={(e) => setMegafonRestPollingPeriod(e.target.value as any)}
                      className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800"
                    >
                      <option value="today">Звонки за сегодня (today)</option>
                      <option value="yesterday">Звонки за вчера (yesterday)</option>
                      <option value="this_week">Звонки за текущую неделю (this_week)</option>
                      <option value="last_week">Звонки за прошедшую неделю (last_week)</option>
                      <option value="this_month">Звонки за текущий месяц (this_month)</option>
                      <option value="last_month">Звонки за прошедший месяц (last_month)</option>
                    </select>

                    <button
                      type="button"
                      onClick={handleFetchWcgpHistory}
                      disabled={syncingWcgpHistory}
                      className="px-3.5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-semibold text-xs transition-all shadow-xs flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${syncingWcgpHistory ? 'animate-spin' : ''}`} />
                      {syncingWcgpHistory ? 'Выгрузка истории...' : 'Загрузить историю звонков'}
                    </button>

                    {wcgpHistoryResult && (
                      <span className="text-[11px] font-medium text-slate-700 bg-slate-100 px-2.5 py-1 rounded-md">
                        {wcgpHistoryResult}
                      </span>
                    )}
                  </div>
                </div>

                {/* Тест обратного звонка (Click-to-Call cmd=makeCall) */}
                <div className="p-4 bg-slate-50/70 rounded-xl border border-slate-200 space-y-2.5">
                  <div className="flex items-center justify-between font-bold text-slate-800 text-xs">
                    <span className="flex items-center gap-1.5">
                      <PhoneCall className="w-4 h-4 text-emerald-600" />
                      Тест обратного звонка из CRM (команда cmd=makeCall):
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="text"
                      placeholder="Логин/доб. сотрудника (user)"
                      value={testCallUser}
                      onChange={(e) => setTestCallUser(e.target.value)}
                      className="p-2 bg-white border border-slate-200 rounded-lg text-xs"
                    />
                    <input
                      type="text"
                      placeholder="Номер клиента (+79...)"
                      value={testCallPhone}
                      onChange={(e) => setTestCallPhone(e.target.value)}
                      className="p-2 bg-white border border-slate-200 rounded-lg text-xs"
                    />
                    <button
                      type="button"
                      onClick={handleMakeTestCall}
                      disabled={makingCall || !testCallUser || !testCallPhone}
                      className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-xs transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      <PhoneForwarded className="w-3.5 h-3.5" />
                      {makingCall ? 'Вызов...' : 'Инициировать звонок'}
                    </button>
                  </div>
                  {makeCallResult && (
                    <div className={`p-2 rounded text-[11px] font-medium ${makeCallResult.ok ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                      {makeCallResult.message}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Автоопрос АТС и интервал (общий для обоих режимов) */}
            <div className="p-3.5 bg-emerald-50 rounded-xl border border-emerald-200 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-800">
                  <input
                    type="checkbox"
                    checked={pollingEnabled}
                    onChange={(e) => setPollingEnabled(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>Автоопрос АТС (фоновый сбор новых звонков)</span>
                </label>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  pollingEnabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                }`}>
                  {pollingEnabled ? 'Включен' : 'Выключен'}
                </span>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-slate-600 font-medium">Интервал периодического опроса:</span>
                  <span className="text-xs font-bold text-emerald-700 font-mono">{pollingIntervalMinutes} мин.</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="1440"
                    value={pollingIntervalMinutes}
                    onChange={(e) => setPollingIntervalMinutes(Math.max(1, parseInt(e.target.value, 10) || 15))}
                    className="w-20 p-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800"
                  />
                  <div className="flex flex-wrap items-center gap-1">
                    {[5, 10, 15, 30, 60].map((mins) => (
                      <button
                        key={mins}
                        type="button"
                        onClick={() => setPollingIntervalMinutes(mins)}
                        className={`px-2 py-0.5 text-[10px] rounded-md font-semibold transition-all ${
                          pollingIntervalMinutes === mins
                            ? 'bg-emerald-600 text-white shadow-3xs'
                            : 'bg-white hover:bg-emerald-100 text-slate-600 border border-slate-200'
                        }`}
                      >
                        {mins} мин{mins === 15 ? ' (стандарт)' : ''}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-3 bg-green-50 rounded-lg border border-green-200 text-green-900">
              <p className="font-semibold mb-1">Уведомление о записи (152-ФЗ):</p>
              <p className="text-[11px] text-green-800">
                Автоинформатор воспроизводится АТС Мегафон перед соединением с оператором. Ответ на вызов подтверждает голосовое согласие клиента на аудиозапись и обработку персональных данных.
              </p>
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={handleImmediatePoll}
                disabled={pollingNow}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition-all"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${pollingNow ? 'animate-spin' : ''}`} />
                {pollingNow ? 'Опрос...' : `Опросить АТС сейчас (${megafonApiVersion === 'rest_wcgp' ? 'REST' : 'JSON-RPC'})`}
              </button>
              {pollNowResult && <span className="text-[11px] text-slate-600 font-medium">{pollNowResult}</span>}
            </div>
          </div>
        </div>

        {/* 5. ВКонтакте и Yclients */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-5">
          {/* VK */}
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-sky-600" />
                <h3 className="text-sm font-bold text-slate-800">ВКонтакте (Обезличенные отчеты)</h3>
              </div>
              <input
                type="checkbox"
                checked={vkEnabled}
                onChange={(e) => setVkEnabled(e.target.checked)}
                className="w-4 h-4 rounded text-sky-600"
              />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-slate-600 mb-1">ID чата управляющего:</label>
                <input
                  type="text"
                  value={vkChatId}
                  onChange={(e) => setVkChatId(e.target.value)}
                  placeholder="2000000045"
                  className="w-full p-2 border border-slate-200 rounded-lg text-xs"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-600 mb-1">Статус 152-ФЗ:</label>
                <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600">
                  Только маска <b>Клиент (****1234)</b>
                </div>
              </div>
            </div>

            <div className="mt-3 text-xs">
              <label className="block font-medium text-slate-600 mb-1">Шаблон сообщения в VK:</label>
              <textarea
                value={vkTemplate}
                onChange={(e) => setVkTemplate(e.target.value)}
                rows={5}
                placeholder="🔔 *Анализ звонка #{call_id}*..."
                className="w-full p-2 border border-slate-200 rounded-lg text-xs font-mono leading-relaxed"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Переменные: <code className="bg-slate-100 px-1 py-0.5 rounded text-sky-700 font-semibold">{'{duration}'}</code> (длительность звонка), <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700">{'{call_date_time}'}</code>, <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700">{'{client_name}'}</code>, <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700">{'{operator_score}'}</code>, <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700">{'{summary}'}</code>, <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700">{'{is_dispute_text}'}</code>, <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700">{'{recommendations}'}</code>
              </p>
            </div>
          </div>

          {/* YClients */}
          <div className="pt-3 border-t border-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-amber-600" />
                <h3 className="text-sm font-bold text-slate-800">Yclients (CRM салона)</h3>
              </div>
              <input
                type="checkbox"
                checked={ycEnabled}
                onChange={(e) => setYcEnabled(e.target.checked)}
                className="w-4 h-4 rounded text-amber-600"
              />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-slate-600 mb-1">ID салона:</label>
                <input
                  type="text"
                  value={ycSalonId}
                  onChange={(e) => setYcSalonId(e.target.value)}
                  placeholder="987654"
                  className="w-full p-2 border border-slate-200 rounded-lg text-xs"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-600 mb-1">Статус 152-ФЗ:</label>
                <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600">
                  Без транскрипта и персональных данных
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 6. Хранилище S3 timeweb.cloud */}
        <div className="lg:col-span-2">
          <S3SyncPanel />
        </div>
      </div>
    </div>
  );
}
