import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type * as Article from '../core/article.js';
import type * as Ctx from './requestContext.js';
import type { ExtractResult } from '../types.js';
import { openDatabase } from '../db/database.js';

// Приватность логов на пути /article: содержимое чужого запроса (ссылка, названия глав) не
// должно попадать в вывод логгера. Проверяем по реальному выводу pino, а не по коду.
let buildArticle: typeof Article.buildArticle;
let withRequest: typeof Ctx.withRequest;

before(async () => {
  process.env.DOTENV_CONFIG_PATH = '/dev/null';
  process.env.BOT_TOKEN = 'test-token';
  process.env.LLM_API_KEY = 'test-key';
  process.env.MODEL = 'test/model';
  process.env.ADMIN_USER_ID = '1';
  process.env.LOG_LEVEL = 'info';
  ({ buildArticle } = await import('../core/article.js'));
  ({ withRequest } = await import('./requestContext.js'));
});

const SECRET_URL = 'https://www.youtube.com/watch?v=SECRETVIDEO';

const video: ExtractResult = {
  markdown: '',
  title: 'Секретное видео',
  type: 'youtube',
  url: SECRET_URL,
  chapters: [
    { title: 'Секретная глава', startTime: 0 },
    { title: 'Реклама', startTime: 10 },
  ],
  transcript: [
    { text: 'речь', startTime: 0, chapterIndex: 0 },
    { text: 'купите', startTime: 10, chapterIndex: 1 },
  ],
};

/** Выполняет fn и возвращает всё, что за это время логгер написал в stdout. */
async function captureLogs(fn: () => Promise<unknown>): Promise<string> {
  const lines: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = original;
  }
  return lines.join('');
}

// Модель падает — так срабатывает и строка «фрагмент статьи не обработан».
const failingLlm = async (): Promise<never> => {
  throw new Error('boom');
};

async function articleAs(isAdmin: boolean): Promise<string> {
  const db = await openDatabase(':memory:');
  return captureLogs(() =>
    withRequest(
      { db, now: Date.now },
      { userId: isAdmin ? 1 : 5, isAdmin },
      'article',
      async () => {
        // Все фрагменты упали → buildArticle бросает; нам нужны только логи.
        await buildArticle(video, { llm: failingLlm }).catch(() => {});
        return true;
      },
    ),
  );
}

test('/article не-владельца: в логах нет ссылки и названий глав', async () => {
  const out = await articleAs(false);
  assert.ok(out.includes('собираю статью'), 'логи перехвачены');
  assert.ok(!out.includes('SECRETVIDEO'), out);
  assert.ok(!out.includes('Секретная глава'), out);
  assert.ok(!out.includes('Реклама'), out);
  assert.ok(out.includes('www.youtube.com'), 'домен для отладки остаётся');
});

test('/article владельца: ссылка в логах есть', async () => {
  const out = await articleAs(true);
  assert.ok(out.includes('SECRETVIDEO'), out);
});
