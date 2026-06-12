import { Bot } from 'grammy';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { onStart } from './handlers/onStart.js';
import { onLink } from './handlers/onLink.js';

const bot = new Bot(config.BOT_TOKEN);

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
