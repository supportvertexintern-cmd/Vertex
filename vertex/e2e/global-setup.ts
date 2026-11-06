import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(__dirname, "../.env") });

import { dbFixture } from "./db-fixture";

// Real, known-password accounts and their own region, country and job, so
// the suite is self-contained (vertex_be/scripts/seed/e2e.py). Cleaned up by
// global-teardown.ts.
export default async function globalSetup() {
  dbFixture("setup");
}
