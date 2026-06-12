const URL_RE = /https?:\/\/[^\s<>()]+/i;

/** Достаёт первую http(s)-ссылку из текста сообщения и нормализует её. */
export function extractUrl(text: string): string | null {
  const match = text.match(URL_RE);
  if (!match) return null;
  try {
    return new URL(match[0]).toString();
  } catch {
    return null;
  }
}
