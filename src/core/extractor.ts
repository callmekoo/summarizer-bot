import { logger } from '../lib/logger.js';
import type { Chapter, ExtractResult, TranscriptSegment } from '../types.js';

export type ExtractErrorKind = 'empty' | 'timeout' | 'failed';

export class ExtractError extends Error {
  constructor(public readonly kind: ExtractErrorKind, message: string) {
    super(message);
    this.name = 'ExtractError';
  }
}

const TIMEOUT_MS = 60_000;

// rdrr — ESM-библиотека без публичных типов, поэтому грузим динамически и
// нормализуем форму ответа (markdown может лежать по-разному).
type ParseFn = (url: string, options?: Record<string, unknown>) => Promise<any>;
let parseFn: ParseFn | null = null;

async function getParse(): Promise<ParseFn> {
  if (!parseFn) {
    const mod: any = await import('rdrr');
    parseFn = mod.parse ?? mod.default?.parse ?? mod.default;
    if (typeof parseFn !== 'function') {
      throw new Error('rdrr: не найдена функция parse');
    }
  }
  return parseFn;
}

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 500;

/**
 * Извлекает текст по ссылке через rdrr. Бросает ExtractError с понятной категорией.
 * Транзиентные сбои (сеть, таймаут) повторяются с backoff; пустой результат — нет
 * (это не временная ошибка, а отсутствие текста).
 */
export async function extract(url: string): Promise<ExtractResult> {
  const parse = await getParse();
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result: any = await withTimeout(parse(url), TIMEOUT_MS);

      const markdown = String(result?.markdown ?? result?.content ?? '').trim();
      if (!markdown) {
        // Не ретраим: текста просто нет (пейвол, видео без субтитров и т.п.).
        throw new ExtractError('empty', 'по ссылке не нашлось текста для пересказа');
      }

      const meta = result?.metadata ?? {};
      // rdrr иногда отдаёт пустые строки — превращаем их в undefined.
      const clean = (v: unknown): string | undefined => {
        const s = typeof v === 'string' ? v.trim() : '';
        return s || undefined;
      };
      return {
        markdown,
        title: clean(result?.title ?? meta.title),
        author: clean(result?.author ?? meta.author),
        site: clean(result?.siteName ?? result?.domain ?? meta.siteName ?? meta.domain),
        wordCount: result?.wordCount ?? meta.wordCount,
        type: result?.type ?? meta.type,
        url,
        chapters: normalizeChapters(result?.chapters),
        transcript: normalizeTranscript(result?.transcript),
      };
    } catch (err) {
      if (err instanceof ExtractError && err.kind === 'empty') throw err;
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) {
        logger.warn({ err, url, attempt }, 'rdrr: транзиентный сбой, повтор');
        await sleep(BACKOFF_MS * attempt);
      }
    }
  }

  // Попытки исчерпаны.
  if (lastErr instanceof ExtractError) throw lastErr; // таймаут
  logger.error({ err: lastErr, url }, 'rdrr parse failed');
  throw new ExtractError('failed', 'не удалось извлечь текст по ссылке');
}

/**
 * Главы и транскрипт есть только у YouTube (и то не всегда: главы автор размечает вручную).
 * rdrr без публичных типов, поэтому проверяем форму, а не верим на слово: кривой сегмент
 * лучше отбросить, чем уронить сборку статьи на undefined.
 */
function normalizeChapters(raw: unknown): Chapter[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const chapters = raw
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .map((c) => ({ title: String(c.title ?? '').trim(), startTime: Number(c.startTime ?? 0) }))
    .filter((c) => c.title && Number.isFinite(c.startTime));
  return chapters.length ? chapters : undefined;
}

function normalizeTranscript(raw: unknown): TranscriptSegment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const segments = raw
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    .map((s) => ({
      text: String(s.text ?? '').trim(),
      startTime: Number(s.startTime ?? 0),
      // Нет главы — считаем, что всё видео это одна глава №0.
      chapterIndex: Number.isFinite(Number(s.chapterIndex)) ? Number(s.chapterIndex) : 0,
    }))
    .filter((s) => s.text);
  return segments.length ? segments : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ExtractError('timeout', 'извлечение текста заняло слишком долго')),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
