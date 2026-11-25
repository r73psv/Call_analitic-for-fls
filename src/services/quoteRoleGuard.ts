/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { splitInlineSpeakerLabels } from './transcriptUtils.js';

export type CanonicalSpeakerRole = 'client' | 'manager';

export interface RoleUtterancesMap {
  client: string[];
  manager: string[];
  hasRoleLabels: boolean;
}

export interface AttributedQuoteMatch {
  role: CanonicalSpeakerRole;
  roleLabel: 'Клиент' | 'Менеджер';
  quote: string;
  fullMatch: string;
  startIndex: number;
  endIndex: number;
}

export interface QuoteRoleMismatch {
  field: string;
  attributedRole: 'Клиент' | 'Менеджер';
  quote: string;
  foundInOppositeRole: boolean;
}

export interface GeneratorSummaryFieldsInput {
  short_summary?: string;
  call_purpose?: string;
  requested_service?: string;
  offered_master?: string;
  offered_price?: string;
  offered_date_time?: string;
  booking_status_text?: string;
  unbooked_reason?: string;
  manager_next_steps?: string[] | null;
  operator_comment?: string;
  quotes_support?: string[];
  /** Explicit quotes bound to specific summary fields (e.g., from facts.* or summary metadata) */
  field_quotes?: Partial<Record<string, string | null | undefined>>;
  /** Skip checking requested_service quote ownership on existing-booking confirmation calls where manager reminds client of booked service */
  skip_service_field_quote_check?: boolean;
}

export interface GeneratorQuoteRoleControlResult {
  fields: GeneratorSummaryFieldsInput;
  flaggedFields: string[];
  mismatches: QuoteRoleMismatch[];
}

export interface FieldQuoteSpeakerCheckResult {
  valid: boolean;
  field: string;
  fieldLabelRu: string;
  expectedRole: CanonicalSpeakerRole;
  actualRole: CanonicalSpeakerRole | null;
  quote: string;
}

export const NEEDS_VERIFICATION_LABEL = 'требует проверки';

/**
 * Maps summary fields to the speaker role they describe and their Russian display label
 * used in `[Generator WARNING]` diagnostics.
 */
export const SUMMARY_FIELD_SPEAKER_META: Record<
  string,
  { expectedRole: CanonicalSpeakerRole; labelRu: string }
> = {
  call_purpose: { expectedRole: 'client', labelRu: 'цель' },
  goal: { expectedRole: 'client', labelRu: 'цель' },
  requested_service: { expectedRole: 'client', labelRu: 'желаемая услуга' },
  service: { expectedRole: 'client', labelRu: 'желаемая услуга' },
  unbooked_reason: { expectedRole: 'client', labelRu: 'причина отказа' },
  reason_if_not: { expectedRole: 'client', labelRu: 'причина отказа' },
  offered_master: { expectedRole: 'manager', labelRu: 'предложенный мастер' },
  master: { expectedRole: 'manager', labelRu: 'предложенный мастер' },
  offered_price: { expectedRole: 'manager', labelRu: 'цена' },
  price: { expectedRole: 'manager', labelRu: 'цена' },
  offered_date_time: { expectedRole: 'manager', labelRu: 'дата и время' },
  date_time: { expectedRole: 'manager', labelRu: 'дата и время' },
};

function normalizeQuoteText(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»„“”"''`‚‘’]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits a transcript into normalized utterances grouped by canonical speaker role
 * (`Клиент` / `Менеджер`). System IVR lines (`Автоинформатор:`) are excluded.
 */
export function extractRoleUtterances(transcript?: string | null): RoleUtterancesMap {
  const client: string[] = [];
  const manager: string[] = [];

  if (!transcript || typeof transcript !== 'string') {
    return { client, manager, hasRoleLabels: false };
  }

  const lines = splitInlineSpeakerLabels(transcript)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let hasRoleLabels = false;
  for (const line of lines) {
    if (/^автоинформатор\s*:/i.test(line)) continue;

    if (/^(?:клиент|гость)\s*:/i.test(line)) {
      hasRoleLabels = true;
      const body = line.replace(/^(?:клиент|гость)\s*:\s*/i, '').trim();
      if (body) client.push(body);
    } else if (/^(?:менеджер|администратор|оператор)\s*:/i.test(line)) {
      hasRoleLabels = true;
      const body = line.replace(/^(?:менеджер|администратор|оператор)\s*:\s*/i, '').trim();
      if (body) manager.push(body);
    }
  }

  return { client, manager, hasRoleLabels };
}

/**
 * Checks whether a quote `X` actually appears in the transcript utterances
 * belonging to the specified speaker role.
 */
export function doesRoleUtterancesContainQuote(utterances: string[], quote: string): boolean {
  const normQuote = normalizeQuoteText(quote);
  if (!normQuote || normQuote.length < 2) return true;
  if (!utterances || utterances.length === 0) return false;

  const normUtterances = utterances.map(normalizeQuoteText).filter(Boolean);
  if (normUtterances.length === 0) return false;

  const combined = normUtterances.join(' ');
  if (combined.includes(normQuote)) {
    return true;
  }

  // Soft coverage fallback for longer quotes (>= 4 words) to tolerate minor ASR punctuation/filler variance
  const qTokens = normQuote.split(' ').filter((w) => w.length >= 2);
  if (qTokens.length >= 4) {
    for (const utt of normUtterances) {
      const uttTokens = new Set(utt.split(' ').filter((w) => w.length >= 2));
      let hits = 0;
      for (const tok of qTokens) {
        if (uttTokens.has(tok) || utt.includes(tok)) {
          hits++;
        }
      }
      if (hits / qTokens.length >= 0.75) {
        return true;
      }
    }
    const combinedTokens = new Set(combined.split(' ').filter((w) => w.length >= 2));
    let combinedHits = 0;
    for (const tok of qTokens) {
      if (combinedTokens.has(tok) || combined.includes(tok)) {
        combinedHits++;
      }
    }
    if (combinedHits / qTokens.length >= 0.8) {
      return true;
    }
  }

  return false;
}

const SPEECH_VERBS_FRAGMENT =
  '(?:сказал[аи]?|ответил[аи]?|уточнил[аи]?|спросил[аи]?|сообщил[аи]?|подтвердил[аи]?|попросил[аи]?|предложил[аи]?|пообещал[аи]?|назвал[аи]?|указал[аи]?|произн[её]с(?:ла|ли)?|озвучил[аи]?|заявил[аи]?|отметил[аи]?|добавил[аи]?|упомянул[аи]?|пояснил[аи]?|проинформировал[аи]?|приветствовал[аи]?|выразил[аи]?|отказал(?:ся|ась|ись)|пожаловал(?:ся|ась|ись)|отреагировал[аи]?|подчеркнул[аи]?|фразой|словами|репликой|:)';

const QUOTED_TEXT_CAPTURE = '(?:«([^»]{2,240})»|"([^"]{2,240})"|„([^“"]{2,240})[“"])';

const CLIENT_ATTRIBUTED_QUOTE_RE = new RegExp(
  `(?:^|[^\\p{L}])((?:клиент(?:ка|а|у|ом)?|гост(?:ья|ь|я|ю)?|абонент(?:а)?|звонящ(?:ий|ая))[^.!?\\n«"„]{0,65}?${SPEECH_VERBS_FRAGMENT}\\s*(?:[,:]\\s*)?${QUOTED_TEXT_CAPTURE})`,
  'giu'
);

const MANAGER_ATTRIBUTED_QUOTE_RE = new RegExp(
  `(?:^|[^\\p{L}])((?:менеджер(?:а|у)?|администратор(?:а|у)?|оператор(?:а|у)?|сотрудни(?:к|ца))[^.!?\\n«"„]{0,65}?${SPEECH_VERBS_FRAGMENT}\\s*(?:[,:]\\s*)?${QUOTED_TEXT_CAPTURE})`,
  'giu'
);

/**
 * Finds speaker-attributed quotes in generated text, such as:
 *   «клиент сказал "буду завтра"»
 *   «менеджер пообещал «скидку 20%»»
 *   «Клиент: «запишите меня»»
 */
export function extractAttributedQuotes(text?: string | null): AttributedQuoteMatch[] {
  if (!text || typeof text !== 'string') return [];
  const matches: AttributedQuoteMatch[] = [];

  const collect = (regex: RegExp, role: CanonicalSpeakerRole, roleLabel: 'Клиент' | 'Менеджер') => {
    const re = new RegExp(regex.source, regex.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const fullMatch = m[1];
      const quote = (m[2] || m[3] || m[4] || '').trim();
      if (!quote || quote.length < 2) continue;

      // Ignore brand/salon names quoted directly after "салон"/"студия"
      if (/(?:салон[ауе]?|студи[яиюей]|бренда?)\s*$/iu.test(fullMatch.slice(0, fullMatch.indexOf(quote)))) {
        continue;
      }

      const leadingOffset = m[0].indexOf(fullMatch);
      const startIndex = m.index + Math.max(0, leadingOffset);
      const endIndex = startIndex + fullMatch.length;

      // Guard against nested/overlapping match where another role appeared right before the quote
      const prefixBeforeQuote = fullMatch.slice(0, Math.max(0, fullMatch.lastIndexOf(quote)));
      if (
        role === 'client' &&
        /(?:менеджер|администратор|оператор)\s+(?:сказал|ответил|уточнил|сообщил|предложил|озвучил|подтвердил|:)/iu.test(
          prefixBeforeQuote
        )
      ) {
        continue;
      }
      if (
        role === 'manager' &&
        /(?:клиент|гость)\s+(?:сказал|ответил|уточнил|сообщил|попросил|спросил|подтвердил|:)/iu.test(
          prefixBeforeQuote
        )
      ) {
        continue;
      }

      matches.push({
        role,
        roleLabel,
        quote,
        fullMatch,
        startIndex,
        endIndex,
      });
    }
  };

  collect(CLIENT_ATTRIBUTED_QUOTE_RE, 'client', 'Клиент');
  collect(MANAGER_ATTRIBUTED_QUOTE_RE, 'manager', 'Менеджер');

  // Deduplicate overlapping spans by keeping the tighter (later-starting) attribution
  matches.sort((a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex);
  const deduped: AttributedQuoteMatch[] = [];
  for (const item of matches) {
    const prev = deduped[deduped.length - 1];
    if (prev && item.startIndex < prev.endIndex) {
      if (item.startIndex > prev.startIndex) {
        deduped[deduped.length - 1] = item;
      }
      continue;
    }
    deduped.push(item);
  }
  return deduped;
}

/**
 * Extracts all quoted fragments («...», "...", „...“) from a summary field value,
 * ignoring brand/salon names immediately preceded by «салон»/«студия»/«бренд».
 */
export function extractQuotedSnippets(text?: string | null): string[] {
  if (!text || typeof text !== 'string') return [];
  const results: string[] = [];
  const re = new RegExp(QUOTED_TEXT_CAPTURE, 'giu');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const quote = (m[1] || m[2] || m[3] || '').trim();
    if (!quote || quote.length < 2) continue;
    const before = text.slice(Math.max(0, m.index - 24), m.index);
    if (/(?:салон[ауе]?|студи[яиюей]|бренда?)\s*$/iu.test(before)) {
      continue;
    }
    results.push(quote);
  }
  return results;
}

/**
 * Verifies a quote bound to a specific summary field against the utterances of the speaker
 * that the field describes (e.g. `call_purpose`/`goal` -> client, `offered_price` -> manager).
 * If the quote belongs to the opposite speaker, logs:
 *   `[Generator WARNING] цитата «...» привязана к полю «цель», но принадлежит реплике менеджера.`
 */
export function verifyFieldQuoteSpeaker(
  fieldName: string,
  quote: string,
  transcript?: string | null,
  precomputedRoles?: RoleUtterancesMap
): FieldQuoteSpeakerCheckResult {
  const meta = SUMMARY_FIELD_SPEAKER_META[fieldName];
  if (!meta || !quote || !quote.trim()) {
    return {
      valid: true,
      field: fieldName,
      fieldLabelRu: meta?.labelRu || fieldName,
      expectedRole: meta?.expectedRole || 'client',
      actualRole: null,
      quote: (quote || '').trim(),
    };
  }

  const roleUtterances = precomputedRoles || extractRoleUtterances(transcript);
  if (!roleUtterances.hasRoleLabels) {
    return {
      valid: true,
      field: fieldName,
      fieldLabelRu: meta.labelRu,
      expectedRole: meta.expectedRole,
      actualRole: null,
      quote: quote.trim(),
    };
  }

  const cleanQuote = quote.trim();
  const expectedUtterances = meta.expectedRole === 'client' ? roleUtterances.client : roleUtterances.manager;
  const oppositeRole: CanonicalSpeakerRole = meta.expectedRole === 'client' ? 'manager' : 'client';
  const oppositeUtterances = oppositeRole === 'client' ? roleUtterances.client : roleUtterances.manager;
  const oppositeGenitive = oppositeRole === 'manager' ? 'менеджера' : 'клиента';

  const inExpected = doesRoleUtterancesContainQuote(expectedUtterances, cleanQuote);
  if (inExpected) {
    return {
      valid: true,
      field: fieldName,
      fieldLabelRu: meta.labelRu,
      expectedRole: meta.expectedRole,
      actualRole: meta.expectedRole,
      quote: cleanQuote,
    };
  }

  const inOpposite = doesRoleUtterancesContainQuote(oppositeUtterances, cleanQuote);
  if (inOpposite) {
    console.warn(
      `[Generator WARNING] цитата «${cleanQuote}» привязана к полю «${meta.labelRu}», но принадлежит реплике ${oppositeGenitive}.`
    );
    return {
      valid: false,
      field: fieldName,
      fieldLabelRu: meta.labelRu,
      expectedRole: meta.expectedRole,
      actualRole: oppositeRole,
      quote: cleanQuote,
    };
  }

  return {
    valid: true,
    field: fieldName,
    fieldLabelRu: meta.labelRu,
    expectedRole: meta.expectedRole,
    actualRole: null,
    quote: cleanQuote,
  };
}

const GREETING_QUOTE_GOAL_SUBSTANCE_RE =
  /(?:запис[а-яё]*|брон[а-яё]*|стрижк|окрашив|маникюр|педикюр|укладк|макияж|бров|ресниц|завивк|уход|услуг|процедур|мастер|специалист|цен[ауы]|стоимост|прайс|перенес|перенос|отмен|опозда|подтверд|консультац|обзвон|жалоб|претенз|вопрос|уточн|узнат|справк|звоню\s+по\s+поводу|хотел[аи]?\s+бы|хочу\s+|можно\s+[А-ЯЁ][а-яё]+)/iu;

const GREETING_ONLY_RE =
  /^(?:(?:алло|ало|ау|да|здравствуйте|здрасте|добрый\s+(?:день|вечер)|доброе\s+утро|приветствую|привет|слушаю(?:\s+вас)?|чем\s+могу\s+помочь|салон(?:\s+красоты)?|студия(?:\s+красоты)?|fashion\s+look(?:\s+studio)?|фэшн\s+лук(?:\s+студио)?|фешен\s+лук(?:\s+студио)?|лук\s+студи[яи]|ли[кqс]\s*28|liq\s*28|от[,\s]+а[,\s]+28|администратор(?:\s+[А-ЯЁа-яё]+)?|меня\s+зовут\s+[А-ЯЁа-яё]+|это\s+[А-ЯЁа-яё]+|вас\s+слушает(?:\s+[А-ЯЁа-яё]+)?|до\s+свидания|всего\s+доброго|спасибо)[\s,!.?:;\-–—«»"„“”]*)+$/iu;

/**
 * Checks whether a string or quote is purely a greeting / salon intro / «Алло»
 * and therefore MUST NOT be placed into the «Цель обращения» (`call_purpose`) field.
 */
export function isGreetingOnlyQuote(text?: string | null): boolean {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^(?:не\s+озвучено|не\s+указано|не\s+применимо|разговор\s+не\s+состоялся|звонок\s+не\s+(?:состоялся|дош[её]л)|требует\s+проверки)$/iu.test(trimmed)) {
    return false;
  }
  const stripped = trimmed.replace(/[«»„“”"''`]/g, '').trim();
  if (!stripped) return false;
  if (GREETING_QUOTE_GOAL_SUBSTANCE_RE.test(stripped)) {
    return false;
  }
  return GREETING_ONLY_RE.test(stripped);
}

/**
 * Controls speaker-bound quotes in generator fields BEFORE forming final summary fields.
 * If a quote is bound to a specific speaker (e.g., «клиент сказал X») and the utterances
 * with that role label do NOT contain X:
 *   - logs `[Generator WARNING] цитата не совпадает с меткой роли ...`
 *   - marks the field as `требует проверки` and suppresses the mismatched quote.
 * Also blocks greeting-only quotes («Добрый день, салон ...», «Алло») from being placed into `call_purpose`.
 */
export function enforceSummaryQuoteRoleControl(
  inputFields: GeneratorSummaryFieldsInput,
  transcript?: string | null
): GeneratorQuoteRoleControlResult {
  const roleUtterances = extractRoleUtterances(transcript);
  const fields: GeneratorSummaryFieldsInput = {
    ...inputFields,
    ...(Array.isArray(inputFields.manager_next_steps)
      ? { manager_next_steps: [...inputFields.manager_next_steps] }
      : {}),
    ...(Array.isArray(inputFields.quotes_support)
      ? { quotes_support: [...inputFields.quotes_support] }
      : {}),
  };

  const flaggedSet = new Set<string>();
  const mismatches: QuoteRoleMismatch[] = [];

  // Запрет подстановки цитаты-приветствия в поле «Цель обращения» (работает независимо от наличия меток ролей)
  if (typeof fields.call_purpose === 'string' && fields.call_purpose.trim()) {
    const rawPurpose = fields.call_purpose.trim();
    const purposeQuotedSnippets = extractQuotedSnippets(rawPurpose);
    const boundPurposeQuote =
      typeof inputFields.field_quotes?.call_purpose === 'string'
        ? inputFields.field_quotes.call_purpose.trim()
        : '';

    const badGreetingSnippet =
      (isGreetingOnlyQuote(rawPurpose) ? rawPurpose : null) ||
      purposeQuotedSnippets.find((s) => isGreetingOnlyQuote(s)) ||
      (boundPurposeQuote && isGreetingOnlyQuote(boundPurposeQuote) ? boundPurposeQuote : null);

    if (badGreetingSnippet) {
      flaggedSet.add('call_purpose');
      mismatches.push({
        field: 'call_purpose',
        attributedRole: 'Клиент',
        quote: badGreetingSnippet.replace(/^[«»„“”"]+|[«»„“”"]+$/g, '').trim() || badGreetingSnippet,
        foundInOppositeRole: true,
      });
      console.warn(
        `[Generator WARNING] цитата-приветствие «${badGreetingSnippet.replace(/^[«»„“”"]+|[«»„“”"]+$/g, '').trim()}» не может быть подставлена в поле «цель».`
      );
      fields.call_purpose = NEEDS_VERIFICATION_LABEL;
    }
  }

  if (!roleUtterances.hasRoleLabels) {
    return { fields, flaggedFields: Array.from(flaggedSet), mismatches };
  }

  const checkText = (fieldName: string, text: string, atomicReplace: boolean): string => {
    const attributed = extractAttributedQuotes(text);
    if (attributed.length === 0) return text;

    const badMatches: AttributedQuoteMatch[] = [];
    for (const item of attributed) {
      const ownUtterances = item.role === 'client' ? roleUtterances.client : roleUtterances.manager;
      const oppositeUtterances = item.role === 'client' ? roleUtterances.manager : roleUtterances.client;
      const oppositeLabel = item.role === 'client' ? 'Менеджер' : 'Клиент';

      const inOwn = doesRoleUtterancesContainQuote(ownUtterances, item.quote);
      if (!inOwn) {
        const inOpposite = doesRoleUtterancesContainQuote(oppositeUtterances, item.quote);
        badMatches.push(item);
        flaggedSet.add(fieldName);
        mismatches.push({
          field: fieldName,
          attributedRole: item.roleLabel,
          quote: item.quote,
          foundInOppositeRole: inOpposite,
        });
        console.warn(
          `[Generator WARNING] цитата не совпадает с меткой роли (поле: ${fieldName}, указана роль: ${item.roleLabel}, цитата: «${item.quote}»${
            inOpposite ? `, фактически найдено у роли: ${oppositeLabel}` : ', отсутствует в репликах указанной роли'
          })`
        );
      }
    }

    if (badMatches.length === 0) return text;

    if (atomicReplace) {
      return NEEDS_VERIFICATION_LABEL;
    }

    // For multi-sentence prose fields (short_summary, operator_comment):
    // strip mismatched attributed quote segments without emitting the false quote,
    // and explicitly mark with «требует проверки».
    let sanitized = text;
    for (let i = badMatches.length - 1; i >= 0; i--) {
      const bm = badMatches[i];
      sanitized =
        sanitized.slice(0, bm.startIndex) +
        `${bm.roleLabel}: ${NEEDS_VERIFICATION_LABEL}` +
        sanitized.slice(bm.endIndex);
    }
    return sanitized.replace(/\s{2,}/g, ' ').trim();
  };

  // Atomic structured summary fields -> replace entire field with «требует проверки» on mismatch
  const atomicKeys: (keyof Pick<
    GeneratorSummaryFieldsInput,
    | 'call_purpose'
    | 'requested_service'
    | 'offered_master'
    | 'offered_price'
    | 'offered_date_time'
    | 'booking_status_text'
    | 'unbooked_reason'
  >)[] = [
    'call_purpose',
    'requested_service',
    'offered_master',
    'offered_price',
    'offered_date_time',
    'booking_status_text',
    'unbooked_reason',
  ];

  for (const key of atomicKeys) {
    const val = fields[key];
    if (typeof val === 'string' && val.trim()) {
      let checked = checkText(key, val, true);

      // Проверка цитаты и говорящего, которого описывает поле (даже без явной подписи «клиент сказал ...»)
      const fieldMeta = SUMMARY_FIELD_SPEAKER_META[key];
      const skipForService = key === 'requested_service' && Boolean(inputFields.skip_service_field_quote_check);
      if (fieldMeta && !skipForService) {
        const quotedSnippets = extractQuotedSnippets(val);
        for (const snippet of quotedSnippets) {
          const fieldCheck = verifyFieldQuoteSpeaker(key, snippet, transcript, roleUtterances);
          if (!fieldCheck.valid) {
            flaggedSet.add(key);
            const alreadyRecorded = mismatches.some(
              (m) => m.field === key && normalizeQuoteText(m.quote) === normalizeQuoteText(snippet)
            );
            if (!alreadyRecorded) {
              mismatches.push({
                field: key,
                attributedRole: fieldMeta.expectedRole === 'client' ? 'Клиент' : 'Менеджер',
                quote: snippet,
                foundInOppositeRole: true,
              });
            }
            checked = NEEDS_VERIFICATION_LABEL;
          }
        }
      }

      fields[key] = checked;
    }

    // Проверка явно привязанной к полю цитаты (например, из facts.*.quote или field_quotes)
    const boundQuote = inputFields.field_quotes?.[key];
    const skipForServiceBound = key === 'requested_service' && Boolean(inputFields.skip_service_field_quote_check);
    if (
      typeof boundQuote === 'string' &&
      boundQuote.trim() &&
      SUMMARY_FIELD_SPEAKER_META[key] &&
      !skipForServiceBound
    ) {
      const boundCheck = verifyFieldQuoteSpeaker(key, boundQuote, transcript, roleUtterances);
      if (!boundCheck.valid) {
        flaggedSet.add(key);
        const fieldMeta = SUMMARY_FIELD_SPEAKER_META[key];
        const alreadyRecorded = mismatches.some(
          (m) => m.field === key && normalizeQuoteText(m.quote) === normalizeQuoteText(boundQuote)
        );
        if (!alreadyRecorded) {
          mismatches.push({
            field: key,
            attributedRole: fieldMeta.expectedRole === 'client' ? 'Клиент' : 'Менеджер',
            quote: boundQuote.trim(),
            foundInOppositeRole: true,
          });
        }
        fields[key] = NEEDS_VERIFICATION_LABEL;
      }
    }
  }

  // Multi-sentence narrative fields -> suppress the mismatched quote and mark «требует проверки»
  if (typeof fields.short_summary === 'string' && fields.short_summary.trim()) {
    fields.short_summary = checkText('short_summary', fields.short_summary, false);
  }
  if (typeof fields.operator_comment === 'string' && fields.operator_comment.trim()) {
    fields.operator_comment = checkText('operator_comment', fields.operator_comment, false);
  }

  // Steps array -> replace any step with role-mismatched quote with «требует проверки»
  if (Array.isArray(fields.manager_next_steps)) {
    fields.manager_next_steps = fields.manager_next_steps.map((step, idx) =>
      typeof step === 'string' && step.trim()
        ? checkText(`manager_next_steps[${idx}]`, step, true)
        : step
    );
  }

  // Remove any mismatched quotes from quotes_support if present
  if (Array.isArray(fields.quotes_support) && mismatches.length > 0) {
    const badNorms = new Set(mismatches.map((m) => normalizeQuoteText(m.quote)));
    fields.quotes_support = fields.quotes_support.filter((q) => !badNorms.has(normalizeQuoteText(q)));
  }

  return {
    fields,
    flaggedFields: Array.from(flaggedSet),
    mismatches,
  };
}
