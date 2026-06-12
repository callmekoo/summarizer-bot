const TG_LIMIT = 4096;

/** Экранирует спецсимволы HTML, чтобы текст от модели не ломал разметку Telegram. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Превращает ответ модели в безопасный Telegram-HTML.
 * Модель размечает заголовки блоков как **жирный** — сначала всё экранируем,
 * затем по нашей же конвенции превращаем **…** в <b>…</b>.
 */
export function toTelegramHtml(text: string): string {
  const escaped = escapeHtml(text.trim());
  return escaped.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

/** Режет текст на части под лимит Telegram (4096), по границам строк. */
export function splitForTelegram(text: string, limit = TG_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const parts: string[] = [];
  let buf = '';
  for (const rawLine of text.split('\n')) {
    // Очень длинную одиночную строку режем жёстко.
    let line = rawLine;
    while (line.length > limit) {
      parts.push(line.slice(0, limit));
      line = line.slice(limit);
    }
    if (buf.length + line.length + 1 > limit) {
      if (buf) parts.push(buf);
      buf = line;
    } else {
      buf = buf ? `${buf}\n${line}` : line;
    }
  }
  if (buf) parts.push(buf);
  return parts;
}
