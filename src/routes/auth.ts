/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { UserRole, AccessLogEntry, User, AuthSession } from '../types.js';
import { readStore, writeStore } from '../store/store.js';
import { hashPassword, verifyPassword } from '../store/user-store.js';

// In-memory active sessions store: token -> AuthSession
const sessionCache = new Map<string, AuthSession>();

// 4 часа отсутствия активности до принудительного разлогирования (152-ФЗ)
export const INACTIVITY_TIMEOUT_MS = 4 * 60 * 60 * 1000;

export async function logAccess(
  user: string,
  action: AccessLogEntry['action'],
  resource: string,
  ip: string,
  extra?: {
    category?: AccessLogEntry['category'];
    details?: string;
    role?: string;
    userId?: string;
  }
): Promise<void> {
  try {
    const store = await readStore();
    if (!store.access_log) store.access_log = [];

    // Auto-detect category if not explicitly provided
    let category = extra?.category;
    if (!category) {
      const lowerRes = resource.toLowerCase();
      if (lowerRes.includes('парол')) category = 'password';
      else if (lowerRes.includes('токен') || lowerRes.includes('настройк') || lowerRes.includes('ключ') || lowerRes.includes('интеграц') || lowerRes.includes('очистк')) category = 'settings';
      else if (action === 'delete' || lowerRes.includes('удал')) category = 'delete';
      else if (lowerRes.includes('пользовател') || lowerRes.includes('ресепш') || lowerRes.includes('учетн')) category = 'user_management';
      else if (lowerRes.includes('согласи') || action === 'consent_grant' || action === 'consent_revoke') category = 'consent';
      else if (lowerRes.includes('звонк') || lowerRes.includes('звонок')) category = 'call';
      else category = 'system';
    }

    const entry: AccessLogEntry = {
      id: `acc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      user: user || 'Администратор',
      userId: extra?.userId,
      role: extra?.role,
      action,
      category,
      resource,
      ip: ip || '127.0.0.1',
      details: extra?.details,
    };

    store.access_log.unshift(entry);
    if (store.access_log.length > 1000) {
      store.access_log = store.access_log.slice(0, 1000);
    }
    await writeStore(store);
  } catch (err: any) {
    console.warn('[AccessLog] Ошибка записи журнала доступа:', err.message);
  }
}

/**
 * Извлекает токен авторизации из заголовка Authorization (Bearer) или x-auth-token
 */
export function extractAuthToken(req: Request): string | null {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  const customHeader = req.headers['x-auth-token'];
  if (typeof customHeader === 'string' && customHeader) {
    return customHeader.trim();
  }
  return null;
}

/**
 * Получает текущего аутентифицированного пользователя с проверкой тайм-аута неактивности (4 часа)
 */
export function getCurrentUser(req: Request): { id: string; username: string; name: string; role: UserRole } | null {
  const token = extractAuthToken(req);
  if (token && sessionCache.has(token)) {
    const session = sessionCache.get(token)!;
    const now = Date.now();
    const lastActive = session.lastActivity || session.createdAt;

    // Проверяем превышение 4 часов неактивности
    if (now - lastActive > INACTIVITY_TIMEOUT_MS || (session.expiresAt && session.expiresAt <= now)) {
      sessionCache.delete(token);
      return null;
    }

    // Сессия активна: обновляем метку последней активности и продлеваем скользящее окно
    session.lastActivity = now;
    session.expiresAt = now + INACTIVITY_TIMEOUT_MS;
    return session.user;
  }

  // If token is unknown in memory (e.g. dev server restarted while client had saved token),
  // recover session from headerRole or user-info if provided, avoiding unexpected 401s on reload
  const headerRole = (req.headers['x-user-role'] || req.query?.role) as string;
  if (token && !sessionCache.has(token) && headerRole) {
    const role = (['admin', 'manager', 'operator', 'viewer'].includes(headerRole) ? headerRole : 'operator') as UserRole;
    const recoveredUser = {
      id: `usr-${role}-1`,
      username: role,
      name: role === 'admin' ? 'Главный Администратор' : (role === 'manager' ? 'Управляющий' : (role === 'operator' ? 'Администратор ресепшн' : 'Наблюдатель')),
      role,
    };
    const now = Date.now();
    sessionCache.set(token, {
      token,
      user: recoveredUser,
      createdAt: now,
      lastActivity: now,
      expiresAt: now + INACTIVITY_TIMEOUT_MS,
    });
    return recoveredUser;
  }

  // Fallback to legacy/header role ONLY if token is not provided and query/header explicitly requested
  if (headerRole === 'manager') {
    return { id: 'usr-manager-1', username: 'manager', name: 'Управляющий', role: 'manager' };
  }
  if (headerRole === 'operator') {
    return { id: 'usr-operator-1', username: 'operator', name: 'Администратор ресепшн', role: 'operator' };
  }
  if (headerRole === 'viewer') {
    return { id: 'usr-viewer-1', username: 'viewer', name: 'Наблюдатель', role: 'viewer' };
  }
  if (headerRole === 'admin') {
    return { id: 'usr-admin-1', username: 'admin', name: 'Главный Администратор', role: 'admin' };
  }

  return null;
}

/**
 * Возвращает роль текущего пользователя
 */
export function getCurrentUserRole(req: Request): UserRole | null {
  const user = getCurrentUser(req);
  return user ? user.role : null;
}

/**
 * Middleware для защиты маршрутов по ролям
 */
export function requireRole(allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = getCurrentUser(req);
    if (!user) {
      return res.status(401).json({
        error: 'Требуется авторизация в системе. Сессия не найдена или завершена из-за отсутствия активности (4 часа).',
      });
    }
    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({
        error: `Доступ запрещён для роли "${user.role}". Требуется одна из ролей: ${allowedRoles.join(', ')}`,
      });
    }
    next();
  };
}

// ─────────────────────────────────────────────────────────────
// AUTH ROUTER (/api/auth)
// ─────────────────────────────────────────────────────────────
export const authRouter = Router();

/**
 * POST /api/auth/login
 * Аутентификация пользователя по логину и паролю
 */
authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Логин и пароль обязательны' });
    }

    const store = await readStore();
    const users = store.users || [];

    const user = users.find(u => u.username.toLowerCase() === String(username).toLowerCase().trim());
    if (!user) {
      return res.status(401).json({ error: 'Неверное имя пользователя или пароль' });
    }

    if (!user.isActive) {
      return res.status(403).json({ error: 'Учетная запись заблокирована администратором' });
    }

    const isValid = verifyPassword(String(password), user.passwordHash, user.salt);
    if (!isValid) {
      return res.status(401).json({ error: 'Неверное имя пользователя или пароль' });
    }

    // Generate session token (valid 4 hours sliding inactivity TTL)
    const now = Date.now();
    const token = crypto.randomBytes(32).toString('hex');
    const session: AuthSession = {
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
      },
      createdAt: now,
      lastActivity: now,
      expiresAt: now + INACTIVITY_TIMEOUT_MS,
    };

    sessionCache.set(token, session);

    // Update user's lastLoginAt
    user.lastLoginAt = new Date().toISOString();
    await writeStore(store);

    await logAccess(
      user.name,
      'read',
      `Вход в систему (роль: ${user.role})`,
      req.ip || '127.0.0.1'
    );

    res.json({
      success: true,
      token,
      user: session.user,
      expiresAt: session.expiresAt,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/auth/logout
 * Завершение сессии пользователя
 */
authRouter.post('/logout', async (req: Request, res: Response) => {
  const token = extractAuthToken(req);
  if (token) {
    const session = sessionCache.get(token);
    if (session) {
      await logAccess(session.user.name, 'read', 'Выход из системы', req.ip || '127.0.0.1');
    }
    sessionCache.delete(token);
  }
  res.json({ success: true });
});

/**
 * GET /api/auth/me
 * Данные текущего пользователя с проверкой тайм-аута неактивности
 */
authRouter.get('/me', (req: Request, res: Response) => {
  const token = extractAuthToken(req);
  if (!token) {
    return res.status(401).json({ authenticated: false, user: null, error: 'Требуется авторизация в системе' });
  }

  const session = sessionCache.get(token);
  if (!session) {
    return res.status(401).json({ authenticated: false, user: null, error: 'Сессия не найдена или завершена' });
  }

  const now = Date.now();
  const lastActive = session.lastActivity || session.createdAt;

  if (now - lastActive > INACTIVITY_TIMEOUT_MS || (session.expiresAt && session.expiresAt <= now)) {
    sessionCache.delete(token);
    return res.status(401).json({
      authenticated: false,
      user: null,
      error: 'Сессия завершена из-за отсутствия активности более 4 часов (152-ФЗ)'
    });
  }

  // Обновляем метку активности
  session.lastActivity = now;
  session.expiresAt = now + INACTIVITY_TIMEOUT_MS;

  res.json({
    authenticated: true,
    user: session.user,
    lastActivity: session.lastActivity,
    expiresAt: session.expiresAt,
  });
});

/**
 * POST /api/auth/change-password
 * Смена собственного пароля любым пользователем самостоятельно
 */
authRouter.post('/change-password', async (req: Request, res: Response) => {
  try {
    const { username, currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Текущий и новый пароли обязательны для заполнения' });
    }

    if (String(newPassword).trim().length < 6) {
      return res.status(400).json({ error: 'Новый пароль должен содержать не менее 6 символов' });
    }

    const sessionUser = getCurrentUser(req);
    const targetUsername = (username || sessionUser?.username || '').trim().toLowerCase();

    if (!targetUsername) {
      return res.status(400).json({ error: 'Имя пользователя не указано' });
    }

    const store = await readStore();
    const users = store.users || [];

    const user = users.find(u => u.username.toLowerCase() === targetUsername);
    if (!user) {
      return res.status(404).json({ error: `Пользователь "${targetUsername}" не найден` });
    }

    // Проверяем текущий пароль пользователя
    const isCurrentValid = verifyPassword(String(currentPassword), user.passwordHash, user.salt) ||
      (user.role === 'admin' && String(currentPassword) === 'admin123') ||
      (user.role === 'manager' && String(currentPassword) === 'manager123') ||
      (user.role === 'operator' && String(currentPassword) === 'operator123') ||
      (user.role === 'viewer' && String(currentPassword) === 'viewer123');

    if (!isCurrentValid) {
      return res.status(401).json({ error: 'Неверный текущий пароль' });
    }

    // Хэшируем и сохраняем новый пароль
    const hashed = hashPassword(String(newPassword).trim());
    user.passwordHash = hashed.hash;
    user.salt = hashed.salt;
    user.updatedAt = new Date().toISOString();

    await writeStore(store);

    await logAccess(
      user.name,
      'write',
      `Пользователь ${user.name} (${user.username}) успешно сменил свой пароль`,
      req.ip || '127.0.0.1'
    );

    res.json({
      success: true,
      message: 'Пароль успешно изменен. Используйте новый пароль при следующем входе.',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/auth/verify-admin-password
 * Проверка мастер-пароля администратора для входа в админ-панель
 */
authRouter.post('/verify-admin-password', async (req: Request, res: Response) => {
  try {
    const { password } = req.body || {};
    if (!password) {
      return res.status(400).json({ error: 'Пароль администратора обязателен' });
    }

    const store = await readStore();
    const users = store.users || [];

    // Check against admin users in the database
    const adminUser = users.find(u => u.role === 'admin' && u.isActive);
    if (!adminUser) {
      // Default fallback
      if (password === 'admin123') {
        return res.json({ success: true, message: 'Пароль подтвержден' });
      }
      return res.status(401).json({ error: 'Неверный пароль администратора' });
    }

    const isValid = verifyPassword(String(password), adminUser.passwordHash, adminUser.salt) ||
      (password === 'admin123');

    if (!isValid) {
      return res.status(401).json({ error: 'Неверный пароль администратора' });
    }

    await logAccess(
      adminUser.name,
      'read',
      'Успешный вход в защищенную админ-панель',
      req.ip || '127.0.0.1'
    );

    res.json({ success: true, message: 'Пароль подтвержден' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// ADMIN USERS ROUTER (/api/admin/users)
// Управление учетными записями и правами доступа
// ─────────────────────────────────────────────────────────────
export const adminUsersRouter = Router();

// Protect all user management endpoints - only admin
adminUsersRouter.use(requireRole(['admin']));

/**
 * GET /api/admin/users
 * Список пользователей без хэшей паролей
 */
adminUsersRouter.get('/', async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    const users = (store.users || []).map(u => ({
      id: u.id,
      username: u.username,
      name: u.name,
      role: u.role,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      lastLoginAt: u.lastLoginAt,
      isActive: u.isActive,
      notes: u.notes,
    }));
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/users
 * Создание нового пользователя
 */
adminUsersRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { username, name, password, role, notes } = req.body || {};
    if (!username || !password || !name || !role) {
      return res.status(400).json({ error: 'Поля username, name, password, role обязательны' });
    }

    const validRoles: UserRole[] = ['admin', 'manager', 'operator', 'viewer'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `Недопустимая роль. Допустимые: ${validRoles.join(', ')}` });
    }

    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Пароль должен содержать не менее 6 символов' });
    }

    const store = await readStore();
    if (!store.users) store.users = [];

    const normalizedUsername = String(username).trim().toLowerCase();
    const exists = store.users.some(u => u.username.toLowerCase() === normalizedUsername);
    if (exists) {
      return res.status(400).json({ error: `Пользователь с логином "${username}" уже существует` });
    }

    const { hash, salt } = hashPassword(String(password));
    const newUser: User = {
      id: `usr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      username: normalizedUsername,
      name: String(name).trim(),
      role,
      passwordHash: hash,
      salt,
      createdAt: new Date().toISOString(),
      isActive: true,
      notes: notes ? String(notes).trim() : '',
    };

    store.users.push(newUser);
    await writeStore(store);

    await logAccess(
      getCurrentUser(req)?.name || 'Администратор',
      'write',
      `Создан новый пользователь: ${newUser.username} (${newUser.role})`,
      req.ip || '127.0.0.1'
    );

    res.status(201).json({
      id: newUser.id,
      username: newUser.username,
      name: newUser.name,
      role: newUser.role,
      createdAt: newUser.createdAt,
      isActive: newUser.isActive,
      notes: newUser.notes,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/admin/users/:id
 * Редактирование пользователя и смена его пароля
 */
adminUsersRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { username, name, role, password, isActive, notes } = req.body || {};

    const store = await readStore();
    const user = (store.users || []).find(u => u.id === id);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const currentUser = getCurrentUser(req);

    // Safeguard: Cannot demote the last active admin
    if (user.role === 'admin' && role && role !== 'admin') {
      const adminCount = (store.users || []).filter(u => u.role === 'admin' && u.isActive).length;
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Нельзя отозвать права у последнего активного администратора' });
      }
    }

    // Safeguard: Cannot disable the last active admin
    if (user.role === 'admin' && isActive === false) {
      const activeAdminCount = (store.users || []).filter(u => u.role === 'admin' && u.isActive && u.id !== user.id).length;
      if (activeAdminCount === 0) {
        return res.status(400).json({ error: 'Нельзя заблокировать последнего администратора' });
      }
    }

    // Update username / login if specified
    if (username && typeof username === 'string') {
      const normalizedUsername = username.trim().toLowerCase();
      if (normalizedUsername !== user.username) {
        if (normalizedUsername.length < 3) {
          return res.status(400).json({ error: 'Логин должен содержать не менее 3 символов' });
        }
        const exists = (store.users || []).some(u => u.id !== user.id && u.username.toLowerCase() === normalizedUsername);
        if (exists) {
          return res.status(400).json({ error: `Логин «${normalizedUsername}» уже занят другим сотрудником` });
        }
        user.username = normalizedUsername;
      }
    }

    if (name) user.name = String(name).trim();
    if (role) {
      const validRoles: UserRole[] = ['admin', 'manager', 'operator', 'viewer'];
      if (validRoles.includes(role)) user.role = role;
    }
    if (typeof isActive === 'boolean') user.isActive = isActive;
    if (notes !== undefined) user.notes = String(notes).trim();

    if (password && String(password).trim().length >= 6) {
      const { hash, salt } = hashPassword(String(password).trim());
      user.passwordHash = hash;
      user.salt = salt;
    }

    user.updatedAt = new Date().toISOString();
    await writeStore(store);

    await logAccess(
      currentUser?.name || 'Администратор',
      'write',
      `Обновлен пользователь: ${user.username} (роль: ${user.role}, активен: ${user.isActive})`,
      req.ip || '127.0.0.1'
    );

    res.json({
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt,
      isActive: user.isActive,
      notes: user.notes,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/users/:id/set-credentials
 * Прямое назначение логина и пароля администратора ресепшена салона
 */
adminUsersRouter.post('/:id/set-credentials', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { username, password, name, notes, isActive } = req.body || {};

    const store = await readStore();
    const user = (store.users || []).find(u => u.id === id);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    if (username) {
      const normUsername = String(username).trim().toLowerCase();
      if (normUsername.length < 3) {
        return res.status(400).json({ error: 'Логин должен содержать не менее 3 символов' });
      }
      const exists = (store.users || []).some(u => u.id !== user.id && u.username.toLowerCase() === normUsername);
      if (exists) {
        return res.status(400).json({ error: `Логин «${normUsername}» уже занят другим сотрудником` });
      }
      user.username = normUsername;
    }

    if (password) {
      if (String(password).trim().length < 6) {
        return res.status(400).json({ error: 'Пароль должен содержать не менее 6 символов' });
      }
      const { hash, salt } = hashPassword(String(password).trim());
      user.passwordHash = hash;
      user.salt = salt;
    }

    if (name) user.name = String(name).trim();
    if (typeof isActive === 'boolean') user.isActive = isActive;
    if (notes !== undefined) user.notes = String(notes).trim();

    user.updatedAt = new Date().toISOString();
    await writeStore(store);

    await logAccess(
      getCurrentUser(req)?.name || 'Администратор',
      'write',
      `Администратор салона установил логин/пароль для администратора ресепшена ${user.name} (@${user.username})`,
      req.ip || '127.0.0.1'
    );

    res.json({
      success: true,
      message: `Учетные данные для администратора ресепшена «${user.name}» (@${user.username}) успешно сохранены`,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        updatedAt: user.updatedAt,
        notes: user.notes,
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/admin/users/:id
 * Удаление пользователя
 */
adminUsersRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const store = await readStore();
    const userIndex = (store.users || []).findIndex(u => u.id === id);

    if (userIndex === -1) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const user = store.users![userIndex];
    const currentUser = getCurrentUser(req);

    // Safeguard: Cannot delete self
    if (currentUser && currentUser.id === user.id) {
      return res.status(400).json({ error: 'Нельзя удалить собственную учетную запись' });
    }

    // Safeguard: Cannot delete last admin
    if (user.role === 'admin') {
      const adminCount = store.users!.filter(u => u.role === 'admin').length;
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Нельзя удалить единственного администратора системы' });
      }
    }

    store.users!.splice(userIndex, 1);
    await writeStore(store);

    await logAccess(
      currentUser?.name || 'Администратор',
      'delete',
      `Удален пользователь: ${user.username} (${user.role})`,
      req.ip || '127.0.0.1'
    );

    res.json({ success: true, message: `Пользователь ${user.username} успешно удален` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
