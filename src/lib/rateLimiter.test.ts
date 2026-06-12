import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from './rateLimiter.js';

test('пропускает до max обращений в окне', () => {
  const rl = createRateLimiter(2, 1000);
  assert.equal(rl.check('u', 0).allowed, true);
  assert.equal(rl.check('u', 100).allowed, true);
  const denied = rl.check('u', 200);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterMs, 800, 'retryAfter = когда выпадет самый старый хит');
});

test('окно скользит: после истечения снова можно', () => {
  const rl = createRateLimiter(1, 1000);
  assert.equal(rl.check('u', 0).allowed, true);
  assert.equal(rl.check('u', 500).allowed, false);
  assert.equal(rl.check('u', 1001).allowed, true, 'первый хит выпал из окна');
});

test('ключи независимы', () => {
  const rl = createRateLimiter(1, 1000);
  assert.equal(rl.check('a', 0).allowed, true);
  assert.equal(rl.check('b', 0).allowed, true, 'другой пользователь не затронут');
  assert.equal(rl.check('a', 0).allowed, false);
});

test('retryAfterMs не отрицательный', () => {
  const rl = createRateLimiter(1, 1000);
  rl.check('u', 0);
  assert.ok(rl.check('u', 0).retryAfterMs >= 0);
});
