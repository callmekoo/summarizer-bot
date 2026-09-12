import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { retryAfterMs as RetryAfterMs } from './complete.js';

// complete → llm-client → config валидирует env при импорте, поэтому задаём
// окружение заранее и подгружаем модуль динамически.
let retryAfterMs: typeof RetryAfterMs;

before(async () => {
  process.env.DOTENV_CONFIG_PATH = '/dev/null'; // не зависеть от реального .env
  process.env.BOT_TOKEN = 'test-token';
  process.env.LLM_API_KEY = 'test-key';
  process.env.MODEL = 'test/model';
  ({ retryAfterMs } = await import('./complete.js'));
});

test('retryAfterMs: заголовок в нативном Headers (форма openai v5+)', () => {
  const err = { status: 429, headers: new Headers({ 'retry-after': '7' }) };
  assert.equal(retryAfterMs(err), 7_000);
});

test('retryAfterMs: заголовок обычным объектом (старая форма и моки)', () => {
  assert.equal(retryAfterMs({ status: 429, headers: { 'retry-after': '3' } }), 3_000);
});

test('retryAfterMs: metadata OpenRouter важнее заголовка', () => {
  const err = {
    status: 429,
    headers: new Headers({ 'retry-after': '7' }),
    error: { metadata: { retry_after_seconds: 2 } },
  };
  assert.equal(retryAfterMs(err), 2_000);
});

test('retryAfterMs: нет данных — дефолтные 5 секунд', () => {
  assert.equal(retryAfterMs({ status: 429 }), 5_000);
  assert.equal(retryAfterMs({ status: 429, headers: new Headers() }), 5_000);
  assert.equal(retryAfterMs(new Error('нет заголовков вовсе')), 5_000);
});
