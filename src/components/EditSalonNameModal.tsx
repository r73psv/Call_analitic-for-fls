/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Building2, Save, X, AlertCircle, CheckCircle2, RotateCcw } from 'lucide-react';

interface EditSalonNameModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentName: string;
  onSave: (newName: string) => Promise<boolean>;
  userRole?: string;
}

const PRESET_SUGGESTIONS = [
  'Лик 28',
  'Лик 28 Премиум',
  'Лик',
  'Beauty Studio',
  'Mon Amie',
  'Этуаль',
  'Магия Красоты',
];

export const EditSalonNameModal: React.FC<EditSalonNameModalProps> = ({
  isOpen,
  onClose,
  currentName,
  onSave,
  userRole = 'admin',
}) => {
  const [salonName, setSalonName] = useState(currentName || 'Лик 28');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSalonName(currentName || 'Лик 28');
      setError(null);
      setSuccess(false);
    }
  }, [isOpen, currentName]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanName = salonName.trim();
    if (!cleanName) {
      setError('Пожалуйста, введите название салона красоты');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const ok = await onSave(cleanName);
      if (ok) {
        setSuccess(true);
        setTimeout(() => {
          onClose();
        }, 600);
      } else {
        setError('Не удалось сохранить название салона. Проверьте права администратора.');
      }
    } catch (err: any) {
      setError(err?.message || 'Ошибка сохранения названия салона');
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div 
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
        onKeyDown={handleKeyDown}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.15 }}
          className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full overflow-hidden"
          role="dialog"
          aria-modal="true"
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-emerald-600 to-teal-700 px-6 py-4 text-white flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-xl">
                <Building2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-base leading-tight">Название салона красоты</h3>
                <p className="text-xs text-emerald-100">Ручной ввод и настройка бренда</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              title="Закрыть"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label 
                htmlFor="salon-name-input"
                className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5"
              >
                Наименование организации / салона
              </label>
              <div className="relative">
                <input
                  id="salon-name-input"
                  type="text"
                  value={salonName}
                  onChange={(e) => {
                    setSalonName(e.target.value);
                    if (error) setError(null);
                  }}
                  autoFocus
                  placeholder="Например: Лик 28, Mon Amie, Магия Красоты..."
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 transition-all placeholder:text-slate-400"
                  maxLength={100}
                />
                {salonName.trim() !== 'Лик 28' && (
                  <button
                    type="button"
                    onClick={() => setSalonName('Лик 28')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 rounded-md transition-colors text-xs flex items-center gap-1"
                    title="Вернуть «Лик 28» по умолчанию"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span className="text-[10px]">Лик 28</span>
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                Это название применяется в шапке системы, протоколах аудита звонков (PDF), автоинформаторе 152-ФЗ и речевых скриптах GigaChat.
              </p>
            </div>

            {/* Quick Suggestions */}
            <div>
              <div className="text-[11px] font-medium text-slate-500 mb-1.5">
                Быстрый выбор:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_SUGGESTIONS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setSalonName(preset)}
                    className={`px-2.5 py-1 text-xs rounded-lg border transition-all ${
                      salonName === preset
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-800 font-bold'
                        : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-600'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Preview Banner */}
            <div className="bg-slate-50 border border-slate-200/90 rounded-xl p-3 text-xs text-slate-700">
              <span className="font-semibold text-slate-800">Предварительный просмотр:</span>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="text-slate-500 text-[11px]">В шапке и отчетах:</span>
                <span className="bg-emerald-100/70 text-emerald-900 border border-emerald-200 text-[11px] font-bold px-2 py-0.5 rounded-md">
                  салон «{salonName.trim() || '...'}»
                </span>
              </div>
            </div>

            {/* Error & Success Messages */}
            {error && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            {success && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-800 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Название успешно обновлено!</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="px-4 py-2 border border-slate-200 text-slate-700 hover:bg-slate-100 rounded-xl text-xs font-semibold transition-colors"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={saving || !salonName.trim()}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
                id="submit-salon-name-btn"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Сохранение...' : 'Сохранить название'}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
