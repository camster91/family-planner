/**
 * Account and household deletion from Settings (D-3, F-3;
 * docs/product/ACCOUNT_DELETION.md). Runs in `phone-390x844` and
 * `desktop-1366x768` only.
 *
 * - Settings has no Two-Factor Authentication entry; Data Export downloads
 *   the JSON export.
 * - The only parent of a spec-owned household opens Delete Account, gets the
 *   household mode (invite link, member count), downloads the export from the
 *   dialog, types the password and the household name, and deletes it: the
 *   browser lands on /login with a notice, the database has no row of that
 *   household, and the fixture households are untouched.
 * - One of two parents of another spec-owned household deletes only their
 *   account by typing DELETE; the household stays and the chore they created
 *   now belongs to the other parent.
 *
 * Spec-owned rows `fx_e2e_acctdel_<project>_*` are inserted before each test
 * and removed after it (whatever the test left). They copy the fixture
 * parent's password hash, so FIXTURE_PASSWORD signs them in.
 */
import fs from "fs";
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import pg from "pg";
import { FIXTURE_IDS, FIXTURE_PASSWORD } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { expect, loginViaUi, test } from "./support/test";

const PROJECTS = ["phone-390x844", "desktop-1366x768"];

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

function ids(testInfo: TestInfo) {
  const p = `fx_e2e_acctdel_${testInfo.project.name.replace(/\W+/g, "_")}`;
  return {
    prefix: p,
    solo: {
      family: `${p}_solo`,
      parent: `${p}_solo_parent`,
      child: `${p}_solo_child`,
      chore: `${p}_solo_chore`,
    },
    duo: {
      family: `${p}_duo`,
      parent: `${p}_duo_parent`,
      parent2: `${p}_duo_parent2`,
      chore: `${p}_duo_chore`,
    },
    email: (id: string) => `${id.replace(/_/g, "-")}@example.test`,
  };
}

async function removeSpecRows(db: pg.Client, prefix: string) {
  await db.query(`DELETE FROM "Chore" WHERE family_id LIKE $1`, [`${prefix}%`]);
  await db.query(`DELETE FROM "User" WHERE id LIKE $1`, [`${prefix}%`]);
  await db.query(`DELETE FROM "Family" WHERE id LIKE $1`, [`${prefix}%`]);
  await db.query(
    `DELETE FROM "RateLimitEntry" WHERE key LIKE 'account-delete:%'`,
  );
}

async function seed(testInfo: TestInfo) {
  const x = ids(testInfo);
  await withDb(async (db) => {
    await removeSpecRows(db, x.prefix);
    const { rows } = await db.query(
      `SELECT password FROM "User" WHERE id = $1`,
      [FIXTURE_IDS.familyA.parent],
    );
    const hash = rows[0].password as string;
    const user = (
      id: string,
      name: string,
      role: string,
      family: string,
      created: string,
    ) =>
      db.query(
        `INSERT INTO "User" (id, email, password, name, role, family_id, email_verified, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7)`,
        [id, x.email(id), hash, name, role, family, created],
      );
    const chore = (
      id: string,
      family: string,
      assignee: string,
      creator: string,
    ) =>
      db.query(
        `INSERT INTO "Chore" (id, family_id, title, assigned_to, due_date, created_by)
         VALUES ($1, $2, 'E2E deletion chore', $3, now(), $4)`,
        [id, family, assignee, creator],
      );
    await db.query(
      `INSERT INTO "Family" (id, name, invite_code) VALUES ($1, 'E2E Solo Home', $1), ($2, 'E2E Duo Home', $2)`,
      [x.solo.family, x.duo.family],
    );
    await user(
      x.solo.parent,
      "Solo Parent",
      "parent",
      x.solo.family,
      "2026-01-01",
    );
    await user(
      x.solo.child,
      "Solo Child",
      "child",
      x.solo.family,
      "2026-01-02",
    );
    await chore(x.solo.chore, x.solo.family, x.solo.child, x.solo.parent);
    await user(
      x.duo.parent,
      "Duo Parent",
      "parent",
      x.duo.family,
      "2026-01-01",
    );
    await user(
      x.duo.parent2,
      "Duo Parent Two",
      "parent",
      x.duo.family,
      "2026-01-02",
    );
    await chore(x.duo.chore, x.duo.family, x.duo.parent2, x.duo.parent);
  });
  return x;
}

async function expectNoBlockingAxe(
  page: Page,
  testInfo: TestInfo,
  label: string,
) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .include('[data-testid="delete-account-dialog"]')
    .analyze();
  await testInfo.attach(`axe-${label}.json`, {
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

test.describe("account and household deletion", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      !PROJECTS.includes(testInfo.project.name),
      "phone and desktop only",
    );
  });

  test.afterEach(async ({}, testInfo) => {
    if (!PROJECTS.includes(testInfo.project.name)) return;
    await withDb((db) => removeSpecRows(db, ids(testInfo).prefix));
  });

  test("the only parent deletes the household from Settings after exporting", async ({
    page,
  }, testInfo) => {
    const x = await seed(testInfo);
    const fixtureCounts = await withDb(
      async (db) =>
        (
          await db.query(
            `SELECT family_id, count(*)::int AS n FROM "User" WHERE family_id = ANY($1) GROUP BY family_id ORDER BY 1`,
            [[FIXTURE_IDS.familyA.family, FIXTURE_IDS.familyB.family]],
          )
        ).rows,
    );

    await loginViaUi(page, x.email(x.solo.parent));
    await page.waitForURL(/\/dashboard/);
    await page.goto("/dashboard/settings");
    await expect(
      page.getByRole("heading", { name: "Privacy & Security" }),
    ).toBeVisible();
    await expect(page.getByText(/Two-Factor/i)).toHaveCount(0);

    // Settings → Data Export downloads the JSON export.
    const [settingsDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Data Export/ }).click(),
    ]);
    expect(settingsDownload.suggestedFilename()).toMatch(
      /^family-planner-export-\d{4}-\d{2}-\d{2}\.json$/,
    );

    await page.getByRole("button", { name: "Delete Account" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete household" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/all 2 accounts in it/)).toBeVisible();
    await expect(
      dialog.getByRole("link", { name: "invite another parent" }),
    ).toHaveAttribute("href", "/dashboard/family/invite");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      dialog.getByRole("button", { name: "Download my data" }).click(),
    ]);
    const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
    expect(JSON.stringify(exported)).toContain("E2E Solo Home");
    expect(JSON.stringify(exported)).not.toContain("Fixture-A");

    const submit = dialog.getByRole("button", { name: "Delete household" });
    await expect(submit).toBeDisabled();
    await dialog.getByLabel("Your password").fill(FIXTURE_PASSWORD);
    await dialog.getByLabel(/Type the household name/).fill("DELETE");
    await expect(submit).toBeDisabled();
    await dialog.getByLabel(/Type the household name/).fill("e2e solo home");
    await expect(submit).toBeEnabled();
    const box = await submit.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await expectNoBlockingAxe(page, testInfo, "household-dialog");

    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/family") && r.request().method() === "DELETE",
    );
    await submit.click();
    const res = await response;
    expect(res.status()).toBe(200);
    expect(res.request().headers()["idempotency-key"]).toMatch(
      /^[0-9a-f-]{36}$/,
    );

    await page.waitForURL(/\/login\?deleted=household/);
    await expect(
      page.getByRole("status").filter({
        hasText: "Your household and its accounts have been deleted.",
      }),
    ).toBeVisible();

    await withDb(async (db) => {
      const left = await db.query(
        `SELECT (SELECT count(*) FROM "Family" WHERE id = $1)::int AS families,
                (SELECT count(*) FROM "User" WHERE family_id = $1 OR id = ANY($2))::int AS users,
                (SELECT count(*) FROM "Chore" WHERE family_id = $1)::int AS chores`,
        [x.solo.family, [x.solo.parent, x.solo.child]],
      );
      expect(left.rows[0]).toEqual({ families: 0, users: 0, chores: 0 });
      const after = await db.query(
        `SELECT family_id, count(*)::int AS n FROM "User" WHERE family_id = ANY($1) GROUP BY family_id ORDER BY 1`,
        [[FIXTURE_IDS.familyA.family, FIXTURE_IDS.familyB.family]],
      );
      expect(after.rows).toEqual(fixtureCounts);
    });

    // The old session is gone.
    await page.goto("/dashboard/settings");
    await page.waitForURL(/\/login/);
  });

  test("one of two parents deletes only their own account", async ({
    page,
  }, testInfo) => {
    const x = await seed(testInfo);
    await loginViaUi(page, x.email(x.duo.parent));
    await page.waitForURL(/\/dashboard/);
    await page.goto("/dashboard/settings");
    await page.getByRole("button", { name: "Delete Account" }).click();

    const dialog = page.getByRole("dialog", { name: "Delete account" });
    await expect(dialog.getByText(/stay with it/)).toBeVisible();
    await dialog.getByLabel("Your password").fill("not-the-password");
    await dialog.getByLabel(/to confirm/).fill("DELETE");
    await dialog.getByRole("button", { name: "Delete my account" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "That password is not right.",
    );
    await expectNoBlockingAxe(page, testInfo, "account-dialog-error");

    await dialog.getByLabel("Your password").fill(FIXTURE_PASSWORD);
    await dialog.getByRole("button", { name: "Delete my account" }).click();
    await page.waitForURL(/\/login\?deleted=account/);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Your account has been deleted." }),
    ).toBeVisible();

    await withDb(async (db) => {
      const users = await db.query(
        `SELECT id FROM "User" WHERE family_id = $1 ORDER BY id`,
        [x.duo.family],
      );
      expect(users.rows.map((r) => r.id)).toEqual([x.duo.parent2]);
      const chore = await db.query(
        `SELECT created_by FROM "Chore" WHERE id = $1`,
        [x.duo.chore],
      );
      expect(chore.rows[0]?.created_by).toBe(x.duo.parent2);
    });
  });
});
