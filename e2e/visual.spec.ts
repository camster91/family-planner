/**
 * Visual snapshots (#155), tagged @visual. Baselines live in
 * e2e/__screenshots__/ and are Linux + Chromium specific (font rendering
 * differs per OS). Review policy: docs/testing/VISUAL_REGRESSION.md and
 * docs/testing/E2E.md. Never update baselines just to get green.
 *
 * Determinism: fixed fixture data (#154), server + browser clocks pinned to the
 * anchor, fixed zone/locale, reduced motion, animations disabled, 1x DPR.
 */
import type { Page } from "@playwright/test";
import { authFile } from "./support/env";
import { useStoredTheme } from "./support/network";
import { expect, test } from "./support/test";

/** Wait for fonts and a settled layout before capturing. */
async function ready(page: Page) {
  await page.waitForLoadState("load");
  await page.evaluate(() => document.fonts.ready);
  // Nothing should be focused or hovered in a baseline.
  await page.mouse.move(0, 0);
}

test.describe("@visual signed out", () => {
  test("login page", async ({ page }) => {
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "Welcome Back" }),
    ).toBeVisible();
    await ready(page);
    await expect(page).toHaveScreenshot("login.png");
  });
});

test.describe("@visual Family A parent", () => {
  test.use({ storageState: authFile("parentA") });

  for (const theme of ["light", "dark"] as const) {
    test(`dashboard (${theme})`, async ({ page }) => {
      await useStoredTheme(page, theme);
      await page.goto("/dashboard");
      if (theme === "dark")
        await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      const main = page.locator("#main-content");
      await expect(main.getByText("Take out recycling")).toBeVisible();
      await ready(page);
      await expect(page).toHaveScreenshot(`dashboard-parent-${theme}.png`, {
        // Clock-derived text. It is pinned today, but it is the first thing to
        // drift if FIXTURES_ANCHOR_DATE or the zone changes, and it is covered by
        // the text assertion in journeys.spec.ts instead.
        mask: [
          main.getByText("Monday, January 5"),
          main.getByText(/^Good (morning|afternoon|evening)/),
        ],
      });
    });
  }
});
