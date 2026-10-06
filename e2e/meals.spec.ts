/**
 * Meals and grocery UI on the canonical models (ADR-0007, #252).
 *
 * - /dashboard/meals: add a free-text meal (edit, delete), add a meal with a
 *   fixture recipe and open its detail view, create a recipe inline, and two
 *   meals in one slot, each visible, editable and deletable (gap 2.4.1).
 * - Grocery provenance: "amount unit", "from <recipe>" and rows grouped by
 *   ingredient on a spec-owned grocery list.
 * - Roles: the meals pages stay parent-only in the UI (kid allowlist); the
 *   child can read recipes but not create them (O-7).
 * - Targets >= 44px, no horizontal overflow, long text, axe (serious/critical).
 *
 * Rows the UI creates are named "E2E meals …" and deleted before and after
 * each test. The grocery list and its items are spec-owned
 * (`fx_e2e_meals_*`) rather than seeded, so the dashboard Shopping card and
 * the fridge baselines, which count every open grocery item, are unchanged
 * outside this file. The fixture guard refuses production-like databases.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page, TestInfo } from "@playwright/test";
import pg from "pg";
import {
  FIXTURE_IDS,
  FIXTURE_LEGACY_MEAL_IDS,
} from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { authFile } from "./support/env";
import { browserFetch, browserSend, expect, test } from "./support/test";

const A = FIXTURE_IDS.familyA;
const L = FIXTURE_LEGACY_MEAL_IDS.familyA;
const PREFIX = "E2E meals";
/** The default anchor's calendar day (2026-01-05T12:00Z) in the E2E zone, America/Toronto. */
const TODAY_KEY = "2026-01-05";
const TODAY_LONG = "Monday, January 5";
const LONG_NAME = `${PREFIX} ${"slow-roasted tomato and white bean casserole with herby breadcrumbs ".repeat(2).trim()}`;

const IDS = {
  list: "fx_e2e_meals_grocery",
  tomLasagna: "fx_e2e_meals_item_tom_lasagna",
  tomSoup: "fx_e2e_meals_item_tom_soup",
  manual: "fx_e2e_meals_item_manual",
};

async function withDb<T>(fn: (db: pg.Client) => Promise<T>): Promise<T> {
  assertFixtureTargetAllowed(process.env);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

/** Everything the UI created in these tests (names start with PREFIX). */
async function removeUiRows(db: pg.Client) {
  await db.query(
    `DELETE FROM "FamilyMeal" WHERE family_id = $1 AND recipe_name LIKE $2`,
    [A.family, `${PREFIX}%`],
  );
  await db.query(
    `DELETE FROM "Recipe" WHERE family_id = $1 AND title LIKE $2`,
    [A.family, `${PREFIX}%`],
  );
  await db.query(
    `DELETE FROM "Ingredient" WHERE family_id = $1 AND name LIKE $2`,
    [A.family, `${PREFIX}%`],
  );
}

async function removeSpecRows(db: pg.Client) {
  await db.query(`DELETE FROM "ListItem" WHERE list_id = $1`, [IDS.list]);
  await db.query(`DELETE FROM "List" WHERE id = $1`, [IDS.list]);
  await removeUiRows(db);
}

test.beforeAll(async () => {
  await withDb(async (db) => {
    await removeSpecRows(db);
    const now = new Date();
    await db.query(
      `INSERT INTO "List" (id, family_id, name, type, created_by, created_at, updated_at)
       VALUES ($1, $2, 'E2E meals groceries', 'grocery', $3, $4, $4)`,
      [IDS.list, A.family, A.parent, now],
    );
    const item = (
      id: string,
      content: string,
      position: number,
      extra: {
        amount?: number;
        unit?: string;
        quantity?: number;
        ingredient?: string;
        recipe?: string;
      },
    ) =>
      db.query(
        `INSERT INTO "ListItem"
           (id, list_id, content, checked, quantity, position, added_by, created_at, updated_at,
            amount, unit, ingredient_id, recipe_id, source, source_key)
         VALUES ($1, $2, $3, false, $4, $5, $6, $7, $7, $8, $9, $10, $11, $12, $13)`,
        [
          id,
          IDS.list,
          content,
          extra.quantity ?? 1,
          position,
          A.parent,
          now,
          extra.amount ?? null,
          extra.unit ?? null,
          extra.ingredient ?? null,
          extra.recipe ?? null,
          extra.recipe ? "recipe" : "manual",
          extra.recipe ? `recipe:${extra.recipe}` : null,
        ],
      );
    await item(IDS.tomLasagna, "Tomatoes", 1, {
      amount: 6,
      ingredient: L.ingredientTomatoes,
      recipe: L.recipeLasagna,
    });
    await item(IDS.manual, "Dish soap", 2, { quantity: 2 });
    await item(IDS.tomSoup, "Tomatoes", 3, {
      amount: 8,
      unit: "pcs",
      ingredient: L.ingredientTomatoes,
      recipe: L.recipeSoup,
    });
  });
});

test.afterAll(async () => {
  await withDb(removeSpecRows);
});

test.beforeEach(async () => {
  await withDb(removeUiRows);
});

test.afterEach(async () => {
  await withDb(removeUiRows);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const todayCard = (page: Page) =>
  page.locator(`[data-testid="meal-day"][data-day="${TODAY_KEY}"]`);
const slotRows = (page: Page, type: string) =>
  todayCard(page).locator(
    `[data-testid="meal-slot"][data-meal-type="${type}"] [data-testid="meal-row"]`,
  );
const dialog = (page: Page) => page.getByRole("dialog");

async function openMeals(page: Page) {
  await page.goto("/dashboard/meals");
  await expect(todayCard(page)).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

/** Undo over confirm (#269): deleting a meal must not open a browser dialog. */
function countDialogs(page: Page) {
  const seen = { count: 0 };
  page.on("dialog", (d) => {
    seen.count += 1;
    void d.dismiss();
  });
  return seen;
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Every visible button/link/select/input inside `scope` is at least 44px tall (and 44px wide for buttons). */
async function expectTargets(scope: Locator) {
  const small = await scope
    .locator("button, a[href], select, input")
    .evaluateAll((els) =>
      els
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => {
          const r = el.getBoundingClientRect();
          const name =
            el.getAttribute("aria-label") ??
            (el.textContent ?? "").trim().slice(0, 40);
          return {
            name,
            tag: el.tagName,
            w: Math.round(r.width),
            h: Math.round(r.height),
          };
        })
        .filter((t) => t.h < 44 || (t.tag === "BUTTON" && t.w < 44)),
    );
  expect(small, "targets smaller than 44px").toEqual([]);
}

async function expectNoSeriousAxe(
  page: Page,
  testInfo: TestInfo,
  label: string,
) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude("next-route-announcer")
    .analyze();
  await testInfo.attach(`axe-${label.replace(/\W+/g, "_")}.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });
  const blocking = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      rule: v.id,
      nodes: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
    }));
  expect(blocking, `serious/critical axe violations on ${label}`).toEqual([]);
}

// ---------------------------------------------------------------------------
// Parent
// ---------------------------------------------------------------------------

test.describe("meals (parent)", () => {
  test.use({ storageState: authFile("parentA") });

  test("add, edit and delete a free-text meal", async ({ page }) => {
    await openMeals(page);
    await expect(slotRows(page, "breakfast")).toHaveCount(0);
    await todayCard(page)
      .getByRole("button", { name: `Add breakfast, ${TODAY_LONG}` })
      .click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByLabel("Recipe (optional)")).toHaveValue("");
    await dialog(page).getByLabel("Recipe name").fill(`${PREFIX} porridge`);
    const posted = page.waitForRequest(
      (r) => r.url().endsWith("/api/meals") && r.method() === "POST",
    );
    await dialog(page).getByRole("button", { name: "Save" }).click();
    // Free text: the request body has no recipe link, exactly as before #252.
    expect((await posted).postDataJSON()).toEqual({
      date: TODAY_KEY,
      meal_type: "breakfast",
      recipe_name: `${PREFIX} porridge`,
    });
    await expect(dialog(page)).toBeHidden();
    await expect(slotRows(page, "breakfast")).toHaveCount(1);
    await expect(slotRows(page, "breakfast")).toContainText(
      `${PREFIX} porridge`,
    );
    await expect(slotRows(page, "breakfast")).toContainText("Breakfast");

    await slotRows(page, "breakfast").click();
    await dialog(page).getByLabel("Recipe name").fill(`${PREFIX} oatmeal`);
    await dialog(page).getByRole("button", { name: "Save" }).click();
    await expect(slotRows(page, "breakfast")).toContainText(
      `${PREFIX} oatmeal`,
    );

    const dialogs = countDialogs(page);
    await slotRows(page, "breakfast").click();
    await dialog(page).getByRole("button", { name: "Delete" }).click();
    await expect(slotRows(page, "breakfast")).toHaveCount(0);
    // Undo puts the meal back (re-created with the same fields).
    const toast = page.getByTestId("undo-toast");
    await expect(toast).toContainText("Deleted");
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(slotRows(page, "breakfast")).toHaveCount(1);
    await slotRows(page, "breakfast").click();
    await dialog(page).getByRole("button", { name: "Delete" }).click();
    await expect(slotRows(page, "breakfast")).toHaveCount(0);
    expect(dialogs.count).toBe(0);
    await expect(
      todayCard(page).getByRole("button", {
        name: `Add breakfast, ${TODAY_LONG}`,
      }),
    ).toBeVisible();
  });

  test("add a meal with a recipe and open the recipe detail", async ({
    page,
  }, testInfo) => {
    await openMeals(page);
    await todayCard(page)
      .getByRole("button", { name: `Add lunch, ${TODAY_LONG}` })
      .click();
    const picker = dialog(page).getByLabel("Recipe (optional)");
    await expect(
      picker.locator("option", { hasText: "Tomato soup" }),
    ).toHaveCount(1);
    await picker.selectOption({ label: "Tomato soup" });
    await expect(dialog(page).getByLabel("Recipe name")).toHaveValue(
      "Tomato soup",
    );
    // Name the meal so the cleanup finds it; the recipe link stays.
    await dialog(page).getByLabel("Recipe name").fill(`${PREFIX} soup night`);
    await expectTargets(dialog(page));
    await expectNoSeriousAxe(page, testInfo, "meal modal with recipe");
    const posted = page.waitForRequest(
      (r) => r.url().endsWith("/api/meals") && r.method() === "POST",
    );
    await dialog(page).getByRole("button", { name: "Save" }).click();
    expect((await posted).postDataJSON()).toMatchObject({
      recipe_id: L.recipeSoup,
      recipe_name: `${PREFIX} soup night`,
    });
    await expect(slotRows(page, "lunch")).toContainText(
      "Lunch · Recipe · 10 min prep",
    );

    await slotRows(page, "lunch").click();
    await dialog(page).getByRole("link", { name: "View recipe" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/meals/recipes/${L.recipeSoup}$`),
    );
    const detail = page.getByTestId("recipe-detail");
    await expect(
      detail.getByRole("heading", { level: 1, name: "Tomato soup" }),
    ).toBeVisible();
    await expect(detail).toContainText("Prep10 min");
    await expect(detail).toContainText("Cook30 min");
    await expect(detail).toContainText("Serves4");
    await expect(page.getByTestId("recipe-ingredients")).toContainText(
      "Tomatoes",
    );
    await expect(page.getByTestId("recipe-ingredients")).toContainText("8");
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousAxe(page, testInfo, "recipe detail");
    await page.getByRole("link", { name: "Meals" }).first().click();
    await expect(todayCard(page)).toBeVisible();
  });

  test("create a recipe inline from the meal modal", async ({ page }) => {
    await openMeals(page);
    await todayCard(page)
      .getByRole("button", { name: `Add snack, ${TODAY_LONG}` })
      .click();
    await dialog(page).getByRole("button", { name: "New recipe" }).click();
    const panel = dialog(page).getByTestId("recipe-quick-create");
    await panel.getByLabel("Recipe name").fill(`${PREFIX} trail mix`);
    await panel.getByLabel("Prep (min)").fill("5");
    await panel.getByLabel("Amount").fill("200");
    await panel.getByLabel("Unit").fill("g");
    await panel
      .getByRole("textbox", { name: "Ingredient", exact: true })
      .fill(`${PREFIX} almonds`);
    await panel.getByRole("button", { name: "Save recipe" }).click();
    await expect(panel).toBeHidden();
    const picker = dialog(page).getByLabel("Recipe (optional)");
    await expect(picker.locator("option:checked")).toHaveText(
      `${PREFIX} trail mix`,
    );
    await expect(dialog(page).getByLabel("Recipe name")).toHaveValue(
      `${PREFIX} trail mix`,
    );
    await dialog(page).getByRole("button", { name: "Save" }).click();
    await expect(slotRows(page, "snack")).toContainText(
      "Snack · Recipe · 5 min prep",
    );
  });

  test("two meals in one slot are both visible, editable and deletable", async ({
    page,
  }, testInfo) => {
    await openMeals(page);
    // The fixture dinners sit 8 weeks back (backfill rehearsal), so this week
    // starts empty: add one dinner, then a second one in the same slot.
    await expect(slotRows(page, "dinner")).toHaveCount(0);
    await todayCard(page)
      .getByRole("button", { name: `Add dinner, ${TODAY_LONG}` })
      .click();
    await dialog(page).getByLabel("Recipe name").fill(`${PREFIX} tacos`);
    await dialog(page).getByRole("button", { name: "Save" }).click();
    await expect(slotRows(page, "dinner")).toHaveCount(1);

    await todayCard(page)
      .getByRole("button", { name: `Add another dinner, ${TODAY_LONG}` })
      .click();
    await expect(dialog(page).getByLabel("Meal")).toHaveValue("dinner");
    await dialog(page).getByLabel("Recipe name").fill(LONG_NAME);
    await dialog(page).getByRole("button", { name: "Save" }).click();
    await expect(slotRows(page, "dinner")).toHaveCount(2);
    await expect(slotRows(page, "dinner").nth(0)).toContainText(
      `${PREFIX} tacos`,
    );
    await expect(slotRows(page, "dinner").nth(1)).toContainText(LONG_NAME);

    // Long text wraps; nothing overflows and every target is still >= 44px.
    await expectNoHorizontalOverflow(page);
    await expectTargets(todayCard(page));
    await expectNoSeriousAxe(page, testInfo, "meals week, two dinners");

    // Edit the second meal only.
    await slotRows(page, "dinner").nth(1).click();
    await expect(dialog(page).getByLabel("Recipe name")).toHaveValue(LONG_NAME);
    await dialog(page).getByLabel("Recipe name").fill(`${PREFIX} salad`);
    await dialog(page).getByRole("button", { name: "Save" }).click();
    await expect(slotRows(page, "dinner").nth(1)).toContainText(
      `${PREFIX} salad`,
    );
    await expect(slotRows(page, "dinner").nth(0)).toContainText(
      `${PREFIX} tacos`,
    );

    // Delete the second meal; the first stays.
    await slotRows(page, "dinner").nth(1).click();
    await dialog(page).getByRole("button", { name: "Delete" }).click();
    await expect(slotRows(page, "dinner")).toHaveCount(1);
    await expect(slotRows(page, "dinner")).toContainText(`${PREFIX} tacos`);
  });

  test("grocery rows show amount, unit, recipe provenance and ingredient groups", async ({
    page,
  }, testInfo) => {
    await page.goto(`/dashboard/lists/${IDS.list}`);
    const group = page.getByRole("group", { name: "Tomatoes, 2 entries" });
    await expect(group).toBeVisible();
    const rows = group.getByRole("checkbox");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("6 · from Veggie lasagna");
    await expect(rows.nth(1)).toContainText("8 pcs · from Tomato soup");
    await expect(
      page.getByRole("checkbox", { name: /Dish soap/ }),
    ).toContainText("× 2");
    // Grouped rows sit together, before the manual row added in between.
    await expect(page.getByTestId("list-item")).toHaveCount(3);
    const order = await page
      .getByTestId("list-item")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-item-id")));
    expect(order).toEqual([IDS.tomLasagna, IDS.tomSoup, IDS.manual]);
    await expectNoHorizontalOverflow(page);
    await expectTargets(page.getByTestId("list-item").first());
    await expectNoSeriousAxe(page, testInfo, "grocery list with provenance");
  });

  test("meal_plan is not offered for a new list", async ({ page }) => {
    await page.goto("/dashboard/lists/create");
    await expect(page.getByRole("button", { name: /Grocery/ })).toBeVisible();
    await expect(page.getByText("Meal plan", { exact: true })).toHaveCount(0);
  });

  test("loading and error states", async ({ page }) => {
    let fail = true;
    await page.route("**/api/meals?*", async (route) => {
      if (fail) {
        await route.fulfill({ status: 500, body: "{}" });
      } else {
        await route.fallback();
      }
    });
    await page.goto("/dashboard/meals");
    await expect(page.getByText("Could not load meals")).toBeVisible();
    fail = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(todayCard(page)).toBeVisible();

    await page.route("**/api/recipes/*", (route) =>
      route.fulfill({ status: 404, body: '{"error":"Recipe not found"}' }),
    );
    await page.goto("/dashboard/meals/recipes/fx_missing_recipe");
    await expect(
      page.getByRole("heading", { level: 1, name: "Recipe not found" }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Child (role matrix: meals pages are parent-only in the UI; recipes R only)
// ---------------------------------------------------------------------------

test.describe("meals (child)", () => {
  test.use({ storageState: authFile("childA") });

  test("is sent away from the meals pages and may read but not create recipes", async ({
    page,
  }) => {
    await page.goto("/dashboard/meals");
    await expect(page).not.toHaveURL(/\/dashboard\/meals/);
    await page.goto(`/dashboard/meals/recipes/${L.recipeSoup}`);
    await expect(page).not.toHaveURL(/\/dashboard\/meals/);

    const read = await browserFetch(page, `/api/recipes/${L.recipeSoup}`);
    expect(read.status).toBe(200);
    const create = await browserSend(page, "POST", "/api/recipes", {
      title: `${PREFIX} child recipe`,
    });
    expect(create.status).toBe(403);
  });
});
