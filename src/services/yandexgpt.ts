/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import axios from 'axios';
import https from 'https';
import { getYandexAuthHeader, getYandexFolderId, isYandexAuthConfigured } from './yandex-auth.js';
import { getGigaChatToken, isGigaChatConfigured } from './gigachat-auth.js';
import { CallRecord, ContextClarification, TokenUsage } from '../types.js';

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

export interface ClarifyContextParams {
  call: CallRecord;
  question: string;
  salonName?: string;
  forceModel?: 'yandexgpt' | 'gigachat';
}

export interface ClarifyContextResult {
  answer: string;
  model: 'yandexgpt' | 'GigaChat' | string;
  provider: string;
  timestamp: string;
  tokens_used?: TokenUsage;
}

/**
 * Builds system prompt for fact-checking and context clarification
 */
function buildClarificationSystemPrompt(salonName: string): string {
  return `Ты — специализированный ИИ-аналитик контроля качества салона красоты «${salonName}» на базе Yandex.GPT.
Твоя задача — ответить на уточняющий вопрос пользователя по конкретному телефонному разговору, опираясь СТРОГО на предоставленную стенограмму и объективные факты звонка.

ГЛАВНЫЕ ПРАВИЛА:
1. Базируйся ИСКЛЮЧИТЕЛЬНО на содержании транскрипта. Категорически запрещено додумывать, выдумывать или предполагать факты, которых нет в тексте.
2. Если в разговоре нет ответа на поставленный вопрос, прямо напиши: «В стенограмме данного разговора эта информация не упоминается».
3. Обязательно подтверждай ключевые тезисы точными цитатами или репликами участников диалога в кавычках (например: «Давайте 15 0 0», «по номеру телефона на Озон банк»).
4. Если вопрос касается цен, предоплаты, условий бронирования, скидок, имен мастеров, даты и времени — выдели эти сведения четким списком с конкретными цифрами и цитатами.
5. Форматируй ответ понятно, структурированно (абзацы, маркированные списки при необходимости), избегай канцелярита. Объем ответа: 2–6 содержательных предложений или структурированный список.`;
}

/**
 * Builds user prompt with full call metadata and transcript
 */
function buildClarificationUserPrompt(call: CallRecord, question: string): string {
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
 * Executes clarification request via Yandex.GPT Foundation Models API
 */
async function queryYandexGPTApi(
  systemPrompt: string,
  userPrompt: string,
  folderId: string
): Promise<{ text: string; tokens?: TokenUsage }> {
  const authHeader = await getYandexAuthHeader();
  const url = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';

  const payload = {
    modelUri: `gpt://${folderId}/yandexgpt/latest`,
    completionOptions: {
      stream: false,
      temperature: 0.2,
      maxTokens: '2000'
    },
    messages: [
      { role: 'system', text: systemPrompt },
      { role: 'user', text: userPrompt }
    ]
  };

  const res = await axios.post(url, payload, {
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
      'x-folder-id': folderId
    },
    httpsAgent,
    timeout: 45000
  });

  const alternative = res.data?.result?.alternatives?.[0];
  const text = alternative?.message?.text;
  if (!text) {
    throw new Error('Yandex.GPT вернул пустой ответ');
  }

  const usage = res.data?.result?.usage;
  const tokens: TokenUsage = {
    prompt_tokens: usage?.inputTextTokens ? parseInt(usage.inputTextTokens, 10) : undefined,
    completion_tokens: usage?.completionTokens ? parseInt(usage.completionTokens, 10) : undefined,
    total_tokens: usage?.totalTokens ? parseInt(usage.totalTokens, 10) : undefined,
  };

  return { text, tokens };
}

/**
 * Fallback via GigaChat if Yandex.GPT is not available or credentials missing
 */
async function queryGigaChatFallback(
  systemPrompt: string,
  userPrompt: string
): Promise<{ text: string; tokens?: TokenUsage }> {
  const token = await getGigaChatToken();
  const gigachatApiUrl = process.env.GIGACHAT_API_URL || 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions';
  const model = (process.env.GIGACHAT_DEFAULT_MODEL as any) || 'GigaChat:Lite';

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
      timeout: 45000
    }
  );

  const rawContent = res.data?.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error('GigaChat вернул пустой ответ');
  }

  const usage = res.data?.usage;
  const tokens: TokenUsage = {
    prompt_tokens: usage?.prompt_tokens,
    completion_tokens: usage?.completion_tokens,
    total_tokens: usage?.total_tokens
  };

  return { text: rawContent, tokens };
}

/**
 * Rule-based fallback if no LLM credentials are valid
 */
function localFactualClarification(call: CallRecord, question: string): string {
  const q = question.toLowerCase();
  const transcript = call.transcript || '';
  const facts = call.key_facts || {} as any;

  // Question about price / cost / payment
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

  // Question about master / specialist
  if (q.includes('мастер') || q.includes('кто') || q.includes('специалист') || q.includes('имя')) {
    if (facts.master) {
      return `В стенограмме зафиксирован мастер: «${facts.master}». В диалоге обсуждалась запись к данному специалисту (согласованная услуга: ${facts.service || 'не указана'}).`;
    }
    return 'В стенограмме конкретное имя мастера не прозвучало или не было однозначно согласовано.';
  }

  // Question about date and time
  if (q.includes('когда') || q.includes('дат') || q.includes('врем') || q.includes('число') || q.includes('день')) {
    const d = facts.date || 'не указана';
    const t = facts.time || 'не указано';
    return `По данным стенограммы: согласованная дата — «${d}», согласованное время визита — «${t}». Статус бронирования: ${facts.booking_status || 'не определен'}.`;
  }

  // Question about promises / obligations
  if (q.includes('обещан') || q.includes('обязательств') || q.includes('договор')) {
    if (facts.promises && facts.promises.length > 0) {
      return `Зафиксированные обещания оператора клиенту:\n` + facts.promises.map((p: string, i: number) => `${i + 1}. «${p}»`).join('\n');
    }
    return 'В ходе разговора оператор не давал нестандартных обязательств, требующих отдельного контроля.';
  }

  // Generic fallback
  return `По вопросу «${question}»: исходное резюме звонка содержит следующую информацию: ${call.summary || 'Резюме не сформировано'}. Для расширенного анализа с цитированием подключите Yandex Cloud API ключ или GigaChat в настройках приложения.`;
}

import { clarifyCallContextWithGigaChat } from './gigachat.js';

/**
 * Main service method: clarify context and check facts for a specific call.
 * Yandex.GPT временно исключен по запросу пользователя, запросы направляются в GigaChat.
 */
export async function clarifyCallContextWithYandexGPT(params: ClarifyContextParams): Promise<ClarifyContextResult> {
  return clarifyCallContextWithGigaChat(params as any);
}
