import { encode } from 'gpt-tokenizer';
import { openrouter } from '../llm/openrouter.js';
import { SYSTEM_PROMPT, userPrompt } from '../llm/prompts.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

export type SummarizeErrorKind = 'unavailable' | 'failed';

export class SummarizeError extends Error {
  constructor(public readonly kind: SummarizeErrorKind, message: string) {
    super(message);
    this.name = 'SummarizeError';
  }
}

/**
 * Суммаризирует текст одним проходом. Основная модель вмещает ~1M токенов,
 * поэтому пока без map-reduce — только защитная обрезка по MAX_INPUT_TOKENS.
 * Перебирает MODEL → MODEL_FALLBACK при ошибке/пустом ответе.
 */
export async function summarize(text: string, title?: string): Promise<string> {
  const input = capTokens(text, config.MAX_INPUT_TOKENS);
  const models = [config.MODEL, config.MODEL_FALLBACK];

  let lastErr: unknown;
  let allUnavailable = true;
  for (const model of models) {
    try {
      const resp = await openrouter.chat.completions.create({
        model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt(title, input) },
        ],
      });
      const content = resp.choices[0]?.message?.content?.trim();
      if (content) return content;
      allUnavailable = false;
      logger.warn({ model }, 'пустой ответ модели, пробую следующую');
    } catch (err) {
      lastErr = err;
      if (!isModelUnavailable(err)) allUnavailable = false;
      logger.warn({ err, model }, 'ошибка запроса к модели, пробую следующую');
    }
  }

  // Все модели отвалились по 404 «нет такой/недоступна бесплатно» — это протухший
  // слаг в .env, а не временный сбой. Сообщаем об этом отдельно.
  if (allUnavailable) {
    throw new SummarizeError(
      'unavailable',
      `модели недоступны: ${models.join(', ')} — обнови MODEL/MODEL_FALLBACK в .env`,
    );
  }
  throw new SummarizeError('failed', `LLM summarization failed: ${String(lastErr)}`);
}

/** OpenRouter возвращает 404, когда слаг модели не существует или больше не бесплатен. */
function isModelUnavailable(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: number }).status === 404;
}

/** Обрезает текст под бюджет токенов (грубо, пропорционально по символам). */
function capTokens(text: string, maxTokens: number): string {
  const tokenCount = encode(text).length;
  if (tokenCount <= maxTokens) return text;
  const ratio = maxTokens / tokenCount;
  logger.warn({ tokenCount, maxTokens }, 'текст превышает лимит токенов, обрезаю');
  return text.slice(0, Math.floor(text.length * ratio));
}
