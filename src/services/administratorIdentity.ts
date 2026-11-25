/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CallRecord } from '../types.js';

export const UNIDENTIFIED_ADMINISTRATOR_LABEL = 'Не представился';

export type AdministratorIdentitySource =
  | 'stored'
  | 'greeting_quote'
  | 'transcript_intro'
  | 'unidentified';

export interface AdministratorIntroExtraction {
  name: string | null;
  quote: string | null;
  source: 'greeting_quote' | 'transcript_intro' | 'none';
}

export interface ResolvedAdministratorIdentity {
  name: string;
  identified: boolean;
  source: AdministratorIdentitySource;
  quote: string | null;
}

const CANONICAL_NAME_ALIASES: Record<string, string> = {
  'алена': 'Алёна',
  'алёна': 'Алёна',
  'артем': 'Артём',
  'артём': 'Артём',
  'семен': 'Семён',
  'семён': 'Семён',
  'федор': 'Фёдор',
  'фёдор': 'Фёдор',
  'петр': 'Пётр',
  'пётр': 'Пётр',
};

const NON_NAME_STOP_WORDS = new Set<string>([
  'салон',
  'салона',
  'салоне',
  'красоты',
  'студия',
  'студии',
  'студио',
  'лик',
  'лис',
  'фэшн',
  'фешен',
  'фешн',
  'лук',
  'добрый',
  'доброе',
  'добрая',
  'день',
  'вечер',
  'утро',
  'ночь',
  'здравствуйте',
  'здравствуй',
  'привет',
  'алло',
  'ало',
  'слушаю',
  'слушает',
  'вас',
  'вам',
  'чем',
  'могу',
  'помочь',
  'подскажите',
  'скажите',
  'спасибо',
  'пожалуйста',
  'девушка',
  'женщина',
  'мужчина',
  'клиент',
  'клиентка',
  'гость',
  'запись',
  'записи',
  'записаться',
  'записаны',
  'записана',
  'записан',
  'звоню',
  'звонок',
  'звонила',
  'звонили',
  'администратор',
  'админ',
  'менеджер',
  'оператор',
  'старший',
  'дежурный',
  'сотрудник',
  'специалист',
  'мастер',
  'мастера',
  'мастеру',
  'парикмахер',
  'косметолог',
  'бровист',
  'визажист',
  'стилист',
  'услуга',
  'услуги',
  'маникюр',
  'педикюр',
  'стрижка',
  'окрашивание',
  'брови',
  'ресницы',
  'массаж',
  'время',
  'дата',
  'цена',
  'стоимость',
  'сегодня',
  'завтра',
  'вчера',
  'хорошо',
  'ладно',
  'понятно',
  'да',
  'нет',
  'увы',
  'сейчас',
  'потом',
  'можно',
  'нужно',
  'надо',
  'хочу',
  'хотела',
  'хотел',
  'это',
  'меня',
  'зовут',
  'как',
  'кто',
  'что',
  'где',
  'когда',
  'почему',
  'зачем',
  'вы',
  'мы',
  'они',
  'она',
  'он',
  'тут',
  'здесь',
  'там',
  'очень',
  'просто',
  'прямо',
  'номер',
  'телефон',
  'линия',
  'линии',
  'автоответчик',
  'автоинформатор',
  'очередь',
  'оставайтесь',
  'оставьте',
  'сообщение',
  'разговор',
  'может',
  'быть',
  'работаем',
  'компания',
  'центр',
  'клиника',
  'ваш',
  'ваша',
  'вашего',
  'наш',
  'наша',
  'нашего',
  'офис',
  'приемная',
  'приёмная',
  'ресепшен',
  'ресепшн',
  'представился',
  'указан',
  'озвучено',
  'неизвестно',
  'неизвестный',
]);

// Широкий словарь распространённых личных имён (РФ / Поволжье) для контекстов без явного маркера «меня зовут / администратор».
const KNOWN_RUSSIAN_FIRST_NAMES = new Set<string>([
  'алена', 'алёна', 'алина', 'алиса', 'альбина', 'алия', 'алла', 'амина', 'анастасия', 'настя', 'настенька',
  'ангелина', 'анжелика', 'анна', 'аня', 'анюта', 'антонина', 'арина', 'асия', 'валентина', 'валя',
  'валерия', 'лера', 'варвара', 'варя', 'василиса', 'венера', 'вера', 'вероника', 'виктория', 'вика',
  'виолетта', 'влада', 'владислава', 'галина', 'галя', 'галия', 'гузель', 'гульнара', 'дарина', 'дарья', 'даша',
  'диана', 'диляра', 'дина', 'динара', 'ева', 'евгения', 'женя', 'екатерина', 'катя', 'елена', 'лена',
  'елизавета', 'лиза', 'жанна', 'зарина', 'земфира', 'злата', 'зоя', 'зульфия', 'илона', 'инга', 'инна',
  'ирина', 'ира', 'камилла', 'камила', 'карина', 'кира', 'клавдия', 'кристина', 'ксения', 'ксюша',
  'лариса', 'лейсан', 'ляйсан', 'лиана', 'лидия', 'лида', 'лилия', 'лиля', 'любовь', 'люба', 'людмила', 'люда',
  'мадина', 'майя', 'маргарита', 'рита', 'марина', 'мария', 'маша', 'мила', 'милана', 'милена',
  'надежда', 'надя', 'наталья', 'наталия', 'наташа', 'нелли', 'ника', 'нина', 'нонна', 'оксана', 'олеся', 'алеся',
  'ольга', 'оля', 'полина', 'поля', 'раиса', 'регина', 'резеда', 'римма', 'роза', 'рушана', 'сабина',
  'светлана', 'света', 'снежана', 'софия', 'софья', 'соня', 'стефания', 'таисия', 'тамара', 'татьяна', 'таня',
  'ульяна', 'эльвира', 'элина', 'эльмира', 'эльза', 'эмма', 'юлиана', 'юлия', 'юля', 'яна', 'ясмина',
  'александр', 'саша', 'александра', 'алексей', 'алёша', 'андрей', 'антон', 'артём', 'артем', 'артур', 'айрат',
  'борис', 'вадим', 'валентин', 'валерий', 'василий', 'виктор', 'виталий', 'владимир', 'владислав', 'вячеслав',
  'георгий', 'глеб', 'григорий', 'давид', 'даниил', 'данил', 'данила', 'денис', 'дмитрий', 'дима', 'евгений',
  'егор', 'иван', 'игорь', 'ильдар', 'илья', 'камиль', 'кирилл', 'константин', 'леонид', 'максим', 'макс',
  'марат', 'матвей', 'михаил', 'миша', 'наиль', 'никита', 'николай', 'коля', 'олег', 'павел', 'паша',
  'пётр', 'петр', 'рамиль', 'ренат', 'ринат', 'роман', 'рома', 'руслан', 'семён', 'семен', 'сергей', 'серёжа',
  'станислав', 'стас', 'степан', 'тимур', 'фёдор', 'федор', 'эдуард', 'юрий', 'ярослав',
]);

export function normalizeAdministratorFirstName(
  raw?: string | null,
  options?: { requireKnownName?: boolean }
): string | null {
  if (!raw || typeof raw !== 'string') return null;

  // Убираем лишние пробелы, кавычки, скобки и пояснения вроде "(администратор)"
  let cleaned = raw
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[«»"'`.,!?;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return null;

  // Если передали "администратор Анна" или "меня зовут Алёна" — берём имя после маркера
  const prefixMatch = cleaned.match(
    /^(?:меня\s+зовут|старший\s+администратор|дежурный\s+администратор|администратор|менеджер|оператор)\s+([А-ЯЁа-яё-]{2,20})$/i
  );
  if (prefixMatch) {
    cleaned = prefixMatch[1].trim();
  }

  // Только одно личное имя (1 слово кириллицей, допускается дефис)
  const token = cleaned.split(/\s+/)[0] || '';
  if (!/^[А-ЯЁа-яё]{2,20}(?:-[А-ЯЁа-яё]{2,20})?$/.test(token)) {
    return null;
  }

  const lower = token.toLowerCase();
  if (NON_NAME_STOP_WORDS.has(lower)) {
    return null;
  }

  if (options?.requireKnownName && !KNOWN_RUSSIAN_FIRST_NAMES.has(lower)) {
    return null;
  }

  if (CANONICAL_NAME_ALIASES[lower]) {
    return CANONICAL_NAME_ALIASES[lower];
  }

  return lower
    .split('-')
    .map(part => (part ? part.charAt(0).toUpperCase() + part.slice(1) : ''))
    .join('-');
}

export function isGenericAtsOperatorLabel(raw?: string | null): boolean {
  if (!raw || typeof raw !== 'string') return true;
  const trimmed = raw.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  if (lower === UNIDENTIFIED_ADMINISTRATOR_LABEL.toLowerCase()) return true;
  if (/^\+?\d[\d\s\-()]{2,}$/.test(trimmed)) return true; // телефон или внутренний номер АТС
  if (/@/.test(trimmed)) return true; // email / SIP URI
  if (/^(?:user|sip|ext|line|desk|reception|admin|operator|manager|megafon|ats)[_\-\s\d]*$/i.test(trimmed)) {
    return true;
  }
  if (
    /^(?:дежурный\s+)?(?:администратор|менеджер|оператор|сотрудник|не\s+указан|не\s+представился|неизвестно)(?:\s+салона|\s+ресепшена?)?$/i.test(
      lower
    )
  ) {
    return true;
  }
  return false;
}

function isPrecededByMasterOrClientContext(text: string, matchIndex: number): boolean {
  const before = text.slice(Math.max(0, matchIndex - 38), matchIndex).toLowerCase();
  return /(?:к\s+мастеру|у\s+мастера|мастер[ауе]?|специалист[ауе]?|парикмахер[ауе]?|косметолог[ауе]?|бровист[ауе]?|визажист[ауе]?|стилист[ауе]?|записан[аы]?\s+к|запись\s+к|клиент(?:к[аиеу])?|гость(?:я)?)\s*$/i.test(
    before
  );
}

function isFollowedByClientAddressingContext(text: string, matchEnd: number): boolean {
  const after = text.slice(matchEnd, Math.min(text.length, matchEnd + 45)).toLowerCase();
  // Например: "Алло, Динара, добрый день" / "Это Динара?" / "Динара, вы записаны..."
  if (/^\s*\?/.test(after)) return true;
  return /^\s*[,!.]?\s*(?:добрый|доброе|здравствуйте|вы\s+записан|вы\s+к\s+нам|у\s+вас\s+запис|напоминаю|подтверждаете|удобно\s+говорить|вам\s+удобно)/i.test(
    after
  );
}

function buildSnippet(text: string, start: number, end: number): string {
  const left = Math.max(0, start - 35);
  const right = Math.min(text.length, end + 45);
  return text
    .slice(left, right)
    .replace(/\s+/g, ' ')
    .trim();
}

function extractNameFromOpeningSegment(segment: string): { name: string; quote: string } | null {
  const text = segment.replace(/\s+/g, ' ').trim();
  if (!text) return null;

  // Приоритет 1: Явное «меня зовут <Имя>» / «зовут меня <Имя>»
  const introPatterns: Array<{ regex: RegExp; requireKnownName: boolean; checkClientAfter?: boolean }> = [
    {
      regex: /(?:меня\s+зовут|зовут\s+меня)\s+(?:(?:старший|дежурный)\s+)?(?:(?:администратор|менеджер|оператор)\s+)?([А-ЯЁа-яё]{2,20}(?:-[А-ЯЁа-яё]{2,20})?)/gi,
      requireKnownName: false,
    },
    // Приоритет 2: «администратор <Имя>» / «менеджер <Имя>» / «оператор <Имя>»
    {
      regex: /(?:(?:старший|дежурный)\s+)?(?:администратор|менеджер|оператор)(?:\s+салона(?:\s+красоты)?)?[\s,:-]+([А-ЯЁа-яё]{2,20}(?:-[А-ЯЁа-яё]{2,20})?)/gi,
      requireKnownName: false,
    },
    // Приоритет 3: «<Имя>, администратор / менеджер»
    {
      regex: /(?:^|[\s,;.!?—–-])([А-ЯЁа-яё]{2,20})\s*,\s*(?:старший\s+)?(?:администратор|менеджер|оператор)(?=\b|[.,!?\s]|$)/gi,
      requireKnownName: true,
    },
    // Приоритет 4: «с вами говорит <Имя>» / «вас слушает <Имя>» / «на связи <Имя>»
    {
      regex: /(?:с\s+вами\s+(?:говорит|разговаривает)|вас\s+слушает|на\s+связи)\s+(?:администратор\s+)?([А-ЯЁа-яё]{2,20}(?:-[А-ЯЁа-яё]{2,20})?)/gi,
      requireKnownName: false,
    },
    // Приоритет 5: «<Имя>, слушаю вас» / «<Имя> слушает» / «<Имя>, чем могу помочь»
    {
      regex: /(?:^|[\s,;.!?—–-])([А-ЯЁа-яё]{2,20})[\s,]+(?:слушаю\s+вас|вас\s+слушаю|слушаю|слушает|чем\s+(?:я\s+)?могу\s+(?:вам\s+)?помочь)(?=\b|[.,!?\s]|$)/gi,
      requireKnownName: true,
      checkClientAfter: true,
    },
    // Приоритет 6: «салон ... / Лик 28 / LIQ28 / Fashion Look Studio, <Имя>» (в конце приветствия или перед фразой менеджера)
    {
      regex: /(?:салон(?:\s+красоты)?|студи[яио]|лик\s*28|лис\s*28|liq\s*28|fashion\s+look(?:\s+studio)?|ф[еэ]ш[еэ]н\s+лук(?:\s+студио)?|лук\s+студи[яо]|28)[\s,«»"'–—-]+([А-ЯЁа-яё]{2,20})(?=\s*(?:[,.!]|$|звоню|слушаю|чем\s+могу|подскажите))/gi,
      requireKnownName: true,
      checkClientAfter: true,
    },
    // Приоритет 7: «это <Имя>, салон ...» / «это <Имя>, звоню...» (исключаем вопросы «это Динара?»)
    {
      regex: /(?:^|[.!?\s,])это\s+([А-ЯЁа-яё]{2,20})(?=\s*[,.\s!]|\s*$)/gi,
      requireKnownName: true,
      checkClientAfter: true,
    },
  ];

  for (const { regex, requireKnownName, checkClientAfter } of introPatterns) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const candidateRaw = match[1];
      const matchStart = match.index;
      const matchEnd = matchStart + match[0].length;

      if (isPrecededByMasterOrClientContext(text, matchStart)) {
        continue;
      }
      if (checkClientAfter && isFollowedByClientAddressingContext(text, matchEnd)) {
        continue;
      }

      const normalized = normalizeAdministratorFirstName(candidateRaw, { requireKnownName });
      if (normalized) {
        return {
          name: normalized,
          quote: buildSnippet(text, matchStart, matchEnd),
        };
      }
    }
  }

  return null;
}

function extractOpeningManagerUtterances(transcript: string): string[] {
  const lines = transcript
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const hasSpeakerLabels = lines.some(l =>
    /^(?:менеджер|администратор|оператор|сотрудник|клиент|гость|автоинформатор|система)\s*:/i.test(l)
  );

  if (!hasSpeakerLabels) {
    // Сплошной текст SpeechKit / GigaASR без меток ролей — берём только начало разговора
    const openingChunk = transcript.replace(/\s+/g, ' ').trim().slice(0, 420);
    return openingChunk ? [openingChunk] : [];
  }

  const managerLines: string[] = [];
  let inspectedNonAutoLines = 0;

  for (const line of lines) {
    if (/^(?:автоинформатор|система|бот)\s*:/i.test(line)) {
      continue;
    }

    inspectedNonAutoLines++;

    const managerMatch = line.match(/^(?:менеджер|администратор|оператор|сотрудник)\s*:\s*(.+)$/i);
    if (managerMatch) {
      managerLines.push(managerMatch[1].trim());
      if (managerLines.length >= 4) break;
      continue;
    }

    // Иногда ASR на самой первой реплике путает метку «Клиент:» и «Менеджер:»
    // (например: «Клиент: Добрый день, салон LIQ28, администратор Анна»).
    const clientMatch = line.match(/^(?:клиент|гость)\s*:\s*(.+)$/i);
    if (clientMatch && inspectedNonAutoLines <= 2 && managerLines.length === 0) {
      const content = clientMatch[1].trim();
      if (/(?:салон|лик\s*28|liq\s*28|fashion\s+look|ф[еэ]ш[еэ]н|администратор|менеджер|слушаю\s+вас)/i.test(content)) {
        managerLines.push(content);
      }
      continue;
    }

    // Если уже прошли стартовое окно диалога (первые 6 реплик), прекращаем поиск
    if (inspectedNonAutoLines >= 6) break;
  }

  return managerLines;
}

export function extractAdministratorIntroNameFromTranscript(
  transcript?: string | null,
  greetingQuote?: string | null
): AdministratorIntroExtraction {
  // 1. Сначала проверяем точную цитату приветствия из аудита (Критерий 1 / greeting_check),
  // если она заполнена и содержит самопредставление администратора
  if (greetingQuote && typeof greetingQuote === 'string' && greetingQuote.trim()) {
    const fromQuote = extractNameFromOpeningSegment(greetingQuote.trim());
    if (fromQuote) {
      return {
        name: fromQuote.name,
        quote: greetingQuote.trim(),
        source: 'greeting_quote',
      };
    }
  }

  // 2. Разбираем стартовые реплики менеджера в стенограмме
  if (transcript && typeof transcript === 'string' && transcript.trim()) {
    const openingUtterances = extractOpeningManagerUtterances(transcript);
    for (const utterance of openingUtterances) {
      const match = extractNameFromOpeningSegment(utterance);
      if (match) {
        return {
          name: match.name,
          quote: match.quote,
          source: 'transcript_intro',
        };
      }
    }
    // Если реплики приветствия разбиты на 2 соседние строки менеджера — проверим объединённое начало
    if (openingUtterances.length >= 2) {
      const joined = openingUtterances.slice(0, 2).join(' ').slice(0, 420);
      const match = extractNameFromOpeningSegment(joined);
      if (match) {
        return {
          name: match.name,
          quote: match.quote,
          source: 'transcript_intro',
        };
      }
    }
  }

  return {
    name: null,
    quote: null,
    source: 'none',
  };
}

function getGreetingCriterionQuote(call: Partial<CallRecord>): string | null {
  const criteria = call.evaluation?.criteria || call.criteria_scores || call.key_facts?.evaluation?.criteria || [];
  if (!Array.isArray(criteria)) return null;
  const greetingCrit = criteria.find(
    c =>
      c &&
      (c.id === 'greeting_intro' ||
        (typeof c.name === 'string' && c.name.toLowerCase().includes('приветств')))
  );
  const quote = greetingCrit?.evidence_quote;
  if (typeof quote === 'string' && quote.trim() && quote.trim().toLowerCase() !== 'не применимо') {
    return quote.trim();
  }
  return null;
}

/**
 * Определяет администратора звонка строго по имени, которым он представился в начале разговора.
 * Номер/аккаунт АТС (call.operator_name) намеренно НЕ используется для классификации,
 * поскольку под одной линией АТС в разное время работают разные администраторы.
 */
export function resolveCallAdministratorName(call: Partial<CallRecord>): ResolvedAdministratorIdentity {
  const greetingQuote = getGreetingCriterionQuote(call);

  // 1. Если имя представления уже извлечено при анализе и сохранено в карточке звонка
  const storedRaw = call.spoken_operator_name || call.key_facts?.administrator_name || null;
  if (storedRaw && !isGenericAtsOperatorLabel(storedRaw)) {
    const normalizedStored = normalizeAdministratorFirstName(storedRaw, { requireKnownName: false });
    if (normalizedStored) {
      return {
        name: normalizedStored,
        identified: true,
        source: 'stored',
        quote: greetingQuote || null,
      };
    }
  }

  // 2. Извлекаем имя из цитаты приветствия / начала стенограммы (работает и для всех исторических звонков!)
  const extracted = extractAdministratorIntroNameFromTranscript(call.transcript, greetingQuote);
  if (extracted.name) {
    return {
      name: extracted.name,
      identified: true,
      source: extracted.source === 'greeting_quote' ? 'greeting_quote' : 'transcript_intro',
      quote: extracted.quote,
    };
  }

  // 3. Администратор не представился в начале разговора (или звонок без диалога/пропущенный)
  return {
    name: UNIDENTIFIED_ADMINISTRATOR_LABEL,
    identified: false,
    source: 'unidentified',
    quote: null,
  };
}

export interface StaffRecentCallSummary {
  call_id: string;
  timestamp: string;
  client_name: string;
  client_phone_masked?: string;
  duration_seconds: number;
  score: number | null;
  call_outcome: string;
  booking_status?: string;
  summary: string;
  intro_quote?: string | null;
}

export interface StaffPerformanceMember {
  id: string;
  username: string;
  name: string;
  role: string;
  isActive: boolean;
  isOnline: boolean;
  isUnidentifiedBucket: boolean;
  lastLoginAt?: string;
  lastCallAt?: string;
  sampleIntroQuote?: string | null;
  notes?: string;
  totalCalls: number;
  averageScore: number | null;
  starsScore: number | null;
  bookingsCount: number;
  conversionRate: number;
  consultationsCount: number;
  refusalsCount: number;
  disputesCount: number;
  averageDurationSeconds: number;
  criteriaAverages: Record<string, number | null>;
  recentCalls: StaffRecentCallSummary[];
}

export interface StaffPerformanceReport {
  period: string;
  totalStaff: number;
  identifiedStaffCount: number;
  activeStaff: number;
  onlineStaff: number;
  totalCallsAnalyzed: number;
  identifiedCallsCount: number;
  unidentifiedCallsCount: number;
  salonAverageScore: number | null;
  salonConversionRate: number;
  staff: StaffPerformanceMember[];
  source: string;
  dataSourceDescription: string;
}

const CRITERIA_KEY_MATCHERS: Array<{ key: string; match: (id: string, name: string) => boolean }> = [
  { key: 'greeting', match: (id, name) => id.includes('greeting') || id.includes('intro') || name.includes('приветств') },
  { key: 'needsDiscovery', match: (id, name) => id.includes('needs') || name.includes('потребност') },
  { key: 'servicePresentation', match: (id, name) => id.includes('service_master') || id.includes('service') || id.includes('master') || name.includes('презентация услуги') },
  { key: 'pricePresentation', match: (id, name) => id.includes('price') || name.includes('стоимост') },
  { key: 'objections', match: (id, name) => id.includes('objection') || name.includes('возражен') },
  { key: 'extraServices', match: (id, name) => id.includes('additional') || id.includes('extra') || id.includes('upsell') || name.includes('дополнительн') || name.includes('доп.') },
  { key: 'parallelBooking', match: (id, name) => id.includes('parallel') || name.includes('параллельн') },
  { key: 'alternativeOptions', match: (id, name) => id.includes('alternative') || id.includes('variant') || name.includes('альтернатив') },
  { key: 'closing', match: (id, name) => id.includes('booking_closure') || id === 'closing' || (id.includes('clos') && !id.includes('communication')) || name.includes('закрытие на запись') },
  { key: 'communicationQuality', match: (id, name) => id.includes('communication') || id.includes('quality') || name.includes('коммуникац') },
];

function isCallBooked(c: CallRecord): boolean {
  const bStatus = (c.booking_status || c.key_facts?.booking_status || '').toLowerCase();
  const outcome = (c.key_facts?.call_outcome || '').toLowerCase();
  return (
    bStatus.includes('соглас') ||
    bStatus.includes('запись состоялась') ||
    bStatus.includes('подтвержд') ||
    outcome === 'запись' ||
    outcome === 'успешно'
  );
}

function isCallRefusal(c: CallRecord): boolean {
  const bStatus = (c.booking_status || c.key_facts?.booking_status || '').toLowerCase();
  const outcome = (c.key_facts?.call_outcome || '').toLowerCase();
  return bStatus.includes('отказ') || outcome === 'отказ';
}

function isCallConsultation(c: CallRecord): boolean {
  const bStatus = (c.booking_status || c.key_facts?.booking_status || '').toLowerCase();
  const outcome = (c.key_facts?.call_outcome || '').toLowerCase();
  return bStatus.includes('консультац') || outcome === 'консультация';
}

function getCallScore(c: CallRecord): number | null {
  if (typeof c.key_facts?.evaluation?.overall_score === 'number' && !Number.isNaN(c.key_facts.evaluation.overall_score)) {
    return c.key_facts.evaluation.overall_score;
  }
  if (typeof c.evaluation?.overall_score === 'number' && !Number.isNaN(c.evaluation.overall_score)) {
    return c.evaluation.overall_score;
  }
  if (typeof c.operator_score === 'number' && !Number.isNaN(c.operator_score)) {
    return c.operator_score;
  }
  return null;
}

export function filterCallsByPerformancePeriod(
  allCalls: CallRecord[],
  options: { period?: string; startDate?: string; endDate?: string; now?: Date }
): CallRecord[] {
  const period = options.period || 'all';
  const now = options.now || new Date();
  let startTime = 0;
  let endTime = Infinity;

  if (period === 'today') {
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    startTime = startOfDay.getTime();
  } else if (period === '7d' || period === '7days' || period === 'week') {
    startTime = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  } else if (period === 'this_month') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    startTime = monthStart.getTime();
  } else if (period === '30d' || period === '30days' || period === 'month') {
    startTime = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  } else if (period === 'custom' && options.startDate) {
    startTime = new Date(options.startDate).getTime();
    if (options.endDate) {
      endTime = new Date(options.endDate).getTime() + 24 * 60 * 60 * 1000 - 1;
    }
  }

  return allCalls.filter(c => {
    if (c.is_demo) return false;
    if (!c.timestamp) return period === 'all';
    const t = new Date(c.timestamp).getTime();
    return t >= startTime && t <= endTime;
  });
}

/**
 * Единый расчёт эффективности в разрезе администраторов по имени,
 * которым они представляются в начале разговора.
 */
export function buildStaffPerformanceReport(
  allCalls: CallRecord[],
  options: { period?: string; startDate?: string; endDate?: string; now?: Date } = {}
): StaffPerformanceReport {
  const period = options.period || 'all';
  const now = options.now || new Date();
  const periodCalls = filterCallsByPerformancePeriod(allCalls, { ...options, now });

  // Группируем строго по имени представления в начале разговора
  const grouped = new Map<
    string,
    {
      name: string;
      identified: boolean;
      calls: Array<{ call: CallRecord; quote: string | null }>;
    }
  >();

  let identifiedCallsCount = 0;
  let unidentifiedCallsCount = 0;

  for (const call of periodCalls) {
    const resolved = resolveCallAdministratorName(call);
    if (resolved.identified) {
      identifiedCallsCount++;
    } else {
      unidentifiedCallsCount++;
    }

    const bucketKey = resolved.identified ? resolved.name.toLowerCase() : '__unidentified__';
    let entry = grouped.get(bucketKey);
    if (!entry) {
      entry = {
        name: resolved.name,
        identified: resolved.identified,
        calls: [],
      };
      grouped.set(bucketKey, entry);
    }
    entry.calls.push({ call, quote: resolved.quote });
  }

  const RECENT_ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000; // активность за последние 24 часа

  const staff: StaffPerformanceMember[] = Array.from(grouped.values()).map(group => {
    const sortedCalls = [...group.calls].sort(
      (a, b) => new Date(b.call.timestamp).getTime() - new Date(a.call.timestamp).getTime()
    );
    const totalCalls = sortedCalls.length;
    const scoredCalls = sortedCalls
      .map(item => getCallScore(item.call))
      .filter((s): s is number => s !== null);

    const averageScore =
      scoredCalls.length > 0
        ? Math.round((scoredCalls.reduce((sum, s) => sum + s, 0) / scoredCalls.length) * 10) / 10
        : null;
    const starsScore = averageScore !== null ? Math.round((averageScore / 2) * 10) / 10 : null;

    const bookingsCount = sortedCalls.filter(item => isCallBooked(item.call)).length;
    const refusalsCount = sortedCalls.filter(item => isCallRefusal(item.call)).length;
    const consultationsCount = sortedCalls.filter(item => isCallConsultation(item.call)).length;
    const disputesCount = sortedCalls.filter(item => item.call.key_facts?.is_dispute).length;
    const conversionRate = totalCalls > 0 ? Math.round((bookingsCount / totalCalls) * 100) : 0;

    const totalDuration = sortedCalls.reduce((sum, item) => sum + (item.call.duration_seconds || 0), 0);
    const averageDurationSeconds = totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0;

    // Средние по всем 10 критериям аудита (в ключах UI StaffPerformanceTab)
    const criteriaAverages: Record<string, number | null> = {};
    for (const matcher of CRITERIA_KEY_MATCHERS) {
      const vals: number[] = [];
      for (const { call } of sortedCalls) {
        const critList = call.evaluation?.criteria || call.criteria_scores || call.key_facts?.evaluation?.criteria || call.key_facts?.criteria_scores || [];
        const found = critList.find(cr => {
          const cid = String(cr.id || '').toLowerCase();
          const cname = String(cr.name || '').toLowerCase();
          return matcher.match(cid, cname);
        });
        if (found && found.is_applicable !== false && typeof found.score === 'number' && !Number.isNaN(found.score)) {
          vals.push(found.score);
        }
      }
      criteriaAverages[matcher.key] =
        vals.length > 0 ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
    }

    const lastCallAt = sortedCalls[0]?.call.timestamp;
    const isRecentlyActive =
      Boolean(lastCallAt) && now.getTime() - new Date(lastCallAt).getTime() <= RECENT_ACTIVE_WINDOW_MS;
    const sampleIntroQuote = sortedCalls.find(item => item.quote)?.quote || null;

    const recentCalls: StaffRecentCallSummary[] = sortedCalls.slice(0, 10).map(({ call, quote }) => ({
      call_id: call.call_id,
      timestamp: call.timestamp,
      client_name: call.client_name || 'Клиент',
      client_phone_masked: call.client_phone_masked || call.client_phone,
      duration_seconds: call.duration_seconds || 0,
      score: getCallScore(call),
      call_outcome: call.key_facts?.call_outcome || 'консультация',
      booking_status: call.booking_status || call.key_facts?.booking_status,
      summary: call.summary || '',
      intro_quote: quote,
    }));

    return {
      id: group.identified ? `spoken_${group.name.toLowerCase()}` : 'spoken_unidentified',
      username: group.identified ? 'по приветствию' : 'без представления',
      name: group.name,
      role: group.identified ? 'Администратор' : 'Не представился',
      isActive: true,
      isOnline: group.identified && isRecentlyActive,
      isUnidentifiedBucket: !group.identified,
      lastLoginAt: lastCallAt,
      lastCallAt,
      sampleIntroQuote,
      notes: group.identified
        ? 'Определён по имени, которым представился в начале разговора'
        : 'Звонки, где администратор не назвал своё имя в начале разговора (либо без диалога)',
      totalCalls,
      averageScore,
      starsScore,
      bookingsCount,
      conversionRate,
      consultationsCount,
      refusalsCount,
      disputesCount,
      averageDurationSeconds,
      criteriaAverages,
      recentCalls,
    };
  });

  // Сортировка: сначала идентифицированные администраторы (по количеству звонков и среднему баллу),
  // корзина «Не представился» всегда в самом низу таблицы
  staff.sort((a, b) => {
    if (a.isUnidentifiedBucket !== b.isUnidentifiedBucket) {
      return a.isUnidentifiedBucket ? 1 : -1;
    }
    if (b.totalCalls !== a.totalCalls) return b.totalCalls - a.totalCalls;
    return (b.averageScore || 0) - (a.averageScore || 0);
  });

  const allScored = periodCalls.map(getCallScore).filter((s): s is number => s !== null);
  const salonAverageScore =
    allScored.length > 0
      ? Math.round((allScored.reduce((sum, s) => sum + s, 0) / allScored.length) * 10) / 10
      : null;

  const totalBooked = periodCalls.filter(isCallBooked).length;
  const salonConversionRate = periodCalls.length > 0 ? Math.round((totalBooked / periodCalls.length) * 100) : 0;

  const identifiedStaff = staff.filter(s => !s.isUnidentifiedBucket);
  const activeRecentlyCount = identifiedStaff.filter(s => s.isOnline).length;

  return {
    period,
    totalStaff: identifiedStaff.length,
    identifiedStaffCount: identifiedStaff.length,
    activeStaff: identifiedStaff.length,
    onlineStaff: activeRecentlyCount,
    totalCallsAnalyzed: periodCalls.length,
    identifiedCallsCount,
    unidentifiedCallsCount,
    salonAverageScore,
    salonConversionRate,
    staff,
    source: 'spoken_intro',
    dataSourceDescription:
      'Классификация по имени, которым администратор представляется в начале разговора (независимо от номера АТС)',
  };
}
