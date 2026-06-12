import type { Context } from 'grammy';
import { extractUrl } from '../lib/url.js';
import { extract, ExtractError } from '../core/extractor.js';
import { summarize, SummarizeError } from '../core/summarizer.js';
import { toTelegramHtml, splitForTelegram } from '../core/formatter.js';
import { createLimiter } from '../lib/concurrency.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

// Глобальный лимит одновременных тяжёлых обработок (parse + LLM): защищает от
// шторма 429 при нескольких ссылках подряд. Лишние ждут в очереди.
const pipeline = createLimiter(config.MAX_CONCURRENCY);

export async function onLink(ctx: Context): Promise<void> {
  const text = ctx.message?.text ?? '';
  const url = extractUrl(text);
  if (!url) {
    await ctx.reply('Пришли ссылку (http/https) на статью или YouTube-видео.');
    return;
  }

  const status = await ctx.reply('⏳ Обрабатываю ссылку…');
  // Держим индикатор «печатает», пока идёт парсинг + запрос к LLM.
  const typing = setInterval(() => {
    ctx.replyWithChatAction('typing').catch(() => {});
  }, 4000);

  try {
    await ctx.replyWithChatAction('typing');
    const summary = await pipeline.run(async () => {
      const extracted = await extract(url);
      return summarize(extracted.markdown, extracted.title);
    });
    const html = toTelegramHtml(summary);

    for (const chunk of splitForTelegram(html)) {
      await ctx.reply(chunk, { parse_mode: 'HTML' });
    }
  } catch (err) {
    logger.error({ err, url }, 'не удалось сделать пересказ');
    await ctx.reply(userMessageForError(err));
  } finally {
    clearInterval(typing);
    await ctx.api.deleteMessage(status.chat.id, status.message_id).catch(() => {});
  }
}

function userMessageForError(err: unknown): string {
  if (err instanceof ExtractError) {
    switch (err.kind) {
      case 'empty':
        return '😕 По этой ссылке не нашлось текста для пересказа.';
      case 'timeout':
        return '⌛ Извлечение текста заняло слишком долго. Попробуй ещё раз.';
      default:
        return '⚠️ Не удалось открыть ссылку. Проверь, что она доступна.';
    }
  }
  if (err instanceof SummarizeError) {
    if (err.kind === 'unavailable') {
      return '🛠 Выбранная LLM-модель сейчас недоступна. Обнови MODEL в .env (см. список бесплатных моделей).';
    }
    if (err.kind === 'rate_limited') {
      return '🚦 Бесплатные модели сейчас перегружены. Попробуй ещё раз через минуту.';
    }
  }
  return '⚠️ Что-то пошло не так при пересказе. Попробуй позже.';
}
