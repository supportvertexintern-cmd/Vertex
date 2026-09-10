interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  store.forEach((entry, key) => {
    if (entry.resetAt < now) store.delete(key);
  });
}, 5 * 60 * 1000);

export interface RateLimitOptions {
  windowMs?: number; // default 60_000 (1 min)
  max?: number;      // default 10
}

export function rateLimit(
  identifier: string,
  options: RateLimitOptions = {}
): { success: boolean; remaining: number; resetAt: number } {
  const windowMs = options.windowMs ?? (Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000);
  const max = options.max ?? (Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 10);
  const now = Date.now();

  const entry = store.get(identifier);

  if (!entry || entry.resetAt < now) {
    // New window
    const resetAt = now + windowMs;
    store.set(identifier, { count: 1, resetAt });
    return { success: true, remaining: max - 1, resetAt };
  }

  if (entry.count >= max) {
    return { success: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return { success: true, remaining: max - entry.count, resetAt: entry.resetAt };
}
