/** #443 QA availability may never enable a real provider or bypass fixture guards. */
import { spawnSync } from "node:child_process";
import path from "node:path";

const configurations = [
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
];
function install(overrides: Record<string, string> = {}) {
  return spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      "-e",
      `const before = JSON.stringify(process.env); const fetchBefore = globalThis.fetch;
     import(${JSON.stringify(path.resolve("e2e/support/settings-qa.mjs"))})
       .then(() => process.stdout.write(JSON.stringify({installed:true,
         calendar:Boolean(process.env.GOOGLE_CLIENT_ID && process.env.MICROSOFT_CLIENT_ID && process.env.CALENDAR_TOKEN_KEY && process.env.APP_URL),
         pin:process.env.SHARED_DEVICE_ENABLED==="1", ai:process.env.CAPTURE_AI_SETTINGS_ENABLED==="1",
         fetchChanged:globalThis.fetch!==fetchBefore})))
       .catch(() => { process.stdout.write(JSON.stringify({installed:false,
         envUnchanged:JSON.stringify(process.env)===before,
         fetchUnchanged:globalThis.fetch===fetchBefore})); process.exitCode=1; });`,
    ],
    {
      env: {
        ...process.env,
        ...Object.fromEntries(configurations.map((name) => [name, ""])),
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://localhost/fp_e2e_ci",
        FIXTURES_ALLOW: "1",
        E2E_SETTINGS_QA: "enabled",
        E2E_ALLOW_SETTINGS_QA: "1",
        E2E_SKIP_BUILD: "1",
        E2E_PORT: "3100",
        ...overrides,
      },
      encoding: "utf8",
      timeout: 10000,
    },
  );
}
it.each([
  { E2E_SETTINGS_QA: "0" },
  { E2E_SETTINGS_QA: "future" },
  { E2E_ALLOW_SETTINGS_QA: "0" },
  { E2E_SKIP_BUILD: "0" },
  { FIXTURES_ALLOW: "0" },
  { NODE_ENV: "production" },
  { DATABASE_URL: "postgresql://localhost/family_planner_prod" },
  { DATABASE_URL: "postgresql://postgres/fp_e2e_ci" },
  { DATABASE_URL: "postgresql://localhost/family_planner" },
  { DATABASE_URL: "postgresql://localhost/fp_e2e_ci?host=external.test" },
  { E2E_PORT: "0" },
  { E2E_PORT: "65536" },
  { E2E_PORT: "3100x" },
  ...configurations.map((name) => ({ [name]: "non-fixture-inherited" })),
])("refuses before changing availability or transport: %j", (overrides) => {
  const run = install(overrides);
  expect(run.status).not.toBe(0);
  expect(JSON.parse(run.stdout)).toEqual({
    installed: false,
    envUnchanged: true,
    fetchUnchanged: true,
  });
});
it.each(["enabled", "unavailable"])(
  "installs only the explicit %s prebuilt server",
  (mode) => {
    const run = install({ E2E_SETTINGS_QA: mode });
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({
      installed: true,
      calendar: mode === "enabled",
      pin: mode === "enabled",
      ai: mode === "enabled",
      fetchChanged: true,
    });
  },
);

const { createSettingsQaFetch } =
  require("../../e2e/support/settings-qa-fetch.cjs") as {
    createSettingsQaFetch: (
      forward: typeof fetch,
      port: number,
    ) => typeof fetch;
  };
it.each([
  "https://accounts.google.com/o/oauth2/v2/auth",
  "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  "https://api.openai.com/v1/chat/completions",
  "https://example.test/private.ics",
  "http://192.0.2.1:3100/",
  "file:///private/test",
  "http://localhost:3101/api/version",
  "http://user:password@localhost:3100/api/version",
])("refuses non-fixture transport without forwarding: %s", async (url) => {
  const forward = jest.fn();
  await expect(createSettingsQaFetch(forward, 3100)(url)).rejects.toThrow(
    "refused",
  );
  expect(forward).not.toHaveBeenCalled();
});
it.each(["localhost", "127.0.0.1", "[::1]"])(
  "allows only the isolated server port and never follows redirects: %s",
  async (host) => {
    const response = new Response("synthetic-only");
    const forward = jest.fn().mockResolvedValue(response);
    const request = new Request(`http://${host}:3100/api/version`);
    expect(
      await createSettingsQaFetch(forward, 3100)(request, {
        redirect: "follow",
      }),
    ).toBe(response);
    expect(forward).toHaveBeenCalledWith(request, { redirect: "error" });
  },
);
