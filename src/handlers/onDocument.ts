import type { Context } from 'grammy';
import {
  checkDocument,
  readDocument,
  DocumentError,
  type DocumentFormat,
} from '../core/document.js';
import { renderSourceHeader } from '../core/formatter.js';
import { summarizeSource, userMessageForError } from './onLink.js';
import { replyTo } from '../lib/reply.js';
import { config } from '../config.js';

/**
 * Присланный файл (.md, .txt, .html, субтитры, .fb2) → пересказ, как у веб-страницы.
 * Формат и размер проверяем до очереди: на неподходящий файл отвечаем сразу.
 */
export async function onDocument(ctx: Context): Promise<void> {
  const message = ctx.message;
  const doc = message?.document;
  // GIF Telegram присылает и как animation, и как document — это не документ.
  if (!message || !doc || message.animation) return;

  let format: DocumentFormat;
  try {
    format = checkDocument({
      fileName: doc.file_name,
      mimeType: doc.mime_type,
      fileSize: doc.file_size,
    });
  } catch (err) {
    await ctx.reply(userMessageForError(err), replyTo(message.message_id));
    return;
  }

  const fileName = doc.file_name ?? 'документ';
  await summarizeSource(
    ctx,
    {
      status: '⏳ Читаю файл…',
      log: { file: fileName, format, bytes: doc.file_size },
      load: async () => {
        const bytes = await downloadDocument(ctx);
        const { markdown, title } = await readDocument(bytes, format);
        return {
          markdown,
          // Модели нужен хоть какой-то заголовок, а в шапке имя файла и так есть.
          title: title ?? fileName.replace(/\.[^.]+$/, ''),
          header: renderSourceHeader({ title, file: fileName }),
        };
      },
    },
    message.message_id,
  );
}

const DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * Скачивает файл текущего сообщения. В адресе файла токен бота: в текст ошибки его не
 * кладём (logger токен вырежет, но не стоит на это полагаться).
 */
async function downloadDocument(ctx: Context): Promise<Uint8Array> {
  try {
    const file = await ctx.getFile();
    if (!file.file_path) throw new Error('Telegram не вернул file_path');
    const res = await fetch(
      `https://api.telegram.org/file/bot${config.BOT_TOKEN}/${file.file_path}`,
      { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new DocumentError('download', `не удалось скачать файл: ${reason}`);
  }
}
