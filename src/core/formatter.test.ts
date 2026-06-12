import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toTelegramHtml, splitForTelegram } from './formatter.js';

test('toTelegramHtml экранирует спецсимволы HTML', () => {
  const out = toTelegramHtml('теги <div> и & «амперсанд» > конец');
  assert.ok(out.includes('&lt;div&gt;'), 'угловые скобки экранированы');
  assert.ok(out.includes(' &amp; '), 'амперсанд экранирован');
  assert.ok(!out.includes('<div>'), 'нет сырого тега');
});

test('toTelegramHtml превращает **жирный** в <b>…</b>', () => {
  assert.equal(toTelegramHtml('**Заголовок**'), '<b>Заголовок</b>');
});

test('toTelegramHtml: бол вокруг экранированного текста остаётся валидным HTML', () => {
  // Звёздочки вокруг текста с < должны дать <b> поверх уже экранированного содержимого.
  assert.equal(toTelegramHtml('**a < b**'), '<b>a &lt; b</b>');
});

test('toTelegramHtml обрезает ведущие/замыкающие пробелы', () => {
  assert.equal(toTelegramHtml('  привет  '), 'привет');
});

test('splitForTelegram не трогает короткий текст', () => {
  assert.deepEqual(splitForTelegram('коротко', 4096), ['коротко']);
});

test('splitForTelegram режет по границам строк, каждая часть в пределах лимита', () => {
  const text = Array.from({ length: 50 }, (_, i) => `строка ${i}`).join('\n');
  const parts = splitForTelegram(text, 30);
  assert.ok(parts.length > 1, 'текст разбит на несколько частей');
  for (const p of parts) assert.ok(p.length <= 30, `часть в пределах лимита: "${p}"`);
  // Склейка обратно даёт исходные строки (границы — переводы строк).
  assert.deepEqual(parts.join('\n').split('\n'), text.split('\n'));
});

test('splitForTelegram жёстко режет одиночную строку длиннее лимита', () => {
  const long = 'x'.repeat(25);
  const parts = splitForTelegram(long, 10);
  for (const p of parts) assert.ok(p.length <= 10);
  assert.equal(parts.join(''), long);
});

test('splitForTelegram: текст ровно по лимиту не режется', () => {
  const text = 'a'.repeat(10);
  assert.deepEqual(splitForTelegram(text, 10), [text]);
});
