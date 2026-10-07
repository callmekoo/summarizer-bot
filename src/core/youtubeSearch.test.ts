import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSearchResults,
  renderSearchList,
  youtubeWatchUrl,
  PICK_RE,
  type VideoHit,
} from './youtubeSearch.js';

// Модуль без config/logger — импортируем статически, окружение не нужно.

/** videoRenderer в форме ответа InnerTube (лишние поля опущены). */
function video(id: string, extra: Record<string, unknown> = {}) {
  return {
    videoRenderer: {
      videoId: id,
      title: { runs: [{ text: `Видео ` }, { text: id }] },
      ownerText: { runs: [{ text: 'Канал' }] },
      lengthText: { simpleText: '12:34' },
      thumbnailOverlays: [
        { thumbnailOverlayTimeStatusRenderer: { style: 'DEFAULT' } },
      ],
      ...extra,
    },
  };
}

/** Обёртка, как в настоящем ответе: twoColumn → sectionList → itemSection. */
function response(items: unknown[]) {
  return {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [
              { itemSectionRenderer: { contents: items } },
              { continuationItemRenderer: {} },
            ],
          },
        },
      },
    },
  };
}

const overlay = (style: string) => [
  { thumbnailOverlayTimeStatusRenderer: { style } },
];

test('обычное видео разбирается целиком', () => {
  const { hits, skipped } = parseSearchResults(
    response([video('aaaaaaaaaa1')]),
  );
  assert.deepEqual(hits, [
    {
      id: 'aaaaaaaaaa1',
      title: 'Видео aaaaaaaaaa1',
      channel: 'Канал',
      duration: '12:34',
    },
  ]);
  assert.deepEqual(skipped, []);
});

test('идущий эфир, анонс, шортс и видео без длительности отсеяны с причиной', () => {
  const { hits, skipped } = parseSearchResults(
    response([
      video('live0000001', {
        lengthText: undefined,
        thumbnailOverlays: overlay('LIVE'),
      }),
      // Бейдж «В эфире» без оверлея — тоже эфир.
      video('live0000002', {
        badges: [
          { metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_LIVE_NOW' } },
        ],
      }),
      video('upcoming001', {
        lengthText: undefined,
        upcomingEventData: { startTime: '1791000000' },
      }),
      video('shorts00001', { thumbnailOverlays: overlay('SHORTS') }),
      video('nolength001', { lengthText: undefined }),
      video('normal00001'),
    ]),
  );
  assert.deepEqual(
    hits.map((h) => h.id),
    ['normal00001'],
  );
  assert.deepEqual(
    skipped.map((s) => [s.id, s.reason]),
    [
      ['live0000001', 'live'],
      ['live0000002', 'live'],
      ['upcoming001', 'upcoming'],
      ['shorts00001', 'shorts'],
      ['nolength001', 'no_duration'],
    ],
  );
});

test('запись прошедшей трансляции — обычное видео, проходит', () => {
  const { hits } = parseSearchResults(
    response([
      video('streamed001', {
        lengthText: { simpleText: '2:01:15' },
        publishedTimeText: { simpleText: 'Трансляция закончилась 2 дня назад' },
      }),
    ]),
  );
  assert.deepEqual(
    hits.map((h) => [h.id, h.duration]),
    [['streamed001', '2:01:15']],
  );
});

test('берётся не больше limit, дубли и кривые id пропускаются', () => {
  const ids = Array.from({ length: 8 }, (_, i) => `video000000${i}`.slice(-11));
  const { hits } = parseSearchResults(
    response([video('bad'), ...ids.map((id) => video(id)), video(ids[0]!)]),
    5,
  );
  assert.deepEqual(
    hits.map((h) => h.id),
    ids.slice(0, 5),
  );
});

test('канал берётся из longBylineText, если ownerText нет', () => {
  const { hits } = parseSearchResults(
    response([
      video('byline00001', {
        ownerText: undefined,
        longBylineText: { runs: [{ text: 'Другой канал' }] },
      }),
    ]),
  );
  assert.equal(hits[0]?.channel, 'Другой канал');
});

test('мусор на входе — пустой результат, без исключений', () => {
  for (const junk of [
    null,
    undefined,
    42,
    'строка',
    [],
    {},
    { contents: [1] },
  ]) {
    assert.deepEqual(parseSearchResults(junk), { hits: [], skipped: [] });
  }
});

test('renderSearchList: нумерация, экранирование и кнопки с id видео', () => {
  const hits: VideoHit[] = [
    { id: 'aaaaaaaaaa1', title: 'C++ <templates> & co', duration: '9:59' },
    {
      id: 'bbbbbbbbbb2',
      title: 'Второе',
      channel: 'Канал <b>',
      duration: '1:02:03',
    },
  ];
  const { text, keyboard } = renderSearchList(hits);

  assert.match(text, /1\. <b>C\+\+ &lt;templates&gt; &amp; co<\/b>\n9:59/);
  assert.match(text, /2\. <b>Второе<\/b>\nКанал &lt;b&gt; · 1:02:03/);

  const buttons = keyboard.inline_keyboard.flat();
  assert.deepEqual(
    buttons.map((b) => b.text),
    ['1', '2'],
  );
  const data = buttons.map((b) =>
    'callback_data' in b ? b.callback_data : '',
  );
  // Кнопка должна ловиться тем же регекспом, что регистрируется в bot.ts.
  assert.deepEqual(
    data.map((d) => d.match(PICK_RE)?.[1]),
    ['aaaaaaaaaa1', 'bbbbbbbbbb2'],
  );
  // Лимит Telegram на callback_data — 64 байта.
  for (const d of data) assert.ok(Buffer.byteLength(d) <= 64);
});

test('youtubeWatchUrl строит каноническую ссылку', () => {
  assert.equal(
    youtubeWatchUrl('oSsqVq4bhd8'),
    'https://www.youtube.com/watch?v=oSsqVq4bhd8',
  );
});
