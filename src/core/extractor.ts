import { logger } from '../lib/logger.js';
import type { ExtractResult } from '../types.js';

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
      return {
        markdown,
        title: result?.title ?? meta.title,
        wordCount: result?.wordCount ?? meta.wordCount,
        type: result?.type ?? meta.type,
        url,
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
