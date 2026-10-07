import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { isAllowed as IsAllowed } from './allowlist.js';

// allowlist → config валидирует env при импорте, поэтому задаём окружение заранее и
// подгружаем модуль динамически (как в summarizer.test.ts).
let isAllowed: typeof IsAllowed;

before(async () => {
  process.env.DOTENV_CONFIG_PATH = '/dev/null'; // не зависеть от реального .env
  process.env.BOT_TOKEN = 'test-token';
  process.env.LLM_API_KEY = 'test-key';
  process.env.MODEL = 'test/model';
  ({ isAllowed } = await import('./allowlist.js'));
});

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
