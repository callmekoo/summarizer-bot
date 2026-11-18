import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// Страж от SQL-инъекций: в src/db SQL пишется только строковым литералом, значения идут
// параметрами (`?`). Шаблон с ${…}, склейка через + или переменная в prepare()/exec() —
// дорога к инъекции, даже если сегодня туда попадает «безопасное» значение.

/** Возвращает аргументы prepare()/exec(), которые не являются простым литералом. */
export function findUnsafeSql(source: string): string[] {
  const bad: string[] = [];
  for (const m of source.matchAll(/\.(?:prepare|exec)\(\s*/g)) {
    const start = m.index + m[0].length;
    const arg = readLiteral(source, start);
    if (arg === null) bad.push(source.slice(start, start + 60));
  }
  return bad;
}

/**
 * Если с позиции start идёт ровно один строковый литерал, за которым следует `)` или
 * `,` — возвращает его; иначе null. Шаблон допускается только без `${`.
 */
function readLiteral(source: string, start: number): string | null {
  const quote = source[start];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  let i = start + 1;
  while (i < source.length && source[i] !== quote) {
    if (source[i] === '\\') i++;
    i++;
  }
  const literal = source.slice(start, i + 1);
  if (quote === '`' && literal.includes('${')) return null;
  const rest = source.slice(i + 1).trimStart();
  return rest.startsWith(')') || rest.startsWith(',') ? literal : null;
}

test('детектор ловит интерполяцию, склейку и переменную', () => {
  assert.equal(findUnsafeSql('db.prepare(`SELECT ${x}`)').length, 1);
  assert.equal(findUnsafeSql("db.prepare('a' + b)").length, 1);
  assert.equal(findUnsafeSql('db.exec(sql)').length, 1);
  assert.equal(findUnsafeSql("db.prepare('SELECT ?').get(1)").length, 0);
  assert.equal(findUnsafeSql('db.exec(`CREATE TABLE t (a)`)').length, 0);
  assert.equal(
    findUnsafeSql("db.prepare(\n  'SELECT * FROM t WHERE a = ?',\n)").length,
    0,
  );
});

test('в src/db SQL только литералами', () => {
  const dir = new URL('./', import.meta.url);
  const files = readdirSync(dir).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
  );
  assert.ok(files.length > 0, 'в src/db нет модулей');
  for (const f of files) {
    const unsafe = findUnsafeSql(readFileSync(new URL(f, dir), 'utf8'));
    assert.deepEqual(unsafe, [], `${f}: SQL не литералом`);
  }
});
