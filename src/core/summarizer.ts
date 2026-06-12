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

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export interface SummarizeResult {
  text: string;
  /** Какая модель в итоге ответила (основная или фолбэк). */
  model: string;
  usage?: TokenUsage;
  /** Текст был длиннее лимита и обрезан. */
  truncated: boolean;
  /** Какая доля исходного текста вошла в пересказ, % (100, если без обрезки). */
  keptPercent: number;
}

// Потолок ожидания по Retry-After: дольше держать пользователя в «печатает…» не хотим.
const MAX_RETRY_WAIT_MS = 30_000;

/**
 * Суммаризирует текст одним проходом (без map-reduce — пока хватает обрезки по
 * MAX_INPUT_TOKENS). Перебирает MODEL → MODEL_FALLBACK; при общем 429 (бесплатные
 * модели перегружены апстримом) один раз ждёт по Retry-After и повторяет цепочку.
 */
export async function summarize(text: string, title?: string): Promise<SummarizeResult> {
  const cap = capTokens(text, config.MAX_INPUT_TOKENS);
  const models = [config.MODEL, config.MODEL_FALLBACK];
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: userPrompt(title, cap.text) },
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
        if (content) {
          return {
            text: content,
            model,
            usage: mapUsage(resp.usage),
            truncated: cap.truncated,
            keptPercent: cap.keptPercent,
          };
        }
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

/** Приводит usage из ответа OpenRouter к нашему виду (поля могут отсутствовать). */
function mapUsage(usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined): TokenUsage | undefined {
  if (!usage) return undefined;
  return {
    prompt: usage.prompt_tokens ?? 0,
    completion: usage.completion_tokens ?? 0,
    total: usage.total_tokens ?? 0,
  };
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

export interface CapResult {
  text: string;
  truncated: boolean;
  keptPercent: number;
}

/** Обрезает текст под бюджет токенов (грубо, пропорционально по символам). */
export function capTokens(text: string, maxTokens: number): CapResult {
  const tokenCount = encode(text).length;
  if (tokenCount <= maxTokens) {
    return { text, truncated: false, keptPercent: 100 };
  }
  const ratio = maxTokens / tokenCount;
  logger.warn({ tokenCount, maxTokens }, 'текст превышает лимит токенов, обрезаю');
  return {
    text: text.slice(0, Math.floor(text.length * ratio)),
    truncated: true,
    keptPercent: Math.round(ratio * 100),
  };
}
