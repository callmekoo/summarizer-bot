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
  logger.warn(
    'ALLOWED_USER_IDS пуст — бот отвечает всем. Укажи свой Telegram ID в .env.',
  );
} else {
  logger.info({ count: config.ALLOWED_USER_IDS.length }, 'allowlist включён');
}

bot.use(allowlist);
bot.use(rateLimit);
// До общего обработчика текста, иначе `/article <url>` уйдёт в пересказ.
bot.command('summary', onLink);
bot.command('article', onArticle);
bot.command('help', onHelp);
bot.command('start', onStart);
// Ссылка без команды — тоже пересказ.
bot.on('message:text', onLink);

bot.catch((err) => {
  logger.error({ err: err.error }, 'необработанная ошибка бота');
});

// Docker healthcheck: файл «протух» дольше 60 с — контейнер unhealthy.
const HEARTBEAT_INTERVAL_MS = 15_000;

function writeHeartbeat(): void {
  try {
    writeFileSync(config.HEARTBEAT_FILE, String(Date.now()));
  } catch (err) {
    logger.warn(
      { err, file: config.HEARTBEAT_FILE },
      'не удалось записать heartbeat',
    );
  }
}

// isRunning() true ещё до успешного getMe, isInited() — только после.
const heartbeat = setInterval(() => {
  if (bot.isInited() && bot.isRunning()) writeHeartbeat();
}, HEARTBEAT_INTERVAL_MS);

// После stop() event loop держат keep-alive сокеты grammY, сам процесс не выйдет.
const SHUTDOWN_TIMEOUT_MS = 5_000;

let stopping = false;

const shutdown = (): void => {
  stopping = true;
  clearInterval(heartbeat);
  setTimeout(
    () => process.exit(process.exitCode ?? 0),
    SHUTDOWN_TIMEOUT_MS,
  ).unref();
  bot
    .stop()
    .catch((err: unknown) =>
      logger.warn({ err }, 'остановка поллинга с ошибкой'),
    );
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

bot
  .start({
    onStart: (me) => {
      writeHeartbeat();
      // Меню у поля ввода. Сетевой вызов, но без меню бот работоспособен — только warn.
      void bot.api
        .setMyCommands(
          COMMANDS.map(({ command, description }) => ({
            command,
            description,
          })),
        )
        .catch((err: unknown) =>
          logger.warn({ err }, 'не удалось зарегистрировать меню команд'),
        );
      logger.info({ username: me.username }, 'бот запущен');
    },
  })
  // start() реджектится и при штатной остановке, и при отказе поллинга (401, 409).
  .catch((err: unknown) => {
    clearInterval(heartbeat);
    if (stopping) {
      logger.info('поллинг остановлен');
      return;
    }
    logger.fatal({ err }, 'поллинг остановлен из-за ошибки');
    process.exitCode = 1;
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
  });
