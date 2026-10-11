import { defineConfig, devices } from "@playwright/test";

// Port 3100 by default: 3000 is taken on the main dev machine by another
// project. E2E_BASE_URL targets an already-running server instead (CI starts
// a production build itself); E2E_WEB_SERVER overrides the start command.
const PORT = Number(process.env.E2E_PORT) || 3100;
const BASE_URL = process.env.E2E_BASE_URL || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: process.env.E2E_WEB_SERVER || `npm run dev -- -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
