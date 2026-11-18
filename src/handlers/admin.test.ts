import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type * as Admin from './admin.js';
import { openDatabase, type Db } from '../db/database.js';
import { getUser, createApplication, setStatus } from '../db/users.js';
import type { Context } from 'grammy';
import { formatRetryDate } from '../core/access.js';

// admin → config/logger валидируют env при импорте: задаём окружение и грузим динамически.
let applyDecision: typeof Admin.applyDecision;
let handleAccessButton: typeof Admin.handleAccessButton;

const NOW = Date.UTC(2026, 10, 6, 12);
const DAY = 86_400_000;

before(async () => {
  process.env.DOTENV_CONFIG_PATH = '/dev/null';
  process.env.BOT_TOKEN = 'test-token';
  process.env.LLM_API_KEY = 'test-key';
  process.env.MODEL = 'test/model';
  process.env.ADMIN_USER_ID = '1';
  process.env.LOG_LEVEL = 'silent';
  ({ applyDecision, handleAccessButton } = await import('./admin.js'));
});

let db: Db;
let sent: { chatId: number; text: string }[];
let sendFails: boolean;

beforeEach(async () => {
  db = await openDatabase(':memory:');
  sent = [];
  sendFails = false;
  createApplication(db, { id: 5, first_name: 'Иван' }, NOW);
});

const deps = (): Admin.DecisionDeps => ({
  db,
  now: () => NOW,
  retryDays: 7,
  adminId: 1,
  send: async (chatId, text) => {
    if (sendFails) throw new Error('403: bot was blocked by the user');
    sent.push({ chatId, text });
  },
});

test('одобрение с кнопки: статус и приветствие пользователю', async () => {
  const r = await applyDecision(deps(), 5, 'approve', { onlyIfPending: true });
  assert.equal(r.kind, 'done');
  assert.equal(getUser(db, 5)?.status, 'approved');
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.chatId, 5);
  assert.ok(sent[0]!.text.includes('✅ Доступ открыт!'));
  assert.ok(sent[0]!.text.includes('/help'));
});

test('отказ: кулдаун ACCESS_RETRY_DAYS и дата в уведомлении', async () => {
  await applyDecision(deps(), 5, 'reject', { onlyIfPending: true });
  const retryAfter = NOW + 7 * DAY;
  assert.equal(getUser(db, 5)?.retryAfter, retryAfter);
  assert.ok(sent[0]!.text.includes(formatRetryDate(retryAfter)));
});

test('бан: пользователю ничего не шлём', async () => {
  const r = await applyDecision(deps(), 5, 'ban', { onlyIfPending: true });
  assert.equal(r.kind, 'done');
  assert.equal(getUser(db, 5)?.status, 'banned');
  assert.equal(sent.length, 0);
});

test('пользователь заблокировал бота: статус всё равно меняется', async () => {
  sendFails = true;
  const r = await applyDecision(deps(), 5, 'approve', { onlyIfPending: true });
  assert.deepEqual(
    { kind: r.kind, notified: r.kind === 'done' && r.notified },
    { kind: 'done', notified: false },
  );
  assert.equal(getUser(db, 5)?.status, 'approved');
});

test('старая кнопка после решения командой — «уже обработано»', async () => {
  await applyDecision(deps(), 5, 'approve', { onlyIfPending: false });
  const r = await applyDecision(deps(), 5, 'reject', { onlyIfPending: true });
  assert.equal(r.kind, 'already');
  assert.equal(getUser(db, 5)?.status, 'approved');
  assert.equal(sent.length, 1);
});

test('команда работает из любого статуса (разбан)', async () => {
  await applyDecision(deps(), 5, 'ban', { onlyIfPending: false });
  const r = await applyDecision(deps(), 5, 'approve', { onlyIfPending: false });
  assert.equal(r.kind, 'done');
  assert.equal(getUser(db, 5)?.status, 'approved');
});

test('неизвестный пользователь → not_found', async () => {
  const r = await applyDecision(deps(), 999, 'approve', {
    onlyIfPending: false,
  });
  assert.equal(r.kind, 'not_found');
});

test('команда без изменения статуса: «уже», без повторного уведомления', async () => {
  await applyDecision(deps(), 5, 'approve', { onlyIfPending: false });
  const again = await applyDecision(deps(), 5, 'approve', {
    onlyIfPending: false,
  });
  assert.equal(again.kind, 'already');
  assert.equal(sent.length, 1); // приветствие ушло один раз
});

test('повторный /revoke не перезапускает кулдаун', async () => {
  await applyDecision(deps(), 5, 'reject', { onlyIfPending: false });
  const retryAfter = getUser(db, 5)?.retryAfter;
  const later: Admin.DecisionDeps = { ...deps(), now: () => NOW + 3 * DAY };
  const again = await applyDecision(later, 5, 'reject', {
    onlyIfPending: false,
  });
  assert.equal(again.kind, 'already');
  assert.equal(getUser(db, 5)?.retryAfter, retryAfter);
  assert.equal(sent.length, 1);
});

test('повторный /ban — «уже», статус тот же', async () => {
  await applyDecision(deps(), 5, 'ban', { onlyIfPending: false });
  const again = await applyDecision(deps(), 5, 'ban', { onlyIfPending: false });
  assert.equal(again.kind, 'already');
  assert.equal(getUser(db, 5)?.status, 'banned');
});

test('/revoke забаненного не снимает бан', async () => {
  setStatus(db, 5, 'banned', NOW);
  const r = await applyDecision(deps(), 5, 'reject', { onlyIfPending: false });
  assert.equal(r.kind, 'already');
  assert.equal(getUser(db, 5)?.status, 'banned');
  assert.equal(getUser(db, 5)?.retryAfter, null);
  assert.equal(sent.length, 0);
});

test('владельца командой не забанить и не отклонить', async () => {
  for (const action of ['ban', 'reject', 'approve'] as const) {
    const r = await applyDecision(deps(), 1, action, { onlyIfPending: false });
    assert.equal(r.kind, 'self', action);
  }
  assert.equal(getUser(db, 1), undefined);
  assert.equal(sent.length, 0);
});

/** Фейковое нажатие кнопки заявки владельцем. */
function buttonCtx(action: string, userId: number, answerFails = false) {
  const edits: { text: string; opts: unknown }[] = [];
  let markupRemoved = false;
  const ctx = {
    match: [`access:${action}:${userId}`, action, String(userId)],
    answerCallbackQuery: async () => {
      if (answerFails) throw new Error('400: query is too old');
    },
    editMessageText: async (text: string, opts: unknown) => {
      edits.push({ text, opts });
    },
    editMessageReplyMarkup: async () => {
      markupRemoved = true;
    },
  } as unknown as Context;
  return { ctx, edits, markupRemoved: () => markupRemoved };
}

test('кнопка: устаревший callback не мешает отметить решение в заявке', async () => {
  const b = buttonCtx('approve', 5, true);
  await assert.doesNotReject(handleAccessButton(b.ctx, deps()));
  assert.equal(getUser(db, 5)?.status, 'approved');
  assert.equal(b.edits.length, 1);
  assert.ok(b.edits[0]!.text.includes('одобрен'), b.edits[0]!.text);
});

test('кнопка «уже обработано»: заявка показывает текущий статус, кнопки убраны', async () => {
  await applyDecision(deps(), 5, 'approve', { onlyIfPending: false });
  const b = buttonCtx('reject', 5);
  await handleAccessButton(b.ctx, deps());
  assert.equal(getUser(db, 5)?.status, 'approved');
  assert.equal(b.edits.length, 1);
  assert.ok(b.edits[0]!.text.includes('одобрен'), b.edits[0]!.text);
  // Без reply_markup Telegram убирает клавиатуру.
  assert.equal(
    (b.edits[0]!.opts as { reply_markup?: unknown }).reply_markup,
    undefined,
  );
});

test('кнопка по неизвестному пользователю: кнопки убраны, без исключения', async () => {
  const b = buttonCtx('approve', 999, true);
  await assert.doesNotReject(handleAccessButton(b.ctx, deps()));
  assert.equal(b.markupRemoved(), true);
});
