const MAX_LENGTH = 60;
const FALLBACK = 'article';

// Транслитерация кириллицы: Telegram нормально принимает и юникодные имена, но латиница
// надёжнее переживает скачивание в любую файловую систему.
const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};

/** Заголовок → безопасное имя файла без расширения (латиница, дефисы). */
export function slugify(title: string | undefined): string {
  const slug = (title ?? '')
    .toLowerCase()
    .split('')
    .map((ch) => CYRILLIC[ch] ?? ch)
    .join('')
    // Всё, что не буква/цифра — в дефис: заодно убирает слэши и двоеточия, опасные в путях.
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LENGTH)
    .replace(/-+$/, ''); // срез мог оставить дефис на конце

  return slug || FALLBACK;
}

/** Имя .md-файла для статьи. */
export function articleFilename(title: string | undefined): string {
  return `${slugify(title)}.md`;
}
