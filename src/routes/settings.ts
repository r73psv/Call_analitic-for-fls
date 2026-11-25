/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, Request, Response } from 'express';
import { readStore, writeStore } from '../store/store.js';
import { requireRole, getCurrentUser, logAccess } from './auth.js';
import { GigaChatModel, SttProvider, GigaamModelVariant } from '../types.js';
import { getDefaultSystemPrompt, getCrmMastersWithSource } from '../services/gigachat.js';
import { resolveActiveSttProvider } from '../services/transcriptionService.js';
import { isYandexAuthConfigured } from '../services/yandex-auth.js';
import { isTbankVoiceKitConfigured } from '../services/tbank-voicekit.js';
import { getGigaAmConfig, isGigaAmConfigured, normalizeGigaamVariant } from '../services/gigaam-asr.js';
import { isGigaChatConfigured } from '../services/gigachat-auth.js';
import { getEnvValue, persistServerEnvVars } from '../services/serverEnv.js';
import { resolveSalonName } from '../services/salonBranding.js';
import { buildStaffPerformanceReport } from '../services/administratorIdentity.js';

export const settingsRouter = Router();

// GET /api/settings
settingsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    const defaultModel = store.config.default_gigachat_model || (process.env.GIGACHAT_DEFAULT_MODEL as GigaChatModel) || 'GigaChat:Ultra';
    const salonName = resolveSalonName({
      envSalonName: getEnvValue('SALON_NAME'),
      configSalonName: store.config.salonName,
      credentialsSalonName: store.config.credentials?.salonName,
    });
    const { list: crmMasters } = await getCrmMastersWithSource();
    const defaultPrompt = getDefaultSystemPrompt(salonName, crmMasters);
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
    const salonName = resolveSalonName({
      envSalonName: getEnvValue('SALON_NAME'),
      configSalonName: store.config.salonName,
      credentialsSalonName: store.config.credentials?.salonName,
    });
    const { list: crmMasters } = await getCrmMastersWithSource();
    const defaultPrompt = getDefaultSystemPrompt(salonName, crmMasters);
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

    const salonName = resolveSalonName({
      envSalonName: getEnvValue('SALON_NAME'),
      configSalonName: store.config.salonName,
      credentialsSalonName: store.config.credentials?.salonName,
    });
    const { list: crmMasters } = await getCrmMastersWithSource();
    const defaultPrompt = getDefaultSystemPrompt(salonName, crmMasters);

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

    const salonName = resolveSalonName({
      envSalonName: getEnvValue('SALON_NAME'),
      configSalonName: store.config.salonName,
      credentialsSalonName: store.config.credentials?.salonName,
    });
    const { list: crmMasters } = await getCrmMastersWithSource();
    const defaultPrompt = getDefaultSystemPrompt(salonName, crmMasters);

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
      if (!store.config.credentials) store.config.credentials = {};
      store.config.credentials.salonName = cleanSalonName;
      persistServerEnvVars({ SALON_NAME: cleanSalonName });
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
      salonName: resolveSalonName({
        envSalonName: getEnvValue('SALON_NAME'),
        configSalonName: store.config.salonName,
        credentialsSalonName: store.config.credentials?.salonName,
      }),
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
// Эффективность администраторов строго по имени, которым они представляются в начале разговора
settingsRouter.get('/staff-performance', requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const { period = 'all', startDate, endDate } = req.query;
    const store = await readStore();
    const allCalls = store.calls || [];

    const report = buildStaffPerformanceReport(allCalls, {
      period: String(period || 'all'),
      startDate: startDate ? String(startDate) : undefined,
      endDate: endDate ? String(endDate) : undefined,
    });

    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
