import type { Context, NextFunction } from 'grammy';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

/**
 * Пропускает дальше только пользователей из ALLOWED_USER_IDS.
 * Пустой список = allowlist выключен (бот открыт всем) — предупреждение пишется на старте.
 */
export async function allowlist(ctx: Context, next: NextFunction): Promise<void> {
  const allowed = config.ALLOWED_USER_IDS;
  if (allowed.length === 0) {
    return next();
  }

  const userId = ctx.from?.id;
  if (userId !== undefined && allowed.includes(userId)) {
    return next();
  }

  // Логируем реальный id отказа — удобно, чтобы добавить себя в список.
  logger.warn({ userId, username: ctx.from?.username }, 'доступ запрещён (не в allowlist)');
  await ctx.reply('⛔ Доступ ограничен: бот приватный.');
}
