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
- **zod** — валидация env, **pino** — логи. Оценка токенов — эвристика (символы÷3),
  без зависимости-токенайзера.

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

Два пайплайна:

- **Пересказ** (любой текст): `onLink` → `extract` → `summarize` → `formatter` → HTML в чат.
- **Статья** (`/article`): `onArticle` → `extract` → `buildArticle` → `.md`-файлом.
  Видео → `chunker` → LLM по кускам последовательно → склейка. Не видео → markdown от rdrr
  под нашей шапкой, **без LLM**.

```
src/
  bot.ts            точка входа: grammY, middleware, heartbeat, graceful shutdown
  config.ts         env + zod; падает с понятной ошибкой при невалидном .env
  handlers/         onStart (/start, /help), onLink (пересказ), onArticle (/article)
  middleware/       allowlist (ALLOWED_USER_IDS), rateLimit (RATE_LIMIT_PER_MIN)
  core/
    extractor.ts    rdrr.parse(url) с таймаутом + 3 ретрая; ошибки → ExtractError(kind).
                    Для youtube отдаёт ещё chapters[] и transcript[] (нужны статье)
    summarizer.ts   пересказ: обрезка по токенам + complete() → SummarizeResult
    chunker.ts      чистая нарезка транскрипта по главам под бюджет символов
    article.ts      сборка статьи: чанки → LLM → markdown. LLM инжектится (тесты без сети)
    formatter.ts    escape HTML → **bold**→<b> → разбивка ≤4096; шапка источника
  llm/
    client.ts       OpenAI-совместимый клиент
    complete.ts     ЕДИНСТВЕННОЕ место вызова LLM: перебор MODEL→MODEL_FALLBACK,
                    404/429, повтор по Retry-After. SummarizeError живёт здесь
    prompts.ts      SAFETY_RULES + промпты пересказа и статьи; wrapUntrusted (нонс-маркеры)
  lib/              url, logger, concurrency, rateLimiter, filename (slug для .md)
  types.ts          ExtractResult, Chapter, TranscriptSegment, isVideo()
```

## Соглашения и подводные камни

- **ESM-импорты с расширением `.js`** (требование NodeNext), даже для `.ts`-файлов.
- **rdrr**: текст лежит в поле `content` (не `markdown`); `title`/`wordCount`/`type` —
  на верхнем уровне `ParseResult`. Грузим динамически (`await import('rdrr')`).
- **rdrr и видео**: `type` бывает `youtube | webpage | github | pdf | x-profile | x-status`.
  **Видео — только YouTube**, Vimeo и прочих нет. У youtube есть `chapters[]` и `transcript[]`
  (у сегмента — `chapterIndex`), а `content` — плоский дамп с таймкодами, для статьи не годится:
  строим из `transcript[]`. Для webpage `content` — **голое тело без H1**, шапку добавляем сами.
- **Лимит выхода ≠ контекст.** Для `/article` объём ответа сравним со входом. В контекст всё
  влезает, но модель имеет прайор на длину ответа (~1–2k токенов) и на большом куске **тихо
  скатывается в пересказ**. Поэтому и нужен `chunker` — маленький кусок она разворачивает
  честно. Метрика, которой это ловится: `ratio = длина статьи / длина расшифровки` ≳ 0.5.
- **Вызывать LLM только через `llm/complete.ts`.** Логика фолбэков и 429 тонкая — не дублируй.
- **Telegram не рендерит markdown-заголовки**. parse mode — **HTML**; заголовки блоков
  модель размечает `**жирным**`, форматтер сначала экранирует `< > &`, потом
  превращает `**…**` в `<b>…</b>`. Не добавляй сырой HTML до экранирования.
- **Язык ответа — всегда русский**, формат: `🔑 TL;DR` + смысловые блоки со списками.
- **Prompt-инъекции:** текст из веба/транскрипта недоверенный. `wrapUntrusted` оборачивает его
  в маркеры `⟦SOURCE <код>⟧…⟦/SOURCE <код>⟧` со случайным кодом на запрос, а `SAFETY_RULES`
  велят игнорировать инструкции изнутри блока. Оба системных промпта собираются как
  `composeSystemPrompt(task) = task + SAFETY_RULES`: **task-часть** — это то, что заменяет
  `SYSTEM_PROMPT_FILE` / `ARTICLE_PROMPT_FILE`, а **защита живёт в коде и подмешивается
  всегда**, поэтому кастомный промпт не может её потерять. Правила и обёртка ссылаются на
  общую константу `SOURCE_TAG` — не разъезжайся. Новый путь к LLM → обязательно через
  `wrapUntrusted` + `composeSystemPrompt`. Без действий/секретов в контексте инъекция максимум
  портит вывод: это снижение риска, не абсолют.
- Ошибки наружу — понятным текстом пользователю, не стек-трейсом (см. `onLink`).
- Провайдер настраивается (`LLM_BASE_URL`/`LLM_API_KEY`), всё ниже — **специфика
  дефолтного OpenRouter**; для OpenAI/Groq/Ollama просто поменяй baseURL+ключ+`MODEL`.
- Модели задаются в env — `MODEL` (обязателен) и `MODEL_FALLBACK` (опционален), **без
  встроенных дефолтов**; конкретную модель не навязываем. Список меняется, проверяй через
  `GET /api/v1/models`.
- Бесплатные слаги могут протухнуть → 404 (`unavailable`) или упереться в лимит → 429
  (`rate_limited`); оба обрабатываются в `summarizer` (для 429 — повтор по `Retry-After`).
  Если модель стабильно отдаёт 429 — поставь другой слаг.

## Статус и следующие шаги

Готовы Этапы 0–3 и бо́льшая часть Этапа 4: happy path, устойчивость (ретраи rdrr,
fallback-модель + повтор по 429, очередь `MAX_CONCURRENCY`, rate-limit, allowlist),
шапка источника, метрики (строка `request`), Docker + compose + heartbeat-healthcheck.
Развёрнут на GitHub: `callmekoo/summarizer-bot`. Образ собирает CI
(`.github/workflows/docker.yml`) и пушит в GHCR (`ghcr.io/callmekoo/summarizer-bot`);
на сервере — `docker compose pull` (сборку с слабого VPS убрали, там `tsc` шёл минутами).

Готова команда **`/article`** (Этап 5): видео → статья в `.md`, с нарезкой по главам
(`chunker.ts`), вырезанием рекламы и настройкой промпта через `ARTICLE_PROMPT_FILE`.

Открыто (см. [PLAN.md](PLAN.md)):
- **webhook** вместо polling — и тогда healthcheck переделать на HTTP `/health`;
- опциональный **SQLite-кэш по URL**;
- map-reduce для **пересказа** сверхдлинных текстов — сейчас там работает обрезка с
  предупреждением (у `/article` своя нарезка, `chunker.ts`).

## При обновлении этого файла

Держи в актуальном состоянии раздел «Статус» и фиксируй новые подводные камни.
Отмечай выполненные этапы в [PLAN.md](PLAN.md).
