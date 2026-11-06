import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, type Db } from './database.js';
import {
  getUser,
  touchProfile,
  createApplication,
  setStatus,
  seedApproved,
  listUsers,
  findUser,
} from './users.js';

const NOW = Date.UTC(2026, 10, 6, 12);
const DAY = 86_400_000;
let db: Db;

beforeEach(async () => {
  db = await openDatabase(':memory:');
});

const count = () =>
  (db.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n;

test('заявка создаёт pending с датой', () => {
  createApplication(db, { id: 1, username: 'ivanp', first_name: 'Иван' }, NOW);
  const u = getUser(db, 1);
  assert.equal(u?.status, 'pending');
  assert.equal(u?.requestedAt, NOW);
  assert.equal(u?.username, 'ivanp');
  assert.equal(u?.firstName, 'Иван');
  assert.equal(u?.lastName, null);
});

test('повторная заявка после отказа сбрасывает retryAfter', () => {
  createApplication(db, { id: 1 }, NOW);
  setStatus(db, 1, 'rejected', NOW, NOW + DAY);
  const u = createApplication(db, { id: 1 }, NOW + 2 * DAY);
  assert.equal(u.status, 'pending');
  assert.equal(u.retryAfter, null);
  assert.equal(u.requestedAt, NOW + 2 * DAY);
});

test('touchProfile не создаёт незнакомцев', () => {
  assert.equal(touchProfile(db, { id: 99, username: 'x' }), undefined);
  assert.equal(count(), 0);
});

test('touchProfile обновляет имя и ник', () => {
  createApplication(db, { id: 1, first_name: 'Иван' }, NOW);
  const u = touchProfile(db, { id: 1, username: 'new', first_name: 'Ваня' });
  assert.equal(u?.username, 'new');
  assert.equal(u?.firstName, 'Ваня');
});

test('ник переходит к новому владельцу и у старого обнуляется', () => {
  createApplication(db, { id: 1, username: 'nick' }, NOW);
  createApplication(db, { id: 2 }, NOW);
  touchProfile(db, { id: 2, username: 'Nick' });
  assert.equal(getUser(db, 1)?.username, null);
  assert.equal(findUser(db, '@NICK')?.id, 2);
});

test('setStatus: решение и кулдаун; неизвестный id → undefined', () => {
  createApplication(db, { id: 1 }, NOW);
  const u = setStatus(db, 1, 'rejected', NOW + 1, NOW + 7 * DAY);
  assert.equal(u?.status, 'rejected');
  assert.equal(u?.decidedAt, NOW + 1);
  assert.equal(u?.retryAfter, NOW + 7 * DAY);
  assert.equal(setStatus(db, 42, 'approved', NOW), undefined);
});

test('seedApproved одобряет, но не снимает бан', () => {
  createApplication(db, { id: 2 }, NOW);
  setStatus(db, 2, 'banned', NOW);
  createApplication(db, { id: 3 }, NOW);
  seedApproved(db, [1, 2, 3], NOW);
  assert.equal(getUser(db, 1)?.status, 'approved');
  assert.equal(getUser(db, 2)?.status, 'banned');
  assert.equal(getUser(db, 3)?.status, 'approved');
});

test('findUser: id, ник с @ и без, мусор', () => {
  createApplication(db, { id: 123, username: 'ivanp' }, NOW);
  assert.equal(findUser(db, '123')?.id, 123);
  assert.equal(findUser(db, 'ivanp')?.id, 123);
  assert.equal(findUser(db, '@IvanP')?.id, 123);
  assert.equal(findUser(db, 'drop table'), undefined);
  assert.equal(findUser(db, "' OR 1=1 --"), undefined);
  assert.equal(findUser(db, '@nobody'), undefined);
});

test('listUsers: по статусу, внутри — свежие заявки выше', () => {
  createApplication(db, { id: 1 }, NOW);
  createApplication(db, { id: 2 }, NOW + 1);
  createApplication(db, { id: 3 }, NOW + 2);
  setStatus(db, 3, 'approved', NOW + 3);
  const ids = listUsers(db).map((u) => [u.status, u.id]);
  assert.deepEqual(ids, [
    ['approved', 3],
    ['pending', 2],
    ['pending', 1],
  ]);
});

test('имя с SQL сохраняется как есть, таблица жива', () => {
  const evil = "'; DROP TABLE users; --";
  createApplication(db, { id: 1, first_name: evil }, NOW);
  assert.equal(getUser(db, 1)?.firstName, evil);
  assert.equal(count(), 1);
});

test('seedApproved не возвращает доступ отозванному (рестарт после /revoke)', () => {
  seedApproved(db, [1], NOW);
  setStatus(db, 1, 'rejected', NOW + 1, NOW + 7 * DAY);
  seedApproved(db, [1], NOW + 2);
  assert.equal(getUser(db, 1)?.status, 'rejected');
});

test('seedApproved одобряет ждущую заявку', () => {
  createApplication(db, { id: 1 }, NOW);
  seedApproved(db, [1], NOW);
  assert.equal(getUser(db, 1)?.status, 'approved');
});
