/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * ЧЕЙНДЖЛОГ (сборка от 16.11.2026, правки согласованности и доказательности анализа):
 * 1. getSystemPrompt: добавлены Этап 0 (сначала факты — потом выводы), правило разграничения
 *    «предложение времени» vs «состоявшаяся запись», Шаг 7 (missed_opportunities с правилом
 *    реальности), Шаг 8 (финальная самопроверка согласованности разделов), запрет шаблонных
 *    советов про SMS/авто-подтверждение; поле missed_opportunities добавлено в JSON-схему ответа.
 * 2. validateResult: расширенные проверки согласованности (call_outcome<->booking_status,
 *    operator_score<->среднее применимых критериев, оценка в резюме<->operator_score,
 *    фантомные ошибки допродаж при пустом missed_opportunities).
 * 3. parseGigaChatJson: прокидывание missed_opportunities в AnalysisResult с нормализацией.
 * ТРЕБУЕТСЯ В types.ts: добавить в AnalysisResult поле
 *    missed_opportunities?: { type: string; evidence: string; what_to_say: string }[];
 */

import axios from 'axios';
import https from 'https';
import { readStoreSync } from '../store/store.js';
import { getGigaChatToken, isGigaChatConfigured, invalidateGigaChatTokenCache } from './gigachat-auth.js';
import { GigaChatModel, AnalysisResult, CallRecord, NextStepItem, KeyFacts, TokenUsage, ContextClarification, StructuredCallSummary, CallEvaluationCriterion, CallEvaluation } from '../types.js';
import {
  VERIFIER_PROMPT,
  CRITERIA_VERIFIER_PROMPT,
  verifySummary,
  verifyCriteriaWithTranscript,
  applyVerdicts,
  isQuotePresentInTranscript,
  buildConciseDraftForVerifier,
  runTwoPassVerification,
} from './callVerifier.js';

export {
  VERIFIER_PROMPT,
  CRITERIA_VERIFIER_PROMPT,
  verifySummary,
  verifyCriteriaWithTranscript,
  applyVerdicts,
  isQuotePresentInTranscript,
  buildConciseDraftForVerifier,
  runTwoPassVerification,
};

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

export const FALLBACK_SALON_MASTERS = [
  'Дарья Прибыткова',
  'Елена Валиулова',
  'Татьяна Валиулова',
  'Арина Егорова',
  'Наталья Гуркина',
  'Екатерина Кожевникова',
  'Кристина',
  'Анна',
  'Ирина',
];

let crmMastersCache: { list: string[]; fetchedAt: number } | null = null;
const CRM_MASTERS_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Динамически подтягивает актуальный список мастеров из YClients CRM (с 10-минутным кэшем
 * и резервным списком известных мастеров салона).
 */
export async function getCrmMastersList(): Promise<string[]> {
  if (crmMastersCache && Date.now() - crmMastersCache.fetchedAt < CRM_MASTERS_CACHE_TTL_MS) {
    return crmMastersCache.list;
  }

  const merged = new Set<string>(FALLBACK_SALON_MASTERS);

  try {
    const store = readStoreSync();
    const yclients = store?.config?.yclients;
    const userToken = (yclients?.userToken || process.env.YCLIENTS_USER_TOKEN || '').trim();
    const partnerToken = (yclients?.partnerToken || process.env.YCLIENTS_PARTNER_TOKEN || '').trim();
    const salonId = (yclients?.salonId || process.env.YCLIENTS_SALON_ID || '').trim();

    if (
      userToken &&
      salonId &&
      !userToken.includes('example') &&
      !partnerToken.includes('example')
    ) {
      const authHeader = partnerToken
        ? `Bearer ${partnerToken}, User ${userToken}`
        : `Bearer ${userToken}`;
      const res = await fetch(`https://api.yclients.com/api/v1/staff/${encodeURIComponent(salonId)}`, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.yclients.v2+json',
          Authorization: authHeader,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const json: any = await res.json();
        const staffList: any[] = Array.isArray(json?.data) ? json.data : [];
        for (const member of staffList) {
          if (member && member.fired !== 1 && member.hidden !== 1 && typeof member.name === 'string') {
            const cleanName = member.name.trim();
            if (cleanName.length >= 2) {
              merged.add(cleanName);
            }
          }
        }
      }
    }
  } catch (err: any) {
    console.warn(`[GigaChat Masters] Не удалось получить список мастеров из YClients: ${err?.message || err}`);
  }

  const list = Array.from(merged);
  crmMastersCache = { list, fetchedAt: Date.now() };
  return list;
}

export function getSystemPrompt(customSalonName?: string, mastersList?: string[]): string {
  const salon = customSalonName || process.env.SALON_NAME || 'Fashion Look Studio';
  const effectiveMasters =
    Array.isArray(mastersList) && mastersList.length > 0 ? mastersList : FALLBACK_SALON_MASTERS;
  const mastersBlock = effectiveMasters.join(', ');

  return `Ты — аудитор телефонных звонков салона красоты «${salon}». Ты работаешь строго по стенограмме. Ни одного факта вне стенограммы.

[СПИСОК МАСТЕРОВ]
Актуальный список мастеров салона: ${mastersBlock}.
Если имя мастера в стенограмме искажено распознаванием речи (например, «уволюовой Татьяны»), сопоставь с этим списком (Татьяна Валиулова) и укажи примечание в поле note. Выдумывать других мастеров вне стенограммы и этого списка ЗАПРЕЩЕНО.

=== ЭТАП 1. ИЗВЛЕЧЕНИЕ ФАКТОВ ===
Выпиши КАЖДЫЙ факт, релевантный резюме, в JSON. Каждому факту — точная дословная цитата из стенограммы. Факт без цитаты не существует.

{
  "client_name": {"value": "...", "quote": "..."},
  "desired_service": {"value": "услуга или 'не озвучено'", "quote": "..."},
  "master": {"value": "имя или 'не озвучено'", "quote": "...", "note": "если имя в стенограмме искажено"},
  "prices_mentioned": [{"value": "...", "quote": "..."}],
  "date_time_offered": {"value": "или 'не озвучено'", "quote": "..."},
  "booking_markers": [{"value": "дословная реплика о записи", "quote": "..."}],
  "greeting_check": {
    "greeted": true,
    "addressed_client_by_name": true,
    "named_salon": true,
    "named_self": false,
    "quote": "..."
  }
}

=== ЭТАП 2. КЛАССИФИКАЦИЯ СТАТУСА ===
- "Запись состоялась" — если клиент явно подтвердил запись («хорошо», «да», «запишите», «записалась», «подтвердили», «буду», «подойду», «договорились») И/ИЛИ менеджер явно подтвердил бронь («жду», «ждём», «будем ожидать», «записал», «запись оформлена», «принято»).
- "Отсрочка" — клиент просит подумать / перезвонит / проверить расписание.
- "Отказ" — клиент отказался от услуги, цены или времени.
- "Консультация" — вопрос без попытки записаться или уведомление (предупреждение об опоздании, организационный вопрос).
- "Не применимо" — разговор не состоялся (тишина, гудки, сброс, автоответчик без живого диалога).

ВАЖНЫЕ ПРАВИЛА РАЗБОРА РОЛЕЙ И СТАТУСА:
- Метки ролей (Менеджер/Клиент) в стенограмме могут быть неточными — ориентируйся на смысл реплик!
- Приветствие салона («Добрый день, салон ...», «Fashion Look», «Лук Студия») и озвучивание расписания/цен — всегда реплики Менеджера.
- Вопросы об услуге, стоимости, окошках и фразы подтверждения/отказа клиента — реплики Клиента.
- Фразы автоинформатора АТС («разговор может быть записан», «вы позвонили в салон») выноси как «Автоинформатор: ...» и не принимай за согласие клиента на запись.

=== ЭТАП 3. РЕЗЮМЕ ===
Составляется ИСКЛЮЧИТЕЛЬНО из фактов ЭТАПА 1.
Каждое утверждение должно ссылаться на цитату из ЭТАПА 1.
Если поля не было в ЭТАПЕ 1 — пиши "не озвучено".
ЗАПРЕЩЕНО домысливать услуги, имена, цены, причины, отсутствующие в ЭТАПЕ 1.
Время всегда приводи к формату ЧЧ:ММ (например, «в 10 подойдёте?» -> «10:00», «15 0 0» -> «15:00»).

=== ЭТАП 4. АУДИТ МЕНЕДЖЕРА ===
Оценивай по 10 критериям от 0 до 10 баллов (применимость определяй строго по диалогу; неприменимые критерии отмечай applicable: false и score: null):
1. Приветствие и представление
2. Выявление потребности гостя
3. Презентация услуги и мастера
4. Корректная презентация стоимости
5. Работа с возражениями
6. Предложение дополнительных услуг
7. Предложение параллельной записи
8. Предложение альтернативных вариантов
9. Закрытие на запись
10. Качество коммуникации и завершение разговора

Для каждого применимого критерия укажи дословную цитату из стенограммы или напиши "не применимо" (при applicable: false).
Правило по приветствию: если менеджер поприветствовал клиента (особенно с обращением по имени и названием салона, например: «Добрый день, Михаил. Салон красоты Лук Студия.») — критерий 1 «Приветствие и представление» оценивается высоко (9–10 баллов); НЕ снижай балл с формулировкой «не представился», если в приветствии есть приветствие + имя клиента или название салона.
Правило по стоимости: если конкретные цифры/рубли не озвучивались, критерий 4 имеет applicable: false, score: null.
Правило по возражениям и альтернативам: если не было отказа или несогласия по времени/цене, критерии 5 и 8 имеют applicable: false, score: null.

ЗАПРЕЩЕНО:
- Писать "не представился", если в приветствии звучали приветствие + имя клиента или название салона.
- Писать "менеджер не переспросил про...", если клиент сам завершил тему.
- Придумывать ошибки и советы про SMS/автоподтверждения или допродажи, если диалог короткий/подтверждающий или для этого не было основания в стенограмме.
- Копировать шаблонные фразы из примеров.
- Выводить любой текст вне JSON.

ФОРМАТ ОТВЕТА (строго JSON без markdown):
{
  "is_conversation": true,
  "formatted_transcript": "Менеджер: ...\\nКлиент: ...",
  "facts": {
    "client_name": {"value": "имя или 'не озвучено'", "quote": "точная цитата или null"},
    "desired_service": {"value": "услуга или 'не озвучено'", "quote": "точная цитата или null"},
    "master": {"value": "имя из [СПИСОК МАСТЕРОВ] / стенограммы или 'не озвучено'", "quote": "точная цитата или null", "note": ""},
    "prices_mentioned": [{"value": "...", "quote": "..."}],
    "date_time_offered": {"value": "дата и время (ЧЧ:ММ) или 'не озвучено'", "quote": "точная цитата или null"},
    "booking_markers": [{"value": "реплика о записи", "quote": "точная цитата"}],
    "greeting_check": {"greeted": true, "addressed_client_by_name": false, "named_salon": true, "named_self": false, "quote": "точная цитата или null"}
  },
  "booking_status": "Запись состоялась | Отсрочка | Отказ | Консультация | Не применимо",
  "summary": {
    "goal": "Цель обращения строго по стенограмме...",
    "service": "услуга или 'не озвучено'",
    "master": "имя или 'не озвучено'",
    "price": "озвученная цена или 'не озвучено'",
    "date_time": "дата и время (ЧЧ:ММ) или 'не озвучено'",
    "booking_done": "итоговый статус записи строго по фактам...",
    "reason_if_not": "причина если не состоялась или 'не применимо'",
    "manager_next_steps": ["конкретный шаг 1 строго по диалогу"],
    "short_summary": "Суть обращения + краткий фактологический пересказ (2–6 предложений по этапам диалога) + фактический вывод.",
    "quotes_support": ["точная цитата 1 из стенограммы", "точная цитата 2"]
  },
  "audit": {
    "criteria": [
      {"name": "Приветствие и представление", "score": 9, "applicable": true, "reasoning": "...", "quote": "..."}
    ],
    "overall_score": 9,
    "mistakes": []
  },
  "recommendations": ["прикладная рекомендация строго по этому звонку"],
  "missed_opportunities": []
}`;
}

export const SYSTEM_PROMPT = getSystemPrompt();
export const getDefaultSystemPrompt = getSystemPrompt;


/// ============================================================
// БАЗОВЫЕ ПРИМЕРЫ (few-shot) в строгом 4-этапном формате
// ============================================================
export const FEW_SHOT_EXAMPLES = `
ПРИМЕР 1 (пустой звонок / автоответчик)
Транскрипт: "[тишина] [гудки] [сброс]" (длительность 5 сек)
Ответ:
{
  "is_conversation": false,
  "formatted_transcript": "Разговор не состоялся (диалог отсутствует)",
  "facts": {
    "client_name": {"value": "не озвучено", "quote": null},
    "desired_service": {"value": "не озвучено", "quote": null},
    "master": {"value": "не озвучено", "quote": null, "note": ""},
    "prices_mentioned": [],
    "date_time_offered": {"value": "не озвучено", "quote": null},
    "booking_markers": [],
    "greeting_check": {"greeted": false, "addressed_client_by_name": false, "named_salon": false, "named_self": false, "quote": null}
  },
  "booking_status": "Не применимо",
  "summary": {
    "goal": "Разговор не состоялся",
    "service": "не озвучено",
    "master": "не озвучено",
    "price": "не озвучено",
    "date_time": "не озвучено",
    "booking_done": "Разговор не состоялся (диалог отсутствует)",
    "reason_if_not": "Диалог отсутствует",
    "manager_next_steps": ["Повторить попытку дозвона клиенту в рабочее время салона."],
    "short_summary": "Разговор не состоялся: живой диалог между сторонами отсутствует.",
    "quotes_support": []
  },
  "audit": {
    "criteria": [],
    "overall_score": null,
    "mistakes": []
  },
  "recommendations": ["Повторить попытку дозвона клиенту в рабочее время салона."],
  "missed_opportunities": []
}

ПРИМЕР 2 (подтверждение короткой записи с обращением к клиенту по имени)
Транскрипт: "Менеджер: Добрый день, Михаил. Салон красоты Лук Студия. Менеджер: Завтра в 10 подойдёте? Клиент: Да, все, запись подтвердили. Менеджер: Будем ожидать вас. Спасибо за обратный звонок. Клиент: Угу. Хорошего дня."
Ответ:
{
  "is_conversation": true,
  "formatted_transcript": "Менеджер: Добрый день, Михаил. Салон красоты Лук Студия.\\nМенеджер: Завтра в 10 подойдёте?\\nКлиент: Да, все, запись подтвердили.\\nМенеджер: Будем ожидать вас. Спасибо за обратный звонок.\\nКлиент: Угу. Хорошего дня.",
  "facts": {
    "client_name": {"value": "Михаил", "quote": "Добрый день, Михаил."},
    "desired_service": {"value": "не озвучено", "quote": null},
    "master": {"value": "не озвучено", "quote": null, "note": ""},
    "prices_mentioned": [],
    "date_time_offered": {"value": "завтра, 10:00", "quote": "Завтра в 10 подойдёте?"},
    "booking_markers": [
      {"value": "Да, все, запись подтвердили.", "quote": "Да, все, запись подтвердили."},
      {"value": "Будем ожидать вас.", "quote": "Будем ожидать вас."}
    ],
    "greeting_check": {"greeted": true, "addressed_client_by_name": true, "named_salon": true, "named_self": false, "quote": "Добрый день, Михаил. Салон красоты Лук Студия."}
  },
  "booking_status": "Запись состоялась",
  "summary": {
    "goal": "Подтверждение записи на завтра в 10:00",
    "service": "не озвучено",
    "master": "не озвучено",
    "price": "не озвучено",
    "date_time": "завтра 10:00",
    "booking_done": "Запись состоялась (подтверждена клиентом на завтра в 10:00)",
    "reason_if_not": "не применимо",
    "manager_next_steps": ["Отметить подтверждение визита на завтра в 10:00 в CRM."],
    "short_summary": "Суть обращения: услуга — не озвучено, дата — завтра, время — 10:00, мастер — не озвучено. Пересказ диалога: Менеджер салона красоты «Лук Студия» поприветствовал клиента Михаила и уточнил, подойдёт ли он завтра в 10:00. Клиент подтвердил запись, после чего менеджер поблагодарил за обратный звонок и подтвердил ожидание. Вывод: Запись подтверждена на завтра в 10:00.",
    "quotes_support": ["Добрый день, Михаил. Салон красоты Лук Студия.", "Завтра в 10 подойдёте?", "Да, все, запись подтвердили."]
  },
  "audit": {
    "criteria": [
      {"name": "Приветствие и представление", "score": 9, "applicable": true, "reasoning": "Вежливое приветствие с обращением по имени клиента и названием салона.", "quote": "Добрый день, Михаил. Салон красоты Лук Студия."},
      {"name": "Выявление потребности гостя", "score": null, "applicable": false, "reasoning": "Звонок направлен на подтверждение уже согласованного визита.", "quote": "не применимо"},
      {"name": "Презентация услуги и мастера", "score": null, "applicable": false, "reasoning": "Услуга и мастер в этом коротком подтверждении не обсуждались.", "quote": "не применимо"},
      {"name": "Корректная презентация стоимости", "score": null, "applicable": false, "reasoning": "Стоимость не озвучивалась.", "quote": "не применимо"},
      {"name": "Работа с возражениями", "score": null, "applicable": false, "reasoning": "Возражений не возникало.", "quote": "не применимо"},
      {"name": "Предложение дополнительных услуг", "score": null, "applicable": false, "reasoning": "Короткий подтверждающий звонок.", "quote": "не применимо"},
      {"name": "Предложение параллельной записи", "score": null, "applicable": false, "reasoning": "Не требовалась.", "quote": "не применимо"},
      {"name": "Предложение альтернативных вариантов", "score": null, "applicable": false, "reasoning": "Время устроило клиента сразу.", "quote": "не применимо"},
      {"name": "Закрытие на запись", "score": 10, "applicable": true, "reasoning": "Запись чётко подтверждена сторонами.", "quote": "Будем ожидать вас."},
      {"name": "Качество коммуникации и завершение разговора", "score": 10, "applicable": true, "reasoning": "Доброжелательное завершение диалога.", "quote": "Спасибо за обратный звонок."}
    ],
    "overall_score": 10,
    "mistakes": []
  },
  "recommendations": ["Поддерживать аналогичный вежливый и чёткий формат подтверждения визитов."],
  "missed_opportunities": []
}

ПРИМЕР 3 (отказ по времени)
Транскрипт: "Менеджер: Салон «Фешен лук студио», добрый день. Клиент: Хочу стрижку на выходных. Менеджер: На выходных есть суббота в 12:00. Клиент: Нет, я буду в отъезде, не подходит. Менеджер: Хорошо, звоните. Клиент: До свидания."
Ответ:
{
  "is_conversation": true,
  "formatted_transcript": "Менеджер: Салон «Фешен лук студио», добрый день.\\nКлиент: Хочу стрижку на выходных.\\nМенеджер: На выходных есть суббота в 12:00.\\nКлиент: Нет, я буду в отъезде, не подходит.\\nМенеджер: Хорошо, звоните.\\nКлиент: До свидания.",
  "facts": {
    "client_name": {"value": "не озвучено", "quote": null},
    "desired_service": {"value": "стрижка", "quote": "Хочу стрижку на выходных."},
    "master": {"value": "не озвучено", "quote": null, "note": ""},
    "prices_mentioned": [],
    "date_time_offered": {"value": "суббота 12:00", "quote": "На выходных есть суббота в 12:00."},
    "booking_markers": [{"value": "Нет, я буду в отъезде, не подходит.", "quote": "Нет, я буду в отъезде, не подходит."}],
    "greeting_check": {"greeted": true, "addressed_client_by_name": false, "named_salon": true, "named_self": false, "quote": "Салон «Фешен лук студио», добрый день."}
  },
  "booking_status": "Отказ",
  "summary": {
    "goal": "Запись на стрижку на выходные",
    "service": "стрижка",
    "master": "не озвучено",
    "price": "не озвучено",
    "date_time": "суббота 12:00",
    "booking_done": "Запись не состоялась (отказ по дате/времени)",
    "reason_if_not": "Клиент будет в отъезде в субботу",
    "manager_next_steps": ["Зафиксировать запрос на стрижку и уточнить удобные будние дни при повторном контакте."],
    "short_summary": "Суть обращения: услуга — стрижка, дата — суббота, время — 12:00, мастер — не озвучено. Пересказ диалога: Клиент запросил запись на стрижку в выходные дни. Менеджер предложил субботу в 12:00, но клиент отказался, так как будет в отъезде. Альтернативные даты предложены не были. Вывод: Запись не состоялась из-за несовпадения по времени.",
    "quotes_support": ["Хочу стрижку на выходных.", "На выходных есть суббота в 12:00.", "Нет, я буду в отъезде, не подходит."]
  },
  "audit": {
    "criteria": [
      {"name": "Приветствие и представление", "score": 8, "applicable": true, "reasoning": "Назван салон и приветствие, без имени администратора.", "quote": "Салон «Фешен лук студио», добрый день."},
      {"name": "Выявление потребности гостя", "score": 6, "applicable": true, "reasoning": "Пожелания по другим дням не уточнены.", "quote": "Хочу стрижку на выходных."},
      {"name": "Корректная презентация стоимости", "score": null, "applicable": false, "reasoning": "Стоимость не озвучивалась.", "quote": "не применимо"},
      {"name": "Работа с возражениями", "score": 4, "applicable": true, "reasoning": "После отказа клиента по причине отъезда попытки подобрать другое время не предприняты.", "quote": "Хорошо, звоните."},
      {"name": "Предложение альтернативных вариантов", "score": 3, "applicable": true, "reasoning": "Предложен один слот без вилки времени и без листа ожидания.", "quote": "На выходных есть суббота в 12:00."},
      {"name": "Закрытие на запись", "score": 3, "applicable": true, "reasoning": "Диалог завершен без фиксации следующего шага.", "quote": "Хорошо, звоните."},
      {"name": "Качество коммуникации и завершение разговора", "score": 7, "applicable": true, "reasoning": "Вежливое, но пассивное завершение.", "quote": "Хорошо, звоните."}
    ],
    "overall_score": 5,
    "mistakes": ["При отказе от субботы не предложены альтернативные дни или лист ожидания"]
  },
  "recommendations": ["Предлагать минимум 2 варианта времени и альтернативные будние дни при занятости в выходные."],
  "missed_opportunities": [{"type": "alternative_master", "evidence": "Нет, я буду в отъезде, не подходит.", "what_to_say": "Подскажите, в пятницу вечером или в начале следующей недели вам было бы удобно подойти?"}]
}
`;

export const FEW_SHOT_EDGE_CASES = `
ПРИМЕР 4 (короткий запрос цены — 12 сек, консультация)
Транскрипт: "Менеджер: Салон «Фешен лук студио». Клиент: Сколько стоит педикюр? Менеджер: От 1800 рублей. Клиент: Понял, спасибо."
Ответ:
{
  "is_conversation": true,
  "formatted_transcript": "Менеджер: Салон «Фешен лук студио».\\nКлиент: Сколько стоит педикюр?\\nМенеджер: От 1800 рублей.\\nКлиент: Понял, спасибо.",
  "facts": {
    "client_name": {"value": "не озвучено", "quote": null},
    "desired_service": {"value": "педикюр", "quote": "Сколько стоит педикюр?"},
    "master": {"value": "не озвучено", "quote": null, "note": ""},
    "prices_mentioned": [{"value": "от 1800 рублей", "quote": "От 1800 рублей."}],
    "date_time_offered": {"value": "не озвучено", "quote": null},
    "booking_markers": [],
    "greeting_check": {"greeted": false, "addressed_client_by_name": false, "named_salon": true, "named_self": false, "quote": "Салон «Фешен лук студио»."}
  },
  "booking_status": "Консультация",
  "summary": {
    "goal": "Уточнение стоимости педикюра",
    "service": "педикюр",
    "master": "не озвучено",
    "price": "от 1800 рублей",
    "date_time": "не озвучено",
    "booking_done": "Запись не оформлялась (справочная консультация по цене)",
    "reason_if_not": "Клиент уточнял только стоимость",
    "manager_next_steps": ["Отмечать входящие ценовые запросы; при повторном вопросе предлагать свободные окна."],
    "short_summary": "Суть обращения: услуга — педикюр, дата — не озвучено, время — не озвучено, мастер — не озвучено. Пересказ диалога: Клиент уточнил стоимость педикюра. Администратор ответил, что стоимость начинается от 1800 рублей, после чего клиент поблагодарил и завершил звонок. Вывод: Проведена короткая ценовая консультация без записи.",
    "quotes_support": ["Сколько стоит педикюр?", "От 1800 рублей."]
  },
  "audit": {
    "criteria": [
      {"name": "Приветствие и представление", "score": 8, "applicable": true, "reasoning": "Назван салон.", "quote": "Салон «Фешен лук студио»."},
      {"name": "Корректная презентация стоимости", "score": 8, "applicable": true, "reasoning": "Озвучена минимальная стоимость услуги от 1800 рублей.", "quote": "От 1800 рублей."},
      {"name": "Закрытие на запись", "score": 5, "applicable": true, "reasoning": "Не предложено подобрать удобное окно после озвучивания цены.", "quote": "От 1800 рублей."}
    ],
    "overall_score": 7,
    "mistakes": ["После ответа о цене не предложена запись на процедуру"]
  },
  "recommendations": ["После ответа о стоимости сразу предлагать подобрать удобное время к мастеру."],
  "missed_opportunities": []
}

ПРИМЕР 5 (отсрочка / договорённость о перезвоне)
Транскрипт: "Менеджер: Салон «Фешен лук студио», добрый день. Клиент: Хочу записаться на окрашивание, но не знаю, когда освобожусь. Менеджер: Давайте я вам позвоню завтра утром? Клиент: Да, удобно, после 10:00."
Ответ:
{
  "is_conversation": true,
  "formatted_transcript": "Менеджер: Салон «Фешен лук студио», добрый день.\\nКлиент: Хочу записаться на окрашивание, но не знаю, когда освобожусь.\\nМенеджер: Давайте я вам позвоню завтра утром?\\nКлиент: Да, удобно, после 10:00.",
  "facts": {
    "client_name": {"value": "не озвучено", "quote": null},
    "desired_service": {"value": "окрашивание", "quote": "Хочу записаться на окрашивание"},
    "master": {"value": "не озвучено", "quote": null, "note": ""},
    "prices_mentioned": [],
    "date_time_offered": {"value": "завтра после 10:00 (перезвон)", "quote": "Давайте я вам позвоню завтра утром?"},
    "booking_markers": [{"value": "Да, удобно, после 10:00.", "quote": "Да, удобно, после 10:00."}],
    "greeting_check": {"greeted": true, "addressed_client_by_name": false, "named_salon": true, "named_self": false, "quote": "Салон «Фешен лук студио», добрый день."}
  },
  "booking_status": "Отсрочка",
  "summary": {
    "goal": "Запись на окрашивание (согласован перезвон)",
    "service": "окрашивание",
    "master": "не озвучено",
    "price": "не озвучено",
    "date_time": "завтра после 10:00 (перезвон)",
    "booking_done": "Отсрочка: согласован перезвон завтра после 10:00",
    "reason_if_not": "Клиент не знает расписание, ожидается перезвон",
    "manager_next_steps": ["Перезвонить клиенту завтра после 10:00 для фиксации записи на окрашивание."],
    "short_summary": "Суть обращения: услуга — окрашивание, дата — завтра (перезвон), время — 10:00, мастер — не озвучено. Пересказ диалога: Клиент выразил желание записаться на окрашивание, но не смог сразу назвать удобное время. Администратор предложил перезвонить завтра утром, клиент подтвердил удобство звонка после 10:00. Вывод: Договорились о повторном звонке завтра после 10:00.",
    "quotes_support": ["Хочу записаться на окрашивание, но не знаю, когда освобожусь.", "Давайте я вам позвоню завтра утром?", "Да, удобно, после 10:00."]
  },
  "audit": {
    "criteria": [
      {"name": "Приветствие и представление", "score": 8, "applicable": true, "reasoning": "Назван салон и приветствие.", "quote": "Салон «Фешен лук студио», добрый день."},
      {"name": "Закрытие на запись", "score": 8, "applicable": true, "reasoning": "Согласован конкретный следующий шаг — перезвон завтра после 10:00.", "quote": "Давайте я вам позвоню завтра утром?"}
    ],
    "overall_score": 8,
    "mistakes": []
  },
  "recommendations": ["Уточнять вид окрашивания и длину волос перед перезвоном для расчёта времени."],
  "missed_opportunities": []
}
`;


/**
 * Собирает пользовательскую часть промпта: примеры + транскрипт + длительность.
 * Системная часть (SYSTEM_PROMPT) передаётся отдельным сообщением с ролью 'system'.
 */
export const buildUserPrompt = (transcript: string, callDurationSeconds?: number): string => {
  const durationLine =
    callDurationSeconds !== undefined
      ? `Фактическая длительность звонка: ${callDurationSeconds} сек. (вспомогательный признак — решает СОДЕРЖАНИЕ диалога).\n`
      : '';
  return `ПРИМЕРЫ ПРАВИЛЬНЫХ ОТВЕТОВ (ориентируйся на них по структуре и логике):
${FEW_SHOT_EXAMPLES}
${FEW_SHOT_EDGE_CASES}

ТРАНСКРИПТ ЗВОНКА:
${durationLine}${transcript}`;
};

/**
 * Программная проверка согласованности ответа модели.
 * Базовые проверки: оценка при несостоявшемся звонке и статус «не состоялся» при реальном диалоге.
 * Дополнительные проверки (согласованность разделов): call_outcome<->booking_status,
 * operator_score<->среднее применимых критериев, оценка в резюме<->operator_score,
 * «фантомные» ошибки допродаж при пустом missed_opportunities,
 * санитарная проверка мастера, синхронизация критерия цены с offered_price.
 */
export function validateResult(result: AnalysisResult): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const notHappened =
    result.key_facts.call_outcome === 'не состоялся' || result.booking_status === 'не применимо';

  if (notHappened) {
    if (result.operator_score !== null) {
      errors.push('Звонок не состоялся, но operator_score не null');
    }
    if (result.booking_status !== 'не применимо') {
      errors.push('Звонок не состоялся, но booking_status не "не применимо"');
    }
    if (result.key_facts.call_outcome !== 'не состоялся') {
      errors.push('Звонок не состоялся, но call_outcome не "не состоялся"');
    }
  } else {
    if (typeof result.operator_score !== 'number') {
      errors.push('Разговор состоялся, но operator_score не число');
    }
    if (result.booking_status === 'не применимо') {
      errors.push('Разговор состоялся, но booking_status = "не применимо"');
    }
  }

  if (result.booking_status !== result.key_facts.booking_status) {
    errors.push('booking_status не совпадает с key_facts.booking_status');
  }

  // 1. call_outcome <-> booking_status
  const outcomeBookingMap: Record<string, string[]> = {
    'запись': ['согласие'],
    'отказ': ['отказ'],
    'консультация': ['консультация'],
    'перезвон': ['консультация'],
    'отмена': ['отказ', 'согласие', 'консультация'],
  };
  if (!notHappened) {
    const allowed = outcomeBookingMap[result.key_facts.call_outcome];
    if (allowed && !allowed.includes(result.booking_status)) {
      errors.push(`call_outcome «${result.key_facts.call_outcome}» не согласован с booking_status «${result.booking_status}»`);
    }
  }

  // 2. operator_score <-> среднее применимых критериев (допуск ±1)
  const kfAny = result.key_facts as any;
  const criteria: any[] =
    (Array.isArray(result.criteria_scores) ? result.criteria_scores : null) ||
    ((result as any).evaluation && Array.isArray((result as any).evaluation.criteria)
      ? (result as any).evaluation.criteria
      : null) ||
    (Array.isArray(kfAny?.criteria_scores) ? kfAny.criteria_scores : []);
  const applicableScores = criteria
    .filter((c: any) => c && c.is_applicable === true && typeof c.score === 'number' && !isNaN(c.score))
    .map((c: any) => c.score as number);
  if (!notHappened && applicableScores.length > 0 && typeof result.operator_score === 'number') {
    const avg = Math.round(applicableScores.reduce((s, v) => s + v, 0) / applicableScores.length);
    if (Math.abs(result.operator_score - avg) > 1) {
      errors.push(`operator_score (${result.operator_score}) расходится со средним применимых критериев (${avg})`);
    }
  }

  // 3. Оценка в тексте резюме <-> operator_score (допуск ±1)
  if (!notHappened && typeof result.operator_score === 'number') {
    const m = String(result.transcript_summary || '').match(/оценка\s*(\d{1,2})\s*\/\s*10/i);
    if (m) {
      const summaryScore = parseInt(m[1], 10);
      if (!isNaN(summaryScore) && Math.abs(summaryScore - result.operator_score) > 1) {
        errors.push(`оценка в transcript_summary (${summaryScore}/10) расходится с operator_score (${result.operator_score})`);
      }
    }
  }

  // 4. Фантомные ошибки допродаж: missed_opportunities пуст — формулировок о несостоявшихся допродажах быть не должно
  const missed = (result as any).missed_opportunities;
  if (Array.isArray(missed) && missed.length === 0 && Array.isArray(result.operator_mistakes)) {
    const phantom = result.operator_mistakes.filter((mm: string) =>
      /не предложил\s+(?:сопутств|доп|альтернатив|параллель|другого специалиста|мастера другой)/i.test(String(mm))
    );
    if (phantom.length > 0) {
      errors.push('missed_opportunities пуст, но в operator_mistakes есть формулировки о несостоявшихся допродажах');
    }
  }

  // 5. Санитарная проверка мастера: поле не может быть не-именем
  const mVal = String(result.key_facts.master || '').trim();
  if (mVal && /окошечк|окошк|слот|время|секунд|расписан|студио/i.test(mVal)) {
    errors.push(`в key_facts.master записано «${mVal}» — это не ФИО мастера`);
  }

  // 6. Цена: критерий применим, но суммы в offered_price нет
  const priceCrit = criteria.find((c: any) => c?.id === 'price_presentation');
  if (priceCrit?.is_applicable === true) {
    const priceText = String(result.key_facts.offered_price || '');
    const hasPrice = /\d/.test(priceText) && !/не озвуч|не применимо/i.test(priceText);
    if (!hasPrice) {
      errors.push('price_presentation применим, но offered_price без суммы — стоимость в диалоге не озвучивалась');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Очередь запросов к GigaChat (FIFO) с ограничением параллелизма = 1.
 * Гарантирует, что к GigaChat идёт не более 1 запроса одновременно,
 * а остальные запросы последовательно ожидают в очереди.
 */
interface QueueTask<T> {
  id: string;
  description: string;
  fn: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
  enqueuedAt: number;
}

export class GigaChatQueue {
  private queue: QueueTask<any>[] = [];
  private isProcessing = false;
  private currentTaskId: string | null = null;
  private totalProcessed = 0;
  private minIntervalMs = 400; // Минимальная пауза между запросами (защита от burst-лимитов)
  private lastRequestEndTime = 0;

  /**
   * Добавляет асинхронную задачу в очередь FIFO.
   */
  public enqueue<T>(fn: () => Promise<T>, description = 'Запрос к GigaChat'): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = `giga-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const task: QueueTask<T> = {
        id,
        description,
        fn,
        resolve,
        reject,
        enqueuedAt: Date.now(),
      };

      this.queue.push(task);
      const position = this.queue.length;

      if (this.isProcessing) {
        console.log(`[GigaChat Очередь] «${description}» [${id}] добавлен в очередь (позиция: ${position})`);
      }

      this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const item = this.queue.shift()!;
    this.currentTaskId = item.id;
    const waitTimeMs = Date.now() - item.enqueuedAt;

    try {
      // Соблюдение минимального интервала между последовательными запросами
      const elapsedSinceLast = Date.now() - this.lastRequestEndTime;
      if (this.lastRequestEndTime > 0 && elapsedSinceLast < this.minIntervalMs) {
        await new Promise(r => setTimeout(r, this.minIntervalMs - elapsedSinceLast));
      }

      if (waitTimeMs > 150) {
        console.log(`[GigaChat Очередь] Выполнение [${item.id}] «${item.description}» (ожидание в очереди: ${waitTimeMs} мс, осталось: ${this.queue.length})`);
      }

      const result = await item.fn();
      this.totalProcessed++;
      item.resolve(result);
    } catch (err) {
      item.reject(err);
    } finally {
      this.lastRequestEndTime = Date.now();
      this.currentTaskId = null;
      this.isProcessing = false;
      // Переход к следующему элементу в очереди
      setImmediate(() => this.processNext());
    }
  }

  public getStatus() {
    return {
      pending: this.queue.length,
      isProcessing: this.isProcessing,
      currentTaskId: this.currentTaskId,
      totalProcessed: this.totalProcessed,
    };
  }
}

export const gigaChatQueue = new GigaChatQueue();

export function getGigaChatQueueStatus() {
  return gigaChatQueue.getStatus();
}

const MAX_RETRIES = 4;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 32000;

export type GigaChatLogCallback = (
  type: 'info' | 'warning' | 'error' | 'success',
  message: string
) => void;

/**
 * Выполняет анализ через GigaChat с очередью FIFO (параллелизм = 1)
 * и экспоненциальной задержкой retry (особенно при ошибках 429 Too Many Requests).
 */
export async function analyzeWithRetry(
  transcript: string,
  model?: GigaChatModel,
  onLog?: GigaChatLogCallback,
  callDurationSeconds?: number,
  customSalonName?: string,
  customSystemPrompt?: string
): Promise<AnalysisResult> {
  const modelName = model || 'GigaChat:Lite';
  return gigaChatQueue.enqueue(async () => {
    return executeWithExponentialBackoff(transcript, modelName, onLog, callDurationSeconds, customSalonName, customSystemPrompt);
  }, `Анализ транскрипта (${modelName})`);
}

async function executeWithExponentialBackoff(
  transcript: string,
  model: GigaChatModel,
  onLog?: GigaChatLogCallback,
  callDurationSeconds?: number,
  customSalonName?: string,
  customSystemPrompt?: string
): Promise<AnalysisResult> {
  let lastError: any = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await analyzeWithGigaChat(transcript, model, callDurationSeconds, customSalonName, customSystemPrompt);
    } catch (error: any) {
      lastError = error;
      const status = error.response?.status;
      const responseData = error.response?.data;
      const responseMsg = responseData?.message || responseData?.description || error.message || String(error);

      // Проверка на ошибку лимита 429 (Too Many Requests / Rate Limit)
      const is429 = status === 429 ||
        /429|too many requests|rate limit|queries per second|quota exceeded/i.test(responseMsg);

      // При ошибках аутентификации 401/403 сбрасываем кэш токена
      if (status === 401 || status === 403) {
        invalidateGigaChatTokenCache();
        console.warn(`[GigaChat] Ошибка авторизации (HTTP ${status}). Сброс токена и повторная авторизация...`);
      }

      console.error(
        `[GigaChat] Попытка ${attempt}/${MAX_RETRIES} завершилась ошибкой (HTTP ${status || 'ERR'}): ${responseMsg}`
      );

      if (attempt < MAX_RETRIES) {
        // Экспоненциальная задержка: 2s, 4s, 8s, 16s...
        const expDelay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), MAX_DELAY_MS);

        // Проверка заголовка Retry-After (если предоставлен сервисом Сбера в секундах)
        let retryAfterMs = 0;
        const retryHeader = error.response?.headers?.['retry-after'];
        if (retryHeader) {
          const parsedSeconds = parseInt(retryHeader, 10);
          if (!isNaN(parsedSeconds) && parsedSeconds > 0) {
            retryAfterMs = parsedSeconds * 1000;
          }
        }

        // Небольшой случайный джиттер (±10%) для устранения резонансных всплесков
        const jitter = Math.floor(Math.random() * (expDelay * 0.2)) - (expDelay * 0.1);
        const finalDelay = Math.max(1000, Math.max(expDelay + jitter, retryAfterMs));
        const delaySec = (finalDelay / 1000).toFixed(1);

        if (is429) {
          const logMsg = `GigaChat: превышен лимит запросов (HTTP 429 Too Many Requests). Экспоненциальная пауза ${delaySec} сек перед повтором (попытка ${attempt}/${MAX_RETRIES})...`;
          console.warn(`[GigaChat RateLimit 429] ${logMsg}`);
          if (onLog) onLog('warning', logMsg);
        } else {
          const logMsg = `GigaChat: временный сбой (${responseMsg}). Повтор через ${delaySec} сек (попытка ${attempt}/${MAX_RETRIES})...`;
          console.log(`[GigaChat Retry] ${logMsg}`);
          if (onLog) onLog('warning', logMsg);
        }

        await new Promise(r => setTimeout(r, finalDelay));
      }
    }
  }

  const failMsg = `GigaChat недоступен после ${MAX_RETRIES} попыток: ${lastError?.message || lastError}`;
  console.error(`[GigaChat] ${failMsg}`);
  if (onLog) onLog('error', failMsg);
  throw new Error(failMsg);
}


export async function analyzeWithGigaChat(
  transcript: string,
  modelOverride?: GigaChatModel,
  callDurationSeconds?: number,
  customSalonName?: string,
  customSystemPrompt?: string
): Promise<AnalysisResult> {
  const model: GigaChatModel = modelOverride || (process.env.GIGACHAT_DEFAULT_MODEL as GigaChatModel) || 'GigaChat:Lite';

  // Жёсткий предохранитель: при длительности менее 10 секунд LLM не вызываем —
  // возвращаем результат «разговор не состоялся», чтобы исключить фантазии модели.
  if (callDurationSeconds !== undefined && callDurationSeconds < 10) {
    return generateLocalFallbackAnalysis(transcript, model, callDurationSeconds, customSalonName);
  }

  if (!isGigaChatConfigured()) {
    // Если GigaChat не настроен — возвращаем локальный резервный анализ.
    return generateLocalFallbackAnalysis(transcript, model, callDurationSeconds, customSalonName);
  }

  const token = await getGigaChatToken();
  console.log(`[GigaChat] Анализ моделью: ${model} (длительность звонка: ${callDurationSeconds ?? 'не указана'} сек.)`);

  const gigachatApiUrl = process.env.GIGACHAT_API_URL || 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions';

  // Системная часть: кастомный системный промпт из настроек администратора (если задан), иначе дефолтный шаблон с актуальным списком мастеров из CRM
  let systemPromptContent: string;
  if (customSystemPrompt && customSystemPrompt.trim().length > 30) {
    systemPromptContent = customSystemPrompt.trim();
  } else {
    const crmMasters = await getCrmMastersList();
    systemPromptContent = getSystemPrompt(customSalonName, crmMasters);
  }
  const messages = [
    { role: 'system', content: systemPromptContent },
    { role: 'user', content: buildUserPrompt(transcript, callDurationSeconds) },
  ];

  const res = await axios.post(
    gigachatApiUrl,
    {
      model,
      messages,
      temperature: 0,
      max_tokens: 4000,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      httpsAgent,
      timeout: 60000,
    }
  );

  const rawContent = res.data.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error('GigaChat вернул пустой ответ');
  }

  // Пытаемся распарсить JSON, при неудаче — просим модель исправить формат.
  let draft: AnalysisResult;
  try {
    draft = parseGigaChatJson(rawContent, customSalonName, transcript);
  } catch (parseErr) {
    console.warn('[GigaChat] Первый парсинг JSON не удался, отправка запроса на исправление формата...');
    const retryRes = await axios.post(
      gigachatApiUrl,
      {
        model,
        messages: [
          ...messages,
          { role: 'assistant', content: rawContent },
          { role: 'user', content: 'Верни только валидный JSON без пояснений и markdown-обёрток.' },
        ],
        temperature: 0,
        max_tokens: 4000,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        httpsAgent,
        timeout: 60000,
      }
    );

    const retryContent = retryRes.data.choices?.[0]?.message?.content || '';
    draft = parseGigaChatJson(retryContent, customSalonName, transcript);
  }

  // Второй независимый проход верификации (Pass 2): проверяет ТОЛЬКО стенограмму и черновик
  if (draft.booking_status !== 'не применимо' && transcript.trim().length >= 15) {
    try {
      await new Promise((r) => setTimeout(r, 350)); // бережём RPS лимиты перед второй сессией
      const verified = await runTwoPassVerification(transcript, draft, {
        apiUrl: gigachatApiUrl,
        token,
        model,
        httpsAgent,
      });
      const flagsCount = verified.verification_flags?.length || 0;
      const critFlagsCount = verified.verification_report?.criteria_flags?.length || 0;
      const caughtQuotes = verified.verification_report?.hallucinated_quotes_caught || 0;
      console.log(
        `[GigaChat Verifier] Фактчек завершён: вердикт="${verified.verification_report?.summary_verdict || 'ок'}", флагов полей=${flagsCount}, флагов критериев=${critFlagsCount}, отсечено фейковых цитат=${caughtQuotes}`
      );
      return verified;
    } catch (verifyErr: any) {
      console.warn(
        `[GigaChat Verifier] Пропуск верификации из-за сбоя API (возвращаем черновик 1-го прохода): ${verifyErr.message || verifyErr}`
      );
    }
  }

  return draft;
}

export type { EssenceDetails } from './summaryUtils.js';
export {
  FORBIDDEN_MASTER_WORDS,
  isMasterNameValid,
  normalizeMasterName,
  extractEssenceDetails,
  extractStructuredCallSummary
} from './summaryUtils.js';

export {
  EVALUATION_CRITERIA_DEFINITIONS,
  calculateOverallScore,
  buildCallEvaluation,
  extractCallEvaluation,
  harmonizeMistakesAndEvaluation,
  splitSpeakerLines
} from './evaluationUtils.js';

import {
  EssenceDetails,
  CallContextClassification,
  classifyCallContext,
  isMasterNameValid,
  normalizeMasterName,
  extractEssenceDetails,
  extractStructuredCallSummary
} from './summaryUtils.js';

import {
  stripIvrFromTranscript,
  refineTranscriptRoles,
  fixDuplicatedTranscript
} from './transcriptUtils.js';

import {
  EVALUATION_CRITERIA_DEFINITIONS,
  calculateOverallScore,
  buildCallEvaluation,
  extractCallEvaluation,
  harmonizeMistakesAndEvaluation,
  splitSpeakerLines
} from './evaluationUtils.js';

/**
 * Формирует фактологический пересказ (2–4 предложения для коротких звонков, 5–7 для длинных многоэтапных)
 * и вывод строго по полному содержанию диалога, без обрезанных цитат и шаблонных фантазий.
 */
export function buildContextGroundedSummary(
  ctx: CallContextClassification,
  essence: EssenceDetails,
  salon: string
): { retelling: string; conclusion: string } {
  const { managerText, clientText, fullText } = splitSpeakerLines(ctx.cleanTranscript);
  const transcript = ctx.cleanTranscript || '';

  const dateLabel = essence.date ? ` на ${essence.date}` : '';
  const timeLabel = essence.time ? ` в ${essence.time}` : '';
  const masterLabel = essence.master ? ` к мастеру ${essence.master}` : '';

  const priceMatch = transcript.match(/(?:по\s+стоимости|стоимост[ьи]|стоит|цена)\s*(?:от\s+)?(\d{3,5})\s*(?:руб|р(?![а-яё])|₽)/iu);
  const priceLabel = priceMatch ? `${Number(priceMatch[1]).toLocaleString('ru-RU')} ₽` : null;
  const prepayMatch = transcript.match(/предоплат[а-яё]*[^.\n]{0,40}?(?:50%|\d+%)[^.\n]{0,40}?(\d{3,5})?/iu);
  const hasOzonPrepay = /озон\s*банк/iu.test(transcript);

  if (ctx.category === 'non_client') {
    const topicNote = ctx.nonClientTopic || 'организационный / партнёрский вопрос';
    const hasWhatsapp = /ватсап|whatsapp/iu.test(transcript);
    const hasName = transcript.match(/мо[её]\s+имя\s+([А-ЯЁ][а-яё]+)/iu);
    const callerLabel = hasName ? `Звонящий (${hasName[1]})` : 'Звонящий';
    return {
      retelling: `Входящий звонок носил нецелевой (организационно-партнёрский) характер и не был связан с записью на услуги салона. ${callerLabel} обратился по вопросу: ${topicNote}. Администратор вежливо выслушала собеседника${hasWhatsapp ? ' и подтвердила, что сообщение в мессенджере будет обязательно прочитано' : ''}, поблагодарила за звонок и корректно завершила диалог.`,
      conclusion: `Нецелевой / партнёрский звонок (${topicNote}). Запись на услуги салона не требовалась; администратор вежливо принял информацию к сведению.`
    };
  }

  if (ctx.category === 'late_or_visit_update') {
    const delayStr = ctx.lateMinutes ? ` примерно на ${ctx.lateMinutes}` : '';
    const targetTimeStr = essence.time ? ` (ориентировочно к ${essence.time})` : '';
    return {
      retelling: `Клиент позвонил в салон «${salon}», чтобы заранее предупредить об опоздании на свой предстоящий визит${delayStr}${targetTimeStr}. Администратор доброжелательно отреагировала и подтвердила, что в салоне гостя обязательно дождутся. Собеседник поблагодарил сотрудника, после чего стороны вежливо завершили разговор.`,
      conclusion: `Действующая запись клиента сохраняется: гость предупредил об опоздании${delayStr}, администратор подтвердил ожидание.`
    };
  }

  if (ctx.category === 'refusal_unavailable_service') {
    const reqService = essence.service ? `услуга «${essence.service}»` : 'интересующая его процедура';
    const hasConsultOffer = /консультац/i.test(transcript);
    const hasAltChem = /химическ[а-яё]*\s+завивк/iu.test(transcript);
    return {
      retelling: `Клиент позвонил в салон «${salon}» с вопросом о возможности выполнения услуги «${essence.service || 'запрошенной процедуры'}». Администратор пояснила, что данная техника в салоне не представлена, ${hasAltChem ? 'рассказала о доступной химической завивке' : 'предложила альтернативный вариант'}${hasConsultOffer ? ' и предложила записаться на предварительную консультацию к мастеру' : ''}. Гость уточнил, что ищет именно ${reqService}, и вежливо отказался от предложенной альтернативы.`,
      conclusion: `Запись не состоялась: запрашиваемая услуга в салоне отсутствует, а от предложенной альтернативы${hasConsultOffer ? ' и консультации' : ''} клиент отказался.`
    };
  }

  if (ctx.category === 'dispute') {
    return {
      retelling: `Клиент обратился в салон «${salon}» со спорным вопросом или замечанием по качеству обслуживания. Администратор выслушал обращение и дал обратную связь в рамках регламента салона. Стороны обсудили возможные пути решения и зафиксировали дальнейший порядок урегулирования вопроса.`,
      conclusion: `Зафиксировано обращение с претензией или вопросом по качеству сервиса. Требуется контроль со стороны управляющего.`
    };
  }

  if (ctx.category === 'confirmed_booking') {
    const sentences: string[] = [];
    const introNameMatch = transcript.match(/меня\s+зовут\s+([А-ЯЁ][а-яё]+)/iu);
    const hasPastLookup = /(?:напомнить|что\s+за\s+мастер|была\s+\d|укладывал[аи])/iu.test(transcript);
    const hasCompanionHandoff = /(?:передам[^.\n]{0,20}трубк|трубк[^.\n]{0,20}передам|спрошу\s+подруг)/iu.test(transcript);
    const pastDateMatch = transcript.match(/(\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря))\s+я\s+у\s+вас/iu);

    // 1. Начало разговора и исходный запрос
    if (hasPastLookup) {
      const callerPrefix = introNameMatch ? `Клиентка ${introNameMatch[1]}` : 'Клиентка';
      const pastDateNote = pastDateMatch ? ` (${pastDateMatch[1]})` : '';
      sentences.push(
        `${callerPrefix} позвонила в салон «${salon}», чтобы уточнить имя мастера, который делал укладку ей и её подруге во время прошлого визита${pastDateNote}.`
      );
    } else {
      sentences.push(
        essence.service
          ? `Клиент обратился в салон «${salon}» по вопросу записи на услугу «${essence.service}»${masterLabel}.`
          : `Клиент позвонил в салон «${salon}» для оформления или подтверждения записи.`
      );
    }

    // 2. Справка по мастерам / услугам (если звучала)
    const hasSpecializationInfo = /специализирует/iu.test(transcript);
    if (hasPastLookup || hasSpecializationInfo) {
      if (essence.master && hasSpecializationInfo) {
        sentences.push(
          `Администратор проверила историю посещений, назвала работавших специалистов и уточнила, что мастер ${essence.master} специализируется на стрижках и окрашиваниях.`
        );
      } else if (essence.master) {
        sentences.push(
          `Администратор проверила информацию в системе и подтвердила, что мастер ${essence.master} продолжает работать в салоне.`
        );
      }
    }

    // 3. Передача трубки спутнику (если была)
    if (hasCompanionHandoff) {
      const companionNameMatch = transcript.match(/([А-ЯЁ][а-яё]+),?\s+верно,?\s*да\??/iu);
      const companionStr = companionNameMatch ? ` по имени ${companionNameMatch[1]}` : '';
      sentences.push(
        `Узнав о возможности онлайн-записи или подбора окошка через администратора, звонящая передала трубку подруге${companionStr} для выбора времени и оформления визита.`
      );
    }

    // 4. Подбор дат, занятость и предложенные окна времени
    const windowMatch = transcript.match(/с\s+(\d{1,2}[:.\s]\d{2})\s+до\s+(\d{1,2}[:.\s]\d{2})/iu);
    const hasWeekendUnavailable = /не\s+работает/iu.test(transcript);
    if (hasWeekendUnavailable || windowMatch || /предложить/iu.test(managerText || transcript)) {
      const normWindow = windowMatch
        ? ` (вечернее окно с ${windowMatch[1].replace(/\s+/g, ':')} до ${windowMatch[2].replace(/\s+/g, ':')})`
        : '';
      if (hasWeekendUnavailable) {
        sentences.push(
          `Гостья уточнила наличие мест на выходные или начало недели, на что администратор сообщила о выходных днях мастера и предложила ближайшую свободную дату${dateLabel}${normWindow}.`
        );
      } else if (essence.date || windowMatch) {
        sentences.push(
          `Администратор проверила расписание и предложила доступные варианты времени визита${dateLabel}${normWindow}.`
        );
      }
    }

    // 5. Подтверждение услуги, стоимости и контактов
    const hasPhoneCollected = /(?:продиктую|номер телефона|960|9\d{2})/iu.test(transcript);
    if (priceLabel || prepayMatch || hasPhoneCollected) {
      const details: string[] = [];
      if (essence.service) details.push(`услугу «${essence.service}»`);
      if (priceLabel) details.push(`стоимость ${priceLabel}`);
      if (prepayMatch || hasOzonPrepay) details.push('условие внесения 50% предоплаты для бронирования');
      if (hasPhoneCollected) details.push('контактный номер телефона для фиксации записи');
      if (details.length > 0) {
        const joined =
          details.length === 1
            ? details[0]
            : `${details.slice(0, -1).join(', ')} и ${details[details.length - 1]}`;
        sentences.push(`Стороны подтвердили ${joined}.`);
      }
    }

    // 6. Финальное подтверждение записи
    sentences.push(
      `В результате запись${essence.service ? ` на услугу «${essence.service}»` : ''}${masterLabel}${dateLabel}${timeLabel} была успешно согласована и подтверждена.`
    );

    return {
      retelling: sentences.join(' '),
      conclusion: `Администратор согласовал запись${essence.service ? ` на услугу «${essence.service}»` : ''}${masterLabel}${dateLabel}${timeLabel}${priceLabel ? ` (стоимость — ${priceLabel})` : ''}. Запись успешно подтверждена.`
    };
  }

  if (ctx.category === 'declined') {
    const s1 = essence.service
      ? `Клиент позвонил в салон «${salon}» по вопросу записи на услугу «${essence.service}»${masterLabel}.`
      : `Клиент обратился в салон «${salon}» по поводу подбора визита.`;
    const s2 = `Администратор проверил расписание и озвучил доступные условия${dateLabel}${timeLabel}, однако предложенный вариант клиенту не подошёл.`;
    const s3 = `Стороны вежливо завершили разговор без оформления записи.`;
    return {
      retelling: `${s1} ${s2} ${s3}`,
      conclusion: `Запись не состоялась: клиент отказался от предложенного варианта${dateLabel}${timeLabel}.`
    };
  }

  if (ctx.category === 'reschedule_or_cancel') {
    return {
      retelling: `Клиент позвонил в салон «${salon}» для уточнения или корректировки существующей записи${dateLabel}${timeLabel}${masterLabel}. Администратор проверил расписание, уточнил занятость более ранних или смежных слотов и проинформировал гостя по доступным условиям. По итогам диалога стороны зафиксировали актуальный статус бронирования.`,
      conclusion: `Проведена проверка и актуализация действующей записи${masterLabel}${dateLabel}${timeLabel}.`
    };
  }

  // Консультация / справочное обращение без сырых обрывков текста
  const consultTopic = essence.service ? ` по услуге «${essence.service}»` : '';
  const hasScheduleQ = /до\s+скольки|работаете|график/iu.test(clientText || transcript);
  return {
    retelling: `Клиент обратился в салон «${salon}» за справочной информацией${consultTopic}${hasScheduleQ ? ' (режим работы салона)' : ''}. Администратор предоставил необходимые пояснения по заданному вопросу. Запись на конкретную дату и время в ходе этого разговора не оформлялась.`,
    conclusion: `Проведена справочная консультация по запросу клиента без фиксации записи на визит.`
  };
}

/**
 * Нормализует резюме так, чтобы оно ВСЕГДА содержало 4 четких блока:
 * 1) Краткая суть обращения (услуга, дата, время, мастер);
 * 2) Краткий пересказ разговора (СТРОГО 2–4 предложения);
 * 3) Вывод (итог диалога, предложения администратора и результат);
 * 4) Разбор работы менеджера с оценкой, конкретными ошибками/недочетами и практическими советами по оптимизации.
 * А также возвращает структурированное резюме из 8 параметров.
 */
export function formatSummaryWithEssence(
  rawSummary: string,
  transcript: string,
  extractedDetails?: EssenceDetails,
  customSalonName?: string,
  operatorScore?: number | null,
  operatorMistakes?: string[] | string | null,
  recommendations?: string[] | string | null,
  operatorComment?: string | null,
  callEvaluation?: CallEvaluation | null
): {
  formattedSummary: string;
  essence: EssenceDetails;
  structuredSummary: StructuredCallSummary;
  retelling?: string;
  conclusion?: string;
  managerEvaluation?: string;
  mistakes?: string[];
  advice?: string[];
  score?: number | null;
} {
  const salon = (customSalonName || process.env.SALON_NAME || 'Fashion Look Studio').trim();

  const ctx = classifyCallContext(transcript, rawSummary);
  const cleanTranscript = ctx.cleanTranscript;

  // Звонок не состоялся
  if (ctx.category === 'not_happened') {
    const structuredSummary = extractStructuredCallSummary(transcript, rawSummary, undefined, salon, 'не применимо');
    return {
      formattedSummary: rawSummary,
      essence: { service: null, date: null, time: null, master: null },
      structuredSummary,
      retelling: '',
      conclusion: rawSummary,
      managerEvaluation: '',
      mistakes: [],
      advice: [],
      score: null,
    };
  }

  // Всегда запускаем надежный парсер, если какое-либо поле в переданных деталях отсутствует или недостоверно
  const fallbackEssence = extractEssenceDetails(cleanTranscript, rawSummary, salon);
  const isMeaningful = (v?: string | null) =>
    v &&
    typeof v === 'string' &&
    !v.toLowerCase().includes('не указан') &&
    !v.toLowerCase().includes('не выбран') &&
    !v.toLowerCase().includes('студио') &&
    v.trim().length > 0;

  const hasTimeCorrectionInTranscript = Boolean(
    fallbackEssence.time && cleanTranscript && /(?:убираю|отмените|отменить|оставляю|оставьте)/iu.test(cleanTranscript)
  );
  const hasExplicitSingleBookingOverride = Boolean(
    fallbackEssence.service && /(?:необходимо|нужно)\s+будет\s+только\s+[а-яё]+/iu.test(cleanTranscript)
  );
  const hasPastVsConfirmedDateMismatch = Boolean(
    fallbackEssence.date &&
    extractedDetails?.date &&
    extractedDetails.date.toLowerCase() !== fallbackEssence.date.toLowerCase() &&
    ctx.isConfirmedBooking
  );

  const essence: EssenceDetails = {
    service:
      hasExplicitSingleBookingOverride && fallbackEssence.service
        ? fallbackEssence.service
        : isMeaningful(extractedDetails?.service)
        ? extractedDetails!.service
        : fallbackEssence.service,
    date:
      hasPastVsConfirmedDateMismatch && fallbackEssence.date
        ? fallbackEssence.date
        : isMeaningful(extractedDetails?.date)
        ? extractedDetails!.date
        : fallbackEssence.date,
    time:
      (hasTimeCorrectionInTranscript || hasPastVsConfirmedDateMismatch) && fallbackEssence.time
        ? fallbackEssence.time
        : isMeaningful(extractedDetails?.time)
        ? extractedDetails!.time
        : fallbackEssence.time,
    master: isMasterNameValid(extractedDetails?.master)
      ? normalizeMasterName(extractedDetails!.master!)
      : fallbackEssence.master,
  };

  const serviceStr = ctx.isNonClient
    ? 'не применимо (организационный звонок)'
    : ctx.isLateWarning
    ? (essence.service || 'предупреждение об опоздании')
    : (essence.service || 'не указана');
  const dateStr = essence.date || 'не указана';
  const timeStr = essence.time || 'не указано';
  const masterStr = essence.master || 'не выбран';
  const essencePrefix = `Суть обращения: услуга — ${serviceStr}, дата — ${dateStr}, время — ${timeStr}, мастер — ${masterStr}.`;

  // 1. Попытка обнаружить блок разбора работы менеджера в исходном тексте
  const managerReviewMatch = rawSummary.match(
    /(?:разбор работы менеджера(?:\s*\([^)]*\))?|оценка и разбор работы менеджера|разбор работы оператора)\s*:\s*([\s\S]*)$/i
  );
  let rawManagerSection = managerReviewMatch ? managerReviewMatch[1].trim() : '';

  // Текст без блока разбора работы менеджера для чистого парсинга пересказа и вывода
  const summaryWithoutManager = rawSummary
    .replace(/(?:разбор работы менеджера(?:\s*\([^)]*\))?|оценка и разбор работы менеджера|разбор работы оператора)\s*:[\s\S]*$/i, '')
    .trim();

  // 2. Попытка извлечь существующие блоки из summaryWithoutManager
  const retellingMatch = summaryWithoutManager.match(
    /(?:пересказ диалога|краткий пересказ(?: разговора)?|пересказ разговора)\s*:\s*([\s\S]*?)(?=(?:вывод\s*:|$))/i
  );
  const conclusionMatch = summaryWithoutManager.match(/вывод\s*:\s*([\s\S]*)$/i);

  let retellingText = retellingMatch ? retellingMatch[1].trim() : '';
  let conclusionText = conclusionMatch ? conclusionMatch[1].trim() : '';

  // Очистка от ошибочного «мастеру Студио», «Меня Вот», «Записались»
  const badMasterRegex =
    /(?:к\s+мастеру\s+(?:Меня\s+Вот|Записались|Студио|Будете)|мастеру\s+(?:Меня\s+Вот|Записались|Студио|Будете)|Меня\s+Вот|к\s+мастеру\s+Студио)/gi;
  if (retellingText) {
    retellingText = retellingText.replace(badMasterRegex, essence.master ? `к мастеру ${essence.master}` : 'в салон');
  }
  if (conclusionText) {
    conclusionText = conclusionText.replace(badMasterRegex, essence.master ? `к мастеру ${essence.master}` : 'в салон');
  }

  // Если модель вернула единый текст без явных блоков пересказа и вывода
  if (!retellingText && !conclusionText) {
    const cleanRaw = summaryWithoutManager
      .replace(/^суть обращения:[^.]*\.?/i, '')
      .trim();

    if (cleanRaw.length > 0) {
      const sentences = cleanRaw.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
      if (sentences.length >= 3) {
        conclusionText = sentences[sentences.length - 1].trim();
        retellingText = sentences.slice(0, sentences.length - 1).join(' ').trim();
      } else {
        conclusionText = cleanRaw;
      }
    }
  } else if (!retellingText && conclusionText) {
    const preConclusion = summaryWithoutManager
      .replace(/^суть обращения:[^.]*\.?/i, '')
      .replace(/вывод\s*:[\s\S]*$/i, '')
      .trim();
    if (preConclusion.length > 20) {
      retellingText = preConclusion;
    }
  }

  // Определяем, нужно ли пересобрать пересказ/вывод строго по стенограмме:
  // срабатывает при пустых полях, обрывках цитат («...»), старых шаблонах или при противоречии фактическому исходу звонка
  const isLegacyCannedRetelling = /Клиент обратился в салон красоты по вопросам обслуживания и записи\.\s*Администратор предоставил подробную консультацию по графику/i.test(retellingText);
  const isTruncatedSnippetRetelling =
    /«[^»]{60,}»/.test(retellingText) ||
    /\(\s*«[^»]{25,}»\s*\)/.test(retellingText);
  const isContradictoryBookingConclusion =
    !ctx.isConfirmedBooking &&
    !ctx.isRescheduleOrCheck &&
    /администратор согласовал запись|запись успешно подтверждена/i.test(`${retellingText} ${conclusionText}`);
  const isMissedConfirmedBooking =
    ctx.isConfirmedBooking &&
    /не оформлял|не состоял|без фиксации записи|справочн/i.test(`${retellingText} ${conclusionText}`);

  const grounded = buildContextGroundedSummary(ctx, essence, salon);

  if (
    !retellingText ||
    retellingText.includes('к мастеру Студио') ||
    /свободное время\s*\./.test(retellingText) ||
    isLegacyCannedRetelling ||
    isTruncatedSnippetRetelling ||
    isContradictoryBookingConclusion ||
    isMissedConfirmedBooking
  ) {
    retellingText = grounded.retelling;
  }

  if (
    !conclusionText ||
    conclusionText.includes('к мастеру Студио') ||
    isLegacyCannedRetelling ||
    isTruncatedSnippetRetelling ||
    isContradictoryBookingConclusion ||
    isMissedConfirmedBooking
  ) {
    conclusionText = grounded.conclusion;
  }

  // Очистка от возможных дублей заголовков
  retellingText = retellingText.replace(/^(?:пересказ диалога|краткий пересказ(?: разговора)?):\s*/i, '').trim();
  conclusionText = conclusionText.replace(/^вывод:\s*/i, '').trim();

  // 3. Формирование и извлечение 4-го блока: Разбор работы менеджера (оценка, ошибки, советы)
  let resolvedScore: number | null = null;
  if (typeof operatorScore === 'number' && !isNaN(operatorScore)) {
    resolvedScore = operatorScore;
  } else {
    const scoreInSummaryMatch = rawSummary.match(/оценка\s*(\d{1,2})\s*\/\s*10/i);
    if (scoreInSummaryMatch) {
      resolvedScore = parseInt(scoreInSummaryMatch[1], 10);
    } else {
      resolvedScore = 8;
    }
  }

  // Извлечение ошибок
  let mistakesList: string[] = [];
  if (Array.isArray(operatorMistakes) && operatorMistakes.length > 0) {
    mistakesList = operatorMistakes.map(m => String(m).trim()).filter(Boolean);
  } else if (typeof operatorMistakes === 'string' && operatorMistakes.trim().length > 0) {
    mistakesList = [operatorMistakes.trim()];
  } else if (rawManagerSection) {
    const mistakesSubMatch = rawManagerSection.match(
      /(?:ошибки и недочеты|ошибки|недочеты)\s*:\s*([\s\S]*?)(?=(?:советы по оптимизации|советы|рекомендации)\s*:|$)/i
    );
    if (mistakesSubMatch) {
      const rawText = mistakesSubMatch[1].trim();
      const splitItems = rawText
        .split(/(?:^|\n)\s*[-•*0-9.)]+\s*/g)
        .map(s => s.trim().replace(/^;\s*/, ''))
        .filter(s => s.length > 3);
      if (splitItems.length > 0) {
        mistakesList = splitItems;
      } else if (rawText) {
        mistakesList = [rawText];
      }
    }
  }

  // Извлечение советов по оптимизации
  let adviceList: string[] = [];
  if (Array.isArray(recommendations) && recommendations.length > 0) {
    adviceList = recommendations.map(r => String(r).trim()).filter(Boolean);
  } else if (typeof recommendations === 'string' && recommendations.trim().length > 0) {
    adviceList = [recommendations.trim()];
  } else if (rawManagerSection) {
    const adviceSubMatch = rawManagerSection.match(
      /(?:советы по оптимизации|советы|рекомендации)\s*:\s*([\s\S]*)$/i
    );
    if (adviceSubMatch) {
      const rawText = adviceSubMatch[1].trim();
      const splitItems = rawText
        .split(/(?:^|\n)\s*[-•*0-9.)]+\s*/g)
        .map(s => s.trim().replace(/^;\s*/, ''))
        .filter(s => s.length > 3);
      if (splitItems.length > 0) {
        adviceList = splitItems;
      } else if (rawText) {
        adviceList = [rawText];
      }
    }
  }

  // 4. Синхронизация ошибок и советов с оценкой по 10 критериям
  const evalForHarmonization = callEvaluation || extractCallEvaluation(
    transcript,
    conclusionText || rawSummary,
    null,
    resolvedScore,
    mistakesList,
    adviceList,
    salon
  );

  if (evalForHarmonization.overall_score !== null && !isNaN(evalForHarmonization.overall_score)) {
    resolvedScore = Math.max(1, Math.min(10, Math.round(evalForHarmonization.overall_score)));
  }

  const harmonized = harmonizeMistakesAndEvaluation(mistakesList, adviceList, evalForHarmonization, transcript);
  mistakesList = harmonized.mistakes;
  adviceList = harmonized.advice;

  const mistakesFormatted = mistakesList.join('; ');
  const adviceFormatted = adviceList.join('; ');
  const managerEvaluationBlock = `Разбор работы менеджера (оценка ${resolvedScore}/10):\n- Ошибки и недочеты: ${mistakesFormatted}\n- Советы по оптимизации: ${adviceFormatted}`;

  const formattedSummary = `${essencePrefix} Пересказ диалога: ${retellingText} Вывод: ${conclusionText}\n${managerEvaluationBlock}`;

  const derivedStatus = ctx.isConfirmedBooking
    ? 'согласие'
    : (ctx.isDeclined ? 'отказ' : 'консультация');

  const structuredSummary = extractStructuredCallSummary(
    transcript,
    conclusionText || rawSummary,
    {
      service: essence.service,
      date: essence.date,
      time: essence.time,
      master: essence.master
    },
    salon,
    derivedStatus
  );

  return {
    formattedSummary,
    essence,
    structuredSummary,
    retelling: retellingText,
    conclusion: conclusionText,
    managerEvaluation: managerEvaluationBlock,
    mistakes: mistakesList,
    advice: adviceList,
    score: resolvedScore,
  };
}

function mapAuditCriterionId(rawNameOrId: string): string | undefined {
  const s = String(rawNameOrId || '').toLowerCase().trim();
  if (!s) return undefined;
  const exact = EVALUATION_CRITERIA_DEFINITIONS.find(
    d => d.id === s || d.name.toLowerCase() === s
  );
  if (exact) return exact.id;
  if (s.includes('приветств')) return 'greeting_intro';
  if (s.includes('потребност') || s.includes('выявлен')) return 'needs_identification';
  if (s.includes('презентация услуги') || (s.includes('услуг') && s.includes('мастер'))) return 'service_and_master_presentation';
  if (s.includes('стоимост') || s.includes('цен')) return 'price_presentation';
  if (s.includes('возражен')) return 'handling_objections';
  if (s.includes('дополнительн') || s.includes('допродаж')) return 'additional_services';
  if (s.includes('параллельн')) return 'parallel_booking';
  if (s.includes('альтернатив')) return 'alternative_options';
  if (s.includes('закрыт')) return 'closing_booking';
  if (s.includes('коммуникац') || s.includes('завершен')) return 'communication_quality_closing';
  return undefined;
}

function cleanFactValue(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s) return null;
  const low = s.toLowerCase();
  if (
    low === 'null' ||
    low === 'не озвучено' ||
    low === 'не указана' ||
    low === 'не указан' ||
    low === 'не указано' ||
    low === 'не выбран' ||
    low === 'не выбрана' ||
    low === 'не применимо' ||
    low === 'отсутствует'
  ) {
    return null;
  }
  return s;
}

/**
 * Разбирает ответ модели (поддерживает как новую 4-этапную схему { facts, booking_status, summary, audit },
 * так и совместимую плоскую схему), программно проверяет цитаты и возвращает согласованный AnalysisResult.
 */
export function parseGigaChatJson(text: string, customSalonName?: string, originalTranscript?: string): AnalysisResult {
  const salon = customSalonName || process.env.SALON_NAME || 'Fashion Look Studio';
  // Явно вырезаем markdown-обёртки ```json / ``` перед JSON.parse
  let clean = (text || '')
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  const jsonMatch = clean.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    clean = jsonMatch[0];
  }

  const parsed = JSON.parse(clean);

  const rawFormattedTranscript =
    typeof parsed.formatted_transcript === 'string' && parsed.formatted_transcript.trim().length > 0
      ? parsed.formatted_transcript.trim()
      : undefined;

  const baseTranscriptForRoles = originalTranscript || rawFormattedTranscript || '';
  const formattedTranscript =
    rawFormattedTranscript === 'Разговор не состоялся (диалог отсутствует)'
      ? rawFormattedTranscript
      : refineTranscriptRoles(baseTranscriptForRoles || rawFormattedTranscript || '');

  const rawOutcome = String(parsed.key_facts?.call_outcome || '').toLowerCase().trim();
  const rawBooking = String(parsed.booking_status || parsed.key_facts?.booking_status || '').toLowerCase().trim();

  // Классификация контекста по очищенной от IVR стенограмме (защита от галлюцинаций модели)
  const dialogueCtx = classifyCallContext(formattedTranscript || originalTranscript || '');

  // Признак реального диалога: в стенограмме присутствуют обе роли.
  const transcriptHasBothRoles =
    !!formattedTranscript &&
    /менеджер\s*:/i.test(formattedTranscript) &&
    /клиент\s*:/i.test(formattedTranscript);

  // --- Определяем, состоялся ли разговор (главный переключатель) ---
  let isConversation: boolean;
  if (dialogueCtx.category !== 'not_happened' && transcriptHasBothRoles) {
    isConversation = true;
  } else if (typeof parsed.is_conversation === 'boolean') {
    isConversation = parsed.is_conversation;
  } else if (rawOutcome === 'не состоялся' || rawOutcome === 'автоответчик' || rawBooking === 'не применимо') {
    isConversation = false;
  } else if (rawOutcome || rawBooking) {
    isConversation = true;
  } else {
    isConversation = transcriptHasBothRoles;
  }

  // Явные маркеры провала перекрывают вердикт, но ТОЛЬКО если в стенограмме нет обеих ролей.
  const summaryTextForCheck =
    typeof parsed.summary === 'string'
      ? parsed.summary
      : String(parsed.summary?.short_summary || parsed.summary?.booking_done || '');
  const combinedText = `${stripIvrFromTranscript(formattedTranscript || '')} ${parsed.transcript_summary || ''} ${summaryTextForCheck}`.toLowerCase();
  const explicitFailure =
    /разговор не состоялся|звонок не состоялся|автоответчик|автоинформатор|голосовая почта|оставьте сообщение|после сигнала|абонент временно недоступен|абонент занят|все операторы заняты/.test(combinedText);
  if (explicitFailure && !transcriptHasBothRoles) {
    isConversation = false;
  }

  // --- Ветка «разговор не состоялся» ---
  if (!isConversation) {
    const failedEval = extractCallEvaluation('', '', null, null, [], [], salon);
    return {
      transcript_summary: 'Разговор не состоялся: диалог отсутствует (тишина, гудки, сброс, автоответчик или автоинформатор).',
      booking_status: 'не применимо',
      formatted_transcript: formattedTranscript || 'Разговор не состоялся (диалог отсутствует)',
      evaluation: failedEval,
      criteria_scores: failedEval.criteria,
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'не состоялся',
        booking_status: 'не применимо',
        client_issue: null,
        service: null,
        date: null,
        time: null,
        master: null,
        evaluation: failedEval,
        criteria_scores: failedEval.criteria,
      },
      operator_score: null,
      operator_mistakes: [],
      operator_comment: 'Разговор не состоялся (диалог отсутствует).',
      recommendations: `Повторить попытку дозвона клиенту в рабочее время салона «${salon}».`,
      missed_opportunities: [],
    };
  }

  // --- Ветка «разговор состоялся»: маппинг статуса Stage 2 («Запись состоялась | Отсрочка | Отказ | Консультация | Не применимо») ---
  let bookingStatus = rawBooking;
  let outcomeFromStage2: string | null = null;
  if (rawBooking.includes('запись состоялась') || rawBooking === 'согласие' || rawBooking.includes('соглас')) {
    bookingStatus = 'согласие';
    outcomeFromStage2 = 'запись';
  } else if (rawBooking.includes('отсроч')) {
    bookingStatus = 'консультация';
    outcomeFromStage2 = 'перезвон';
  } else if (rawBooking.includes('отказ') || rawOutcome === 'отказ') {
    bookingStatus = 'отказ';
    outcomeFromStage2 = 'отказ';
  } else if (rawBooking.includes('консультац')) {
    bookingStatus = 'консультация';
    outcomeFromStage2 = 'консультация';
  } else if (rawOutcome === 'запись') {
    bookingStatus = 'согласие';
    outcomeFromStage2 = 'запись';
  } else {
    bookingStatus = 'консультация';
  }

  // Защита от ложного статуса «согласие» на основе IVR или при явном отказе/опоздании/партнёрском звонке,
  // а также восстановление статуса «согласие», если в конце стенограммы запись подтверждена («записали вас», «запись подтвердили»)
  if (dialogueCtx.isUnavailableServiceRefusal || dialogueCtx.isDeclined) {
    bookingStatus = 'отказ';
  } else if (dialogueCtx.isLateWarning || dialogueCtx.isNonClient) {
    bookingStatus = 'консультация';
  } else if (dialogueCtx.isConfirmedBooking) {
    bookingStatus = 'согласие';
  } else if (bookingStatus === 'согласие' && !dialogueCtx.isRescheduleOrCheck) {
    bookingStatus = 'консультация';
  }

  const validOutcomes = ['запись', 'отказ', 'консультация', 'перезвон', 'отмена'];
  let outcome = outcomeFromStage2 || (validOutcomes.includes(rawOutcome) ? rawOutcome : 'консультация');
  if (bookingStatus === 'согласие') {
    outcome = 'запись';
  } else if (bookingStatus === 'отказ' && outcome !== 'отмена') {
    outcome = 'отказ';
  } else if (dialogueCtx.isLateWarning || dialogueCtx.isNonClient) {
    outcome = 'консультация';
  } else if (rawBooking.includes('отсроч')) {
    outcome = 'перезвон';
  }

  const fullTranscript = formattedTranscript || originalTranscript || '';

  // Программная проверка цитат без повторного запроса к API (Требование 5)
  const rawSummaryObj = parsed.summary && typeof parsed.summary === 'object' ? parsed.summary : null;
  if (rawSummaryObj && Array.isArray(rawSummaryObj.quotes_support)) {
    const validQuotes: string[] = [];
    for (const q of rawSummaryObj.quotes_support) {
      const qs = String(q || '').trim();
      if (!qs) continue;
      if (isQuotePresentInTranscript(fullTranscript, qs)) {
        validQuotes.push(qs);
      } else {
        console.warn(`[GigaChat Facts] Цитата из summary.quotes_support не найдена в стенограмме: "${qs.slice(0, 60)}"`);
      }
    }
    rawSummaryObj.quotes_support = validQuotes;
  }

  const rawFacts = parsed.facts && typeof parsed.facts === 'object' ? parsed.facts : null;
  if (rawFacts) {
    for (const key of ['client_name', 'desired_service', 'master', 'date_time_offered'] as const) {
      const entry = rawFacts[key];
      if (entry && typeof entry === 'object' && entry.quote && !isQuotePresentInTranscript(fullTranscript, entry.quote)) {
        console.warn(`[GigaChat Facts] Цитата для facts.${key} не найдена в стенограмме — очищена без ретрая.`);
        entry.quote = null;
      }
    }
  }

  const rawAudit = parsed.audit && typeof parsed.audit === 'object' ? parsed.audit : null;

  let score: number | null = null;
  const candidateScore = parsed.operator_score ?? rawAudit?.overall_score;
  if (typeof candidateScore === 'number' && !isNaN(candidateScore)) {
    score = Math.max(1, Math.min(10, Math.round(candidateScore)));
  }
  if (score === null) {
    score = 7;
  }

  // Извлечение конкретных ошибок оператора из json ответа модели (поддерживает audit.mistakes и operator_mistakes)
  let rawMistakes: string[] = [];
  const sourceMistakes = parsed.operator_mistakes ?? rawAudit?.mistakes;
  if (Array.isArray(sourceMistakes)) {
    rawMistakes = sourceMistakes.map((m: any) => String(m).trim()).filter(Boolean);
  } else if (typeof sourceMistakes === 'string' && sourceMistakes.trim().length > 0) {
    rawMistakes = [sourceMistakes.trim()];
  }

  const rawSummary =
    parsed.transcript_summary ||
    (rawSummaryObj?.short_summary ? String(rawSummaryObj.short_summary) : null) ||
    (typeof parsed.summary === 'string' ? parsed.summary : null) ||
    'Краткое содержание диалога с результатом обращения.';

  // Извлекаем суть обращения: услуга, дата, время, мастер
  const extracted = extractEssenceDetails(fullTranscript, rawSummary, salon);

  const isMeaningful = (v: any) =>
    v &&
    typeof v === 'string' &&
    !v.toLowerCase().includes('не указан') &&
    !v.toLowerCase().includes('не выбран') &&
    !v.toLowerCase().includes('не озвуч') &&
    !v.toLowerCase().includes('не применимо') &&
    !v.toLowerCase().includes('студио') &&
    v.trim().length > 0;

  const parsedKeyFacts = parsed.key_facts || {};
  const rawMaster =
    cleanFactValue(rawFacts?.master?.value) ||
    cleanFactValue(rawSummaryObj?.master) ||
    parsedKeyFacts.master ||
    parsed.master;

  const service =
    cleanFactValue(rawFacts?.desired_service?.value) ||
    cleanFactValue(rawSummaryObj?.service) ||
    (isMeaningful(parsedKeyFacts.service) ? parsedKeyFacts.service : null) ||
    (isMeaningful(parsed.service) ? parsed.service : null) ||
    extracted.service;

  const rawDateTimeFromFacts =
    cleanFactValue(rawFacts?.date_time_offered?.value) ||
    cleanFactValue(rawSummaryObj?.date_time);

  // Пытаемся выделить дату и время из date_time_offered / summary.date_time, дополняя extractEssenceDetails
  let factsDate: string | null = null;
  let factsTime: string | null = null;
  if (rawDateTimeFromFacts) {
    const dtTimeMatch =
      rawDateTimeFromFacts.match(/\b([012]?\d)[:.\s]([0-5]\d)\b/) ||
      rawDateTimeFromFacts.match(/(?:^|[\s,])(?:в\s+)?([012]?\d)(?:\s*(?:час|ч\b)|$)/i);
    if (dtTimeMatch) {
      const h = parseInt(dtTimeMatch[1], 10);
      const m = dtTimeMatch[2] ? dtTimeMatch[2] : '00';
      if (h >= 7 && h <= 22) {
        factsTime = `${String(h).padStart(2, '0')}:${m}`;
      }
    }
    const dtDateMatch = rawDateTimeFromFacts.match(
      /(сегодня|завтра|послезавтра|в\s+(?:понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)|\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря))/i
    );
    if (dtDateMatch) {
      factsDate = dtDateMatch[1].replace(/^в\s+/i, '').trim().toLowerCase();
    }
  }

  const date =
    (isMeaningful(parsedKeyFacts.date) ? parsedKeyFacts.date : null) ||
    (isMeaningful(parsed.date) ? parsed.date : null) ||
    extracted.date ||
    factsDate;

  const rawTime =
    (isMeaningful(parsedKeyFacts.time) ? parsedKeyFacts.time : null) ||
    (isMeaningful(parsed.time) ? parsed.time : null) ||
    extracted.time ||
    factsTime;
  const time = rawTime
    ? rawTime.replace(
        /\b([012]?\d)\s+([0-5]\d|0\s+0)\b/gi,
        (_: any, h: string, m: string) =>
          `${h.padStart(2, '0')}:${m.replace(/\s+/g, '') === '0' || m.replace(/\s+/g, '') === '00' ? '00' : m}`
      )
    : null;

  const master =
    (isMasterNameValid(rawMaster) ? normalizeMasterName(rawMaster) : null) ||
    extracted.master;

  const comment =
    parsed.operator_comment && parsed.operator_comment.trim().length > 0
      ? parsed.operator_comment
      : `Администратор обработал обращение по регламенту салона «${salon}».`;
  const recommendations = parsed.recommendations || `Соблюдать стандарты сервиса салона «${salon}».`;

  // Оценка звонка по 10 критериям (принимает как criteria_scores[], так и audit.criteria[])
  let rawCriteria: any[] = Array.isArray(parsed.criteria_scores)
    ? parsed.criteria_scores
    : Array.isArray(parsed.evaluation?.criteria)
    ? parsed.evaluation.criteria
    : Array.isArray(rawAudit?.criteria)
    ? rawAudit.criteria.map((c: any) => {
        const mappedId = mapAuditCriterionId(c?.id || c?.name || '');
        const quoteStr = c?.quote && String(c.quote).trim();
        const isValidQuote =
          quoteStr &&
          quoteStr.toLowerCase() !== 'не применимо' &&
          quoteStr.toLowerCase() !== 'null' &&
          isQuotePresentInTranscript(fullTranscript, quoteStr);
        const applicable =
          c?.applicable !== undefined
            ? Boolean(c.applicable)
            : c?.is_applicable !== undefined
            ? Boolean(c.is_applicable)
            : c?.score !== null;
        return {
          id: mappedId || c?.id,
          name: c?.name,
          score: applicable ? c?.score : null,
          is_applicable: applicable,
          explanation: c?.reasoning || c?.explanation || '',
          evidence_quote: isValidQuote ? quoteStr : null,
        };
      })
    : [];

  rawCriteria = rawCriteria.filter((c: any) => c && (c.id || c.name));
  let mergedCriteria = rawCriteria;
  if (rawCriteria.length >= 2 && rawCriteria.length < 10) {
    const recArr = Array.isArray(recommendations) ? recommendations : [recommendations].filter(Boolean) as string[];
    const baseEval = extractCallEvaluation(fullTranscript, rawSummary, null, score, rawMistakes, recArr, salon);
    const providedById = new Map<string, any>();
    for (const rc of rawCriteria) {
      const cid = rc.id || mapAuditCriterionId(rc.name || '');
      if (cid) providedById.set(cid, rc);
    }
    mergedCriteria = baseEval.criteria.map(defCrit => providedById.get(defCrit.id) || defCrit);
  }
  const parsedEvalObj = mergedCriteria.length >= 2 ? buildCallEvaluation(mergedCriteria) : null;
  const evaluation: CallEvaluation = extractCallEvaluation(
    fullTranscript,
    rawSummary,
    parsedEvalObj,
    score,
    rawMistakes,
    Array.isArray(recommendations) ? recommendations : [recommendations].filter(Boolean) as string[],
    salon
  );

  // Пробрасываем evidence_quote из Pass 1 в evaluation.criteria, если они подтверждены стенограммой
  if (rawCriteria.length > 0) {
    const quoteById = new Map<string, string>();
    for (const rc of rawCriteria) {
      const cid = rc.id || mapAuditCriterionId(rc.name || '');
      if (cid && rc.evidence_quote) {
        quoteById.set(cid, rc.evidence_quote);
      }
    }
    evaluation.criteria = evaluation.criteria.map(crit => ({
      ...crit,
      evidence_quote: crit.evidence_quote ?? quoteById.get(crit.id) ?? undefined,
    }));
  }

  // Итоговый балл оператора синхронизируется со средним баллом по применимым критериям
  if (evaluation.overall_score !== null && !isNaN(evaluation.overall_score)) {
    score = Math.max(1, Math.min(10, Math.round(evaluation.overall_score)));
  }

  const { formattedSummary, essence, structuredSummary, mistakes, advice } = formatSummaryWithEssence(
    rawSummary,
    fullTranscript,
    {
      service: service || null,
      date: date || null,
      time: time || null,
      master: master || null,
    },
    salon,
    score,
    rawMistakes,
    recommendations,
    comment,
    evaluation
  );

  const finalMistakes = mistakes && mistakes.length > 0 ? mistakes : [];
  const finalAdvice =
    advice && advice.length > 0
      ? advice
      : Array.isArray(recommendations)
      ? recommendations
      : [recommendations].filter(Boolean);

  // Структурированное резюме: маппинг как parsed.structured_summary, так и нового parsed.summary
  const modelStruct: Record<string, any> = parsed.structured_summary || (rawSummaryObj
    ? {
        call_purpose: rawSummaryObj.goal,
        requested_service: rawSummaryObj.service,
        offered_master: rawSummaryObj.master,
        offered_price: rawSummaryObj.price,
        offered_date_time: rawSummaryObj.date_time,
        booking_status_text: rawSummaryObj.booking_done,
        unbooked_reason: rawSummaryObj.reason_if_not,
        manager_next_steps: rawSummaryObj.manager_next_steps,
      }
    : {});

  const modelStepsStr = Array.isArray(modelStruct.manager_next_steps)
    ? modelStruct.manager_next_steps.join(' ').toLowerCase()
    : '';
  const hasCannedConsultationSteps =
    (dialogueCtx.isNonClient ||
      dialogueCtx.isLateWarning ||
      dialogueCtx.isUnavailableServiceRefusal ||
      dialogueCtx.isDeclined ||
      dialogueCtx.isConfirmedBooking) &&
    (modelStepsStr.includes('консультац') ||
      modelStepsStr.includes('прайс-лист') ||
      modelStepsStr.includes('онлайн-запись'));

  const modelBookedTextLower = String(modelStruct.booking_status_text || '').toLowerCase();
  const hasContradictoryBookedText =
    (dialogueCtx.isConfirmedBooking && /(?:не оформлял|не состоял|консультац)/i.test(modelBookedTextLower)) ||
    (!dialogueCtx.isConfirmedBooking &&
      !dialogueCtx.isRescheduleOrCheck &&
      /(?:запись оформлена|записан|подтверждена|запись состоялась)/i.test(modelBookedTextLower));

  const useGroundedStructOverride =
    dialogueCtx.isNonClient || dialogueCtx.isLateWarning || dialogueCtx.isUnavailableServiceRefusal;
  const hasEssenceDateMismatch = Boolean(
    essence.date &&
      modelStruct.offered_date_time &&
      !String(modelStruct.offered_date_time).toLowerCase().includes(essence.date.toLowerCase())
  );
  const hasEssenceServiceMismatch = Boolean(
    essence.service &&
      modelStruct.requested_service &&
      !String(modelStruct.requested_service).toLowerCase().includes(essence.service.toLowerCase())
  );

  // Защита от "не озвучено" при наличии подтверждённых фактов из стенограммы
  const pickMeaningfulStruct = (modelVal: unknown, fallbackVal: string): string => {
    const cleaned = cleanFactValue(modelVal);
    return cleaned ? cleaned : fallbackVal;
  };

  const finalStructuredSummary: StructuredCallSummary = {
    call_purpose:
      useGroundedStructOverride || hasEssenceServiceMismatch
        ? structuredSummary.call_purpose
        : pickMeaningfulStruct(modelStruct.call_purpose, structuredSummary.call_purpose),
    requested_service:
      useGroundedStructOverride || hasEssenceServiceMismatch
        ? structuredSummary.requested_service
        : pickMeaningfulStruct(modelStruct.requested_service, structuredSummary.requested_service),
    offered_master: useGroundedStructOverride
      ? structuredSummary.offered_master
      : isMasterNameValid(modelStruct.offered_master)
      ? normalizeMasterName(modelStruct.offered_master)!
      : structuredSummary.offered_master,
    offered_price: useGroundedStructOverride
      ? structuredSummary.offered_price
      : pickMeaningfulStruct(modelStruct.offered_price, structuredSummary.offered_price),
    offered_date_time:
      useGroundedStructOverride || hasEssenceDateMismatch
        ? structuredSummary.offered_date_time
        : pickMeaningfulStruct(modelStruct.offered_date_time, structuredSummary.offered_date_time),
    booking_status_text:
      useGroundedStructOverride || dialogueCtx.isDeclined || hasContradictoryBookedText
        ? structuredSummary.booking_status_text
        : pickMeaningfulStruct(modelStruct.booking_status_text, structuredSummary.booking_status_text),
    unbooked_reason:
      useGroundedStructOverride || dialogueCtx.isDeclined || hasContradictoryBookedText
        ? structuredSummary.unbooked_reason
        : pickMeaningfulStruct(modelStruct.unbooked_reason, structuredSummary.unbooked_reason),
    manager_next_steps:
      Array.isArray(modelStruct.manager_next_steps) &&
      modelStruct.manager_next_steps.length > 0 &&
      !hasCannedConsultationSteps
        ? modelStruct.manager_next_steps
        : structuredSummary.manager_next_steps,
  };

  const result: AnalysisResult = {
    transcript_summary: formattedSummary,
    booking_status: bookingStatus,
    formatted_transcript: formattedTranscript,
    structured_summary: finalStructuredSummary,
    evaluation,
    criteria_scores: evaluation.criteria,
    key_facts: {
      is_dispute: Boolean(parsed.key_facts?.is_dispute),
      dispute_reason: parsed.key_facts?.dispute_reason || null,
      tone_client: parsed.key_facts?.tone_client || 'нейтральный',
      tone_manager: parsed.key_facts?.tone_manager || 'нейтральный',
      call_outcome: outcome,
      booking_status: bookingStatus,
      client_issue:
        parsed.key_facts?.client_issue ||
        cleanFactValue(rawSummaryObj?.goal) ||
        (essence.service ? `Запись на ${essence.service}` : `Обращение в салон «${salon}»`),
      service: essence.service,
      date: essence.date,
      time: essence.time,
      master: essence.master,
      call_purpose: finalStructuredSummary.call_purpose,
      requested_service: finalStructuredSummary.requested_service,
      offered_master: finalStructuredSummary.offered_master,
      offered_price: finalStructuredSummary.offered_price,
      offered_date_time: finalStructuredSummary.offered_date_time,
      is_booked_text: finalStructuredSummary.booking_status_text,
      unbooked_reason: finalStructuredSummary.unbooked_reason,
      manager_next_steps: finalStructuredSummary.manager_next_steps,
      structured_summary: finalStructuredSummary,
      evaluation,
      criteria_scores: evaluation.criteria,
    },
    operator_score: score,
    operator_mistakes: finalMistakes,
    operator_comment: comment,
    recommendations: finalAdvice,
    missed_opportunities: [],
  };

  // Прокидывание упущенных возможностей из ответа модели (ШАГ 7 системного промпта)
  let missedOpportunities: { type: string; evidence: string; what_to_say: string }[] = [];
  const rawMissed = (parsed as any).missed_opportunities;
  if (Array.isArray(rawMissed)) {
    missedOpportunities = rawMissed
      .map((m: any) => {
        if (m && typeof m === 'object') {
          const item = {
            type: String(m.type || m.category || '').trim(),
            evidence: String(m.evidence || m.reason || '').trim(),
            what_to_say: String(m.what_to_say || m.suggestion || '').trim(),
          };
          return item.type ? item : null;
        }
        if (typeof m === 'string' && m.trim()) {
          return { type: m.trim(), evidence: '', what_to_say: '' };
        }
        return null;
      })
      .filter((m: any): m is { type: string; evidence: string; what_to_say: string } => m !== null);
  }
  result.missed_opportunities = missedOpportunities;

  // Программная проверка согласованности — только логируем расхождения.
  const check = validateResult(result);
  if (!check.valid) {
    console.warn(`[GigaChat] Обнаружены несоответствия в ответе модели: ${check.errors.join('; ')}`);
  }

  return result;
}


export function generateLocalFallbackAnalysis(
  transcript: string,
  _model: GigaChatModel,
  callDurationSeconds?: number,
  customSalonName?: string
): AnalysisResult {
  const salon = (customSalonName || process.env.SALON_NAME || 'Fashion Look Studio').trim();
  const rawClean = (transcript || '').trim();
  const rawLower = rawClean.toLowerCase();

  // 1. Жёсткий предохранитель: звонки менее 10 секунд без реального диалога
  if (callDurationSeconds !== undefined && callDurationSeconds < 10) {
    const failedEval = extractCallEvaluation('', '', null, null, [], [], salon);
    const failedStruct = extractStructuredCallSummary('', 'Разговор не состоялся', undefined, salon, 'не применимо');
    return {
      transcript_summary: `Разговор не состоялся: длительность вызова ${callDurationSeconds} сек (менее 10 секунд), диалог между оператором и клиентом отсутствует.`,
      booking_status: 'не применимо',
      formatted_transcript: rawClean || 'Разговор не состоялся (диалог отсутствует)',
      structured_summary: failedStruct,
      evaluation: failedEval,
      criteria_scores: failedEval.criteria,
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'не состоялся',
        booking_status: 'не применимо',
        client_issue: 'Звонок менее 10 секунд / диалог отсутствует',
        service: null,
        date: null,
        time: null,
        master: null,
        structured_summary: failedStruct,
        evaluation: failedEval,
        criteria_scores: failedEval.criteria,
      },
      operator_score: null,
      operator_mistakes: [],
      operator_comment: `Оценка не выставляется: разговор не состоялся (длительность ${callDurationSeconds} сек менее 10 секунд).`,
      recommendations: `Повторить попытку дозвона клиенту в рабочее время салона «${salon}».`,
    };
  }

  // 2. Пустой транскрипт или заглушка (ожидание STT)
  const isPlaceholderOrEmpty =
    !rawClean ||
    rawLower.includes('стенограмма ожидает') ||
    rawLower.includes('запись разговора и стенограмма отсутствуют');

  if (isPlaceholderOrEmpty) {
    const durLabel = callDurationSeconds !== undefined ? ` (длительность ${callDurationSeconds} сек.)` : '';
    const failedEval = extractCallEvaluation('', '', null, null, [], [], salon);
    const failedStruct = extractStructuredCallSummary('', 'Разговор не состоялся', undefined, salon, 'не применимо');
    return {
      transcript_summary: `Разговор не состоялся: аудиозапись${durLabel} не содержит разборчивой речи (зафиксированы только гудки/тишина или сброс линии).`,
      booking_status: 'не применимо',
      formatted_transcript: rawClean || `Аудиозапись${durLabel} не содержит разборчивой речи.`,
      structured_summary: failedStruct,
      evaluation: failedEval,
      criteria_scores: failedEval.criteria,
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'не состоялся',
        booking_status: 'не применимо',
        client_issue: 'Отсутствует разборчивая речь в аудиозаписи',
        service: null,
        date: null,
        time: null,
        master: null,
        structured_summary: failedStruct,
        evaluation: failedEval,
        criteria_scores: failedEval.criteria,
      },
      operator_score: null,
      operator_mistakes: [],
      operator_comment: `Оценка не выставляется: аудиозапись${durLabel} не содержит разборчивого диалога оператора и клиента.`,
      recommendations: 'Проверить качество связи или повторить вызов.',
    };
  }

  // 3. Очистка от эха, выделение IVR («Автоинформатор») и точное определение ролей («Менеджер» / «Клиент»)
  const formattedTranscript = refineTranscriptRoles(fixDuplicatedTranscript(rawClean));
  const ctx = classifyCallContext(formattedTranscript);

  // 4. Несостоявшийся разговор / чистый автоответчик (после удаления IVR живого диалога не осталось)
  if (ctx.category === 'not_happened') {
    const failedEval = extractCallEvaluation('', '', null, null, [], [], salon);
    const failedStruct = extractStructuredCallSummary('', 'Разговор не состоялся', undefined, salon, 'не применимо');
    return {
      transcript_summary: 'Разговор не состоялся: сработал автоответчик или диалог между сотрудником и собеседником отсутствует. Запись не оформлена.',
      booking_status: 'не применимо',
      formatted_transcript: formattedTranscript || rawClean,
      structured_summary: failedStruct,
      evaluation: failedEval,
      criteria_scores: failedEval.criteria,
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'не состоялся',
        booking_status: 'не применимо',
        client_issue: 'Звонок не состоялся / автоответчик',
        service: null,
        date: null,
        time: null,
        master: null,
        structured_summary: failedStruct,
        evaluation: failedEval,
        criteria_scores: failedEval.criteria,
      },
      operator_score: null,
      operator_mistakes: [],
      operator_comment: 'Разговор не состоялся: зафиксирован автоответчик или обрыв до начала диалога (оценка не выставляется).',
      recommendations: `Повторить звонок клиенту в рабочие часы салона «${salon}».`,
    };
  }

  // 5. Состоявшийся разговор — классифицированный строго по очищенной стенограмме (без IVR)
  const essence = extractEssenceDetails(formattedTranscript, undefined, salon);
  const { conclusion } = buildContextGroundedSummary(ctx, essence, salon);

  let bookingStatus: 'согласие' | 'отказ' | 'консультация' = 'консультация';
  let outcome: 'запись' | 'отказ' | 'консультация' | 'перезвон' | 'отмена' = 'консультация';

  if (ctx.category === 'confirmed_booking') {
    bookingStatus = 'согласие';
    outcome = 'запись';
  } else if (ctx.category === 'refusal_unavailable_service' || ctx.category === 'declined') {
    bookingStatus = 'отказ';
    outcome = 'отказ';
  } else if (ctx.category === 'dispute') {
    bookingStatus = 'консультация';
    outcome = 'перезвон';
  } else if (ctx.category === 'reschedule_or_cancel') {
    bookingStatus = /отмен/i.test(ctx.cleanTranscript) ? 'отказ' : 'согласие';
    outcome = /отмен/i.test(ctx.cleanTranscript) ? 'отмена' : 'запись';
  } else {
    // non_client, late_or_visit_update, consultation
    bookingStatus = 'консультация';
    outcome = 'консультация';
  }

  // Фактологическая оценка по 10 критериям (определяет применимость, баллы, ошибки и рекомендации)
  const evaluation: CallEvaluation = extractCallEvaluation(
    formattedTranscript,
    conclusion,
    null,
    undefined,
    undefined,
    undefined,
    salon
  );

  const score = evaluation.overall_score !== null && !isNaN(evaluation.overall_score)
    ? Math.max(1, Math.min(10, Math.round(evaluation.overall_score)))
    : 8;

  const { formattedSummary, structuredSummary, mistakes, advice } = formatSummaryWithEssence(
    conclusion,
    formattedTranscript,
    essence,
    salon,
    score,
    undefined,
    undefined,
    undefined,
    evaluation
  );

  const finalMistakes = mistakes && mistakes.length > 0 ? mistakes : [];
  const finalAdvice = advice && advice.length > 0 ? advice : [`Соблюдать стандарты сервиса салона «${salon}».`];

  let comment = `Администратор обработал обращение по регламенту салона «${salon}».`;
  if (ctx.category === 'non_client') {
    comment = 'Нецелевой/партнёрский звонок: администратор вежливо принял информацию без лишней нагрузки по скрипту продаж.';
  } else if (ctx.category === 'late_or_visit_update') {
    comment = 'Клиент предупредил об опоздании: администратор вежливо принял информацию и подтвердил ожидание гостя.';
  } else if (ctx.category === 'refusal_unavailable_service') {
    comment = 'Запрошенная услуга в салоне не представлена; администратор предложил доступную альтернативу, но клиент отказался.';
  } else if (ctx.category === 'dispute') {
    comment = 'Зафиксировано обращение со спорным вопросом — требуется контроль со стороны управляющего.';
  } else if (ctx.category === 'declined') {
    comment = 'Запись не оформлена: клиент отклонил предложенные условия или время визита.';
  } else if (ctx.category === 'confirmed_booking') {
    comment = `Администратор согласовал и подтвердил запись по стандартам салона «${salon}».`;
  }

  const clientIssue = ctx.category === 'non_client'
    ? (ctx.nonClientTopic || 'Организационный / партнёрский вопрос')
    : ctx.category === 'late_or_visit_update'
    ? `Предупреждение об опоздании${ctx.lateMinutes ? ` на ${ctx.lateMinutes}` : ''}`
    : ctx.category === 'refusal_unavailable_service'
    ? `Запрос отсутствующей услуги (${essence.service || 'услуга не представлена'})`
    : ctx.category === 'dispute'
    ? 'Вопрос / претензия по обслуживанию'
    : essence.service
    ? `Обращение по услуге: ${essence.service}`
    : 'Консультация / обращение в салон';

  return {
    transcript_summary: formattedSummary,
    booking_status: bookingStatus,
    formatted_transcript: formattedTranscript,
    structured_summary: structuredSummary,
    evaluation,
    criteria_scores: evaluation.criteria,
    key_facts: {
      is_dispute: ctx.isDispute,
      dispute_reason: ctx.isDispute ? 'Зафиксирован спорный вопрос или отмена в тексте разговора' : null,
      tone_client: ctx.isDispute ? 'негативный' : 'нейтральный',
      tone_manager: 'позитивный',
      call_outcome: outcome,
      booking_status: bookingStatus,
      client_issue: clientIssue,
      service: essence.service,
      date: essence.date,
      time: essence.time,
      master: essence.master,
      call_purpose: structuredSummary.call_purpose,
      requested_service: structuredSummary.requested_service,
      offered_master: structuredSummary.offered_master,
      offered_price: structuredSummary.offered_price,
      offered_date_time: structuredSummary.offered_date_time,
      is_booked_text: structuredSummary.booking_status_text,
      unbooked_reason: structuredSummary.unbooked_reason,
      manager_next_steps: structuredSummary.manager_next_steps,
      structured_summary: structuredSummary,
      evaluation,
      criteria_scores: evaluation.criteria,
    },
    operator_score: score,
    operator_mistakes: finalMistakes,
    operator_comment: comment,
    recommendations: finalAdvice,
  };
}

/**
 * Локальный генератор следующих шагов (Next Steps) для администратора
 */
export function generateLocalNextSteps(call: CallRecord, customSalonName?: string): string[] {
  const salon = (customSalonName || process.env.SALON_NAME || 'Fashion Look Studio').trim();
  const struct = extractStructuredCallSummary(
    call.transcript || '',
    call.summary || '',
    call.key_facts,
    salon,
    call.booking_status
  );

  const steps: string[] = [...struct.manager_next_steps];
  const kf: Partial<KeyFacts> = call.key_facts || {};
  if (Array.isArray(kf.promises) && kf.promises.length > 0) {
    kf.promises.forEach(p => {
      if (p && typeof p === 'string' && p.trim()) {
        steps.push(`Выполнить зафиксированное обещание: ${p.trim()}`);
      }
    });
  }
  return steps;
}

/**
 * Интеллектуальная генерация Next Steps (следующих шагов) по итогам звонка для администратора
 */
export async function generateNextStepsWithAI(
  call: CallRecord,
  customSalonName?: string
): Promise<{ steps: string[]; items: NextStepItem[] }> {
  const salon = (customSalonName || process.env.SALON_NAME || 'Fashion Look Studio').trim();

  // Если GigaChat не настроен или транскрипт слишком короткий — используем локальный генератор
  if (!isGigaChatConfigured() || !call.transcript || call.transcript.length < 15) {
    const fallbackSteps = generateLocalNextSteps(call, salon);
    const items: NextStepItem[] = fallbackSteps.map((text, idx) => ({
      id: `step-${Date.now()}-${idx + 1}`,
      text,
      completed: false,
    }));
    return { steps: fallbackSteps, items };
  }

  const prompt = `Ты — старший управляющий и координатор клиентского сервиса салона красоты «${salon}».
Твоя задача — составить четкий, практичный список задач (Next Steps / Следующие шаги) для дежурного администратора салона по итогам телефонного разговора.

ДАННЫЕ ЗВОНКА:
- Статус записи: ${call.booking_status || call.key_facts?.booking_status || 'консультация'}
- Суть обращения: ${call.key_facts?.client_issue || 'консультация'}
- Услуга: ${call.key_facts?.service || 'не указана'}
- Желаемая дата: ${call.key_facts?.date || 'не указана'}
- Желаемое время: ${call.key_facts?.time || 'не указано'}
- Мастер: ${call.key_facts?.master || 'не указан'}
- Обещания клиенту: ${(call.key_facts?.promises || []).join('; ') || 'нет'}
- Конфликт/спор: ${call.key_facts?.is_dispute ? 'ДА: ' + (call.key_facts?.dispute_reason || '') : 'НЕТ'}
- Резюме диалога: ${call.summary || 'нет'}

СТЕНОГРАММА ДИАЛОГА:
${call.transcript}

ТРЕБОВАНИЯ К NEXT STEPS:
1. Составь от 3 до 5 конкретных шагов для администратора салона.
2. Каждый шаг должен начинаться с глагола в неопределенной форме (Внести, Отправить, Позвонить, Проверить, Подготовить, Согласовать).
3. Шаги должны учитывать специфику работы салона красоты (CRM Yclients, мессенджеры WhatsApp/Telegram, напоминания, расходники, график мастеров).
4. Обязательно учти договоренности и обещания, зафиксированные в диалоге.
5. Верни результат СТРОГО в формате JSON-массива строк, без пояснительного текста до и после:
["действие 1", "действие 2", "действие 3"]`;

  try {
    const token = await getGigaChatToken();
    const model = (call.model_used && call.model_used.startsWith('GigaChat') ? call.model_used : 'GigaChat:Lite') as GigaChatModel;

    const response = await gigaChatQueue.enqueue(async () => {
      const res = await axios.post(
        'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
        {
          model: model,
          messages: [
            { role: 'system', content: `Ты — старший управляющий салона «${salon}». Отвечай ТОЛЬКО валидным JSON-массивом строк.` },
            { role: 'user', content: prompt }
          ],
          temperature: 0.2,
          max_tokens: 1000
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          httpsAgent,
          timeout: 60000
        }
      );
      return res.data;
    }, 'Генерация Next Steps');

    const content = response.choices?.[0]?.message?.content || '';
    const cleanJson = content.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanJson);

    if (Array.isArray(parsed) && parsed.length > 0) {
      const steps: string[] = parsed
        .map((s: any) => String(s).trim())
        .filter((s: string) => s.length > 0);

      const items: NextStepItem[] = steps.map((text, idx) => ({
        id: `step-${Date.now()}-${idx + 1}`,
        text,
        completed: false,
      }));

      return { steps, items };
    }
  } catch (err: any) {
    console.warn(`[GigaChat NextSteps] Сбой онлайн-генерации: ${err.message}. Переход на резервный генератор.`);
  }

  // Резервный расчет
  const fallbackSteps = generateLocalNextSteps(call, salon);
  const items: NextStepItem[] = fallbackSteps.map((text, idx) => ({
    id: `step-${Date.now()}-${idx + 1}`,
    text,
    completed: false,
  }));
  return { steps: fallbackSteps, items };
}

export interface ClarifyContextParams {
  call: CallRecord;
  question: string;
  salonName?: string;
  forceModel?: GigaChatModel;
}

export interface ClarifyContextResult {
  answer: string;
  model: string;
  provider: string;
  timestamp: string;
  tokens_used?: TokenUsage;
}

/**
 * Системный промпт для фактчекинга и уточнения контекста через GigaChat
 */
export function buildClarificationSystemPrompt(salonName: string): string {
  return `Ты — ведущий эксперт контроля качества и аналитик звонков салона красоты «${salonName}» на базе GigaChat.
Твоя задача — ответить на произвольный уточняющий вопрос пользователя по конкретному телефонному разговору, опираясь СТРОГО на предоставленную стенограмму и объективные факты звонка.

ГЛАВНЫЕ ПРАВИЛА:
1. Базируйся ИСКЛЮЧИТЕЛЬНО на содержании транскрипта. Запрещено додумывать, выдумывать или предполагать факты, которых нет в тексте.
2. Если в разговоре нет ответа на поставленный вопрос, прямо напиши: «В стенограмме данного разговора эта информация не упоминается».
3. Обязательно подтверждай ключевые тезисы точными цитатами или репликами участников диалога в кавычках (например: «Давайте 15 0 0», «по номеру телефона на Озон банк»).
4. Если вопрос касается цен, предоплаты, условий бронирования, скидок, имен мастеров, даты и времени — выдели эти сведения четким структурированным ответом с конкретными цифрами и цитатами.
5. Форматируй ответ понятно, структурированно (абзацы, маркированные списки при необходимости), избегай канцелярита. Объем ответа: 2–6 содержательных предложений или структурированный список.`;
}

/**
 * Пользовательский промпт с метаданными звонка, стенограммой и вопросом
 */
export function buildClarificationUserPrompt(call: CallRecord, question: string): string {
  const service = call.key_facts?.service || 'не указана';
  const master = call.key_facts?.master || 'не указан';
  const date = call.key_facts?.date || 'не указана';
  const time = call.key_facts?.time || 'не указано';
  const bookingStatus = call.key_facts?.booking_status || call.booking_status || 'не определен';
  const promises = Array.isArray(call.key_facts?.promises) && call.key_facts.promises.length > 0 
    ? call.key_facts.promises.join('; ') 
    : 'нет зафиксированных обещаний';
  const dispute = call.key_facts?.is_dispute ? `Да (причина: ${call.key_facts.dispute_reason || 'спор'})` : 'Нет';

  return `КОНТЕКСТ АНАЛИЗИРУЕМОГО ЗВОНКА:
- Идентификатор звонка: ${call.call_id}
- Клиент: ${call.client_name || 'Клиент'} (${call.client_phone_masked || call.client_phone || 'номер скрыт'})
- Оператор / администратор: ${call.operator_name || 'Не указан'}
- Согласованная услуга: ${service}
- Мастер: ${master}
- Согласованная дата и время: ${date} в ${time}
- Статус записи: ${bookingStatus}
- Наличие спора/претензии: ${dispute}
- Зафиксированные обязательства/обещания сотрудника: ${promises}
- Исходное резюме звонка: ${call.summary || 'отсутствует'}

ПОЛНАЯ СТЕНОГРАММА ДИАЛОГА:
"""
${call.transcript || 'Текст стенограммы отсутствует.'}
"""

УТОЧНЯЮЩИЙ ВОПРОС ПОЛЬЗОВАТЕЛЯ ДЛЯ ПРОВЕРКИ ФАКТОВ:
"${question.trim()}"

Дай точный, фактологический ответ с цитатами из разговора:`;
}

/**
 * Локальный эвристический фактчекинг на случай недоступности API
 */
export function localFactualClarification(call: CallRecord, question: string): string {
  const q = question.toLowerCase();
  const transcript = call.transcript || '';
  const facts = (call.key_facts || {}) as any;

  if (q.includes('цен') || q.includes('стоимост') || q.includes('руб') || q.includes('оплат') || q.includes('банк') || q.includes('предоплат')) {
    const priceMatches = transcript.match(/\d+[\s\d]*\s*(?:руб|р\b|тыс)/gi) || [];
    const paymentQuotes: string[] = [];
    transcript.split('\n').forEach(line => {
      if (line.match(/оплат|банк|руб|стоимост|предоплат|бронирован/i)) {
        paymentQuotes.push(`«${line.trim()}»`);
      }
    });

    let res = `Финансовые факты по звонку ${call.call_id}:\n`;
    if (priceMatches.length > 0) {
      res += `• В разговоре прозвучали суммы: ${priceMatches.join(', ')}.\n`;
    }
    if (paymentQuotes.length > 0) {
      res += `• Цитаты из диалога об оплате и бронировании:\n  ${paymentQuotes.slice(0, 3).join('\n  ')}\n`;
    }
    if (facts.promises && facts.promises.some((p: string) => p.toLowerCase().includes('оплат') || p.toLowerCase().includes('банк') || p.toLowerCase().includes('реквизит'))) {
      res += `• Зафиксированное обещание: ${facts.promises.join('; ')}.`;
    }
    return res || 'В стенограмме информация о точной стоимости не упоминается.';
  }

  if (q.includes('мастер') || q.includes('кто') || q.includes('специалист') || q.includes('имя')) {
    if (facts.master) {
      return `В стенограмме зафиксирован мастер: «${facts.master}». В диалоге обсуждалась запись к данному специалисту (согласованная услуга: ${facts.service || 'не указана'}).`;
    }
    return 'В стенограмме конкретное имя мастера не прозвучало или не было однозначно согласовано.';
  }

  if (q.includes('когда') || q.includes('дат') || q.includes('врем') || q.includes('число') || q.includes('день')) {
    const d = facts.date || 'не указана';
    const t = facts.time || 'не указано';
    return `По данным стенограммы: согласованная дата — «${d}», согласованное время визита — «${t}». Статус бронирования: ${facts.booking_status || 'не определен'}.`;
  }

  if (q.includes('обещан') || q.includes('обязательств') || q.includes('договор')) {
    if (facts.promises && facts.promises.length > 0) {
      return `Зафиксированные обещания оператора клиенту:\n` + facts.promises.map((p: string, i: number) => `${i + 1}. «${p}»`).join('\n');
    }
    return 'В ходе разговора оператор не давал нестандартных обязательств, требующих отдельного контроля.';
  }

  return `По вопросу «${question}»: исходное резюме звонка содержит следующую информацию: ${call.summary || 'Резюме не сформировано'}. Для расширенного анализа с цитированием укажите авторизационные данные GigaChat в настройках приложения.`;
}

/**
 * Отправляет произвольный вопрос пользователя по конкретному звонку в GigaChat для получения фактологической выжимки
 */
export async function clarifyCallContextWithGigaChat({
  call,
  question,
  salonName = 'Fashion Look Studio',
  forceModel
}: ClarifyContextParams): Promise<ClarifyContextResult> {
  if (!question || !question.trim()) {
    throw new Error('Укажите вопрос для уточнения контекста');
  }

  const systemPrompt = buildClarificationSystemPrompt(salonName);
  const userPrompt = buildClarificationUserPrompt(call, question);
  const now = new Date().toISOString();

  if (isGigaChatConfigured()) {
    try {
      const token = await getGigaChatToken();
      const model: GigaChatModel = forceModel || (process.env.GIGACHAT_DEFAULT_MODEL as GigaChatModel) || 'GigaChat:Lite';
      console.log(`[GigaChat] Отправка уточняющего вопроса по звонку ${call.call_id} в GigaChat (модель: ${model})`);

      const gigachatApiUrl = process.env.GIGACHAT_API_URL || 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions';

      const response = await gigaChatQueue.enqueue(async () => {
        const res = await axios.post(
          gigachatApiUrl,
          {
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.2,
            max_tokens: 1500
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            httpsAgent,
            timeout: 60000
          }
        );
        return res.data;
      }, `Уточнение контекста [${call.call_id}]`);

      const rawContent = response?.choices?.[0]?.message?.content;
      if (!rawContent) {
        throw new Error('GigaChat вернул пустой ответ');
      }

      const usage = response?.usage;
      const tokens: TokenUsage = {
        prompt_tokens: usage?.prompt_tokens,
        completion_tokens: usage?.completion_tokens,
        total_tokens: usage?.total_tokens
      };

      return {
        answer: rawContent.trim(),
        model,
        provider: `GigaChat (${model})`,
        timestamp: now,
        tokens_used: tokens
      };
    } catch (err: any) {
      console.warn(`[GigaChat Clarify] Ошибка обращения к API GigaChat: ${err.message}. Переход на локальный фактологический анализ.`);
    }
  }

  // Локальный эвристический анализ стенограммы, если GigaChat не настроен или временно недоступен
  const localAnswer = localFactualClarification(call, question);
  return {
    answer: localAnswer,
    model: 'heuristic_fallback',
    provider: 'Локальный фактологический анализ стенограммы (GigaChat не настроен)',
    timestamp: now
  };
}
