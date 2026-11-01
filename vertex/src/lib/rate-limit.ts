import { createHash } from "node:crypto";
import { createClient } from "redis";
import { clientKey } from "./client-ip";
import { log } from "./log";

// Rate limits (auth hardening plan B.3). Counters live in Redis when
// REDIS_URL is set, so every website process shares them; without it (npm run
// dev, unit tests) they stay in this process. Fixed windows: one INCR and
// PEXPIRE per request, in one MULTI. Keys hold a hash of what's limited
// (an address, an email), never the value itself.
//
// If Redis can't be reached, a limit allows the request and logs at error
// level, unless it is failClosed: then it answers 503, so an outage can't be
// used to flood someone's inbox (B.4). Every call has a hard deadline (a
// stopped container's name can take seconds to fail to resolve), and after a
// failure Redis is left alone for a while, so an outage doesn't slow every
// request down.
const STORE_DEADLINE_MS = 500;
const STORE_BREAK_MS = 30_000;
let brokenUntil = 0;

function deadline<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("rate-limit store timed out")), STORE_DEADLINE_MS).unref?.()),
  ]);
}

export interface RateLimitOptions {
  windowMs?: number; // default 60_000 (1 min)
  max?: number; // default 10
  /** Refuse (503) rather than allow while the counter store is down. */
  failClosed?: boolean;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
  /** The store was down; success says what failClosed decided. */
  unavailable?: boolean;
}

interface Entry {
  count: number;
  resetAt: number;
}

const memory = new Map<string, Entry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  memory.forEach((entry, key) => {
    if (entry.resetAt < now) memory.delete(key);
  });
}, 5 * 60 * 1000).unref?.();

// Only what the limiter uses: one INCR and PEXPIRE in a MULTI.
interface CounterStore {
  multi(): { incr(key: string): unknown; pExpire(key: string, ms: number): unknown; exec(): Promise<unknown[]> };
}
let store: Promise<CounterStore> | null = null;

function connect(url: string): Promise<CounterStore> {
  if (store) return store;
  const connecting = (async () => {
    const client = createClient({
      url,
      // Fail fast: a request never waits on a reconnect.
      disableOfflineQueue: true,
      socket: { connectTimeout: 1000, reconnectStrategy: (retries: number) => Math.min(retries * 200, 2000) },
    });
    client.on("error", (err: unknown) => log.error("ratelimit.store_error", { err }));
    await client.connect();
    return client as unknown as CounterStore;
  })().catch((err) => {
    store = null; // try again on the next request
    throw err;
  });
  store = connecting;
  return connecting;
}

/** `scope:key` with the key hashed, prefixed with the environment. */
function storeKey(identifier: string, window: number): string {
  const at = identifier.indexOf(":");
  const scope = at < 0 ? "default" : identifier.slice(0, at);
  const digest = createHash("sha256").update(at < 0 ? identifier : identifier.slice(at + 1)).digest("hex").slice(0, 32);
  return `${process.env.APP_ENV || "local"}:rl:${scope}:${digest}:${window}`;
}

/** Counts one request against `identifier` ("scope:key"). */
export async function rateLimit(identifier: string, options: RateLimitOptions = {}): Promise<RateLimitResult> {
  const windowMs = options.windowMs ?? (Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000);
  const max = options.max ?? (Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 10);
  const now = Date.now();
  const url = process.env.REDIS_URL;

  if (url) {
    const window = Math.floor(now / windowMs);
    const resetAt = (window + 1) * windowMs;
    try {
      if (now < brokenUntil) throw new Error("rate-limit store recently unreachable");
      const count = await deadline(
        (async () => {
          const client = await connect(url);
          const key = storeKey(identifier, window);
          const tx = client.multi();
          tx.incr(key);
          tx.pExpire(key, windowMs);
          const [n] = (await tx.exec()) as [number, unknown];
          return n;
        })(),
      );
      return { success: count <= max, remaining: Math.max(0, max - count), resetAt };
    } catch (err) {
      if (now >= brokenUntil) brokenUntil = now + STORE_BREAK_MS;
      log.error("ratelimit.store_unavailable", { scope: identifier.split(":")[0], fail_closed: Boolean(options.failClosed), err });
      return { success: !options.failClosed, remaining: 0, resetAt, unavailable: true };
    }
  }

  const entry = memory.get(identifier);
  if (!entry || entry.resetAt < now) {
    const resetAt = now + windowMs;
    memory.set(identifier, { count: 1, resetAt });
    return { success: true, remaining: max - 1, resetAt };
  }
  if (entry.count >= max) return { success: false, remaining: 0, resetAt: entry.resetAt };
  entry.count += 1;
  return { success: true, remaining: max - entry.count, resetAt: entry.resetAt };
}

/** Seconds until the window resets, for Retry-After. */
export function retryAfter(result: RateLimitResult): string {
  return String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000)));
}

/** The 429 (or, store down and failClosed, 503) for a refused request. */
export function limitedResponse(result: RateLimitResult, body: unknown = { error: "Too many requests. Please try again later." }): Response {
  if (result.unavailable) {
    return Response.json({ error: "This is unavailable for a moment. Please try again shortly." }, { status: 503, headers: { "Retry-After": "30" } });
  }
  return Response.json(body, { status: 429, headers: { "Retry-After": retryAfter(result) } });
}

/**
 * Per-client limit for route handlers: a 429 (with Retry-After) when the
 * caller is over the limit, or null to continue. Keyed on the address the
 * edge proxy reports (lib/client-ip.ts).
 */
export async function limitByIp(req: Request, scope: string, options: RateLimitOptions = {}): Promise<Response | null> {
  const result = await rateLimit(`${scope}:${clientKey(req.headers)}`, options);
  return result.success ? null : limitedResponse(result);
}
