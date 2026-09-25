/**
 * Playwright global setup (#155).
 *
 * 1. Refuses to run unless the fixture guard (#154) accepts DATABASE_URL, so an
 *    E2E run can never seed or touch a production-like database.
 * 2. Seeds/reconciles the fixture households at E2E_ANCHOR (`npm run fixtures:seed`).
 *    Seed is idempotent and restores anything a previous run changed.
 * 3. Clears login rate-limit windows. The app allows 30 logins per client
 *    address per 15 minutes and 10 failures per account; each project already
 *    gets its own X-Forwarded-For bucket (playwright.config.ts), but
 *    back-to-back local runs would still hit 429. Only `login:` /
 *    `login-fail:` keys are deleted, and only on a guarded DB.
 *
 * Migrations are NOT run here: run `node scripts/migrate.js` first (CI does).
 * Set E2E_SKIP_SEED=1 to skip steps 2-3 (for example against a server you manage).
 */
import { execFileSync } from "node:child_process";
import pg from "pg";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { E2E_ANCHOR } from "./support/env";

export default async function globalSetup(): Promise<void> {
  if (process.env.E2E_SKIP_SEED === "1") return;

  if (!process.env.DATABASE_URL) {
    throw new Error(
      "E2E needs DATABASE_URL for a local/disposable database (see docs/testing/E2E.md), e.g. " +
        "postgresql://postgres:postgres@localhost:5432/fp_e2e",
    );
  }
  // Throws FixtureTargetRefusedError (with the reason) for anything production-like
  // or when FIXTURES_ALLOW=1 is missing.
  assertFixtureTargetAllowed(process.env);

  execFileSync("npm", ["run", "--silent", "fixtures:seed"], {
    stdio: "inherit",
    env: { ...process.env, FIXTURES_ANCHOR_DATE: E2E_ANCHOR.toISOString() },
  });

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `DELETE FROM "RateLimitEntry" WHERE key LIKE 'login:%' OR key LIKE 'login-fail:%'`,
    );
  } finally {
    await client.end();
  }
}
