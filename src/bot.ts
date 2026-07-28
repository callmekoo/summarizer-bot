import { writeFileSync } from 'node:fs';
import { Bot } from 'grammy';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { onStart } from './handlers/onStart.js';
import { onHelp } from './handlers/onHelp.js';
import { onLink } from './handlers/onLink.js';
import { onArticle } from './handlers/onArticle.js';
import { COMMANDS } from './commands.js';
import { allowlist } from './middleware/allowlist.js';
import { rateLimit } from './middleware/rateLimit.js';

const bot = new Bot(config.BOT_TOKEN);

if (config.ALLOWED_USER_IDS.length === 0) {
  logger.warn('ALLOWED_USER_IDS пуст — бот отвечает всем. Укажи свой Telegram ID в .env.');
} else {
  logger.info({ count: config.ALLOWED_USER_IDS.length }, 'allowlist включён');
}

bot.use(allowlist);
bot.use(rateLimit);
// Имена и описания команд — в commands.ts (там же берёт их меню Telegram и /help).
// Команды разбираются до общего обработчика текста, иначе `/article <url>` уйдёт в пересказ.
bot.command('summary', onLink);
bot.command('article', onArticle);
bot.command('help', onHelp);
bot.command('start', onStart);
// Ссылка без команды = пересказ: extractUrl вытащит её из любого текста.
bot.on('message:text', onLink);

bot.catch((err) => {
  logger.error({ err: err.error }, 'необработанная ошибка бота');
});

// Heartbeat для Docker healthcheck: обновляем mtime файла, пока бот реально опрашивает
// Telegram. Если polling умрёт — файл «протухнет» и контейнер пометится unhealthy.
const HEARTBEAT_INTERVAL_MS = 15_000;

function writeHeartbeat(): void {
  try {
    writeFileSync(config.HEARTBEAT_FILE, String(Date.now()));
  } catch (err) {
    logger.warn({ err, file: config.HEARTBEAT_FILE }, 'не удалось записать heartbeat');
  }
}

const heartbeat = setInterval(() => {
  if (bot.isRunning()) writeHeartbeat();
}, HEARTBEAT_INTERVAL_MS);

const shutdown = (): void => {
  clearInterval(heartbeat);
  void bot.stop();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

bot.start({
  onStart: (me) => {
    writeHeartbeat();
    // Меню у поля ввода: без регистрации набор «/» не подсказывает ничего. Вызов сетевой,
    // но бот без меню вполне работоспособен — падать из-за него не за что, только warn.
    void bot.api
      .setMyCommands(COMMANDS.map(({ command, description }) => ({ command, description })))
      .catch((err: unknown) => logger.warn({ err }, 'не удалось зарегистрировать меню команд'));
    logger.info({ username: me.username }, 'бот запущен');
  },
});
