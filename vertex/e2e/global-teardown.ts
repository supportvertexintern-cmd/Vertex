import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(__dirname, "../.env") });

import { dbFixture } from "./db-fixture";

// Sweeps up what the suite created: only what's named for it (the "e2e-"
// accounts, E2E Country, ...), never other @test.local fixtures.
export default async function globalTeardown() {
  dbFixture("teardown");
}
