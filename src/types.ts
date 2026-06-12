export interface ExtractResult {
  /** Очищенный текст в markdown. */
  markdown: string;
  title?: string;
  author?: string;
  /** Имя сайта или домен (siteName ?? domain). */
  site?: string;
  wordCount?: number;
  /** Тип контента по версии rdrr (article, youtube, …). */
  type?: string;
  url: string;
}
