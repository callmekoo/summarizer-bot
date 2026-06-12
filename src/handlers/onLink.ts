import type { Context } from 'grammy';
import { extractUrl } from '../lib/url.js';
import { extract, ExtractError } from '../core/extractor.js';
import { summarize, SummarizeError } from '../core/summarizer.js';
import { toTelegramHtml, splitForTelegram, renderSourceHeader } from '../core/formatter.js';
import type { ExtractResult } from '../types.js';
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

  const startedAt = Date.now();
  const queuedAhead = pipeline.queued;
  let parseMs = 0;
  let llmMs = 0;

  let extracted: ExtractResult | undefined;
  try {
    await ctx.replyWithChatAction('typing');
    const result = await pipeline.run(async () => {
      const tParse = Date.now();
      extracted = await extract(url);
      parseMs = Date.now() - tParse;

      const tLlm = Date.now();
      const summary = await summarize(extracted.markdown, extracted.title);
      llmMs = Date.now() - tLlm;
      return summary;
    });

    const header = renderSourceHeader({
      url,
      title: extracted?.title,
      author: extracted?.author,
      site: extracted?.site,
    });
    const body = toTelegramHtml(result.text);
    const message = header ? `${header}\n\n${body}` : body;

    for (const chunk of splitForTelegram(message)) {
      await ctx.reply(chunk, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    }

    // Метрики: одна строка на успешный запрос.
    logger.info(
      {
        url,
        ok: true,
        model: result.model,
        parseMs,
        llmMs,
        totalMs: Date.now() - startedAt,
        promptTokens: result.usage?.prompt,
        completionTokens: result.usage?.completion,
        queuedAhead,
      },
      'request',
    );
  } catch (err) {
    await ctx.reply(userMessageForError(err));
    // Метрики: одна строка на неуспешный запрос (err тоже логируем для деталей).
    logger.error(
      {
        err,
        url,
        ok: false,
        reason: errorReason(err),
        parseMs,
        llmMs,
        totalMs: Date.now() - startedAt,
        queuedAhead,
      },
      'request',
    );
  } finally {
    clearInterval(typing);
    await ctx.api.deleteMessage(status.chat.id, status.message_id).catch(() => {});
  }
}

/** Короткий машиночитаемый код причины для метрик. */
function errorReason(err: unknown): string {
  if (err instanceof ExtractError) return `extract_${err.kind}`;
  if (err instanceof SummarizeError) return `llm_${err.kind}`;
  return 'unknown';
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
