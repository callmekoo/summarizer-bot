import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { buildArticle as BuildArticle, renderArticleMd as RenderArticleMd } from './article.js';
import type { ExtractResult } from '../types.js';

// article → prompts → config валидирует env при импорте: задаём окружение заранее
// и подгружаем модуль динамически (как в summarizer.test.ts).
let buildArticle: typeof BuildArticle;
let renderArticleMd: typeof RenderArticleMd;

before(async () => {
  process.env.DOTENV_CONFIG_PATH = '/dev/null';
  process.env.BOT_TOKEN = 'test-token';
  process.env.LLM_API_KEY = 'test-key';
  process.env.MODEL = 'test/model';
  ({ buildArticle, renderArticleMd } = await import('./article.js'));
});

const video: ExtractResult = {
  markdown: 'сырой дамп с таймкодами',
  title: 'Заголовок видео',
  author: 'Автор',
  site: 'YouTube',
  type: 'youtube',
  url: 'https://youtu.be/x',
  chapters: [{ title: 'Глава', startTime: 0 }],
  transcript: [
    { text: 'первый кусок речи', startTime: 0, chapterIndex: 0 },
    { text: 'второй кусок речи', startTime: 5, chapterIndex: 0 },
  ],
};

/** Мок LLM: возвращает предсказуемый текст, чтобы не ходить в сеть. */
const okLlm = async (): Promise<{ text: string; model: string }> => ({
  text: '## Раздел\n\nТекст статьи.',
  model: 'test/model',
});

test('не видео → тело от rdrr под нашей шапкой, LLM не зовётся', async () => {
  const page: ExtractResult = {
    ...video,
    type: 'webpage',
    markdown: 'Текст страницы.',
    transcript: undefined,
    chapters: undefined,
  };
  let called = false;
  const result = await buildArticle(page, {
    llm: async () => {
      called = true;
      return { text: 'x', model: 'm' };
    },
  });

  assert.equal(called, false, 'LLM не вызывалась');
  assert.equal(result.chunks, 0);
  assert.ok(result.markdown.includes('Текст страницы.'), 'тело от rdrr на месте');
  // rdrr отдаёт для страниц голое тело — заголовок и ссылку добавляем мы.
  assert.ok(result.markdown.startsWith('# Заголовок видео'), 'шапка с заголовком добавлена');
  assert.ok(result.markdown.includes('[Источник]'), 'ссылка на источник добавлена');
});

test('видео → расшифровка разворачивается в статью через LLM', async () => {
  const result = await buildArticle(video, { llm: okLlm });
  assert.equal(result.chunks, 1, 'короткая расшифровка → один кусок');
  assert.equal(result.failedChunks, 0);
  assert.equal(result.model, 'test/model');
  assert.ok(result.markdown.includes('# Заголовок видео'), 'шапка с заголовком');
  assert.ok(result.markdown.includes('## Раздел'), 'тело от модели');
});

test('прогресс сообщается по каждому куску', async () => {
  const calls: string[] = [];
  await buildArticle(video, { llm: okLlm, onProgress: (d, t) => calls.push(`${d}/${t}`) });
  assert.deepEqual(calls, ['1/1']);
});

test('упавший кусок помечается, но статья всё равно отдаётся', async () => {
  // Маленький бюджет → расшифровка режется надвое; первый вызов падает, второй нет.
  let call = 0;
  const flakyLlm = async (): Promise<{ text: string; model: string }> => {
    call++;
    if (call === 1) throw new Error('429');
    return { text: 'Готовый раздел.', model: 'test/model' };
  };

  const result = await buildArticle(video, { llm: flakyLlm, chunkChars: 20 });
  assert.equal(result.chunks, 2, 'расшифровка разрезана надвое');
  assert.equal(result.failedChunks, 1, 'один кусок не дался');
  assert.ok(result.markdown.includes('⚠️ Не удалось обработать фрагмент 1'), 'пропуск помечен');
  assert.ok(result.markdown.includes('Готовый раздел.'), 'остальное на месте');
});

test('не дался ни один кусок → честная ошибка, а не пустая статья', async () => {
  await assert.rejects(
    buildArticle(video, {
      llm: async () => {
        throw new Error('429');
      },
    }),
    /ни одного фрагмента/,
  );
});

test('renderArticleMd: шапка с заголовком, автором и ссылкой', () => {
  const md = renderArticleMd(video, '## Раздел\n\nТело.');
  assert.ok(md.startsWith('# Заголовок видео'), 'начинается с H1');
  assert.ok(md.includes('*Автор · YouTube*'), 'подпись');
  assert.ok(md.includes('[Источник](https://youtu.be/x)'), 'ссылка на источник');
  assert.ok(md.includes('## Раздел'), 'тело');
});
