import { CallRecord } from '../types.js';
import { anonymizeTranscript, maskPhone } from './anonymize.js';

function escapeCsv(val: any): string {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

export function generateCallCsv(call: CallRecord, userRole: string = 'manager', customSalonName?: string): string {
  const salonName = (customSalonName || process.env.SALON_NAME || 'Fashion Look Studio').trim();
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
    ['Итог разговора', call.key_facts?.call_outcome || 'не указан', 'Категория результата'],
    ['Конфликт / Спор', call.key_facts?.is_dispute ? 'ДА' : 'НЕТ', call.key_facts?.dispute_reason || 'Конфликтов не зафиксировано'],
    ['Тональность клиента', call.key_facts?.tone_client || 'нейтральный', 'Эмоциональный окрас'],
    ['Тональность администратора', call.key_facts?.tone_manager || 'спокойный', 'Соблюдение стандартов сервиса'],
    ['Обещания клиенту', promisesText || 'Нет', 'Зафиксированные договоренности'],
    ['Суть обращения клиента', call.key_facts?.client_issue || 'Не указана', 'Тематика звонка'],
    ['Услуга', call.key_facts?.service || 'не указана', 'Интересующая услуга/процедура'],
    ['Дата записи', call.key_facts?.date || 'не указана', 'Желаемая/согласованная дата'],
    ['Время записи', call.key_facts?.time || 'не указано', 'Желаемое/согласованное время'],
    ['Мастер', call.key_facts?.master || 'не выбран', 'Выбранный специалист'],
    ['Комментарий аудитора', call.operator_comment || '', 'Анализ работы сотрудника'],
    ['Краткое содержание диалога', call.summary || '', 'Резюме разговора от ИИ'],
    ['Рекомендации для администратора', recommendationsText || '', 'Точки роста сервиса'],
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
  const salonName = (customSalonName || process.env.SALON_NAME || 'Fashion Look Studio').trim();
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
    'Тональность клиента',
    'Тональность администратора',
    'Конфликт / Спор',
    'Причина спора',
    'Итог звонка',
    'Краткая суть обращения',
    'Краткое резюме диалога',
    'Комментарий аудитора',
    'Рекомендации оператору',
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

