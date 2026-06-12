import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { capTokens as CapTokens } from './summarizer.js';

// summarizer → openrouter → config валидирует env при импорте, поэтому задаём
// окружение заранее и подгружаем модуль динамически.
let capTokens: typeof CapTokens;

before(async () => {
  process.env.BOT_TOKEN = 'test-token';
  process.env.OPENROUTER_API_KEY = 'test-key';
  ({ capTokens } = await import('./summarizer.js'));
});

test('capTokens: короткий текст не трогается', () => {
  const r = capTokens('короткий текст', 1000);
  assert.equal(r.truncated, false);
  assert.equal(r.keptPercent, 100);
  assert.equal(r.text, 'короткий текст');
});

test('capTokens: длинный текст обрезается, считается процент', () => {
  // Много токенов при крошечном лимите → обрезка.
  const text = 'word '.repeat(5000);
  const r = capTokens(text, 100);
  assert.equal(r.truncated, true);
  assert.ok(r.text.length < text.length, 'текст реально укоротился');
  assert.ok(r.keptPercent > 0 && r.keptPercent < 100, `keptPercent в (0,100): ${r.keptPercent}`);
});
