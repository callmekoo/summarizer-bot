import { chunkTranscript } from './chunker.js';
import { ARTICLE_SYSTEM_PROMPT, articleUserPrompt } from '../llm/prompts.js';
import { complete, SummarizeError, type ChatMessage, type CompletionResult } from '../llm/complete.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { isVideo, type ExtractResult } from '../types.js';

export interface ArticleResult {
  markdown: string;
  /** Какая модель собрала статью. undefined — LLM не звали (не видео). */
  model?: string;
  /** Сколько кусков обработано (0 — обошлись без LLM). */
  chunks: number;
  /** Сколько кусков не далось (429 и т.п.) — статья отдана частичной. */
  failedChunks: number;
}

export type CompleteFn = (messages: ChatMessage[]) => Promise<CompletionResult>;

export interface BuildArticleOptions {
  /** Зовётся после каждого куска — чтобы показать прогресс: долгие видео идут минутами. */
  onProgress?: (done: number, total: number) => void;
  /** Подменяется в тестах, чтобы не ходить в сеть. */
  llm?: CompleteFn;
  /** Бюджет куска в символах. По умолчанию из конфига; параметр — ради тестов. */
  chunkChars?: number;
}

/**
 * Собирает markdown-статью по результату извлечения.
 *
 * Не видео → отдаём markdown от rdrr как есть: он уже структурирован, LLM не нужна.
 * Видео → расшифровка режется на куски и каждый разворачивается в текст статьи.
 * Куски идут последовательно: free-тир жёстко отдаёт 429 при параллельных запросах.
 */
export async function buildArticle(
  extracted: ExtractResult,
  options: BuildArticleOptions = {},
): Promise<ArticleResult> {
  const { onProgress, llm = complete, chunkChars = config.ARTICLE_CHUNK_CHARS } = options;
  const transcript = extracted.transcript ?? [];

  // Не видео (или видео без сегментов) — текст уже структурирован, LLM не нужна. Шапку
  // всё равно добавляем: rdrr отдаёт для страниц голое тело, без заголовка и ссылки.
  if (!isVideo(extracted) || transcript.length === 0) {
    return {
      markdown: renderArticleMd(extracted, extracted.markdown),
      chunks: 0,
      failedChunks: 0,
    };
  }

  const chunks = chunkTranscript(transcript, extracted.chapters, chunkChars);
  logger.info({ chunks: chunks.length, url: extracted.url }, 'собираю статью из расшифровки');

  const sections: string[] = [];
  let failedChunks = 0;
  let model: string | undefined;

  for (const [i, chunk] of chunks.entries()) {
    try {
      const result = await llm([
        { role: 'system', content: ARTICLE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: articleUserPrompt(chunk.text, {
            index: i + 1,
            total: chunks.length,
            chapterTitles: chunk.chapterTitles,
          }),
        },
      ]);
      sections.push(result.text);
      model = result.model;
    } catch (err) {
      // Один упавший кусок не должен обнулять минуты уже сделанной работы: помечаем
      // пропуск и продолжаем, а пользователю отдаём частичную статью.
      failedChunks++;
      sections.push(`> ⚠️ Не удалось обработать фрагмент ${i + 1} из ${chunks.length}.`);
      logger.warn({ err, chunk: i + 1, url: extracted.url }, 'фрагмент статьи не обработан');
    }
    onProgress?.(i + 1, chunks.length);
  }

  // Не дался ни один кусок — отдавать нечего, это честная ошибка.
  if (failedChunks === chunks.length) {
    throw new SummarizeError('failed', 'не удалось обработать ни одного фрагмента расшифровки');
  }

  return {
    markdown: renderArticleMd(extracted, sections.join('\n\n')),
    model,
    chunks: chunks.length,
    failedChunks,
  };
}

/** Собирает итоговый markdown: шапка с источником + тело. Чистая функция. */
export function renderArticleMd(meta: ExtractResult, body: string): string {
  const byline = [meta.author, meta.site].filter(Boolean).join(' · ');
  return [
    `# ${meta.title ?? 'Статья'}`,
    byline ? `*${byline}*` : '',
    `[Источник](${meta.url})`,
    '',
    '---',
    '',
    body.trim(),
    '',
  ]
    .filter((line, i, all) => !(line === '' && all[i - 1] === '')) // без двойных пустых строк
    .join('\n');
}
