/** Глава YouTube-видео (rdrr отдаёт их, если автор разметил тайм-коды в описании). */
export interface Chapter {
  title: string;
  startTime: number;
}

/** Кусочек транскрипта. `chapterIndex` связывает его с Chapter — по нему и режем. */
export interface TranscriptSegment {
  text: string;
  startTime: number;
  chapterIndex: number;
}

export interface ExtractResult {
  /** Очищенный текст в markdown. */
  markdown: string;
  title?: string;
  author?: string;
  /** Имя сайта или домен (siteName ?? domain). */
  site?: string;
  wordCount?: number;
  /** Тип контента по версии rdrr: youtube, webpage, github, pdf, x-profile, x-status. */
  type?: string;
  url: string;
  /** Только для type === 'youtube'. Может быть пустым: главы есть не у всех видео. */
  chapters?: Chapter[];
  /** Только для type === 'youtube'. Сырые сегменты — основа для сборки статьи. */
  transcript?: TranscriptSegment[];
}

/** Видео ли это (единственная видеоплатформа, которую понимает rdrr, — YouTube). */
export function isVideo(result: ExtractResult): boolean {
  return result.type === 'youtube';
}
