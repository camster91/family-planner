/**
 * #560 / #536: recurring chore lifecycle on the real parent surface.
 *
 * Each journey creates one UUID-owned weekly anchor through the real form,
 * adds one completed history row, exercises the protected legacy DELETE and
 * parent-only Stop repeating flow, then deletes a separate ordinary chore
 * through the real confirmation dialog. The primary ordinary DELETE reaches
 * the loopback API after a real browser Back/Escape pending check; the small
 * 404 case is explicitly synthetic and proves readback recovery without
 * replacing that real write. Cleanup is family/creator/title scoped and reads
 * back zero owned rows before the test ends.
 */
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type {
  Browser,
  BrowserContext,
  Locator,
  Page,
  TestInfo,
} from "@playwright/test";
import pg from "pg";
import { choreFormMessages } from "../src/i18n/chore-forms";
import { choreScheduleMessages } from "../src/i18n/chore-schedule";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { E2E_ANCHOR, E2E_TIMEZONE, authFile } from "./support/env";
import { browserFetch, browserSend, expect, test } from "./support/test";

const A = FIXTURE_IDS.familyA;
const B = FIXTURE_IDS.familyB;
const PROJECTS = [
  "phone-390x844",
  "phone-430x932",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
  "tablet-large-1920x1200",
  "desktop-1366x768",
] as const;
const LOCALES = ["en", "es"] as const;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
type Locale = (typeof LOCALES)[number];

test.use({ storageState: authFile("parentA"), timezoneId: E2E_TIMEZONE });

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

function anchorDay(offsetDays = 0) {
  return new Date(
    Date.UTC(
      E2E_ANCHOR.getUTCFullYear(),
      E2E_ANCHOR.getUTCMonth(),
      E2E_ANCHOR.getUTCDate() + offsetDays,
    ),
  );
}

function sourceHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function sourceTree() {
  return execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();
}

function compiledBuiltAt() {
  const route = fs.readFileSync(
    ".next/server/app/api/version/route.js",
    "utf8",
  );
  const values = [
    ...new Set(route.match(/20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g) ?? []),
  ];
  expect(values).toHaveLength(1);
  return values[0]!;
}

async function runtimeIdentity(
  page: Page,
  info: TestInfo,
  locale: Locale,
  project: string,
) {
  const head = sourceHead();
  expect(head).toMatch(/^[a-f0-9]{40}$/);
  const tree = sourceTree();
  expect(tree).toMatch(/^[a-f0-9]{40}$/);
  const response = await page.request.get("/api/version");
  expect(response.status()).toBe(200);
  const runtime = (await response.json()) as {
    commit: string;
    builtAt: string;
  };
  expect(runtime.commit).toBe(head);
  const releaseSha = process.env.RELEASE_SHA?.trim();
  if (releaseSha) expect(releaseSha).toBe(head);
  expect(runtime.builtAt).toBe(compiledBuiltAt());
  const configuredTree = process.env.E2E_CHORE_SERIES_BUILD_TREE?.trim();
  if (configuredTree) expect(configuredTree).toBe(tree);
  await info.attach("actual-chore-series-runtime-identity", {
    body: JSON.stringify({
      runtime,
      buildId: fs.readFileSync(".next/BUILD_ID", "utf8").trim(),
      buildTree: tree,
      configuredBuildTree: configuredTree ?? null,
      locale,
      project,
      fixtureFamily: A.family,
      fixtureParent: A.parent,
      lifecycleTransport:
        "weekly anchor and ordinary delete use loopback API; 404 readback is synthetic",
    }),
    contentType: "application/json",
  });
}

async function installLoopbackGuard(context: BrowserContext) {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return LOOPBACK_HOSTS.has(url.hostname) ||
      ["data:", "blob:"].includes(url.protocol)
      ? route.continue()
      : route.abort();
  });
}

async function assertActionGeometry(page: Page, action: Locator) {
  await action.scrollIntoViewIfNeeded();
  const box = await action.boundingBox();
  const viewport = page.viewportSize();
  expect(box).toBeTruthy();
  expect(viewport).toBeTruthy();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
  expect(
    await action.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return element.contains(
        document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        ),
      );
    }),
  ).toBe(true);
}

async function captureSurface(
  page: Page,
  info: TestInfo,
  label: string,
  controls: Locator[],
) {
  for (const control of controls) await assertActionGeometry(page, control);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= window.innerWidth &&
        document.body.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const results = await new AxeBuilder({ page })
    .exclude("next-route-announcer")
    .analyze();
  const blocking = results.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  await info.attach(`${label}-axe`, {
    body: JSON.stringify(blocking),
    contentType: "application/json",
  });
  expect(blocking).toEqual([]);
  await info.attach(`${label}-viewport`, {
    body: await page.screenshot({ fullPage: false, animations: "disabled" }),
    contentType: "image/png",
  });
}

async function insertCompletedHistory(
  historyId: string,
  title: string,
  anchorId: string,
) {
  await withDb((db) =>
    db.query(
      `INSERT INTO "Chore"
       (id, family_id, title, points, assigned_to, due_date, status, frequency,
        difficulty, created_by, created_at, completed_at, recurrence_id, is_template)
       VALUES ($1, $2, $3, 10, $4, $5, 'completed', 'once', 'easy', $6, $7, $5, $8, false)`,
      [
        historyId,
        A.family,
        title,
        A.child,
        anchorDay(-7).toISOString(),
        A.parent,
        E2E_ANCHOR.toISOString(),
        anchorId,
      ],
    ),
  );
}

async function cleanupOwned(
  titles: readonly string[],
  expectedIds: ReadonlySet<string>,
) {
  await withDb(async (db) => {
    const rows = await db.query<{ id: string; title: string }>(
      `SELECT id, title
         FROM "Chore"
        WHERE family_id = $1 AND created_by = $2 AND title = ANY($3::text[])`,
      [A.family, A.parent, titles],
    );
    const ids = [
      ...new Set([...expectedIds, ...rows.rows.map((row) => row.id)]),
    ];
    if (ids.length) {
      await db.query(
        `DELETE FROM "Chore"
          WHERE family_id = $1 AND created_by = $2 AND id = ANY($3::text[])`,
        [A.family, A.parent, ids],
      );
    }
    await db.query(
      `DELETE FROM "Activity" WHERE family_id = $1 AND title LIKE ANY($2::text[])`,
      [A.family, titles.map((title) => `%${title}%`)],
    );
    await db.query(
      `DELETE FROM "Notification"
        WHERE user_id IN (SELECT id FROM "User" WHERE family_id = $1)
          AND message LIKE ANY($2::text[])`,
      [A.family, titles.map((title) => `%${title}%`)],
    );
    const remaining = await db.query<{ id: string }>(
      `SELECT id
         FROM "Chore"
        WHERE family_id = $1 AND created_by = $2 AND title = ANY($3::text[])`,
      [A.family, A.parent, titles],
    );
    expect(remaining.rows).toEqual([]);
  });
}

async function readSeries(page: Page, anchorId: string) {
  const response = await browserFetch(page, "/api/chores?limit=200");
  expect(response.status, response.body).toBe(200);
  const chores = (JSON.parse(response.body).chores ?? []) as Array<{
    id: string;
    family_id: string;
    created_by: string;
    title: string;
    recurrence_id: string | null;
    is_template: boolean;
    frequency: string;
    status: string;
    due_date: string;
  }>;
  return chores.filter((chore) => chore.recurrence_id === anchorId);
}

async function createWeeklyAnchor(
  page: Page,
  info: TestInfo,
  locale: Locale,
  title: string,
) {
  const copy = choreFormMessages[locale];
  const schedule = choreScheduleMessages[locale];
  await page.goto("/dashboard/chores/create");
  await expect(
    page.getByRole("heading", { name: copy.newTitle }),
  ).toBeVisible();
  const titleField = page.getByLabel(copy.title, { exact: true });
  const assignee = page.getByLabel(copy.assignTo, { exact: true });
  await titleField.fill(title);
  await expect(assignee).toBeVisible();
  await assignee.selectOption(A.child);
  const weekly = page.getByRole("button", { name: copy.weekly, exact: true });
  await weekly.click();
  const monday = page.getByRole("checkbox", {
    name: schedule.weekdayNames[1],
    exact: true,
  });
  const mondayTarget = page
    .locator("label")
    .filter({ hasText: schedule.weekdayNames[1] })
    .first();
  await monday.check();
  await expect(monday).toBeChecked();
  const create = page.getByRole("button", { name: copy.create, exact: true });
  await expect(create).toBeEnabled();
  await captureSurface(page, info, `${locale}-${info.project.name}-create`, [
    weekly,
    mondayTarget,
    create,
  ]);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/chores/create",
  );
  await create.click();
  const response = await responsePromise;
  const body = await response.json();
  expect(response.status(), JSON.stringify(body)).toBe(200);
  const anchorId = body.chore?.id as string | undefined;
  expect(anchorId).toEqual(expect.any(String));
  await expect(page).toHaveURL(/\/dashboard\/chores\/?$/);
  return anchorId!;
}

test.describe.configure({ mode: "serial" });

for (const locale of LOCALES) {
  test.describe(`${locale} recurring chore lifecycle`, () => {
    test.use({ colorScheme: locale === "es" ? "dark" : "light" });

    test(`${locale}: create, stop, retain history, and delete one occurrence`, async ({
      browser,
      page,
      context,
      baseURL,
    }, info) => {
      test.skip(
        !PROJECTS.includes(info.project.name as (typeof PROJECTS)[number]),
        "Lifecycle journey runs at all six representative responsive sizes",
      );
      assertFixtureTargetAllowed(process.env);
      expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
        new URL(baseURL!).hostname,
      );
      await installLoopbackGuard(context);
      await page.addInitScript(
        ({ key, value }) => localStorage.setItem(key, value),
        { key: LOCALE_STORAGE_KEY, value: locale },
      );

      const runId = randomUUID();
      const title = `E2E recurring lifecycle ${runId}`;
      const ordinaryTitle = `E2E ordinary occurrence ${runId}`;
      const fallbackTitle = `E2E synthetic 404 occurrence ${runId}`;
      const historyId = randomUUID();
      const ownedIds = new Set<string>([historyId]);
      const titles = [title, ordinaryTitle, fallbackTitle];
      const writes: Array<{ method: string; path: string; body: unknown }> = [];
      const onRequest = (request: {
        method(): string;
        url(): string;
        postDataJSON(): unknown;
      }) => {
        if (!MUTATING_METHODS.has(request.method())) return;
        let body: unknown = null;
        try {
          body = request.postDataJSON();
        } catch {
          body = request.url();
        }
        writes.push({
          method: request.method(),
          path: new URL(request.url()).pathname,
          body,
        });
      };
      page.on("request", onRequest);

      let anchorId: string | undefined;
      let ordinaryId: string | undefined;
      let fallbackId: string | undefined;
      let releaseDelete: ((continueRequest: boolean) => void) | undefined;
      let childContext: BrowserContext | undefined;
      let testFailure: unknown;
      try {
        await page.goto("/dashboard");
        await runtimeIdentity(page, info, locale, info.project.name);
        anchorId = await createWeeklyAnchor(page, info, locale, title);
        ownedIds.add(anchorId);
        await insertCompletedHistory(historyId, title, anchorId);
        const createdRows = await readSeries(page, anchorId);
        expect(createdRows.find((row) => row.id === anchorId)).toMatchObject({
          id: anchorId,
          family_id: A.family,
          created_by: A.parent,
          title,
          recurrence_id: anchorId,
          is_template: true,
          frequency: "weekly",
        });

        // A parent can read the own family and cannot delete a foreign row.
        const foreignBefore = await withForeignParent(
          browser,
          async (foreignPage) =>
            browserFetch(foreignPage, `/api/chores?id=${B.chore}`),
        );
        expect(foreignBefore.status, foreignBefore.body).toBe(200);
        expect(JSON.parse(foreignBefore.body).chore).toMatchObject({
          id: B.chore,
          family_id: B.family,
          created_by: B.parent,
        });
        const foreignAttempt = await browserSend(
          page,
          "DELETE",
          "/api/chores",
          {
            choreId: B.chore,
          },
        );
        expect(foreignAttempt.status, foreignAttempt.body).toBe(403);
        const foreignAfter = await withForeignParent(
          browser,
          async (foreignPage) =>
            browserFetch(foreignPage, `/api/chores?id=${B.chore}`),
        );
        expect(foreignAfter.status, foreignAfter.body).toBe(200);
        expect(JSON.parse(foreignAfter.body).chore.id).toBe(B.chore);

        // The current assignee is still unable to use the parent-only Stop
        // frequency mutation, even though ordinary occurrence policy is
        // assignee-aware.
        childContext = await browser.newContext({
          storageState: authFile("childA"),
          timezoneId: E2E_TIMEZONE,
        });
        await installLoopbackGuard(childContext);
        const childPage = await childContext.newPage();
        await childPage.goto("/dashboard");
        const childAttempt = await browserSend(
          childPage,
          "PATCH",
          "/api/chores",
          {
            choreId: anchorId,
            frequency: "once",
          },
        );
        expect(childAttempt.status, childAttempt.body).toBe(403);
        await childContext.close();
        childContext = undefined;

        const activeDelete = await browserSend(page, "DELETE", "/api/chores", {
          choreId: anchorId,
        });
        expect(activeDelete.status, activeDelete.body).toBe(409);
        expect(JSON.parse(activeDelete.body).code).toBe(
          "RECURRING_SERIES_REQUIRES_STOP",
        );
        const activeRead = await browserFetch(
          page,
          `/api/chores?id=${encodeURIComponent(anchorId)}`,
        );
        expect(activeRead.status, activeRead.body).toBe(200);
        expect(JSON.parse(activeRead.body).chore.id).toBe(anchorId);

        const copy = choreFormMessages[locale];
        const menuName = `More actions for “${title}”`;
        const menuOpener = page.getByRole("button", {
          name: menuName,
          exact: true,
        });
        await expect(menuOpener).toBeVisible();
        await menuOpener.click();
        const sheet = page.getByRole("dialog", { name: menuName, exact: true });
        const stop = sheet.getByRole("button", {
          name: copy.stopRepeating,
          exact: true,
        });
        await expect(stop).toBeVisible();
        await captureSurface(
          page,
          info,
          `${locale}-${info.project.name}-stop-menu`,
          [stop, sheet.getByRole("button", { name: "Cancel", exact: true })],
        );
        const patchesBeforeStop = writes.filter(
          (write) => write.method === "PATCH",
        ).length;
        await stop.click();
        await expect(page).toHaveURL(
          new RegExp(`/dashboard/chores/edit\\?id=${anchorId}&stop=1$`),
        );
        const once = page.getByRole("button", { name: copy.once, exact: true });
        await expect(once).toHaveAttribute("aria-pressed", "true");
        expect(writes.filter((write) => write.method === "PATCH").length).toBe(
          patchesBeforeStop,
        );
        const save = page.getByRole("button", { name: copy.save, exact: true });
        await captureSurface(
          page,
          info,
          `${locale}-${info.project.name}-stop-edit`,
          [once, save],
        );
        const saveResponsePromise = page.waitForResponse(
          (response) =>
            response.request().method() === "PATCH" &&
            new URL(response.url()).pathname === "/api/chores",
        );
        await save.click();
        const saveResponse = await saveResponsePromise;
        expect(saveResponse.status()).toBe(200);
        await expect(page).toHaveURL(/\/dashboard\/chores\/?$/);

        const stoppedRows = await readSeries(page, anchorId);
        const stoppedAnchor = stoppedRows.find((row) => row.id === anchorId);
        expect(stoppedAnchor).toMatchObject({
          family_id: A.family,
          created_by: A.parent,
          title,
          recurrence_id: anchorId,
          is_template: false,
          frequency: "once",
        });
        expect(stoppedRows.find((row) => row.id === historyId)).toMatchObject({
          id: historyId,
          family_id: A.family,
          created_by: A.parent,
          title,
          status: "completed",
        });
        expect(
          stoppedRows.filter(
            (row) =>
              row.status === "pending" &&
              new Date(row.due_date).getTime() > anchorDay().getTime(),
          ),
        ).toEqual([]);

        const stoppedDelete = await browserSend(page, "DELETE", "/api/chores", {
          choreId: anchorId,
        });
        expect(stoppedDelete.status, stoppedDelete.body).toBe(409);
        expect(JSON.parse(stoppedDelete.body).code).toBe(
          "RECURRING_ANCHOR_RETAINS_HISTORY",
        );
        const stoppedRead = await browserFetch(
          page,
          `/api/chores?id=${encodeURIComponent(anchorId)}`,
        );
        expect(stoppedRead.status, stoppedRead.body).toBe(200);

        const ordinaryCreated = await browserSend(
          page,
          "POST",
          "/api/chores/create",
          {
            title: ordinaryTitle,
            assigned_to: A.child,
            due_date: anchorDay().toISOString().slice(0, 10),
            difficulty: "easy",
            frequency: "once",
            points: 10,
          },
        );
        expect(ordinaryCreated.status, ordinaryCreated.body).toBe(200);
        ordinaryId = JSON.parse(ordinaryCreated.body).chore.id as string;
        ownedIds.add(ordinaryId);
        expect(JSON.parse(ordinaryCreated.body).chore).toMatchObject({
          id: ordinaryId,
          family_id: A.family,
          created_by: A.parent,
          title: ordinaryTitle,
        });
        await page.reload();
        await expect(
          page.getByRole("button", {
            name: `More actions for “${ordinaryTitle}”`,
            exact: true,
          }),
        ).toBeVisible();

        const fallbackCreated = await browserSend(
          page,
          "POST",
          "/api/chores/create",
          {
            title: fallbackTitle,
            assigned_to: A.child,
            due_date: anchorDay().toISOString().slice(0, 10),
            difficulty: "easy",
            frequency: "once",
            points: 10,
          },
        );
        expect(fallbackCreated.status, fallbackCreated.body).toBe(200);
        fallbackId = JSON.parse(fallbackCreated.body).chore.id as string;
        ownedIds.add(fallbackId);
        expect(JSON.parse(fallbackCreated.body).chore).toMatchObject({
          id: fallbackId,
          family_id: A.family,
          created_by: A.parent,
          title: fallbackTitle,
        });
        await page.reload();

        const deleteBodies: unknown[] = [];
        await page.route("**/api/chores**", async (route) => {
          const request = route.request();
          let body: { choreId?: string } | null = null;
          try {
            body = request.postDataJSON() as { choreId?: string } | null;
          } catch {
            body = null;
          }
          const url = new URL(request.url());
          if (request.method() === "DELETE" && body?.choreId === ordinaryId) {
            deleteBodies.push(body);
            const continueRequest = await new Promise<boolean>((resolve) => {
              releaseDelete = resolve;
            });
            if (continueRequest) await route.continue();
            else await route.abort();
            return;
          }
          if (request.method() === "DELETE" && body?.choreId === fallbackId) {
            deleteBodies.push(body);
            await route.fulfill({
              status: 404,
              contentType: "application/json",
              body: JSON.stringify({ error: "Chore not found" }),
            });
            return;
          }
          if (
            request.method() === "GET" &&
            url.searchParams.get("id") === fallbackId
          ) {
            await route.fulfill({
              status: 404,
              contentType: "application/json",
              body: JSON.stringify({ error: "Chore not found" }),
            });
            return;
          }
          await route.continue();
        });

        const ordinaryOpener = page.getByRole("button", {
          name: `More actions for “${ordinaryTitle}”`,
          exact: true,
        });
        await ordinaryOpener.click();
        const ordinarySheet = page.getByRole("dialog", {
          name: `More actions for “${ordinaryTitle}”`,
          exact: true,
        });
        await ordinarySheet
          .getByRole("button", { name: copy.deleteOccurrence, exact: true })
          .click();
        const deleteDialog = page.getByRole("alertdialog", {
          name: copy.deleteOccurrenceConfirm,
          exact: true,
        });
        await expect(deleteDialog).toBeVisible();
        const cancel = deleteDialog
          .getByRole("button", {
            name: copy.deleteOccurrenceCancel,
            exact: true,
          })
          .last();
        const deleteButton = deleteDialog.getByRole("button", {
          name: copy.deleteOccurrenceButton,
          exact: true,
        });
        await captureSurface(
          page,
          info,
          `${locale}-${info.project.name}-delete-dialog`,
          [cancel, deleteButton],
        );
        const deleteResponsePromise = page.waitForResponse(
          (response) =>
            response.request().method() === "DELETE" &&
            new URL(response.url()).pathname === "/api/chores",
        );
        await deleteButton.click();
        await expect(
          deleteDialog.getByRole("button", {
            name: copy.deleteOccurrencePending,
            exact: true,
          }),
        ).toBeDisabled();
        await expect(cancel).toBeDisabled();
        await expect(deleteDialog.locator("[aria-busy='true']")).toHaveCount(1);
        expect(deleteBodies).toHaveLength(1);
        const pendingUrl = page.url();
        await page
          .goBack({ waitUntil: "commit", timeout: 1_500 })
          .catch(() => undefined);
        await expect.poll(() => page.url()).toBe(pendingUrl);
        await expect(deleteDialog).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(deleteDialog).toBeVisible();
        expect(deleteBodies).toHaveLength(1);
        releaseDelete?.(true);
        releaseDelete = undefined;
        const deleteResponse = await deleteResponsePromise;
        expect(deleteResponse.status()).toBe(200);
        await expect(page.getByRole("alertdialog")).toHaveCount(0);
        await expect(
          page.getByText(ordinaryTitle, { exact: true }),
        ).toHaveCount(0);
        const ordinaryRead = await browserFetch(
          page,
          `/api/chores?id=${encodeURIComponent(ordinaryId)}`,
        );
        expect(ordinaryRead.status, ordinaryRead.body).toBe(404);
        expect(deleteBodies).toEqual([{ choreId: ordinaryId }]);

        // Explicitly labelled synthetic 404/readback recovery. The row is
        // deliberately retained in the disposable DB for guarded cleanup.
        const fallbackOpener = page.getByRole("button", {
          name: `More actions for “${fallbackTitle}”`,
          exact: true,
        });
        await fallbackOpener.click();
        const fallbackSheet = page.getByRole("dialog", {
          name: `More actions for “${fallbackTitle}”`,
          exact: true,
        });
        await fallbackSheet
          .getByRole("button", { name: copy.deleteOccurrence, exact: true })
          .click();
        const fallbackDialog = page.getByRole("alertdialog", {
          name: copy.deleteOccurrenceConfirm,
          exact: true,
        });
        await fallbackDialog
          .getByRole("button", {
            name: copy.deleteOccurrenceButton,
            exact: true,
          })
          .click();
        await expect(
          fallbackDialog.getByRole("button", {
            name: copy.deleteOccurrenceRefresh,
            exact: true,
          }),
        ).toBeVisible();
        await expect(fallbackDialog.getByRole("alert")).toContainText(
          copy.deleteOccurrenceNotFound,
        );
        await expect(
          page.getByText(fallbackTitle, { exact: true }),
        ).toBeVisible();
        await fallbackDialog
          .getByRole("button", {
            name: copy.deleteOccurrenceRefresh,
            exact: true,
          })
          .click();
        await expect(page.getByRole("alertdialog")).toHaveCount(0);
        await expect(
          page.getByText(fallbackTitle, { exact: true }),
        ).toHaveCount(0);
        await info.attach(
          `${locale}-${info.project.name}-synthetic-404-readback`,
          {
            body: JSON.stringify({
              method: "DELETE",
              status: 404,
              recovery: "explicit GET /api/chores?id=<owned-id> returned 404",
              primaryRealDelete: { status: 200, id: ordinaryId },
            }),
            contentType: "application/json",
          },
        );
      } catch (error) {
        testFailure = error;
        throw error;
      } finally {
        releaseDelete?.(false);
        releaseDelete = undefined;
        await page
          .unrouteAll({ behavior: "ignoreErrors" })
          .catch(() => undefined);
        await context
          .unrouteAll({ behavior: "ignoreErrors" })
          .catch(() => undefined);
        page.off("request", onRequest);
        await childContext?.close().catch(() => undefined);
        const cleanupFailures: unknown[] = [];
        try {
          await cleanupOwned(titles, ownedIds);
        } catch (error) {
          cleanupFailures.push(error);
        }
        if (cleanupFailures.length) {
          throw new AggregateError(
            [...(testFailure ? [testFailure] : []), ...cleanupFailures],
            "Recurring lifecycle journey failed to clean up owned rows",
          );
        }
      }
    });
  });
}

async function withForeignParent<T>(
  browser: Browser,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const context = await browser.newContext({
    storageState: authFile("parentB"),
    timezoneId: E2E_TIMEZONE,
  });
  await installLoopbackGuard(context);
  const page = await context.newPage();
  try {
    await page.goto("/dashboard");
    return await fn(page);
  } finally {
    await context.close();
  }
}
