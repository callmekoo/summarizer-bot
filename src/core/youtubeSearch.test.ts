import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSearchResults,
  renderSearchList,
  youtubeWatchUrl,
  PICK_COMMAND_RE,
  encodeVideoId,
  decodeVideoId,
  pickCommand,
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

test('кодирование id для команды обратимо и даёт только [A-Za-z0-9_]', () => {
  for (const id of [
    'oSsqVq4bhd8',
    'a-b_c-d_e-f',
    '___________',
    '-----------',
  ]) {
    const code = encodeVideoId(id);
    assert.match(code, /^[A-Za-z0-9_]+$/, `код «${code}» оборвёт подсветку`);
    assert.equal(decodeVideoId(code), id);
  }
  assert.equal(encodeVideoId('ab_c-d'), 'ab_0c_1d');
});

test('decodeVideoId отвергает испорченный код', () => {
  for (const bad of [
    '',
    'short',
    'oSsqVq4bhd8x',
    'abc_2defghij',
    'oSsqVq4bhd_',
    'ab-cdefghij',
  ]) {
    assert.equal(decodeVideoId(bad), null, `«${bad}» не должен декодироваться`);
  }
});

test('PICK_COMMAND_RE ловит обе команды, в том числе с @botname', () => {
  const id = 'a-b_cdefghi';
  for (const action of ['sum', 'art'] as const) {
    const cmd = pickCommand(action, id);
    for (const text of [cmd, `${cmd}@summarizer_bot`]) {
      const m = text.match(PICK_COMMAND_RE);
      assert.equal(m?.[1], action);
      assert.equal(decodeVideoId(m![2]!), id);
    }
  }
  // Обычные команды бота сюда не попадают.
  for (const text of [
    '/summary https://x.y',
    '/article',
    '/search кот',
    '/sum',
  ]) {
    assert.equal(PICK_COMMAND_RE.test(text), false, text);
  }
});

test('renderSearchList: ссылка в названии, экранирование и обе команды', () => {
  const hits: VideoHit[] = [
    { id: 'aaaaaaaaaa1', title: 'C++ <templates> & co', duration: '9:59' },
    {
      id: 'bb-bbbbbb_2',
      title: 'Второе',
      channel: 'Канал <b>',
      duration: '1:02:03',
    },
  ];
  const text = renderSearchList(hits);

  assert.ok(
    text.includes(
      '1. <a href="https://youtu.be/aaaaaaaaaa1">C++ &lt;templates&gt; &amp; co</a>\n9:59\n' +
        '/sum_aaaaaaaaaa1 · /art_aaaaaaaaaa1',
    ),
    text,
  );
  assert.ok(
    text.includes(
      '2. <a href="https://youtu.be/bb-bbbbbb_2">Второе</a>\nКанал &lt;b&gt; · 1:02:03\n' +
        '/sum_bb_1bbbbbb_02 · /art_bb_1bbbbbb_02',
    ),
    text,
  );
  // В шапке нет голых слэш-команд: Telegram подсветил бы их, а бот не понял бы.
  const head = text.split('\n\n')[0]!;
  assert.doesNotMatch(head, /\/\w/);
});

test('youtubeWatchUrl строит каноническую ссылку', () => {
  assert.equal(
    youtubeWatchUrl('oSsqVq4bhd8'),
    'https://www.youtube.com/watch?v=oSsqVq4bhd8',
  );
});
