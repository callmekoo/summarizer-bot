import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { userPrompt as UserPrompt } from './prompts.js';

// prompts → config валидирует env при импорте, поэтому задаём окружение заранее
// и подгружаем модуль динамически (как в summarizer.test.ts).
let userPrompt: typeof UserPrompt;

before(async () => {
  process.env.DOTENV_CONFIG_PATH = '/dev/null';
  process.env.BOT_TOKEN = 'test-token';
  process.env.LLM_API_KEY = 'test-key';
  process.env.MODEL = 'test/model';
  ({ userPrompt } = await import('./prompts.js'));
});

const MARKERS = /⟦SOURCE ([0-9a-f]+)⟧\n([\s\S]*)\n⟦\/SOURCE ([0-9a-f]+)⟧/;

test('userPrompt оборачивает текст в маркеры с совпадающим кодом', () => {
  const out = userPrompt(undefined, 'тело статьи');
  const m = out.match(MARKERS);
  assert.ok(m, 'есть пара маркеров SOURCE');
  assert.equal(m[1], m[3], 'код открывающего и закрывающего маркера совпадает');
  assert.equal(m[2], 'тело статьи', 'внутри блока — ровно исходный текст');
});

test('userPrompt: заголовок попадает ВНУТРЬ блока (он тоже недоверенный)', () => {
  const out = userPrompt('Заголовок от сайта', 'тело');
  const m = out.match(MARKERS);
  assert.ok(m, 'есть маркеры');
  assert.ok(m[2].includes('Заголовок: Заголовок от сайта'), 'заголовок внутри блока');
  assert.ok(m[2].includes('тело'));
});

test('userPrompt: код случайный — разный между запросами', () => {
  const a = userPrompt(undefined, 'x').match(MARKERS)?.[1];
  const b = userPrompt(undefined, 'x').match(MARKERS)?.[1];
  assert.notEqual(a, b, 'код различается между вызовами');
});

test('userPrompt: инструкции к пересказу лежат СНАРУЖИ блока', () => {
  const out = userPrompt(undefined, 'материал');
  const closeIdx = out.indexOf('⟦/SOURCE');
  assert.ok(out.indexOf('Сделай краткий пересказ') > closeIdx, 'команда после закрытия блока');
});
