import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, articleFilename } from './filename.js';

test('slugify: латиница и пробелы → дефисы', () => {
  assert.equal(slugify('Let us build GPT'), 'let-us-build-gpt');
});

test('slugify: кириллица транслитерируется', () => {
  assert.equal(slugify('Как варить кофе'), 'kak-varit-kofe');
});

test('slugify: слэши и двоеточия не утекают в имя файла', () => {
  const s = slugify('a/b: c\\d');
  assert.ok(!/[/\\:]/.test(s), `нет опасных символов: ${s}`);
});

test('slugify: пустой или бессимвольный заголовок → фолбэк', () => {
  assert.equal(slugify(undefined), 'article');
  assert.equal(slugify(''), 'article');
  assert.equal(slugify('!!! ???'), 'article');
});

test('slugify: длинный заголовок обрезается и не кончается дефисом', () => {
  const s = slugify('a'.repeat(200) + ' ' + 'b'.repeat(200));
  assert.ok(s.length <= 60, `длина ограничена: ${s.length}`);
  assert.ok(!s.endsWith('-'), 'нет дефиса на конце');
});

test('articleFilename добавляет .md', () => {
  assert.equal(articleFilename('Привет мир'), 'privet-mir.md');
});
