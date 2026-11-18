/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Mic, ShieldCheck, Radio, Cpu, CheckCircle2, AlertCircle } from 'lucide-react';
import { SttProvider } from '../types.js';

export interface SttStatusMap {
  yandex_speechkit?: boolean;
  tbank_voicekit?: boolean;
  gigaam_v3?: boolean;
}

interface TranscriptionModelSelectorProps {
  currentModel: SttProvider | string;
  onSelectModel: (model: SttProvider) => void;
  disabled?: boolean;
  compact?: boolean;
  statusMap?: SttStatusMap;
}

export function getSttEngineDisplayName(engine?: string): string {
  switch (engine) {
    case 'tbank_voicekit':
    case 'tbank':
      return 'T-Bank VoiceKit';
    case 'gigaam_v3':
    case 'gigaam':
      return 'GigaASR / GigaAM v3';
    case 'yandex_speechkit':
    case 'speechkit':
    default:
      return 'Yandex SpeechKit';
  }
}

export const STT_MODELS: {
  id: SttProvider;
  shortLabel: string;
  label: string;
  vendor: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    id: 'yandex_speechkit',
    shortLabel: 'SpeechKit',
    label: 'Yandex SpeechKit',
    vendor: 'Yandex Cloud · 152-ФЗ',
    desc: 'Двухканальное распознавание, ролевая разметка диалога, длинные записи через S3.',
    icon: Radio,
  },
  {
    id: 'tbank_voicekit',
    shortLabel: 'T-Bank',
    label: 'T-Bank VoiceKit',
    vendor: 'Т-Банк Облако · 152-ФЗ',
    desc: 'Телефонное STT с JWT-авторизацией, разделением каналов и высокой точностью чисел.',
    icon: Mic,
  },
  {
    id: 'gigaam_v3',
    shortLabel: 'GigaASR',
    label: 'GigaASR / GigaAM v3',
    vendor: 'Cloud.ru Evolution · Сбер ASR',
    desc: 'Распознавание речи Сбер через Cloud.ru Foundation Models (GigaChat/GigaASR) или self-hosted GigaAM v3.',
    icon: Cpu,
  },
];

export const TranscriptionModelSelector: React.FC<TranscriptionModelSelectorProps> = ({
  currentModel,
  onSelectModel,
  disabled = false,
  compact = false,
  statusMap,
}) => {
  const normalizedCurrent: SttProvider =
    currentModel === 'tbank_voicekit' || currentModel === 'tbank'
      ? 'tbank_voicekit'
      : currentModel === 'gigaam_v3' || currentModel === 'gigaam'
      ? 'gigaam_v3'
      : 'yandex_speechkit';

  if (compact) {
    return (
      <div
        className="inline-flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200"
        role="group"
        aria-label="Выбор модели транскрибации речи"
      >
        {STT_MODELS.map((m) => {
          const isSelected = normalizedCurrent === m.id;
          const isConfigured = statusMap ? statusMap[m.id] : undefined;
          const statusHint =
            isConfigured === true
              ? 'Настроен'
              : isConfigured === false
              ? 'Требуется настройка ключей в админ-панели'
              : '';
          return (
            <button
              key={m.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelectModel(m.id)}
              title={`${m.label} (${m.vendor})${statusHint ? ` — ${statusHint}` : ''}`}
              id={`compact-stt-btn-${m.id}`}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                isSelected
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              } disabled:opacity-50`}
            >
              <span>{m.shortLabel}</span>
              {isConfigured === false && !isSelected && (
                <AlertCircle className="w-3 h-3 text-amber-500 shrink-0" aria-hidden="true" />
              )}
              {isConfigured === true && isSelected && (
                <CheckCircle2 className="w-3 h-3 text-indigo-100 shrink-0" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {STT_MODELS.map((m) => {
        const isSelected = normalizedCurrent === m.id;
        const isConfigured = statusMap ? statusMap[m.id] : undefined;
        const Icon = m.icon;
        return (
          <button
            key={m.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelectModel(m.id)}
            id={`stt-model-card-${m.id}`}
            className={`p-3.5 text-left rounded-xl border transition-colors flex flex-col justify-between gap-2 ${
              isSelected
                ? 'bg-indigo-50/70 border-indigo-500 ring-2 ring-indigo-500/20'
                : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
            } disabled:opacity-50 cursor-pointer`}
          >
            <div className="space-y-1.5 w-full">
              <div className="flex items-center justify-between gap-2 w-full">
                <div className="flex items-center gap-2 min-w-0">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isSelected ? 'text-indigo-600' : 'text-slate-500'
                    }`}
                  />
                  <span className="font-bold text-xs text-slate-900 truncate">{m.label}</span>
                </div>
                {isSelected && (
                  <span className="text-[11px] font-semibold text-indigo-700 whitespace-nowrap shrink-0 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" /> Активна
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span>{m.vendor}</span>
                {isConfigured !== undefined && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span
                      className={`font-semibold inline-flex items-center gap-1 ${
                        isConfigured ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {isConfigured ? (
                        <>
                          <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                          <span>Настроен</span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-3 h-3 text-amber-600 shrink-0" />
                          <span>Нужны ключи</span>
                        </>
                      )}
                    </span>
                  </>
                )}
              </div>
            </div>

            <p className="text-[11px] text-slate-600 leading-snug">{m.desc}</p>
          </button>
        );
      })}
    </div>
  );
};
