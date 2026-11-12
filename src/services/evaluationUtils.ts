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

export interface DialogueUtterances {
  managerText: string;
  clientText: string;
  fullText: string;
}

/**
 * Извлекает реплики менеджера и клиента для раздельного фактологического анализа
 */
export function splitSpeakerLines(transcript: string): DialogueUtterances {
  const lines = (transcript || '').split('\n').map(l => l.trim()).filter(Boolean);
  const managerLines: string[] = [];
  const clientLines: string[] = [];

  for (const line of lines) {
    if (/^(?:менеджер|администратор|оператор)\s*:/i.test(line)) {
      managerLines.push(line.replace(/^(?:менеджер|администратор|оператор)\s*:/i, '').trim());
    } else if (/^(?:клиент|гость)\s*:/i.test(line)) {
      clientLines.push(line.replace(/^(?:клиент|гость)\s*:/i, '').trim());
    }
  }

  const managerText = managerLines.join(' ');
  const clientText = clientLines.join(' ');

  return {
    managerText,
    clientText,
    fullText: transcript || ''
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
  // Если уже есть готовый массив из 10 критериев в объекте оценки с валидными флагами
  if (existingEvaluation?.criteria && Array.isArray(existingEvaluation.criteria) && existingEvaluation.criteria.length >= 10) {
    // Проверяем, не содержит ли existingEvaluation устаревшую галлюцинацию по additional_services
    // Если в существующей оценке additional_services было 10/10, но в mistakes значится "Не предложены сопутствующие",
    // нормализуем на основе транскрипта
    const crit6 = existingEvaluation.criteria.find(c => c.id === 'additional_services');
    const mistakesStr = (mistakes || []).join(' ').toLowerCase();
    const hasMistakeContradiction = crit6 && crit6.score === 10 && mistakesStr.includes('сопутствующ');
    if (!hasMistakeContradiction) {
      return buildCallEvaluation(existingEvaluation.criteria);
    }
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

  // Разделение реплик говорящих
  const { managerText, clientText, fullText } = splitSpeakerLines(transcript);
  const managerEffective = managerText || fullText;

  // Анализ типа обращения
  const isDispute = /(?:претензи|жалоб|отмен|издеваетесь|недоволен|почему отменили|верните деньги)/iu.test(fullText);
  const isRescheduleOrCheck = /(?:перенести запись|перенос записи|у меня запись на|хотела уточнить запись|проверить запись|оставляем все спасибо|на 9 оставляю на 10:30 убираю)/iu.test(fullText)
    && !/(?:первичн|впервые|хочу записаться на|запишите меня)/iu.test(clientText || fullText);

  // 1. Приветствие и представление (проверяем реплики администратора)
  const hasGreeting = /(?:добрый день|здравствуйте|доброе утро|добрый вечер|салон|приветствую)/iu.test(managerEffective);
  const hasManagerNameIntro = /(?:меня зовут|администратор\s+[а-яё]+|это\s+[а-яё]+)/iu.test(managerEffective);
  const hasSalonName = /(?:студи|салон|fashion|фешен|фэшн|лик)/iu.test(managerEffective);

  // 2. Выявление потребности гостя
  const hasNeedsQuestions = /(?:какую услугу|на какую|когда вам|в какое время|какой мастер|что именно|подскажите|хотели бы|планируете|на какое число)/iu.test(managerEffective);

  // 3. Презентация услуги и мастера
  const hasMasterPresented = /(?:мастер|кристина|анна|елена|татьяна|арина|наталья|ирина|ольга|специалист|квалификац|ведущий специалист|топ-мастер)/iu.test(managerEffective);

  // 4. Корректная презентация стоимости
  const hasPriceMention = /(?:стоить|рубл|₽|цена|прайс|стоит|стоимость)/iu.test(managerEffective);

  // 5. Работа с возражениями
  // Возражения гостя: сомнения, высокая цена, неудобное время, претензия
  const hasObjections = /(?:дорого|не могу|не успе|не удобн|отъезд|не получ|занят|пораньше нельзя|не подходит|почему отменили|издеваетесь|претензи|жалоб)/iu.test(clientText || fullText);
  const handledObjectionWell = /(?:могу предложить|давайте посмотрим|лист ожидания|другой мастер|альтернатив|перенесем|в субботу|в воскресенье|скидк|компенсац|извините|понимаем вас)/iu.test(managerEffective);

  // 6. Предложение дополнительных услуг (допродажа / сопутствующие процедуры)
  // ВАЖНО: проверяем, исходило ли предложение сопутствующих услуг ОТ АДМИНИСТРАТОРА,
  // а не просто запрос клиента ("хочу макияж и укладку")!
  const managerOfferedCrossSell =
    // Предложение снятия покрытия
    /(?:сняти|со\s+снятием|нужно\s+ли\s+снять|потребуется\s+ли\s+снятие)/iu.test(managerEffective) ||
    // Предложение дизайна ногтей
    /(?:дизайн|будем\s+делать\s+дизайн|с\s+дизайном)/iu.test(managerEffective) ||
    // Предложение ухода, спа, маски, ламинирования, пилинга, парафинотерапии, укрепления
    /(?:спа-уход|спа\s+уход|уход\s+для|уходовую|маск|экранирован|ламинирован|пилинг|парафинотерапи|парафин|укреплени)/iu.test(managerEffective) ||
    // Проактивное предложение второй услуги (к маникюру - педикюр, к стрижке - укладка/уход)
    /(?:могу|можем)\s+(?:также\s+)?предложить\s+(?:вам\s+)?(?:педикюр|маникюр|бров|ресниц|укладк|стрижк|уход|макияж)/iu.test(managerEffective) ||
    // Прямой вопрос допродажи
    /(?:не\s+хотите\s+(?:ли\s+)?добавить|записать\s+вас\s+также\s+на|будем\s+делать\s+также|рекомендую\s+также|предложу\s+вам\s+также|дополнительно\s+можем)/iu.test(managerEffective) ||
    // Фиксация предложения в резюме диалога со стороны администратора
    /(?:администратор\s+предложил\s+сопутствующ|администратор\s+предложил\s+уход|администратор\s+предложил\s+дизайн)/iu.test(summary);

  // Применимость критерия дополнительных услуг:
  // При разрешении конфликта/претензии или при переносе существующей брони допродажи не применимы!
  const isCrossSellApplicable = !isDispute && !isRescheduleOrCheck;

  // 7. Параллельная запись (в 4 руки / для двоих)
  // Применима ТОЛЬКО если обсуждался комплекс услуг (маникюр + педикюр, макияж + укладка) или запись для 2 человек
  const isMultipleServices = /(?:маникюр\s+и\s+педикюр|педикюр\s+и\s+маникюр|макияж\s+и\s+укладка|укладка\s+и\s+макияж|2\s+макияжа|два\s+макияжа|вдвоем|подруг|сестр|вместе\s+с|для\s+двоих|2\s+человек)/iu.test(fullText);
  const hasParallelOffer = /(?:в\s+4\s+руки|в\s+четыре\s+руки|одновременно|параллельно|сразу\s+два\s+мастера)/iu.test(managerEffective);

  // 8. Предложение альтернативных вариантов (вилка времени, другие дни, другие мастера, лист ожидания)
  // Применимо ТОЛЬКО при занятости слота, несовпадении графиков или первичном отказе гостя
  const isSlotConflict = /(?:занят|забронирован|нет мест|нет свободного|не могу|не успе|не подходит время|не получается|пораньше нельзя)/iu.test(fullText);
  const hasAlternativesOffered = /(?:или\s+на|есть\s+еще|могу\s+предложить\s+на|а\s+если|в\s+\d{1,2}:\d{2}\s+или\s+в\s+\d{1,2}:\d{2}|на\s+субботу|на\s+воскресенье|к\s+другому\s+мастеру|лист\s+ожидания)/iu.test(managerEffective);

  // 9. Закрытие на запись
  const hasBookingClosing = /(?:записываю вас|записала вас|ждем вас|запись подтверждаем|будем вас ожидать|оставляем|зафиксировала)/iu.test(managerEffective);
  const isBookingAgreed = /(?:согласие|запись)/iu.test(summary) || hasBookingClosing;

  // 10. Качество коммуникации и завершение
  const hasPoliteClosing = /(?:до свидания|всего доброго|хорошего дня|ждем вас|спасибо|до встречи)/iu.test(managerEffective);
  const hasReminderMention = /(?:напоминание|whatsapp|ватсап|смс|накануне|за полчаса|за 24 часа|сообщени)/iu.test(managerEffective);

  const criteria: CallEvaluationCriterion[] = [
    // 1. Приветствие и представление
    {
      id: 'greeting_intro',
      name: 'Приветствие и представление',
      is_applicable: true,
      score: hasGreeting && hasManagerNameIntro && hasSalonName ? 10 : (hasGreeting && (hasManagerNameIntro || hasSalonName) ? 8 : (hasGreeting ? 7 : 4)),
      explanation: hasGreeting && hasManagerNameIntro && hasSalonName
        ? 'Приветствие по полному корпоративному стандарту: назван салон и имя администратора.'
        : hasGreeting && hasManagerNameIntro
        ? 'Приветствие вежливое с указанием имени администратора, название салона сокращено.'
        : hasGreeting && hasSalonName
        ? 'Приветствие вежливое с названием салона, но администратор не назвал собственное имя.'
        : hasGreeting
        ? 'Приветствие озвучено вежливо, однако не названы имя администратора и салон.'
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
        : 'Потребность выявлена на базовом уровне со слов клиента без активных уточняющих вопросов.'
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
      is_applicable: !isRescheduleOrCheck,
      score: isRescheduleOrCheck ? null : (hasPriceMention ? 10 : 7),
      explanation: isRescheduleOrCheck
        ? 'Звонок посвящен согласованию расписания действующей записи, озвучивание цен не требовалось (не снижает оценку).'
        : hasPriceMention
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
          ? 'Администратор профессионально отработал сомнения/претензии гостя и предложил компромиссное решение.'
          : 'Администратор пассивно отреагировал на сомнения гостя, не предприняв попытки удержания.'
        : 'Возражений со стороны гостя в ходе звонка не возникало (критерий не применим, не снижает общую оценку).'
    },

    // 6. Предложение дополнительных услуг
    {
      id: 'additional_services',
      name: 'Предложение дополнительных услуг',
      is_applicable: isCrossSellApplicable,
      score: !isCrossSellApplicable
        ? null
        : (managerOfferedCrossSell ? 10 : 6),
      explanation: !isCrossSellApplicable
        ? (isDispute
            ? 'Звонок посвящен урегулированию претензии/отмены записи, предложение сопутствующих услуг не требовалось (не снижает оценку).'
            : 'Обращение касается переноса или проверки существующей записи, предложение дополнительных услуг не требовалось (не снижает оценку).')
        : managerOfferedCrossSell
        ? 'Администратор предложил гостю сопутствующие процедуры / дополнительные опции к основной услуге.'
        : 'В разговоре зафиксирована только базовая услуга; сопутствующие процедуры (дизайн, спа-уход, снятие) администратором не предлагались.'
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
      score: (isSlotConflict || !isBookingAgreed) ? (hasAlternativesOffered ? 10 : 4) : null,
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
      score: hasPoliteClosing && hasReminderMention ? 10 : (hasPoliteClosing ? 8 : 6),
      explanation: hasPoliteClosing && hasReminderMention
        ? 'Вежливый, доброжелательный тон, упомянуто напоминание о визите, разговор завершен на позитивной ноте.'
        : hasPoliteClosing
        ? 'Диалог завершен вежливо и доброжелательно, однако регламент напоминания о визите не озвучен.'
        : 'Концовка диалога скомкана, регламент вежливого прощания не соблюден.'
    }
  ];

  return buildCallEvaluation(criteria);
}

/**
 * Синхронизирует список ошибок (mistakes) и советов (advice) с критериями оценки.
 * ГАРАНТИРУЕТ отсутствие противоречий:
 * 1. Если критерий 6 (additional_services) имеет score >= 9 или is_applicable === false,
 *    в ошибках КАТЕГОРИЧЕСКИ НЕ МОЖЕТ быть фразы "Не предложены сопутствующие услуги / процедуры".
 * 2. Если критерий 7 (parallel_booking) неприменим или выполнен, в ошибках нет претензий по записи в 4 руки.
 * 3. Если ошибок нет, но балл снижен, ошибки формируются СТРОГО из применимых критериев с оценкой < 8.
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
  const criteriaMap = new Map<string, CallEvaluationCriterion>();
  (evaluation.criteria || []).forEach(c => criteriaMap.set(c.id, c));

  const critCrossSell = criteriaMap.get('additional_services');
  const critParallel = criteriaMap.get('parallel_booking');
  const critAlternatives = criteriaMap.get('alternative_options');
  const critObjections = criteriaMap.get('handling_objections');

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

  // Очищаем входной список ошибок от противоречий с критериями
  let filteredMistakes = inputMistakes
    .map(m => m.trim())
    .filter(m => {
      if (!m) return false;
      const lower = m.toLowerCase();

      // Противоречие по сопутствующим услугам
      if (isCrossSellNotApplicableOrHigh && (lower.includes('сопутствующ') || lower.includes('допродаж') || lower.includes('спа-уход') || lower.includes('снятие покрытия') || lower.includes('дополнительн'))) {
        return false;
      }

      // Противоречие по параллельной записи
      if (isParallelNotApplicableOrHigh && (lower.includes('параллельн') || lower.includes('4 руки') || lower.includes('четыре руки'))) {
        return false;
      }

      // Противоречие по альтернативным слотам
      if (isAlternativesNotApplicableOrHigh && (lower.includes('альтернативн') || lower.includes('лист ожидания'))) {
        return false;
      }

      // Противоречие по возражениям
      if (isObjectionsNotApplicable && (lower.includes('возражен') || lower.includes('сомнени'))) {
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
      return true;
    });

  const overall = evaluation.overall_score;

  // Если общий балл 10/10 — ошибок быть не может
  if (overall !== null && overall >= 9.8) {
    return {
      mistakes: ['Грубых ошибок не допущено, регламент общения соблюден в полном объеме.'],
      advice: filteredAdvice.length > 0 ? filteredAdvice : ['Поддерживать высокий уровень сервиса и направлять клиенту подтверждение визита.']
    };
  }

  // Если список ошибок опустел или был не заполнен, но оценка снижена (< 10) —
  // выводим ошибки СТРОГО на основе критериев, где оценка < 8
  if (filteredMistakes.length === 0 && overall !== null && overall < 10) {
    const derivedMistakes: string[] = [];
    const derivedAdvice: string[] = [];

    (evaluation.criteria || []).forEach(c => {
      if (c.is_applicable !== false && typeof c.score === 'number' && c.score < 8) {
        switch (c.id) {
          case 'greeting_intro':
            derivedMistakes.push('Администратор не назвал собственное имя при приветствии клиента.');
            derivedAdvice.push('Представляться по полному корпоративному стандарту (название салона + имя администратора).');
            break;
          case 'needs_identification':
            derivedMistakes.push('Не заданы уточняющие вопросы для детального выявления потребностей гостя.');
            derivedAdvice.push('Проявлять активное слушание и уточнять пожелания гостя по услуге, времени и мастеру.');
            break;
          case 'service_and_master_presentation':
            derivedMistakes.push('Презентация мастера проведена формально без акцента на его квалификации и опыте.');
            derivedAdvice.push('Кратко презентовать специалиста (квалификация, опыт, особенности выполнения процедуры).');
            break;
          case 'price_presentation':
            derivedMistakes.push('Стоимость процедуры не была озвучена клиенту в ходе диалога.');
            derivedAdvice.push('Четко и уверенно озвучивать прайс и условия бронирования.');
            break;
          case 'handling_objections':
            derivedMistakes.push('Администратор пассивно отреагировал на сомнения/возражения гостя, не предприняв попытки удержания.');
            derivedAdvice.push('Использовать аргументацию преимуществ салона и предлагать компромиссные решения при сомнениях.');
            break;
          case 'additional_services':
            derivedMistakes.push('Администратор не предложил сопутствующие процедуры к основной услуге (дизайн, спа-уход, снятие покрытия).');
            derivedAdvice.push('Предлагать сопутствующие процедуры и уходовые комплексы при бронировании основной услуги.');
            break;
          case 'parallel_booking':
            derivedMistakes.push('При бронировании комплекса услуг не была предложена опция параллельной записи в 4 руки.');
            derivedAdvice.push('Предлагать гостям параллельную запись в 4 руки для существенной экономии их времени.');
            break;
          case 'alternative_options':
            derivedMistakes.push('При несовпадении времени администратор не предложил альтернативные дни, слоты или лист ожидания.');
            derivedAdvice.push('Всегда предлагать вилку минимум из 2 вариантов времени или запись в лист ожидания.');
            break;
          case 'closing_booking':
            derivedMistakes.push('Не проявлена инициатива по фиксации записи и закрытию диалога.');
            derivedAdvice.push('Инициировать закрытие диалога с четким повторением даты, времени и мастера.');
            break;
          case 'communication_quality_closing':
            derivedMistakes.push('Не оговорён регламент предварительного напоминания о визите накануне.');
            derivedAdvice.push('Обязательно предупреждать клиента об отправке напоминания о визите накануне записи.');
            break;
        }
      }
    });

    if (derivedMistakes.length > 0) {
      filteredMistakes = derivedMistakes;
    }
    if (filteredAdvice.length === 0 && derivedAdvice.length > 0) {
      filteredAdvice = derivedAdvice;
    }
  }

  // Если всё ещё нет советов
  if (filteredAdvice.length === 0) {
    filteredAdvice = [
      'Соблюдать корпоративный регламент ведения телефонных переговоров салона.',
      'Направлять клиенту подтверждение записи и напоминание накануне визита.'
    ];
  }

  return {
    mistakes: filteredMistakes,
    advice: filteredAdvice
  };
}
