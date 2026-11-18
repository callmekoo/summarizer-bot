import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from 'grammy';
import type * as Access from './access.js';
import { openDatabase, type Db } from '../db/database.js';
import { getUser, createApplication, setStatus } from '../db/users.js';
import { ACCESS_TEXT } from '../core/access.js';
import type { UserRow } from '../core/users.js';

// access → config/logger валидируют env при импорте: задаём окружение и грузим динамически.
let createAccess: typeof Access.createAccess;
let renderApplication: typeof Access.renderApplication;

const ADMIN = 1;
const NOW = Date.UTC(2026, 10, 6, 12);
const DAY = 86_400_000;

before(async () => {
  process.env.DOTENV_CONFIG_PATH = '/dev/null';
  process.env.BOT_TOKEN = 'test-token';
  process.env.LLM_API_KEY = 'test-key';
  process.env.MODEL = 'test/model';
  process.env.ADMIN_USER_ID = String(ADMIN);
  process.env.LOG_LEVEL = 'silent';
  ({ createAccess, renderApplication } = await import('./access.js'));
});

let db: Db;
let notified: UserRow[];
let notifyFails: boolean;

beforeEach(async () => {
  db = await openDatabase(':memory:');
  notified = [];
  notifyFails = false;
});

/**
 * Прогоняет один апдейт через middleware; возвращает ответы и признак next().
 * kind: обычное сообщение (по умолчанию), нажатие кнопки или служебное событие
 * (my_chat_member — человек заблокировал/разблокировал бота).
 */
async function send(
  from: { id: number; username?: string; first_name?: string } | undefined,
  now = NOW,
  opts: {
    kind?: 'message' | 'callback' | 'service';
    replyFails?: boolean;
  } = {},
) {
  const kind = opts.kind ?? 'message';
  const replies: string[] = [];
  let passed = false;
  const ctx = {
    from,
    message: kind === 'message' ? { text: 'привет' } : undefined,
    callbackQuery: kind === 'callback' ? { data: 'x' } : undefined,
    myChatMember: kind === 'service' ? { new_chat_member: {} } : undefined,
    reply: async (text: string) => {
      if (opts.replyFails) throw new Error('403: bot was blocked by the user');
      replies.push(text);
    },
    answerCallbackQuery: async () => {},
  } as unknown as Context;
  const access = createAccess({
    db,
    adminId: ADMIN,
    now: () => now,
    notifyAdmin: async (u) => {
      if (notifyFails)
        throw new Error('403: bot can not initiate conversation');
      notified.push(u);
    },
  });
  await access(ctx, async () => {
    passed = true;
  });
  return { replies, passed };
}

test('админ проходит, и бот запоминает его ник и имя (для /stats)', async () => {
  const r = await send({ id: ADMIN, username: 'owner', first_name: 'Хозяин' });
  assert.equal(r.passed, true);
  const row = getUser(db, ADMIN);
  assert.equal(row?.status, 'approved');
  assert.equal(row?.username, 'owner');
  assert.equal(row?.firstName, 'Хозяин');
});

test('админ проходит, даже если база недоступна', async () => {
  db.close();
  const r = await send({ id: ADMIN, username: 'owner' });
  assert.equal(r.passed, true);
  assert.deepEqual(r.replies, []);
});

test('апдейт без from игнорируется', async () => {
  const r = await send(undefined);
  assert.equal(r.passed, false);
  assert.deepEqual(r.replies, []);
});

test('незнакомец → заявка, текст, одно уведомление админу', async () => {
  const r = await send({ id: 5, username: 'ivanp', first_name: 'Иван' });
  assert.equal(r.passed, false);
  assert.deepEqual(r.replies, [ACCESS_TEXT.applied]);
  assert.equal(getUser(db, 5)?.status, 'pending');
  assert.equal(notified.length, 1);
  assert.equal(notified[0]?.id, 5);
});

test('повторное сообщение pending → «на рассмотрении», без нового уведомления', async () => {
  await send({ id: 5 });
  const r = await send({ id: 5 });
  assert.deepEqual(r.replies, [ACCESS_TEXT.pending]);
  assert.equal(notified.length, 1);
});

test('уведомление админу не доставилось → заявка всё равно сохранена', async () => {
  notifyFails = true;
  const r = await send({ id: 5 });
  assert.deepEqual(r.replies, [ACCESS_TEXT.applied]);
  assert.equal(getUser(db, 5)?.status, 'pending');
});

test('approved проходит, banned — тишина', async () => {
  createApplication(db, { id: 5 }, NOW);
  setStatus(db, 5, 'approved', NOW);
  assert.equal((await send({ id: 5 })).passed, true);

  setStatus(db, 5, 'banned', NOW);
  const r = await send({ id: 5 });
  assert.equal(r.passed, false);
  assert.deepEqual(r.replies, []);
});

test('отклонённый: до срока — отказ с датой, после — новая заявка', async () => {
  createApplication(db, { id: 5 }, NOW);
  setStatus(db, 5, 'rejected', NOW, NOW + 7 * DAY);

  const early = await send({ id: 5 }, NOW + DAY);
  assert.deepEqual(early.replies, [ACCESS_TEXT.rejected(NOW + 7 * DAY)]);
  assert.equal(notified.length, 0);

  const late = await send({ id: 5 }, NOW + 8 * DAY);
  assert.deepEqual(late.replies, [ACCESS_TEXT.applied]);
  assert.equal(getUser(db, 5)?.status, 'pending');
  assert.equal(notified.length, 1);
});

test('база недоступна → временная ошибка, дальше не пускаем', async () => {
  db.close();
  const r = await send({ id: 5 });
  assert.equal(r.passed, false);
  assert.equal(r.replies.length, 1);
  assert.match(r.replies[0]!, /Временная ошибка/);
});

test('текст заявки: имя, ник, id; HTML экранирован', () => {
  const text = renderApplication({
    id: 5,
    username: null,
    firstName: '<Иван>',
    lastName: null,
    status: 'pending',
    requestedAt: NOW,
    decidedAt: null,
    retryAfter: null,
  });
  assert.equal(text, 'Новая заявка: без ника (&lt;Иван&gt;, id 5)');
});

test('служебное событие от незнакомца не создаёт заявку и не отвечает', async () => {
  const r = await send({ id: 5 }, NOW, { kind: 'service' });
  assert.equal(r.passed, false);
  assert.deepEqual(r.replies, []);
  assert.equal(getUser(db, 5), undefined);
  assert.equal(notified.length, 0);
});

test('блокировка бота отклонённым после кулдауна — не новая заявка', async () => {
  createApplication(db, { id: 5 }, NOW);
  setStatus(db, 5, 'rejected', NOW, NOW + DAY);
  const r = await send({ id: 5 }, NOW + 2 * DAY, { kind: 'service' });
  assert.deepEqual(r.replies, []);
  assert.equal(getUser(db, 5)?.status, 'rejected');
  assert.equal(notified.length, 0);
});

test('служебное событие от ждущего — без ответа «на рассмотрении»', async () => {
  createApplication(db, { id: 5 }, NOW);
  const r = await send({ id: 5 }, NOW, { kind: 'service' });
  assert.deepEqual(r.replies, []);
  assert.equal(r.passed, false);
});

test('служебное событие одобренного проходит дальше, как раньше', async () => {
  createApplication(db, { id: 5 }, NOW);
  setStatus(db, 5, 'approved', NOW);
  assert.equal((await send({ id: 5 }, NOW, { kind: 'service' })).passed, true);
});

test('ответ человеку не ушёл — владелец всё равно получает заявку', async () => {
  await send({ id: 5 }, NOW, { replyFails: true });
  assert.equal(getUser(db, 5)?.status, 'pending');
  assert.equal(notified.length, 1);
});

test('ответ «на рассмотрении» не ушёл — без исключения наружу', async () => {
  createApplication(db, { id: 5 }, NOW);
  await assert.doesNotReject(send({ id: 5 }, NOW, { replyFails: true }));
});

test('кнопка от незнакомца — заявка, как от сообщения', async () => {
  const r = await send({ id: 5 }, NOW, { kind: 'callback' });
  assert.deepEqual(r.replies, [ACCESS_TEXT.applied]);
  assert.equal(notified.length, 1);
});
