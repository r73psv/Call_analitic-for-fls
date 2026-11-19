/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, Request, Response } from 'express';
import { readStore, writeStore } from '../store/store.js';
import { requireRole, getCurrentUser, logAccess } from './auth.js';
import { GigaChatModel, SttProvider, GigaamModelVariant } from '../types.js';
import { getDefaultSystemPrompt } from '../services/gigachat.js';
import { resolveActiveSttProvider } from '../services/transcriptionService.js';
import { isYandexAuthConfigured } from '../services/yandex-auth.js';
import { isTbankVoiceKitConfigured } from '../services/tbank-voicekit.js';
import { getGigaAmConfig, isGigaAmConfigured, normalizeGigaamVariant } from '../services/gigaam-asr.js';
import { isGigaChatConfigured } from '../services/gigachat-auth.js';

export const settingsRouter = Router();

// GET /api/settings
settingsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    const defaultModel = store.config.default_gigachat_model || (process.env.GIGACHAT_DEFAULT_MODEL as GigaChatModel) || 'GigaChat:Lite';
    const salonName = store.config.salonName || process.env.SALON_NAME || 'Fashion Look Studio';
    const defaultPrompt = getDefaultSystemPrompt(salonName);
    const transcriptionModel = resolveActiveSttProvider();
    const gigaamCfg = getGigaAmConfig();
    res.json({
      salonName,
      default_gigachat_model: defaultModel,
      activeModel: defaultModel,
      transcriptionModel,
      gigaamVariant: gigaamCfg.variant,
      encryption_active: true,
      customSystemPrompt: store.config.customSystemPrompt || store.config.credentials?.customSystemPrompt || '',
      defaultSystemPrompt: defaultPrompt,
      yandex_speechkit_configured: isYandexAuthConfigured(),
      tbank_voicekit_configured: isTbankVoiceKitConfigured(),
      gigaam_v3_configured: isGigaAmConfigured(),
      gigachat_configured: isGigaChatConfigured(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/system-prompt (Admin & Manager)
settingsRouter.get('/system-prompt', requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    const salonName = store.config.salonName || store.config.credentials?.salonName || process.env.SALON_NAME || 'Fashion Look Studio';
    const defaultPrompt = getDefaultSystemPrompt(salonName);
    const customPrompt = store.config.customSystemPrompt || store.config.credentials?.customSystemPrompt || '';
    res.json({
      success: true,
      salonName,
      customSystemPrompt: customPrompt,
      defaultSystemPrompt: defaultPrompt,
      isCustomActive: customPrompt.trim().length > 0,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/system-prompt (Admin & Manager)
settingsRouter.post('/system-prompt', requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const { customSystemPrompt } = req.body || {};
    const store = await readStore();
    const cleanPrompt = customSystemPrompt !== undefined ? String(customSystemPrompt).trim() : '';

    store.config.customSystemPrompt = cleanPrompt;
    if (!store.config.credentials) store.config.credentials = {};
    store.config.credentials.customSystemPrompt = cleanPrompt;

    await writeStore(store);

    const currentUser = getCurrentUser(req);
    const actorName = currentUser?.name || (currentUser?.role === 'manager' ? 'Управляющий' : 'Администратор');
    const roleTitle = currentUser?.role === 'manager' ? 'управляющим' : 'администратором';

    await logAccess(
      actorName,
      'write',
      `Системный промпт ИИ (GigaChat) обновлен ${roleTitle}`,
      req.ip || '127.0.0.1',
      {
        category: 'settings',
        details: cleanPrompt ? `Пользовательский промпт сохранен (${cleanPrompt.length} симв.)` : 'Установлен пустой промпт (активирован эталонный промпт)',
        role: currentUser?.role || 'manager',
        userId: currentUser?.id,
      }
    );

    const salonName = store.config.salonName || store.config.credentials?.salonName || process.env.SALON_NAME || 'Fashion Look Studio';
    const defaultPrompt = getDefaultSystemPrompt(salonName);

    res.json({
      success: true,
      message: 'Системный промпт ИИ успешно сохранён и применён для анализа звонков',
      customSystemPrompt: store.config.customSystemPrompt,
      defaultSystemPrompt: defaultPrompt,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/system-prompt/reset (Admin & Manager)
settingsRouter.post('/system-prompt/reset', requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    store.config.customSystemPrompt = '';
    if (store.config.credentials) {
      store.config.credentials.customSystemPrompt = '';
    }
    await writeStore(store);

    const currentUser = getCurrentUser(req);
    const actorName = currentUser?.name || (currentUser?.role === 'manager' ? 'Управляющий' : 'Администратор');
    const roleTitle = currentUser?.role === 'manager' ? 'управляющим' : 'администратором';

    await logAccess(
      actorName,
      'write',
      `Системный промпт ИИ (GigaChat) сброшен к эталону по умолчанию ${roleTitle}`,
      req.ip || '127.0.0.1',
      {
        category: 'settings',
        details: 'Системный промпт сброшен к заводскому эталону',
        role: currentUser?.role || 'manager',
        userId: currentUser?.id,
      }
    );

    const salonName = store.config.salonName || store.config.credentials?.salonName || process.env.SALON_NAME || 'Fashion Look Studio';
    const defaultPrompt = getDefaultSystemPrompt(salonName);

    res.json({
      success: true,
      message: 'Системный промпт успешно сброшен к эталонному значению',
      defaultSystemPrompt: defaultPrompt,
      customSystemPrompt: '',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings (Admin & Manager for prompt and salonName; only admin for default_gigachat_model)
settingsRouter.put('/', requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const { default_gigachat_model, transcriptionModel, gigaamVariant, salonName, customSystemPrompt } = req.body;
    if (
      !default_gigachat_model &&
      !transcriptionModel &&
      !gigaamVariant &&
      salonName === undefined &&
      customSystemPrompt === undefined
    ) {
      return res.status(400).json({ error: 'Необходимо указать параметры настроек для обновления' });
    }

    const currentUser = getCurrentUser(req);
    const userRole = currentUser?.role || 'operator';

    // Model change is restricted to admin
    if ((default_gigachat_model || transcriptionModel || gigaamVariant) && userRole !== 'admin') {
      return res.status(403).json({ error: 'Изменение моделей ИИ и транскрибации разрешено только администратору' });
    }

    const store = await readStore();

    if (default_gigachat_model) {
      const validModels: GigaChatModel[] = ['GigaChat:Lite', 'GigaChat:Pro', 'GigaChat:Max', 'GigaChat:Ultra'];
      if (!validModels.includes(default_gigachat_model)) {
        return res.status(400).json({ error: `Недопустимая модель. Допустимые: ${validModels.join(', ')}` });
      }
      store.config.default_gigachat_model = default_gigachat_model;
      store.config.activeModel = default_gigachat_model;
    }

    if (transcriptionModel) {
      const validStt: SttProvider[] = ['yandex_speechkit', 'tbank_voicekit', 'gigaam_v3'];
      if (!validStt.includes(transcriptionModel)) {
        return res.status(400).json({ error: `Недопустимая модель транскрибации. Допустимые: ${validStt.join(', ')}` });
      }
      store.config.transcriptionModel = transcriptionModel;
      if (!store.config.credentials) store.config.credentials = {};
      store.config.credentials.transcriptionModel = transcriptionModel;
      process.env.STT_PROVIDER = transcriptionModel;
    }

    if (gigaamVariant) {
      const validVariants: GigaamModelVariant[] = [
        'GigaChat/GigaASR',
        'GigaChat/SaluteSpeech',
        'openai/whisper-large-v3',
        'sber/GigaASR',
        'e2e_rnnt',
        'e2e_ctc',
        'rnnt',
        'ctc',
      ];
      if (!validVariants.includes(gigaamVariant)) {
        return res.status(400).json({ error: `Недопустимый вариант GigaASR / GigaAM v3. Допустимые: ${validVariants.join(', ')}` });
      }
      if (!store.config.credentials) store.config.credentials = {};
      store.config.credentials.gigaamVariant = normalizeGigaamVariant(gigaamVariant);
      process.env.GIGAAM_MODEL_VARIANT = store.config.credentials.gigaamVariant;
    }

    if (salonName !== undefined) {
      const cleanSalonName = String(salonName).trim();
      if (!cleanSalonName) {
        return res.status(400).json({ error: 'Название салона красоты не может быть пустым' });
      }
      store.config.salonName = cleanSalonName;
      process.env.SALON_NAME = cleanSalonName;
      if (!store.config.credentials) store.config.credentials = {};
      store.config.credentials.salonName = cleanSalonName;
    }

    if (customSystemPrompt !== undefined) {
      const cleanPrompt = String(customSystemPrompt).trim();
      store.config.customSystemPrompt = cleanPrompt;
      if (!store.config.credentials) store.config.credentials = {};
      store.config.credentials.customSystemPrompt = cleanPrompt;

      const actorName = currentUser?.name || (userRole === 'manager' ? 'Управляющий' : 'Администратор');
      await logAccess(
        actorName,
        'write',
        `Системный промпт ИИ изменен пользователем ${actorName} (роль: ${userRole})`,
        req.ip || '127.0.0.1',
        {
          category: 'settings',
          details: cleanPrompt ? `Обновлен текст системного промпта (${cleanPrompt.length} симв.)` : 'Сброшен к пустому значению',
          role: userRole,
          userId: currentUser?.id,
        }
      );
    }

    await writeStore(store);

    res.json({
      success: true,
      salonName: store.config.salonName || 'Fashion Look Studio',
      default_gigachat_model: store.config.default_gigachat_model,
      transcriptionModel: resolveActiveSttProvider(),
      gigaamVariant: getGigaAmConfig().variant,
      customSystemPrompt: store.config.customSystemPrompt || '',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/staff-performance (accessible by admin and manager)
settingsRouter.get('/staff-performance', requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const { period = 'all', startDate, endDate } = req.query;
    const store = await readStore();
    const allCalls = store.calls || [];
    const allUsers = store.users || [];

    // Time boundaries calculation
    const now = new Date();
    let filterStart: number | null = null;
    let filterEnd: number | null = null;

    if (period === 'today') {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      filterStart = todayStart.getTime();
      filterEnd = now.getTime();
    } else if (period === '7days') {
      filterStart = now.getTime() - 7 * 24 * 3600 * 1000;
      filterEnd = now.getTime();
    } else if (period === 'this_month') {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      filterStart = monthStart.getTime();
      filterEnd = now.getTime();
    } else if (period === '30days') {
      filterStart = now.getTime() - 30 * 24 * 3600 * 1000;
      filterEnd = now.getTime();
    } else if (period === 'custom' && startDate) {
      filterStart = new Date(String(startDate)).getTime();
      filterEnd = endDate ? new Date(String(endDate)).getTime() + 24 * 3600 * 1000 : now.getTime();
    }

    const periodCalls = allCalls.filter(c => {
      if (!c.timestamp) return false;
      const callTime = new Date(c.timestamp).getTime();
      if (filterStart && callTime < filterStart) return false;
      if (filterEnd && callTime > filterEnd) return false;
      return true;
    });

    const receptionUsers = allUsers.filter(u => u.role === 'operator');
    const detectedNames = new Set<string>();
    for (const c of periodCalls) {
      const op = c.operator_name || c.key_facts?.master;
      if (op && typeof op === 'string' && op.trim() && !op.toLowerCase().includes('автоответчик') && !op.toLowerCase().includes('робот')) {
        detectedNames.add(op.trim());
      }
    }

    const staffList: any[] = [];
    for (const u of receptionUsers) {
      const uNorm = u.name.toLowerCase().trim();
      const userCalls = periodCalls.filter(c => {
        const op = (c.operator_name || c.key_facts?.master || '').toLowerCase().trim();
        return op === uNorm || op.includes(uNorm) || uNorm.includes(op);
      });

      const totalCalls = userCalls.length;
      const scoredCalls = userCalls.filter(c => {
        const sc = c.key_facts?.evaluation?.overall_score ?? c.operator_score;
        return typeof sc === 'number' && !isNaN(sc) && sc > 0;
      });

      const averageScore = scoredCalls.length > 0
        ? Math.round((scoredCalls.reduce((acc, c) => acc + (c.key_facts?.evaluation?.overall_score ?? c.operator_score ?? 0), 0) / scoredCalls.length) * 10) / 10
        : null;

      const starsScore = averageScore !== null ? Math.round((averageScore / 2) * 10) / 10 : null;
      const bookingsCount = userCalls.filter(c => c.booking_status === 'согласие' || c.key_facts?.call_outcome === 'запись').length;
      const conversionRate = totalCalls > 0 ? Math.round((bookingsCount / totalCalls) * 1000) / 10 : 0;
      const consultationsCount = userCalls.filter(c => c.booking_status === 'консультация' || c.key_facts?.call_outcome === 'консультация').length;
      const refusalsCount = userCalls.filter(c => c.booking_status === 'отказ' || c.key_facts?.call_outcome === 'отказ').length;
      const disputesCount = userCalls.filter(c => c.key_facts?.is_dispute).length;

      const totalDur = userCalls.reduce((acc, c) => acc + (c.duration_seconds || 0), 0);
      const averageDurationSeconds = totalCalls > 0 ? Math.round(totalDur / totalCalls) : 0;

      const recentCalls = userCalls
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 5)
        .map(c => ({
          call_id: c.call_id,
          timestamp: c.timestamp,
          client_name: c.client_name,
          client_phone_masked: c.client_phone_masked,
          duration_seconds: c.duration_seconds,
          score: c.key_facts?.evaluation?.overall_score ?? c.operator_score,
          call_outcome: c.key_facts?.call_outcome || 'консультация',
          booking_status: c.booking_status,
          summary: c.summary,
        }));

      staffList.push({
        id: u.id,
        username: u.username,
        name: u.name,
        role: u.role,
        isActive: u.isActive,
        isOnline: u.isActive,
        lastLoginAt: u.lastLoginAt,
        notes: u.notes,
        totalCalls,
        averageScore,
        starsScore,
        bookingsCount,
        conversionRate,
        consultationsCount,
        refusalsCount,
        disputesCount,
        averageDurationSeconds,
        criteriaAverages: {},
        recentCalls,
      });
    }

    const totalStaffCalls = staffList.reduce((acc, s) => acc + s.totalCalls, 0);
    const totalStaffBookings = staffList.reduce((acc, s) => acc + s.bookingsCount, 0);
    const validScores = staffList.filter(s => s.averageScore !== null).map(s => s.averageScore!);
    const salonAverageScore = validScores.length > 0
      ? Math.round((validScores.reduce((a, b) => a + b, 0) / validScores.length) * 10) / 10
      : null;
    const salonConversionRate = totalStaffCalls > 0
      ? Math.round((totalStaffBookings / totalStaffCalls) * 1000) / 10
      : 0;

    res.json({
      period,
      totalStaff: staffList.length,
      activeStaff: staffList.filter(s => s.isActive).length,
      onlineStaff: staffList.filter(s => s.isOnline).length,
      totalCallsAnalyzed: totalStaffCalls,
      salonAverageScore,
      salonConversionRate,
      staff: staffList,
      source: 'firestore_compatible_store',
      dataSourceDescription: 'Коллекции Firestore staff, calls, evaluations (защищенная БД 152-ФЗ)',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
