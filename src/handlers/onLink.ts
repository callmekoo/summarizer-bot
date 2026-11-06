import type { Context } from 'grammy';
import { extractUrl } from '../lib/url.js';
import { extract, ExtractError } from '../core/extractor.js';
import { summarize, SummarizeError } from '../core/summarizer.js';
import {
  toTelegramHtml,
  splitForTelegram,
  renderSourceHeader,
} from '../core/formatter.js';
import { DocumentError, supportedExtensions } from '../core/document.js';
import { createLimiter } from '../lib/concurrency.js';
import { replyTo } from '../lib/reply.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

// Глобальный лимит одновременных тяжёлых обработок (parse + LLM): защищает от
// шторма 429 при нескольких ссылках подряд. Лишние ждут в очереди.
const pipeline = createLimiter(config.MAX_CONCURRENCY);

export async function onLink(ctx: Context): Promise<void> {
  const text = ctx.message?.text ?? '';
  const url = extractUrl(text);
  if (!url) {
    // Сюда попадают и «/summary» без аргумента, и просто болтовня — единственное место,
    // где человек, не нашедший меню команд, вообще узнает про /help.
    await ctx.reply(
      'Пришли ссылку (http/https) на статью или YouTube-видео.\n\nВсе команды — /help',
    );
    return;
  }
  await runSummary(ctx, url, ctx.message?.message_id);
}

/** Откуда берётся текст для пересказа: ссылка или присланный файл. */
export interface SummarySource {
  /** Статус, пока идёт обработка. */
  status: string;
  /** Поля строки метрик `request`, по которым видно источник: `{ url }`, `{ file, … }`. */
  log: Record<string, unknown>;
  /** Достаёт текст и готовит шапку. Выполняется внутри общей очереди. */
  load: () => Promise<LoadedSource>;
}

export interface LoadedSource {
  markdown: string;
  /** Заголовок для промпта. */
  title?: string;
  /** Готовая HTML-шапка над пересказом ('' — без шапки). */
  header: string;
}

/**
 * Пересказ по готовой ссылке. Общий путь для ссылки в сообщении и для команды
 * `/sum_<id>` из списка /search; результат приходит ответом на replyToMessageId.
 */
export async function runSummary(
  ctx: Context,
  url: string,
  replyToMessageId: number | undefined,
): Promise<void> {
  await summarizeSource(
    ctx,
    {
      status: '⏳ Обрабатываю ссылку…',
      log: { url },
      load: async () => {
        const extracted = await extract(url);
        return {
          markdown: extracted.markdown,
          title: extracted.title,
          header: renderSourceHeader({
            url,
            title: extracted.title,
            author: extracted.author,
            site: extracted.site,
          }),
        };
      },
    },
    replyToMessageId,
  );
}

/**
 * Пересказ любого источника: загрузка → LLM → сообщения в чат + строка метрик. Очередь,
 * статус, «печатает», цепочка ответов и тексты ошибок — общие для ссылок и файлов.
 */
export async function summarizeSource(
  ctx: Context,
  source: SummarySource,
  replyToMessageId: number | undefined,
): Promise<void> {
  const status = await ctx.reply(source.status);
  // Держим индикатор «печатает», пока идёт загрузка + запрос к LLM.
  const typing = setInterval(() => {
    ctx.replyWithChatAction('typing').catch(() => {});
  }, 4000);

  const startedAt = Date.now();
  const queuedAhead = pipeline.queued;
  let parseMs = 0;
  let llmMs = 0;

  try {
    await ctx.replyWithChatAction('typing');
    const { result, header } = await pipeline.run(async () => {
      const tParse = Date.now();
      const loaded = await source.load();
      parseMs = Date.now() - tParse;

      const tLlm = Date.now();
      const summary = await summarize(loaded.markdown, loaded.title);
      llmMs = Date.now() - tLlm;
      return { result: summary, header: loaded.header };
    });

    const notice = result.truncated
      ? `⚠️ Текст очень длинный — в пересказ вошли первые ~${result.keptPercent}%.`
      : '';
    const body = toTelegramHtml(result.text);
    const message = [header, notice, body].filter(Boolean).join('\n\n');

    // Части выстраиваем цепочкой: первая отвечает на исходное сообщение, каждая следующая — на
    // предыдущую. Так пересказ читается по порядку, даже если чат уехал далеко вперёд.
    let replyToId = replyToMessageId;
    for (const chunk of splitForTelegram(message)) {
      const sent = await ctx.reply(chunk, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...replyTo(replyToId),
      });
      replyToId = sent.message_id;
    }

    // Метрики: одна строка на успешный запрос.
    logger.info(
      {
        ...source.log,
        ok: true,
        model: result.model,
        parseMs,
        llmMs,
        totalMs: Date.now() - startedAt,
        promptTokens: result.usage?.prompt,
        completionTokens: result.usage?.completion,
        truncated: result.truncated,
        // Просили / получили — по этой паре видно, слушается ли модель ориентира.
        targetChars: result.budget.chars,
        targetBlocks: result.budget.blocks,
        actualChars: result.text.length,
        queuedAhead,
      },
      'request',
    );
  } catch (err) {
    await ctx.reply(userMessageForError(err), replyTo(replyToMessageId));
    // Метрики: одна строка на неуспешный запрос (err тоже логируем для деталей).
    logger.error(
      {
        err,
        ...source.log,
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
    await ctx.api
      .deleteMessage(status.chat.id, status.message_id)
      .catch(() => {});
  }
}

/** Короткий машиночитаемый код причины для метрик. */
function errorReason(err: unknown): string {
  if (err instanceof ExtractError) return `extract_${err.kind}`;
  if (err instanceof DocumentError) return `document_${err.kind}`;
  if (err instanceof SummarizeError) return `llm_${err.kind}`;
  return 'unknown';
}

/** Понятный текст ошибки для чата — без стек-трейсов. Нужен и хендлеру файлов. */
export function userMessageForError(err: unknown): string {
  if (err instanceof DocumentError) {
    switch (err.kind) {
      case 'unsupported':
        return `📎 Такие файлы я не читаю. Пересказываю текстовые документы: ${supportedExtensions()}.`;
      case 'too_large':
        return '📦 Файл слишком большой для пересказа.';
      case 'encoding':
        return '😕 Не получается прочитать файл как текст — похоже, он не текстовый.';
      case 'empty':
        return '😕 В файле не нашлось текста для пересказа.';
      default:
        return '⚠️ Не удалось скачать файл из Telegram. Попробуй ещё раз.';
    }
  }
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
