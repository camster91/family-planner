/**
 * Narrow widths and zoom (#133 acceptance: "No horizontal overflow or clipped
 * primary actions at 320 … 1920 logical widths" and "useful at 200–400%
 * zoom/reflow"). Tagged `@reflow`, so it runs in the normal journeys step
 * (`--grep-invert @visual`), not with the screenshots.
 *
 * Pages: the Family A parent's Today board, calendar, chores, lists, meals and
 * settings, and the Family A child's kid home (`/dashboard`). Each is loaded
 * at the widths below, which the six viewport projects do not cover, and
 * checked for:
 *
 * - no horizontal page overflow:
 *   `document.scrollingElement.scrollWidth <= clientWidth + 1` (1px absorbs
 *   sub-pixel rounding);
 * - primary actions at least 44x44 CSS px: every visible `.btn-filled`,
 *   `.btn-primary` and `.btn-destructive`, and the phone tab bar / top-bar
 *   tab links (AGENTS.md ">=44x44 primary targets").
 *
 * 200% zoom: Playwright cannot set browser zoom, and CSS `zoom` on the root
 * does not change media queries or the layout viewport, so it is not what a
 * zoomed user gets. Browser zoom at 200% on a 1280x800 window gives a
 * 640x400 CSS-px layout viewport at device pixel ratio 2, with media queries
 * evaluated at 640px. The `zoom-200` size models that layout
 * (`viewport` 640x400, `deviceScaleFactor: 2`, desktop pointer). `zoom-400`
 * models the same window at 400% with 320x200 CSS px, scale factor 4 and a
 * desktop pointer. The separate `w320` case retains mobile/touch behavior.
 * These are layout-viewport emulations, not real browser zoom or physical
 * Android high-text-scale acceptance.
 *
 * Read-only: nothing is created or changed. The sizes are set with
 * `test.use`, so the spec runs in one project only (`desktop-1366x768`);
 * running it in every project would repeat identical checks.
 */
import type { Page, TestInfo } from "@playwright/test";
import { authFile } from "./support/env";
import { expect, test } from "./support/test";

const PROJECT = "desktop-1366x768";

function onlyOnce(testInfo: TestInfo) {
  test.skip(
    testInfo.project.name !== PROJECT,
    "reflow sizes are set by the spec; runs in one project only",
  );
}

const SIZES = [
  {
    name: "w320",
    viewport: { width: 320, height: 568 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  },
  {
    name: "w360",
    viewport: { width: 360, height: 800 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  },
  {
    name: "w600",
    viewport: { width: 600, height: 960 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: true,
  },
  {
    name: "w768",
    viewport: { width: 768, height: 1024 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: true,
  },
  {
    name: "w1024",
    viewport: { width: 1024, height: 768 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: true,
  },
  {
    // Explicit desktop layout at 400%; distinct from the mobile w320 case.
    name: "zoom-400",
    viewport: { width: 320, height: 200 },
    deviceScaleFactor: 4,
    isMobile: false,
    hasTouch: false,
  },
  {
    // 1280x800 at 200% browser zoom (see the header).
    name: "zoom-200",
    viewport: { width: 640, height: 400 },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
  },
] as const;

const PARENT_PAGES = [
  "/dashboard/today",
  "/dashboard/calendar",
  "/dashboard/chores",
  "/dashboard/lists",
  "/dashboard/meals",
  "/dashboard/settings",
];

const PRIMARY_ACTIONS = [
  ".btn-filled",
  ".btn-primary",
  ".btn-destructive",
  "nav.tab-bar a[href]",
  '[data-testid="top-tabs"] a[href]',
].join(", ");

async function settle(page: Page) {
  await expect(page.locator("#main-content")).toBeVisible();
  // Let client components hydrate and fetch, and fonts load, before measuring.
  await page.waitForLoadState("load");
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(500);
}

async function expectReflow(page: Page, label: string) {
  const size = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  expect(
    size.scrollWidth,
    `${label}: horizontal overflow (scrollWidth ${size.scrollWidth}, clientWidth ${size.clientWidth})`,
  ).toBeLessThanOrEqual(size.clientWidth + 1);

  // List every undersized action by name, so a failure says what to fix.
  const small = await page.locator(PRIMARY_ACTIONS).evaluateAll((els) =>
    els
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return (
          r.width > 0 &&
          r.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none"
        );
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          name: (
            el.getAttribute("aria-label") ?? (el.textContent ?? "").trim()
          ).slice(0, 40),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      })
      .filter((t) => t.w < 44 || t.h < 44),
  );
  expect(small, `${label}: primary actions smaller than 44x44`).toEqual([]);

  const clipped = await page.locator(PRIMARY_ACTIONS).evaluateAll((els) =>
    els.flatMap((el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (
        r.width <= 0 ||
        r.height <= 0 ||
        style.visibility === "hidden" ||
        style.display === "none"
      )
        return [];
      if (r.left >= -1 && r.right <= document.documentElement.clientWidth + 1)
        return [];
      return [
        {
          name: (
            el.getAttribute("aria-label") ?? (el.textContent ?? "").trim()
          ).slice(0, 60),
          left: r.left,
          right: r.right,
          viewport: document.documentElement.clientWidth,
        },
      ];
    }),
  );
  expect(
    clipped,
    `${label}: horizontally clipped primary action targets`,
  ).toEqual([]);
}

for (const size of SIZES) {
  test.describe(`reflow @reflow ${size.name}`, () => {
    test.use({
      viewport: size.viewport,
      deviceScaleFactor: size.deviceScaleFactor,
      isMobile: size.isMobile,
      hasTouch: size.hasTouch,
    });

    test.describe("Family A parent", () => {
      test.use({ storageState: authFile("parentA") });

      for (const path of PARENT_PAGES) {
        test(path, async ({ page }, testInfo) => {
          onlyOnce(testInfo);
          await page.goto(path);
          await expect(page).toHaveURL(new RegExp(`${path}$`));
          await settle(page);
          await expectReflow(page, `${size.name} ${path}`);
          if (size.name === "zoom-400")
            await page.screenshot({
              path: testInfo.outputPath("zoom-400.png"),
            });
        });
      }
    });

    test.describe("Family A child", () => {
      test.use({ storageState: authFile("childA") });

      test("kid home", async ({ page }, testInfo) => {
        onlyOnce(testInfo);
        await page.goto("/dashboard");
        await expect(page.getByText("Today's Missions")).toBeVisible();
        await settle(page);
        await expectReflow(page, `${size.name} kid home`);
        if (size.name === "zoom-400")
          await page.screenshot({ path: testInfo.outputPath("zoom-400.png") });
      });
    });
  });
}
