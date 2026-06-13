import { test } from 'node:test';
import assert from 'node:assert/strict';

// config читает process.env и валидирует при импорте — поэтому задаём окружение
// заранее и подгружаем модуль динамически (внутри этого тест-файла отдельный процесс).
test('config: парсинг, дефолты и обратная совместимость ключа', async () => {
  // Не подхватывать реальный .env — тест должен зависеть только от заданного здесь.
  process.env.DOTENV_CONFIG_PATH = '/dev/null';
  process.env.BOT_TOKEN = 'test-token';
  // намеренно ставим СТАРОЕ имя — проверяем обратную совместимость
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_BASE_URL;
  process.env.ALLOWED_USER_IDS = '111, 222 ,333';
  process.env.MAX_INPUT_TOKENS = '5000';
  delete process.env.MODEL;

  const { config } = await import('./config.js');

  // OPENROUTER_API_KEY подхватывается как LLM_API_KEY
  assert.equal(config.LLM_API_KEY, 'test-key');
  // дефолтный провайдер — OpenRouter
  assert.equal(config.LLM_BASE_URL, 'https://openrouter.ai/api/v1');
  // строка с пробелами → массив чисел
  assert.deepEqual(config.ALLOWED_USER_IDS, [111, 222, 333]);
  // числовая env приводится к number
  assert.equal(config.MAX_INPUT_TOKENS, 5000);
  // дефолт модели подставляется, когда переменная не задана
  assert.equal(config.MODEL, 'nvidia/nemotron-3-super-120b-a12b:free');
});
