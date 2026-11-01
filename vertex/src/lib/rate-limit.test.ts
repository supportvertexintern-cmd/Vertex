// Rate limits (auth hardening plan, workstream B): the client's address only
// from the edge proxy, counters shared through Redis by every process, keys
// that never hold the raw value, Retry-After on every 429, and what a Redis
// outage does (B.4). Redis itself is faked here; the stack check runs the
// real one (vertex_be/deploy/verify-stack.sh).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redis = vi.hoisted(() => ({
  counts: new Map<string, number>(),
  keys: [] as string[],
  down: false,
  hang: false,
  connects: 0,
}));

vi.mock("redis", () => ({
  createClient: () => ({
    on: () => undefined,
    connect: async () => {
      redis.connects += 1;
      if (redis.hang) await new Promise(() => undefined); // never resolves, as a reconnect loop
      if (redis.down) throw new Error("ECONNREFUSED");
    },
    multi: () => {
      const ops: (() => unknown)[] = [];
      const tx = {
        incr: (key: string) => {
          ops.push(() => {
            redis.keys.push(key);
            const n = (redis.counts.get(key) ?? 0) + 1;
            redis.counts.set(key, n);
            return n;
          });
          return tx;
        },
        pExpire: () => {
          ops.push(() => 1);
          return tx;
        },
        exec: async () => {
          if (redis.down) throw new Error("connection lost");
          return ops.map((op) => op());
        },
      };
      return tx;
    },
  }),
}));

vi.mock("./log", () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const fresh = async () => {
  vi.resetModules(); // a new process: its own memory and its own connection
  return import("./rate-limit");
};
const req = (headers: Record<string, string>) => new Request("http://localhost/api/x", { headers });

beforeEach(() => {
  redis.counts.clear();
  redis.keys = [];
  redis.down = false;
  redis.connects = 0;
  vi.unstubAllEnvs();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("the client's address", () => {
  it("comes only from the edge proxy's X-Real-IP, and only when trusted", async () => {
    const { clientIp } = await import("./client-ip");
    const h = new Headers({ "x-real-ip": "198.51.100.4", "x-forwarded-for": "6.6.6.6" });
    expect(clientIp(h)).toBeNull();
    vi.stubEnv("TRUST_PROXY_HEADERS", "true");
    expect(clientIp(h)).toBe("198.51.100.4");
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6" }))).toBeNull(); // a forged header counts for nothing
  });

  it("a forged X-Forwarded-For can't dodge a limit", async () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "true");
    const { limitByIp } = await fresh();
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      const res = await limitByIp(req({ "x-real-ip": "198.51.100.5", "x-forwarded-for": `10.0.0.${i}` }), "probe", { max: 3 });
      statuses.push(res?.status ?? 200);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("two real clients have their own buckets", async () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "true");
    const { limitByIp } = await fresh();
    await limitByIp(req({ "x-real-ip": "198.51.100.6" }), "probe", { max: 1 });
    expect(await limitByIp(req({ "x-real-ip": "198.51.100.7" }), "probe", { max: 1 })).toBeNull();
  });
});

describe("in this process (no REDIS_URL)", () => {
  it("limits and says when to retry", async () => {
    const { limitByIp } = await fresh();
    const r = req({});
    for (let i = 0; i < 2; i++) expect(await limitByIp(r, "mem", { max: 2, windowMs: 60_000 })).toBeNull();
    const refused = await limitByIp(r, "mem", { max: 2, windowMs: 60_000 });
    expect(refused?.status).toBe(429);
    expect(Number(refused?.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(redis.connects).toBe(0);
  });
});

describe("in Redis", () => {
  beforeEach(() => {
    vi.stubEnv("REDIS_URL", "redis://:pw@redis:6379");
    vi.stubEnv("TRUST_PROXY_HEADERS", "true");
  });

  it("is shared by every process", async () => {
    const one = await fresh();
    const two = await fresh();
    const r = req({ "x-real-ip": "198.51.100.8" });
    expect(await one.limitByIp(r, "shared", { max: 2 })).toBeNull();
    expect(await two.limitByIp(r, "shared", { max: 2 })).toBeNull();
    expect((await one.limitByIp(r, "shared", { max: 2 }))?.status).toBe(429);
  });

  it("keys name the environment and scope, never the address or email", async () => {
    vi.stubEnv("APP_ENV", "dev");
    const { rateLimit } = await fresh();
    await rateLimit("forgot-email:someone@test.invalid");
    await rateLimit("login:198.51.100.9");
    expect(redis.keys.every((k) => !k.includes("someone@") && !k.includes("198.51.100.9"))).toBe(true);
    expect(redis.keys[0]).toMatch(/^dev:rl:forgot-email:[0-9a-f]{32}:\d+$/);
  });

  it("down: an ordinary limit lets the request through", async () => {
    redis.down = true;
    const { limitByIp } = await fresh();
    expect(await limitByIp(req({ "x-real-ip": "198.51.100.10" }), "chat")).toBeNull();
  });

  it("down: a failClosed limit refuses with 503, so nobody's inbox can be flooded", async () => {
    redis.down = true;
    const { limitByIp } = await fresh();
    const res = await limitByIp(req({ "x-real-ip": "198.51.100.11" }), "forgot-password", { failClosed: true });
    expect([res?.status, res?.headers.get("Retry-After")]).toEqual([503, "30"]);
  });

  it("an outage costs one wait, then Redis is left alone for 30 seconds and tried again", async () => {
    redis.down = true;
    const { rateLimit } = await fresh();
    expect((await rateLimit("x:1", { failClosed: true })).unavailable).toBe(true);
    const connects = redis.connects;
    redis.down = false;
    expect((await rateLimit("x:1", { failClosed: true })).unavailable).toBe(true); // not even tried
    expect(redis.connects).toBe(connects);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31_000);
    expect(await rateLimit("x:1", { failClosed: true })).toMatchObject({ success: true });
    vi.useRealTimers();
  });

  it("a hung connection gives up within the deadline", async () => {
    const { rateLimit } = await fresh();
    const started = Date.now();
    redis.hang = true;
    const result = await rateLimit("x:2", { failClosed: true });
    redis.hang = false;
    expect(result.unavailable).toBe(true);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
