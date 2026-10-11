/**
 * Parent routine-stack editor coverage (#499).
 *
 * This file owns only disposable rows whose IDs start with the per-test marker.
 * Successful mutation cases use the real loopback API; recovery cases intercept
 * only the routine transport so no uncertain or malformed response can write a
 * domain row. Every case still runs at the six responsive projects in both
 * locales. The child check uses the seeded Family A account but never mutates
 * it or the routine.
 */
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import pg from "pg";
import type { BrowserContext, Page, TestInfo } from "@playwright/test";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { E2E_ANCHOR, authFile } from "./support/env";
import { browserFetch, expect, test } from "./support/test";

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
  const suffix = `${info.project.name}_${locale}_${info.testId}`
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .slice(-52);
  const prefix = `fx_e2e_rs_${suffix}`;
  return {
    prefix,
    label: `QA routine ${suffix}`,
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
    const family = await db.query(`SELECT id FROM "Family" WHERE id = $1`, [
      A.family,
    ]);
    const parent = await db.query(
      `SELECT id, family_id, role FROM "User" WHERE id = $1`,
      [A.parent],
    );
    const child = await db.query(
      `SELECT id, family_id, role FROM "User" WHERE id = $1`,
      [A.child],
    );
    expect(family.rows).toHaveLength(1);
    expect(parent.rows[0]).toMatchObject({
      id: A.parent,
      family_id: A.family,
      role: "parent",
    });
    expect(child.rows[0]).toMatchObject({
      id: A.child,
      family_id: A.family,
      role: "child",
    });

    await db.query(`DELETE FROM "Chore" WHERE id LIKE $1`, [
      `${fixture.prefix}%`,
    ]);
    await db.query(
      `DELETE FROM "HouseholdMemberAccountLink" WHERE member_id = ANY($1::text[])`,
      [[fixture.memberParent, fixture.memberChild]],
    );
    await db.query(
      `DELETE FROM "HouseholdMemberLegacyMapping" WHERE member_id = ANY($1::text[])`,
      [[fixture.memberParent, fixture.memberChild]],
    );
    await db.query(`DELETE FROM "HouseholdMember" WHERE id = ANY($1::text[])`, [
      [fixture.memberParent, fixture.memberChild],
    ]);

    await db.query(
      `INSERT INTO "HouseholdMember"
        (id, family_id, name, role, created_at, updated_at)
       VALUES
        ($1, $3, $4, 'parent', $5, $5),
        ($2, $3, $6, 'child', $5, $5)`,
      [
        fixture.memberParent,
        fixture.memberChild,
        A.family,
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
        A.parent,
        A.family,
        TIMESTAMP,
        A.child,
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
        A.parent,
        A.family,
        A.child,
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
    expect(link.rows.every((row) => row.family_id === A.family)).toBe(true);
  });
}

async function cleanupFixture(fixture: Fixture) {
  await withDb(async (db) => {
    const stacks = await db.query(
      `SELECT id FROM "RoutineStack" WHERE family_id = $1 AND label LIKE $2`,
      [A.family, `${fixture.label}%`],
    );
    const stackIds = stacks.rows.map((row) => row.id as string);
    await db.query(`DELETE FROM "Chore" WHERE id LIKE $1`, [
      `${fixture.prefix}%`,
    ]);
    if (stackIds.length) {
      await db.query(
        `DELETE FROM "Chore" WHERE family_id = $1 AND routine_stack_id = ANY($2::text[])`,
        [A.family, stackIds],
      );
      await db.query(`DELETE FROM "RoutineStack" WHERE id = ANY($1::text[])`, [
        stackIds,
      ]);
    }
    await db.query(
      `DELETE FROM "HouseholdMemberAccountLink" WHERE member_id = ANY($1::text[])`,
      [[fixture.memberParent, fixture.memberChild]],
    );
    await db.query(
      `DELETE FROM "HouseholdMemberLegacyMapping" WHERE member_id = ANY($1::text[])`,
      [[fixture.memberParent, fixture.memberChild]],
    );
    await db.query(`DELETE FROM "HouseholdMember" WHERE id = ANY($1::text[])`, [
      [fixture.memberParent, fixture.memberChild],
    ]);
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
        "real Family A rows for success; routine transport intercepted for recovery",
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

async function makeDraft(page: Page, fixture: Fixture, locale: Locale) {
  const text = copy[locale];
  const editor = page.getByTestId("routine-stack-editor");
  const candidates = editor
    .locator("section")
    .filter({ hasText: text.candidates })
    .first();
  await candidates
    .getByRole("button", { name: text.add, exact: true })
    .first()
    .click();
  await editor.getByLabel(text.label).fill(fixture.label);
  await editor.locator("#routine-new-title").fill(fixture.newTitle);
  await editor.locator("#routine-new-assignee").selectOption(A.child);
  await editor.getByRole("button", { name: text.addStep, exact: true }).click();
  return editor;
}

async function syntheticSaveResponse(
  route: Parameters<Parameters<Page["route"]>[1]>[0],
) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      stack_id: "synthetic-routine-stack",
      version: 1,
      steps: [["synthetic-step", 1, 1]],
      assignments: [[A.child, "synthetic-member"]],
      members: [["synthetic-member", "Synthetic member"]],
      fingerprint: "synthetic-fingerprint",
    }),
  });
}

test.use({ storageState: authFile("parentA") });
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
      await setLocale(context, locale);
      await seedFixture(fixture);
      let stackId: string | null = null;
      try {
        await page.goto("/dashboard/chores");
        await runtimeIdentity(page, info, locale);
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
        expect(response.status()).toBe(200);
        const body = (await response.json()) as {
          stack_id?: string;
          fingerprint?: string;
        };
        expect(body.stack_id).toEqual(expect.any(String));
        expect(body.fingerprint).toEqual(expect.any(String));
        stackId = body.stack_id!;
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
          storageState: authFile("childA"),
          locale: locale === "es" ? "es" : "en-US",
          colorScheme: locale === "es" ? "dark" : "light",
        });
        try {
          await loopbackGuard(childContext, baseURL!);
          const childPage = await childContext.newPage();
          await childPage.goto("/dashboard");
          const denied = await browserFetch(
            childPage,
            `/api/chores/stacks?stack_id=${encodeURIComponent(stackId)}&occurrence_date=${DATE}`,
          );
          expect(denied.status).toBe(403);
          expect(denied.body).not.toContain(fixture.label);
          await childPage.goto("/dashboard/chores");
          await expect(childPage.getByText(fixture.childTitle)).toBeVisible();
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
        await editor
          .getByLabel(copy[locale].label)
          .fill(`${fixture.label} edited`);
        await editor
          .locator('select[id^="routine-assignee-"]')
          .first()
          .selectOption(A.parent);
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
        expect((await reorderResponse).status()).toBe(200);

        await page.goto(
          `/dashboard/chores/routines?stack_id=${encodeURIComponent(stackId)}&occurrence_date=${DATE}`,
        );
        await expect(page.getByTestId("routine-stack-editor")).toBeVisible();
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
      await setLocale(context, locale);
      await seedFixture(fixture);
      let writes = 0;
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname === "/api/chores/stacks"
        )
          writes += 1;
      });
      try {
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
      await setLocale(context, locale);
      await seedFixture(fixture);
      let candidateAttempts = 0;
      let postAttempts = 0;
      const posts: Array<{ key: string; body: string }> = [];
      try {
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
            return syntheticSaveResponse(route);
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
          return syntheticSaveResponse(route);
        });

        const editor = await makeDraft(page, fixture, locale);
        await editor
          .getByRole("button", { name: copy[locale].save, exact: true })
          .click();
        await expect(page.getByRole("alert")).toContainText(
          copy[locale].unknownSave,
        );
        await page
          .getByRole("button", { name: copy[locale].retrySave, exact: true })
          .click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        expect(postAttempts).toBe(2);
        expect(posts[0]).toEqual(posts[1]);

        await page.goto(`/dashboard/chores/routines?occurrence_date=${DATE}`);
        await expect(page.getByTestId("routine-stack-editor")).toBeVisible();
        const secondEditor = await makeDraft(page, fixture, locale);
        await secondEditor
          .getByRole("button", { name: copy[locale].save, exact: true })
          .click();
        await expect(page.getByRole("alert")).toContainText(
          copy[locale].unknownSave,
        );
        await page
          .getByRole("button", { name: copy[locale].retrySave, exact: true })
          .click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
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
      await setLocale(context, locale);
      await seedFixture(fixture);
      try {
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
        await page.goto(`/dashboard/chores/routines?occurrence_date=${DATE}`);
        await runtimeIdentity(page, info, locale);
        const editor = await makeDraft(page, fixture, locale);
        await editor
          .getByRole("button", { name: copy[locale].save, exact: true })
          .click();
        await expect(page.getByRole("alert")).toBeVisible();
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
