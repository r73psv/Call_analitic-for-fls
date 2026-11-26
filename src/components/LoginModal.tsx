/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Lock, User, KeyRound, ShieldCheck, AlertCircle, LogIn, Eye, EyeOff, Clock } from 'lucide-react';
import { UserRole } from '../types.js';
import { DEFAULT_SALON_NAME, LOGIN_FORM_TITLE, SalonThemeId, detectSalonTheme } from '../services/salonBranding.js';

interface LoginModalProps {
  onLoginSuccess: (user: { id: string; username: string; name: string; role: UserRole; salon_id?: string }, token: string) => void;
  isOpen: boolean;
  onOpenChangePassword?: () => void;
  salonName?: string;
  theme?: SalonThemeId;
  sessionExpiredNotice?: string | null;
}

export function LoginModal({
  onLoginSuccess,
  isOpen,
  onOpenChangePassword,
  salonName,
  theme,
  sessionExpiredNotice,
}: LoginModalProps) {
  const effectiveSalonName = salonName?.trim() || DEFAULT_SALON_NAME;
  const activeTheme: SalonThemeId = theme || detectSalonTheme(effectiveSalonName);
  const isLiq28 = activeTheme === 'liq28';

  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Ошибка авторизации');
      }

      localStorage.setItem('callqa_auth_token', data.token);
      localStorage.setItem('callqa_user_role', data.user.role);
      localStorage.setItem('callqa_user_info', JSON.stringify(data.user));
      localStorage.setItem('callqa_last_activity', String(Date.now()));

      onLoginSuccess(data.user, data.token);
    } catch (err: any) {
      setError(err.message || 'Не удалось выполнить вход');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickFill = (u: string, p: string) => {
    setUsername(u);
    setPassword(p);
    setError(null);
  };

  return (
    <div
      className={
        isLiq28
          ? 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#FAF7F2]/90 backdrop-blur-xs'
          : 'fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4'
      }
      id="login-modal-overlay"
    >
      <div
        className={
          isLiq28
            ? 'bg-white rounded-2xl max-w-md w-full border border-[#E6DDD1] overflow-hidden shadow-[0_24px_60px_-24px_rgba(31,27,24,0.18)] animate-in fade-in zoom-in-95 duration-200'
            : 'bg-white rounded-2xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200'
        }
        id="login-modal-card"
      >
        {/* Header */}
        {isLiq28 ? (
          <div className="bg-[#FAF7F2] border-b border-[#E6DDD1] px-7 pt-7 pb-6 text-center relative">
            <div className="inline-flex flex-col items-center">
              <span className="liq28-display text-2xl font-semibold tracking-[0.18em] text-[#1F1B18]">
                LIQ.28
              </span>
              <span className="block w-10 h-px bg-[#9A7B56] mt-2 mb-3" aria-hidden="true" />
            </div>
            <h2 className="text-[19px] font-semibold tracking-tight text-[#1F1B18] leading-snug">
              {LOGIN_FORM_TITLE}
            </h2>
            <p className="text-xs text-[#5C534A] mt-1.5">
              Салон красоты «{effectiveSalonName}» · Защита ПДн по 152-ФЗ
            </p>
            <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] font-medium text-[#7D6140]">
              <ShieldCheck className="w-3.5 h-3.5 text-[#9A7B56]" />
              <span>Ролевая модель доступа и шифрование AES-256</span>
            </div>
          </div>
        ) : (
          <div className="bg-gradient-to-r from-emerald-700 to-teal-800 p-6 text-white text-center relative">
            <div className="mx-auto w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center mb-3 shadow-inner">
              <Lock className="w-6 h-6 text-emerald-200" />
            </div>
            <h2 className="text-lg font-bold tracking-tight leading-snug">{LOGIN_FORM_TITLE}</h2>
            <p className="text-xs text-emerald-100/90 mt-1.5">
              Салон красоты «{effectiveSalonName}» • Защита ПДн по 152-ФЗ
            </p>
            <div className="mt-2.5 flex items-center justify-center gap-1.5 text-[11px] font-medium text-emerald-100/85">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
              <span>Ролевая модель доступа & Шифрование AES-256</span>
            </div>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4" id="login-form">
          {sessionExpiredNotice && (
            <div
              className="bg-amber-50 border border-amber-300 rounded-xl p-3 flex items-start gap-2.5 text-xs text-amber-900 shadow-2xs"
              id="session-expired-alert"
            >
              <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">Автоматический выход (4 часа неактивности)</div>
                <div className="text-[11px] text-amber-800 mt-0.5 leading-snug">{sessionExpiredNotice}</div>
              </div>
            </div>
          )}

          {error && (
            <div
              className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-rose-800"
              id="login-error-alert"
            >
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label
              className={`block text-xs font-semibold mb-1.5 ${
                isLiq28 ? 'text-[#2C2621]' : 'text-slate-700 font-bold'
              }`}
            >
              Имя пользователя (Логин)
            </label>
            <div className="relative">
              <User
                className={`w-4 h-4 absolute left-3 top-2.5 ${
                  isLiq28 ? 'text-[#9A8B7A]' : 'text-slate-400'
                }`}
              />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className={
                  isLiq28
                    ? 'w-full pl-9 pr-3 py-2.5 bg-[#FAF7F2] border border-[#DDD3C5] rounded-xl text-xs text-[#1F1B18] placeholder:text-[#9A8B7A] focus:border-[#9A7B56] focus:bg-white focus:outline-hidden transition-all'
                    : 'w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-hidden transition-all'
                }
                placeholder="admin / operator / manager / viewer"
                id="login-username-input"
              />
            </div>
          </div>

          <div>
            <label
              className={`block text-xs font-semibold mb-1.5 ${
                isLiq28 ? 'text-[#2C2621]' : 'text-slate-700 font-bold'
              }`}
            >
              Пароль
            </label>
            <div className="relative">
              <KeyRound
                className={`w-4 h-4 absolute left-3 top-2.5 ${
                  isLiq28 ? 'text-[#9A8B7A]' : 'text-slate-400'
                }`}
              />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className={
                  isLiq28
                    ? 'w-full pl-9 pr-10 py-2.5 bg-[#FAF7F2] border border-[#DDD3C5] rounded-xl text-xs text-[#1F1B18] placeholder:text-[#9A8B7A] focus:border-[#9A7B56] focus:bg-white focus:outline-hidden transition-all'
                    : 'w-full pl-9 pr-10 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-hidden transition-all'
                }
                placeholder="Введите ваш пароль"
                id="login-password-input"
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                className={`absolute right-3 top-2.5 p-0.5 ${
                  isLiq28 ? 'text-[#877C71] hover:text-[#1F1B18]' : 'text-slate-400 hover:text-slate-600'
                }`}
                title={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {onOpenChangePassword && (
              <div className="flex items-center justify-end mt-1.5">
                <button
                  type="button"
                  onClick={onOpenChangePassword}
                  className={
                    isLiq28
                      ? 'text-[11px] font-semibold text-[#7D6140] hover:text-[#1F1B18] hover:underline flex items-center gap-1'
                      : 'text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 hover:underline flex items-center gap-1'
                  }
                  id="login-modal-change-password-link"
                >
                  <KeyRound className="w-3 h-3" />
                  Сменить свой пароль
                </button>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className={
              isLiq28
                ? 'w-full py-2.5 bg-[#231F1C] hover:bg-[#38312B] disabled:bg-[#B8AEA2] text-[#FAF7F2] font-semibold text-xs tracking-wide rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer'
                : 'w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer'
            }
            id="login-submit-button"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Проверка доступа...
              </span>
            ) : (
              <>
                <LogIn className="w-4 h-4" /> Войти в систему
              </>
            )}
          </button>
        </form>

        {/* Security Rules Info */}
        <div
          className={
            isLiq28
              ? 'px-6 py-2.5 bg-[#FAF7F2]/80 border-t border-[#EAE2D7] text-[11px] text-[#6B6157] flex items-center justify-between'
              : 'px-6 py-2 bg-slate-100/60 border-t border-slate-200/80 text-[11px] text-slate-500 flex items-center justify-between'
          }
        >
          <span className="flex items-center gap-1.5">
            <Clock className={`w-3 h-3 ${isLiq28 ? 'text-[#9A7B56]' : 'text-emerald-600'}`} />
            Автовыход через 4 часа неактивности
          </span>
          <span className={`font-mono text-[10px] ${isLiq28 ? 'text-[#9A8B7A]' : 'text-slate-400'}`}>
            152-ФЗ Security
          </span>
        </div>

        {/* Quick Demo Credentials Preset */}
        <div
          className={
            isLiq28
              ? 'bg-[#F5F0E8]/70 border-t border-[#EAE2D7] p-4 text-xs text-[#5C534A]'
              : 'bg-slate-50 border-t border-slate-200/80 p-4 text-xs text-slate-600'
          }
        >
          <div className={`font-semibold mb-2 ${isLiq28 ? 'text-[#2C2621]' : 'text-slate-700 font-bold'}`}>
            Быстрый вход для проверки ролей (нажмите для автозаполнения):
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => handleQuickFill('admin', 'admin123')}
              className={
                isLiq28
                  ? 'p-2.5 bg-white hover:bg-[#FAF7F2] hover:border-[#9A7B56] border border-[#E6DDD1] rounded-lg text-left transition-colors cursor-pointer'
                  : 'p-2 bg-white hover:bg-emerald-50 hover:border-emerald-300 border border-slate-200 rounded-lg text-left transition-colors cursor-pointer'
              }
            >
              <div className={`font-semibold ${isLiq28 ? 'text-[#1F1B18]' : 'font-bold text-slate-800'}`}>
                Администратор салона
              </div>
              <div className={`font-mono text-[10px] ${isLiq28 ? 'text-[#7D7267]' : 'text-slate-500'}`}>
                admin / admin123
              </div>
              <div className={`text-[10px] mt-0.5 ${isLiq28 ? 'text-[#7D6140]' : 'text-emerald-700'}`}>
                Полный доступ + Админка
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleQuickFill('operator', 'operator123')}
              className={
                isLiq28
                  ? 'p-2.5 bg-white hover:bg-[#FAF7F2] hover:border-[#9A7B56] border border-[#E6DDD1] rounded-lg text-left transition-colors cursor-pointer'
                  : 'p-2 bg-white hover:bg-purple-50 hover:border-purple-300 border border-slate-200 rounded-lg text-left transition-colors cursor-pointer'
              }
            >
              <div className={`font-semibold ${isLiq28 ? 'text-[#1F1B18]' : 'font-bold text-slate-800'}`}>
                Администратор ресепшена
              </div>
              <div className={`font-mono text-[10px] ${isLiq28 ? 'text-[#7D7267]' : 'text-slate-500'}`}>
                operator / operator123
              </div>
              <div className={`text-[10px] mt-0.5 ${isLiq28 ? 'text-[#7D6140]' : 'text-purple-700'}`}>
                Звонки, запись и клиенты
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleQuickFill('manager', 'manager123')}
              className={
                isLiq28
                  ? 'p-2.5 bg-white hover:bg-[#FAF7F2] hover:border-[#9A7B56] border border-[#E6DDD1] rounded-lg text-left transition-colors cursor-pointer'
                  : 'p-2 bg-white hover:bg-blue-50 hover:border-blue-300 border border-slate-200 rounded-lg text-left transition-colors cursor-pointer'
              }
            >
              <div className={`font-semibold ${isLiq28 ? 'text-[#1F1B18]' : 'font-bold text-slate-800'}`}>
                Управляющий
              </div>
              <div className={`font-mono text-[10px] ${isLiq28 ? 'text-[#7D7267]' : 'text-slate-500'}`}>
                manager / manager123
              </div>
              <div className={`text-[10px] mt-0.5 ${isLiq28 ? 'text-[#7D6140]' : 'text-blue-700'}`}>
                Контроль качества & ПДн
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleQuickFill('viewer', 'viewer123')}
              className={
                isLiq28
                  ? 'p-2.5 bg-white hover:bg-[#FAF7F2] hover:border-[#9A7B56] border border-[#E6DDD1] rounded-lg text-left transition-colors cursor-pointer'
                  : 'p-2 bg-white hover:bg-slate-100 hover:border-slate-300 border border-slate-200 rounded-lg text-left transition-colors cursor-pointer'
              }
            >
              <div className={`font-semibold ${isLiq28 ? 'text-[#1F1B18]' : 'font-bold text-slate-800'}`}>
                Аудитор / Наблюдатель
              </div>
              <div className={`font-mono text-[10px] ${isLiq28 ? 'text-[#7D7267]' : 'text-slate-500'}`}>
                viewer / viewer123
              </div>
              <div className={`text-[10px] mt-0.5 ${isLiq28 ? 'text-[#7D7267]' : 'text-slate-600'}`}>
                Обезличенные отчёты
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
