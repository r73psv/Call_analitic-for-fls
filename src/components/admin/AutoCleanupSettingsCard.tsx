/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Trash2, ShieldCheck, Clock, FileText, HardDrive, 
  RefreshCw, CheckCircle2, AlertTriangle, Play, Sparkles,
  Info, Database, Layers, CloudUpload, Archive, FolderArchive,
  ArrowDownToLine, ExternalLink, Check, Lock
} from 'lucide-react';
import { AutoCleanupSettings, S3ArchiveStatus, S3ArchiveBatch } from '../../types.js';

interface AutoCleanupSettingsCardProps {
  authToken?: string | null;
}

interface CurrentStorageStats {
  logsTotal: number;
  logsOlderThanRetention: number;
  accessLogsTotal: number;
  tempFilesTotal: number;
  tempFilesBytes: number;
  tempFilesOlderThanRetention: number;
  tempBytesOlderThanRetention: number;
  scannedDirs: string[];
}

export function AutoCleanupSettingsCard({ authToken }: AutoCleanupSettingsCardProps) {
  const [settings, setSettings] = useState<AutoCleanupSettings>({
    enabled: true,
    logRetentionDays: 30,
    tempFilesRetentionDays: 30,
    autoRunDaily: true,
    archiveCallsToS3: true,
    archiveOlderThanDays: 30,
    deleteLocalAfterArchive: false
  });
  const [currentStats, setCurrentStats] = useState<CurrentStorageStats | null>(null);
  const [archiveStatus, setArchiveStatus] = useState<S3ArchiveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningCleanup, setRunningCleanup] = useState(false);
  const [runningArchive, setRunningArchive] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [lastCleanupStats, setLastCleanupStats] = useState<any>(null);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const headers: Record<string, string> = { 'x-user-role': 'admin' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const res = await fetch('/api/admin/cleanup-settings', { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.settings) {
          setSettings({
            enabled: data.settings.enabled !== false,
            logRetentionDays: data.settings.logRetentionDays || 30,
            tempFilesRetentionDays: data.settings.tempFilesRetentionDays || 30,
            autoRunDaily: data.settings.autoRunDaily !== false,
            archiveCallsToS3: data.settings.archiveCallsToS3 !== false,
            archiveOlderThanDays: data.settings.archiveOlderThanDays || data.settings.logRetentionDays || 30,
            deleteLocalAfterArchive: !!data.settings.deleteLocalAfterArchive,
            lastRunTimestamp: data.settings.lastRunTimestamp,
            lastRunStats: data.settings.lastRunStats,
            lastArchiveTimestamp: data.settings.lastArchiveTimestamp,
            lastArchiveStats: data.settings.lastArchiveStats
          });
          if (data.settings.lastRunStats) {
            setLastCleanupStats(data.settings.lastRunStats);
          }
        }
        if (data.currentStats) {
          setCurrentStats(data.currentStats);
        }
        if (data.archiveStatus) {
          setArchiveStatus(data.archiveStatus);
        }
      }
    } catch (err: any) {
      console.error('Failed to load cleanup & archive settings:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, [authToken]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const headers: Record<string, string> = { 
        'x-user-role': 'admin',
        'Content-Type': 'application/json'
      };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const res = await fetch('/api/admin/cleanup-settings', {
        method: 'POST',
        headers,
        body: JSON.stringify(settings)
      });
      const data = await res.json();
      if (res.ok) {
        setFeedback({ type: 'success', message: 'Настройки автоочистки и S3-архивации (152-ФЗ) успешно сохранены' });
        await fetchSettings();
      } else {
        setFeedback({ type: 'error', message: data.error || 'Ошибка при сохранении' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Сетевая ошибка' });
    } finally {
      setSaving(false);
    }
  };

  const handleRunCleanupNow = async () => {
    const days = settings.logRetentionDays || 30;
    if (!confirm(`Выполнить регламентную очистку логов и временных файлов старше ${days} дней, а также архивацию звонков в S3 прямо сейчас?`)) {
      return;
    }
    setRunningCleanup(true);
    setFeedback(null);
    try {
      const headers: Record<string, string> = { 'x-user-role': 'admin' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const res = await fetch('/api/admin/cleanup/run', { method: 'POST', headers });
      const data = await res.json();
      if (res.ok && data.stats) {
        setLastCleanupStats(data.stats);
        const archiveNote = data.stats.callsArchivedToS3 !== undefined
          ? `, архивировано в S3: ${data.stats.callsArchivedToS3} звонков`
          : '';
        setFeedback({
          type: 'success',
          message: `Регламентная процедура успешно выполнена: удалено ${data.stats.logsCleaned} логов, ${data.stats.tempFilesCleaned} временных файлов (${formatBytes(data.stats.tempBytesCleaned || 0)}), ${data.stats.audioRemoved} аудиозаписей${archiveNote}.`
        });
        await fetchSettings();
      } else {
        setFeedback({ type: 'error', message: data.error || 'Ошибка при выполнении очистки' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Ошибка запуска процедуры очистки' });
    } finally {
      setRunningCleanup(false);
    }
  };

  const handleRunArchiveNow = async (forceAllOlder = false) => {
    const days = settings.archiveOlderThanDays || settings.logRetentionDays || 30;
    if (!confirm(`Выполнить архивацию звонков старше ${days} дней в защищенное S3 хранилище с шифрованием AES-256-GCM (152-ФЗ)?`)) {
      return;
    }
    setRunningArchive(true);
    setFeedback(null);
    try {
      const headers: Record<string, string> = { 
        'x-user-role': 'admin',
        'Content-Type': 'application/json'
      };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const res = await fetch('/api/admin/archive/run', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          retentionDays: days,
          deleteLocalAfterArchive: settings.deleteLocalAfterArchive,
          forceAllOlder
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setFeedback({
          type: 'success',
          message: data.message || `Архивация в S3 успешно завершена: ${data.result?.archivedCount || 0} звонков выгружено.`
        });
        await fetchSettings();
      } else {
        setFeedback({
          type: 'error',
          message: data.error || data.message || 'Ошибка архивации в S3'
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Ошибка выполнения запроса на архивацию в S3'
      });
    } finally {
      setRunningArchive(false);
    }
  };

  function formatBytes(bytes: number): string {
    if (!bytes || bytes === 0) return '0 Б';
    const k = 1024;
    const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatDate(isoString?: string): string {
    if (!isoString) return 'Не выполнялась';
    try {
      return new Date(isoString).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    } catch {
      return isoString;
    }
  }

  const archiveDays = settings.archiveOlderThanDays || settings.logRetentionDays || 30;

  return (
    <div className="space-y-6" id="auto-cleanup-and-archive-settings">
      {/* 152-FZ Legal Regulatory Banner */}
      <div className="bg-gradient-to-r from-emerald-950/60 via-slate-900 to-teal-950/60 border border-emerald-800/60 rounded-2xl p-5 text-emerald-100 flex flex-col md:flex-row items-start gap-4 shadow-xs">
        <div className="p-3 bg-emerald-500/20 text-emerald-300 rounded-xl shrink-0 border border-emerald-500/30">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <div className="space-y-1 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-white tracking-tight">
              Регламент автоматической очистки и S3-архивации данных (ст. 5 и 21 закона 152-ФЗ)
            </h3>
            <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full">
              Соответствие 152-ФЗ
            </span>
            <span className="bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 font-mono">
              <Lock className="w-3 h-3" /> AES-256-GCM S3
            </span>
          </div>
          <p className="text-emerald-200/90 leading-relaxed">
            В соответствии с Федеральным законом № 152-ФЗ «О персональных данных», персональные данные субъектов, технические логи обработки, временные аудиофайлы SpeechKit и звонки подлежат обязательному уничтожению либо долговременной архивации в зашифрованное хранилище по достижении регламентных сроков (рекомендованный срок <strong>TTL_LOG_DAYS = {settings.logRetentionDays} дней</strong>).
          </p>
        </div>
      </div>

      {/* Storage & Retention Live State Overview: 4-Card Responsive Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: System Logs State */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between text-slate-200">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span className="flex items-center gap-1.5 font-medium">
                <FileText className="w-4 h-4 text-blue-400" /> Системные логи
              </span>
              <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">
                {settings.logRetentionDays} дн. лимит
              </span>
            </div>
            <div className="text-2xl font-bold text-white">
              {currentStats ? currentStats.logsTotal : '...'}
              <span className="text-xs font-normal text-slate-400 ml-1.5">записей</span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between">
            <span>Старше {settings.logRetentionDays} дн.:</span>
            <span className={`font-bold font-mono ${currentStats && currentStats.logsOlderThanRetention > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {currentStats ? `${currentStats.logsOlderThanRetention} к удалению` : '0'}
            </span>
          </div>
        </div>

        {/* Card 2: Temporary Files & Audio Cache */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between text-slate-200">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span className="flex items-center gap-1.5 font-medium">
                <HardDrive className="w-4 h-4 text-emerald-400" /> Временные файлы
              </span>
              <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">
                {settings.tempFilesRetentionDays} дн. лимит
              </span>
            </div>
            <div className="text-2xl font-bold text-white">
              {currentStats ? currentStats.tempFilesTotal : '...'}
              <span className="text-xs font-normal text-slate-400 ml-1.5">
                ({currentStats ? formatBytes(currentStats.tempFilesBytes) : '0 Б'})
              </span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between">
            <span>Старше {settings.tempFilesRetentionDays} дн.:</span>
            <span className={`font-bold font-mono ${currentStats && currentStats.tempFilesOlderThanRetention > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {currentStats ? `${currentStats.tempFilesOlderThanRetention} ф. (${formatBytes(currentStats.tempBytesOlderThanRetention)})` : '0'}
            </span>
          </div>
        </div>

        {/* Card 3: S3 Archive Status (Calls older than TTL_LOG_DAYS) */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between text-slate-200 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-full blur-xl pointer-events-none" />
          <div>
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span className="flex items-center gap-1.5 font-medium">
                <Archive className="w-4 h-4 text-amber-400" /> S3-Архив звонков
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold ${
                archiveStatus?.s3Connected 
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' 
                  : archiveStatus?.s3Configured 
                    ? 'bg-amber-950 text-amber-300 border border-amber-800'
                    : 'bg-rose-950 text-rose-300 border border-rose-800'
              }`}>
                {archiveStatus?.s3Connected ? 'S3 Активно' : (archiveStatus?.s3Configured ? 'S3 Ошибка' : 'S3 Нет связи')}
              </span>
            </div>
            <div className="text-2xl font-bold text-white">
              {archiveStatus ? archiveStatus.olderThanTtlCalls : '...'}
              <span className="text-xs font-normal text-slate-400 ml-1.5">старше {archiveDays} дн.</span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between">
            <span>В архиве S3 / К выгрузке:</span>
            <span className="font-mono">
              <span className="text-emerald-400 font-bold">{archiveStatus?.alreadyArchivedCalls || 0}</span>
              <span className="text-slate-600 mx-1">/</span>
              <span className={archiveStatus && archiveStatus.pendingArchiveCalls > 0 ? 'text-amber-400 font-bold' : 'text-slate-400'}>
                {archiveStatus?.pendingArchiveCalls || 0}
              </span>
            </span>
          </div>
        </div>

        {/* Card 4: Last Scheduled Cleanup & Archive */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between text-slate-200">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span className="flex items-center gap-1.5 font-medium">
                <Clock className="w-4 h-4 text-amber-400" /> Регламентная очистка
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${settings.enabled ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-rose-950 text-rose-400'}`}>
                {settings.enabled ? 'Автоочистка активна' : 'Отключена'}
              </span>
            </div>
            <div className="text-xs font-semibold text-white truncate">
              {formatDate(settings.lastRunTimestamp)}
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between">
            <span>В прошлый раз:</span>
            <span className="font-mono text-emerald-400 truncate max-w-[150px]" title={lastCleanupStats ? `${lastCleanupStats.logsCleaned || 0} логов, S3: ${lastCleanupStats.callsArchivedToS3 || 0}` : '—'}>
              {lastCleanupStats ? `${lastCleanupStats.logsCleaned || 0} лог, S3: ${lastCleanupStats.callsArchivedToS3 || 0}` : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Main Configuration Form */}
      <form onSubmit={handleSaveSettings} className="space-y-6">
        {/* Feedback Alert */}
        {feedback && (
          <div className={`p-4 rounded-xl text-xs flex items-center gap-2.5 ${
            feedback.type === 'success' 
              ? 'bg-emerald-950/80 border border-emerald-800 text-emerald-200' 
              : 'bg-rose-950/80 border border-rose-800 text-rose-200'
          }`}>
            {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />}
            <span>{feedback.message}</span>
          </div>
        )}

        {/* SECTION 1: Automatic S3 Call Archiving (Requested 152-FZ Feature) */}
        <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-blue-900/40 rounded-2xl p-6 space-y-5 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg border border-blue-500/20">
                  <CloudUpload className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    Автоматическая архивация звонков старше TTL_LOG_DAYS дней в S3 хранилище
                    <span className="bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full font-mono">
                      152-ФЗ
                    </span>
                  </h4>
                  <p className="text-xs text-slate-400">
                    Перемещение завершенных звонков и метаданных в зашифрованный архив S3 (AES-256-GCM) для долгосрочного аудита
                  </p>
                </div>
              </div>
            </div>

            {/* S3 Connection Pill */}
            <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-xs">
              <span className={`w-2 h-2 rounded-full ${archiveStatus?.s3Connected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              <span className="text-slate-300 font-mono text-[11px]">
                {archiveStatus?.s3Bucket !== '—' ? `s3://${archiveStatus?.s3Bucket}` : 'Бакет S3 не задан'}
              </span>
            </div>
          </div>

          {/* S3 Storage Status Banner */}
          {!archiveStatus?.s3Configured && (
            <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-800/60 text-amber-200 text-xs flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-white">S3 хранилище не настроено в системе</p>
                <p className="text-[11px] text-amber-300/80 mt-1">
                  Для активации автоматической выгрузки звонков укажите S3 Endpoint, Bucket Name, Access Key и Secret Key во вкладке «Токены, Ключи & Интеграции» (поддерживаются Timeweb Cloud S3, Yandex Object Storage и любые S3-совместимые хранилища).
                </p>
              </div>
            </div>
          )}

          {/* Archive Settings Controls */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
            {/* Age Threshold Slider */}
            <div className="space-y-3 bg-slate-950/70 p-4 rounded-xl border border-slate-800/80">
              <div className="flex items-center justify-between">
                <label htmlFor="archive-older-than-days-input" className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <Archive className="w-4 h-4 text-amber-400" />
                  Порог возраста звонков для архивации:
                </label>
                <span className="font-bold text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 font-mono">
                  {archiveDays} дней (TTL)
                </span>
              </div>

              <div className="flex items-center gap-3">
                <input
                  id="archive-older-than-days-input"
                  type="range"
                  min="7"
                  max="180"
                  step="1"
                  value={archiveDays}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setSettings({ ...settings, archiveOlderThanDays: val });
                  }}
                  className="w-full accent-amber-500 cursor-pointer"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                {[14, 30, 60, 90].map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setSettings({ ...settings, archiveOlderThanDays: days })}
                    className={`text-[11px] px-2.5 py-1 rounded transition-colors ${
                      archiveDays === days 
                        ? 'bg-amber-600 text-white font-bold shadow-xs' 
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    {days} дн. {days === 30 && '(152-ФЗ TTL)'}
                  </button>
                ))}
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                Все звонки, поступившие ранее этого срока, автоматически упаковываются в зашифрованный пакет <code className="text-slate-300">calls-*.json.enc</code> и переносятся в S3.
              </p>
            </div>

            {/* Checkbox Options & Triggers */}
            <div className="space-y-4 bg-slate-950/70 p-4 rounded-xl border border-slate-800/80 flex flex-col justify-between">
              <div className="space-y-3">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={settings.archiveCallsToS3 !== false}
                    onChange={(e) => setSettings({ ...settings, archiveCallsToS3: e.target.checked })}
                    className="mt-0.5 w-4 h-4 rounded border-slate-700 bg-slate-800 text-blue-600 focus:ring-blue-500"
                  />
                  <div className="text-xs">
                    <span className="font-semibold text-slate-200 group-hover:text-white transition-colors">
                      Включить автоматическую архивацию звонков в S3
                    </span>
                    <p className="text-slate-400 text-[11px] mt-0.5">
                      При ежедневной регламентной процедуре звонки старше {archiveDays} дней автоматически отправляются в S3.
                    </p>
                  </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={!!settings.deleteLocalAfterArchive}
                    onChange={(e) => setSettings({ ...settings, deleteLocalAfterArchive: e.target.checked })}
                    className="mt-0.5 w-4 h-4 rounded border-slate-700 bg-slate-800 text-amber-600 focus:ring-amber-500"
                  />
                  <div className="text-xs">
                    <span className="font-semibold text-slate-200 group-hover:text-white transition-colors">
                      Очищать локальное аудио и транскрипты после архивации
                    </span>
                    <p className="text-slate-400 text-[11px] mt-0.5">
                      Освобождает локальный диск сервера; полные данные остаются доступны в защищенном архиве S3.
                    </p>
                  </div>
                </label>
              </div>

              {/* Action buttons inside S3 box */}
              <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleRunArchiveNow(false)}
                  disabled={runningArchive || !archiveStatus?.s3Configured}
                  className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-colors flex items-center gap-2 disabled:opacity-50"
                  title="Архивировать неархивированные звонки старше срока"
                >
                  <CloudUpload className={`w-3.5 h-3.5 ${runningArchive ? 'animate-bounce' : ''}`} />
                  {runningArchive ? 'Архивация в S3...' : 'Заархивировать в S3 прямо сейчас'}
                </button>

                {archiveStatus && archiveStatus.alreadyArchivedCalls > 0 && (
                  <button
                    type="button"
                    onClick={() => handleRunArchiveNow(true)}
                    disabled={runningArchive || !archiveStatus?.s3Configured}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
                    title="Принудительно переархивировать все звонки старше срока"
                  >
                    <FolderArchive className="w-3.5 h-3.5 text-slate-400" />
                    Полная выгрузка
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* S3 Archive Manifest / Recent Batches */}
          {archiveStatus?.recentBatches && archiveStatus.recentBatches.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span className="font-semibold flex items-center gap-1.5">
                  <FolderArchive className="w-4 h-4 text-blue-400" />
                  Архивные пакеты в S3 ({archiveStatus.recentBatches.length}):
                </span>
                <span className="text-[11px] text-slate-400 font-mono">
                  Хранилище: {archiveStatus.s3Bucket}
                </span>
              </div>

              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {archiveStatus.recentBatches.map((batch: S3ArchiveBatch) => (
                  <div 
                    key={batch.archive_id}
                    className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-400" />
                      <span className="font-mono text-slate-200 font-bold">{batch.archive_id}</span>
                      <span className="text-slate-500">•</span>
                      <span className="text-emerald-400 font-semibold">{batch.calls_count} звонков</span>
                      <span className="text-slate-500">•</span>
                      <span className="text-slate-400 font-mono">{formatBytes(batch.size_bytes)}</span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] text-slate-400">
                      <span>{formatDate(batch.created_at)}</span>
                      <span className="text-slate-600 font-mono hidden md:inline truncate max-w-[200px]" title={batch.s3_key}>
                        {batch.s3_key.split('/').pop()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* SECTION 2: Logs & Temp Files Retention Parameters */}
        <div className="bg-slate-900/95 border border-slate-800 rounded-2xl p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-amber-400" />
                Параметры регламентного удаления логов и временных файлов
              </h4>
              <p className="text-xs text-slate-400 mt-1">
                Настройте периоды хранения для соблюдения сроков обработки персональных данных салона
              </p>
            </div>

            <button
              type="button"
              onClick={fetchSettings}
              disabled={loading}
              className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Обновить состояние"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Log Retention Setting */}
            <div className="space-y-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
              <div className="flex items-center justify-between">
                <label htmlFor="log-retention-input" className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-blue-400" />
                  Срок хранения системных логов и аудита:
                </label>
                <span className="font-bold text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20 font-mono">
                  {settings.logRetentionDays} дней
                </span>
              </div>

              <div className="flex items-center gap-3">
                <input
                  id="log-retention-input"
                  type="range"
                  min="7"
                  max="90"
                  step="1"
                  value={settings.logRetentionDays}
                  onChange={(e) => setSettings({ ...settings, logRetentionDays: Number(e.target.value) })}
                  className="w-full accent-blue-500 cursor-pointer"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                {[14, 30, 60, 90].map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setSettings({ ...settings, logRetentionDays: days })}
                    className={`text-[11px] px-2.5 py-1 rounded transition-colors ${
                      settings.logRetentionDays === days 
                        ? 'bg-blue-600 text-white font-bold shadow-xs' 
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    {days} дн. {days === 30 && '(152-ФЗ)'}
                  </button>
                ))}
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                Все записи журнала действий, системные логи и события доступа старше указанного срока безвозвратно удаляются из зашифрованной базы данных.
              </p>
            </div>

            {/* Temp Files Retention Setting */}
            <div className="space-y-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
              <div className="flex items-center justify-between">
                <label htmlFor="temp-retention-input" className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <HardDrive className="w-4 h-4 text-emerald-400" />
                  Срок хранения временных файлов и аудио:
                </label>
                <span className="font-bold text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 font-mono">
                  {settings.tempFilesRetentionDays} дней
                </span>
              </div>

              <div className="flex items-center gap-3">
                <input
                  id="temp-retention-input"
                  type="range"
                  min="7"
                  max="90"
                  step="1"
                  value={settings.tempFilesRetentionDays}
                  onChange={(e) => setSettings({ ...settings, tempFilesRetentionDays: Number(e.target.value) })}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                {[14, 30, 60, 90].map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setSettings({ ...settings, tempFilesRetentionDays: days })}
                    className={`text-[11px] px-2.5 py-1 rounded transition-colors ${
                      settings.tempFilesRetentionDays === days 
                        ? 'bg-emerald-600 text-white font-bold shadow-xs' 
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    {days} дн. {days === 30 && '(152-ФЗ)'}
                  </button>
                ))}
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                Файлы во временных директориях (/app/temp, uploads, os.tmpdir), временные WAV/MP3 фрагменты и кэш конвертации SpeechKit очищаются с диска.
              </p>
            </div>
          </div>

          {/* Checkboxes & Switches */}
          <div className="space-y-3 pt-2">
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
                className="mt-0.5 w-4 h-4 rounded border-slate-700 bg-slate-800 text-emerald-600 focus:ring-emerald-500"
              />
              <div className="text-xs">
                <span className="font-semibold text-slate-200 group-hover:text-white transition-colors">
                  Включить регламентную процедуру автоматической очистки (152-ФЗ)
                </span>
                <p className="text-slate-400 text-[11px] mt-0.5">
                  Автоматически удаляет устаревшие логи, временные файлы и очищает ссылки на аудиозаписи.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={settings.autoRunDaily}
                onChange={(e) => setSettings({ ...settings, autoRunDaily: e.target.checked })}
                className="mt-0.5 w-4 h-4 rounded border-slate-700 bg-slate-800 text-emerald-600 focus:ring-emerald-500"
              />
              <div className="text-xs">
                <span className="font-semibold text-slate-200 group-hover:text-white transition-colors">
                  Ежедневный запуск по расписанию (раз в 24 часа в 03:00 МСК)
                </span>
                <p className="text-slate-400 text-[11px] mt-0.5">
                  Автоматический фоновый запуск процедур автоочистки и S3-архивации без ручного вмешательства.
                </p>
              </div>
            </label>
          </div>

          {/* Monitored directories note */}
          {currentStats?.scannedDirs && currentStats.scannedDirs.length > 0 && (
            <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-800/60 text-[11px] text-slate-400 flex items-start gap-2">
              <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
              <div>
                <span>Отслеживаемые директории временных файлов: </span>
                <span className="font-mono text-slate-300">
                  {currentStats.scannedDirs.join(', ')}
                </span>
              </div>
            </div>
          )}

          {/* Buttons Row */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-slate-800">
            <button
              type="submit"
              disabled={saving}
              className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              {saving ? 'Сохранение...' : 'Сохранить настройки 152-ФЗ'}
            </button>

            <button
              type="button"
              onClick={handleRunCleanupNow}
              disabled={runningCleanup}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 font-medium text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Play className={`w-3.5 h-3.5 ${runningCleanup ? 'animate-spin' : ''}`} />
              {runningCleanup ? 'Выполняется процедура...' : 'Запустить регламентную очистку и S3-архивацию прямо сейчас'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
