/**
 * Parent routine-stack editor coverage (#499).
 *
 * This file owns only disposable rows whose IDs start with the per-test marker.
 * Successful mutation cases use the real loopback API; recovery cases intercept
 * only the routine transport so no uncertain or malformed response can write a
 * domain row. Every case still runs at the six responsive projects in both
 * locales. Every case owns a disposable family, parent, child, members and
 * chores; the child check never uses a shared fixture.
 */
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import pg from "pg";
import type { BrowserContext, Page, TestInfo } from "@playwright/test";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { E2E_ANCHOR } from "./support/env";
import { browserFetch, expect, loginViaUi, test } from "./support/test";

const A = FIXTURE_IDS.familyA;
const PROJECTS = [
  "phone-390x844",
  "phone-430x932",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
  "tablet-large-1920x1200",
  "desktop-1366x768",
] as const;
const LOCALES = ["en", "es"] as const;
type Locale = (typeof LOCALES)[number];
const DATE = E2E_ANCHOR.toISOString().slice(0, 10);
const TIMESTAMP = `${DATE}T00:00:00.000Z`;

const copy = {
  en: {
    build: "Build a routine",
    label: "Routine name",
    candidates: "Add an existing chore",
    add: "Add",
    newTitle: "Chore title",
    assignedTo: "Assigned to",
    addStep: "Add step",
    save: "Save routine",
    saving: "Saving routine…",
    cancel: "Cancel",
    close: "Close routine editor",
    retry: "Try again",
    retrySave: "Retry save",
    reload: "Reload latest routine",
    discard: "Discard changes",
    keepEditing: "Keep editing",
    unknownSave: "We could not confirm whether the routine was saved.",
    loadError: "Routine could not load",
    moveDown: (title: string) => `Move ${title} down`,
    remove: (title: string) => `Remove ${title} from routine`,
  },
  es: {
    build: "Crear una rutina",
    label: "Nombre de la rutina",
    candidates: "Añadir una tarea existente",
    add: "Añadir",
    newTitle: "Título de la tarea",
    assignedTo: "Asignada a",
    addStep: "Añadir paso",
    save: "Guardar rutina",
    saving: "Guardando rutina…",
    cancel: "Cancelar",
    close: "Cerrar editor de rutina",
    retry: "Intentar de nuevo",
    retrySave: "Reintentar guardado",
    reload: "Cargar la rutina más reciente",
    discard: "Descartar cambios",
    keepEditing: "Seguir editando",
    unknownSave: "No pudimos confirmar si se guardó la rutina.",
    loadError: "No se pudo cargar la rutina",
    moveDown: (title: string) => `Bajar ${title}`,
    remove: (title: string) => `Quitar ${title} de la rutina`,
  },
} as const;

type Fixture = {
  prefix: string;
  family: string;
  parent: string;
  child: string;
  parentEmail: string;
  childEmail: string;
  label: string;
  memberParent: string;
  memberChild: string;
  existingChild: string;
  existingParent: string;
  childTitle: string;
  parentTitle: string;
  newTitle: string;
};

function fixtureFor(info: TestInfo, locale: Locale): Fixture {
  const identity = `${info.project.name}_${locale}_${info.testId}`;
  const suffix = identity.replace(/[^a-zA-Z0-9_]/g, "_").slice(-52);
  // User IDs also pass through the offline queue namespace, whose canonical
  // identifier limit is 64 characters. A compact digest preserves unique
  // ownership without weakening that production limit.
  const token = createHash("sha256")
    .update(identity)
    .digest("hex")
    .slice(0, 24);
  const prefix = `fx_e2e_rs_${token}`;
  const email = (id: string) => `${id.replace(/_/g, "-")}@example.test`;
  const family = `${prefix}_family`;
  const parent = `${prefix}_parent`;
  const child = `${prefix}_child`;
  // Keep the visible label within the canonical 40-character API limit while
  // retaining the compact unique marker in every owned row ID above.
  // Leave seven characters for the real edit journey's " edited" suffix.
  const label = `QA routine ${token.slice(0, 22)}`;
  return {
    prefix,
    family,
    parent,
    child,
    parentEmail: email(parent),
    childEmail: email(child),
    label,
    memberParent: `${prefix}_member_parent`,
    memberChild: `${prefix}_member_child`,
    existingChild: `${prefix}_existing_child`,
    existingParent: `${prefix}_existing_parent`,
    childTitle: `QA existing child ${suffix}`,
    parentTitle: `QA existing parent ${suffix}`,
    newTitle: `QA new step ${suffix}`,
  };
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

async function seedFixture(fixture: Fixture) {
  await withDb(async (db) => {
    // Copy only the seeded hash so these dedicated users can use the real UI
    // login. Never print or persist the source hash outside this disposable
    // transaction, and never mutate Family A's users or member mappings.
    const password = await db.query(
      `SELECT password FROM "User" WHERE id = $1`,
      [A.parent],
    );
    expect(password.rows[0]?.password).toEqual(expect.any(String));

    // The IDs are unique per test, but these exact predicates make retries
    // safe without touching another family's rows.
    await db.query(
      `UPDATE "Chore" SET routine_stack_id = NULL WHERE family_id = $1`,
      [fixture.family],
    );
    await db.query(`DELETE FROM "Chore" WHERE family_id = $1`, [
      fixture.family,
    ]);
    await db.query(`DELETE FROM "RoutineStack" WHERE family_id = $1`, [
      fixture.family,
    ]);
    await db.query(`DELETE FROM "IdempotencyRecord" WHERE family_id = $1`, [
      fixture.family,
    ]);
    await db.query(
      `DELETE FROM "HouseholdMemberAccountLink" WHERE family_id = $1`,
      [fixture.family],
    );
    await db.query(
      `DELETE FROM "HouseholdMemberLegacyMapping" WHERE family_id = $1`,
      [fixture.family],
    );
    await db.query(`DELETE FROM "HouseholdMember" WHERE family_id = $1`, [
      fixture.family,
    ]);
    await db.query(`DELETE FROM "User" WHERE id = ANY($1::text[])`, [
      [fixture.parent, fixture.child],
    ]);
    await db.query(`DELETE FROM "Family" WHERE id = $1`, [fixture.family]);

    await db.query(
      `INSERT INTO "Family" (id, name, invite_code) VALUES ($1, $2, $1)`,
      [fixture.family, `QA routine ${fixture.prefix}`],
    );
    await db.query(
      `INSERT INTO "User"
        (id, email, password, name, role, family_id, email_verified, created_at)
       VALUES ($1, $2, $3, $4, 'parent', $5, true, $6),
              ($7, $8, $3, $9, 'child', $5, true, $6)`,
      [
        fixture.parent,
        fixture.parentEmail,
        password.rows[0].password,
        `QA parent ${fixture.prefix}`,
        fixture.family,
        TIMESTAMP,
        fixture.child,
        fixture.childEmail,
        `QA child ${fixture.prefix}`,
      ],
    );

    await db.query(
      `INSERT INTO "HouseholdMember"
        (id, family_id, name, role, created_at, updated_at)
       VALUES
        ($1, $3, $4, 'parent', $5, $5),
        ($2, $3, $6, 'child', $5, $5)`,
      [
        fixture.memberParent,
        fixture.memberChild,
        fixture.family,
        `QA parent ${fixture.prefix}`,
        TIMESTAMP,
        `QA child ${fixture.prefix}`,
      ],
    );
    await db.query(
      `INSERT INTO "HouseholdMemberAccountLink"
        (member_id, user_id, family_id, verified_at, created_at)
       VALUES ($1, $3, $4, $5, $5), ($2, $6, $4, $5, $5)`,
      [
        fixture.memberParent,
        fixture.memberChild,
        fixture.parent,
        fixture.family,
        TIMESTAMP,
        fixture.child,
      ],
    );
    await db.query(
      `INSERT INTO "Chore"
        (id, family_id, title, description, points, assigned_to,
         assigned_member_id, due_date, status, frequency, difficulty,
         created_by, created_at, routine_stack_id)
       VALUES
        ($1, $5, $7, 'Synthetic editor row', 10, $6, $3, $8,
         'pending', 'once', 'easy', $4, $8, NULL),
        ($2, $5, $9, 'Synthetic editor row', 10, $4, $10, $8,
         'pending', 'once', 'easy', $4, $8, NULL)`,
      [
        fixture.existingChild,
        fixture.existingParent,
        fixture.memberChild,
        fixture.parent,
        fixture.family,
        fixture.child,
        fixture.childTitle,
        TIMESTAMP,
        fixture.parentTitle,
        fixture.memberParent,
      ],
    );

    const link = await db.query(
      `SELECT member_id, user_id, family_id
         FROM "HouseholdMemberAccountLink"
        WHERE member_id = ANY($1::text[])
        ORDER BY member_id`,
      [[fixture.memberParent, fixture.memberChild]],
    );
    expect(link.rows).toHaveLength(2);
    expect(link.rows.every((row) => row.family_id === fixture.family)).toBe(
      true,
    );
  });
}

async function cleanupFixture(fixture: Fixture) {
  await withDb(async (db) => {
    // The family is unique to this test, so every row selected by this family
    // predicate is owned. Clear the no-action stack FK before deleting rows;
    // do not search by a human label or delete shared fixture chores.
    await db.query(
      `UPDATE "Chore" SET routine_stack_id = NULL WHERE family_id = $1`,
      [fixture.family],
    );
    await db.query(`DELETE FROM "Chore" WHERE family_id = $1`, [
      fixture.family,
    ]);
    await db.query(`DELETE FROM "RoutineStack" WHERE family_id = $1`, [
      fixture.family,
    ]);
    await db.query(
      `DELETE FROM "IdempotencyRecord" WHERE family_id = $1 AND action = 'routine-stack.mutate'`,
      [fixture.family],
    );
    await db.query(
      `DELETE FROM "HouseholdMemberAccountLink" WHERE family_id = $1`,
      [fixture.family],
    );
    await db.query(
      `DELETE FROM "HouseholdMemberLegacyMapping" WHERE family_id = $1`,
      [fixture.family],
    );
    await db.query(`DELETE FROM "HouseholdMember" WHERE family_id = $1`, [
      fixture.family,
    ]);
    await db.query(`DELETE FROM "User" WHERE id = ANY($1::text[])`, [
      [fixture.parent, fixture.child],
    ]);
    await db.query(`DELETE FROM "Family" WHERE id = $1`, [fixture.family]);
  });
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

function builtAt() {
  const route = fs.readFileSync(
    ".next/server/app/api/version/route.js",
    "utf8",
  );
  const values = [
    ...new Set(route.match(/20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g) ?? []),
  ];
  expect(values).toHaveLength(1);
  return values[0];
}

async function runtimeIdentity(page: Page, info: TestInfo, locale: Locale) {
  const head = sourceHead();
  expect(head).toMatch(/^[a-f0-9]{40}$/);
  expect(() =>
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "prisma"], {
      stdio: "ignore",
    }),
  ).not.toThrow();
  expect(process.env.RELEASE_SHA?.trim()).toBe(head);
  const tree = sourceTree();
  expect(tree).toMatch(/^[a-f0-9]{40}$/);
  const configuredTree = process.env.E2E_ROUTINE_STACK_BUILD_TREE?.trim();
  if (configuredTree) expect(configuredTree).toBe(tree);
  const response = await page.request.get("/api/version");
  expect(response.status()).toBe(200);
  const runtime = (await response.json()) as {
    commit: string;
    builtAt: string;
  };
  expect(runtime.commit).toBe(head);
  expect(runtime.builtAt).toBe(builtAt());
  await info.attach("routine-stack-source-runtime-proof", {
    body: JSON.stringify({
      runtime,
      buildId: fs.readFileSync(".next/BUILD_ID", "utf8").trim(),
      buildTree: tree,
      configuredBuildTree: configuredTree ?? null,
      locale,
      role: "parent",
      transport:
        "real per-test household rows for success; routine transport intercepted for recovery",
    }),
    contentType: "application/json",
  });
}

async function loopbackGuard(context: BrowserContext, baseURL: string) {
  const host = new URL(baseURL).hostname;
  expect(["localhost", "127.0.0.1", "[::1]"].includes(host)).toBe(true);
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      ["data:", "blob:"].includes(url.protocol)
    ) {
      return route.continue();
    }
    return route.abort();
  });
}

async function setLocale(context: BrowserContext, locale: Locale) {
  await context.addInitScript(
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

async function assertUiLogin(
  page: Page,
  expectedUserId: string,
  expectedRole: "parent" | "child",
) {
  // loginViaUi performs the real form submission. Wait for its canonical
  // dashboard arrival before navigating again; a premature goto can abort the
  // redirect and leave the first protected page blank on slower builds.
  await expect(page).toHaveURL(/\/dashboard(?:\/.*)?$/);
  const auth = await browserFetch(page, "/api/auth/me");
  expect(auth.status, auth.body).toBe(200);
  const user = JSON.parse(auth.body).user as {
    id?: unknown;
    role?: unknown;
  };
  expect(user.id).toBe(expectedUserId);
  expect(user.role).toBe(expectedRole);
}

async function expectSurface(
  page: Page,
  info: TestInfo,
  locale: Locale,
  label: string,
) {
  const text = copy[locale];
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  const editor = page.getByTestId("routine-stack-editor");
  await expect(editor).toBeVisible();
  const targets = [
    { locator: editor.getByLabel(text.label), focus: true },
    {
      locator: editor.getByRole("button", { name: text.save, exact: true }),
      focus: false,
    },
  ];
  for (const { locator: target, focus } of targets) {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    const viewport = page.viewportSize();
    expect(box).toBeTruthy();
    expect(viewport).toBeTruthy();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
    if (focus) {
      await target.focus();
      await expect(target).toBeFocused();
    }
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude("next-route-announcer")
    .analyze();
  await info.attach(`axe-${label}-${locale}.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });
  expect(
    results.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
}

async function expectChoreListView(page: Page) {
  // A successful editor save uses router.back(). Wait for that navigation and
  // the mounted default view before issuing a canonical read or opening the
  // editor again; otherwise the old route's execution context can disappear
  // while browserFetch is still evaluating in the page.
  await expect(page).toHaveURL(/\/dashboard\/chores$/);
  const view = page.getByRole("group", { name: "Chore view" });
  await expect(view).toBeVisible();
  // Intercepted sheets preserve the selected Routines tab; direct routes may
  // remount the default list. Both are the canonical mounted chore workspace.
  await expect(view.locator('button[aria-pressed="true"]')).toHaveCount(1);
}

async function makeDraft(page: Page, fixture: Fixture, locale: Locale) {
  const text = copy[locale];
  const editor = page.getByTestId("routine-stack-editor");
  const candidates = editor
    .locator("section")
    .filter({ hasText: text.candidates })
    .first();
  // Never take whichever seed row happens to sort first. Both owned chores
  // are required for the three-step real journey (two existing + one new).
  for (const title of [fixture.childTitle, fixture.parentTitle]) {
    const row = candidates.locator("li").filter({ hasText: title }).first();
    await expect(row).toContainText(title);
    await row.getByRole("button", { name: text.add, exact: true }).click();
  }
  await editor.getByLabel(text.label).fill(fixture.label);
  await editor.locator("#routine-new-title").fill(fixture.newTitle);
  await editor.locator("#routine-new-assignee").selectOption(fixture.child);
  await editor.getByRole("button", { name: text.addStep, exact: true }).click();
  return editor;
}

async function syntheticSaveResponse(
  route: Parameters<Parameters<Page["route"]>[1]>[0],
  fixture: Fixture,
) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      stack_id: "synthetic-routine-stack",
      version: 1,
      steps: [["synthetic-step", 1, 1]],
      assignments: [[fixture.child, "synthetic-member"]],
      members: [["synthetic-member", "Synthetic member"]],
      fingerprint: "synthetic-fingerprint",
    }),
  });
}

test.describe.configure({ mode: "serial" });

for (const locale of LOCALES) {
  test.describe(`${locale} routine stack editor`, () => {
    test(`${locale}: real create, add, reassign, reorder, unstack and child privacy`, async ({
      page,
      browser,
      context,
      baseURL,
    }, info) => {
      test.skip(
        !PROJECTS.includes(info.project.name as (typeof PROJECTS)[number]),
        "routine editor matrix runs at all six responsive projects",
      );
      assertFixtureTargetAllowed(process.env);
      const fixture = fixtureFor(info, locale);
      await loopbackGuard(context, baseURL!);
      let stackId: string | null = null;
      try {
        await seedFixture(fixture);
        await context.clearCookies();
        await loginViaUi(page, fixture.parentEmail);
        await assertUiLogin(page, fixture.parent, "parent");
        await setLocale(context, locale);
        await page.goto("/dashboard/chores");
        await runtimeIdentity(page, info, locale);
        await page
          .getByRole("button", { name: "Routines", exact: true })
          .click();
        await page
          .getByRole("link", { name: copy[locale].build, exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await makeDraft(page, fixture, locale);
        const saveResponse = page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/chores/stacks") &&
            response.request().method() === "POST",
        );
        await page
          .getByRole("button", { name: copy[locale].save, exact: true })
          .click();
        const response = await saveResponse;
        const responseBody = await response.text();
        expect(response.status(), responseBody).toBe(200);
        const body = JSON.parse(responseBody) as {
          stack_id?: string;
          fingerprint?: string;
        };
        expect(body.stack_id).toEqual(expect.any(String));
        expect(body.fingerprint).toEqual(expect.any(String));
        stackId = body.stack_id!;
        await expectChoreListView(page);
        await expect(page.getByRole("dialog")).toHaveCount(0);

        const read = await browserFetch(
          page,
          `/api/chores/stacks?stack_id=${encodeURIComponent(stackId)}&occurrence_date=${DATE}`,
        );
        expect(read.status, read.body).toBe(200);
        const snapshot = JSON.parse(read.body) as {
          fingerprint: string;
          steps: Array<{ id: string; assigned_to: string }>;
        };
        expect(snapshot.fingerprint).toEqual(expect.any(String));
        expect(snapshot.steps).toHaveLength(3);
        expect(snapshot.steps.map((step) => step.id)).toContain(
          fixture.existingChild,
        );

        const childContext = await browser.newContext({
          locale: locale === "es" ? "es" : "en-US",
          colorScheme: locale === "es" ? "dark" : "light",
        });
        try {
          await loopbackGuard(childContext, baseURL!);
          const childPage = await childContext.newPage();
          await childPage.clock.install({ time: E2E_ANCHOR });
          await loginViaUi(childPage, fixture.childEmail);
          await assertUiLogin(childPage, fixture.child, "child");
          await setLocale(childContext, locale);
          await childPage.goto("/dashboard/today");
          const denied = await browserFetch(
            childPage,
            `/api/chores/stacks?stack_id=${encodeURIComponent(stackId)}&occurrence_date=${DATE}`,
          );
          expect(denied.status).toBe(403);
          expect(denied.body).not.toContain(fixture.label);
          await expect(childPage).toHaveURL(/\/dashboard\/today$/);
          const ownWork = childPage.getByTestId("my-chores");
          await expect(ownWork.getByText(fixture.childTitle)).toBeVisible();
          await expect(ownWork.getByText(fixture.parentTitle)).toHaveCount(0);
          await expect(
            childPage.getByRole("link", { name: /Edit routine|Editar rutina/ }),
          ).toHaveCount(0);
          await childPage.close();
        } finally {
          await childContext.close();
        }

        await page.goto(
          `/dashboard/chores/routines?stack_id=${encodeURIComponent(stackId)}&occurrence_date=${DATE}`,
        );
        await expectSurface(page, info, locale, "real-edit");
        const editor = page.getByTestId("routine-stack-editor");
        const editedLabel = `${fixture.label} edited`;
        await editor.getByLabel(copy[locale].label).fill(editedLabel);
        await expect(editor.getByLabel(copy[locale].label)).toHaveValue(
          editedLabel,
        );
        await editor
          .locator('select[id^="routine-assignee-"]')
          .first()
          .selectOption(fixture.parent);
        await editor
          .getByRole("button", {
            name: copy[locale].moveDown(fixture.childTitle),
            exact: true,
          })
          .click();
        const reorderResponse = page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/chores/stacks") &&
            response.request().method() === "POST",
        );
        await editor
          .getByRole("button", { name: copy[locale].save, exact: true })
          .click();
        const reorderResult = await reorderResponse;
        // Successful save navigates back; its canonical read below proves persistence.
        const reorderBody = reorderResult.ok()
          ? ""
          : await reorderResult.text();
        expect(reorderResult.status(), reorderBody).toBe(200);
        await expectChoreListView(page);
        const editedRead = await browserFetch(
          page,
          `/api/chores/stacks?stack_id=${encodeURIComponent(stackId)}&occurrence_date=${DATE}`,
        );
        expect(editedRead.status, editedRead.body).toBe(200);
        expect(JSON.parse(editedRead.body).stack.label).toBe(editedLabel);

        await page.goto(
          `/dashboard/chores/routines?stack_id=${encodeURIComponent(stackId)}&occurrence_date=${DATE}`,
        );
        await expect(page.getByTestId("routine-stack-editor")).toBeVisible();
        await expect(page.getByLabel(copy[locale].label)).toHaveValue(
          editedLabel,
        );
        const remove = page.getByRole("button", {
          name: copy[locale].remove(fixture.parentTitle),
          exact: true,
        });
        await remove.click();
        const unstackResponse = page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/chores/stacks") &&
            response.request().method() === "POST",
        );
        await page
          .getByRole("button", { name: copy[locale].save, exact: true })
          .click();
        expect((await unstackResponse).status()).toBe(200);
        await expectChoreListView(page);
        const finalRead = await browserFetch(
          page,
          `/api/chores/stacks?stack_id=${encodeURIComponent(stackId)}&occurrence_date=${DATE}`,
        );
        expect(finalRead.status, finalRead.body).toBe(200);
        expect(
          (JSON.parse(finalRead.body) as { steps: unknown[] }).steps,
        ).toHaveLength(2);
      } finally {
        await cleanupFixture(fixture);
      }
    });

    test(`${locale}: direct and intercepted sheets keep dirty drafts behind a shared discard dialog`, async ({
      page,
      context,
      baseURL,
    }, info) => {
      test.skip(
        !PROJECTS.includes(info.project.name as (typeof PROJECTS)[number]),
        "routine editor matrix runs at all six responsive projects",
      );
      assertFixtureTargetAllowed(process.env);
      const fixture = fixtureFor(info, locale);
      await loopbackGuard(context, baseURL!);
      let writes = 0;
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname === "/api/chores/stacks"
        )
          writes += 1;
      });
      try {
        await seedFixture(fixture);
        await context.clearCookies();
        await loginViaUi(page, fixture.parentEmail);
        await assertUiLogin(page, fixture.parent, "parent");
        await setLocale(context, locale);
        await page.goto("/dashboard/chores");
        await expectChoreListView(page);
        await page.goto(`/dashboard/chores/routines?occurrence_date=${DATE}`);
        await runtimeIdentity(page, info, locale);
        await expectSurface(page, info, locale, "direct-draft");
        const label = page.getByLabel(copy[locale].label);
        await label.fill(fixture.label);
        await page
          .getByRole("button", { name: copy[locale].cancel, exact: true })
          .click();
        const discard = page.getByRole("alertdialog");
        await expect(discard).toBeVisible();
        await discard
          .getByRole("button", { name: copy[locale].keepEditing, exact: true })
          .click();
        await expect(label).toHaveValue(fixture.label);
        await page
          .getByRole("button", { name: copy[locale].cancel, exact: true })
          .click();
        await page
          .getByRole("alertdialog")
          .getByRole("button", { name: copy[locale].discard, exact: true })
          .click();
        await page.goto("/dashboard/chores");
        await expectChoreListView(page);
        await page
          .getByRole("button", { name: "Routines", exact: true })
          .click();
        await page
          .getByRole("link", { name: copy[locale].build, exact: true })
          .click();
        const sheet = page.getByRole("dialog");
        await expect(sheet).toBeVisible();
        await sheet.getByLabel(copy[locale].label).fill(fixture.label);
        await sheet
          .getByRole("button", { name: copy[locale].close, exact: true })
          .click();
        await expect(page.getByRole("alertdialog")).toBeVisible();
        await page
          .getByRole("alertdialog")
          .getByRole("button", { name: copy[locale].keepEditing, exact: true })
          .click();
        await expect(sheet.getByLabel(copy[locale].label)).toHaveValue(
          fixture.label,
        );
        expect(writes).toBe(0);
      } finally {
        await cleanupFixture(fixture);
      }
    });

    test(`${locale}: malformed candidate, malformed save and in-flight 409 expose retry without writes`, async ({
      page,
      context,
      baseURL,
    }, info) => {
      test.skip(
        !PROJECTS.includes(info.project.name as (typeof PROJECTS)[number]),
        "routine editor matrix runs at all six responsive projects",
      );
      assertFixtureTargetAllowed(process.env);
      const fixture = fixtureFor(info, locale);
      await loopbackGuard(context, baseURL!);
      let candidateAttempts = 0;
      let postAttempts = 0;
      const posts: Array<{ key: string; body: string }> = [];
      try {
        await seedFixture(fixture);
        await context.clearCookies();
        await loginViaUi(page, fixture.parentEmail);
        await assertUiLogin(page, fixture.parent, "parent");
        await setLocale(context, locale);
        await page.route("**/api/chores/stacks/candidates**", async (route) => {
          if (route.request().method() !== "GET") return route.continue();
          candidateAttempts += 1;
          if (candidateAttempts === 1) {
            return route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({ candidates: [] }),
            });
          }
          return route.continue();
        });
        await page.goto("/dashboard/chores");
        await expectChoreListView(page);
        await page.goto(`/dashboard/chores/routines?occurrence_date=${DATE}`);
        await runtimeIdentity(page, info, locale);
        await expect(
          page.getByRole("heading", { name: copy[locale].loadError }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: copy[locale].retry, exact: true })
          .click();
        await expect(page.getByTestId("routine-stack-editor")).toBeVisible();

        await page.route("**/api/chores/stacks", async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          if (request.method() !== "POST" || url.search)
            return route.continue();
          postAttempts += 1;
          const headers = request.headers();
          posts.push({
            key: headers["idempotency-key"] ?? "",
            body: request.postData() ?? "",
          });
          if (postAttempts === 1) {
            return route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({ stack_id: "malformed" }),
            });
          }
          if (postAttempts === 2) {
            return syntheticSaveResponse(route, fixture);
          }
          if (postAttempts === 3) {
            return route.fulfill({
              status: 409,
              contentType: "application/json",
              body: JSON.stringify({
                error: { code: "IDEMPOTENCY_IN_PROGRESS" },
              }),
            });
          }
          return syntheticSaveResponse(route, fixture);
        });

        const editor = await makeDraft(page, fixture, locale);
        await editor
          .getByRole("button", { name: copy[locale].save, exact: true })
          .click();
        await expect(editor.getByRole("alert")).toContainText(
          copy[locale].unknownSave,
        );
        await page
          .getByRole("button", { name: copy[locale].retrySave, exact: true })
          .click();
        await expectChoreListView(page);
        expect(postAttempts).toBe(2);
        expect(posts[0]).toEqual(posts[1]);

        await page.goto(`/dashboard/chores/routines?occurrence_date=${DATE}`);
        await expect(page.getByTestId("routine-stack-editor")).toBeVisible();
        const secondEditor = await makeDraft(page, fixture, locale);
        await secondEditor
          .getByRole("button", { name: copy[locale].save, exact: true })
          .click();
        await expect(secondEditor.getByRole("alert")).toContainText(
          copy[locale].unknownSave,
        );
        await page
          .getByRole("button", { name: copy[locale].retrySave, exact: true })
          .click();
        await expectChoreListView(page);
        expect(postAttempts).toBe(4);
        expect(posts[2]).toEqual(posts[3]);
      } finally {
        await cleanupFixture(fixture);
      }
    });

    test(`${locale}: explicit conflict asks before reloading the latest stack`, async ({
      page,
      context,
      baseURL,
    }, info) => {
      test.skip(
        !PROJECTS.includes(info.project.name as (typeof PROJECTS)[number]),
        "routine editor matrix runs at all six responsive projects",
      );
      assertFixtureTargetAllowed(process.env);
      const fixture = fixtureFor(info, locale);
      await loopbackGuard(context, baseURL!);
      try {
        await seedFixture(fixture);
        await context.clearCookies();
        await loginViaUi(page, fixture.parentEmail);
        await assertUiLogin(page, fixture.parent, "parent");
        await setLocale(context, locale);
        await page.route("**/api/chores/stacks", async (route) => {
          if (route.request().method() === "POST") {
            return route.fulfill({
              status: 409,
              contentType: "application/json",
              body: JSON.stringify({
                error: { code: "ROUTINE_STACK_CONFLICT" },
              }),
            });
          }
          return route.continue();
        });
        await page.goto("/dashboard/chores");
        await expectChoreListView(page);
        await page.goto(`/dashboard/chores/routines?occurrence_date=${DATE}`);
        await runtimeIdentity(page, info, locale);
        const editor = await makeDraft(page, fixture, locale);
        await editor
          .getByRole("button", { name: copy[locale].save, exact: true })
          .click();
        await expect(editor.getByRole("alert")).toBeVisible();
        await page
          .getByRole("button", { name: copy[locale].reload, exact: true })
          .click();
        const discard = page.getByRole("alertdialog");
        await expect(discard).toBeVisible();
        await discard
          .getByRole("button", { name: copy[locale].reload, exact: true })
          .click();
        await expect(page.getByTestId("routine-stack-editor")).toBeVisible();
        await expect(page.getByLabel(copy[locale].label)).not.toHaveValue(
          fixture.label,
        );
      } finally {
        await cleanupFixture(fixture);
      }
    });
  });
}
