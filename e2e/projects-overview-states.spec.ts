/**
 * #499 Projects overview and detail journey.
 *
 * This is a real-fixture browser proof for the approved Open/Done Projects
 * surface.  The create and task retry cases commit through the real API and
 * then lose only the browser response; the retry must reuse the same receipt
 * key and produce one row.  No successful response is fabricated.
 */
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import pg from "pg";
import type {
  Browser,
  BrowserContext,
  Locator,
  Page,
  TestInfo,
} from "@playwright/test";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { projectCreateMessages } from "../src/i18n/project-create";
import { projectOverviewMessages } from "../src/i18n/project-overview";
import { formatDateOnly } from "../src/lib/dates";
import { E2E_ANCHOR, authFile } from "./support/env";
import { ownFeatureAudit } from "./support/feature-audit";
import { browserFetch, browserSend, expect, test } from "./support/test";

const A = FIXTURE_IDS.familyA;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const VIEWPORT_PROJECTS = new Set([
  "phone-390x844",
  "phone-430x932",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
  "tablet-large-1920x1200",
  "desktop-1366x768",
]);
const FULL_WORKFLOW_PROJECTS = new Set(["phone-390x844", "desktop-1366x768"]);
const RENDER_ONLY_PROJECTS = new Set([
  "phone-430x932",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
  "tablet-large-1920x1200",
]);

type Locale = "en" | "es";
type FeatureSetup = {
  original: Record<string, unknown>;
  changed: boolean;
  cleanAudit: (restore: boolean) => Promise<void>;
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

async function removeOwnedRows(
  projectIds: readonly string[],
  idempotencyKeys: readonly string[],
): Promise<void> {
  if (!projectIds.length && !idempotencyKeys.length) return;
  await withDb(async (db) => {
    if (projectIds.length) {
      await db.query(
        `DELETE FROM "Project"
         WHERE family_id=$1 AND created_by=$2 AND id=ANY($3::text[])`,
        [A.family, A.parent, projectIds],
      );
    }
    if (idempotencyKeys.length) {
      await db.query(
        `DELETE FROM "IdempotencyRecord"
         WHERE family_id=$1 AND user_id=ANY($2::text[])
           AND action IN ('projects.create')
           AND key=ANY($3::text[])`,
        [A.family, [A.parent, A.child], idempotencyKeys],
      );
      // Task receipts include the disposable project id in their action.
      await db.query(
        `DELETE FROM "IdempotencyRecord"
         WHERE family_id=$1 AND user_id=ANY($2::text[])
           AND action LIKE 'projects.task.create:%'
           AND key=ANY($3::text[])`,
        [A.family, [A.parent, A.child], idempotencyKeys],
      );
    }
    if (projectIds.length) {
      const remaining = await db.query<{ id: string }>(
        `SELECT id FROM "Project"
         WHERE family_id=$1 AND created_by=$2 AND id=ANY($3::text[])`,
        [A.family, A.parent, projectIds],
      );
      expect(remaining.rows).toEqual([]);
    }
  });
}

async function installLoopbackGuard(
  context: BrowserContext,
  blockedWrites: string[],
  ownedProjectIds: Set<string>,
  ownedTaskIds: Set<string>,
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

    const projectId = url.pathname.startsWith("/api/projects/")
      ? url.pathname.slice("/api/projects/".length).split("/")[0]
      : "";
    const isOwnedProject = ownedProjectIds.has(projectId);
    const isOwnedTask = ownedTaskIds.has(
      url.pathname.split("/api/projects/")[1]?.split("/").at(-1) ?? "",
    );
    const allowedMutation =
      (request.method() === "PATCH" &&
        url.pathname === "/api/family/features") ||
      (request.method() === "POST" && url.pathname === "/api/projects") ||
      (request.method() === "POST" &&
        /^\/api\/projects\/[^/]+\/tasks$/.test(url.pathname) &&
        isOwnedProject) ||
      (request.method() === "PATCH" &&
        ((/^\/api\/projects\/[^/]+$/.test(url.pathname) && isOwnedProject) ||
          (/^\/api\/projects\/[^/]+\/tasks\/[^/]+$/.test(url.pathname) &&
            isOwnedTask))) ||
      (request.method() === "DELETE" && isOwnedProject);
    if (MUTATING_METHODS.has(request.method()) && !allowedMutation) {
      blockedWrites.push(`${request.method()} ${url.pathname}`);
      await route.abort();
      return;
    }
    await route.continue();
  });
}

async function configureLocale(page: Page, locale: Locale) {
  await page.addInitScript(
    ({ localeKey, language, themeKey }) => {
      localStorage.setItem(localeKey, language);
      localStorage.setItem(themeKey, language === "es" ? "dark" : "light");
    },
    {
      localeKey: LOCALE_STORAGE_KEY,
      language: locale,
      themeKey: THEME_STORAGE_KEY,
    },
  );
}

async function openRole(
  browser: Browser,
  baseURL: string | undefined,
  info: TestInfo,
  storageState: string,
  locale: Locale,
  blockedWrites: string[],
  ownedProjectIds: Set<string>,
  ownedTaskIds: Set<string>,
): Promise<{ context: BrowserContext; page: Page }> {
  const use = info.project.use;
  const context = await browser.newContext({
    baseURL,
    storageState,
    viewport: use.viewport,
    deviceScaleFactor: use.deviceScaleFactor,
    hasTouch: use.hasTouch,
    isMobile: use.isMobile,
    timezoneId: use.timezoneId,
    colorScheme: locale === "es" ? "dark" : "light",
    reducedMotion: "reduce",
    extraHTTPHeaders: use.extraHTTPHeaders,
  });
  await context.addInitScript(
    ({ localeKey, language, themeKey }) => {
      localStorage.setItem(localeKey, language);
      localStorage.setItem(themeKey, language === "es" ? "dark" : "light");
    },
    {
      localeKey: LOCALE_STORAGE_KEY,
      language: locale,
      themeKey: THEME_STORAGE_KEY,
    },
  );
  await installLoopbackGuard(
    context,
    blockedWrites,
    ownedProjectIds,
    ownedTaskIds,
  );
  const page = await context.newPage();
  await page.clock.install({ time: E2E_ANCHOR });
  await configureLocale(page, locale);
  return { context, page };
}

async function assertNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= window.innerWidth &&
        document.body.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

async function assertHitTarget(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const metrics = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return {
      width: rect.width,
      height: rect.height,
      x: rect.left,
      y: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      hit: hit === element || (hit instanceof Node && element.contains(hit)),
    };
  });
  const viewport = page.viewportSize();
  expect(viewport).toBeTruthy();
  expect(metrics.width).toBeGreaterThanOrEqual(44);
  expect(metrics.height).toBeGreaterThanOrEqual(44);
  expect(metrics.x).toBeGreaterThanOrEqual(0);
  expect(metrics.y).toBeGreaterThanOrEqual(0);
  expect(metrics.right).toBeLessThanOrEqual(viewport!.width);
  expect(metrics.bottom).toBeLessThanOrEqual(viewport!.height);
  expect(metrics.hit).toBe(true);
}

async function assertA11y(page: Page, scope = "main") {
  const violations = (
    await new AxeBuilder({ page }).include(scope).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
}

async function captureState(
  page: Page,
  info: TestInfo,
  locale: Locale,
  name: string,
) {
  const path = info.outputPath(`${name}.png`);
  const image = await page.screenshot({ path, fullPage: true });
  await info.attach(`${name}.png`, { path, contentType: "image/png" });
  await info.attach(`${name}.metadata.json`, {
    body: JSON.stringify({
      locale,
      project: info.project.name,
      viewport: page.viewportSize(),
      width: image.readUInt32BE(16),
      height: image.readUInt32BE(20),
    }),
    contentType: "application/json",
  });
}

async function enableProjects(page: Page): Promise<FeatureSetup> {
  const cleanAudit = await ownFeatureAudit(["projects"]);
  const current = await browserFetch(page, "/api/family/features");
  expect(current.status, current.body).toBe(200);
  const original = JSON.parse(current.body).features as Record<string, unknown>;
  const next = { ...original, projects: true };
  const changed = JSON.stringify(next) !== JSON.stringify(original);
  if (changed) {
    const response = await browserSend(page, "PATCH", "/api/family/features", {
      features: next,
    });
    expect(response.status, response.body).toBe(200);
  }
  return { original, changed, cleanAudit };
}

async function restoreProjects(page: Page, setup: FeatureSetup) {
  const errors: unknown[] = [];
  try {
    if (setup.changed) {
      const restored = await browserSend(
        page,
        "PATCH",
        "/api/family/features",
        { features: setup.original },
      );
      expect(restored.status, restored.body).toBe(200);
    }
  } catch (error) {
    errors.push(error);
  }
  try {
    await setup.cleanAudit(true);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length) throw errors[0];
}

async function sendWithKey(
  page: Page,
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body: unknown,
  key: string,
) {
  return page.evaluate(
    async ({ method: m, path: p, body: b, key: idempotencyKey }) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((cookie) => cookie.startsWith("csrf_token="))
          ?.slice("csrf_token=".length) ?? "";
      const response = await fetch(p, {
        method: m,
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf,
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(b),
      });
      return { status: response.status, body: await response.text() };
    },
    { method, path, body, key },
  );
}

function copyFor(locale: Locale) {
  return {
    create: projectCreateMessages[locale],
    overview: projectOverviewMessages[locale],
  };
}

for (const locale of ["en", "es"] as const) {
  test.describe(`${locale} Projects overview and detail`, () => {
    test.use({
      storageState: authFile("parentA"),
      colorScheme: locale === "es" ? "dark" : "light",
    });

    test(`${locale}: parent creates, retries, assigns, archives, reactivates, completes and scopes a project`, async ({
      page,
      context,
      browser,
      baseURL,
    }, info) => {
      assertFixtureTargetAllowed(process.env);
      expect(VIEWPORT_PROJECTS.has(info.project.name)).toBe(true);
      test.skip(
        !FULL_WORKFLOW_PROJECTS.has(info.project.name),
        "full create/retry/role workflow runs on representative phone and desktop projects",
      );
      const blockedWrites: string[] = [];
      const ownedProjectIds = new Set<string>();
      const ownedTaskIds = new Set<string>();
      const idempotencyKeys = new Set<string>();
      const copy = copyFor(locale);
      const runId = randomUUID();
      const projectName = `E2E Projects ${locale} ${runId} — café family garden goals that wrap cleanly on small screens`;
      const projectDescription = `Raw family note ${runId}: café, naïve, façade — keep this user content exactly as entered and readable across devices.`;
      const taskTitle = `E2E assigned task ${runId} — gather tools and label every garden box before the weekend`;
      let featureSetup: FeatureSetup | undefined;
      let childContext: BrowserContext | undefined;
      let familyBContext: BrowserContext | undefined;
      let projectId: string | undefined;
      let taskId: string | undefined;
      let firstCreateKey: string | undefined;
      let committedProjectId: string | undefined;
      let firstTaskKey: string | undefined;
      const projectRequestKeys: string[] = [];
      const taskRequestKeys: string[] = [];
      let loseProjectResponse = true;
      let loseTaskResponse = true;

      await installLoopbackGuard(
        context,
        blockedWrites,
        ownedProjectIds,
        ownedTaskIds,
      );
      await configureLocale(page, locale);
      await page.route("**/api/projects", async (route) => {
        if (
          loseProjectResponse &&
          route.request().method() === "POST" &&
          !firstCreateKey
        ) {
          firstCreateKey = route.request().headers()["idempotency-key"];
          if (!firstCreateKey)
            throw new Error("Project create omitted receipt key");
          projectRequestKeys.push(firstCreateKey);
          idempotencyKeys.add(firstCreateKey);
          loseProjectResponse = false;
          const response = await route.fetch();
          const body = (await response.json().catch(() => null)) as {
            project?: { id?: unknown };
          } | null;
          if (typeof body?.project?.id === "string") {
            committedProjectId = body.project.id;
            ownedProjectIds.add(committedProjectId);
          } else {
            throw new Error("Project create response omitted its canonical id");
          }
          await route.abort();
          return;
        }
        if (route.request().method() === "POST") {
          const key = route.request().headers()["idempotency-key"];
          if (key) projectRequestKeys.push(key);
        }
        await route.continue();
      });

      let primaryError: unknown;
      try {
        await page.goto("/dashboard");
        const identity = await browserFetch(page, "/api/auth/me");
        expect(identity.status, identity.body).toBe(200);
        expect(JSON.parse(identity.body).user).toMatchObject({
          id: A.parent,
          family_id: A.family,
          role: "parent",
        });
        featureSetup = await enableProjects(page);

        await page.goto("/dashboard/projects");
        await expect(
          page.getByRole("heading", {
            name: copy.overview.pageTitle,
            exact: true,
          }),
        ).toBeVisible();
        const newProject = page.getByRole("link", {
          name: copy.overview.newProject,
          exact: true,
        });
        await expect(newProject).toBeVisible();
        await assertHitTarget(page, newProject);
        await assertNoHorizontalOverflow(page);
        await assertA11y(page);
        await captureState(page, info, locale, "projects-empty-overview");

        await newProject.click();
        const createForm = page.locator("form").filter({
          has: page.getByRole("button", { name: copy.create.create }),
        });
        await expect(
          page.getByRole("heading", {
            name: copy.create.title,
            exact: true,
          }),
        ).toBeVisible();
        const nameField = createForm.getByLabel(new RegExp(copy.create.name));
        const descriptionField = createForm.getByLabel(
          copy.create.description,
          {
            exact: false,
          },
        );
        const createButton = createForm.getByRole("button", {
          name: copy.create.create,
          exact: true,
        });
        await nameField.fill(projectName);
        await descriptionField.fill(projectDescription);
        await assertHitTarget(page, createButton);
        await assertA11y(page);
        await createButton.click();
        await expect(
          page.getByRole("alert").filter({ hasText: copy.create.createError }),
        ).toBeVisible();
        await expect(nameField).toHaveValue(projectName);
        await expect(descriptionField).toHaveValue(projectDescription);
        expect(firstCreateKey).toBeTruthy();

        await createButton.click();
        expect(projectRequestKeys).toEqual([firstCreateKey, firstCreateKey]);
        expect(committedProjectId).toBeTruthy();
        await expect
          .poll(() => new URL(page.url()).pathname)
          .toBe(`/dashboard/projects/${committedProjectId}`);
        projectId = committedProjectId;
        expect(projectId).toBeTruthy();
        expect(ownedProjectIds.has(projectId!)).toBe(true);
        await expect(
          page.getByRole("heading", { name: projectName, exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText(copy.overview.noTasks, { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", {
            name: copy.overview.addTask,
            exact: true,
          }),
        ).toBeVisible();
        const persisted = await browserFetch(
          page,
          `/api/projects/${projectId}`,
        );
        expect(persisted.status, persisted.body).toBe(200);
        expect(JSON.parse(persisted.body).project).toMatchObject({
          id: projectId,
          family_id: A.family,
          created_by: A.parent,
          name: projectName,
          description: projectDescription,
          status: "active",
        });
        const allProjects = await browserFetch(page, "/api/projects");
        expect(allProjects.status, allProjects.body).toBe(200);
        const matchingProjects = (
          JSON.parse(allProjects.body).projects as Array<{ name?: string }>
        ).filter((project) => project.name === projectName);
        expect(matchingProjects).toHaveLength(1);
        await assertNoHorizontalOverflow(page);
        await assertA11y(page);
        await captureState(page, info, locale, "projects-empty-owned-detail");

        await page.unroute("**/api/projects");
        await page.route("**/api/projects/*/tasks", async (route) => {
          if (
            loseTaskResponse &&
            route.request().method() === "POST" &&
            !firstTaskKey
          ) {
            firstTaskKey = route.request().headers()["idempotency-key"];
            if (!firstTaskKey)
              throw new Error("Task create omitted receipt key");
            taskRequestKeys.push(firstTaskKey);
            idempotencyKeys.add(firstTaskKey);
            loseTaskResponse = false;
            const response = await route.fetch();
            const body = (await response.json().catch(() => null)) as {
              task?: { id?: unknown };
            } | null;
            if (typeof body?.task?.id === "string") {
              ownedTaskIds.add(body.task.id);
            }
            await route.abort();
            return;
          }
          if (route.request().method() === "POST") {
            const key = route.request().headers()["idempotency-key"];
            if (key) taskRequestKeys.push(key);
          }
          await route.continue();
        });

        const addTask = page.getByRole("button", {
          name: copy.overview.addTask,
          exact: true,
        });
        await addTask.click();
        const taskForm = page.getByRole("form", {
          name: copy.overview.taskFormLabel,
        });
        await expect(taskForm).toBeVisible();
        const taskField = taskForm.getByLabel(copy.overview.taskName, {
          exact: true,
        });
        const dueField = taskForm.getByLabel(copy.overview.dueDate, {
          exact: false,
        });
        const assigneeField = taskForm.getByLabel(copy.overview.whoIsDoingIt, {
          exact: false,
        });
        await taskField.fill(taskTitle);
        await dueField.fill("2026-01-08");
        await assigneeField.selectOption(A.teen);
        await assertHitTarget(
          page,
          taskForm.getByRole("button", {
            name: copy.overview.addTask,
            exact: true,
          }),
        );
        await assertA11y(page, `[aria-label="${copy.overview.taskFormLabel}"]`);
        await taskForm
          .getByRole("button", { name: copy.overview.addTask, exact: true })
          .click();
        await expect(
          taskForm
            .getByRole("alert")
            .filter({ hasText: copy.overview.taskAddError }),
        ).toBeVisible();
        await expect(taskField).toHaveValue(taskTitle);
        await expect(dueField).toHaveValue("2026-01-08");
        await expect(assigneeField).toHaveValue(A.teen);
        expect(firstTaskKey).toBeTruthy();
        await taskForm
          .getByRole("button", { name: copy.overview.addTask, exact: true })
          .click();
        expect(taskRequestKeys).toEqual([firstTaskKey, firstTaskKey]);
        await expect(page.getByText(taskTitle, { exact: true })).toBeVisible();
        // Use the canonical task list to prove that one task, with the exact
        // raw title and assignment, exists.
        const tasksResponse = await browserFetch(
          page,
          `/api/projects/${projectId}/tasks`,
        );
        expect(tasksResponse.status, tasksResponse.body).toBe(200);
        const tasks = JSON.parse(tasksResponse.body).tasks as Array<{
          id?: string;
          title?: string;
          assigned_to?: string | null;
          due_date?: string | null;
        }>;
        const matchingTasks = tasks.filter((task) => task.title === taskTitle);
        expect(matchingTasks).toHaveLength(1);
        taskId = matchingTasks[0]?.id;
        expect(taskId).toBeTruthy();
        ownedTaskIds.add(taskId!);
        expect(matchingTasks[0]?.assigned_to).toBe(A.teen);
        expect(matchingTasks[0]?.due_date).toContain("2026-01-08");
        await expect(
          page.getByText(
            copy.overview.taskAssignedTo.replace("{name}", "Taylor Fixture-A"),
            {
              exact: false,
            },
          ),
        ).toBeVisible();
        await expect(taskField).toBeFocused();
        await assertNoHorizontalOverflow(page);
        await assertA11y(page);
        await captureState(page, info, locale, "projects-open-assigned-task");

        const projectActions = page.getByRole("button", {
          name: copy.overview.actions,
          exact: true,
        });
        await projectActions.click();
        const archiveMenu = page.getByRole("menu", {
          name: copy.overview.projectActions,
        });
        await expect(
          archiveMenu.getByRole("menuitem", {
            name: copy.overview.archive,
            exact: true,
          }),
        ).toBeVisible();
        await archiveMenu
          .getByRole("menuitem", {
            name: copy.overview.archive,
            exact: true,
          })
          .click();
        await expect(
          page.getByText(copy.overview.projectArchived, { exact: true }),
        ).toBeVisible();
        const archived = await browserFetch(page, `/api/projects/${projectId}`);
        expect(archived.status, archived.body).toBe(200);
        expect(JSON.parse(archived.body).project.status).toBe("archived");

        await projectActions.click();
        const reactivateMenu = page.getByRole("menu", {
          name: copy.overview.projectActions,
        });
        await reactivateMenu
          .getByRole("menuitem", {
            name: copy.overview.reactivate,
            exact: true,
          })
          .click();
        await expect(
          page.getByText(copy.overview.projectReactivated, { exact: true }),
        ).toBeVisible();
        const reactivated = await browserFetch(
          page,
          `/api/projects/${projectId}`,
        );
        expect(reactivated.status, reactivated.body).toBe(200);
        expect(JSON.parse(reactivated.body).project.status).toBe("active");

        await page.goto("/dashboard/projects");
        const openSection = page.locator(
          "section[aria-labelledby='projects-active-heading']",
        );
        await expect(openSection).toBeVisible();
        await expect(
          openSection.getByText(projectName, { exact: true }),
        ).toBeVisible();
        await expect(
          openSection.getByText(copy.overview.active, { exact: true }),
        ).toBeVisible();
        await assertNoHorizontalOverflow(page);
        await assertA11y(page);
        await captureState(page, info, locale, "projects-open-overview");

        await page.goto(`/dashboard/projects/${projectId}`);

        const checkbox = page
          .getByRole("checkbox")
          .filter({ hasText: taskTitle })
          .first();
        await assertHitTarget(page, checkbox);
        await checkbox.click();
        await expect(checkbox).toHaveAttribute("aria-checked", "true");
        await expect(
          page.getByText(copy.overview.doneTasks, { exact: true }),
        ).toBeVisible();

        const child = await openRole(
          browser,
          baseURL,
          info,
          authFile("childA"),
          locale,
          blockedWrites,
          ownedProjectIds,
          ownedTaskIds,
        );
        childContext = child.context;
        await child.page.goto("/dashboard/projects");
        await expect(
          child.page.getByRole("heading", {
            name: copy.overview.pageTitle,
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          child.page.getByRole("link", {
            name: copy.overview.newProject,
            exact: true,
          }),
        ).toHaveCount(0);
        await child.page.goto(`/dashboard/projects/${projectId}`);
        await expect(
          child.page.getByRole("heading", {
            name: projectName,
            exact: true,
          }),
        ).toBeVisible();
        const childActions = child.page.getByRole("button", {
          name: copy.overview.actions,
          exact: true,
        });
        await expect(childActions).toBeVisible();
        await childActions.click();
        const childMenu = child.page.getByRole("menu", {
          name: copy.overview.projectActions,
        });
        await expect(
          childMenu.getByText(copy.overview.noActions, { exact: true }),
        ).toBeVisible();
        await expect(
          childMenu.getByRole("menuitem", {
            name: copy.overview.markComplete,
            exact: true,
          }),
        ).toHaveCount(0);
        await child.page.keyboard.press("Escape");
        await expect(childActions).toBeFocused();
        await expect(
          child.page.getByRole("button", {
            name: copy.overview.addTask,
            exact: true,
          }),
        ).toBeVisible();
        await assertNoHorizontalOverflow(child.page);
        await assertA11y(child.page);

        // A child can still use the canonical task-create API. The UI keeps
        // parent-only status controls out of the menu; task creation remains a
        // household-member operation by contract.
        const childTaskKey = randomUUID();
        idempotencyKeys.add(childTaskKey);
        const childTask = await sendWithKey(
          child.page,
          "POST",
          `/api/projects/${projectId}/tasks`,
          { title: `Child API task ${runId}` },
          childTaskKey,
        );
        expect(childTask.status, childTask.body).toBe(201);
        const childTaskBody = JSON.parse(childTask.body).task as {
          project_id?: string;
          title?: string;
        };
        expect(childTaskBody).toMatchObject({
          project_id: projectId,
          title: `Child API task ${runId}`,
        });

        // The parent-only status action is available to the parent after the
        // child member-create check. This keeps the API contract test on an
        // active project, where task creation is allowed for every member.
        await page.goto(`/dashboard/projects/${projectId}`);
        const actions = page.getByRole("button", {
          name: copy.overview.actions,
          exact: true,
        });
        await assertHitTarget(page, actions);
        await actions.click();
        const menu = page.getByRole("menu", {
          name: copy.overview.projectActions,
        });
        await expect(menu).toBeVisible();
        const complete = menu.getByRole("menuitem", {
          name: copy.overview.markComplete,
          exact: true,
        });
        await expect(complete).toBeFocused();
        await assertHitTarget(page, complete);
        await complete.click();
        await expect(
          page.getByText(copy.overview.projectCompleted, { exact: true }),
        ).toBeVisible();
        await page.goto("/dashboard/projects");
        const completedSection = page.locator(
          "section[aria-labelledby='projects-completed-heading']",
        );
        await expect(completedSection).toBeVisible();
        await expect(
          completedSection.getByText(projectName, { exact: true }),
        ).toBeVisible();
        await expect(
          completedSection.getByText(copy.overview.completed, { exact: true }),
        ).toBeVisible();
        await assertNoHorizontalOverflow(page);
        await assertA11y(page);
        await captureState(page, info, locale, "projects-done-overview");

        familyBContext = await browser.newContext({
          baseURL,
          storageState: authFile("parentB"),
          viewport: info.project.use.viewport,
          deviceScaleFactor: info.project.use.deviceScaleFactor,
          hasTouch: info.project.use.hasTouch,
          isMobile: info.project.use.isMobile,
          timezoneId: info.project.use.timezoneId,
          colorScheme: locale === "es" ? "dark" : "light",
          reducedMotion: "reduce",
          extraHTTPHeaders: info.project.use.extraHTTPHeaders,
        });
        await familyBContext.addInitScript(
          ({ localeKey, language, themeKey }) => {
            localStorage.setItem(localeKey, language);
            localStorage.setItem(
              themeKey,
              language === "es" ? "dark" : "light",
            );
          },
          {
            localeKey: LOCALE_STORAGE_KEY,
            language: locale,
            themeKey: THEME_STORAGE_KEY,
          },
        );
        await installLoopbackGuard(
          familyBContext,
          blockedWrites,
          ownedProjectIds,
          ownedTaskIds,
        );
        const familyBPage = await familyBContext.newPage();
        await familyBPage.goto("/dashboard");
        const foreignDetail = await browserFetch(
          familyBPage,
          `/api/projects/${projectId}`,
        );
        expect(foreignDetail.status, foreignDetail.body).toBe(403);
        const familyBProjects = await browserFetch(
          familyBPage,
          "/api/projects",
        );
        expect(familyBProjects.status, familyBProjects.body).toBe(200);
        expect(familyBProjects.body).not.toContain(projectName);

        await info.attach("projects-transport-and-role-proof", {
          body: JSON.stringify({
            locale,
            viewport: info.project.name,
            projectId,
            taskId,
            projectCreateReceiptKeyReused: Boolean(firstCreateKey),
            taskCreateReceiptKeyReused: Boolean(firstTaskKey),
            childTaskCreateAllowed: true,
            parentOnlyStatusControls: true,
            familyBProjectRead: foreignDetail.status,
            blockedWrites,
          }),
          contentType: "application/json",
        });
      } catch (error) {
        primaryError = error;
        throw error;
      } finally {
        await page.unrouteAll({ behavior: "ignoreErrors" });
        await childContext?.close().catch(() => undefined);
        await familyBContext?.close().catch(() => undefined);
        const cleanupErrors: unknown[] = [];
        if (projectId && ownedProjectIds.has(projectId)) {
          try {
            const deleted = await browserSend(
              page,
              "DELETE",
              `/api/projects/${projectId}`,
            );
            expect(deleted.status, deleted.body).toBe(200);
          } catch (error) {
            cleanupErrors.push(error);
          }
        }
        try {
          await removeOwnedRows([...ownedProjectIds], [...idempotencyKeys]);
        } catch (error) {
          cleanupErrors.push(error);
        }
        if (featureSetup) {
          try {
            await restoreProjects(page, featureSetup);
          } catch (error) {
            cleanupErrors.push(error);
          }
        }
        await context.unrouteAll({ behavior: "ignoreErrors" });
        if (cleanupErrors.length) {
          await info.attach("projects-cleanup-errors", {
            body: cleanupErrors
              .map((error) =>
                error instanceof Error
                  ? (error.stack ?? error.message)
                  : String(error),
              )
              .join("\n\n"),
            contentType: "text/plain",
          });
          if (!primaryError) throw cleanupErrors[0];
        }
      }
      expect(blockedWrites).toEqual([]);
    });

    test(`${locale}: renders scoped project states across the remaining viewports`, async ({
      page,
      context,
    }, info) => {
      assertFixtureTargetAllowed(process.env);
      expect(VIEWPORT_PROJECTS.has(info.project.name)).toBe(true);
      test.skip(
        !RENDER_ONLY_PROJECTS.has(info.project.name),
        "bounded render-state coverage uses the four remaining responsive projects",
      );

      const blockedWrites: string[] = [];
      const ownedProjectIds = new Set<string>();
      const ownedTaskIds = new Set<string>();
      const idempotencyKeys = new Set<string>();
      const copy = copyFor(locale);
      const runId = randomUUID();
      const projectName = `E2E render project ${locale} ${runId} — café family garden goals that wrap cleanly on small screens`;
      const projectDescription = `Raw family note ${runId}: café, naïve, façade — keep this user content exactly as entered and readable across devices.`;
      const openTaskTitle = `Open assigned task ${runId} — gather tools and label every garden box before the weekend`;
      let featureSetup: FeatureSetup | undefined;
      let projectId: string | undefined;

      await installLoopbackGuard(
        context,
        blockedWrites,
        ownedProjectIds,
        ownedTaskIds,
      );
      await configureLocale(page, locale);

      let primaryError: unknown;
      try {
        await page.goto("/dashboard");
        const identity = await browserFetch(page, "/api/auth/me");
        expect(identity.status, identity.body).toBe(200);
        expect(JSON.parse(identity.body).user).toMatchObject({
          id: A.parent,
          family_id: A.family,
          role: "parent",
        });
        featureSetup = await enableProjects(page);

        await page.goto("/dashboard/projects");
        await expect(
          page.getByRole("heading", {
            name: copy.overview.pageTitle,
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByText(copy.overview.noProjectsTitle, { exact: true }),
        ).toBeVisible();
        const newProject = page.getByRole("link", {
          name: copy.overview.newProject,
          exact: true,
        });
        await expect(newProject).toBeVisible();
        await assertHitTarget(page, newProject);
        await assertNoHorizontalOverflow(page);
        await assertA11y(page);
        await captureState(
          page,
          info,
          locale,
          "projects-render-empty-overview",
        );

        const projectKey = randomUUID();
        idempotencyKeys.add(projectKey);
        const created = await sendWithKey(
          page,
          "POST",
          "/api/projects",
          {
            name: projectName,
            description: projectDescription,
            color: "#3B82F6",
          },
          projectKey,
        );
        expect(created.status, created.body).toBe(201);
        const createdProject = JSON.parse(created.body).project as {
          id?: string;
          family_id?: string;
          created_by?: string;
          name?: string;
          description?: string | null;
          status?: string;
        };
        expect(createdProject).toMatchObject({
          family_id: A.family,
          created_by: A.parent,
          name: projectName,
          description: projectDescription,
          status: "active",
        });
        expect(typeof createdProject.id).toBe("string");
        projectId = createdProject.id;
        ownedProjectIds.add(projectId!);

        const openTaskKey = randomUUID();
        const openTask = await sendWithKey(
          page,
          "POST",
          `/api/projects/${projectId}/tasks`,
          {
            title: openTaskTitle,
            assigned_to: A.teen,
            due_date: "2026-01-08",
          },
          openTaskKey,
        );
        idempotencyKeys.add(openTaskKey);
        expect(openTask.status, openTask.body).toBe(201);
        const createdOpenTask = JSON.parse(openTask.body).task as {
          id?: string;
          title?: string;
        };
        expect(createdOpenTask).toMatchObject({ title: openTaskTitle });
        expect(typeof createdOpenTask.id).toBe("string");
        ownedTaskIds.add(createdOpenTask.id!);

        await page.goto("/dashboard/projects");
        const activeSection = page.locator(
          "section[aria-labelledby='projects-active-heading']",
        );
        await expect(activeSection).toBeVisible();
        const projectCard = activeSection.getByRole("button", {
          name: new RegExp(projectName),
        });
        await expect(projectCard).toBeVisible();
        await assertHitTarget(page, projectCard);
        await assertNoHorizontalOverflow(page);
        await assertA11y(page);
        await captureState(page, info, locale, "projects-render-open-overview");

        await projectCard.click();
        await expect(
          page.getByRole("heading", { name: projectName, exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText(projectDescription, { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText(openTaskTitle, { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText(
            copy.overview.taskAssignedTo.replace("{name}", "Taylor Fixture-A"),
            { exact: false },
          ),
        ).toBeVisible();
        const dueDateLabel = formatDateOnly(
          "2026-01-08",
          { weekday: "short", month: "short", day: "numeric" },
          locale === "es" ? "es-ES" : "en-US",
        );
        await expect(
          page.getByText(
            copy.overview.taskDue.replace("{date}", dueDateLabel),
            { exact: false },
          ),
        ).toBeVisible();
        const back = page.getByRole("link", {
          name: copy.overview.backToProjects,
          exact: true,
        });
        await assertHitTarget(page, back);
        const actions = page.getByRole("button", {
          name: copy.overview.actions,
          exact: true,
        });
        await assertHitTarget(page, actions);
        await assertNoHorizontalOverflow(page);
        await assertA11y(page);
        await captureState(page, info, locale, "projects-render-open-detail");

        const taskCheckbox = page
          .getByRole("checkbox")
          .filter({ hasText: openTaskTitle })
          .first();
        await assertHitTarget(page, taskCheckbox);
        await taskCheckbox.click();
        await expect(taskCheckbox).toHaveAttribute("aria-checked", "true");
        await expect(
          page.getByText(copy.overview.doneTasks, { exact: true }),
        ).toBeVisible();
        await assertNoHorizontalOverflow(page);
        await assertA11y(page);
        await captureState(page, info, locale, "projects-render-done-detail");

        await back.click();
        await expect(page).toHaveURL(/\/dashboard\/projects$/);
      } catch (error) {
        primaryError = error;
        throw error;
      } finally {
        await page.unrouteAll({ behavior: "ignoreErrors" });
        const cleanupErrors: unknown[] = [];
        if (projectId && ownedProjectIds.has(projectId)) {
          try {
            const deleted = await browserSend(
              page,
              "DELETE",
              `/api/projects/${projectId}`,
            );
            expect(deleted.status, deleted.body).toBe(200);
          } catch (error) {
            cleanupErrors.push(error);
          }
        }
        try {
          await removeOwnedRows([...ownedProjectIds], [...idempotencyKeys]);
        } catch (error) {
          cleanupErrors.push(error);
        }
        if (featureSetup) {
          try {
            await restoreProjects(page, featureSetup);
          } catch (error) {
            cleanupErrors.push(error);
          }
        }
        await context.unrouteAll({ behavior: "ignoreErrors" });
        if (cleanupErrors.length) {
          await info.attach("projects-cleanup-errors", {
            body: cleanupErrors
              .map((error) =>
                error instanceof Error
                  ? (error.stack ?? error.message)
                  : String(error),
              )
              .join("\n\n"),
            contentType: "text/plain",
          });
          if (!primaryError) throw cleanupErrors[0];
        }
      }
      expect(blockedWrites).toEqual([]);
    });
  });
}
