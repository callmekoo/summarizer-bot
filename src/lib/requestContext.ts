import { AsyncLocalStorage } from 'node:async_hooks';
import type { Db } from '../db/database.js';
import {
  startRequest,
  finishRequest,
  type RequestCommand,
} from '../db/usage.js';
import { logger } from './logger.js';
import { sourceLogFields } from './privacy.js';

// «Для кого сейчас работаем». Хендлер открывает запрос через withRequest, а нижние слои
// (complete() — учёт расхода, extractor — приватность логов) читают currentRequest(),
// не получая пользователя через параметры. Новый путь к LLM должен идти внутри
// withRequest, иначе его расход не попадёт в статистику.

export interface RequestContext {
  /** null — запрос не удалось записать в базу; работа идёт, но без учёта. */
  requestId: number | null;
  userId: number;
  isAdmin: boolean;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function currentRequest(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Поля об источнике запроса (url / file / title / query) для строки лога. Владельцу —
 * как есть, остальным — только домен и расширение (lib/privacy.ts). Кто делает запрос,
 * берётся из контекста; вне запроса — как для чужого. Любое логирование содержимого
 * запроса — только через эту функцию.
 */
export function logSource(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return sourceLogFields(currentRequest()?.isAdmin ?? false, fields);
}

/**
 * Выполняет fn как один запрос пользователя: строка в requests, контекст для нижних
 * слоёв, итог ok по возвращённому значению (исключение — ошибка, пробрасывается).
 * Сбой записи статистики не мешает пользователю получить ответ — только warn.
 */
export async function withRequest(
  deps: { db: Db; now: () => number },
  user: { userId: number; isAdmin: boolean },
  command: RequestCommand,
  fn: () => Promise<boolean>,
): Promise<boolean> {
  let requestId: number | null = null;
  try {
    requestId = startRequest(deps.db, user.userId, command, deps.now());
  } catch (err) {
    logger.warn({ err, command }, 'статистика: не удалось открыть запрос');
  }

  const finish = (ok: boolean): void => {
    if (requestId === null) return;
    try {
      finishRequest(deps.db, requestId, ok);
    } catch (err) {
      logger.warn({ err, requestId }, 'статистика: не удалось закрыть запрос');
    }
  };

  let ok = false;
  try {
    ok = await storage.run({ requestId, ...user }, fn);
    return ok;
  } finally {
    finish(ok);
  }
}
