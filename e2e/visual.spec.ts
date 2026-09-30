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
      // One home (#269): /dashboard is the Today board with the parent's
      // summary sentence above it.
      await page.goto("/dashboard");
      await expect(page).toHaveURL(/\/dashboard\/today$/);
      if (theme === "dark")
        await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      const main = page.locator("#main-content");
      await expect(main.getByText("Dentist (Casey)").first()).toBeVisible();
      await expect(main.getByTestId("home-summary-sentence")).toBeVisible();
      await ready(page);
      await expect(page).toHaveScreenshot(`dashboard-parent-${theme}.png`, {
        // Clock-derived text: the date (asserted as text in journeys.spec.ts),
        // the ticking clock and the "Updated" time.
        mask: [
          main.getByTestId("board-date"),
          main.getByTestId("board-clock"),
          main.getByTestId("board-updated"),
        ],
      });
    });
  }
});
