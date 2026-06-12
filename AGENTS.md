# AGENTS

Гайд для ИИ-агентов по проекту **summarizer** — телеграм-бот, который принимает
ссылку (статья или YouTube-видео) и возвращает краткий пересказ на русском.

Полный план и принятые решения — в [PLAN.md](PLAN.md). Запуск — в [README.md](README.md).

## Стек

- **TypeScript / Node.js 20+**, ESM (`"type": "module"`, `module: NodeNext`).
- **grammY** — телеграм-бот. **rdrr** — извлечение текста (как библиотека).
- **OpenRouter** через `openai` SDK (OpenAI-совместимый, другой `baseURL`).
- **zod** — валидация env, **pino** — логи, **gpt-tokenizer** — подсчёт токенов.

> ⚠️ Node ставится через **nvm** (`v22.22.3`); в системном PATH его может не быть.
> Перед командами: `nvm use 22` или `export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"`.

## Команды

```sh
npm run dev        # tsx watch — разработка
npm run typecheck  # tsc --noEmit
npm run build      # tsc → dist/
npm start          # node dist/bot.js (прод)
```

Перед коммитом прогоняй `npm run typecheck`.

## Архитектура

Пайплайн одного запроса: `onLink` → `extract` (rdrr) → `summarize` (OpenRouter) →
`formatter` (HTML) → ответ. Раскладка:

```
src/
  bot.ts            точка входа (grammY, graceful shutdown)
  config.ts         env + zod; падает с понятной ошибкой при невалидном .env
  handlers/         onStart (/start, /help), onLink (оркестрация пайплайна)
  core/
    extractor.ts    rdrr.parse(url) с таймаутом; ошибки → ExtractError(kind)
    summarizer.ts   один проход OpenRouter + обрезка по токенам + фолбэк-модель
    formatter.ts    escape HTML → **bold**→<b> → разбивка ≤4096
  llm/              openrouter (клиент), prompts (русский, TL;DR + блоки)
  lib/              url (извлечение ссылки), logger (pino)
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
- Модели бесплатные (`:free`), id — в env (`MODEL`, `MODEL_FALLBACK`); список меняется,
  проверять можно через `GET /api/v1/models`.
- **Venice-подвох:** free-слаги Meta/Qwen/Google/DeepSeek роутятся через провайдера
  Venice, чей бесплатный пул стабильно отдаёт **429** (даже при нашем `usage: 0`).
  Рабочие бесплатные — на инфраструктуре **NVIDIA** (Nemotron). Слаг протух → 404
  (`unavailable`), перегрузка → 429 (`rate_limited`); оба обрабатываются в `summarizer`.

## Статус и следующие шаги

Сделаны Этап 0 (каркас) и Этап 1 (happy path). Дальше по [PLAN.md](PLAN.md):
Этап 3 — устойчивость (ретраи, rate-limit, очередь). Этап 2 (map-reduce) отложен:
контекста основной модели (1M) хватает на типичные тексты, пока обходимся обрезкой по `MAX_INPUT_TOKENS`.

## При обновлении этого файла

Держи в актуальном состоянии раздел «Статус» и фиксируй новые подводные камни.
Отмечай выполненные этапы в [PLAN.md](PLAN.md).
