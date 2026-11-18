// Приватность логов: владелец не должен видеть, что присылают другие. Для чужих запросов
// вместо ссылки — домен (хватает для отладки «rdrr падает на таком-то сайте»), вместо
// имени файла — расширение; заголовки и поисковые запросы не пишутся вовсе. Свои запросы
// владелец видит подробно. Без зависимостей — тестируется без .env.

/**
 * Поля строки лога об источнике запроса. Ключи url / file / title / query обрабатываются,
 * остальные (ok, ms, bytes, …) проходят как есть.
 */
export function sourceLogFields(
  isAdmin: boolean,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  if (isAdmin) return { ...fields };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'url' && typeof value === 'string') out.host = hostOf(value);
    else if (key === 'file' && typeof value === 'string')
      out.ext = extOf(value);
    else if (key === 'title' || key === 'query') continue;
    else out[key] = value;
  }
  return out;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid';
  }
}

function extOf(fileName: string): string | null {
  const m = fileName.match(/\.[^.\\/]+$/);
  return m ? m[0].toLowerCase() : null;
}
