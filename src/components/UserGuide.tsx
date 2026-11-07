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

interface UserGuideProps {
  salonName?: string;
}

export function UserGuide({ salonName = 'Fashion Look Studio' }: UserGuideProps) {
  const [activeSection, setActiveSection] = useState<string>('intro');
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const sections = [
    { id: 'intro', title: '1. Назначение и обзор системы', icon: BookOpen },
    { id: 'roles', title: '2. Роли и безопасность 152-ФЗ', icon: ShieldCheck },
    { id: 'list', title: '3. Журнал звонков и фильтры', icon: SlidersHorizontal },
    { id: 'analysis', title: '4. Анализ диалога и оценка ИИ', icon: Activity },
    { id: 'next-steps', title: '5. Следующие шаги (Next Steps ИИ)', icon: Sparkles },
    { id: 'export', title: '6. Экспорт отчетов (CSV & PDF)', icon: Download },
    { id: 'integrations', title: '7. МегаФон, Yclients, VK, S3', icon: Database },
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
              <h2 className="text-sm font-bold text-slate-900 leading-tight">Справка & Руководство</h2>
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
            <span>AI CallQA v2.8</span>
          </div>
          <p className="leading-snug text-purple-800">
            Речевая аналитика Сбер GigaChat + Yandex SpeechKit с полным соответствием 152-ФЗ РФ.
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
                Автоматизированный программный комплекс речевой аналитики и контроля качества телефонных диалогов салона красоты «{salonName}».
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-1">
                <span className="text-[10px] font-bold uppercase text-slate-400">1. Запись и распознавание</span>
                <p className="text-xs font-semibold text-slate-800">МегаФон ВАТС + Yandex SpeechKit</p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Автоматический прием аудиозаписей звонков, шумоподавление, транскрибация речи и разделение ролей (Менеджер / Клиент).
                </p>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-1">
                <span className="text-[10px] font-bold uppercase text-slate-400">2. Интеллектуальный анализ</span>
                <p className="text-xs font-semibold text-slate-800">Сбер GigaChat (Lite / Pro / Max)</p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Определение статуса записи (согласие/отказ), фиксация сути (услуга, мастер, дата, время), пересказ и 10-балльная оценка работы администратора.
                </p>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-1">
                <span className="text-[10px] font-bold uppercase text-slate-400">3. Действия и экспорт</span>
                <p className="text-xs font-semibold text-slate-800">Next Steps + Отчеты PDF / CSV</p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Формирование пошаговых задач для дежурного администратора, отправка в Yclients CRM, закрытый чат VK и экспорт реестров для управляющего.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-2 text-xs text-blue-950">
              <h4 className="font-bold flex items-center gap-1.5 text-blue-900">
                <Check className="w-4 h-4 text-blue-600" />
                Ключевые преимущества для руководства салона:
              </h4>
              <ul className="list-disc list-inside space-y-1 text-slate-700 leading-relaxed pl-1">
                <li>100% охват входящих и исходящих звонков без необходимости выборочного ручного прослушивания;</li>
                <li>Мгновенный контроль конверсии первичных и повторных обращений клиентов в запись;</li>
                <li>Автоматическое выявление претензий, конфликтов и грубых нарушений скрипта обслуживания;</li>
                <li>Полное юридическое соответствие закону «О персональных данных» № 152-ФЗ РФ.</li>
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
                Четырехуровневая система разграничения доступа (RBAC) и строгие алгоритмы деперсонализации данных.
              </p>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-3">Роль</th>
                    <th className="p-3">Телефоны клиентов</th>
                    <th className="p-3">Стенограмма диалога</th>
                    <th className="p-3">Next Steps и экспорт</th>
                    <th className="p-3">Системные настройки</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="p-3 font-bold text-purple-700">Администратор (Admin)</td>
                    <td className="p-3 text-emerald-700 font-medium">Полный номер (с правами)</td>
                    <td className="p-3 text-emerald-700 font-medium">Полный доступ</td>
                    <td className="p-3 text-emerald-700 font-medium">Полный доступ (PDF/CSV)</td>
                    <td className="p-3 text-emerald-700 font-medium">Полный доступ (токены, пароли)</td>
                  </tr>
                  <tr className="bg-slate-50/50">
                    <td className="p-3 font-bold text-indigo-700">Управляющий (Manager)</td>
                    <td className="p-3 text-amber-700 font-medium">Маскирован (+7***4589)</td>
                    <td className="p-3 text-emerald-700 font-medium">Дословный транскрипт</td>
                    <td className="p-3 text-emerald-700 font-medium">Генерация шагов, экспорт PDF/CSV</td>
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
                <li><strong>Журнал согласий:</strong> фиксация даты, маскированного номера и хэша согласия на обработку биометрии/речи;</li>
                <li><strong>Обезличивание:</strong> перед отправкой в нейросеть Сбер GigaChat из текста вырезаются телефоны, фамилии и платежные данные.</li>
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
                3. Журнал звонков и умная панель фильтрации
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Мгновенный поиск и сортировка обращений по ключевым управленческим критериям.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1.5 shadow-3xs">
                <div className="font-bold text-indigo-900 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-indigo-600" /> Фильтр по дате и периоду
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Пресеты «Сегодня», «Вчера», «7 дней», «30 дней», «Этот месяц», а также выбор точного диапазона дат в местном часовом поясе (Europe/Samara, UTC+4).
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
                  Сортировка: «Отличные (8-10)» для премирования, «Средние (5-7)» для анализа точек роста, «Низкие (1-4)» для разбора ошибок.
                </p>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1.5 shadow-3xs">
                <div className="font-bold text-indigo-900 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-indigo-600" /> Тональность диалога
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Фильтрация по эмоциональному настрою: Позитивная (клиент доволен), Нейтральная (деловой контакт), Негативная / Спорная (жалобы, возражения).
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/50 text-xs space-y-1 text-amber-950">
              <span className="font-bold block">Быстрые пресеты (Chips):</span>
              <p className="leading-relaxed text-amber-900">
                В верхней части панели доступны быстрые кнопки-чипы: «Претензии/Споры», «Запись оформлена», «Отказы», «Низкий балл (&lt;5)», «Высокий балл (8+)», «Пропущенные». Чипы отображают точный счетчик звонков в реальном времени.
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
                4. Анализ диалога, резюме и оценка качества
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Структурированный паспорт вызова, извлечение параметров записи и аналитические выводы.
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                <span className="font-bold text-slate-800 text-[11px] uppercase tracking-wider block">
                  1. Карточка сути обращения (Параметры записи):
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div className="p-2 bg-white rounded-lg border border-slate-200">
                    <span className="text-[10px] text-slate-400 block font-semibold">Услуга</span>
                    <span className="font-bold text-slate-800">стрижка, окрашивание</span>
                  </div>
                  <div className="p-2 bg-white rounded-lg border border-slate-200">
                    <span className="text-[10px] text-slate-400 block font-semibold">Дата</span>
                    <span className="font-bold text-slate-800">завтра / 15 ноября</span>
                  </div>
                  <div className="p-2 bg-white rounded-lg border border-slate-200">
                    <span className="text-[10px] text-slate-400 block font-semibold">Время</span>
                    <span className="font-bold text-slate-800">14:00</span>
                  </div>
                  <div className="p-2 bg-white rounded-lg border border-slate-200">
                    <span className="text-[10px] text-slate-400 block font-semibold">Мастер</span>
                    <span className="font-bold text-slate-800">Елена</span>
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/30 space-y-2">
                <span className="font-bold text-indigo-950 text-[11px] uppercase tracking-wider block">
                  2. Трёхчастное резюме звонка (Регламент):
                </span>
                <ul className="space-y-1.5 text-slate-700 leading-relaxed">
                  <li><strong>Суть обращения:</strong> кратко фиксирует услугу, дату, время и мастера;</li>
                  <li><strong>Краткий пересказ разговора (2–4 предложения):</strong> с чем обратился клиент, какие варианты предложил администратор, что было согласовано;</li>
                  <li><strong>Вывод и итог:</strong> финальный результат звонка (запись подтверждена, отказ по причине отъезда, справочная консультация).</li>
                </ul>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2">
                <span className="font-bold text-slate-800 text-[11px] uppercase tracking-wider block">
                  3. Ре-анализ и смена модели:
                </span>
                <p className="text-slate-600 leading-relaxed">
                  Кнопка «Переанализировать» в тулбаре позволяет повторно запустить транскрибацию и анализ звонка с выбором более мощной модели нейросети (GigaChat:Pro или GigaChat:Max) при возникновении спорных ситуаций.
                </p>
              </div>

              {/* GigaChat Clarify Context Feature */}
              <div className="p-4 rounded-xl border border-rose-300 bg-gradient-to-br from-rose-50/70 to-amber-50/40 space-y-2.5">
                <span className="font-bold text-rose-950 text-[11px] uppercase tracking-wider flex items-center gap-1.5">
                  <span className="px-1.5 py-0.5 rounded bg-emerald-600 text-white font-black text-[10px]">AI</span>
                  <span>4. Кнопка «Уточнить контекст у ИИ» (GigaChat):</span>
                </span>
                <p className="text-slate-700 leading-relaxed">
                  Позволяет задать любой дополнительный вопрос по конкретному диалогу напрямую в <strong>GigaChat</strong> для получения уточненной выжимки, сверки обещаний или проверки фактов.
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
                Искусственный интеллект GigaChat детально анализирует содержание разговора, зафиксированные договоренности, обещания сотрудника («я уточню у мастера», «отправлю прайс», «перезвоню через час»), статус записи и эмоциональный тон, после чего формирует от 3 до 5 прикладных шагов для администратора салона.
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <h4 className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                Примеры формируемых задач:
              </h4>

              <div className="space-y-2">
                <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50/40 space-y-1">
                  <div className="font-bold text-emerald-900 flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-emerald-600" /> При успешной записи (Согласие):
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 text-slate-700 pl-1 leading-relaxed">
                    <li>Внести подтвержденную запись клиента Ольги в CRM Yclients (стрижка, 15 ноября в 14:00 к Елене);</li>
                    <li>Отправить клиенту подтверждение бронирования и адрес студии в WhatsApp/SMS;</li>
                    <li>Проверить график мастера Елены и забронировать расходные материалы;</li>
                    <li>Установить автоматическое напоминание за 24 часа до визита для подтверждения явки.</li>
                  </ul>
                </div>

                <div className="p-3 rounded-xl border border-rose-200 bg-rose-50/40 space-y-1">
                  <div className="font-bold text-rose-900 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-rose-600" /> При претензии или споре:
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 text-slate-700 pl-1 leading-relaxed">
                    <li>Зафиксировать инцидент в журнале претензий и передать управляющему салона «{salonName}»;</li>
                    <li>Поднять историю предыдущих визитов клиента и подготовить фактуру по замечаниям;</li>
                    <li>Согласовать вариант сервисной компенсации или скидки для сохранения лояльности;</li>
                    <li>Связаться с клиентом в течение 2 часов для обратной связи.</li>
                  </ul>
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2">
                <h4 className="font-bold text-slate-800 text-[11px] uppercase tracking-wider">
                  Интерактивные возможности чек-листа:
                </h4>
                <ul className="list-disc list-inside space-y-1 text-slate-600 pl-1 leading-relaxed">
                  <li><strong>Отметка выполнения:</strong> администратор нажимает на пункт, и задача помечается выполненной со зачеркиванием текста и мгновенным сохранением в БД;</li>
                  <li><strong>Копирование в буфер:</strong> кнопка «Копировать» форматирует весь список задач для вставки в рабочий чат администраторов;</li>
                  <li><strong>Ручное добавление:</strong> ссылка «Добавить задачу» позволяет дописать любую нестандартную задачу;</li>
                  <li><strong>Пересчет ИИ:</strong> кнопка «Обновить ИИ» формирует свежий актуализированный перечень задач.</li>
                </ul>
              </div>

              {/* Dedicated Tab & Floating Reminders Documentation */}
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
                      В верхнем меню приложения доступна отдельная вкладка с бейджем незавершенных звонков. На ней сгруппированы карточки всех диалогов, где остались открытые шаги, со строкой поиска, фильтрацией по операторам, прогресс-баром и кнопкой «Отметить все».
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-purple-200/80 space-y-1.5">
                    <div className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                      <Bell className="w-3.5 h-3.5 text-amber-600" /> Всплывающие напоминания в углу:
                    </div>
                    <p className="text-[11px] leading-relaxed text-slate-600">
                      В правом нижнем углу экрана автоматически появляется интерактивное уведомление с количеством зависших задач, превью ближайшего действия и кнопками: «Открыть задачи», «+15 мин» (отложить) или «Свернуть» в компактный плавающий бейдж.
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
                6. Экспорт отчетов (CSV & PDF для управляющего)
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Выгрузка сводных реестров звонков и персональных аудитов в стандартизированных форматах.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/30 space-y-2">
                <div className="flex items-center gap-2 text-emerald-900 font-bold">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                  <span>Таблица в CSV (Microsoft Excel)</span>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Файл формируется с кодировкой UTF-8 BOM и стандартным разделителем точка с запятой (;), что гарантирует открытие в русскоязычном Excel без сбоев кодировки.
                </p>
                <div className="bg-white p-2.5 rounded-lg border border-emerald-200 text-[11px] text-slate-700 space-y-1">
                  <span className="font-semibold block text-emerald-800">Содержит:</span>
                  <span>• Сводный блок ключевых метрик KPI управляющего;</span><br />
                  <span>• 27 детальных столбцов паспорта каждого диалога (Самара UTC+4, маскированный телефон, статус записи, мастер, оценка, суть, резюме диалога).</span>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-rose-200 bg-rose-50/30 space-y-2">
                <div className="flex items-center gap-2 text-rose-900 font-bold">
                  <FileText className="w-5 h-5 text-rose-600" />
                  <span>Сводный реестр в PDF (А4 Альбомный)</span>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Официальный презентационный документ для управляющего салоном с фирменным логотипом и названием «{salonName}».
                </p>
                <div className="bg-white p-2.5 rounded-lg border border-rose-200 text-[11px] text-slate-700 space-y-1">
                  <span className="font-semibold block text-rose-800">Содержит:</span>
                  <span>• 6 сводных KPI-карточек (конверсия %, отказы %, споры %, средний балл);</span><br />
                  <span>• Таблицу вызовов с цветовой кодировкой статусов и оценок;</span><br />
                  <span>• Блок согласования и подписи управляющего салоном с датой утверждения.</span>
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-1 text-xs text-slate-700">
              <span className="font-bold text-slate-900">Как выполнить экспорт:</span>
              <p className="leading-relaxed">
                В шапке «Журнала звонков» нажмите кнопку <strong>«Экспорт»</strong>. Выберите нужный объем данных: «Текущая выборка» (с учетом всех фильтров по датам, операторам, тональности) или «Вся таблица» базы данных.
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
                7. Внешние интеграции (МегаФон, Yclients, VK, S3)
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Автоматический обмен данными между телефонией, CRM и корпоративными мессенджерами.
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1.5 shadow-3xs">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> МегаФон Виртуальная АТС
                </span>
                <p className="text-slate-600 leading-relaxed">
                  Поддержка протоколов JSON-RPC и REST WCGP. Прием вебхуков о завершении вызовов, скачивание аудиозаписей диалогов и автоматический запуск транскрибации.
                </p>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1.5 shadow-3xs">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Yclients CRM
                </span>
                <p className="text-slate-600 leading-relaxed">
                  Синхронизация карточек клиентов, проверка существующих записей в расписании салона красоты и отправка ссылки на аудиозапись звонка в карточку визита.
                </p>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1.5 shadow-3xs">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-sky-500" /> ВКонтакте (Закрытый чат)
                </span>
                <p className="text-slate-600 leading-relaxed">
                  Мгновенная отправка уведомлений о записавшихся клиентах, низкой оценке администратора или конфликтном разговоре в закрытую беседу управляющих в VK.
                </p>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1.5 shadow-3xs">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-500" /> S3 Timeweb Cloud Резервирование
                </span>
                <p className="text-slate-600 leading-relaxed">
                  Автоматическая синхронизация зашифрованного хранилища базы данных (AES-256-GCM) в облачное объектное S3-хранилище каждые 5 минут для предотвращения потери данных.
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
                Полный технический паспорт системы сохранен в файле <code className="bg-white px-1.5 py-0.5 rounded border border-indigo-200 font-mono">TECHNICAL_DOCUMENTATION.md</code> в корне репозитория.
              </p>
              <p className="text-slate-600 leading-relaxed">
                Ниже приведена сводка по технологическому стеку, механизмам получения записей с АТС МегаФон и последовательности обработки звонков ИИ.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2 shadow-3xs">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Database className="w-4 h-4 text-indigo-600" /> Стек разработки
                </span>
                <ul className="text-slate-600 space-y-1 list-disc pl-4 leading-relaxed">
                  <li><strong>Frontend:</strong> React 18, TypeScript, Tailwind CSS, Lucide React, Vite.</li>
                  <li><strong>Backend:</strong> Node.js 22, Express, TypeScript, esbuild (bundle <code>dist/server.cjs</code>).</li>
                  <li><strong>Распознавание речи (STT):</strong> Yandex Cloud SpeechKit (русская речь, диаризация ролей).</li>
                  <li><strong>Нейросеть (LLM):</strong> Сбер GigaChat (Lite/Pro/Max) через доверенные сертификаты Минцифры РФ.</li>
                  <li><strong>Безопасность:</strong> AES-256-GCM шифрование локальной базы, маскирование номеров 152-ФЗ.</li>
                  <li><strong>Резервное копирование:</strong> S3 Timeweb Cloud (@aws-sdk/client-s3).</li>
                </ul>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2 shadow-3xs">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <PhoneCall className="w-4 h-4 text-emerald-600" /> Две версии интеграции с АТС МегаФон
                </span>
                <div className="text-slate-600 space-y-2 leading-relaxed">
                  <p>
                    <strong>Версия 1 (Push / Webhooks):</strong> АТС отправляет HTTP POST вебхуки на <code>/crm_integration.php</code> или <code>/api/calls/webhook</code> сразу после звонка (<code>cmd=history</code> с прямой ссылкой на MP3 и <code>cmd=event</code> для входящих звонков).
                  </p>
                  <p>
                    <strong>Версия 2 (Pull / WCGP REST):</strong> Сервер самостоятельно опрашивает шлюз <code>/sys/crm_api.wcgp</code> по расписанию (раз в 5-15 мин), разбирает CSV-реестр звонков и через команду <code>get.mgf_calls</code> получает прямые ссылки на записи.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2 shadow-3xs text-xs">
              <span className="font-bold text-slate-900 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-purple-600" /> Конвейер обработки звонка ИИ
              </span>
              <ol className="text-slate-600 space-y-1.5 list-decimal pl-4 leading-relaxed">
                <li><strong>Валидация длительности:</strong> звонки короче 10 секунд отсекаются (ИИ не галлюцинирует, оценка не ставится).</li>
                <li><strong>Скачивание MP3:</strong> сервер загружает аудиофайл с медиасервера МегаФон в буфер оперативной памяти.</li>
                <li><strong>STT Yandex SpeechKit:</strong> аудио преобразуется в текст с разделением «Менеджер» и «Клиент» и устранением дублей.</li>
                <li><strong>Обезличивание 152-ФЗ:</strong> телефоны маскируются перед передачей во внешнюю нейросеть.</li>
                <li><strong>Анализ GigaChat:</strong> определение статуса бронирования (согласие/отказ/консультация), сути обращения (услуга, мастер, дата, время), пересказа (2-4 предложения), оценки (1-10) и рекомендаций с учетом настроенного в админ-панели системного промпта.</li>
                <li><strong>Генерация Next Steps:</strong> составление 3-5 конкретных задач администратору для CRM Yclients и мессенджеров.</li>
                <li><strong>Журналирование и алерты:</strong> сохранение согласия в ConsentLog, запись в зашифрованную БД и алерт в VK/Telegram при спорах.</li>
              </ol>
            </div>

            {/* Настройка системного промпта ИИ */}
            <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2 shadow-3xs text-xs">
              <span className="font-bold text-slate-900 flex items-center gap-1.5">
                <SlidersHorizontal className="w-4 h-4 text-emerald-600" /> Настройка системного промпта ИИ в панели администратора
              </span>
              <p className="text-slate-600 leading-relaxed">
                В панели администратора доступен гибкий редактор <strong>Системного промпта GigaChat</strong>. Он содержит директивы для языковой модели по извлечению параметров звонка:
              </p>
              <ul className="text-slate-600 space-y-1 list-disc pl-4 leading-relaxed">
                <li><strong>Строгое написание ФИО с заглавной буквы:</strong> Все фамилии и имена специалистов и клиентов («Елена Валиулова», «Татьяна Валиулова», «Арина Егорова») автоматически извлекаются с прописной буквы, даже если в распознанной речи они звучали строчными буквами.</li>
                <li><strong>Категорический фильтр паразитных фраз:</strong> Модели запрещено подставлять в поле мастера местоимения, частицы и глаголы вроде «Меня Вот», «Записались», «Будете», «Студио».</li>
                <li><strong>Параметры услуги, даты и времени:</strong> Поддерживается нормализация устного счета («15 0 0» → «15:00») и фиксация дат («8 ноября», «5 января»).</li>
                <li><strong>Кнопки быстрого управления:</strong> Быстрая вставка директив, загрузка заводского эталона в редактор и мгновенный сброс к значениям по умолчанию.</li>
              </ul>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
