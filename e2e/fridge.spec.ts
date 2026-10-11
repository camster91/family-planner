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
 *
 * Weather (#262) never touches the network here: households default to off,
 * and the weather tests turn Family A on together with a fresh, spec-owned
 * `WeatherCache` row (stamped a few hours after the anchor so the server's
 * 30-minute freshness check always serves it), then turn it off again. Place
 * search in the settings test is answered by `page.route`, in the browser.
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

/** Coarse place and cached forecast for the weather tests (#262). */
const WEATHER_PLACE = {
  label: "Toronto, Ontario, Canada",
  latitude: 43.65,
  longitude: -79.38,
};
const WEATHER_SNAPSHOT = {
  utcOffsetSeconds: -18000,
  timezone: "America/Toronto",
  current: { temperatureC: -3.4, code: 71, isDay: true },
  daily: [
    {
      day: "2026-01-05",
      highC: -1.2,
      lowC: -8.5,
      code: 71,
      precipitationChance: 80,
    },
    {
      day: "2026-01-06",
      highC: 2.6,
      lowC: -4,
      code: 3,
      precipitationChance: 10,
    },
    { day: "2026-01-07", highC: 4, lowC: -2, code: 0, precipitationChance: 0 },
    { day: "2026-01-08", highC: 5, lowC: 1, code: 61, precipitationChance: 70 },
  ],
};

async function enableWeather(db: pg.Client) {
  await db.query(
    `UPDATE "Family" SET weather_enabled = true, weather_latitude = $2, weather_longitude = $3,
       weather_label = $4, weather_unit = 'celsius' WHERE id = $1`,
    [
      A.family,
      WEATHER_PLACE.latitude,
      WEATHER_PLACE.longitude,
      WEATHER_PLACE.label,
    ],
  );
  await seedWeatherCache(db);
}

async function seedWeatherCache(db: pg.Client) {
  await db.query(
    `INSERT INTO "WeatherCache" (family_id, latitude, longitude, status, payload, fetched_at, updated_at)
     VALUES ($1, $2, $3, 'ok', $4, $5, now())
     ON CONFLICT (family_id) DO UPDATE SET latitude = $2, longitude = $3, status = 'ok', payload = $4, fetched_at = $5`,
    [
      A.family,
      WEATHER_PLACE.latitude,
      WEATHER_PLACE.longitude,
      JSON.stringify(WEATHER_SNAPSHOT),
      at(6 * HOUR),
    ],
  );
}

async function disableWeather(db: pg.Client) {
  await db.query(
    `UPDATE "Family" SET weather_enabled = false, weather_latitude = NULL, weather_longitude = NULL,
       weather_label = NULL, weather_unit = 'celsius' WHERE id = $1`,
    [A.family],
  );
  await db.query(`DELETE FROM "WeatherCache" WHERE family_id = $1`, [A.family]);
  await db.query(`UPDATE "User" SET board_color = NULL WHERE family_id = $1`, [
    A.family,
  ]);
}

/**
 * "Use soon" tile (#263 data in the #262 slot). Spec-owned rows
 * `fx_e2e_board_inventory_*`; the inventory feature (off in the fixtures) is
 * turned on for Family A only during the test and removed again afterwards.
 */
const INVENTORY_PREFIX = "fx_e2e_board_inventory_";
const USE_SOON_ROWS: Array<[string, string, string, number]> = [
  // [id suffix, name, location, expiry day offset from the anchor day]
  ["a_spinach", "Baby spinach", "fridge", -2],
  ["a_milk", "Oat milk", "fridge", 0],
  ["a_bread", "Sourdough loaf", "pantry", 1],
  ["a_lasagna", "Leftover lasagna", "fridge", 1],
  ["a_yogurt", "Greek yogurt", "fridge", 2],
  ["a_chicken", "Chicken thighs", "freezer", 3],
  ["a_berries", "Strawberries", "fridge", 3],
  ["a_jam", "Apricot jam", "pantry", 30],
];
const INVENTORY_CANARY_B = "FRIDGE-CANARY-B-INVENTORY";

const dayKey = (days: number) => dateOnly(days).toISOString().slice(0, 10);

async function removeBoardInventory(db: pg.Client) {
  await db.query(`DELETE FROM "InventoryItem" WHERE id LIKE $1`, [
    `${INVENTORY_PREFIX}%`,
  ]);
  await db.query(
    `UPDATE "Family" SET features = features - 'inventory' WHERE id = $1 AND features IS NOT NULL`,
    [A.family],
  );
}

async function addBoardInventory(db: pg.Client) {
  await removeBoardInventory(db);
  for (const [suffix, name, location, days] of USE_SOON_ROWS) {
    await db.query(
      `INSERT INTO "InventoryItem" (id, family_id, name, location, expires_on, amount, added_by)
       VALUES ($1, $2, $3, $4, $5, 2, $6)`,
      [
        INVENTORY_PREFIX + suffix,
        A.family,
        name,
        location,
        dayKey(days),
        A.parent,
      ],
    );
  }
  // A use-by day that has passed (#158): "don't eat", never on the tile.
  await db.query(
    `INSERT INTO "InventoryItem" (id, family_id, name, location, expires_on, date_kind, added_by)
     VALUES ($1, $2, 'Old prawns', 'fridge', $3, 'use_by', $4)`,
    [INVENTORY_PREFIX + "a_prawns", A.family, dayKey(-1), A.parent],
  );
  // Another household's item, due today: must never reach Family A's board.
  await db.query(
    `INSERT INTO "InventoryItem" (id, family_id, name, location, expires_on)
     VALUES ($1, $2, $3, 'fridge', $4)`,
    [
      INVENTORY_PREFIX + "b_canary",
      FIXTURE_IDS.familyB.family,
      INVENTORY_CANARY_B,
      dayKey(0),
    ],
  );
}

async function setBoardInventoryFeature(db: pg.Client) {
  await db.query(
    `UPDATE "Family" SET features = COALESCE(features, '{}'::jsonb) || '{"inventory":true}'::jsonb WHERE id = $1`,
    [A.family],
  );
}

async function removeSpecRows(db: pg.Client) {
  await disableWeather(db);
  await removeBoardInventory(db);
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
        [id, A.family, dateOnly(days).toISOString(), recipe, A.parent, now],
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

/** 16:10 landscape fridge hubs (#262): 1280x800 and the 13" 1920x1200. */
const LANDSCAPE_HUBS = ["fridge-landscape-1280x800", "tablet-large-1920x1200"];

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
    // #274: the tile heading opens the section (no "Open meals" button).
    await expect(
      dinner.getByRole("link", { name: /Dinner tonight\s*, open meals/ }),
    ).toHaveAttribute("href", "/dashboard/meals");
    await expect(page.getByRole("link", { name: /^Open / })).toHaveCount(0);

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
    ).toHaveAttribute("href", "/dashboard/lists/groceries");
    // #274: a grocery row ticks the item off in place; the heading opens groceries.
    await expect(
      items.nth(0).getByRole("button", { name: "Tick off Milk, 2" }),
    ).toBeVisible();
    await expect(
      groceries.getByRole("link", { name: /Groceries\s*, open grocery lists/ }),
    ).toHaveAttribute("href", "/dashboard/lists/groceries");

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

    // Every interactive element on the board is at least 44x44 CSS px, and
    // at least 56 px tall on the 1920x1200 hub (#262: larger on the board).
    const minHeight =
      test.info().project.name === "tablet-large-1920x1200" ? 56 : 44;
    const targets = board(page).locator("a, button");
    const count = await targets.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const box = await targets.nth(i).boundingBox();
      const label = await targets.nth(i).innerText();
      expect(box, `target "${label}" is rendered`).not.toBeNull();
      expect(box!.height, `target "${label}" height`).toBeGreaterThanOrEqual(
        minHeight,
      );
      expect(box!.width, `target "${label}" width`).toBeGreaterThanOrEqual(44);
    }
    await expectNoHorizontalOverflow(page);

    await exit.click();
    await expect(page).toHaveURL(/\/dashboard\/today$/);
    await expect(board(page)).toHaveAttribute("data-mode", "app");
  });

  // One home (#269): the board is the parent's home and Today tab; the
  // user-menu link is for children and teens, whose Today tab is the kid home.
  test("is the parent's home", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard\/today$/);
    await expect(region(page, "today")).toBeVisible();
  });

  test("checks for changes on the client and says when it is offline", async ({
    page,
  }) => {
    await openBoard(page);
    await expect(board(page).getByTestId("board-updated")).toHaveText(
      "Updated just now",
    );

    // Visible sync (#271): about every 25 s the board asks the cheap version
    // route; with nothing changed it keeps its data and stays "just now".
    // (e2e/ambient.spec.ts covers the re-fetch when something changes.)
    const checked = page.waitForResponse(
      (res) =>
        res.url().includes("/api/family/board-version") && res.status() === 200,
    );
    await page.clock.runFor(30 * 1000);
    await checked;
    await expect(region(page, "dinner")).toContainText(DINNER_TODAY);
    await expect(board(page).getByTestId("board-updated")).toHaveText(
      "Updated just now",
    );

    // App mode: the app-wide banner says "You're offline"; the board only
    // says how old its data is (one offline message, OFFLINE_SYNC.md).
    await goOffline(page);
    await expect(page.getByTestId("app-offline-banner")).toBeVisible();
    await expect(board(page).getByTestId("sync-notice")).toContainText(
      "Showing what was here",
    );
    await expect(board(page).getByTestId("sync-notice")).not.toContainText(
      "You're offline.",
    );
    await goOnline(page);
    await expect(board(page).getByTestId("sync-notice")).toBeHidden();

    // Fridge mode hides the banner, so the board's own notice says it.
    await openBoard(page, "/dashboard/today?mode=fridge");
    await goOffline(page);
    await expect(board(page).getByRole("status")).toContainText(
      "You're offline.",
    );
    await expect(page.getByTestId("app-offline-banner")).toBeHidden();
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

  test("fridge hub fits every region and the weather tile in a 16:10 landscape viewport", async ({
    page,
  }, testInfo) => {
    test.skip(
      !LANDSCAPE_HUBS.includes(testInfo.project.name),
      "The fit-to-screen hub is for 16:10 landscape fridge tablets (#262).",
    );
    await withDb(enableWeather);
    try {
      await openBoard(page, "/dashboard/today?mode=fridge");
      await expect(page.getByTestId("board-weather")).toBeVisible();
      const viewport = page.viewportSize();
      if (!viewport) throw new Error("No viewport");
      const pageHeight = await page.evaluate(
        () => document.documentElement.scrollHeight,
      );
      expect(pageHeight).toBeLessThanOrEqual(viewport.height);
      for (const testId of [
        "region-today",
        "region-dinner",
        "region-chores",
        "region-groceries",
        "region-coming",
        "board-weather",
      ]) {
        const box = await page.getByTestId(testId).boundingBox();
        expect(box, testId).not.toBeNull();
        expect(box!.y + box!.height, testId).toBeLessThanOrEqual(
          viewport.height,
        );
      }
      // Four columns side by side: schedule, kitchen, chores, coming up.
      const xs: number[] = [];
      for (const area of ["today", "dinner", "chores", "coming"] as const) {
        xs.push(Math.round((await region(page, area).boundingBox())!.x));
      }
      expect([...xs].sort((a, b) => a - b)).toEqual(xs);
      expect(new Set(xs).size).toBe(4);
      await expectNoHorizontalOverflow(page);
    } finally {
      await withDb(disableWeather);
    }
  });

  test("shows the household's opt-in weather with text, and no coordinates", async ({
    page,
  }, testInfo) => {
    // Off by default: no tile.
    await openBoard(page, "/dashboard/today?mode=fridge");
    await expect(page.getByTestId("board-weather")).toHaveCount(0);

    await withDb(enableWeather);
    try {
      await openBoard(page, "/dashboard/today?mode=fridge");
      const tile = page.getByRole("region", {
        name: `Weather in ${WEATHER_PLACE.label}`,
      });
      await expect(tile).toBeVisible();
      await expect(tile.getByTestId("weather-now")).toHaveText("-3°C");
      await expect(tile).toContainText("Light snow");
      await expect(tile).toContainText("80% chance of rain or snow");
      await expect(tile).toContainText(WEATHER_PLACE.label);
      // The next days show on the wide hub only.
      await expect(tile.getByTestId("weather-day").first()).toBeVisible({
        visible: testInfo.project.name === "tablet-large-1920x1200",
      });
      const html = await page.content();
      expect(html).not.toContain(String(WEATHER_PLACE.latitude));
      expect(html).not.toContain(String(WEATHER_PLACE.longitude));
      await expectNoHorizontalOverflow(page);
      await axeScan(page, testInfo, "/dashboard/today?mode=fridge (weather)");
    } finally {
      await withDb(disableWeather);
    }
  });

  test("marks each member with a colour next to their name", async ({
    page,
  }) => {
    await openBoard(page, "/dashboard/today?mode=fridge");
    const people = region(page, "chores").getByTestId("chore-person");
    const colors = await people.evaluateAll((items) =>
      items.map(
        (li) =>
          li
            .querySelector("[data-member-color]")
            ?.getAttribute("data-member-color") ?? null,
      ),
    );
    expect(colors.length).toBeGreaterThan(0);
    expect(colors.every(Boolean)).toBe(true);
    expect(new Set(colors).size).toBe(colors.length);
    // The name is always printed beside the colour.
    await expect(people.nth(0).getByRole("heading")).toHaveText("Casey");
    // Events a member added carry their name; the imported one does not.
    const events = region(page, "today").getByTestId("today-event");
    await expect(events.nth(1).getByTestId("event-member")).toHaveCount(0);
    await expect(events.nth(0).getByTestId("event-member")).toContainText(
      "Added by",
    );
  });

  test("shows a read-only Use soon tile only with inventory on and something due", async ({
    page,
  }, testInfo) => {
    // Rows exist, but the feature is off: no tile, and the hub keeps its layout.
    await withDb(addBoardInventory);
    try {
      await openBoard(page, "/dashboard/today?mode=fridge");
      await expect(page.getByTestId("board-slot-use-soon")).toHaveCount(0);

      await withDb(setBoardInventoryFeature);
      await openBoard(page, "/dashboard/today?mode=fridge");
      const tile = page.getByRole("region", { name: "Use soon" });
      await expect(tile).toBeVisible();
      const rows = tile.getByTestId("use-soon-item");
      await expect(rows).toHaveCount(5);
      await expect(rows.nth(0)).toHaveText(
        /Baby spinach\s*Best before was 2 days ago\s*·\s*Fridge/,
      );
      await expect(rows.nth(0)).toHaveAttribute("data-status", "expired");
      await expect(rows.nth(1)).toHaveText(
        /Oat milk\s*Best before today\s*·\s*Fridge/,
      );
      await expect(rows.nth(2)).toContainText("Best before tomorrow");
      await expect(tile.getByTestId("use-soon-more")).toHaveText(
        "2 more to use soon",
      );
      // Not due yet, past use-by, and another household's item, are never shown.
      await expect(tile).not.toContainText("Apricot jam");
      await expect(tile).not.toContainText("Old prawns");
      expect(await page.content()).not.toContain(INVENTORY_CANARY_B);
      await expect(
        tile.getByRole("link", { name: "Open inventory" }),
      ).toHaveAttribute("href", "/dashboard/inventory");

      if (LANDSCAPE_HUBS.includes(testInfo.project.name)) {
        // The hub still fits the screen with the extra row.
        const viewport = page.viewportSize()!;
        const box = await tile.boundingBox();
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
        const pageHeight = await page.evaluate(
          () => document.documentElement.scrollHeight,
        );
        expect(pageHeight).toBeLessThanOrEqual(viewport.height);
      }
      const minHeight =
        testInfo.project.name === "tablet-large-1920x1200" ? 56 : 44;
      const link = await tile.getByRole("link").boundingBox();
      expect(link!.height).toBeGreaterThanOrEqual(minHeight);
      await expectNoHorizontalOverflow(page);
      await axeScan(page, testInfo, "/dashboard/today?mode=fridge (use soon)");
    } finally {
      await withDb(removeBoardInventory);
    }
  });

  test("parent sets a member colour and a weather place in family settings", async ({
    page,
  }, testInfo) => {
    test.skip(
      !["desktop-1366x768", "phone-390x844"].includes(testInfo.project.name),
      "Settings flow: one wide and one phone layout.",
    );
    let searched = "";
    // Answered in the browser: the server never calls Open-Meteo in E2E.
    await page.route("**/api/family/board-settings/places**", async (route) => {
      searched = new URL(route.request().url()).searchParams.get("q") ?? "";
      await route.fulfill({ json: { places: [WEATHER_PLACE] } });
    });
    try {
      await page.goto("/dashboard/family/settings");
      const section = page.getByTestId("board-settings");
      await expect(
        section.getByRole("heading", { name: "Today board" }),
      ).toBeVisible();
      await expect(section.getByTestId("weather-privacy-note")).toContainText(
        "Open-Meteo",
      );
      const toggle = section.getByLabel("Show weather on the Today board");
      await expect(toggle).not.toBeChecked();
      await expect(toggle).toBeDisabled();

      // Member colour (the picker lists colour names, not colour alone).
      await section.getByLabel("Casey Fixture-A").selectOption({
        label: "Orange",
      });
      await expect(section.getByRole("status")).toContainText(
        "Casey Fixture-A's colour saved.",
      );

      await section.getByLabel("Find a town or city").fill("Toronto");
      await section.getByRole("button", { name: "Search" }).click();
      await section.getByRole("button", { name: WEATHER_PLACE.label }).click();
      expect(searched).toBe("Toronto");
      await expect(section.getByRole("status")).toContainText(
        `Place set to ${WEATHER_PLACE.label}.`,
      );
      // Serve the forecast from the cache so the board never fetches.
      await withDb(seedWeatherCache);
      // Saved on the server first, then shown checked (not optimistic).
      await toggle.click();
      await expect(toggle).toBeChecked();
      await expect(section.getByRole("status")).toContainText(
        "Weather is on for the board.",
      );

      const stored = await withDb(
        async (db) =>
          (
            await db.query(
              `SELECT weather_enabled, weather_latitude, weather_longitude, weather_label FROM "Family" WHERE id = $1`,
              [A.family],
            )
          ).rows[0],
      );
      expect(stored).toEqual({
        weather_enabled: true,
        weather_latitude: WEATHER_PLACE.latitude,
        weather_longitude: WEATHER_PLACE.longitude,
        weather_label: WEATHER_PLACE.label,
      });

      await openBoard(page, "/dashboard/today");
      await expect(page.getByTestId("board-weather")).toContainText("-3°C");
      await expect(
        region(page, "chores")
          .getByTestId("chore-person")
          .nth(0)
          .locator('[data-member-color="orange"]'),
      ).toHaveCount(1);
    } finally {
      await withDb(disableWeather);
    }
  });

  test("@visual fridge view baseline", async ({ page }, testInfo) => {
    test.skip(
      ![...LANDSCAPE_HUBS, "tablet-portrait-800x1280"].includes(
        testInfo.project.name,
      ),
      "Fridge baselines are kept for the tablet sizes only.",
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

  test("@visual fridge hub with weather baseline", async ({
    page,
  }, testInfo) => {
    test.skip(
      !LANDSCAPE_HUBS.includes(testInfo.project.name),
      "The weather hub baseline is kept for the two 16:10 landscape sizes.",
    );
    await withDb(enableWeather);
    try {
      await openBoard(page, "/dashboard/today?mode=fridge");
      await expect(page.getByTestId("board-weather")).toBeVisible();
      await page.mouse.move(0, 0);
      await expect(page).toHaveScreenshot("fridge-hub-weather.png", {
        fullPage: true,
        mask: [
          page.getByTestId("board-clock"),
          page.getByTestId("board-updated"),
        ],
      });
    } finally {
      await withDb(disableWeather);
    }
  });
});

test.describe("Today board: Family A child", () => {
  test.use({ storageState: authFile("childA") });

  test("opens the shared board with only links a child can use", async ({
    page,
  }, testInfo) => {
    await openBoard(page, "/dashboard/today?mode=fridge");
    await expect(page).toHaveURL(/\/dashboard\/today\?mode=fridge$/);
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
    expect(hrefs).toContain("/dashboard/lists/groceries");

    // Board settings are parent-only (#262).
    const settingsRes = await page.request.get("/api/family/board-settings");
    expect(settingsRes.status()).toBe(403);
    const placesRes = await page.request.get(
      "/api/family/board-settings/places?q=Toronto",
    );
    expect(placesRes.status()).toBe(403);

    await expectNoCanaries(page);
    await axeScan(page, testInfo, "/dashboard/today?mode=fridge (child)");
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
    // The parent gets a next step instead of only empty regions.
    await expect(page.getByTestId("get-started")).toBeVisible();
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
