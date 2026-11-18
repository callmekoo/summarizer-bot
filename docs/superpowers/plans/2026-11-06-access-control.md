# Контроль доступа и статистика — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** доступ к боту — только по одобрению владельца (кнопки в Telegram), с хранением
пользователей и агрегированной статистикой (запросы, токены, $) в SQLite, без хранения
содержимого запросов.

**Architecture:** SQLite через встроенный `node:sqlite`; репозитории в `src/db/` принимают
базу параметром (тесты на `:memory:`). Middleware `access` решает судьбу апдейта через
чистую `decideAccess`. Расход LLM привязывается к пользователю через AsyncLocalStorage
(`lib/requestContext.ts`): хендлер открывает запрос, `complete()` пишет каждый платный вызов.

**Tech Stack:** TypeScript (ESM, NodeNext), Node ≥ 22.13, grammY, `node:sqlite`, zod, pino,
`node:test`.

**Spec:** [`docs/superpowers/specs/2026-11-06-access-control-design.md`](../specs/2026-11-06-access-control-design.md)

## Global Constraints

- Новых npm-зависимостей нет. SQLite — только `node:sqlite` (`DatabaseSync`).
- `package.json` → `"engines": { "node": ">=22.13" }`.
- Импорты с расширением `.js`. Перед командами: `export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"`.
- `npm run check` зелёный перед каждым коммитом (`npm run format` при необходимости).
- SQL — **только** `db.prepare('…?…')` / `db.exec('…')` со строковым литералом; никакой
  интерполяции (`${}`), конкатенации, переменных в аргументе. Значения — параметрами.
- Содержимое запросов (url, title, query, имя файла) **не пишется в базу никогда**; в логи —
  только через `sourceLogFields` (для не-админа: `host`, `ext`).
- Все чужие строки в Telegram-HTML — через `escapeHtml`; имена — через `displayName`.
- Ошибка записи статистики → `logger.warn`, пользователь получает ответ как обычно.
- Ошибка записи в `users` в `access` → fail closed: «⚠️ Временная ошибка, попробуй позже».
- Модуль, тянущий `config` (напрямую или через `logger`), в тестах — задать env в `before()`
  (включая `ADMIN_USER_ID`) и импортировать динамически (как `summarizer.test.ts`).
- Время в базе — Unix ms (`INTEGER`). Команды запросов: `'summary' | 'article' | 'search' | 'file'`.
- Тексты пользователю (дословно, из спеки):
  - заявка: `👋 Бот работает по приглашениям. Заявка отправлена владельцу — напишу, когда он ответит.`
  - ожидание: `⏳ Заявка уже на рассмотрении.`
  - отказ: `Заявка отклонена. Повторить можно после <ДД.ММ>.`
  - одобрение: `✅ Доступ открыт!` + приветствие `/start`
  - админу: `Новая заявка: <имя> (@ник | без ника), id <id>` + кнопки `✅ Одобрить` / `❌ Отклонить` / `🚫 Забанить`

## Review Focus

1. **Админ ни разу не писал боту** → `sendMessage` админу падает; заявка всё равно сохранена,
   пользователь получил текст заявки, в логе `error`. Тест — Task 7, Step 1.
2. **Пользователь заблокировал бота до решения** → уведомление ему падает, но статус всё равно
   меняется, админу показан результат. Тест — Task 8, Step 1.
3. **`/users` или `/stats` длиннее 4096 символов** (сотни пользователей) → ответ режется через
   `splitForTelegram`, а не падает с `message is too long`. Тест — Task 6, Step 1.
4. **Пустая база / пользователь без запросов** → `/stats` показывает нули и «нет данных», без
   `NaN`, `undefined`, `$null`. Тест — Task 6, Step 1.
5. **Старая кнопка после решения командой** (`/approve 123`, потом «Отклонить» в старом
   уведомлении) → «уже обработано», статус не меняется. Тест — Task 8, Step 1.

---

## Карта файлов

| Файл | Статус | Ответственность |
|---|---|---|
| `src/config.ts` | M | `ADMIN_USER_ID`, `DB_PATH`, `ACCESS_RETRY_DAYS` |
| `src/db/database.ts` | C | открыть базу, PRAGMA, схема, тишина про ExperimentalWarning |
| `src/db/users.ts` | C | репозиторий пользователей |
| `src/db/usage.ts` | C | запросы, вызовы LLM, агрегаты |
| `src/db/sqlGuard.test.ts` | C | страж от SQL-интерполяции |
| `src/core/access.ts` | C | `decideAccess`, тексты, `formatRetryDate` |
| `src/core/users.ts` | C | `displayName` |
| `src/core/stats.ts` | C | границы периодов, `renderStats` / `renderUserStats` / `renderUsers` |
| `src/lib/requestContext.ts` | C | AsyncLocalStorage, `withRequest` |
| `src/lib/privacy.ts` | C | `sourceLogFields` |
| `src/lib/store.ts` | C | синглтон базы по `config.DB_PATH` |
| `src/llm/complete.ts` | M | флаг usage для OpenRouter, `cost`, запись вызова |
| `src/middleware/access.ts` | C | `createAccess(deps)` — middleware доступа |
| `src/middleware/allowlist.ts` (+test) | D | заменён `access` |
| `src/middleware/rateLimit.ts` | M | админ не лимитируется |
| `src/handlers/admin.ts` | C | кнопки, `/users`, `/stats`, `/revoke`, `/approve`, `/ban` |
| `src/handlers/onStart.ts` | M | экспорт `GREETING` |
| `src/handlers/onLink.ts`, `onArticle.ts`, `onSearch.ts`, `onDocument.ts` | M | учёт запросов, приватность логов |
| `src/core/extractor.ts` | M | `url` в логах через `sourceLogFields` |
| `src/commands.ts` (+test) | M | флаг `admin`, `PUBLIC_COMMANDS` / `ADMIN_COMMANDS` |
| `src/bot.ts` | M | порядок middleware, админские регистрации, меню по scope, seed |
| `Dockerfile`, `docker-compose.yml`, `.gitignore`, `.dockerignore`, `.env.example`, `package.json` | M | инфраструктура |
| `README.md`, `AGENTS.md`, `PLAN.md` | M | документация |

---

### Task 1: Конфиг и база (схема, страж SQL)

**Files:**
- Modify: `src/config.ts`, `src/config.test.ts`, `package.json`, `.gitignore`, `.dockerignore`
- Modify (env в `before()` + `ADMIN_USER_ID='1'`): `src/llm/complete.test.ts`, `src/llm/prompts.test.ts`, `src/core/chunker.test.ts`, `src/core/summarizer.test.ts`, `src/core/article.test.ts`, `src/middleware/allowlist.test.ts`
- Create: `src/db/database.ts`, `src/db/database.test.ts`, `src/db/sqlGuard.test.ts`

**Interfaces:**
- Produces:
  - `config.ADMIN_USER_ID: number` (обязателен, `z.coerce.number().int().positive()`, сообщение `'ADMIN_USER_ID обязателен (твой Telegram id)'`), `config.DB_PATH: string` (деф. `'data/bot.db'`), `config.ACCESS_RETRY_DAYS: number` (int ≥ 1, деф. `7`).
  - `type Db = DatabaseSync` (реэкспорт типа из `db/database.ts`).
  - `openDatabase(path: string): Promise<Db>` — `':memory:'` или путь к файлу; для файла создаёт каталог (`mkdirSync(dirname, { recursive: true })`).
  - `SCHEMA_VERSION = 1`.

- [ ] **Step 1: Тесты.** В `config.test.ts` добавить `process.env.ADMIN_USER_ID = '42'` и проверки: `config.ADMIN_USER_ID === 42`, `config.DB_PATH === 'data/bot.db'`, `config.ACCESS_RETRY_DAYS === 7`. Во все перечисленные тест-файлы с env — `process.env.ADMIN_USER_ID = '1'`.
  `src/db/database.test.ts`:
  - `openDatabase(':memory:')` → таблицы `users`, `requests`, `llm_calls` есть (`SELECT name FROM sqlite_master WHERE type='table'`), `PRAGMA user_version` = 1.
  - файл во временном каталоге `mkdtempSync(join(tmpdir(), 'bot-'))` + `'nested/x.db'`: открыть, вставить строку в `users`, закрыть, открыть снова — строка на месте, ошибки «table already exists» нет.
  `src/db/sqlGuard.test.ts`: для каждого `src/db/*.ts`, кроме `*.test.ts`, найти все вызовы `.prepare(` и `.exec(`; аргумент должен начинаться с `'` или `` ` `` без `${` и до закрывающей скобки не содержать `+` вне литерала. Простейшая реализация: регэксп `/\.(prepare|exec)\(\s*([^)]*)/gs` и проверка `arg` по `/^(['`])[^]*?\1\s*,?\s*$/` плюс `!arg.includes('${')`. Самопроверка стража: тот же детектор на строках-примерах `` "db.prepare(`SELECT ${x}`)" `` и `"db.prepare('a' + b)"` возвращает нарушение, на `"db.prepare('SELECT ?')"` — нет.

- [ ] **Step 2:** `npm test` — новые тесты падают (нет модуля / поля).

- [ ] **Step 3: Реализация.**
  - `config.ts`: три поля; `ALLOWED_USER_IDS` — комментарий «одобрены заранее, сидируются при старте».
  - `db/database.ts`: `import type { DatabaseSync } from 'node:sqlite'` (только тип), сам модуль — `await import('node:sqlite')` внутри `openDatabase`, предварительно один раз обернув `process.emitWarning` так, чтобы предупреждение с текстом, содержащим `'SQLite is an experimental feature'`, проглатывалось, а остальные проходили как есть. PRAGMA: `journal_mode = WAL` (для файла), `foreign_keys = ON`. Схема — из спеки дословно (`CREATE TABLE IF NOT EXISTS`, индексы `IF NOT EXISTS`), в одном `db.exec(SCHEMA_SQL)` где `SCHEMA_SQL` — строковый литерал; затем `PRAGMA user_version = 1`.
  - `package.json`: `engines.node` → `>=22.13`. `.gitignore`, `.dockerignore`: строка `data/`.

- [ ] **Step 4:** `npm run check` — PASS.

- [ ] **Step 5: Commit** — `feat: SQLite-хранилище и настройки доступа (ADMIN_USER_ID, DB_PATH)`.

---

### Task 2: Чистая логика доступа и имён

**Files:**
- Create: `src/core/access.ts`, `src/core/access.test.ts`, `src/core/users.ts`, `src/core/users.test.ts`

**Interfaces:**
- Produces:
  - `type UserStatus = 'pending' | 'approved' | 'rejected' | 'banned'`
  - `interface UserRow { id: number; username: string | null; firstName: string | null; lastName: string | null; status: UserStatus; requestedAt: number | null; decidedAt: number | null; retryAfter: number | null }` — в `core/users.ts`.
  - `type AccessDecision = { kind: 'pass' } | { kind: 'apply' } | { kind: 'pending' } | { kind: 'rejected'; until: number } | { kind: 'ignore' }`
  - `decideAccess(user: UserRow | undefined, isAdmin: boolean, now: number): AccessDecision`
  - `formatRetryDate(ms: number): string` → `ДД.ММ` (`toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })`).
  - `ACCESS_TEXT = { applied: string; pending: string; rejected: (until: number) => string; approved: string }` — тексты из Global Constraints (`approved` = `'✅ Доступ открыт!'`).
  - `displayName(user: Pick<UserRow, 'firstName' | 'lastName'>): string`, `displayUsername(username: string | null): string` (→ `'@ivanp'` или `'без ника'`).

- [ ] **Step 1: Тесты** `access.test.ts`:
  - админ → `pass` при любом `user` (включая `undefined` и `banned`);
  - `undefined` → `apply`; `approved` → `pass`; `pending` → `pending`; `banned` → `ignore`;
  - `rejected`, `now < retryAfter` → `{ kind: 'rejected', until: retryAfter }`; `now >= retryAfter` → `apply`; `retryAfter === null` → `apply`;
  - `ACCESS_TEXT.rejected(Date.UTC(2026, 10, 13, 12))` содержит `'13.11'`.
  `users.test.ts` (`displayName`):
  - `{ firstName: 'Иван', lastName: 'Петров' }` → `'Иван Петров'`; `lastName: null` → `'Иван'`;
  - `'​​'` → `'без имени'`; `null`/`null` → `'без имени'`;
  - `'Ива‮н'` → `'Иван'`; `'Иван\nПетров'` → `'Иван Петров'`;
  - Zalgo: `'И' + '́'.repeat(30)` → `'И́́'`;
  - 100 × `'а'` → длина 64 code points, оканчивается на `'…'`;
  - `'Семья 👨‍👩‍👧'` — ZWJ сохраняются; `'а‍б'` → `'аб'`;
  - `displayUsername(null)` → `'без ника'`, `displayUsername('ivanp')` → `'@ivanp'`.

- [ ] **Step 2:** `npm test` — FAIL.

- [ ] **Step 3: Реализация.** `displayName`: склеить `firstName`/`lastName` через пробел → удалить `\p{Cc}` и `\p{Cf}`, кроме U+200D, у которого слева и справа `\p{Extended_Pictographic}` (до или после `️`) → оставить ≤ 2 подряд `\p{M}` → `\s+` → `' '`, `trim` → если > 64 code points, первые 63 + `'…'` → пусто → `'без имени'`.

- [ ] **Step 4:** `npm run check` — PASS.

- [ ] **Step 5: Commit** — `feat: решение о доступе и безопасный показ имён`.

---

### Task 3: Репозиторий пользователей

**Files:**
- Create: `src/db/users.ts`, `src/db/users.test.ts`

**Interfaces:**
- Consumes: `Db`, `openDatabase` (Task 1); `UserRow`, `UserStatus` (Task 2).
- Produces:
  - `interface TgProfile { id: number; username?: string; first_name?: string; last_name?: string }` (совместим с grammY `User`).
  - `getUser(db: Db, id: number): UserRow | undefined`
  - `touchProfile(db: Db, p: TgProfile): UserRow | undefined` — обновляет ник/имя **существующей** строки и обнуляет этот ник у других строк (`lower(username) = lower(?) AND id <> ?`); строку не создаёт.
  - `createApplication(db: Db, p: TgProfile, now: number): UserRow` — upsert со `status='pending'`, `requested_at=now`, `retry_after=NULL`.
  - `setStatus(db: Db, id: number, status: UserStatus, now: number, retryAfter: number | null = null): UserRow | undefined` — `decided_at=now`; `undefined`, если строки нет.
  - `seedApproved(db: Db, ids: readonly number[], now: number): void` — нет строки → `approved`; есть и не `banned` → `approved`; `banned` не трогает.
  - `listUsers(db: Db): UserRow[]` — по `status`, затем `requested_at DESC`.
  - `findUser(db: Db, query: string): UserRow | undefined` — `^\d+$` → по id; `^@?[A-Za-z0-9_]{1,32}$` → по нику без учёта регистра; иначе `undefined`.

- [ ] **Step 1: Тесты** (`openDatabase(':memory:')` в `beforeEach`):
  - `createApplication` → `getUser` даёт `pending`, `requestedAt = now`;
  - `touchProfile` для неизвестного id → `undefined`, строк не прибавилось;
  - смена ника: A с `'nick'`, потом B прислал `'Nick'` → у A `username === null`, `findUser(db, '@NICK')?.id === B`;
  - `setStatus(…, 'rejected', now, now + 7d)` → `retryAfter`, `decidedAt` выставлены; для неизвестного id → `undefined`;
  - `seedApproved([1, 2], now)` при `2` = `banned` → `1` approved, `2` banned;
  - `findUser(db, 'drop table')` → `undefined`; `findUser(db, '123')` → по id;
  - имя `"'; DROP TABLE users; --"` сохраняется и читается как есть, таблица жива.

- [ ] **Step 2:** FAIL. **Step 3:** реализовать (маппинг snake_case → camelCase в одной функции `rowToUser`). **Step 4:** `npm run check` — PASS (включая `sqlGuard`).

- [ ] **Step 5: Commit** — `feat: репозиторий пользователей`.

---

### Task 4: Учёт запросов и агрегаты

**Files:**
- Create: `src/db/usage.ts`, `src/db/usage.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 1).
- Produces:
  - `type RequestCommand = 'summary' | 'article' | 'search' | 'file'`
  - `startRequest(db: Db, userId: number, command: RequestCommand, now: number): number` — id запроса.
  - `finishRequest(db: Db, requestId: number, ok: boolean): void`
  - `interface LlmCall { requestId: number; model: string; promptTokens: number; completionTokens: number; costUsd: number | null; now: number }`; `recordLlmCall(db: Db, call: LlmCall): void`
  - `interface Totals { requests: number; errors: number; promptTokens: number; completionTokens: number; costUsd: number; pricedCalls: number; unpricedCalls: number }`
  - `totals(db: Db, since: number, userId?: number): Totals` — `since = 0` → всё время. Запросы по `requests.started_at >= since`; токены/стоимость — `llm_calls` JOIN `requests`, тот же фильтр по `started_at`. `errors` — только `ok = 0`.
  - `interface TopRow { userId: number; requests: number; tokens: number; costUsd: number }`; `topUsers(db: Db, since: number, limit: number): TopRow[]` — по `costUsd DESC, tokens DESC`.
  - `commandBreakdown(db: Db, userId: number): { command: RequestCommand; requests: number }[]` — всё время, по убыванию.
  - `lastRequestAt(db: Db, userId: number): number | null`

  Фильтр по `userId` без динамического SQL: условие `(? IS NULL OR r.user_id = ?)` с параметром `userId ?? null` дважды.

- [ ] **Step 1: Тесты:**
  - пустая база → `totals(db, 0)` — все нули;
  - два пользователя, запросы до и после `since`, у статьи 3 вызова (стоимости `0.001`, `0.002`, `null`) → корректные `requests`, токены, `costUsd = 0.003`, `pricedCalls = 2`, `unpricedCalls = 1`;
  - запрос без `finishRequest` (`ok IS NULL`) входит в `requests`, но не в `errors`; `finishRequest(id, false)` → `errors = 1`;
  - `totals(db, 0, userA)` не видит запросов B;
  - `topUsers` порядок и `limit`; `commandBreakdown`; `lastRequestAt` → `null` без запросов.

- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** `npm run check` — PASS.

- [ ] **Step 5: Commit** — `feat: учёт запросов и вызовов LLM`.

---

### Task 5: Контекст запроса, приватность логов, запись вызовов в `complete()`

**Files:**
- Create: `src/lib/store.ts`, `src/lib/requestContext.ts`, `src/lib/requestContext.test.ts`, `src/lib/privacy.ts`, `src/lib/privacy.test.ts`
- Modify: `src/llm/complete.ts`, `src/llm/complete.test.ts`

**Interfaces:**
- Consumes: `openDatabase`, `Db` (Task 1); `startRequest`, `finishRequest`, `recordLlmCall`, `RequestCommand` (Task 4).
- Produces:
  - `store.ts`: `initStore(): Promise<Db>` (открывает `config.DB_PATH` один раз; повторный вызов — тот же объект), `getDb(): Db` (бросает, если `initStore` не вызывался).
  - `requestContext.ts`:
    - `interface RequestContext { requestId: number | null; userId: number; isAdmin: boolean }`
    - `currentRequest(): RequestContext | undefined`
    - `withRequest(deps: { db: Db; now: () => number }, user: { userId: number; isAdmin: boolean }, command: RequestCommand, fn: () => Promise<boolean>): Promise<boolean>` — `startRequest` (ошибка → `warn`, `requestId = null`), выполняет `fn` внутри `AsyncLocalStorage.run`, `finishRequest(requestId, ok)` по возвращённому `ok`; если `fn` бросила — `finishRequest(…, false)` и проброс. Ошибки записи — `warn`, не бросают.
  - `privacy.ts`: `sourceLogFields(isAdmin: boolean, fields: Record<string, unknown>): Record<string, unknown>` — админ → копия как есть. Иначе: `url` (строка) → `host` (`new URL(url).host`, битый → `'invalid'`); `file` (строка) → `ext` (`.md` в нижнем регистре или `null`); `title`, `query` удаляются; прочие ключи (`ok`, `ms`, `bytes`, `format`, …) без изменений.
  - `complete.ts`:
    - `isOpenRouter(baseUrl: string): boolean` — хост `openrouter.ai` или его поддомен.
    - `TokenUsage` дополняется `costUsd: number | null`; `mapUsage` берёт `usage.cost`, если `typeof === 'number' && Number.isFinite && >= 0`, иначе `null`. Экспортировать `mapUsage`.
    - При `isOpenRouter(config.LLM_BASE_URL)` к телу запроса добавляется `usage: { include: true }` (типизация — расширить объект параметров и привести к `ChatCompletionCreateParamsNonStreaming`).
    - После успешного ответа: `const rc = currentRequest(); if (rc?.requestId != null) recordLlmCall(getDb(), {...})` в `try`, ошибка → `logger.warn`.

- [ ] **Step 1: Тесты.**
  - `privacy.test.ts`: админ получает `{ url, title }` как есть; не-админ: `{ url: 'https://www.youtube.com/watch?v=x', title: 'T', ok: true }` → `{ host: 'www.youtube.com', ok: true }`; `{ file: 'Отчёт.MD', bytes: 10 }` → `{ ext: '.md', bytes: 10 }`; `{ file: 'README' }` → `{ ext: null }`; `{ query: 'секрет' }` → `{}`; `{ url: 'not a url' }` → `{ host: 'invalid' }`.
  - `requestContext.test.ts` (база `:memory:`): внутри `fn` `currentRequest()` = `{ requestId: <число>, userId: 5, isAdmin: false }`; снаружи — `undefined`; `fn` вернула `false` → строка `requests.ok = 0`; `fn` бросила → `ok = 0` и ошибка проброшена; два параллельных `withRequest` видят каждый свой `requestId`; закрытая база (`db.close()` до вызова) → `fn` всё равно выполняется с `requestId = null`.
  - `complete.test.ts`: `isOpenRouter('https://openrouter.ai/api/v1') === true`, `'https://api.openai.com/v1'` → `false`, `'http://localhost:11434/v1'` → `false`; `mapUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.0012 })` → `costUsd: 0.0012`; без `cost` → `null`; `cost: '0.1'` → `null`; `cost: -1` → `null`; `mapUsage(undefined)` → `undefined`.

- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** `npm run check` — PASS.

- [ ] **Step 5: Commit** — `feat: контекст запроса и учёт расхода LLM`.

---

### Task 6: Рендер статистики и списков

**Files:**
- Create: `src/core/stats.ts`, `src/core/stats.test.ts`

**Interfaces:**
- Consumes: `Totals`, `TopRow`, `RequestCommand` (Task 4); `UserRow`, `displayName`, `displayUsername` (Task 2); `escapeHtml`, `splitForTelegram` (`core/formatter.ts`).
- Produces:
  - `periodStarts(now: Date): { today: number; week: number; month: number }` — локальная полночь сегодня, сегодня − 6 дней, сегодня − 29 дней (через `new Date(y, m, d - n)`).
  - `formatCost(t: Pick<Totals, 'costUsd' | 'pricedCalls' | 'unpricedCalls'>): string` — нет вызовов → `'$0'`; только неоценённые → `'$ —'`; часть неоценённых → `'$0.0030 + н/д'`; иначе `'$0.0030'` (4 знака после точки).
  - `interface PeriodTotals { label: string; totals: Totals }` — метки `'Сегодня'`, `'7 дней'`, `'30 дней'`, `'Всё время'`.
  - `renderStats(periods: PeriodTotals[], top: { row: TopRow; user: UserRow | undefined }[]): string`
  - `renderUserStats(user: UserRow, periods: PeriodTotals[], breakdown: { command: RequestCommand; requests: number }[], lastAt: number | null): string`
  - `renderUsers(users: UserRow[]): string` — группы «Одобрены / Ждут / Отклонены / Забанены» (пустые группы пропускать; нет никого → `'Пользователей пока нет.'`), строка: `<имя> (@ник | без ника), id <id>, <ДД.ММ.ГГГГ>`.
  - Все три — Telegram-HTML; отправка — `splitForTelegram(…)` у вызывающего.

  Строка периода: `<b>Сегодня</b>: 3 запр. (1 ошиб.), 12 345 ток., $0.0030`. Топ: `1. Иван (@ivanp) — $0.0030, 5 запр.`; пустой топ → `нет данных`. По пользователю без запросов: разбивка `нет данных`, последний запрос `—`.

- [ ] **Step 1: Тесты:**
  - `periodStarts(new Date(2026, 10, 6, 15, 30))`: `today === new Date(2026, 10, 6).getTime()`, `week === new Date(2026, 9, 31).getTime()`, `month === new Date(2026, 9, 8).getTime()`;
  - `formatCost` — все четыре случая;
  - `renderStats` на нулевых `Totals` и пустом топе — содержит `'нет данных'`, не содержит `'NaN'`, `'undefined'`, `'null'`;
  - имя `'<b>x</b>'` в `renderUsers` → `'&lt;b&gt;x&lt;/b&gt;'`;
  - `renderUserStats` с `lastAt = null` и пустой разбивкой — `'—'` и `'нет данных'`;
  - 300 пользователей → `splitForTelegram(renderUsers(users))` даёт несколько частей, каждая ≤ 4096 символов, и вместе они содержат все 300 id.

- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** `npm run check` — PASS.

- [ ] **Step 5: Commit** — `feat: отчёты /stats и /users`.

---

### Task 7: Middleware доступа и подключение в боте

**Files:**
- Create: `src/middleware/access.ts`, `src/middleware/access.test.ts`
- Delete: `src/middleware/allowlist.ts`, `src/middleware/allowlist.test.ts`
- Modify: `src/middleware/rateLimit.ts`, `src/bot.ts`, `src/handlers/onStart.ts`

**Interfaces:**
- Consumes: `decideAccess`, `ACCESS_TEXT` (Task 2); `touchProfile`, `createApplication`, `seedApproved`, `getUser` (Task 3); `initStore`, `getDb` (Task 5); `displayName`, `displayUsername` (Task 2).
- Produces:
  - `interface AccessDeps { db: Db; adminId: number; now: () => number; notifyAdmin: (user: UserRow) => Promise<void> }`
  - `createAccess(deps: AccessDeps): (ctx: Context, next: NextFunction) => Promise<void>`
  - `isAdmin(ctx: Context): boolean` (в `access.ts`, по `config.ADMIN_USER_ID`; для `bot.filter`).
  - `applicationKeyboard(userId: number): InlineKeyboard` — callback-data `access:approve:<id>`, `access:reject:<id>`, `access:ban:<id>`.
  - `renderApplication(user: UserRow): string` → `Новая заявка: <имя> (<@ник|без ника>), id <id>` (через `escapeHtml`).
  - `onStart.ts`: `export const GREETING: string` (текущий текст приветствия), `onStart` использует его.

  Поведение `createAccess` (спека, «Поведение»): нет `ctx.from` → return; админ → `next()`; `touchProfile` → `decideAccess` → `pass`: `next()`; `apply`: `createApplication`, ответ `ACCESS_TEXT.applied`, `notifyAdmin(user)` (ошибка → `logger.error`, не пробрасывать); `pending`: `ACCESS_TEXT.pending`; `rejected`: `ACCESS_TEXT.rejected(until)`; `ignore`: ничего (если это callback — `answerCallbackQuery()` с `.catch(() => {})`). Ошибка базы в `touchProfile`/`createApplication` → ответ `'⚠️ Временная ошибка, попробуй позже.'`, `logger.error`, `next()` не вызывается.

- [ ] **Step 1: Тесты** `access.test.ts` (env + динамический импорт; база `:memory:`; фейковый `ctx` = `{ from, reply: async (t) => { replies.push(t) }, callbackQuery?, answerCallbackQuery }`, `next` — счётчик):
  - админ без строки в базе → `next` вызван, строк в `users` нет;
  - новый пользователь → `next` не вызван, ответ `ACCESS_TEXT.applied`, статус `pending`, `notifyAdmin` вызван один раз;
  - повторное сообщение pending → `ACCESS_TEXT.pending`, `notifyAdmin` больше не вызывался;
  - **`notifyAdmin` бросает** → пользователь всё равно получил `applied`, статус `pending`, исключение не вылетело;
  - `approved` → `next`; `banned` → ни ответа, ни `next`;
  - `rejected` до срока → текст с датой; после срока → новая заявка и `notifyAdmin`;
  - закрытая база (`db.close()`) → ответ с «Временная ошибка», `next` не вызван.

- [ ] **Step 2:** FAIL.

- [ ] **Step 3: Реализация.**
  - `access.ts` по интерфейсу.
  - `rateLimit.ts`: `ctx.from?.id === config.ADMIN_USER_ID` → `next()` сразу.
  - `bot.ts`: в начале `const db = await initStore()` (ошибка → `logger.fatal` + `process.exit(1)` с понятным текстом про `DB_PATH`); `seedApproved(db, config.ALLOWED_USER_IDS, Date.now())`; лог `info` с числом заранее одобренных; убрать предупреждение «ALLOWED_USER_IDS пуст»; `bot.use(createAccess({ db, adminId: config.ADMIN_USER_ID, now: Date.now, notifyAdmin: (u) => bot.api.sendMessage(config.ADMIN_USER_ID, renderApplication(u), { parse_mode: 'HTML', reply_markup: applicationKeyboard(u.id) }).then(() => {}) }))` вместо `allowlist`; затем `rateLimit`.

- [ ] **Step 4:** `npm run check` — PASS.

- [ ] **Step 5: Commit** — `feat: доступ по заявкам вместо статического allowlist`.

---

### Task 8: Админские команды и кнопки

**Files:**
- Create: `src/handlers/admin.ts`, `src/handlers/admin.test.ts`
- Modify: `src/commands.ts`, `src/commands.test.ts`, `src/bot.ts`

**Interfaces:**
- Consumes: всё из Tasks 2–7; `GREETING` (Task 7); `formatRetryDate`.
- Produces:
  - `type AdminAction = 'approve' | 'reject' | 'ban'`
  - `interface DecisionDeps { db: Db; now: () => number; retryDays: number; send: (chatId: number, text: string) => Promise<unknown> }`
  - `type DecisionOutcome = { kind: 'done'; user: UserRow; notified: boolean } | { kind: 'already'; user: UserRow } | { kind: 'not_found' }`
  - `applyDecision(deps: DecisionDeps, userId: number, action: AdminAction, opts: { onlyIfPending: boolean }): Promise<DecisionOutcome>` — кнопки передают `onlyIfPending: true` (статус ≠ `pending` → `already`), команды — `false`. `reject` → `retryAfter = now + retryDays·86 400 000`. Уведомление: `approve` → `ACCESS_TEXT.approved + '\n\n' + GREETING` (HTML), `reject` → `ACCESS_TEXT.rejected(retryAfter)`, `ban` → не шлём. Ошибка `send` → `notified: false`, `logger.warn`, статус уже сохранён.
  - Хендлеры: `onAccessButton(ctx)` (callback: разбор `ctx.match`, `applyDecision`, `answerCallbackQuery` — «уже обработано» для `already`; `editMessageText(renderApplication(user) + ' — одобрен|отклонён|забанен')` без клавиатуры), `onUsers`, `onStats` (без аргумента / с `@ник|id`), `onRevoke` (= `reject`), `onApprove`, `onBan`. Неверный аргумент → `'Не понял: нужен id или @ник.'`; не найден → `'Не нашёл пользователя.'`. Длинные ответы — через `splitForTelegram`.
  - `commands.ts`: `BotCommand.admin?: true`; новые записи `users`, `stats`, `approve`, `revoke`, `ban` с `admin: true`; `PUBLIC_COMMANDS = COMMANDS.filter(c => !c.admin)`; `renderHelp` — только `PUBLIC_COMMANDS`.
  - `bot.ts`: `const admin = bot.filter(isAdmin)`; `admin.callbackQuery(/^access:(approve|reject|ban):(\d+)$/, onAccessButton)`; `admin.command('users' | 'stats' | 'approve' | 'revoke' | 'ban', …)` — до общих регистраций; `setMyCommands(PUBLIC_COMMANDS)` + `setMyCommands(COMMANDS, { scope: { type: 'chat', chat_id: config.ADMIN_USER_ID } })` (ошибка второго — `warn`).

- [ ] **Step 1: Тесты.**
  `admin.test.ts` (env + динамический импорт, база `:memory:`):
  - pending → `approve` с кнопки → `done`, статус `approved`, `send` получил текст с `'✅ Доступ открыт!'`;
  - `reject` → `retryAfter = now + 7·86 400 000`, текст содержит дату `formatRetryDate(retryAfter)`;
  - `ban` → `send` не вызывался;
  - **`send` бросает** → `done`, `notified: false`, статус всё равно изменён;
  - **старая кнопка**: `applyDecision(…, 'approve', { onlyIfPending: false })`, затем `'reject'` с `{ onlyIfPending: true }` → `already`, статус остался `approved`;
  - неизвестный id → `not_found`.
  `commands.test.ts`: регэксп сверки — `/(?:bot|admin)\.command\('([a-z0-9_]+)'/g`; `renderHelp()` не содержит `/users`, `/stats`, `/ban`, `/approve`, `/revoke`; у каждой команды с `admin: true` описание непустое.

- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** `npm run check` — PASS.

- [ ] **Step 5: Commit** — `feat: админские команды и кнопки заявок`.

---

### Task 9: Учёт запросов в хендлерах и приватность логов

**Files:**
- Modify: `src/handlers/onLink.ts`, `src/handlers/onArticle.ts`, `src/handlers/onDocument.ts`, `src/handlers/onSearch.ts`, `src/core/extractor.ts`

**Interfaces:**
- Consumes: `withRequest`, `currentRequest` (Task 5), `sourceLogFields` (Task 5), `getDb` (Task 5), `RequestCommand` (Task 4).
- Produces: `SummarySource.command: 'summary' | 'file'` (onLink — `'summary'`, onDocument — `'file'`); хелпер в `onLink.ts` `export function requestUser(ctx: Context): { userId: number; isAdmin: boolean }`.

- [ ] **Step 1: Проверка до правки.** `grep -rn -A12 "logger\.\(info\|warn\|error\)" src/handlers src/core/extractor.ts | grep -E "\b(url|title|query|file)\b"` — список всех мест логирования содержимого; каждое из них должно после правки идти через `sourceLogFields`.

- [ ] **Step 2: Реализация.**
  - `summarizeSource`: тело (от статуса до `finally`) — внутри `withRequest({ db: getDb(), now: Date.now }, requestUser(ctx), source.command, async () => { …; return ok })`; в обоих логах `request` — `...sourceLogFields(isAdmin, source.log)`.
  - `runArticle`: то же с `'article'`; поля `url`, `title` — через `sourceLogFields`.
  - `onSearch`: `withRequest(…, 'search', …)` вокруг поиска; `query` в обоих логах `search` и в `warn` — через `sourceLogFields`. `onSearchCommand` не оборачивать (он вызывает `runSummary`/`runArticle`, которые учитываются сами).
  - `extractor.ts`: `{ err, url, attempt }` и `{ err: lastErr, url }` → `sourceLogFields(currentRequest()?.isAdmin ?? false, { url })` разворотом.

- [ ] **Step 3: Smoke-прогон** (скрипт в `$SCRATCHPAD`, не коммитится): `DB_PATH=$SCRATCHPAD/smoke.db`, фейковый `ctx` не-админа, `summarizeSource` с `load`, возвращающим короткий markdown, и LLM, подменённым через `LLM_BASE_URL` на локальный HTTP-сервер, отдающий `{ choices: [{ message: { content: '🔑 TL;DR …' } }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cost: 0.0001 } }`. Ожидание: в `requests` одна строка `summary`, `ok = 1`; в `llm_calls` одна строка с `cost_usd = 0.0001`; в выводе логов нет `url`/`title`, есть `host`.

- [ ] **Step 4:** `npm run check` — PASS.

- [ ] **Step 5: Commit** — `feat: учёт запросов в хендлерах, в логах чужих запросов только домен`.

---

### Task 10: Инфраструктура и документация

**Files:**
- Modify: `Dockerfile`, `docker-compose.yml`, `.env.example`, `README.md`, `AGENTS.md`, `PLAN.md`

- [ ] **Step 1: Docker.** `Dockerfile` (runtime stage, до `USER node`): `RUN mkdir -p /app/data && chown node:node /app/data`. `docker-compose.yml`: у `bot` — `volumes: - bot-data:/app/data` (существующий закомментированный пример с `prompt.txt` сохранить), внизу `volumes: bot-data:`; комментарий: почему именованный том и команда бэкапа `docker compose cp bot:/app/data/bot.db .`.

- [ ] **Step 2: `.env.example`.** `ADMIN_USER_ID=` (комментарий: твой id, узнать — @userinfobot; сначала напиши боту `/start` сам, иначе он не сможет прислать заявку), `ALLOWED_USER_IDS` — «одобрены заранее, без заявки», `DB_PATH=data/bot.db`, `ACCESS_RETRY_DAYS=7`, `TZ=Europe/Moscow` (границы «сегодня» в `/stats`).

- [ ] **Step 3: Доки.**
  - README: раздел «Доступ и статистика» — как работает заявка, админские команды, бэкап базы, что содержимое запросов не хранится и не логируется.
  - AGENTS.md: в «Архитектура» — `db/`, `core/access.ts`, `core/users.ts`, `core/stats.ts`, `lib/requestContext.ts`, `lib/privacy.ts`, `lib/store.ts`, `handlers/admin.ts`, порядок middleware; в «Подводные камни» — (а) SQL только литералом + `sqlGuard.test.ts`; (б) новый путь к LLM должен идти внутри `withRequest`, иначе расход не учтётся; (в) содержимое в логах — только через `sourceLogFields`; (г) админские команды — `admin.command`, в реестре с `admin: true`; (д) `node:sqlite` грузится динамически ради тишины про ExperimentalWarning; (е) тестам с `config` нужен `ADMIN_USER_ID`. «Статус» — Этап 9 готов.
  - PLAN.md: «Этап 9 — доступ по заявкам и статистика ✅» с перечнем; лимиты и флуд-защита неодобренных — открытыми пунктами.

- [ ] **Step 4:** `npm run check` и `npm run build` — PASS; `docker compose config` — если Docker доступен (в песочнице может не быть — тогда пропустить и сказать об этом).

- [ ] **Step 5: Commit** — `docs: доступ по заявкам — Docker-том, .env.example, README/AGENTS/PLAN`; `git push`.

Финал: проверка в живом Telegram со вторым аккаунтом — за владельцем (заявка → кнопка → `/summary` → `/stats`).
