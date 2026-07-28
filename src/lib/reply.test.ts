import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replyTo } from './reply.js';

test('привязывает ответ к указанному сообщению', () => {
  assert.deepEqual(replyTo(42), {
    reply_parameters: { message_id: 42, allow_sending_without_reply: true },
  });
});

test('allow_sending_without_reply включён: удалённое сообщение не должно съедать результат', () => {
  assert.equal(replyTo(1).reply_parameters?.allow_sending_without_reply, true);
});

test('без id — пустые опции, а не битая привязка', () => {
  // Спред пустого объекта в опции ctx.reply ничего не меняет — отправка проходит как раньше.
  assert.deepEqual(replyTo(undefined), {});
});

test('цепочка частей: каждая следующая ссылается на предыдущую', () => {
  // Повторяет логику onLink: id для следующей части берётся у отправленной.
  const sentIds = [101, 102, 103];
  const chain: (number | undefined)[] = [];

  let replyToId: number | undefined = 7; // сообщение пользователя со ссылкой
  for (const id of sentIds) {
    chain.push(replyTo(replyToId).reply_parameters?.message_id);
    replyToId = id;
  }

  assert.deepEqual(chain, [7, 101, 102], 'часть 1 → ссылка, часть 2 → часть 1, часть 3 → часть 2');
});
