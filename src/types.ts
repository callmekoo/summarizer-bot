export interface ExtractResult {
  /** Очищенный текст в markdown. */
  markdown: string;
  title?: string;
  wordCount?: number;
  /** Тип контента по версии rdrr (article, youtube, …). */
  type?: string;
  url: string;
}
