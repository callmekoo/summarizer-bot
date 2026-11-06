import { InputFile, type Context } from 'grammy';
import { extractUrl } from '../lib/url.js';
import { extract, ExtractError } from '../core/extractor.js';
import { buildArticle } from '../core/article.js';
import { SummarizeError } from '../llm/complete.js';
import { renderSourceHeader } from '../core/formatter.js';
import { articleFilename } from '../lib/filename.js';
import { isVideo, type ExtractResult } from '../types.js';
import { createLimiter } from '../lib/concurrency.js';
import { replyTo } from '../lib/reply.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { withRequest } from '../lib/requestContext.js';
import { sourceLogFields } from '../lib/privacy.js';
import { getDb } from '../lib/store.js';
import { requestUser } from './onLink.js';

// Тот же лимит тяжёлых обработок, что и у пересказа: статья ещё дороже (десяток вызовов),
// параллелить их на free-тире — гарантированный шторм 429.
const pipeline = createLimiter(config.MAX_CONCURRENCY);

export async function onArticle(ctx: Context): Promise<void> {
  const url = extractUrl(ctx.message?.text ?? '');
  if (!url) {
    await ctx.reply(
      'Пришли ссылку вместе с командой:\n/article https://youtube.com/watch?v=…',
    );
    return;
  }
  await runArticle(ctx, url, ctx.message?.message_id);
}

/**
 * Статья по готовой ссылке. Общий путь для /article и для команды `/art_<id>` из
 * списка /search; результат приходит ответом на replyToMessageId.
 */
export async function runArticle(
  ctx: Context,
  url: string,
  replyToMessageId: number | undefined,
): Promise<void> {
  const user = requestUser(ctx);
  await withRequest({ db: getDb(), now: Date.now }, user, 'article', () =>
    articleTracked(ctx, url, replyToMessageId, user.isAdmin),
  );
}

/** Тело runArticle внутри учтённого запроса; true — статья доставлена. */
async function articleTracked(
  ctx: Context,
  url: string,
  replyToMessageId: number | undefined,
  isAdmin: boolean,
): Promise<boolean> {
  const status = await ctx.reply('⏳ Извлекаю текст…');
  const typing = setInterval(() => {
    ctx.replyWithChatAction('upload_document').catch(() => {});
  }, 4000);

  const startedAt = Date.now();
  const queuedAhead = pipeline.queued;
  let parseMs = 0;
  let llmMs = 0;

  let extracted: ExtractResult | undefined;
  try {
    const result = await pipeline.run(async () => {
      const tParse = Date.now();
      extracted = await extract(url);
      parseMs = Date.now() - tParse;

      const tLlm = Date.now();
      const article = await buildArticle(extracted, {
        onProgress: (done, total) => {
          // Длинное видео идёт минутами — без прогресса непонятно, жив ли бот.
          if (total > 1)
            void editStatus(ctx, status, `⏳ Собираю статью… ${done}/${total}`);
        },
      });
      llmMs = Date.now() - tLlm;
      return article;
    });

    const caption = renderSourceHeader({
      url,
      title: extracted?.title,
      author: extracted?.author,
      site: extracted?.site,
    });
    const notice = result.failedChunks
      ? `\n\n⚠️ Не удалось обработать ${result.failedChunks} из ${result.chunks} фрагментов — статья неполная.`
      : '';

    await ctx.replyWithDocument(
      new InputFile(
        Buffer.from(result.markdown, 'utf8'),
        articleFilename(extracted?.title),
      ),
      {
        caption: caption + notice,
        parse_mode: 'HTML',
        ...replyTo(replyToMessageId),
      },
    );

    logger.info(
      {
        ...sourceLogFields(isAdmin, { url }),
        ok: true,
        command: 'article',
        model: result.model,
        video: extracted ? isVideo(extracted) : undefined,
        chunks: result.chunks,
        failedChunks: result.failedChunks,
        bytes: Buffer.byteLength(result.markdown, 'utf8'),
        parseMs,
        llmMs,
        totalMs: Date.now() - startedAt,
        queuedAhead,
      },
      'request',
    );
    return true;
  } catch (err) {
    await ctx.reply(userMessageForError(err), replyTo(replyToMessageId));
    logger.error(
      {
        err,
        ...sourceLogFields(isAdmin, { url }),
        ok: false,
        command: 'article',
        reason: errorReason(err),
        parseMs,
        llmMs,
        totalMs: Date.now() - startedAt,
        queuedAhead,
      },
      'request',
    );
    return false;
  } finally {
    clearInterval(typing);
    await ctx.api
      .deleteMessage(status.chat.id, status.message_id)
      .catch(() => {});
  }
}

/** Обновляет статус-сообщение. Ошибки глотаем: прогресс — не повод валить запрос. */
async function editStatus(
  ctx: Context,
  status: { chat: { id: number }; message_id: number },
  text: string,
): Promise<void> {
  await ctx.api
    .editMessageText(status.chat.id, status.message_id, text)
    .catch(() => {});
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
        return '😕 По этой ссылке не нашлось текста. У видео может не быть субтитров.';
      case 'timeout':
        return '⌛ Извлечение текста заняло слишком долго. Попробуй ещё раз.';
      default:
        return '⚠️ Не удалось открыть ссылку. Проверь, что она доступна.';
    }
  }
  if (err instanceof SummarizeError) {
    if (err.kind === 'unavailable') {
      return '🛠 Выбранная LLM-модель сейчас недоступна. Обнови MODEL в .env.';
    }
    if (err.kind === 'rate_limited') {
      return '🚦 Бесплатные модели сейчас перегружены. Попробуй ещё раз через минуту.';
    }
  }
  return '⚠️ Что-то пошло не так при сборке статьи. Попробуй позже.';
}
