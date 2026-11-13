import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayName, displayUsername, userLabelHtml } from './users.js';

const name = (firstName: string | null, lastName: string | null = null) =>
  displayName({ firstName, lastName });

test('обычное имя и фамилия', () => {
  assert.equal(name('Иван', 'Петров'), 'Иван Петров');
  assert.equal(name('Иван'), 'Иван');
});

test('пустое и невидимое имя → «без имени»', () => {
  assert.equal(name('​​'), 'без имени');
  assert.equal(name(null, null), 'без имени');
  assert.equal(name('   ', '⁦'), 'без имени');
});

test('переключатели направления и переводы строк убираются', () => {
  assert.equal(name('Ива‮н'), 'Иван');
  assert.equal(name('Иван\nПетров'), 'Иван Петров');
  assert.equal(name('Иван\t\t  Петров'), 'Иван Петров');
});

test('Zalgo: не больше двух диакритик подряд', () => {
  assert.equal(name('И' + '́'.repeat(30)), 'И́́');
});

test('длинное имя обрезается до 64 символов с многоточием', () => {
  const result = name('а'.repeat(100));
  assert.equal([...result].length, 64);
  assert.ok(result.endsWith('…'));
});

test('составные эмодзи сохраняют ZWJ, одинокий ZWJ удаляется', () => {
  const family = '👨‍👩‍👧';
  assert.equal(name(`Семья ${family}`), `Семья ${family}`);
  assert.equal(name('а‍б'), 'аб');
});

test('ник: с @ или «без ника»', () => {
  assert.equal(displayUsername(null), 'без ника');
  assert.equal(displayUsername('ivanp'), '@ivanp');
});

const row = (over: Partial<Parameters<typeof userLabelHtml>[0]> = {}) => ({
  id: 5,
  username: 'ivanp' as string | null,
  firstName: 'Иван' as string | null,
  lastName: 'Петров' as string | null,
  ...over,
});

test('метка пользователя: @ник (Имя, id)', () => {
  assert.equal(userLabelHtml(row()), '@ivanp (Иван Петров, id 5)');
});

test('метка: без ника и без имени — явные заглушки', () => {
  assert.equal(
    userLabelHtml(row({ username: null })),
    'без ника (Иван Петров, id 5)',
  );
  assert.equal(
    userLabelHtml(row({ firstName: null, lastName: null })),
    '@ivanp (без имени, id 5)',
  );
});

test('метка экранирует HTML в имени и нике', () => {
  assert.equal(
    userLabelHtml(
      row({ username: 'a<b', firstName: '<Иван>', lastName: null }),
    ),
    '@a&lt;b (&lt;Иван&gt;, id 5)',
  );
});
