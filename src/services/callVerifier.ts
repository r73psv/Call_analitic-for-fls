/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import axios from 'axios';
import {
  AnalysisResult,
  CallEvaluationCriterion,
  CallVerificationReport,
  CriteriaVerificationItem,
  StructuredCallSummary,
  VerifierField,
  VerifierVerdict,
} from '../types.js';
import { calculateOverallScore, reconcileMistakesWithCriteria } from './evaluationUtils.js';

export const VERIFIER_PROMPT = `Ты — строгий проверяющий фактчекер. Тебе даны стенограмма телефонного звонка и черновик резюме звонка.

Задача: проверить КАЖДОЕ утверждение резюме по стенограмме.

Правила:
1. Утверждение подтверждено, только если в стенограмме есть фрагмент, дословно или почти дословно его подтверждающий.
2. Для каждого подтверждённого поля приведи точную цитату из стенограммы (не выдумывай и не «исправляй» цитату).
3. Если утверждение противоречит стенограмме — пометь его как "ПРОТИВОРЕЧИТ" и приведи цитату, которая его опровергает.
4. Если подтверждения в стенограмме нет — пометь как "НЕ ПОДТВЕРЖДЕНО". Не угадывай и не восполняй пробелы.
5. Имена мастеров, цены, даты и время проверяй особенно строго: сравнивай посимвольно.
6. Метки ролей (Клиент/Менеджер) в стенограмме могут быть неточными — опирайся на смысл реплик, а не на метку.
7. Поля booking_status и call_outcome — это служебные метки словаря («согласие», «запись», «отказ», «консультация», «перезвон», «отмена»), НЕ проверяй их на дословное вхождение слова «согласие»/«запись» в текст: подтверждай их цитатой из стенограммы о записи, дате/времени или закрытии на визит.
8. Синтез-поля booking_done, booking_status_text и short_summary — это сводные формулировки, НЕ проверяй их на дословное вхождение всей фразы целиком в стенограмму: проверяй подтверждённость их составных фактов (booking_markers, даты/времени, мастера). Если составные факты подтверждены стенограммой — ставь синтез-полю verdict: "confirmed" и указывай подтверждающую цитату одного из составных фактов.

Верни строго JSON без markdown:
{
  "fields": [
    {
      "field": "название поля резюме",
      "draft_value": "значение из черновика",
      "verdict": "confirmed" | "contradicts" | "unconfirmed",
      "quote": "цитата из стенограммы или null",
      "corrected_value": "исправленное значение или null"
    }
  ],
  "summary_verdict": "ок" | "есть противоречия"
}`;

export const CRITERIA_VERIFIER_PROMPT = `Ты — строгий аудитор-фактчекер оценок качества звонка. Тебе даны стенограмма телефонного звонка и список применимых критериев аудита с их обоснованиями.

Задача: для КАЖДОГО критерия проверить его обоснование по стенограмме и привести точную дословную цитату-обоснование из стенограммы.

Правила:
1. Если в стенограмме есть дословный фрагмент, подтверждающий оценку и обоснование критерия — verdict: "confirmed", quote: точная цитата из стенограммы (без исправлений).
2. Если оценка или обоснование противоречит стенограмме — verdict: "contradicts", quote: опровергающая цитата из стенограммы (или null).
3. Если обоснование не подтверждается стенограммой и цитату привести нельзя — verdict: "unconfirmed", quote: null.
4. Метки ролей (Клиент/Менеджер) могут быть неточными — опирайся на смысл реплик.
5. Для критерия 10 (communication — качество коммуникации и завершение разговора): утверждение о качестве концовки обязательно должно подтверждаться цитатой последней реплики менеджера или клиента из стенограммы.

Верни строго JSON без markdown:
{
  "criteria": [
    {
      "id": "id критерия",
      "verdict": "confirmed" | "contradicts" | "unconfirmed",
      "quote": "точная цитата из стенограммы или null"
    }
  ]
}`;

const ax = axios.create({ timeout: 60000 }); // тайм-аут обязателен

export interface VerifierCallOptions {
  apiUrl: string;
  token: string;
  model: string;
}

export const UNCONFIRMED_VALUE_PLACEHOLDER = 'не подтверждено стенограммой';

const ABSENCE_VALUE_REGEX =
  /^(?:не\s+озвучено|не\s+указан[аоы]?|не\s+выбран[ао]?|не\s+озвучивал(?:ась|ся|ось|ись)|не\s+предложен[аоы]?|не\s+требуется|не\s+применимо|отсутствует|нет|null|—|-)$/i;

export function isAbsenceValue(val: unknown): boolean {
  if (val === null || val === undefined) return true;
  const s = String(val).trim();
  if (!s) return true;
  return ABSENCE_VALUE_REGEX.test(s);
}

const DICTIONARY_STATUS_FIELDS = new Set(['booking_status', 'call_outcome']);
export const SYNTHESIS_FIELDS = new Set(['booking_done', 'booking_status_text', 'short_summary']);
const CONSTITUENT_FACT_FIELDS = new Set([
  'booking_markers',
  'date_time_offered',
  'offered_date_time',
  'date',
  'time',
  'offered_master',
  'master',
]);

function normalizeWhitespaceLower(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»„“”"''`‚‘’]/g, '')
    .replace(/[\u2010-\u2015\u2212\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForQuoteMatch(s: string): string {
  return s
    // Удаляем метки ролей как в начале строк, так и внутри склеенных реплик ASR
    .replace(/(?:^|[\n\r.!?]\s*|\s+)(?:менеджер|клиент|оператор|администратор|автоинформатор|сотрудник|гость)\s*:\s*/gi, ' ')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»„“”"''`‚‘’]/g, '')
    .replace(/[\u2010-\u2015\u2212\-]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Мягкий фолбэк (частичное совпадение >= 70% длины цитаты, длина цитаты >= 6 слов):
 * находит длинную цитату даже при склейке ролей ASR, лишних междометиях или искажении 1–2 слов,
 * но не пропускает короткие шаблонные фразы из few-shot примеров.
 */
export function hasSoftSubstringCoverage(
  normTranscript: string,
  normQuote: string,
  minRatio: number = 0.7,
  minWords: number = 6
): boolean {
  if (!normTranscript || !normQuote || normQuote.length < 4) return false;

  const qTokens = normQuote.split(' ').filter(Boolean);
  const tTokens = normTranscript.split(' ').filter(Boolean);
  if (qTokens.length < minWords || tTokens.length < 2) return false;

  // 1. Проверка непрерывного подстрочного совпадения >= 70% длины цитаты (скользящее окно)
  const targetLen = Math.max(4, Math.ceil(normQuote.length * minRatio));
  if (targetLen <= normQuote.length) {
    const maxStart = normQuote.length - targetLen;
    // Для скорости шагаем по 1 символу при коротких цитатах и по 2 при очень длинных
    const step = maxStart > 80 ? 2 : 1;
    for (let start = 0; start <= maxStart; start += step) {
      const slice = normQuote.slice(start, start + targetLen).trim();
      if (slice.length >= Math.max(4, targetLen - 1) && normTranscript.includes(slice)) {
        return true;
      }
    }
    // Проверяем хвост (если шаг > 1 пропустил последний индекс)
    if (step > 1) {
      const tailSlice = normQuote.slice(maxStart, maxStart + targetLen).trim();
      if (tailSlice.length >= Math.max(4, targetLen - 1) && normTranscript.includes(tailSlice)) {
        return true;
      }
    }
  }

  // 2. Пословное упорядоченное совпадение в локальном окне стенограммы (>= 70% символьной длины слов цитаты)
  // Устойчиво к вставке ASR-слов или склейке соседних реплик в середине цитаты
  const totalQuoteChars = qTokens.reduce((acc, w) => acc + w.length, 0);
  if (totalQuoteChars < 4) return false;

  const tokensRoughMatch = (a: string, b: string): boolean => {
    if (a === b) return true;
    // Допуск на окончание слова/искажение 1–2 букв ASR для длинных слов (>= 5 букв)
    if (a.length >= 5 && b.length >= 5) {
      const prefixLen = Math.min(a.length, b.length) - 1;
      if (prefixLen >= 4 && a.slice(0, prefixLen) === b.slice(0, prefixLen)) return true;
    }
    return false;
  };

  const maxWindowTokens = Math.min(tTokens.length, Math.max(qTokens.length * 2 + 4, qTokens.length + 6));

  for (let startIdx = 0; startIdx < tTokens.length; startIdx++) {
    // Начинаем окно только там, где совпадает один из первых токенов цитаты
    const matchesInitial =
      tokensRoughMatch(tTokens[startIdx], qTokens[0]) ||
      (qTokens.length >= 3 && tokensRoughMatch(tTokens[startIdx], qTokens[1]));
    if (!matchesInitial) continue;

    let qIdx = tokensRoughMatch(tTokens[startIdx], qTokens[0]) ? 0 : 1;
    let matchedChars = 0;
    const windowEnd = Math.min(tTokens.length, startIdx + maxWindowTokens);

    for (let tIdx = startIdx; tIdx < windowEnd && qIdx < qTokens.length; tIdx++) {
      if (tokensRoughMatch(tTokens[tIdx], qTokens[qIdx])) {
        matchedChars += qTokens[qIdx].length;
        qIdx++;
      } else {
        // Проверяем, не выпало ли 1 слово из цитаты (lookahead на 1–2 токена цитаты)
        for (let skip = 1; skip <= 2 && qIdx + skip < qTokens.length; skip++) {
          if (tokensRoughMatch(tTokens[tIdx], qTokens[qIdx + skip])) {
            matchedChars += qTokens[qIdx + skip].length;
            qIdx = qIdx + skip + 1;
            break;
          }
        }
      }
    }

    if (matchedChars / totalQuoteChars >= minRatio) {
      return true;
    }
  }

  return false;
}

/**
 * Фолбэк токенизированного вхождения слов цитаты в стенограмму:
 * разбивает цитату и стенограмму на слова и проверяет долю слов цитаты,
 * входящих подряд (или в плотном локальном окне при склейке ролей ASR);
 * если доля >= 70% и длина цитаты >= 4 слов — считает цитату найденной.
 */
export function hasSequentialWordCoverage(
  normTranscript: string,
  normQuote: string,
  minRatio: number = 0.7,
  minWords: number = 4
): boolean {
  if (!normTranscript || !normQuote) return false;
  const quoteWords = normQuote.split(' ').filter(Boolean);
  const transcriptWords = normTranscript.split(' ').filter(Boolean);
  if (quoteWords.length < minWords || transcriptWords.length < minWords) return false;

  // 1. Максимальная непрерывная серия подряд идущих слов цитаты в стенограмме
  let maxConsecutiveMatch = 0;
  for (let tStart = 0; tStart < transcriptWords.length; tStart++) {
    for (let qStart = 0; qStart < quoteWords.length; qStart++) {
      if (transcriptWords[tStart] !== quoteWords[qStart]) continue;
      let run = 0;
      while (
        tStart + run < transcriptWords.length &&
        qStart + run < quoteWords.length &&
        transcriptWords[tStart + run] === quoteWords[qStart + run]
      ) {
        run++;
      }
      if (run > maxConsecutiveMatch) {
        maxConsecutiveMatch = run;
      }
    }
  }
  if (maxConsecutiveMatch / quoteWords.length >= minRatio) {
    return true;
  }

  // 2. Упорядоченное вхождение слов цитаты в локальном окне (допуск 1-2 вставных слова при склейке ролей ASR)
  const maxGap = 2;
  for (let tStart = 0; tStart < transcriptWords.length; tStart++) {
    for (let qStart = 0; qStart <= 1 && qStart < quoteWords.length; qStart++) {
      if (transcriptWords[tStart] !== quoteWords[qStart]) continue;
      let matchedWords = 1;
      let lastTIdx = tStart;
      let qIdx = qStart + 1;

      while (qIdx < quoteWords.length) {
        let foundIdx = -1;
        const limit = Math.min(transcriptWords.length - 1, lastTIdx + 1 + maxGap);
        for (let scan = lastTIdx + 1; scan <= limit; scan++) {
          if (transcriptWords[scan] === quoteWords[qIdx]) {
            foundIdx = scan;
            break;
          }
        }
        if (foundIdx !== -1) {
          matchedWords++;
          lastTIdx = foundIdx;
        }
        qIdx++;
      }

      if (matchedWords / quoteWords.length >= minRatio) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Программная страховка от галлюцинированных цитат верификатора:
 * нормализует регистр, ё/е, виды кавычек, пунктуацию, дефисы и метки ролей ASR,
 * а при неудаче строгого и relaxed сравнения применяет токенизированный фолбэк (>= 70%, >= 4 слов)
 * и мягкий посимвольный фолбэк.
 */
export function isQuotePresentInTranscript(transcript: string, quote: string | null | undefined): boolean {
  if (!quote || typeof quote !== 'string') return false;
  const qRaw = quote.trim();
  if (qRaw.length < 2) return false;

  // Убираем внешние кавычки («...» / "..." / '...') если модель обернула цитату
  const unwrapped = qRaw.replace(/^[«"'„“”`‚‘’]+|[»"'„“”`‚‘’]+$/g, '').trim();
  if (unwrapped.length < 2) return false;

  // Если модель склеила несколько отрывков через "..." / "…" — проверяем каждую непустую часть
  const parts = unwrapped
    .split(/\s*(?:\.\.\.|…)\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);

  if (parts.length === 0) return false;

  const normTranscriptStrict = normalizeWhitespaceLower(transcript);
  const normTranscriptRelaxed = normalizeForQuoteMatch(transcript);

  return parts.every((part) => {
    const strictPart = normalizeWhitespaceLower(part);
    if (strictPart && normTranscriptStrict.includes(strictPart)) {
      return true;
    }
    const relaxedPart = normalizeForQuoteMatch(part);
    if (relaxedPart.length >= 2 && normTranscriptRelaxed.includes(relaxedPart)) {
      return true;
    }
    // Токенизированный фолбэк: доля слов цитаты подряд в стенограмме >= 70% при длине цитаты >= 4 слов
    if (hasSequentialWordCoverage(normTranscriptRelaxed, relaxedPart, 0.7, 4)) {
      return true;
    }
    // Мягкий фолбэк: частичное совпадение >= 70% длины цитаты при длине >= 6 слов (защита от склейки ролей и погрешностей ASR)
    if (relaxedPart.length >= 4 && hasSoftSubstringCoverage(normTranscriptRelaxed, relaxedPart, 0.7, 6)) {
      return true;
    }
    return false;
  });
}

export function normalizeVerdict(raw: unknown): VerifierVerdict {
  const s = String(raw || '').toLowerCase().trim();
  if (
    s === 'contradicts' ||
    s.includes('противореч') ||
    s === 'conflict' ||
    s === 'false'
  ) {
    return 'contradicts';
  }
  if (
    s === 'unconfirmed' ||
    s.includes('не подтвержд') ||
    s.includes('неподтвержд') ||
    s === 'unknown'
  ) {
    return 'unconfirmed';
  }
  if (s === 'confirmed' || s.includes('подтвержд') || s === 'ok' || s === 'true') {
    return 'confirmed';
  }
  return 'unconfirmed';
}

function stripJsonMarkdown(raw: string): string {
  let clean = (raw || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (match) {
    clean = match[0];
  }
  return clean;
}

/**
 * Формирует компактный черновик ключевых утверждений резюме для верификатора,
 * не перегружая его внимание таблицей из 10 критериев (она проверяется отдельным проходом).
 */
export function buildConciseDraftForVerifier(draft: AnalysisResult): Record<string, any> {
  const struct: Partial<StructuredCallSummary> =
    draft.structured_summary || draft.key_facts?.structured_summary || {};
  const kf = draft.key_facts || ({} as AnalysisResult['key_facts']);

  const bookingDoneValue =
    struct.booking_status_text ?? kf.is_booked_text ?? 'не озвучено';
  const bookingMarkersValue = Array.isArray((draft as any).booking_markers)
    ? (draft as any).booking_markers
    : Array.isArray((kf as any).booking_markers)
    ? (kf as any).booking_markers
    : Array.isArray(kf.booking_markers_quotes) && kf.booking_markers_quotes.length > 0
    ? kf.booking_markers_quotes
    : [];

  // Исключаем booking_status и call_outcome (метки словаря, не текст стенограммы):
  // статус записи подтверждается через booking_done и booking_markers.
  return {
    call_purpose: struct.call_purpose ?? kf.call_purpose ?? kf.client_issue ?? 'не озвучено',
    requested_service: struct.requested_service ?? kf.requested_service ?? kf.service ?? 'не озвучено',
    offered_master: struct.offered_master ?? kf.offered_master ?? kf.master ?? 'не озвучено',
    offered_price: struct.offered_price ?? kf.offered_price ?? 'не озвучено',
    offered_date_time:
      struct.offered_date_time ??
      kf.offered_date_time ??
      ([kf.date, kf.time].filter(Boolean).join(' ') || 'не озвучено'),
    booking_done: bookingDoneValue,
    booking_markers: bookingMarkersValue,
    booking_status_text: bookingDoneValue,
    short_summary: draft.transcript_summary ?? 'не озвучено',
    unbooked_reason: struct.unbooked_reason ?? kf.unbooked_reason ?? 'не озвучено',
    service: kf.service ?? 'не озвучено',
    date: kf.date ?? 'не озвучено',
    time: kf.time ?? 'не озвучено',
    master: kf.master ?? 'не озвучено',
  };
}

async function callVerifierModel(
  systemPrompt: string,
  userContent: string,
  opts: VerifierCallOptions,
  maxTokens: number = 4000
): Promise<string> {
  const response = await ax.post(
    opts.apiUrl,
    {
      model: opts.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0, // верификатору не нужна креативность
      max_tokens: maxTokens,
    },
    {
      headers: {
        Authorization: `Bearer ${opts.token}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    }
  );

  const raw = response.data?.choices?.[0]?.message?.content;
  if (!raw || typeof raw !== 'string') {
    throw new Error('Верификатор вернул пустой ответ');
  }
  return raw;
}

function parseSummaryVerifierFields(rawContent: string): {
  fields: VerifierField[];
  summary_verdict: string;
} {
  const clean = stripJsonMarkdown(rawContent);
  const parsed = JSON.parse(clean);
  const rawFields: any[] = Array.isArray(parsed?.fields) ? parsed.fields : [];
  const fields: VerifierField[] = rawFields
    .map((f: any) => {
      if (!f || !f.field) return null;
      const rawVerdict = normalizeVerdict(f.verdict);
      const quote = f.quote && String(f.quote).trim() && String(f.quote).toLowerCase() !== 'null'
        ? String(f.quote).trim()
        : null;
      // Противоречие без опровергающей цитаты — не доказанное противоречие: понижаем до unconfirmed
      const verdict: VerifierVerdict =
        rawVerdict === 'contradicts' && !quote ? 'unconfirmed' : rawVerdict;
      const corrected =
        f.corrected_value && String(f.corrected_value).trim() && String(f.corrected_value).toLowerCase() !== 'null'
          ? String(f.corrected_value).trim()
          : null;
      return {
        field: String(f.field).trim(),
        draft_value: f.draft_value !== undefined && f.draft_value !== null ? String(f.draft_value) : '',
        verdict,
        quote,
        corrected_value: corrected,
      } satisfies VerifierField;
    })
    .filter((f): f is VerifierField => f !== null);

  return {
    fields,
    summary_verdict: String(parsed?.summary_verdict || (fields.some((f) => f.verdict !== 'confirmed') ? 'есть противоречия' : 'ок')),
  };
}

/**
 * Второй независимый проход верификации резюме по стенограмме (один запрос к модели).
 * Программно проверяет каждую цитату на вхождение в стенограмму:
 * если цитата отсутствует — немедленно помечает поле как unconfirmed без повторного вызова API.
 */
export async function verifySummary(
  transcript: string,
  draftSummary: Record<string, any>,
  opts: VerifierCallOptions
): Promise<{
  summary: Record<string, any>;
  report: VerifierField[];
  summary_verdict: string;
  hallucinatedQuotesCaught: number;
}> {
  const userContent = `СТЕНОГРАММА:\n${transcript}\n\nЧЕРНОВИК РЕЗЮМЕ (JSON):\n${JSON.stringify(draftSummary, null, 2)}`;

  const parsed = parseSummaryVerifierFields(
    await callVerifierModel(VERIFIER_PROMPT, userContent, opts, 4000)
  );

  let hallucinatedQuotesCaught = 0;

  // Программная проверка цитат БЕЗ повторного запроса к LLM + детекция suspected false positive
  // Поля booking_status и call_outcome (словарные метки) и синтез-поля (booking_done, booking_status_text, short_summary)
  // не требуют дословного вхождения всей синтетической формулировки — проверяются через составные факты.
  const preliminaryFields: VerifierField[] = parsed.fields.map((f) => {
    const fieldName = f.field.trim();
    if (DICTIONARY_STATUS_FIELDS.has(fieldName) || SYNTHESIS_FIELDS.has(fieldName)) {
      if (f.quote && isQuotePresentInTranscript(transcript, f.quote)) {
        return { ...f, verdict: f.verdict === 'contradicts' ? 'contradicts' : 'confirmed' };
      }
      // Окончательный статус определим ниже по подтверждённости составных фактов (booking_markers, дата/время, мастер)
      return {
        ...f,
        quote: f.quote && isQuotePresentInTranscript(transcript, f.quote) ? f.quote : null,
      };
    }

    if (f.quote && !isQuotePresentInTranscript(transcript, f.quote)) {
      hallucinatedQuotesCaught++;
      console.warn(
        `[Verifier] Поле "${f.field}": цитата не найдена в стенограмме ("${f.quote.slice(0, 60)}"). Помечено unconfirmed без ретрая.`
      );
      return {
        ...f,
        verdict: 'unconfirmed',
        quote: null,
        rejected_quote: f.quote,
        hallucinated_quote: true,
      };
    }
    if (f.verdict === 'unconfirmed' && !isAbsenceValue(f.draft_value)) {
      const candidateMatch =
        f.quote && isQuotePresentInTranscript(transcript, f.quote)
          ? f.quote
          : isQuotePresentInTranscript(transcript, f.draft_value)
          ? f.draft_value
          : null;
      if (candidateMatch) {
        console.warn(
          `[GigaChat Verifier] suspected false positive: поле="${f.field}", вердикт="unconfirmed" → повышен до confirmed, цитата найдена дословно в стенограмме: "${candidateMatch.slice(0, 120)}"`
        );
        return {
          ...f,
          verdict: 'confirmed',
          quote: candidateMatch,
          hallucinated_quote: false,
          rejected_quote: null,
          suspected_false_positive: true,
        };
      }
    }
    if (f.verdict === 'confirmed' && !f.quote && !isAbsenceValue(f.draft_value)) {
      return {
        ...f,
        verdict: 'unconfirmed',
      };
    }
    return f;
  });

  // Подтверждение словарных полей (booking_status / call_outcome) и синтез-полей (booking_done / booking_status_text / short_summary)
  // через подтверждённые составные факты: booking_markers, дата/время (date_time_offered / offered_date_time / date / time), мастер (offered_master / master)
  const constituentSupportQuote = (() => {
    const candidateQuotes: string[] = [];
    for (const pf of preliminaryFields) {
      const fn = pf.field.trim();
      if (pf.verdict === 'confirmed' && pf.quote && CONSTITUENT_FACT_FIELDS.has(fn)) {
        candidateQuotes.push(pf.quote);
      }
    }
    if (Array.isArray(draftSummary?.booking_markers)) {
      for (const bm of draftSummary.booking_markers) {
        const q = typeof bm === 'string' ? bm : bm?.quote || bm?.value;
        if (q) candidateQuotes.push(String(q));
      }
    }
    if (draftSummary?.date_time_offered_quote) {
      candidateQuotes.push(String(draftSummary.date_time_offered_quote));
    }
    return candidateQuotes.find((q) => isQuotePresentInTranscript(transcript, q)) || null;
  })();

  const hasContradictingConstituentFact = preliminaryFields.some(
    (pf) => CONSTITUENT_FACT_FIELDS.has(pf.field.trim()) && pf.verdict === 'contradicts'
  );

  const statusSupportQuote = constituentSupportQuote;

  const verifiedFields: VerifierField[] = preliminaryFields.map((f) => {
    const fn = f.field.trim();
    if (DICTIONARY_STATUS_FIELDS.has(fn) && f.verdict !== 'contradicts' && statusSupportQuote) {
      return {
        ...f,
        verdict: 'confirmed',
        quote: f.quote || statusSupportQuote,
        hallucinated_quote: false,
      };
    }
    if (
      SYNTHESIS_FIELDS.has(fn) &&
      f.verdict !== 'contradicts' &&
      !hasContradictingConstituentFact &&
      constituentSupportQuote
    ) {
      return {
        ...f,
        verdict: 'confirmed',
        quote: f.quote || constituentSupportQuote,
        rejected_quote: null,
        hallucinated_quote: false,
      };
    }
    return f;
  });

  const anyNotOk = verifiedFields.some(
    (f) =>
      f.verdict !== 'confirmed' &&
      !isAbsenceValue(f.draft_value) &&
      !(DICTIONARY_STATUS_FIELDS.has(f.field.trim()) && statusSupportQuote) &&
      !(SYNTHESIS_FIELDS.has(f.field.trim()) && !hasContradictingConstituentFact && constituentSupportQuote)
  );
  return {
    summary: draftSummary,
    report: verifiedFields,
    summary_verdict: anyNotOk ? 'есть противоречия' : parsed.summary_verdict,
    hallucinatedQuotesCaught,
  };
}

export function parseCriteriaVerification(rawContent: string): CriteriaVerificationItem[] {
  const clean = stripJsonMarkdown(rawContent);
  const parsed = JSON.parse(clean);
  const list: any[] = Array.isArray(parsed?.criteria) ? parsed.criteria : [];
  return list
    .map((c: any) => {
      if (!c || !c.id) return null;
      const rawVerdict = normalizeVerdict(c.verdict);
      const quote = c.quote && String(c.quote).trim() && String(c.quote).toLowerCase() !== 'null'
        ? String(c.quote).trim()
        : null;
      // Противоречие без опровергающей цитаты — не доказанное противоречие: понижаем до unconfirmed
      const verdict: VerifierVerdict =
        rawVerdict === 'contradicts' && !quote ? 'unconfirmed' : rawVerdict;
      return {
        id: String(c.id).trim(),
        verdict,
        quote,
      } satisfies CriteriaVerificationItem;
    })
    .filter((c): c is CriteriaVerificationItem => c !== null);
}

/**
 * Отдельная короткая проверка применимых критериев аудита (10 критериев):
 * «для каждого критерия приведи цитату-обоснование; обоснования без цитаты — понизь до 0 и пометь».
 */
export async function verifyCriteriaWithTranscript(
  transcript: string,
  criteria: CallEvaluationCriterion[],
  opts: VerifierCallOptions
): Promise<{
  items: CriteriaVerificationItem[];
  hallucinatedQuotesCaught: number;
}> {
  const applicable = criteria.filter((c) => c.is_applicable !== false && typeof c.score === 'number');
  if (applicable.length === 0) {
    return { items: [], hallucinatedQuotesCaught: 0 };
  }

  const conciseCriteria = applicable.map((c) => ({
    id: c.id,
    name: c.name,
    score: c.score,
    explanation: c.explanation,
  }));

  const userContent = `СТЕНОГРАММА:\n${transcript}\n\nПРИМЕНИМЫЕ КРИТЕРИИ АУДИТА (JSON):\n${JSON.stringify(conciseCriteria, null, 2)}`;

  const items = parseCriteriaVerification(
    await callVerifierModel(CRITERIA_VERIFIER_PROMPT, userContent, opts, 2000)
  );

  let hallucinatedQuotesCaught = 0;
  const origCriteriaById = new Map<string, CallEvaluationCriterion>();
  applicable.forEach((c) => origCriteriaById.set(c.id, c));

  const sanitized = items.map((it) => {
    if (it.quote && !isQuotePresentInTranscript(transcript, it.quote)) {
      hallucinatedQuotesCaught++;
      return {
        ...it,
        verdict: 'unconfirmed' as VerifierVerdict,
        quote: null,
        rejected_quote: it.quote,
        hallucinated_quote: true,
      };
    }
    if (it.verdict === 'unconfirmed') {
      const origQuote = origCriteriaById.get(it.id)?.evidence_quote || null;
      const candidateMatch =
        it.quote && isQuotePresentInTranscript(transcript, it.quote)
          ? it.quote
          : origQuote && isQuotePresentInTranscript(transcript, origQuote)
          ? origQuote
          : null;
      if (candidateMatch) {
        console.warn(
          `[GigaChat Verifier] suspected false positive: критерий="${it.id}", вердикт="unconfirmed" → повышен до confirmed, цитата найдена дословно в стенограмме: "${candidateMatch.slice(0, 120)}"`
        );
        return {
          ...it,
          verdict: 'confirmed' as VerifierVerdict,
          quote: candidateMatch,
          hallucinated_quote: false,
          rejected_quote: null,
          suspected_false_positive: true,
        };
      }
    }
    if (it.verdict === 'confirmed' && !it.quote) {
      return {
        ...it,
        verdict: 'unconfirmed' as VerifierVerdict,
      };
    }
    return it;
  });

  return { items: sanitized, hallucinatedQuotesCaught };
}

/**
 * Применяет вердикты верификатора к черновику (чистая управляемая функция):
 * - confirmed -> оставляем как есть;
 * - contradicts с corrected_value -> заменяем на исправленное значение;
 * - unconfirmed (или contradicts без исправления) -> помечаем как 'не подтверждено стенограммой' (если черновик утверждал положительный факт);
 * - для критериев аудита без валидной цитаты -> понижаем score до 0 и помечаем как требующие проверки.
 */
export function applyVerdicts(
  draft: AnalysisResult,
  report: VerifierField[],
  criteriaReport: CriteriaVerificationItem[] = [],
  hallucinatedQuotesCaught: number = 0,
  transcriptForCheck?: string
): AnalysisResult {
  const struct: StructuredCallSummary = {
    ...(draft.structured_summary || draft.key_facts?.structured_summary || {
      call_purpose: 'не озвучено',
      requested_service: 'не озвучено',
      offered_master: 'не озвучено',
      offered_price: 'не озвучено',
      offered_date_time: 'не озвучено',
      booking_status_text: draft.booking_status || 'не озвучено',
      unbooked_reason: 'не озвучено',
      manager_next_steps: [],
    }),
  };

  const keyFacts = { ...(draft.key_facts || {}) } as AnalysisResult['key_facts'];
  const effectiveTranscript = transcriptForCheck || draft.formatted_transcript || '';

  // Сбор подтверждающих цитат из составных фактов (booking_markers, дата/время, мастер) и критерия 9 (closing):
  // используется как для словарных полей (booking_status, call_outcome), так и для синтез-полей (booking_done, booking_status_text, short_summary).
  const sourceCriteriaForStatus =
    draft.criteria_scores ||
    draft.evaluation?.criteria ||
    draft.key_facts?.criteria_scores ||
    [];
  const statusSupportCandidates: string[] = [];
  const constituentSupportCandidates: string[] = [];
  if (Array.isArray(keyFacts.booking_markers_quotes)) {
    const bmQuotes = keyFacts.booking_markers_quotes.filter(Boolean);
    statusSupportCandidates.push(...bmQuotes);
    constituentSupportCandidates.push(...bmQuotes);
  }
  if (keyFacts.date_time_offered_quote) {
    statusSupportCandidates.push(keyFacts.date_time_offered_quote);
    constituentSupportCandidates.push(keyFacts.date_time_offered_quote);
  }
  for (const rf of report) {
    const fn = rf.field.trim();
    if (rf.verdict === 'confirmed' && rf.quote) {
      if (CONSTITUENT_FACT_FIELDS.has(fn)) {
        constituentSupportCandidates.push(rf.quote);
      }
      if (
        ['booking_done', 'booking_markers', 'booking_status_text', 'date_time_offered', 'offered_date_time', 'date', 'time'].includes(fn)
      ) {
        statusSupportCandidates.push(rf.quote);
      }
    }
  }
  const crit9Ver = criteriaReport.find((c) => c.id === 'closing');
  if (crit9Ver?.quote) {
    statusSupportCandidates.push(crit9Ver.quote);
  }
  const crit9Pass1 = sourceCriteriaForStatus.find((c) => c.id === 'closing');
  if (crit9Pass1?.evidence_quote) {
    statusSupportCandidates.push(crit9Pass1.evidence_quote);
  }

  const verifiedConstituentQuote = constituentSupportCandidates.find((q) =>
    effectiveTranscript ? isQuotePresentInTranscript(effectiveTranscript, q) : Boolean(q && q.trim().length >= 2)
  ) || null;
  const verifiedStatusQuote = statusSupportCandidates.find((q) =>
    effectiveTranscript ? isQuotePresentInTranscript(effectiveTranscript, q) : Boolean(q && q.trim().length >= 2)
  ) || verifiedConstituentQuote;

  const hasContradictingConstituent = report.some(
    (rf) => CONSTITUENT_FACT_FIELDS.has(rf.field.trim()) && rf.verdict === 'contradicts' && Boolean(rf.quote && String(rf.quote).trim())
  );

  // Нормализуем отчёт:
  // - contradicts без опровергающей цитаты понижаем до unconfirmed;
  // - booking_status и call_outcome не требуют дословной цитаты слова «согласие»/«запись»;
  // - синтез-поля booking_done, booking_status_text, short_summary проверяются по подтверждённости составных фактов
  //   (booking_markers, даты/времени, мастера) — если составные факты confirmed, синтез-поле confirmed.
  const normalizedReport: VerifierField[] = report.map((item) => {
    const hasFieldQuote = Boolean(item.quote && String(item.quote).trim());
    let normalizedItem: VerifierField =
      item.verdict === 'contradicts' && !hasFieldQuote
        ? { ...item, verdict: 'unconfirmed', quote: null }
        : item;

    const fn = normalizedItem.field.trim();

    if (SYNTHESIS_FIELDS.has(fn)) {
      if (normalizedItem.verdict !== 'contradicts' && !hasContradictingConstituent && verifiedConstituentQuote) {
        return {
          ...normalizedItem,
          verdict: 'confirmed',
          quote: normalizedItem.quote || verifiedConstituentQuote,
          rejected_quote: null,
          hallucinated_quote: false,
        };
      }
      return normalizedItem;
    }

    if (
      normalizedItem.verdict === 'unconfirmed' &&
      !DICTIONARY_STATUS_FIELDS.has(fn) &&
      !isAbsenceValue(normalizedItem.draft_value) &&
      effectiveTranscript
    ) {
      const fpQuote =
        normalizedItem.quote && isQuotePresentInTranscript(effectiveTranscript, normalizedItem.quote)
          ? normalizedItem.quote
          : isQuotePresentInTranscript(effectiveTranscript, normalizedItem.draft_value)
          ? normalizedItem.draft_value
          : null;
      if (fpQuote) {
        normalizedItem = {
          ...normalizedItem,
          verdict: 'confirmed',
          quote: fpQuote,
          rejected_quote: null,
          hallucinated_quote: false,
          suspected_false_positive: true,
        };
      }
    }

    if (DICTIONARY_STATUS_FIELDS.has(fn)) {
      if (normalizedItem.verdict !== 'contradicts' && verifiedStatusQuote) {
        return {
          ...normalizedItem,
          verdict: 'confirmed',
          quote: normalizedItem.quote || verifiedStatusQuote,
          rejected_quote: null,
          hallucinated_quote: false,
        };
      }
      // Если verdict был unconfirmed (не противоречит) — не привязываем к дословному значению словаря
      if (normalizedItem.verdict === 'unconfirmed') {
        return {
          ...normalizedItem,
          quote: null,
        };
      }
    }
    return normalizedItem;
  });

  let bookingStatus = draft.booking_status;
  const fieldFlags: string[] = [];
  let rejectedClaimsCount = 0;
  const verdictByField = new Map<string, VerifierField>();
  normalizedReport.forEach((item) => verdictByField.set(item.field.trim(), item));

  for (const f of normalizedReport) {
    const fieldName = f.field.trim();
    const draftAlreadyNegative = isAbsenceValue(f.draft_value);

    if (f.verdict === 'confirmed') {
      continue;
    }

    // Если черновик уже честно написал «не указана / не выбран / не озвучено», не перетираем на тревожную заглушку
    if (f.verdict === 'unconfirmed' && draftAlreadyNegative) {
      continue;
    }

    // Словарные поля booking_status / call_outcome при наличии подтверждающих цитат уже стали confirmed выше;
    // если подтверждающей цитаты нет и вердикт unconfirmed — не выставляем ложный флаг «не найдена цитата для "согласие"».
    if (DICTIONARY_STATUS_FIELDS.has(fieldName) && f.verdict === 'unconfirmed') {
      continue;
    }

    const nextValue =
      f.verdict === 'contradicts' && f.corrected_value
        ? f.corrected_value
        : UNCONFIRMED_VALUE_PLACEHOLDER;

    fieldFlags.push(fieldName);
    rejectedClaimsCount++;

    // Помечаем отклонённую/неподтверждённую цитату, чтобы она явно отражалась в отчёте и счётчике
    if (f.verdict === 'unconfirmed' || f.verdict === 'contradicts') {
      if (f.quote && !f.rejected_quote && f.verdict === 'unconfirmed') {
        f.rejected_quote = f.quote;
        f.quote = null;
      }
    }

    switch (fieldName) {
      case 'call_purpose':
        struct.call_purpose = nextValue;
        keyFacts.call_purpose = nextValue;
        break;
      case 'requested_service':
        struct.requested_service = nextValue;
        keyFacts.requested_service = nextValue;
        break;
      case 'service':
        keyFacts.service = nextValue === UNCONFIRMED_VALUE_PLACEHOLDER ? null : nextValue;
        if (verdictByField.get('requested_service')?.verdict !== 'confirmed') {
          struct.requested_service = nextValue;
          keyFacts.requested_service = nextValue;
        }
        break;
      case 'offered_master':
        struct.offered_master = nextValue;
        keyFacts.offered_master = nextValue;
        keyFacts.master = nextValue;
        break;
      case 'master':
        keyFacts.master = nextValue === UNCONFIRMED_VALUE_PLACEHOLDER ? null : nextValue;
        if (verdictByField.get('offered_master')?.verdict !== 'confirmed') {
          struct.offered_master = nextValue;
          keyFacts.offered_master = nextValue;
        }
        break;
      case 'offered_price':
        struct.offered_price = nextValue;
        keyFacts.offered_price = nextValue;
        break;
      case 'offered_date_time':
        struct.offered_date_time = nextValue;
        keyFacts.offered_date_time = nextValue;
        break;
      case 'date':
        keyFacts.date = nextValue === UNCONFIRMED_VALUE_PLACEHOLDER ? null : nextValue;
        break;
      case 'time':
        keyFacts.time = nextValue === UNCONFIRMED_VALUE_PLACEHOLDER ? null : nextValue;
        break;
      case 'booking_done':
      case 'booking_status_text':
        struct.booking_status_text = nextValue;
        keyFacts.is_booked_text = nextValue;
        break;
      case 'unbooked_reason':
        struct.unbooked_reason = nextValue;
        keyFacts.unbooked_reason = nextValue;
        break;
      case 'booking_status':
        if (nextValue !== UNCONFIRMED_VALUE_PLACEHOLDER) {
          bookingStatus = nextValue;
          keyFacts.booking_status = nextValue;
        }
        break;
      case 'call_outcome':
        if (nextValue !== UNCONFIRMED_VALUE_PLACEHOLDER) {
          keyFacts.call_outcome = nextValue;
        }
        break;
      default:
        break;
    }
  }

  // Обработка 10 критериев аудита: «для каждого критерия приведи цитату-обоснование; обоснования без цитаты — понизь до 0 и пометь».
  // Вердикт contradicts без опровергающей цитаты понижаем до unconfirmed.
  const sourceCriteriaById = new Map<string, CallEvaluationCriterion>();
  sourceCriteriaForStatus.forEach((c) => sourceCriteriaById.set(c.id, c));

  const normalizedCriteriaReport: CriteriaVerificationItem[] = criteriaReport.map((it) => {
    const hasQuote = Boolean(it.quote && String(it.quote).trim());
    let nextItem: CriteriaVerificationItem =
      it.verdict === 'contradicts' && !hasQuote
        ? { ...it, verdict: 'unconfirmed', quote: null }
        : { ...it };

    if (nextItem.verdict === 'unconfirmed' && effectiveTranscript) {
      const pass1Quote = sourceCriteriaById.get(nextItem.id)?.evidence_quote || null;
      const fpMatch =
        nextItem.quote && isQuotePresentInTranscript(effectiveTranscript, nextItem.quote)
          ? nextItem.quote
          : pass1Quote && isQuotePresentInTranscript(effectiveTranscript, pass1Quote)
          ? pass1Quote
          : null;
      if (fpMatch) {
        nextItem = {
          ...nextItem,
          verdict: 'confirmed',
          quote: fpMatch,
          rejected_quote: null,
          hallucinated_quote: false,
          suspected_false_positive: true,
        };
      }
    }
    return nextItem;
  });

  const criteriaFlags: string[] = [];
  const sourceCriteria = sourceCriteriaForStatus;

  let updatedCriteria = sourceCriteria.map((c) => ({ ...c }));
  if (normalizedCriteriaReport.length > 0 && updatedCriteria.length > 0) {
    const byId = new Map<string, CriteriaVerificationItem>();
    normalizedCriteriaReport.forEach((it) => byId.set(it.id, it));

    updatedCriteria = updatedCriteria.map((crit) => {
      if (crit.is_applicable === false || typeof crit.score !== 'number') {
        return crit;
      }
      const ver = byId.get(crit.id);
      if (!ver) return crit;

      if (ver.verdict === 'confirmed' && ver.quote) {
        return {
          ...crit,
          evidence_quote: ver.quote,
          requires_verification: false,
        };
      }

      criteriaFlags.push(crit.id);
      rejectedClaimsCount++;
      // Если у критерия на Pass 1 была цитата, а Pass 2 отклонил её (unconfirmed/contradicts), сохраняем в rejected_quote
      if (!ver.rejected_quote && crit.evidence_quote) {
        ver.rejected_quote = crit.evidence_quote;
      }
      const tag = '[Требует проверки: обоснование не подтверждено цитатой из стенограммы]';
      const baseExp = (crit.explanation || '').trim();
      return {
        ...crit,
        score: 0,
        evidence_quote: null,
        requires_verification: true,
        explanation: baseExp.includes(tag) ? baseExp : `${baseExp} ${tag}`.trim(),
      };
    });
  }

  let updatedEvaluation = draft.evaluation;
  let updatedOperatorScore = draft.operator_score;
  if (updatedCriteria.length > 0) {
    const scoreCalc = calculateOverallScore(updatedCriteria);
    if (updatedEvaluation) {
      updatedEvaluation = {
        ...updatedEvaluation,
        criteria: updatedCriteria,
        overall_score: scoreCalc.overallScore,
        applicable_count: scoreCalc.applicableCount,
      };
    }
    if (scoreCalc.overallScore !== null) {
      updatedOperatorScore = scoreCalc.overallScore;
    }
  }

  // Согласованность аудита после Pass 2: если критерии (в т. ч. после понижения) содержат оценки < 7,
  // блок mistakes не должен быть пустым или содержать «грубых ошибок не допущено».
  const visitDateCtx = struct.offered_date_time || keyFacts.offered_date_time || keyFacts.date || null;
  const reconciled = reconcileMistakesWithCriteria(
    draft.operator_mistakes || [],
    updatedCriteria,
    keyFacts.call_datetime || null,
    visitDateCtx,
    effectiveTranscript
  );
  const updatedMistakes = reconciled.mistakes;

  // Синхронизируем строку «Суть обращения: ...» и число оценки в «Разбор работы менеджера (оценка X/10)»
  let updatedTranscriptSummary = draft.transcript_summary;
  if (fieldFlags.length > 0 && updatedTranscriptSummary) {
    const svc = keyFacts.service || struct.requested_service || 'не озвучено';
    const dt = keyFacts.date || 'не озвучено';
    const tm = keyFacts.time || 'не озвучено';
    const mst = keyFacts.master || struct.offered_master || 'не озвучено';
    const newEssence = `Суть обращения: услуга — ${svc}, дата — ${dt}, время — ${tm}, мастер — ${mst}.`;
    if (/^Суть обращения:[^\n]*/i.test(updatedTranscriptSummary)) {
      updatedTranscriptSummary = updatedTranscriptSummary.replace(/^Суть обращения:[^\n]*/i, newEssence);
    }
  }
  if (updatedTranscriptSummary && typeof updatedOperatorScore === 'number' && !isNaN(updatedOperatorScore)) {
    updatedTranscriptSummary = updatedTranscriptSummary.replace(
      /(Разбор работы менеджера\s*\(оценка\s*)[\d.,]+(\/10\))/i,
      `$1${updatedOperatorScore}$2`
    );
  }
  if (updatedTranscriptSummary && reconciled.fixedFromCriteria && updatedMistakes.length > 0) {
    updatedTranscriptSummary = updatedTranscriptSummary.replace(
      /(-\s*Ошибки и недочеты:\s*)[^\n]*/i,
      `$1${updatedMistakes.join('; ')}`
    );
  }

  const uniqueFlags = Array.from(new Set(fieldFlags));
  const uniqueCriteriaFlags = Array.from(new Set(criteriaFlags));
  const suspectedFalsePositives = [
    ...normalizedReport.filter((f) => f.suspected_false_positive).map((f) => f.field),
    ...normalizedCriteriaReport.filter((c) => c.suspected_false_positive).map((c) => c.id),
  ];

  // Счётчик отсечённых/неподтверждённых цитат и утверждений отражает все unconfirmed/contradicts флаги,
  // а не только цитаты, отсечённые программно на шаге verifySummary.
  const totalCaughtQuotes = Math.max(
    hallucinatedQuotesCaught,
    rejectedClaimsCount,
    uniqueFlags.length + uniqueCriteriaFlags.length
  );

  const verificationReport: CallVerificationReport = {
    summary_verdict:
      uniqueFlags.length > 0 || uniqueCriteriaFlags.length > 0 ? 'есть противоречия' : 'ок',
    fields: normalizedReport,
    flags: uniqueFlags,
    criteria_flags: uniqueCriteriaFlags,
    criteria_items: normalizedCriteriaReport,
    hallucinated_quotes_caught: totalCaughtQuotes,
    ...(suspectedFalsePositives.length > 0 ? { suspected_false_positives: suspectedFalsePositives } : {}),
    verified_at: new Date().toISOString(),
  };

  keyFacts.structured_summary = struct;
  if (updatedEvaluation) {
    keyFacts.evaluation = updatedEvaluation;
  }
  if (updatedCriteria.length > 0) {
    keyFacts.criteria_scores = updatedCriteria;
  }

  return {
    ...draft,
    transcript_summary: updatedTranscriptSummary,
    booking_status: bookingStatus,
    structured_summary: struct,
    evaluation: updatedEvaluation,
    criteria_scores: updatedCriteria.length > 0 ? updatedCriteria : draft.criteria_scores,
    operator_score: updatedOperatorScore,
    operator_mistakes: updatedMistakes,
    key_facts: keyFacts,
    verification_report: verificationReport,
    verification_flags: uniqueFlags,
  };
}

/**
 * Запускает полный двухпроходный пайплайн верификации:
 * 1) verifySummary (независимая сессия фактчекера с VERIFIER_PROMPT)
 * 2) verifyCriteriaWithTranscript (отдельная короткая проверка 10 критериев)
 * 3) applyVerdicts (применение вердиктов и флагов "требует проверки")
 */
export async function runTwoPassVerification(
  transcript: string,
  draft: AnalysisResult,
  opts: VerifierCallOptions
): Promise<AnalysisResult> {
  const conciseDraft = buildConciseDraftForVerifier(draft);
  const summaryRes = await verifySummary(transcript, conciseDraft, opts);

  let criteriaItems: CriteriaVerificationItem[] = [];
  let criteriaHallucinations = 0;

  const criteriaToCheck = draft.criteria_scores || draft.evaluation?.criteria || [];
  if (criteriaToCheck.some((c) => c.is_applicable !== false && typeof c.score === 'number')) {
    try {
      await new Promise((r) => setTimeout(r, 350)); // бережём RPS лимиты
      const critRes = await verifyCriteriaWithTranscript(transcript, criteriaToCheck, opts);
      criteriaItems = critRes.items;
      criteriaHallucinations = critRes.hallucinatedQuotesCaught;
    } catch (critErr: any) {
      console.warn(`[Verifier Criteria] Пропуск проверки критериев из-за сбоя API: ${critErr.message}`);
    }
  }

  return applyVerdicts(
    draft,
    summaryRes.report,
    criteriaItems,
    summaryRes.hallucinatedQuotesCaught + criteriaHallucinations,
    transcript
  );
}
