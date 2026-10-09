/** #415: existing store-section controls with isolated fabricated household rows. */
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page, TestInfo } from "@playwright/test";
import pg from "pg";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { sectionNameKey } from "../src/lib/grocery-sections";
import {
  storeSectionsEnglish,
  storeSectionsSpanish,
  type StoreSectionMessage,
} from "../src/i18n/store-section-messages";
import {
  isPseudolocaleEnabled,
  pseudolocalizeTemplate,
} from "../src/i18n/pseudo";
import { authFile } from "./support/env";
import { expect, test } from "./support/test";

const projects = [
  "phone-390x844",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
];
const listId = "fx_e2e_section_copy_list";
const itemId = "fx_e2e_section_copy_milk";
const content = "E2E section-copy milk {item} 🥛";
const nameKey = sectionNameKey(content);
const A = FIXTURE_IDS.familyA;
async function withDb<T>(fn: (db: pg.Client) => Promise<T>) {
  assertFixtureTargetAllowed(process.env);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}
async function cleanup(db: pg.Client) {
  await db.query('DELETE FROM "List" WHERE id = $1', [listId]);
  await db.query(
    'DELETE FROM "GrocerySectionPreference" WHERE family_id = $1 AND name_key = $2',
    [A.family, nameKey],
  );
}
async function fixture(db: pg.Client) {
  await cleanup(db);
  await db.query(
    "INSERT INTO \"List\" (id, family_id, name, type, created_by, updated_at) VALUES ($1, $2, $3, 'grocery', $4, NOW())",
    [listId, A.family, "E2E section-copy list {name} 🛒", A.parent],
  );
  await db.query(
    'INSERT INTO "ListItem" (id, list_id, content, quantity, added_by, updated_at) VALUES ($1, $2, $3, 1, $4, NOW())',
    [itemId, listId, content, A.parent],
  );
  await db.query(
    "INSERT INTO \"GrocerySectionPreference\" (id, family_id, name_key, section, updated_by, updated_at) VALUES ($1, $2, $3, 'pantry', $4, NOW())",
    ["fx_e2e_section_copy_preference", A.family, nameKey, A.parent],
  );
}
async function capture(
  page: Page,
  scope: Locator,
  info: TestInfo,
  name: string,
) {
  await expect(scope).toBeVisible();
  for (const target of await scope.locator("button").all()) {
    if (!(await target.isVisible())) continue;
    await target.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const box = await target.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    if (await target.isEnabled()) {
      await target.focus();
      await expect(target).toBeFocused();
    }
    expect(
      await target.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
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
  await scope.evaluate((el) =>
    el.setAttribute("data-section-copy-qa", "current"),
  );
  expect(
    (
      await new AxeBuilder({ page })
        .include('[data-section-copy-qa="current"]')
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await scope.evaluate((el) => {
    el.scrollTop = 0;
    el.querySelectorAll<HTMLElement>("*").forEach((child) => {
      child.scrollTop = 0;
    });
  });
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
  await scope.evaluate((el) => el.removeAttribute("data-section-copy-qa"));
}

for (const locale of ["en", "es"] as const) {
  const text = (key: StoreSectionMessage, item?: string) => {
    const raw = (locale === "en" ? storeSectionsEnglish : storeSectionsSpanish)[
      key
    ];
    const value = isPseudolocaleEnabled(process.env)
      ? pseudolocalizeTemplate(raw)
      : raw;
    return item === undefined ? value : value.replace("{item}", item);
  };
  for (const role of ["parentA", "childA"] as const) {
    test.describe(`${locale} ${role} store-section localization`, () => {
      test.use({ storageState: authFile(role) });
      test.beforeEach(async ({ page }, info) => {
        test.skip(
          !projects.includes(info.project.name),
          "representative phone, portrait and fridge layouts",
        );
        await withDb(fixture);
        await page.addInitScript(
          (language) =>
            localStorage.setItem("familyPlanner_language", language),
          locale,
        );
      });
      test.afterEach(async () => {
        await withDb(cleanup);
      });
      test("sort, current, pending, error and automatic choices preserve canonical data", async ({
        page,
      }, info) => {
        await page.goto(`/dashboard/lists/${listId}`);
        const sort = page.getByTestId("section-sort");
        await expect(sort).toContainText(text("grouped"));
        if (role === "parentA")
          await expect(
            sort.getByRole("switch", { name: text("sort") }),
          ).toHaveAttribute("aria-checked", "true");
        else {
          await expect(sort.getByRole("switch")).toHaveCount(0);
          await expect(sort).toContainText(text("sortOn"));
        }
        await expect(
          page.getByRole("region", { name: text("pantry"), exact: true }),
        ).toContainText(content);
        await capture(page, sort, info, `${locale}-${role}-sort-on`);
        const move = page.getByRole("button", {
          name: text("moveItem", content),
          exact: true,
        });
        await move.click();
        const dialog = page.getByRole("dialog", {
          name: text("moveTitle", content),
          exact: true,
        });
        await expect(
          dialog.getByRole("list", { name: text("sections") }),
        ).toBeVisible();
        await expect(
          dialog.getByRole("button", {
            name: `${text("pantry")} ${text("current")}`,
            pressed: true,
          }),
        ).toBeVisible();
        await expect(
          dialog.getByRole("button", { name: text("automatic") }),
        ).toBeVisible();
        await capture(page, dialog, info, `${locale}-${role}-chosen-current`);

        let release!: () => void;
        const hold = new Promise<void>((resolve) => {
          release = resolve;
        });
        await page.route("**/api/lists/items/section", async (route) => {
          await hold;
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Fixture section error {current}" }),
          });
        });
        await dialog
          .getByRole("button", { name: text("bakery"), exact: true })
          .click();
        await expect(
          dialog.getByRole("button", { name: text("bakery"), exact: true }),
        ).toBeDisabled();
        await expect(
          dialog.getByRole("button", { name: text("close"), exact: true }),
        ).toHaveCount(0);
        try {
          await capture(page, dialog, info, `${locale}-${role}-pending`);
        } finally {
          release();
        }
        // The caller's existing generic mutation error remains separate copy debt.
        await expect(dialog.getByRole("alert")).toHaveText(
          "Couldn’t move this item. Try again.",
        );
        await page.unroute("**/api/lists/items/section");
        await capture(page, dialog, info, `${locale}-${role}-error`);

        const saved = page.waitForRequest(
          (request) =>
            request.url().endsWith("/api/lists/items/section") &&
            request.method() === "PATCH",
        );
        await dialog
          .getByRole("button", { name: text("automatic"), exact: true })
          .click();
        expect((await saved).postDataJSON()).toEqual({ itemId, section: null });
        await expect(dialog).toBeHidden();
        const preferences = await withDb((db) =>
          db.query(
            'SELECT section FROM "GrocerySectionPreference" WHERE family_id = $1 AND name_key = $2',
            [A.family, nameKey],
          ),
        );
        expect(preferences.rows).toEqual([]);
        await expect(
          page.getByRole("region", { name: text("dairy_eggs"), exact: true }),
        ).toContainText(content);
        await move.click();
        await expect(
          dialog.getByRole("button", { name: text("automatic"), exact: true }),
        ).toHaveCount(0);
        await expect(
          dialog.getByRole("button", {
            name: `${text("dairy_eggs")} ${text("current")}`,
            pressed: true,
          }),
        ).toBeVisible();
        await capture(
          page,
          dialog,
          info,
          `${locale}-${role}-automatic-current`,
        );
        await dialog
          .getByRole("button", { name: text("close"), exact: true })
          .click();
        if (role === "parentA") {
          const toggle = sort.getByRole("switch", {
            name: text("sort"),
            exact: true,
          });
          const switched = page.waitForResponse(
            (response) =>
              response.url().endsWith("/api/lists/section-sort") &&
              response.request().method() === "PATCH",
          );
          await toggle.click();
          const savedSort = await switched;
          expect(savedSort.status()).toBe(200);
          expect(savedSort.request().postDataJSON()).toEqual({
            listId,
            sortBySection: false,
          });
          await expect(toggle).toHaveAttribute("aria-checked", "false");
          await expect(sort).toContainText(text("added"));
          await expect(move).toHaveCount(0);
          const state = await withDb((db) =>
            db.query('SELECT sort_by_section FROM "List" WHERE id = $1', [
              listId,
            ]),
          );
          expect(state.rows).toEqual([{ sort_by_section: false }]);
          await capture(page, sort, info, `${locale}-${role}-sort-off`);
        }
      });
    });
  }
}
