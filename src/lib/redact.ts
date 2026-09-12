export function createRedactor(secrets: string[]): (line: string) => string {
  const list = [...new Set(secrets.filter(Boolean))];
  if (list.length === 0) return (line) => line;
  return (line) => list.reduce((acc, s) => acc.split(s).join('<скрыто>'), line);
}
