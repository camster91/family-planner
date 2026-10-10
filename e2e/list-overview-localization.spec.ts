/** #411: existing overview/filter/empty states with isolated fabricated data. */
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { authFile } from "./support/env";
import { browserSend, expect, test } from "./support/test";
import {
  listOverviewEnglish,
  listOverviewSpanish,
  type ListOverviewMessage,
} from "../src/i18n/list-overview";
import {
  isPseudolocaleEnabled,
  pseudolocalizeTemplate,
} from "../src/i18n/pseudo";

const projects = [
  "phone-390x844",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
];

async function captureOverview(
  page: Page,
  scope: Locator,
  info: TestInfo,
  name: string,
) {
  await expect(scope).toBeVisible();
  const targets = scope.locator("button, a.btn-filled");
  for (const target of await targets.all()) {
    if (!(await target.isVisible())) continue;
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(
      await target.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await target.focus();
    await expect(target).toBeFocused();
    await target.evaluate((el) => el.scrollIntoView({ block: "center" }));
    expect(
      await target.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return hit !== null && el.contains(hit);
      }),
    ).toBe(true);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await scope.evaluate((el) => el.setAttribute("data-overview-qa", "current"));
  expect(
    (
      await new AxeBuilder({ page })
        .include('[data-overview-qa="current"]')
        .analyze()
    ).violations,
  ).toEqual([]);
  // Full-page captures start at the top, so fixed navigation is not painted mid-image.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
  await scope.evaluate((el) => el.removeAttribute("data-overview-qa"));
}

for (const locale of ["en", "es"] as const) {
  const text = (key: ListOverviewMessage) => {
    const value = (locale === "en" ? listOverviewEnglish : listOverviewSpanish)[
      key
    ];
    return isPseudolocaleEnabled(process.env)
      ? pseudolocalizeTemplate(value)
      : value;
  };
  for (const role of ["parentA", "childA"] as const) {
    test.describe(`${locale} ${role} list overview localization`, () => {
      test.use({ storageState: authFile(role) });
      let listId = "";
      test.beforeEach(async ({ page }, info) => {
        test.skip(
          !projects.includes(info.project.name),
          "representative phone, portrait and fridge layouts",
        );
        listId = "";
        await page.addInitScript(
          (value) => localStorage.setItem("familyPlanner_language", value),
          locale,
        );
      });
      test.afterEach(async ({ page }) => {
        if (listId) {
          await page.goto("/dashboard/lists");
          expect(
            (await browserSend(page, "DELETE", "/api/lists", { listId }))
              .status,
          ).toBe(200);
        }
      });
      if (role === "parentA") {
        test("overview and mounted filter retain list text and exact query", async ({
          page,
        }, info) => {
          await page.goto("/dashboard/lists");
          const created = await browserSend(page, "POST", "/api/lists/create", {
            name: "Pan {count} 🥖 overview QA",
            type: "grocery",
          });
          expect(created.status).toBe(200);
          listId = JSON.parse(created.body).list.id;
          await page.goto("/dashboard/lists");
          const scope = page.locator("main#main-content");
          await expect(
            scope.getByRole("heading", { name: text("title"), exact: true }),
          ).toBeVisible();
          await expect(
            scope.getByText("Pan {count} 🥖 overview QA", { exact: true }),
          ).toBeVisible();
          await expect(
            scope.getByRole("link", { name: text("add"), exact: true }),
          ).toHaveAttribute("href", "/dashboard/lists/create");
          await captureOverview(page, scope, info, `overview-${locale}`);
          const filters = scope.getByRole("region", {
            name: text("filter"),
            exact: true,
          });
          const grocery = filters
            .getByRole("button")
            .filter({ hasText: text("groceryName") });
          await grocery.click();
          await expect(grocery).toHaveAttribute("aria-pressed", "true");
          await expect(page).toHaveURL(/\/dashboard\/lists\?type=grocery$/);
          await expect(
            scope.getByRole("heading", {
              name: text("groceryName"),
              exact: true,
            }),
          ).toBeVisible();
          await expect(scope.getByRole("status")).toHaveText(
            text("groceryShowing"),
          );
          await expect(
            scope.getByText("Pan {count} 🥖 overview QA", { exact: true }),
          ).toBeVisible();
          await expect(
            scope.getByRole("link", { name: text("add"), exact: true }),
          ).toHaveAttribute("href", "/dashboard/lists/create?type=grocery");
          await captureOverview(page, scope, info, `filtered-${locale}`);
          await scope
            .getByRole("button", { name: text("showAll"), exact: true })
            .click();
          await expect(page).toHaveURL(/\/dashboard\/lists$/);
          await expect(grocery).toHaveAttribute("aria-pressed", "false");
        });
        test("empty wishlist preserves creation target", async ({
          page,
        }, info) => {
          await page.goto("/dashboard/lists?type=wishlist");
          const scope = page.locator("main#main-content");
          await expect(
            scope.getByRole("heading", { name: text("title"), exact: true }),
          ).toBeVisible();
          await expect(
            scope.getByRole("heading", {
              name: text("wishlistEmpty"),
              exact: true,
            }),
          ).toBeVisible();
          await expect(
            scope.getByRole("link", { name: text("create"), exact: true }),
          ).toHaveAttribute("href", "/dashboard/lists/create?type=wishlist");
          await captureOverview(page, scope, info, `empty-wishlist-${locale}`);
        });
      }
      test("retired meal-plan empty state keeps role restrictions", async ({
        page,
      }, info) => {
        await page.goto("/dashboard/lists?type=meal_plan");
        const scope = page.locator("main#main-content");
        await expect(
          scope.getByRole("heading", { name: text("title"), exact: true }),
        ).toBeVisible();
        await expect(
          scope.getByRole("heading", {
            name: text("meal_planEmpty"),
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          scope.getByText(text("mealsNow"), { exact: true }),
        ).toBeVisible();
        await expect(
          scope.getByRole("link", { name: text("create"), exact: true }),
        ).toHaveCount(0);
        await expect(
          scope.getByRole("link", { name: text("add"), exact: true }),
        ).toHaveCount(role === "parentA" ? 1 : 0);
        await captureOverview(
          page,
          scope,
          info,
          `legacy-empty-${role}-${locale}`,
        );
      });
    });
  }
}
