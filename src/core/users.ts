// Пользователь в нашей базе и его безопасное представление для владельца. Без зависимостей:
// тестируется без .env.

export type UserStatus = 'pending' | 'approved' | 'rejected' | 'banned';

export interface UserRow {
  /** Telegram user id. */
  id: number;
  /** Ник без @; у многих его нет. */
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  status: UserStatus;
  /** Последняя заявка, Unix ms. */
  requestedAt: number | null;
  /** Последнее решение владельца, Unix ms. */
  decidedAt: number | null;
  /** Для rejected: с какого момента можно подать заявку снова. */
  retryAfter: number | null;
}

const MAX_NAME = 64;
const ZWJ = '‍';
const EMOJI = /\p{Extended_Pictographic}/u;

/**
 * Имя для показа владельцу. В базе хранится как прислал Telegram, а здесь вычищается то,
 * что ломает вёрстку или прячет имя: управляющие и невидимые символы, переключатели
 * направления текста, горы диакритики. Результат — обычный текст, HTML экранирует вызывающий.
 */
export function displayName(
  user: Pick<UserRow, 'firstName' | 'lastName'>,
): string {
  const raw = [user.firstName, user.lastName].filter(Boolean).join(' ');
  const cleaned = raw
    // Cc/Cf: переводы строк, нулевая ширина, RTL-override и т.п. ZWJ между эмодзи
    // оставляем — на нём держатся составные эмодзи вроде 👨‍👩‍👧.
    .replace(/[\p{Cc}\p{Cf}]/gu, (ch, offset: number, s: string) =>
      ch === ZWJ && isBetweenEmoji(s, offset)
        ? ch
        : ch === '\n' || ch === '\t'
          ? ' '
          : '',
    )
    // Zalgo: не больше двух комбинируемых знаков подряд.
    .replace(/(\p{M}{2})\p{M}+/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();

  if (!cleaned) return 'без имени';
  const chars = [...cleaned];
  return chars.length > MAX_NAME
    ? chars.slice(0, MAX_NAME - 1).join('') + '…'
    : cleaned;
}

/** Ник для показа: `@ivanp` или «без ника». */
export function displayUsername(username: string | null): string {
  return username ? `@${username}` : 'без ника';
}

function isBetweenEmoji(s: string, offset: number): boolean {
  // Перед ZWJ может стоять селектор варианта U+FE0F — пропускаем его.
  let before = s.slice(0, offset);
  if (before.endsWith('️')) before = before.slice(0, -1);
  const prev = [...before].at(-1);
  const next = [...s.slice(offset + 1)][0];
  return (
    prev !== undefined &&
    next !== undefined &&
    EMOJI.test(prev) &&
    EMOJI.test(next)
  );
}
