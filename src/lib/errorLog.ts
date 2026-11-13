import { stdSerializers } from 'pino';

// Сериализатор поля `err` для логов. Стандартный pino копирует все перечислимые поля
// ошибки — а у ошибок библиотек там содержимое запроса:
//   - GrammyError.payload — аргументы метода Telegram (текст пересказа с шапкой-ссылкой,
//     подпись статьи, сам файл);
//   - ошибка провайдера LLM: error.metadata — у OpenRouter туда попадает фрагмент входа
//     (например, flagged_input при модерации).
// Владелец не должен видеть, что присылают другие, поэтому эти поля вырезаются всегда.
// Остальное (name, message, stack, status, error_code, description, method) остаётся.

const DROP_KEYS = new Set(['payload', 'metadata']);
const MAX_DEPTH = 6;

export function serializeError(err: unknown): Record<string, unknown> {
  const base =
    err instanceof Error
      ? (stdSerializers.err(err) as unknown as Record<string, unknown>)
      : { message: String(err) };
  const out = scrub(base, 0) as Record<string, unknown>;
  // cause по стандарту неперечислимый — сериализатор его не копирует; разбираем сами.
  if (err instanceof Error && err.cause !== undefined && !('cause' in out)) {
    out.cause = serializeError(err.cause);
  }
  return out;
}

function scrub(value: unknown, depth: number): unknown {
  if (value === null || typeof value !== 'object') return value;
  // Глубже предела не разбираем — и не пропускаем как есть: там тоже может быть payload.
  if (depth > MAX_DEPTH) return '[обрезано]';
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (DROP_KEYS.has(key)) continue;
    out[key] = scrub(v, depth + 1);
  }
  return out;
}
