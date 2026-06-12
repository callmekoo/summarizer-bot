import type { Context } from 'grammy';

export async function onStart(ctx: Context): Promise<void> {
  await ctx.reply(
    'Привет! Пришли мне ссылку на статью или YouTube-видео — ' +
      'я верну краткий пересказ на русском.\n\n' +
      'Просто отправь ссылку в чат.',
  );
}
