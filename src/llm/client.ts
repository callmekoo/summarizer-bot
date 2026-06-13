import OpenAI from 'openai';
import { config } from '../config.js';

// Клиент к любому OpenAI-совместимому провайдеру (OpenRouter по умолчанию).
export const llm = new OpenAI({
  apiKey: config.LLM_API_KEY,
  baseURL: config.LLM_BASE_URL,
  // OpenRouter использует эти заголовки для атрибуции/рейтинга; другие провайдеры
  // их просто игнорируют, так что слать безопасно.
  defaultHeaders: {
    'HTTP-Referer': 'https://github.com/callmekoo/summarizer-bot',
    'X-Title': 'Summarizer Bot',
  },
});
