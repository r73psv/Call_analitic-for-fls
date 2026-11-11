import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { CallRecord } from '../types.js';
import { anonymizeTranscript, maskPhone } from './anonymize.js';

function getFontPaths(): { regular: string; bold: string } {
  const localRegular = path.join(process.cwd(), 'fonts', 'LiberationSans-Regular.ttf');
  const localBold = path.join(process.cwd(), 'fonts', 'LiberationSans-Bold.ttf');
  if (fs.existsSync(localRegular) && fs.existsSync(localBold)) {
    return { regular: localRegular, bold: localBold };
  }

  const sysRegular = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf';
  const sysBold = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf';
  if (fs.existsSync(sysRegular) && fs.existsSync(sysBold)) {
    return { regular: sysRegular, bold: sysBold };
  }

  throw new Error('Шрифты с поддержкой кириллицы (LiberationSans) не найдены.');
}

function formatSamaraDate(dateStr?: string): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('ru-RU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Samara',
    });
  } catch {
    return dateStr;
  }
}

function formatDuration(sec?: number): string {
  if (!sec && sec !== 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s} сек.`;
  return `${m} мин. ${s} сек.`;
}

export function generateCallAuditPdf(call: CallRecord, userRole: string = 'manager', customSalonName?: string): InstanceType<typeof PDFDocument> {
  const salonName = customSalonName || process.env.SALON_NAME || 'Fashion Look Studio';
  const doc = new PDFDocument({
    size: 'A4',
    margin: 36,
    bufferPages: true,
    info: {
      Title: `Отчет аудита звонка ${call.call_id} — Салон «${salonName}»`,
      Author: `Салон красоты «${salonName}» — Речевая аналитика GigaChat`,
      Subject: 'Отчет контроля качества обслуживания и работы оператора (152-ФЗ)',
    },
  });

  const fonts = getFontPaths();
  doc.registerFont('AppFont', fonts.regular);
  doc.registerFont('AppFontBold', fonts.bold);

  const pageWidth = 595.28;
  const margin = 36;
  const contentWidth = pageWidth - margin * 2; // 523.28

  // Helper function to check and add new page if needed
  function ensureSpace(neededHeight: number) {
    if (doc.y + neededHeight > doc.page.height - margin - 30) {
      doc.addPage();
    }
  }

  // 152-ФЗ Маскирование телефона в зависимости от прав доступа
  const rawPhone = call.client_phone || (call as any).full_phone || '';
  const maskedPhone = call.client_phone_masked || maskPhone(rawPhone);
  const clientPhone = (userRole === 'admin' && rawPhone) ? rawPhone : maskedPhone;

  // 1. Header Banner
  doc.rect(margin, margin, contentWidth, 54).fill('#1e1b4b');
  doc.font('AppFontBold').fontSize(16).fillColor('#ffffff').text(`САЛОН КРАСОТЫ «${salonName.toUpperCase()}»`, margin + 14, margin + 12);
  doc
    .font('AppFont')
    .fontSize(9)
    .fillColor('#c7d2fe')
    .text('ОТЧЕТ КОНТРОЛЯ КАЧЕСТВА ОБСЛУЖИВАНИЯ И АУДИТА РАБОТЫ ОПЕРАТОРА', margin + 14, margin + 34);

  doc.y = margin + 64;

  // 2. Metadata Sub-strip (152-FZ + generation date)
  const nowSamara = new Date().toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Samara',
  });

  doc.font('AppFont').fontSize(8).fillColor('#64748b');
  doc.text(
    `Дата формирования отчета: ${nowSamara} (Самара, UTC+4)  •  Маскирование 152-ФЗ: Активно  •  Модель: ${call.model_used || 'GigaChat'}`,
    margin,
    doc.y
  );
  doc.moveDown(0.8);

  // 3. Call Parameters Table
  const tableY = doc.y;
  doc.rect(margin, tableY, contentWidth, 68).fillAndStroke('#f8fafc', '#e2e8f0');

  doc.font('AppFontBold').fontSize(8.5).fillColor('#475569');
  doc.text('РЕКВИЗИТЫ ЗВОНКА (МАСКИРОВАНО ПО 152-ФЗ)', margin + 12, tableY + 8);

  doc.font('AppFont').fontSize(8.5).fillColor('#1e293b');
  const col1X = margin + 12;
  const col2X = margin + 180;
  const col3X = margin + 350;

  // Row 1
  doc.font('AppFontBold').text('ID звонка: ', col1X, tableY + 24, { continued: true });
  doc.font('AppFont').text(call.call_id);

  doc.font('AppFontBold').text('Дата и время: ', col2X, tableY + 24, { continued: true });
  doc.font('AppFont').text(formatSamaraDate(call.timestamp));

  doc.font('AppFontBold').text('Длительность: ', col3X, tableY + 24, { continued: true });
  doc.font('AppFont').text(formatDuration(call.duration_seconds));

  // Row 2
  doc.font('AppFontBold').text('Клиент (152-ФЗ): ', col1X, tableY + 44, { continued: true });
  doc.font('AppFont').text(clientPhone);

  doc.font('AppFontBold').text('Администратор: ', col2X, tableY + 44, { continued: true });
  doc.font('AppFont').text(call.operator_name || `Администратор «${salonName}»`);

  doc.font('AppFontBold').text('Тип вызова: ', col3X, tableY + 44, { continued: true });
  doc.font('AppFont').text(call.type === 'outgoing' ? 'Исходящий' : 'Входящий');

  doc.y = tableY + 76;
  doc.moveDown(0.5);

  // 4. Booking Status & Score Assessment Box
  const rawStatus = (call.booking_status || call.key_facts?.booking_status || '').toLowerCase().trim();
  const isConsent = rawStatus === 'согласие' || rawStatus.includes('соглас') || call.key_facts?.call_outcome === 'запись';
  const isDecline = rawStatus === 'отказ' || rawStatus.includes('отказ') || call.key_facts?.call_outcome === 'отказ';
  const isNA = rawStatus === 'не применимо' || call.key_facts?.call_outcome === 'автоответчик';

  let statusTitle = 'КОНСУЛЬТАЦИЯ (Без записи)';
  let statusDesc = 'Клиент получил информацию об услугах/мастерах салона, слот записи не зафиксирован.';
  let statusBg = '#f0f9ff';
  let statusStroke = '#0ea5e9';
  let statusText = '#0369a1';

  if (isConsent) {
    statusTitle = '✓ СОГЛАСИЕ НА ЗАПИСЬ (Клиент записан)';
    statusDesc = 'Клиент согласился на предложенный слот времени, запись в расписание успешно подтверждена.';
    statusBg = '#ecfdf5';
    statusStroke = '#10b981';
    statusText = '#047857';
  } else if (isDecline) {
    statusTitle = '✗ ОТКАЗ ОТ ЗАПИСИ (Запись не состоялась)';
    statusDesc = 'Клиент отказался от предложенных вариантов (не подходит время, отъезд из города, занятость мастера).';
    statusBg = '#fff1f2';
    statusStroke = '#f43f5e';
    statusText = '#be123c';
  } else if (isNA) {
    statusTitle = '— НЕ ПРИМЕНИМО (Автоответчик / Короткий вызов)';
    statusDesc = 'Соединение не перешло в диалог или сработал автоответчик абонента.';
    statusBg = '#f8fafc';
    statusStroke = '#94a3b8';
    statusText = '#475569';
  }

  ensureSpace(95);
  const assessY = doc.y;
  doc.rect(margin, assessY, contentWidth, 86).fillAndStroke(statusBg, statusStroke);

  // Left side: Booking status
  doc.font('AppFontBold').fontSize(10).fillColor(statusText).text(statusTitle, margin + 14, assessY + 12);
  doc
    .font('AppFont')
    .fontSize(8.5)
    .fillColor('#334155')
    .text(statusDesc, margin + 14, assessY + 28, { width: 340, lineGap: 2 });

  doc.font('AppFontBold').fontSize(8).fillColor('#64748b').text('ИТОГ ОБРАЩЕНИЯ: ', margin + 14, assessY + 64, { continued: true });
  doc.font('AppFontBold').fillColor(statusText).text((call.key_facts?.call_outcome || 'КОНСУЛЬТАЦИЯ').toUpperCase(), { continued: true });
  doc.font('AppFont').fillColor('#64748b').text('  |  Конфликт/спор: ', { continued: true });
  doc.font('AppFontBold').fillColor(call.key_facts?.is_dispute ? '#e11d48' : '#059669').text(
    call.key_facts?.is_dispute ? 'Обнаружен спор' : 'Отсутствует'
  );

  // Right side: Score Badge
  const scoreBoxX = margin + 375;
  const scoreBoxY = assessY + 10;
  const score = call.operator_score;

  let scoreColor = '#10b981';
  let scoreLabel = 'Высокое качество';
  if (score === null || score === undefined) {
    scoreColor = '#94a3b8';
    scoreLabel = 'Без оценки';
  } else if (score < 5) {
    scoreColor = '#ef4444';
    scoreLabel = 'Низкий балл';
  } else if (score < 8) {
    scoreColor = '#f59e0b';
    scoreLabel = 'Средний балл';
  }

  doc.roundedRect(scoreBoxX, scoreBoxY, 134, 66, 6).fillAndStroke('#ffffff', scoreColor);
  doc.font('AppFont').fontSize(7.5).fillColor('#64748b').text('ОЦЕНКА ОПЕРАТОРА', scoreBoxX, scoreBoxY + 8, { align: 'center', width: 134 });
  doc.font('AppFontBold').fontSize(22).fillColor(scoreColor).text(
    score !== null && score !== undefined ? `${score}/10` : '—',
    scoreBoxX,
    scoreBoxY + 20,
    { align: 'center', width: 134 }
  );
  doc.font('AppFont').fontSize(7.5).fillColor(scoreColor).text(scoreLabel, scoreBoxX, scoreBoxY + 48, { align: 'center', width: 134 });

  doc.y = assessY + 96;
  doc.moveDown(0.5);

  // 5. Auditor Comment (Комментарий аудитора)
  if (call.operator_comment) {
    ensureSpace(60);
    const commentY = doc.y;
    doc.rect(margin, commentY, contentWidth, 18).fill('#f1f5f9');
    doc.font('AppFontBold').fontSize(8.5).fillColor('#334155').text('КОММЕНТАРИЙ АУДИТОРА К РАБОТЕ ОПЕРАТОРА', margin + 10, commentY + 5);

    doc.y = commentY + 24;
    doc
      .font('AppFont')
      .fontSize(8.5)
      .fillColor('#1e293b')
      .text(call.operator_comment, margin + 10, doc.y, { width: contentWidth - 20, lineGap: 3 });
    doc.moveDown(0.6);
  }

  // 6. Dialogue Summary (Краткое содержание диалога и 8 обязательных параметров)
  ensureSpace(100);
  const summaryHeaderY = doc.y;
  doc.rect(margin, summaryHeaderY, contentWidth, 18).fill('#f1f5f9');
  doc.font('AppFontBold').fontSize(8.5).fillColor('#334155').text('РЕЗЮМЕ ЗВОНКА И 8 СТРУКТУРИРОВАННЫХ ПАРАМЕТРОВ ОБРАЩЕНИЯ', margin + 10, summaryHeaderY + 5);

  doc.y = summaryHeaderY + 24;
  const struct = call.structured_summary || call.key_facts?.structured_summary;
  if (struct) {
    const pItems: [string, string][] = [
      ['1. Цель обращения', struct.call_purpose || 'Консультация и запись'],
      ['2. Желаемая услуга', struct.requested_service || 'Не указана'],
      ['3. Предложенный мастер', struct.offered_master || 'Не выбран'],
      ['4. Озвученная стоимость', struct.offered_price || 'Не озвучивалась'],
      ['5. Предложенные дата и время', struct.offered_date_time || 'Не предложены'],
      ['6. Состоялась ли запись', struct.booking_status_text || '—'],
      ['7. Причина (если не состоялась)', struct.unbooked_reason || 'Запись состоялась'],
      ['8. Дальнейшие действия менеджера', Array.isArray(struct.manager_next_steps) ? struct.manager_next_steps.join('; ') : '—'],
    ];

    pItems.forEach(([label, val]) => {
      ensureSpace(16);
      doc.font('AppFontBold').fontSize(8).fillColor('#4338ca').text(`${label}: `, margin + 10, doc.y, { continued: true });
      doc.font('AppFont').fillColor('#1e293b').text(val, { width: contentWidth - 20, lineGap: 2 });
    });
    doc.moveDown(0.4);
  }

  const summaryText = call.summary || 'Резюме диалога отсутствует.';
  const summaryMatch = summaryText.match(/суть обращения\s*:\s*([\s\S]*?)(?:(?:пересказ диалога|краткий пересказ(?: разговора)?|пересказ разговора)\s*:\s*([\s\S]*?))?(?:вывод\s*:\s*([\s\S]*))?$/i);
  if (summaryMatch && (summaryMatch[1] || summaryMatch[2] || summaryMatch[3])) {
    if (summaryMatch[1]?.trim()) {
      doc.font('AppFontBold').fontSize(8.5).fillColor('#4338ca').text('Суть обращения: ', margin + 10, doc.y, { continued: true });
      doc.font('AppFont').fillColor('#1e293b').text(summaryMatch[1].trim(), { width: contentWidth - 20, lineGap: 2 });
      doc.moveDown(0.3);
    }
    if (summaryMatch[2]?.trim()) {
      doc.font('AppFontBold').fontSize(8.5).fillColor('#1e1b4b').text('Краткий пересказ (2–4 предложения): ', margin + 10, doc.y, { continued: true });
      doc.font('AppFont').fillColor('#1e293b').text(summaryMatch[2].trim(), { width: contentWidth - 20, lineGap: 2 });
      doc.moveDown(0.3);
    }
    if (summaryMatch[3]?.trim()) {
      doc.font('AppFontBold').fontSize(8.5).fillColor('#047857').text('Вывод: ', margin + 10, doc.y, { continued: true });
      doc.font('AppFont').fillColor('#1e293b').text(summaryMatch[3].trim(), { width: contentWidth - 20, lineGap: 3 });
    }
  } else {
    doc
      .font('AppFont')
      .fontSize(8.5)
      .fillColor('#1e293b')
      .text(summaryText, margin + 10, doc.y, { width: contentWidth - 20, lineGap: 3 });
  }
  doc.moveDown(0.6);

  // 6.1. Оценка звонка по 10 критериям качества обслуживания
  const evalData = call.evaluation || (call.criteria_scores ? { criteria: call.criteria_scores, overall_score: call.operator_score, applicable_count: call.criteria_scores.filter(c => c.is_applicable !== false).length } : null);
  if (evalData && evalData.criteria && evalData.criteria.length > 0) {
    ensureSpace(120);
    const evalHeaderY = doc.y;
    doc.rect(margin, evalHeaderY, contentWidth, 18).fill('#f1f5f9');
    doc.font('AppFontBold').fontSize(8.5).fillColor('#334155').text(
      `ОЦЕНКА ЗВОНКА ПО 10 КРИТЕРИЯМ (СРЕДНИЙ БАЛЛ: ${evalData.overall_score ?? '—'} / 10, ПРИМЕНИМО: ${evalData.applicable_count ?? '—'} ИЗ 10)`,
      margin + 10,
      evalHeaderY + 5
    );
    doc.y = evalHeaderY + 24;

    evalData.criteria.forEach((crit, idx) => {
      ensureSpace(18);
      const isApplicable = crit.is_applicable !== false && crit.score !== null;
      const scoreStr = isApplicable ? `${crit.score}/10` : 'Н/П';
      const scoreColor = !isApplicable ? '#64748b' : ((crit.score ?? 0) >= 8 ? '#047857' : (crit.score ?? 0) >= 5 ? '#b45309' : '#b91c1c');

      doc.font('AppFontBold').fontSize(8).fillColor('#1e1b4b').text(`${idx + 1}. ${crit.name}: `, margin + 10, doc.y, { continued: true });
      doc.font('AppFontBold').fontSize(8).fillColor(scoreColor).text(`[${scoreStr}] `, { continued: true });
      doc.font('AppFont').fontSize(7.5).fillColor('#475569').text(crit.explanation, { width: contentWidth - 20, lineGap: 1.5 });
      doc.moveDown(0.2);
    });
    doc.moveDown(0.5);
  }

  // 7. Recommendations (Рекомендации для администратора)
  const recs = Array.isArray(call.recommendations) ? call.recommendations : [call.recommendations].filter(Boolean);
  if (recs.length > 0) {
    ensureSpace(50);
    const recsHeaderY = doc.y;
    doc.rect(margin, recsHeaderY, contentWidth, 18).fill('#f1f5f9');
    doc.font('AppFontBold').fontSize(8.5).fillColor('#334155').text('РЕКОМЕНДАЦИИ ДЛЯ АДМИНИСТРАТОРА', margin + 10, recsHeaderY + 5);

    doc.y = recsHeaderY + 24;
    recs.forEach((rec, idx) => {
      ensureSpace(24);
      doc
        .font('AppFontBold')
        .fontSize(8.5)
        .fillColor('#4338ca')
        .text(`${idx + 1}. `, margin + 10, doc.y, { continued: true });
      doc
        .font('AppFont')
        .fillColor('#1e293b')
        .text(rec, { width: contentWidth - 30, lineGap: 2 });
      doc.moveDown(0.2);
    });
    doc.moveDown(0.5);
  }

  // 8. Transcript (Стенограмма диалога по ролям с обезличиванием по 152-ФЗ)
  if (userRole === 'viewer') {
    ensureSpace(50);
    const trHeaderY = doc.y;
    doc.rect(margin, trHeaderY, contentWidth, 18).fill('#f1f5f9');
    doc.font('AppFontBold').fontSize(8.5).fillColor('#334155').text('СТЕНОГРАММА ДИАЛОГА', margin + 10, trHeaderY + 5);
    doc.y = trHeaderY + 24;
    doc.font('AppFont').fontSize(8.5).fillColor('#94a3b8').text('[Доступ к стенограмме ограничен правилами 152-ФЗ для роли Наблюдатель]', margin + 10, doc.y);
    doc.moveDown(0.5);
  } else if (call.transcript && call.transcript.trim().length > 0) {
    ensureSpace(70);
    const trHeaderY = doc.y;
    doc.rect(margin, trHeaderY, contentWidth, 18).fill('#f1f5f9');
    doc.font('AppFontBold').fontSize(8.5).fillColor('#334155').text('СТЕНОГРАММА ДИАЛОГА (ОБЕЗЛИЧЕНА ПО 152-ФЗ)', margin + 10, trHeaderY + 5);

    doc.y = trHeaderY + 24;

    const lines = call.transcript.split('\n').map(l => l.trim()).filter(Boolean);
    lines.forEach((line) => {
      ensureSpace(22);
      const isManager = line.startsWith('Менеджер:') || line.startsWith('Администратор:') || line.startsWith('Оператор:');
      const cleanLineRaw = line.replace(/^(Менеджер:|Клиент:|Администратор:|Оператор:|Неизвестный:)\s*/i, '');
      const cleanLine = anonymizeTranscript(cleanLineRaw);
      const speakerLabel = isManager ? 'Менеджер: ' : (line.startsWith('Клиент:') ? 'Клиент: ' : '');

      if (isManager) {
        doc.font('AppFontBold').fontSize(8).fillColor('#4338ca').text(speakerLabel, margin + 10, doc.y, { continued: true });
        doc.font('AppFont').fontSize(8).fillColor('#1e1b4b').text(cleanLine, { width: contentWidth - 25, lineGap: 2 });
      } else {
        doc.font('AppFontBold').fontSize(8).fillColor('#0f172a').text(speakerLabel, margin + 10, doc.y, { continued: true });
        doc.font('AppFont').fontSize(8).fillColor('#334155').text(cleanLine, { width: contentWidth - 25, lineGap: 2 });
      }
      doc.moveDown(0.15);
    });
    doc.moveDown(0.5);
  }

  // 9. Signatures Block (Подпись управляющего)
  ensureSpace(60);
  doc.moveDown(0.8);
  const signY = doc.y;
  doc.rect(margin, signY, contentWidth, 44).fillAndStroke('#f8fafc', '#e2e8f0');

  doc.font('AppFontBold').fontSize(8).fillColor('#475569').text('УТВЕРЖДЕНИЕ ОТЧЕТА УПРАВЛЯЮЩИМ САЛОНА «ЛИК 28»', margin + 12, signY + 8);
  doc.font('AppFont').fontSize(8).fillColor('#334155').text(
    'Управляющий: ________________________ / ________________________            Дата: «____» ________________ 202___ г.',
    margin + 12,
    signY + 25
  );

  // 10. Number all pages & Add Footers
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    const footerY = doc.page.height - margin + 12;
    doc.font('AppFont').fontSize(7.5).fillColor('#94a3b8');
    doc.text(
      `Салон красоты «${salonName}» • Автоматический аудит GigaChat & SpeechKit • Звонок: ${call.call_id}`,
      margin,
      footerY
    );
    doc.text(`Страница ${i + 1} из ${pages.count}`, margin, footerY, {
      align: 'right',
      width: contentWidth,
    });
  }

  return doc;
}

export interface PeriodStatsReportData {
  periodTitle: string;
  periodDates: string;
  isComparative: boolean;
  comparePeriodTitle?: string;
  compareDates?: string;
  currentStats: {
    totalCalls: number;
    incomingCalls: number;
    outgoingCalls: number;
    completedCalls: number;
    missedCalls: number;
    bookedCount: number;
    declinedCount: number;
    consultationCount: number;
    conversionRate: number;
    averageScore: number;
    disputeCount: number;
    disputeRate: number;
    avgDurationSec: number;
  };
  previousStats?: {
    totalCalls: number;
    incomingCalls: number;
    outgoingCalls: number;
    completedCalls: number;
    missedCalls: number;
    bookedCount: number;
    declinedCount: number;
    consultationCount: number;
    conversionRate: number;
    averageScore: number;
    disputeCount: number;
    disputeRate: number;
    avgDurationSec: number;
  };
  operators: Array<{
    name: string;
    totalCalls: number;
    avgScore: number | null;
    bookedCount: number;
    conversionRate: number;
    disputes: number;
    prevAvgScore?: number | null;
    prevConversionRate?: number;
  }>;
  hourlyPeakHours?: string;
  userRole?: string;
}

/**
 * Генерация комплексного PDF-отчета за период со сравнительным анализом
 */
export function generatePeriodStatsPdf(data: PeriodStatsReportData, customSalonName?: string): InstanceType<typeof PDFDocument> {
  const salonName = customSalonName || process.env.SALON_NAME || 'Fashion Look Studio';
  const doc = new PDFDocument({
    size: 'A4',
    margin: 36,
    bufferPages: true,
    info: {
      Title: `Сводный аналитический отчет — Салон «${salonName}» (${data.periodDates})`,
      Author: `Салон красоты «${salonName}» — Речевая аналитика`,
      Subject: 'Сводный отчет эффективности звонков и работы операторов за период',
    },
  });

  const fonts = getFontPaths();
  doc.registerFont('AppFont', fonts.regular);
  doc.registerFont('AppFontBold', fonts.bold);

  const pageWidth = 595.28;
  const margin = 36;
  const contentWidth = pageWidth - margin * 2; // 523.28

  function ensureSpace(neededHeight: number) {
    if (doc.y + neededHeight > doc.page.height - margin - 30) {
      doc.addPage();
    }
  }

  // 1. Header Banner
  doc.rect(margin, margin, contentWidth, 54).fill('#0f172a');
  doc.font('AppFontBold').fontSize(15).fillColor('#ffffff').text(`САЛОН КРАСОТЫ «${salonName.toUpperCase()}»`, margin + 14, margin + 11);
  doc
    .font('AppFont')
    .fontSize(9)
    .fillColor('#94a3b8')
    .text('СВОДНЫЙ АНАЛИТИЧЕСКИЙ ОТЧЕТ И СРАВНИТЕЛЬНЫЙ АНАЛИЗ ЗВОНКОВ', margin + 14, margin + 32);

  doc.y = margin + 64;

  // 2. Info Strip
  const nowSamara = new Date().toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Samara',
  });

  const infoY = doc.y;
  doc.rect(margin, infoY, contentWidth, data.isComparative ? 44 : 32).fillAndStroke('#f8fafc', '#e2e8f0');

  doc.font('AppFontBold').fontSize(8.5).fillColor('#1e293b').text(
    `АНАЛИЗИРУЕМЫЙ ПЕРИОД: ${data.periodTitle.toUpperCase()} (${data.periodDates})`,
    margin + 10,
    infoY + 8
  );

  if (data.isComparative && data.compareDates) {
    doc.font('AppFont').fontSize(8).fillColor('#0284c7').text(
      `СРАВНЕНИЕ С ПЕРИОДОМ: ${data.comparePeriodTitle || 'Предыдущий период'} (${data.compareDates})`,
      margin + 10,
      infoY + 22
    );
  }

  doc.font('AppFont').fontSize(7.5).fillColor('#64748b').text(
    `Сформирован: ${nowSamara} (Самара, UTC+4) • 152-ФЗ РФ`,
    margin + 10,
    data.isComparative ? infoY + 33 : infoY + 20
  );

  doc.y = infoY + (data.isComparative ? 52 : 40);

  // 3. KPI Summary Table
  doc.font('AppFontBold').fontSize(11).fillColor('#0f172a').text('1. Ключевые показатели эффективности (KPI)');
  doc.moveDown(0.3);

  const cur = data.currentStats;
  const prev = data.previousStats;

  interface KpiRow {
    label: string;
    curVal: string;
    prevVal?: string;
    delta?: string;
    isPositiveGood?: boolean;
    isGood?: boolean;
  }

  function calcDelta(curN: number, prevN?: number, isPercent = false, invert = false): { text: string; isGood: boolean } {
    if (prevN === undefined || prevN === null || prevN === 0 && curN === 0) return { text: '—', isGood: true };
    const diff = curN - prevN;
    const sign = diff > 0 ? '+' : '';
    let text = isPercent ? `${sign}${diff.toFixed(1)}%` : `${sign}${diff.toFixed(1)}`;
    if (!isPercent && prevN > 0) {
      const pct = ((diff / prevN) * 100).toFixed(1);
      text += ` (${sign}${pct}%)`;
    }
    const isGood = invert ? diff <= 0 : diff >= 0;
    return { text, isGood };
  }

  const kpiRows: KpiRow[] = [
    {
      label: 'Всего звонков',
      curVal: `${cur.totalCalls} вызовов`,
      prevVal: prev ? `${prev.totalCalls} вызовов` : undefined,
      delta: prev ? calcDelta(cur.totalCalls, prev.totalCalls).text : undefined,
      isGood: prev ? cur.totalCalls >= prev.totalCalls : true
    },
    {
      label: 'Входящие вызовы',
      curVal: `${cur.incomingCalls} (${cur.totalCalls > 0 ? Math.round((cur.incomingCalls / cur.totalCalls) * 100) : 0}%)`,
      prevVal: prev ? `${prev.incomingCalls} (${prev.totalCalls > 0 ? Math.round((prev.incomingCalls / prev.totalCalls) * 100) : 0}%)` : undefined,
      delta: prev ? calcDelta(cur.incomingCalls, prev.incomingCalls).text : undefined,
      isGood: true
    },
    {
      label: 'Исходящие вызовы',
      curVal: `${cur.outgoingCalls} (${cur.totalCalls > 0 ? Math.round((cur.outgoingCalls / cur.totalCalls) * 100) : 0}%)`,
      prevVal: prev ? `${prev.outgoingCalls} (${prev.totalCalls > 0 ? Math.round((prev.outgoingCalls / prev.totalCalls) * 100) : 0}%)` : undefined,
      delta: prev ? calcDelta(cur.outgoingCalls, prev.outgoingCalls).text : undefined,
      isGood: true
    },
    {
      label: 'Конверсия в запись',
      curVal: `${cur.conversionRate}% (${cur.bookedCount} записей)`,
      prevVal: prev ? `${prev.conversionRate}% (${prev.bookedCount} записей)` : undefined,
      delta: prev ? calcDelta(cur.conversionRate, prev.conversionRate, true).text : undefined,
      isGood: prev ? cur.conversionRate >= prev.conversionRate : true
    },
    {
      label: 'Средний балл операторов',
      curVal: `${cur.averageScore} / 10`,
      prevVal: prev ? `${prev.averageScore} / 10` : undefined,
      delta: prev ? calcDelta(cur.averageScore, prev.averageScore).text : undefined,
      isGood: prev ? cur.averageScore >= prev.averageScore : true
    },
    {
      label: 'Уровень споров и претензий',
      curVal: `${cur.disputeRate}% (${cur.disputeCount} звонков)`,
      prevVal: prev ? `${prev.disputeRate}% (${prev.disputeCount} звонков)` : undefined,
      delta: prev ? calcDelta(cur.disputeRate, prev.disputeRate, true, true).text : undefined,
      isGood: prev ? cur.disputeRate <= prev.disputeRate : true
    },
    {
      label: 'Пропущенные / Не отвеченные',
      curVal: `${cur.missedCalls} (${cur.totalCalls > 0 ? Math.round((cur.missedCalls / cur.totalCalls) * 100) : 0}%)`,
      prevVal: prev ? `${prev.missedCalls} (${prev.totalCalls > 0 ? Math.round((prev.missedCalls / prev.totalCalls) * 100) : 0}%)` : undefined,
      delta: prev ? calcDelta(cur.missedCalls, prev.missedCalls, false, true).text : undefined,
      isGood: prev ? cur.missedCalls <= prev.missedCalls : true
    },
    {
      label: 'Средняя длительность диалога',
      curVal: formatDuration(cur.avgDurationSec),
      prevVal: prev ? formatDuration(prev.avgDurationSec) : undefined,
      delta: prev ? calcDelta(cur.avgDurationSec, prev.avgDurationSec).text : undefined,
      isGood: true
    },
  ];

  // Draw KPI Table Header
  const tableHeaderY = doc.y;
  doc.rect(margin, tableHeaderY, contentWidth, 20).fill('#e2e8f0');

  const colWidthMetric = data.isComparative ? 180 : 280;
  const colWidthCur = data.isComparative ? 120 : 243;
  const colWidthPrev = 120;
  const colWidthDelta = 103;

  doc.font('AppFontBold').fontSize(8).fillColor('#1e293b');
  doc.text('Показатель / Метрика', margin + 8, tableHeaderY + 6);
  doc.text(data.isComparative ? 'Текущий период' : 'Значение за период', margin + colWidthMetric + 8, tableHeaderY + 6);
  if (data.isComparative) {
    doc.text('Предыдущий период', margin + colWidthMetric + colWidthCur + 8, tableHeaderY + 6);
    doc.text('Динамика (Δ)', margin + colWidthMetric + colWidthCur + colWidthPrev + 8, tableHeaderY + 6);
  }

  doc.y = tableHeaderY + 20;

  kpiRows.forEach((row, idx) => {
    ensureSpace(20);
    const rowY = doc.y;
    const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
    doc.rect(margin, rowY, contentWidth, 19).fillAndStroke(bg, '#f1f5f9');

    doc.font('AppFontBold').fontSize(8).fillColor('#334155').text(row.label, margin + 8, rowY + 5);
    doc.font('AppFont').fontSize(8).fillColor('#0f172a').text(row.curVal, margin + colWidthMetric + 8, rowY + 5);

    if (data.isComparative && row.prevVal) {
      doc.font('AppFont').fontSize(8).fillColor('#64748b').text(row.prevVal, margin + colWidthMetric + colWidthCur + 8, rowY + 5);
      const deltaColor = row.isGood ? '#15803d' : '#b91c1c';
      doc.font('AppFontBold').fontSize(8).fillColor(deltaColor).text(row.delta || '—', margin + colWidthMetric + colWidthCur + colWidthPrev + 8, rowY + 5);
    }

    doc.y = rowY + 19;
  });

  doc.moveDown(0.8);

  // 4. Operator Ranking Table
  ensureSpace(80);
  doc.font('AppFontBold').fontSize(11).fillColor('#0f172a').text('2. Рейтинг и результативность операторов (администраторов)');
  doc.moveDown(0.3);

  const opHeaderY = doc.y;
  doc.rect(margin, opHeaderY, contentWidth, 20).fill('#e2e8f0');

  const opColName = 160;
  const opColCalls = 70;
  const opColScore = 80;
  const opColBooked = 70;
  const opColConv = 80;
  const opColDisp = 63;

  doc.font('AppFontBold').fontSize(8).fillColor('#1e293b');
  doc.text('Сотрудник (Оператор)', margin + 8, opHeaderY + 6);
  doc.text('Звонков', margin + opColName + 8, opHeaderY + 6);
  doc.text('Ср. балл', margin + opColName + opColCalls + 8, opHeaderY + 6);
  doc.text('Записей', margin + opColName + opColCalls + opColScore + 8, opHeaderY + 6);
  doc.text('Конверсия', margin + opColName + opColCalls + opColScore + opColBooked + 8, opHeaderY + 6);
  doc.text('Конфликты', margin + opColName + opColCalls + opColScore + opColBooked + opColConv + 8, opHeaderY + 6);

  doc.y = opHeaderY + 20;

  if (data.operators.length === 0) {
    const emptyY = doc.y;
    doc.rect(margin, emptyY, contentWidth, 20).fillAndStroke('#ffffff', '#e2e8f0');
    doc.font('AppFont').fontSize(8).fillColor('#64748b').text('За выбранный период звонки операторов не зафиксированы', margin + 8, emptyY + 6);
    doc.y = emptyY + 20;
  } else {
    data.operators.forEach((op, idx) => {
      ensureSpace(20);
      const rowY = doc.y;
      const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
      doc.rect(margin, rowY, contentWidth, 19).fillAndStroke(bg, '#f1f5f9');

      doc.font('AppFontBold').fontSize(8).fillColor('#0f172a').text(op.name, margin + 8, rowY + 5);
      doc.font('AppFont').fontSize(8).fillColor('#334155').text(String(op.totalCalls), margin + opColName + 8, rowY + 5);

      const scoreText = op.avgScore !== null ? `${op.avgScore} / 10` : '—';
      const scoreColor = (op.avgScore || 0) >= 8 ? '#15803d' : (op.avgScore || 0) >= 6 ? '#b45309' : '#b91c1c';
      doc.font('AppFontBold').fontSize(8).fillColor(scoreColor).text(scoreText, margin + opColName + opColCalls + 8, rowY + 5);

      doc.font('AppFont').fontSize(8).fillColor('#334155').text(String(op.bookedCount), margin + opColName + opColCalls + opColScore + 8, rowY + 5);
      doc.font('AppFontBold').fontSize(8).fillColor('#0369a1').text(`${op.conversionRate}%`, margin + opColName + opColCalls + opColScore + opColBooked + 8, rowY + 5);

      const dispColor = op.disputes > 0 ? '#dc2626' : '#64748b';
      doc.font('AppFont').fontSize(8).fillColor(dispColor).text(String(op.disputes), margin + opColName + opColCalls + opColScore + opColBooked + opColConv + 8, rowY + 5);

      doc.y = rowY + 19;
    });
  }

  doc.moveDown(0.8);

  // 5. Conclusions and Manager Recommendations
  ensureSpace(85);
  doc.font('AppFontBold').fontSize(11).fillColor('#0f172a').text('3. Резюме и аналитические выводы');
  doc.moveDown(0.3);

  const concY = doc.y;
  doc.rect(margin, concY, contentWidth, 68).fillAndStroke('#eff6ff', '#bfdbfe');

  const recList = [
    `• Общая конверсия обращений в запись составила ${cur.conversionRate}%, средняя оценка качества работы операторов — ${cur.averageScore}/10.`,
    cur.disputeRate > 10 
      ? `• ВНИМАНИЕ: Доля спорных обращений составляет ${cur.disputeRate}%. Рекомендуется провести разбор конфликтных диалогов с дежурными администраторами.` 
      : `• Показатель конфликтности находится в пределах регламентной нормы салона (${cur.disputeRate}%).`,
    `• Пиковые часы обращений клиентов: ${data.hourlyPeakHours || '11:00 — 16:00'}. Рекомендуется обеспечить максимальную доступность линии в данный интервал.`,
    data.isComparative && prev
      ? `• Сравнительная динамика: конверсия ${cur.conversionRate >= prev.conversionRate ? 'выросла на' : 'снизилась на'} ${Math.abs(cur.conversionRate - prev.conversionRate).toFixed(1)}%, средний балл ${cur.averageScore >= prev.averageScore ? 'увеличился на' : 'снизился на'} ${Math.abs(cur.averageScore - prev.averageScore).toFixed(1)}.`
      : '• Мониторинг качества осуществляется в автоматическом режиме с применением технологий распознавания речи Yandex SpeechKit и анализа Сбер GigaChat.'
  ];

  let currRecY = concY + 7;
  recList.forEach((r) => {
    doc.font('AppFont').fontSize(7.8).fillColor('#1e3a8a').text(r, margin + 8, currRecY, { width: contentWidth - 16 });
    currRecY += 14;
  });

  doc.y = concY + 72;

  // 6. Signatures Block
  ensureSpace(50);
  doc.moveDown(0.5);
  const signY = doc.y;
  doc.rect(margin, signY, contentWidth, 42).fillAndStroke('#f8fafc', '#e2e8f0');

  doc.font('AppFontBold').fontSize(8).fillColor('#475569').text(`УТВЕРЖДЕНИЕ ОТЧЕТА УПРАВЛЯЮЩИМ САЛОНА «${salonName.toUpperCase()}»`, margin + 12, signY + 7);
  doc.font('AppFont').fontSize(7.5).fillColor('#334155').text(
    'Управляющий салоном: ________________________ / ________________________       Дата: «____» ________________ 202___ г.',
    margin + 12,
    signY + 23
  );

  // 7. Page numbers and footer
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    const footerY = doc.page.height - margin + 12;
    doc.font('AppFont').fontSize(7.5).fillColor('#94a3b8');
    doc.text(
      `Салон красоты «${salonName}» • Сводный отчет по звонкам • ${data.periodDates}`,
      margin,
      footerY
    );
    doc.text(`Страница ${i + 1} из ${pages.count}`, margin, footerY, {
      align: 'right',
      width: contentWidth,
    });
  }

  return doc;
}

/**
 * Генерация сводного реестра звонков в PDF (формат А4 альбомный / Landscape)
 * Предназначен для управляющего салоном: содержит сводку KPI, оценку работы операторов и детальный журнал
 */
export function generateCallsTablePdf(
  calls: CallRecord[],
  userRole: string = 'manager',
  customSalonName?: string,
  filterTitle?: string
): InstanceType<typeof PDFDocument> {
  const salonName = (customSalonName || process.env.SALON_NAME || 'Fashion Look Studio').trim();

  // Создаем документ в альбомной ориентации (841.89 x 595.28)
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 36,
    bufferPages: true,
    info: {
      Title: `Сводный реестр звонков — Салон «${salonName}»`,
      Author: `Салон красоты «${salonName}» — Речевая аналитика GigaChat`,
      Subject: 'Сводный отчет управляющего по качеству звонков и конверсии (152-ФЗ)',
    },
  });

  const fonts = getFontPaths();
  doc.registerFont('AppFont', fonts.regular);
  doc.registerFont('AppFontBold', fonts.bold);

  const pageWidth = 841.89;
  const pageHeight = 595.28;
  const margin = 36;
  const contentWidth = pageWidth - margin * 2; // 769.89

  // Вспомогательная функция проверки места на странице
  function ensureSpace(neededHeight: number, onNewPage?: () => void) {
    if (doc.y + neededHeight > pageHeight - margin - 25) {
      doc.addPage();
      if (onNewPage) {
        onNewPage();
      }
    }
  }

  // Расчет сводных KPI
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
  const declinedRate = totalCalls > 0 ? ((declinedCount / totalCalls) * 100).toFixed(1) : '0.0';
  const disputeRate = totalCalls > 0 ? ((disputeCount / totalCalls) * 100).toFixed(1) : '0.0';
  const avgScore = scoredCallsCount > 0 ? (totalScore / scoredCallsCount).toFixed(1) : '—';
  const avgDurationSec = totalCalls > 0 ? Math.round(totalDurationSec / totalCalls) : 0;
  const avgDurationText = `${Math.floor(avgDurationSec / 60)} мин. ${avgDurationSec % 60} сек.`;

  const nowSamara = new Date().toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Samara',
  });

  // 1. Верхний титульный баннер
  doc.rect(margin, margin, contentWidth, 48).fill('#1e1b4b');
  doc.font('AppFontBold').fontSize(14).fillColor('#ffffff').text(`САЛОН КРАСОТЫ «${salonName.toUpperCase()}»`, margin + 14, margin + 10);
  doc
    .font('AppFont')
    .fontSize(8.5)
    .fillColor('#c7d2fe')
    .text('СВОДНЫЙ РЕЕСТР И АУДИТ ЗВОНКОВ — ОФИЦИАЛЬНЫЙ ОТЧЕТ УПРАВЛЯЮЩЕГО САЛОНОМ', margin + 14, margin + 28);

  // Правый блок баннера (выборка/фильтр)
  const displayFilter = filterTitle ? `Выборка: ${filterTitle}` : 'Выборка: Все звонки журнала';
  doc.font('AppFontBold').fontSize(8.5).fillColor('#f8fafc').text(displayFilter, margin, margin + 12, {
    align: 'right',
    width: contentWidth - 14,
  });
  doc.font('AppFont').fontSize(7.5).fillColor('#94a3b8').text(`Всего звонков в отчете: ${totalCalls}`, margin, margin + 28, {
    align: 'right',
    width: contentWidth - 14,
  });

  doc.y = margin + 54;

  // 2. Метаданные (дата, 152-ФЗ, роль)
  doc.font('AppFont').fontSize(7.5).fillColor('#64748b');
  doc.text(
    `Дата выгрузки: ${nowSamara} (Самара, UTC+4)  •  Маскирование 152-ФЗ: Активно  •  Уровень доступа: ${userRole.toUpperCase()}  •  Модель анализа: Сбер GigaChat`,
    margin,
    doc.y
  );
  doc.moveDown(0.6);

  // 3. Блок сводных KPI-карточек для управляющего
  const kpiY = doc.y;
  const numCards = 6;
  const gap = 8;
  const cardWidth = (contentWidth - gap * (numCards - 1)) / numCards;
  const cardHeight = 44;

  const kpiCards = [
    { label: 'ВСЕГО ЗВОНКОВ', val: `${totalCalls}`, sub: 'В выборке отчета', color: '#0f172a', bg: '#f8fafc', border: '#e2e8f0' },
    { label: 'КОНВЕРСИЯ В ЗАПИСЬ', val: `${conversionRate}%`, sub: `${bookedCount} клиентов`, color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0' },
    { label: 'ОТКАЗЫ ОТ ЗАПИСИ', val: `${declinedRate}%`, sub: `${declinedCount} клиентов`, color: '#b91c1c', bg: '#fef2f2', border: '#fecaca' },
    { label: 'СПОРЫ / ПРЕТЕНЗИИ', val: `${disputeRate}%`, sub: `${disputeCount} звонков`, color: disputeCount > 0 ? '#b91c1c' : '#475569', bg: disputeCount > 0 ? '#fef2f2' : '#f8fafc', border: disputeCount > 0 ? '#fecaca' : '#e2e8f0' },
    { label: 'СРЕДНИЙ БАЛЛ ИИ', val: `${avgScore} / 10`, sub: `${scoredCallsCount} оценено`, color: (Number(avgScore) || 0) >= 8 ? '#15803d' : '#0369a1', bg: '#f0f9ff', border: '#bae6fd' },
    { label: 'СРЕДНЕЕ ВРЕМЯ', val: avgDurationText, sub: `${avgDurationSec} сек.`, color: '#334155', bg: '#f8fafc', border: '#e2e8f0' },
  ];

  kpiCards.forEach((c, idx) => {
    const cx = margin + idx * (cardWidth + gap);
    doc.rect(cx, kpiY, cardWidth, cardHeight).fillAndStroke(c.bg, c.border);
    doc.font('AppFontBold').fontSize(6.5).fillColor('#64748b').text(c.label, cx + 6, kpiY + 6, { width: cardWidth - 12 });
    doc.font('AppFontBold').fontSize(11).fillColor(c.color).text(c.val, cx + 6, kpiY + 16, { width: cardWidth - 12 });
    doc.font('AppFont').fontSize(6.5).fillColor('#64748b').text(c.sub, cx + 6, kpiY + 31, { width: cardWidth - 12 });
  });

  doc.y = kpiY + cardHeight + 10;

  // 4. Определение колонок реестра звонков
  // Ширина: 22 + 75 + 65 + 75 + 85 + 95 + 72 + 38 + 55 + 38 + 150 = 770
  const cols = {
    idx: { x: margin, w: 22, title: '№' },
    date: { x: margin + 22, w: 75, title: 'Дата / Время' },
    id: { x: margin + 97, w: 65, title: 'ID / Тип' },
    phone: { x: margin + 162, w: 75, title: 'Клиент (152-ФЗ)' },
    operator: { x: margin + 237, w: 85, title: 'Оператор' },
    service: { x: margin + 322, w: 95, title: 'Услуга / Мастер' },
    status: { x: margin + 417, w: 72, title: 'Статус записи' },
    score: { x: margin + 489, w: 38, title: 'Балл' },
    tone: { x: margin + 527, w: 55, title: 'Тональность' },
    dispute: { x: margin + 582, w: 38, title: 'Спор' },
    summary: { x: margin + 620, w: 150, title: 'Суть обращения и резюме диалога' },
  };

  function drawTableHeaders() {
    const thY = doc.y;
    doc.rect(margin, thY, contentWidth, 18).fill('#1e293b');
    doc.font('AppFontBold').fontSize(7).fillColor('#ffffff');

    doc.text(cols.idx.title, cols.idx.x + 3, thY + 5);
    doc.text(cols.date.title, cols.date.x + 4, thY + 5);
    doc.text(cols.id.title, cols.id.x + 4, thY + 5);
    doc.text(cols.phone.title, cols.phone.x + 4, thY + 5);
    doc.text(cols.operator.title, cols.operator.x + 4, thY + 5);
    doc.text(cols.service.title, cols.service.x + 4, thY + 5);
    doc.text(cols.status.title, cols.status.x + 4, thY + 5);
    doc.text(cols.score.title, cols.score.x + 4, thY + 5);
    doc.text(cols.tone.title, cols.tone.x + 4, thY + 5);
    doc.text(cols.dispute.title, cols.dispute.x + 4, thY + 5);
    doc.text(cols.summary.title, cols.summary.x + 4, thY + 5);

    doc.y = thY + 18;
  }

  // Отрисовка шапки таблицы
  drawTableHeaders();

  // 5. Отрисовка строк таблицы
  if (calls.length === 0) {
    const emptyY = doc.y;
    doc.rect(margin, emptyY, contentWidth, 24).fillAndStroke('#ffffff', '#e2e8f0');
    doc.font('AppFont').fontSize(8.5).fillColor('#64748b').text('По выбранным критериям звонки не найдены', margin + 12, emptyY + 7);
    doc.y = emptyY + 24;
  } else {
    calls.forEach((call, index) => {
      const rowHeight = 26;
      ensureSpace(rowHeight, () => {
        drawTableHeaders();
      });

      const rowY = doc.y;
      const isEven = index % 2 === 0;
      doc.rect(margin, rowY, contentWidth, rowHeight).fillAndStroke(isEven ? '#ffffff' : '#f8fafc', '#f1f5f9');

      // 152-ФЗ Телефон
      const rawPhone = call.client_phone || (call as any).full_phone || '';
      const maskedPhone = call.client_phone_masked || maskPhone(rawPhone);
      const clientPhone = (userRole === 'admin' && rawPhone) ? rawPhone : maskedPhone;

      // Дата и время
      let dateText = '—';
      try {
        const d = new Date(call.timestamp);
        dateText = d.toLocaleString('ru-RU', {
          timeZone: 'Europe/Samara',
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
      } catch {}

      // Длительность
      const durSec = call.duration_seconds || 0;
      const durText = durSec > 0 ? `${Math.floor(durSec / 60)}м ${durSec % 60}с` : '—';

      // Статус записи
      const rawStatus = (call.booking_status || call.key_facts?.booking_status || '').toLowerCase().trim();
      let statusLabel = 'Консультация';
      let statusColor = '#0369a1';
      if (rawStatus === 'согласие' || rawStatus.includes('соглас') || call.key_facts?.call_outcome === 'запись') {
        statusLabel = '✓ Согласие';
        statusColor = '#15803d';
      } else if (rawStatus === 'отказ' || rawStatus.includes('отказ') || call.key_facts?.call_outcome === 'отказ') {
        statusLabel = '✕ Отказ';
        statusColor = '#b91c1c';
      } else if (rawStatus === 'не применимо' || call.key_facts?.call_outcome === 'автоответчик') {
        statusLabel = 'Автоответ';
        statusColor = '#64748b';
      }

      // Оценка
      const sc = call.operator_score;
      const scoreText = sc !== null && sc !== undefined ? `${sc}/10` : '—';
      let scoreColor = '#64748b';
      if (sc !== null && sc !== undefined) {
        scoreColor = sc >= 8 ? '#15803d' : sc >= 5 ? '#b45309' : '#b91c1c';
      }

      // Спор
      const isDispute = Boolean(call.key_facts?.is_dispute);
      const disputeText = isDispute ? 'ДА' : 'Нет';
      const disputeColor = isDispute ? '#dc2626' : '#94a3b8';

      // Тональность
      const toneClient = call.key_facts?.tone_client || 'нейтральн.';

      // Услуга / мастер
      const svc = call.key_facts?.service || 'Консультация';
      const mstr = call.key_facts?.master ? `(${call.key_facts.master})` : '';
      const serviceText = mstr ? `${svc} ${mstr}` : svc;

      // Суть / резюме (обрезаем до 130 символов)
      let summaryText = call.key_facts?.client_issue || call.summary || 'Обращение клиента обработано.';
      if (summaryText.length > 120) {
        summaryText = summaryText.slice(0, 117) + '...';
      }

      // Рендерим ячейки строки
      doc.font('AppFont').fontSize(6.5).fillColor('#64748b').text(String(index + 1), cols.idx.x + 3, rowY + 5);

      // Дата и длительность
      doc.font('AppFontBold').fontSize(6.8).fillColor('#1e293b').text(dateText, cols.date.x + 4, rowY + 5);
      doc.font('AppFont').fontSize(6.2).fillColor('#64748b').text(durText, cols.date.x + 4, rowY + 14);

      // ID и направление
      const shortId = call.call_id.length > 10 ? call.call_id.slice(-8) : call.call_id;
      doc.font('AppFontBold').fontSize(6.5).fillColor('#0f172a').text(shortId, cols.id.x + 4, rowY + 5);
      doc.font('AppFont').fontSize(6.2).fillColor('#64748b').text(call.type === 'outgoing' ? 'Исходящий' : 'Входящий', cols.id.x + 4, rowY + 14);

      // Телефон
      doc.font('AppFont').fontSize(6.8).fillColor('#1e293b').text(clientPhone, cols.phone.x + 4, rowY + 9);

      // Оператор
      const opName = call.operator_name || 'Не указан';
      doc.font('AppFontBold').fontSize(6.8).fillColor('#0f172a').text(opName, cols.operator.x + 4, rowY + 9, {
        width: cols.operator.w - 6,
        ellipsis: true,
      });

      // Услуга / Мастер
      doc.font('AppFont').fontSize(6.5).fillColor('#334155').text(serviceText, cols.service.x + 4, rowY + 5, {
        width: cols.service.w - 6,
        height: 18,
        ellipsis: true,
      });

      // Статус записи
      doc.font('AppFontBold').fontSize(6.8).fillColor(statusColor).text(statusLabel, cols.status.x + 4, rowY + 9);

      // Оценка
      doc.font('AppFontBold').fontSize(7).fillColor(scoreColor).text(scoreText, cols.score.x + 4, rowY + 9);

      // Тональность
      doc.font('AppFont').fontSize(6.5).fillColor('#475569').text(toneClient, cols.tone.x + 4, rowY + 9, {
        width: cols.tone.w - 6,
        ellipsis: true,
      });

      // Спор
      doc.font('AppFontBold').fontSize(6.8).fillColor(disputeColor).text(disputeText, cols.dispute.x + 4, rowY + 9);

      // Суть / резюме
      doc.font('AppFont').fontSize(6.2).fillColor('#334155').text(summaryText, cols.summary.x + 4, rowY + 4, {
        width: cols.summary.w - 6,
        height: 20,
        ellipsis: true,
      });

      doc.y = rowY + rowHeight;
    });
  }

  // 6. Блок утверждения отчета управляющим салона
  ensureSpace(45);
  doc.moveDown(0.5);
  const signY = doc.y;
  doc.rect(margin, signY, contentWidth, 38).fillAndStroke('#f8fafc', '#e2e8f0');

  doc.font('AppFontBold').fontSize(7.5).fillColor('#334155').text(
    `УТВЕРЖДЕНИЕ СВОДНОГО РЕЕСТРА ЗВОНКОВ УПРАВЛЯЮЩИМ САЛОНА «${salonName.toUpperCase()}»`,
    margin + 12,
    signY + 6
  );
  doc.font('AppFont').fontSize(7).fillColor('#475569').text(
    'Управляющий салоном: ________________________ / ________________________       Дата подписи: «____» ________________ 202___ г.',
    margin + 12,
    signY + 20
  );
  doc.font('AppFont').fontSize(6.5).fillColor('#94a3b8').text(
    'Отчет сформирован автоматизированным модулем речевой аналитики на базе Сбер GigaChat с полным соблюдением требований 152-ФЗ РФ.',
    margin + 420,
    signY + 20,
    { width: contentWidth - 430, align: 'right' }
  );

  // 7. Нумерация страниц и футер
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    const footerY = pageHeight - margin + 10;
    doc.font('AppFont').fontSize(7).fillColor('#94a3b8');
    doc.text(
      `Салон красоты «${salonName}» • Сводный реестр звонков • ${filterTitle || 'Все звонки'} • Соответствие 152-ФЗ`,
      margin,
      footerY
    );
    doc.text(`Страница ${i + 1} из ${pages.count}`, margin, footerY, {
      align: 'right',
      width: contentWidth,
    });
  }

  return doc;
}


