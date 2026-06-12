import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN обязателен'),
  OPENROUTER_API_KEY: z.string().min(1, 'OPENROUTER_API_KEY обязателен'),
  MODEL: z.string().default('meta-llama/llama-3.3-70b-instruct:free'),
  MODEL_FALLBACK: z.string().default('qwen/qwen3-next-80b-a3b-instruct:free'),
  MAX_INPUT_TOKENS: z.coerce.number().int().positive().default(100_000),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(5),
  LOG_LEVEL: z.string().default('info'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Печатаем понятный список проблем и выходим — иначе упадём позже и непонятно.
  console.error('Ошибка конфигурации (.env):');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;
