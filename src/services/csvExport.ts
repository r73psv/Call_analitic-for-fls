import { CallRecord } from '../types.js';
import { anonymizeTranscript, maskPhone } from './anonymize.js';
import type { PeriodStatsReportData } from './pdfReport.js';
import { resolveSalonName } from './salonBranding.js';

function sanitizeFormulaCell(raw: string): string {
  // Нейтрализация CSV Formula Injection (=, +, @, \t, \r, а также '-' если это не обычное число/дефис)
  if (!raw) return raw;
  const first = raw[0];
  if (first === '=' || first === '@' || first === '\t' || first === '\r') {
    return `'${raw}`;
  }
  if (first === '+') {
    // Разрешаем безопасные дельты вида "+5" / "+12.5%" / "+3 (+20%)", но экранируем формулы вроде "+1+1" или "+CMD"
    if (!/^\+\d+(?:[.,]\d+)?%?(?:\s*\([+-]\d+(?:[.,]\d+)?%?\))?$/.test(raw.trim())) {
      return `'${raw}`;
    }
  }
  if (first === '-') {
    if (!/^-\d+(?:[.,]\d+)?%?(?:\s*\([+-]\d+(?:[.,]\d+)?%?\))?$/.test(raw.trim()) && raw.trim() !== '-') {
      return `'${raw}`;
    }
  }
  return raw;
}

function escapeCsv(val: any): string {
  if (val === null || val === undefined) return '""';
  const sanitized = sanitizeFormulaCell(String(val));
  const str = sanitized.replace(/"/g, '""');
  return `"${str}"`;
}

export function generateCallCsv(call: CallRecord, userRole: string = 'manager', customSalonName?: string): string {
  const salonName = resolveSalonName({ configSalonName: customSalonName, envSalonName: process.env.SALON_NAME });
  const rawPhone = call.client_phone || (call as any).full_phone || '';
  const maskedPhone = call.client_phone_masked || maskPhone(rawPhone);

  // 152-ФЗ: Строгое соблюдение ролевого доступа к ПДн
  const clientPhone = (userRole === 'admin' && rawPhone) ? rawPhone : maskedPhone;

  // Обезличивание стенограммы перед экспортом по 152-ФЗ
  let transcript = call.transcript || '';
  if (userRole === 'viewer') {
    transcript = '[Доступ к стенограмме ограничен: роль Наблюдатель (152-ФЗ)]';
  } else {
    transcript = anonymizeTranscript(transcript);
  }

  // Местное время (Europe/Samara, UTC+4)
  let dateFormatted = call.timestamp;
  try {
    dateFormatted = new Date(call.timestamp).toLocaleString('ru-RU', {
      timeZone: 'Europe/Samara',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {}

  const m = Math.floor((call.duration_seconds || 0) / 60);
  const s = (call.duration_seconds || 0) % 60;
  const durationText = m > 0 ? `${m} мин. ${s} сек.` : `${s} сек.`;

  const bookingStatus = call.booking_status || call.key_facts?.booking_status || 'консультация';
  const recommendationsText = Array.isArray(call.recommendations)
    ? call.recommendations.join('; ')
    : (call.recommendations || '');
  const mistakesText = Array.isArray(call.operator_mistakes)
    ? call.operator_mistakes.join('; ')
    : (call.operator_mistakes || '');
  const promisesText = Array.isArray(call.key_facts?.promises)
    ? call.key_facts.promises.join('; ')
    : '';

  // Сборка CSV с BOM для корректного открытия в Excel (Windows/Mac)
  // Используется точка с запятой (;) - стандартный разделитель для русскоязычной локали Excel
  const rows: string[] = [];

  // Блок 1: Метаданные и паспорт отчета
  rows.push([`# САЛОН КРАСОТЫ «${salonName.toUpperCase()}» - ДЕТАЛЬНЫЙ ОТЧЕТ АУДИТА ЗВОНКА`, '', ''].map(escapeCsv).join(';'));
  rows.push(['# Режим соответствия 152-ФЗ: ВСЕ ПЕРСОНАЛЬНЫЕ ДАННЫЕ МАСКИРОВАНЫ', '', ''].map(escapeCsv).join(';'));
  rows.push(['# Роль пользователя при выгрузке', userRole, ''].map(escapeCsv).join(';'));
  rows.push(['', '', ''].join(';'));

  // Блок 2: Ключ - Значение (для удобного построчного чтения)
  const details: [string, string, string][] = [
    ['ID звонка', call.call_id, 'Уникальный номер сессии'],
    ['Дата и время (местное)', dateFormatted, 'Europe/Samara (UTC+4)'],
    ['Длительность', durationText, `${call.duration_seconds || 0} сек.`],
    ['Тип вызова', call.type === 'outgoing' ? 'Исходящий' : 'Входящий', 'Направление звонка'],
    ['Статус звонка', call.status || 'completed', 'Технический статус соединения'],
    ['Администратор / Оператор', call.operator_name || 'Не указан', `Сотрудник салона «${salonName}»`],
    ['Клиент (152-ФЗ)', clientPhone, 'Телефон (маскирован согласно 152-ФЗ)'],
    ['Согласие на обработку (152-ФЗ)', call.consent_status || 'active', 'Правовое основание записи'],
    ['Цели обработки ПДн', (call.consent_purposes || ['quality_control', 'training']).join(', '), 'Контроль качества'],
    ['Используемая ИИ-модель', call.model_used || 'GigaChat:Lite', 'Сбер GigaChat / SpeechKit'],
    ['Статус записи (ИИ-анализ)', bookingStatus, 'согласие / отказ / консультация'],
    ['Оценка работы оператора', call.operator_score !== null && call.operator_score !== undefined ? `${call.operator_score}/10` : 'Без оценки', 'Шкала 1-10'],
    ['Ошибки и недочеты менеджера', mistakesText || 'Грубых ошибок не допущено', 'Причины снижения оценки'],
    ['Итог разговора', call.key_facts?.call_outcome || 'не указан', 'Категория результата'],
    ['Конфликт / Спор', call.key_facts?.is_dispute ? 'ДА' : 'НЕТ', call.key_facts?.dispute_reason || 'Конфликтов не зафиксировано'],
    ['Тональность клиента', call.key_facts?.tone_client || 'нейтральный', 'Эмоциональный окрас'],
    ['Тональность администратора', call.key_facts?.tone_manager || 'спокойный', 'Соблюдение стандартов сервиса'],
    ['Обещания клиенту', promisesText || 'Нет', 'Зафиксированные договоренности'],
    ['Суть обращения клиента', call.key_facts?.client_issue || 'Не указана', 'Тематика звонка'],
    ['1. Цель обращения', call.structured_summary?.call_purpose || call.key_facts?.call_purpose || call.key_facts?.client_issue || 'Консультация и запись', 'Структурированное резюме'],
    ['2. Желаемая услуга', call.structured_summary?.requested_service || call.key_facts?.requested_service || call.key_facts?.service || 'не указана', 'Структурированное резюме'],
    ['3. Предложенный мастер', call.structured_summary?.offered_master || call.key_facts?.offered_master || call.key_facts?.master || 'не выбран', 'Структурированное резюме'],
    ['4. Озвученная стоимость', call.structured_summary?.offered_price || call.key_facts?.offered_price || 'Не озвучивалась', 'Структурированное резюме'],
    ['5. Предложенные дата и время', call.structured_summary?.offered_date_time || call.key_facts?.offered_date_time || 'Не предложены', 'Структурированное резюме'],
    ['6. Состоялась ли запись', call.structured_summary?.booking_status_text || call.key_facts?.is_booked_text || bookingStatus, 'Структурированное резюме'],
    ['7. Причина (если запись не состоялась)', call.structured_summary?.unbooked_reason || call.key_facts?.unbooked_reason || 'Запись состоялась', 'Структурированное резюме'],
    ['8. Дальнейшие действия менеджера', call.structured_summary?.manager_next_steps?.join('; ') || call.key_facts?.manager_next_steps?.join('; ') || '', 'Структурированное резюме'],
    ['Средний балл по применимым критериям', call.evaluation?.overall_score !== null && call.evaluation?.overall_score !== undefined ? `${call.evaluation.overall_score}/10 (применимо ${call.evaluation.applicable_count} из 10)` : '—', 'Оценка по 10 критериям'],
    ...((call.evaluation?.criteria || call.criteria_scores || []).map((crit, idx): [string, string, string] => [
      `Критерий ${idx + 1}. ${crit.name}`,
      crit.is_applicable !== false && crit.score !== null ? `${crit.score}/10` : 'Не применим (не снижает оценку)',
      crit.explanation
    ])),
    ['Услуга', call.key_facts?.service || 'не указана', 'Интересующая услуга/процедура'],
    ['Дата записи', call.key_facts?.date || 'не указана', 'Желаемая/согласованная дата'],
    ['Время записи', call.key_facts?.time || 'не указано', 'Желаемое/согласованное время'],
    ['Мастер', call.key_facts?.master || 'не выбран', 'Выбранный специалист'],
    ['Комментарий аудитора', call.operator_comment || '', 'Анализ работы сотрудника'],
    ['Краткое содержание диалога', call.summary || '', 'Резюме разговора от ИИ'],
    ['Рекомендации и советы по оптимизации', recommendationsText || '', 'Точки роста сервиса'],
    ['Обезличенная стенограмма диалога (152-ФЗ)', transcript, 'Диалог по ролям: Менеджер / Клиент'],
  ];

  rows.push(['Параметр', 'Значение', 'Примечание'].map(escapeCsv).join(';'));
  details.forEach(([k, v, note]) => {
    rows.push([k, v, note].map(escapeCsv).join(';'));
  });

  rows.push(['', '', ''].join(';'));
  rows.push(['# ТАБЛИЧНАЯ СТРОКА ДЛЯ ИМПОРТА В CRM / EXCEL / БАЗЫ ДАННЫХ', '', ''].map(escapeCsv).join(';'));

  // Блок 3: Плоская табличная строка (для легкого объединения или импорта)
  const tableHeaders = [
    'call_id',
    'timestamp_samara',
    'duration_seconds',
    'type',
    'status',
    'operator_name',
    'client_phone_152fz',
    'consent_status',
    'model_used',
    'booking_status',
    'service',
    'booking_date',
    'booking_time',
    'master',
    'operator_score',
    'call_outcome',
    'is_dispute',
    'dispute_reason',
    'tone_client',
    'tone_manager',
    'summary',
    'operator_comment',
    'recommendations',
    'transcript_anonymized',
  ];

  const tableValues = [
    call.call_id,
    dateFormatted,
    call.duration_seconds || 0,
    call.type || 'incoming',
    call.status || 'completed',
    call.operator_name || '',
    clientPhone,
    call.consent_status || 'active',
    call.model_used || '',
    bookingStatus,
    call.key_facts?.service || '',
    call.key_facts?.date || '',
    call.key_facts?.time || '',
    call.key_facts?.master || '',
    call.operator_score ?? '',
    call.key_facts?.call_outcome || '',
    call.key_facts?.is_dispute ? 'true' : 'false',
    call.key_facts?.dispute_reason || '',
    call.key_facts?.tone_client || '',
    call.key_facts?.tone_manager || '',
    call.summary || '',
    call.operator_comment || '',
    recommendationsText,
    transcript,
  ];

  rows.push(tableHeaders.map(escapeCsv).join(';'));
  rows.push(tableValues.map(escapeCsv).join(';'));

  // Возвращаем строку с UTF-8 BOM (\uFEFF) для мгновенного корректного открытия в Microsoft Excel
  return '\uFEFF' + rows.join('\r\n');
}

/**
 * Генерация сводного реестра звонков в CSV для отчетов управляющего салоном
 * Формат полностью совместим с Excel (русская локаль, разделитель ';', UTF-8 BOM, маскирование 152-ФЗ)
 */
export function generateCallsTableCsv(
  calls: CallRecord[],
  userRole: string = 'manager',
  customSalonName?: string,
  filterTitle?: string
): string {
  const salonName = resolveSalonName({ configSalonName: customSalonName, envSalonName: process.env.SALON_NAME });
  const rows: string[] = [];

  // Время генерации (Самара, UTC+4)
  const nowSamara = new Date().toLocaleString('ru-RU', {
    timeZone: 'Europe/Samara',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  // KPI метрики выборки для управляющего
  let bookedCount = 0;
  let declinedCount = 0;
  let consultationCount = 0;
  let disputeCount = 0;
  let totalScore = 0;
  let scoredCallsCount = 0;
  let totalDurationSec = 0;

  calls.forEach(call => {
    const rawStatus = (call.booking_status || call.key_facts?.booking_status || '').toLowerCase().trim();
    const outcome = (call.key_facts?.call_outcome || '').toLowerCase().trim();
    if (rawStatus === 'согласие' || rawStatus.includes('соглас') || outcome === 'запись') {
      bookedCount++;
    } else if (rawStatus === 'отказ' || rawStatus.includes('отказ') || outcome === 'отказ') {
      declinedCount++;
    } else {
      consultationCount++;
    }

    if (call.key_facts?.is_dispute) {
      disputeCount++;
    }

    if (call.operator_score !== null && call.operator_score !== undefined) {
      totalScore += Number(call.operator_score);
      scoredCallsCount++;
    }

    totalDurationSec += call.duration_seconds || 0;
  });

  const totalCalls = calls.length;
  const conversionRate = totalCalls > 0 ? ((bookedCount / totalCalls) * 100).toFixed(1) : '0.0';
  const disputeRate = totalCalls > 0 ? ((disputeCount / totalCalls) * 100).toFixed(1) : '0.0';
  const avgScore = scoredCallsCount > 0 ? (totalScore / scoredCallsCount).toFixed(1) : '—';
  const avgDuration = totalCalls > 0 ? Math.round(totalDurationSec / totalCalls) : 0;
  const avgDurationText = `${Math.floor(avgDuration / 60)} мин. ${avgDuration % 60} сек.`;

  // Блок 1: Заголовок и паспорт реестра
  rows.push([`# САЛОН КРАСОТЫ «${salonName.toUpperCase()}» — СВОДНЫЙ РЕЕСТР ЗВОНКОВ`, '', '', '', ''].map(escapeCsv).join(';'));
  rows.push([`# Назначение: Отчет управляющего по контролю качества обслуживания и аудио-аудиту`, '', '', '', ''].map(escapeCsv).join(';'));
  rows.push([`# Режим соответствия 152-ФЗ: ПЕРСОНАЛЬНЫЕ ДАННЫЕ МАСКИРОВАНЫ (Роль: ${userRole})`, '', '', '', ''].map(escapeCsv).join(';'));
  rows.push([`# Параметры фильтрации / выборка: ${filterTitle || 'Все звонки журнала'}`, '', '', '', ''].map(escapeCsv).join(';'));
  rows.push([`# Сформирован: ${nowSamara} (Самара, UTC+4)`, '', '', '', ''].map(escapeCsv).join(';'));
  rows.push(['', '', '', '', ''].join(';'));

  // Блок 2: Сводные KPI управляющего
  rows.push(['# СВОДНЫЕ ПОКАЗАТЕЛИ ВЫБОРКИ (KPI)', '', '', '', ''].map(escapeCsv).join(';'));
  rows.push(['Метрика', 'Значение', 'Пояснение', '', ''].map(escapeCsv).join(';'));
  rows.push(['Всего звонков в отчете', String(totalCalls), 'Общее количество сессий вызовов'].map(escapeCsv).join(';'));
  rows.push(['Конверсия в запись', `${conversionRate}% (${bookedCount} записей)`, 'Доля успешных записей клиентов'].map(escapeCsv).join(';'));
  rows.push(['Отказы от записи', `${declinedCount} (${totalCalls > 0 ? ((declinedCount / totalCalls) * 100).toFixed(1) : 0}%)`, 'Клиент отказался от визита'].map(escapeCsv).join(';'));
  rows.push(['Консультации / справка', `${consultationCount}`, 'Информационные звонки без слота'].map(escapeCsv).join(';'));
  rows.push(['Спорные диалоги / претензии', `${disputeRate}% (${disputeCount} звонков)`, 'Зафиксированные конфликтные маркеры'].map(escapeCsv).join(';'));
  rows.push(['Средний балл операторов', `${avgScore} / 10`, `Оценено звонков: ${scoredCallsCount}`].map(escapeCsv).join(';'));
  rows.push(['Средняя длительность разговора', avgDurationText, `${avgDuration} сек.`].map(escapeCsv).join(';'));
  rows.push(['', '', '', '', ''].join(';'));

  // Блок 3: Заголовки таблицы звонков
  const headers = [
    '№',
    'ID звонка',
    'Дата и время (Самара)',
    'Длительность',
    'Длительность (сек)',
    'Направление',
    'Статус соединения',
    'Администратор / Оператор',
    'Телефон клиента (152-ФЗ)',
    'Согласие 152-ФЗ',
    'Статус записи (ИИ)',
    'Услуга',
    'Дата записи',
    'Время записи',
    'Мастер',
    'Оценка ИИ (1-10)',
    'Ошибки менеджера',
    'Тональность клиента',
    'Тональность администратора',
    'Конфликт / Спор',
    'Причина спора',
    'Итог звонка',
    'Краткая суть обращения',
    'Краткое резюме диалога',
    'Комментарий аудитора',
    'Рекомендации и советы по оптимизации',
    'Теги',
    'ИИ-модель',
  ];
  rows.push(headers.map(escapeCsv).join(';'));

  // Блок 4: Строки звонков
  calls.forEach((call, index) => {
    const rawPhone = call.client_phone || (call as any).full_phone || '';
    const maskedPhone = call.client_phone_masked || maskPhone(rawPhone);
    const clientPhone = (userRole === 'admin' && rawPhone) ? rawPhone : maskedPhone;

    let dateFormatted = call.timestamp;
    try {
      dateFormatted = new Date(call.timestamp).toLocaleString('ru-RU', {
        timeZone: 'Europe/Samara',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {}

    const m = Math.floor((call.duration_seconds || 0) / 60);
    const s = (call.duration_seconds || 0) % 60;
    const durationText = m > 0 ? `${m} мин. ${s} сек.` : `${s} сек.`;

    const rawStatus = (call.booking_status || call.key_facts?.booking_status || '').toLowerCase().trim();
    let bookingStatus = 'консультация';
    if (rawStatus === 'согласие' || rawStatus.includes('соглас') || call.key_facts?.call_outcome === 'запись') {
      bookingStatus = 'согласие';
    } else if (rawStatus === 'отказ' || rawStatus.includes('отказ') || call.key_facts?.call_outcome === 'отказ') {
      bookingStatus = 'отказ';
    } else if (rawStatus === 'не применимо' || call.key_facts?.call_outcome === 'автоответчик') {
      bookingStatus = 'не применимо';
    }

    const recommendationsText = Array.isArray(call.recommendations)
      ? call.recommendations.join('; ')
      : (call.recommendations || '');

    const mistakesText = Array.isArray(call.operator_mistakes)
      ? call.operator_mistakes.join('; ')
      : (call.operator_mistakes || '');

    const tagsText = Array.isArray(call.tags)
      ? call.tags.join(', ')
      : '';

    const row = [
      index + 1,
      call.call_id,
      dateFormatted,
      durationText,
      call.duration_seconds || 0,
      call.type === 'outgoing' ? 'Исходящий' : 'Входящий',
      call.status || 'completed',
      call.operator_name || 'Не указан',
      clientPhone,
      call.consent_status || 'active',
      bookingStatus,
      call.key_facts?.service || '',
      call.key_facts?.date || '',
      call.key_facts?.time || '',
      call.key_facts?.master || '',
      call.operator_score !== null && call.operator_score !== undefined ? call.operator_score : '',
      mistakesText || 'Грубых ошибок не допущено',
      call.key_facts?.tone_client || '',
      call.key_facts?.tone_manager || '',
      call.key_facts?.is_dispute ? 'ДА' : 'НЕТ',
      call.key_facts?.dispute_reason || '',
      call.key_facts?.call_outcome || '',
      call.key_facts?.client_issue || '',
      call.summary || '',
      call.operator_comment || '',
      recommendationsText,
      tagsText,
      call.model_used || '',
    ];

    rows.push(row.map(escapeCsv).join(';'));
  });

  return '\uFEFF' + rows.join('\r\n');
}

/**
 * Генерация обезличенного сводного аналитического отчета за период в формате CSV (152-ФЗ РФ)
 * для подготовки внутренней отчетности администраторами.
 * Строго обезличивает все персональные данные клиентов: телефоны всегда маскированы (****XXXXXX),
 * имена клиентов и стенограммы не выгружаются, текстовые поля очищены от ПДн.
 */
export function generatePeriodStatsCsv(
  data: PeriodStatsReportData,
  calls: CallRecord[] = [],
  customSalonName?: string
): string {
  const salonName = resolveSalonName({ configSalonName: customSalonName, envSalonName: process.env.SALON_NAME });
  const rows: string[] = [];

  const nowSamara = new Date().toLocaleString('ru-RU', {
    timeZone: 'Europe/Samara',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const formatDur = (sec?: number): string => {
    const s = Math.max(0, Math.round(sec || 0));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return m > 0 ? `${m} мин. ${rem} сек.` : `${rem} сек.`;
  };

  const calcDeltaText = (curVal: number, prevVal?: number, isPercent = false): string => {
    if (prevVal === undefined || prevVal === null || (prevVal === 0 && curVal === 0)) return '—';
    const diff = curVal - prevVal;
    const sign = diff > 0 ? '+' : '';
    let text = isPercent ? `${sign}${diff.toFixed(1)}%` : `${sign}${Number.isInteger(diff) ? diff : diff.toFixed(1)}`;
    if (!isPercent && prevVal > 0) {
      const pct = ((diff / prevVal) * 100).toFixed(1);
      text += ` (${sign}${pct}%)`;
    }
    return text;
  };

  const cur = data.currentStats;
  const prev = data.isComparative ? data.previousStats : undefined;

  // Блок 1: Паспорт отчета (152-ФЗ)
  rows.push([`# САЛОН КРАСОТЫ «${salonName.toUpperCase()}» — ОБЕЗЛИЧЕННЫЙ АНАЛИТИЧЕСКИЙ ОТЧЕТ (152-ФЗ)`, '', '', ''].map(escapeCsv).join(';'));
  rows.push(['# Режим соответствия 152-ФЗ: ВСЕ ПЕРСОНАЛЬНЫЕ ДАННЫЕ КЛИЕНТОВ ОБЕЗЛИЧЕНЫ (БЕЗ ФИО, ПОЛНЫХ НОМЕРОВ И СТЕНОГРАММ)', '', '', ''].map(escapeCsv).join(';'));
  rows.push(['# Анализируемый период', `${data.periodTitle} (${data.periodDates})`, '', ''].map(escapeCsv).join(';'));
  if (data.isComparative && data.compareDates) {
    rows.push(['# Период сравнения', `${data.comparePeriodTitle || 'Предыдущий период'} (${data.compareDates})`, '', ''].map(escapeCsv).join(';'));
  }
  rows.push(['# Пиковые часы обращений', data.hourlyPeakHours || '—', '', ''].map(escapeCsv).join(';'));
  rows.push(['# Сформирован', `${nowSamara} (Самара, UTC+4)`, '', ''].map(escapeCsv).join(';'));
  rows.push(['', '', '', ''].join(';'));

  // Блок 2: Ключевые показатели эффективности (KPI)
  rows.push(['# 1. КЛЮЧЕВЫЕ ПОКАЗАТЕЛИ ЭФФЕКТИВНОСТИ (KPI)', '', '', ''].map(escapeCsv).join(';'));
  if (prev) {
    rows.push(['Показатель / Метрика', 'Текущий период', 'Предыдущий период', 'Динамика (Δ)'].map(escapeCsv).join(';'));
  } else {
    rows.push(['Показатель / Метрика', 'Значение за период', 'Примечание', ''].map(escapeCsv).join(';'));
  }

  const kpiEntries: Array<[string, string, string, string, string]> = [
    [
      'Всего звонков',
      String(cur.totalCalls),
      prev ? String(prev.totalCalls) : '',
      prev ? calcDeltaText(cur.totalCalls, prev.totalCalls) : '',
      'Общее количество обращений за период',
    ],
    [
      'Входящие вызовы',
      String(cur.incomingCalls),
      prev ? String(prev.incomingCalls) : '',
      prev ? calcDeltaText(cur.incomingCalls, prev.incomingCalls) : '',
      `${cur.totalCalls > 0 ? Math.round((cur.incomingCalls / cur.totalCalls) * 100) : 0}% от общего объема`,
    ],
    [
      'Исходящие вызовы',
      String(cur.outgoingCalls),
      prev ? String(prev.outgoingCalls) : '',
      prev ? calcDeltaText(cur.outgoingCalls, prev.outgoingCalls) : '',
      `${cur.totalCalls > 0 ? Math.round((cur.outgoingCalls / cur.totalCalls) * 100) : 0}% от общего объема`,
    ],
    [
      'Завершенные / отвеченные',
      String(cur.completedCalls),
      prev ? String(prev.completedCalls) : '',
      prev ? calcDeltaText(cur.completedCalls, prev.completedCalls) : '',
      'Успешно обработанные звонки',
    ],
    [
      'Пропущенные / неотвеченные',
      String(cur.missedCalls),
      prev ? String(prev.missedCalls) : '',
      prev ? calcDeltaText(cur.missedCalls, prev.missedCalls) : '',
      `${cur.totalCalls > 0 ? Math.round((cur.missedCalls / cur.totalCalls) * 100) : 0}% от общего объема`,
    ],
    [
      'Успешные записи (согласие)',
      String(cur.bookedCount),
      prev ? String(prev.bookedCount) : '',
      prev ? calcDeltaText(cur.bookedCount, prev.bookedCount) : '',
      'Подтвержденные записи клиентов',
    ],
    [
      'Отказы от записи',
      String(cur.declinedCount),
      prev ? String(prev.declinedCount) : '',
      prev ? calcDeltaText(cur.declinedCount, prev.declinedCount) : '',
      'Клиент отказался от визита',
    ],
    [
      'Консультации / справка',
      String(cur.consultationCount),
      prev ? String(prev.consultationCount) : '',
      prev ? calcDeltaText(cur.consultationCount, prev.consultationCount) : '',
      'Информационные обращения без записи',
    ],
    [
      'Конверсия в запись (%)',
      `${cur.conversionRate}%`,
      prev ? `${prev.conversionRate}%` : '',
      prev ? calcDeltaText(cur.conversionRate, prev.conversionRate, true) : '',
      'Доля обращений, завершившихся записью',
    ],
    [
      'Средний балл операторов (из 10)',
      String(cur.averageScore),
      prev ? String(prev.averageScore) : '',
      prev ? calcDeltaText(cur.averageScore, prev.averageScore) : '',
      'Средняя оценка качества обслуживания ИИ',
    ],
    [
      'Спорные / конфликтные звонки',
      `${cur.disputeCount} (${cur.disputeRate}%)`,
      prev ? `${prev.disputeCount} (${prev.disputeRate}%)` : '',
      prev ? calcDeltaText(cur.disputeRate, prev.disputeRate, true) : '',
      'Доля звонков с маркерами спора/недовольства',
    ],
    [
      'Средняя длительность диалога',
      formatDur(cur.avgDurationSec),
      prev ? formatDur(prev.avgDurationSec) : '',
      prev ? calcDeltaText(cur.avgDurationSec, prev.avgDurationSec) : '',
      `${cur.avgDurationSec} сек.`,
    ],
  ];

  kpiEntries.forEach(([label, curVal, prevVal, deltaVal, note]) => {
    if (prev) {
      rows.push([label, curVal, prevVal, deltaVal].map(escapeCsv).join(';'));
    } else {
      rows.push([label, curVal, note, ''].map(escapeCsv).join(';'));
    }
  });

  rows.push(['', '', '', ''].join(';'));

  // Блок 3: Рейтинг операторов
  rows.push(['# 2. РЕЙТИНГ И РЕЗУЛЬТАТИВНОСТЬ ОПЕРАТОРОВ', '', '', ''].map(escapeCsv).join(';'));
  const opHeaders = data.isComparative
    ? ['Оператор / Администратор', 'Звонков', 'Средний балл', 'Записей', 'Конверсия (%)', 'Конфликты', 'Пред. ср. балл', 'Пред. конверсия (%)']
    : ['Оператор / Администратор', 'Звонков', 'Средний балл', 'Записей', 'Конверсия (%)', 'Конфликты'];
  rows.push(opHeaders.map(escapeCsv).join(';'));

  if (!data.operators || data.operators.length === 0) {
    rows.push(['За выбранный период данные по операторам отсутствуют'].map(escapeCsv).join(';'));
  } else {
    data.operators.forEach((op) => {
      const base = [
        op.name || 'Дежурный администратор',
        op.totalCalls,
        op.avgScore !== null && op.avgScore !== undefined ? op.avgScore : '—',
        op.bookedCount,
        `${op.conversionRate}%`,
        op.disputes,
      ];
      if (data.isComparative) {
        base.push(
          op.prevAvgScore !== null && op.prevAvgScore !== undefined ? op.prevAvgScore : '—',
          op.prevConversionRate !== undefined ? `${op.prevConversionRate}%` : '—'
        );
      }
      rows.push(base.map(escapeCsv).join(';'));
    });
  }

  rows.push(['', '', '', ''].join(';'));

  // Блок 4: Обезличенный реестр звонков за период (152-ФЗ)
  rows.push(['# 3. ОБЕЗЛИЧЕННЫЙ РЕЕСТР ЗВОНКОВ ЗА ПЕРИОД (152-ФЗ — БЕЗ ПЕРСОНАЛЬНЫХ ДАННЫХ)', '', '', ''].map(escapeCsv).join(';'));
  const callHeaders = [
    '№',
    'ID звонка',
    'Дата и время (Самара)',
    'Длительность (сек)',
    'Направление',
    'Статус соединения',
    'Оператор / Администратор',
    'Абонент (обезличено 152-ФЗ)',
    'Статус записи',
    'Услуга',
    'Мастер',
    'Оценка ИИ (1-10)',
    'Тональность клиента',
    'Тональность оператора',
    'Конфликт / Спор',
    'Причина спора (обезличено)',
    'Итог звонка',
    'Краткое резюме (обезличено)',
    'Ошибки менеджера (обезличено)',
    'Теги',
    'Модель ИИ',
  ];
  rows.push(callHeaders.map(escapeCsv).join(';'));

  calls.forEach((call, index) => {
    const rawPhone = call.client_phone || (call as any).full_phone || '';
    // Строго 152-ФЗ: всегда маскируем телефон независимо от роли (даже для администратора)
    const maskedPhone = maskPhone(rawPhone || call.client_phone_masked || '');

    let dateFormatted = call.timestamp || '';
    try {
      dateFormatted = new Date(call.timestamp).toLocaleString('ru-RU', {
        timeZone: 'Europe/Samara',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {}

    const rawStatus = (call.booking_status || call.key_facts?.booking_status || '').toLowerCase().trim();
    let bookingStatus = 'консультация';
    if (rawStatus === 'согласие' || rawStatus.includes('соглас') || call.key_facts?.call_outcome === 'запись') {
      bookingStatus = 'согласие';
    } else if (rawStatus === 'отказ' || rawStatus.includes('отказ') || call.key_facts?.call_outcome === 'отказ') {
      bookingStatus = 'отказ';
    } else if (rawStatus === 'не применимо' || call.key_facts?.call_outcome === 'автоответчик') {
      bookingStatus = 'не применимо';
    }

    const mistakesText = Array.isArray(call.operator_mistakes)
      ? call.operator_mistakes.join('; ')
      : (call.operator_mistakes || '');
    const tagsText = Array.isArray(call.tags) ? call.tags.join(', ') : '';

    const safeSummary = anonymizeTranscript(call.summary || '');
    const safeDisputeReason = anonymizeTranscript(call.key_facts?.dispute_reason || '');
    const safeMistakes = anonymizeTranscript(mistakesText || 'Грубых ошибок не допущено');
    const safeService = anonymizeTranscript(call.key_facts?.service || '');

    const row = [
      index + 1,
      call.call_id,
      dateFormatted,
      call.duration_seconds || 0,
      call.type === 'outgoing' ? 'Исходящий' : 'Входящий',
      call.status || 'completed',
      call.operator_name || 'Дежурный администратор',
      `Клиент (${maskedPhone})`,
      bookingStatus,
      safeService,
      call.key_facts?.master || '',
      call.operator_score !== null && call.operator_score !== undefined ? call.operator_score : '',
      call.key_facts?.tone_client || '',
      call.key_facts?.tone_manager || '',
      call.key_facts?.is_dispute ? 'ДА' : 'НЕТ',
      safeDisputeReason,
      call.key_facts?.call_outcome || '',
      safeSummary,
      safeMistakes,
      tagsText,
      call.model_used || '',
    ];

    rows.push(row.map(escapeCsv).join(';'));
  });

  return '\uFEFF' + rows.join('\r\n');
}


