/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import { existsSync, mkdirSync, readFileSync, copyFileSync, writeFileSync } from 'fs';
import path from 'path';
import { encrypt, decrypt } from './crypto-store.js';
import { CallRecord, LogEntry, SystemConfig, AccessLogEntry, User, SystemNotification, ConsentRecord } from '../types.js';
import { getInitialUsers } from './user-store.js';
import { readConsentStoreSync, setConsentStoreDirect } from './consent-store.js';
import { deduplicateCalls } from '../services/callUtils.js';

const DATA_PATH_ENC = process.env.DATA_PATH_ENC || path.join(process.cwd(), 'data', 'data-store.enc');
const DATA_PATH_JSON = process.env.DATA_PATH || path.join(process.cwd(), 'data', 'data-store.json');
const ROOT_JSON = path.join(process.cwd(), 'data-store.json');

export interface AppDatabase {
  calls: CallRecord[];
  logs: LogEntry[];
  access_log?: AccessLogEntry[];
  users?: User[];
  notifications?: SystemNotification[];
  config: SystemConfig;
  consents?: ConsentRecord[];
}

export function getDefaultConfig(): SystemConfig {
  const megafonToken = (process.env.MEGAFON_TOKEN || '').trim();
  const megafonApiVersion = ((process.env.MEGAFON_API_VERSION as any) === 'rest_wcgp' ? 'rest_wcgp' : 'json_rpc');
  const megafonRestDomain = (process.env.MEGAFON_REST_DOMAIN || '').trim();
  const megafonRestToken = (process.env.MEGAFON_REST_TOKEN || '').trim();
  const megafonCrmToken = (process.env.MEGAFON_CRM_TOKEN || '').trim();
  const vkToken = (process.env.VK_TOKEN || '').trim();
  const vkChatId = (process.env.VK_CHAT_ID || '').trim();
  const yclientsUserToken = (process.env.YCLIENTS_USER_TOKEN || '').trim();
  const yclientsPartnerToken = (process.env.YCLIENTS_PARTNER_TOKEN || '').trim();
  const yclientsSalonId = (process.env.YCLIENTS_SALON_ID || '').trim();

  return {
    activeModel: (process.env.GIGACHAT_MODEL as any) || 'GigaChat:Lite',
    default_gigachat_model: (process.env.GIGACHAT_MODEL as any) || 'GigaChat:Lite',
    salonName: (process.env.SALON_NAME || 'Лик 28').trim(),
    megafon: {
      apiVersion: megafonApiVersion,
      token: megafonToken,
      webhookUrl: '/api/calls/webhook',
      autoImport: Boolean(megafonToken || megafonRestToken),
      active: Boolean(megafonToken || megafonRestToken),
      pollingEnabled: Boolean(megafonToken || megafonRestToken),
      pollingIntervalMinutes: 5,
      lastPollingTime: new Date().toISOString(),
      restDomain: megafonRestDomain,
      restToken: megafonRestToken,
      crmToken: megafonCrmToken,
      restPollingPeriod: 'today',
    },
    vk: {
      token: vkToken,
      chatId: vkChatId,
      enabled: Boolean(vkToken && vkChatId),
      template: `🔔 *Анализ звонка #{call_id}*\n📅 *Дата:* {call_date_time}\n⏱️ *Длительность:* {duration}\n👤 *Клиент:* {client_name}\n📞 *Оценка оператора:* {operator_score}\n💬 *Резюме:* {summary}\n⚠️ *Конфликт:* {is_dispute_text}\n💡 *Рекомендации:* {recommendations}`,
    },
    yclients: {
      userToken: yclientsUserToken,
      partnerToken: yclientsPartnerToken,
      salonId: yclientsSalonId,
      enabled: Boolean(yclientsUserToken && yclientsSalonId),
    },
  };
}

export const DEFAULT_CONFIG: SystemConfig = getDefaultConfig();

export const SEED_CALLS: CallRecord[] = [
  {
    call_id: 'megafon-call-89101',
    timestamp: new Date(Date.now() - 3600000 * 4).toISOString(),
    duration_seconds: 145,
    model_used: 'GigaChat:Lite',
    gigachat_model: 'GigaChat:Lite',
    audio_url: 'https://cp.megafon.ru/record/megafon-call-89101.mp3',
    client_name: 'Клиент (****003344)',
    client_phone_masked: '****003344',
    full_phone: '+79270003344',
    operator_name: 'Мария (администратор)',
    status: 'completed',
    type: 'incoming',
    is_answered: true,
    is_demo: true,
    consent_status: 'active',
    consent_method: 'voice',
    transcript: `Менеджер: Добрый день! Салон красоты «Лик 28», меня зовут Мария. Чем я могу вам помочь?\nКлиент: Здравствуйте. Я бы хотела записаться на аппаратный маникюр с покрытием шеллак на завтра на вечер.\nМенеджер: Да, конечно. Завтра на вечер есть свободное время на 18:30 и на 20:00. Какой мастер вам больше нравится — Кристина или Анна?\nКлиент: Давайте к Кристине на 18:30. Сколько это будет стоить?\nМенеджер: Аппаратный маникюр с покрытием у Кристины стоит 2100 рублей. По времени займет около полутора часов. Записываю вас на завтра на 18:30.\nКлиент: Отлично, спасибо большое!\nМенеджер: Пожалуйста! За полчаса до визита мы пришлем вам напоминание в мессенджер. Ждем вас в салоне «Лик 28»!`,
    summary: 'Суть обращения: услуга — аппаратный маникюр с шеллаком, дата — завтра, время — 18:30, мастер — Кристина. Пересказ диалога: Клиентка позвонила в салон с намерением записаться на аппаратный маникюр с покрытием шеллак на завтрашний вечер. Администратор Мария поприветствовала гостью и предложила слоты на 18:30 и 20:00 у мастеров Кристины и Анны. Клиентка выбрала время 18:30 к мастеру Кристине и уточнила цену процедуры. Администратор подтвердила запись, озвучила стоимость 2100 рублей и пообещала выслать напоминание в WhatsApp. Вывод: Администратор Мария оперативно предложила свободные слоты (18:30 и 20:00). Клиент согласовала визит на 18:30 к мастеру Кристине; запись успешно оформлена, обещано напоминание в WhatsApp.\nРазбор работы менеджера (оценка 10/10):\n- Ошибки и недочеты: Грубых ошибок не допущено, администратор соблюдал регламент вежливости, предложил вилку по времени и мастерам, четко и доброжелательно зафиксировал бронь.\n- Советы по оптимизации: Поддерживать аналогичный высокий уровень сервиса и за день до визита отправить напоминание в мессенджер с геолокацией салона.',
    booking_status: 'согласие',
    key_facts: {
      is_dispute: false,
      dispute_reason: null,
      promises: ['Прислать напоминание за полчаса до визита'],
      tone_client: 'нейтральный',
      tone_manager: 'позитивный',
      call_outcome: 'запись',
      booking_status: 'согласие',
      client_issue: 'Запись на маникюр',
      service: 'аппаратный маникюр с шеллаком',
      date: 'завтра',
      time: '18:30',
      master: 'Кристина',
    },
    trigger_phrases: [],
    recommendations: [
      'Отличная работа администратора, вежливость на высоком уровне.',
      'Рекомендуется также предлагать клиенту сопутствующие услуги салона «Лик 28» (парафинотерапию или уход для рук).',
    ],
    operator_score: 10,
    operator_mistakes: [],
    operator_comment: 'Мария продемонстрировала отличные навыки вежливого общения, быстро ответила на вопросы по цене и длительности, зафиксировала договоренности.',
  },
  {
    call_id: 'megafon-call-89102',
    timestamp: new Date(Date.now() - 3600000 * 3).toISOString(),
    duration_seconds: 180,
    model_used: 'GigaChat:Pro',
    gigachat_model: 'GigaChat:Pro',
    audio_url: 'https://cp.megafon.ru/record/megafon-call-89102.mp3',
    client_name: 'Клиент (****006677)',
    client_phone_masked: '****006677',
    full_phone: '+79270006677',
    operator_name: 'Дмитрий (менеджер)',
    status: 'completed',
    type: 'incoming',
    is_answered: true,
    is_demo: true,
    consent_status: 'active',
    consent_method: 'voice',
    transcript: `Клиент: Здравствуйте! Мне пришло сообщение, что моя запись к косметологу на сегодня отменена! Я уже еду к вам!\nМенеджер: Здравствуйте! Салон красоты «Лик 28», администратор Дмитрий. Приносим свои глубочайшие извинения. Дело в том, что специалист экстренно заболел, и мы физически не можем провести процедуру прямо сейчас.\nКлиент: Я трачу свое время на дорогу!\nМенеджер: Мы прекрасно вас понимаем и искренне сожалеем. Давайте мы подберем вам другого топ-мастера на удобное время со скидкой 30% на процедуру в качестве компенсации?\nКлиент: Ладно. А когда есть свободное время?\nМенеджер: Завтра в 12:00 или в 15:00 есть окна у Ирины, она ведущий специалист. И мы зафиксируем для вас скидку 30%.\nКлиент: Хорошо, давайте завтра на 12:00 к Ирине.\nМенеджер: Отлично, записал вас на завтра на 12:00 к Ирине. Мы перезвоним сегодня вечером для подтверждения. Еще раз извините за неудобства.`,
    summary: 'Суть обращения: услуга — прием косметолога, дата — завтра, время — 12:00, мастер — Ирина. Пересказ диалога: Клиентка обратилась в салон с резкой претензией по поводу внезапной отмены записи к косметологу день-в-день. Менеджер Дмитрий принес искренние извинения, объяснил причину форс-мажора болезнью мастера и предложил компенсационную скидку 30%. В качестве решения сотрудник подобрал ближайшее удобное окно на завтра в 12:00 к ведущему специалисту Ирине. Клиентка согласилась на предложенный перенос, после чего администратор зафиксировал новую запись со скидкой. Вывод: Клиент выразила претензию из-за отмены визита день-в-день по причине болезни мастера. Менеджер Дмитрий применил амортизацию и согласовал перенос визита на завтра к ведущему специалисту Ирине со скидкой 30%; запись подтверждена.\nРазбор работы менеджера (оценка 8/10):\n- Ошибки и недочеты: 1) Клиент не был заблаговременно оповещен о форс-мажоре до своего выезда в салон; 2) Администратор не уточнил у клиента предпочтительный мессенджер для вечернего подтверждения визита.\n- Советы по оптимизации: 1) Внедрить регламент экстренного автооповещения при форс-мажорах минимум за 3-4 часа до визита; 2) При обещании перезвонить уточнять удобный канал связи («Вам удобнее звонок или сообщение в WhatsApp?»).',
    booking_status: 'согласие',
    key_facts: {
      is_dispute: true,
      dispute_reason: 'Клиент недоволен отменой записи день-в-день',
      promises: ['Предоставить скидку 30% на процедуру у косметолога Ирины', 'Перезвонить сегодня вечером для подтверждения'],
      tone_client: 'негативный',
      tone_manager: 'спокойный',
      call_outcome: 'запись',
      booking_status: 'согласие',
      client_issue: 'Отмена записи день-в-день',
      service: 'прием косметолога',
      date: 'завтра',
      time: '12:00',
      master: 'Ирина',
    },
    trigger_phrases: [
      'Мне пришло сообщение, что моя запись к косметологу на сегодня отменена!',
      'Я трачу свое время на дорогу!',
    ],
    recommendations: [
      'Администратор грамотно применил амортизацию и оперативно предложил альтернативу со скидкой.',
      'Уведомлять клиентов об отменах минимум за 3-4 часа, чтобы предотвратить негативные обращения.',
    ],
    operator_score: 8,
    operator_mistakes: [
      'Клиент не был предупрежден об отмене записи заблаговременно (до выезда в салон)',
      'Администратор не уточнил удобный канал для вечернего контрольного контакта'
    ],
    operator_comment: 'Дмитрий был спокоен, не перебивал клиента, предложил решение с компенсацией в виде скидки 30%. Упущены баллы из-за позднего оповещения клиента.',
  },
];

let memCache: AppDatabase | null = null;

export function readStoreSync(): AppDatabase {
  if (memCache) return memCache;

  const dir = path.dirname(DATA_PATH_ENC);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (existsSync(DATA_PATH_ENC)) {
    try {
      const raw = readFileSync(DATA_PATH_ENC, 'utf-8');
      const payload = JSON.parse(raw);
      if (payload && payload.encrypted && payload.iv && payload.tag) {
        const decryptedStr = decrypt(payload);
        const parsed: AppDatabase = JSON.parse(decryptedStr);
        if (Array.isArray(parsed.calls)) {
          parsed.calls = deduplicateCalls(parsed.calls);
        }
        if (!parsed.users || parsed.users.length === 0) {
          parsed.users = getInitialUsers();
        }
        if (!Array.isArray(parsed.notifications)) {
          parsed.notifications = [];
        }
        if (process.env.MEGAFON_TOKEN && (!parsed.config?.megafon?.token || parsed.config.megafon.token === '')) {
          if (!parsed.config) parsed.config = getDefaultConfig();
          if (!parsed.config.megafon) parsed.config.megafon = getDefaultConfig().megafon;
          parsed.config.megafon.token = process.env.MEGAFON_TOKEN.trim();
          parsed.config.megafon.active = true;
        }
        if (Array.isArray(parsed.consents) && parsed.consents.length > 0) {
          const currentStore = readConsentStoreSync();
          if (currentStore.consents.length === 0) {
            setConsentStoreDirect({ consents: parsed.consents });
          } else {
            const existingOrigins = new Set(currentStore.consents.map(c => c.call_id_origin || c.consent_id));
            const missing = parsed.consents.filter(c => !existingOrigins.has(c.call_id_origin || c.consent_id));
            if (missing.length > 0) {
              setConsentStoreDirect({ consents: [...currentStore.consents, ...missing] });
            }
          }
        }
        memCache = parsed;
        return memCache;
      } else if (payload && Array.isArray(payload.calls)) {
        // Raw JSON accidentally stored as .enc
        payload.calls = deduplicateCalls(payload.calls);
        if (!payload.users || payload.users.length === 0) {
          payload.users = getInitialUsers();
        }
        if (Array.isArray(payload.consents) && payload.consents.length > 0) {
          const currentStore = readConsentStoreSync();
          if (currentStore.consents.length === 0) {
            setConsentStoreDirect({ consents: payload.consents });
          } else {
            const existingOrigins = new Set(currentStore.consents.map(c => c.call_id_origin || c.consent_id));
            const missing = payload.consents.filter(c => !existingOrigins.has(c.call_id_origin || c.consent_id));
            if (missing.length > 0) {
              setConsentStoreDirect({ consents: [...currentStore.consents, ...missing] });
            }
          }
        }
        memCache = payload;
        return memCache;
      }
    } catch (e: any) {
      console.warn('[Store] Ошибка синхронного дешифрования data-store.enc:', e.message);
      // Backup corrupted file to avoid data loss
      try {
        const bak = `${DATA_PATH_ENC}.corrupted.${Date.now()}`;
        copyFileSync(DATA_PATH_ENC, bak);
        console.warn(`[Store] Нераспознанный файл сохранен как резервная копия: ${bak}`);
      } catch {
        // ignore
      }
    }
  }

  // Check backup mirror
  const backupMirror = path.join(dir, 'data-store.backup.json');
  if (existsSync(backupMirror)) {
    try {
      const raw = readFileSync(backupMirror, 'utf-8');
      const parsed: AppDatabase = JSON.parse(raw);
      if (parsed && (Array.isArray(parsed.calls) || Array.isArray(parsed.users))) {
        console.log('[Store] Восстановлена база данных из локального backup mirror (data-store.backup.json)');
        if (Array.isArray(parsed.calls)) {
          parsed.calls = deduplicateCalls(parsed.calls);
        }
        if (Array.isArray(parsed.consents) && parsed.consents.length > 0) {
          const currentStore = readConsentStoreSync();
          if (currentStore.consents.length === 0) {
            setConsentStoreDirect({ consents: parsed.consents });
          } else {
            const existingOrigins = new Set(currentStore.consents.map(c => c.call_id_origin || c.consent_id));
            const missing = parsed.consents.filter(c => !existingOrigins.has(c.call_id_origin || c.consent_id));
            if (missing.length > 0) {
              setConsentStoreDirect({ consents: [...currentStore.consents, ...missing] });
            }
          }
        }
        memCache = parsed;
        return memCache;
      }
    } catch {
      // ignore
    }
  }

  const legacyPath = existsSync(DATA_PATH_JSON) ? DATA_PATH_JSON : (existsSync(ROOT_JSON) ? ROOT_JSON : null);
  if (legacyPath) {
    try {
      const raw = readFileSync(legacyPath, 'utf-8');
      const parsed: AppDatabase = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.calls)) {
        parsed.calls = deduplicateCalls(parsed.calls);
        if (!parsed.users || parsed.users.length === 0) {
          parsed.users = getInitialUsers();
        }
        if (!Array.isArray(parsed.notifications)) {
          parsed.notifications = [];
        }
        memCache = parsed;
        return memCache;
      }
    } catch (migErr: any) {
      console.warn('[Store] Ошибка синхронного чтения legacy хранилища:', migErr.message);
    }
  }

  memCache = {
    calls: [],
    logs: [
      {
        id: 'log-1',
        timestamp: new Date().toISOString(),
        type: 'info',
        module: 'security',
        message: 'Инициализировано зашифрованное хранилище AES-256-GCM в соответствии с 152-ФЗ',
      },
    ],
    access_log: [],
    users: getInitialUsers(),
    config: DEFAULT_CONFIG,
  };

  return memCache;
}

export async function readStore(): Promise<AppDatabase> {
  if (memCache) return memCache;

  const dir = path.dirname(DATA_PATH_ENC);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // 1. Try reading encrypted file
  if (existsSync(DATA_PATH_ENC)) {
    try {
      const raw = await fs.readFile(DATA_PATH_ENC, 'utf-8');
      const payload = JSON.parse(raw);
      if (payload && payload.encrypted && payload.iv && payload.tag) {
        const decryptedStr = decrypt(payload);
        const parsed: AppDatabase = JSON.parse(decryptedStr);
        if (Array.isArray(parsed.calls)) {
          parsed.calls = deduplicateCalls(parsed.calls);
        }
        if (!parsed.users || parsed.users.length === 0) {
          parsed.users = getInitialUsers();
        }
        if (process.env.MEGAFON_TOKEN && (!parsed.config?.megafon?.token || parsed.config.megafon.token === '')) {
          if (!parsed.config) parsed.config = getDefaultConfig();
          if (!parsed.config.megafon) parsed.config.megafon = getDefaultConfig().megafon;
          parsed.config.megafon.token = process.env.MEGAFON_TOKEN.trim();
          parsed.config.megafon.active = true;
        }
        memCache = parsed;
        return memCache;
      } else if (payload && Array.isArray(payload.calls)) {
        payload.calls = deduplicateCalls(payload.calls);
        if (!payload.users || payload.users.length === 0) {
          payload.users = getInitialUsers();
        }
        memCache = payload;
        return memCache;
      }
    } catch (e: any) {
      console.warn('[Store] Ошибка дешифрования data-store.enc:', e.message);
    }
  }

  // Backup mirror check
  const backupMirror = path.join(dir, 'data-store.backup.json');
  if (existsSync(backupMirror)) {
    try {
      const raw = readFileSync(backupMirror, 'utf-8');
      const parsed: AppDatabase = JSON.parse(raw);
      if (parsed && (Array.isArray(parsed.calls) || Array.isArray(parsed.users))) {
        console.log('[Store] Асинхронно восстановлена база данных из backup mirror');
        if (Array.isArray(parsed.calls)) {
          parsed.calls = deduplicateCalls(parsed.calls);
        }
        memCache = parsed;
        return memCache;
      }
    } catch {
      // ignore
    }
  }

  // 2. Migration: Try reading legacy unencrypted JSON file
  const legacyPath = existsSync(DATA_PATH_JSON) ? DATA_PATH_JSON : (existsSync(ROOT_JSON) ? ROOT_JSON : null);
  if (legacyPath) {
    try {
      const raw = readFileSync(legacyPath, 'utf-8');
      const parsed: AppDatabase = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.calls)) {
        parsed.calls = deduplicateCalls(parsed.calls);
        if (!parsed.users || parsed.users.length === 0) {
          parsed.users = getInitialUsers();
        }
        console.log(`[Store] Миграция открытого ${legacyPath} в зашифрованный data-store.enc (152-ФЗ)...`);
        memCache = parsed;
        await writeStore(memCache);
        return memCache;
      }
    } catch (migErr: any) {
      console.warn('[Store] Ошибка миграции legacy хранилища:', migErr.message);
    }
  }

  // 3. Fallback to empty clean initial data
  memCache = {
    calls: [],
    logs: [
      {
        id: 'log-1',
        timestamp: new Date().toISOString(),
        type: 'info',
        module: 'security',
        message: 'Инициализировано зашифрованное хранилище AES-256-GCM в соответствии с 152-ФЗ',
      },
    ],
    access_log: [],
    users: getInitialUsers(),
    config: DEFAULT_CONFIG,
  };

  await writeStore(memCache);
  return memCache;
}

let writeQueue = Promise.resolve();

export async function writeStore(data: AppDatabase): Promise<void> {
  // Ensure consents are bundled in the database payload so they never get lost
  const cs = readConsentStoreSync();
  if (cs.consents && cs.consents.length > 0) {
    data.consents = cs.consents;
  }

  // Always deduplicate calls before saving to memCache or disk
  if (Array.isArray(data.calls)) {
    data.calls = deduplicateCalls(data.calls);
  }

  memCache = data;
  const dir = path.dirname(DATA_PATH_ENC);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Chain writes sequentially to prevent file write collisions
  writeQueue = writeQueue.then(async () => {
    // Sort calls newest first
    if (Array.isArray(data.calls)) {
      data.calls = deduplicateCalls(data.calls);
      data.calls.sort((a, b) => {
        const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return timeB - timeA;
      });
    }

    const jsonStr = JSON.stringify(data, null, 2);
    const payload = encrypt(jsonStr);
    const encStr = JSON.stringify(payload, null, 2);

    // Atomic write for DATA_PATH_ENC
    const tmpEnc = `${DATA_PATH_ENC}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await fs.writeFile(tmpEnc, encStr, 'utf-8');
    await fs.rename(tmpEnc, DATA_PATH_ENC);

    // Atomic write for backup mirror
    try {
      const backupMirror = path.join(dir, 'data-store.backup.json');
      const tmpBak = `${backupMirror}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await fs.writeFile(tmpBak, jsonStr, 'utf-8');
      await fs.rename(tmpBak, backupMirror);
    } catch (err: any) {
      console.warn('[Store] Предупреждение: не удалось обновить backup mirror:', err.message);
    }
  }).catch(err => {
    console.error('[Store] Критическая ошибка записи базы данных:', err);
  });

  await writeQueue;
}
