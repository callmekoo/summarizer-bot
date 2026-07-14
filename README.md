# Summarizer Bot

Телеграм-бот, который умеет две вещи:

- **Пересказ** — пришли ссылку на статью или YouTube-видео, получишь краткий пересказ
  на русском прямо в чат.
- **Статья** — `/article <ссылка>` собирает из видео полноценную статью с заголовками и
  присылает `.md`-файлом (Telegram рендерит markdown-превью в клиенте). Это **не пересказ**:
  содержание сохраняется целиком, вырезаются только реклама и мусор устной речи.

Извлечение текста — [rdrr](https://github.com/fkonovalov/rdrr), пересказ — LLM через
**любой OpenAI-совместимый API** (по умолчанию [OpenRouter](https://openrouter.ai);
меняется через `LLM_BASE_URL` + `LLM_API_KEY`). Подробный план — в [PLAN.md](PLAN.md).

## Стек

TypeScript (Node 20+) · grammY · rdrr · OpenAI-совместимый LLM API (через `openai` SDK).

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

Образ собирает CI и публикует в GHCR — `ghcr.io/callmekoo/summarizer-bot`
(см. [`.github/workflows/docker.yml`](.github/workflows/docker.yml)). На сервере его не
собирают, а **скачивают готовым** (`tsc` + `npm ci` на слабом VPS — это минуты):

```sh
docker run --rm --env-file .env ghcr.io/callmekoo/summarizer-bot:latest
```

Локально из исходников (для разработки): `docker build -t summarizer-bot .`.

Секреты передаются через `--env-file` (`.env` в образ не копируется, см. `.dockerignore`).
Для постоянной работы удобнее Docker Compose (ниже).

**Healthcheck.** Бот пишет heartbeat-файл (`HEARTBEAT_FILE`), пока опрашивает Telegram;
`HEALTHCHECK` в образе считает контейнер `unhealthy`, если файл «протух» (> 60 с). Docker
сам по себе только помечает статус: `restart` перезапускает контейнер, лишь когда процесс
**вышел**. Если бот «завис» (процесс жив, polling умер) — нужен `autoheal` (см. compose).
(При переходе на webhook healthcheck заменим на HTTP `/health` — см. PLAN, Этап 4.)

## Docker Compose (запуск на сервере)

На сервере нужен Docker с плагином compose. Установка (один раз):

```sh
# Debian/Ubuntu — официальный скрипт ставит Docker + compose-плагин
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # чтобы запускать без sudo; затем перелогиниться
```

Деплой (образ тянется из GHCR, на сервере ничего не собирается):

```sh
git clone <repo-url> summarizer && cd summarizer
cp .env.example .env              # вписать BOT_TOKEN, LLM_API_KEY, MODEL, ALLOWED_USER_IDS
docker compose pull               # скачать готовый образ из GHCR
docker compose up -d              # поднять в фоне
```

Образ публичный — для `pull` логин в GHCR не нужен. На сервере достаточно `compose.yml`
и `.env` (репозиторий клонировать необязательно).

Управление:

```sh
docker compose ps                 # статус + health
docker compose logs -f bot        # логи (Ctrl+C — выйти, бот продолжит работать)
docker compose restart bot        # перезапуск
docker compose down               # остановить и удалить контейнер
```

Обновление после изменений в коде (CI уже собрал и запушил новый образ в GHCR):

```sh
docker compose pull               # подтянуть свежий :latest
docker compose up -d              # перезапустить на новом образе
```

`restart: unless-stopped` поднимет бота после краша и перезагрузки сервера. Чтобы ещё и
авто-перезапускать «зависший» (unhealthy) контейнер — раскомментируй сервис `autoheal`
в [docker-compose.yml](docker-compose.yml).

## Переменные окружения

| Переменная | Назначение | По умолчанию |
|---|---|---|
| `BOT_TOKEN` | токен Telegram-бота (от @BotFather) | — (обязательна) |
| `LLM_API_KEY` | ключ LLM-провайдера (или старый `OPENROUTER_API_KEY`) | — (обязательна) |
| `LLM_BASE_URL` | baseURL OpenAI-совместимого API | `https://openrouter.ai/api/v1` |
| `MODEL` | основная модель (slug провайдера) | — (обязательна) |
| `MODEL_FALLBACK` | запасная модель (при ошибке/429 основной) | — (опционально) |
| `LLM_TEMPERATURE` | температура сэмплинга, 0–2 (ниже = стабильнее) | `0.3` |
| `SYSTEM_PROMPT_FILE` | путь к файлу системного промпта (пусто = встроенный) | — |
| `ARTICLE_PROMPT_FILE` | то же для `/article` (пусто = встроенный) | — |
| `ARTICLE_LANG` | язык статьи: `original` (как в видео) или `ru` (переводить) | `original` |
| `ARTICLE_CHUNK_CHARS` | размер куска расшифровки; меньше = подробнее статья | `12000` |
| `MAX_INPUT_TOKENS` | лимит входных токенов (свыше — обрезка + предупреждение) | `200000` |
| `RATE_LIMIT_PER_MIN` | лимит запросов/мин на пользователя | `5` |
| `MAX_CONCURRENCY` | одновременных обработок (parse + LLM) | `2` |
| `ALLOWED_USER_IDS` | белый список Telegram ID через запятую (пусто = все) | — |
| `HEARTBEAT_FILE` | файл heartbeat для Docker healthcheck | `/tmp/heartbeat` |
| `LOG_LEVEL` | уровень логов pino | `info` |

Свой Telegram ID — у [@userinfobot](https://t.me/userinfobot). Пустой `ALLOWED_USER_IDS`
= бот открыт всем (на старте пишет предупреждение в лог).

Живой список бесплатных моделей OpenRouter:

```sh
curl -s https://openrouter.ai/api/v1/models | \
  jq -r '.data[] | select(.id | endswith(":free")) | .id'
```

## Команда `/article` — видео в статью

`/article <ссылка>` берёт расшифровку YouTube-видео и разворачивает её в статью: устная речь
переписывается письменным языком, добавляются заголовки и разметка. **Содержание не
сокращается** — вырезаются только рекламные/спонсорские вставки, призывы подписаться и мусор
устной речи. Результат приходит `.md`-файлом.

Ссылка **не на видео** (статья, GitHub, PDF) → отдаём текст страницы в `.md` сразу, без LLM:
rdrr уже вернул структурированный markdown. *Видео rdrr понимает только с YouTube.*

### Почему расшифровка режется на куски

У модели два разных лимита: **контекст** (вход) и **`max_completion_tokens`** (выход). В
контекст расшифровка влезает легко. Но статья по объёму сравнима с расшифровкой, а у модели
сильный внутренний прайор на длину ответа (~1–2 тыс. токенов): попроси её одним вызовом
развернуть 28 тыс. токенов расшифровки — она не упрётся в лимит, а **втихую скатится в
пересказ**, сжав всё к середине.

Поэтому расшифровка режется на куски по `ARTICLE_CHUNK_CHARS` (по границам глав видео, если
они есть) и каждый разворачивается отдельно: кусок настолько мал, что честное разворачивание —
естественный для модели объём ответа. Куски идут **последовательно** (параллель на free-тире
= шторм 429), поэтому длинное видео обрабатывается минутами — бот показывает прогресс.
Короткое видео = один кусок = один вызов.

Если статьи выходят слишком краткими — **уменьши** `ARTICLE_CHUNK_CHARS`.

## Системный промпт без пересборки

По умолчанию промпт встроен в код. Чтобы менять его, не пересобирая образ, вынеси в файл
и укажи `SYSTEM_PROMPT_FILE`. Промпт читается при старте — после правки **перезапусти**
(не пересобирай):

- **Локально:** `SYSTEM_PROMPT_FILE=./prompt.txt` в `.env`, правишь файл → перезапуск.
- **Docker:** примонтируй файл и укажи путь внутри контейнера — раскомментируй `volumes`
  в [docker-compose.yml](docker-compose.yml), поставь `SYSTEM_PROMPT_FILE=/app/prompt.txt`,
  затем `docker compose restart bot`.

Если файл не задан, пуст или нечитаем — используется встроенный дефолт (с логом).

**В файле пиши только задачу: что делать с текстом, каким стилем и в каком формате.** Правила
защиты от prompt-инъекций (текст из веба недоверенный — инструкции внутри него выполнять
нельзя) код **всегда добавляет сам**, поверх твоего промпта. Знать о них и копировать их в
свой файл не нужно, отключить — тоже нельзя. Минимальный рабочий `prompt.txt` — буквально:

```
Перескажи текст в трёх предложениях на русском.
```

Промпт `/article` настраивается так же — через `ARTICLE_PROMPT_FILE`. Учти: `ARTICLE_LANG`
влияет только на встроенный промпт, в своём файле язык задавай сам.

## Структура

```
src/
  bot.ts            точка входа (grammY, middleware, heartbeat, graceful shutdown)
  config.ts         env + валидация (zod)
  types.ts          ExtractResult
  handlers/         хендлеры Telegram (onStart, onLink)
  middleware/       allowlist (Telegram ID), rateLimit (запросов/мин)
  core/             extractor, summarizer, formatter
  llm/              клиент OpenRouter + промпты
  lib/              url, logger, concurrency, rateLimiter
  **/*.test.ts      юнит-тесты рядом с кодом (node:test)

Dockerfile · docker-compose.yml · .dockerignore   — деплой (см. выше)
tsconfig.json / tsconfig.build.json                — типы / сборка (без тестов)
```

## Статус

Рабочий бот, развёрнутый сценарий «ссылка → пересказ» полностью готов. Сделаны Этапы 1–3
и бо́льшая часть Этапа 4 (Docker, compose, healthcheck, метрики). Что осталось — открытые
пункты в [PLAN.md](PLAN.md): **webhook** (и тогда `/health` вместо heartbeat) и
опциональный **SQLite-кэш по URL**. Полный map-reduce для сверхдлинных текстов — тоже
опционально (сейчас работает обрезка с предупреждением, см. PLAN, Этап 2).
