/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Mic } from 'lucide-react';
import { DEFAULT_SALON_NAME, isLiq28Salon } from '../services/salonBranding.js';

interface RecordingNoticeProps {
  salonName?: string;
}

export const RecordingNotice: React.FC<RecordingNoticeProps> = ({ salonName }) => {
  const effectiveSalonName = salonName?.trim() || DEFAULT_SALON_NAME;
  const liq28 = isLiq28Salon(effectiveSalonName);

  return (
    <div
      className={
        liq28
          ? 'bg-white border border-[#E6DDD1] rounded-xl p-3.5 shadow-[0_2px_10px_-6px_rgba(31,27,24,0.08)] flex items-start gap-3 text-xs text-[#3C352E]'
          : 'bg-gradient-to-r from-emerald-50 via-teal-50 to-blue-50 border border-emerald-200/80 rounded-xl p-3.5 shadow-2xs flex items-start gap-3 text-xs text-slate-700'
      }
    >
      <div
        className={
          liq28
            ? 'p-1.5 bg-[#F5EFE6] text-[#846644] rounded-lg shrink-0 mt-0.5 border border-[#E6DDD1]'
            : 'p-1.5 bg-emerald-100/70 text-emerald-700 rounded-lg shrink-0 mt-0.5'
        }
      >
        <Mic className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className={liq28 ? 'font-semibold text-[#1F1B18]' : 'font-semibold text-emerald-950'}>
            Соответствие 152-ФЗ «О персональных данных»
          </span>
          <span
            className={
              liq28
                ? 'text-[#7D6140] font-medium text-[10px] border-l border-[#E6DDD1] pl-2'
                : 'px-2 py-0.2 bg-emerald-200/60 text-emerald-900 rounded-full font-medium text-[10px]'
            }
          >
            Автоинформатор АТС
          </span>
        </div>
        <p className={liq28 ? 'text-[#5C534A] leading-relaxed text-[11px]' : 'text-slate-600 leading-relaxed text-[11px]'}>
          При каждом входящем звонке воспроизводится предупреждение: <i>«В целях повышения качества обслуживания и работы салона красоты „{effectiveSalonName}“ все разговоры записываются»</i>. Продолжение диалога фиксирует голосовое согласие клиента в зашифрованном реестре.
        </p>
      </div>
    </div>
  );
};
