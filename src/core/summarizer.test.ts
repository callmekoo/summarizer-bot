import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type {
  capTokens as CapTokens,
  summaryBudget as SummaryBudgetFn,
} from './summarizer.js';

// summarizer → llm-client → config валидирует env при импорте, поэтому задаём
// окружение заранее и подгружаем модуль динамически.
let capTokens: typeof CapTokens;
let summaryBudget: typeof SummaryBudgetFn;

before(async () => {
  process.env.DOTENV_CONFIG_PATH = '/dev/null'; // не зависеть от реального .env
  process.env.BOT_TOKEN = 'test-token';
  process.env.LLM_API_KEY = 'test-key';
  process.env.MODEL = 'test/model';
  ({ capTokens, summaryBudget } = await import('./summarizer.js'));
});

test('capTokens: короткий текст не трогается', () => {
  const r = capTokens('короткий текст', 1000);
  assert.equal(r.truncated, false);
  assert.equal(r.keptPercent, 100);
  assert.equal(r.text, 'короткий текст');
});

test('capTokens: длинный текст обрезается, считается процент', () => {
  // Много токенов при крошечном лимите → обрезка.
  const text = 'word '.repeat(5000);
  const r = capTokens(text, 100);
  assert.equal(r.truncated, true);
  assert.ok(r.text.length < text.length, 'текст реально укоротился');
  assert.ok(r.keptPercent > 0 && r.keptPercent < 100, `keptPercent в (0,100): ${r.keptPercent}`);
});

const source = (chars: number): string => 'а'.repeat(chars);

test('summaryBudget: объём растёт вместе с источником — это суть фичи', () => {
  const short = summaryBudget(source(3_000));
  const long = summaryBudget(source(60_000));
  assert.ok(long.chars > short.chars * 2, `часовое видео должно быть заметно длиннее: ${short.chars} → ${long.chars}`);
  assert.ok(long.blocks > short.blocks, 'и блоков должно стать больше');
});

test('summaryBudget: рост сублинейный — длинное видео не превращается в простыню', () => {
  const a = summaryBudget(source(20_000));
  const b = summaryBudget(source(200_000));
  // Вход вырос в 10 раз, пересказ — меньше чем в 10 (иначе получим полотно).
  assert.ok(b.chars < a.chars * 10, `рост должен быть медленнее линейного: ${a.chars} → ${b.chars}`);
});

test('summaryBudget: монотонность — больше вход, не меньше бюджет', () => {
  const sizes = [0, 500, 1_500, 3_000, 10_000, 20_000, 60_000, 200_000, 1_000_000];
  let prev = -1;
  for (const size of sizes) {
    const { chars } = summaryBudget(source(size));
    assert.ok(chars >= prev, `бюджет не должен падать на ${size}: ${prev} → ${chars}`);
    prev = chars;
  }
});

test('summaryBudget: короткий текст — без блоков, связной сутью', () => {
  assert.equal(summaryBudget(source(1_500)).blocks, 0);
  assert.equal(summaryBudget('').blocks, 0);
});

test('summaryBudget: блоков либо ноль, либо хотя бы два — один блок бессмыслен', () => {
  for (const size of [0, 500, 2_400, 2_600, 3_000, 10_000]) {
    const { blocks } = summaryBudget(source(size));
    assert.ok(blocks === 0 || blocks >= 2, `${size} символов → ${blocks} блоков`);
  }
});

test('summaryBudget: упирается в потолок — не длиннее двух сообщений Telegram', () => {
  const huge = summaryBudget(source(5_000_000));
  assert.equal(huge.chars, 7_000);
  assert.ok(huge.blocks <= 14, `блоков не больше 14: ${huge.blocks}`);
});

test('summaryBudget: контрольные точки кривой', () => {
  // Ломается при правке констант — это и нужно: кривая меняется осознанно.
  assert.deepEqual(summaryBudget(source(3_000)), { chars: 700, blocks: 2 });
  assert.deepEqual(summaryBudget(source(20_000)), { chars: 1_700, blocks: 4 });
  assert.deepEqual(summaryBudget(source(60_000)), { chars: 2_900, blocks: 7 });
});
