import type { Context } from 'grammy';
import {
  searchYoutube,
  renderSearchList,
  youtubeWatchUrl,
  decodeVideoId,
  SearchError,
  PICK_COMMAND_RE,
} from '../core/youtubeSearch.js';
import { runSummary } from './onLink.js';
import { runArticle } from './onArticle.js';
import { replyTo } from '../lib/reply.js';
import { logger } from '../lib/logger.js';

/** `/search <запрос>` → список видео с YouTube; под каждым команды пересказа и статьи. */
export async function onSearch(ctx: Context): Promise<void> {
  const query = typeof ctx.match === 'string' ? ctx.match.trim() : '';
  const replyId = ctx.message?.message_id;
  if (!query) {
    await ctx.reply(
      'Напиши, что найти, вместе с командой:\n/search как устроены трансформеры',
      replyTo(replyId),
    );
    return;
  }

  const startedAt = Date.now();
  try {
    await ctx.replyWithChatAction('typing').catch(() => {});
    const { hits, skipped } = await searchYoutube(query);
    logger.info(
      {
        query,
        hits: hits.length,
        skipped: skipped.length,
        ms: Date.now() - startedAt,
      },
      'search',
    );

    if (hits.length === 0) {
      // Ни одного videoRenderer на обычный запрос — скорее всего, YouTube поменял формат
      // выдачи, а не «ничего не нашлось». Ловится этой строкой в логах.
      if (skipped.length === 0) {
        logger.warn({ query }, 'search: в выдаче нет ни одного видео');
      }
      await ctx.reply(
        '😕 Ничего не нашлось. Идущие эфиры, анонсы трансляций и шортсы я пропускаю — ' +
          'попробуй сформулировать иначе.',
        replyTo(replyId),
      );
      return;
    }

    await ctx.reply(renderSearchList(hits), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...replyTo(replyId),
    });
  } catch (err) {
    logger.error(
      {
        err,
        query,
        reason: err instanceof SearchError ? `search_${err.kind}` : 'unknown',
        ms: Date.now() - startedAt,
      },
      'search',
    );
    const message =
      err instanceof SearchError && err.kind === 'timeout'
        ? '⌛ YouTube долго не отвечает. Попробуй ещё раз.'
        : '⚠️ Не получилось поискать на YouTube. Попробуй позже.';
    await ctx.reply(message, replyTo(replyId));
  }
}

/**
 * Команда из списка /search: `/sum_<код>` — пересказ, `/art_<код>` — статья. Результат
 * приходит ответом на саму команду: в чате её видно, и ясно, к какому видео он относится.
 */
export async function onSearchCommand(ctx: Context): Promise<void> {
  const replyId = ctx.message?.message_id;
  const match = ctx.message?.text?.match(PICK_COMMAND_RE);
  const id = match ? decodeVideoId(match[2]!) : null;
  if (!match || !id) {
    await ctx.reply(
      '⚠️ Не понял, какое это видео. Найди его заново через /search.',
      replyTo(replyId),
    );
    return;
  }
  const url = youtubeWatchUrl(id);
  if (match[1] === 'art') {
    await runArticle(ctx, url, replyId);
  } else {
    await runSummary(ctx, url, replyId);
  }
}
