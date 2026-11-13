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

const IVR_SENTENCE_PATTERNS: RegExp[] = [
  /обращаем\s+ваше\s+внимание[\s,]*разговор[\s,]*может[\s,]*быть[\s,]*записан[.!?]*/iu,
  /разговор[\s,]*может[\s,]*быть[\s,]*записан(?:\s+в\s+целях\s+повышения\s+качества[^.!?]*)?[.!?]*/iu,
  /здравствуйте[\s,]*оставайтесь\s+на\s+линии[\s,]*вам\s+ответит[^.!?]*[.!?]*/iu,
  /оставайтесь\s+на\s+линии[^.!?]*[.!?]*/iu,
  /здравствуйте[\s,]*вы\s+позвонили\s+в\s+салон[^.!?]*[.!?]*/iu,
  /вы\s+позвонили\s+в\s+салон[^.!?]*[.!?]*/iu,
  /мы\s+очень\s+рады[\s,]*что\s+вы\s+позвонили\s+именно\s+нам(?:\s+в\s+целях\s+повышения\s+качества(?:\s+обслуживания)?)?[.!?]*/iu,
  /в\s+целях\s+повышения\s+качества(?:\s+обслуживания)?(?:\s+разговор[^.!?]*)?[.!?]*/iu,
  /ваш\s+звонок\s+очень\s+важен\s+для\s+нас[^.!?]*[.!?]*/iu,
  /соединяем\s+(?:вас\s+)?с\s+(?:оператором|администратором|сотрудником)[^.!?]*[.!?]*/iu,
];

/**
 * Проверяет, является ли фраза полностью системным автоинформатором АТС (IVR).
 */
export function isIvrUtterance(text: string): boolean {
  const cleaned = (text || '')
    .replace(/^(?:Автоинформатор|Менеджер|Клиент|Администратор|Оператор|Неизвестный)\s*:\s*/i, '')
    .trim();
  if (!cleaned) return false;
  let remainder = cleaned;
  let matchedAny = false;
  for (const pat of IVR_SENTENCE_PATTERNS) {
    const gPat = new RegExp(pat.source, 'giu');
    if (gPat.test(remainder)) {
      matchedAny = true;
      remainder = remainder.replace(gPat, ' ');
    }
  }
  if (!matchedAny) return false;
  const leftover = remainder.replace(/[\s.,!?;:\-–—]+/g, '').trim();
  return leftover.length < 4;
}

/**
 * Отделяет префикс автоинформатора АТС от начала реплики, сохраняя живой диалог.
 */
export function extractIvrPrefix(line: string): { ivr: string | null; rest: string } {
  let working = (line || '').trim();
  if (/^Автоинформатор\s*:/i.test(working)) {
    return {
      ivr: working.replace(/^Автоинформатор\s*:\s*/i, '').trim(),
      rest: ''
    };
  }

  const ivrParts: string[] = [];
  let progress = true;
  while (progress && working.length > 0) {
    progress = false;
    for (const pat of IVR_SENTENCE_PATTERNS) {
      const startPat = new RegExp(`^\\s*(?:${pat.source})`, 'iu');
      const m = working.match(startPat);
      if (m && m[0].trim().length > 0) {
        ivrParts.push(m[0].trim());
        working = working.slice(m[0].length).replace(/^[\s.,!?;:\-–—]+/, '').trim();
        progress = true;
        break;
      }
    }
  }

  return {
    ivr: ivrParts.length > 0 ? ivrParts.join(' ').trim() : null,
    rest: working
  };
}

/**
 * Удаляет все фразы/строки автоинформатора АТС из стенограммы перед анализом смысла
 * (чтобы фраза «разговор может быть записан» не вызывала ложного срабатывания «запись подтверждена»).
 */
export function stripIvrFromTranscript(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  const lines = raw.split('\n');
  const cleanLines: string[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (/^Автоинформатор\s*:/i.test(trimmed)) continue;

    const speakerPrefixMatch = trimmed.match(/^(Менеджер:|Клиент:|Администратор:|Оператор:|Неизвестный:)\s*/i);
    const prefix = speakerPrefixMatch ? speakerPrefixMatch[0] : '';
    const body = prefix ? trimmed.slice(prefix.length).trim() : trimmed;

    const { rest } = extractIvrPrefix(body);
    let cleanedBody = rest;
    for (const pat of IVR_SENTENCE_PATTERNS) {
      cleanedBody = cleanedBody.replace(new RegExp(pat.source, 'giu'), ' ');
    }
    cleanedBody = cleanedBody.replace(/\s{2,}/g, ' ').replace(/^[\s.,!?;:\-–—]+/, '').trim();

    if (cleanedBody.length > 0) {
      cleanLines.push(`${prefix}${cleanedBody}`);
    }
  }

  return cleanLines.join('\n').trim();
}

/**
 * Разделяет длинный монолитный блок текста на потенциальные смены реплик по границам предложений.
 */
function splitBySentenceTurnBoundaries(text: string): string[] {
  // 1. Разделяем после приветствия администратора, если за ним сразу следует реплика клиента
  const afterIntroRe = /^((?:добр(?:ый\s+день|ое\s+утро|ый\s+вечер)|здравствуйте|алло)[,\s]*(?:салон(?:\s+красоты)?|администратор)[^.!?]*[.!?]?)\s+(.+)$/iu;
  const introMatch = text.match(afterIntroRe);
  if (introMatch && introMatch[1].trim().length > 5 && introMatch[2].trim().length > 3) {
    return [introMatch[1].trim(), ...splitBySentenceTurnBoundaries(introMatch[2].trim())];
  }

  // 2. Разделяем склеенные внутри одной строки ответы про временные окна / телефон / прощание
  const internalSplitPatterns: RegExp[] = [
    // Клиент уточняет вечернее время -> Менеджер называет интервал ("с 16:30 до 19:30...")
    /^(.*?(?:вечерн[а-яё]*\s+(?:когда|во\s+сколько|какой[^.!?]*)|когда\s+какой[^.!?]*вечерн[а-яё]*)[.?,\s]*)\s+(с\s+\d{1,2}[:.\s]\d{2}\s+до\s+\d{1,2}[:.\s]\d{2}.*)$/iu,
    // Клиент: "Давайте я продиктую" -> Менеджер: "Угу, сейчас секунду загрузит"
    /^(.*?давайте\s+(?:я\s+)?продикту[юе][.!?,]*)\s+((?:угу|ага|хорошо|да)[,\s]*(?:сейчас\s+секунду|минуточку|загрузит|слушаю).*)$/iu,
    // Клиент: "Угу, хорошо" -> Менеджер: "Угу, будем ожидать, до свидания"
    /^((?:угу,?\s*)?хорошо[,.\s]*)\s+((?:угу,?\s*)?(?:будем\s+(?:вас\s+)?ожидать|жд[её]м\s+вас|до\s+свидания).*)$/iu,
    // Склейка приветствий: "Да, хорошо. Здравствуйте, в какие дни..."
    /^(.*?хорошо[.!?]?)\s+(здравствуйте[,.\s]+(?:здравствуйте[,.\s]+)?(?:в\s+какие\s+дни|чем\s+могу|подскажите).*)$/iu,
  ];

  for (const pat of internalSplitPatterns) {
    const m = text.match(pat);
    if (m && m[1].trim().length >= 3 && m[2].trim().length >= 3) {
      return [
        ...splitBySentenceTurnBoundaries(m[1].trim()),
        ...splitBySentenceTurnBoundaries(m[2].trim()),
      ];
    }
  }

  // 3. Разделяем по знаку вопроса или точки перед явными сменными репликами
  const splitPoints = text.split(
    /(?<=[?])\s+(?=[А-ЯЁA-Z])|(?<=[.!])\s+(?=(?:Алло|Здравствуйте|Добрый\s+день|Доброе\s+утро|Добрый\s+вечер|Мо[её]\s+имя|Меня\s+зовут|Я\s+хотел|А\s+у\s+вас|А\s+подскажите|Подскажите|Скажите|Угу|Ага|Да,|Нет,|Хорошо,|Ладно,|Давайте|В\s+нашем\s+салоне|Ничего\s+страшного|Будем\s+(?:вас\s+)?ожидать|Сейчас\s+(?:прочитаем|секунду|посмотрим|буквально)|Я\s+слушаю|Необходимо\s+будет|В\s+эти\s+выходные|Всего\s+доброго|До\s+свидания)(?=[^\p{L}]|$))/u
  );

  return splitPoints.map(s => s.trim()).filter(Boolean);
}

/**
 * Разделяет склеенные в одном предложении реплики разных говорящих
 * (например, автоинформатор + приветствие, прощание администратора + ответ клиента)
 */
export function splitConjoinedLines(lines: string[]): { text: string; forcedSpeaker?: 'Менеджер' | 'Клиент' | 'Автоинформатор' }[] {
  const result: { text: string; forcedSpeaker?: 'Менеджер' | 'Клиент' | 'Автоинформатор' }[] = [];

  for (const line of lines) {
    const rawLine = line.replace(/^(Менеджер:|Клиент:|Администратор:|Оператор:|Автоинформатор:|Неизвестный:)\s*/i, '').trim();
    if (!rawLine) continue;

    // Отделяем системное сообщение автоинформатора от живого диалога
    const { ivr, rest } = extractIvrPrefix(rawLine);
    if (ivr) {
      result.push({ text: ivr, forcedSpeaker: 'Автоинформатор' });
    }
    if (!rest) continue;

    // Разбиваем потенциально склеенные предложения на фрагменты
    const fragments = splitBySentenceTurnBoundaries(rest);

    for (const raw of fragments) {
      if (!raw) continue;

      // Склейка в финале: Прощание администратора + ответ клиента
      const fareMatch = raw.match(
        /^(.*?(?:записать|до свидания|всего доброго|рады видеть|до встречи|будем вас ожидать)[.!?]?)\s+(Угу\s+(?:взаимно|все|да).*|взаимно.*|и вам.*|хорошо,?\s+спасибо.*|спасибо.*до свидания.*)$/i
      );
      if (fareMatch && fareMatch[1].trim().length > 3 && fareMatch[2].trim().length > 3) {
        result.push({ text: fareMatch[1].trim(), forcedSpeaker: 'Менеджер' });
        result.push({ text: fareMatch[2].trim(), forcedSpeaker: 'Клиент' });
        continue;
      }

      // Склейка в начале: Приветствие администратора + ответ/просьба клиента
      const greetMatch = raw.match(
        /^(.*?(?:слушаю вас|чем могу помочь|администратор\s+[А-ЯЁа-яё]+)[.!]?)\s+([Зз]дравствуйте.*|[Дд]обрый.*|[Аа]лло.*|[Аа]\s+подскажите.*|[Яя]\s+бы хотел.*|[Яя]\s+хотел.*|[Мм]о[её]\s+имя.*)/iu
      );
      if (greetMatch && greetMatch[1].trim().length > 3 && greetMatch[2].trim().length > 3) {
        result.push({ text: greetMatch[1].trim(), forcedSpeaker: 'Менеджер' });
        result.push({ text: greetMatch[2].trim(), forcedSpeaker: 'Клиент' });
        continue;
      }

      // Склейка двойного «Здравствуйте»: Клиент приветствует -> Администратор отвечает
      const doubleHelloMatch = raw.match(
        /^(?:(?:да,?\s*хорошо[.!]?\s*)?)(здравствуйте[.!,]?)\s+(здравствуйте,\s*(?:в\s+какие\s+дни|чем\s+могу|слушаю|подскажите).*)$/iu
      );
      if (doubleHelloMatch && doubleHelloMatch[1].trim().length > 3 && doubleHelloMatch[2].trim().length > 5) {
        result.push({ text: doubleHelloMatch[1].trim(), forcedSpeaker: 'Клиент' });
        result.push({ text: doubleHelloMatch[2].trim(), forcedSpeaker: 'Менеджер' });
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

      // Спец-разделение: «специализируется больше по стрижкам и по окрашиваниям хотели бы записаться»
      // (если в одной строке склеены тезис о специализации и приглашение на запись)
      const specBookMatch = raw.match(
        /^(.*?специализируется\s+больше\s+по\s+[^.!?]+?\s+хотели\s+бы\s+записаться\??)\s+(к\s+[А-ЯЁа-яё]+\s+[А-ЯЁа-яё]+\??)$/iu
      );
      if (specBookMatch) {
        result.push({ text: specBookMatch[1].trim(), forcedSpeaker: 'Менеджер' });
        result.push({ text: specBookMatch[2].trim(), forcedSpeaker: 'Клиент' });
        continue;
      }

      result.push({ text: raw });
    }
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
    'фэшн лук',
    'fls',
    'лик 28',
    'слушаю вас',
    'я слушаю номер',
    'слушаю номер телефона',
    'чем могу помочь',
    'подскажите ваш номер',
    'подскажите номер',
    'записывать на ваш номер',
    'минуточку, сейчас',
    'минуточку',
    'сейчас буквально секунду',
    'буквально секунду посмотрим',
    'секунду посмотрим',
    'сейчас секунду загрузит',
    'сейчас посмотрим',
    '1 минуту',
    'одну минуту',
    'подобрать вам',
    'подберу вам',
    'подберу мастер',
    'топ эксперт',
    'эксперт категории',
    'хотели бы попробовать',
    'хотели бы записаться',
    'к другому хотели бы',
    'в какие дни было бы комфортно',
    'когда вам было бы комфортнее',
    'необходимо будет только',
    'данный мастер работает',
    'выполняет в принципе',
    'выполняет, в принципе',
    'только экспресс укладк',
    'специализируется больше',
    'могу предложить',
    'могли бы предложить',
    'можем сейчас предложить',
    'самое ближайшее',
    'ближайшее свободное время',
    'дневное время и вечернее',
    'в любое время можно выбрать',
    'самое крайнее время',
    'можно в свободном',
    'можно, свободно',
    'предложить запись',
    'предложу запись',
    'в нашем салоне',
    'выполняется',
    'нет такой услуги',
    'ничего страшного',
    'будем вас ожидать',
    'будем ожидать',
    'будем ждать',
    'сейчас прочитаем',
    'прочитаем обязательно',
    'у мастера нерабочий день',
    'у мастера выходной',
    'мастер не работает',
    'не работает.',
    'не работает,',
    'в эти выходные',
    'подряд подряд записи',
    'у надежды по 30 минут',
    'будем рады в следующий раз',
    'будем рады вас видеть',
    'выполняем оформление',
    'записи немножко с запасом',
    'единственное время свободное',
    'хорошего дня вам, кристина',
    'хорошего дня вам',
    'записываю вас',
    'записала вас',
    'записали вас',
    'запись подтверждаем',
    'на продукции',
    'по стоимости',
    'верно, да?',
    'укладку делала',
  ],
  client: [
    'а подскажите',
    'а у вас есть',
    'у вас есть',
    'у кого я стригла',
    'стригла челку',
    'хотела бы',
    'хотела предупредить',
    'хотел предупредить',
    'я хотела',
    'я хотел',
    'я у вас с подружк',
    'с подружкой была',
    'моя подруга',
    'мою подругу укладывала',
    'была сначала подружка',
    'на укладке и макияж',
    'мне нужно напомнить',
    'что за мастер',
    'что это за девушка',
    'работает еще у вас',
    'только локоны, да',
    'она просто говорила',
    'стрижет еще',
    'мы запишемся',
    'сами запишемся',
    'сейчас время подберем',
    'онлайн можно посмотреть',
    'спрошу подруг',
    'будешь сейчас записываться',
    'трубку передам',
    'а вы предложите ей',
    'на воскресенье есть',
    'на следующей неделе',
    'понедельник, вторник',
    'давайте я продиктую',
    'правильно, да',
    'опоздаю',
    'задержусь',
    'мое имя',
    'моё имя',
    'для вашего салона',
    'вам прислал',
    'в ватсапе',
    'цифровая завивка',
    'японская завивка',
    'химическая, да',
    'нет, цифровую',
    'цифровую надо',
    'хочу записаться',
    'хочется записаться',
    'у меня запись',
    'чикнула прям 5 минут',
    'чикнула',
    'мне нельзя вот',
    'впихнуть пораньше',
    'не будет в городе',
    'в москве',
    'верно.',
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
const CONTINUATION_PREFIXES = ['и ', 'ну ', 'то есть ', 'да и ', 'но ', 'на укладке'];

/**
 * Интеллектуально нормализует и распределяет реплики по ролям Автоинформатор / Менеджер / Клиент,
 * исправляя ошибочные метки и склеенные предложения.
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
  let firstHumanSeen = false;

  const managerMarkers = markers.manager.map(m => m.toLowerCase());
  const clientMarkers = markers.client.map(m => m.toLowerCase());

  for (let i = 0; i < splitItems.length; i++) {
    const item = splitItems[i];
    const phrase = item.text;
    const lower = phrase.toLowerCase();

    if (item.forcedSpeaker === 'Автоинформатор' || isIvrUtterance(phrase)) {
      result.push(`Автоинформатор: ${phrase}`);
      // Автоинформатор не меняет состояние очередности живых говорящих
      continue;
    }

    if (item.forcedSpeaker) {
      result.push(`${item.forcedSpeaker}: ${phrase}`);
      prevSpeaker = item.forcedSpeaker;
      firstHumanSeen = true;
      continue;
    }

    const hasSalonOrAdminWord = /(?:салон|студи|администратор|фэшн|fashion|лик\s*28)/iu.test(lower);
    const isCallerSelfIntro =
      /(?:меня\s+зовут)/iu.test(lower) && !hasSalonOrAdminWord;
    const isAddressingStaffByName =
      /^[А-ЯЁ][а-яё]+,\s+(?:здравствуйте|добр)/u.test(phrase) && !hasSalonOrAdminWord;

    const isManagerByMarker = managerMarkers.some(m => lower.includes(m));
    const isClientByMarker =
      clientMarkers.some(m => lower.includes(m)) ||
      isCallerSelfIntro ||
      isAddressingStaffByName ||
      /^\+?[0-9\s-]{2,}\.?$/.test(phrase) ||
      /^алло[,\s]+(?:здравствуйте|добрый)/i.test(phrase) ||
      /^нет,\s+.*?надо(?:[^\p{L}]|$)/iu.test(phrase) ||
      /^(?:так[,\s]+)?\d{1,2}(?:-го)?\s*,?\s*а\s+вечерн/iu.test(phrase) ||
      /^в\s+(?:\d{1,2}|шесть|семь|восемь|пять)[,\s]+например/iu.test(phrase);

    // П. 3.7 ТЗ: фраза — продолжение мысли предыдущего спикера (если нет явного конфликта ролей).
    const startsLowercase = /^[а-яёa-z]/.test(phrase);
    const startsWithConnector = CONTINUATION_PREFIXES.some(p => lower.startsWith(p));
    if (
      firstHumanSeen &&
      (startsLowercase || startsWithConnector) &&
      !(prevSpeaker === 'Клиент' && isManagerByMarker && !isClientByMarker) &&
      !(prevSpeaker === 'Менеджер' && isClientByMarker && !isManagerByMarker)
    ) {
      result.push(`${prevSpeaker}: ${phrase}`);
      continue;
    }

    const isFirstHumanGreetingManager =
      !firstHumanSeen &&
      !isClientByMarker &&
      (lower.includes('добрый') || lower.includes('слушаю') || lower.includes('салон') || lower.includes('здравствуйте'));

    const isManager = isManagerByMarker || isFirstHumanGreetingManager;
    const isClient = isClientByMarker;

    let currentSpeaker: 'Менеджер' | 'Клиент';
    if (isManager && !isClient) {
      currentSpeaker = 'Менеджер';
    } else if (isClient && !isManager) {
      currentSpeaker = 'Клиент';
    } else {
      currentSpeaker = prevSpeaker === 'Менеджер' ? 'Клиент' : 'Менеджер';
    }

    firstHumanSeen = true;
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
  if (lines.length === 0) return raw;

  // Извлекаем чистые фразы и удаляем подряд идущие дубликаты
  const cleanPhrases: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const textOnly = lines[i].replace(/^(Менеджер:|Клиент:|Администратор:|Оператор:|Автоинформатор:|Неизвестный:)\s*/i, '').trim();
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

  // Применяем ролевую диаризацию и сплит склеенных предложений (в т.ч. для однострочных стенограмм)
  return refineTranscriptRoles(cleanPhrases.join('\n'), markers);
}
