import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Check if we are running in Next.js build phase
const isBuild = process.env.npm_lifecycle_event === "build" || process.env.NEXT_PHASE === "phase-production-build";

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
    : new PrismaClient({
        log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
      }));

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma as any;
