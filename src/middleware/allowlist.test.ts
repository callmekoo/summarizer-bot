import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowed } from './allowlist.js';

test('пустой список = allowlist выключен, пускаем всех', () => {
  assert.equal(isAllowed([], 123), true);
  assert.equal(isAllowed([], undefined), true);
});

test('пользователь из списка проходит', () => {
  assert.equal(isAllowed([111, 222, 333], 222), true);
});

test('пользователь не из списка отклоняется', () => {
  assert.equal(isAllowed([111, 222], 999), false);
});

test('без user id (undefined) отклоняется при непустом списке', () => {
  assert.equal(isAllowed([111], undefined), false);
});
