/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Sparkles, CheckCircle2, AlertCircle, FileText, RotateCcw, 
  Save, RefreshCw, Check, BookOpen, ShieldCheck, Zap
} from 'lucide-react';

interface SystemPromptEditorProps {
  authToken?: string | null;
  userRole?: string;
  salonName?: string;
  onPromptSaved?: (newPrompt: string) => void;
}

export function SystemPromptEditor({
  authToken,
  userRole = 'manager',
  salonName = 'Fashion Look Studio',
  onPromptSaved,
}: SystemPromptEditorProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [customSystemPrompt, setCustomSystemPrompt] = useState('');
  const [defaultSystemPrompt, setDefaultSystemPrompt] = useState('');
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const getHeaders = () => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-user-role': userRole,
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    return headers;
  };

  const loadPromptData = async () => {
    setLoading(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/settings/system-prompt', { headers: getHeaders() });
      if (!res.ok) {
        throw new Error(`Ошибка загрузки системного промпта (${res.status})`);
      }
      const data = await res.json();
      setCustomSystemPrompt(data.customSystemPrompt || '');
      setDefaultSystemPrompt(data.defaultSystemPrompt || '');
    } catch (err: any) {
      console.error('System prompt load error:', err);
      setSaveError(err.message || 'Не удалось загрузить системный промпт');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPromptData();
  }, [userRole]);

  const handleSavePrompt = async () => {
    setSaving(true);
    setSaveSuccess(null);
    setSaveError(null);
    try {
      const res = await fetch('/api/settings/system-prompt', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ customSystemPrompt: customSystemPrompt.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка при сохранении промпта');
      
      setSaveSuccess('Системный промпт ИИ успешно сохранён и активирован для анализа звонков!');
      if (onPromptSaved) onPromptSaved(customSystemPrompt.trim());
      setTimeout(() => setSaveSuccess(null), 4000);
    } catch (err: any) {
      setSaveError(err.message || 'Не удалось сохранить промпт');
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefault = async () => {
    if (!confirm('Сбросить системный промпт ИИ к заводскому эталонному значению по умолчанию?')) return;
    setSaving(true);
    setSaveSuccess(null);
    setSaveError(null);
    try {
      const res = await fetch('/api/settings/system-prompt/reset', {
        method: 'POST',
        headers: getHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка при сбросе промпта');
      
      setCustomSystemPrompt('');
      if (data.defaultSystemPrompt) setDefaultSystemPrompt(data.defaultSystemPrompt);
      setSaveSuccess('Системный промпт успешно сброшен к заводскому эталону!');
      if (onPromptSaved) onPromptSaved('');
      setTimeout(() => setSaveSuccess(null), 4000);
    } catch (err: any) {
      setSaveError(err.message || 'Не удалось сбросить промпт');
    } finally {
      setSaving(false);
    }
  };

  const handleLoadDefaultIntoEditor = () => {
    if (defaultSystemPrompt) {
      setCustomSystemPrompt(defaultSystemPrompt);
      setSaveSuccess('Текст эталонного заводского промпта скопирован в редактор для внесения правок.');
      setTimeout(() => setSaveSuccess(null), 4000);
    }
  };

  const handleAppendInstruction = (directive: string) => {
    const current = customSystemPrompt.trim() || defaultSystemPrompt.trim();
    setCustomSystemPrompt(`${current}\n\n${directive}`);
    setSaveSuccess('Правило добавлено в текст промпта. Нажмите «Сохранить промпт» для применения.');
    setTimeout(() => setSaveSuccess(null), 4000);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden" id="system-prompt-editor-card">
      {/* Header Banner */}
      <div className="p-5 border-b border-slate-200 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-white/10 rounded-xl border border-white/20">
            <Sparkles className="w-5 h-5 text-amber-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm tracking-tight">Редактор системного промпта ИИ (GigaChat)</h3>
              <span className="bg-indigo-500/30 text-indigo-200 border border-indigo-400/30 text-[10px] font-bold px-2 py-0.5 rounded-full">
                Доступ управляющего
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              Настройка инструкций нейросети: извлечение сути звонка, правил записи, параметров вежливости и стандартов сервиса
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-bold px-3 py-1 rounded-full border ${
            customSystemPrompt.trim().length > 0
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40'
              : 'bg-white/10 text-slate-300 border-white/20'
          }`}>
            {customSystemPrompt.trim().length > 0 ? '✓ Пользовательский промпт активен' : '⚙️ Заводской эталон'}
          </span>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Информационный регламент */}
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
          <div className="font-bold text-slate-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Обязательные требования к извлечению данных (152-ФЗ и регламент салона):</span>
          </div>
          <ul className="text-[11px] text-slate-600 space-y-1.5 list-disc pl-5 leading-relaxed">
            <li>
              <strong className="text-slate-800">Имена специалистов строго с заглавной буквы:</strong> Все имена и фамилии мастеров («Елена Валиулова», «Татьяна», «Арина») должны фиксироваться с прописной буквы.
            </li>
            <li>
              <strong className="text-slate-800">Запрет паразитных слов в поле мастера:</strong> Модель не должна подставлять частицы и глаголы («Меня Вот», «Записались», «Будете»).
            </li>
            <li>
              <strong className="text-slate-800">8 обязательных параметров резюме:</strong> Цель обращения, запрашиваемая услуга, предложенный мастер, озвученная стоимость, предложенные даты/время, состоялась ли запись, причина отказа, дальнейшие действия менеджера.
            </li>
            <li>
              <strong className="text-slate-800">Оценка по 10 критериям (0-10 баллов):</strong> Приветствие, выявление потребности, презентация услуги/мастера, стоимость, работа с возражениями, доп. услуги, параллельная запись, альтернативы, закрытие на запись, завершение.
            </li>
          </ul>
        </div>

        {/* Быстрые директивы */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-bold text-slate-700">
              Быстрая вставка директив в промпт:
            </label>
            <span className="text-[10px] text-slate-400">
              Нажмите кнопку, чтобы добавить правило в конец текста
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleAppendInstruction('ВНИМАНИЕ: Все фамилии и имена мастеров и клиентов ВСЕГДА пиши С ЗАГЛАВНОЙ БУКВЫ («Елена Валиулова», «Татьяна»). Любые имена из устной речи приводи к заглавной букве!')}
              className="px-2.5 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 font-medium rounded-lg border border-slate-200 transition-colors"
            >
              + ФИО с заглавной буквы
            </button>
            <button
              type="button"
              onClick={() => handleAppendInstruction('СТРОГИЙ ЗАПРЕТ: Никогда не пиши в поле мастера слова-паразиты («Меня Вот», «Записались», «Будете»)! Мастер — это строго имя реального сотрудника салона.')}
              className="px-2.5 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 font-medium rounded-lg border border-slate-200 transition-colors"
            >
              + Запрет мусорных слов
            </button>
            <button
              type="button"
              onClick={() => handleAppendInstruction('ФОРМАТ ВРЕМЕНИ: Фиксируй время строго в формате ЧЧ:ММ («15:00», «19:00»). Устный счет вроде «15 0 0» распознавай как «15:00».')}
              className="px-2.5 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 font-medium rounded-lg border border-slate-200 transition-colors"
            >
              + Формат времени ЧЧ:ММ
            </button>
            <button
              type="button"
              onClick={() => handleAppendInstruction(`НАЗВАНИЕ САЛОНА: Официальное наименование салона красоты — «${salonName}». Регламент приветствия обязателен.`)}
              className="px-2.5 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 font-medium rounded-lg border border-slate-200 transition-colors"
            >
              + Наименование салона «{salonName}»
            </button>
          </div>
        </div>

        {/* Текстовая область промпта */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-bold text-slate-700">
              Текст системного промпта нейросети:
            </label>
            <div className="flex items-center gap-3 text-xs text-slate-500 font-mono">
              <span>Символов: {customSystemPrompt.length || defaultSystemPrompt.length}</span>
              <span>Слов: {(customSystemPrompt || defaultSystemPrompt).split(/\s+/).filter(Boolean).length}</span>
            </div>
          </div>

          <div className="relative">
            <textarea
              rows={14}
              value={customSystemPrompt}
              onChange={(e) => setCustomSystemPrompt(e.target.value)}
              placeholder={defaultSystemPrompt || 'Используется заводской эталонный промпт...'}
              className="w-full px-4 py-3 bg-slate-900 text-slate-100 border border-slate-700 rounded-xl text-xs font-mono leading-relaxed focus:ring-2 focus:ring-indigo-500 focus:outline-hidden shadow-inner"
              id="system-prompt-textarea"
            />
            {!customSystemPrompt && (
              <div className="absolute right-3 bottom-3 pointer-events-none text-[11px] text-slate-400 bg-slate-800/90 px-2.5 py-1 rounded border border-slate-700">
                Заводской эталонный промпт активен (поле пустое)
              </div>
            )}
          </div>

          <p className="text-[11px] text-slate-500">
            Если поле пустое, нейросеть автоматически использует эталонный заводской системный промпт с адаптацией под салон «{salonName}». Для переопределения логики анализа введите собственный текст и нажмите «Сохранить промпт».
          </p>
        </div>

        {/* Сообщения об успехе/ошибке */}
        {saveSuccess && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-emerald-800">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>{saveSuccess}</span>
          </div>
        )}
        {saveError && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-rose-800">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{saveError}</span>
          </div>
        )}

        {/* Кнопки действий */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleLoadDefaultIntoEditor}
              disabled={saving || !defaultSystemPrompt}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5"
              title="Загрузить эталонный заводской текст в окно редактора"
              id="prompt-editor-load-default-btn"
            >
              <FileText className="w-3.5 h-3.5 text-slate-500" />
              <span>Загрузить эталон в редактор</span>
            </button>

            <button
              type="button"
              onClick={handleResetToDefault}
              disabled={saving}
              className="px-3 py-2 bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-700 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5"
              title="Сбросить к заводскому промпту"
              id="prompt-editor-reset-default-btn"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Сбросить к заводскому</span>
            </button>

            <button
              type="button"
              onClick={loadPromptData}
              disabled={loading || saving}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5"
              title="Перезагрузить промпт с сервера"
              id="prompt-editor-reload-btn"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Обновить</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleSavePrompt}
            disabled={saving}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-2"
            id="prompt-editor-save-btn"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>Сохранить промпт</span>
          </button>
        </div>
      </div>
    </div>
  );
}
