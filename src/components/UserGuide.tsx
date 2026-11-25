/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  BookOpen, ShieldCheck, Sparkles, PhoneCall, BarChart3,
  Download, Database, MessageCircle, SlidersHorizontal, CheckSquare,
  HelpCircle, ChevronRight, FileText, FileSpreadsheet, Lock, UserCheck,
  Activity, Check, Copy, AlertTriangle, ListTodo, Bell
} from 'lucide-react';
import { DEFAULT_SALON_NAME } from '../services/salonBranding.js';

interface UserGuideProps {
  salonName?: string;
}

export function UserGuide({ salonName = DEFAULT_SALON_NAME }: UserGuideProps) {
  const [activeSection, setActiveSection] = useState<string>('intro');
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const sections = [
    { id: 'intro', title: '1. Назначение и обзор системы', icon: BookOpen },
    { id: 'roles', title: '2. Роли и безопасность 152-ФЗ', icon: ShieldCheck },
    { id: 'list', title: '3. Журнал звонков и фильтры', icon: SlidersHorizontal },
    { id: 'analysis', title: '4. Анализ, классы A/B/C и Verifier', icon: Activity },
    { id: 'next-steps', title: '5. Следующие шаги (Next Steps ИИ)', icon: Sparkles },
    { id: 'export', title: '6. Экспорт отчётов (CSV & PDF)', icon: Download },
    { id: 'integrations', title: '7. МегаФон, STT, VK, YClients, S3', icon: Database },
    { id: 'architecture', title: '8. Техническая архитектура', icon: FileText },
  ];

  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(id);
    setTimeout(() => setCopiedSection(null), 2500);
  };

  return (
    <div className="flex flex-col lg:flex-row h-full min-h-[640px] bg-slate-50/50" id="user-guide-container">
      {/* Sidebar Navigation */}
      <div className="w-full lg:w-72 border-b lg:border-b-0 lg:border-r border-slate-200 bg-white p-4 space-y-2 shrink-0">
        <div className="pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-600 text-white">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 leading-tight">Справка &amp; Руководство</h2>
              <p className="text-[11px] text-slate-500">Салон «{salonName}»</p>
            </div>
          </div>
        </div>

        <nav className="space-y-1">
          {sections.map((sec) => {
            const Icon = sec.icon;
            const isActive = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                onClick={() => setActiveSection(sec.id)}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-all cursor-pointer ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-900 border border-indigo-200 shadow-3xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                  <span>{sec.title}</span>
                </div>
                {isActive && <ChevronRight className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
              </button>
            );
          })}
        </nav>

        <div className="mt-6 p-3 rounded-xl bg-purple-50/70 border border-purple-200 text-purple-900 text-[11px] space-y-1.5">
          <div className="font-bold flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-purple-600" />
            <span>AI CallQA v3.0</span>
          </div>
          <p className="leading-snug text-purple-800">
            GigaChat:Ultra + Repair + Verifier • GigaASR / Yandex SpeechKit / T-Bank VoiceKit • 152-ФЗ РФ.
          </p>
        </div>
      </div>

      {/* Main Content Pane */}
      <div className="flex-1 p-6 overflow-y-auto max-h-[820px] bg-white space-y-6">

        {/* Section 1: Intro */}
        {activeSection === 'intro' && (
          <div className="space-y-4 animate-in fade-in">
            <div className="border-b border-slate-200 pb-3">
              <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-indigo-600" />
                1. Назначение и обзор системы
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Автоматизированный комплекс речевой аналитики, фактчекинга и аудита звонков салонов красоты «Fashion Look Studio» и «LIQ28» (активный салон: «{salonName}»).
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-1">
                <span className="text-[10px] font-bold uppercase text-slate-400">1. Запись и распознавание (STT)</span>
                <p className="text-xs font-semibold text-slate-800">МегаФон ВАТС + GigaASR / SpeechKit / VoiceKit</p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Приём входящих и исходящих записей, выбор STT-провайдера (GigaAM v3 / Yandex SpeechKit / T-Bank VoiceKit), смысловое восстановление ролей и ретраи при сетевых сбоях.
                </p>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-1">
                <span className="text-[10px] font-bold uppercase text-slate-400">2. Интеллектуальный аудит</span>
                <p className="text-xs font-semibold text-slate-800">GigaChat:Ultra + Repair + Verifier</p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  8 обязательных параметров резюме, 10 критериев аудита с цитатами, классы звонков A/B/C, программный авто-ремонт (Repair) и двухпроходный фактчекер (Verifier).
                </p>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-1">
                <span className="text-[10px] font-bold uppercase text-slate-400">3. Действия, VK и отчёты</span>
                <p className="text-xs font-semibold text-slate-800">Next Steps + VK + CSV / PDF (152-ФЗ)</p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Задачи Next Steps, уведомления в VK с обязательным кратким пересказом диалога, ежедневная сводка KPI после 21:00 и экспорт обезличенных отчётов из StatsGrid.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-2 text-xs text-blue-950">
              <h4 className="font-bold flex items-center gap-1.5 text-blue-900">
                <Check className="w-4 h-4 text-blue-600" />
                Ключевые преимущества обновлённой версии 3.0:
              </h4>
              <ul className="list-disc list-inside space-y-1 text-slate-700 leading-relaxed pl-1">
                <li>100% охват входящих и исходящих звонков (включая подтверждения записи и обзвоны) без ложных штрафов на коротких/справочных вызовах;</li>
                <li>Двухпроходная проверка фактов и цитат (Verifier) исключает галлюцинации и некорректную привязку реплик;</li>
                <li>Ежедневная автоматическая сводка основных KPI в VK после 21:00 и обязательный краткий пересказ диалога в каждом уведомлении VK;</li>
                <li>Строгое соответствие закону № 152-ФЗ РФ: маскирование номеров, шифрование AES-256-GCM, пакетная синхронизация и архивация в S3.</li>
              </ul>
            </div>
          </div>
        )}

        {/* Section 2: Roles */}
        {activeSection === 'roles' && (
          <div className="space-y-4 animate-in fade-in">
            <div className="border-b border-slate-200 pb-3">
              <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-indigo-600" />
                2. Ролевая модель и соблюдение 152-ФЗ
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Четырёхуровневая система разграничения доступа (RBAC) и строгие алгоритмы деперсонализации данных.
              </p>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-3">Роль</th>
                    <th className="p-3">Телефоны клиентов</th>
                    <th className="p-3">Стенограмма диалога</th>
                    <th className="p-3">Next Steps, VK и экспорт</th>
                    <th className="p-3">Системные настройки</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="p-3 font-bold text-purple-700">Администратор (Admin)</td>
                    <td className="p-3 text-emerald-700 font-medium">Полный номер (с правами)</td>
                    <td className="p-3 text-emerald-700 font-medium">Полный доступ</td>
                    <td className="p-3 text-emerald-700 font-medium">Полный доступ (StatsGrid/реестр PDF/CSV, VK)</td>
                    <td className="p-3 text-emerald-700 font-medium">Полный доступ (АТС, STT, GigaChat, VK, YClients, S3)</td>
                  </tr>
                  <tr className="bg-slate-50/50">
                    <td className="p-3 font-bold text-indigo-700">Управляющий (Manager)</td>
                    <td className="p-3 text-amber-700 font-medium">Маскирован (+7***4589)</td>
                    <td className="p-3 text-emerald-700 font-medium">Дословный транскрипт</td>
                    <td className="p-3 text-emerald-700 font-medium">Next Steps, экспорт PDF/CSV, выгрузка сводки VK</td>
                    <td className="p-3 text-slate-400">Только чтение маскированных параметров</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-bold text-blue-700">Оператор (Operator)</td>
                    <td className="p-3 text-amber-700 font-medium">Маскирован (+7***4589)</td>
                    <td className="p-3 text-emerald-700 font-medium">Обезличенный диалог</td>
                    <td className="p-3 text-emerald-700 font-medium">Выполнение чек-листа Next Steps</td>
                    <td className="p-3 text-slate-400">Закрыто</td>
                  </tr>
                  <tr className="bg-slate-50/50">
                    <td className="p-3 font-bold text-slate-600">Наблюдатель (Viewer)</td>
                    <td className="p-3 text-amber-700 font-medium">Маскирован (+7***4589)</td>
                    <td className="p-3 text-slate-400 font-medium">Только резюме (152-ФЗ)</td>
                    <td className="p-3 text-slate-400">Только просмотр</td>
                    <td className="p-3 text-slate-400">Закрыто</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-xs">
              <h4 className="font-bold text-slate-800">Нормы Федерального закона № 152-ФЗ РФ:</h4>
              <ul className="list-disc list-inside space-y-1 text-slate-600 pl-1 leading-relaxed">
                <li><strong>Автоматическое автоинформирование:</strong> при соединении озвучивается уведомление о записи для контроля качества;</li>
                <li><strong>Журнал согласий:</strong> фиксация даты, маскированного номера и идентификатора согласия на обработку аудиозаписи;</li>
                <li><strong>Сквозное обезличивание:</strong> перед отправкой в нейросеть, в экспорт CSV/PDF (StatsGrid и реестры) и в сообщения VK (как по отдельным звонкам, так и в ежедневную сводку) телефоны и персональные данные принудительно маскируются;</li>
                <li><strong>Шифрование и архивация в S3:</strong> хранилище шифруется (AES-256-GCM), синхронизируется пакетно в S3 Timeweb Cloud, а звонки старше TTL_LOG_DAYS автоматически архивируются.</li>
              </ul>
            </div>
          </div>
        )}

        {/* Section 3: CallList & Filters */}
        {activeSection === 'list' && (
          <div className="space-y-4 animate-in fade-in">
            <div className="border-b border-slate-200 pb-3">
              <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <SlidersHorizontal className="w-5 h-5 text-indigo-600" />
                3. Журнал звонков, фильтры и массовый анализ
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Мгновенный поиск, сортировка обращений и отказоустойчивый массовый переанализ.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1.5 shadow-3xs">
                <div className="font-bold text-indigo-900 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-indigo-600" /> Фильтр по дате и периоду
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Пресеты «Сегодня», «Вчера», «7 дней», «30 дней», «Этот месяц», а также выбор точного диапазона дат в часовом поясе салона (Europe/Samara, UTC+4).
                </p>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1.5 shadow-3xs">
                <div className="font-bold text-indigo-900 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-indigo-600" /> Фильтр по оператору (администратору)
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Позволяет выбрать конкретного сотрудника салона с отображением количества обработанных им звонков для индивидуальной оценки работы.
                </p>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1.5 shadow-3xs">
                <div className="font-bold text-indigo-900 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-indigo-600" /> Оценка ИИ (Шкала 1–10)
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Сортировка: «Отличные (8-10)», «Средние (5-7)», «Низкие (1-4)». Короткие/пустые вызовы (Класс A) имеют оценку «—» и не искажают средний балл.
                </p>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1.5 shadow-3xs">
                <div className="font-bold text-indigo-900 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-indigo-600" /> Тональность диалога
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Фильтрация по эмоциональному настрою: Позитивная, Нейтральная, Негативная / Спорная (жалобы, возражения).
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/50 text-xs space-y-1 text-amber-950">
              <span className="font-bold block">Быстрые пресеты (Chips):</span>
              <p className="leading-relaxed text-amber-900">
                В верхней части панели доступны быстрые кнопки-чипы: «Претензии/Споры», «Запись оформлена», «Отказы», «Низкий балл (&lt;5)», «Высокий балл (8+)», «Пропущенные» с точным счётчиком звонков.
              </p>
            </div>

            <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/40 text-xs space-y-1 text-emerald-950">
              <span className="font-bold block">Устойчивость массового переанализа к рестартам:</span>
              <p className="leading-relaxed text-emerald-900">
                Очередь массового анализа сохраняется в хранилище (какие звонки обработаны, а какие ожидают). После перезапуска сервера прогон автоматически продолжается с места остановки, а причина каждого рестарта фиксируется в системном логе.
              </p>
            </div>
          </div>
        )}

        {/* Section 4: Analysis & Score */}
        {activeSection === 'analysis' && (
          <div className="space-y-4 animate-in fade-in">
            <div className="border-b border-slate-200 pb-3">
              <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Activity className="w-5 h-5 text-indigo-600" />
                4. Анализ диалога, классы A/B/C, Repair и Verifier
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                8 обязательных параметров резюме, 10 критериев аудита с цитатами и двухпроходная верификация фактов.
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                <span className="font-bold text-slate-800 text-[11px] uppercase tracking-wider block">
                  1. 8 обязательных параметров резюме звонка:
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { label: '1. Цель обращения', val: 'без подстановки приветствий' },
                    { label: '2. Услуга', val: 'стрижка, маникюр, окрашивание' },
                    { label: '3. Мастер', val: 'сверка со списком YClients' },
                    { label: '4. Стоимость', val: 'озвученная цена / «не озвучено»' },
                    { label: '5. Дата и время', val: 'предложенные или итоговые слоты' },
                    { label: '6. Статус записи', val: 'запись / подтверждение / перенос' },
                    { label: '7. Причина отказа', val: 'если запись не состоялась' },
                    { label: '8. Next Steps', val: 'дальнейшие шаги менеджера' },
                  ].map((item) => (
                    <div key={item.label} className="p-2 bg-white rounded-lg border border-slate-200">
                      <span className="text-[10px] text-slate-400 block font-semibold">{item.label}</span>
                      <span className="font-bold text-slate-800 text-[11px]">{item.val}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/30 space-y-2">
                <span className="font-bold text-indigo-950 text-[11px] uppercase tracking-wider block">
                  2. Классификация звонков (Классы A / B / C) и честный аудит по 10 критериям:
                </span>
                <ul className="space-y-1.5 text-slate-700 leading-relaxed">
                  <li><strong>Класс A (короткие/пустые вызовы, автоинформатор, «Алло — Алло», «Номер занят»):</strong> статус «Не применимо», оценка <code>null</code>, 0 критериев, без ошибок и без вердикта «требуется обучение». Содержательные короткие звонки с фактами записи («мы пока предварительно забронировали с 12 до 2») защищены и оцениваются как Класс C.</li>
                  <li><strong>Класс B (частичный контакт / обрыв связи, справочный запрос «Можно Елену? — Её сейчас нет»):</strong> Критерий 9 («Закрытие на запись») не штрафуется, вердикт «требуется обучение» запрещён, формируются практические шаги для перезвона.</li>
                  <li><strong>Исходящие подтверждения и обзвоны:</strong> при подтверждении существующей записи («да, я буду») Критерий 9 оценивается на 9–10 баллов (формулировки «бронь не оформлена» запрещены). При коротком обзвоне с отказом («не могу говорить») — статус «Консультация / отказ» без жёсткого штрафа и рекомендация повторного обзвона.</li>
                  <li><strong>ASR-искажения названия салона:</strong> фонетические искажения («лис 28», «от, а, 28», «лик 28») сопоставляются с брендом «LIQ28» — менеджер не штрафуется по Критерию 1.</li>
                </ul>
              </div>

              <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/30 space-y-2">
                <span className="font-bold text-emerald-950 text-[11px] uppercase tracking-wider block">
                  3. Программный авто-ремонт (Repair) и фактчекер (Verifier):
                </span>
                <ul className="list-disc list-inside space-y-1 text-slate-700 pl-1 leading-relaxed">
                  <li><strong>Контроль цитат и говорящего:</strong> проверяется, что цитата в резюме реально принадлежит нужному участнику, а фраза-приветствие не подставлена в «Цель обращения»;</li>
                  <li><strong>Контроль «интерес → отказ»:</strong> при отказе клиента неподтверждённые услуга/дата/время не выдаются за факт;</li>
                  <li><strong>Подтверждение составных фактов (синтез-полей):</strong> Verifier подтверждает корректные обобщения (например, перенос записи к другому мастеру без изменения цены и времени) без ложных флагов, а неподтверждённые утверждения помечает как «требует проверки».</li>
                </ul>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2">
                <span className="font-bold text-slate-800 text-[11px] uppercase tracking-wider block">
                  4. Ре-анализ и модель по умолчанию GigaChat:Ultra:
                </span>
                <p className="text-slate-600 leading-relaxed">
                  Модель анализа по умолчанию — <strong>GigaChat:Ultra</strong>. Кнопка «Переанализировать» в карточке звонка позволяет повторно запустить анализ с выбором модели (<code>Ultra</code>, <code>Max</code>, <code>Pro</code>, <code>Lite</code>) или перетранскрибацию выбранным STT-провайдером.
                </p>
              </div>

              {/* GigaChat Clarify Context Feature */}
              <div className="p-4 rounded-xl border border-rose-300 bg-gradient-to-br from-rose-50/70 to-amber-50/40 space-y-2.5">
                <span className="font-bold text-rose-950 text-[11px] uppercase tracking-wider flex items-center gap-1.5">
                  <span className="px-1.5 py-0.5 rounded bg-emerald-600 text-white font-black text-[10px]">AI</span>
                  <span>5. Кнопка «Уточнить контекст у ИИ» (GigaChat):</span>
                </span>
                <p className="text-slate-700 leading-relaxed">
                  Позволяет задать любой дополнительный вопрос по конкретному диалогу напрямую в <strong>GigaChat</strong> для получения уточнённой выжимки, сверки обещаний или проверки фактов.
                </p>
                <ul className="list-disc list-inside space-y-1 text-slate-600 pl-1 leading-relaxed">
                  <li><strong>Быстрые шаблоны:</strong> готовые подсказки для мгновенной проверки согласованных цен, скидок, реквизитов предоплаты, даты, времени и мастера;</li>
                  <li><strong>Точные цитаты:</strong> модель находит в стенограмме прямые цитаты («...») и аргументирует выводы реальными репликами собеседников;</li>
                  <li><strong>История запросов:</strong> все заданные вопросы и полученные ответы сохраняются в карточке звонка с возможностью копирования в буфер обмена.</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Section 5: Next Steps */}
        {activeSection === 'next-steps' && (
          <div className="space-y-4 animate-in fade-in">
            <div className="border-b border-slate-200 pb-3">
              <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-600" />
                5. Следующие шаги для администратора (Next Steps)
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                ИИ-генерация персонализированного чек-листа операционных задач по итогам каждого диалога.
              </p>
            </div>

            <div className="p-4 rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50/60 to-indigo-50/30 space-y-2 text-xs">
              <h3 className="font-bold text-purple-950 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-600" />
                Как работает генератор Next Steps:
              </h3>
              <p className="text-slate-700 leading-relaxed">
                Искусственный интеллект GigaChat анализирует содержание разговора, зафиксированные договорённости, обещания сотрудника («уточню у мастера», «отправлю прайс», «перезвоню через час»), статус записи и эмоциональный тон, после чего формирует конкретный список шагов для администратора салона.
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <h4 className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                Примеры формируемых задач:
              </h4>

              <div className="space-y-2">
                <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50/40 space-y-1">
                  <div className="font-bold text-emerald-900 flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-emerald-600" /> При успешной записи или переносе:
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 text-slate-700 pl-1 leading-relaxed">
                    <li>Проверить и подтвердить запись клиента в расписании мастера;</li>
                    <li>Отправить подтверждение бронирования и адрес студии в мессенджер;</li>
                    <li>Запланировать напоминание за 24 часа до визита (если визит не сегодня).</li>
                  </ul>
                </div>

                <div className="p-3 rounded-xl border border-rose-200 bg-rose-50/40 space-y-1">
                  <div className="font-bold text-rose-900 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-rose-600" /> При претензии, обрыве или отказе на обзвоне:
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 text-slate-700 pl-1 leading-relaxed">
                    <li>При споре: зафиксировать инцидент и передать управляющему салона «{salonName}»;</li>
                    <li>При обрыве связи или отказе «не могу говорить»: запланировать повторный обзвон;</li>
                    <li>При отсутствии мастера: перезвонить клиенту, когда мастер будет доступен.</li>
                  </ul>
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2">
                <h4 className="font-bold text-slate-800 text-[11px] uppercase tracking-wider">
                  Интерактивные возможности чек-листа:
                </h4>
                <ul className="list-disc list-inside space-y-1 text-slate-600 pl-1 leading-relaxed">
                  <li><strong>Отметка выполнения:</strong> клик по пункту помечает задачу выполненной с мгновенным сохранением в БД;</li>
                  <li><strong>Копирование в буфер:</strong> кнопка «Копировать» форматирует список задач для вставки в рабочий чат;</li>
                  <li><strong>Ручное добавление и пересчёт ИИ:</strong> добавление своих задач и кнопка «Обновить ИИ».</li>
                </ul>
              </div>

              <div className="p-4 rounded-xl border border-purple-300 bg-purple-50/50 space-y-3">
                <h4 className="font-bold text-purple-950 text-xs flex items-center gap-2">
                  <ListTodo className="w-4 h-4 text-purple-600" />
                  Вкладка «Задачи Next Steps» и всплывающие напоминания
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-slate-700">
                  <div className="bg-white p-3 rounded-xl border border-purple-200/80 space-y-1.5">
                    <div className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                      <ListTodo className="w-3.5 h-3.5 text-purple-600" /> Единая вкладка контроля шагов:
                    </div>
                    <p className="text-[11px] leading-relaxed text-slate-600">
                      В верхнем меню доступна отдельная вкладка с бейджем незавершённых звонков, поиском, фильтрацией по операторам, прогресс-баром и кнопкой «Отметить все».
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-purple-200/80 space-y-1.5">
                    <div className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                      <Bell className="w-3.5 h-3.5 text-amber-600" /> Всплывающие напоминания:
                    </div>
                    <p className="text-[11px] leading-relaxed text-slate-600">
                      В правом нижнем углу экрана автоматически появляется интерактивное уведомление с кнопками «Открыть задачи», «+15 мин» (отложить) и «Свернуть».
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Section 6: Export */}
        {activeSection === 'export' && (
          <div className="space-y-4 animate-in fade-in">
            <div className="border-b border-slate-200 pb-3">
              <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Download className="w-5 h-5 text-indigo-600" />
                6. Экспорт отчётов (StatsGrid, CSV &amp; PDF по 152-ФЗ)
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Выгрузка обезличенной аналитики за период, сводных реестров и персональных аудитов звонков.
              </p>
            </div>

            <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50/40 space-y-1.5 text-xs">
              <div className="font-bold text-indigo-950 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-indigo-600" />
                <span>Кнопка «Экспорт отчета» в блоке сводной аналитики (StatsGrid)</span>
              </div>
              <p className="text-slate-700 leading-relaxed">
                В верхней панели статистики администраторам и управляющим доступна кнопка <strong>«Экспорт отчета»</strong> для мгновенного скачивания обезличенных данных аналитики звонков в формате <strong>CSV</strong> или <strong>PDF</strong> (в полном соответствии со 152-ФЗ — без открытых телефонов и ФИО клиентов) для подготовки внутренней отчётности.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/30 space-y-2">
                <div className="flex items-center gap-2 text-emerald-900 font-bold">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                  <span>Таблица в CSV (Microsoft Excel)</span>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Кодировка UTF-8 BOM, разделитель «;» и защита от CSV-инъекций — корректное открытие в русскоязычном Excel без сбоев кодировки.
                </p>
                <div className="bg-white p-2.5 rounded-lg border border-emerald-200 text-[11px] text-slate-700 space-y-1">
                  <span className="font-semibold block text-emerald-800">Содержит:</span>
                  <span>• Сводный блок ключевых метрик KPI управляющего;</span><br />
                  <span>• Обезличенный реестр звонков с датой (UTC+4), статусом записи, мастером, оценкой и резюме диалога.</span>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-rose-200 bg-rose-50/30 space-y-2">
                <div className="flex items-center gap-2 text-rose-900 font-bold">
                  <FileText className="w-5 h-5 text-rose-600" />
                  <span>Официальный отчёт в PDF (А4 Альбомный)</span>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Презентационный документ для руководства салона «{salonName}» со встроенными кириллическими шрифтами LiberationSans.
                </p>
                <div className="bg-white p-2.5 rounded-lg border border-rose-200 text-[11px] text-slate-700 space-y-1">
                  <span className="font-semibold block text-rose-800">Содержит:</span>
                  <span>• Сводные KPI-карточки (конверсия %, отказы %, споры %, средний балл);</span><br />
                  <span>• Обезличенную таблицу вызовов с цветовой кодировкой статусов и оценок;</span><br />
                  <span>• Блок согласования и подписи управляющего салоном.</span>
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-1 text-xs text-slate-700">
              <span className="font-bold text-slate-900">Дополнительные точки экспорта:</span>
              <p className="leading-relaxed">
                Помимо кнопки <strong>«Экспорт отчета»</strong> в панели статистики, экспорт доступен в шапке «Журнала звонков» (по текущей выборке фильтров или всей базе) и внутри карточки каждого отдельного звонка («PDF» и «CSV 152-ФЗ»).
              </p>
            </div>
          </div>
        )}

        {/* Section 7: Integrations */}
        {activeSection === 'integrations' && (
          <div className="space-y-4 animate-in fade-in">
            <div className="border-b border-slate-200 pb-3">
              <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Database className="w-5 h-5 text-indigo-600" />
                7. Внешние интеграции (МегаФон, STT, VK, YClients, S3)
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Обмен данными с телефонией, сервисами распознавания речи, VK, YClients и облачным хранилищем S3.
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1.5 shadow-3xs">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> МегаФон Виртуальная АТС
                </span>
                <p className="text-slate-600 leading-relaxed">
                  Поддержка протоколов JSON-RPC и REST WCGP. Приём вебхуков о завершении вызовов, периодический опрос истории, скачивание аудиозаписей и автоматический запуск анализа.
                </p>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1.5 shadow-3xs">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" /> Распознавание речи (GigaASR / SpeechKit / T-Bank VoiceKit)
                </span>
                <p className="text-slate-600 leading-relaxed">
                  Поддерживаются три провайдера STT: <strong>GigaASR / GigaAM v3 (Cloud.ru)</strong>, <strong>Yandex Cloud SpeechKit</strong> и <strong>T-Bank VoiceKit</strong>. Работают очередь ASR, автоматические ретраи при сетевых сбоях и изолированный выбор провайдера при ручной перетранскрибации.
                </p>
              </div>

              <div className="p-3.5 rounded-xl border border-sky-200 bg-sky-50/30 space-y-1.5 shadow-3xs">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-sky-500" /> ВКонтакте: карточки звонков и ежедневная сводка после 21:00
                </span>
                <ul className="list-disc list-inside space-y-1 text-slate-600 pl-1 leading-relaxed">
                  <li><strong>Обязательный краткий пересказ диалога:</strong> каждое уведомление по звонку в VK обязательно содержит отдельный блок <code>📝 Краткий пересказ диалога</code> (переменная <code>{'{short_summary}'}</code> — добавляется автоматически даже в пользовательский шаблон) с маскированием телефонов по 152-ФЗ;</li>
                  <li><strong>Ежедневная сводка KPI после 21:00:</strong> автоматическая выгрузка итогов дня (количество звонков, пропущенные, конверсия, записи по видам услуг и мастерам, средние оценки администраторов). В «Интеграциях» и «Администрировании» доступны настройка времени (от 21:00) и кнопка ручной выгрузки <strong>«Выгрузить итоги дня в VK»</strong>.</li>
                </ul>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1.5 shadow-3xs">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> YClients CRM (строго «только чтение» мастеров)
                </span>
                <p className="text-slate-600 leading-relaxed">
                  Доступ ограничен режимом «только чтение»: аутентификация по логину и паролю (+ <code className="font-mono">YCLIENTS_PARTNER_TOKEN</code>) используется исключительно для получения актуального списка мастеров салона. Запись и изменение данных в YClients отключены.
                </p>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1.5 shadow-3xs">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-500" /> S3 Timeweb Cloud (пакетная синхронизация и архивация)
                </span>
                <p className="text-slate-600 leading-relaxed">
                  Зашифрованное хранилище (AES-256-GCM) синхронизируется в S3 <strong>пакетно с дебаунсом</strong> (каждые 30–60 сек или по достижении N изменений), с 3 автоматическими попытками ретрая (5–15–30 сек), подробным логированием ошибок SDK и гарантированным сохранением по завершении очереди и перед рестартом сервера.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Section 8: Technical Architecture */}
        {activeSection === 'architecture' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-600" />
                <h3 className="text-base font-bold text-slate-900">8. Техническая архитектура и стек разработки</h3>
              </div>
              <button
                onClick={() => handleCopyText('Полная техническая спецификация сохранена в файле TECHNICAL_DOCUMENTATION.md в корне проекта.', 'architecture')}
                className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 flex items-center gap-1 cursor-pointer transition-colors"
              >
                {copiedSection === 'architecture' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedSection === 'architecture' ? 'Скопировано!' : 'Копировать'}</span>
              </button>
            </div>

            <div className="p-4 rounded-xl border border-indigo-100 bg-indigo-50/40 text-xs text-indigo-900 space-y-2">
              <p className="font-semibold text-indigo-950">
                Полный технический паспорт системы сохранён в файле <code className="bg-white px-1.5 py-0.5 rounded border border-indigo-200 font-mono">TECHNICAL_DOCUMENTATION.md</code>, а реестр переменных — в <code className="bg-white px-1.5 py-0.5 rounded border border-indigo-200 font-mono">ENV_VARIABLES.md</code>.
              </p>
              <p className="text-slate-600 leading-relaxed">
                Ниже приведена актуальная сводка по технологическому стеку, интеграциям и многоступенчатому конвейеру анализа звонков версии 3.0.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2 shadow-3xs">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Database className="w-4 h-4 text-indigo-600" /> Стек разработки
                </span>
                <ul className="text-slate-600 space-y-1 list-disc pl-4 leading-relaxed">
                  <li><strong>Frontend:</strong> React 19, TypeScript, Tailwind CSS, Lucide React, Recharts, Vite.</li>
                  <li><strong>Backend:</strong> Node.js 22, Express, TypeScript, esbuild (bundle <code>dist/server.cjs</code>), node-cron.</li>
                  <li><strong>Распознавание речи (STT):</strong> GigaASR / GigaAM v3 (Cloud.ru), Yandex SpeechKit, T-Bank VoiceKit (с очередью и ретраями).</li>
                  <li><strong>Нейросеть (LLM):</strong> Сбер GigaChat (<code>Ultra</code> по умолчанию, <code>Max</code>/<code>Pro</code>/<code>Lite</code>) через сертификаты Минцифры РФ.</li>
                  <li><strong>Безопасность:</strong> AES-256-GCM шифрование БД, маскирование 152-ФЗ, журнал согласий и аудита.</li>
                  <li><strong>Резервирование и надёжность:</strong> пакетный S3-синк с бэкоффом, персистентная очередь массового анализа, логирование причин рестартов.</li>
                </ul>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2 shadow-3xs">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <PhoneCall className="w-4 h-4 text-emerald-600" /> Две версии интеграции с АТС МегаФон
                </span>
                <div className="text-slate-600 space-y-2 leading-relaxed">
                  <p>
                    <strong>Версия 1 (Push / Webhooks):</strong> АТС отправляет HTTP POST вебхуки на <code>/crm_integration.php</code> или <code>/api/calls/webhook</code> сразу после звонка (<code>cmd=history</code> с прямой ссылкой на MP3 и <code>cmd=event</code>).
                  </p>
                  <p>
                    <strong>Версия 2 (Pull / WCGP REST):</strong> Сервер самостоятельно опрашивает шлюз <code>/sys/crm_api.wcgp</code> по расписанию (раз в 5–15 мин), разбирает CSV-реестр звонков и получает прямые ссылки на записи.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2 shadow-3xs text-xs">
              <span className="font-bold text-slate-900 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-purple-600" /> Конвейер обработки звонка (v3.0)
              </span>
              <ol className="text-slate-600 space-y-1.5 list-decimal pl-4 leading-relaxed">
                <li><strong>Приём и скачивание MP3:</strong> дедупликация по ID, загрузка аудиозаписи с медиасервера МегаФон.</li>
                <li><strong>STT и восстановление ролей:</strong> распознавание через GigaASR / SpeechKit / VoiceKit, склейка подряд идущих реплик и смысловое разделение «Менеджер» / «Клиент».</li>
                <li><strong>Детекторы классов A/B/C и 152-ФЗ:</strong> отсечение пустых звонков и автоинформаторов без оценки (с защитой коротких содержательных диалогов), обезличивание перед LLM.</li>
                <li><strong>Анализ GigaChat:Ultra:</strong> 8 параметров резюме, краткий пересказ, 10 критериев аудита с цитатами, ошибки, рекомендации (приоритет «модель → fallback» с логированием причины) и Next Steps.</li>
                <li><strong>Программный авто-ремонт (Repair):</strong> исправление Критерия 1 при ASR-искажениях салона, Критерия 8 без отказа, Критерия 9 при подтверждении существующей записи, контроль цитат и ролей.</li>
                <li><strong>Двухпроходный фактчекер (Verifier):</strong> сверка фактов и цитат со стенограммой (включая подтверждение составных фактов переноса записи), маркировка неподтверждённых полей.</li>
                <li><strong>Сохранение, VK и S3:</strong> запись в зашифрованную БД, отправка в VK с обязательным кратким пересказом диалога, ежедневная сводка KPI после 21:00 и пакетный флаш в S3.</li>
              </ol>
            </div>

            {/* Настройка системного промпта ИИ */}
            <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2 shadow-3xs text-xs">
              <span className="font-bold text-slate-900 flex items-center gap-1.5">
                <SlidersHorizontal className="w-4 h-4 text-emerald-600" /> Настройка системного промпта ИИ в панели администратора
              </span>
              <p className="text-slate-600 leading-relaxed">
                В панели администратора доступен редактор <strong>Системного промпта GigaChat</strong> с поддержкой эталонных примеров (ПРИМЕР 1–17), актуального списка мастеров из YClients (Read-Only) и сброса к заводскому эталону:
              </p>
              <ul className="text-slate-600 space-y-1 list-disc pl-4 leading-relaxed">
                <li><strong>Оба салона и ASR-искажения:</strong> корректная обработка «Fashion Look Studio» и «LIQ28» (включая фонетические искажения «лис 28», «от, а, 28»);</li>
                <li><strong>Строгое написание ФИО и фильтр мусорных слов:</strong> автоматическая нормализация имён мастеров и исключение разговорных слов-паразитов;</li>
                <li><strong>Контроль цитат и классов звонков:</strong> запрет подстановки приветствий в «Цель обращения», корректная работа с исходящими подтверждениями, обзвонами и справочными запросами.</li>
              </ul>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
