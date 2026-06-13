import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toTelegramHtml, splitForTelegram, renderSourceHeader } from './formatter.js';

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

test('toTelegramHtml: инлайн-код `…` → <code>, без сырых бэктиков', () => {
  const out = toTelegramHtml('зови `parseUrl()` для разбора');
  assert.equal(out, 'зови <code>parseUrl()</code> для разбора');
  assert.ok(!out.includes('`'), 'сырых бэктиков не осталось');
});

test('toTelegramHtml: блок ```…``` → <pre>, тег языка отброшен', () => {
  const out = toTelegramHtml('пример:\n```js\nconst x = 1;\n```');
  assert.equal(out, 'пример:\n<pre>const x = 1;</pre>');
});

test('toTelegramHtml: содержимое кода тоже экранируется', () => {
  assert.equal(toTelegramHtml('`a < b && c`'), '<code>a &lt; b &amp;&amp; c</code>');
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

test('renderSourceHeader: заголовок-ссылка + сайт + автор', () => {
  const h = renderSourceHeader({
    url: 'https://habr.com/p/1',
    title: 'Заголовок',
    author: 'Иван',
    site: 'Хабр',
  });
  assert.equal(h, '<a href="https://habr.com/p/1"><b>Заголовок</b></a>\n🌐 Хабр · ✍️ Иван');
});

test('renderSourceHeader экранирует html в полях и href', () => {
  const h = renderSourceHeader({
    url: 'https://x.test/?a=1&b=2',
    title: 'A <b> & "C"',
    site: 'Site & Co',
  });
  assert.ok(h.includes('href="https://x.test/?a=1&amp;b=2"'), 'амперсанд в href экранирован');
  // В тексте элемента экранируем только < > &; кавычки внутри текста допустимы как есть.
  assert.ok(h.includes('<b>A &lt;b&gt; &amp; "C"</b>'), 'текст заголовка экранирован');
  assert.ok(h.includes('🌐 Site &amp; Co'));
  assert.ok(!h.includes('✍️'), 'автора нет — строка без него');
});

test('renderSourceHeader: только сайт, без заголовка', () => {
  assert.equal(renderSourceHeader({ url: 'https://x.test', site: 'X' }), '🌐 X');
});

test('renderSourceHeader: нет метаданных → пустая строка', () => {
  assert.equal(renderSourceHeader({ url: 'https://x.test' }), '');
});
