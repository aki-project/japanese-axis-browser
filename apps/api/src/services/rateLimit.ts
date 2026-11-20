/**
 * A fixed-window request limiter. One limiter is one shared budget: the
 * account routes use one per action, keyed on nothing, so the limit is
 * global across all clients rather than per IP. In memory, so it holds
 * per API process.
 */

export interface RateLimit {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
}

export type TakeResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export interface RateLimiter {
  /** Spends one request from the current window, or reports when the next one opens. */
  take(): TakeResult;
}

export function createRateLimiter(
  { limit, windowMs }: RateLimit,
  now: () => number = Date.now,
): RateLimiter {
  let windowStart = -Infinity;
  let used = 0;
  return {
    take() {
      const t = now();
      if (t - windowStart >= windowMs) {
        windowStart = t;
        used = 0;
      }
      if (used < limit) {
        used += 1;
        return { ok: true };
      }
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - t) / 1000)) };
    },
  };
}
