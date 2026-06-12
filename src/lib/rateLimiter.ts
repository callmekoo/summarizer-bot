export interface RateDecision {
  allowed: boolean;
  /** Через сколько мс можно повторить (0, если разрешено). */
  retryAfterMs: number;
}

export interface RateLimiter {
  check(key: string | number, now?: number): RateDecision;
}

/**
 * Скользящее окно: не более `max` обращений за `windowMs` на ключ.
 * Чистая логика с инъекцией `now` — тестируется без таймеров.
 */
export function createRateLimiter(max: number, windowMs: number): RateLimiter {
  const hits = new Map<string | number, number[]>();

  function check(key: string | number, now = Date.now()): RateDecision {
    const cutoff = now - windowMs;
    const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);

    if (recent.length >= max) {
      hits.set(key, recent);
      const retryAfterMs = recent[0] + windowMs - now;
      return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 0) };
    }

    recent.push(now);
    hits.set(key, recent);
    return { allowed: true, retryAfterMs: 0 };
  }

  return { check };
}
