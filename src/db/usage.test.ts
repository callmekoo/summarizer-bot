import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, type Db } from './database.js';
import {
  startRequest,
  finishRequest,
  recordLlmCall,
  totals,
  topUsers,
  commandBreakdown,
  lastRequestAt,
} from './usage.js';

const T = Date.UTC(2026, 10, 6, 12);
const A = 1;
const B = 2;
let db: Db;

beforeEach(async () => {
  db = await openDatabase(':memory:');
});

function call(requestId: number, costUsd: number | null, tokens = 100) {
  recordLlmCall(db, {
    requestId,
    model: 'm',
    promptTokens: tokens,
    completionTokens: tokens / 10,
    costUsd,
    now: T,
  });
}

test('пустая база — нули', () => {
  assert.deepEqual(totals(db, 0), {
    requests: 0,
    errors: 0,
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
    pricedCalls: 0,
    unpricedCalls: 0,
  });
  assert.deepEqual(topUsers(db, 0, 5), []);
  assert.deepEqual(commandBreakdown(db, A), []);
  assert.equal(lastRequestAt(db, A), null);
});

test('агрегаты: период, токены, стоимость с неизвестной частью', () => {
  const old = startRequest(db, A, 'summary', T - 1000);
  finishRequest(db, old, true);
  call(old, 0.5);

  const article = startRequest(db, A, 'article', T);
  call(article, 0.001);
  call(article, 0.002);
  call(article, null);
  finishRequest(db, article, true);

  const t = totals(db, T);
  assert.equal(t.requests, 1);
  assert.equal(t.errors, 0);
  assert.equal(t.promptTokens, 300);
  assert.equal(t.completionTokens, 30);
  assert.ok(Math.abs(t.costUsd - 0.003) < 1e-12);
  assert.equal(t.pricedCalls, 2);
  assert.equal(t.unpricedCalls, 1);

  assert.equal(totals(db, 0).requests, 2);
});

test('незакрытый запрос считается, но не как ошибка', () => {
  startRequest(db, A, 'summary', T);
  const failed = startRequest(db, A, 'summary', T);
  finishRequest(db, failed, false);
  const t = totals(db, 0);
  assert.equal(t.requests, 2);
  assert.equal(t.errors, 1);
});

test('фильтр по пользователю', () => {
  call(startRequest(db, A, 'summary', T), 0.1);
  call(startRequest(db, B, 'summary', T), 0.2);
  const a = totals(db, 0, A);
  assert.equal(a.requests, 1);
  assert.ok(Math.abs(a.costUsd - 0.1) < 1e-12);
});

test('топ по стоимости, затем по токенам; limit', () => {
  call(startRequest(db, A, 'summary', T), 0.1);
  call(startRequest(db, B, 'summary', T), 0.2);
  call(startRequest(db, 3, 'summary', T), null, 5000);
  const top = topUsers(db, 0, 2);
  assert.deepEqual(
    top.map((r) => r.userId),
    [B, A],
  );
  assert.equal(top[0]!.requests, 1);
  assert.equal(top[0]!.tokens, 110);
  assert.equal(topUsers(db, 0, 5).length, 3);
});

test('разбивка по командам и последний запрос', () => {
  startRequest(db, A, 'summary', T);
  startRequest(db, A, 'summary', T + 1);
  startRequest(db, A, 'file', T + 2);
  startRequest(db, B, 'article', T + 3);
  assert.deepEqual(commandBreakdown(db, A), [
    { command: 'summary', requests: 2 },
    { command: 'file', requests: 1 },
  ]);
  assert.equal(lastRequestAt(db, A), T + 2);
});

test('топ: сколько вызовов с известной и неизвестной стоимостью', () => {
  const r = startRequest(db, A, 'article', T);
  call(r, 0.001);
  call(r, null);
  call(r, null);
  const [row] = topUsers(db, 0, 5);
  assert.equal(row!.pricedCalls, 1);
  assert.equal(row!.unpricedCalls, 2);
});

test('топ: запрос без вызовов LLM не считается неоценённым', () => {
  startRequest(db, A, 'search', T);
  const [row] = topUsers(db, 0, 5);
  assert.equal(row!.pricedCalls, 0);
  assert.equal(row!.unpricedCalls, 0);
});
