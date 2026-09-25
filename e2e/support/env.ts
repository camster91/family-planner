/**
 * Shared E2E settings (#155). Imported by playwright.config.ts, the global
 * setup and the specs so every layer agrees on the clock, zone and locale.
 *
 * Only relative imports from src/: the fixture dataset module is plain
 * TypeScript with type-only imports, so Playwright's loader can read it.
 */
import {
  DEFAULT_FIXTURE_ANCHOR,
  resolveFixtureAnchor,
} from "../../src/lib/fixtures/dataset";

export const E2E_PORT = Number.parseInt(process.env.E2E_PORT ?? "", 10) || 3100;
export const E2E_BASE_URL =
  process.env.E2E_BASE_URL ?? `http://localhost:${E2E_PORT}`;

/**
 * The instant both clocks are pinned to: the seed anchor (FIXTURES_ANCHOR_DATE),
 * the Next.js server (E2E_SERVER_NOW, see e2e/support/server-clock.cjs) and the
 * browser (`page.clock`, see e2e/support/test.ts).
 */
export const E2E_ANCHOR = resolveFixtureAnchor(
  process.env.FIXTURES_ANCHOR_DATE ?? DEFAULT_FIXTURE_ANCHOR,
);

/** One zone for the server process (TZ) and the browser (timezoneId). */
export const E2E_TIMEZONE = process.env.E2E_TIMEZONE ?? "America/Toronto";
export const E2E_LOCALE = "en-US";

/** Fake, test-only secret (>= 32 chars). Never used outside the E2E server. */
export const E2E_DEFAULT_JWT_SECRET =
  "e2e-only-jwt-secret-not-for-any-real-environment";

/** Where the setup project writes signed-in browser state (gitignored). */
export const AUTH_DIR = "e2e/.auth";
export const authFile = (who: "parentA" | "childA" | "parentB") =>
  `${AUTH_DIR}/${who}.json`;
