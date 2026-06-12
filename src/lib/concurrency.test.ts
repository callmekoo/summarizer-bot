import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter } from './concurrency.js';

const tick = () => new Promise((r) => setTimeout(r, 5));

test('createLimiter не превышает заданную конкурентность', async () => {
  const limiter = createLimiter(2);
  let active = 0;
  let maxActive = 0;

  const task = async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await tick();
    active--;
  };

  await Promise.all(Array.from({ length: 6 }, () => limiter.run(task)));
  assert.equal(maxActive, 2, 'одновременно не более 2');
  assert.equal(limiter.active, 0, 'после завершения активных нет');
  assert.equal(limiter.queued, 0, 'очередь пуста');
});

test('createLimiter(1) сериализует и сохраняет порядок', async () => {
  const limiter = createLimiter(1);
  const order: number[] = [];
  await Promise.all(
    [1, 2, 3].map((n) => limiter.run(async () => {
      await tick();
      order.push(n);
    })),
  );
  assert.deepEqual(order, [1, 2, 3]);
});

test('createLimiter пробрасывает результат и ошибку', async () => {
  const limiter = createLimiter(1);
  assert.equal(await limiter.run(async () => 42), 42);
  await assert.rejects(() => limiter.run(async () => {
    throw new Error('boom');
  }), /boom/);
  // после ошибки слот освобождается — следующая задача выполняется
  assert.equal(await limiter.run(async () => 'ok'), 'ok');
});

test('createLimiter отклоняет конкурентность < 1', () => {
  assert.throws(() => createLimiter(0));
});
