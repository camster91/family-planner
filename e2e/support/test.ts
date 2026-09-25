/**
 * Project-wide `test` for E2E specs (#155). Import `test`/`expect` from here,
 * not from '@playwright/test', so every page gets the fixed browser clock.
 */
import { test as base, expect, type Page } from "@playwright/test";
import { FIXTURE_PASSWORD } from "../../src/lib/fixtures/dataset";
import { E2E_ANCHOR } from "./env";

export const test = base.extend<{ fixedClock: void }>({
  // Auto fixture: pin the browser clock to the fixture anchor before any page
  // script runs. `install` (not `setFixedTime`) keeps timers working; time then
  // flows forward from the anchor, the same way the server clock shim does.
  fixedClock: [
    async ({ page }, use) => {
      await page.clock.install({ time: E2E_ANCHOR });
      await use();
    },
    { auto: true },
  ],
});

export { expect };

/** Sign in through the real login form (no API shortcuts). */
export async function loginViaUi(
  page: Page,
  email: string,
  password: string = FIXTURE_PASSWORD,
) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
}

/**
 * Same-origin fetch from inside the page, so the request carries the browser's
 * own session cookie exactly like the app's client code would.
 */
export async function browserFetch(
  page: Page,
  path: string,
): Promise<{ status: number; body: string }> {
  return page.evaluate(async (p) => {
    const res = await fetch(p, { credentials: "same-origin" });
    return { status: res.status, body: await res.text() };
  }, path);
}
