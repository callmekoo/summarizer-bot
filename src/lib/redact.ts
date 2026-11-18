export function createRedactor(secrets: string[]): (line: string) => string {
  const list = [...new Set(secrets.filter(Boolean))];
  if (list.length === 0) return (line) => line;
  return (line) => list.reduce((acc, s) => acc.split(s).join('<скрыто>'), line);
}

/** Пароль из URL прокси (в обоих видах): undici кладёт URL прокси в текст ошибок. */
export function proxySecrets(url: string | undefined): string[] {
  if (!url) return [];
  const { password } = new URL(url);
  if (!password) return [];
  return [password, decodeURIComponent(password)];
}
