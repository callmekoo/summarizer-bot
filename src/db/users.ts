import type { Db } from './database.js';
import type { UserRow, UserStatus } from '../core/users.js';

// Репозиторий пользователей. База — параметром, чтобы тесты шли на :memory:.
// SQL — только литералами с `?` (страж: sqlGuard.test.ts).

/** Профиль из Telegram; совместим с `User` из grammY. */
export interface TgProfile {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface Row {
  id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  status: UserStatus;
  requested_at: number | null;
  decided_at: number | null;
  retry_after: number | null;
}

function rowToUser(r: Row): UserRow {
  return {
    id: r.id,
    username: r.username,
    firstName: r.first_name,
    lastName: r.last_name,
    status: r.status,
    requestedAt: r.requested_at,
    decidedAt: r.decided_at,
    retryAfter: r.retry_after,
  };
}

export function getUser(db: Db, id: number): UserRow | undefined {
  const r = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return r ? rowToUser(r as unknown as Row) : undefined;
}

/**
 * Освежает ник и имя у пользователя, который уже есть в базе (строку не создаёт). Ник в
 * Telegram уникален, но переходит к другим: у прочих строк он обнуляется, чтобы
 * `findUser('@ник')` находил актуального владельца.
 */
export function touchProfile(db: Db, p: TgProfile): UserRow | undefined {
  if (!getUser(db, p.id)) return undefined;
  releaseUsername(db, p);
  db.prepare(
    'UPDATE users SET username = ?, first_name = ?, last_name = ? WHERE id = ?',
  ).run(p.username ?? null, p.first_name ?? null, p.last_name ?? null, p.id);
  return getUser(db, p.id);
}

/**
 * Владелец: держим его профиль в базе, чтобы в /stats он был виден по нику, а
 * `/stats @свой_ник` его находил. Статус всегда approved (проверку доступа он не проходит).
 */
export function touchAdmin(db: Db, p: TgProfile, now: number): void {
  releaseUsername(db, p);
  db.prepare(
    `INSERT INTO users (id, username, first_name, last_name, status, decided_at)
     VALUES (?, ?, ?, ?, 'approved', ?)
     ON CONFLICT(id) DO UPDATE SET
       username = excluded.username,
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       status = 'approved'`,
  ).run(
    p.id,
    p.username ?? null,
    p.first_name ?? null,
    p.last_name ?? null,
    now,
  );
}

/** Новая (или повторная после отказа) заявка: статус pending, кулдаун сброшен. */
export function createApplication(db: Db, p: TgProfile, now: number): UserRow {
  releaseUsername(db, p);
  db.prepare(
    `INSERT INTO users (id, username, first_name, last_name, status, requested_at)
     VALUES (?, ?, ?, ?, 'pending', ?)
     ON CONFLICT(id) DO UPDATE SET
       username = excluded.username,
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       status = 'pending',
       requested_at = excluded.requested_at,
       retry_after = NULL`,
  ).run(
    p.id,
    p.username ?? null,
    p.first_name ?? null,
    p.last_name ?? null,
    now,
  );
  return getUser(db, p.id)!;
}

/** Решение владельца. `undefined`, если такого пользователя нет. */
export function setStatus(
  db: Db,
  id: number,
  status: UserStatus,
  now: number,
  retryAfter: number | null = null,
): UserRow | undefined {
  db.prepare(
    'UPDATE users SET status = ?, decided_at = ?, retry_after = ? WHERE id = ?',
  ).run(status, now, retryAfter, id);
  return getUser(db, id);
}

/**
 * Одобренные заранее (ALLOWED_USER_IDS). Добавляет новых и одобряет ждущих; решение
 * владельца (отказ, /revoke, бан) не перебивает — иначе рестарт молча вернул бы доступ.
 * Вернуть человека — /approve.
 */
export function seedApproved(
  db: Db,
  ids: readonly number[],
  now: number,
): void {
  const stmt = db.prepare(
    `INSERT INTO users (id, status, decided_at) VALUES (?, 'approved', ?)
     ON CONFLICT(id) DO UPDATE SET status = 'approved', decided_at = excluded.decided_at,
       retry_after = NULL
     WHERE users.status = 'pending'`,
  );
  for (const id of ids) stmt.run(id, now);
}

/** Все пользователи: одобренные, ждущие, отклонённые, забаненные; свежие заявки выше. */
export function listUsers(db: Db): UserRow[] {
  return db
    .prepare(
      `SELECT * FROM users ORDER BY
         CASE status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1
                     WHEN 'rejected' THEN 2 ELSE 3 END,
         requested_at DESC, id`,
    )
    .all()
    .map((r) => rowToUser(r as unknown as Row));
}

/** Поиск по id (`123`) или нику (`@ivanp`, `ivanp`, без учёта регистра). */
export function findUser(db: Db, query: string): UserRow | undefined {
  const q = query.trim();
  if (/^\d+$/.test(q)) return getUser(db, Number(q));
  const nick = q.match(/^@?([A-Za-z0-9_]{1,32})$/)?.[1];
  if (!nick) return undefined;
  const r = db
    .prepare('SELECT * FROM users WHERE lower(username) = lower(?)')
    .get(nick);
  return r ? rowToUser(r as unknown as Row) : undefined;
}

function releaseUsername(db: Db, p: TgProfile): void {
  if (!p.username) return;
  db.prepare(
    'UPDATE users SET username = NULL WHERE lower(username) = lower(?) AND id <> ?',
  ).run(p.username, p.id);
}
