import type { Context } from 'grammy';
import {
  searchYoutube,
  renderSearchList,
  youtubeWatchUrl,
  SearchError,
  PICK_RE,
} from '../core/youtubeSearch.js';
import { runSummary } from './onLink.js';
import { replyTo } from '../lib/reply.js';
import { logger } from '../lib/logger.js';

/** `/search <запрос>` → список видео с YouTube и кнопки «1…5». Пересказ — по нажатию. */
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

    const { text, keyboard } = renderSearchList(hits);
    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
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

/** Нажатие кнопки из списка /search: обычный пересказ видео ответом на список. */
export async function onSearchPick(ctx: Context): Promise<void> {
  const id = ctx.callbackQuery?.data?.match(PICK_RE)?.[1];
  // Ответить на callback нужно сразу: иначе у кнопки крутится спиннер, пока идёт пересказ.
  await ctx
    .answerCallbackQuery(id ? { text: '⏳ Делаю пересказ…' } : undefined)
    .catch(() => {});
  if (!id) return;
  // Список не удаляем: можно нажать и другое видео из него.
  await runSummary(
    ctx,
    youtubeWatchUrl(id),
    ctx.callbackQuery?.message?.message_id,
  );
}
