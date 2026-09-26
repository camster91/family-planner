/**
 * Today board / fridge view (#119 / #159): /dashboard/today.
 *
 * Covers every region with Family A fixture data, the empty household, the
 * child role, shared-surface privacy (no parent-only data in the rendered page
 * OR its RSC payload), fridge mode chrome, targets, offline, client refresh,
 * axe, and a visual baseline at the two primary tablet sizes.
 *
 * Meal and imported-calendar fixtures do not exist in the canonical dataset yet
 * (TEST_DATA.md defers meals to #149), so this spec inserts a few clearly
 * labelled rows into Family A (ids `fx_e2e_fridge_*`) before the tests and
 * deletes them afterwards. It also inserts parent-only "canary" rows (budget,
 * medical, address, private message) whose text must never reach the board.
 * The same guard as global-setup refuses production-like databases.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import pg from "pg";
import {
  FIXTURE_EMAILS,
  FIXTURE_IDS,
  FIXTURE_LONG_TEXT,
  FIXTURE_PASSWORD,
} from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { E2E_ANCHOR, authFile } from "./support/env";
import { goOffline, goOnline } from "./support/network";
import { expect, test } from "./support/test";

const A = FIXTURE_IDS.familyA;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(E2E_ANCHOR.getTime() + offsetMs);
/** UTC midnight of the anchor's UTC day + `days` (date-only storage, src/lib/dates.ts). */
const dateOnly = (days: number) =>
  new Date(
    Date.UTC(
      E2E_ANCHOR.getUTCFullYear(),
      E2E_ANCHOR.getUTCMonth(),
      E2E_ANCHOR.getUTCDate() + days,
    ),
  );

const IDS = {
  subscription: "fx_e2e_fridge_sub",
  importedEvent: "fx_e2e_fridge_imported",
  dinnerToday: "fx_e2e_fridge_dinner_today",
  dinnerTomorrow: "fx_e2e_fridge_dinner_tomorrow",
  medication: "fx_e2e_fridge_med",
  location: "fx_e2e_fridge_loc",
  transaction: "fx_e2e_fridge_txn",
  message: "fx_e2e_fridge_msg",
};

const SUBSCRIPTION_NAME = "Riverside School District";
const IMPORTED_TITLE = "Early dismissal";
const DINNER_TODAY = "Lemon herb chicken with rice";
const DINNER_TOMORROW = "Veggie tacos";

/** Parent-only or free-text content that must never appear on the shared board. */
const CANARIES = [
  "FRIDGE-CANARY-BUDGET",
  "1234.56",
  "1,234.56",
  "FRIDGE-CANARY-MEDICATION",
  "FRIDGE-CANARY-MEDICAL-NOTE",
  "FRIDGE-CANARY-ADDRESS",
  "FRIDGE-CANARY-PRIVATE-MESSAGE",
  "FRIDGE-CANARY-MEAL-NOTE",
  "FRIDGE-CANARY-EVENT-NOTE",
  // Fixture event locations (one is a street address) and long descriptions.
  "123 Example Street",
  "Fixture Elementary",
  "Fixture Field",
  FIXTURE_LONG_TEXT.description,
];

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
  // Children before parents; every id is spec-owned.
  await db.query(`DELETE FROM "Event" WHERE id = $1`, [IDS.importedEvent]);
  await db.query(`DELETE FROM "CalendarSubscription" WHERE id = $1`, [
    IDS.subscription,
  ]);
  await db.query(`DELETE FROM "FamilyMeal" WHERE id = ANY($1)`, [
    [IDS.dinnerToday, IDS.dinnerTomorrow],
  ]);
  await db.query(`DELETE FROM "Medication" WHERE id = $1`, [IDS.medication]);
  await db.query(`DELETE FROM "FamilyLocation" WHERE id = $1`, [IDS.location]);
  await db.query(`DELETE FROM "Transaction" WHERE id = $1`, [IDS.transaction]);
  await db.query(`DELETE FROM "Message" WHERE id = $1`, [IDS.message]);
}

test.beforeAll(async () => {
  await withDb(async (db) => {
    await removeSpecRows(db);
    const now = new Date();
    // Fetched "in the future" so the view-driven refresh never treats it as
    // stale and never tries to reach a feed (there is none).
    await db.query(
      `INSERT INTO "CalendarSubscription"
         (id, family_id, name, url_enc, color, last_fetched_at, last_status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, 'v1:e2e-no-feed', '#0079A8', $4, 'ok', $5, $6, $6)`,
      [
        IDS.subscription,
        A.family,
        SUBSCRIPTION_NAME,
        at(365 * DAY),
        A.parent,
        now,
      ],
    );
    await db.query(
      `INSERT INTO "Event"
         (id, family_id, title, description, start_time, end_time, location, event_type, is_task, created_by, created_at,
          source_subscription_id, source_uid, source_occurrence_start)
       VALUES ($1, $2, $3, 'FRIDGE-CANARY-EVENT-NOTE', $4, $5, 'FRIDGE-CANARY-ADDRESS 42 Hidden Lane', 'school', false, $6, $7,
               $8, 'fx-e2e-fridge-uid-1', $4)`,
      [
        IDS.importedEvent,
        A.family,
        IMPORTED_TITLE,
        at(3 * HOUR),
        at(4 * HOUR),
        A.parent,
        now,
        IDS.subscription,
      ],
    );
    for (const [id, days, recipe] of [
      [IDS.dinnerToday, 0, DINNER_TODAY],
      [IDS.dinnerTomorrow, 1, DINNER_TOMORROW],
    ] as const) {
      await db.query(
        `INSERT INTO "FamilyMeal" (id, family_id, date, meal_type, recipe_name, notes, cook_id, created_by, created_at)
         VALUES ($1, $2, $3, 'dinner', $4, 'FRIDGE-CANARY-MEAL-NOTE', $5, $5, $6)`,
        [id, A.family, dateOnly(days), recipe, A.parent, now],
      );
    }
    await db.query(
      `INSERT INTO "Medication" (id, family_id, person_id, name, dosage, schedule, notes, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, 'FRIDGE-CANARY-MEDICATION', '5 ml', 'daily', 'FRIDGE-CANARY-MEDICAL-NOTE', $4, $5, $5)`,
      [IDS.medication, A.family, A.child, A.parent, now],
    );
    await db.query(
      `INSERT INTO "FamilyLocation" (id, family_id, user_id, label, address, created_at, updated_at)
       VALUES ($1, $2, $3, 'Home', 'FRIDGE-CANARY-ADDRESS 7 Private Road', $4, $4)`,
      [IDS.location, A.family, A.parent, now],
    );
    await db.query(
      `INSERT INTO "Transaction" (id, family_id, user_id, amount, type, description, date, created_at, updated_at)
       VALUES ($1, $2, $3, 1234.56, 'expense', 'FRIDGE-CANARY-BUDGET', $4, $5, $5)`,
      [IDS.transaction, A.family, A.parent, at(-HOUR), now],
    );
    await db.query(
      `INSERT INTO "Message" (id, family_id, sender_id, content, attachments, read_by, created_at)
       VALUES ($1, $2, $3, 'FRIDGE-CANARY-PRIVATE-MESSAGE', '{}', '{}', $4)`,
      [IDS.message, A.family, A.parent, now],
    );
  });
});

test.afterAll(async () => {
  await withDb(removeSpecRows);
});

const board = (page: Page) => page.getByTestId("today-board");
const region = (
  page: Page,
  name: "today" | "dinner" | "chores" | "groceries" | "coming",
) => page.getByTestId(`region-${name}`);

async function openBoard(page: Page, path = "/dashboard/today") {
  await page.goto(path);
  // The board renders after mount (local "today"), so wait for the regions.
  await expect(region(page, "today")).toBeVisible();
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

async function expectNoCanaries(page: Page) {
  // The raw HTML includes the serialized RSC payload, i.e. the board's props:
  // private data must not be sent, not merely hidden.
  const html = await page.content();
  for (const canary of CANARIES) {
    expect(html, `"${canary}" leaked into /dashboard/today`).not.toContain(
      canary,
    );
  }
  const text = (await board(page).innerText()).toLowerCase();
  for (const word of [
    "budget",
    "spent",
    "allowance",
    "medication",
    "message",
    " xp",
    "streak",
    "leaderboard",
    "points",
    "level ",
  ]) {
    expect(text, `board text mentions "${word}"`).not.toContain(word);
  }
}

async function axeScan(page: Page, testInfo: TestInfo, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude("next-route-announcer")
    .analyze();
  await testInfo.attach(`axe-${label.replace(/\W+/g, "_")}.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });
  // Same gate as a11y.spec.ts (whose allowlist is empty): no serious/critical.
  const blocking = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      rule: v.id,
      nodes: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
    }));
  expect(blocking, `serious/critical axe violations on ${label}`).toEqual([]);
}

test.describe("Today board: Family A parent", () => {
  test.use({ storageState: authFile("parentA") });

  test("shows every region from real household data", async ({ page }) => {
    await openBoard(page);

    await expect(page.getByTestId("board-date")).toHaveText(
      "Monday, January 5",
    );

    // Today: still-to-come events in the viewer's zone, imported one labelled.
    const today = region(page, "today");
    await expect(today.getByRole("heading", { name: "Today" })).toBeVisible();
    const events = today.getByTestId("today-event");
    await expect(events).toHaveCount(4);
    await expect(events.nth(0)).toContainText("9:00 AM");
    await expect(events.nth(0)).toContainText("Dentist (Casey)");
    await expect(events.nth(1)).toContainText("10:00 AM");
    await expect(events.nth(1)).toContainText(IMPORTED_TITLE);
    await expect(events.nth(1)).toContainText(`From ${SUBSCRIPTION_NAME}`);
    await expect(events.nth(2)).toContainText("Soccer practice");
    await expect(events.nth(3)).toContainText(FIXTURE_LONG_TEXT.eventTitle);
    // Already finished this morning.
    await expect(today).not.toContainText("School drop-off");
    await expect(today).not.toContainText("Work stand-up");

    // Dinner tonight.
    const dinner = region(page, "dinner");
    await expect(dinner.getByTestId("dinner-tonight")).toContainText(
      DINNER_TODAY,
    );
    await expect(dinner).toContainText("Cooking: Avery Fixture-A");
    await expect(
      dinner.getByRole("link", { name: "Open meals" }),
    ).toHaveAttribute("href", "/dashboard/meals");

    // Groceries: oldest 5 open items, checked items excluded, overflow link.
    const groceries = region(page, "groceries");
    await expect(groceries).toContainText("6 to buy");
    const items = groceries.getByTestId("grocery-item");
    await expect(items).toHaveCount(5);
    await expect(items.nth(0)).toContainText("Milk");
    await expect(items.nth(0)).toContainText("× 2");
    await expect(items.nth(1)).toContainText(FIXTURE_LONG_TEXT.groceryItem);
    await expect(groceries).not.toContainText("Coffee beans");
    await expect(groceries).not.toContainText("Dish soap");
    await expect(
      groceries.getByRole("link", { name: "1 more to buy" }),
    ).toHaveAttribute("href", "/dashboard/lists");
    await expect(items.nth(0).getByRole("link")).toHaveAttribute(
      "href",
      `/dashboard/lists/${A.groceryList}`,
    );

    // Chores due today, per person, household order, no points.
    const chores = region(page, "chores");
    const people = chores.getByTestId("chore-person");
    await expect(people).toHaveCount(2);
    // Household member order (fixture members share created_at, so by id).
    await expect(people.nth(0)).toContainText("Casey");
    await expect(people.nth(0)).toContainText("Tidy bedroom");
    await expect(people.nth(0)).toContainText("In progress");
    await expect(people.nth(1)).toContainText("Taylor");
    await expect(people.nth(1)).toContainText("Take out recycling");
    await expect(people.nth(1)).toContainText("Vacuum living room");
    // Not due today (overdue from earlier / due later): no guilt, no clutter.
    await expect(chores).not.toContainText("Mow the lawn");
    await expect(chores).not.toContainText("Pack school bag");

    // Coming up: the next three local days.
    const days = region(page, "coming").getByTestId("coming-up-day");
    await expect(days).toHaveCount(3);
    await expect(days.nth(0)).toContainText("Tomorrow Jan 6");
    await expect(days.nth(0)).toContainText("Library returns");
    await expect(days.nth(0)).toContainText("Swim lessons");
    await expect(days.nth(0)).toContainText("Piano recital");
    await expect(days.nth(0)).toContainText(`Dinner: ${DINNER_TOMORROW}`);
    await expect(days.nth(1)).toContainText("Wednesday Jan 7");
    await expect(days.nth(1)).toContainText("Late flight arrival");
    await expect(days.nth(2)).toContainText("Thursday Jan 8");
    await expect(days.nth(2)).toContainText("Renew library cards");

    await expectNoHorizontalOverflow(page);
  });

  test("keeps parent-only data off the shared board", async ({ page }) => {
    await openBoard(page);
    await expectNoCanaries(page);
    await openBoard(page, "/dashboard/today?mode=fridge");
    await expectNoCanaries(page);
  });

  test("fridge mode hides the app chrome and keeps targets large", async ({
    page,
  }) => {
    await openBoard(page, "/dashboard/today?mode=fridge");
    await expect(board(page)).toHaveAttribute("data-mode", "fridge");
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).toBeHidden();
    const exit = page.getByRole("link", { name: "Exit fridge mode" });
    await expect(exit).toBeVisible();

    // Every interactive element on the board is at least 44x44 CSS px.
    const targets = board(page).locator("a, button");
    const count = await targets.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const box = await targets.nth(i).boundingBox();
      const label = await targets.nth(i).innerText();
      expect(box, `target "${label}" is rendered`).not.toBeNull();
      expect(box!.height, `target "${label}" height`).toBeGreaterThanOrEqual(
        44,
      );
      expect(box!.width, `target "${label}" width`).toBeGreaterThanOrEqual(44);
    }
    await expectNoHorizontalOverflow(page);

    await exit.click();
    await expect(page).toHaveURL(/\/dashboard\/today$/);
    await expect(board(page)).toHaveAttribute("data-mode", "app");
  });

  test("is reachable from the user menu", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "User menu" }).click();
    await page.getByRole("link", { name: "Today board" }).click();
    await expect(page).toHaveURL(/\/dashboard\/today$/);
    await expect(region(page, "today")).toBeVisible();
  });

  test("refreshes itself on the client and says when it is offline", async ({
    page,
  }) => {
    await openBoard(page);

    // Five minutes later the board re-requests its server component (RSC).
    const refreshed = page.waitForRequest(
      (req) =>
        req.url().includes("/dashboard/today") && Boolean(req.headers()["rsc"]),
    );
    await page.clock.runFor(5 * 60 * 1000);
    await refreshed;
    await expect(region(page, "dinner")).toContainText(DINNER_TODAY);

    await goOffline(page);
    await expect(board(page).getByRole("status")).toContainText(
      "You're offline.",
    );
    await goOnline(page);
    await expect(
      board(page).getByText("You're offline.", { exact: false }),
    ).toBeHidden();
  });

  test("axe: board and fridge mode", async ({ page }, testInfo) => {
    await openBoard(page);
    await axeScan(page, testInfo, "/dashboard/today");
    await openBoard(page, "/dashboard/today?mode=fridge");
    await axeScan(page, testInfo, "/dashboard/today?mode=fridge");
  });

  test("@visual fridge view baseline", async ({ page }, testInfo) => {
    test.skip(
      !["fridge-landscape-1280x800", "tablet-portrait-800x1280"].includes(
        testInfo.project.name,
      ),
      "Fridge baselines are kept for the two primary tablet sizes only.",
    );
    await openBoard(page, "/dashboard/today?mode=fridge");
    await page.mouse.move(0, 0);
    await expect(page).toHaveScreenshot("fridge-parent.png", {
      fullPage: true,
      // Clock-derived. The date is asserted as text instead of masked.
      mask: [
        page.getByTestId("board-clock"),
        page.getByTestId("board-updated"),
      ],
    });
  });
});

test.describe("Today board: Family A child", () => {
  test.use({ storageState: authFile("childA") });

  test("opens the shared board with only links a child can use", async ({
    page,
  }, testInfo) => {
    await openBoard(page);
    await expect(page).toHaveURL(/\/dashboard\/today$/);
    await expect(region(page, "dinner")).toContainText(DINNER_TODAY);
    await expect(
      region(page, "chores").getByTestId("chore-person"),
    ).toHaveCount(2);
    await expect(
      region(page, "groceries").getByTestId("grocery-item"),
    ).toHaveCount(5);

    const hrefs = await board(page)
      .locator("a")
      .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
    for (const blocked of [
      "/dashboard/meals",
      "/dashboard/chores",
      "/dashboard/calendar",
      "/dashboard/features",
    ]) {
      expect(hrefs).not.toContain(blocked);
    }
    expect(hrefs).toContain("/dashboard/lists");

    await expectNoCanaries(page);
    await axeScan(page, testInfo, "/dashboard/today (child)");
  });
});

test.describe("Today board: empty household", () => {
  test("shows an explicit empty state for every region", async ({
    page,
  }, testInfo) => {
    const res = await page.request.post("/api/auth/login", {
      data: {
        email: FIXTURE_EMAILS.familyEmpty.parent,
        password: FIXTURE_PASSWORD,
      },
    });
    expect(res.status(), await res.text()).toBe(200);

    await openBoard(page);
    await expect(region(page, "today")).toContainText(
      "Nothing else on the calendar today.",
    );
    await expect(region(page, "dinner")).toContainText(
      "No dinner planned yet.",
    );
    await expect(
      region(page, "dinner").getByRole("link", { name: "Plan dinner" }),
    ).toHaveAttribute("href", "/dashboard/meals");
    await expect(region(page, "groceries")).toContainText(
      "The grocery list is clear.",
    );
    await expect(region(page, "chores")).toContainText("No chores due today.");
    await expect(
      region(page, "coming").getByText("Nothing on the calendar"),
    ).toHaveCount(3);
    // Nothing from the busy household.
    await expect(board(page)).not.toContainText("Dentist (Casey)");
    await expect(board(page)).not.toContainText("Milk");

    await expectNoHorizontalOverflow(page);
    await axeScan(page, testInfo, "/dashboard/today (empty)");
  });
});
