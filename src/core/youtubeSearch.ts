import { InlineKeyboard } from 'grammy';
import { escapeHtml } from './formatter.js';

/**
 * Поиск видео на YouTube для /search. Через InnerTube — внутренний API, на котором
 * работает сам сайт и через который rdrr уже тянет субтитры: без ключа и квот, но и без
 * гарантий формата. Поэтому разбор защитный, а всё, что не похоже на обычное видео,
 * отбрасывается с причиной — её видно в smoke-скрипте (src/scripts/searchSmoke.ts).
 *
 * Модуль намеренно без logger/config: тесты и smoke-скрипт работают без .env.
 */

export interface VideoHit {
  id: string;
  title: string;
  channel?: string;
  /** Как показывает YouTube: «12:34», «1:02:03». */
  duration: string;
}

export type SkipReason = 'live' | 'upcoming' | 'shorts' | 'no_duration';

export interface SkippedVideo {
  id: string;
  title: string;
  reason: SkipReason;
}

export interface SearchResults {
  hits: VideoHit[];
  skipped: SkippedVideo[];
}

export type SearchErrorKind = 'timeout' | 'failed';

export class SearchError extends Error {
  constructor(
    public readonly kind: SearchErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'SearchError';
  }
}

const SEARCH_URL =
  'https://www.youtube.com/youtubei/v1/search?prettyPrint=false';
// Тот же WEB-клиент, что у rdrr для /next: перестанет приниматься — сломается и пересказ.
const CLIENT = {
  clientName: 'WEB',
  clientVersion: '2.20240101.00.00',
  hl: 'ru',
};
// Фильтр выдачи «Тип: видео» (без каналов и плейлистов) — protobuf из URL сайта (&sp=).
const ONLY_VIDEOS = 'EgIQAQ==';
const TIMEOUT_MS = 15_000;

export const SEARCH_LIMIT = 5;

/** id видео YouTube — ровно 11 символов base64url. */
export const VIDEO_ID_RE = /^[\w-]{11}$/;

/** callback_data кнопок из renderSearchList. */
export const PICK_PREFIX = 'sum:';
/** Нажатие на кнопку из renderSearchList; группа 1 — id видео. */
export const PICK_RE = /^sum:([\w-]{11})$/;

export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

export async function searchYoutube(
  query: string,
  limit = SEARCH_LIMIT,
): Promise<SearchResults> {
  return parseSearchResults(await fetchSearchJson(query), limit);
}

/** Сырой ответ InnerTube. Отдельно — чтобы smoke-скрипт мог сохранить его в фикстуру. */
export async function fetchSearchJson(query: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: { client: CLIENT },
        query,
        params: ONLY_VIDEOS,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new SearchError('timeout', 'поиск на YouTube не ответил вовремя');
    }
    throw new SearchError('failed', `поиск на YouTube недоступен: ${err}`);
  }
  if (!res.ok) {
    throw new SearchError('failed', `поиск на YouTube ответил ${res.status}`);
  }
  try {
    return await res.json();
  } catch {
    throw new SearchError('failed', 'поиск на YouTube вернул не JSON');
  }
}

/**
 * Достаёт видео из ответа InnerTube. Берём только `videoRenderer` — обычный результат
 * поиска; шортсы и прочие карточки приходят другими рендерерами и сюда не попадают.
 *
 * Эфиры отсекаем консервативно: у видео должна быть длительность, и не должно быть ни
 * одного признака эфира. Запись прошедшей трансляции — обычное видео с длительностью,
 * она проходит (`/live/ID` и `watch?v=ID` — одно и то же).
 */
export function parseSearchResults(
  json: unknown,
  limit = SEARCH_LIMIT,
): SearchResults {
  const hits: VideoHit[] = [];
  const skipped: SkippedVideo[] = [];
  const seen = new Set<string>();

  for (const r of collectVideoRenderers(json)) {
    const id = str(r.videoId);
    if (!id || !VIDEO_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    const title = text(r.title) ?? id;

    const reason = skipReason(r);
    if (reason) {
      skipped.push({ id, title, reason });
      continue;
    }
    if (hits.length < limit) {
      hits.push({
        id,
        title,
        channel: text(r.ownerText) ?? text(r.longBylineText),
        duration: text(r.lengthText)!,
      });
    }
  }
  return { hits, skipped };
}

function skipReason(r: Obj): SkipReason | undefined {
  const overlayStyles = arr(r.thumbnailOverlays).map((o) =>
    str(obj(obj(o).thumbnailOverlayTimeStatusRenderer).style),
  );
  const badgeStyles = arr(r.badges).map((b) =>
    str(obj(obj(b).metadataBadgeRenderer).style),
  );
  if (
    overlayStyles.includes('LIVE') ||
    badgeStyles.includes('BADGE_STYLE_TYPE_LIVE_NOW')
  ) {
    return 'live';
  }
  if (r.upcomingEventData !== undefined || overlayStyles.includes('UPCOMING')) {
    return 'upcoming';
  }
  if (overlayStyles.includes('SHORTS')) return 'shorts';
  // У эфира длительности нет. Нет её и признаков эфира тоже нет — формат поменялся или
  // это что-то странное: лучше не предложить видео, чем предложить трансляцию.
  if (!text(r.lengthText)) return 'no_duration';
  return undefined;
}

/** Обход в глубину: результаты лежат в sectionList → itemSection, но точный путь не важен. */
function collectVideoRenderers(root: unknown): Obj[] {
  const out: Obj[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'videoRenderer' && typeof value === 'object' && value) {
        out.push(value as Obj);
      } else {
        walk(value);
      }
    }
  };
  walk(root);
  return out;
}

/**
 * Сообщение-список для /search и клавиатура «1…N». В callback_data — сам id видео
 * (`sum:<id>`, 15 байт при лимите 64): хранить результаты поиска не нужно, кнопки
 * работают и после рестарта бота.
 */
export function renderSearchList(hits: VideoHit[]): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const lines = hits.map((h, i) => {
    const meta = [h.channel, h.duration]
      .filter((s): s is string => Boolean(s))
      .map(escapeHtml);
    return `${i + 1}. <b>${escapeHtml(h.title)}</b>\n${meta.join(' · ')}`;
  });
  const keyboard = new InlineKeyboard();
  hits.forEach((h, i) => keyboard.text(String(i + 1), `${PICK_PREFIX}${h.id}`));
  return {
    text: ['Что пересказать?', ...lines].join('\n\n'),
    keyboard,
  };
}

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj =>
  typeof v === 'object' && v !== null ? (v as Obj) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

/** Текст InnerTube приходит либо `{simpleText}`, либо `{runs: [{text}]}`. */
function text(v: unknown): string | undefined {
  const o = obj(v);
  // Куски runs не тримим по одному: пробелы между словами живут на их стыках.
  const runs = arr(o.runs)
    .map((r) => obj(r).text)
    .filter((t): t is string => typeof t === 'string')
    .join('');
  return str(o.simpleText) ?? str(runs);
}
