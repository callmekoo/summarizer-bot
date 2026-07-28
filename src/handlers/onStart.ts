import type { Context } from 'grammy';

// Приветствие держим коротким: подробности живут в /help, чтобы не дублировать их в двух
// местах и не разъезжаться при добавлении команд.
export async function onStart(ctx: Context): Promise<void> {
  await ctx.reply(
    'Привет! Пришли ссылку на статью или YouTube-видео — верну краткий пересказ на русском.\n\n' +
      'А ещё умею <code>/article &lt;ссылка&gt;</code> — соберу из видео полноценную статью ' +
      'и пришлю .md-файлом.\n\n' +
      'Все команды и подробности — /help',
    { parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
  );
}
