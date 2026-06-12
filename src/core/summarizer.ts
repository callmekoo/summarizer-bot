import { encode } from 'gpt-tokenizer';
import { openrouter } from '../llm/openrouter.js';
import { SYSTEM_PROMPT, userPrompt } from '../llm/prompts.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

export type SummarizeErrorKind = 'unavailable' | 'rate_limited' | 'failed';

export class SummarizeError extends Error {
  constructor(public readonly kind: SummarizeErrorKind, message: string) {
    super(message);
    this.name = 'SummarizeError';
  }
}

// Потолок ожидания по Retry-After: дольше держать пользователя в «печатает…» не хотим.
const MAX_RETRY_WAIT_MS = 30_000;

/**
 * Суммаризирует текст одним проходом (без map-reduce — пока хватает обрезки по
 * MAX_INPUT_TOKENS). Перебирает MODEL → MODEL_FALLBACK; при общем 429 (бесплатные
 * модели перегружены апстримом) один раз ждёт по Retry-After и повторяет цепочку.
 */
export async function summarize(text: string, title?: string): Promise<string> {
  const input = capTokens(text, config.MAX_INPUT_TOKENS);
  const models = [config.MODEL, config.MODEL_FALLBACK];
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: userPrompt(title, input) },
  ];

  for (let attempt = 0; ; attempt++) {
    let lastErr: unknown;
    let n404 = 0;
    let n429 = 0;
    let nOther = 0;
    let minRetryAfterMs = Infinity;

    for (const model of models) {
      try {
        const resp = await openrouter.chat.completions.create({ model, temperature: 0.3, messages });
        const content = resp.choices[0]?.message?.content?.trim();
        if (content) return content;
        nOther++;
        logger.warn({ model }, 'пустой ответ модели, пробую следующую');
      } catch (err) {
        lastErr = err;
        const status = httpStatus(err);
        if (status === 404) {
          n404++;
        } else if (status === 429) {
          n429++;
          minRetryAfterMs = Math.min(minRetryAfterMs, retryAfterMs(err));
        } else {
          nOther++;
        }
        logger.warn({ err, model }, 'ошибка запроса к модели, пробую следующую');
      }
    }

    // Только 429 по всем моделям — апстрим временно перегружен. Один раз ждём и повторяем.
    const allRateLimited = n429 > 0 && n404 === 0 && nOther === 0;
    if (allRateLimited && attempt === 0 && Number.isFinite(minRetryAfterMs)) {
      const waitMs = Math.min(minRetryAfterMs, MAX_RETRY_WAIT_MS);
      logger.warn({ waitMs }, 'все модели перегружены (429), жду и повторяю');
      await sleep(waitMs);
      continue;
    }
    if (allRateLimited) {
      throw new SummarizeError('rate_limited', `все модели перегружены (429): ${models.join(', ')}`);
    }

    // Только 404 — слаги протухли/стали платными, это правка .env, а не временный сбой.
    if (n404 > 0 && n429 === 0 && nOther === 0) {
      throw new SummarizeError(
        'unavailable',
        `модели недоступны: ${models.join(', ')} — обнови MODEL/MODEL_FALLBACK в .env`,
      );
    }
    throw new SummarizeError('failed', `LLM summarization failed: ${String(lastErr)}`);
  }
}

function httpStatus(err: unknown): number | undefined {
  return typeof err === 'object' && err !== null ? (err as { status?: number }).status : undefined;
}

/** Достаёт паузу до повтора из 429: сперва metadata, потом заголовок Retry-After. */
function retryAfterMs(err: unknown): number {
  const e = err as { headers?: Record<string, string>; error?: { metadata?: { retry_after_seconds?: number } } };
  const metaSec = e?.error?.metadata?.retry_after_seconds;
  const headerSec = Number(e?.headers?.['retry-after']);
  const sec = Number.isFinite(metaSec) ? Number(metaSec) : headerSec;
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 5000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Обрезает текст под бюджет токенов (грубо, пропорционально по символам). */
function capTokens(text: string, maxTokens: number): string {
  const tokenCount = encode(text).length;
  if (tokenCount <= maxTokens) return text;
  const ratio = maxTokens / tokenCount;
  logger.warn({ tokenCount, maxTokens }, 'текст превышает лимит токенов, обрезаю');
  return text.slice(0, Math.floor(text.length * ratio));
}
