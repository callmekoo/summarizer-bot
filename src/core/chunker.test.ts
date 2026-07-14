import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkTranscript } from './chunker.js';
import type { Chapter, TranscriptSegment } from '../types.js';

/** Сегменты с уникальными текстами s0, s1… — так легко проверить порядок и полноту. */
function segments(specs: { chapter: number; len?: number }[]): TranscriptSegment[] {
  return specs.map((spec, i) => ({
    // Текст вида "s0aaaa…" нужной длины: уникальный префикс + набивка.
    text: `s${i}`.padEnd(spec.len ?? 2, 'a'),
    startTime: i,
    chapterIndex: spec.chapter,
  }));
}

/** Все слова из всех кусков по порядку — для проверки, что ничего не потеряно. */
function words(chunks: { text: string }[]): string[] {
  return chunks
    .map((c) => c.text)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean);
}

const chapters: Chapter[] = [
  { title: 'Вступление', startTime: 0 },
  { title: 'Основная часть', startTime: 10 },
  { title: 'Итоги', startTime: 20 },
];

test('короткий транскрипт → ровно один кусок (вырождается в один вызов LLM)', () => {
  const t = segments([{ chapter: 0 }, { chapter: 1 }]);
  const chunks = chunkTranscript(t, chapters, 10_000);
  assert.equal(chunks.length, 1);
  assert.deepEqual(chunks[0].chapterTitles, ['Вступление', 'Основная часть']);
});

test('соседние главы пакуются в один кусок, пока влезают в бюджет', () => {
  // Каждая глава по 100 символов, бюджет 250 → 2 главы в первый кусок, 1 во второй.
  const t = segments([
    { chapter: 0, len: 100 },
    { chapter: 1, len: 100 },
    { chapter: 2, len: 100 },
  ]);
  const chunks = chunkTranscript(t, chapters, 250);
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[0].chapterTitles, ['Вступление', 'Основная часть']);
  assert.deepEqual(chunks[1].chapterTitles, ['Итоги']);
});

test('глава больше бюджета режется по границам сегментов, бюджет соблюдён', () => {
  // Одна глава из 5 сегментов по 100 символов = 500; бюджет 250.
  const t = segments(Array.from({ length: 5 }, () => ({ chapter: 0, len: 100 })));
  const chunks = chunkTranscript(t, chapters, 250);
  assert.ok(chunks.length > 1, 'глава разрезана');
  for (const c of chunks) {
    assert.ok(c.text.length <= 250, `кусок в пределах бюджета: ${c.text.length}`);
    assert.deepEqual(c.chapterTitles, ['Вступление'], 'части наследуют заголовок главы');
  }
});

test('глав нет → сегменты просто пакуются по бюджету, заголовков нет', () => {
  const t = segments(Array.from({ length: 4 }, () => ({ chapter: 0, len: 100 })));
  const chunks = chunkTranscript(t, undefined, 250);
  assert.ok(chunks.length > 1, 'нарезано по бюджету');
  for (const c of chunks) assert.deepEqual(c.chapterTitles, [], 'заголовков нет — придумает модель');
});

test('ИНВАРИАНТ: ни один сегмент не потерян и порядок сохранён', () => {
  const specs = Array.from({ length: 40 }, (_, i) => ({ chapter: i % 3, len: 60 }));
  const t = segments(specs);
  const chunks = chunkTranscript(t, chapters, 200);

  const got = words(chunks);
  const expected = t.map((s) => s.text);
  assert.deepEqual(got, expected, 'все сегменты на месте, в исходном порядке');
});

test('сегмент длиннее бюджета проходит целиком (рвать фразу хуже, чем превысить бюджет)', () => {
  const t = segments([{ chapter: 0, len: 500 }]);
  const chunks = chunkTranscript(t, chapters, 100);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, t[0].text, 'текст сегмента не порван');
});

test('пустой транскрипт → пустой список, без падения', () => {
  assert.deepEqual(chunkTranscript([], chapters, 1000), []);
  assert.deepEqual(chunkTranscript([], undefined, 1000), []);
});

test('нулевой бюджет — это ошибка конфигурации, а не тихое зацикливание', () => {
  assert.throws(() => chunkTranscript(segments([{ chapter: 0 }]), chapters, 0));
});
