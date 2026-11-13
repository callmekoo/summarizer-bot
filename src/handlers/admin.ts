import type { Context } from 'grammy';
import type { Db } from '../db/database.js';
import { getUser, setStatus, listUsers, findUser } from '../db/users.js';
import {
  totals,
  topUsers,
  commandBreakdown,
  lastRequestAt,
} from '../db/usage.js';
import { ACCESS_TEXT } from '../core/access.js';
import { userLabelHtml, type UserRow, type UserStatus } from '../core/users.js';
import {
  periodStarts,
  renderStats,
  renderUserStats,
  renderUsers,
  type PeriodTotals,
} from '../core/stats.js';
import { splitForTelegram } from '../core/formatter.js';
import { renderApplication } from '../middleware/access.js';
import { GREETING } from './onStart.js';
import { getDb } from '../lib/store.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

// Команды и кнопки владельца. Сюда попадают только апдейты от ADMIN_USER_ID
// (bot.filter(isAdmin) в bot.ts), повторная проверка не нужна.

export type AdminAction = 'approve' | 'reject' | 'ban';

export interface DecisionDeps {
  db: Db;
  now: () => number;
  retryDays: number;
  /** Сообщение пользователю (Telegram-HTML). Может упасть: человек заблокировал бота. */
  send: (chatId: number, text: string) => Promise<unknown>;
}

export type DecisionOutcome =
  | { kind: 'done'; user: UserRow; notified: boolean }
  | { kind: 'already'; user: UserRow }
  | { kind: 'not_found' };

const STATUS_OF: Record<AdminAction, UserStatus> = {
  approve: 'approved',
  reject: 'rejected',
  ban: 'banned',
};

const DONE_LABEL: Record<AdminAction, string> = {
  approve: '✅ одобрен',
  reject: '❌ отклонён',
  ban: '🚫 забанен',
};

const DAY_MS = 86_400_000;

/**
 * Решение по пользователю: статус в базе + уведомление ему. Кнопки заявки работают только
 * по ждущей заявке (onlyIfPending) — так старая кнопка не перебьёт решение, принятое
 * командой. Статус меняется, даже если уведомление не дошло.
 */
export async function applyDecision(
  deps: DecisionDeps,
  userId: number,
  action: AdminAction,
  opts: { onlyIfPending: boolean },
): Promise<DecisionOutcome> {
  const current = getUser(deps.db, userId);
  if (!current) return { kind: 'not_found' };
  if (opts.onlyIfPending && current.status !== 'pending') {
    return { kind: 'already', user: current };
  }

  const now = deps.now();
  const retryAfter = action === 'reject' ? now + deps.retryDays * DAY_MS : null;
  const user = setStatus(deps.db, userId, STATUS_OF[action], now, retryAfter)!;
  logger.info({ userId, action }, 'доступ: решение владельца');

  const text =
    action === 'approve'
      ? `${ACCESS_TEXT.approved}\n\n${GREETING}`
      : action === 'reject'
        ? ACCESS_TEXT.rejected(retryAfter!)
        : null;
  if (text === null) return { kind: 'done', user, notified: false };
  try {
    await deps.send(userId, text);
    return { kind: 'done', user, notified: true };
  } catch (err) {
    logger.warn({ err, userId }, 'доступ: не удалось уведомить пользователя');
    return { kind: 'done', user, notified: false };
  }
}

function decisionDeps(ctx: Context): DecisionDeps {
  return {
    db: getDb(),
    now: Date.now,
    retryDays: config.ACCESS_RETRY_DAYS,
    send: (chatId, text) =>
      ctx.api.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      }),
  };
}

/** Кнопка под заявкой: callback-data `access:<action>:<id>`. */
export async function onAccessButton(ctx: Context): Promise<void> {
  const match = ctx.match as RegExpMatchArray;
  const action = match[1] as AdminAction;
  const userId = Number(match[2]);
  const r = await applyDecision(decisionDeps(ctx), userId, action, {
    onlyIfPending: true,
  });

  if (r.kind === 'not_found') {
    await ctx.answerCallbackQuery({ text: 'Пользователь не найден' });
    return;
  }
  if (r.kind === 'already') {
    await ctx.answerCallbackQuery({ text: 'Уже обработано' });
    return;
  }
  await ctx.answerCallbackQuery();
  const note = r.notified || action === 'ban' ? '' : ' (уведомить не удалось)';
  // Без reply_markup Telegram убирает кнопки.
  await ctx
    .editMessageText(
      `${renderApplication(r.user)} — ${DONE_LABEL[action]}${note}`,
      { parse_mode: 'HTML' },
    )
    .catch((err: unknown) =>
      logger.warn({ err }, 'доступ: не удалось обновить сообщение заявки'),
    );
}

export async function onUsers(ctx: Context): Promise<void> {
  await replyLong(ctx, renderUsers(listUsers(getDb())));
}

export async function onStats(ctx: Context): Promise<void> {
  const db = getDb();
  const arg = commandArg(ctx);
  const p = periodStarts(new Date());
  const periodsFor = (userId?: number): PeriodTotals[] => [
    { label: 'Сегодня', totals: totals(db, p.today, userId) },
    { label: '7 дней', totals: totals(db, p.week, userId) },
    { label: '30 дней', totals: totals(db, p.month, userId) },
    { label: 'Всё время', totals: totals(db, 0, userId) },
  ];

  if (!arg) {
    const top = topUsers(db, p.month, 5).map((row) => ({
      row,
      user: getUser(db, row.userId),
    }));
    await replyLong(ctx, renderStats(periodsFor(), top));
    return;
  }

  const user = await resolveUser(ctx, arg);
  if (!user) return;
  await replyLong(
    ctx,
    renderUserStats(
      user,
      periodsFor(user.id),
      commandBreakdown(db, user.id),
      lastRequestAt(db, user.id),
    ),
  );
}

export const onApprove = (ctx: Context) => decideByCommand(ctx, 'approve');
export const onRevoke = (ctx: Context) => decideByCommand(ctx, 'reject');
export const onBan = (ctx: Context) => decideByCommand(ctx, 'ban');

async function decideByCommand(
  ctx: Context,
  action: AdminAction,
): Promise<void> {
  const target = await resolveUser(ctx, commandArg(ctx));
  if (!target) return;

  const r = await applyDecision(decisionDeps(ctx), target.id, action, {
    onlyIfPending: false,
  });
  if (r.kind !== 'done') {
    await ctx.reply('Не нашёл пользователя.');
    return;
  }
  const note = r.notified || action === 'ban' ? '' : ' (уведомить не удалось)';
  await ctx.reply(`${userLabelHtml(r.user)} — ${DONE_LABEL[action]}${note}`, {
    parse_mode: 'HTML',
  });
}

const USAGE = 'Не понял: нужен id или @ник.';
const USER_ARG = /^(\d+|@?[A-Za-z0-9_]{1,32})$/;

function commandArg(ctx: Context): string {
  return typeof ctx.match === 'string' ? ctx.match.trim() : '';
}

/** id или @ник → пользователь; иначе отвечает владельцу и возвращает undefined. */
async function resolveUser(
  ctx: Context,
  arg: string,
): Promise<UserRow | undefined> {
  if (!USER_ARG.test(arg)) {
    await ctx.reply(USAGE);
    return undefined;
  }
  const user = findUser(getDb(), arg);
  if (!user) await ctx.reply('Не нашёл пользователя.');
  return user;
}

async function replyLong(ctx: Context, html: string): Promise<void> {
  for (const part of splitForTelegram(html)) {
    await ctx.reply(part, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  }
}
