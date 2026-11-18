import type { Context } from 'grammy';

// Приветствие держим коротким: подробности живут в /help, чтобы не дублировать их в двух
// местах и не разъезжаться при добавлении команд.
// Нужно и при одобрении заявки: новичок получает то же приветствие, что и /start.
export const GREETING =
  'Привет! Пришли ссылку на статью или YouTube-видео — верну краткий пересказ на русском.\n\n' +
  'А ещё умею:\n' +
  '<code>/article &lt;ссылка&gt;</code> — соберу из видео полноценную статью и пришлю ' +
  '.md-файлом;\n' +
  '<code>/search &lt;запрос&gt;</code> — найду видео на YouTube; выбранное перескажу ' +
  'или разверну в статью;\n' +
  'пришли файл (.md, .txt, .html, субтитры, .fb2) — перескажу и его.\n\n' +
  'Все команды и подробности — /help';

export async function onStart(ctx: Context): Promise<void> {
  await ctx.reply(GREETING, {
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  });
}
