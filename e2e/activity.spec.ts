/**
 * Settings -> Recent changes (#285, PR101 D-4): /dashboard/settings/activity
 * and GET /api/audit against the seeded fixture households.
 *
 * Spec-owned `AuditLog` rows (`fx_e2e_activity_*`: two for Family A, one of
 * them made on the family tablet, and one Family B canary) are inserted before
 * the file and deleted after it, so seeded data and the visual baselines are
 * unchanged. Runs at 390x844 and 1366x768.
 *
 * - Parent (Family A): Settings links to Recent changes; the page lists the
 *   rows in plain words with who and where; never Family B's; targets >= 44px;
 *   no horizontal overflow; axe (serious/critical).
 * - Child (Family A): the page redirects home; the API answers 403.
 * - Family B parent: sees only its own row.
 */
import AxeBuilder from "@axe-core/playwright";
import type { TestInfo } from "@playwright/test";
import pg from "pg";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { authFile } from "./support/env";
import { browserFetch, expect, test } from "./support/test";

const A = FIXTURE_IDS.familyA;
const B = FIXTURE_IDS.familyB;
const PROJECTS = ["phone-390x844", "desktop-1366x768"];
const IDS = {
  aFeature: "fx_e2e_activity_a_feature",
  aTablet: "fx_e2e_activity_a_tablet",
  bCanary: "fx_e2e_activity_b_canary",
};

function onlyOnSomeProjects(testInfo: TestInfo) {
  test.skip(
    !PROJECTS.includes(testInfo.project.name),
    "recent changes journey runs at 390x844 and 1366x768",
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
  await db.query(`DELETE FROM "AuditLog" WHERE "id" = ANY($1)`, [
    Object.values(IDS),
  ]);
}

test.beforeAll(async () => {
  await withDb(async (db) => {
    await removeSpecRows(db);
    const insert = `INSERT INTO "AuditLog"
      ("id", "family_id", "actor_user_id", "actor_kind", "action", "target_type", "target_id", "summary", "created_at")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() - $9::interval)`;
    await db.query(insert, [
      IDS.aFeature,
      A.family,
      A.parent,
      "person",
      "feature.turned_on",
      "feature",
      "wishlist",
      "Turned on Wishlist",
      "1 hour",
    ]);
    await db.query(insert, [
      IDS.aTablet,
      A.family,
      A.parent,
      "device",
      "board_settings.changed",
      "family",
      A.family,
      "Changed the Today board settings: calm display",
      "2 hours",
    ]);
    await db.query(insert, [
      IDS.bCanary,
      B.family,
      B.parent,
      "person",
      "feature.turned_on",
      "feature",
      "wishlist",
      "Family B canary change",
      "1 hour",
    ]);
  });
});

test.afterAll(async () => {
  await withDb(removeSpecRows);
});

type Entry = { id: string; summary: string };

async function apiAudit(
  page: import("@playwright/test").Page,
): Promise<{ status: number; entries: Entry[] }> {
  const res = await browserFetch(page, "/api/audit?limit=50");
  const body = JSON.parse(res.body) as { entries?: Entry[] };
  return { status: res.status, entries: body.entries ?? [] };
}

test.describe("recent changes (Family A parent)", () => {
  test.use({ storageState: authFile("parentA") });

  test("Settings links to it and it lists the household's changes in plain words", async ({
    page,
  }, testInfo) => {
    onlyOnSomeProjects(testInfo);
    await page.goto("/dashboard/settings");
    const link = page.getByRole("link", { name: /Recent changes/ });
    await expect(link).toBeVisible();
    expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await link.click();
    await expect(page).toHaveURL(/\/dashboard\/settings\/activity$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Recent changes" }),
    ).toBeVisible();

    const list = page.getByTestId("activity-list");
    // Other specs write real audit rows with the same wording (the tiles spec
    // changes the board on the tablet), so find the spec-owned rows by id.
    const entry = (id: string) => list.locator(`[data-entry-id="${id}"]`);
    await expect(entry(IDS.aFeature)).toContainText("Turned on Wishlist");
    await expect(entry(IDS.aTablet)).toContainText(
      "Changed the Today board settings: calm display",
    );
    await expect(entry(IDS.aTablet)).toContainText(
      "Avery Fixture-A, on the family tablet",
    );
    await expect(page.getByText("Family B canary change")).toHaveCount(0);

    const back = page.getByRole("link", { name: "Settings" });
    expect((await back.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      axe.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => v.id),
    ).toEqual([]);
  });
});

test.describe("recent changes (Family A child)", () => {
  test.use({ storageState: authFile("childA") });

  test("the page is parent-only and the API refuses", async ({
    page,
  }, testInfo) => {
    onlyOnSomeProjects(testInfo);
    await page.goto("/dashboard/settings/activity");
    await expect(page).toHaveURL(/\/dashboard$/);
    const api = await apiAudit(page);
    expect(api.status).toBe(403);
    expect(api.entries).toEqual([]);
  });
});

test.describe("recent changes (Family B parent)", () => {
  test.use({ storageState: authFile("parentB") });

  test("sees only its own household", async ({ page }, testInfo) => {
    onlyOnSomeProjects(testInfo);
    await page.goto("/dashboard/settings/activity");
    const api = await apiAudit(page);
    expect(api.status).toBe(200);
    const ids = api.entries.map((e) => e.id);
    expect(ids).toContain(IDS.bCanary);
    expect(ids).not.toContain(IDS.aFeature);
    expect(ids).not.toContain(IDS.aTablet);
  });
});
