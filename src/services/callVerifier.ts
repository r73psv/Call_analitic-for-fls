/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import axios from 'axios';
import https from 'https';
import {
  AnalysisResult,
  CallEvaluationCriterion,
  CallVerificationReport,
  CriteriaVerificationItem,
  StructuredCallSummary,
  VerifierField,
  VerifierVerdict,
} from '../types.js';
import { calculateOverallScore } from './evaluationUtils.js';

export const VERIFIER_PROMPT = `Ты — строгий проверяющий фактчекер. Тебе даны стенограмма телефонного звонка и черновик резюме звонка.

Задача: проверить КАЖДОЕ утверждение резюме по стенограмме.

Правила:
1. Утверждение подтверждено, только если в стенограмме есть фрагмент, дословно или почти дословно его подтверждающий.
2. Для каждого подтверждённого поля приведи точную цитату из стенограммы (не выдумывай и не «исправляй» цитату).
3. Если утверждение противоречит стенограмме — пометь его как "ПРОТИВОРЕЧИТ" и приведи цитату, которая его опровергает.
4. Если подтверждения в стенограмме нет — пометь как "НЕ ПОДТВЕРЖДЕНО". Не угадывай и не восполняй пробелы.
5. Имена мастеров, цены, даты и время проверяй особенно строго: сравнивай посимвольно.
6. Метки ролей (Клиент/Менеджер) в стенограмме могут быть неточными — опирайся на смысл реплик, а не на метку.

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
  httpsAgent?: https.Agent;
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

function normalizeWhitespaceLower(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeForQuoteMatch(s: string): string {
  return s
    .replace(/^(?:менеджер|клиент|оператор|администратор|автоинформатор)\s*:\s*/gim, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Программная страховка от галлюцинированных цитат верификатора:
 * проверяет, что цитата действительно присутствует в стенограмме после нормализации пробелов/пунктуации.
 */
export function isQuotePresentInTranscript(transcript: string, quote: string | null | undefined): boolean {
  if (!quote || typeof quote !== 'string') return false;
  const qRaw = quote.trim();
  if (qRaw.length < 2) return false;

  // Убираем внешние кавычки («...» / "..." / '...') если модель обернула цитату
  const unwrapped = qRaw.replace(/^[«"'„]+|[»"'“]+$/g, '').trim();
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

  return {
    call_purpose: struct.call_purpose ?? kf.call_purpose ?? kf.client_issue ?? 'не озвучено',
    requested_service: struct.requested_service ?? kf.requested_service ?? kf.service ?? 'не озвучено',
    offered_master: struct.offered_master ?? kf.offered_master ?? kf.master ?? 'не озвучено',
    offered_price: struct.offered_price ?? kf.offered_price ?? 'не озвучено',
    offered_date_time:
      struct.offered_date_time ??
      kf.offered_date_time ??
      ([kf.date, kf.time].filter(Boolean).join(' ') || 'не озвучено'),
    booking_status_text: struct.booking_status_text ?? kf.is_booked_text ?? draft.booking_status ?? 'не озвучено',
    unbooked_reason: struct.unbooked_reason ?? kf.unbooked_reason ?? 'не озвучено',
    service: kf.service ?? 'не озвучено',
    date: kf.date ?? 'не озвучено',
    time: kf.time ?? 'не озвучено',
    master: kf.master ?? 'не озвучено',
    booking_status: draft.booking_status ?? kf.booking_status ?? 'не озвучено',
    call_outcome: kf.call_outcome ?? 'не озвучено',
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
      ...(opts.httpsAgent ? { httpsAgent: opts.httpsAgent } : {}),
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
      const verdict = normalizeVerdict(f.verdict);
      const quote = f.quote && String(f.quote).trim() && String(f.quote).toLowerCase() !== 'null'
        ? String(f.quote).trim()
        : null;
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

  // Программная проверка цитат БЕЗ повторного запроса к LLM
  const verifiedFields: VerifierField[] = parsed.fields.map((f) => {
    if (f.quote && !isQuotePresentInTranscript(transcript, f.quote)) {
      hallucinatedQuotesCaught++;
      console.warn(
        `[Verifier] Поле "${f.field}": цитата не найдена в стенограмме ("${f.quote.slice(0, 60)}"). Помечено unconfirmed без ретрая.`
      );
      return {
        ...f,
        verdict: 'unconfirmed',
        quote: null,
        hallucinated_quote: true,
      };
    }
    if (f.verdict === 'confirmed' && !f.quote && !isAbsenceValue(f.draft_value)) {
      return {
        ...f,
        verdict: 'unconfirmed',
      };
    }
    return f;
  });

  const anyNotOk = verifiedFields.some((f) => f.verdict !== 'confirmed' && !isAbsenceValue(f.draft_value));
  return {
    summary: draftSummary,
    report: verifiedFields,
    summary_verdict: anyNotOk ? 'есть противоречия' : parsed.summary_verdict,
    hallucinatedQuotesCaught,
  };
}

function parseCriteriaVerification(rawContent: string): CriteriaVerificationItem[] {
  const clean = stripJsonMarkdown(rawContent);
  const parsed = JSON.parse(clean);
  const list: any[] = Array.isArray(parsed?.criteria) ? parsed.criteria : [];
  return list
    .map((c: any) => {
      if (!c || !c.id) return null;
      const verdict = normalizeVerdict(c.verdict);
      const quote = c.quote && String(c.quote).trim() && String(c.quote).toLowerCase() !== 'null'
        ? String(c.quote).trim()
        : null;
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
  const sanitized = items.map((it) => {
    if (it.quote && !isQuotePresentInTranscript(transcript, it.quote)) {
      hallucinatedQuotesCaught++;
      return {
        ...it,
        verdict: 'unconfirmed' as VerifierVerdict,
        quote: null,
        hallucinated_quote: true,
      };
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
  hallucinatedQuotesCaught: number = 0
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
  let bookingStatus = draft.booking_status;
  const fieldFlags: string[] = [];
  const verdictByField = new Map<string, VerifierField>();
  report.forEach((item) => verdictByField.set(item.field.trim(), item));

  for (const f of report) {
    const fieldName = f.field.trim();
    const draftAlreadyNegative = isAbsenceValue(f.draft_value);

    if (f.verdict === 'confirmed') {
      continue;
    }

    // Если черновик уже честно написал «не указана / не выбран / не озвучено», не перетираем на тревожную заглушку
    if (f.verdict === 'unconfirmed' && draftAlreadyNegative) {
      continue;
    }

    const nextValue =
      f.verdict === 'contradicts' && f.corrected_value
        ? f.corrected_value
        : UNCONFIRMED_VALUE_PLACEHOLDER;

    fieldFlags.push(fieldName);

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

  // Обработка 10 критериев аудита: «для каждого критерия приведи цитату-обоснование; обоснования без цитаты — понизь до 0 и пометь»
  const criteriaFlags: string[] = [];
  const sourceCriteria =
    draft.criteria_scores ||
    draft.evaluation?.criteria ||
    draft.key_facts?.criteria_scores ||
    [];

  let updatedCriteria = sourceCriteria.map((c) => ({ ...c }));
  if (criteriaReport.length > 0 && updatedCriteria.length > 0) {
    const byId = new Map<string, CriteriaVerificationItem>();
    criteriaReport.forEach((it) => byId.set(it.id, it));

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
    if (scoreCalc.overallScore !== null && typeof updatedOperatorScore === 'number') {
      updatedOperatorScore = Math.max(1, Math.min(10, Math.round(scoreCalc.overallScore)));
    }
  }

  // Синхронизируем строку «Суть обращения: ...» в transcript_summary, если поля уточнились/помечены
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

  const uniqueFlags = Array.from(new Set(fieldFlags));
  const uniqueCriteriaFlags = Array.from(new Set(criteriaFlags));

  const verificationReport: CallVerificationReport = {
    summary_verdict:
      uniqueFlags.length > 0 || uniqueCriteriaFlags.length > 0 ? 'есть противоречия' : 'ок',
    fields: report,
    flags: uniqueFlags,
    criteria_flags: uniqueCriteriaFlags,
    hallucinated_quotes_caught: hallucinatedQuotesCaught,
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
    summaryRes.hallucinatedQuotesCaught + criteriaHallucinations
  );
}
