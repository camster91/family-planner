import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import {
  test,
  expect,
  loginViaUi,
  browserSend,
  browserFetch,
} from "./support/test";
import { FIXTURE_EMAILS, FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { E2E_ANCHOR } from "./support/env";

async function withFixtureDb<T>(fn: (db: pg.Client) => Promise<T>): Promise<T> {
  assertFixtureTargetAllowed(process.env);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

test("Routines keeps Today actionable and other repeating chores dated, grouped and canonical", async ({
  page,
  context,
}) => {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["localhost", "127.0.0.1"].includes(url.hostname) ||
      ["data:", "blob:"].includes(url.protocol)
      ? route.continue()
      : route.abort();
  });
  // This real sign-in must not inherit another journey's exhausted login
  // bucket. The app's authentication and rate-limit policy are unchanged.
  await page.setExtraHTTPHeaders({ "X-Forwarded-For": "198.51.100.243" });
  await loginViaUi(page, FIXTURE_EMAILS.familyA.parent);
  await expect(page).toHaveURL(/\/dashboard(?:\/|$)/);
  // Own a fresh series: generated non-fixture copies from earlier local runs
  // are intentionally not removed by fixture seeding. Shared fixture state
  // must not determine this test's expected group count.
  const title = `QA weekly routine ${randomUUID()}`;
  const ownedIds: string[] = [];
  let seriesId: string | undefined;
  let testFailure: unknown;
  let metricsEnabled: boolean | undefined;
  try {
    await withFixtureDb(async (db) => {
      const family = await db.query<{ beta_metrics_enabled: boolean }>(
        'SELECT beta_metrics_enabled FROM "Family" WHERE id = $1',
        [FIXTURE_IDS.familyA.family],
      );
      expect(family.rowCount).toBe(1);
      metricsEnabled = family.rows[0].beta_metrics_enabled;
      // Keep opt-in counters intact; no metrics are produced by this QA run.
      await db.query(
        'UPDATE "Family" SET beta_metrics_enabled = false WHERE id = $1',
        [FIXTURE_IDS.familyA.family],
      );
    });
    const created = await browserSend(page, "POST", "/api/chores/create", {
      title,
      assigned_to: FIXTURE_IDS.familyA.teen,
      due_date: E2E_ANCHOR.toISOString().slice(0, 10),
      difficulty: "easy",
      frequency: "weekly",
      points: 10,
    });
    expect(created.status).toBe(200);
    seriesId = JSON.parse(created.body).chore.id as string;
    ownedIds.push(seriesId);
    const records = await browserFetch(page, "/api/chores?limit=200");
    expect(records.status).toBe(200);
    const series = (
      JSON.parse(records.body).chores as Array<{
        id: string;
        recurrence_id: string;
      }>
    ).filter((c) => c.recurrence_id === seriesId);
    ownedIds.splice(0, ownedIds.length, ...series.map((c) => c.id));
    expect(ownedIds).toHaveLength(4);
    await page.goto("/dashboard/chores");
    await page
      .getByRole("combobox", { name: "More chore views", exact: true })
      .selectOption("routines");
    const other = page.getByRole("region", {
      name: "Other chores",
      exact: true,
    });
    await expect(
      other.getByRole("button", { name: `Done: ${title}` }),
    ).toHaveCount(1);
    await page
      .getByRole("combobox", { name: "Routine range", exact: true })
      .selectOption("all");
    const summary = other.locator("summary").filter({ hasText: title });
    await expect(summary).toBeVisible();
    // The fresh fixed-clock series has its template today plus three weekly copies.
    // The four-occurrence window counts its template; it must not grow a fifth
    // row simply because the page is opened.
    await expect(summary).toContainText("4 dates");
    await expect(
      other.getByRole("button", { name: `Done: ${title}` }).first(),
    ).not.toBeVisible();
    await summary.click();
    const buttons = other.getByRole("button", {
      name: `Done: ${title}`,
    });
    await expect(buttons).toHaveCount(4);
    await expect(buttons.first()).toBeVisible();
    const selected = buttons.nth(1);
    const href = await selected
      .locator("..")
      .getByRole("link", { name: `Edit ${title}` })
      .getAttribute("href");
    const expectedId = new URL(href!, "http://localhost").searchParams.get(
      "id",
    );
    const responsePromise = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/chores/complete") &&
        r.request().method() === "POST",
    );
    await selected.click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toEqual({ choreId: expectedId });
    expect(ownedIds).toContain(expectedId);
    expect(expectedId).not.toBe(seriesId);
    await expect(
      other.getByText("Done · awaiting check").first(),
    ).toBeVisible();
    const result = await new AxeBuilder({ page })
      .include('section[aria-label="Other chores"]')
      .analyze();
    expect(result.violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await summary.click();
    await other.screenshot({
      path: test.info().outputPath("other-chores.png"),
    });
  } catch (error) {
    testFailure = error;
    throw error;
  } finally {
    // Recover every test-owned row even when creation parsing, bounded GET or
    // assertions fail. This read is fixture-guarded and scoped to this run's
    // unique title and household. An active series anchor must be stopped via
    // the canonical PATCH before its occurrences can be deleted.
    const cleanupFailures: unknown[] = [];
    try {
      await withFixtureDb(async (db) => {
        const rows = await db.query<{
          id: string;
          recurrence_id: string | null;
          is_template: boolean;
          frequency: string;
        }>(
          'SELECT id, recurrence_id, is_template, frequency FROM "Chore" WHERE family_id = $1 AND title = $2',
          [FIXTURE_IDS.familyA.family, title],
        );
        const anchor = rows.rows.find(
          (row) =>
            row.id === row.recurrence_id &&
            row.is_template &&
            ["daily", "weekly", "monthly"].includes(row.frequency),
        );
        if (anchor) {
          const stopped = await browserSend(page, "PATCH", "/api/chores", {
            choreId: anchor.id,
            frequency: "once",
          });
          expect(stopped.status, stopped.body).toBe(200);
        }
      });
    } catch (error) {
      cleanupFailures.push(error);
    }

    // Re-read after stopping: the canonical stop operation removes future
    // pending copies. Delete surviving occurrences before the stopped anchor
    // so its history-retention guard does not turn a valid cleanup into 409.
    let rowsAfterStop: Array<{ id: string; recurrence_id: string | null }> = [];
    try {
      await withFixtureDb(async (db) => {
        const rows = await db.query<{
          id: string;
          recurrence_id: string | null;
        }>(
          'SELECT id, recurrence_id FROM "Chore" WHERE family_id = $1 AND title = $2',
          [FIXTURE_IDS.familyA.family, title],
        );
        rowsAfterStop = rows.rows;
      });
    } catch (error) {
      cleanupFailures.push(error);
    }
    for (const row of rowsAfterStop.sort((a, b) => {
      if (a.id === a.recurrence_id) return 1;
      if (b.id === b.recurrence_id) return -1;
      return 0;
    })) {
      try {
        const removed = await browserSend(page, "DELETE", "/api/chores", {
          choreId: row.id,
        });
        expect(removed.status).toBe(200);
      } catch (error) {
        // Attempt later deletions even if one fails; retain the original error.
        cleanupFailures.push(error);
      }
    }
    try {
      await withFixtureDb(async (db) => {
        const remaining = await db.query<{ id: string }>(
          'SELECT id FROM "Chore" WHERE family_id = $1 AND title = $2',
          [FIXTURE_IDS.familyA.family, title],
        );
        expect(remaining.rows).toHaveLength(0);
      });
    } catch (error) {
      cleanupFailures.push(error);
    }
    try {
      await withFixtureDb(async (db) => {
        // Notifications/activity have no chore FK. Match only this run's UUID.
        const activityTitlePattern = `%"${title}"%`;
        const notificationMessagePattern = `%"${title}"%`;
        await db.query(
          'DELETE FROM "Activity" WHERE family_id = $1 AND title LIKE $2',
          [FIXTURE_IDS.familyA.family, activityTitlePattern],
        );
        await db.query(
          'DELETE FROM "Notification" WHERE user_id = $1 AND message LIKE $2',
          [FIXTURE_IDS.familyA.teen, notificationMessagePattern],
        );
        const remainingActivity = await db.query<{ id: string }>(
          'SELECT id FROM "Activity" WHERE family_id = $1 AND title LIKE $2',
          [FIXTURE_IDS.familyA.family, activityTitlePattern],
        );
        expect(remainingActivity.rows).toHaveLength(0);
        const remainingNotifications = await db.query<{ id: string }>(
          'SELECT id FROM "Notification" WHERE user_id = $1 AND message LIKE $2',
          [FIXTURE_IDS.familyA.teen, notificationMessagePattern],
        );
        expect(remainingNotifications.rows).toHaveLength(0);
      });
    } catch (error) {
      cleanupFailures.push(error);
    }
    if (metricsEnabled !== undefined) {
      try {
        await withFixtureDb(async (db) => {
          await db.query(
            'UPDATE "Family" SET beta_metrics_enabled = $2 WHERE id = $1',
            [FIXTURE_IDS.familyA.family, metricsEnabled],
          );
          const restoredFamily = await db.query<{
            beta_metrics_enabled: boolean;
          }>('SELECT beta_metrics_enabled FROM "Family" WHERE id = $1', [
            FIXTURE_IDS.familyA.family,
          ]);
          expect(restoredFamily.rows).toHaveLength(1);
          expect(restoredFamily.rows[0]?.beta_metrics_enabled).toBe(
            metricsEnabled,
          );
        });
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    if (cleanupFailures.length) {
      throw new AggregateError(
        [...(testFailure ? [testFailure] : []), ...cleanupFailures],
        "Routine test failed to clean up all owned rows",
      );
    }
  }
});
