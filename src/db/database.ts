import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
// Только тип: сам модуль грузим динамически, см. openDatabase.
import type { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

/** Версия схемы в PRAGMA user_version — пригодится для будущих миграций. */
export const SCHEMA_VERSION = 1;

/**
 * Открывает базу (':memory:' или файл; каталог создаётся) и приводит схему к актуальной.
 *
 * node:sqlite в Node 22 печатает ExperimentalWarning при загрузке. Статический импорт
 * выполнился бы раньше любого нашего кода, поэтому модуль грузим динамически, а это
 * единственное предупреждение глушим — прочие проходят как есть.
 */
export async function openDatabase(path: string): Promise<Db> {
  silenceSqliteWarning();
  const { DatabaseSync } = await import('node:sqlite');

  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  // Схема из спеки. Время — Unix ms. Содержимого запросов (url, title, query, имена
  // файлов) здесь нет и быть не должно: владелец не видит, что присылают другие.
  // Литералом прямо в exec — этого требует страж sqlGuard.test.ts.
  db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY,
  username     TEXT,
  first_name   TEXT,
  last_name    TEXT,
  status       TEXT NOT NULL,
  requested_at INTEGER,
  decided_at   INTEGER,
  retry_after  INTEGER
);
CREATE INDEX IF NOT EXISTS users_username ON users(lower(username));

CREATE TABLE IF NOT EXISTS requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  command     TEXT NOT NULL,
  started_at  INTEGER NOT NULL,
  ok          INTEGER
);
CREATE INDEX IF NOT EXISTS requests_user_time ON requests(user_id, started_at);
CREATE INDEX IF NOT EXISTS requests_time ON requests(started_at);

CREATE TABLE IF NOT EXISTS llm_calls (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id        INTEGER NOT NULL REFERENCES requests(id),
  created_at        INTEGER NOT NULL,
  model             TEXT NOT NULL,
  prompt_tokens     INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  cost_usd          REAL
);
CREATE INDEX IF NOT EXISTS llm_calls_request ON llm_calls(request_id);
`);
  db.exec('PRAGMA user_version = 1');
  return db;
}

let silenced = false;

function silenceSqliteWarning(): void {
  if (silenced) return;
  silenced = true;
  const original = process.emitWarning.bind(process);
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === 'string' ? warning : warning.message;
    if (text.includes('SQLite is an experimental feature')) return;
    (original as (...args: unknown[]) => void)(warning, ...rest);
  }) as typeof process.emitWarning;
}
