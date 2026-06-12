const TG_LIMIT = 4096;

/** Экранирует спецсимволы HTML, чтобы текст от модели не ломал разметку Telegram. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Экранирование для значения HTML-атрибута (href). */
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

export interface SourceMeta {
  url: string;
  title?: string;
  author?: string;
  site?: string;
}

/**
 * Шапка с источником над пересказом: кликабельный заголовок-ссылка, затем сайт и автор.
 * Возвращает '' если выводить нечего. Все поля экранируются.
 */
export function renderSourceHeader(meta: SourceMeta): string {
  const lines: string[] = [];

  if (meta.title) {
    lines.push(`<a href="${escapeAttr(meta.url)}"><b>${escapeHtml(meta.title)}</b></a>`);
  }

  const sub: string[] = [];
  if (meta.site) sub.push(`🌐 ${escapeHtml(meta.site)}`);
  if (meta.author) sub.push(`✍️ ${escapeHtml(meta.author)}`);
  if (sub.length) lines.push(sub.join(' · '));

  return lines.join('\n');
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
