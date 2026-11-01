import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";

// Credentials this app never reads (users step 8.5, review item #8): the
// database grants vertex_web every column of User and RefreshToken but these
// (deploy/db-roles.sql), so every query leaves them out. Signing in, setting
// passwords, Google linking and sessions are FastAPI's.
const OMIT = {
  user: { password_hash: true, google_id: true },
  refreshToken: { token_hash: true },
} as const;

function newClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
    omit: OMIT,
  });
}

type Client = ReturnType<typeof newClient>;

const globalForPrisma = globalThis as unknown as {
  prisma: Client | undefined;
};

// Check if we are running in Next.js build phase
const isBuild = process.env.npm_lifecycle_event === "build" || process.env.NEXT_PHASE === "phase-production-build";

// withAccelerate() only works against an actual Accelerate proxy
// connection string (prisma://.../prisma+postgres://...) — it routes
// queries over Accelerate's own HTTP API, not a raw Postgres driver, so
// applying it against a plain postgresql:// URL (local dev, and every
// admin script that connects via .env.production-db-reference's direct
// connection) would break instead of no-op. Gated on the URL shape so
// both keep working exactly as before; only the real Vercel/production
// DATABASE_URL (once set to the Accelerate URL) gets pooling.
const databaseUrl = process.env.DATABASE_URL ?? "";
const isAccelerateUrl = databaseUrl.startsWith("prisma://") || databaseUrl.startsWith("prisma+postgres://");

function createPrismaClient(): Client {
  const client = newClient();
  return isAccelerateUrl ? (client.$extends(withAccelerate()) as unknown as Client) : client;
}

// During `next build` every query resolves to an empty list instead of
// touching a database. Typed as the client on purpose: an `any` here made
// the exported client `any`, which switched type checking off for every
// query in the app.
const buildStub = new Proxy({}, {
  get(target, prop) {
    if (prop === "then") return undefined;
    return new Proxy(() => Promise.resolve([]), {
      get(t, p) {
        if (p === "then") return undefined;
        return () => Promise.resolve([]);
      },
    });
  },
}) as unknown as Client;

export const prisma: Client = globalForPrisma.prisma ?? (isBuild ? buildStub : createPrismaClient());

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Prisma's "record to update/delete does not exist" (P2025): an unknown ID
// is a 404 for the caller, not a server error (ZAP 90022, Phase 12).
export function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2025";
}
