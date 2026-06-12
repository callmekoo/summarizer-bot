import OpenAI from 'openai';
import { config } from '../config.js';

// OpenRouter OpenAI-совместим: тот же SDK, другой baseURL.
export const openrouter = new OpenAI({
  apiKey: config.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://github.com/local/summarizer-bot',
    'X-Title': 'Summarizer Bot',
  },
});
