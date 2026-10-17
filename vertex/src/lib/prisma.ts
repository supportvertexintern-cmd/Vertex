import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
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

function createPrismaClient() {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });
  return isAccelerateUrl ? client.$extends(withAccelerate()) : client;
}

export const prisma =
  globalForPrisma.prisma ??
  (isBuild
    ? new Proxy({} as any, {
        get(target, prop) {
          if (prop === "then") return undefined;
          return new Proxy(() => Promise.resolve([]), {
            get(t, p) {
              if (p === "then") return undefined;
              return () => Promise.resolve([]);
            },
          });
        },
      })
    : createPrismaClient());

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma as any;

// Prisma's "record to update/delete does not exist" (P2025): an unknown ID
// is a 404 for the caller, not a server error (ZAP 90022, Phase 12).
export function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2025";
}
