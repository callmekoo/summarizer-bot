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
 * Сначала всё экранируем, затем по нашим конвенциям маппим markdown в HTML-теги,
 * которые понимает Telegram. Бэктики обязательно превращаем в <code>/<pre> —
 * иначе они утекают сырыми символами (parse_mode HTML их за разметку не считает).
 */
export function toTelegramHtml(text: string): string {
  let s = escapeHtml(text.trim());
  // Блоки кода ```…``` → <pre> (до инлайна, чтобы тройные бэктики не съел `…`).
  // Необязательный тег языка после ``` отбрасываем.
  s = s.replace(/```[^\n`]*\n?([\s\S]*?)```/g, (_m, code: string) => `<pre>${code.replace(/\n+$/, '')}</pre>`);
  // Цитаты: подряд идущие строки `> …` → один <blockquote>.
  s = wrapBlockquotes(s);
  // Инлайн-код `…` → <code>.
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  // **жирный** → <b> (заголовки блоков).
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  return s;
}

// После escapeHtml символ '>' уже стал '&gt;', поэтому ловим строки цитат по нему.
const QUOTE_LINE = /^&gt;\s?/;

/** Группирует подряд идущие строки-цитаты в один <blockquote> (markdown `>` → Telegram). */
function wrapBlockquotes(s: string): string {
  const out: string[] = [];
  let quote: string[] | null = null;

  const flush = (): void => {
    if (quote) {
      out.push(`<blockquote>${quote.join('\n')}</blockquote>`);
      quote = null;
    }
  };

  for (const line of s.split('\n')) {
    if (QUOTE_LINE.test(line)) {
      (quote ??= []).push(line.replace(QUOTE_LINE, ''));
    } else {
      flush();
      out.push(line);
    }
  }
  flush();
  return out.join('\n');
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
