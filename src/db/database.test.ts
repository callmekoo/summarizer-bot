import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, SCHEMA_VERSION } from './database.js';

// database.ts не тянет config — импортируем статически, без env.

test('openDatabase(:memory:) создаёт схему и ставит версию', async () => {
  const db = await openDatabase(':memory:');
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => r.name);
  for (const t of ['users', 'requests', 'llm_calls']) {
    assert.ok(tables.includes(t), `нет таблицы ${t}`);
  }
  const { user_version } = db.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };
  assert.equal(user_version, SCHEMA_VERSION);
  assert.equal(SCHEMA_VERSION, 1);
  db.close();
});

test('файл: каталоги создаются, повторное открытие не теряет данные', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'bot-')), 'nested', 'x.db');
  const first = await openDatabase(path);
  first.prepare("INSERT INTO users (id, status) VALUES (?, 'pending')").run(7);
  first.close();

  const second = await openDatabase(path);
  const row = second.prepare('SELECT id FROM users WHERE id = ?').get(7);
  assert.equal(row?.id, 7);
  second.close();
});
