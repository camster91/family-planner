/**
 * Recipe → grocery add (ADR-0007 child D, #253): add → replay → undo.
 *
 * Inserts one labelled Family A lunch today (`fx_e2e_groceries_meal`) linked
 * to the fixture recipe "Tomato soup" (4 servings, 8 tomatoes) for 8 people,
 * and deletes it, the rows it added and its idempotency records afterwards,
 * so seeded data and baselines are untouched. The same guard as global-setup
 * refuses production-like databases.
 */
import type { TestInfo } from "@playwright/test";
import pg from "pg";
import {
  FIXTURE_IDS,
  FIXTURE_LEGACY_MEAL_IDS,
} from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { E2E_ANCHOR, authFile } from "./support/env";
import { browserFetch, expect, test } from "./support/test";

const A = FIXTURE_IDS.familyA;
const MEAL_ID = "fx_e2e_groceries_meal";
const RECIPE_ID = FIXTURE_LEGACY_MEAL_IDS.familyA.recipeSoup;
const TOMATOES = FIXTURE_LEGACY_MEAL_IDS.familyA.ingredientTomatoes;
/** A data-path journey: two representative sizes are enough. */
const PROJECTS = ["phone-390x844", "desktop-1366x768"];

function onlyOnSomeProjects(testInfo: TestInfo) {
  test.skip(
    !PROJECTS.includes(testInfo.project.name),
    "recipe → grocery journey runs on two representative projects",
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

async function removeSpecRows(db: pg.Client) {
  await db.query(`DELETE FROM "ListItem" WHERE source_key = $1`, [
    `meal:${MEAL_ID}`,
  ]);
  await db.query(
    `DELETE FROM "IdempotencyRecord" WHERE family_id = $1 AND action = 'grocery.add-from-recipe'`,
    [A.family],
  );
  await db.query(`DELETE FROM "FamilyMeal" WHERE id = $1`, [MEAL_ID]);
}

type Item = {
  id: string;
  content: string;
  amount: number | null;
  ingredient_id: string | null;
  source: string;
};

async function tomatoRows(page: import("@playwright/test").Page) {
  const { status, body } = await browserFetch(
    page,
    `/api/lists/items?listId=${A.groceryList}`,
  );
  expect(status, body).toBe(200);
  return (JSON.parse(body).items as Item[]).filter(
    (i) => i.ingredient_id === TOMATOES && i.source === "recipe",
  );
}

test.describe("recipe ingredients to groceries: Family A parent", () => {
  test.use({ storageState: authFile("parentA") });

  test.beforeEach(async ({}, testInfo) => {
    onlyOnSomeProjects(testInfo);
    await withDb(async (db) => {
      await removeSpecRows(db);
      const today = new Date(
        Date.UTC(
          E2E_ANCHOR.getUTCFullYear(),
          E2E_ANCHOR.getUTCMonth(),
          E2E_ANCHOR.getUTCDate(),
        ),
      );
      await db.query(
        `INSERT INTO "FamilyMeal" (id, family_id, date, meal_type, recipe_name, recipe_id, servings, created_by)
         VALUES ($1, $2, $3, 'lunch', 'Tomato soup', $4, 8, $5)`,
        [MEAL_ID, A.family, today, RECIPE_ID, A.parent],
      );
    });
  });

  test.afterEach(async ({}, testInfo) => {
    if (!PROJECTS.includes(testInfo.project.name)) return;
    await withDb(removeSpecRows);
  });

  test("add from the meal, a retry with the same key replays, undo removes the rows", async ({
    page,
  }) => {
    await page.goto("/dashboard/meals");
    // The canonical lunch is disclosed through its dated day card; dinner stays
    // visible initially. Exercise that user path without changing fixture data.
    const todayCard = page.locator(
      `[data-testid="meal-day"][data-day="${E2E_ANCHOR.toISOString().slice(0, 10)}"]`,
    );
    const otherMeals = todayCard.getByRole("button", { name: /^Other meals/ });
    await expect(otherMeals).toHaveAttribute("aria-expanded", "false");
    await otherMeals.click();
    await expect(otherMeals).toHaveAttribute("aria-expanded", "true");
    // #252: each planned meal is a button row that opens the edit dialog.
    await page
      .locator(`[data-testid="meal-row"][data-meal-id="${MEAL_ID}"]`)
      .click();
    const dialogButton = page.getByRole("button", {
      name: "Add ingredients to groceries",
    });
    await expect(dialogButton).toBeVisible();

    let mutations = 0;
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname.startsWith("/api/lists") &&
        !["GET", "HEAD"].includes(request.method())
      ) {
        mutations++;
      }
    });
    const review = page.getByRole("dialog", {
      name: "Review grocery ingredients",
    });
    const confirm = review.getByRole("button", {
      name: "Add selected ingredients",
    });
    const openReview = async () => {
      const [loaded] = await Promise.all([
        page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname ===
              "/api/lists/items/from-recipe/review" &&
            r.request().method() === "GET",
        ),
        dialogButton.click(),
      ]);
      expect(loaded.status()).toBe(200);
      expect(await loaded.json()).toMatchObject({
        recipeId: RECIPE_ID,
        targetServings: 8,
        defaultListId: A.groceryList,
        ingredients: [{ ingredientId: TOMATOES, name: "Tomatoes" }],
      });
      await expect(review).toBeVisible();
      await expect(review.getByText("Loading ingredients…")).toHaveCount(0);
      await expect(
        review.getByText("For 8 servings", { exact: true }),
      ).toBeVisible();
      await expect(review.getByLabel("Destination list")).toHaveValue(
        A.groceryList,
      );
      await expect(review.getByRole("checkbox")).toHaveCount(1);
      await expect(
        review.getByRole("checkbox", { name: /^Tomatoes / }),
      ).toBeChecked();
      await expect(confirm).toBeEnabled();
      expect(mutations).toBe(0);
      expect(await tomatoRows(page)).toHaveLength(0);
    };
    const expectNoIdempotencyRecords = async () => {
      const records = await withDb((db) =>
        db.query(
          `SELECT id FROM "IdempotencyRecord" WHERE family_id = $1 AND action = 'grocery.add-from-recipe'`,
          [A.family],
        ),
      );
      expect(records.rows).toEqual([]);
    };

    await openReview();
    await expectNoIdempotencyRecords();
    await review.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(review).toBeHidden();
    expect(mutations).toBe(0);
    expect(await tomatoRows(page)).toHaveLength(0);
    await expectNoIdempotencyRecords();
    await openReview();
    await expectNoIdempotencyRecords();

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/lists/items/from-recipe") &&
          r.request().method() === "POST",
      ),
      confirm.click(),
    ]);
    expect(response.status()).toBe(201);
    expect(mutations).toBe(1);
    await expect(review).toBeHidden();
    const key = response.request().headers()["idempotency-key"];
    expect(key).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    const sentBody = response.request().postData();
    expect(JSON.parse(sentBody ?? "{}")).toEqual({
      recipeId: RECIPE_ID,
      mealId: MEAL_ID,
      listId: A.groceryList,
      ingredientIds: [TOMATOES],
    });
    const first = await response.json();
    expect(first).toMatchObject({
      listId: A.groceryList,
      createdCount: 1,
      alreadyOnListCount: 0,
    });

    const status = page.getByRole("status").filter({ hasText: "Added" });
    await expect(status).toContainText("Added 1 item to Groceries");
    // 8 tomatoes for 4 servings, scaled to the meal's 8.
    const added = await tomatoRows(page);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ content: "Tomatoes", amount: 16 });

    // A lost response retried with the same key: replayed, nothing new written.
    const replay = await page.evaluate(
      async ({ k, b }) => {
        const csrf =
          document.cookie
            .split("; ")
            .find((c) => c.startsWith("csrf_token="))
            ?.slice("csrf_token=".length) ?? "";
        const res = await fetch("/api/lists/items/from-recipe", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf,
            "Idempotency-Key": k,
          },
          body: b,
        });
        return {
          status: res.status,
          replayed: res.headers.get("Idempotency-Replayed"),
          body: await res.json(),
        };
      },
      { k: key, b: sentBody ?? "" },
    );
    expect(replay).toEqual({ status: 201, replayed: "true", body: first });
    expect(await tomatoRows(page)).toHaveLength(1);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Removed" }),
    ).toContainText("Removed 1 item.");
    expect(await tomatoRows(page)).toHaveLength(0);
  });
});
