import { encode } from 'gpt-tokenizer';
import { openrouter } from '../llm/openrouter.js';
import { SYSTEM_PROMPT, userPrompt } from '../llm/prompts.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

/**
 * Суммаризирует текст одним проходом. Основная модель вмещает ~1M токенов,
 * поэтому пока без map-reduce — только защитная обрезка по MAX_INPUT_TOKENS.
 * Перебирает MODEL → MODEL_FALLBACK при ошибке/пустом ответе.
 */
export async function summarize(text: string, title?: string): Promise<string> {
  const input = capTokens(text, config.MAX_INPUT_TOKENS);
  const models = [config.MODEL, config.MODEL_FALLBACK];

  let lastErr: unknown;
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
      logger.warn({ model }, 'пустой ответ модели, пробую следующую');
    } catch (err) {
      lastErr = err;
      logger.warn({ err, model }, 'ошибка запроса к модели, пробую следующую');
    }
  }

  throw new Error(`LLM summarization failed: ${String(lastErr)}`);
}

/** Обрезает текст под бюджет токенов (грубо, пропорционально по символам). */
function capTokens(text: string, maxTokens: number): string {
  const tokenCount = encode(text).length;
  if (tokenCount <= maxTokens) return text;
  const ratio = maxTokens / tokenCount;
  logger.warn({ tokenCount, maxTokens }, 'текст превышает лимит токенов, обрезаю');
  return text.slice(0, Math.floor(text.length * ratio));
}
