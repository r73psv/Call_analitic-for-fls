/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, Request, Response } from 'express';
import { readStore, writeStore } from '../store/store.js';
import { requireRole } from './auth.js';
import { GigaChatModel } from '../types.js';

export const settingsRouter = Router();

// GET /api/settings
settingsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    const defaultModel = store.config.default_gigachat_model || (process.env.GIGACHAT_DEFAULT_MODEL as GigaChatModel) || 'GigaChat:Lite';
    const salonName = store.config.salonName || process.env.SALON_NAME || 'Лик 28';
    res.json({
      salonName,
      default_gigachat_model: defaultModel,
      activeModel: defaultModel,
      encryption_active: true,
      yandex_speechkit_configured: !!process.env.YC_SERVICE_ACCOUNT_KEY_FILE,
      gigachat_configured: !!process.env.GIGACHAT_AUTH_KEY,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings
settingsRouter.put('/', requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const { default_gigachat_model, salonName } = req.body;
    if (!default_gigachat_model && salonName === undefined) {
      return res.status(400).json({ error: 'Необходимо указать default_gigachat_model или salonName' });
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

    await writeStore(store);

    res.json({
      success: true,
      salonName: store.config.salonName || 'Лик 28',
      default_gigachat_model: store.config.default_gigachat_model,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
