import { AsyncResource } from 'node:async_hooks';

export interface Limiter {
  /** Запускает задачу, не превышая лимит одновременных; остальные ждут в очереди. */
  run<T>(fn: () => Promise<T>): Promise<T>;
  /** Сколько задач выполняется прямо сейчас. */
  readonly active: number;
  /** Сколько задач ждёт в очереди. */
  readonly queued: number;
}

/** Простой ограничитель конкурентности (без зависимостей). */
export function createLimiter(concurrency: number): Limiter {
  if (concurrency < 1) throw new Error('concurrency должно быть >= 1');

  let active = 0;
  const queue: Array<() => void> = [];

  const pump = (): void => {
    if (active >= concurrency) return;
    const start = queue.shift();
    if (!start) return;
    active++;
    start();
  };

  function run<T>(fn: () => Promise<T>): Promise<T> {
    // Async-контекст берём у вызывающего в момент постановки в очередь. Без этого задача
    // стартует из .finally предыдущей и наследует её контекст: currentRequest() видел бы
    // чужой запрос, и расход LLM ушёл бы не тому пользователю.
    const task = AsyncResource.bind(fn);
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            active--;
            pump();
          });
      });
      pump();
    });
  }

  return {
    run,
    get active() {
      return active;
    },
    get queued() {
      return queue.length;
    },
  };
}
