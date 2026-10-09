/** The browser QA transport must never leak a synthetic image to an external provider. */
import { spawnSync } from "node:child_process";
import path from "node:path";
const { createInventoryScanStub, SYNTHETIC_SCAN_KEY, SYNTHETIC_SCAN_ITEMS } =
  require("../../e2e/support/inventory-scan-stub.cjs") as {
    createInventoryScanStub: (forward: typeof fetch) => typeof fetch;
    SYNTHETIC_SCAN_KEY: string;
    SYNTHETIC_SCAN_ITEMS: unknown[];
  };
it("intercepts only the exact fixture provider POST and never forwards it", async () => {
  const forward = jest.fn();
  const stub = createInventoryScanStub(forward);
  const response = await stub("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": SYNTHETIC_SCAN_KEY },
    body: "synthetic-image-only",
  });
  const body = await response.json();
  expect(JSON.parse(body.content[0].text)).toEqual({
    items: SYNTHETIC_SCAN_ITEMS,
  });
  expect(response.headers.get("x-e2e-inventory-scan")).toBe(
    "synthetic-fixed-endpoint",
  );
  expect(forward).not.toHaveBeenCalled();
});
it.each([
  "https://api.anthropic.com/v1/messages?unexpected=1",
  "https://api.anthropic.com/other",
  "https://example.test/provider",
  "http://192.0.2.1/",
  "file:///private/synthetic",
])("refuses external or unsupported %s without forwarding", async (url) => {
  const forward = jest.fn();
  const stub = createInventoryScanStub(forward);
  await expect(stub(url)).rejects.toThrow("refused");
  expect(forward).not.toHaveBeenCalled();
});
it("refuses wrong method and non-fixture key even at the exact provider endpoint", async () => {
  const forward = jest.fn();
  const stub = createInventoryScanStub(forward);
  for (const init of [
    { method: "GET", headers: { "x-api-key": SYNTHETIC_SCAN_KEY } },
    { method: "POST", headers: { "x-api-key": "non-fixture" } },
  ])
    await expect(
      stub("https://api.anthropic.com/v1/messages", init),
    ).rejects.toThrow("non-fixture");
  expect(forward).not.toHaveBeenCalled();
});
it("forwards only loopback traffic and refuses redirects to an external destination", async () => {
  const response = new Response("synthetic");
  const forward = jest.fn().mockResolvedValue(response);
  const stub = createInventoryScanStub(forward);
  expect(
    await stub("http://127.0.0.1:3100/api/version", { redirect: "follow" }),
  ).toBe(response);
  expect(forward).toHaveBeenCalledWith("http://127.0.0.1:3100/api/version", {
    redirect: "error",
  });
});
it.each([
  { E2E_ALLOW_INVENTORY_SCAN_STUB: "0" },
  { E2E_SKIP_BUILD: "0" },
  { FIXTURES_ALLOW: "0" },
  { NODE_ENV: "production" as const },
  { DATABASE_URL: "postgresql://localhost/family_planner_prod" },
  { DATABASE_URL: "postgresql://postgres/fp_e2e_ci" },
  { INVENTORY_SCAN_ANTHROPIC_API_KEY: "non-fixture" },
])("installer fails closed before enabling its transport: %j", (overrides) => {
  const run = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      "--import",
      path.resolve("e2e/support/inventory-scan-stub.mjs"),
      "-e",
      'process.stdout.write("installed")',
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://localhost/fp_e2e_ci",
        FIXTURES_ALLOW: "1",
        E2E_INVENTORY_SCAN_STUB: "1",
        E2E_ALLOW_INVENTORY_SCAN_STUB: "1",
        E2E_SKIP_BUILD: "1",
        INVENTORY_SCAN_ANTHROPIC_API_KEY: "",
        ...overrides,
      },
      encoding: "utf8",
      timeout: 10000,
    },
  );
  expect(run.status).not.toBe(0);
  expect(run.stdout).not.toContain("installed");
});
