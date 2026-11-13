/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CallEvaluationCriterion, CallEvaluation } from '../types.js';
import { stripIvrFromTranscript } from './transcriptUtils.js';
import { classifyCallContext, CallContextClassification } from './summaryUtils.js';

export interface CriterionDefinition {
  id: string;
  name: string;
  shortDescription: string;
  category: 'standard' | 'sales' | 'service';
  iconKey: string;
}

/**
 * 10 обязательных критериев оценки звонка по регламенту салона красоты
 */
export const EVALUATION_CRITERIA_DEFINITIONS: CriterionDefinition[] = [
  {
    id: 'greeting_intro',
    name: 'Приветствие и представление',
    shortDescription: 'Приветствие по стандарту (название салона + имя администратора), доброжелательный тон',
    category: 'standard',
    iconKey: 'greeting'
  },
  {
    id: 'needs_identification',
    name: 'Выявление потребности гостя',
    shortDescription: 'Активное слушание, уточнение желаемой услуги, пожеланий, специфики и удобного времени',
    category: 'standard',
    iconKey: 'needs'
  },
  {
    id: 'service_and_master_presentation',
    name: 'Презентация услуги и мастера',
    shortDescription: 'Экспертное представление специалиста, квалификации, особенностей и длительности процедуры',
    category: 'service',
    iconKey: 'master'
  },
  {
    id: 'price_presentation',
    name: 'Корректная презентация стоимости',
    shortDescription: 'Четкое и уверенное озвучивание цен, состава услуг, условий предоплаты и возможных акций',
    category: 'sales',
    iconKey: 'price'
  },
  {
    id: 'handling_objections',
    name: 'Работа с возражениями',
    shortDescription: 'Отработка сомнений по цене, плотной записи мастера, переубеждение и предложение решений',
    category: 'sales',
    iconKey: 'objections'
  },
  {
    id: 'additional_services',
    name: 'Предложение дополнительных услуг',
    shortDescription: 'Допродажа сопутствующих процедур (снятие, спа-уход, дизайн, оформление бровей, уход)',
    category: 'sales',
    iconKey: 'cross_sell'
  },
  {
    id: 'parallel_booking',
    name: 'Предложение параллельной записи',
    shortDescription: 'Предложение одновременных услуг (в 4 руки), запись для спутника или параллельных процедур',
    category: 'sales',
    iconKey: 'parallel'
  },
  {
    id: 'alternative_options',
    name: 'Предложение альтернативных вариантов',
    shortDescription: 'Вилка времени (2+ слота), альтернативные даты, другие мастера или лист ожидания при занятости',
    category: 'service',
    iconKey: 'alternatives'
  },
  {
    id: 'closing_booking',
    name: 'Закрытие на запись',
    shortDescription: 'Инициатива фиксации брони, четкое проговаривание даты, времени, мастера и подтверждение',
    category: 'sales',
    iconKey: 'closing'
  },
  {
    id: 'communication_quality_closing',
    name: 'Качество коммуникации и завершение разговора',
    shortDescription: 'Грамотная речь, отсутствие слов-паразитов, предупреждение о напоминании и теплое прощание',
    category: 'standard',
    iconKey: 'communication'
  }
];

/**
 * Рассчитывает общий балл строго по применимым критериям.
 * Критерии с is_applicable = false исключаются из знаменателя и НЕ снижают оценку.
 */
export function calculateOverallScore(criteria: CallEvaluationCriterion[]): {
  overallScore: number | null;
  applicableCount: number;
  totalScore: number;
} {
  const applicable = criteria.filter(c => c.is_applicable !== false && typeof c.score === 'number' && !isNaN(c.score));
  const applicableCount = applicable.length;
  if (applicableCount === 0) {
    return { overallScore: null, applicableCount: 0, totalScore: 0 };
  }

  const totalScore = applicable.reduce((acc, c) => acc + (c.score ?? 0), 0);
  const avg = totalScore / applicableCount;
  // Округляем до 1 знака после запятой (например 8.8)
  const overallScore = Math.round(avg * 10) / 10;

  return { overallScore, applicableCount, totalScore };
}

/**
 * Нормализует список критериев и собирает полный объект CallEvaluation
 */
export function buildCallEvaluation(criteriaInput: Partial<CallEvaluationCriterion>[]): CallEvaluation {
  const criteriaMap = new Map<string, Partial<CallEvaluationCriterion>>();
  criteriaInput.forEach(c => {
    if (c.id) criteriaMap.set(c.id, c);
  });

  const normalizedCriteria: CallEvaluationCriterion[] = EVALUATION_CRITERIA_DEFINITIONS.map(def => {
    const found = criteriaMap.get(def.id) || criteriaMap.get(def.name);
    let isApplicable = found?.is_applicable !== undefined ? Boolean(found.is_applicable) : true;
    let score: number | null = null;

    if (isApplicable) {
      if (typeof found?.score === 'number' && !isNaN(found.score)) {
        score = Math.max(0, Math.min(10, Math.round(found.score)));
      } else {
        score = 8;
      }
    } else {
      score = null;
    }

    const explanation = found?.explanation && found.explanation.trim().length > 0
      ? found.explanation.trim()
      : isApplicable
      ? `Критерий «${def.name}» оценен на ${score}/10 по стандартам обслуживания.`
      : `Критерий не применим к специфике данного звонка (не снижает общую оценку).`;

    return {
      id: def.id,
      name: def.name,
      score,
      is_applicable: isApplicable,
      explanation
    };
  });

  const { overallScore, applicableCount } = calculateOverallScore(normalizedCriteria);

  let summaryVerdict = '';
  if (overallScore === null) {
    summaryVerdict = 'Разговор не состоялся или критерии не применимы к диалогу.';
  } else if (overallScore >= 9.0) {
    summaryVerdict = 'Отличная работа администратора: стандарты сервиса и регламент записи соблюдены на высшем уровне.';
  } else if (overallScore >= 7.5) {
    summaryVerdict = 'Хороший диалог: базовая задача решена успешно, есть небольшие точки роста в допродажах и сервисе.';
  } else if (overallScore >= 5.5) {
    summaryVerdict = 'Удовлетворительно: присутствуют ошибки в ведении диалога, отработке возражений или удержании клиента.';
  } else {
    summaryVerdict = 'Требуется обучение: зафиксированы серьезные нарушения скрипта, пассивная позиция или упущенная запись.';
  }

  return {
    overall_score: overallScore,
    max_score: 10,
    applicable_count: applicableCount,
    total_criteria_count: 10,
    criteria: normalizedCriteria,
    summary_verdict: summaryVerdict
  };
}

export interface DialogueUtterances {
  managerText: string;
  clientText: string;
  fullText: string;
}

/**
 * Извлекает реплики менеджера и клиента (без строк автоинформатора) для раздельного фактологического анализа
 */
export function splitSpeakerLines(transcript: string): DialogueUtterances {
  const cleanTranscript = stripIvrFromTranscript(transcript || '');
  const lines = cleanTranscript.split('\n').map(l => l.trim()).filter(Boolean);
  const managerLines: string[] = [];
  const clientLines: string[] = [];

  for (const line of lines) {
    if (/^(?:менеджер|администратор|оператор)\s*:/i.test(line)) {
      managerLines.push(line.replace(/^(?:менеджер|администратор|оператор)\s*:/i, '').trim());
    } else if (/^(?:клиент|гость)\s*:/i.test(line)) {
      clientLines.push(line.replace(/^(?:клиент|гость)\s*:\s*/i, '').trim());
    }
  }

  const managerText = managerLines.join(' ');
  const clientText = clientLines.join(' ');

  return {
    managerText,
    clientText,
    fullText: cleanTranscript
  };
}

/**
 * Извлекает или формирует детальную оценку по 10 критериям
 * СТРОГО на основе содержания разговора без додумывания и фантазий.
 */
export function extractCallEvaluation(
  transcript: string,
  summary: string,
  existingEvaluation?: Partial<CallEvaluation> | null,
  operatorScore?: number | null,
  mistakes?: string[],
  recommendations?: string[],
  customSalonName?: string
): CallEvaluation {
  const ctx: CallContextClassification = classifyCallContext(transcript || '', summary || '');

  // Проверка валидности уже существующей оценки (защита от галлюцинаций и противоречий со стенограммой)
  if (existingEvaluation?.criteria && Array.isArray(existingEvaluation.criteria) && existingEvaluation.criteria.length >= 10) {
    const critMap = new Map(existingEvaluation.criteria.map(c => [c.id, c]));
    const crit6 = critMap.get('additional_services');
    const critParallel = critMap.get('parallel_booking');
    const critAlt = critMap.get('alternative_options');
    const critClosing = critMap.get('closing_booking');
    const critPrice = critMap.get('price_presentation');
    const critMaster = critMap.get('service_and_master_presentation');
    const mistakesStr = (mistakes || []).join(' ').toLowerCase();

    const hasCrossSellContradiction = crit6 && crit6.score === 10 && mistakesStr.includes('сопутствующ');
    const hasWrongClosing10 =
      !ctx.isConfirmedBooking &&
      !ctx.isRescheduleOrCheck &&
      critClosing &&
      critClosing.is_applicable !== false &&
      (critClosing.score ?? 0) >= 8;
    const hasMissedConfirmedClosing =
      ctx.isConfirmedBooking &&
      critClosing &&
      (critClosing.is_applicable === false || (critClosing.score ?? 0) < 8);
    const hasFalseParallelForSingleBooking =
      /(?:необходимо|нужно)\s+будет\s+только\s+[а-яё]+/iu.test(ctx.cleanTranscript) &&
      critParallel &&
      critParallel.is_applicable !== false;
    const hasBadAltMistakeOrLowScore =
      ctx.isConfirmedBooking &&
      critAlt &&
      critAlt.is_applicable !== false &&
      (critAlt.score ?? 0) < 8 &&
      /предложил альтернативн/i.test(critAlt.explanation || '');
    const hasSalesOnNonSalesCall =
      (ctx.isNonClient || ctx.isLateWarning) &&
      (critClosing?.is_applicable !== false || critPrice?.is_applicable !== false || critMaster?.is_applicable !== false);
    const hasFakePriceExplanation =
      critPrice &&
      critPrice.is_applicable !== false &&
      /прайс озвучен без детализации/i.test(critPrice.explanation || '') &&
      !/(?:стоить|рубл|₽|цена|прайс|стоит|стоимость|\d{3,5}\s*р)/iu.test(ctx.cleanTranscript);
    const hasMissedPriceMention =
      /(?:по\s+стоимости|стоит|цена)\s*\d{3,5}\s*(?:р|руб|₽)/iu.test(ctx.cleanTranscript) &&
      critPrice &&
      critPrice.is_applicable !== false &&
      (critPrice.score ?? 0) < 8;

    if (
      !hasCrossSellContradiction &&
      !hasWrongClosing10 &&
      !hasMissedConfirmedClosing &&
      !hasFalseParallelForSingleBooking &&
      !hasBadAltMistakeOrLowScore &&
      !hasSalesOnNonSalesCall &&
      !hasFakePriceExplanation &&
      !hasMissedPriceMention
    ) {
      return buildCallEvaluation(existingEvaluation.criteria);
    }
  }

  // Разговор не состоялся
  if (ctx.category === 'not_happened') {
    const failedCriteria: CallEvaluationCriterion[] = EVALUATION_CRITERIA_DEFINITIONS.map(def => ({
      id: def.id,
      name: def.name,
      score: null,
      is_applicable: false,
      explanation: 'Разговор не состоялся (диалог отсутствует, критерий не применим).'
    }));

    return {
      overall_score: null,
      max_score: 10,
      applicable_count: 0,
      total_criteria_count: 10,
      criteria: failedCriteria,
      summary_verdict: 'Звонок не состоялся: оценка качества оператора не производится.'
    };
  }

  // Разделение реплик говорящих (строго без автоинформатора)
  const { managerText, clientText, fullText } = splitSpeakerLines(ctx.cleanTranscript);
  const managerEffective = managerText || fullText;
  const clientEffective = clientText || fullText;

  // 1. Приветствие и представление (строго по стартовой реплике приветствия менеджера)
  const rawOpeningManager = (managerText || fullText).slice(0, 160).trim();
  const openingManagerText = rawOpeningManager.split(/(?<=[.!?])\s+/)[0] || rawOpeningManager;
  const hasGreeting = /(?:добрый день|здравствуйте|доброе утро|добрый вечер|приветствую|алло)/iu.test(openingManagerText);
  const hasManagerNameIntro = /(?:меня зовут|администратор(?:\s+салона[^.!?]{0,40})?\s+[А-ЯЁа-яё]+|это\s+[А-ЯЁа-яё]+)/iu.test(openingManagerText);
  const hasSalonName = /(?:студи|салон|fashion|фешен|фэшн|лик)/iu.test(openingManagerText);
  const isClippedIntroInStt =
    !hasGreeting &&
    !hasManagerNameIntro &&
    /^[А-ЯЁ][а-яё]+,\s+(?:здравствуйте|добрый)/u.test((clientText || '').trim());

  const greetingCriterion: CallEvaluationCriterion = {
    id: 'greeting_intro',
    name: 'Приветствие и представление',
    is_applicable: !isClippedIntroInStt,
    score: isClippedIntroInStt
      ? null
      : hasGreeting && hasManagerNameIntro && hasSalonName
      ? 10
      : hasManagerNameIntro && hasSalonName
      ? 9
      : hasGreeting && (hasManagerNameIntro || hasSalonName)
      ? 8
      : hasGreeting
      ? 7
      : 4,
    explanation: isClippedIntroInStt
      ? 'Начальное приветствие администратора не попало в расшифровку (звонящая сразу обращается к администратору по имени — критерий не снижает оценку).'
      : hasGreeting && hasManagerNameIntro && hasSalonName
      ? 'Приветствие по полному корпоративному стандарту: названы салон и имя администратора.'
      : hasManagerNameIntro && hasSalonName
      ? 'Администратор представился с названием салона и собственным именем.'
      : hasGreeting && hasManagerNameIntro
      ? 'Приветствие вежливое с указанием имени администратора.'
      : hasGreeting && hasSalonName
      ? 'Приветствие вежливое с названием салона, но администратор не назвал собственное имя.'
      : hasGreeting
      ? 'Приветствие озвучено вежливо, однако в расшифровке не зафиксированы название салона и имя администратора.'
      : 'Приветствие скомкано или не соответствует корпоративному стандарту.'
  };

  // Спец-ветка 1: Нецелевой / партнёрский / организационный звонок (например, билеты в WhatsApp)
  if (ctx.isNonClient) {
    const hasPoliteClosing = /(?:до свидания|всего доброго|хорошего дня|спасибо|пожалуйста|обязательно|прочитаем)/iu.test(managerEffective);
    const acknowledgedAction = /(?:прочитаем|передам|посмотрим|хорошо|спасибо большое)/iu.test(managerEffective);
    const notApp = 'Звонок носит организационный/партнёрский характер (не клиентская запись), критерий не применим (не снижает оценку).';

    return buildCallEvaluation([
      greetingCriterion,
      { id: 'needs_identification', is_applicable: false, score: null, explanation: notApp },
      { id: 'service_and_master_presentation', is_applicable: false, score: null, explanation: notApp },
      { id: 'price_presentation', is_applicable: false, score: null, explanation: notApp },
      { id: 'handling_objections', is_applicable: false, score: null, explanation: notApp },
      { id: 'additional_services', is_applicable: false, score: null, explanation: notApp },
      { id: 'parallel_booking', is_applicable: false, score: null, explanation: notApp },
      { id: 'alternative_options', is_applicable: false, score: null, explanation: notApp },
      { id: 'closing_booking', is_applicable: false, score: null, explanation: notApp },
      {
        id: 'communication_quality_closing',
        is_applicable: true,
        score: hasPoliteClosing && acknowledgedAction ? 9 : (hasPoliteClosing ? 8 : 6),
        explanation: acknowledgedAction
          ? 'Администратор вежливо принял информацию и подтвердил готовность ознакомиться с ней и завершил разговор корректно.'
          : 'Вежливое завершение организационного звонка.'
      }
    ]);
  }

  // Спец-ветка 2: Предупреждение клиента об опоздании по существующей записи
  if (ctx.isLateWarning) {
    const confirmedWaiting = /(?:ничего страшного|будем вас ожидать|будем ждать|ждем вас|хорошо)/iu.test(managerEffective);
    const clarifiedClientOrTime = /(?:как вас зовут|на какое время|к кому вы записаны|ваше имя|подскажите фамилию)/iu.test(managerEffective);
    const notAppLate = 'Клиент позвонил предупредить об опоздании по действующей записи; этап продажи/новой записи не требовался (не снижает оценку).';

    return buildCallEvaluation([
      greetingCriterion,
      { id: 'needs_identification', is_applicable: false, score: null, explanation: notAppLate },
      { id: 'service_and_master_presentation', is_applicable: false, score: null, explanation: notAppLate },
      { id: 'price_presentation', is_applicable: false, score: null, explanation: notAppLate },
      { id: 'handling_objections', is_applicable: false, score: null, explanation: notAppLate },
      { id: 'additional_services', is_applicable: false, score: null, explanation: notAppLate },
      { id: 'parallel_booking', is_applicable: false, score: null, explanation: notAppLate },
      { id: 'alternative_options', is_applicable: false, score: null, explanation: notAppLate },
      { id: 'closing_booking', is_applicable: false, score: null, explanation: notAppLate },
      {
        id: 'communication_quality_closing',
        is_applicable: true,
        score: confirmedWaiting && clarifiedClientOrTime ? 10 : (confirmedWaiting ? 8 : 6),
        explanation: confirmedWaiting && clarifiedClientOrTime
          ? 'Администратор вежливо подтвердил ожидание гостя и уточнил детали существующей записи.'
          : confirmedWaiting
          ? 'Администратор доброжелательно подтвердил ожидание опаздывающего клиента, однако не уточнил имя или точное время действующей записи для отметки в расписании.'
          : 'Ответ на предупреждение об опоздании прозвучал скомканно.'
      }
    ]);
  }

  // Клиентские обращения (первичная запись, перенос, спор, отказ, отсутствие услуги, консультация)
  const isDispute = ctx.isDispute;
  const isRescheduleOrCheck = ctx.isRescheduleOrCheck;

  // 2. Выявление потребности гостя
  const hasNeedsQuestions = /(?:какую услугу|на какую|когда вам|в какое время|в какие дни|какой мастер|что именно|подскажите|хотели бы|планируете|на какое число|какой эффект|какие волосы|на что именно|необходимо будет|верно,?\s*да)/iu.test(managerEffective);

  // 3. Презентация услуги и мастера
  const hasMasterPresented = /(?:мастер|специалист|специализирует|квалификац|ведущий специалист|топ-мастер|опыт|продукци|выполняет|екатерин|лилия|елена|татьяна|арина|наталья|ольга|анна|кристина|ирина)/iu.test(managerEffective);

  // 4. Корректная презентация стоимости
  const hasPriceMention = /(?:стоить|рубл|₽|цена|прайс|стоит|стоимость|\d{3,5}\s*р(?![а-яё]))/iu.test(managerEffective);
  const priceAskedByClient = /(?:сколько стоит|по стоимости|цена|прайс|поч[её]м)/iu.test(clientEffective);
  const isPriceApplicable =
    !isRescheduleOrCheck &&
    (!ctx.isUnavailableServiceRefusal || hasPriceMention || priceAskedByClient) &&
    (ctx.category !== 'consultation' || hasPriceMention || priceAskedByClient);

  // 5. Работа с возражениями
  const hasObjections =
    ctx.isUnavailableServiceRefusal ||
    /(?:дорого|не могу|не успе|не удобн|неудобно|отъезд|не получ|занят|пораньше нельзя|не подходит|почему отменили|издеваетесь|претензи|жалоб|(?:^|[^\p{L}])нет,\s+[^\n.!?]*(?:надо|нужно)(?:[^\p{L}]|$))/iu.test(clientEffective);
  const handledObjectionWell = /(?:могу предложить|давайте посмотрим|лист ожидания|другой мастер|альтернатив|перенесем|в субботу|в воскресенье|скидк|компенсац|извините|понимаем вас|могли бы предложить)/iu.test(managerEffective);

  // 6. Предложение дополнительных услуг (допродажа / сопутствующие процедуры)
  const managerOfferedCrossSell =
    /(?:сняти|со\s+снятием|нужно\s+ли\s+снять|потребуется\s+ли\s+снятие)/iu.test(managerEffective) ||
    /(?:дизайн|будем\s+делать\s+дизайн|с\s+дизайном)/iu.test(managerEffective) ||
    /(?:спа-уход|спа\s+уход|уход\s+для|уходовую|маск|экранирован|ламинирован|пилинг|парафинотерапи|парафин|укреплени)/iu.test(managerEffective) ||
    /(?:могу|можем)\s+(?:также\s+)?предложить\s+(?:вам\s+)?(?:педикюр|маникюр|бров|ресниц|укладк|стрижк|уход|макияж)/iu.test(managerEffective) ||
    /(?:не\s+хотите\s+(?:ли\s+)?добавить|записать\s+вас\s+также\s+на|будем\s+делать\s+также|рекомендую\s+также|предложу\s+вам\s+также|дополнительно\s+можем)/iu.test(managerEffective);

  const isCrossSellApplicable =
    !isDispute &&
    !isRescheduleOrCheck &&
    !ctx.isUnavailableServiceRefusal &&
    ctx.category !== 'declined';

  // 7. Параллельная запись (в 4 руки / для двоих)
  // Не учитываем воспоминания о прошлом визите ("была с подружкой на укладке и макияж") и передачу трубки, если в итоге бронируется одна процедура
  const hasExplicitSingleServiceConfirm = /(?:необходимо|нужно)\s+будет\s+только\s+[а-яё]+/iu.test(ctx.cleanTranscript);
  const activeMultiServiceText = ctx.cleanTranscript
    .split('\n')
    .filter(line => !/(?:была\s+(?:на|у)|укладывала|делала|передам\s+трубку|трубку\s+передам|спрошу\s+подруг)/iu.test(line))
    .join(' ');
  const isMultipleServices =
    !ctx.isUnavailableServiceRefusal &&
    !hasExplicitSingleServiceConfirm &&
    /(?:маникюр\s+и\s+педикюр|педикюр\s+и\s+маникюр|макияж\s+и\s+укладк|укладк[а-яё]*\s+и\s+макияж|2\s+макияжа|два\s+макияжа|вдво[её]м|для\s+подруг[и]|и\s+подруг[у]\s+запис|на\s+двоих|для\s+двоих|2\s+человек)/iu.test(activeMultiServiceText);
  const hasParallelOffer = /(?:в\s+4\s+руки|в\s+четыре\s+руки|одновременно|параллельно|сразу\s+два\s+мастера)/iu.test(managerEffective);

  // 8. Предложение альтернативных вариантов
  const isSlotConflict =
    ctx.isUnavailableServiceRefusal ||
    ctx.category === 'declined' ||
    /(?:занят|забронирован|не\s+работает|нет\s+мест|нет\s+свободного|не\s+могу|не\s+успе|не\s+подходит\s+время|не\s+получается|пораньше\s+нельзя)/iu.test(fullText);
  const hasAlternativesOffered = /(?:или\s+на|есть\s+ещ[её]|могу\s+предложить|могл[иа]\s+бы\s+предложить|можем\s+(?:сейчас\s+)?предложить|самое\s+ближайшее|дневн[а-яё]+\s+время\s+и\s+вечерн|с\s+\d{1,2}[:.]\d{2}\s+до\s+\d{1,2}[:.]\d{2}|любое\s+время\s+можно\s+выбрать|а\s+если|в\s+\d{1,2}:\d{2}\s+или\s+в\s+\d{1,2}:\d{2}|на\s+субботу|на\s+воскресенье|к\s+другому\s+мастеру|лист\s+ожидания|химическ[а-яё]*\s+завивк|запись\s+на\s+консультацию|предложить\s+консультацию)/iu.test(managerEffective);

  // 9. Закрытие на запись
  const hasBookingAttempt = /(?:записываю\s+вас|записала\s+вас|записали\s+вас|запись\s+на\s+консультацию|могли\s+бы\s+предложить\s+запись|подойд[её]т|записать\s+вас|подберем\s+время|жд[её]м\s+вас|запись\s+подтверждаем|оставляем|зафиксировала|записывать\s+на\s+ваш\s+номер)/iu.test(managerEffective);
  const isBookingAgreed = ctx.isConfirmedBooking || (isRescheduleOrCheck && /оставляем|подтверждаем/iu.test(managerEffective));

  // 10. Качество коммуникации и завершение
  const hasPoliteClosing = /(?:до свидания|всего доброго|хорошего дня|ждем вас|спасибо|до встречи|комфортно)/iu.test(managerEffective);
  const hasReminderMention = /(?:напоминание|whatsapp|ватсап|смс|накануне|за полчаса|за 24 часа|сообщени)/iu.test(managerEffective);

  const criteria: CallEvaluationCriterion[] = [
    greetingCriterion,

    // 2. Выявление потребности гостя
    {
      id: 'needs_identification',
      name: 'Выявление потребности гостя',
      is_applicable: true,
      score: hasNeedsQuestions ? 9 : (ctx.isUnavailableServiceRefusal ? 6 : 7),
      explanation: hasNeedsQuestions
        ? 'Администратор задавал уточняющие вопросы, выявляя пожелания гостя по услуге, времени или деталям визита.'
        : ctx.isUnavailableServiceRefusal
        ? 'Запрос клиента зафиксирован с его слов, но уточняющих вопросов (о желаемом результате, типе волос или срочности) не задано.'
        : 'Потребность принята со слов клиента без дополнительных уточняющих вопросов.'
    },

    // 3. Презентация услуги и мастера
    {
      id: 'service_and_master_presentation',
      name: 'Презентация услуги и мастера',
      is_applicable: true,
      score: ctx.isUnavailableServiceRefusal
        ? (hasNeedsQuestions && hasMasterPresented ? 8 : 6)
        : (hasMasterPresented ? 9 : 6),
      explanation: ctx.isUnavailableServiceRefusal
        ? 'Администратор назвал доступную в салоне услугу (химическая завивка) и предложил консультацию, однако не раскрыл особенности процедуры и не представил мастера.'
        : hasMasterPresented
        ? 'Администратор сориентировал клиента по специалисту и/или особенностям выполнения процедуры.'
        : 'В ходе диалога специалист и особенности услуги подробно не презентовались.'
    },

    // 4. Корректная презентация стоимости
    {
      id: 'price_presentation',
      name: 'Корректная презентация стоимости',
      is_applicable: isPriceApplicable,
      score: !isPriceApplicable ? null : (hasPriceMention ? 10 : 6),
      explanation: !isPriceApplicable
        ? (isRescheduleOrCheck
            ? 'Звонок посвящен согласованию расписания действующей записи, озвучивание цен не требовалось (не снижает оценку).'
            : ctx.isUnavailableServiceRefusal
            ? 'Обсуждение стоимости не состоялось: запрашиваемая услуга отсутствует в салоне, и клиент отказался от альтернативы (не снижает оценку).'
            : 'Вопрос стоимости в рамках данного справочного обращения не поднимался (не снижает оценку).')
        : hasPriceMention
        ? 'Стоимость услуг озвучена в ходе разговора.'
        : 'Стоимость услуги/консультации в ходе разговора не была озвучена.'
    },

    // 5. Работа с возражениями
    {
      id: 'handling_objections',
      name: 'Работа с возражениями',
      is_applicable: hasObjections,
      score: hasObjections
        ? (ctx.isUnavailableServiceRefusal
            ? (handledObjectionWell ? 6 : 4)
            : (handledObjectionWell ? 9 : 4))
        : null,
      explanation: hasObjections
        ? ctx.isUnavailableServiceRefusal
          ? 'Клиент настаивал на отсутствующей услуге; администратор предложил альтернативу/консультацию, но не аргументировал преимущества и безопасность доступной методики.'
          : handledObjectionWell
          ? 'Администратор отработал сомнения/претензии гостя и предложил компромиссное решение.'
          : 'Администратор пассивно отреагировал на отказ/сомнения гостя, не предприняв попытки удержания.'
        : 'Возражений со стороны гостя в ходе звонка не возникало (критерий не применим, не снижает общую оценку).'
    },

    // 6. Предложение дополнительных услуг
    {
      id: 'additional_services',
      name: 'Предложение дополнительных услуг',
      is_applicable: isCrossSellApplicable,
      score: !isCrossSellApplicable ? null : (managerOfferedCrossSell ? 10 : 6),
      explanation: !isCrossSellApplicable
        ? (isDispute
            ? 'Звонок посвящен урегулированию претензии, предложение сопутствующих услуг не требовалось (не снижает оценку).'
            : ctx.isUnavailableServiceRefusal || ctx.category === 'declined'
            ? 'Запись на основную услугу не состоялась, допродажа сопутствующих процедур не применима (не снижает оценку).'
            : 'Обращение касается переноса или проверки существующей записи, предложение дополнительных услуг не требовалось (не снижает оценку).')
        : managerOfferedCrossSell
        ? 'Администратор предложил гостю сопутствующие процедуры / дополнительные опции к основной услуге.'
        : 'Сопутствующие процедуры к основной услуге администратором не предлагались.'
    },

    // 7. Предложение параллельной записи
    {
      id: 'parallel_booking',
      name: 'Предложение параллельной записи',
      is_applicable: isMultipleServices,
      score: isMultipleServices ? (hasParallelOffer ? 10 : 6) : null,
      explanation: isMultipleServices
        ? hasParallelOffer
          ? 'Администратор предложил удобную параллельную запись в 4 руки для экономии времени гостя.'
          : 'Клиент бронировал несколько процедур, но опция параллельной записи в 4 руки не предложена.'
        : 'Запрашивалась одиночная процедура, параллельная запись (в 4 руки / для двоих) не требовалась (критерий не применим, не снижает общую оценку).'
    },

    // 8. Предложение альтернативных вариантов
    {
      id: 'alternative_options',
      name: 'Предложение альтернативных вариантов',
      is_applicable: isSlotConflict || !isBookingAgreed,
      score: (isSlotConflict || !isBookingAgreed)
        ? (hasAlternativesOffered
            ? (isBookingAgreed && !ctx.isUnavailableServiceRefusal ? 9 : 7)
            : 4)
        : null,
      explanation: (isSlotConflict || !isBookingAgreed)
        ? ctx.isUnavailableServiceRefusal && hasAlternativesOffered
          ? 'При отсутствии запрошенной техники администратор предложил альтернативную процедуру и консультацию, однако клиент не заинтересовался вариантом.'
          : hasAlternativesOffered && isBookingAgreed
          ? 'При занятости желаемых дат администратор предложил альтернативную дату и выбор слотов времени, успешно согласовав запись.'
          : hasAlternativesOffered
          ? 'Администратор предложил альтернативные варианты времени/услуги.'
          : 'При несовпадении условий администратор не предложил альтернативные дни, слоты, мастеров или смежные решения.'
        : 'Выбранный слот времени сразу подошел клиенту, предложение альтернатив не требовалось (критерий не применим, не снижает оценку).'
    },

    // 9. Закрытие на запись
    {
      id: 'closing_booking',
      name: 'Закрытие на запись',
      is_applicable: true,
      score: isBookingAgreed ? 10 : (hasBookingAttempt ? 5 : 4),
      explanation: isBookingAgreed
        ? 'Запись успешно подтверждена и зафиксирована с согласованием условий визита.'
        : ctx.isUnavailableServiceRefusal
        ? 'Администратор предложил запись на консультацию, но бронь не состоялась из-за отказа клиента от альтернативной услуги.'
        : hasBookingAttempt
        ? 'Попытка закрытия на запись была предпринята, но визит не согласован.'
        : 'Попытка закрытия диалога на запись отсутствовала, бронь не оформлена.'
    },

    // 10. Качество коммуникации и завершение разговора
    {
      id: 'communication_quality_closing',
      name: 'Качество коммуникации и завершение разговора',
      is_applicable: true,
      score: isBookingAgreed
        ? (hasPoliteClosing && hasReminderMention ? 10 : (hasPoliteClosing ? 8 : 6))
        : (hasPoliteClosing ? 8 : 7),
      explanation: isBookingAgreed
        ? hasPoliteClosing && hasReminderMention
          ? 'Вежливый, доброжелательный тон, упомянуто напоминание о визите, разговор завершен на позитивной ноте.'
          : hasPoliteClosing
          ? 'Диалог завершен вежливо, однако регламент напоминания о визите накануне не озвучен.'
          : 'Концовка диалога скомкана, регламент вежливого прощания не соблюден.'
        : 'Коммуникация вежливая и корректная в рамках характера обращения.'
    }
  ];

  return buildCallEvaluation(criteria);
}

/**
 * Синхронизирует список ошибок (mistakes) и советов (advice) с критериями оценки.
 * Гарантирует отсутствие противоречий и навязанных шаблонов, не относящихся к диалогу.
 */
export function harmonizeMistakesAndEvaluation(
  inputMistakes: string[] = [],
  inputAdvice: string[] = [],
  evaluation: CallEvaluation,
  transcript?: string
): {
  mistakes: string[];
  advice: string[];
} {
  const ctx = transcript ? classifyCallContext(transcript) : null;
  const criteriaMap = new Map<string, CallEvaluationCriterion>();
  (evaluation.criteria || []).forEach(c => criteriaMap.set(c.id, c));

  const critCrossSell = criteriaMap.get('additional_services');
  const critParallel = criteriaMap.get('parallel_booking');
  const critAlternatives = criteriaMap.get('alternative_options');
  const critObjections = criteriaMap.get('handling_objections');
  const critPrice = criteriaMap.get('price_presentation');
  const critClosing = criteriaMap.get('closing_booking');

  const isCrossSellNotApplicableOrHigh =
    !critCrossSell ||
    critCrossSell.is_applicable === false ||
    (critCrossSell.score !== null && critCrossSell.score >= 9);

  const isParallelNotApplicableOrHigh =
    !critParallel ||
    critParallel.is_applicable === false ||
    (critParallel.score !== null && critParallel.score >= 9);

  const isAlternativesNotApplicableOrHigh =
    !critAlternatives ||
    critAlternatives.is_applicable === false ||
    (critAlternatives.score !== null && critAlternatives.score >= 9);

  const isObjectionsNotApplicable =
    !critObjections ||
    critObjections.is_applicable === false;

  const isPriceNotApplicableOrHigh =
    !critPrice ||
    critPrice.is_applicable === false ||
    (critPrice.score !== null && critPrice.score >= 9);

  const isBookingNotApplicable =
    !critClosing ||
    critClosing.is_applicable === false ||
    Boolean(ctx?.isNonClient || ctx?.isLateWarning);

  // Очищаем входной список ошибок от противоречий с критериями и типом звонка
  let filteredMistakes = inputMistakes
    .map(m => m.trim())
    .filter(m => {
      if (!m) return false;
      const lower = m.toLowerCase();

      // Позитивные констатации (например, «Администратор предложил альтернативные варианты времени/услуги.») не являются ошибками
      if (/^администратор\s+(?:предложил|уточнил|сориентировал|озвучил|подтвердил)/i.test(lower)) {
        return false;
      }
      if (isCrossSellNotApplicableOrHigh && (lower.includes('сопутствующ') || lower.includes('допродаж') || lower.includes('спа-уход') || lower.includes('снятие покрытия') || lower.includes('дополнительн'))) {
        return false;
      }
      if (isParallelNotApplicableOrHigh && (lower.includes('параллельн') || lower.includes('4 руки') || lower.includes('четыре руки'))) {
        return false;
      }
      if (isAlternativesNotApplicableOrHigh && (lower.includes('альтернативн') || lower.includes('лист ожидания'))) {
        return false;
      }
      if (isObjectionsNotApplicable && (lower.includes('возражен') || lower.includes('сомнени'))) {
        return false;
      }
      if (isPriceNotApplicableOrHigh && (lower.includes('прайс') || lower.includes('стоимост'))) {
        return false;
      }
      if (isBookingNotApplicable && (lower.includes('запис') || lower.includes('напоминан') || lower.includes('подтверждении брони') || lower.includes('слот'))) {
        return false;
      }
      if (ctx && !ctx.isConfirmedBooking && (lower.includes('смс-напоминан') || lower.includes('накануне визита'))) {
        return false;
      }

      return true;
    });

  // Очищаем входной список советов от противоречий
  let filteredAdvice = inputAdvice
    .map(a => a.trim())
    .filter(a => {
      if (!a) return false;
      const lower = a.toLowerCase();
      if (isCrossSellNotApplicableOrHigh && (lower.includes('сопутствующ') || lower.includes('допродаж') || lower.includes('парафинотерапи') || lower.includes('спа-уход') || lower.includes('дополнительн'))) {
        return false;
      }
      if (isParallelNotApplicableOrHigh && (lower.includes('параллельн') || lower.includes('4 руки') || lower.includes('четыре руки'))) {
        return false;
      }
      if (isBookingNotApplicable && (lower.includes('смс-напоминан') || lower.includes('свободные окна') || lower.includes('прайс-лист'))) {
        return false;
      }
      if (ctx && !ctx.isConfirmedBooking && (lower.includes('смс-напоминан') || lower.includes('накануне визита'))) {
        return false;
      }
      return true;
    });

  const overall = evaluation.overall_score;

  // Если общий балл >= 9.8 — грубых ошибок нет
  if (overall !== null && overall >= 9.8) {
    return {
      mistakes: ['Грубых ошибок не допущено, регламент общения соблюден в полном объеме.'],
      advice: filteredAdvice.length > 0
        ? filteredAdvice
        : [ctx?.isNonClient || ctx?.isLateWarning
            ? 'Поддерживать высокий уровень вежливости и оперативной фиксации обращений.'
            : 'Поддерживать высокий уровень сервиса и направлять клиенту подтверждение визита.']
    };
  }

  // Если список ошибок опустел или был не заполнен — выводим строго на основе применимых критериев с оценкой < 8
  if (filteredMistakes.length === 0 && overall !== null && overall < 10) {
    const derivedMistakes: string[] = [];
    const derivedAdvice: string[] = [];

    (evaluation.criteria || []).forEach(c => {
      if (c.is_applicable !== false && typeof c.score === 'number' && c.score < 8) {
        switch (c.id) {
          case 'greeting_intro':
            derivedMistakes.push('Администратор не назвал собственное имя и/или название салона при приветствии.');
            derivedAdvice.push('Представляться по полному корпоративному стандарту (название салона + имя администратора).');
            break;
          case 'needs_identification':
            derivedMistakes.push('Не заданы уточняющие вопросы для выявления потребностей гостя.');
            derivedAdvice.push('Проявлять активное слушание и уточнять пожелания гостя по результату, срокам и деталям.');
            break;
          case 'service_and_master_presentation':
            derivedMistakes.push(c.explanation || 'Особенности услуги и квалификация мастера не раскрыты.');
            derivedAdvice.push('Кратко презентовать особенности методики и квалификацию мастера салона.');
            break;
          case 'price_presentation':
            derivedMistakes.push('Стоимость процедуры не была озвучена в ходе диалога.');
            derivedAdvice.push('Четко и уверенно озвучивать стоимость и условия оказания услуги.');
            break;
          case 'handling_objections':
            derivedMistakes.push(c.explanation || 'Недостаточная аргументация при возражении/сомнении гостя.');
            derivedAdvice.push('Аргументировать преимущества доступных методик и предлагать комфортные решения.');
            break;
          case 'additional_services':
            derivedMistakes.push('Администратор не предложил сопутствующие процедуры к основной услуге.');
            derivedAdvice.push('Предлагать сопутствующие процедуры при оформлении основной записи.');
            break;
          case 'parallel_booking':
            derivedMistakes.push('При бронировании комплекса услуг не была предложена опция параллельной записи в 4 руки.');
            derivedAdvice.push('Предлагать гостям параллельную запись в 4 руки для экономии времени.');
            break;
          case 'alternative_options':
            if (typeof c.score === 'number' && c.score <= 5) {
              derivedMistakes.push(c.explanation || 'Не предложены альтернативные варианты времени, дат или мастеров.');
              derivedAdvice.push('Предлагать несколько альтернативных вариантов по времени, мастерам или смежным услугам.');
            }
            break;
          case 'closing_booking':
            derivedMistakes.push(c.explanation || 'Запись в рамках диалога не состоялась.');
            derivedAdvice.push('При наличии интереса клиента активно переводить диалог к согласованию удобного времени или консультации.');
            break;
          case 'communication_quality_closing':
            if (ctx?.isLateWarning) {
              derivedMistakes.push('При подтверждении ожидания не уточнены имя клиента и точное время исходной записи.');
              derivedAdvice.push('При звонке об опоздании всегда уточнять имя гостя/время брони для быстрой отметки в расписании.');
            } else if (ctx?.isConfirmedBooking) {
              derivedMistakes.push('Не оговорён регламент предварительного напоминания о визите накануне.');
              derivedAdvice.push('Предупреждать клиента об отправке напоминания накануне визита.');
            }
            break;
        }
      }
    });

    if (derivedMistakes.length > 0) {
      filteredMistakes = derivedMistakes;
    } else if (ctx?.isNonClient || ctx?.isLateWarning) {
      filteredMistakes = ['Существенных нарушений стандартов общения по данному типу звонка не выявлено.'];
    }
    if (filteredAdvice.length === 0 && derivedAdvice.length > 0) {
      filteredAdvice = derivedAdvice;
    }
  }

  // Если всё ещё нет советов — подбираем strictly contextual default
  if (filteredAdvice.length === 0) {
    if (ctx?.isNonClient) {
      filteredAdvice = ['Зафиксировать полученную информацию из мессенджера и передать ответственному сотруднику/управляющему.'];
    } else if (ctx?.isLateWarning) {
      filteredAdvice = [
        'При получении звонка об опоздании уточнять имя гостя и время записи для оперативного уведомления мастера.'
      ];
    } else if (ctx?.isUnavailableServiceRefusal) {
      filteredAdvice = [
        'Фиксировать запросы на отсутствующие услуги в CRM для анализа спроса и аргументированно рассказывать о преимуществах доступных методик.'
      ];
    } else {
      filteredAdvice = [
        'Соблюдать корпоративный регламент ведения телефонных переговоров салона.',
        ...(ctx?.isConfirmedBooking ? ['Направлять клиенту подтверждение записи и напоминание накануне визита.'] : [])
      ];
    }
  }

  return {
    mistakes: filteredMistakes,
    advice: filteredAdvice
  };
}
