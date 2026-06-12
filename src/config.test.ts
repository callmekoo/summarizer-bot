import { test } from 'node:test';
import assert from 'node:assert/strict';

// config читает process.env и валидирует при импорте — поэтому задаём окружение
// заранее и подгружаем модуль динамически (внутри этого тест-файла отдельный процесс).
test('config парсит ALLOWED_USER_IDS и применяет дефолты', async () => {
  process.env.BOT_TOKEN = 'test-token';
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.ALLOWED_USER_IDS = '111, 222 ,333';
  process.env.MAX_INPUT_TOKENS = '5000';
  delete process.env.MODEL;

  const { config } = await import('./config.js');

  // строка с пробелами → массив чисел
  assert.deepEqual(config.ALLOWED_USER_IDS, [111, 222, 333]);
  // числовая env приводится к number
  assert.equal(config.MAX_INPUT_TOKENS, 5000);
  // дефолт модели подставляется, когда переменная не задана
  assert.equal(config.MODEL, 'nvidia/nemotron-3-super-120b-a12b:free');
});
