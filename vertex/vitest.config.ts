import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: { NODE_ENV: "test" },
    // Most suites are integration tests against one real, shared Postgres,
    // with test files running in parallel; under that load a few
    // multi-request tests drift past Vitest's 5s default (seen with
    // Vitest 5, which spawns a worker per file). A real hang still fails.
    testTimeout: 15_000,
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
