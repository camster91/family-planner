/** Real local writes with deliberately lost responses; never a provider or live household. */
import pg from "pg";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { authFile } from "./support/env";
import { expect, test } from "./support/test";

const family = "fx_family_a";
const parent = "fx_user_a_parent";
const list = "fx_review_recovery_list";
const item = "fx_review_recovery_item";
const meal = "fx_review_recovery_meal";
const profile = "fx_review_recovery_profile";
const itemName = "Review recovery milk";
const mealName = "Review recovery dinner";
const profileName = "Review preschool profile";

async function withDb<T>(work: (db: pg.Client) => Promise<T>) {
  assertFixtureTargetAllowed(process.env);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await work(db);
  } finally {
    await db.end();
  }
}
async function cleanup(db: pg.Client) {
  await db.query('DELETE FROM "List" WHERE id=$1', [list]);
  await db.query(
    'DELETE FROM "FamilyMeal" WHERE family_id=$1 AND recipe_name=$2',
    [family, mealName],
  );
  await db.query('DELETE FROM "HouseholdMember" WHERE id=$1', [profile]);
}

test.use({ storageState: authFile("parentA") });
test.beforeEach(async ({}, info) => {
  test.skip(
    !["phone-390x844", "desktop-1366x768"].includes(info.project.name),
    "two representative layouts",
  );
  await withDb(async (db) => {
    await cleanup(db);
    await db.query(
      'INSERT INTO "List" (id,family_id,name,type,created_by) VALUES ($1,$2,$3,$4,$5)',
      [list, family, "Review recovery groceries", "grocery", parent],
    );
    await db.query(
      'INSERT INTO "ListItem" (id,list_id,content,added_by) VALUES ($1,$2,$3,$4)',
      [item, list, itemName, parent],
    );
    await db.query(
      'INSERT INTO "FamilyMeal" (id,family_id,date,meal_type,recipe_name,created_by) VALUES ($1,$2,$3,$4,$5,$6)',
      [meal, family, "2026-01-05", "dinner", mealName, parent],
    );
    await db.query(
      'INSERT INTO "HouseholdMember" (id,family_id,name,role,age) VALUES ($1,$2,$3,$4,$5)',
      [profile, family, profileName, "child", 3],
    );
  });
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  await withDb(cleanup);
});

test("list deletion committed before response loss still offers a working Undo", async ({
  page,
}, info) => {
  await page.goto(`/dashboard/lists/${list}`);
  await page.route(
    (url) => url.pathname === `/api/lists/items/${item}`,
    async (route) => {
      if (route.request().method() !== "DELETE") return route.continue();
      const response = await route.fetch({ maxRetries: 0, maxRedirects: 0 });
      expect(response.status()).toBe(200);
      await route.abort("failed");
    },
  );
  await page
    .getByRole("button", { name: `Delete ${itemName}`, exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeVisible();
  expect(
    await withDb(
      async (db) =>
        (await db.query('SELECT id FROM "ListItem" WHERE id=$1', [item]))
          .rowCount,
    ),
  ).toBe(0);
  await expect(page.locator(`[data-item-id="${item}"]`)).toHaveCount(0);
  await info.attach("confirmed-delete-after-lost-response", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText(itemName, { exact: true })).toBeVisible();
  expect(
    await withDb(
      async (db) =>
        (
          await db.query(
            'SELECT id FROM "ListItem" WHERE list_id=$1 AND content=$2',
            [list, itemName],
          )
        ).rowCount,
    ),
  ).toBe(1);
});

test("meal deletion committed before response loss still offers a working Undo", async ({
  page,
}, info) => {
  await page.goto("/dashboard/meals?start=2026-01-05");
  await page.getByTestId("meal-row").filter({ hasText: mealName }).click();
  await page.route(
    (url) => url.pathname === `/api/meals/${meal}`,
    async (route) => {
      if (route.request().method() !== "DELETE") return route.continue();
      const response = await route.fetch({ maxRetries: 0, maxRedirects: 0 });
      expect(response.status()).toBe(200);
      await route.abort("failed");
    },
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeVisible();
  expect(
    await withDb(
      async (db) =>
        (await db.query('SELECT id FROM "FamilyMeal" WHERE id=$1', [meal]))
          .rowCount,
    ),
  ).toBe(0);
  await info.attach("confirmed-meal-delete-after-lost-response", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByTestId("meal-row").filter({ hasText: mealName }),
  ).toBeVisible();
  expect(
    await withDb(
      async (db) =>
        (
          await db.query(
            'SELECT id FROM "FamilyMeal" WHERE family_id=$1 AND recipe_name=$2',
            [family, mealName],
          )
        ).rowCount,
    ),
  ).toBe(1);
});

test("saved email-free profiles are visible without reopening the add dialog", async ({
  page,
}, info) => {
  test.skip(
    process.env.HOUSEHOLD_PROFILE_SETUP_ENABLED !== "1",
    "profile setup gate must be enabled only on the local test server",
  );
  await page.goto("/dashboard/family");
  const main = page.getByRole("main");
  await expect(main.getByText(profileName, { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(main.getByText(profileName, { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await info.attach("visible-profile-roster", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});
