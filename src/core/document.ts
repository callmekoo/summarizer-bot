/**
 * Документ из чата → текст для пересказа. Формат определяется по расширению, дальше
 * каждый превращается в markdown-ish текст своим способом. Сеть здесь не трогаем
 * (скачивание — в хендлере), config/logger не тянем: модуль тестируется без .env.
 *
 * Сознательно только то, что разбирается без новых зависимостей. PDF, DOCX, EPUB и
 * .fb2.zip требуют парсера/распаковщика — отложено (см. PLAN.md).
 */

export type DocumentFormat = 'text' | 'html' | 'subtitles' | 'fb2';

export type DocumentErrorKind =
  'unsupported' | 'too_large' | 'download' | 'encoding' | 'empty';

export class DocumentError extends Error {
  constructor(
    public readonly kind: DocumentErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'DocumentError';
  }
}

const BY_EXTENSION: Record<string, DocumentFormat> = {
  md: 'text',
  markdown: 'text',
  txt: 'text',
  rst: 'text',
  org: 'text',
  adoc: 'text',
  html: 'html',
  htm: 'html',
  srt: 'subtitles',
  vtt: 'subtitles',
  fb2: 'fb2',
};

// Запасной путь, если Telegram не прислал имя файла (бывает у пересланных/сгенерированных).
const BY_MIME: Record<string, DocumentFormat> = {
  'text/plain': 'text',
  'text/markdown': 'text',
  'text/x-markdown': 'text',
  'text/html': 'html',
  'application/x-subrip': 'subtitles',
  'text/vtt': 'subtitles',
};

const MB = 1024 * 1024;

// Текст дальше всё равно режется по MAX_INPUT_TOKENS (200k ≈ 600k символов), так что
// предел — не про качество, а чтобы не качать и не держать в памяти лишнее. HTML и FB2
// крупнее при том же тексте: сохранённые страницы и книги несут картинки в base64.
const MAX_BYTES: Record<DocumentFormat, number> = {
  text: 2 * MB,
  subtitles: 2 * MB,
  html: 10 * MB,
  fb2: 10 * MB,
};

/** Формат по имени файла (а без него — по MIME). undefined — не поддерживаем. */
export function documentFormat(
  fileName: string | undefined,
  mimeType?: string,
): DocumentFormat | undefined {
  if (fileName) {
    const dot = fileName.lastIndexOf('.');
    if (dot > 0) return BY_EXTENSION[fileName.slice(dot + 1).toLowerCase()];
    return undefined;
  }
  const mime = mimeType?.split(';')[0]?.trim().toLowerCase();
  return mime ? BY_MIME[mime] : undefined;
}

/** «.md, .markdown, …» — для ответа на неподдерживаемый файл. */
export function supportedExtensions(): string {
  return Object.keys(BY_EXTENSION)
    .map((ext) => `.${ext}`)
    .join(', ');
}

/**
 * Проверка до скачивания: формат известен и файл не слишком большой. Размер Telegram
 * сообщает не всегда — тогда его проверит readDocument по факту.
 */
export function checkDocument(doc: {
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
}): DocumentFormat {
  const format = documentFormat(doc.fileName, doc.mimeType);
  if (!format) {
    throw new DocumentError(
      'unsupported',
      `неподдерживаемый файл: ${doc.fileName ?? doc.mimeType ?? '?'}`,
    );
  }
  assertSize(doc.fileSize, format);
  return format;
}

function assertSize(size: number | undefined, format: DocumentFormat): void {
  if (size !== undefined && size > MAX_BYTES[format]) {
    throw new DocumentError(
      'too_large',
      `файл ${size} байт, предел для ${format} — ${MAX_BYTES[format]}`,
    );
  }
}

/**
 * Байты → строка. UTF-8 (BOM срезается), UTF-16 по BOM (Блокнот Windows, «Юникод»),
 * иначе windows-1251: старые русские .txt и .fb2 почти всегда в ней. NUL в «тексте» —
 * верный признак бинарника с подменённым расширением.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes);
  }
  if (bytes.includes(0)) {
    throw new DocumentError('encoding', 'в файле нулевые байты — не текст');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1251').decode(bytes);
  }
}

export interface ReadDocumentResult {
  markdown: string;
  /** Заголовок из самого документа; нет — хендлер подставит имя файла. */
  title?: string;
}

/** Скачанный файл → текст для пересказа. Бросает DocumentError. */
export async function readDocument(
  bytes: Uint8Array,
  format: DocumentFormat,
): Promise<ReadDocumentResult> {
  assertSize(bytes.length, format);
  const raw = decodeText(bytes);

  let result: ReadDocumentResult;
  switch (format) {
    case 'text': {
      const text = decodeMarkdownEntities(raw.trim());
      result = { markdown: text, title: markdownTitle(text) };
      break;
    }
    case 'subtitles':
      result = { markdown: subtitlesToText(raw) };
      break;
    case 'fb2': {
      const { text, title } = fb2ToText(raw);
      result = { markdown: text, title };
      break;
    }
    case 'html':
      result = await htmlToText(raw);
      break;
  }

  if (!result.markdown) {
    throw new DocumentError('empty', 'в файле не нашлось текста');
  }
  return result;
}

/** Первый заголовок `# …` (ATX H1, хвостовые `#` срезаются). */
function markdownTitle(text: string): string | undefined {
  const m = /^#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/m.exec(text);
  return m?.[1]?.trim() || undefined;
}

/**
 * Сохранённая страница — тот же Readability, что у пересказа по ссылке: меню, подвал и
 * прочий шум уходят, остаётся тело статьи. rdrr грузим динамически, как в extractor.
 */
async function htmlToText(html: string): Promise<ReadDocumentResult> {
  const { parseHtml } = await import('rdrr');
  const page = await parseHtml(html);
  return {
    markdown: (page.content ?? '').trim(),
    title: page.title?.trim() || undefined,
  };
}

/**
 * SRT/VTT → сплошной текст. Реплика — блок до пустой строки с тайм-кодом (`-->`): всё до
 * тайм-кода включительно (номер/идентификатор) отбрасываем, блоки без тайм-кода (шапка
 * WEBVTT, NOTE, STYLE) — целиком. Подряд идущие одинаковые строки схлопываем: автосубтитры
 * YouTube «прокручивают» каждую строку дважды.
 */
export function subtitlesToText(source: string): string {
  const lines: string[] = [];
  for (const block of source.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)) {
    const rows = block.split('\n');
    const timing = rows.findIndex((r) => r.includes('-->'));
    if (timing === -1) continue;
    for (const row of rows.slice(timing + 1)) {
      const text = decodeEntities(
        row.replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, ''),
      ).trim();
      if (text && text !== lines[lines.length - 1]) lines.push(text);
    }
  }
  return lines.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * FB2 (XML) → текст. Берём первый <body> — второй обычно сноски (`name="notes"`),
 * <binary> (картинки в base64) лежат вне body. Заголовки разделов → `## …`, чтобы
 * модель видела структуру книги. Регэкспы вместо XML-парсера: формат плоский, а
 * зависимость ради одного формата — перебор.
 */
export function fb2ToText(xml: string): { text: string; title?: string } {
  const titleRaw = /<book-title[^>]*>([\s\S]*?)<\/book-title>/.exec(xml)?.[1];
  const title = titleRaw ? inlineText(titleRaw) || undefined : undefined;

  const body = /<body(?:\s[^>]*)?>([\s\S]*?)<\/body>/.exec(xml)?.[1] ?? '';
  const text = decodeEntities(
    body
      .replace(
        /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/g,
        (_m, inner: string) => `\n\n## ${stripToLine(inner)}\n\n`,
      )
      .replace(/<\/(?:p|v|subtitle|text-author)>|<empty-line\s*\/>/g, '\n\n')
      .replace(/<[^>]*>/g, ''),
  )
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, title };
}

/** Фрагмент разметки → одна строка (теги → пробелы), сущности пока не трогаем. */
function stripToLine(fragment: string): string {
  return fragment
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inlineText(fragment: string): string {
  return decodeEntities(stripToLine(fragment));
}

// XML знает только первые пять; остальное — типографика, которая реально встречается в
// markdown и вёрстке (полная таблица HTML5 — 2000+ имён, ради неё нужна зависимость).
// Незнакомое имя оставляем как есть: лучше видимый `&foo;`, чем потерянный текст.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  shy: '­',
  ndash: '–',
  mdash: '—',
  minus: '−',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  times: '×',
  divide: '÷',
  plusmn: '±',
  sect: '§',
  para: '¶',
  euro: '€',
  larr: '←',
  rarr: '→',
  uarr: '↑',
  darr: '↓',
  harr: '↔',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
};

/** HTML/XML-сущности. В FB2 зовём последним: раскодированный `&lt;` иначе приняли бы за тег. */
function decodeEntities(s: string): string {
  return s.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi,
    (m, code: string) => {
      if (code[0] === '#') {
        const n =
          code[1] === 'x' || code[1] === 'X'
            ? parseInt(code.slice(2), 16)
            : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n <= 0x10ffff
          ? String.fromCodePoint(n)
          : m;
      }
      // Имена регистрозависимы (&Dagger; ≠ &dagger;), поэтому без toLowerCase.
      return NAMED_ENTITIES[code] ?? m;
    },
  );
}

// Код в markdown: блоки ``` / ~~~ (незакрытый — до конца файла) и инлайн `…`. Скобка
// захватывающая — split кладёт код на нечётные места.
const MARKDOWN_CODE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]+`)/;

/**
 * Сущности в markdown — часть синтаксиса: рендерер раскодировал бы `&nbsp;` везде, кроме
 * кода. Мы markdown не рендерим, поэтому делаем это сами — иначе `&nbsp;` из заголовка
 * попадает в шапку литералом, а из текста — в пересказ (модель копирует его как есть).
 */
function decodeMarkdownEntities(md: string): string {
  return md
    .split(MARKDOWN_CODE)
    .map((part, i) => (i % 2 ? part : decodeEntities(part)))
    .join('');
}
