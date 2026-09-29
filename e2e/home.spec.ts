/**
 * Home and shell (#268, #269).
 *
 * - One home: `/dashboard` sends a parent to the Today board
 *   (`/dashboard/today`), which starts with one true summary sentence and the
 *   viewer's own chores; children and teens keep their kid home.
 * - Tapping a chore on the home completes it (optimistic, server-confirmed)
 *   and Undo reopens it.
 * - Phone tab bar: exactly Today · Calendar · Meals · Lists · Family. The top
 *   bar carries the same tabs from 800px up.
 * - Emergency is reached from Family; Family → More lists only enabled features.
 *
 * Spec-owned rows: one chore due today assigned to the Family A parent
 * (`fx_e2e_home_*`), inserted before the file and deleted after it, and the
 * `pickups` flag turned on for Family A for the More check (removed after).
 * Runs at 390x844, 800x1280 and 1366x768.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import pg from "pg";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { E2E_ANCHOR, authFile } from "./support/env";
import { expect, test } from "./support/test";

const A = FIXTURE_IDS.familyA;
const PROJECTS = [
  "phone-390x844",
  "tablet-portrait-800x1280",
  "desktop-1366x768",
];
const CHORE_ID = "fx_e2e_home_parent_chore";
const CHORE_TITLE = "Call the plumber";

/** UTC midnight of the anchor's UTC day (date-only storage). */
const anchorDay = () =>
  new Date(
    Date.UTC(
      E2E_ANCHOR.getUTCFullYear(),
      E2E_ANCHOR.getUTCMonth(),
      E2E_ANCHOR.getUTCDate(),
    ),
  );

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

async function choreStatus(): Promise<string> {
  return withDb(async (db) => {
    const r = await db.query(`SELECT status FROM "Chore" WHERE id = $1`, [
      CHORE_ID,
    ]);
    return r.rows[0]?.status;
  });
}

async function cleanup(db: pg.Client) {
  await db.query(`DELETE FROM "Chore" WHERE id = $1`, [CHORE_ID]);
  await db.query(
    `DELETE FROM "Activity" WHERE family_id = $1 AND title LIKE $2`,
    [A.family, `%${CHORE_TITLE}%`],
  );
  await db.query(
    `UPDATE "Family" SET features = features - 'pickups' WHERE id = $1 AND features IS NOT NULL`,
    [A.family],
  );
}

test.beforeAll(async () => {
  await withDb(async (db) => {
    await cleanup(db);
    await db.query(
      `INSERT INTO "Chore" (id, family_id, title, points, assigned_to, due_date, status, frequency, difficulty, created_by, created_at)
       VALUES ($1, $2, $3, 10, $4, $5, 'pending', 'once', 'medium', $4, $6)`,
      [CHORE_ID, A.family, CHORE_TITLE, A.parent, anchorDay(), E2E_ANCHOR],
    );
    await db.query(
      `UPDATE "Family" SET features = COALESCE(features, '{}'::jsonb) || '{"pickups":true}'::jsonb WHERE id = $1`,
      [A.family],
    );
  });
});

test.afterAll(async () => {
  await withDb(cleanup);
});

test.beforeEach(async ({}, testInfo) => {
  test.skip(
    !PROJECTS.includes(testInfo.project.name),
    "home/shell journey runs at 390x844, 800x1280 and 1366x768",
  );
});

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

const summary = (page: Page) => page.getByTestId("home-summary-sentence");

test.describe("Family A parent", () => {
  test.use({ storageState: authFile("parentA") });

  test("/dashboard opens the Today board with one true sentence", async ({
    page,
  }, testInfo) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard\/today$/);
    await expect(page.getByTestId("today-board")).toBeVisible();
    // Household chores due today: Taylor 2 (recycling, vacuum), and one each
    // for the parent (spec-owned) and Casey (tidy bedroom, in progress).
    await expect(summary(page)).toHaveText(
      "4 chores left today · Taylor 2, Avery 1, Casey 1",
    );
    // No contradicting empty state and no progress ring.
    await expect(page.getByText("All done for today!")).toHaveCount(0);
    await expect(page.getByText(/^\d+ of \d+ done today$/)).toHaveCount(0);
    // Chores stay reachable from Today.
    await expect(
      page.getByRole("link", { name: "All chores" }),
    ).toHaveAttribute("href", "/dashboard/chores");
    await expect(
      page.getByRole("link", { name: "1 chore to check" }),
    ).toBeVisible();
    await expectNoSeriousAxe(page, testInfo, "home");
  });

  test("tapping a chore on home completes it and Undo restores it", async ({
    page,
  }) => {
    await page.goto("/dashboard/today");
    const box = page.getByRole("checkbox", { name: new RegExp(CHORE_TITLE) });
    await expect(box).toHaveAttribute("aria-checked", "false");

    const completed = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/chores/complete") &&
        r.request().method() === "POST",
    );
    await box.click();
    await expect(box).toHaveAttribute("aria-checked", "true");
    expect((await completed).status()).toBe(200);
    await expect(summary(page)).toHaveText(
      "3 chores left today · Taylor 2, Casey 1",
    );
    expect(await choreStatus()).toBe("completed");

    const toast = page.getByTestId("undo-toast");
    await expect(toast).toContainText(`“${CHORE_TITLE}” done`);
    const reopened = page.waitForResponse((r) =>
      r.url().endsWith("/api/chores/uncomplete"),
    );
    await toast.getByRole("button", { name: "Undo" }).click();
    expect((await reopened).status()).toBe(200);
    await expect(
      page.getByRole("checkbox", { name: new RegExp(CHORE_TITLE) }),
    ).toHaveAttribute("aria-checked", "false");
    await expect(summary(page)).toHaveText(
      "4 chores left today · Taylor 2, Avery 1, Casey 1",
    );
    expect(await choreStatus()).toBe("pending");
  });

  test("phone tab bar has exactly the five tabs", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "phone-390x844",
      "the bottom tab bar is the phone navigation",
    );
    await page.goto("/dashboard/today");
    const bar = page.locator("nav.tab-bar");
    await expect(bar).toBeVisible();
    const tabs = bar.getByRole("link");
    await expect(tabs).toHaveText([
      "Today",
      "Calendar",
      "Meals",
      "Lists",
      "Family",
    ]);
    await expect(bar.getByRole("link", { name: "Today" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const tab of await tabs.all()) {
      const b = await tab.boundingBox();
      expect(b?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await bar.getByRole("link", { name: "Meals" }).tap();
    await expect(page).toHaveURL(/\/dashboard\/meals$/);
  });

  test("top bar carries the same five tabs on tablets and desktop", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "phone-390x844",
      "the top bar tabs start at md",
    );
    await page.goto("/dashboard/today");
    await expect(page.locator("nav.tab-bar")).toBeHidden();
    await expect(page.getByTestId("top-tabs").getByRole("link")).toHaveText([
      "Today",
      "Calendar",
      "Meals",
      "Lists",
      "Family",
    ]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });

  test("Emergency is reached from Family", async ({ page }) => {
    await page.goto("/dashboard/family");
    const link = page
      .locator("#main-content")
      .getByRole("link", { name: /Emergency/ });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/dashboard\/emergency$/);
  });

  test("More lists the enabled features and a way to turn more on", async ({
    page,
  }, testInfo) => {
    await page.goto("/dashboard/family");
    await page
      .locator("#main-content")
      .getByRole("link", { name: /^More/ })
      .click();
    await expect(page).toHaveURL(/\/dashboard\/family\/more$/);
    const list = page.getByTestId("more-list");
    // Chores first; on by default or turned on by this spec: listed.
    await expect(list.getByRole("link").first()).toContainText("Chores");
    for (const title of [
      "Emergency contacts",
      "Budget",
      "Family chat",
      "Pickups & dropoffs",
    ]) {
      await expect(list.getByText(title, { exact: true })).toBeVisible();
    }
    // Off: not listed. Tabs are never listed.
    for (const title of [
      "Allowance & IOUs",
      "Food inventory",
      "Babysitter handoff",
      "Meal planning",
      "Calendar",
      "Lists",
    ]) {
      await expect(list.getByText(title, { exact: true })).toHaveCount(0);
    }
    await expect(
      page.getByRole("link", { name: /Turn features on or off/ }),
    ).toHaveAttribute("href", "/dashboard/features");
    await expectNoSeriousAxe(page, testInfo, "more");
  });
});

test.describe("Family A child", () => {
  test.use({ storageState: authFile("childA") });

  test("keeps the kid home, with Today, Lists and Emergency tabs", async ({
    page,
  }, testInfo) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText("Today's Missions")).toBeVisible();
    const tabs =
      testInfo.project.name === "phone-390x844"
        ? page.locator("nav.tab-bar").getByRole("link")
        : page.getByTestId("top-tabs").getByRole("link");
    await expect(tabs).toHaveText(["Today", "Lists", "Emergency"]);
  });

  test("the board speaks to the child about their own chores", async ({
    page,
  }) => {
    await page.goto("/dashboard/today");
    await expect(summary(page)).toHaveText("You have 1 chore left");
    await expect(
      page.getByTestId("home-summary").getByRole("link"),
    ).toHaveCount(0);
  });
});
