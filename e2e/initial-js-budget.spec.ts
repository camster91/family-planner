/** #413: cold production-build navigation, including chunks requested by hydration. */
import {
  CORE_JS_BUDGETS,
  enforceJavaScriptBudget,
  measureInitialJavaScript,
  type ScriptAsset,
} from "../scripts/initial-js-budget";
import { authFile, E2E_BASE_URL } from "./support/env";
import type { Request } from "@playwright/test";
import { expect, test } from "./support/test";

test.use({ storageState: authFile("parentA") });
for (const [route, budget] of Object.entries(CORE_JS_BUDGETS)) {
  test(`${route} cold initial JavaScript stays within ${budget} gzip bytes`, async ({
    page,
  }, info) => {
    const scripts: ScriptAsset[] = [];
    const pending: Promise<void>[] = [];
    const failures: string[] = [];
    const activeScripts = new Set<Request>();
    let lastScriptActivity = Date.now();
    page.on("request", (request) => {
      if (request.resourceType() !== "script") return;
      activeScripts.add(request);
      lastScriptActivity = Date.now();
    });
    const finishScript = (request: Request) => {
      if (request.resourceType() !== "script") return;
      activeScripts.delete(request);
      lastScriptActivity = Date.now();
    };
    page.on("requestfinished", finishScript);
    page.on("requestfailed", finishScript);
    page.on("requestfailed", (request) => {
      if (request.resourceType() === "script")
        failures.push("An initial script request failed.");
    });
    page.on("response", (response) => {
      if (response.request().resourceType() !== "script") return;
      pending.push(
        (async () => {
          if (!response.ok())
            throw new Error("An initial script response was unsuccessful.");
          scripts.push({ url: response.url(), body: await response.body() });
        })().catch(() => {
          failures.push("An initial script response could not be read.");
        }),
      );
    });
    const response = await page.goto(`/dashboard/${route}`);
    expect(response?.status()).toBe(200);
    await expect(page.locator("main")).toBeVisible();
    // A React-controlled read-only interaction proves hydration has completed.
    const menu = page.getByRole("button", { name: "User menu", exact: true });
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    // Measure hydrated JavaScript rather than waiting for the entire app's
    // background sync to become idle. Keep all script failures and wait for
    // both outstanding script transfers and a quiet script window.
    await expect
      .poll(
        () =>
          activeScripts.size === 0 && Date.now() - lastScriptActivity >= 500,
        { timeout: 10_000, message: "Initial JavaScript transfers settle" },
      )
      .toBe(true);
    await Promise.all(pending);
    expect(failures).toEqual([]);
    const measured = measureInitialJavaScript(E2E_BASE_URL, scripts);
    // The modern browser skips nomodule scripts itself; record them separately.
    const legacyScripts = await page
      .locator("script[nomodule][src]")
      .evaluateAll((elements) =>
        elements.map((el) => new URL((el as HTMLScriptElement).src).pathname),
      );
    await info.attach("initial-js-budget", {
      body: Buffer.from(
        JSON.stringify({ route, budget, ...measured, legacyScripts }, null, 2),
      ),
      contentType: "application/json",
    });
    enforceJavaScriptBudget(measured, budget);
  });
}
