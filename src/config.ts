import 'dotenv/config';
import { z } from 'zod';

// Список Telegram user ID через запятую → массив чисел. Пустой = allowlist выключен.
const allowedUserIds = z
  .string()
  .default('')
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(z.coerce.number().int().positive()));

const schema = z.object({
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN обязателен'),
  OPENROUTER_API_KEY: z.string().min(1, 'OPENROUTER_API_KEY обязателен'),
  MODEL: z.string().default('nvidia/nemotron-3-super-120b-a12b:free'),
  MODEL_FALLBACK: z.string().default('nvidia/nemotron-3-nano-30b-a3b:free'),
  MAX_INPUT_TOKENS: z.coerce.number().int().positive().default(200_000),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(5),
  MAX_CONCURRENCY: z.coerce.number().int().positive().default(2),
  ALLOWED_USER_IDS: allowedUserIds,
  HEARTBEAT_FILE: z.string().default('/tmp/heartbeat'),
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
