import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type * as Complete from './complete.js';

// complete → llm-client → config валидирует env при импорте, поэтому задаём
// окружение заранее и подгружаем модуль динамически.
let retryAfterMs: typeof Complete.retryAfterMs;
let isOpenRouter: typeof Complete.isOpenRouter;
let mapUsage: typeof Complete.mapUsage;

before(async () => {
  process.env.DOTENV_CONFIG_PATH = '/dev/null'; // не зависеть от реального .env
  process.env.BOT_TOKEN = 'test-token';
  process.env.LLM_API_KEY = 'test-key';
  process.env.MODEL = 'test/model';
  process.env.ADMIN_USER_ID = '1';
  ({ retryAfterMs, isOpenRouter, mapUsage } = await import('./complete.js'));
});

test('retryAfterMs: заголовок в нативном Headers (форма openai v5+)', () => {
  const err = { status: 429, headers: new Headers({ 'retry-after': '7' }) };
  assert.equal(retryAfterMs(err), 7_000);
});

test('retryAfterMs: заголовок обычным объектом (старая форма и моки)', () => {
  assert.equal(
    retryAfterMs({ status: 429, headers: { 'retry-after': '3' } }),
    3_000,
  );
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

test('isOpenRouter: только openrouter.ai и его поддомены', () => {
  assert.equal(isOpenRouter('https://openrouter.ai/api/v1'), true);
  assert.equal(isOpenRouter('https://eu.openrouter.ai/api/v1'), true);
  assert.equal(isOpenRouter('https://api.openai.com/v1'), false);
  assert.equal(isOpenRouter('http://localhost:11434/v1'), false);
  assert.equal(isOpenRouter('https://notopenrouter.ai/v1'), false);
});

test('mapUsage: стоимость из usage.cost', () => {
  assert.deepEqual(
    mapUsage({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      cost: 0.0012,
    }),
    { prompt: 10, completion: 5, total: 15, costUsd: 0.0012 },
  );
});

test('mapUsage: нет или мусорная стоимость → null', () => {
  const base = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
  assert.equal(mapUsage(base)?.costUsd, null);
  assert.equal(mapUsage({ ...base, cost: '0.1' })?.costUsd, null);
  assert.equal(mapUsage({ ...base, cost: -1 })?.costUsd, null);
  assert.equal(mapUsage({ ...base, cost: Number.NaN })?.costUsd, null);
  assert.equal(mapUsage(undefined), undefined);
});
