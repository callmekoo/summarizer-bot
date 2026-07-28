import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COMMANDS, renderHelp } from './commands.js';

// commands.ts тянет только formatter (чистый), поэтому config тут не при чём —
// импортируем статически, без плясок с окружением, как в summarizer.test.ts.

test('имена команд валидны для Telegram', () => {
  // Требование Bot API: только [a-z0-9_], 1-32 символа. Иначе setMyCommands упадёт целиком.
  for (const c of COMMANDS) {
    assert.match(c.command, /^[a-z0-9_]{1,32}$/, `имя «${c.command}» не пройдёт setMyCommands`);
  }
});

test('описания непустые и влезают в лимит меню', () => {
  for (const c of COMMANDS) {
    assert.ok(c.description.length > 0, `у /${c.command} пустое описание`);
    assert.ok(c.description.length <= 256, `описание /${c.command} длиннее 256 символов`);
    assert.ok(c.details === undefined || c.details.length > 0, `у /${c.command} пустой details`);
  }
});

test('дубликатов команд нет', () => {
  const names = COMMANDS.map((c) => c.command);
  assert.equal(new Set(names).size, names.length, 'команда объявлена дважды');
});

test('реестр совпадает с регистрациями в bot.ts', () => {
  // Ради этого теста реестр и заводился: меню Telegram обещает ровно то, на что бот отвечает.
  // bot.ts в юнит-тесте не импортируешь — на верхнем уровне он поднимает polling, поэтому
  // сверяемся по исходнику. Тест ломается, если добавить bot.command() мимо commands.ts.
  const source = readFileSync(new URL('./bot.ts', import.meta.url), 'utf8');
  const registered = [...source.matchAll(/bot\.command\('([a-z0-9_]+)'/g)].map((m) => m[1]);

  assert.deepEqual(
    [...registered].sort(),
    COMMANDS.map((c) => c.command).sort(),
    'список команд в commands.ts разошёлся с bot.command() в bot.ts',
  );
});

test('renderHelp упоминает каждую команду и её описание', () => {
  const help = renderHelp();
  for (const c of COMMANDS) {
    assert.ok(help.includes(`/${c.command}`), `в справке нет /${c.command}`);
    assert.ok(help.includes(c.description), `в справке нет описания /${c.command}`);
  }
});

test('renderHelp экранирует placeholder аргумента', () => {
  // usage вида «<ссылка>» с parse_mode HTML Telegram примет за тег и отобьёт всё сообщение.
  const help = renderHelp();
  assert.ok(help.includes('&lt;ссылка&gt;'), 'угловые скобки экранированы');
  assert.ok(!/<ссылка>/.test(help), 'сырых угловых скобок в справке нет');
});
