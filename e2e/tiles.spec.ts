/**
 * Board tiles act directly (#274; SHARED_DEVICE.md §9.2, §6.4).
 *
 * - Person session: on /dashboard/today the parent taps a chore row (marked
 *   done through POST /api/chores/complete) and a grocery row (ticked through
 *   the #162 queue, PATCH /api/lists/items/update with an Idempotency-Key),
 *   each with Undo in the toast; the database follows both ways.
 * - Paired tablet with the household opt-in turned on for the test: tapping a
 *   grocery row asks "Who's this?", then ticks it as that member through the
 *   device queue; a chore tap completes it as that member and its Undo
 *   reopens it; the audit rows name the member and the tablet. With the
 *   opt-in off the tiles are plain text.
 * - Elevated setup on the tablet: parent mode → "Board settings" changes the
 *   calm-display minutes and turns tablet writes off; no photo picker.
 *
 * Spec-owned rows `fx_e2e_tiles_*`: a Family A grocery list with one old open
 * item (so it is first on the board) and one chore due on the anchor day for
 * the Family A child. Inserted before each test, deleted after the file with
 * the activity, idempotency and device rows the tests write. Family A's
 * `device_writes_enabled` and calm-display minutes are reset afterwards.
 */
import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import pg from "pg";
import { FIXTURE_IDS, FIXTURE_PASSWORD } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { E2E_ANCHOR, authFile } from "./support/env";
import { expect, test } from "./support/test";

const A = FIXTURE_IDS.familyA;
const FAMILIES = [FIXTURE_IDS.familyA.family, FIXTURE_IDS.familyB.family];
const IDS = {
  list: "fx_e2e_tiles_list",
  item: "fx_e2e_tiles_item",
  chore: "fx_e2e_tiles_chore",
};
const ITEM = "E2E tiles oat milk";
const CHORE = "E2E tiles feed the fish";
const PARENT_NAME = "Avery Fixture-A";
const CHILD_NAME = "Casey Fixture-A";
const PIN = "246810";
const PROJECTS = ["fridge-landscape-1280x800", "desktop-1366x768"];
const TABLET_PROJECTS = ["fridge-landscape-1280x800"];

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

async function removeRows(db: pg.Client) {
  await db.query(
    `DELETE FROM "Activity" WHERE family_id = $1 AND title LIKE $2`,
    [A.family, `%${CHORE}%`],
  );
  await db.query(`DELETE FROM "Chore" WHERE id = $1`, [IDS.chore]);
  await db.query(`DELETE FROM "List" WHERE id = $1`, [IDS.list]);
  await db.query(
    `DELETE FROM "IdempotencyRecord" WHERE family_id = $1 AND (scope LIKE 'device:%' OR action IN ('list-item.update'))`,
    [A.family],
  );
  await db.query(`DELETE FROM "HouseholdDevice" WHERE family_id = ANY($1)`, [
    FAMILIES,
  ]);
  await db.query(`DELETE FROM "DevicePairing" WHERE family_id = ANY($1)`, [
    FAMILIES,
  ]);
  await db.query(`DELETE FROM "DeviceAuditEvent" WHERE family_id = ANY($1)`, [
    FAMILIES,
  ]);
  await db.query(`DELETE FROM "ParentElevationPin" WHERE family_id = ANY($1)`, [
    FAMILIES,
  ]);
  await db.query(`DELETE FROM "RateLimitEntry" WHERE key LIKE 'device-%'`);
  await db.query(
    `UPDATE "Family" SET device_writes_enabled = false, ambient_idle_minutes = 5 WHERE id = $1`,
    [A.family],
  );
}

async function insertRows(db: pg.Client) {
  const old = new Date("2020-01-01T00:00:00Z");
  await db.query(
    `INSERT INTO "List" (id, family_id, name, type, created_by, created_at, updated_at)
     VALUES ($1, $2, 'E2E tiles groceries', 'grocery', $3, $4, $4)`,
    [IDS.list, A.family, A.parent, old],
  );
  await db.query(
    `INSERT INTO "ListItem" (id, list_id, content, added_by, position, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 1, $5, $5)`,
    [IDS.item, IDS.list, ITEM, A.parent, old],
  );
  await db.query(
    `INSERT INTO "Chore" (id, family_id, title, assigned_to, due_date, status, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)`,
    [
      IDS.chore,
      A.family,
      CHORE,
      A.child,
      E2E_ANCHOR.toISOString().slice(0, 10),
      A.parent,
      old,
    ],
  );
}

async function row<T = Record<string, unknown>>(
  sql: string,
  params: unknown[],
): Promise<T | undefined> {
  return withDb(async (db) => (await db.query(sql, params)).rows[0] as T);
}

const itemRow = () =>
  row<{ checked: boolean; checked_by: string | null }>(
    `SELECT checked, checked_by FROM "ListItem" WHERE id = $1`,
    [IDS.item],
  );
const choreRow = () =>
  row<{ status: string }>(`SELECT status FROM "Chore" WHERE id = $1`, [
    IDS.chore,
  ]);

test.beforeEach(async ({}, testInfo) => {
  test.skip(
    !PROJECTS.includes(testInfo.project.name),
    "Tiles run in the fridge landscape and desktop projects",
  );
  await withDb(async (db) => {
    await removeRows(db);
    await insertRows(db);
  });
});

test.afterAll(async () => {
  await withDb(removeRows);
});

const region = (page: Page, name: string) => page.getByTestId(`region-${name}`);

test.describe("person board", () => {
  test.use({ storageState: authFile("parentA") });

  test("a chore tap and a grocery tap act at once, with Undo", async ({
    page,
  }) => {
    await page.goto("/dashboard/today");
    const chores = region(page, "chores");
    await expect(chores).toContainText(CHORE);

    // Chore: POST /api/chores/complete, then Undo → /api/chores/uncomplete.
    const completed = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/chores/complete") &&
        r.request().method() === "POST",
    );
    await chores
      .getByRole("button", { name: `Mark ${CHORE} done, Casey` })
      .click();
    expect((await completed).status()).toBe(200);
    await expect(chores).not.toContainText(CHORE);
    await expect.poll(async () => (await choreRow())?.status).toBe("completed");
    const choreToast = page
      .getByTestId("undo-toast")
      .filter({ hasText: `“${CHORE}” done` });
    await expect(choreToast).toBeVisible();
    const reopened = page.waitForResponse((r) =>
      r.url().endsWith("/api/chores/uncomplete"),
    );
    await choreToast.getByRole("button", { name: "Undo" }).click();
    expect((await reopened).status()).toBe(200);
    await expect.poll(async () => (await choreRow())?.status).toBe("pending");
    await expect(chores).toContainText(CHORE);

    // Grocery: the #162 queue sends the explicit state with an Idempotency-Key.
    const groceries = region(page, "groceries");
    const ticked = page.waitForRequest(
      (r) =>
        r.url().endsWith("/api/lists/items/update") && r.method() === "PATCH",
    );
    await groceries.getByRole("button", { name: `Tick off ${ITEM}` }).click();
    const tickRequest = await ticked;
    expect(tickRequest.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(tickRequest.postDataJSON()).toEqual({
      itemId: IDS.item,
      checked: true,
    });
    await expect(groceries).not.toContainText(ITEM);
    await expect
      .poll(async () => await itemRow())
      .toEqual({ checked: true, checked_by: A.parent });
    const itemToast = page
      .getByTestId("undo-toast")
      .filter({ hasText: `“${ITEM}” ticked off` });
    await itemToast.getByRole("button", { name: "Undo" }).click();
    await expect(groceries).toContainText(ITEM);
    await expect.poll(async () => (await itemRow())?.checked).toBe(false);

    // The heading opens the section; no "Open …" buttons remain.
    await expect(
      chores.getByRole("link", { name: /Chores today\s*, open chores/ }),
    ).toHaveAttribute("href", "/dashboard/chores");
    await expect(page.getByRole("link", { name: /^Open / })).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Paired tablet

async function openParent(
  browser: Browser,
  testInfo: TestInfo,
): Promise<{ context: BrowserContext; page: Page }> {
  const use = testInfo.project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport,
    hasTouch: use.hasTouch,
    locale: use.locale,
    timezoneId: use.timezoneId,
    colorScheme: "light",
    reducedMotion: "reduce",
    extraHTTPHeaders: use.extraHTTPHeaders,
    storageState: authFile("parentA"),
  });
  const page = await context.newPage();
  await page.clock.install({ time: E2E_ANCHOR });
  return { context, page };
}

async function send(
  page: Page,
  method: "POST" | "PUT" | "PATCH",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: string }> {
  return page.evaluate(
    async ({ m, p, b }) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((c) => c.startsWith("csrf_token="))
          ?.slice("csrf_token=".length) ?? "";
      const res = await fetch(p, {
        method: m,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: b === undefined ? undefined : JSON.stringify(b),
      });
      return { status: res.status, body: await res.text() };
    },
    { m: method, p: path, b: body },
  );
}

/** Pair the tablet through the public and parent APIs (the UI is covered by device.spec.ts). */
async function pair(parent: Page, tablet: Page) {
  await parent.goto("/dashboard/settings/devices");
  const created = await send(parent, "POST", "/api/family/devices/pairings", {
    label: "Kitchen tablet",
  });
  expect(created.status, created.body).toBe(201);
  const { pairingId, code } = JSON.parse(created.body);
  await tablet.goto("/device/pair");
  const claim = await send(tablet, "POST", "/api/device/pair/claim", {
    code,
    platform: "web",
    appVersion: "web",
  });
  expect(claim.status, claim.body).toBe(200);
  const { claimToken, confirmDigits } = JSON.parse(claim.body);
  const confirm = await send(
    parent,
    "POST",
    `/api/family/devices/pairings/${pairingId}/confirm`,
    { digits: confirmDigits },
  );
  expect(confirm.status, confirm.body).toBe(200);
  const status = await send(tablet, "POST", "/api/device/pair/status", {
    claimToken,
  });
  expect(JSON.parse(status.body).status).toBe("paired");
}

test.describe("paired tablet", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      !TABLET_PROJECTS.includes(testInfo.project.name),
      "Tablet tiles run in the fridge landscape project",
    );
  });

  test("with the household opt-in on: Who's this?, a grocery tick and a chore, attributed and audited", async ({
    page: tablet,
    browser,
  }, testInfo) => {
    const parent = await openParent(browser, testInfo);
    try {
      await pair(parent.page, tablet);

      // Off by default: the tiles are plain text.
      await tablet.goto("/device/today");
      await expect(region(tablet, "groceries")).toContainText(ITEM);
      await expect(region(tablet, "groceries").getByRole("button")).toHaveCount(
        0,
      );
      await expect(region(tablet, "chores").getByRole("button")).toHaveCount(0);

      await withDb((db) =>
        db.query(
          `UPDATE "Family" SET device_writes_enabled = true WHERE id = $1`,
          [A.family],
        ),
      );
      await tablet.reload();

      // Grocery tick: "Who's this?" first, then the device queue.
      const groceries = region(tablet, "groceries");
      const ticked = tablet.waitForResponse(
        (r) =>
          r.url().endsWith(`/api/device/lists/items/${IDS.item}`) &&
          r.request().method() === "PATCH",
      );
      await groceries.getByRole("button", { name: `Tick off ${ITEM}` }).click();
      const who = tablet.getByTestId("who-is-this");
      await expect(who).toBeVisible();
      await expect(
        who.getByRole("button", { name: PARENT_NAME }),
      ).toBeVisible();
      await who.getByRole("button", { name: CHILD_NAME }).click();
      const tickResponse = await ticked;
      expect(tickResponse.status()).toBe(200);
      expect(tickResponse.request().headers()["idempotency-key"]).toMatch(
        /^[0-9a-f-]{36}$/,
      );
      expect(tickResponse.request().postDataJSON()).toEqual({
        checked: true,
        actingMemberId: A.child,
      });
      await expect(groceries).not.toContainText(ITEM);
      await expect(
        tablet
          .getByTestId("undo-toast")
          .filter({ hasText: "ticked off by Casey" }),
      ).toBeVisible();
      await expect(tablet.getByTestId("device-actor")).toContainText(
        `Ticking off as ${CHILD_NAME}`,
      );
      await expect
        .poll(async () => await itemRow())
        .toEqual({ checked: true, checked_by: A.child });

      // Chore: no second "Who's this?" within two minutes.
      const chores = region(tablet, "chores");
      const completed = tablet.waitForResponse((r) =>
        r.url().endsWith(`/api/device/chores/${IDS.chore}/complete`),
      );
      await chores
        .getByRole("button", { name: `Mark ${CHORE} done, Casey` })
        .click();
      expect((await completed).status()).toBe(200);
      await expect(who).toBeHidden();
      await expect
        .poll(async () => (await choreRow())?.status)
        .toBe("completed");
      const choreToast = tablet
        .getByTestId("undo-toast")
        .filter({ hasText: `“${CHORE}” done by Casey` });
      await expect(choreToast).toContainText("A parent will check it.");
      await expect(tablet.locator("body")).not.toContainText(/\bXP\b|points/);

      const audit = await withDb(
        async (db) =>
          (
            await db.query(
              `SELECT actor_user_id, metadata FROM "DeviceAuditEvent"
             WHERE family_id = $1 AND type = 'device.member_action' ORDER BY created_at`,
              [A.family],
            )
          ).rows,
      );
      expect(audit).toEqual([
        {
          actor_user_id: A.child,
          metadata: {
            action: "list_item_check",
            targetType: "list_item",
            targetId: IDS.item,
          },
        },
        {
          actor_user_id: A.child,
          metadata: {
            action: "chore_complete",
            targetType: "chore",
            targetId: IDS.chore,
          },
        },
      ]);

      // The tablet's own Undo within its window reopens the chore.
      const reopened = tablet.waitForResponse((r) =>
        r.url().endsWith(`/api/device/chores/${IDS.chore}/uncomplete`),
      );
      await choreToast.getByRole("button", { name: "Undo" }).click();
      expect((await reopened).status()).toBe(200);
      await expect.poll(async () => (await choreRow())?.status).toBe("pending");
    } finally {
      await parent.context.close();
    }
  });

  test("a parent changes the board settings on the tablet under parent mode", async ({
    page: tablet,
    browser,
  }, testInfo) => {
    const parent = await openParent(browser, testInfo);
    try {
      await pair(parent.page, tablet);
      await parent.page.goto("/dashboard/settings");
      const pin = await send(parent.page, "PUT", "/api/users/elevation-pin", {
        pin: PIN,
        currentPassword: FIXTURE_PASSWORD,
      });
      expect(pin.status, pin.body).toBe(204);
      await withDb((db) =>
        db.query(
          `UPDATE "Family" SET device_writes_enabled = true WHERE id = $1`,
          [A.family],
        ),
      );

      await tablet.goto("/device/today");
      await expect(region(tablet, "today")).toBeVisible();
      // Without parent mode the elevated route refuses.
      const refused = await tablet.evaluate(async () => {
        const res = await fetch("/api/device/elevated/board-settings");
        return { status: res.status, body: await res.json() };
      });
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe("ELEVATION_REQUIRED");

      await tablet.getByRole("button", { name: "Parent", exact: true }).click();
      const sheet = tablet.getByTestId("elevation-sheet");
      await sheet.getByRole("button", { name: PARENT_NAME }).click();
      const pad = sheet.getByRole("group", {
        name: `Tablet PIN pad for ${PARENT_NAME}`,
      });
      for (const digit of PIN) {
        await pad.getByRole("button", { name: digit, exact: true }).click();
      }
      await expect(tablet.getByTestId("elevated-banner")).toBeVisible();

      await tablet.getByRole("button", { name: "Board settings" }).click();
      const dialog = tablet.getByTestId("device-board-settings");
      await expect(
        dialog.getByTestId("board-member-color").first(),
      ).toBeVisible();
      // Photos stay off paired tablets (O-15).
      await expect(dialog.getByTestId("calm-photos-settings")).toHaveCount(0);

      await dialog.getByLabel("Fade to the calm screen").selectOption("10");
      await expect(dialog).toContainText(
        "The board fades after 10 minutes without a touch.",
      );
      await dialog
        .getByLabel("Let the family tablet tick things off")
        // Controlled by the saved state: it flips once the server answers.
        .click();
      await expect(dialog).toContainText(
        "The family tablet is read-only again.",
      );

      const family = await row<{
        ambient_idle_minutes: number;
        device_writes_enabled: boolean;
      }>(
        `SELECT ambient_idle_minutes, device_writes_enabled FROM "Family" WHERE id = $1`,
        [A.family],
      );
      expect(family).toEqual({
        ambient_idle_minutes: 10,
        device_writes_enabled: false,
      });
      const audit = await withDb(
        async (db) =>
          (
            await db.query(
              `SELECT actor_user_id, metadata FROM "DeviceAuditEvent"
             WHERE family_id = $1 AND type = 'device.elevated_action' ORDER BY created_at`,
              [A.family],
            )
          ).rows,
      );
      expect(audit.map((a) => a.metadata.sections)).toEqual([
        ["display"],
        ["deviceWrites"],
      ]);
      expect(audit.every((a) => a.actor_user_id === A.parent)).toBe(true);

      await dialog.getByRole("button", { name: "Close" }).click();
      // Writes are off again: the tiles go back to plain text.
      await expect(region(tablet, "groceries").getByRole("button")).toHaveCount(
        0,
      );
    } finally {
      await parent.context.close();
    }
  });
});
