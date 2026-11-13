import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeError } from './errorLog.js';

const SECRET = 'https://example.com/secret-article Секретный заголовок';

test('GrammyError: payload (аргументы метода с текстом сообщения) не попадает в лог', () => {
  const err = Object.assign(new Error('Call to sendMessage failed'), {
    name: 'GrammyError',
    method: 'sendMessage',
    error_code: 400,
    description: "Bad Request: can't parse entities",
    payload: { chat_id: 5, text: SECRET },
  });
  const out = serializeError(err);
  const json = JSON.stringify(out);
  assert.ok(!json.includes('secret-article'), json);
  assert.ok(!json.includes('Секретный'), json);
  assert.equal(out.description, "Bad Request: can't parse entities");
  assert.equal(out.error_code, 400);
  assert.equal(out.method, 'sendMessage');
  assert.equal(out.message, 'Call to sendMessage failed');
});

test('ошибка провайдера: metadata с фрагментом входа выкидывается, суть остаётся', () => {
  const err = Object.assign(new Error('403 flagged'), {
    status: 403,
    error: {
      message: 'Input was flagged',
      code: 403,
      metadata: { flagged_input: SECRET, reasons: ['x'] },
    },
  });
  const out = serializeError(err) as Record<string, unknown> & {
    error: Record<string, unknown>;
  };
  assert.ok(!JSON.stringify(out).includes('secret-article'));
  assert.equal(out.status, 403);
  assert.equal(out.error.message, 'Input was flagged');
  assert.equal(out.error.code, 403);
});

test('payload в cause тоже вычищается', () => {
  const inner = Object.assign(new Error('inner'), {
    payload: { text: SECRET },
  });
  const err = new Error('outer', { cause: inner });
  assert.ok(!JSON.stringify(serializeError(err)).includes('secret-article'));
});

test('не-Error проходит без падений', () => {
  assert.doesNotThrow(() => serializeError('строка'));
  assert.doesNotThrow(() => serializeError(undefined));
});

test('глубже предела вложенности payload всё равно не утекает', () => {
  // error → response → body → … : payload на 10-м уровне.
  let nested: Record<string, unknown> = { payload: { text: SECRET } };
  for (let i = 0; i < 10; i++) nested = { level: nested };
  const err = Object.assign(new Error('deep'), { error: nested });
  const json = JSON.stringify(serializeError(err));
  assert.ok(!json.includes('secret-article'), json);
  assert.ok(json.includes('[обрезано]'), json);
});
