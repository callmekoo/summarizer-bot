import { SYSTEM_PROMPT, userPrompt } from '../llm/prompts.js';
import { complete } from '../llm/complete.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

// Ошибки и usage — общие для всех вызовов LLM, живут в llm/complete. Ре-экспортируем,
// чтобы хендлеры (onLink) импортировали их привычно отсюда.
export { SummarizeError } from '../llm/complete.js';
export type { SummarizeErrorKind, TokenUsage } from '../llm/complete.js';

export interface SummarizeResult {
  text: string;
  /** Какая модель в итоге ответила (основная или фолбэк). */
  model: string;
  usage?: import('../llm/complete.js').TokenUsage;
  /** Текст был длиннее лимита и обрезан. */
  truncated: boolean;
  /** Какая доля исходного текста вошла в пересказ, % (100, если без обрезки). */
  keptPercent: number;
}

/**
 * Суммаризирует текст одним проходом (без map-reduce — пока хватает обрезки по
 * MAX_INPUT_TOKENS). Перебор моделей, 404/429 и повторы — в `complete`.
 */
export async function summarize(text: string, title?: string): Promise<SummarizeResult> {
  const cap = capTokens(text, config.MAX_INPUT_TOKENS);
  const result = await complete([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt(title, cap.text) },
  ]);

  return {
    text: result.text,
    model: result.model,
    usage: result.usage,
    truncated: cap.truncated,
    keptPercent: cap.keptPercent,
  };
}

export interface CapResult {
  text: string;
  truncated: boolean;
  keptPercent: number;
}

// Грубая оценка токенов по символам — без зависимости-токенайзера. Берём ~3 символа
// на токен: для русского/смешанного это близко, для английского — с запасом (оценка
// завышает число токенов → обрезаем чуть раньше, а не переполняем контекст). Точность
// тут не важна: это редкий предохранитель, а лимит (200k) сильно ниже контекста моделей.
const APPROX_CHARS_PER_TOKEN = 3;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}

/** Обрезает текст под бюджет токенов (грубо, пропорционально по символам). */
export function capTokens(text: string, maxTokens: number): CapResult {
  const tokenCount = estimateTokens(text);
  if (tokenCount <= maxTokens) {
    return { text, truncated: false, keptPercent: 100 };
  }
  const ratio = maxTokens / tokenCount;
  logger.warn({ tokenCount, maxTokens }, 'текст превышает лимит токенов (оценка), обрезаю');
  return {
    text: text.slice(0, Math.floor(text.length * ratio)),
    truncated: true,
    keptPercent: Math.round(ratio * 100),
  };
}
