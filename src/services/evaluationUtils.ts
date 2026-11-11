/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CallEvaluationCriterion, CallEvaluation } from '../types.js';

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

/**
 * Извлекает или формирует детальную оценку по 10 критериям
 * на основе транскрипта, резюме и существующих данных оценки.
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
  // Если уже есть готовый массив из 10 критериев в объекте оценки
  if (existingEvaluation?.criteria && Array.isArray(existingEvaluation.criteria) && existingEvaluation.criteria.length >= 10) {
    return buildCallEvaluation(existingEvaluation.criteria);
  }

  const salon = customSalonName || 'Fashion Look Studio';
  const tLower = (transcript || '').toLowerCase();
  const sLower = (summary || '').toLowerCase();

  // Разговор не состоялся
  const isFailedCall =
    tLower.includes('разговор не состоялся') ||
    sLower.includes('разговор не состоялся') ||
    tLower.includes('диалог отсутствует') ||
    (!tLower.includes('менеджер:') && !tLower.includes('клиент:'));

  if (isFailedCall) {
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

  // Анализ стенограммы по фактам
  const hasGreeting = /(?:добрый день|здравствуйте|доброе утро|добрый вечер|салон|приветствую)/i.test(transcript);
  const hasManagerNameIntro = /(?:меня зовут|администратор\s+[а-яё]+|это\s+[а-яё]+)/iu.test(transcript);
  const hasSalonName = /(?:студи|салон|fashion|фешен|лик)/iu.test(transcript);

  const hasNeedsQuestions = /(?:какую услугу|на какую|когда вам|в какое время|какой мастер|что именно|подскажите|хотели бы|планируете)/iu.test(transcript);
  const hasMasterPresented = /(?:мастер|кристина|анна|елена|татьяна|арина|наталья|специалист|квалификац)/iu.test(transcript);
  const hasPriceMention = /(?:стоить|рубл|₽|цена|прайс|стоит|стоимость)/iu.test(transcript);
  
  // Возражения
  const hasObjections = /(?:дорого|не могу|не успе|не удобн|отъезд|не получ|занят|пораньше нельзя|не подходит)/iu.test(transcript);
  const handledObjectionWell = /(?:могу предложить|давайте посмотрим|лист ожидания|другой мастер|альтернатив|перенесем|в субботу|в воскресенье)/iu.test(transcript);

  // Дополнительные услуги
  const hasCrossSell = /(?:снятие|дизайн|уход|макияж и укладка|педикюр|маникюр и|брови|комплекс|укрепление|маска|спа)/iu.test(transcript);

  // Параллельная запись (в 4 руки, 2 процедуры, запись для двоих)
  const isMultipleServices = /(?:2 макияжа|маникюр и педикюр|в четыре руки|в 4 руки|вдвоем|подруг|макияж.*укладка)/iu.test(transcript);
  const hasParallelOffer = /(?:в 4 руки|одновременно|параллельно|вместе|сразу два мастера)/iu.test(transcript);

  // Альтернативные варианты (слоты времени, даты, мастера)
  const isSlotConflict = /(?:занят|забронировано|нет свободного|не могу|не подходит время)/iu.test(transcript);
  const hasAlternativesOffered = /(?:или на|есть еще|могу предложить на|а если|в 15:00 или в 20:00|на субботу|на воскресенье|к другому мастеру|лист ожидания)/iu.test(transcript);

  // Закрытие на запись
  const hasBookingClosing = /(?:записываю вас|записала вас|ждем вас|запись подтверждаем|будем вас ожидать|оставляем|зафиксировала)/iu.test(transcript);
  const isBookingAgreed = /(?:согласие|запись|подтвержден)/iu.test(summary) || hasBookingClosing;

  // Качество коммуникации и завершение
  const hasPoliteClosing = /(?:до свидания|всего доброго|хорошего дня|ждем вас|спасибо|напоминание в whatsapp|смс)/iu.test(transcript);
  const hasReminderMention = /(?:напоминание|whatsapp|ватсап|смс|накануне|за полчаса|за 24 часа)/iu.test(transcript);

  // Базовый уровень оценок
  const baseScore = typeof operatorScore === 'number' && !isNaN(operatorScore) ? operatorScore : 8;

  const criteria: CallEvaluationCriterion[] = [
    // 1. Приветствие и представление
    {
      id: 'greeting_intro',
      name: 'Приветствие и представление',
      is_applicable: true,
      score: hasGreeting && hasManagerNameIntro ? 10 : hasGreeting ? 8 : 4,
      explanation: hasGreeting && hasManagerNameIntro
        ? 'Приветствие по полному корпоративному стандарту: назван салон и имя администратора.'
        : hasGreeting
        ? 'Приветствие озвучено вежливо, однако администратор не назвал собственное имя.'
        : 'Приветствие скомкано или не соответствует корпоративному стандарту.'
    },

    // 2. Выявление потребности гостя
    {
      id: 'needs_identification',
      name: 'Выявление потребности гостя',
      is_applicable: true,
      score: hasNeedsQuestions ? 9 : 7,
      explanation: hasNeedsQuestions
        ? 'Администратор задавал уточняющие вопросы, активно выявлял пожелания по времени, услуге и мастеру.'
        : 'Потребность выявлена на базовом уровне со слов клиента без глубокой детализации.'
    },

    // 3. Презентация услуги и мастера
    {
      id: 'service_and_master_presentation',
      name: 'Презентация услуги и мастера',
      is_applicable: true,
      score: hasMasterPresented ? 9 : 7,
      explanation: hasMasterPresented
        ? 'Администратор четко сориентировал по специалисту и специфике выполнения услуги.'
        : 'Презентация мастера проведена формально без акцента на его квалификации.'
    },

    // 4. Корректная презентация стоимости
    {
      id: 'price_presentation',
      name: 'Корректная презентация стоимости',
      is_applicable: true,
      score: hasPriceMention ? 10 : 7,
      explanation: hasPriceMention
        ? 'Стоимость услуги названа четко, прозрачно и уверенно в соответствии с прайс-листом.'
        : 'Прайс озвучен без детализации стоимости сопутствующих элементов или условий оплаты.'
    },

    // 5. Работа с возражениями
    {
      id: 'handling_objections',
      name: 'Работа с возражениями',
      is_applicable: hasObjections,
      score: hasObjections ? (handledObjectionWell ? 9 : 4) : null,
      explanation: hasObjections
        ? handledObjectionWell
          ? 'Администратор профессионально отработал сомнения гостя по времени/цене и предложил компромисс.'
          : 'Администратор пассивно отреагировал на сомнения гостя, не предприняв попытки удержания.'
        : 'Возражений со стороны гостя в ходе звонка не возникало (критерий не применим, не снижает общую оценку).'
    },

    // 6. Предложение дополнительных услуг
    {
      id: 'additional_services',
      name: 'Предложение дополнительных услуг',
      is_applicable: isBookingAgreed,
      score: hasCrossSell ? 10 : Math.max(5, baseScore - 2),
      explanation: hasCrossSell
        ? 'Администратор проактивно предложил сопутствующие процедуры (дизайн, уход, снятие).'
        : 'Сопутствующие услуги и допродажи не предлагались, упущен потенциал среднего чека.'
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
        : 'Параллельная запись не требовалась в контексте обращения (критерий не применим, не снижает общую оценку).'
    },

    // 8. Предложение альтернативных вариантов
    {
      id: 'alternative_options',
      name: 'Предложение альтернативных вариантов',
      is_applicable: isSlotConflict || !isBookingAgreed,
      score: (isSlotConflict || !isBookingAgreed) ? (hasAlternativesOffered ? 9 : 4) : null,
      explanation: (isSlotConflict || !isBookingAgreed)
        ? hasAlternativesOffered
          ? 'При занятости основного слота администратор сразу предложил альтернативные даты, время или лист ожидания.'
          : 'При несовпадении времени администратор не предложил альтернативные дни, слоты или других мастеров.'
        : 'Выбранный слот времени сразу подошел клиенту, предложение альтернатив не требовалось (критерий не применим, не снижает оценку).'
    },

    // 9. Закрытие на запись
    {
      id: 'closing_booking',
      name: 'Закрытие на запись',
      is_applicable: true,
      score: isBookingAgreed ? 10 : (hasBookingClosing ? 8 : 5),
      explanation: isBookingAgreed
        ? 'Успешная фиксация записи с четким проговариванием даты, времени и мастера.'
        : 'Попытка закрытия на запись была недостаточной, бронь не зафиксирована.'
    },

    // 10. Качество коммуникации и завершение разговора
    {
      id: 'communication_quality_closing',
      name: 'Качество коммуникации и завершение разговора',
      is_applicable: true,
      score: hasPoliteClosing && hasReminderMention ? 10 : hasPoliteClosing ? 9 : 7,
      explanation: hasPoliteClosing && hasReminderMention
        ? 'Вежливый, доброжелательный тон, упомянуто напоминание о визите, разговор завершен на позитивной ноте.'
        : hasPoliteClosing
        ? 'Диалог завершен вежливо и доброжелательно, регламент общения соблюден.'
        : 'Концовка диалога смазана, не оговорен регламент напоминания о визите.'
    }
  ];

  return buildCallEvaluation(criteria);
}
