import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type {
  userPrompt as UserPrompt,
  articleUserPrompt as ArticleUserPrompt,
  composeSystemPrompt as ComposeSystemPrompt,
  SAFETY_RULES as SafetyRules,
  ARTICLE_SYSTEM_PROMPT as ArticleSystemPrompt,
} from './prompts.js';

// prompts → config валидирует env при импорте, поэтому задаём окружение заранее
// и подгружаем модуль динамически (как в summarizer.test.ts).
let userPrompt: typeof UserPrompt;
let articleUserPrompt: typeof ArticleUserPrompt;
let composeSystemPrompt: typeof ComposeSystemPrompt;
let SAFETY_RULES: typeof SafetyRules;
let ARTICLE_SYSTEM_PROMPT: typeof ArticleSystemPrompt;

before(async () => {
  process.env.DOTENV_CONFIG_PATH = '/dev/null';
  process.env.BOT_TOKEN = 'test-token';
  process.env.LLM_API_KEY = 'test-key';
  process.env.MODEL = 'test/model';
  ({ userPrompt, articleUserPrompt, composeSystemPrompt, SAFETY_RULES, ARTICLE_SYSTEM_PROMPT } =
    await import('./prompts.js'));
});

const MARKERS = /⟦SOURCE ([0-9a-f]+)⟧\n([\s\S]*)\n⟦\/SOURCE ([0-9a-f]+)⟧/;

test('userPrompt оборачивает текст в маркеры с совпадающим кодом', () => {
  const out = userPrompt(undefined, 'тело статьи');
  const m = out.match(MARKERS);
  assert.ok(m, 'есть пара маркеров SOURCE');
  assert.equal(m[1], m[3], 'код открывающего и закрывающего маркера совпадает');
  assert.equal(m[2], 'тело статьи', 'внутри блока — ровно исходный текст');
});

test('userPrompt: заголовок попадает ВНУТРЬ блока (он тоже недоверенный)', () => {
  const out = userPrompt('Заголовок от сайта', 'тело');
  const m = out.match(MARKERS);
  assert.ok(m, 'есть маркеры');
  assert.ok(m[2].includes('Заголовок: Заголовок от сайта'), 'заголовок внутри блока');
  assert.ok(m[2].includes('тело'));
});

test('userPrompt: код случайный — разный между запросами', () => {
  const a = userPrompt(undefined, 'x').match(MARKERS)?.[1];
  const b = userPrompt(undefined, 'x').match(MARKERS)?.[1];
  assert.notEqual(a, b, 'код различается между вызовами');
});

test('userPrompt: инструкции к пересказу лежат СНАРУЖИ блока', () => {
  const out = userPrompt(undefined, 'материал');
  const closeIdx = out.indexOf('⟦/SOURCE');
  assert.ok(out.indexOf('Сделай краткий пересказ') > closeIdx, 'команда после закрытия блока');
});

test('composeSystemPrompt: кастомный промпт НЕ теряет защиту', () => {
  // Главный регресс-тест: автор кастомного промпта не знает о защите, но получает её.
  const out = composeSystemPrompt('Перескажи текст в три предложения.');
  assert.ok(out.includes('Перескажи текст в три предложения.'), 'кастомная задача на месте');
  assert.ok(out.includes(SAFETY_RULES), 'правила защиты подмешаны');
});

test('composeSystemPrompt: защита идёт ПОСЛЕ задачи (её нельзя «закончить» раньше)', () => {
  const task = 'Перескажи текст в три предложения.';
  const out = composeSystemPrompt(task);
  assert.ok(out.indexOf(SAFETY_RULES) > out.indexOf(task), 'защита — суффикс');
});

test('SAFETY_RULES описывают тот же маркер, что ставит userPrompt', () => {
  // Страховка от рассинхрона: правила ссылаются на маркер, обёртка его же и генерирует.
  assert.ok(SAFETY_RULES.includes('SOURCE'), 'правила упоминают маркер SOURCE');
  assert.ok(userPrompt(undefined, 'x').includes('⟦SOURCE '), 'обёртка ставит маркер SOURCE');
});

test('промпт статьи тоже защищён: расшифровка видео — недоверенный текст', () => {
  assert.ok(ARTICLE_SYSTEM_PROMPT.includes(SAFETY_RULES), 'SAFETY_RULES подмешаны и в статью');
});

test('articleUserPrompt: текст куска обёрнут нонс-маркерами с совпадающим кодом', () => {
  const out = articleUserPrompt('речь из видео', { index: 1, total: 3, chapterTitles: [] });
  const m = out.match(MARKERS);
  assert.ok(m, 'есть пара маркеров');
  assert.equal(m[1], m[3], 'коды совпадают');
  assert.equal(m[2], 'речь из видео', 'внутри — ровно текст куска');
});

test('articleUserPrompt: инструкции лежат СНАРУЖИ блока', () => {
  const out = articleUserPrompt('речь', { index: 1, total: 1, chapterTitles: [] });
  const closeIdx = out.indexOf('⟦/SOURCE');
  assert.ok(out.indexOf('Преврати расшифровку выше') > closeIdx, 'команда после закрытия блока');
});

test('articleUserPrompt: названия глав передаются модели, номер фрагмента — тоже', () => {
  const out = articleUserPrompt('речь', {
    index: 2,
    total: 5,
    chapterTitles: ['Вступление', 'Итоги'],
  });
  assert.ok(out.includes('фрагмент 2 из 5'), 'позиция куска');
  assert.ok(out.includes('- Вступление') && out.includes('- Итоги'), 'главы перечислены');
});

test('articleUserPrompt: глав нет → модель придумывает заголовки сама', () => {
  const out = articleUserPrompt('речь', { index: 1, total: 1, chapterTitles: [] });
  assert.ok(out.includes('придумай заголовки'), 'сказано придумать заголовки');
});
