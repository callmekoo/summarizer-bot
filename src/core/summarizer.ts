import { SYSTEM_PROMPT, userPrompt, type SummaryBudget } from '../llm/prompts.js';
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
  /** Какой объём просили у модели — чтобы по логам подкручивать кривую. */
  budget: SummaryBudget;
}

/**
 * Суммаризирует текст одним проходом (без map-reduce — пока хватает обрезки по
 * MAX_INPUT_TOKENS). Перебор моделей, 404/429 и повторы — в `complete`.
 */
export async function summarize(text: string, title?: string): Promise<SummarizeResult> {
  const cap = capTokens(text, config.MAX_INPUT_TOKENS);
  // Бюджет считаем от обрезанного текста: ориентир должен отражать то, что модель видит.
  const budget = summaryBudget(cap.text);
  const result = await complete([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt(title, cap.text, budget) },
  ]);

  return {
    text: result.text,
    model: result.model,
    usage: result.usage,
    truncated: cap.truncated,
    keptPercent: cap.keptPercent,
    budget,
  };
}

// Объём пересказа растёт как КОРЕНЬ из объёма источника, а не линейно: на длинном
// материале доля действительно новых тем падает (повторы, отступления, вода), и
// линейный рост дал бы простыню на часовом видео. Без этого ориентира модель выдаёт
// ~одинаковые 3-5 блоков и на заметке, и на транскрипте — ровно та проблема, которую
// чиним. Числа подобраны на глаз, правятся здесь одной строкой.
const SCALE = 12; // статья 20k символов → ~1700 символов пересказа
const MIN_CHARS = 300;
const MAX_CHARS = 7000; // ~два сообщения Telegram (лимит 4096, режет splitForTelegram)
const CHARS_PER_BLOCK = 420; // блок = заголовок + 2-5 предложений
// Ниже этого порога блоки только мешают: короткий текст честнее пересказать связной сутью.
const BLOCKS_THRESHOLD = 600;
const MAX_BLOCKS = 14;

/**
 * Ориентир по объёму пересказа для данного текста. Чистая функция: сама по себе ничего
 * не гарантирует — модель следует ориентиру приблизительно, и это нормально.
 */
export function summaryBudget(text: string): SummaryBudget {
  const raw = clamp(SCALE * Math.sqrt(text.length), MIN_CHARS, MAX_CHARS);
  // Круглое число: «около 1700» читается моделью как ориентир, «около 1697» — как точная цель.
  const chars = Math.round(raw / 100) * 100;
  const blocks =
    chars < BLOCKS_THRESHOLD ? 0 : clamp(Math.round(chars / CHARS_PER_BLOCK), 2, MAX_BLOCKS);
  return { chars, blocks };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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
