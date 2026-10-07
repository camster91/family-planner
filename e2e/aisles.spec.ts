/**
 * Grocery lists sorted by store section (#273).
 *
 * A spec-owned Family A grocery list (`fx_e2e_aisles_*`, inserted afresh
 * before each test and deleted after the file, so the dashboard Shopping
 * card, the fridge board and every baseline are unchanged) with free-text rows named "E2E aisles …"
 * and two recipe rows for the fixture ingredient Tomatoes. Covers: text
 * section headers in store order with the ingredient group and provenance
 * inside Produce; "Move to…" through the sheet, persisted as a household
 * override; the per-list switch (persisted, category order when off); an
 * offline tick stays in its section and syncs, and the trip records its
 * section; the child moves an item but has no switch (403 from the API); a
 * Family B parent cannot move a Family A row. Overrides named "e2e aisles …"
 * and the ingredient's section are cleared before and after. The fixture
 * guard refuses production-like databases.
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
import { goOffline, goOnline } from "./support/network";
import { browserSend, expect, test } from "./support/test";

const A = FIXTURE_IDS.familyA;
const L = FIXTURE_LEGACY_MEAL_IDS.familyA;
/** A data-path journey: two representative sizes are enough. */
const PROJECTS = ["phone-390x844", "desktop-1366x768"];

const IDS = {
  list: "fx_e2e_aisles_list",
  bananas: "fx_e2e_aisles_bananas",
  soap: "fx_e2e_aisles_soap",
  milk: "fx_e2e_aisles_milk",
  widget: "fx_e2e_aisles_widget",
  tomLasagna: "fx_e2e_aisles_tom_lasagna",
  tomSoup: "fx_e2e_aisles_tom_soup",
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

async function removeSpecRows(db: pg.Client) {
  // Trips cascade with the list; items too.
  await db.query(`DELETE FROM "List" WHERE id = $1`, [IDS.list]);
  await db.query(
    `DELETE FROM "GrocerySectionPreference" WHERE family_id = $1 AND name_key LIKE 'e2e aisles%'`,
    [A.family],
  );
  await db.query(`UPDATE "Ingredient" SET section = NULL WHERE id = $1`, [
    L.ingredientTomatoes,
  ]);
}

async function insertSpecRows(db: pg.Client) {
  const now = new Date();
  await db.query(
    `INSERT INTO "List" (id, family_id, name, type, created_by, created_at, updated_at)
     VALUES ($1, $2, 'E2E aisles groceries', 'grocery', $3, $4, $4)`,
    [IDS.list, A.family, A.parent, now],
  );
  const item = (
    id: string,
    content: string,
    position: number,
    recipe?: string,
  ) =>
    db.query(
      `INSERT INTO "ListItem"
         (id, list_id, content, checked, quantity, position, added_by, created_at, updated_at,
          ingredient_id, recipe_id, source, source_key)
       VALUES ($1, $2, $3, false, 1, $4, $5, $6, $6, $7, $8, $9, $10)`,
      [
        id,
        IDS.list,
        content,
        position,
        A.parent,
        now,
        recipe ? L.ingredientTomatoes : null,
        recipe ?? null,
        recipe ? "recipe" : "manual",
        recipe ? `recipe:${recipe}` : null,
      ],
    );
  // Added in an order unlike the store's, so grouping is visible.
  await item(IDS.soap, "E2E aisles dish soap", 1);
  await item(IDS.tomLasagna, "Tomatoes", 2, L.recipeLasagna);
  await item(IDS.milk, "E2E aisles milk", 3);
  await item(IDS.widget, "E2E aisles zzyzx widget", 4);
  await item(IDS.bananas, "E2E aisles bananas", 5);
  await item(IDS.tomSoup, "Tomatoes", 6, L.recipeSoup);
}

function onlyOnSomeProjects(testInfo: TestInfo) {
  test.skip(
    !PROJECTS.includes(testInfo.project.name),
    "store-section journey runs on two representative projects",
  );
}

test.afterAll(async () => {
  await withDb(removeSpecRows);
});

test.beforeEach(async ({}, testInfo) => {
  onlyOnSomeProjects(testInfo);
  // Each test starts from the inserted state: sorting on, no overrides.
  await withDb(async (db) => {
    await removeSpecRows(db);
    await insertSpecRows(db);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sectionNames = (page: Page) =>
  page
    .getByTestId("store-section")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
const row = (page: Page, id: string) =>
  page.locator(`[data-testid="list-item"][data-item-id="${id}"]`);

async function openList(page: Page) {
  await page.goto(`/dashboard/lists/${IDS.list}`);
  await expect(page.getByTestId("section-sort")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Every visible button inside `scope` is at least 44×44. */
async function expectTargets(scope: Locator) {
  const small = await scope.locator("button").evaluateAll((els) =>
    els
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          name:
            el.getAttribute("aria-label") ??
            (el.textContent ?? "").trim().slice(0, 40),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      })
      .filter((t) => t.h < 44 || t.w < 44),
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

test.describe("store sections: Family A parent", () => {
  test.use({ storageState: authFile("parentA") });

  test("rows are grouped under text headers in store order, with ingredient groups inside", async ({
    page,
  }, testInfo) => {
    await openList(page);
    expect(await sectionNames(page)).toEqual([
      "Produce",
      "Dairy & eggs",
      "Household",
      "Other",
    ]);
    const produce = page.getByRole("region", { name: "Produce" });
    await expect(produce.getByText("Produce", { exact: true })).toBeVisible();
    const group = produce.getByRole("group", { name: "Tomatoes, 2 entries" });
    await expect(group.getByRole("checkbox").nth(0)).toContainText(
      "from Veggie lasagna",
    );
    await expect(group.getByRole("checkbox").nth(1)).toContainText(
      "from Tomato soup",
    );
    await expect(
      produce.getByRole("checkbox", { name: /E2E aisles bananas/ }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Other" })
        .getByRole("checkbox", { name: /zzyzx widget/ }),
    ).toBeVisible();
    await expectTargets(row(page, IDS.milk));
    await expectTargets(page.getByTestId("section-sort"));
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousAxe(page, testInfo, "grocery list by store section");
  });

  test("Move to… sets the household section, which a reload keeps", async ({
    page,
  }, testInfo) => {
    await openList(page);
    await page
      .getByRole("button", {
        name: "Move E2E aisles zzyzx widget to another section",
      })
      .click();
    const sheet = page.getByRole("dialog", {
      name: "Move “E2E aisles zzyzx widget”",
    });
    await expect(sheet).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: /Other/, pressed: true }),
    ).toContainText("Current");
    await expectTargets(sheet);
    await expectNoSeriousAxe(page, testInfo, "move to section sheet");

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/lists/items/section") &&
          r.request().method() === "PATCH",
      ),
      sheet.getByRole("button", { name: "Pantry" }).click(),
    ]);
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({
      nameKey: "e2e aisles zzyzx widget",
      override: "pantry",
    });
    await expect(sheet).toBeHidden();
    await expect(
      page
        .getByRole("region", { name: "Pantry" })
        .getByRole("checkbox", { name: /zzyzx widget/ }),
    ).toBeVisible();

    await page.reload();
    expect(await sectionNames(page)).toEqual([
      "Produce",
      "Dairy & eggs",
      "Pantry",
      "Household",
    ]);
    // The choice can be undone from the same sheet.
    await page
      .getByRole("button", {
        name: "Move E2E aisles zzyzx widget to another section",
      })
      .click();
    await page
      .getByRole("button", { name: "Use the automatic section" })
      .click();
    await expect(
      page
        .getByRole("region", { name: "Other" })
        .getByRole("checkbox", { name: /zzyzx widget/ }),
    ).toBeVisible();
  });

  test("the switch turns sorting off for the list, and back on", async ({
    page,
  }) => {
    await openList(page);
    const toggle = page.getByRole("switch", { name: /Sort by store section/ });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("store-section")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Move / })).toHaveCount(0);

    // Persisted per list: a reload keeps the list's own order.
    await page.reload();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    const order = await page
      .getByTestId("list-item")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-item-id")));
    expect(order).toEqual([
      IDS.soap,
      IDS.tomLasagna,
      IDS.tomSoup,
      IDS.milk,
      IDS.widget,
      IDS.bananas,
    ]);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(await sectionNames(page)).toHaveLength(4);
  });

  test("an offline tick stays in its section, syncs, and records the trip", async ({
    page,
  }) => {
    await openList(page);
    const milk = row(page, IDS.milk);
    await goOffline(page);
    await expect(page.getByTestId("list-offline-detail")).toBeVisible();
    await milk.getByRole("checkbox").click();
    await expect(milk).toHaveAttribute("data-sync-state", "pending");
    const dairy = page.getByRole("region", { name: "Dairy & eggs" });
    await expect(
      dairy.getByRole("checkbox", { name: /E2E aisles milk/ }),
    ).toHaveAttribute("aria-checked", "true");
    // Moving needs a connection and says so.
    await row(page, IDS.bananas)
      .getByRole("button", { name: /^Move / })
      .click();
    await page.getByRole("button", { name: "Bakery" }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "You’re offline",
    );
    await page.getByRole("button", { name: "Close" }).click();

    await goOnline(page);
    await expect(milk).toHaveAttribute("data-sync-state", "synced", {
      timeout: 20_000,
    });
    await expect(
      dairy.getByRole("checkbox", { name: /E2E aisles milk/ }),
    ).toHaveAttribute("aria-checked", "true");
    const trips = await withDb(
      async (db) =>
        (
          await db.query(
            `SELECT sections FROM "GroceryShoppingSession" WHERE list_id = $1`,
            [IDS.list],
          )
        ).rows,
    );
    expect(trips).toEqual([{ sections: ["dairy_eggs"] }]);
  });
});

// ---------------------------------------------------------------------------
// Child and the other household
// ---------------------------------------------------------------------------

test.describe("store sections: Family A child", () => {
  test.use({ storageState: authFile("childA") });

  test("sees sections and may move an item, but cannot switch sorting", async ({
    page,
  }, testInfo) => {
    await openList(page);
    await expect(page.getByRole("switch")).toHaveCount(0);
    await expect(
      page.getByText("Sort by store section: On", { exact: true }),
    ).toBeVisible();
    await row(page, IDS.bananas)
      .getByRole("button", { name: /^Move / })
      .click();
    await page.getByRole("button", { name: "Snacks & drinks" }).click();
    await expect(
      page
        .getByRole("region", { name: "Snacks & drinks" })
        .getByRole("checkbox", { name: /E2E aisles bananas/ }),
    ).toBeVisible();
    const res = await browserSend(page, "PATCH", "/api/lists/section-sort", {
      listId: IDS.list,
      sortBySection: false,
    });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe("SECTION_SORT_FORBIDDEN");
    await expectNoSeriousAxe(
      page,
      testInfo,
      "grocery list by store section (child)",
    );
  });
});

test.describe("store sections: Family B parent", () => {
  test.use({ storageState: authFile("parentB") });

  test("cannot move a Family A row or switch a Family A list", async ({
    page,
  }) => {
    await page.goto("/dashboard/lists");
    const move = await browserSend(page, "PATCH", "/api/lists/items/section", {
      itemId: IDS.bananas,
      section: "household",
    });
    expect(move.status).toBe(404);
    expect(move.body).not.toContain("aisles");
    const sort = await browserSend(page, "PATCH", "/api/lists/section-sort", {
      listId: IDS.list,
      sortBySection: false,
    });
    expect(sort.status).toBe(404);
    const prefs = await withDb(
      async (db) =>
        (
          await db.query(
            `SELECT count(*)::int AS n FROM "GrocerySectionPreference" WHERE name_key LIKE 'e2e aisles%'`,
          )
        ).rows[0].n,
    );
    expect(prefs).toBe(0);
  });
});
