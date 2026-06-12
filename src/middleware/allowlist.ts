import type { Context, NextFunction } from 'grammy';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

/**
 * Решение allowlist (чистая функция, без побочных эффектов — тестируется отдельно).
 * Пустой список = allowlist выключен (бот открыт всем).
 */
export function isAllowed(allowed: readonly number[], userId: number | undefined): boolean {
  if (allowed.length === 0) return true;
  return userId !== undefined && allowed.includes(userId);
}

/** Пропускает дальше только пользователей из ALLOWED_USER_IDS. */
export async function allowlist(ctx: Context, next: NextFunction): Promise<void> {
  if (isAllowed(config.ALLOWED_USER_IDS, ctx.from?.id)) {
    return next();
  }

  // Логируем реальный id отказа — удобно, чтобы добавить себя в список.
  logger.warn({ userId: ctx.from?.id, username: ctx.from?.username }, 'доступ запрещён (не в allowlist)');
  await ctx.reply('⛔ Доступ ограничен: бот приватный.');
}
