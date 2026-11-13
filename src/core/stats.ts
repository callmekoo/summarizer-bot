import { escapeHtml } from './formatter.js';
import { userLabelHtml, type UserRow } from './users.js';
import type { Totals, TopRow, RequestCommand } from '../db/usage.js';

// Отчёты для владельца: /stats, /stats <user>, /users. Чистые функции → Telegram-HTML;
// длинный результат режет вызывающий (splitForTelegram). Содержимого запросов тут нет и
// взяться ему неоткуда: в базе его не хранится.

/** Начала периодов по часовому поясу процесса: сегодня, 7 и 30 дней (включая сегодня). */
export function periodStarts(now: Date): {
  today: number;
  week: number;
  month: number;
} {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  return {
    today: new Date(y, m, d).getTime(),
    week: new Date(y, m, d - 6).getTime(),
    month: new Date(y, m, d - 29).getTime(),
  };
}

export interface PeriodTotals {
  label: string;
  totals: Totals;
}

/** `$0.0030`, `$0.0030 + н/д` (часть стоимостей неизвестна), `$ —` (вся), `$0` (вызовов нет). */
export function formatCost(
  t: Pick<Totals, 'costUsd' | 'pricedCalls' | 'unpricedCalls'>,
): string {
  if (t.pricedCalls === 0 && t.unpricedCalls === 0) return '$0';
  if (t.pricedCalls === 0) return '$ —';
  const known = `$${t.costUsd.toFixed(4)}`;
  return t.unpricedCalls > 0 ? `${known} + н/д` : known;
}

export function renderStats(
  periods: PeriodTotals[],
  top: { row: TopRow; user: UserRow | undefined }[],
): string {
  const lines = ['<b>Статистика</b>', ...periods.map(periodLine), ''];
  lines.push('<b>Топ за 30 дней</b>');
  if (top.length === 0) lines.push('нет данных');
  top.forEach(({ row, user }, i) => {
    const who = user ? userLabelHtml(user) : `id ${row.userId}`;
    const cost = row.costUsd > 0 ? `$${row.costUsd.toFixed(4)}` : '$0';
    lines.push(`${i + 1}. ${who} — ${cost}, ${row.requests} запр.`);
  });
  return lines.join('\n');
}

export function renderUserStats(
  user: UserRow,
  periods: PeriodTotals[],
  breakdown: { command: RequestCommand; requests: number }[],
  lastAt: number | null,
): string {
  const commands = breakdown.length
    ? breakdown.map((b) => `${b.command} — ${b.requests}`).join(', ')
    : 'нет данных';
  return [
    `<b>${userLabelHtml(user)}</b> — ${STATUS_LABEL[user.status]}`,
    ...periods.map(periodLine),
    '',
    `По командам: ${commands}`,
    `Последний запрос: ${lastAt === null ? '—' : formatDate(lastAt)}`,
  ].join('\n');
}

export function renderUsers(users: UserRow[]): string {
  if (users.length === 0) return 'Пользователей пока нет.';
  const blocks: string[] = [];
  for (const [status, title] of GROUPS) {
    const group = users.filter((u) => u.status === status);
    if (group.length === 0) continue;
    blocks.push(
      [
        `<b>${title}</b> (${group.length})`,
        ...group.map((u) => {
          // У ждущих — дата заявки (повторной — новой), у остальных — решения.
          const date =
            u.status === 'pending'
              ? u.requestedAt
              : (u.decidedAt ?? u.requestedAt);
          return `${userLabelHtml(u)}${date ? `, ${formatDate(date)}` : ''}`;
        }),
      ].join('\n'),
    );
  }
  return blocks.join('\n\n');
}

const GROUPS: [UserRow['status'], string][] = [
  ['approved', 'Одобрены'],
  ['pending', 'Ждут'],
  ['rejected', 'Отклонены'],
  ['banned', 'Забанены'],
];

const STATUS_LABEL: Record<UserRow['status'], string> = {
  approved: 'одобрен',
  pending: 'ждёт решения',
  rejected: 'отклонён',
  banned: 'забанен',
};

function periodLine({ label, totals: t }: PeriodTotals): string {
  const errors = t.errors > 0 ? ` (${t.errors} ошиб.)` : '';
  const tokens = (t.promptTokens + t.completionTokens).toLocaleString('ru-RU');
  return `<b>${escapeHtml(label)}</b>: ${t.requests} запр.${errors}, ${tokens} ток., ${formatCost(t)}`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('ru-RU');
}
