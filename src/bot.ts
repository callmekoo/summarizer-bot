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

process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());

bot.start({
  onStart: (me) => logger.info({ username: me.username }, 'бот запущен'),
});
