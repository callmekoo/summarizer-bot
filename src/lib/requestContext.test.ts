import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type * as Ctx from './requestContext.js';
import { openDatabase, type Db } from '../db/database.js';

// requestContext → logger → config валидирует env при импорте: задаём окружение заранее
// и подгружаем модуль динамически.
let withRequest: typeof Ctx.withRequest;
let currentRequest: typeof Ctx.currentRequest;
let db: Db;

before(async () => {
  process.env.DOTENV_CONFIG_PATH = '/dev/null';
  process.env.BOT_TOKEN = 'test-token';
  process.env.LLM_API_KEY = 'test-key';
  process.env.MODEL = 'test/model';
  process.env.ADMIN_USER_ID = '1';
  process.env.LOG_LEVEL = 'silent';
  ({ withRequest, currentRequest } = await import('./requestContext.js'));
});

beforeEach(async () => {
  db = await openDatabase(':memory:');
});

const deps = () => ({ db, now: () => 1000 });
const user = { userId: 5, isAdmin: false };
const okOf = (id: number) =>
  (db.prepare('SELECT ok FROM requests WHERE id = ?').get(id) as { ok: number })
    .ok;

test('внутри — контекст запроса, снаружи — нет', async () => {
  let seen: Ctx.RequestContext | undefined;
  await withRequest(deps(), user, 'summary', async () => {
    seen = currentRequest();
    return true;
  });
  assert.equal(typeof seen?.requestId, 'number');
  assert.equal(seen?.userId, 5);
  assert.equal(seen?.isAdmin, false);
  assert.equal(okOf(seen!.requestId!), 1);
  assert.equal(currentRequest(), undefined);
});

test('fn вернула false → запрос закрыт с ошибкой', async () => {
  let id = 0;
  const ok = await withRequest(deps(), user, 'article', async () => {
    id = currentRequest()!.requestId!;
    return false;
  });
  assert.equal(ok, false);
  assert.equal(okOf(id), 0);
});

test('fn бросила → запрос закрыт с ошибкой, исключение проброшено', async () => {
  let id = 0;
  await assert.rejects(
    withRequest(deps(), user, 'summary', async () => {
      id = currentRequest()!.requestId!;
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.equal(okOf(id), 0);
});

test('параллельные запросы видят каждый свой id', async () => {
  const ids: number[] = [];
  const run = () =>
    withRequest(deps(), user, 'summary', async () => {
      const before = currentRequest()!.requestId!;
      await new Promise((r) => setTimeout(r, 5));
      ids.push(before, currentRequest()!.requestId!);
      return true;
    });
  await Promise.all([run(), run()]);
  assert.equal(ids[0], ids[1]);
  assert.equal(ids[2], ids[3]);
  assert.notEqual(ids[0], ids[2]);
});

test('база недоступна → fn всё равно выполняется, requestId = null', async () => {
  db.close();
  let seen: Ctx.RequestContext | undefined;
  const ok = await withRequest(deps(), user, 'summary', async () => {
    seen = currentRequest();
    return true;
  });
  assert.equal(ok, true);
  assert.equal(seen?.requestId, null);
});
