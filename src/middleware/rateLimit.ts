import type { Context, NextFunction } from 'grammy';
import { config } from '../config.js';
import { createRateLimiter } from '../lib/rateLimiter.js';

// Не более RATE_LIMIT_PER_MIN сообщений в минуту на пользователя.
const limiter = createRateLimiter(config.RATE_LIMIT_PER_MIN, 60_000);

export async function rateLimit(ctx: Context, next: NextFunction): Promise<void> {
  const id = ctx.from?.id;
  if (id === undefined) {
    return next();
  }

  const { allowed, retryAfterMs } = limiter.check(id);
  if (allowed) {
    return next();
  }

  const sec = Math.ceil(retryAfterMs / 1000);
  await ctx.reply(`⏱ Слишком часто. Подожди ${sec} с и пришли ссылку снова.`);
}
