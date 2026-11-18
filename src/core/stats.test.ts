import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  periodStarts,
  formatCost,
  renderStats,
  renderUserStats,
  renderUsers,
  type PeriodTotals,
} from './stats.js';
import { splitForTelegram } from './formatter.js';
import type { Totals } from '../db/usage.js';
import type { UserRow } from './users.js';

const ZERO: Totals = {
  requests: 0,
  errors: 0,
  promptTokens: 0,
  completionTokens: 0,
  costUsd: 0,
  pricedCalls: 0,
  unpricedCalls: 0,
};

const periods = (t: Totals): PeriodTotals[] =>
  ['Сегодня', '7 дней', '30 дней', 'Всё время'].map((label) => ({
    label,
    totals: t,
  }));

function user(id: number, over: Partial<UserRow> = {}): UserRow {
  return {
    id,
    username: null,
    firstName: 'Иван',
    lastName: null,
    status: 'approved',
    requestedAt: Date.UTC(2026, 10, 1, 12),
    decidedAt: null,
    retryAfter: null,
    ...over,
  };
}

test('periodStarts: полночь сегодня, 7 и 30 дней назад включая сегодня', () => {
  const p = periodStarts(new Date(2026, 10, 6, 15, 30));
  assert.equal(p.today, new Date(2026, 10, 6).getTime());
  assert.equal(p.week, new Date(2026, 9, 31).getTime());
  assert.equal(p.month, new Date(2026, 9, 8).getTime());
});

test('formatCost: без вызовов, неизвестно, частично, полностью', () => {
  assert.equal(
    formatCost({ costUsd: 0, pricedCalls: 0, unpricedCalls: 0 }),
    '$0',
  );
  assert.equal(
    formatCost({ costUsd: 0, pricedCalls: 0, unpricedCalls: 2 }),
    '$ —',
  );
  assert.equal(
    formatCost({ costUsd: 0.003, pricedCalls: 2, unpricedCalls: 1 }),
    '$0.0030 + н/д',
  );
  assert.equal(
    formatCost({ costUsd: 0.003, pricedCalls: 2, unpricedCalls: 0 }),
    '$0.0030',
  );
});

test('пустая база: нули и «нет данных», без NaN/undefined/null', () => {
  const text = renderStats(periods(ZERO), []);
  assert.ok(text.includes('нет данных'));
  assert.ok(text.includes('Сегодня'));
  for (const bad of ['NaN', 'undefined', 'null']) {
    assert.ok(!text.includes(bad), bad);
  }
});

test('строка периода и топ', () => {
  const t: Totals = {
    ...ZERO,
    requests: 3,
    errors: 1,
    promptTokens: 12_000,
    completionTokens: 345,
    costUsd: 0.003,
    pricedCalls: 2,
  };
  const text = renderStats(periods(t), [
    {
      row: {
        userId: 5,
        requests: 5,
        tokens: 100,
        costUsd: 0.003,
        pricedCalls: 2,
        unpricedCalls: 0,
      },
      user: user(5, { username: 'ivanp' }),
    },
    {
      row: {
        userId: 6,
        requests: 1,
        tokens: 1,
        costUsd: 0,
        pricedCalls: 0,
        unpricedCalls: 0,
      },
      user: undefined,
    },
  ]);
  assert.ok(text.includes('<b>Сегодня</b>: 3 запр. (1 ошиб.)'));
  assert.ok(text.includes('$0.0030'));
  assert.ok(text.includes('1. @ivanp (Иван, id 5) — $0.0030, 5 запр.'));
  // Пользователя нет в базе (старые данные) — хотя бы id.
  assert.ok(text.includes('2. id 6 — $0, 1 запр.'));
});

test('имена экранируются', () => {
  const text = renderUsers([user(1, { firstName: '<b>x</b>' })]);
  assert.ok(text.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(!text.includes('<b>x</b>'));
});

test('renderUsers: группы и пустой список', () => {
  assert.equal(renderUsers([]), 'Пользователей пока нет.');
  const text = renderUsers([
    user(1),
    user(2, { status: 'pending' }),
    user(3, { status: 'banned' }),
  ]);
  assert.ok(text.includes('Одобрены'));
  assert.ok(text.includes('Ждут'));
  assert.ok(text.includes('Забанены'));
  assert.ok(!text.includes('Отклонены'));
  assert.ok(text.includes('без ника (Иван, id 1), 01.11.2026'));
});

test('renderUsers: у повторной заявки — дата заявки, а не старого отказа', () => {
  const text = renderUsers([
    user(1, {
      status: 'pending',
      decidedAt: Date.UTC(2026, 9, 1, 12), // старый отказ
      requestedAt: Date.UTC(2026, 10, 10, 12), // новая заявка
    }),
  ]);
  assert.ok(text.includes('10.11.2026'), text);
  assert.ok(!text.includes('01.10.2026'), text);
});

test('renderUserStats: заголовок в формате @ник (Имя, id)', () => {
  const text = renderUserStats(
    user(5, { username: 'ivanp' }),
    periods(ZERO),
    [],
    null,
  );
  assert.ok(text.startsWith('<b>@ivanp (Иван, id 5)</b> — одобрен'), text);
});

test('renderUserStats без запросов', () => {
  const text = renderUserStats(user(1), periods(ZERO), [], null);
  assert.ok(text.includes('нет данных'));
  assert.ok(text.includes('—'));
  assert.ok(!text.includes('null'));
});

test('renderUserStats с разбивкой по командам', () => {
  const text = renderUserStats(
    user(1),
    periods(ZERO),
    [
      { command: 'summary', requests: 12 },
      { command: 'file', requests: 1 },
    ],
    Date.UTC(2026, 10, 5, 12),
  );
  assert.ok(text.includes('summary — 12'));
  assert.ok(text.includes('file — 1'));
  assert.ok(text.includes('05.11.2026'));
});

test('300 пользователей режутся на части ≤ 4096 и ничего не теряют', () => {
  const users = Array.from({ length: 300 }, (_, i) =>
    user(1_000_000 + i, { firstName: 'Пользователь с длинным именем' }),
  );
  const parts = splitForTelegram(renderUsers(users));
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(p.length <= 4096);
  const all = parts.join('\n');
  for (const u of users) assert.ok(all.includes(`id ${u.id}`), String(u.id));
});

test('топ: стоимость по тем же правилам, что у периодов', () => {
  const top = (pricedCalls: number, unpricedCalls: number, costUsd: number) =>
    renderStats(periods(ZERO), [
      {
        row: {
          userId: 5,
          requests: 1,
          tokens: 10,
          costUsd,
          pricedCalls,
          unpricedCalls,
        },
        user: user(5, { username: 'ivanp' }),
      },
    ]);
  assert.ok(top(0, 2, 0).includes('— $ —, 1 запр.'));
  assert.ok(top(1, 1, 0.002).includes('— $0.0020 + н/д, 1 запр.'));
  assert.ok(top(1, 0, 0.002).includes('— $0.0020, 1 запр.'));
  assert.ok(top(0, 0, 0).includes('— $0, 1 запр.'));
});
