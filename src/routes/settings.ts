/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, Request, Response } from 'express';
import { readStore, writeStore } from '../store/store.js';
import { requireRole, getCurrentUser, logAccess } from './auth.js';
import { GigaChatModel } from '../types.js';
import { getDefaultSystemPrompt } from '../services/gigachat.js';

export const settingsRouter = Router();

// GET /api/settings
settingsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    const defaultModel = store.config.default_gigachat_model || (process.env.GIGACHAT_DEFAULT_MODEL as GigaChatModel) || 'GigaChat:Lite';
    const salonName = store.config.salonName || process.env.SALON_NAME || 'Fashion Look Studio';
    const defaultPrompt = getDefaultSystemPrompt(salonName);
    res.json({
      salonName,
      default_gigachat_model: defaultModel,
      activeModel: defaultModel,
      encryption_active: true,
      customSystemPrompt: store.config.customSystemPrompt || store.config.credentials?.customSystemPrompt || '',
      defaultSystemPrompt: defaultPrompt,
      yandex_speechkit_configured: !!process.env.YC_SERVICE_ACCOUNT_KEY_FILE,
      gigachat_configured: !!process.env.GIGACHAT_AUTH_KEY,
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
    const { default_gigachat_model, salonName, customSystemPrompt } = req.body;
    if (!default_gigachat_model && salonName === undefined && customSystemPrompt === undefined) {
      return res.status(400).json({ error: 'Необходимо указать default_gigachat_model, salonName или customSystemPrompt' });
    }

    const currentUser = getCurrentUser(req);
    const userRole = currentUser?.role || 'operator';

    // Model change is restricted to admin
    if (default_gigachat_model && userRole !== 'admin') {
      return res.status(403).json({ error: 'Изменение модели нейросети разрешено только администратору' });
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
      customSystemPrompt: store.config.customSystemPrompt || '',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
