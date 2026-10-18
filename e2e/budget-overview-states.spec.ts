/**
 * Parent Budget overview journey.
 *
 * This is the real browser proof for the approved Budget surface. It creates
 * one disposable Family A category, then uses the authenticated UI and real
 * Budget routes to create, edit and delete one transaction. The only mocked
 * response is a deliberately one-shot 503 from the stats GET after a
 * confirmed mutation; the retry continues to the real API and no write is
 * replayed.
 */
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import pg from "pg";
import type { BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import { FIXTURE_IDS, FIXTURE_LONG_TEXT } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { budgetMessages } from "../src/i18n/budget";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { E2E_ANCHOR, authFile } from "./support/env";
import { browserFetch, browserSend, expect, test } from "./support/test";
import { ownFeatureAudit } from "./support/feature-audit";

const A = FIXTURE_IDS.familyA;
const PROJECTS = new Set([
  "phone-390x844",
  "phone-430x932",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
  "tablet-large-1920x1200",
  "desktop-1366x768",
]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const RUN_ID = randomUUID();
const CATEGORY_ID = randomUUID();
const CATEGORY_NAME = `E2E Budget Category ${RUN_ID}`;
const DESCRIPTION_PREFIX = `E2E Budget ${RUN_ID}`;
const DESCRIPTION = `${DESCRIPTION_PREFIX} ${FIXTURE_LONG_TEXT.description}`;
const NOTES = `${DESCRIPTION_PREFIX} notes — preserve this long user content verbatim.`;
const PADDED_DESCRIPTION = `  ${DESCRIPTION}  `;
const PADDED_NOTES = `  ${NOTES}  `;
const EDIT_DESCRIPTION = `${DESCRIPTION_PREFIX} edited ${FIXTURE_LONG_TEXT.description}`;
const EDIT_NOTES = `${DESCRIPTION_PREFIX} edited notes — preserve this long user content verbatim.`;
const PADDED_EDIT_DESCRIPTION = `  ${EDIT_DESCRIPTION}  `;
const PADDED_EDIT_NOTES = `  ${EDIT_NOTES}  `;
const BACKDATED_DATE = (() => {
  const date = new Date(E2E_ANCHOR);
  date.setUTCDate(date.getUTCDate() - 30);
  return date.toISOString().slice(0, 10);
})();
const CATEGORY_LIMIT = 20;

const ownedTransactionIds = new Set<string>();
const ownedIdempotencyKeys = new Set<string>();

type Locale = "en" | "es";
type FeatureMap = Record<string, unknown>;

type TransactionResponse = {
  id: string;
  family_id: string;
  user_id: string;
  amount: number;
  type: string;
  category_id: string | null;
  date: string;
  description: string | null;
  notes: string | null;
  category: { id: string; name: string; icon: string; color: string } | null;
  user: { id: string; name: string; avatar_url: string | null };
};

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

async function removeOwnedRows(db: pg.Client) {
  await db.query(
    `DELETE FROM "Transaction"
     WHERE family_id = $1
       AND category_id = $2
       AND (description LIKE $3 OR id = ANY($4::text[]))`,
    [A.family, CATEGORY_ID, `${DESCRIPTION_PREFIX}%`, [...ownedTransactionIds]],
  );
  await db.query(
    `DELETE FROM "IdempotencyRecord"
     WHERE family_id = $1
       AND user_id = $2
       AND action LIKE 'budget.transaction.%'
       AND key = ANY($3::text[])`,
    [A.family, A.parent, [...ownedIdempotencyKeys]],
  );
  const leftovers = await db.query<{ id: string }>(
    `SELECT id FROM "Transaction"
     WHERE family_id = $1 AND category_id = $2 AND description LIKE $3`,
    [A.family, CATEGORY_ID, `${DESCRIPTION_PREFIX}%`],
  );
  expect(leftovers.rows).toEqual([]);
}

async function installLoopbackBudgetGuard(
  context: BrowserContext,
  blockedWrites: string[],
) {
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      !LOOPBACK_HOSTS.has(url.hostname) &&
      !["data:", "blob:"].includes(url.protocol)
    ) {
      await route.abort();
      return;
    }

    if (MUTATING_METHODS.has(request.method())) {
      const budgetTransaction =
        /^\/api\/budget\/transactions(?:\/[^/]+)?$/.test(url.pathname);
      const featureRestore =
        request.method() === "PATCH" && url.pathname === "/api/family/features";
      if (!budgetTransaction && !featureRestore) {
        blockedWrites.push(`${request.method()} ${url.pathname}`);
        await route.abort();
        return;
      }
    }
    await route.continue();
  });
}

async function setLocale(page: Page, locale: Locale) {
  await page.addInitScript(
    ({ localeKey, language, themeKey }) => {
      localStorage.setItem(localeKey, language);
      localStorage.setItem(themeKey, language === "es" ? "dark" : "light");
    },
    {
      locale,
      localeKey: LOCALE_STORAGE_KEY,
      language: locale,
      themeKey: THEME_STORAGE_KEY,
    },
  );
}

function currency(locale: Locale, amount: number) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

function fill(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replace(`{${key}}`, String(value)),
    template,
  );
}

async function assertTouchTarget(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  expect(box).toBeTruthy();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  const viewport = page.viewportSize();
  expect(viewport).toBeTruthy();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
}

async function assertSummaryLimitLayout(page: Page, label: string) {
  const summaryLimit = page.getByText(label, { exact: true });
  await expect(summaryLimit).toHaveCount(1);
  const geometry = await summaryLimit.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const fontSize = Number.parseFloat(style.fontSize) || 16;
    const lineHeight =
      style.lineHeight === "normal"
        ? fontSize * 1.2
        : Number.parseFloat(style.lineHeight) || fontSize * 1.2;
    return {
      right: rect.right,
      width: rect.width,
      lines: Math.ceil(rect.height / lineHeight),
    };
  });
  const viewport = page.viewportSize();
  expect(viewport).toBeTruthy();
  expect(geometry.width).toBeGreaterThan(0);
  expect(geometry.right).toBeLessThanOrEqual(viewport!.width);
  expect(geometry.lines).toBeLessThanOrEqual(2);
}

async function assertNoOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

async function assertNoSeriousAxe(page: Page, info: TestInfo, label: string) {
  const results = await new AxeBuilder({ page })
    .include("#main-content")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = results.violations
    .filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    )
    .map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")),
    }));
  await info.attach(`budget-axe-${label}`, {
    body: JSON.stringify({ label, blocking, all: results.violations }),
    contentType: "application/json",
  });
  expect(blocking, `serious/critical axe violations on ${label}`).toEqual([]);
}

async function captureProof(
  page: Page,
  info: TestInfo,
  locale: Locale,
  state: string,
) {
  const project = info.project.name;
  const path = info.outputPath(`budget-${locale}-${project}-${state}.png`);
  await page.screenshot({ path, fullPage: false, animations: "disabled" });
  const viewport = page.viewportSize();
  const metadata = {
    locale,
    theme: locale === "es" ? "dark" : "light",
    project,
    state,
    path,
    viewport,
    bytes: fs.statSync(path).size,
    anchor: E2E_ANCHOR.toISOString(),
    categoryId: CATEGORY_ID,
  };
  await info.attach(`budget-${locale}-${project}-${state}`, {
    path,
    contentType: "image/png",
  });
  await info.attach(`budget-${locale}-${project}-${state}-metadata`, {
    body: JSON.stringify(metadata, null, 2),
    contentType: "application/json",
  });
}

async function parseTransactionResponse(
  response: import("@playwright/test").Response,
) {
  const body = await response.text();
  expect(body).not.toContain("private financial implementation detail");
  const json = JSON.parse(body) as { transaction?: TransactionResponse };
  expect(json.transaction).toBeTruthy();
  return json.transaction!;
}

test.use({ storageState: authFile("parentA") });

test.beforeAll(async () => {
  await withDb(async (db) => {
    await removeOwnedRows(db);
    await db.query(`DELETE FROM "BudgetCategory" WHERE id = $1`, [CATEGORY_ID]);
    await db.query(
      `INSERT INTO "BudgetCategory"
       (id, family_id, name, icon, color, type, budget_limit, created_by)
       VALUES ($1, $2, $3, $4, $5, 'expense', $6, $7)`,
      [
        CATEGORY_ID,
        A.family,
        CATEGORY_NAME,
        "F",
        "#E56B6F",
        CATEGORY_LIMIT,
        A.parent,
      ],
    );
  });
});

test.afterEach(async () => {
  await withDb(removeOwnedRows);
});

test.afterAll(async () => {
  await withDb(async (db) => {
    await removeOwnedRows(db);
    await db.query(
      `DELETE FROM "BudgetCategory" WHERE id = $1 AND family_id = $2`,
      [CATEGORY_ID, A.family],
    );
    const category = await db.query(
      `SELECT id FROM "BudgetCategory" WHERE id = $1`,
      [CATEGORY_ID],
    );
    expect(category.rows).toEqual([]);
  });
});

for (const locale of ["en", "es"] as const) {
  test.describe(`${locale} Budget overview`, () => {
    test.use({ colorScheme: locale === "es" ? "dark" : "light" });

    test(`${locale}: real add, edit, delete and refresh recovery across supported sizes`, async ({
      page,
      context,
      baseURL,
    }, info) => {
      test.skip(
        !PROJECTS.has(info.project.name),
        "Budget overview runs at all six representative responsive sizes",
      );
      assertFixtureTargetAllowed(process.env);
      expect(LOOPBACK_HOSTS.has(new URL(baseURL!).hostname)).toBe(true);

      const blockedWrites: string[] = [];
      const transactionWrites: Array<{
        method: string;
        path: string;
        key: string;
      }> = [];
      const statsMethods: string[] = [];
      let statsFailures = 0;
      let failNextStats = false;
      let originalFeatures: FeatureMap | undefined;
      let featureChanged = false;
      let featureRestored = false;
      let cleanAudit: ((restored: boolean) => Promise<void>) | undefined;

      await setLocale(page, locale);
      await installLoopbackBudgetGuard(context, blockedWrites);
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (
          url.pathname.startsWith("/api/budget/transactions") &&
          MUTATING_METHODS.has(request.method())
        ) {
          const key = request.headers()["idempotency-key"] ?? "";
          transactionWrites.push({
            method: request.method(),
            path: url.pathname,
            key,
          });
          if (key) ownedIdempotencyKeys.add(key);
        }
      });
      await page.route("**/api/budget/stats*", async (route) => {
        const request = route.request();
        statsMethods.push(request.method());
        expect(request.method()).toBe("GET");
        if (failNextStats) {
          failNextStats = false;
          statsFailures += 1;
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "synthetic stats outage" }),
          });
          return;
        }
        await route.continue();
      });

      try {
        await page.goto("/dashboard");
        const featureResponse = await browserFetch(
          page,
          "/api/family/features",
        );
        expect(featureResponse.status, featureResponse.body).toBe(200);
        originalFeatures = JSON.parse(featureResponse.body)
          .features as FeatureMap;
        cleanAudit = await ownFeatureAudit(["budget"]);

        if (originalFeatures.budget !== true) {
          const enabled = await browserSend(
            page,
            "PATCH",
            "/api/family/features",
            {
              features: { ...originalFeatures, budget: true },
            },
          );
          expect(enabled.status, enabled.body).toBe(200);
          featureChanged = true;
        }

        await page.goto("/dashboard/budget");
        const copy = budgetMessages[locale];
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(
          page.getByRole("heading", { name: copy.pageTitle, exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText(copy.noTransactions, { exact: true }),
        ).toBeVisible();
        await expect(page.getByTestId("budget-category-empty")).toContainText(
          copy.noCategorySpending,
        );
        await expect(
          page.getByText(
            fill(copy.householdLimit, {
              limit: currency(locale, CATEGORY_LIMIT),
            }),
            { exact: true },
          ),
        ).toBeVisible();
        await assertSummaryLimitLayout(
          page,
          fill(copy.householdLimit, {
            limit: currency(locale, CATEGORY_LIMIT),
          }),
        );

        const add = page
          .getByRole("button", { name: copy.addExpense, exact: true })
          .first();
        await expect(add).toBeVisible();
        await assertTouchTarget(page, add);
        await assertNoOverflow(page);
        await assertNoSeriousAxe(
          page,
          info,
          `${locale}-${info.project.name}-empty`,
        );

        await add.click();
        const dialog = page.getByRole("dialog", {
          name: copy.transactionAddTitle,
          exact: true,
        });
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByLabel(copy.transactionAmount, { exact: true }),
        ).toBeFocused();
        await page.keyboard.press("Tab");
        expect(await dialog.locator(":focus").count()).toBe(1);
        await page.keyboard.press("Shift+Tab");
        await expect(
          dialog.getByLabel(copy.transactionAmount, { exact: true }),
        ).toBeFocused();

        const category = dialog.getByRole("combobox", {
          name: copy.transactionCategory,
          exact: true,
        });
        await expect(
          category.locator(`option[value="${CATEGORY_ID}"]`),
        ).toHaveCount(1);
        await category.selectOption(CATEGORY_ID);
        await dialog
          .getByLabel(copy.transactionAmount, { exact: true })
          .fill("42");
        await dialog
          .getByLabel(copy.transactionDescription, { exact: true })
          .fill(PADDED_DESCRIPTION);
        await dialog
          .getByLabel(copy.transactionNotes, { exact: false })
          .fill(PADDED_NOTES);
        await assertTouchTarget(
          page,
          dialog.getByRole("button", {
            name: copy.addTransaction,
            exact: true,
          }),
        );
        await assertTouchTarget(
          page,
          dialog.getByRole("button", {
            name: copy.transactionCancel,
            exact: true,
          }),
        );
        await assertNoOverflow(page);
        await assertNoSeriousAxe(
          page,
          info,
          `${locale}-${info.project.name}-add-dialog`,
        );

        failNextStats = true;
        const createResponsePromise = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname === "/api/budget/transactions",
        );
        const createButton = dialog.getByRole("button", {
          name: copy.addTransaction,
          exact: true,
        });
        await createButton.click();
        const createResponse = await createResponsePromise;
        expect(createResponse.status()).toBe(201);
        const created = await parseTransactionResponse(createResponse);
        ownedTransactionIds.add(created.id);
        expect(created).toMatchObject({
          family_id: A.family,
          user_id: A.parent,
          amount: 42,
          type: "expense",
          category_id: CATEGORY_ID,
          description: DESCRIPTION,
          notes: NOTES,
          category: {
            id: CATEGORY_ID,
            name: CATEGORY_NAME,
          },
        });
        expect(
          transactionWrites.filter((write) => write.method === "POST"),
        ).toHaveLength(1);
        expect(transactionWrites[0]!.key).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
        await expect(dialog).toHaveCount(0);

        await expect(
          page.getByText(DESCRIPTION, { exact: true }),
        ).toBeVisible();
        const refreshNotice = page.locator("#main-content").getByRole("alert");
        await expect(refreshNotice).toContainText(
          copy.transactionSavedRefreshFailed,
        );
        expect(statsFailures).toBe(1);
        await expect(
          page.getByRole("button", { name: copy.retryRefresh, exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: copy.retryRefresh, exact: true })
          .click();
        await expect(refreshNotice).toHaveCount(0);
        await expect(
          page.getByText(DESCRIPTION, { exact: true }),
        ).toBeVisible();
        await expect.poll(() => statsFailures).toBe(1);

        const categoryCard = page.getByTestId("budget-category-card");
        await expect(categoryCard).toContainText(CATEGORY_NAME);
        await expect(categoryCard).toContainText(
          fill(copy.categoryLimit, {
            spent: currency(locale, 42),
            limit: currency(locale, CATEGORY_LIMIT),
          }),
        );
        await expect(categoryCard).toContainText(
          fill(copy.categoryOverBy, { amount: currency(locale, 22) }),
        );
        const row = page.getByRole("button").filter({ hasText: DESCRIPTION });
        await expect(row).toHaveCount(1);
        await expect(
          row.getByText(`-${currency(locale, 42)}`, { exact: true }),
        ).toBeVisible();
        await expect(
          categoryCard.getByText(currency(locale, 42), { exact: true }),
        ).toBeVisible();
        await assertNoOverflow(page);
        await assertNoSeriousAxe(
          page,
          info,
          `${locale}-${info.project.name}-overage`,
        );
        await captureProof(page, info, locale, "overage");

        await row.click();
        const editDialog = page.getByRole("dialog", {
          name: copy.transactionEditTitle,
          exact: true,
        });
        await expect(editDialog).toBeVisible();
        await expect(
          editDialog.getByLabel(copy.transactionDescription, { exact: true }),
        ).toHaveValue(DESCRIPTION);
        await expect(
          editDialog.getByLabel(copy.transactionNotes, { exact: false }),
        ).toHaveValue(NOTES);
        await editDialog
          .getByLabel(copy.transactionAmount, { exact: true })
          .fill("60");
        await editDialog
          .getByLabel(copy.transactionDescription, { exact: true })
          .fill(PADDED_EDIT_DESCRIPTION);
        await editDialog
          .getByLabel(copy.transactionNotes, { exact: false })
          .fill(PADDED_EDIT_NOTES);
        const updateResponsePromise = page.waitForResponse(
          (response) =>
            response.request().method() === "PATCH" &&
            new URL(response.url()).pathname ===
              `/api/budget/transactions/${created.id}`,
        );
        await editDialog
          .getByRole("button", { name: copy.transactionSave, exact: true })
          .click();
        const updateResponse = await updateResponsePromise;
        expect(updateResponse.status()).toBe(200);
        const updated = await parseTransactionResponse(updateResponse);
        expect(updated).toMatchObject({
          id: created.id,
          family_id: A.family,
          user_id: A.parent,
          amount: 60,
          category_id: CATEGORY_ID,
          description: EDIT_DESCRIPTION,
          notes: EDIT_NOTES,
        });
        expect(
          transactionWrites.filter((write) => write.method === "PATCH"),
        ).toHaveLength(1);
        await expect(editDialog).toHaveCount(0);
        const updatedRow = page
          .getByRole("button")
          .filter({ hasText: EDIT_DESCRIPTION });
        await expect(updatedRow).toHaveCount(1);
        await expect(
          updatedRow.getByText(`-${currency(locale, 60)}`, { exact: true }),
        ).toBeVisible();
        await expect(categoryCard).toContainText(
          fill(copy.categoryOverBy, { amount: currency(locale, 40) }),
        );

        await updatedRow.click();
        const backdatedDialog = page.getByRole("dialog", {
          name: copy.transactionEditTitle,
          exact: true,
        });
        await expect(backdatedDialog).toBeVisible();
        await expect(
          backdatedDialog.getByLabel(copy.transactionDescription, {
            exact: true,
          }),
        ).toHaveValue(EDIT_DESCRIPTION);
        await expect(
          backdatedDialog.getByLabel(copy.transactionNotes, { exact: false }),
        ).toHaveValue(EDIT_NOTES);
        await backdatedDialog
          .getByLabel(copy.transactionDate, { exact: true })
          .fill(BACKDATED_DATE);
        const backdatedResponsePromise = page.waitForResponse(
          (response) =>
            response.request().method() === "PATCH" &&
            new URL(response.url()).pathname ===
              `/api/budget/transactions/${created.id}`,
        );
        await backdatedDialog
          .getByRole("button", { name: copy.transactionSave, exact: true })
          .click();
        const backdatedResponse = await backdatedResponsePromise;
        expect(backdatedResponse.status()).toBe(200);
        const backdated = await parseTransactionResponse(backdatedResponse);
        expect(backdated).toMatchObject({
          id: created.id,
          date: expect.stringContaining(BACKDATED_DATE),
          description: EDIT_DESCRIPTION,
          notes: EDIT_NOTES,
        });
        expect(
          transactionWrites.filter((write) => write.method === "PATCH"),
        ).toHaveLength(2);
        await expect(backdatedDialog).toHaveCount(0);
        await expect(
          page.getByText(EDIT_DESCRIPTION, { exact: true }),
        ).toBeVisible();

        await updatedRow.click();
        const deleteDialog = page.getByRole("dialog", {
          name: copy.transactionEditTitle,
          exact: true,
        });
        await deleteDialog
          .getByRole("button", { name: copy.transactionDelete, exact: true })
          .click();
        const deleteGroup = deleteDialog.getByRole("group", {
          name: copy.transactionDelete,
          exact: true,
        });
        await expect(deleteGroup).toContainText(copy.transactionDeleteConfirm);
        failNextStats = true;
        const deleteResponsePromise = page.waitForResponse(
          (response) =>
            response.request().method() === "DELETE" &&
            new URL(response.url()).pathname ===
              `/api/budget/transactions/${created.id}`,
        );
        await deleteGroup
          .getByRole("button", {
            name: copy.transactionDeleteAction,
            exact: true,
          })
          .click();
        const deleteResponse = await deleteResponsePromise;
        expect(deleteResponse.status()).toBe(200);
        expect(await deleteResponse.json()).toEqual({ success: true });
        expect(
          transactionWrites.filter((write) => write.method === "DELETE"),
        ).toHaveLength(1);
        await expect(deleteDialog).toHaveCount(0);
        await expect(
          page.getByText(EDIT_DESCRIPTION, { exact: true }),
        ).toHaveCount(0);
        await expect(refreshNotice).toContainText(
          copy.transactionDeletedRefreshFailed,
        );
        expect(statsFailures).toBe(2);
        await page
          .getByRole("button", { name: copy.retryRefresh, exact: true })
          .click();
        await expect(refreshNotice).toHaveCount(0);
        await expect(
          page.getByText(copy.noTransactions, { exact: true }),
        ).toBeVisible();
        await expect(page.getByTestId("budget-category-empty")).toContainText(
          copy.noCategorySpending,
        );
        await expect(
          page.getByText(currency(locale, 60), { exact: true }),
        ).toHaveCount(0);

        const finalStats = await browserFetch(
          page,
          "/api/budget/stats?month=2026-01",
        );
        expect(finalStats.status, finalStats.body).toBe(200);
        const finalStatsBody = JSON.parse(finalStats.body) as {
          total_expenses: number;
          category_breakdown: Array<{ category_id: string | null }>;
          recent_transactions: Array<{ id: string }>;
        };
        expect(finalStatsBody.total_expenses).toBe(0);
        expect(finalStatsBody.category_breakdown).toEqual([]);
        expect(
          finalStatsBody.recent_transactions.some(
            (row) => row.id === created.id,
          ),
        ).toBe(false);

        await withDb(async (db) => {
          const row = await db.query(
            `SELECT id FROM "Transaction" WHERE id = $1`,
            [created.id],
          );
          expect(row.rows).toEqual([]);
          const receipts = await db.query<{
            action: string;
            response_status: number | null;
          }>(
            `SELECT action, response_status FROM "IdempotencyRecord"
             WHERE family_id = $1 AND user_id = $2 AND key = ANY($3::text[])
             ORDER BY action`,
            [A.family, A.parent, transactionWrites.map((write) => write.key)],
          );
          expect(receipts.rows).toHaveLength(3);
          expect(receipts.rows.map((receipt) => receipt.action)).toEqual([
            "budget.transaction.create",
            "budget.transaction.delete",
            "budget.transaction.update",
          ]);
          expect(
            receipts.rows.every((receipt) => receipt.response_status !== null),
          ).toBe(true);
        });

        await assertNoOverflow(page);
        await assertNoSeriousAxe(
          page,
          info,
          `${locale}-${info.project.name}-empty-after-delete`,
        );
        await captureProof(page, info, locale, "empty-after-delete");
        expect(blockedWrites).toEqual([]);
        expect(new Set(statsMethods)).toEqual(new Set(["GET"]));
        expect(transactionWrites).toHaveLength(3);
      } finally {
        await page.unrouteAll({ behavior: "ignoreErrors" });
        const cleanupErrors: unknown[] = [];
        try {
          if (featureChanged && originalFeatures) {
            await page.goto("/dashboard");
            const restored = await browserSend(
              page,
              "PATCH",
              "/api/family/features",
              {
                features: originalFeatures,
              },
            );
            expect(restored.status, restored.body).toBe(200);
            const canonical = await browserFetch(page, "/api/family/features");
            expect(canonical.status, canonical.body).toBe(200);
            expect(JSON.parse(canonical.body).features).toEqual(
              originalFeatures,
            );
          }
          featureRestored = true;
        } catch (error) {
          cleanupErrors.push(error);
        }
        try {
          await cleanAudit?.(featureRestored);
        } catch (error) {
          cleanupErrors.push(error);
        }
        await context.unrouteAll({ behavior: "ignoreErrors" });
        if (cleanupErrors.length) throw cleanupErrors[0];
      }
      expect(featureRestored).toBe(true);
    });
  });
}
