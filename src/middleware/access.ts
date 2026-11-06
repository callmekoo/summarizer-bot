import { InlineKeyboard, type Context, type NextFunction } from 'grammy';
import type { Db } from '../db/database.js';
import { touchProfile, createApplication } from '../db/users.js';
import { decideAccess, ACCESS_TEXT } from '../core/access.js';
import { displayName, displayUsername, type UserRow } from '../core/users.js';
import { escapeHtml } from '../core/formatter.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

// Доступ по заявкам: незнакомец пишет что угодно → заявка владельцу с кнопками. Решение —
// в чистой decideAccess, здесь только исполнение и побочные эффекты.

export interface AccessDeps {
  db: Db;
  adminId: number;
  now: () => number;
  /** Шлёт владельцу заявку с кнопками. Может упасть (владелец не писал боту) — не страшно. */
  notifyAdmin: (user: UserRow) => Promise<void>;
}

/** Владелец бота (ADMIN_USER_ID). Для bot.filter у админских команд и кнопок. */
export function isAdmin(ctx: Context): boolean {
  return ctx.from?.id === config.ADMIN_USER_ID;
}

/** `Новая заявка: Иван Петров (@ivanp), id 123` — Telegram-HTML. */
export function renderApplication(user: UserRow): string {
  return (
    `Новая заявка: ${escapeHtml(displayName(user))} ` +
    `(${displayUsername(user.username)}), id ${user.id}`
  );
}

export function applicationKeyboard(userId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Одобрить', `access:approve:${userId}`)
    .text('❌ Отклонить', `access:reject:${userId}`)
    .text('🚫 Забанить', `access:ban:${userId}`);
}

export function createAccess(
  deps: AccessDeps,
): (ctx: Context, next: NextFunction) => Promise<void> {
  return async (ctx, next) => {
    const from = ctx.from;
    if (!from) return; // каналы и прочие апдейты без отправителя
    if (from.id === deps.adminId) return next();

    const now = deps.now();
    let user: UserRow | undefined;
    try {
      user = touchProfile(deps.db, from);
    } catch (err) {
      return failClosed(ctx, err, from.id);
    }

    const decision = decideAccess(user, false, now);
    switch (decision.kind) {
      case 'pass':
        return next();
      case 'apply': {
        let created: UserRow;
        try {
          created = createApplication(deps.db, from, now);
        } catch (err) {
          return failClosed(ctx, err, from.id);
        }
        await ctx.reply(ACCESS_TEXT.applied);
        logger.info({ userId: from.id }, 'доступ: новая заявка');
        try {
          await deps.notifyAdmin(created);
        } catch (err) {
          // Чаще всего владелец ни разу не писал боту, и Telegram не даёт написать первым.
          // Заявка сохранена и видна в /users.
          logger.error(
            { err, userId: from.id },
            'доступ: не удалось уведомить владельца о заявке',
          );
        }
        return;
      }
      case 'pending':
        await ctx.reply(ACCESS_TEXT.pending);
        return;
      case 'rejected':
        await ctx.reply(ACCESS_TEXT.rejected(decision.until));
        return;
      case 'ignore':
        // Бан: молчим. Нажатую кнопку всё же закрываем, чтобы не крутился индикатор.
        if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});
        return;
    }
  };
}

/** Ошибка базы при проверке доступа: не пускаем, без проверки тратить деньги нельзя. */
async function failClosed(
  ctx: Context,
  err: unknown,
  userId: number,
): Promise<void> {
  logger.error({ err, userId }, 'доступ: ошибка базы, запрос отклонён');
  await ctx.reply('⚠️ Временная ошибка, попробуй позже.').catch(() => {});
}
