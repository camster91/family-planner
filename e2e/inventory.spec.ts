/**
 * Food inventory (#263): /dashboard/inventory journey.
 *
 * - Parent (Family A): items grouped by fridge / freezer / pantry; "Use soon"
 *   with written labels ("Expired yesterday", "Use by tomorrow"); "What can I
 *   cook" ranks the fixture recipes (Tomato soup fully in stock, Veggie
 *   lasagna missing Lasagna sheets) and "Add 1 missing to groceries" adds only
 *   the missing ingredient through `from-recipe`; add, edit and remove an item
 *   in the dialog; long text; targets >= 44px; no horizontal overflow; axe
 *   (serious/critical) on the page and the dialog.
 * - Child (Family A): reads the page with no write controls; the API refuses
 *   a write (403).
 * - Family B parent: sees only its own item; a Family A item id is 404.
 *
 * The `inventory` feature is off by default, so the spec turns it on for the
 * two fixture households before the file and removes the key afterwards
 * (the seeded blob has no `inventory` key). Every row is spec-owned
 * (`fx_e2e_inventory_*`, or named "E2E inventory …" when the UI creates it)
 * and deleted before and after, together with the grocery rows and
 * idempotency records the add created, so seeded data and the visual
 * baselines are unchanged outside this file. Runs at 390×844, 800×1280 and
 * 1366×768. The fixture guard refuses production-like databases.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page, TestInfo } from "@playwright/test";
import pg from "pg";
import {
  FIXTURE_IDS,
  FIXTURE_LEGACY_MEAL_IDS,
} from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { E2E_ANCHOR, authFile } from "./support/env";
import { browserFetch, browserSend, expect, test } from "./support/test";

const A = FIXTURE_IDS.familyA;
const B = FIXTURE_IDS.familyB;
const L = FIXTURE_LEGACY_MEAL_IDS.familyA;
const PREFIX = "E2E inventory";
const PROJECTS = [
  "phone-390x844",
  "tablet-portrait-800x1280",
  "desktop-1366x768",
];
const LONG_NAME = `${PREFIX} ${"extra-mature farmhouse cheddar with caramelised onion chutney ".repeat(3).trim()}`;

const IDS = {
  tomatoes: "fx_e2e_inventory_a_tomatoes",
  milk: "fx_e2e_inventory_a_milk",
  peas: "fx_e2e_inventory_a_peas",
  long: "fx_e2e_inventory_a_long",
  canaryB: "fx_e2e_inventory_b_canary",
};
const CANARY_B = `${PREFIX} B canary`;

function onlyOnSomeProjects(testInfo: TestInfo) {
  test.skip(
    !PROJECTS.includes(testInfo.project.name),
    "inventory journey runs at 390x844, 800x1280 and 1366x768",
  );
}

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

/** The anchor's UTC calendar day plus `n` days (the E2E server's "today"). */
function anchorDay(n: number): Date {
  return new Date(
    Date.UTC(
      E2E_ANCHOR.getUTCFullYear(),
      E2E_ANCHOR.getUTCMonth(),
      E2E_ANCHOR.getUTCDate() + n,
    ),
  );
}

async function removeGroceryAdds(db: pg.Client) {
  await db.query(
    `DELETE FROM "ListItem" WHERE source_key = $1 AND source_request_id IS NOT NULL`,
    [`recipe:${L.recipeLasagna}`],
  );
  await db.query(
    `DELETE FROM "IdempotencyRecord" WHERE family_id = $1 AND action = 'grocery.add-from-recipe'`,
    [A.family],
  );
}

async function removeSpecRows(db: pg.Client) {
  await db.query(
    `DELETE FROM "InventoryItem" WHERE id LIKE 'fx_e2e_inventory_%' OR (family_id IN ($1, $2) AND name LIKE $3)`,
    [A.family, B.family, `${PREFIX}%`],
  );
  await removeGroceryAdds(db);
}

async function setInventoryFeature(db: pg.Client, on: boolean) {
  const sql = on
    ? `UPDATE "Family" SET features = COALESCE(features, '{}'::jsonb) || '{"inventory":true}'::jsonb WHERE id IN ($1, $2)`
    : `UPDATE "Family" SET features = features - 'inventory' WHERE id IN ($1, $2) AND features IS NOT NULL`;
  await db.query(sql, [A.family, B.family]);
}

test.beforeAll(async () => {
  await withDb(async (db) => {
    await removeSpecRows(db);
    await setInventoryFeature(db, true);
    const insert = (
      id: string,
      family: string,
      addedBy: string,
      name: string,
      location: string,
      expires: Date | null,
      extra: { ingredient?: string; amount?: number; unit?: string } = {},
    ) =>
      db.query(
        `INSERT INTO "InventoryItem" (id, family_id, name, ingredient_id, amount, unit, location, expires_on, added_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          family,
          name,
          extra.ingredient ?? null,
          extra.amount ?? null,
          extra.unit ?? null,
          location,
          expires ? expires.toISOString().slice(0, 10) : null,
          addedBy,
        ],
      );
    await insert(
      IDS.tomatoes,
      A.family,
      A.parent,
      "Tomatoes",
      "fridge",
      anchorDay(1),
      {
        ingredient: L.ingredientTomatoes,
        amount: 6,
        unit: "pcs",
      },
    );
    await insert(
      IDS.milk,
      A.family,
      A.parent,
      "Milk",
      "fridge",
      anchorDay(-1),
      {
        amount: 1,
        unit: "L",
      },
    );
    await insert(IDS.peas, A.family, A.teen, "Frozen peas", "freezer", null);
    await insert(
      IDS.long,
      A.family,
      A.parent,
      LONG_NAME,
      "pantry",
      anchorDay(30),
    );
    await insert(
      IDS.canaryB,
      B.family,
      B.parent,
      CANARY_B,
      "fridge",
      anchorDay(2),
    );
  });
});

test.afterAll(async () => {
  await withDb(async (db) => {
    await removeSpecRows(db);
    await setInventoryFeature(db, false);
  });
});

test.beforeEach(async ({}, testInfo) => {
  onlyOnSomeProjects(testInfo);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const region = (page: Page, name: RegExp) => page.getByRole("region", { name });
const itemRow = (page: Page, id: string) =>
  page.locator(`[data-testid="inventory-item"][data-item-id="${id}"]`);
const dialog = (page: Page) => page.getByRole("dialog");

async function openInventory(page: Page) {
  await page.goto("/dashboard/inventory");
  await expect(
    page.getByRole("heading", { level: 1, name: "Food inventory" }),
  ).toBeVisible();
  await expect(itemRow(page, IDS.tomatoes)).toBeVisible();
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

/** Touch path (#263 review): the user menu links to the inventory for every role. */
async function tapToInventory(page: Page, testInfo: TestInfo) {
  test.skip(
    testInfo.project.name !== "phone-390x844",
    "touch navigation is checked on the phone project",
  );
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "User menu" }).tap();
  const link = page.getByRole("link", { name: "Food inventory" });
  const box = await link.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await link.tap();
  await expect(page).toHaveURL(/\/dashboard\/inventory$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Food inventory" }),
  ).toBeVisible();
}

// ---------------------------------------------------------------------------
// Parent
// ---------------------------------------------------------------------------

test.describe("inventory (Family A parent)", () => {
  test.use({ storageState: authFile("parentA") });

  test.afterEach(async () => {
    await withDb(async (db) => {
      await db.query(
        `DELETE FROM "InventoryItem" WHERE family_id = $1 AND name LIKE $2 AND id NOT LIKE 'fx_e2e_inventory_%'`,
        [A.family, `${PREFIX}%`],
      );
      await removeGroceryAdds(db);
    });
  });

  test("reaches the inventory by tapping through the user menu", async ({
    page,
  }, testInfo) => {
    await tapToInventory(page, testInfo);
  });

  test("groups items, labels expiry in words, and passes layout and axe checks", async ({
    page,
  }, testInfo) => {
    await openInventory(page);

    const fridge = region(page, /^Fridge/);
    await expect(fridge.getByTestId("inventory-item")).toHaveCount(2);
    // Soonest first; the status is words, not colour alone.
    await expect(fridge.getByTestId("inventory-item").first()).toContainText(
      "Milk",
    );
    await expect(itemRow(page, IDS.milk)).toContainText("Expired yesterday");
    await expect(itemRow(page, IDS.milk)).toContainText("1 L");
    await expect(itemRow(page, IDS.tomatoes)).toContainText("Use by tomorrow");
    await expect(itemRow(page, IDS.tomatoes)).toContainText("6 pcs");
    await expect(itemRow(page, IDS.peas)).toContainText("No date");
    await expect(
      region(page, /^Freezer/).getByTestId("inventory-item"),
    ).toHaveCount(1);
    await expect(itemRow(page, IDS.long)).toContainText("Use in 30 days");
    await expect(page.getByText(CANARY_B)).toHaveCount(0);

    const soon = page.getByTestId("use-soon");
    await expect(soon.getByTestId("use-soon-item")).toHaveCount(2);
    await expect(soon.getByTestId("use-soon-item").nth(0)).toContainText(
      "Milk",
    );
    await expect(soon.getByTestId("use-soon-item").nth(0)).toContainText(
      "Expired yesterday",
    );
    await expect(soon.getByTestId("use-soon-item").nth(1)).toContainText(
      "Use by tomorrow",
    );

    await expectNoHorizontalOverflow(page);
    await expectTargets(page.locator("main"));
    await expectNoSeriousAxe(page, testInfo, "inventory page");

    await itemRow(page, IDS.tomatoes).click();
    await expect(dialog(page)).toBeVisible();
    await expectTargets(dialog(page));
    await expectNoSeriousAxe(page, testInfo, "inventory dialog");
    await dialog(page).getByRole("button", { name: "Close" }).click();
    await expect(dialog(page)).toBeHidden();
  });

  test("what can I cook ranks recipes and adds only the missing ingredient to groceries", async ({
    page,
  }) => {
    await openInventory(page);
    const suggestions = page.getByTestId("cook-suggestion");
    await expect(suggestions.first()).toBeVisible();
    // Tomato soup is fully in stock; Veggie lasagna misses its sheets; the
    // stir-fry has nothing in stock and is left out.
    await expect(suggestions).toHaveCount(2);
    await expect(suggestions.nth(0)).toContainText("Tomato soup");
    await expect(suggestions.nth(0)).toContainText("You have all 1 ingredient");
    const lasagna = page.locator(
      `[data-testid="cook-suggestion"][data-recipe-id="${L.recipeLasagna}"]`,
    );
    await expect(lasagna).toContainText("You have 1 of 2 ingredients");
    await expect(lasagna.getByTestId("cook-missing")).toContainText(
      "Lasagna sheets",
    );
    await expect(page.getByText("Tofu stir-fry")).toHaveCount(0);

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/lists/items/from-recipe") &&
          r.request().method() === "POST",
      ),
      lasagna
        .getByRole("button", { name: "Add 1 missing to groceries" })
        .click(),
    ]);
    expect(response.status()).toBe(201);
    expect(JSON.parse(response.request().postData() ?? "{}")).toEqual({
      recipeId: L.recipeLasagna,
      ingredientIds: [L.ingredientLasagnaSheets],
    });
    await expect(lasagna.getByRole("status")).toContainText("Added 1 item to");

    const rows = await withDb(async (db) =>
      db.query(
        `SELECT ingredient_id FROM "ListItem" WHERE source_key = $1 AND source_request_id IS NOT NULL`,
        [`recipe:${L.recipeLasagna}`],
      ),
    );
    expect(rows.rows.map((r) => r.ingredient_id)).toEqual([
      L.ingredientLasagnaSheets,
    ]);
  });

  test("add, edit and remove an item", async ({ page }) => {
    await openInventory(page);
    await page.getByRole("button", { name: "Add item" }).first().click();
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByLabel("Name").fill(`${PREFIX} yogurt`);
    await dialog(page).getByLabel("Freezer").check();
    await dialog(page)
      .getByLabel(/Amount/)
      .fill("2");
    await dialog(page).getByLabel(/Unit/).fill("tubs");
    await dialog(page)
      .getByLabel(/Use by/)
      .fill("2026-01-07");
    const posted = page.waitForRequest(
      (r) => r.url().includes("/api/inventory?today=") && r.method() === "POST",
    );
    await dialog(page).getByRole("button", { name: "Save" }).click();
    expect((await posted).postDataJSON()).toEqual({
      name: `${PREFIX} yogurt`,
      location: "freezer",
      amount: 2,
      unit: "tubs",
      expires_on: "2026-01-07",
    });
    await expect(dialog(page)).toBeHidden();
    await expect(page.getByRole("status").first()).toContainText(
      `Added ${PREFIX} yogurt.`,
    );
    const freezer = region(page, /^Freezer/);
    const yogurt = freezer
      .getByTestId("inventory-item")
      .filter({ hasText: `${PREFIX} yogurt` });
    await expect(yogurt).toContainText("Use in 2 days");
    await expect(yogurt).toContainText("2 tubs");

    await yogurt.click();
    await dialog(page).getByLabel("Pantry").check();
    await dialog(page).getByRole("button", { name: "Clear date" }).click();
    await dialog(page).getByRole("button", { name: "Save" }).click();
    await expect(dialog(page)).toBeHidden();
    const moved = region(page, /^Pantry/)
      .getByTestId("inventory-item")
      .filter({ hasText: `${PREFIX} yogurt` });
    await expect(moved).toContainText("No date");
    await expect(
      freezer
        .getByTestId("inventory-item")
        .filter({ hasText: `${PREFIX} yogurt` }),
    ).toHaveCount(0);

    await moved.click();
    page.once("dialog", (d) => void d.accept());
    await dialog(page).getByRole("button", { name: "Remove" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(
      page
        .getByTestId("inventory-item")
        .filter({ hasText: `${PREFIX} yogurt` }),
    ).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Child
// ---------------------------------------------------------------------------

test.describe("inventory (Family A child)", () => {
  test.use({ storageState: authFile("childA") });

  test("reaches the inventory by tapping through the user menu", async ({
    page,
  }, testInfo) => {
    await tapToInventory(page, testInfo);
  });

  test("reads the inventory without write controls; the API refuses writes", async ({
    page,
  }, testInfo) => {
    await openInventory(page);
    await expect(itemRow(page, IDS.milk)).toContainText("Expired yesterday");
    await expect(page.getByRole("button", { name: "Add item" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
    await expect(page.getByTestId("use-soon-item")).toHaveCount(2);
    const res = await browserSend(page, "POST", "/api/inventory", {
      name: `${PREFIX} child`,
    });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe("INVENTORY_WRITE_FORBIDDEN");
    const del = await browserSend(page, "DELETE", `/api/inventory/${IDS.milk}`);
    expect(del.status).toBe(403);
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousAxe(page, testInfo, "inventory child");
  });
});

// ---------------------------------------------------------------------------
// Family B
// ---------------------------------------------------------------------------

test.describe("inventory (Family B parent)", () => {
  test.use({ storageState: authFile("parentB") });

  test("sees only its own household; a Family A item id is not found", async ({
    page,
  }) => {
    await page.goto("/dashboard/inventory");
    await expect(page.getByText(CANARY_B)).toHaveCount(2); // fridge row + use soon
    await expect(page.getByText("Milk")).toHaveCount(0);
    await expect(page.getByText("Tomatoes")).toHaveCount(0);
    const list = await browserFetch(page, "/api/inventory");
    expect(list.status).toBe(200);
    expect(
      JSON.parse(list.body).items.map((i: { id: string }) => i.id),
    ).toEqual([IDS.canaryB]);
    const foreign = await browserFetch(page, `/api/inventory/${IDS.milk}`);
    const missing = await browserFetch(page, "/api/inventory/fx_e2e_nope");
    expect(foreign.status).toBe(404);
    expect(foreign.body).toBe(missing.body);
    const patch = await browserSend(
      page,
      "PATCH",
      `/api/inventory/${IDS.milk}`,
      {
        name: "mine",
      },
    );
    expect(patch.status).toBe(404);
  });
});
