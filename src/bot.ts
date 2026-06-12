import { writeFileSync } from 'node:fs';
import { Bot } from 'grammy';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { onStart } from './handlers/onStart.js';
import { onLink } from './handlers/onLink.js';
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
bot.command('start', onStart);
bot.command('help', onStart);
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
    logger.info({ username: me.username }, 'бот запущен');
  },
});
