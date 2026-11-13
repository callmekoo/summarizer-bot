import type { UserRow } from './users.js';

// Решение о доступе — чистая функция: вся логика статусов и кулдауна в одном месте,
// middleware только исполняет решение.

export type AccessDecision =
  | { kind: 'pass' }
  | { kind: 'apply' }
  | { kind: 'pending' }
  | { kind: 'rejected'; until: number }
  | { kind: 'ignore' };

/** Что делать с апдейтом пользователя: пропустить, принять заявку, ответить или молчать. */
export function decideAccess(
  user: UserRow | undefined,
  isAdmin: boolean,
  now: number,
): AccessDecision {
  if (isAdmin) return { kind: 'pass' };
  if (!user) return { kind: 'apply' };
  switch (user.status) {
    case 'approved':
      return { kind: 'pass' };
    case 'pending':
      return { kind: 'pending' };
    case 'banned':
      return { kind: 'ignore' };
    case 'rejected':
      return user.retryAfter !== null && now < user.retryAfter
        ? { kind: 'rejected', until: user.retryAfter }
        : { kind: 'apply' };
  }
}

/** Дата `ДД.ММ` в часовом поясе процесса (TZ). */
export function formatRetryDate(ms: number): string {
  return new Date(ms).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
  });
}

export const ACCESS_TEXT = {
  applied:
    '👋 Бот работает по приглашениям. Заявка отправлена владельцу — напишу, когда он ответит.',
  pending: '⏳ Заявка уже на рассмотрении.',
  rejected: (until: number): string =>
    `Заявка отклонена. Повторить можно после ${formatRetryDate(until)}.`,
  approved: '✅ Доступ открыт!',
};
