import { InlineKeyboard, type Context, type NextFunction } from 'grammy';
import type { Db } from '../db/database.js';
import { touchProfile, touchAdmin, createApplication } from '../db/users.js';
import { decideAccess, ACCESS_TEXT } from '../core/access.js';
import { userLabelHtml, type UserRow } from '../core/users.js';
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

/** `Новая заявка: @ivanp (Иван Петров, id 123)` — Telegram-HTML. */
export function renderApplication(user: UserRow): string {
  return `Новая заявка: ${userLabelHtml(user)}`;
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
    const now = deps.now();
    if (from.id === deps.adminId) {
      // Владелец проходит всегда; профиль — только чтобы видеть себя в /stats по нику.
      try {
        touchAdmin(deps.db, from, now);
      } catch (err) {
        logger.warn({ err }, 'доступ: не удалось обновить профиль владельца');
      }
      return next();
    }

    let user: UserRow | undefined;
    try {
      user = touchProfile(deps.db, from);
    } catch (err) {
      return failClosed(ctx, err, from.id);
    }

    const decision = decideAccess(user, false, now);
    if (decision.kind === 'pass') return next();

    // Неодобренным отвечаем только на то, что человек сделал сам: сообщение или кнопку.
    // Служебные события (my_chat_member — заблокировал/разблокировал бота) молча
    // пропускаем: иначе блокировка после кулдауна заводила бы заявку, а ответ на неё
    // падал бы с «бот заблокирован».
    if (!ctx.message && !ctx.callbackQuery) return;
    // Нажатую кнопку закрываем, чтобы не крутился индикатор.
    if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});

    switch (decision.kind) {
      case 'apply': {
        let created: UserRow;
        try {
          created = createApplication(deps.db, from, now);
        } catch (err) {
          return failClosed(ctx, err, from.id);
        }
        // Ответ человеку может не уйти — владелец о заявке узнать всё равно должен.
        await safeReply(ctx, ACCESS_TEXT.applied);
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
        await safeReply(ctx, ACCESS_TEXT.pending);
        return;
      case 'rejected':
        await safeReply(ctx, ACCESS_TEXT.rejected(decision.until));
        return;
      case 'ignore':
        return; // бан: молчим
    }
  };
}

/** Ответ неодобренному. Не ушёл (например, бот заблокирован) — не повод падать. */
async function safeReply(ctx: Context, text: string): Promise<void> {
  try {
    await ctx.reply(text);
  } catch (err) {
    logger.debug({ err, userId: ctx.from?.id }, 'доступ: ответ не доставлен');
  }
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
