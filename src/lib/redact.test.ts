import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRedactor, proxySecrets } from './redact.js';

test('redact: токен из URL ошибки grammY не доезжает до лога', () => {
  const redact = createRedactor(['123456:AAFlyxTRE_mQUEZulhGp']);
  const line =
    '{"msg":"request to https://api.telegram.org/bot123456:AAFlyxTRE_mQUEZulhGp/getMe failed"}';
  const out = redact(line);
  assert.ok(!out.includes('AAFlyxTRE_mQUEZulhGp'), 'токена быть не должно');
  assert.ok(out.includes('<скрыто>'));
});

test('redact: чистит все секреты и все вхождения', () => {
  const redact = createRedactor(['bot-token-value', 'sk-or-secret-key']);
  const out = redact(
    'bot-token-value и sk-or-secret-key и снова bot-token-value',
  );
  assert.equal(out, '<скрыто> и <скрыто> и снова <скрыто>');
});

test('redact: спецсимволы в секрете не ломают замену', () => {
  const redact = createRedactor(['a.b*c(d)+e']);
  assert.equal(redact('ключ a.b*c(d)+e тут'), 'ключ <скрыто> тут');
  assert.equal(
    redact('ключ aXbYcZdWe тут'),
    'ключ aXbYcZdWe тут',
    'точка не должна значить «любой символ»',
  );
});

test('redact: пустой секрет не режет строку по символам', () => {
  const redact = createRedactor(['']);
  assert.equal(redact('обычная строка'), 'обычная строка');
});

test('redact: строка без секретов не меняется', () => {
  const redact = createRedactor(['секрет']);
  assert.equal(redact('обычная строка лога'), 'обычная строка лога');
});

test('redact: пароль прокси скрыт в закодированном и обычном виде', () => {
  assert.deepEqual(proxySecrets(undefined), []);
  assert.deepEqual(proxySecrets('http://127.0.0.1:10809'), []);
  const redact = createRedactor(
    proxySecrets('https://u:p%40ss@proxy.test:443'),
  );
  assert.equal(
    redact('connect https://u:p%40ss@proxy.test failed (p@ss)'),
    'connect https://u:<скрыто>@proxy.test failed (<скрыто>)',
  );
});

test('redact: ключ в логине прокси (без пароля) скрыт', () => {
  const redact = createRedactor(
    proxySecrets('http://TOKEN123@proxy.test:8080'),
  );
  assert.equal(
    redact('connect http://TOKEN123@proxy.test:8080 failed'),
    'connect http://<скрыто>@proxy.test:8080 failed',
  );
});

test('redact: короткий пароль прокси — только вместе с логином', () => {
  const redact = createRedactor(proxySecrets('http://user:p@proxy.test:8080'));
  assert.equal(
    redact('connect http://user:p@proxy.test failed, port 1080'),
    'connect http://<скрыто>@proxy.test failed, port 1080',
  );
  // слишком короткое целиком — не трогаем вовсе, лог дороже
  assert.deepEqual(proxySecrets('http://u:p@proxy.test'), []);
  assert.deepEqual(proxySecrets('http://abc@proxy.test'), []);
});

test('proxySecrets: битый «%» в пароле не роняет логгер', () => {
  assert.deepEqual(proxySecrets('http://u:p%zzword@proxy.test'), ['p%zzword']);
});
