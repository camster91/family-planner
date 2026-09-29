/**
 * Per-member notification preferences (#286, PR101 D-5) against the seeded
 * fixture households.
 *
 * - Parent (Family A): Settings → Notifications shows three switches; turning
 *   "Calendar events" off sends PATCH /api/users/preferences with an
 *   Idempotency-Key, the database says off, a reload keeps it; targets >= 44px;
 *   axe (serious/critical) scoped to the section (the rest of Settings has
 *   older findings, see docs/testing/E2E.md Known gaps).
 * - Child (Family A): cannot open Settings, so the user menu → Notifications
 *   opens the same switches in a dialog; "Chores and rewards" off is stored;
 *   offline shows a notice and disables the switches; Escape returns focus to
 *   the menu button; a body naming another member is 400; axe on the dialog.
 * - Enforcement: with the child's chores muted, a parent's chore notice to the
 *   child creates nothing (`delivered: false`) and a `system` notice still
 *   arrives.
 *
 * Spec-owned state: the notify_* columns of the Family A parent and child are
 * set back to true before and after the file, and the notices it sends are
 * deleted. Runs at 390x844 and 1366x768. No baseline includes it.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import pg from "pg";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { authFile } from "./support/env";
import { goOffline, goOnline } from "./support/network";
import { browserFetch, browserSend, expect, test } from "./support/test";

const A = FIXTURE_IDS.familyA;
const PROJECTS = ["phone-390x844", "desktop-1366x768"];
const NOTICE = "E2E notifications spec notice";

function onlyOnSomeProjects(testInfo: TestInfo) {
  test.skip(
    !PROJECTS.includes(testInfo.project.name),
    "notification preferences run at 390x844 and 1366x768",
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

async function resetSpecState() {
  await withDb(async (db) => {
    await db.query(
      `UPDATE "User" SET notify_chores = true, notify_events = true, notify_messages = true WHERE id = ANY($1)`,
      [[A.parent, A.child]],
    );
    await db.query(`DELETE FROM "Notification" WHERE title = $1`, [NOTICE]);
  });
}

async function stored(userId: string) {
  return withDb(async (db) => {
    const { rows } = await db.query(
      `SELECT notify_chores AS chores, notify_events AS events, notify_messages AS messages FROM "User" WHERE id = $1`,
      [userId],
    );
    return rows[0] as { chores: boolean; events: boolean; messages: boolean };
  });
}

async function axeSerious(page: Page, include: string) {
  const axe = await new AxeBuilder({ page })
    .include(include)
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return axe.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    );
}

async function expectTargets44(page: Page, scope: string) {
  for (const s of await page.locator(`${scope} [role="switch"]`).all()) {
    const box = await s.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  }
}

test.beforeAll(resetSpecState);
test.afterAll(resetSpecState);

test.describe("notification preferences (Family A parent, Settings)", () => {
  test.use({ storageState: authFile("parentA") });

  test("switches save on their own and survive a reload", async ({
    page,
  }, testInfo) => {
    onlyOnSomeProjects(testInfo);
    await resetSpecState();
    await page.goto("/dashboard/settings");
    const section = page.getByTestId("notification-preferences");
    const events = section.getByRole("switch", { name: "Calendar events" });
    await expect(events).toHaveAttribute("aria-checked", "true");
    await expect(
      section.getByRole("switch", { name: "Chores and rewards" }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      section.getByRole("switch", { name: "Family messages" }),
    ).toHaveAttribute("aria-checked", "true");
    await expectTargets44(page, '[data-testid="notification-preferences"]');

    const patch = page.waitForRequest(
      (r) =>
        r.url().endsWith("/api/users/preferences") && r.method() === "PATCH",
    );
    await events.click();
    const request = await patch;
    expect(request.headers()["idempotency-key"]).toMatch(
      /^[A-Za-z0-9_-]{16,128}$/,
    );
    expect(request.postDataJSON()).toEqual({ events: false });
    await expect(events).toHaveAttribute("aria-checked", "false");
    await expect(section.getByText("Calendar events: off.")).toBeVisible();
    await expect
      .poll(() => stored(A.parent))
      .toEqual({ chores: true, events: false, messages: true });

    await page.reload();
    await expect(
      page
        .getByTestId("notification-preferences")
        .getByRole("switch", { name: "Calendar events" }),
    ).toHaveAttribute("aria-checked", "false");
    // The child's switches are untouched.
    expect(await stored(A.child)).toEqual({
      chores: true,
      events: true,
      messages: true,
    });

    expect(
      await axeSerious(page, '[data-testid="notification-preferences"]'),
    ).toEqual([]);
  });
});

test.describe("notification preferences (Family A child, user menu)", () => {
  test.use({ storageState: authFile("childA") });

  test("opens from the user menu, saves, and goes quiet offline", async ({
    page,
  }, testInfo) => {
    onlyOnSomeProjects(testInfo);
    await resetSpecState();
    await page.goto("/dashboard");
    const menu = page.getByRole("button", { name: "User menu" });
    await menu.click();
    const item = page.getByRole("button", { name: "Notifications" });
    // The menu opens with a spring animation that starts at scale(0.92), so
    // measure once it has settled rather than mid-animation.
    await expect
      .poll(async () => (await item.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(44);
    await item.click();

    const dialog = page.getByRole("dialog", { name: "Notifications" });
    await expect(dialog).toBeVisible();
    const chores = dialog.getByRole("switch", { name: "Chores and rewards" });
    await expect(chores).toHaveAttribute("aria-checked", "true");
    await expectTargets44(
      page,
      '[data-testid="notification-preferences-dialog"]',
    );
    expect(
      await axeSerious(page, '[data-testid="notification-preferences-dialog"]'),
    ).toEqual([]);

    // Keyboard: focus the switch and press Space.
    await chores.focus();
    await page.keyboard.press("Space");
    await expect(chores).toHaveAttribute("aria-checked", "false");
    await expect
      .poll(() => stored(A.child))
      .toEqual({ chores: false, events: true, messages: true });

    await goOffline(page);
    await expect(dialog.getByText(/You're offline/)).toBeVisible();
    await expect(chores).toBeDisabled();
    await goOnline(page);
    await expect(dialog.getByText(/You're offline/)).toBeHidden();
    await expect(chores).toBeEnabled();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(menu).toBeFocused();

    // Direct API: own switches only; naming another member is refused.
    const own = await browserFetch(page, "/api/users/preferences");
    expect(JSON.parse(own.body)).toEqual({
      preferences: { chores: false, events: true, messages: true },
    });
    const other = await browserSend(page, "PATCH", "/api/users/preferences", {
      userId: A.parent,
      chores: false,
    });
    expect(other.status).toBe(400);
    expect((await stored(A.parent)).chores).toBe(true);
  });
});

test.describe("notification preferences are enforced", () => {
  test.use({ storageState: authFile("parentA") });

  test("a muted category creates nothing; a system notice still arrives", async ({
    page,
  }, testInfo) => {
    onlyOnSomeProjects(testInfo);
    await resetSpecState();
    await withDb((db) =>
      db.query(`UPDATE "User" SET notify_chores = false WHERE id = $1`, [
        A.child,
      ]),
    );
    await page.goto("/dashboard/settings");

    const muted = await browserSend(page, "POST", "/api/notifications", {
      userId: A.child,
      title: NOTICE,
      message: "Feed the fish",
      type: "chore",
    });
    expect(muted.status).toBe(200);
    expect(JSON.parse(muted.body)).toMatchObject({
      success: true,
      delivered: false,
      notification: null,
    });

    const always = await browserSend(page, "POST", "/api/notifications", {
      userId: A.child,
      title: NOTICE,
      message: "Home by six",
      type: "system",
    });
    expect(JSON.parse(always.body)).toMatchObject({ delivered: true });

    const rows = await withDb(async (db) => {
      const { rows } = await db.query(
        `SELECT type FROM "Notification" WHERE user_id = $1 AND title = $2`,
        [A.child, NOTICE],
      );
      return rows.map((r) => r.type as string);
    });
    expect(rows).toEqual(["system"]);
  });
});
