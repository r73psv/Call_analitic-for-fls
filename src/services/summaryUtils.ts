/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { StructuredCallSummary, KeyFacts } from '../types.js';

export interface EssenceDetails {
  service: string | null;
  date: string | null;
  time: string | null;
  master: string | null;
}

export const FORBIDDEN_MASTER_WORDS = new Set([
  // Pronouns
  'меня', 'тебя', 'себя', 'нас', 'вас', 'них', 'им', 'ей', 'ему', 'нам', 'вам',
  'кто', 'что', 'это', 'этот', 'эта', 'эти', 'этого', 'этом', 'тот', 'та', 'то', 'те',
  'мой', 'моя', 'мое', 'моё', 'мои', 'твой', 'наш', 'наша', 'наше', 'наши',
  'ваш', 'ваша', 'ваше', 'ваши', 'свой', 'своя', 'свое', 'какой', 'какая', 'какое',
  'чей', 'никто', 'ничто', 'некоторый', 'все', 'всё', 'весь', 'вся', 'всего', 'всем',
  // Particles & adverbs & conversational words
  'вот', 'вон', 'же', 'ж', 'ли', 'ль', 'бы', 'б', 'даже', 'уже', 'только', 'лишь',
  'еще', 'ещё', 'ведь', 'ну', 'да', 'нет', 'не', 'ни', 'ага', 'угу', 'пожалуй',
  'хорошо', 'ладно', 'ясно', 'понятно', 'точно', 'верно', 'конечно', 'правда',
  'сейчас', 'минуту', 'секунду', 'секундочку', 'пожалуйста', 'спасибо', 'здравствуйте',
  'добрый', 'привет', 'день', 'утро', 'вечер', 'до свидания', 'пока', 'алло', 'ало',
  'просто', 'прямо', 'вроде', 'кстати', 'наверное', 'возможно', 'может',
  // Verbs & verb forms
  'записались', 'записаться', 'записали', 'запишите', 'запишу', 'записан', 'записана', 'записано',
  'запись', 'будете', 'будет', 'буду', 'будем', 'посмотрим', 'посмотри', 'посмотреть',
  'получается', 'получится', 'оставьте', 'оставить', 'оставляю', 'отмените', 'отменить',
  'убираю', 'убрать', 'уточнить', 'уточняю', 'подскажите', 'подсказать', 'спросить',
  'спрашиваю', 'хотела', 'хотел', 'хотите', 'думала', 'думал', 'подойти', 'подойдет',
  'подойдёт', 'перенести', 'перенесите', 'предложить', 'предложили', 'предлагаем',
  'можем', 'могли', 'можете', 'слышно', 'повторить', 'отправить', 'направим',
  'направить', 'найти', 'сказать', 'оплатите', 'оплатить', 'продиктую', 'продиктовать',
  'освещение', 'бронирование', 'бронь', 'позвонили', 'звоню', 'звонить',
  // Salon, services, places, days, months
  'салон', 'студия', 'студио', 'фэшн', 'лук', 'fashion', 'look', 'studio', 'лик', 'beauty',
  'клиент', 'менеджер', 'администратор', 'мастер', 'мастеру', 'мастера', 'специалист',
  'время', 'стоимость', 'стоимости', 'цена', 'цене', 'цену', 'услуга', 'услуги', 'процедура',
  'маникюр', 'педикюр', 'стрижка', 'окрашивание', 'макияж', 'укладка', 'ресницы', 'брови',
  'волосы', 'волосами', 'номер', 'номера', 'телефона', 'канал', 'банк', 'озон', 'ozon',
  'суббота', 'субботу', 'воскресенье', 'понедельник', 'вторник', 'среда', 'среду',
  'четверг', 'пятница', 'пятницу', 'выходной', 'выходные', 'выходных',
  'январь', 'января', 'февраль', 'февраля', 'март', 'марта', 'апрель', 'апреля',
  'май', 'мая', 'июнь', 'июня', 'июль', 'июля', 'август', 'августа',
  'сентябрь', 'сентября', 'октябрь', 'октября', 'ноябрь', 'ноября', 'декабрь', 'декабря',
  'не указан', 'не указана', 'не выбран', 'не выбрана', 'неизвестно', 'неизвестен'
]);

/**
 * Проверяет, является ли строка валидным именем/фамилией мастера,
 * исключая местоимения, частицы, глаголы и служебные слова.
 */
export function isMasterNameValid(name?: string | null): boolean {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 50) return false;

  const lower = trimmed.toLowerCase();

  // Отбрасываем фразы-паразиты, ошибочно попадающие в поле мастера
  if (/(?:меня\s+вот|записались|будете|посмотрим|получается|не\s+выбран|не\s+указан|салон|студио|фэшн|look|studio|fashion)/iu.test(lower)) {
    return false;
  }

  const words = trimmed.split(/[\s,–—\-]+/).filter(Boolean);
  if (words.length === 0 || words.length > 3) return false;

  for (const w of words) {
    const wLower = w.toLowerCase().replace(/[^а-яёa-z]/gi, '');
    if (!wLower || FORBIDDEN_MASTER_WORDS.has(wLower)) {
      return false;
    }
  }

  return true;
}

/**
 * Нормализует имя мастера из разговорной формы / дательного падежа в именительный падеж
 */
export function normalizeMasterName(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let clean = raw.trim()
    .replace(/^(?:к|у|мастеру|мастер|к мастеру|у мастера)\s+/iu, '')
    .replace(/[.,!?;:]+$/g, '')
    .trim();
  if (!clean) return null;

  const rawWords = clean.split(/\s+/).filter(Boolean);
  const normalizedWords: string[] = [];

  for (const word of rawWords) {
    let lower = word.toLowerCase().replace(/[^а-яёa-z]/gi, '');
    if (!lower || FORBIDDEN_MASTER_WORDS.has(lower) || /^\d+$/.test(lower)) {
      continue;
    }

    // Акустические искажения SpeechKit: «уволюовой» -> «валиулова», «увалиуловой» -> «валиулова»
    if (lower.startsWith('увол') && lower.endsWith('овой')) {
      lower = 'валиулова';
    } else if (lower.startsWith('увал') && lower.endsWith('овой')) {
      lower = 'валиулова';
    } else if (lower === 'волюовой' || lower === 'волюова') {
      lower = 'валиулова';
    }
    // Фамилии в родительном/дательном: Егоровой -> Егорова, Валиуловой -> Валиулова
    else if (lower.endsWith('овой') || lower.endsWith('евой') || lower.endsWith('ёвой') || lower.endsWith('иной') || lower.endsWith('ыной')) {
      lower = lower.slice(0, -2) + 'а';
    } else if (lower.endsWith('ской') || lower.endsWith('цкой')) {
      lower = lower.slice(0, -2) + 'ая';
    }
    // Имена в дательном/винительном:
    else if (lower === 'арене' || lower === 'арине' || lower === 'арена' || lower === 'арины' || lower === 'арены') {
      lower = 'арина';
    } else if (lower === 'кристине' || lower === 'кристины') {
      lower = 'кристина';
    } else if (lower === 'анне' || lower === 'анны') {
      lower = 'анна';
    } else if (lower === 'елене' || lower === 'елены') {
      lower = 'елена';
    } else if (lower === 'ирине' || lower === 'ирины') {
      lower = 'ирина';
    } else if (lower === 'ольге' || lower === 'ольги') {
      lower = 'ольга';
    } else if (lower === 'татьяне' || lower === 'татьяны') {
      lower = 'татьяна';
    } else if (lower === 'марии') {
      lower = 'мария';
    } else if (lower === 'екатерине' || lower === 'екатерины') {
      lower = 'екатерина';
    } else if (lower === 'светлане' || lower === 'светланы') {
      lower = 'светлана';
    } else if (lower === 'наталье' || lower === 'наталии' || lower === 'натальи') {
      lower = 'наталья';
    } else if (lower === 'анастасии') {
      lower = 'анастасия';
    } else if (lower === 'дарье' || lower === 'дарьи') {
      lower = 'дарья';
    } else if (lower === 'юлии') {
      lower = 'юлия';
    } else if (lower === 'полине' || lower === 'полины') {
      lower = 'полина';
    } else if (lower === 'виктории') {
      lower = 'виктория';
    } else if (lower === 'ксении') {
      lower = 'ксения';
    } else if (lower === 'алене' || lower === 'алёне' || lower === 'алены' || lower === 'алёны') {
      lower = 'алёна';
    } else if (lower === 'диане' || lower === 'дианы') {
      lower = 'диана';
    } else if (lower === 'алине' || lower === 'алины') {
      lower = 'алина';
    } else if (lower === 'валерии') {
      lower = 'валерия';
    } else if (lower === 'веронике' || lower === 'вероники') {
      lower = 'вероника';
    } else if (lower === 'марине' || lower === 'марины') {
      lower = 'марина';
    } else if (lower.endsWith('ии') && lower.length > 3) {
      lower = lower.slice(0, -2) + 'ия';
    } else if (lower.endsWith('е') && lower.length > 3) {
      lower = lower.slice(0, -1) + 'а';
    } else if (lower.endsWith('ы') && lower.length > 3) {
      lower = lower.slice(0, -1) + 'а';
    }

    const capitalized = lower.charAt(0).toUpperCase() + lower.slice(1);
    normalizedWords.push(capitalized);
  }

  if (normalizedWords.length === 0) return null;
  const result = normalizedWords.join(' ');
  return isMasterNameValid(result) ? result : null;
}

/**
 * Извлекает 4 параметра сути обращения (услуга, дата, время, мастер)
 * из текста транскрипта и/или существующего резюме.
 */
export function extractEssenceDetails(
  transcript: string,
  existingSummary?: string,
  customSalonName?: string
): EssenceDetails {
  const combined = `${existingSummary || ''}\n${transcript || ''}`;

  // 1. Услуга
  let service: string | null = null;
  const serviceSummaryMatch = existingSummary?.match(/(?:услуга|процедура)\s*[—–:\-]\s*([^,\n;.]+)/iu);
  if (serviceSummaryMatch && !serviceSummaryMatch[1].toLowerCase().includes('не указан')) {
    service = serviceSummaryMatch[1].trim();
  } else {
    if (/маникюр/i.test(combined) && /педикюр/i.test(combined)) {
      service = 'маникюр и педикюр с покрытием';
    } else if (/макияж/i.test(combined) && /укладк/i.test(combined)) {
      service = 'макияж и укладка';
    } else {
      const servicePatterns: [RegExp, string][] = [
        [/(?:аппаратн\w*\s+)?маникюр\w*(?:\s+с\s+покрытием(?:\s+шеллак|\s+гель-лак)?)?/iu, 'маникюр с покрытием'],
        [/педикюр\w*(?:\s+с\s+покрытием)?/iu, 'педикюр с покрытием'],
        [/макияж\w*(?:\s+и\s+укладк\w*)?/iu, 'макияж и укладка'],
        [/макияж\w*/iu, 'макияж'],
        [/укладк\w*/iu, 'укладка'],
        [/стрижк\w*(?:\s+и\s+окрашиван\w*)?/iu, 'стрижка и окрашивание'],
        [/стрижк\w*(?:\s+и\s+укладк\w*)?/iu, 'стрижка и укладка'],
        [/окрашиван\w*(?:\s+волос)?/iu, 'окрашивание волос'],
        [/мелирован\w*/iu, 'мелирование'],
        [/коррекц\w*\s+бровей|архитектур\w*\s+бровей|окрашивание\s+бровей|брови/iu, 'коррекция бровей'],
        [/наращиван\w*\s+ресниц|ламинирован\w*\s+ресниц|ресниц\w*/iu, 'ресницы'],
        [/косметолог\w*|чистк\w*\s+лица|пилинг/iu, 'прием косметолога'],
        [/массаж\w*/iu, 'массаж'],
        [/депиляц\w*|шугаринг|эпиляц\w*/iu, 'депиляция'],
        [/кератин\w*|ботокс\w*\s+(?:для\s+)?волос/iu, 'уход для волос']
      ];
      for (const [pattern, label] of servicePatterns) {
        if (pattern.test(combined)) {
          service = label;
          break;
        }
      }
    }
  }

  // 2. Дата
  let date: string | null = null;
  const dateSummaryMatch = existingSummary?.match(/дата\s*[—–:\-]\s*([^,\n;.]+)/iu);
  if (dateSummaryMatch && !dateSummaryMatch[1].toLowerCase().includes('не указан')) {
    date = dateSummaryMatch[1].trim();
  } else {
    const dm = combined.match(/(?:^|[^\p{L}\d])(\d{1,2}(?:-[а-яё]+)?\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+(?:в\s+)?(?:понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье))?)(?:[^\p{L}\d]|$)/iu);
    if (dm) {
      date = dm[1].trim();
    } else {
      const rel = combined.match(/(?:^|[^\p{L}\d])(сегодня|завтра|послезавтра|в\s+понедельник|во\s+вторник|в\s+среду|в\s+четверг|в\s+пятницу|в\s+субботу|в\s+воскресенье|на\s+выходных|на\s+выходные)(?:[^\p{L}\d]|$)/iu);
      if (rel) {
        date = rel[1].trim();
      }
    }
  }

  // 3. Время
  let time: string | null = null;
  const keptMatch = combined.match(/(?:на|в)\s+([012]?\d(?::[0-5]\d|\s+[0-5]\d)?)\s*(?:я\s+)?(?:оставляю|оставьте|подтверждаю)/iu) ||
                    combined.match(/(?:оставьте|оставляю)\s+(?:на\s+|в\s+)?([012]?\d(?::[0-5]\d|\s+[0-5]\d)?)/iu);
  if (keptMatch) {
    const rawSlot = keptMatch[1].trim();
    if (rawSlot.includes(':')) {
      const [h, m] = rawSlot.split(':');
      time = `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
    } else if (rawSlot.includes(' ')) {
      const parts = rawSlot.split(/\s+/);
      time = `${parts[0].padStart(2, '0')}:${parts.slice(1).join('').padStart(2, '0')}`;
    } else {
      time = `${rawSlot.padStart(2, '0')}:00`;
    }
  } else {
    const timeSummaryMatch = existingSummary?.match(/время\s*[—–:\-]\s*([^,\n;.]+)/iu);
    if (timeSummaryMatch && !timeSummaryMatch[1].toLowerCase().includes('не указан')) {
      time = timeSummaryMatch[1].trim();
    } else {
      const agreed = [...combined.matchAll(/(?:давайте|запишите|записала|буду|в|на|к)\s+([012]?\d)(?:\s*:\s*|\s+)([0-5]\d|0\s+0)\b/gi)];
      if (agreed.length > 0) {
        const last = agreed[agreed.length - 1];
        const hh = last[1].padStart(2, '0');
        const mmRaw = last[2].replace(/\s+/g, '');
        const mm = mmRaw === '0' || mmRaw === '00' ? '00' : mmRaw;
        time = `${hh}:${mm}`;
      } else {
        const anySpaced = [...combined.matchAll(/\b([012]?\d)\s+([0-5]\d|0\s+0)\b/gi)];
        if (anySpaced.length > 0) {
          const m = anySpaced[anySpaced.length - 1];
          const hh = m[1].padStart(2, '0');
          const mmRaw = m[2].replace(/\s+/g, '');
          const mm = mmRaw === '0' || mmRaw === '00' ? '00' : mmRaw;
          time = `${hh}:${mm}`;
        } else {
          const std = combined.match(/\b([012]?\d:[0-5]\d)\b/);
          if (std) {
            time = std[1];
          } else {
            const wordTime = combined.match(/(?:^|[^\p{L}\d])(?:в|на)\s+([012]?\d)\s+(?:часов|часа)(?:[^\p{L}\d]|$)/iu);
            if (wordTime) {
              time = `${wordTime[1].padStart(2, '0')}:00`;
            }
          }
        }
      }
    }
  }

  // 4. Мастер
  let master: string | null = null;
  const masterSummaryMatch = existingSummary?.match(/мастер\s*[—–:\-]\s*([^,\n;.]+)/iu);
  if (masterSummaryMatch && isMasterNameValid(masterSummaryMatch[1].trim())) {
    master = normalizeMasterName(masterSummaryMatch[1].trim());
  }

  if (!master) {
    const cleanCombined = combined
      .replace(/(?:салон[а-яё\s]*)?(?:фэшн\s+лук\s+студио|fashion\s+look\s+studio)/gi, '')
      .replace(/фэшн\s+лук\s+студио/gi, '');

    const twoCapsMatches = [...cleanCombined.matchAll(/(?:^|[^\p{L}\d])(?:к|у)\s+([А-ЯЁ][а-яё]+)\s+([А-ЯЁ][а-яё]+)(?=[^\p{L}\d]|$)/gu)];
    for (const match of twoCapsMatches) {
      const candidate = `${match[1]} ${match[2]}`;
      if (isMasterNameValid(candidate)) {
        const norm = normalizeMasterName(candidate);
        if (norm) {
          master = norm;
          break;
        }
      }
    }

    if (!master) {
      const distortedMatch = cleanCombined.match(/(?:будете\s+у|будете|к|у)\s*(у?[а-яё]*[ое]вой)\s+([А-ЯЁ][а-яё]+)/iu);
      if (distortedMatch) {
        const candidate = `${distortedMatch[1]} ${distortedMatch[2]}`;
        const norm = normalizeMasterName(candidate);
        if (norm && isMasterNameValid(norm)) {
          master = norm;
        }
      }
    }

    if (!master) {
      const explicitMatches = [...cleanCombined.matchAll(/(?:^|[^\p{L}\d])(?:мастер(?:у|а)?|специалист(?:у|а)?)\s+([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)/gu)];
      for (const match of explicitMatches) {
        const candidate = match[1].trim();
        if (isMasterNameValid(candidate)) {
          const norm = normalizeMasterName(candidate);
          if (norm) {
            master = norm;
            break;
          }
        }
      }
    }

    if (!master) {
      const singleCapMatches = [...cleanCombined.matchAll(/(?:запись(?:\s+[^.\n!?]+?)?\s+)?(?:к|у)\s+([А-ЯЁ][а-яё]+)(?=[^а-яё]|$)/gu)];
      for (const match of singleCapMatches) {
        const candidate = match[1].trim();
        if (isMasterNameValid(candidate)) {
          const norm = normalizeMasterName(candidate);
          if (norm) {
            master = norm;
            break;
          }
        }
      }
    }

    if (!master) {
      const scheduleMatch = cleanCombined.match(/(?:^|[.!?\n])\s*(?:У|у)\s+([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)\s+(?:уже\s+)?(?:перед\s+этим\s+)?(?:все\s+)?(?:забронировано|занято|свободно|есть)/u);
      if (scheduleMatch && isMasterNameValid(scheduleMatch[1])) {
        master = normalizeMasterName(scheduleMatch[1]);
      }
    }

    if (!master) {
      const priceOfferMatch = cleanCombined.match(/(?:^|[^\p{L}\d])(?:у)\s+([А-ЯЁ][а-яё]+)\s+по\s+стоимости/iu);
      if (priceOfferMatch && isMasterNameValid(priceOfferMatch[1])) {
        master = normalizeMasterName(priceOfferMatch[1]);
      }
    }
  }

  return { service, date, time, master };
}

/**
 * Извлекает 8 обязательных параметров структурированного резюме звонка:
 * 1. Цель обращения
 * 2. Какую услугу хотел получить гость
 * 3. Какого мастера предложил менеджер
 * 4. Какую стоимость озвучили
 * 5. Какие даты и время предложили
 * 6. Состоялась ли запись
 * 7. Если запись не состоялась — по какой причине
 * 8. Какие дальнейшие действия необходимо выполнить менеджеру
 */
export function extractStructuredCallSummary(
  transcript: string,
  rawSummary?: string,
  existingKeyFacts?: Partial<KeyFacts>,
  customSalonName?: string,
  existingBookingStatus?: string
): StructuredCallSummary {
  const salon = (customSalonName || process.env.SALON_NAME || 'Fashion Look Studio').trim();
  const combined = `${rawSummary || ''}\n${transcript || ''}`;
  const lower = combined.toLowerCase();

  // 1. Извлекаем базовые 4 параметра (услуга, дата, время, мастер)
  const essence = extractEssenceDetails(transcript, rawSummary, salon);
  const service = (existingKeyFacts?.service && !existingKeyFacts.service.toLowerCase().includes('не указан'))
    ? existingKeyFacts.service
    : essence.service;
  const master = (existingKeyFacts?.master && isMasterNameValid(existingKeyFacts.master))
    ? normalizeMasterName(existingKeyFacts.master)
    : essence.master;
  const date = (existingKeyFacts?.date && !existingKeyFacts.date.toLowerCase().includes('не указан'))
    ? existingKeyFacts.date
    : essence.date;
  const time = (existingKeyFacts?.time && !existingKeyFacts.time.toLowerCase().includes('не указан'))
    ? existingKeyFacts.time
    : essence.time;

  // Проверка: состоялся ли диалог вообще
  const isNotHappened = /разговор не состоялся|звонок не состоялся|диалог отсутствует|тишина|гудки|сброс/i.test(combined) &&
    !lower.includes('клиент:');

  if (isNotHappened) {
    return {
      call_purpose: 'Попытка вызова (диалог отсутствует)',
      requested_service: 'Не указана',
      offered_master: 'Не выбран',
      offered_price: 'Не озвучивалась',
      offered_date_time: 'Не предложены',
      booking_status_text: 'Разговор не состоялся',
      unbooked_reason: 'Абонент не ответил или звонок оборвался (тишина/гудки/сброс)',
      manager_next_steps: [
        `Повторить попытку дозвона клиенту в рабочее время салона «${salon}»`,
        'Проверить контактный номер в базе CRM'
      ]
    };
  }

  // Определение контекста: перенос, онлайн-запись, первичная запись, спор
  const isReschedule = /перенес|перенести|пораньше|перенос/i.test(combined);
  const isOnlineConfirm = /онлайн(?:\s+|-)?запис|вы к нам записались|подтвержд/i.test(combined);
  const isDispute = Boolean(existingKeyFacts?.is_dispute) || /жалоб|претензи|недоволен|отмен/i.test(combined);

  // 1. Цель обращения
  let call_purpose = '';
  if (existingKeyFacts?.client_issue && existingKeyFacts.client_issue.length > 5 && !existingKeyFacts.client_issue.toLowerCase().includes('обращение в салон')) {
    call_purpose = existingKeyFacts.client_issue;
  } else if (isReschedule) {
    const masterStr = master ? ` к мастеру ${master}` : '';
    const dateStr = date ? ` на ${date}` : '';
    call_purpose = `Перенос действующей записи${masterStr}${dateStr} на более раннее время`;
  } else if (isOnlineConfirm) {
    const dateStr = date ? ` на ${date}` : '';
    call_purpose = `Подтверждение и корректировка онлайн-записи${dateStr}`;
  } else if (service) {
    const masterStr = master ? ` к мастеру ${master}` : '';
    call_purpose = `Запись на услугу «${service}»${masterStr}`;
  } else if (isDispute) {
    call_purpose = 'Обращение по вопросу обслуживания / урегулирование ситуации';
  } else {
    call_purpose = `Консультация и запись на услуги салона «${salon}»`;
  }

  // 2. Какую услугу хотел получить гость
  let requested_service = service || 'Не указана';
  if (!service && isReschedule) {
    requested_service = 'Не указана (перенос действующей брони)';
  }

  // 3. Какого мастера предложил менеджер
  const offered_master = master || 'Не выбран / любой свободный специалист';

  // 4. Какую стоимость озвучили
  let offered_price = 'Не озвучивалась';
  const priceMatches: string[] = [];
  const makeupHairMatch = combined.match(/макияж[^\d]*(\d{3,5})\s*(?:р|руб)?[^\d]*укладк[^\d]*(\d{3,5})\s*(?:р|руб)?/iu);
  if (makeupHairMatch) {
    const p1 = Number(makeupHairMatch[1]).toLocaleString('ru-RU');
    const p2 = Number(makeupHairMatch[2]).toLocaleString('ru-RU');
    priceMatches.push(`Макияж — ${p1} ₽, укладка — ${p2} ₽`);
  } else {
    const maniPediMatch = combined.match(/маникюр[^\d]*(\d{3,5})\s*(?:р|руб)?[^\d]*педикюр[^\d]*(\d{3,5})\s*(?:р|руб)?/iu);
    if (maniPediMatch) {
      const p1 = Number(maniPediMatch[1]).toLocaleString('ru-RU');
      const p2 = Number(maniPediMatch[2]).toLocaleString('ru-RU');
      priceMatches.push(`Маникюр — ${p1} ₽, педикюр — ${p2} ₽`);
    } else {
      const genericPrice = combined.match(/(?:стоимост[ьи]|стоит|цена|прайс|будет)\s*(?:по\s+стоимости\s*)?(\d{3,5})\s*(?:руб|р|рублей|₽)?/iu);
      if (genericPrice) {
        const p = Number(genericPrice[1]).toLocaleString('ru-RU');
        priceMatches.push(`${p} ₽`);
      }
    }
  }

  // Информация о предоплате
  const prepayMatch = combined.match(/предоплат\w*\s*(?:50%|\d+%)?\s*(\d{3,5})?\s*(?:р|руб|рублей|₽)?(?:\s+на\s+([а-яёa-z\s]+ банк))?/iu);
  if (prepayMatch) {
    const prepayAmount = prepayMatch[1] ? `${Number(prepayMatch[1]).toLocaleString('ru-RU')} ₽` : '50%';
    const bank = prepayMatch[2] ? ` на ${prepayMatch[2].trim()}` : '';
    priceMatches.push(`предоплата ${prepayAmount}${bank}`);
  }

  if (priceMatches.length > 0) {
    offered_price = priceMatches.join('; ');
  }

  // 5. Какие даты и время предложили
  const allSlots: string[] = [];
  const timeMatches = [...combined.matchAll(/\b([012]?\d)(?::([0-5]\d)|\s+([0-5]\d|0\s+0))\b/g)];
  for (const tm of timeMatches) {
    const hh = tm[1].padStart(2, '0');
    const mmRaw = (tm[2] || tm[3] || '00').replace(/\s+/g, '');
    const mm = mmRaw === '0' || mmRaw === '00' ? '00' : mmRaw;
    const slot = `${hh}:${mm}`;
    if (!allSlots.includes(slot) && Number(hh) <= 23 && Number(mm) <= 59) {
      allSlots.push(slot);
    }
  }

  let offered_date_time = '';
  const datePart = date || 'Дата не согласована';
  if (allSlots.length > 0) {
    const slotsStr = allSlots.join(', ');
    const agreedStr = time ? ` (согласовано на ${time})` : '';
    offered_date_time = `${datePart}: слоты ${slotsStr}${agreedStr}`;
  } else if (time) {
    offered_date_time = `${datePart} в ${time}`;
  } else if (date) {
    offered_date_time = date;
  } else {
    offered_date_time = 'Не предложены';
  }

  // 6. Состоялась ли запись & 7. Причина, если не состоялась
  let booking_status_text = '';
  let unbooked_reason = '';

  const rawBooking = (existingBookingStatus || existingKeyFacts?.booking_status || '').toLowerCase();
  const outcome = (existingKeyFacts?.call_outcome || '').toLowerCase();

  const isDeclined = rawBooking === 'отказ' || outcome === 'отказ' || /не подходит|не смогу|не будет в городе|отказ/i.test(combined);
  const isKeptOldBooking = isReschedule && /оставьте тогда|оставляем|сохранить|перед этим все забронировано|занято/i.test(combined);
  const isConfirmedBooking = !isDeclined && (rawBooking === 'согласие' || outcome === 'запись' || /записала|записали|подтверждаем|договорились|оставляю|на 9 я оставляю/i.test(combined));

  if (isKeptOldBooking) {
    booking_status_text = 'Сохранена прежняя запись (перенос не состоялся)';
    unbooked_reason = master
      ? `У мастера ${master} всё предшествующее время уже забронировано; клиент решил оставить действующую бронь без изменений.`
      : 'Всё предшествующее время у мастера уже занято; сохранена исходная бронь.';
  } else if (isConfirmedBooking) {
    booking_status_text = 'Запись состоялась (успешно подтверждена)';
    unbooked_reason = 'Запись успешно состоялась';
  } else if (isDeclined) {
    booking_status_text = 'Запись не состоялась (отказ клиента)';
    if (/не будет в городе|уезжа/i.test(combined)) {
      unbooked_reason = 'Клиент не сможет прийти в предложенное время из-за отъезда из города.';
    } else if (/дорого|цена|стоимост/i.test(combined)) {
      unbooked_reason = 'Клиента не устроила стоимость предложенных услуг.';
    } else {
      unbooked_reason = 'Клиенту не подошло предложенное время визита, альтернативные варианты не устроили.';
    }
  } else {
    booking_status_text = 'Консультация (запись не оформлялась)';
    unbooked_reason = 'Клиент обратился за справочной консультацией без фиксации конкретного времени визита.';
  }

  // 8. Какие дальнейшие действия необходимо выполнить менеджеру
  const manager_next_steps: string[] = [];

  if (isKeptOldBooking) {
    manager_next_steps.push(
      `Сохранить в расписании действующую запись клиента на ${date || 'согласованную дату'}${master ? ` к мастеру ${master}` : ''}`
    );
    manager_next_steps.push(
      `Внести клиента в лист ожидания CRM: при освобождении более раннего слота к мастеру ${master || 'специалисту'} предложить перенос`
    );
    manager_next_steps.push('Отправить клиенту контрольное напоминание накануне визита');
  } else if (isConfirmedBooking) {
    const serviceLabel = service ? ` на ${service}` : '';
    const masterLabel = master ? ` к мастеру ${master}` : '';
    const timeLabel = time ? ` на ${time}` : '';
    const dateLabel = date ? ` ${date}` : '';

    manager_next_steps.push(
      `Зафиксировать бронь в CRM/YClients${serviceLabel}${masterLabel}${dateLabel}${timeLabel}`
    );
    if (prepayMatch) {
      manager_next_steps.push('Проконтролировать поступление предоплаты и направить чек/подтверждение клиенту');
    }
    manager_next_steps.push(
      'Направить клиенту подтверждение бронирования, правила подготовки к визиту и геолокацию салона в WhatsApp'
    );
    manager_next_steps.push('За 24 часа до визита отправить смс-напоминание для подтверждения визита');
  } else if (isDeclined) {
    manager_next_steps.push('Зафиксировать в CRM причину отказа клиента (несовпадение по времени/отъезд)');
    manager_next_steps.push('Предложить клиенту альтернативные даты визита или внесение в лист ожидания');
    manager_next_steps.push('Запланировать контрольный контакт через 1–2 недели при появлении новых свободных окон');
  } else {
    manager_next_steps.push('Создать карточку клиента в CRM с пометкой «Консультация» и зафиксировать интерес к услугам');
    manager_next_steps.push(`Направить в мессенджер прайс-лист салона «${salon}» и ссылку на онлайн-запись`);
  }

  return {
    call_purpose,
    requested_service,
    offered_master,
    offered_price,
    offered_date_time,
    booking_status_text,
    unbooked_reason,
    manager_next_steps
  };
}
