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
    [1, 2, 3].map((n) =>
      limiter.run(async () => {
        await tick();
        order.push(n);
      }),
    ),
  );
  assert.deepEqual(order, [1, 2, 3]);
});

test('createLimiter пробрасывает результат и ошибку', async () => {
  const limiter = createLimiter(1);
  assert.equal(await limiter.run(async () => 42), 42);
  await assert.rejects(
    () =>
      limiter.run(async () => {
        throw new Error('boom');
      }),
    /boom/,
  );
  // после ошибки слот освобождается — следующая задача выполняется
  assert.equal(await limiter.run(async () => 'ok'), 'ok');
});

test('createLimiter отклоняет конкурентность < 1', () => {
  assert.throws(() => createLimiter(0));
});

test('задача из очереди выполняется в своём async-контексте, а не в предыдущей', async () => {
  // Иначе ждавший в очереди запрос видит чужой currentRequest(): расход уходит не тому
  // пользователю. Контекст должен браться в момент постановки в очередь.
  const { AsyncLocalStorage } = await import('node:async_hooks');
  const als = new AsyncLocalStorage<string>();
  const limiter = createLimiter(1);
  const seen: string[] = [];
  const task = async () => {
    await tick();
    seen.push(als.getStore() ?? 'none');
  };
  await Promise.all(
    ['A', 'B', 'C'].map((id) => als.run(id, () => limiter.run(task))),
  );
  assert.deepEqual(seen, ['A', 'B', 'C']);
});
