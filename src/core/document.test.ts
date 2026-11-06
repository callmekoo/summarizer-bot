import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkDocument,
  decodeText,
  documentFormat,
  fb2ToText,
  readDocument,
  subtitlesToText,
  supportedExtensions,
  DocumentError,
} from './document.js';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

// --- формат и проверки до скачивания ---

test('documentFormat: формат по расширению, без учёта регистра', () => {
  assert.equal(documentFormat('notes.md'), 'text');
  assert.equal(documentFormat('README.MARKDOWN'), 'text');
  assert.equal(documentFormat('a.b.txt'), 'text');
  assert.equal(documentFormat('page.HTM'), 'html');
  assert.equal(documentFormat('lecture.srt'), 'subtitles');
  assert.equal(documentFormat('lecture.vtt'), 'subtitles');
  assert.equal(documentFormat('book.fb2'), 'fb2');
});

test('documentFormat: неизвестное или отсутствующее расширение → undefined', () => {
  assert.equal(documentFormat('doc.pdf'), undefined);
  assert.equal(documentFormat('book.fb2.zip'), undefined);
  assert.equal(documentFormat('Makefile'), undefined);
  assert.equal(documentFormat(undefined), undefined);
});

test('documentFormat: без имени файла — по MIME', () => {
  assert.equal(documentFormat(undefined, 'text/plain'), 'text');
  assert.equal(documentFormat(undefined, 'text/html; charset=utf-8'), 'html');
  assert.equal(documentFormat(undefined, 'application/pdf'), undefined);
});

test('checkDocument: неподдерживаемый формат → DocumentError(unsupported)', () => {
  assert.throws(
    () => checkDocument({ fileName: 'x.pdf', fileSize: 10 }),
    (e: unknown) => e instanceof DocumentError && e.kind === 'unsupported',
  );
});

test('checkDocument: слишком большой файл → DocumentError(too_large)', () => {
  assert.throws(
    () => checkDocument({ fileName: 'x.md', fileSize: 50 * 1024 * 1024 }),
    (e: unknown) => e instanceof DocumentError && e.kind === 'too_large',
  );
});

test('checkDocument: годный файл → формат; размер может быть неизвестен', () => {
  assert.equal(checkDocument({ fileName: 'x.md', fileSize: 1000 }), 'text');
  assert.equal(checkDocument({ fileName: 'x.html' }), 'html');
});

test('supportedExtensions перечисляет все форматы для сообщения пользователю', () => {
  const list = supportedExtensions();
  for (const ext of ['.md', '.txt', '.html', '.srt', '.vtt', '.fb2']) {
    assert.ok(list.includes(ext), ext);
  }
});

// --- кодировки ---

test('decodeText: UTF-8, BOM срезается', () => {
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('Привет')]);
  assert.equal(decodeText(utf8('Привет')), 'Привет');
  assert.equal(decodeText(bom), 'Привет');
});

test('decodeText: не UTF-8 → windows-1251', () => {
  // «Привет» в cp1251.
  const cp1251 = new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
  assert.equal(decodeText(cp1251), 'Привет');
});

test('decodeText: UTF-16 с BOM (Блокнот Windows «Юникод»)', () => {
  const le = new Uint8Array([0xff, 0xfe, 0x1f, 0x04, 0x40, 0x04]); // «Пр»
  const be = new Uint8Array([0xfe, 0xff, 0x04, 0x1f, 0x04, 0x40]);
  assert.equal(decodeText(le), 'Пр');
  assert.equal(decodeText(be), 'Пр');
});

test('decodeText: бинарник под видом текста → DocumentError(encoding)', () => {
  assert.throws(
    () => decodeText(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0x01])),
    (e: unknown) => e instanceof DocumentError && e.kind === 'encoding',
  );
});

// --- субтитры ---

test('subtitlesToText: SRT — без номеров, тайм-кодов и тегов', () => {
  const srt = [
    '1',
    '00:00:01,000 --> 00:00:03,000',
    '<i>Привет</i>, это лекция.',
    '',
    '2',
    '00:00:03,500 --> 00:00:05,000',
    '{\\an8}Сегодня про',
    'нейросети.',
    '',
  ].join('\r\n');
  assert.equal(
    subtitlesToText(srt),
    'Привет, это лекция. Сегодня про нейросети.',
  );
});

test('subtitlesToText: VTT — шапка, NOTE, настройки реплик и дубли автосубтитров', () => {
  const vtt = [
    'WEBVTT',
    'Kind: captions',
    'Language: ru',
    '',
    'NOTE это комментарий',
    'на две строки',
    '',
    '00:00:01.000 --> 00:00:02.000 align:start position:0%',
    'первая<00:00:01.500><c> фраза</c>',
    '',
    '00:00:02.000 --> 00:00:03.000',
    'первая фраза',
    'вторая фраза',
    '',
  ].join('\n');
  assert.equal(subtitlesToText(vtt), 'первая фраза вторая фраза');
});

// --- FB2 ---

const FB2 = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
<description><title-info><book-title>Мастер &amp; Маргарита</book-title></title-info></description>
<body>
<title><p>Часть первая</p></title>
<section>
<title><p>Глава 1</p></title>
<p>Однажды весною&#160;в час…</p>
<empty-line/>
<p>Второй <emphasis>абзац</emphasis> &lt;ok&gt;.</p>
</section>
</body>
<body name="notes"><section><p>Сноска, которой в пересказе не место</p></section></body>
<binary id="cover.jpg" content-type="image/jpeg">AAAA</binary>
</FictionBook>`;

test('fb2ToText: название книги, главы заголовками, абзацы, сущности', () => {
  const { text, title } = fb2ToText(FB2);
  assert.equal(title, 'Мастер & Маргарита');
  assert.ok(text.includes('## Часть первая'), text);
  assert.ok(text.includes('## Глава 1'), text);
  assert.ok(text.includes('Однажды весною в час…'), text);
  assert.ok(text.includes('Второй абзац <ok>.'), text);
  assert.ok(!text.includes('Сноска'), 'тело сносок не берём');
  assert.ok(!text.includes('AAAA'), 'бинарники не берём');
  assert.ok(!/<|emphasis/.test(text.replace('<ok>', '')), 'теги вычищены');
});

// --- readDocument целиком ---

test('readDocument: markdown — текст как есть, заголовок из первого H1', async () => {
  const md = 'Вступление\n\n# Мой конспект ##\n\nТекст.';
  const doc = await readDocument(utf8(md), 'text');
  assert.equal(doc.markdown, md);
  assert.equal(doc.title, 'Мой конспект');
});

test('readDocument: текст без H1 — без заголовка', async () => {
  const doc = await readDocument(utf8('просто текст\n## не H1'), 'text');
  assert.equal(doc.title, undefined);
});

test('readDocument: пустой файл → DocumentError(empty)', async () => {
  await assert.rejects(
    readDocument(utf8('  \n\n '), 'text'),
    (e: unknown) => e instanceof DocumentError && e.kind === 'empty',
  );
});

test('readDocument: HTML идёт через Readability rdrr — без меню и подвала', async () => {
  const html =
    '<html><head><title>Страница</title></head><body><nav>меню сайта</nav>' +
    '<article><h1>Статья</h1><p>' +
    'Содержательный абзац текста. '.repeat(30) +
    '</p></article><footer>подвал сайта</footer></body></html>';
  const doc = await readDocument(utf8(html), 'html');
  assert.equal(doc.title, 'Страница');
  assert.ok(doc.markdown.includes('Содержательный абзац'), doc.markdown);
  assert.ok(!doc.markdown.includes('подвал сайта'), doc.markdown);
});

test('readDocument: субтитры → сплошной текст без заголовка', async () => {
  const doc = await readDocument(
    utf8('1\n00:00:01,000 --> 00:00:02,000\nРаз два\n'),
    'subtitles',
  );
  assert.equal(doc.markdown, 'Раз два');
  assert.equal(doc.title, undefined);
});

test('readDocument: FB2 в windows-1251 — декодируется по фолбэку', async () => {
  const xml =
    '<?xml version="1.0" encoding="windows-1251"?><FictionBook><body><p>Текст</p></body></FictionBook>';
  const bytes = new Uint8Array(
    [...xml].map((ch) => {
      const code = ch.charCodeAt(0);
      // Кириллица А..я в cp1251 — 0xC0..0xFF.
      return code >= 0x410 && code <= 0x44f ? code - 0x410 + 0xc0 : code;
    }),
  );
  const doc = await readDocument(bytes, 'fb2');
  assert.equal(doc.markdown, 'Текст');
});

test('readDocument: HTML-сущности в markdown раскодируются — и в заголовке, и в тексте', async () => {
  const md =
    '# Introducing GNOME&nbsp;51, &laquo;A Coruña&raquo;\n\nGNOME&nbsp;51 &mdash; релиз&hellip;';
  const doc = await readDocument(utf8(md), 'text');
  assert.equal(doc.title, 'Introducing GNOME 51, «A Coruña»');
  assert.ok(doc.markdown.includes('GNOME 51 — релиз…'), doc.markdown);
  assert.ok(!doc.markdown.includes('&'), doc.markdown);
});

test('readDocument: внутри кода сущности остаются как есть (как в CommonMark)', async () => {
  const md = [
    'Пробел &nbsp; и `&nbsp;` в строке.',
    '```html',
    '<p>a&nbsp;b &amp; c</p>',
    '```',
  ].join('\n');
  const doc = await readDocument(utf8(md), 'text');
  assert.ok(doc.markdown.startsWith('Пробел   и `&nbsp;`'), doc.markdown);
  assert.ok(doc.markdown.includes('<p>a&nbsp;b &amp; c</p>'), doc.markdown);
});

test('readDocument: незнакомая сущность и голый амперсанд не ломаются', async () => {
  const doc = await readDocument(
    utf8('A &unknownthing; B & C &#x1F600;'),
    'text',
  );
  assert.equal(doc.markdown, 'A &unknownthing; B & C 😀');
});
