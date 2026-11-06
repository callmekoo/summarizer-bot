import type { Db } from './database.js';

// Учёт запросов и платных вызовов LLM + агрегаты для /stats. Содержимого запросов здесь
// нет: только кто, когда, какая команда, модель, токены и стоимость.
// SQL — только литералами с `?` (страж: sqlGuard.test.ts). Фильтр по пользователю —
// условием `(? IS NULL OR user_id = ?)`, без сборки запроса на лету.

export type RequestCommand = 'summary' | 'article' | 'search' | 'file';

/** Открывает запрос (одно действие пользователя) и возвращает его id. */
export function startRequest(
  db: Db,
  userId: number,
  command: RequestCommand,
  now: number,
): number {
  const r = db
    .prepare(
      'INSERT INTO requests (user_id, command, started_at) VALUES (?, ?, ?)',
    )
    .run(userId, command, now);
  return Number(r.lastInsertRowid);
}

export function finishRequest(db: Db, requestId: number, ok: boolean): void {
  db.prepare('UPDATE requests SET ok = ? WHERE id = ?').run(
    ok ? 1 : 0,
    requestId,
  );
}

export interface LlmCall {
  requestId: number;
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** null — провайдер не сообщил стоимость. */
  costUsd: number | null;
  now: number;
}

export function recordLlmCall(db: Db, call: LlmCall): void {
  db.prepare(
    `INSERT INTO llm_calls
       (request_id, created_at, model, prompt_tokens, completion_tokens, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    call.requestId,
    call.now,
    call.model,
    call.promptTokens,
    call.completionTokens,
    call.costUsd,
  );
}

export interface Totals {
  requests: number;
  /** Только запросы, закрытые с ошибкой; незакрытые (упал процесс) сюда не входят. */
  errors: number;
  promptTokens: number;
  completionTokens: number;
  /** Сумма известных стоимостей. */
  costUsd: number;
  pricedCalls: number;
  unpricedCalls: number;
}

/** Итоги с момента since (0 — всё время), по всем или по одному пользователю. */
export function totals(db: Db, since: number, userId?: number): Totals {
  const uid = userId ?? null;
  const req = db
    .prepare(
      `SELECT count(*) AS requests, coalesce(sum(ok = 0), 0) AS errors
       FROM requests
       WHERE started_at >= ? AND (? IS NULL OR user_id = ?)`,
    )
    .get(since, uid, uid) as { requests: number; errors: number };
  const llm = db
    .prepare(
      `SELECT coalesce(sum(c.prompt_tokens), 0) AS promptTokens,
              coalesce(sum(c.completion_tokens), 0) AS completionTokens,
              coalesce(sum(c.cost_usd), 0) AS costUsd,
              count(c.cost_usd) AS pricedCalls,
              coalesce(sum(c.cost_usd IS NULL), 0) AS unpricedCalls
       FROM llm_calls c JOIN requests r ON r.id = c.request_id
       WHERE r.started_at >= ? AND (? IS NULL OR r.user_id = ?)`,
    )
    .get(since, uid, uid) as Omit<Totals, 'requests' | 'errors'>;
  return {
    requests: req.requests,
    errors: req.errors,
    promptTokens: llm.promptTokens,
    completionTokens: llm.completionTokens,
    costUsd: llm.costUsd,
    pricedCalls: llm.pricedCalls,
    unpricedCalls: llm.unpricedCalls,
  };
}

export interface TopRow {
  userId: number;
  requests: number;
  tokens: number;
  costUsd: number;
}

/** Кто больше всех потратил с момента since: по стоимости, при равенстве — по токенам. */
export function topUsers(db: Db, since: number, limit: number): TopRow[] {
  return db
    .prepare(
      `SELECT r.user_id AS userId,
              count(DISTINCT r.id) AS requests,
              coalesce(sum(c.prompt_tokens + c.completion_tokens), 0) AS tokens,
              coalesce(sum(c.cost_usd), 0) AS costUsd
       FROM requests r LEFT JOIN llm_calls c ON c.request_id = r.id
       WHERE r.started_at >= ?
       GROUP BY r.user_id
       ORDER BY costUsd DESC, tokens DESC, r.user_id
       LIMIT ?`,
    )
    .all(since, limit)
    .map((r) => ({ ...(r as unknown as TopRow) }));
}

/** Сколько раз пользователь вызывал каждую команду, за всё время. */
export function commandBreakdown(
  db: Db,
  userId: number,
): { command: RequestCommand; requests: number }[] {
  return db
    .prepare(
      `SELECT command, count(*) AS requests FROM requests WHERE user_id = ?
       GROUP BY command ORDER BY requests DESC, command`,
    )
    .all(userId)
    .map((r) => {
      const row = r as { command: RequestCommand; requests: number };
      return { command: row.command, requests: row.requests };
    });
}

export function lastRequestAt(db: Db, userId: number): number | null {
  const r = db
    .prepare('SELECT max(started_at) AS at FROM requests WHERE user_id = ?')
    .get(userId) as { at: number | null };
  return r.at;
}
