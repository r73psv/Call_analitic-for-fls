import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePeriodStatsCsv } from '../csvExport.js';
import { generatePeriodStatsPdf, PeriodStatsReportData } from '../pdfReport.js';
import { CallRecord } from '../../types.js';

function createSampleReportData(): PeriodStatsReportData {
  return {
    periodTitle: 'Месяц',
    periodDates: '2026-10-01 — 2026-10-31',
    isComparative: true,
    comparePeriodTitle: 'Предыдущий период',
    compareDates: '2026-09-01 — 2026-09-30',
    currentStats: {
      totalCalls: 42,
      incomingCalls: 36,
      outgoingCalls: 6,
      completedCalls: 40,
      missedCalls: 2,
      bookedCount: 21,
      declinedCount: 8,
      consultationCount: 13,
      conversionRate: 50,
      averageScore: 8.4,
      disputeCount: 2,
      disputeRate: 5,
      avgDurationSec: 135,
    },
    previousStats: {
      totalCalls: 35,
      incomingCalls: 30,
      outgoingCalls: 5,
      completedCalls: 33,
      missedCalls: 2,
      bookedCount: 14,
      declinedCount: 10,
      consultationCount: 11,
      conversionRate: 40,
      averageScore: 7.8,
      disputeCount: 4,
      disputeRate: 11,
      avgDurationSec: 120,
    },
    operators: [
      {
        name: 'Анна',
        totalCalls: 25,
        avgScore: 8.8,
        bookedCount: 15,
        conversionRate: 60,
        disputes: 0,
        prevAvgScore: 8.1,
        prevConversionRate: 48,
      },
    ],
    hourlyPeakHours: '12:00 – 13:00',
    userRole: 'admin',
  };
}

test('generatePeriodStatsCsv strictly anonymizes PII (152-FZ) and guards against CSV formula injection', () => {
  const reportData = createSampleReportData();
  const sampleCalls: CallRecord[] = [
    {
      call_id: 'call-anon-1',
      timestamp: '2026-10-15T10:30:00.000Z',
      duration_seconds: 145,
      type: 'incoming',
      status: 'completed',
      is_answered: true,
      client_name: 'Иван Петрович Смирнов',
      client_phone: '+7 (999) 123-45-67',
      client_phone_masked: '****234567',
      operator_name: 'Анна',
      booking_status: 'согласие',
      operator_score: 9,
      summary: 'Клиент просил перезвонить на +7 (999) 123-45-67 или написать на ivan.smirnov@example.com, адрес ул. Ленина, д. 15, паспорт 4510 123456.',
      transcript: 'Клиент: Меня зовут Иван Петрович Смирнов, мой номер +7 999 123 45 67',
      operator_mistakes: ['=HYPERLINK("http://evil.example","click")'],
      recommendations: ['Уточнять время'],
      key_facts: {
        service: 'Стрижка',
        master: 'Кристина',
        is_dispute: false,
        dispute_reason: '@SUM(A1:A10)',
        tone_client: 'дружелюбный',
        tone_manager: 'вежливый',
        call_outcome: 'запись',
        promises: [],
        client_issue: 'Запись на стрижку',
      },
      model_used: 'GigaChat:Lite',
    } as unknown as CallRecord,
  ];

  const csv = generatePeriodStatsCsv(reportData, sampleCalls, 'Лик 28');

  // UTF-8 BOM + Russian semicolon layout
  assert.ok(csv.startsWith('\uFEFF'), 'CSV should start with UTF-8 BOM for Excel');
  assert.ok(csv.includes('ОБЕЗЛИЧЕННЫЙ АНАЛИТИЧЕСКИЙ ОТЧЕТ (152-ФЗ)'));
  assert.ok(csv.includes('КЛЮЧЕВЫЕ ПОКАЗАТЕЛИ ЭФФЕКТИВНОСТИ (KPI)'));
  assert.ok(csv.includes('РЕЙТИНГ И РЕЗУЛЬТАТИВНОСТЬ ОПЕРАТОРОВ'));
  assert.ok(csv.includes('ОБЕЗЛИЧЕННЫЙ РЕЕСТР ЗВОНКОВ ЗА ПЕРИОД'));

  // Strictly NO raw PII even when userRole === 'admin'
  assert.equal(csv.includes('+7 (999) 123-45-67'), false, 'Raw phone must never appear');
  assert.equal(csv.includes('9991234567'), false, 'Raw digits phone must never appear');
  assert.equal(csv.includes('Иван Петрович Смирнов'), false, 'Client full name must never appear');
  assert.equal(csv.includes('ivan.smirnov@example.com'), false, 'Client email must be stripped');
  assert.equal(csv.includes('ул. Ленина, д. 15'), false, 'Client address must be stripped');
  assert.equal(csv.includes('4510 123456'), false, 'Passport number must be stripped');
  assert.equal(csv.includes('Меня зовут'), false, 'Raw transcript must not be exported');

  // Masked phone and anonymized tokens must be present
  assert.ok(csv.includes('Клиент (****234567)'));
  assert.ok(csv.includes('[НОМЕР_ТЕЛЕФОНА]'));
  assert.ok(csv.includes('[EMAIL]'));
  assert.ok(csv.includes('[АДРЕС]'));
  assert.ok(csv.includes('[ПАСПОРТНЫЕ_ДАННЫЕ]'));

  // Formula injection cells must be neutralized with leading apostrophe
  assert.ok(csv.includes(`"'=HYPERLINK(""`), 'Leading = formula must be neutralized');
  assert.ok(csv.includes(`"'@SUM(A1:A10)"`), 'Leading @ formula must be neutralized');
});

test('generatePeriodStatsPdf streams valid PDF with anonymized calls section (152-FZ)', async () => {
  const reportData: PeriodStatsReportData = {
    ...createSampleReportData(),
    anonymizedCalls: [
      {
        call_id: 'call-anon-1',
        timestamp: '2026-10-15T10:30:00.000Z',
        duration_seconds: 145,
        type: 'incoming',
        operator_name: 'Анна',
        client_masked: '****234567',
        booking_status: 'согласие',
        service: 'Стрижка',
        operator_score: 9,
        is_dispute: false,
      },
    ],
  };

  const doc = generatePeriodStatsPdf(reportData, 'Лик 28');
  const chunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve());
    doc.on('error', reject);
    doc.end();
  });

  const pdfBuffer = Buffer.concat(chunks);
  assert.ok(pdfBuffer.length > 1000, 'PDF output should be non-empty');
  assert.equal(pdfBuffer.subarray(0, 5).toString('ascii'), '%PDF-');
});
