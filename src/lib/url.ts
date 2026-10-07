const URL_RE = /https?:\/\/[^\s<>()]+/i;

/** Достаёт первую http(s)-ссылку из текста сообщения и нормализует её. */
export function extractUrl(text: string): string | null {
  const match = text.match(URL_RE);
  if (!match) return null;
  try {
    return normalizeYoutube(new URL(match[0])).toString();
  } catch {
    return null;
  }
}

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
]);
const LIVE_PATH_RE = /^\/live\/([\w-]{11})\/?$/;

/**
 * `youtube.com/live/ID` → `watch?v=ID`. Это одно и то же видео (идущий эфир или его
 * запись), но rdrr узнаёт id только в `?v=`, `youtu.be/`, `/embed/`, `/shorts/` — а
 * `/live/` без нормализации уходит в него как обычная веб-страница.
 */
function normalizeYoutube(url: URL): URL {
  if (!YOUTUBE_HOSTS.has(url.hostname)) return url;
  const id = url.pathname.match(LIVE_PATH_RE)?.[1];
  if (!id) return url;
  return new URL(`https://www.youtube.com/watch?v=${id}`);
}
