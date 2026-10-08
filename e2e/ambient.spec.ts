/**
 * Visible sync and the calm display (#271) on the Family A fridge board.
 *
 * Runs in `fridge-landscape-1280x800` and `tablet-portrait-800x1280` only.
 * Uses the pinned browser clock (`page.clock`, e2e/support/test.ts) to pass
 * idle time and polling intervals. Spec-owned rows, inserted before the file
 * and removed after it: `fx_e2e_ambient_dinner` (tonight's dinner),
 * `fx_e2e_ambient_upload` (an Upload row of Family A; its image is answered by
 * `page.route` in the browser, so no file is written), and
 * `fx_e2e_ambient_event` (inserted mid-test to prove change detection). Family
 * A's calm-display settings are reset to the defaults (5 minutes, night hours
 * off, no photos) before and after the file.
 */
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import pg from "pg";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { E2E_ANCHOR, authFile } from "./support/env";
import { expect, test } from "./support/test";

const A = FIXTURE_IDS.familyA;
const MIN = 60 * 1000;
const PROJECTS = ["fridge-landscape-1280x800", "tablet-portrait-800x1280"];

const IDS = {
  dinner: "fx_e2e_ambient_dinner",
  upload: "fx_e2e_ambient_upload",
  event: "fx_e2e_ambient_event",
};
const DINNER = "Ambient pasta night";
const EVENT = "Ambient sync check";
/** Stored-filename shape (16 hex + extension); never written to disk. */
const PHOTO_FILE = "e2e0ab1e00000271.png";
/** 1x1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const at = (offsetMs: number) => new Date(E2E_ANCHOR.getTime() + offsetMs);
const today = () =>
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

async function resetDisplay(db: pg.Client) {
  await db.query(
    `UPDATE "Family" SET ambient_idle_minutes = 5, night_start = NULL, night_end = NULL, ambient_photo_ids = '{}' WHERE id = $1`,
    [A.family],
  );
}

async function cleanup(db: pg.Client) {
  await resetDisplay(db);
  await db.query(`DELETE FROM "Event" WHERE id = $1`, [IDS.event]);
  await db.query(`DELETE FROM "FamilyMeal" WHERE id = $1`, [IDS.dinner]);
  await db.query(`DELETE FROM "Upload" WHERE id = $1`, [IDS.upload]);
}

test.beforeAll(async () => {
  await withDb(async (db) => {
    await cleanup(db);
    const now = new Date();
    await db.query(
      `INSERT INTO "FamilyMeal" (id, family_id, date, meal_type, recipe_name, cook_id, created_by, created_at)
       VALUES ($1, $2, $3, 'dinner', $4, $5, $5, $6)`,
      [IDS.dinner, A.family, today(), DINNER, A.parent, now],
    );
    await db.query(
      `INSERT INTO "Upload" (id, family_id, uploaded_by, filename, content_type, size_bytes, created_at)
       VALUES ($1, $2, $3, $4, 'image/png', $5, $6)`,
      [IDS.upload, A.family, A.parent, PHOTO_FILE, PNG.length, now],
    );
  });
});

test.afterAll(async () => {
  await withDb(cleanup);
});

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    !PROJECTS.includes(testInfo.project.name),
    "calm display runs at 1280x800 and 800x1280",
  );
  await page.route(`**/api/files/chores/${PHOTO_FILE}`, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
  );
});

test.use({ storageState: authFile("parentA") });

const board = (page: Page) => page.getByTestId("today-board");
const cover = (page: Page) => page.getByTestId("ambient-cover");

async function openFridge(page: Page) {
  await page.goto("/dashboard/today?mode=fridge");
  await expect(page.getByTestId("region-today")).toBeVisible();
  await expect(board(page).getByTestId("board-updated")).toHaveText(
    "Updated just now",
  );
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

test("re-fetches the board promptly when the household changes", async ({
  page,
}) => {
  await openFridge(page);
  await expect(page.getByTestId("region-today")).not.toContainText(EVENT);

  // Someone adds an event on their phone.
  await withDb((db) =>
    db.query(
      `INSERT INTO "Event" (id, family_id, title, start_time, end_time, event_type, is_task, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'family', false, $6, now(), now())`,
      [IDS.event, A.family, EVENT, at(90 * MIN), at(120 * MIN), A.parent],
    ),
  );
  try {
    // The next version check (about 25 s) sees the change and re-requests the page.
    const refreshed = page.waitForRequest(
      (req) =>
        req.url().includes("/dashboard/today") && Boolean(req.headers()["rsc"]),
    );
    await page.clock.runFor(30 * 1000);
    await refreshed;
    await expect(page.getByTestId("region-today")).toContainText(EVENT);
    await expect(board(page).getByTestId("board-updated")).toHaveText(
      "Updated just now",
    );
    await expect(page.getByTestId("board-sync-announce")).toHaveText(
      "The board has been updated.",
    );
  } finally {
    await withDb((db) =>
      db.query(`DELETE FROM "Event" WHERE id = $1`, [IDS.event]),
    );
  }
});

test("fades to the calm frame after five idle minutes; a tap returns to the board without following the link underneath", async ({
  page,
}, testInfo) => {
  await openFridge(page);
  const exit = page.getByRole("link", { name: "Exit fridge mode" });
  const box = (await exit.boundingBox())!;

  await page.clock.runFor(4 * MIN);
  await expect(cover(page)).toHaveCount(0);
  await page.clock.runFor(1 * MIN + 20 * 1000);
  await expect(cover(page)).toBeVisible();
  await expect(cover(page)).toHaveAttribute("data-ambient", "true");
  await expect(cover(page)).toHaveAttribute("data-dim", "false");
  // Clock, date, the next event (title and time) and tonight's dinner; no
  // weather (off for the household) and no photos (none chosen).
  await expect(page.getByTestId("ambient-clock")).toContainText(/7:0[5-6] AM/);
  await expect(page.getByTestId("ambient-date")).toHaveText(
    "Monday, January 5",
  );
  await expect(page.getByTestId("ambient-next")).toContainText(
    "Next · 9:00 AM",
  );
  await expect(page.getByTestId("ambient-next")).toContainText(
    "Dentist (Casey)",
  );
  await expect(page.getByTestId("ambient-dinner")).toContainText(DINNER);
  await expect(page.getByTestId("ambient-weather")).toHaveCount(0);
  await expect(page.getByTestId("ambient-photo")).toHaveCount(0);
  await expect(page.getByText("Tap anywhere to show the board")).toBeVisible();
  // The board underneath is inert: out of the focus order and a11y tree.
  await expect(board(page)).toHaveAttribute("inert", "");
  await expectNoSeriousAxe(page, testInfo, "calm frame");

  // Tap exactly where "Exit fridge mode" is: only the board comes back.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(cover(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard\/today\?mode=fridge$/);
  await expect(board(page)).toHaveAttribute("data-mode", "fridge");
  await expect(board(page)).not.toHaveAttribute("inert", "");
  // The idle clock restarted: still the board a minute later.
  await page.clock.runFor(1 * MIN);
  await expect(cover(page)).toHaveCount(0);
});

test("a key press returns to the board and does nothing else", async ({
  page,
}, testInfo) => {
  await openFridge(page);
  await page.getByRole("link", { name: "Exit fridge mode" }).focus();
  await page.clock.runFor(5 * MIN + 20 * 1000);
  await expect(cover(page)).toBeVisible();
  const wake = cover(page).getByRole("button", {
    name: "Show the board",
    exact: true,
  });
  await expect(wake).toBeFocused();
  const target = await wake.boundingBox();
  expect(target).not.toBeNull();
  expect(target!.width).toBeGreaterThanOrEqual(44);
  expect(target!.height).toBeGreaterThanOrEqual(44);
  expect(await wake.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe(
    "none",
  );
  const shots = path.join(process.cwd(), "test-results", "fridge-wake");
  await mkdir(shots, { recursive: true });
  await page.screenshot({
    path: path.join(shots, `${testInfo.project.name}-focused-calm-wake.png`),
  });
  await page.keyboard.press("Enter");
  await expect(cover(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard\/today\?mode=fridge$/);
});

test("a parent sets a shorter idle time, night hours and a household photo; the fridge dims and shows it", async ({
  page,
}, testInfo) => {
  await page.goto("/dashboard/family/settings");
  const calm = page.getByTestId("calm-display-settings");
  await expect(calm).toBeVisible();
  await calm.getByLabel("Fade to the calm screen").selectOption("1");
  await expect(page.getByText("The board fades after 1 minute")).toBeVisible();

  const night = page.getByTestId("night-hours-settings");
  await night.getByLabel("Dim the screen at night").click();
  await expect(page.getByText("Night hours are on.")).toBeVisible();
  // 07:00 in Toronto at the anchor: inside 06:00-08:00.
  await night.getByLabel("From").fill("06:00");
  await night.getByLabel("Until").fill("08:00");
  await night.getByRole("button", { name: "Save night hours" }).click();
  await expect(page.getByText("Night hours saved.")).toBeVisible();

  const photos = page.getByTestId("calm-photos-settings");
  await expect(photos).toContainText("not shown on a paired shared tablet");
  const ours = photos
    .getByRole("listitem")
    .filter({ has: page.locator(`img[src$="${PHOTO_FILE}"]`) });
  await ours.getByRole("checkbox").click();
  await expect(page.getByText("Photo added to the calm screen.")).toBeVisible();

  const stored = await withDb((db) =>
    db
      .query(
        `SELECT ambient_idle_minutes, night_start, night_end, ambient_photo_ids FROM "Family" WHERE id = $1`,
        [A.family],
      )
      .then((r) => r.rows[0]),
  );
  expect(stored).toEqual({
    ambient_idle_minutes: 1,
    night_start: "06:00",
    night_end: "08:00",
    ambient_photo_ids: [IDS.upload],
  });

  await openFridge(page);
  await page.clock.runFor(1 * MIN + 20 * 1000);
  await expect(cover(page)).toBeVisible();
  await expect(cover(page)).toHaveAttribute("data-dim", "true");
  await expect(page.getByTestId("night-dim")).toBeVisible();
  const wake = cover(page).getByRole("button", {
    name: "Show the board",
    exact: true,
  });
  await expect(wake).toBeVisible();
  const target = await wake.boundingBox();
  expect(target!.width).toBeGreaterThanOrEqual(44);
  expect(target!.height).toBeGreaterThanOrEqual(44);
  await expectNoSeriousAxe(page, testInfo, "visible night wake");
  const shots = path.join(process.cwd(), "test-results", "fridge-wake");
  await mkdir(shots, { recursive: true });
  await page.screenshot({
    path: path.join(shots, `${testInfo.project.name}-night-wake.png`),
  });
  await expect(page.getByTestId("ambient-photo")).toHaveAttribute(
    "src",
    `/api/files/chores/${PHOTO_FILE}`,
  );
  await cover(page).click();
  await expect(cover(page)).toHaveCount(0);

  await withDb(resetDisplay);
});
