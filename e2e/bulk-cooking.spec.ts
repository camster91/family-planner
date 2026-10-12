/**
 * #538: bulk cooking is a real parent journey, not only a unit/API contract.
 *
 * Each locale runs through the actual Meals -> Bulk cooking UI, creates two
 * dishes in one prep session, marks the session prepared, records and undoes a
 * portion, then changes the next preparation date. The six configured
 * viewport projects provide the responsive pass; English uses the light theme
 * and Spanish uses the dark theme. Rows and idempotency receipts are scoped to
 * this spec's random name prefix and are removed by exact family-owned SQL.
 */
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import type { BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import pg from "pg";
import { bulkCookingMessages } from "../src/i18n/bulk-cooking";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { authFile } from "./support/env";
import { browserFetch, expect, test } from "./support/test";

const A = FIXTURE_IDS.familyA;
const PREFIX = `E2E bulk cooking ${randomUUID()}`;
const PREP_DAY = "2026-01-05";
const NEXT_PREP_DAY = "2026-01-12";
const DISH_ONE = `${PREFIX} chili`;
const DISH_TWO = `${PREFIX} roast vegetables`;

type Locale = "en" | "es";

const copyFor = (locale: Locale) => bulkCookingMessages[locale];
const message = (template: string, count: number) =>
  template.replace("{count}", String(count));

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

/** Remove only this run's batches, canonical meals, and mutation receipts. */
async function removeOwnedRows(keys: readonly string[] = []) {
  await withDb(async (db) => {
    const sessions = await db.query<{ id: string }>(
      `SELECT DISTINCT s.id
         FROM "MealPrepSession" s
         JOIN "MealBatch" b ON b.prep_session_id = s.id
        WHERE s.family_id = $1 AND b.name LIKE $2`,
      [A.family, `${PREFIX}%`],
    );
    const sessionIds = sessions.rows.map((row) => row.id);
    if (sessionIds.length) {
      const batches = await db.query<{ id: string }>(
        `SELECT id
           FROM "MealBatch"
          WHERE family_id = $1 AND prep_session_id = ANY($2::text[])`,
        [A.family, sessionIds],
      );
      const batchIds = batches.rows.map((row) => row.id);
      // FamilyMeal.batch_id is intentionally SET NULL, so remove the
      // canonical meal rows before cascading the batch/session rows.
      if (batchIds.length)
        await db.query(
          `DELETE FROM "FamilyMeal"
            WHERE family_id = $1 AND batch_id = ANY($2::text[])`,
          [A.family, batchIds],
        );
      await db.query(
        `DELETE FROM "MealPrepSession"
          WHERE family_id = $1 AND id = ANY($2::text[])`,
        [A.family, sessionIds],
      );
    }

    const uniqueKeys = [...new Set(keys)];
    if (uniqueKeys.length) {
      const receipts = await db.query<{ id: string }>(
        `SELECT id
           FROM "IdempotencyRecord"
          WHERE family_id = $1
            AND user_id = $2
            AND key = ANY($3::text[])
            AND action LIKE 'meal-prep.%'`,
        [A.family, A.parent, uniqueKeys],
      );
      const receiptIds = receipts.rows.map((row) => row.id);
      if (receiptIds.length)
        await db.query(
          `DELETE FROM "IdempotencyRecord"
            WHERE id = ANY($1::text[])
              AND family_id = $2
              AND user_id = $3
              AND action LIKE 'meal-prep.%'`,
          [receiptIds, A.family, A.parent],
        );
    }

    const remaining = await db.query<{ id: string }>(
      `SELECT DISTINCT s.id
         FROM "MealPrepSession" s
         JOIN "MealBatch" b ON b.prep_session_id = s.id
        WHERE s.family_id = $1 AND b.name LIKE $2`,
      [A.family, `${PREFIX}%`],
    );
    expect(remaining.rows).toHaveLength(0);
  });
}

async function setLocale(page: Page, locale: Locale) {
  await page.addInitScript(
    ({ language, localeKey, themeKey }) => {
      localStorage.setItem(localeKey, language);
      localStorage.setItem(themeKey, language === "es" ? "dark" : "light");
    },
    {
      language: locale,
      localeKey: LOCALE_STORAGE_KEY,
      themeKey: THEME_STORAGE_KEY,
    },
  );
}

async function installLocalOnlyGuard(context: BrowserContext) {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      ["data:", "blob:"].includes(url.protocol)
    ) {
      await route.continue();
      return;
    }
    await route.abort();
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

async function expectTargets(scope: Locator) {
  const undersized = await scope
    .locator("button, a[href], input, select")
    .evaluateAll((elements) =>
      elements
        .filter((element) => (element as HTMLElement).offsetParent !== null)
        .map((element) => {
          const box = element.getBoundingClientRect();
          return {
            name:
              element.getAttribute("aria-label") ??
              (element.textContent ?? "").trim().slice(0, 60),
            tag: element.tagName,
            width: Math.round(box.width),
            height: Math.round(box.height),
          };
        })
        .filter(
          (target) =>
            target.height < 44 ||
            (target.tag === "BUTTON" && target.width < 44),
        ),
    );
  expect(undersized, "bulk cooking controls smaller than 44px").toEqual([]);
}

async function scanBulkPanel(page: Page, info: TestInfo, label: string) {
  const panel = page.getByTestId("bulk-cooking-panel");
  await expect(panel).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectTargets(panel);
  const results = await new AxeBuilder({ page })
    .include('[data-testid="bulk-cooking-panel"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  await info.attach(`axe-${label}.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });
  const blocking = results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => ({
      rule: violation.id,
      nodes: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")),
    }));
  expect(blocking, `serious/critical axe violations on ${label}`).toEqual([]);
}

async function postBulkAction(page: Page, dialog: Locator, buttonName: string) {
  const response = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" &&
      new URL(candidate.url()).pathname === "/api/meals/bulk/actions",
  );
  await dialog.getByRole("button", { name: buttonName, exact: true }).click();
  const result = await response;
  expect(result.status(), await result.text()).toBeGreaterThanOrEqual(200);
  expect(result.status()).toBeLessThan(300);
  await expect(dialog).toHaveCount(0);
}

test.use({ storageState: authFile("parentA") });

let requestKeys = new Set<string>();

test.beforeEach(async ({ page }) => {
  assertFixtureTargetAllowed(process.env);
  requestKeys = new Set<string>();
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      request.method() === "POST" &&
      /^\/api\/meals\/bulk(?:\/actions)?$/.test(path)
    ) {
      const key = request.headers()["idempotency-key"];
      if (key) requestKeys.add(key);
    }
  });
  await removeOwnedRows();
});

test.afterEach(async () => {
  await removeOwnedRows([...requestKeys]);
});

for (const locale of ["en", "es"] as const) {
  test(`${locale}: create, prepare, eat, undo and schedule two bulk dishes`, async ({
    page,
    context,
  }, info) => {
    const copy = copyFor(locale);
    await installLocalOnlyGuard(context);
    await setLocale(page, locale);
    await page.goto("/dashboard/meals?view=bulk");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    if (locale === "es") await expect(page.locator("html")).toHaveClass(/dark/);
    else await expect(page.locator("html")).not.toHaveClass(/dark/);

    const panel = page.getByTestId("bulk-cooking-panel");
    await expect(panel.getByRole("heading", { name: copy.title })).toBeVisible();
    await expect(panel.getByRole("button", { name: copy.add, exact: true })).toBeEnabled();
    await scanBulkPanel(page, info, `${locale}-initial`);

    await panel.getByRole("button", { name: copy.add, exact: true }).click();
    const editor = page.getByTestId("meal-prep-editor");
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel(copy.date)).toHaveValue(PREP_DAY);
    await editor.getByRole("button", { name: copy.next, exact: true }).click();
    await editor.getByLabel(copy.name).fill(DISH_ONE);
    await editor.getByLabel(copy.portions).fill("4");
    await editor.getByRole("button", { name: copy.addDish, exact: true }).click();
    await editor.getByLabel(copy.name).fill(DISH_TWO);
    await editor.getByLabel(copy.portions).fill("4");
    await editor.getByRole("button", { name: copy.next, exact: true }).click();
    await expect(editor.getByRole("heading", { name: DISH_TWO })).toBeVisible();

    expect(requestKeys.size, "Next must not save before explicit review confirmation").toBe(0);
    await expect(editor.getByRole("button", { name: copy.save, exact: true })).toBeEnabled();
    await info.attach(`${locale}-review.png`, { body: await page.screenshot(), contentType: "image/png" });

    const createResponse = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        new URL(candidate.url()).pathname === "/api/meals/bulk",
    );
    await editor.getByRole("button", { name: copy.save, exact: true }).click();
    const created = await createResponse;
    const createdBody = (await created.json()) as { sessionId?: string };
    expect(created.status()).toBe(201);
    expect(createdBody.sessionId).toEqual(expect.any(String));
    await expect(editor).toHaveCount(0);

    const firstDish = panel.getByRole("article", { name: DISH_ONE, exact: true });
    const secondDish = panel.getByRole("article", { name: DISH_TWO, exact: true });
    await expect(firstDish).toBeVisible();
    await expect(secondDish).toBeVisible();
    await expect(firstDish.getByRole("status")).toContainText(message(copy.total, 4));
    await scanBulkPanel(page, info, `${locale}-created`);

    await panel.getByRole("button", { name: copy.markPrepared, exact: true }).click();
    const preparedDialog = page.getByTestId("meal-prep-action");
    await expect(preparedDialog).toBeVisible();
    await postBulkAction(page, preparedDialog, copy.markPrepared);
    await expect(panel.getByText(copy.prepared, { exact: true })).toBeVisible();

    await firstDish.getByRole("button", { name: copy.recordEaten, exact: true }).click();
    const eatenDialog = page.getByTestId("meal-prep-action");
    await expect(eatenDialog).toBeVisible();
    await expect(eatenDialog.getByLabel(copy.eatenFrom)).toHaveValue("");
    await postBulkAction(page, eatenDialog, copy.saveEaten);
    await expect(firstDish.getByRole("status")).toContainText(message(copy.eaten, 1));
    await expect(firstDish.getByRole("button", { name: copy.undoEaten, exact: true })).toBeVisible();

    await firstDish.getByRole("button", { name: copy.undoEaten, exact: true }).click();
    const undoDialog = page.getByTestId("meal-prep-action");
    await expect(undoDialog).toBeVisible();
    await postBulkAction(page, undoDialog, copy.undoEaten);
    await expect(firstDish.getByRole("status")).toContainText(message(copy.eaten, 0));
    await expect(firstDish.getByRole("button", { name: copy.undoEaten, exact: true })).toHaveCount(0);

    await panel.getByRole("button", { name: copy.changeNext, exact: true }).click();
    const nextDialog = page.getByTestId("meal-prep-action");
    await expect(nextDialog).toBeVisible();
    await nextDialog.getByLabel(copy.nextDate).fill(NEXT_PREP_DAY);
    await postBulkAction(page, nextDialog, copy.changeNext);

    const readBack = await browserFetch(page, "/api/meals/bulk");
    expect(readBack.status, readBack.body).toBe(200);
    const session = (
      (JSON.parse(readBack.body) as { sessions: Array<Record<string, unknown>> }).sessions
    ).find((row) => row.id === createdBody.sessionId);
    expect(session).toMatchObject({
      id: createdBody.sessionId,
      next_prep_on: expect.stringMatching(/^2026-01-12T/),
    });
    await scanBulkPanel(page, info, `${locale}-final`);
    await panel.getByRole("button", { name: copy.planNext, exact: true }).click();
    await expect(editor.getByLabel(copy.date)).toHaveValue(NEXT_PREP_DAY);
    const beforeDraftSubmit = requestKeys.size;
    // Native form submission before review (including Enter) may only advance.
    await editor.locator("form").evaluate(form => (form as HTMLFormElement).requestSubmit());
    await expect(editor.getByLabel(copy.name)).toBeVisible();
    expect(requestKeys.size).toBe(beforeDraftSubmit);
    await editor.getByRole("button", { name: copy.cancel, exact: true }).click();
    await expect(editor).toHaveCount(0);
  });
}
