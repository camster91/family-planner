/** Server-child-only QA availability; never imported by production source or builds. */
import {
  assertFixtureTargetAllowed,
  DISPOSABLE_DB_TOKENS,
} from "../../src/lib/fixtures/guard.ts";
import transport from "./settings-qa-fetch.cjs";

const mode = process.env.E2E_SETTINGS_QA;
if (
  !["enabled", "unavailable"].includes(mode) ||
  process.env.E2E_ALLOW_SETTINGS_QA !== "1" ||
  process.env.E2E_SKIP_BUILD !== "1"
)
  throw new Error(
    "Settings QA requires an explicitly opted-in prebuilt server",
  );
const target = assertFixtureTargetAllowed(process.env);
const host = new URL(process.env.DATABASE_URL).hostname;
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(host) ||
  !target.database
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((token) => DISPOSABLE_DB_TOKENS.includes(token))
)
  throw new Error(
    "Settings QA requires a loopback disposable fixture database",
  );
const port = process.env.E2E_PORT || "3100";
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
  throw new Error("Settings QA requires a valid fixture server port");
for (const name of [
  "CALENDAR_TOKEN_KEY",
  "CALENDAR_TOKEN_KEY_PREVIOUS",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "MICROSOFT_TENANT",
  "APP_URL",
  "NEXT_PUBLIC_APP_URL",
  "CAPTURE_AI_KEY",
  "CAPTURE_AI_BASE_URL",
  "CAPTURE_AI_MODEL",
  "CAPTURE_AI_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "INVENTORY_SCAN_ANTHROPIC_API_KEY",
  "EVENT_IMPORT_ANTHROPIC_API_KEY",
]) {
  if (process.env[name]?.trim())
    throw new Error("Settings QA refuses inherited provider configuration");
}
// All guards finish before either process environment or global transport changes.
const enabled = mode === "enabled";
process.env.SHARED_DEVICE_ENABLED = enabled ? "1" : "0";
process.env.CAPTURE_AI_SETTINGS_ENABLED = enabled ? "1" : "0";
if (enabled) {
  process.env.APP_URL = `http://localhost:${port}`;
  process.env.CALENDAR_TOKEN_KEY = Buffer.alloc(32, 0x45).toString("base64");
  process.env.GOOGLE_CLIENT_ID = "synthetic-settings-e2e-google";
  process.env.GOOGLE_CLIENT_SECRET =
    "synthetic-settings-e2e-not-a-provider-secret";
  process.env.MICROSOFT_CLIENT_ID = "synthetic-settings-e2e-microsoft";
  process.env.MICROSOFT_CLIENT_SECRET =
    "synthetic-settings-e2e-not-a-provider-secret";
}
globalThis.fetch = transport.createSettingsQaFetch(
  globalThis.fetch,
  Number(port),
);
