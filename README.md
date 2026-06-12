# Summarizer Bot

Телеграм-бот: принимает ссылку на статью или YouTube-видео и возвращает краткий
пересказ на русском (TL;DR + тезисы блоками).

Извлечение текста — [rdrr](https://github.com/fkonovalov/rdrr), пересказ — LLM через
[OpenRouter](https://openrouter.ai). Подробный план — в [PLAN.md](PLAN.md).

## Стек

TypeScript (Node 20+) · grammY · rdrr · OpenRouter (через `openai` SDK).

## Запуск

```sh
npm install
cp .env.example .env   # заполнить BOT_TOKEN и OPENROUTER_API_KEY
npm run dev            # режим разработки (tsx watch)
```

Тесты и сборка:

```sh
npm test           # юнит-тесты (node:test через tsx)
npm run typecheck  # проверка типов
npm run build
npm start
```

## Docker

Multi-stage сборка (build → runtime, в образе только прод-зависимости), запуск под
непривилегированным пользователем. Бот работает по long-polling — входящий порт не нужен.

```sh
docker build -t summarizer-bot .
docker run --rm --env-file .env summarizer-bot
```

Секреты передаются через `--env-file` (`.env` в образ не копируется, см. `.dockerignore`).

## Переменные окружения

| Переменная | Назначение | По умолчанию |
|---|---|---|
| `BOT_TOKEN` | токен Telegram-бота (от @BotFather) | — (обязательна) |
| `OPENROUTER_API_KEY` | ключ OpenRouter | — (обязательна) |
| `MODEL` | основная модель | `nvidia/nemotron-3-super-120b-a12b:free` |
| `MODEL_FALLBACK` | запасная модель | `nvidia/nemotron-3-nano-30b-a3b:free` |
| `MAX_INPUT_TOKENS` | лимит входных токенов | `100000` |
| `RATE_LIMIT_PER_MIN` | лимит запросов/мин на пользователя | `5` |
| `MAX_CONCURRENCY` | одновременных обработок (parse + LLM) | `2` |
| `ALLOWED_USER_IDS` | белый список Telegram ID через запятую (пусто = все) | — |
| `LOG_LEVEL` | уровень логов pino | `info` |

Свой Telegram ID — у [@userinfobot](https://t.me/userinfobot). Пустой `ALLOWED_USER_IDS`
= бот открыт всем (на старте пишет предупреждение в лог).

Живой список бесплатных моделей OpenRouter:

```sh
curl -s https://openrouter.ai/api/v1/models | \
  jq -r '.data[] | select(.id | endswith(":free")) | .id'
```

## Структура

```
src/
  bot.ts            точка входа
  config.ts         env + валидация (zod)
  handlers/         хендлеры Telegram (onStart, onLink)
  middleware/       allowlist (Telegram ID), rateLimit (запросов/мин)
  core/             extractor, summarizer, formatter
  llm/              клиент OpenRouter + промпты
  lib/              url, logger, concurrency, rateLimiter
  **/*.test.ts      юнит-тесты рядом с кодом (node:test)
```

## Статус

Готов happy path (Этап 1): ссылка → текст → пересказ → ответ. Дальше по
[PLAN.md](PLAN.md): устойчивость (ретраи, rate-limit, категории ошибок) и продакшн.
