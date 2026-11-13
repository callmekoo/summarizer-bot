import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceLogFields } from './privacy.js';

test('админу — всё как есть', () => {
  const fields = { url: 'https://example.com/a?b=1', title: 'T', ok: true };
  assert.deepEqual(sourceLogFields(true, fields), fields);
});

test('чужая ссылка → только домен, заголовок не пишется', () => {
  assert.deepEqual(
    sourceLogFields(false, {
      url: 'https://www.youtube.com/watch?v=x',
      title: 'T',
      ok: true,
    }),
    { host: 'www.youtube.com', ok: true },
  );
});

test('чужой файл → только расширение', () => {
  assert.deepEqual(sourceLogFields(false, { file: 'Отчёт.MD', bytes: 10 }), {
    ext: '.md',
    bytes: 10,
  });
  assert.deepEqual(sourceLogFields(false, { file: 'README' }), { ext: null });
});

test('чужой поисковый запрос не пишется', () => {
  assert.deepEqual(sourceLogFields(false, { query: 'секрет' }), {});
});

test('битая ссылка → host: invalid', () => {
  assert.deepEqual(sourceLogFields(false, { url: 'not a url' }), {
    host: 'invalid',
  });
});
