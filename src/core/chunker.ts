import { logger } from '../lib/logger.js';
import type { Chapter, TranscriptSegment } from '../types.js';

/**
 * Главы, которые автор сам пометил как рекламные. Ловим только «самостоятельные» названия
 * («Реклама», «Спонсор»), а не упоминания внутри темы («Реклама в играх») — иначе выкинем
 * содержательный кусок видео про рекламу.
 */
// \p{L}*, а не \w*: с флагом u \w — это только ASCII, и «Спонсоры» бы не поймалось.
const AD_CHAPTER =
  /^(реклам\p{L}*|рекламная пауза|спонсор\p{L}*|промо|промокод|интеграция|ad|ads|ad break|adv|advertisement|sponsor\p{L}*|promo)$/iu;

/** Название → буквы и пробелы, без эмодзи и пунктуации: «⚡ Реклама!» → «реклама». */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isAdChapter(title: string): boolean {
  return AD_CHAPTER.test(normalizeTitle(title));
}

/**
 * Выбрасывает сегменты рекламных глав.
 *
 * Авторы YouTube часто размечают рекламу отдельной главой («Реклама», 4:34–6:18) — это
 * куда надёжнее, чем надеяться, что модель распознает вставку. Более того, без этого мы
 * сами передаём модели заголовок «Реклама» как основу для раздела статьи и получаем ровно
 * то, что хотели убрать.
 *
 * chapterIndex у оставшихся сегментов не трогаем: он всё ещё индексирует исходный
 * chapters[], а глава без сегментов просто не попадёт ни в один кусок.
 */
export function stripAdChapters(
  transcript: TranscriptSegment[],
  chapters: Chapter[] | undefined,
): TranscriptSegment[] {
  if (!chapters?.length) return transcript;

  const adIndexes = new Set(
    chapters
      .map((c, i) => (isAdChapter(c.title) ? i : -1))
      .filter((i) => i >= 0),
  );
  if (!adIndexes.size) return transcript;

  const kept = transcript.filter((s) => !adIndexes.has(s.chapterIndex));
  logger.info(
    {
      dropped: transcript.length - kept.length,
      chapters: [...adIndexes].map((i) => chapters[i].title),
    },
    'вырезаны рекламные главы',
  );
  return kept;
}

export interface ArticleChunk {
  /** Названия глав, попавших в кусок — подсказка модели для заголовков. Может быть пустым. */
  chapterTitles: string[];
  /** Связный текст куска (сегменты склеены пробелом, главы — пустой строкой). */
  text: string;
}

/** Кусок транскрипта, ещё не превращённый в текст: главы + её сегменты. */
interface Unit {
  chapterIndex: number;
  title?: string;
  segments: TranscriptSegment[];
}

/**
 * Режет транскрипт на куски под бюджет символов, стараясь резать по границам глав.
 *
 * Бюджет здесь нужен не столько ради лимита модели (он большой), сколько ради точности:
 * на большом куске модель скатывается в пересказ вместо разворачивания. Маленький кусок
 * она разворачивает добросовестно.
 *
 * Гарантия: ни один сегмент не теряется и порядок сохраняется. Короткое видео целиком
 * влезает в бюджет → ровно один кусок (то есть один вызов LLM).
 */
export function chunkTranscript(
  transcript: TranscriptSegment[],
  chapters: Chapter[] | undefined,
  budgetChars: number,
): ArticleChunk[] {
  if (budgetChars < 1) throw new Error('budgetChars должен быть >= 1');
  if (!transcript.length) return [];

  const units = groupByChapter(transcript, chapters).flatMap((u) =>
    splitOversized(u, budgetChars),
  );
  return pack(units, budgetChars);
}

/**
 * Группирует сегменты по главам. Идём подряд, а не собираем по индексу в мапу: так порядок
 * сохраняется даже если rdrr вернёт неожиданные chapterIndex. Нет глав — всё склеится в
 * одну группу (chapterIndex у всех 0), и дальше её просто порежет по бюджету.
 */
function groupByChapter(
  transcript: TranscriptSegment[],
  chapters: Chapter[] | undefined,
): Unit[] {
  const units: Unit[] = [];

  for (const segment of transcript) {
    const last = units[units.length - 1];
    if (last && last.chapterIndex === segment.chapterIndex) {
      last.segments.push(segment);
    } else {
      units.push({
        chapterIndex: segment.chapterIndex,
        title: chapters?.[segment.chapterIndex]?.title,
        segments: [segment],
      });
    }
  }

  return units;
}

/**
 * Глава длиннее бюджета — режем её на части по границам сегментов. Сам сегмент не режем:
 * он короткий (фраза), а рвать его посередине значит портить текст. Поэтому одиночный
 * сверхдлинный сегмент проходит как есть — превысить бюджет лучше, чем разорвать фразу.
 */
function splitOversized(unit: Unit, budgetChars: number): Unit[] {
  if (unitLength(unit) <= budgetChars) return [unit];

  const parts: Unit[] = [];
  let current: TranscriptSegment[] = [];
  let length = 0;

  for (const segment of unit.segments) {
    const added = segment.text.length + 1; // +1 — пробел-разделитель
    if (current.length && length + added > budgetChars) {
      parts.push({ ...unit, segments: current });
      current = [];
      length = 0;
    }
    current.push(segment);
    length += added;
  }
  if (current.length) parts.push({ ...unit, segments: current });

  return parts;
}

/** Складывает подряд идущие главы в один кусок, пока влезают в бюджет. */
function pack(units: Unit[], budgetChars: number): ArticleChunk[] {
  const chunks: ArticleChunk[] = [];
  let current: Unit[] = [];
  let length = 0;

  const flush = (): void => {
    if (current.length) chunks.push(toChunk(current));
    current = [];
    length = 0;
  };

  for (const unit of units) {
    const unitLen = unitLength(unit);
    if (current.length && length + unitLen > budgetChars) flush();
    current.push(unit);
    length += unitLen;
  }
  flush();

  return chunks;
}

function toChunk(units: Unit[]): ArticleChunk {
  return {
    chapterTitles: units
      .map((u) => u.title)
      .filter((t): t is string => Boolean(t)),
    text: units.map(unitText).join('\n\n'),
  };
}

function unitText(unit: Unit): string {
  return unit.segments.map((s) => s.text).join(' ');
}

function unitLength(unit: Unit): number {
  return unitText(unit).length;
}
