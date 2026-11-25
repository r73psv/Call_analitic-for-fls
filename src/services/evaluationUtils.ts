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
export const LEGACY_CRITERION_ID_MAP: Record<string, string> = {
  service_and_master_presentation: 'service_presentation',
  handling_objections: 'objections',
  additional_services: 'upsell',
  alternative_options: 'alternatives',
  closing_booking: 'closing',
  communication_quality_closing: 'communication',
};

export function normalizeCriterionId(id?: string | null): string {
  const s = String(id || '').trim();
  return LEGACY_CRITERION_ID_MAP[s] || s;
}

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
    id: 'service_presentation',
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
    id: 'objections',
    name: 'Работа с возражениями',
    shortDescription: 'Отработка сомнений по цене, плотной записи мастера, переубеждение и предложение решений',
    category: 'sales',
    iconKey: 'objections'
  },
  {
    id: 'upsell',
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
    id: 'alternatives',
    name: 'Предложение альтернативных вариантов',
    shortDescription: 'Вилка времени (2+ слота), альтернативные даты, другие мастера или лист ожидания при занятости',
    category: 'service',
    iconKey: 'alternatives'
  },
  {
    id: 'closing',
    name: 'Закрытие на запись',
    shortDescription: 'Инициатива фиксации брони, четкое проговаривание даты, времени, мастера и подтверждение',
    category: 'sales',
    iconKey: 'closing'
  },
  {
    id: 'communication',
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
    if (c.id) {
      criteriaMap.set(normalizeCriterionId(c.id), c);
    }
    if (c.name) {
      criteriaMap.set(c.name, c);
    }
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
      explanation,
      ...(found?.evidence_quote !== undefined ? { evidence_quote: found.evidence_quote } : {}),
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
    const critMap = new Map(existingEvaluation.criteria.map(c => [normalizeCriterionId(c.id), c]));
    const critGreeting = critMap.get('greeting_intro');
    const crit6 = critMap.get('upsell');
    const critParallel = critMap.get('parallel_booking');
    const critAlt = critMap.get('alternatives');
    const critClosing = critMap.get('closing');
    const critPrice = critMap.get('price_presentation');
    const critMaster = critMap.get('service_presentation');
    const mistakesStr = (mistakes || []).join(' ').toLowerCase();

    const { managerText: mgrTxtCheck, fullText: fullTxtCheck } = splitSpeakerLines(ctx.cleanTranscript);
    const openCheck = (mgrTxtCheck || fullTxtCheck).slice(0, 160);
    const openHasGreetingWithClientAndSalon =
      /(?:добрый день|здравствуйте|доброе утро|добрый вечер)/iu.test(openCheck) &&
      /(?:[Дд]обр(?:ый\s+(?:день|вечер)|ое\s+утро)|[Зз]дравствуйте)[,\s]+(?!(?:Салон|Студ|Лик|Фэшн|Фешен|Fashion))[А-ЯЁ][а-яё]+/u.test(openCheck) &&
      /(?:студи|салон|fashion|фешен|фэшн|лук\s*студ|лик)/iu.test(openCheck);
    const hasFalseGreetingPenalty = Boolean(
      openHasGreetingWithClientAndSalon &&
        critGreeting &&
        ((critGreeting.score ?? 10) < 9 ||
          /не\s+представил|не\s+назвал[а]?\s+имя/i.test(`${critGreeting.explanation || ''} ${mistakesStr}`))
    );

    const hasCrossSellContradiction = crit6 && crit6.score === 10 && mistakesStr.includes('сопутствующ');
    const isExistingBookingConfirm = /(?:вы\s+записаны\s+(?:на|к)|ваша\s+запись\s+(?:на|к))/iu.test(ctx.cleanTranscript);
    const hasWrongClosing10 =
      !ctx.isConfirmedBooking &&
      !ctx.isRescheduleOrCheck &&
      !isExistingBookingConfirm &&
      critClosing &&
      critClosing.is_applicable !== false &&
      (critClosing.score ?? 0) >= 8;
    const hasMissedConfirmedClosing =
      !ctx.isArrivalStatus &&
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
      (ctx.isNonClient || ctx.isArrivalStatus || (ctx.isLateWarning && !isExistingBookingConfirm)) &&
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
      !hasFalseGreetingPenalty &&
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
  const openingManagerText = rawOpeningManager.split(/(?<=[.!?])\s+(?=[А-ЯЁA-Z])/).slice(0, 2).join(' ') || rawOpeningManager;
    const hasGreeting = /(?:добрый день|здравствуйте|доброе утро|добрый вечер|приветствую|алло)/iu.test(openingManagerText);
    const hasManagerNameIntro = /(?:меня зовут|администратор(?:\s+салона[^.!?]{0,40})?\s+[А-ЯЁа-яё]+|это\s+[А-ЯЁа-яё]+)/iu.test(openingManagerText);
    const hasClientNameGreeting = /(?:[Дд]обр(?:ый\s+(?:день|вечер)|ое\s+утро)|[Зз]дравствуйте)[,\s]+(?!(?:Салон|Студ|Лик|Фэшн|Фешен|Fashion))[А-ЯЁ][а-яё]+/u.test(openingManagerText);
    const hasSalonName = /(?:студи|салон|fashion|фешен|фэшн|лук\s*студ|лик(?:\s*28)?|от[,\s]+а[,\s]+28)/iu.test(openingManagerText);
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
      : (hasGreeting && hasSalonName && hasClientNameGreeting) || (hasManagerNameIntro && hasSalonName)
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
      : hasGreeting && hasSalonName && hasClientNameGreeting
      ? 'Приветствие по стандарту: администратор вежливо поприветствовал клиента по имени и назвал салон.'
      : hasManagerNameIntro && hasSalonName
      ? 'Администратор представился с названием салона и собственным именем.'
      : hasGreeting && hasManagerNameIntro
      ? 'Приветствие вежливое с указанием имени администратора.'
      : hasGreeting && hasSalonName
      ? 'Приветствие вежливое с названием салона.'
      : hasGreeting
      ? 'Приветствие озвучено вежливо, однако в расшифровке не зафиксированы название салона и имя администратора.'
      : 'Приветствие скомкано или не соответствует корпоративному стандарту.'
  };

  // Последняя реплика менеджера или клиента для критерия 10 (Качество коммуникации и завершение)
  const speakerLinesForClosing = ctx.cleanTranscript
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^(?:менеджер|клиент|оператор|администратор)\s*:/i.test(l));
  const lastSpeakerLineRaw =
    speakerLinesForClosing.length > 0
      ? speakerLinesForClosing[speakerLinesForClosing.length - 1]
      : '';
  const lastUtteranceQuote = lastSpeakerLineRaw
    ? lastSpeakerLineRaw.replace(/^(?:менеджер|клиент|оператор|администратор)\s*:\s*/i, '').trim()
    : '';
  const closingQuoteSuffix = lastUtteranceQuote
    ? ` (финальная реплика: «${lastUtteranceQuote.slice(0, 120)}»)`
    : '';

  // Спец-ветка 1: Нецелевой / партнёрский / организационный звонок (например, билеты в WhatsApp)
  if (ctx.isNonClient) {
    const hasPoliteClosing = /(?:до свидания|всего доброго|хорошего дня|спасибо|пожалуйста|обязательно|прочитаем)/iu.test(managerEffective);
    const acknowledgedAction = /(?:прочитаем|передам|посмотрим|хорошо|спасибо большое)/iu.test(managerEffective);
    const notApp = 'Звонок носит организационный/партнёрский характер (не клиентская запись), критерий не применим (не снижает оценку).';

    return buildCallEvaluation([
      greetingCriterion,
      { id: 'needs_identification', is_applicable: false, score: null, explanation: notApp },
      { id: 'service_presentation', is_applicable: false, score: null, explanation: notApp },
      { id: 'price_presentation', is_applicable: false, score: null, explanation: notApp },
      { id: 'objections', is_applicable: false, score: null, explanation: notApp },
      { id: 'upsell', is_applicable: false, score: null, explanation: notApp },
      { id: 'parallel_booking', is_applicable: false, score: null, explanation: notApp },
      { id: 'alternatives', is_applicable: false, score: null, explanation: notApp },
      { id: 'closing', is_applicable: false, score: null, explanation: notApp },
      {
        id: 'communication',
        is_applicable: true,
        score: hasPoliteClosing && acknowledgedAction ? 9 : (hasPoliteClosing ? 8 : 6),
        explanation: acknowledgedAction
          ? `Администратор вежливо принял информацию, подтвердил готовность ознакомиться с ней и завершил разговор корректно${closingQuoteSuffix}.`
          : `Вежливое завершение организационного звонка${closingQuoteSuffix}.`,
        ...(lastUtteranceQuote ? { evidence_quote: lastUtteranceQuote.slice(0, 180) } : {}),
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
      { id: 'service_presentation', is_applicable: false, score: null, explanation: notAppLate },
      { id: 'price_presentation', is_applicable: false, score: null, explanation: notAppLate },
      { id: 'objections', is_applicable: false, score: null, explanation: notAppLate },
      { id: 'upsell', is_applicable: false, score: null, explanation: notAppLate },
      { id: 'parallel_booking', is_applicable: false, score: null, explanation: notAppLate },
      { id: 'alternatives', is_applicable: false, score: null, explanation: notAppLate },
      { id: 'closing', is_applicable: false, score: null, explanation: notAppLate },
      {
        id: 'communication',
        is_applicable: true,
        score: confirmedWaiting && clarifiedClientOrTime ? 10 : (confirmedWaiting ? 8 : 6),
        explanation: confirmedWaiting && clarifiedClientOrTime
          ? `Администратор вежливо подтвердил ожидание гостя и уточнил детали существующей записи${closingQuoteSuffix}.`
          : confirmedWaiting
          ? `Администратор доброжелательно подтвердил ожидание опаздывающего клиента, однако не уточнил имя или точное время действующей записи для отметки в расписании${closingQuoteSuffix}.`
          : `Ответ на предупреждение об опоздании прозвучал скомканно${closingQuoteSuffix}.`,
        ...(lastUtteranceQuote ? { evidence_quote: lastUtteranceQuote.slice(0, 180) } : {}),
      }
    ]);
  }

  // Спец-ветка 3: Короткий статусный звонок (уведомление о прибытии по существующему визиту)
  if (ctx.isArrivalStatus) {
    const respondedPromptly = /(?:сейчас\s+(?:буду|выйду|подойду)|хорошо|угу|ага|жду|ждем|ждём|иду)/iu.test(managerEffective);
    const notAppStatus = 'Короткий статусный звонок о прибытии по существующему визиту — звонок не про запись услуг, критерий не применим (не снижает оценку).';

    return buildCallEvaluation([
      greetingCriterion,
      { id: 'needs_identification', is_applicable: false, score: null, explanation: notAppStatus },
      { id: 'service_presentation', is_applicable: false, score: null, explanation: notAppStatus },
      { id: 'price_presentation', is_applicable: false, score: null, explanation: notAppStatus },
      { id: 'objections', is_applicable: false, score: null, explanation: notAppStatus },
      { id: 'upsell', is_applicable: false, score: null, explanation: notAppStatus },
      { id: 'parallel_booking', is_applicable: false, score: null, explanation: notAppStatus },
      { id: 'alternatives', is_applicable: false, score: null, explanation: notAppStatus },
      { id: 'closing', is_applicable: false, score: null, explanation: notAppStatus },
      {
        id: 'communication',
        is_applicable: true,
        score: respondedPromptly ? 9 : 7,
        explanation: respondedPromptly
          ? `Администратор оперативно и вежливо отреагировал на уведомление о прибытии гостя${closingQuoteSuffix}.`
          : `Корректная коммуникация в коротком статусном звонке${closingQuoteSuffix}.`,
        ...(lastUtteranceQuote ? { evidence_quote: lastUtteranceQuote.slice(0, 180) } : {}),
      }
    ]);
  }

  // Клиентские обращения (первичная запись, перенос, спор, отказ, отсутствие услуги, консультация)
  const isDispute = ctx.isDispute;
  const isRescheduleOrCheck = ctx.isRescheduleOrCheck;
  const isBookingConfirmationCall =
    /(?:запись\s+подтверд|подтверд[а-яё]*\s+(?:свою\s+)?(?:запис|визит)|подтвержда(?:ю|ем|ете)(?:\s+(?:запис|визит))?|подойд[её]те|обратный\s+звонок|будем\s+ожидать|(?:вы|я)\s+(?:к\s+нам\s+|к\s+вам\s+)?записан[аы]?(?:\s+(?:на|к))?|(?:ваша|моя)\s+запись\s+(?:на|к)|напомина(?:ем|ю)\s+о\s+(?:вашей\s+)?записи)/iu.test(ctx.cleanTranscript) &&
    !/(?:сколько\s+стоит|хочу\s+записаться|какую\s+услугу|цен[ауы]|прайс)/iu.test(ctx.cleanTranscript);

  // 2. Выявление потребности гостя
  const hasNeedsQuestions = /(?:какую услугу|на какую|когда вам|в какое время|в какие дни|какой мастер|что именно|подскажите|хотели бы|планируете|на какое число|какой эффект|какие волосы|на что именно|необходимо будет|верно,?\s*да)/iu.test(managerEffective);

  // 3. Презентация услуги и мастера
  const hasMasterPresented = /(?:мастер|специалист|специализирует|квалификац|ведущий специалист|топ-мастер|опыт|продукци|выполняет|екатерин|лилия|елена|татьяна|арина|наталья|ольга|анна|кристина|ирина)/iu.test(managerEffective);

  // 4. Корректная презентация стоимости
  const hasPriceMention = /(?:стоить|рубл|₽|цена|прайс|стоит|стоимость|\d{3,5}\s*р(?![а-яё]))/iu.test(managerEffective);
  const priceAskedByClient = /(?:сколько стоит|по стоимости|цена|прайс|поч[её]м)/iu.test(clientEffective);
  const isPriceApplicable =
    !isRescheduleOrCheck &&
    !isBookingConfirmationCall &&
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
    !isBookingConfirmationCall &&
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
  const isOutboundConfirmationAgreed =
    isBookingConfirmationCall &&
    !ctx.isDeclined &&
    !/(?:отмен[а-яё]*\s+запис|не\s+смогу\s+прийти|не\s+приду|не\s+подойду)/iu.test(ctx.cleanTranscript) &&
    /(?:^|[\s,!.?«»"])(?:да|буду|подойду|хорошо|подтверждаю|спасибо|до\s+свидания|угу|ага|конечно)(?:$|[\s,!.?«»"])/iu.test(ctx.cleanTranscript);
  const isBookingAgreed =
    ctx.isConfirmedBooking ||
    isOutboundConfirmationAgreed ||
    (isRescheduleOrCheck && /оставляем|подтверждаем/iu.test(managerEffective));

  // 10. Качество коммуникации и завершение
  const hasPoliteClosing = /(?:до свидания|всего доброго|хорошего дня|ждем вас|спасибо|до встречи|комфортно)/iu.test(managerEffective);
  const hasReminderMention = /(?:напоминание|whatsapp|ватсап|смс|накануне|за полчаса|за 24 часа|сообщени)/iu.test(managerEffective);

  const criteria: CallEvaluationCriterion[] = [
    greetingCriterion,

    // 2. Выявление потребности гостя
    {
      id: 'needs_identification',
      name: 'Выявление потребности гостя',
      is_applicable: !isBookingConfirmationCall,
      score: isBookingConfirmationCall ? null : (hasNeedsQuestions ? 9 : (ctx.isUnavailableServiceRefusal ? 6 : 7)),
      explanation: isBookingConfirmationCall
        ? 'Звонок направлен на подтверждение уже согласованного визита (не снижает оценку).'
        : hasNeedsQuestions
        ? 'Администратор задавал уточняющие вопросы, выявляя пожелания гостя по услуге, времени или деталям визита.'
        : ctx.isUnavailableServiceRefusal
        ? 'Запрос клиента зафиксирован с его слов, но уточняющих вопросов (о желаемом результате, типе волос или срочности) не задано.'
        : 'Потребность принята со слов клиента без дополнительных уточняющих вопросов.'
    },

    // 3. Презентация услуги и мастера
    {
      id: 'service_presentation',
      name: 'Презентация услуги и мастера',
      is_applicable: !isBookingConfirmationCall,
      score: isBookingConfirmationCall
        ? null
        : ctx.isUnavailableServiceRefusal
        ? (hasNeedsQuestions && hasMasterPresented ? 8 : 6)
        : (hasMasterPresented ? 9 : 7),
      explanation: isBookingConfirmationCall
        ? 'Услуга и мастер в коротком подтверждении визита не требовали отдельной презентации (не снижает оценку).'
        : ctx.isUnavailableServiceRefusal
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
      id: 'objections',
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
      id: 'upsell',
      name: 'Предложение дополнительных услуг',
      is_applicable: isCrossSellApplicable,
      score: !isCrossSellApplicable ? null : (managerOfferedCrossSell ? 10 : 7),
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
      id: 'alternatives',
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
      id: 'closing',
      name: 'Закрытие на запись',
      is_applicable: true,
      score: isBookingAgreed ? 10 : (isBookingConfirmationCall && !ctx.isDeclined ? 9 : (hasBookingAttempt ? 5 : 4)),
      explanation: isOutboundConfirmationAgreed || (isBookingConfirmationCall && isBookingAgreed)
        ? 'Существующая запись успешно подтверждена клиентом в ходе звонка-подтверждения (бронь существовала до звонка).'
        : isBookingAgreed
        ? 'Запись успешно подтверждена и зафиксирована с согласованием условий визита.'
        : isBookingConfirmationCall && !ctx.isDeclined
        ? 'Менеджер подтвердил ранее оформленную запись (бронь существовала до звонка).'
        : ctx.isUnavailableServiceRefusal
        ? 'Администратор предложил запись на консультацию, но визит не состоялся из-за отказа клиента от альтернативной услуги.'
        : hasBookingAttempt
        ? 'Попытка закрытия на запись была предпринята, но визит не согласован.'
        : 'Попытка закрытия диалога на запись отсутствовала, бронь не оформлена.'
    },

    // 10. Качество коммуникации и завершение разговора (утверждение о качестве концовки — с цитатой последней реплики)
    {
      id: 'communication',
      name: 'Качество коммуникации и завершение разговора',
      is_applicable: true,
      score: isBookingAgreed
        ? (hasPoliteClosing && hasReminderMention ? 10 : (hasPoliteClosing ? 8 : 6))
        : (hasPoliteClosing ? 8 : 7),
      explanation: isBookingAgreed
        ? hasPoliteClosing && hasReminderMention
          ? `Вежливый, доброжелательный тон, упомянуто напоминание о визите, разговор завершен на позитивной ноте${closingQuoteSuffix}.`
          : hasPoliteClosing
          ? `Диалог завершен вежливо, однако регламент напоминания о визите накануне не озвучен${closingQuoteSuffix}.`
          : `Концовка диалога скомкана, регламент вежливого прощания не соблюден${closingQuoteSuffix}.`
        : `Коммуникация вежливая и корректная в рамках характера обращения${closingQuoteSuffix}.`,
      ...(lastUtteranceQuote ? { evidence_quote: lastUtteranceQuote.slice(0, 180) } : {}),
    }
  ];

  return buildCallEvaluation(criteria);
}

const REMINDER_EVE_MISTAKE_REGEX =
  /предварительн(?:ого|ом)?\s+напоминани|напоминани[еяий]\s+(?:о\s+визите\s+)?накануне|напоминани[еяий]\s+за\s+(?:24\s*час|день|сутки)|регламент(?:а)?\s+предварительного\s+напоминани/i;

const RUSSIAN_MONTHS_GENITIVE: Record<string, number> = {
  января: 1,
  февраля: 2,
  марта: 3,
  апреля: 4,
  мая: 5,
  июня: 6,
  июля: 7,
  августа: 8,
  сентября: 9,
  октября: 10,
  ноября: 11,
  декабря: 12,
};

export function isReminderEveMistake(text: string): boolean {
  return REMINDER_EVE_MISTAKE_REGEX.test(String(text || ''));
}

function getDatePartsInSalonTz(timestamp?: string | null): { year: number; month: number; day: number } | null {
  if (!timestamp) return null;
  const dt = new Date(timestamp);
  if (isNaN(dt.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Samara',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(dt);
    const year = Number(parts.find(p => p.type === 'year')?.value);
    const month = Number(parts.find(p => p.type === 'month')?.value);
    const day = Number(parts.find(p => p.type === 'day')?.value);
    if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
      return { year, month, day };
    }
  } catch {
    // fallback to UTC+4
  }
  const shifted = new Date(dt.getTime() + 4 * 3600 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/**
 * Определяет, попадает ли время звонка (по метаданным и контексту визита)
 * в день визита или после наступления времени визита — когда окно напоминаний накануне уже прошло.
 */
export function isCallOnOrAfterVisitDay(
  callTimestamp?: string | null,
  visitDateText?: string | null,
  transcript?: string | null
): boolean {
  const visitLower = String(visitDateText || '').toLowerCase();
  const transcriptLower = String(transcript || '').toLowerCase();

  // 1. Явные маркеры визита сегодня / клиент уже в пути / опоздание
  if (/(?:сегодня|сейчас|через\s+\d+\s*(?:мин|минут)|через\s+полчаса|уже\s+иду|уже\s+еду|опаздыва|в\s+пути)/i.test(visitLower)) {
    return true;
  }
  if (
    /(?:вы\s+записаны\s+(?:на\s+)?сегодня|запись\s+(?:на\s+)?сегодня|сегодня\s+(?:на|в)\s+\d{1,2}[:.]\d{2}|уже\s+иду|уже\s+еду|буду\s+через\s+\d+\s*(?:мин|минут)|подхожу|подъезжаю|опаздываю)/i.test(
      transcriptLower
    )
  ) {
    return true;
  }

  // 2. Сравнение календарной даты визита с датой звонка из метаданных (в часовом поясе салона UTC+4)
  const callDate = getDatePartsInSalonTz(callTimestamp);
  if (callDate && visitLower) {
    // Формат ДД.ММ(.ГГГГ)
    const dotMatch = visitLower.match(/\b([0-3]?\d)\.([01]?\d)(?:\.(\d{2,4}))?\b/);
    if (dotMatch) {
      const vDay = parseInt(dotMatch[1], 10);
      const vMonth = parseInt(dotMatch[2], 10);
      let vYear = callDate.year;
      if (dotMatch[3]) {
        const rawY = parseInt(dotMatch[3], 10);
        vYear = rawY < 100 ? 2000 + rawY : rawY;
      }
      if (vMonth >= 1 && vMonth <= 12 && vDay >= 1 && vDay <= 31) {
        const callKey = callDate.year * 10000 + callDate.month * 100 + callDate.day;
        const visitKey = vYear * 10000 + vMonth * 100 + vDay;
        if (visitKey <= callKey) return true;
      }
    }

    // Формат "15 мая"
    const wordMatch = visitLower.match(
      /\b([0-3]?\d)\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\b/i
    );
    if (wordMatch) {
      const vDay = parseInt(wordMatch[1], 10);
      const vMonth = RUSSIAN_MONTHS_GENITIVE[wordMatch[2].toLowerCase()];
      if (vMonth && vDay >= 1 && vDay <= 31) {
        const callKey = callDate.month * 100 + callDate.day;
        const visitKey = vMonth * 100 + vDay;
        if (visitKey <= callKey) return true;
      }
    }
  }

  return false;
}

/**
 * Удаляет устаревшие ошибки про напоминание накануне, если звонок произошёл в день визита или после него.
 */
export function filterOutdatedReminderMistakes(
  mistakes: string[],
  callTimestamp?: string | null,
  visitDateText?: string | null,
  transcript?: string | null
): string[] {
  if (!Array.isArray(mistakes) || mistakes.length === 0) return [];
  if (!isCallOnOrAfterVisitDay(callTimestamp, visitDateText, transcript)) {
    return mistakes;
  }
  return mistakes.filter((m) => !isReminderEveMistake(m));
}

const ERROR_FREE_MISTAKE_REGEX =
  /(?:грубых\s+ошибок\s+не\s+допущено|регламент(?:\s+общения)?\s+соблюд[её]н(?:\s+в\s+полном\s+объ[её]ме)?|существенных\s+нарушений.*не\s+выявлено|нарушений\s+(?:не\s+(?:выявлено|обнаружено|допущено)|нет)|ошибок\s+(?:не\s+(?:выявлено|обнаружено|допущено)|нет)|ошибки\s+(?:не\s+(?:выявлены|обнаружены)|отсутствуют)|замечаний\s+(?:нет|не\s+выявлено)|без\s+(?:ошибок|замечаний|нарушений)|^(?:не\s+выявлены|отсутствуют|нет|—|-)$)/i;

export function isErrorFreeMistakeStatement(text: string): boolean {
  const clean = String(text || '').trim();
  if (!clean) return true;
  return ERROR_FREE_MISTAKE_REGEX.test(clean);
}

/**
 * Согласованность аудита: если среди применимых критериев есть оценки ниже 7 баллов,
 * блок mistakes НЕ может быть пустым или содержать фразу «грубых ошибок не допущено / регламент соблюден в полном объеме».
 * Приоритет — у критериев оценки: при противоречии список ошибок формируется из сниженных критериев (< 7).
 */
export function reconcileMistakesWithCriteria(
  mistakes: string[] = [],
  criteria: CallEvaluationCriterion[] = [],
  callTimestamp?: string | null,
  visitDateText?: string | null,
  transcript?: string | null
): { mistakes: string[]; fixedFromCriteria: boolean } {
  const lowCriteria = (Array.isArray(criteria) ? criteria : []).filter(
    (c) => c && c.is_applicable !== false && typeof c.score === 'number' && !isNaN(c.score) && c.score < 7
  );

  const normalized = (Array.isArray(mistakes) ? mistakes : [])
    .map((m) => String(m || '').trim())
    .filter(Boolean);

  if (lowCriteria.length === 0) {
    return {
      mistakes: filterOutdatedReminderMistakes(normalized, callTimestamp, visitDateText, transcript),
      fixedFromCriteria: false,
    };
  }

  // При наличии критериев < 7 удаляем противоречивые «безошибочные» формулировки
  const withoutFalseClean = filterOutdatedReminderMistakes(
    normalized.filter((m) => !isErrorFreeMistakeStatement(m)),
    callTimestamp,
    visitDateText,
    transcript
  );

  if (withoutFalseClean.length > 0) {
    return {
      mistakes: withoutFalseClean,
      fixedFromCriteria: withoutFalseClean.length !== normalized.length,
    };
  }

  const reminderWindowPassed = isCallOnOrAfterVisitDay(callTimestamp, visitDateText, transcript);
  const derived: string[] = [];

  for (const crit of lowCriteria) {
    const cleanExp = String(crit.explanation || '')
      .replace(/\[Требует проверки:[^\]]*\]/gi, '')
      .trim();
    if (reminderWindowPassed && isReminderEveMistake(cleanExp)) {
      derived.push(`${crit.name} (${crit.score}/10): снижение оценки по критерию.`);
      continue;
    }
    if (cleanExp) {
      derived.push(`${crit.name} (${crit.score}/10): ${cleanExp}`);
    } else {
      derived.push(`${crit.name} (${crit.score}/10): выявлен недочёт по критерию.`);
    }
  }

  return {
    mistakes: filterOutdatedReminderMistakes(derived, callTimestamp, visitDateText, transcript),
    fixedFromCriteria: true,
  };
}

/**
 * Синхронизирует список ошибок (mistakes) и советов (advice) с критериями оценки.
 * Гарантирует отсутствие противоречий и навязанных шаблонов, не относящихся к диалогу.
 */
export function harmonizeMistakesAndEvaluation(
  inputMistakes: string[] = [],
  inputAdvice: string[] = [],
  evaluation: CallEvaluation,
  transcript?: string,
  callTimestamp?: string | null,
  visitDateText?: string | null
): {
  mistakes: string[];
  advice: string[];
} {
  const ctx = transcript ? classifyCallContext(transcript) : null;
  const reminderWindowPassed = isCallOnOrAfterVisitDay(callTimestamp, visitDateText, transcript);
  const criteriaMap = new Map<string, CallEvaluationCriterion>();
  (evaluation.criteria || []).forEach(c => criteriaMap.set(normalizeCriterionId(c.id), c));

  const critCrossSell = criteriaMap.get('upsell');
  const critParallel = criteriaMap.get('parallel_booking');
  const critAlternatives = criteriaMap.get('alternatives');
  const critObjections = criteriaMap.get('objections');
  const critPrice = criteriaMap.get('price_presentation');
  const critClosing = criteriaMap.get('closing');

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
    Boolean(ctx?.isNonClient || ctx?.isLateWarning || ctx?.isArrivalStatus);

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
  const hasAnyLowCriterion = (evaluation.criteria || []).some(
    (c) => c && c.is_applicable !== false && typeof c.score === 'number' && !isNaN(c.score) && c.score < 7
  );

  // Если общий балл >= 9.8 и нет ни одного сниженного критерия (< 7) — грубых ошибок нет
  if (overall !== null && overall >= 9.8 && !hasAnyLowCriterion) {
    return {
      mistakes: ['Грубых ошибок не допущено, регламент общения соблюден в полном объеме.'],
      advice: filteredAdvice.length > 0
        ? filteredAdvice
        : [ctx?.isNonClient || ctx?.isLateWarning
            ? 'Поддерживать высокий уровень вежливости и оперативной фиксации обращений.'
            : 'Поддерживать высокий уровень сервиса и направлять клиенту подтверждение визита.']
    };
  }

  // Если список ошибок пуст — НЕ подставляем шаблонный набор («не назвал имя / не задал вопросы / не презентовал / не предложил сопутствующие»).
  // Выводим замечания только при реально критичных провалах критериев (score <= 5) или явном отсутствии приветствия (score <= 4).
  if (filteredMistakes.length === 0 && overall !== null && overall < 10) {
    const derivedMistakes: string[] = [];
    const derivedAdvice: string[] = [];

    (evaluation.criteria || []).forEach(c => {
      if (c.is_applicable !== false && typeof c.score === 'number' && c.score <= 5) {
        switch (normalizeCriterionId(c.id)) {
          case 'greeting_intro':
            if (c.score <= 4) {
              derivedMistakes.push(c.explanation || 'Приветствие не зафиксировано в начале разговора.');
              derivedAdvice.push('Начинать диалог с вежливого приветствия по стандарту салона.');
            }
            break;
          case 'price_presentation':
            derivedMistakes.push(c.explanation || 'Стоимость процедуры не была озвучена в ходе диалога.');
            derivedAdvice.push('Четко и уверенно озвучивать стоимость и условия оказания услуги.');
            break;
          case 'objections':
            derivedMistakes.push(c.explanation || 'Недостаточная аргументация при возражении/сомнении гостя.');
            derivedAdvice.push('Аргументировать преимущества доступных методик и предлагать комфортные решения.');
            break;
          case 'parallel_booking':
            derivedMistakes.push(c.explanation || 'При бронировании комплекса услуг не была предложена опция параллельной записи в 4 руки.');
            derivedAdvice.push('Предлагать гостям параллельную запись в 4 руки для экономии времени.');
            break;
          case 'alternatives':
            derivedMistakes.push(c.explanation || 'Не предложены альтернативные варианты времени, дат или мастеров.');
            derivedAdvice.push('Предлагать несколько альтернативных вариантов по времени, мастерам или смежным услугам.');
            break;
          case 'closing':
            derivedMistakes.push(c.explanation || 'Запись в рамках диалога не состоялась.');
            derivedAdvice.push('При наличии интереса клиента активно переводить диалог к согласованию удобного времени или консультации.');
            break;
          case 'communication':
            if (ctx?.isLateWarning) {
              derivedMistakes.push('При подтверждении ожидания не уточнены имя клиента и точное время исходной записи.');
              derivedAdvice.push('При звонке об опоздании всегда уточнять имя гостя/время брони для быстрой отметки в расписании.');
            } else if (ctx?.isConfirmedBooking && !reminderWindowPassed) {
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
        ...(ctx?.isConfirmedBooking && !reminderWindowPassed
          ? ['Направлять клиенту подтверждение записи и напоминание накануне визита.']
          : [])
      ];
    }
  }

  const reconciledFinal = reconcileMistakesWithCriteria(
    filterOutdatedReminderMistakes(filteredMistakes, callTimestamp, visitDateText, transcript),
    evaluation.criteria || [],
    callTimestamp,
    visitDateText,
    transcript
  );

  return {
    mistakes: reconciledFinal.mistakes,
    advice: filteredAdvice
  };
}
