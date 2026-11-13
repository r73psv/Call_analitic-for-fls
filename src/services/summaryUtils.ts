/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { StructuredCallSummary, KeyFacts } from '../types.js';
import { stripIvrFromTranscript } from './transcriptUtils.js';

export type CallIntentCategory =
  | 'not_happened'
  | 'non_client'
  | 'late_or_visit_update'
  | 'reschedule_or_cancel'
  | 'dispute'
  | 'refusal_unavailable_service'
  | 'declined'
  | 'confirmed_booking'
  | 'consultation';

export interface CallContextClassification {
  category: CallIntentCategory;
  cleanTranscript: string;
  isNonClient: boolean;
  isLateWarning: boolean;
  isUnavailableServiceRefusal: boolean;
  isRescheduleOrCheck: boolean;
  isDispute: boolean;
  isDeclined: boolean;
  isConfirmedBooking: boolean;
  lateMinutes: string | null;
  nonClientTopic: string | null;
}

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
  'не указан', 'не указана', 'не выбран', 'не выбрана', 'неизвестно', 'неизвестен',
  'продукции', 'продукция', 'матрикс', 'матриксе', 'экспресс', 'локоны', 'стрижку',
  'подруга', 'подруге', 'подругой', 'подружка', 'подружкой', 'девушка', 'девушки',
  'данный', 'слушаю', 'загрузит', 'верно', 'свободно', 'вечернее', 'дневное'
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
 * Классифицирует тип и фактический исход звонка строго по очищенному от IVR транскрипту.
 */
export function classifyCallContext(
  transcript: string,
  rawSummary?: string,
  existingKeyFacts?: Partial<KeyFacts>,
  existingBookingStatus?: string
): CallContextClassification {
  const cleanTranscript = stripIvrFromTranscript(transcript || '');
  const tLower = cleanTranscript.toLowerCase();
  const sLower = (rawSummary || '').toLowerCase();

  // Разделяем явные реплики клиента и менеджера (если диаризация уже выполнена)
  const clientLines = cleanTranscript
    .split('\n')
    .filter(l => /^(?:клиент|гость)\s*:/i.test(l.trim()))
    .map(l => l.replace(/^(?:клиент|гость)\s*:\s*/i, '').trim())
    .join(' ');
  const managerLines = cleanTranscript
    .split('\n')
    .filter(l => /^(?:менеджер|администратор|оператор)\s*:/i.test(l.trim()))
    .map(l => l.replace(/^(?:менеджер|администратор|оператор)\s*:\s*/i, '').trim())
    .join(' ');
  const hasExplicitRoles = clientLines.length > 0 && managerLines.length > 0;

  // 1. Состоялся ли разговор
  const hasDialogueWords = cleanTranscript.replace(/^(?:Менеджер|Клиент|Администратор|Оператор)\s*:\s*/gim, '').trim().length >= 8;
  const isNotHappened =
    !hasDialogueWords ||
    (!hasExplicitRoles && /разговор не состоялся|звонок не состоялся|диалог отсутствует|автоответчик|голосовая почта|оставьте сообщение после сигнала/i.test(tLower)) ||
    (!hasDialogueWords && /разговор не состоялся|диалог отсутствует/i.test(sLower));

  if (isNotHappened) {
    return {
      category: 'not_happened',
      cleanTranscript,
      isNonClient: false,
      isLateWarning: false,
      isUnavailableServiceRefusal: false,
      isRescheduleOrCheck: false,
      isDispute: false,
      isDeclined: false,
      isConfirmedBooking: false,
      lateMinutes: null,
      nonClientTopic: null,
    };
  }

  // 2. Предупреждение об опоздании / корректировка времени явки
  const isLateWarning = /(?:опозда[юе]|задерж(?:усь|иваюсь)|предупредить[^.\n]{0,30}опозд|не успева[юе])/iu.test(cleanTranscript);
  const lateMatch = cleanTranscript.match(/(?:опозда[юе]|задерж[а-яё]*)\s+(?:на\s+)?(?:минут\s+(?:на\s+)?)?(\d{1,3})|на\s+(\d{1,3})\s+минут/iu);
  const lateMinutes = lateMatch ? `${lateMatch[1] || lateMatch[2]} мин` : null;

  // 3. Нецелевой / партнёрский / организационный звонок (без запроса бьюти-услуг)
  const hasBeautyServiceTalk = /(?:маникюр|педикюр|макияж|укладк|стрижк|окрашиван|завивк|брови|ресниц|пилинг|массаж|депиляц|эпиляц|кератин|ботокс|косметолог|процедур|покрыти|шеллак|гель-лак|опоздаю|хочу записаться|хотела записаться|свободное время|сколько стоит)/iu.test(cleanTranscript);
  const hasPartnerOrOrgCue = /(?:билет[а-яё]*|концерт|курьер|доставк|посылк|реклам|сотрудничеств|коммерческ[а-яё]+\s+предложени[а-яё]*|ошиблись номером|в\s+ватсап[е]?\s+вам\s+прислал|прислал\s+для\s+вашего\s+салона|личн[а-яё]+\s+вопрос)/iu.test(cleanTranscript);
  const isNonClient = hasPartnerOrOrgCue && !hasBeautyServiceTalk;

  let nonClientTopic: string | null = null;
  if (isNonClient) {
    if (/билет|концерт/i.test(cleanTranscript)) {
      nonClientTopic = /ватсап|whatsapp/i.test(cleanTranscript)
        ? 'передача пригласительных билетов на концерт (отправлено в WhatsApp)'
        : 'предложение билетов на концерт';
    } else if (/доставк|курьер|посылк/i.test(cleanTranscript)) {
      nonClientTopic = 'организационный звонок по доставке';
    } else if (/реклам|сотрудничеств|коммерческ/i.test(cleanTranscript)) {
      nonClientTopic = 'коммерческое / партнёрское предложение';
    } else {
      nonClientTopic = 'организационное / личное обращение, не связанное с услугами салона';
    }
  }

  // 4. Претензия / спор (без ложного срабатывания на отмену одного из двух слотов)
  const isDispute =
    Boolean(existingKeyFacts?.is_dispute) ||
    /(?:жалоб|претензи|недовол|издеваетесь|криво|испортили|верните деньги|ужасно|отвратительн)/iu.test(cleanTranscript);

  // 5. Запрос отсутствующей услуги и отказ от альтернативы
  const salonHasNoSuchService = /(?:нет такой услуги|такой услуги нет|мы не (?:делаем|выполняем)|в\s+нашем\s+салоне\s+[а-яё\s]{0,30}(?:выполняется|делается|только)|у\s+нас\s+(?:в\s+(?:нашем\s+)?салоне\s+)?[а-яё\s]{0,30}(?:выполняется|именно\s+химическ|только))/iu.test(cleanTranscript);
  const callerTextForRefusal = clientLines || cleanTranscript;
  const hasExplicitRefusal = /(?:не будет в городе|не смогу|не получается|не подходит|неудобно|не удобно|дорого|передумал|тогда не надо|(?:^|[^\p{L}])нет,\s+[^\n.!?]{1,40}(?:надо|нужно|хотелось бы|искала)(?:[^\p{L}]|$)|нет,\s*спасибо)/iu.test(callerTextForRefusal);
  const isUnavailableServiceRefusal = salonHasNoSuchService && (hasExplicitRefusal || !/(?:давайте|запишите|записывайте|хорошо,?\s*запишите)/iu.test(callerTextForRefusal));

  // 6. Перенос / проверка / корректировка существующей записи
  const isRescheduleOrCheck =
    !isLateWarning &&
    /(?:перенести запись|перенос|у меня\s+(?:вот\s+)?запись|уточнить запись|проверить запись|оставляем\s+все|на\s+\d+\s+(?:я\s+)?оставляю.*убираю|отменить запись)/iu.test(cleanTranscript);

  // 7. Отказ (общий)
  const rawBooking = (existingBookingStatus || existingKeyFacts?.booking_status || '').toLowerCase().trim();
  const outcome = (existingKeyFacts?.call_outcome || '').toLowerCase().trim();
  const clientConfirmedAtEnd =
    /(?:да,\s*(?:отлично|давайте|записывайте|подойд[её]т|хорошо)|на\s+\d{1,2}\s+(?:я\s+)?оставляю|оставьте тогда|подтверждаю запись|давайте я продиктую|угу,?\s*хорошо(?:[.,\s]+до свидания)?)/iu.test(callerTextForRefusal) ||
    /(?<!не\s)(?:записала|записываю|записал|записали|записываем)\s+вас/iu.test(managerLines || cleanTranscript);

  const isDeclined =
    !isNonClient &&
    !isLateWarning &&
    (isUnavailableServiceRefusal ||
      (hasExplicitRefusal && !clientConfirmedAtEnd) ||
      (!clientConfirmedAtEnd && (rawBooking === 'отказ' || outcome === 'отказ')));

  // 8. Подтверждённая запись (СТРОГО по живому диалогу, БЕЗ IVR и БЕЗ «предложить запись» при отказе!)
  const managerEffectiveForBooking = managerLines || cleanTranscript;
  const hasRealBookingActionInTranscript =
    /(?<!не\s)(?:записала(?:\s+вас)?|записываю(?:\s+вас)?|записал(?:\s+вас)?|записали(?:\s+вас)?|запишем(?:\s+вас)?|записываем(?:\s+вас)?|вы\s+записаны|запись\s+(?:успешно\s+)?(?:подтверждаем|подтверждена|оформлена)|на\s+\d{1,2}(?::\d{2})?\s+(?:я\s+)?оставляю|оставляем\s+все|договорились\s+(?:на|в)|жду\s+вас\s+(?:завтра|сегодня|в\s+\d))/iu.test(managerEffectiveForBooking) ||
    (/(?:запишите|давайте\s+на\s+\d|подойд[её]т|согласна|согласен|давайте я продиктую)/iu.test(callerTextForRefusal) &&
      /(?:запис|жд[её]м|ожида|подтвержд|хорошо)/iu.test(managerEffectiveForBooking));

  const isConfirmedBooking =
    !isNonClient &&
    !isLateWarning &&
    !isDeclined &&
    !isUnavailableServiceRefusal &&
    hasRealBookingActionInTranscript;

  let category: CallIntentCategory = 'consultation';
  if (isNonClient) category = 'non_client';
  else if (isLateWarning) category = 'late_or_visit_update';
  else if (isDispute) category = 'dispute';
  else if (isUnavailableServiceRefusal) category = 'refusal_unavailable_service';
  else if (isDeclined) category = 'declined';
  else if (isRescheduleOrCheck) category = 'reschedule_or_cancel';
  else if (isConfirmedBooking) category = 'confirmed_booking';
  else category = 'consultation';

  return {
    category,
    cleanTranscript,
    isNonClient,
    isLateWarning,
    isUnavailableServiceRefusal,
    isRescheduleOrCheck,
    isDispute,
    isDeclined,
    isConfirmedBooking,
    lateMinutes,
    nonClientTopic,
  };
}

/**
 * Извлекает 4 параметра сути обращения (услуга, дата, время, мастер)
 * из текста транскрипта и/или существующего резюме (предварительно очищая от IVR).
 */
export function extractEssenceDetails(
  transcript: string,
  existingSummary?: string,
  customSalonName?: string
): EssenceDetails {
  const cleanTranscript = stripIvrFromTranscript(transcript || '');
  const cleanExisting = existingSummary && !/Клиент обратился в салон красоты по вопросам обслуживания и записи/i.test(existingSummary)
    ? existingSummary
    : '';
  const combined = `${cleanTranscript}\n${cleanExisting}`;

  const singleServicePatterns: [RegExp, string][] = [
    [/(?:цифров[а-яё]*|японск[а-яё]*)\s+завивк[а-яё]*(?:\s+волос)?/iu, 'цифровая (японская) завивка волос'],
    [/(?:химическ[а-яё]*|био)?завивк[а-яё]*(?:\s+волос)?/iu, 'завивка волос'],
    [/(?:аппаратн[а-яё]*\s+)?маникюр[а-яё]*\s+и\s+педикюр[а-яё]*(?:\s+с\s+покрытием)?/iu, 'маникюр и педикюр с покрытием'],
    [/(?:аппаратн[а-яё]*\s+)?маникюр[а-яё]*(?:\s+с\s+покрытием(?:\s+шеллак|\s+гель-лак)?)?/iu, 'маникюр с покрытием'],
    [/педикюр[а-яё]*(?:\s+с\s+покрытием)?/iu, 'педикюр с покрытием'],
    [/стрижк[а-яё]*\s+и\s+окрашиван[а-яё]*/iu, 'стрижка и окрашивание'],
    [/стрижк[а-яё]*\s+и\s+укладк[а-яё]*/iu, 'стрижка и укладка'],
    [/макияж[а-яё]*\s+и\s+укладк[а-яё]*/iu, 'макияж и укладка'],
    [/укладк[а-яё]*\s+и\s+макияж[а-яё]*/iu, 'макияж и укладка'],
    [/стрижк[а-яё]*/iu, 'стрижка'],
    [/окрашиван[а-яё]*(?:\s+волос)?/iu, 'окрашивание волос'],
    [/макияж[а-яё]*/iu, 'макияж'],
    [/укладк[а-яё]*/iu, 'укладка'],
    [/мелирован[а-яё]*/iu, 'мелирование'],
    [/коррекц[а-яё]*\s+бровей|архитектур[а-яё]*\s+бровей|окрашивание\s+бровей|брови/iu, 'коррекция бровей'],
    [/наращиван[а-яё]*\s+ресниц|ламинирован[а-яё]*\s+ресниц|ресниц[а-яё]*/iu, 'ресницы'],
    [/косметолог[а-яё]*|чистк[а-яё]*\s+лица|пилинг/iu, 'прием косметолога'],
    [/массаж[а-яё]*/iu, 'массаж'],
    [/депиляц[а-яё]*|шугаринг|эпиляц[а-яё]*/iu, 'депиляция'],
    [/кератин[а-яё]*|ботокс[а-яё]*\s+(?:для\s+)?волос/iu, 'уход для волос']
  ];

  const matchServiceLabel = (text: string): string | null => {
    for (const [pattern, label] of singleServicePatterns) {
      if (pattern.test(text)) {
        return label;
      }
    }
    return null;
  };

  // 1. Услуга (приоритет: явное подтверждение брони в стенограмме -> активный запрос без реплик о прошлом визите -> общий анализ)
  let service: string | null = null;
  const bookedServiceConfirmMatches = [
    ...cleanTranscript.matchAll(/(?:необходимо|нужно)\s+будет\s+(?:только\s+)?([^.!?\n]{3,45})/giu),
    ...cleanTranscript.matchAll(/([^.!?\n]{3,45}?)(?:\s+[А-ЯЁ][а-яё]+)?(?:\s+на\s+продукции[^.!?\n]+)?\s+по\s+стоимости\s+\d{3,5}\s*(?:р|руб|₽)[^.!?\n]*(?:записали|записала|записываю)/giu),
  ];
  for (const m of bookedServiceConfirmMatches) {
    const candidate = matchServiceLabel(m[1]);
    if (candidate) {
      service = candidate;
      break;
    }
  }

  if (!service && cleanTranscript.trim().length > 0) {
    // Отфильтровываем воспоминания о прошлом визите ("4 мая я была на укладке и макияж"), если дальше обсуждается новая услуга
    const nonPastTranscript = cleanTranscript
      .split('\n')
      .filter(line => !/(?:была\s+(?:на|у)|укладывала|делала)\b/iu.test(line) || /запис|стоимост|необходимо\s+будет|стрижк/iu.test(line))
      .join('\n');

    if (/маникюр/i.test(nonPastTranscript) && /педикюр/i.test(nonPastTranscript)) {
      service = 'маникюр и педикюр с покрытием';
    } else if (/макияж/i.test(nonPastTranscript) && /укладк/i.test(nonPastTranscript)) {
      service = 'макияж и укладка';
    } else {
      service = matchServiceLabel(nonPastTranscript) || matchServiceLabel(cleanTranscript);
    }
  }

  if (!service) {
    const serviceSummaryMatch = cleanExisting?.match(/(?:услуга|процедура)\s*[—–:\-]\s*([^,\n;.]+)/iu);
    if (serviceSummaryMatch && !/не указан|не применим/i.test(serviceSummaryMatch[1])) {
      service = serviceSummaryMatch[1].trim();
    }
  }

  // 2. Дата (оцениваем все даты в стенограмме: подтверждение записи побеждает прошлое воспоминание вроде «4 мая я была»)
  let date: string | null = null;
  const monthDateRe = /(?:^|[^\p{L}\d])(\d{1,2}(?:-[а-яё]+)?\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+(?:в\s+)?(?:понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье))?)(?=[^\p{L}\d]|$)/giu;
  const dateCandidates: { value: string; score: number; index: number }[] = [];

  for (const dm of cleanTranscript.matchAll(monthDateRe)) {
    const val = dm[1].trim();
    const idx = dm.index ?? 0;
    const before = cleanTranscript.slice(Math.max(0, idx - 60), idx).toLowerCase();
    const after = cleanTranscript.slice(idx, Math.min(cleanTranscript.length, idx + val.length + 75)).toLowerCase();
    const windowCtx = `${before} ${after}`;

    let s = 0;
    if (/(?:записали|записала|записываю|вы\s+записаны|подтверждаем|оформлена|оставляю|подойд[её]т)/iu.test(windowCtx)) {
      s += 10;
    }
    if (/(?:предложить|ближайшее|свободн|слоты|есть\s+(?:дневное|вечернее|время))/iu.test(windowCtx)) {
      s += 6;
    }
    if (/(?:была|был[аи]?|приходила|делала|укладывала|в\s+прошлом|год\s+назад)/iu.test(windowCtx)) {
      s -= 12;
    }
    dateCandidates.push({ value: val, score: s, index: idx });
  }

  if (dateCandidates.length > 0) {
    dateCandidates.sort((a, b) => (b.score !== a.score ? b.score - a.score : b.index - a.index));
    date = dateCandidates[0].value;
  } else {
    const rel = cleanTranscript.match(/(?:^|[^\p{L}\d])(сегодня|завтра|послезавтра|в\s+понедельник|во\s+вторник|в\s+среду|в\s+четверг|в\s+пятницу|в\s+субботу|в\s+воскресенье|на\s+выходных|на\s+выходные)(?:[^\p{L}\d]|$)/iu);
    if (rel) {
      date = rel[1].trim();
    } else {
      const dateSummaryMatch = cleanExisting?.match(/дата\s*[—–:\-]\s*([^,\n;.]+)/iu);
      if (dateSummaryMatch && !/не указан|не применим/i.test(dateSummaryMatch[1])) {
        date = dateSummaryMatch[1].trim();
      }
    }
  }

  // 3. Время (защищено от ложного захвата длительности «на минут 15», «4 билета» и т.п.)
  let time: string | null = null;
  const textWithoutDurations = combined
    .replace(/(?:на\s+)?минут\s+(?:на\s+)?\d+/giu, '')
    .replace(/\d+\s+минут[а-яё]*/giu, '')
    .replace(/\d+\s+билет[а-яё]*/giu, '');

  const normalizeSlot = (rawSlot: string): string => {
    const s = rawSlot.trim();
    if (s.includes(':')) {
      const [h, m] = s.split(':');
      return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
    }
    if (/\s/.test(s)) {
      const parts = s.split(/\s+/);
      const mmRaw = parts.slice(1).join('');
      const mm = mmRaw === '0' || mmRaw === '00' ? '00' : mmRaw.padStart(2, '0');
      return `${parts[0].padStart(2, '0')}:${mm}`;
    }
    return `${s.padStart(2, '0')}:00`;
  };

  const keptMatch = textWithoutDurations.match(/(?:на|в)\s+([012]?\d(?::[0-5]\d|\s+[0-5]\d)?)\s*(?:я\s+)?(?:оставляю|оставьте|подтверждаю)/iu) ||
                    textWithoutDurations.match(/(?:оставьте|оставляю)\s+(?:на\s+|в\s+)?([012]?\d(?::[0-5]\d|\s+[0-5]\d)?)/iu);
  const directBookedTimeMatch = cleanTranscript.match(/(?:на|в)\s+([012]?\d(?:\s*:\s*[0-5]\d|\s+(?:[0-5]\d|0\s+0)))\s*(?:я\s+вас\s+|вас\s+)?(?:записал[аи]?|записываю|вы\s+записаны)/iu);

  if (keptMatch) {
    time = normalizeSlot(keptMatch[1]);
  } else if (directBookedTimeMatch) {
    time = normalizeSlot(directBookedTimeMatch[1]);
  } else {
    const agreed = [...cleanTranscript.matchAll(/(?:давайте|запишите|записала|записали|буду|в|на|к)\s+([012]?\d)(?:\s*:\s*|\s+)([0-5]\d|0\s+0)\b/gi)];
    if (agreed.length > 0) {
      const last = agreed[agreed.length - 1];
      const hh = last[1].padStart(2, '0');
      const mmRaw = last[2].replace(/\s+/g, '');
      const mm = mmRaw === '0' || mmRaw === '00' ? '00' : mmRaw;
      if (Number(hh) <= 23) {
        time = `${hh}:${mm}`;
      }
    } else {
      const anySpaced = [...cleanTranscript.matchAll(/\b([012]?\d)\s+([0-5]\d|0\s+0)\b/gi)];
      if (anySpaced.length > 0) {
        const m = anySpaced[anySpaced.length - 1];
        const hh = m[1].padStart(2, '0');
        const mmRaw = m[2].replace(/\s+/g, '');
        const mm = mmRaw === '0' || mmRaw === '00' ? '00' : mmRaw;
        if (Number(hh) <= 23) {
          time = `${hh}:${mm}`;
        }
      } else {
        const std = cleanTranscript.match(/\b([012]?\d:[0-5]\d)\b/);
        if (std) {
          time = std[1];
        } else {
          const wordTime = cleanTranscript.match(/(?:^|[^\p{L}\d])(?:в|на)\s+([012]?\d)\s+(?:часов|часа)(?:[^\p{L}\d]|$)/iu);
          if (wordTime && Number(wordTime[1]) <= 23) {
            time = `${wordTime[1].padStart(2, '0')}:00`;
          } else if (/(?:^|[^\p{L}\d])к\s+часу(?:[^\p{L}\d]|$)/iu.test(cleanTranscript)) {
            time = '13:00';
          }
        }
      }
    }
    if (!time) {
      const timeSummaryMatch = cleanExisting?.match(/время\s*[—–:\-]\s*([^,\n;.]+)/iu);
      if (timeSummaryMatch && !/не указан|не применим/i.test(timeSummaryMatch[1])) {
        time = timeSummaryMatch[1].trim();
      }
    }
  }

  // 4. Мастер (приоритет: мастер, связанный с записью/расписанием, а не случайные упоминания из прошлого визита)
  let master: string | null = null;
  const cleanTranscriptForMaster = cleanTranscript
    .replace(/(?:салон[а-яё\s]*)?(?:фэшн\s+лук\s+студио|fashion\s+look\s+studio)/gi, '')
    .replace(/фэшн\s+лук\s+студио/gi, '');

  const masterCandidates: { name: string; score: number; index: number }[] = [];
  const pushMasterCandidate = (rawName: string, score: number, index: number) => {
    const norm = normalizeMasterName(rawName);
    if (norm && isMasterNameValid(norm)) {
      masterCandidates.push({ name: norm, score, index });
    }
  };

  // а) ФИО из 2 слов с «к / у» (допускаем строчную фамилию в STT: «к кожевниковой Екатерине»)
  for (const match of cleanTranscriptForMaster.matchAll(/(?:^|[^\p{L}\d])(?:к|у)\s+(?:мастеру\s+)?([А-ЯЁа-яё]{2,})\s+([А-ЯЁа-яё]{2,})(?=[^\p{L}\d]|$)/gu)) {
    const candidate = `${match[1]} ${match[2]}`;
    const idx = match.index ?? 0;
    const around = cleanTranscriptForMaster.slice(Math.max(0, idx - 50), idx + match[0].length + 50).toLowerCase();
    let s = 5;
    if (/записа|хотели бы|работает|свободн/i.test(around)) s += 10;
    if (/делал[аи]?|приехал/i.test(around)) s -= 4;
    pushMasterCandidate(candidate, s, idx);
  }

  // б) ФИО перед/после статуса расписания («Екатерина Кожевникова не работает» / «Кожевникова Екатерина ... работает»)
  for (const match of cleanTranscriptForMaster.matchAll(/([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+))\s+(?:не\s+работает|работает\s+ещ[её]|свободн)/gu)) {
    pushMasterCandidate(match[1], 14, match.index ?? 0);
  }

  // в) Искаженные SpeechKit фамилии
  const distortedMatch = cleanTranscriptForMaster.match(/(?:будете\s+у|будете|к|у)\s*(у?[а-яё]*[ое]вой)\s+([А-ЯЁ][а-яё]+)/iu);
  if (distortedMatch) {
    pushMasterCandidate(`${distortedMatch[1]} ${distortedMatch[2]}`, 12, distortedMatch.index ?? 0);
  }

  // г) Явное «мастер X» / «специалист X»
  for (const match of cleanTranscriptForMaster.matchAll(/(?:^|[^\p{L}\d])(?:мастер(?:у|а)?|специалист(?:у|а)?)\s+([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)/gu)) {
    pushMasterCandidate(match[1].trim(), 8, match.index ?? 0);
  }

  // д) Одиночные имена с «к / у / перед слотами / по стоимости»
  for (const match of cleanTranscriptForMaster.matchAll(/(?:запись(?:\s+[^.\n!?]+?)?\s+)?(?:к|у)\s+([А-ЯЁ][а-яё]+)(?=[^а-яё]|$)/gu)) {
    pushMasterCandidate(match[1].trim(), 4, match.index ?? 0);
  }
  const scheduleMatch = cleanTranscriptForMaster.match(/(?:^|[.!?\n])\s*(?:У|у)\s+([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)\s+(?:уже\s+)?(?:перед\s+этим\s+)?(?:все\s+)?(?:забронировано|занято|свободно|есть)/u);
  if (scheduleMatch) {
    pushMasterCandidate(scheduleMatch[1], 7, scheduleMatch.index ?? 0);
  }
  const priceOfferMatch = cleanTranscriptForMaster.match(/(?:^|[^\p{L}\d])(?:у)\s+([А-ЯЁ][а-яё]+)\s+по\s+стоимости/iu);
  if (priceOfferMatch) {
    pushMasterCandidate(priceOfferMatch[1], 7, priceOfferMatch.index ?? 0);
  }

  if (masterCandidates.length > 0) {
    // Отдаем приоритет 2-словному ФИО над одиночным именем и более высокому баллу контекста
    masterCandidates.sort((a, b) => {
      const aFull = a.name.includes(' ') ? 3 : 0;
      const bFull = b.name.includes(' ') ? 3 : 0;
      const totalB = b.score + bFull;
      const totalA = a.score + aFull;
      return totalB !== totalA ? totalB - totalA : b.index - a.index;
    });
    master = masterCandidates[0].name;
  } else {
    const masterSummaryMatch = existingSummary?.match(/мастер\s*[—–:\-]\s*([^,\n;.]+)/iu);
    if (masterSummaryMatch && isMasterNameValid(masterSummaryMatch[1].trim())) {
      master = normalizeMasterName(masterSummaryMatch[1].trim());
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
  const ctx = classifyCallContext(transcript, rawSummary, existingKeyFacts, existingBookingStatus);
  const cleanTranscript = ctx.cleanTranscript;
  const combined = `${rawSummary && !/Клиент обратился в салон красоты по вопросам обслуживания и записи/i.test(rawSummary) ? rawSummary : ''}\n${cleanTranscript}`;

  // 1. Проверка: состоялся ли диалог вообще
  if (ctx.category === 'not_happened') {
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

  // 2. Извлекаем базовые 4 параметра (услуга, дата, время, мастер)
  // Приоритет имеют факты, извлеченные напрямую из стенограммы, чтобы устаревший кэш (например, дата прошлого визита) не блокировал обновление
  const essence = extractEssenceDetails(cleanTranscript, rawSummary, salon);
  const service =
    essence.service ||
    ((existingKeyFacts?.service && !/не указан|не применим/i.test(existingKeyFacts.service))
      ? existingKeyFacts.service
      : null);
  const master =
    essence.master ||
    ((existingKeyFacts?.master && isMasterNameValid(existingKeyFacts.master))
      ? normalizeMasterName(existingKeyFacts.master)
      : null);
  const date =
    essence.date ||
    ((existingKeyFacts?.date && !/не указан|не применим/i.test(existingKeyFacts.date))
      ? existingKeyFacts.date
      : null);
  const time =
    essence.time ||
    ((existingKeyFacts?.time && !/не указан|не применим/i.test(existingKeyFacts.time))
      ? existingKeyFacts.time
      : null);

  // Ветка A: Нецелевой / партнёрский / организационный звонок
  if (ctx.category === 'non_client') {
    const topicLabel = ctx.nonClientTopic || 'организационный / партнёрский вопрос';
    const nextSteps: string[] = [];
    if (/ватсап|whatsapp/i.test(cleanTranscript)) {
      nextSteps.push('Проверить входящее сообщение и вложения в WhatsApp от звонящего');
    }
    if (/билет|концерт/i.test(cleanTranscript)) {
      nextSteps.push('Передать информацию о предложенных билетах команде/управляющему салона');
    } else {
      nextSteps.push(`Передать информацию по организационному вопросу управляющему салона «${salon}»`);
    }
    if (/телефон|перезвон|уточн/i.test(cleanTranscript) || nextSteps.length < 2) {
      nextSteps.push('При необходимости дать обратную связь отправителю в мессенджере');
    }

    return {
      call_purpose: `Организационное / партнёрское обращение (${topicLabel})`,
      requested_service: 'Не применимо (клиентская услуга салона не запрашивалась)',
      offered_master: 'Не применимо',
      offered_price: 'Не применимо',
      offered_date_time: date ? `Упомянута дата: ${date}` : 'Не применимо',
      booking_status_text: 'Не применимо (нецелевой / партнёрский звонок)',
      unbooked_reason: 'Звонок носит организационно-информационный характер и не связан с записью клиента на услуги салона.',
      manager_next_steps: nextSteps
    };
  }

  // Ветка B: Предупреждение клиента об опоздании
  if (ctx.category === 'late_or_visit_update') {
    const delayStr = ctx.lateMinutes ? ` (примерно на ${ctx.lateMinutes})` : '';
    return {
      call_purpose: `Предупреждение клиента об опоздании на действующую запись${delayStr}`,
      requested_service: service || 'Корректировка времени явки по действующей записи',
      offered_master: master || 'По действующей записи клиента',
      offered_price: 'Не обсуждалась (действующая бронь)',
      offered_date_time: time
        ? `Ожидаемое время с учётом задержки: ориентировочно ${time}${delayStr}`
        : `Клиент предупредил о задержке${delayStr}`,
      booking_status_text: 'Действующая запись сохранена (администратор подтвердил ожидание)',
      unbooked_reason: 'Новая запись не оформлялась — клиент уже записан и предупредил о задержке.',
      manager_next_steps: [
        `Отметить в расписании CRM/YClients задержку клиента${delayStr} и актуализировать время явки`,
        `Предупредить мастера${master ? ` (${master})` : ''} о смещении начала визита`,
        'При смещении графика более чем на 15–20 минут проверить и предупредить следующих гостей при необходимости'
      ]
    };
  }

  // Определение контекста для остальных клиентских обращений
  const isReschedule = ctx.isRescheduleOrCheck;
  const isOnlineConfirm = /(?:вы\s+(?:к\s+нам\s+)?записались\s+онлайн|оформлял[аи]?\s+онлайн|подтвердить\s+онлайн(?:\s+|-)?запись|звоню\s+подтвердить)/iu.test(cleanTranscript);
  const isDispute = ctx.isDispute;

  // 1. Цель обращения
  let call_purpose = '';
  if (ctx.isUnavailableServiceRefusal) {
    call_purpose = service
      ? `Запрос услуги «${service}» и подбор доступной альтернативы`
      : 'Запрос отсутствующей в салоне услуги и уточнение альтернатив';
  } else if (isReschedule) {
    const masterStr = master ? ` к мастеру ${master}` : '';
    const dateStr = date ? ` на ${date}` : '';
    call_purpose = `Перенос / корректировка действующей записи${masterStr}${dateStr}`;
  } else if (isOnlineConfirm) {
    const dateStr = date ? ` на ${date}` : '';
    call_purpose = `Подтверждение и корректировка онлайн-записи${dateStr}`;
  } else if (service) {
    const masterStr = master ? ` к мастеру ${master}` : '';
    const hadPastLookup = /(?:напомнить|что\s+за\s+мастер|была\s+\d)/iu.test(cleanTranscript);
    call_purpose = hadPastLookup
      ? `Уточнение мастера по прошлому визиту и запись на услугу «${service}»${masterStr}`
      : `${ctx.isConfirmedBooking ? 'Запись' : 'Запись или консультация'} на услугу «${service}»${masterStr}`;
  } else if (existingKeyFacts?.client_issue && existingKeyFacts.client_issue.length > 5 && !/обращение в салон|консультация \/ обращение/i.test(existingKeyFacts.client_issue)) {
    call_purpose = existingKeyFacts.client_issue;
  } else if (isDispute) {
    call_purpose = 'Обращение по вопросу обслуживания / урегулирование ситуации';
  } else {
    call_purpose = `Справочная консультация по услугам салона «${salon}»`;
  }

  // 2. Какую услугу хотел получить гость
  let requested_service = service || 'Не указана';
  if (!service && isReschedule) {
    requested_service = 'Не указана (корректировка действующей брони)';
  }

  // 3. Какого мастера предложил менеджер
  const offered_master = master || (ctx.isUnavailableServiceRefusal ? 'Не выбирался (услуга отсутствует)' : 'Не выбран');

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
      const genericPrice = cleanTranscript.match(/(?:стоимост[ьи]|стоит|цена|прайс|будет)\s*(?:по\s+стоимости\s*|от\s+)?(\d{3,5})\s*(?:руб|р|рублей|₽)/iu);
      if (genericPrice) {
        const p = Number(genericPrice[1]).toLocaleString('ru-RU');
        priceMatches.push(`${p} ₽`);
      }
    }
  }

  // Информация о предоплате
  const prepayMatch = cleanTranscript.match(/предоплат[а-яё]*\s*(?:50%|\d+%)?\s*(\d{3,5})?\s*(?:р(?![а-яё])|руб[а-яё]*|₽)?(?:\s+на\s+([а-яёa-z\s]+ банк))?/iu);
  if (prepayMatch) {
    const prepayAmount = prepayMatch[1] ? `${Number(prepayMatch[1]).toLocaleString('ru-RU')} ₽` : '50%';
    const bank = prepayMatch[2] ? ` на ${prepayMatch[2].trim()}` : '';
    priceMatches.push(`предоплата ${prepayAmount}${bank}`);
  }

  if (priceMatches.length > 0) {
    offered_price = priceMatches.join('; ');
  }

  // 5. Какие даты и время предложили
  const cleanForSlots = cleanTranscript
    .replace(/(?:на\s+)?минут\s+(?:на\s+)?\d+/giu, '')
    .replace(/\d+\s+минут[а-яё]*/giu, '')
    .replace(/\d+\s+билет[а-яё]*/giu, '')
    .replace(/\d{3,5}\s*(?:руб[а-яё]*|р(?![а-яё])|₽)/giu, '');

  const allSlots: string[] = [];
  const timeMatches = [...cleanForSlots.matchAll(/\b([012]?\d)(?::([0-5]\d)|\s+([0-5]\d|0\s+0))\b/g)];
  for (const tm of timeMatches) {
    const hhNum = Number(tm[1]);
    const mmRaw = (tm[2] || tm[3] || '00').replace(/\s+/g, '');
    const mm = mmRaw === '0' || mmRaw === '00' ? '00' : mmRaw;
    if (hhNum >= 8 && hhNum <= 22 && Number(mm) <= 59) {
      const slot = `${String(hhNum).padStart(2, '0')}:${mm}`;
      if (!allSlots.includes(slot)) {
        allSlots.push(slot);
      }
    }
  }

  let offered_date_time = '';
  const datePart = date || 'Дата не согласована';
  if (ctx.isUnavailableServiceRefusal) {
    offered_date_time = 'Не предлагались (клиент отказался из-за отсутствия нужной услуги)';
  } else if (allSlots.length > 0) {
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

  const isKeptOldBooking = isReschedule && /оставьте тогда|оставляем|сохранить|перед этим все забронировано|занято/i.test(cleanTranscript);
  const isConfirmedReschedule = isReschedule && (
    existingBookingStatus === 'согласие' ||
    /(?:подтверждаем|оставляю|будем вас ожидать|ждем вас|ждём вас|перенесли|записали|оформлена)/iu.test(cleanTranscript)
  );

  if (isKeptOldBooking) {
    booking_status_text = 'Сохранена прежняя запись (перенос не состоялся)';
    unbooked_reason = master
      ? `У мастера ${master} всё предшествующее время уже забронировано; клиент решил оставить действующую бронь без изменений.`
      : 'Всё предшествующее время у мастера уже занято; сохранена исходная бронь.';
  } else if (ctx.category === 'confirmed_booking' || isConfirmedReschedule) {
    booking_status_text = isReschedule
      ? 'Запись скорректирована и подтверждена'
      : 'Запись состоялась (успешно подтверждена)';
    unbooked_reason = 'Запись успешно состоялась';
  } else if (ctx.category === 'refusal_unavailable_service') {
    booking_status_text = 'Запись не состоялась (отказ — запрашиваемая услуга отсутствует)';
    unbooked_reason = `Запрашиваемая услуга${service ? ` («${service}»)` : ''} не выполняется в салоне; клиент отказался от предложенной альтернативной услуги/консультации.`;
  } else if (ctx.category === 'declined') {
    booking_status_text = 'Запись не состоялась (отказ клиента)';
    if (/не будет в городе|уезжа/i.test(cleanTranscript)) {
      unbooked_reason = 'Клиент не сможет прийти в предложенное время из-за отъезда из города.';
    } else if (/дорого|цена|стоимост/i.test(cleanTranscript)) {
      unbooked_reason = 'Клиента не устроила стоимость предложенных услуг.';
    } else {
      unbooked_reason = 'Клиенту не подошло предложенное время или условия визита.';
    }
  } else if (isDispute) {
    booking_status_text = 'Обращение по качеству / спорный вопрос (без новой записи)';
    unbooked_reason = 'Звонок посвящён урегулированию вопроса или претензии клиента.';
  } else {
    booking_status_text = 'Консультация (запись не оформлялась)';
    unbooked_reason = 'Клиент получил справочную информацию без фиксации записи на визит.';
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
  } else if (ctx.category === 'confirmed_booking' || isConfirmedReschedule) {
    const serviceLabel = service ? ` по услуге «${service}»` : '';
    const masterLabel = master ? ` к мастеру ${master}` : '';
    const timeLabel = time ? ` на ${time}` : '';
    const dateLabel = date ? ` ${date}` : '';

    manager_next_steps.push(
      `${isReschedule ? 'Актуализировать бронь' : 'Зафиксировать бронь'} в CRM/YClients${serviceLabel}${masterLabel}${dateLabel}${timeLabel}`
    );
    if (prepayMatch) {
      manager_next_steps.push('Проконтролировать поступление предоплаты и направить чек/подтверждение клиенту');
    }
    manager_next_steps.push(
      'Направить клиенту подтверждение бронирования и геолокацию салона в мессенджер'
    );
    manager_next_steps.push('За 24 часа до визита отправить напоминание для подтверждения явки');
  } else if (ctx.category === 'refusal_unavailable_service') {
    manager_next_steps.push(
      `Зафиксировать в CRM/журнале спроса обращение на отсутствующую услугу${service ? ` («${service}»)` : ''} для передачи управляющему`
    );
    manager_next_steps.push(
      'Если в салоне появится данная услуга или мастер по смежной щадящей технике — оповестить заинтересованных клиентов'
    );
  } else if (ctx.category === 'declined') {
    manager_next_steps.push('Зафиксировать в CRM причину отказа клиента по итогам диалога');
    manager_next_steps.push('При согласии клиента внести контакт в лист ожидания на удобные даты');
  } else if (isDispute) {
    manager_next_steps.push(`Зафиксировать суть обращения в журнале контроля качества и передать управляющему салона «${salon}»`);
    manager_next_steps.push('Связаться с клиентом после разбора ситуации с предоставлением решения');
  } else {
    const serviceTopic = service ? ` («${service}»)` : '';
    manager_next_steps.push(`Создать карточку клиента в CRM с пометкой «Консультация»${serviceTopic}`);
    manager_next_steps.push(`Направить в мессенджер актуальную информацию по запросу и ссылку на онлайн-запись в салон «${salon}»`);
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
