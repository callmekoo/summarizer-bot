# AGENTS

Гайд для ИИ-агентов по проекту **summarizer** — телеграм-бот, который принимает
ссылку (статья или YouTube-видео) и возвращает краткий пересказ на русском.

Полный план и принятые решения — в [PLAN.md](PLAN.md). Запуск — в [README.md](README.md).

## Старт за 30 секунд

```sh
# 1. Node только через nvm — добавь в PATH в КАЖДОМ bash-вызове (state не персистится):
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"

# 2. Зависимости (если ещё не стоят) и проверка, что всё зелёное:
npm install
npm run check          # typecheck + тесты — запускай после каждого изменения

# 3. Запуск бота (нужен заполненный .env, см. README):
npm run dev
```

Что делать дальше — открытые пункты в [PLAN.md](PLAN.md) (Этап 4: webhook, SQLite-кэш).
Перед коммитом: `npm run check` зелёный + обнови PLAN/README/AGENTS, если менял поведение.

## Стек

- **TypeScript / Node.js 20+**, ESM (`"type": "module"`, `module: NodeNext`).
- **grammY** — телеграм-бот. **rdrr** — извлечение текста (как библиотека).
- **LLM** — любой OpenAI-совместимый API через `openai` SDK; провайдер задаётся
  `LLM_BASE_URL` + `LLM_API_KEY` (дефолт — OpenRouter).
- **zod** — валидация env, **pino** — логи, **gpt-tokenizer** — подсчёт токенов.

> ⚠️ Node ставится через **nvm** (`v22.22.3`); в системном PATH его может не быть.
> Перед командами: `nvm use 22` или `export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"`.

## Команды

```sh
npm run dev        # tsx watch — разработка
npm run typecheck  # tsc --noEmit (включая тесты)
npm test           # node:test через tsx — юнит-тесты (src/**/*.test.ts)
npm run check      # typecheck + test одной командой (запускай перед коммитом)
npm run build      # tsc -p tsconfig.build.json → dist/ (без *.test.ts)
npm start          # node dist/bot.js (прод)
```

**Тесты:** встроенный `node:test` + `node:assert`, без внешних зависимостей. Файлы
рядом с кодом (`*.test.ts`). Покрыты чистые модули (formatter, url, allowlist, парсинг
config). Сетевые вызовы (rdrr, OpenRouter) в юнит-тестах не дёргаем — для них чистую
логику выносим в тестируемые функции (напр. `isAllowed`, `retryAfterMs`).

## Архитектура

Пайплайн одного запроса: `onLink` → `extract` (rdrr) → `summarize` (OpenRouter) →
`formatter` (HTML) → ответ. Раскладка:

```
src/
  bot.ts            точка входа: grammY, middleware, heartbeat, graceful shutdown
  config.ts         env + zod; падает с понятной ошибкой при невалидном .env
  handlers/         onStart (/start, /help), onLink (оркестрация пайплайна + метрики)
  middleware/       allowlist (ALLOWED_USER_IDS), rateLimit (RATE_LIMIT_PER_MIN)
  core/
    extractor.ts    rdrr.parse(url) с таймаутом + 3 ретрая; ошибки → ExtractError(kind)
    summarizer.ts   один проход OpenRouter + обрезка + фолбэк → SummarizeResult
                    ({text, model, usage, truncated, keptPercent}); ошибки SummarizeError
    formatter.ts    escape HTML → **bold**→<b> → разбивка ≤4096; шапка источника
  llm/              client (OpenAI-совместимый клиент), prompts (русский, TL;DR + блоки)
  lib/              url, logger, concurrency (лимитер очереди), rateLimiter (окно)
  types.ts
```

## Соглашения и подводные камни

- **ESM-импорты с расширением `.js`** (требование NodeNext), даже для `.ts`-файлов.
- **rdrr**: текст лежит в поле `content` (не `markdown`); `title`/`wordCount`/`type` —
  на верхнем уровне `ParseResult`. Грузим динамически (`await import('rdrr')`).
- **Telegram не рендерит markdown-заголовки**. parse mode — **HTML**; заголовки блоков
  модель размечает `**жирным**`, форматтер сначала экранирует `< > &`, потом
  превращает `**…**` в `<b>…</b>`. Не добавляй сырой HTML до экранирования.
- **Язык ответа — всегда русский**, формат: `🔑 TL;DR` + смысловые блоки со списками.
- Ошибки наружу — понятным текстом пользователю, не стек-трейсом (см. `onLink`).
- Провайдер настраивается (`LLM_BASE_URL`/`LLM_API_KEY`), всё ниже — **специфика
  дефолтного OpenRouter**; для OpenAI/Groq/Ollama просто поменяй baseURL+ключ+`MODEL`.
- Модели бесплатные (`:free`), id — в env (`MODEL`, `MODEL_FALLBACK`); список меняется,
  проверять можно через `GET /api/v1/models`.
- **Venice-подвох:** free-слаги Meta/Qwen/Google/DeepSeek роутятся через провайдера
  Venice, чей бесплатный пул стабильно отдаёт **429** (даже при нашем `usage: 0`).
  Рабочие бесплатные — на инфраструктуре **NVIDIA** (Nemotron). Слаг протух → 404
  (`unavailable`), перегрузка → 429 (`rate_limited`); оба обрабатываются в `summarizer`.

## Статус и следующие шаги

Готовы Этапы 0–3 и бо́льшая часть Этапа 4: happy path, устойчивость (ретраи rdrr,
fallback-модель + повтор по 429, очередь `MAX_CONCURRENCY`, rate-limit, allowlist),
шапка источника, метрики (строка `request`), Docker + compose + heartbeat-healthcheck.
Развёрнут на GitHub: `callmekoo/summarizer-bot`.

Открыто (см. [PLAN.md](PLAN.md)):
- **webhook** вместо polling — и тогда healthcheck переделать на HTTP `/health`;
- опциональный **SQLite-кэш по URL**;
- полный **map-reduce** для сверхдлинных текстов (Этап 2) — сейчас работает обрезка с
  предупреждением, контекста моделей (1M/256k) хватает на типичные входы.

## При обновлении этого файла

Держи в актуальном состоянии раздел «Статус» и фиксируй новые подводные камни.
Отмечай выполненные этапы в [PLAN.md](PLAN.md).
