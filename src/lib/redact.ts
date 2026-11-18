export function createRedactor(secrets: string[]): (line: string) => string {
  const list = [...new Set(secrets.filter(Boolean))];
  if (list.length === 0) return (line) => line;
  return (line) => list.reduce((acc, s) => acc.split(s).join('<скрыто>'), line);
}

// Секрет короче — не вырезаем по отдельности: замена «1» или «ab» по всей строке
// изуродует лог. Такой пароль скрываем только вместе с логином (`user:p`).
const MIN_SECRET_LENGTH = 4;

/**
 * Секреты из URL прокси для редактора лога: undici кладёт URL прокси в текст ошибок.
 * Секрет — пароль, а без пароля логин: часть провайдеров передаёт ключ логином
 * (`http://TOKEN@proxy`). Обе формы — как в URL и раскодированная.
 */
export function proxySecrets(url: string | undefined): string[] {
  if (!url) return [];
  const { username, password } = new URL(url);
  const secret = password || username;
  if (!secret) return [];
  const forms = [secret, safeDecode(secret)];
  if (password && password.length < MIN_SECRET_LENGTH) {
    forms.push(`${username}:${password}`);
  }
  return [...new Set(forms)].filter((s) => s.length >= MIN_SECRET_LENGTH);
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
