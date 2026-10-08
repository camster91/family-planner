/**
 * Offline behaviour (O-41): the app-wide "You're offline" banner and the
 * offline page the service worker (public/sw.js) shows when a navigation
 * fails for lack of a network. Contract: docs/architecture/OFFLINE_SYNC.md
 * "Offline banner and offline page".
 *
 * Service workers are blocked for every other spec (playwright.config.ts), so
 * a worker can never change their navigations or `page.route` handling. The
 * offline-page test opts back in and registers /sw.js itself, which works on
 * both `next start` (where the app also registers it) and `next dev` (where
 * the app never does).
 *
 * Read-only: no data is written. Runs at 390x844 and 1366x768. No baseline
 * includes the banner (it renders nothing while online).
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { authFile } from "./support/env";
import { goOffline, goOnline } from "./support/network";
import { expect, test } from "./support/test";

const PROJECTS = ["phone-390x844", "desktop-1366x768"];

function onlyOnSomeProjects(testInfo: TestInfo) {
  test.skip(
    !PROJECTS.includes(testInfo.project.name),
    "offline checks run at 390x844 and 1366x768",
  );
}

const banner = (page: Page) => page.getByTestId("app-offline-banner");

test.describe("offline: Family A parent", () => {
  test.use({ storageState: authFile("parentA") });

  test.beforeEach(async ({}, testInfo) => onlyOnSomeProjects(testInfo));

  test("the banner says offline, then back online, and never covers the tab bar", async ({
    page,
  }, testInfo) => {
    await page.goto("/dashboard/lists");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(banner(page)).toHaveCount(0);

    await goOffline(page);
    await expect(banner(page)).toHaveText(
      "You're offline. Some things may not load or save until you're back online.",
    );
    await expect(page.locator("[data-offline-banner]")).toHaveAttribute(
      "aria-live",
      "polite",
    );

    if (testInfo.project.name === "phone-390x844") {
      const tabBar = page.locator(".tab-bar");
      await expect(tabBar).toBeVisible();
      const bannerBox = (await banner(page).boundingBox())!;
      const tabBox = (await tabBar.boundingBox())!;
      expect(bannerBox.y + bannerBox.height).toBeLessThanOrEqual(tabBox.y);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);

    const axe = await new AxeBuilder({ page })
      .include("[data-offline-banner]")
      .analyze();
    expect(
      axe.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      ),
    ).toEqual([]);

    await goOnline(page);
    await expect(banner(page)).toHaveText("Back online.");
    await expect(banner(page)).toHaveCount(0, { timeout: 10_000 });
  });

  test("one offline message per page: calendar, Today and a list add only their own detail", async ({
    page,
  }) => {
    const offlineWords = page.getByText(/You['’]re offline/);

    await page.goto("/dashboard/calendar");
    await expect(page.getByTestId("calendar-updated")).toBeVisible();
    await goOffline(page);
    await expect(banner(page)).toBeVisible();
    await expect(page.getByTestId("sync-notice")).toContainText(
      "Showing what was here",
    );
    await expect(offlineWords).toHaveCount(1);
    await goOnline(page);

    await page.goto("/dashboard/today");
    await expect(page.getByTestId("board-updated")).toBeVisible();
    await goOffline(page);
    await expect(banner(page)).toBeVisible();
    await expect(page.getByTestId("sync-notice")).toContainText(
      "Showing what was here",
    );
    await expect(offlineWords).toHaveCount(1);
    await goOnline(page);

    await page.goto("/dashboard/lists");
    await page
      .getByRole("link", { name: /Groceries/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/dashboard\/lists\/[^/]+$/);
    await expect(page.getByRole("checkbox").first()).toBeVisible();
    await goOffline(page);
    await expect(banner(page)).toBeVisible();
    await expect(page.getByTestId("list-offline-detail")).toContainText(
      "Ticks are saved on this device",
    );
    await expect(offlineWords).toHaveCount(1);
    await goOnline(page);
  });

  test.describe("offline page", () => {
    test.use({ serviceWorkers: "allow" });

    test("a navigation that fails offline shows the offline page, which reloads the same address when back online", async ({
      page,
    }) => {
      await page.goto("/dashboard/lists");
      await page.evaluate(async () => {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        await navigator.serviceWorker.ready;
      });
      await expect
        .poll(() =>
          page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
        )
        .toBe(true);

      await goOffline(page);
      await page.goto("/dashboard/calendar");
      await expect(page).toHaveURL(/\/dashboard\/calendar$/);
      await expect(
        page.getByRole("heading", { name: "You're offline." }),
      ).toBeVisible();
      await expect(
        page.getByText("Herewoven will reload when you're back online."),
      ).toBeVisible();
      const retry = page.getByRole("button", { name: "Try again" });
      await expect(retry).toBeVisible();
      const box = (await retry.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      const axe = await new AxeBuilder({ page }).analyze();
      expect(
        axe.violations.filter(
          (v) => v.impact === "serious" || v.impact === "critical",
        ),
      ).toEqual([]);

      // Back online: the page reloads by itself, at the address that failed.
      await goOnline(page);
      await expect(
        page.getByRole("heading", { name: "You're offline." }),
      ).toHaveCount(0);
      await expect(page).toHaveURL(/\/dashboard\/calendar$/);
      await expect(page.locator("#main-content")).toBeVisible();
    });
  });
});
