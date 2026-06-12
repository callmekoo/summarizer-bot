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

/** Извлекает текст по ссылке через rdrr. Бросает ExtractError с понятной категорией. */
export async function extract(url: string): Promise<ExtractResult> {
  let result: any;
  try {
    const parse = await getParse();
    result = await withTimeout(parse(url), TIMEOUT_MS);
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    logger.error({ err, url }, 'rdrr parse failed');
    throw new ExtractError('failed', 'не удалось извлечь текст по ссылке');
  }

  const markdown = String(result?.markdown ?? result?.content ?? '').trim();
  if (!markdown) {
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
