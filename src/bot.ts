import { writeFileSync } from 'node:fs';
import { Bot } from 'grammy';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { onStart } from './handlers/onStart.js';
import { onHelp } from './handlers/onHelp.js';
import { onLink } from './handlers/onLink.js';
import { onArticle } from './handlers/onArticle.js';
import { onDocument } from './handlers/onDocument.js';
import { onSearch, onSearchCommand } from './handlers/onSearch.js';
import { PICK_COMMAND_RE } from './core/youtubeSearch.js';
import { COMMANDS, PUBLIC_COMMANDS } from './commands.js';
import {
  createAccess,
  isAdmin,
  renderApplication,
  applicationKeyboard,
} from './middleware/access.js';
import {
  onAccessButton,
  onUsers,
  onStats,
  onApprove,
  onRevoke,
  onBan,
} from './handlers/admin.js';
import { rateLimit } from './middleware/rateLimit.js';
import { initStore } from './lib/store.js';
import { seedApproved } from './db/users.js';
import type { Db } from './db/database.js';

// База пользователей и статистики. Без неё проверка доступа невозможна, а работать без
// проверки — значит тратить деньги на кого угодно. Поэтому не открылась — выходим.
let db: Db;
try {
  db = await initStore();
  // Тут же, под тем же понятным сообщением: SQLITE_BUSY (файл держит другой процесс) или
  // запись в недоступный каталог иначе уронили бы старт сырым стектрейсом.
  seedApproved(db, config.ALLOWED_USER_IDS, Date.now());
} catch (err) {
  logger.fatal(
    { err, path: config.DB_PATH },
    'не удалось открыть базу (DB_PATH): проверь путь и права на каталог',
  );
  process.exit(1);
}
logger.info(
  { admin: config.ADMIN_USER_ID, preapproved: config.ALLOWED_USER_IDS.length },
  'доступ по заявкам включён',
);

const bot = new Bot(config.BOT_TOKEN);

bot.use(
  createAccess({
    db,
    adminId: config.ADMIN_USER_ID,
    now: Date.now,
    notifyAdmin: async (user) => {
      await bot.api.sendMessage(config.ADMIN_USER_ID, renderApplication(user), {
        parse_mode: 'HTML',
        reply_markup: applicationKeyboard(user.id),
      });
    },
  }),
);
bot.use(rateLimit);
// Команды и кнопки владельца. Для остальных их нет: апдейт идёт дальше, как обычный текст.
const admin = bot.filter(isAdmin);
admin.callbackQuery(/^access:(approve|reject|ban):(\d+)$/, onAccessButton);
admin.command('users', onUsers);
admin.command('stats', onStats);
admin.command('approve', onApprove);
admin.command('revoke', onRevoke);
admin.command('ban', onBan);
// До общего обработчика текста, иначе `/article <url>` уйдёт в пересказ.
bot.command('summary', onLink);
bot.command('article', onArticle);
bot.command('search', onSearch);
bot.command('help', onHelp);
bot.command('start', onStart);
// Команды `/sum_<id>` и `/art_<id>` из списка /search. Имена динамические, поэтому
// hears, а не command; иначе их, как и прочий текст, съест onLink.
bot.hears(PICK_COMMAND_RE, onSearchCommand);
// Ссылка без команды — тоже пересказ.
bot.on('message:text', onLink);
// Присланный файл (.md, .txt, .html, …) — пересказ, как у веб-страницы.
bot.on('message:document', onDocument);

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
      const menu = (list: typeof COMMANDS) =>
        list.map(({ command, description }) => ({ command, description }));
      void bot.api
        .setMyCommands(menu(PUBLIC_COMMANDS))
        .catch((err: unknown) =>
          logger.warn({ err }, 'не удалось зарегистрировать меню команд'),
        );
      // Владельцу — меню с админскими командами. Падает, если он ни разу не писал боту.
      void bot.api
        .setMyCommands(menu(COMMANDS), {
          scope: { type: 'chat', chat_id: config.ADMIN_USER_ID },
        })
        .catch((err: unknown) =>
          logger.warn({ err }, 'не удалось зарегистрировать меню владельца'),
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
