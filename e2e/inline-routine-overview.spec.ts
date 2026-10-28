import { randomUUID } from "node:crypto";
import pg from "pg";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./support/test";
import { authFile, E2E_ANCHOR } from "./support/env";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { LOCALE_STORAGE_KEY } from "../src/i18n";

test.use({ storageState: authFile("parentA") });

test("inline routine steps complete and undo their exact occurrence once", async ({
  page,
  context,
}) => {
  assertFixtureTargetAllowed(process.env);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const family = FIXTURE_IDS.familyA;
  const marker = `QA ${randomUUID()}`;
  const ids = [randomUUID(), randomUUID()];
  const titles = [`${marker} pack bag`, `${marker} check lunch`];
  let metrics: boolean | undefined;
  try {
    const original = await db.query<{ beta_metrics_enabled: boolean }>(
      'SELECT beta_metrics_enabled FROM "Family" WHERE id = $1',
      [family.family],
    );
    expect(original.rowCount).toBe(1);
    metrics = original.rows[0].beta_metrics_enabled;
    await db.query(
      'UPDATE "Family" SET beta_metrics_enabled = false WHERE id = $1',
      [family.family],
    );
    for (let index = 0; index < ids.length; index++) {
      await db.query(
        `INSERT INTO "Chore"
        (id, family_id, title, points, assigned_to, due_date, status, frequency, difficulty, created_by, created_at, routine, routine_order)
        VALUES ($1, $2, $3, 0, $4, $5, 'pending', 'once', 'easy', $4, $5, $6, $7)`,
        [
          ids[index],
          family.family,
          titles[index],
          family.parent,
          E2E_ANCHOR.toISOString(),
          marker,
          index + 1,
        ],
      );
    }
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return ["localhost", "127.0.0.1"].includes(url.hostname) ||
        ["data:", "blob:"].includes(url.protocol)
        ? route.continue()
        : route.abort();
    });
    await page.addInitScript(
      (key) => localStorage.setItem(key, "en"),
      LOCALE_STORAGE_KEY,
    );
    await page.goto("/dashboard/chores");
    const routine = page
      .getByRole("heading", { name: marker, exact: true })
      .locator("..");
    await expect(routine).toBeVisible();
    await expect(routine).toContainText("0 of 2 done · 0 checked");
    for (const title of titles)
      await expect(
        page.getByRole("checkbox", { name: title, exact: true }),
      ).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const focus = page.getByRole("radio", {
      name: "Guided",
      exact: true,
    });
    await focus.click({ timeout: 10_000 });
    await expect(routine.locator('[aria-current="step"]')).toHaveCount(1);
    await expect(
      routine.getByRole("checkbox", { name: titles[0], exact: true }),
    ).toHaveCount(1);
    await expect(
      routine.getByRole("checkbox", { name: titles[1], exact: true }),
    ).toHaveCount(0);
    await page.getByRole("radio", { name: "List", exact: true }).click();
    const complete = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/chores/complete") &&
        response.request().method() === "POST",
    );
    await routine
      .getByRole("checkbox", { name: titles[0], exact: true })
      .click();
    const completed = await complete;
    expect(completed.status()).toBe(200);
    expect(completed.request().postDataJSON()).toEqual({ choreId: ids[0] });
    await expect(routine).toContainText("1 of 2 done · 0 checked");
    await expect(
      routine.getByRole("checkbox", { name: titles[1], exact: true }),
    ).not.toBeChecked();
    const undo = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/chores/uncomplete") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    const undone = await undo;
    expect(undone.status()).toBe(200);
    expect(undone.request().postDataJSON()).toEqual({ choreId: ids[0] });
    await expect(routine).toContainText("0 of 2 done · 0 checked");
    await expect(
      page.getByRole("checkbox", { name: titles[0], exact: true }),
    ).toHaveCount(1);
    expect(
      (
        await db.query(
          'SELECT status FROM "Chore" WHERE id = ANY($1::text[]) ORDER BY id',
          [ids],
        )
      ).rows.map((row) => row.status),
    ).toEqual(["pending", "pending"]);
    expect(
      (
        await new AxeBuilder({ page })
          .include("main")
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath("inline-routine-overview.png"),
      fullPage: true,
    });
  } finally {
    try {
      await db.query(
        'DELETE FROM "Chore" WHERE family_id = $1 AND id = ANY($2::text[])',
        [family.family, ids],
      );
      await db.query(
        'DELETE FROM "Activity" WHERE family_id = $1 AND title LIKE $2',
        [family.family, `%${marker}%`],
      );
      await db.query(
        'DELETE FROM "Notification" WHERE user_id IN (SELECT id FROM "User" WHERE family_id = $1) AND message LIKE $2',
        [family.family, `%${marker}%`],
      );
      if (metrics !== undefined)
        await db.query(
          'UPDATE "Family" SET beta_metrics_enabled = $2 WHERE id = $1',
          [family.family, metrics],
        );
      expect(
        (
          await db.query('SELECT id FROM "Chore" WHERE id = ANY($1::text[])', [
            ids,
          ])
        ).rows,
      ).toEqual([]);
    } finally {
      await db.end();
    }
  }
});
