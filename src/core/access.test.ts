import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideAccess, ACCESS_TEXT, formatRetryDate } from './access.js';
import type { UserRow, UserStatus } from './users.js';

const NOW = Date.UTC(2026, 10, 6, 12);
const DAY = 86_400_000;

function user(status: UserStatus, retryAfter: number | null = null): UserRow {
  return {
    id: 5,
    username: 'ivanp',
    firstName: 'Иван',
    lastName: null,
    status,
    requestedAt: NOW - DAY,
    decidedAt: null,
    retryAfter,
  };
}

test('админ проходит всегда, даже без строки в базе и с баном', () => {
  assert.deepEqual(decideAccess(undefined, true, NOW), { kind: 'pass' });
  assert.deepEqual(decideAccess(user('banned'), true, NOW), { kind: 'pass' });
});

test('незнакомец подаёт заявку', () => {
  assert.deepEqual(decideAccess(undefined, false, NOW), { kind: 'apply' });
});

test('статусы: approved проходит, pending ждёт, banned игнорируется', () => {
  assert.deepEqual(decideAccess(user('approved'), false, NOW), {
    kind: 'pass',
  });
  assert.deepEqual(decideAccess(user('pending'), false, NOW), {
    kind: 'pending',
  });
  assert.deepEqual(decideAccess(user('banned'), false, NOW), {
    kind: 'ignore',
  });
});

test('отклонённый: до срока — отказ с датой, после — новая заявка', () => {
  const until = NOW + DAY;
  assert.deepEqual(decideAccess(user('rejected', until), false, NOW), {
    kind: 'rejected',
    until,
  });
  assert.deepEqual(decideAccess(user('rejected', until), false, until), {
    kind: 'apply',
  });
  assert.deepEqual(decideAccess(user('rejected', null), false, NOW), {
    kind: 'apply',
  });
});

test('текст отказа содержит дату ДД.ММ', () => {
  const until = Date.UTC(2026, 10, 13, 12);
  assert.equal(formatRetryDate(until), '13.11');
  assert.ok(ACCESS_TEXT.rejected(until).includes('13.11'));
});
