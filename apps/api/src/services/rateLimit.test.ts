import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rateLimit.js';

describe('createRateLimiter', () => {
  it('allows `limit` requests per window, then refuses with the seconds until the next window', () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 }, () => t);
    expect(limiter.take()).toEqual({ ok: true });
    expect(limiter.take()).toEqual({ ok: true });
    t = 15_000;
    expect(limiter.take()).toEqual({ ok: false, retryAfterSeconds: 45 });
  });

  it('opens a fresh budget once the window has passed', () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000 }, () => t);
    expect(limiter.take().ok).toBe(true);
    expect(limiter.take().ok).toBe(false);
    t = 1_000;
    expect(limiter.take().ok).toBe(true);
  });

  it('never reports a retry delay below one second', () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000 }, () => t);
    limiter.take();
    t = 999;
    expect(limiter.take()).toEqual({ ok: false, retryAfterSeconds: 1 });
  });
});
