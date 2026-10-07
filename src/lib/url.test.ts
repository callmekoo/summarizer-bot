import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUrl } from './url.js';

test('extractUrl достаёт ссылку из текста с обрамлением', () => {
  assert.equal(
    extractUrl('глянь это https://habr.com/ru/articles/123 интересно'),
    'https://habr.com/ru/articles/123',
  );
});

test('extractUrl берёт первую ссылку, если их несколько', () => {
  assert.equal(
    extractUrl('http://a.example один и https://b.example два'),
    'http://a.example/',
  );
});

test('extractUrl поддерживает https и http', () => {
  assert.equal(extractUrl('https://example.com/'), 'https://example.com/');
  assert.equal(extractUrl('http://example.com/'), 'http://example.com/');
});

test('extractUrl возвращает null без ссылки', () => {
  assert.equal(extractUrl('просто текст без ссылок'), null);
});

test('extractUrl игнорирует не-http схемы', () => {
  assert.equal(extractUrl('ftp://example.com/file'), null);
  assert.equal(extractUrl('tg://resolve?domain=x'), null);
});

test('extractUrl не захватывает закрывающую скобку', () => {
  assert.equal(
    extractUrl('ссылка (https://example.com/page) тут'),
    'https://example.com/page',
  );
});

test('extractUrl превращает youtube.com/live/ID в watch?v=ID', () => {
  const watch = 'https://www.youtube.com/watch?v=oSsqVq4bhd8';
  assert.equal(extractUrl('https://www.youtube.com/live/oSsqVq4bhd8'), watch);
  assert.equal(extractUrl('https://youtube.com/live/oSsqVq4bhd8?si=x1'), watch);
  assert.equal(extractUrl('https://m.youtube.com/live/oSsqVq4bhd8/'), watch);
});

test('extractUrl не трогает обычные ссылки на YouTube и чужие /live/', () => {
  assert.equal(
    extractUrl('https://www.youtube.com/watch?v=oSsqVq4bhd8&t=42'),
    'https://www.youtube.com/watch?v=oSsqVq4bhd8&t=42',
  );
  // Страница «эфиры канала», а не видео.
  assert.equal(
    extractUrl('https://www.youtube.com/@channel/live'),
    'https://www.youtube.com/@channel/live',
  );
  assert.equal(
    extractUrl('https://example.com/live/oSsqVq4bhd8'),
    'https://example.com/live/oSsqVq4bhd8',
  );
});
