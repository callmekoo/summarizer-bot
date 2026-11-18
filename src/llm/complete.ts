import type OpenAI from 'openai';
import { llm } from './client.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { currentRequest } from '../lib/requestContext.js';
import { getDb } from '../lib/store.js';
import { recordLlmCall } from '../db/usage.js';

export type SummarizeErrorKind = 'unavailable' | 'rate_limited' | 'failed';

export class SummarizeError extends Error {
  constructor(
    public readonly kind: SummarizeErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'SummarizeError';
  }
}

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
  /** Стоимость в $, если провайдер её сообщил (OpenRouter: usage.cost); иначе null. */
  costUsd: number | null;
}

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface CompletionResult {
  text: string;
  /** Какая модель в итоге ответила (основная или фолбэк). */
  model: string;
  usage?: TokenUsage;
}

// Потолок ожидания по Retry-After: дольше держать пользователя в «печатает…» не хотим.
const MAX_RETRY_WAIT_MS = 30_000;

/**
 * Один вызов LLM с перебором MODEL → MODEL_FALLBACK. При общем 429 (бесплатные модели
 * перегружены апстримом) один раз ждёт по Retry-After и повторяет цепочку.
 *
 * Общий низкий уровень для пересказа и сборки статьи: логика фолбэков и 429 тонкая,
 * дублировать её нельзя.
 */
export async function complete(
  messages: ChatMessage[],
): Promise<CompletionResult> {
  const models = [config.MODEL, config.MODEL_FALLBACK].filter(
    (m): m is string => Boolean(m),
  );
  // OpenRouter по этому флагу кладёт стоимость в usage.cost. Другим провайдерам поле не
  // шлём: строгие (OpenAI) отбивают незнакомые параметры.
  const extra = isOpenRouter(config.LLM_BASE_URL)
    ? { usage: { include: true } }
    : {};

  for (let attempt = 0; ; attempt++) {
    let lastErr: unknown;
    let n404 = 0;
    let n429 = 0;
    let nOther = 0;
    let minRetryAfterMs = Infinity;

    for (const model of models) {
      try {
        const resp = await llm.chat.completions.create({
          model,
          temperature: config.LLM_TEMPERATURE,
          messages,
          ...extra,
        } as OpenAI.ChatCompletionCreateParamsNonStreaming);
        const usage = mapUsage(resp.usage);
        // Платный вызов записываем, даже если ответ пустой: деньги уже потрачены.
        recordCall(model, usage);
        const content = resp.choices[0]?.message?.content?.trim();
        if (content) {
          return { text: content, model, usage };
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
        logger.warn(
          { err, model },
          'ошибка запроса к модели, пробую следующую',
        );
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
      throw new SummarizeError(
        'rate_limited',
        `все модели перегружены (429): ${models.join(', ')}`,
      );
    }

    // Только 404 — слаги протухли/стали платными, это правка .env, а не временный сбой.
    if (n404 > 0 && n429 === 0 && nOther === 0) {
      throw new SummarizeError(
        'unavailable',
        `модели недоступны: ${models.join(', ')} — обнови MODEL/MODEL_FALLBACK в .env`,
      );
    }
    throw new SummarizeError('failed', `LLM call failed: ${String(lastErr)}`);
  }
}

function httpStatus(err: unknown): number | undefined {
  return typeof err === 'object' && err !== null
    ? (err as { status?: number }).status
    : undefined;
}

/** Хост baseURL — openrouter.ai или его поддомен. */
export function isOpenRouter(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === 'openrouter.ai' || host.endsWith('.openrouter.ai');
  } catch {
    return false;
  }
}

/**
 * Приводит usage из ответа провайдера к нашему виду (поля могут отсутствовать). Стоимость
 * берём, только если это конечное неотрицательное число — формат ответа чужой.
 */
export function mapUsage(
  usage:
    | {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        cost?: unknown;
      }
    | undefined,
): TokenUsage | undefined {
  if (!usage) return undefined;
  const cost = usage.cost;
  return {
    prompt: usage.prompt_tokens ?? 0,
    completion: usage.completion_tokens ?? 0,
    total: usage.total_tokens ?? 0,
    costUsd:
      typeof cost === 'number' && Number.isFinite(cost) && cost >= 0
        ? cost
        : null,
  };
}

/** Пишет вызов в статистику текущего запроса. Сбой записи не ломает ответ — только warn. */
function recordCall(model: string, usage: TokenUsage | undefined): void {
  const rc = currentRequest();
  if (rc?.requestId == null) return;
  try {
    recordLlmCall(getDb(), {
      requestId: rc.requestId,
      model,
      promptTokens: usage?.prompt ?? 0,
      completionTokens: usage?.completion ?? 0,
      costUsd: usage?.costUsd ?? null,
      now: Date.now(),
    });
  } catch (err) {
    logger.warn({ err, model }, 'статистика: не удалось записать вызов LLM');
  }
}

/** Достаёт паузу до повтора из 429: сперва metadata, потом заголовок Retry-After. */
export function retryAfterMs(err: unknown): number {
  const e = err as {
    headers?: Headers | Record<string, string>;
    error?: { metadata?: { retry_after_seconds?: number } };
  };
  const metaSec = e?.error?.metadata?.retry_after_seconds;
  const headerSec = Number(header(e?.headers, 'retry-after'));
  const sec = Number.isFinite(metaSec) ? Number(metaSec) : headerSec;
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 5000;
}

// openai с v5 отдаёт заголовки ошибки нативным Headers (раньше — обычным объектом),
// а провайдеры/моки могут прислать и то, и другое. Читаем обе формы.
function header(
  headers: Headers | Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) ?? undefined;
  }
  return (headers as Record<string, string>)[name];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
