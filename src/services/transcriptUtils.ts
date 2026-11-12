/**
 * Чистые утилиты нормализации и диаризации стенограмм (работают как на сервере, так и в браузере).
 */

/**
 * П. 3.5 ТЗ: минимальное число слов фразы, ниже которого фраза не считается дубликатом.
 * Защищает легитимные короткие повторы ("Да", "Да") от удаления дедупликацией.
 */
export const SHORT_PHRASE_MIN_WORDS = 3;

/**
 * П. 3.5 ТЗ: определяет, нужно ли считать две фразы дубликатами.
 * Фразы короче SHORT_PHRASE_MIN_WORDS слов никогда не склеиваются.
 */
export function shouldMergeDuplicate(candidate: string, previous: string, similarityThreshold = 0.65): boolean {
  const wordCount = (candidate || '').trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < SHORT_PHRASE_MIN_WORDS) return false;
  return calculateTextSimilarity(candidate, previous) > similarityThreshold;
}

/**
 * Вычисляет коэффициент сходства двух строк (на основе биграмм / коэффициента Соренсена-Дайса)
 */
export function calculateTextSimilarity(s1: string, s2: string): number {
  const str1 = (s1 || '').toLowerCase().replace(/[^a-zа-яё0-9\s]/gi, '').trim();
  const str2 = (s2 || '').toLowerCase().replace(/[^a-zа-яё0-9\s]/gi, '').trim();

  if (str1 === str2) return 1.0;
  if (!str1 || !str2) return 0.0;
  if (str1.length < 2 || str2.length < 2) return 0.0;

  const getBigrams = (str: string) => {
    const bigrams = new Map<string, number>();
    for (let i = 0; i < str.length - 1; i++) {
      const bg = str.substring(i, i + 2);
      bigrams.set(bg, (bigrams.get(bg) || 0) + 1);
    }
    return bigrams;
  };

  const bg1 = getBigrams(str1);
  const bg2 = getBigrams(str2);

  let intersection = 0;
  for (const [bg, count1] of bg1.entries()) {
    const count2 = bg2.get(bg) || 0;
    intersection += Math.min(count1, count2);
  }

  const total = (str1.length - 1) + (str2.length - 1);
  return (2.0 * intersection) / total;
}

/**
 * Разделяет склеенные в одном предложении реплики разных говорящих
 * (например, прощание администратора и ответ клиента «Угу взаимно...»)
 */
export function splitConjoinedLines(lines: string[]): { text: string; forcedSpeaker?: 'Менеджер' | 'Клиент' }[] {
  const result: { text: string; forcedSpeaker?: 'Менеджер' | 'Клиент' }[] = [];

  for (const line of lines) {
    const raw = line.replace(/^(Менеджер:|Клиент:|Администратор:|Оператор:|Неизвестный:)\s*/i, '').trim();
    if (!raw) continue;

    // Склейка в финале: Прощание администратора + ответ клиента
    const fareMatch = raw.match(
      /^(.*?(?:записать|до свидания|всего доброго|рады видеть|до встречи))\s+(Угу\s+(?:взаимно|все|да).*|взаимно.*|и вам.*|спасибо.*до свидания.*)$/i
    );
    if (fareMatch && fareMatch[1].trim().length > 3 && fareMatch[2].trim().length > 3) {
      result.push({ text: fareMatch[1].trim(), forcedSpeaker: 'Менеджер' });
      result.push({ text: fareMatch[2].trim(), forcedSpeaker: 'Клиент' });
      continue;
    }

    // Склейка в начале: Приветствие администратора + ответ/просьба клиента
    const greetMatch = raw.match(
      /^(.*?(?:слушаю вас|чем могу помочь)[.!]?)\s+([Зз]дравствуйте.*|[Дд]обрый.*|[Аа]\s+подскажите.*|[Яя]\s+бы хотел.*)/i
    );
    if (greetMatch && greetMatch[1].trim().length > 3 && greetMatch[2].trim().length > 3) {
      result.push({ text: greetMatch[1].trim(), forcedSpeaker: 'Менеджер' });
      result.push({ text: greetMatch[2].trim(), forcedSpeaker: 'Клиент' });
      continue;
    }

    // Склейка вопроса о номере: Вопрос администратора + номер клиента
    const phoneMatch = raw.match(
      /^(.*?(?:подскажите ваш номер|ваш номер|номер телефона)[?.:!]?)\s+([0-9\s-+]{3,}.*)/i
    );
    if (phoneMatch && phoneMatch[1].trim().length > 3 && phoneMatch[2].trim().length > 3) {
      result.push({ text: phoneMatch[1].trim(), forcedSpeaker: 'Менеджер' });
      result.push({ text: phoneMatch[2].trim(), forcedSpeaker: 'Клиент' });
      continue;
    }

    result.push({ text: raw });
  }

  return result;
}

/**
 * П. 3.8 ТЗ: конфигурация маркеров ролей (бренд-маркеры салона, имена сотрудников).
 * Вынесена из тела refineTranscriptRoles: новые маркеры добавляются без правки логики.
 */
export interface RoleMarkersConfig {
  /** Фразы, однозначно указывающие на менеджера салона */
  manager: string[];
  /** Фразы, однозначно указывающие на клиента */
  client: string[];
}

/**
 * Значения по умолчанию — сохраняют прежнее поведение функции.
 * Имена сотрудников ("кристина") перечислены здесь для совместимости;
 * при смене администратора достаточно отредактировать словарь, а не код.
 */
export const DEFAULT_ROLE_MARKERS: RoleMarkersConfig = {
  manager: [
    'менеджер',
    'администратор',
    'салон красоты',
    'fashion look',
    'фешен лук',
    'fls',
    'лик 28',
    'слушаю вас',
    'чем могу помочь',
    'подскажите ваш номер',
    'подскажите номер',
    'минуточку, сейчас',
    'минуточку',
    'сейчас посмотрим',
    '1 минуту',
    'одну минуту',
    'подобрать вам',
    'подберу вам',
    'подберу мастер',
    'топ эксперт',
    'эксперт категории',
    'хотели бы попробовать',
    'к другому хотели бы',
    'могу предложить',
    'предложу запись',
    'у мастера нерабочий день',
    'у мастера выходной',
    'мастер не работает',
    'подряд подряд записи',
    'у надежды по 30 минут',
    'будем рады в следующий раз',
    'будем рады вас видеть',
    'выполняем оформление',
    'записи немножко с запасом',
    'единственное время свободное',
    'хорошего дня вам, кристина',
    'хорошего дня вам',
  ],
  client: [
    'а подскажите',
    'у кого я стригла',
    'стригла челку',
    'хотела бы',
    'хочу записаться',
    'хочется записаться',
    'чикнула прям 5 минут',
    'чикнула',
    'мне нельзя вот',
    'впихнуть пораньше',
    'не будет в городе',
    'в москве',
    'верно.',
    'верно',
    'да, верно',
    'угу взаимно',
    'взаимно все хорошего дня',
  ],
};

/**
 * П. 3.7 ТЗ: реплики, начинающиеся с этих слов, — продолжение мысли предыдущего
 * спикера (встречные вставки, союзы-связки). Роль предыдущей реплики сохраняется,
 * переключение не выполняется.
 */
const CONTINUATION_PREFIXES = ['и ', 'ну ', 'то есть ', 'да и ', 'а ', 'но '];

/**
 * Интеллектуально нормализует и распределяет реплики по ролям Менеджер / Клиент,
 * исправляя ошибочные метки и склеенные предложения.
 *
 * П. 3.7 ТЗ: метки спикеров (0/1, 1/2) в SpeechKit УСЛОВНЫ — они не привязаны к
 * ролям. Данная эвристика не претендует на 100% точность: возможны инверсии меток
 * и короткие встречные реплики разных людей. Финальная выверка ролей выполняется
 * на верхнем уровне (или вручную).
 *
 * Правило: реплики с разными метками спикера НИКОГДА не склеиваются, даже если
 * грамматически стыкуются. Склейка допустима только внутри одной метки при
 * связности высказывания.
 */
export function refineTranscriptRoles(
  raw: string,
  markers: RoleMarkersConfig = DEFAULT_ROLE_MARKERS
): string {
  if (!raw || typeof raw !== 'string') return raw;

  const rawLines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  if (rawLines.length === 0) return '';

  const splitItems = splitConjoinedLines(rawLines);
  const result: string[] = [];
  let prevSpeaker: 'Менеджер' | 'Клиент' = 'Клиент';

  const managerMarkers = markers.manager.map(m => m.toLowerCase());
  const clientMarkers = markers.client.map(m => m.toLowerCase());

  for (let i = 0; i < splitItems.length; i++) {
    const item = splitItems[i];
    const phrase = item.text;
    const lower = phrase.toLowerCase();

    if (item.forcedSpeaker) {
      result.push(`${item.forcedSpeaker}: ${phrase}`);
      prevSpeaker = item.forcedSpeaker;
      continue;
    }

    // П. 3.7 ТЗ: фраза — продолжение мысли предыдущего спикера.
    // Начинается со строчной буквы или союза-связки => роль не переключаем.
    const startsLowercase = /^[а-яёa-z]/.test(phrase);
    const startsWithConnector = CONTINUATION_PREFIXES.some(p => lower.startsWith(p));
    if (i > 0 && (startsLowercase || startsWithConnector)) {
      result.push(`${prevSpeaker}: ${phrase}`);
      continue;
    }

    const isManager =
      (i === 0 && (lower.includes('добрый') || lower.includes('слушаю') || lower.includes('салон') || lower.includes('здравствуйте'))) ||
      managerMarkers.some(m => lower.includes(m));

    const isClient =
      clientMarkers.some(m => lower.includes(m)) ||
      /^\+?[0-9\s-]{3,}$/.test(phrase); // Цифры номера телефона

    let currentSpeaker: 'Менеджер' | 'Клиент';
    if (isManager && !isClient) {
      currentSpeaker = 'Менеджер';
    } else if (isClient && !isManager) {
      currentSpeaker = 'Клиент';
    } else {
      currentSpeaker = prevSpeaker === 'Менеджер' ? 'Клиент' : 'Менеджер';
    }

    result.push(`${currentSpeaker}: ${phrase}`);
    prevSpeaker = currentSpeaker;
  }

  return result.join('\n');
}

/**
 * Исправляет стенограммы с дублированными репликами и нормализует разделение ролей.
 * П. 3.5 ТЗ: короткие фразы (< SHORT_PHRASE_MIN_WORDS слов) не склеиваются никогда.
 */
export function fixDuplicatedTranscript(
  raw: string,
  markers: RoleMarkersConfig = DEFAULT_ROLE_MARKERS
): string {
  if (!raw || typeof raw !== 'string') return raw;
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return raw;

  // Извлекаем чистые фразы и удаляем подряд идущие дубликаты
  const cleanPhrases: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const textOnly = lines[i].replace(/^(Менеджер:|Клиент:|Администратор:|Оператор:|Неизвестный:)\s*/i, '').trim();
    if (!textOnly) continue;

    if (cleanPhrases.length > 0) {
      const prev = cleanPhrases[cleanPhrases.length - 1];
      // П. 3.5 ТЗ: решение о склейке через shouldMergeDuplicate
      // (короткие фразы не считаются дубликатами)
      if (shouldMergeDuplicate(textOnly, prev)) {
        if (textOnly.length > prev.length) {
          cleanPhrases[cleanPhrases.length - 1] = textOnly;
        }
        continue;
      }
    }
    cleanPhrases.push(textOnly);
  }

  // Применяем ролевую диаризацию и сплит склеенных предложений
  return refineTranscriptRoles(cleanPhrases.join('\n'), markers);
}
