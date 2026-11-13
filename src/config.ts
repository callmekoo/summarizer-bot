import 'dotenv/config';
import { z } from 'zod';

// Список Telegram user ID через запятую → массив чисел. Это пользователи, одобренные
// заранее: при старте они становятся approved без заявки (кроме тех, по кому владелец
// уже решил иначе: отказ, /revoke, бан).
const allowedUserIds = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.coerce.number<string>().int().positive()));

const schema = z.object({
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN обязателен'),
  // Любой OpenAI-совместимый провайдер. По умолчанию — OpenRouter.
  LLM_API_KEY: z
    .string()
    .min(1, 'LLM_API_KEY (или OPENROUTER_API_KEY) обязателен'),
  LLM_BASE_URL: z.url().default('https://openrouter.ai/api/v1'),
  // Слаги моделей у провайдера. MODEL обязателен; MODEL_FALLBACK опционален
  // (пробуется при ошибке/429 основной). Дефолтов нет — выбираются под провайдера.
  MODEL: z.string().min(1, 'MODEL обязателен (укажи slug модели)'),
  MODEL_FALLBACK: z.string().optional(),
  // Температура сэмплинга: ниже = точнее/стабильнее, выше = разнообразнее. Для
  // суммаризации держим низкой. Диапазон 0–2.
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.3),
  // Путь к файлу с системным промптом. Пусто = встроенный дефолт.
  SYSTEM_PROMPT_FILE: z.string().optional(),
  // То же для команды /article (транскрипт видео → статья). Защита от инъекций
  // подмешивается кодом в обоих случаях, в файле — только задача/стиль/формат.
  ARTICLE_PROMPT_FILE: z.string().optional(),
  // Язык статьи: original — как в видео, ru — переводить на русский.
  ARTICLE_LANG: z.enum(['original', 'ru']).default('original'),
  // Размер куска транскрипта в символах. Маленький кусок модель разворачивает честно,
  // на большом скатывается в пересказ — поэтому бюджет невелик и не привязан к лимитам API.
  ARTICLE_CHUNK_CHARS: z.coerce.number().int().positive().default(12_000),
  MAX_INPUT_TOKENS: z.coerce.number().int().positive().default(200_000),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(5),
  MAX_CONCURRENCY: z.coerce.number().int().positive().default(2),
  // Владелец бота: получает заявки, видит статистику, не проходит проверку доступа.
  ADMIN_USER_ID: z.coerce
    .number<string>({ error: 'ADMIN_USER_ID обязателен (твой Telegram id)' })
    .int()
    .positive(),
  ALLOWED_USER_IDS: allowedUserIds,
  // SQLite с пользователями и статистикой. В Docker — именованный том /app/data.
  DB_PATH: z.string().min(1).default('data/bot.db'),
  // Через сколько дней отклонённый может подать заявку снова.
  ACCESS_RETRY_DAYS: z.coerce.number().int().min(1).default(7),
  HEARTBEAT_FILE: z.string().default('/tmp/heartbeat'),
  LOG_LEVEL: z.string().default('info'),
});

// Обратная совместимость: старое имя OPENROUTER_API_KEY → LLM_API_KEY.
const env = {
  ...process.env,
  LLM_API_KEY: process.env.LLM_API_KEY ?? process.env.OPENROUTER_API_KEY,
};

const parsed = schema.safeParse(env);

if (!parsed.success) {
  // Печатаем понятный список проблем и выходим — иначе упадём позже и непонятно.
  console.error('Ошибка конфигурации (.env):');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;
