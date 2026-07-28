import type { Context } from 'grammy';
import { renderHelp } from '../commands.js';

export async function onHelp(ctx: Context): Promise<void> {
  await ctx.reply(renderHelp(), {
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  });
}
