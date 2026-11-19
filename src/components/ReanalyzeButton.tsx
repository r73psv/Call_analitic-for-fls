/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { RefreshCw, ChevronDown, Check, Mic } from 'lucide-react';
import { GigaChatModel, CallRecord, SttProvider } from '../types.js';
import { STT_MODELS, getSttEngineDisplayName } from './TranscriptionModelSelector.js';

interface ReanalyzeButtonProps {
  callId: string;
  currentModel?: string;
  currentSttEngine?: string;
  hasAudio?: boolean;
  onReanalyzed: (updatedCall: CallRecord) => void;
  onError?: (errorMessage: string | null) => void;
  userRole?: string;
}

export const ReanalyzeButton: React.FC<ReanalyzeButtonProps> = ({
  callId,
  currentModel = 'GigaChat:Lite',
  currentSttEngine,
  hasAudio = false,
  onReanalyzed,
  onError,
  userRole = 'admin',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<GigaChatModel>(
    (currentModel.startsWith('GigaChat:') ? currentModel : 'GigaChat:Lite') as GigaChatModel
  );
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState('Анализ...');
  const [error, setError] = useState<string | null>(null);

  const models: { id: GigaChatModel; label: string; desc: string }[] = [
    { id: 'GigaChat:Lite', label: 'Lite (Базовая)', desc: 'Быстрый анализ' },
    { id: 'GigaChat:Pro', label: 'Pro (Сложные диалоги)', desc: 'Глубокий разбор конфликтов' },
    { id: 'GigaChat:Max', label: 'Max (Флагман)', desc: 'Максимальная точность' },
    { id: 'GigaChat:Ultra', label: 'Ultra (Reasoning)', desc: 'Глубокое рассуждение и аналитика' },
  ];

  const handleReanalyze = async (modelToUse: GigaChatModel, sttProvider?: SttProvider) => {
    setLoading(true);
    setLoadingLabel(sttProvider ? `Транскрибация (${getSttEngineDisplayName(sttProvider)})...` : 'Анализ...');
    setError(null);
    onError?.(null);
    setIsOpen(false);

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('callqa_auth_token') : null;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-user-role': userRole,
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`/api/calls/${callId}/reanalyze`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: modelToUse,
          ...(sttProvider ? { sttProvider, forceRetranscribe: true } : {}),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data?.call) {
          onReanalyzed(data.call as CallRecord);
        }
        const errMsg = data?.error || `Ошибка сервера: HTTP ${res.status}`;
        setError(errMsg);
        onError?.(errMsg);
        return;
      }

      const updated: CallRecord = data as CallRecord;
      onReanalyzed(updated);
      if (updated.error_message) {
        setError(updated.error_message);
        onError?.(updated.error_message);
      } else if (
        updated.summary_source === 'template' &&
        updated.fallback_reason &&
        !/<\s*10\s*сек|0\s*сек/i.test(updated.fallback_reason)
      ) {
        const fbMsg = `Анализ выполнен резервным генератором, модель недоступна: ${updated.fallback_reason}`;
        setError(fbMsg);
        onError?.(fbMsg);
      } else if (sttProvider && updated.transcription_engine === 'none') {
        const sttMsg = `Не удалось выполнить транскрибацию (${getSttEngineDisplayName(sttProvider)}). Проверьте настройки и журнал логов.`;
        setError(sttMsg);
        onError?.(sttMsg);
      } else {
        onError?.(null);
      }
    } catch (err: any) {
      const msg = err.message || 'Ошибка повторного анализа';
      setError(msg);
      onError?.(msg);
    } finally {
      setLoading(false);
    }
  };

  if (userRole === 'viewer' || userRole === 'operator') {
    return null;
  }

  return (
    <div className="relative inline-block text-left">
      <div className="inline-flex rounded-lg shadow-2xs">
        <button
          type="button"
          onClick={() => handleReanalyze(selectedModel)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-l-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? loadingLabel : `Пересчитать (${selectedModel.replace('GigaChat:', '')})`}
        </button>

        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          disabled={loading}
          className="px-2 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-r-lg border-l border-emerald-500 transition-colors disabled:opacity-50"
          title="Выбрать модель GigaChat или транскрибацию"
          id="reanalyze-dropdown-toggle-btn"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-20"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-1.5 w-68 bg-white rounded-xl shadow-xl border border-slate-200 z-30 py-1.5 overflow-hidden">
            <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 border-b border-slate-100">
              Модель анализа GigaChat
            </div>
            {models.map((m) => {
              const isCurrent = selectedModel === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setSelectedModel(m.id);
                    handleReanalyze(m.id);
                  }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 flex items-start justify-between gap-2 transition-colors"
                >
                  <div>
                    <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                      {m.label}
                      {isCurrent && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{m.desc}</div>
                  </div>
                </button>
              );
            })}

            {hasAudio && (
              <>
                <div className="px-3 py-1.5 text-[11px] font-semibold text-indigo-600 border-t border-b border-slate-100 bg-indigo-50/40 flex items-center gap-1.5 mt-1">
                  <Mic className="w-3 h-3" />
                  <span>Перетранскрибировать аудиозапись</span>
                </div>
                {STT_MODELS.map((stt) => {
                  const isUsedEngine =
                    currentSttEngine === stt.id ||
                    (stt.id === 'yandex_speechkit' && currentSttEngine === 'speechkit');
                  return (
                    <button
                      key={stt.id}
                      type="button"
                      onClick={() => handleReanalyze(selectedModel, stt.id)}
                      id={`retranscribe-btn-${stt.id}`}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-indigo-50/60 flex items-start justify-between gap-2 transition-colors"
                    >
                      <div>
                        <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                          <span>{stt.label}</span>
                          {isUsedEngine && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">{stt.vendor}</div>
                      </div>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </>
      )}

      {error && (
        <div className="text-[11px] text-rose-600 mt-1 font-medium">
          {error}
        </div>
      )}
    </div>
  );
};
