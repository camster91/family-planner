/** Loaded only by the explicitly opted-in, prebuilt, isolated E2E server. */
import { assertFixtureTargetAllowed } from "../../src/lib/fixtures/guard.ts";
import stub from "./inventory-scan-stub.cjs";
if (
  process.env.E2E_INVENTORY_SCAN_STUB !== "1" ||
  process.env.E2E_ALLOW_INVENTORY_SCAN_STUB !== "1" ||
  process.env.E2E_SKIP_BUILD !== "1"
)
  throw new Error(
    "Synthetic inventory scan requires an explicitly opted-in prebuilt E2E server",
  );
assertFixtureTargetAllowed(process.env);
const hostname = new URL(process.env.DATABASE_URL).hostname;
if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname))
  throw new Error(
    "Synthetic inventory scan requires a loopback fixture database",
  );
// The Playwright server env already blanks any inherited real provider key.
if (process.env.INVENTORY_SCAN_ANTHROPIC_API_KEY)
  throw new Error(
    "Synthetic inventory scan refuses an existing provider configuration",
  );
process.env.INVENTORY_SCAN_ANTHROPIC_API_KEY = stub.SYNTHETIC_SCAN_KEY;
globalThis.fetch = stub.createInventoryScanStub(globalThis.fetch);
