/**
 * #514/#499: Projects create form and intercepted sheet.
 *
 * The parent fixture enables Projects through its guarded feature endpoint for
 * this journey. The refusal POST is deliberately synthetic; the pending retry proceeds to the
 * real authenticated API, reads back its persisted Project, and deletes only
 * the returned owned ID. GETs, identity and feature restoration also use the
 * loopback app exactly as the browser would.
 */
import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { projectCreateMessages } from "../src/i18n/project-create";
import { authFile } from "./support/env";
import { ownFeatureAudit } from "./support/feature-audit";
import { browserFetch, browserSend, expect, test } from "./support/test";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

type Locale = "en" | "es";
type Surface = "sheet" | "direct";
type CreateMode = "failure" | "pending";

async function installLoopbackGuard(
  context: BrowserContext,
  blockedWrites: string[],
  ownedProjectIds: Set<string>,
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

    const allowedMutation =
      (request.method() === "PATCH" &&
        url.pathname === "/api/family/features") ||
      (request.method() === "POST" && url.pathname === "/api/projects") ||
      (request.method() === "DELETE" &&
        ownedProjectIds.has(url.pathname.slice("/api/projects/".length)));
    if (MUTATING_METHODS.has(request.method()) && !allowedMutation) {
      blockedWrites.push(`${request.method()} ${url.pathname}`);
      await route.abort();
      return;
    }
    await route.continue();
  });
}

async function assertActionGeometry(page: Page, action: Locator) {
  const box = await action.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
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

async function assertA11y(page: Page, surface: Surface) {
  const scope = surface === "sheet" ? '[role="dialog"]' : "main";
  const violations = (
    await new AxeBuilder({ page }).include(scope).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
}

async function assertFeatureIdentity(page: Page) {
  const response = await browserFetch(page, "/api/auth/me");
  expect(response.status, response.body).toBe(200);
  const body = JSON.parse(response.body) as {
    user?: { id?: unknown; family_id?: unknown; role?: unknown };
  };
  expect(body.user?.id).toBe(FIXTURE_IDS.familyA.parent);
  expect(body.user?.family_id).toBe(FIXTURE_IDS.familyA.family);
  expect(body.user?.role).toBe("parent");
}

async function openSurface(page: Page, surface: Surface, locale: Locale) {
  const copy = projectCreateMessages[locale];
  if (surface === "sheet") {
    await page.goto("/dashboard/projects");
    await page.getByRole("link", { name: "New", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: copy.sheetTitle });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: copy.closeLabel }),
    ).toBeFocused();
    await assertActionGeometry(
      page,
      dialog.getByRole("button", { name: copy.closeLabel }),
    );
    return dialog;
  }

  await page.goto("/dashboard/projects/create");
  await expect(page.getByRole("heading", { name: copy.title })).toBeVisible();
  await expect(
    page.getByRole("link", { name: copy.back, exact: true }),
  ).toHaveAttribute("href", "/dashboard/projects");
  return page.locator("main");
}

for (const locale of ["en", "es"] as const) {
  test.describe(`${locale} parent Projects create`, () => {
    test.use({
      storageState: authFile("parentA"),
      colorScheme: locale === "es" ? "dark" : "light",
    });

    test(`${locale}: intercepted sheet and direct form recover across create states`, async ({
      page,
      context,
    }, info) => {
      assertFixtureTargetAllowed(process.env);
      const blockedWrites: string[] = [];
      const postBodies: unknown[] = [];
      const ownedProjectIds = new Set<string>();
      const cleanAudit = await ownFeatureAudit(["projects"]);
      let originalFeatures: Record<string, unknown> | undefined;
      let featureChanged = false;
      let mode: CreateMode = "failure";
      let releasePending: ((continueRequest: boolean) => void) | undefined;

      await installLoopbackGuard(context, blockedWrites, ownedProjectIds);
      await page.addInitScript(
        ({ key, value }) => localStorage.setItem(key, value),
        { key: LOCALE_STORAGE_KEY, value: locale },
      );
      await page.route("**/api/projects", async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        postBodies.push(route.request().postDataJSON());
        if (mode === "failure") {
          await route.fulfill({
            status: 403,
            contentType: "application/json",
            body: JSON.stringify({ error: "Only parents can create projects" }),
          });
          return;
        }
        const continueRequest = await new Promise<boolean>((resolve) => {
          releasePending = resolve;
        });
        if (continueRequest) await route.continue();
        else await route.abort();
      });

      try {
        await page.goto("/dashboard");
        await assertFeatureIdentity(page);
        const originalFeaturesResponse = await browserFetch(
          page,
          "/api/family/features",
        );
        expect(
          originalFeaturesResponse.status,
          originalFeaturesResponse.body,
        ).toBe(200);
        originalFeatures = JSON.parse(originalFeaturesResponse.body)
          .features as Record<string, unknown>;
        if (originalFeatures.projects !== true) {
          const enabled = await browserSend(
            page,
            "PATCH",
            "/api/family/features",
            {
              features: { ...originalFeatures, projects: true },
            },
          );
          expect(enabled.status, enabled.body).toBe(200);
          featureChanged = true;
        }

        await page.goto("/dashboard/projects");
        const copy = projectCreateMessages[locale];
        for (const surface of ["sheet", "direct"] as const) {
          if (surface === "direct") mode = "failure";
          const form = await openSurface(page, surface, locale);
          const name = form.getByLabel(new RegExp(copy.name));
          const description = form.getByLabel(copy.description, {
            exact: false,
          });
          const submit = form.getByRole("button", { name: copy.create });
          await expect(name).toBeVisible();
          await expect(description).toBeVisible();
          await assertActionGeometry(page, submit);
          await assertNoHorizontalOverflow(page);
          await assertA11y(page, surface);
          if (surface === "direct") await expect(name).toBeFocused();

          await name.fill(`${surface} ${locale} draft`);
          await description.fill("Keep this draft while retrying.");
          await submit.click();
          const refusal = page.getByRole("alert").filter({
            hasText: copy.createError,
          });
          await expect(refusal).toBeVisible();
          await expect(name).toHaveValue(`${surface} ${locale} draft`);
          await expect(description).toHaveValue(
            "Keep this draft while retrying.",
          );

          mode = "pending";
          const pendingClick = submit.click();
          await expect(
            form.getByRole("button", { name: copy.creating }),
          ).toBeDisabled();
          if (surface === "sheet") {
            await expect(
              page.getByRole("dialog").getByText(copy.pendingDescription),
            ).toBeVisible();
            await expect(
              form.getByRole("button", { name: copy.closeLabel }),
            ).toHaveCount(0);
            // Exercise the browser Back path while the POST is held. The
            // pending sheet owns a same-URL history sentinel, so Back must
            // restore that entry and keep the draft mounted until the request
            // is released. Use the browser history API directly so this does
            // not depend on a hidden or forced control click.
            await page.evaluate(() => window.history.back());
            await expect(page).toHaveURL(/\/dashboard\/projects\/create$/);
            await expect(
              form.getByRole("button", { name: copy.creating }),
            ).toBeDisabled();
            await page.keyboard.press("Escape");
            await expect(page).toHaveURL(/\/dashboard\/projects\/create$/);
          } else {
            await expect(
              form.getByRole("button", { name: copy.creating }),
            ).toBeVisible();
            await expect(
              form.getByTestId("project-create-back-busy"),
            ).toBeVisible();
            await expect(
              form.getByRole("link", { name: copy.back, exact: true }),
            ).toHaveCount(0);
            // Exercise the direct route's browser Back path while the POST is
            // held. The direct form owns the same-URL sentinel, so the draft
            // must remain mounted at the create URL.
            await page.evaluate(() => window.history.back());
            await expect(page).toHaveURL(/\/dashboard\/projects\/create$/);
            await expect(
              form.getByTestId("project-create-back-busy"),
            ).toBeVisible();
            await expect(
              form.getByRole("button", { name: copy.creating }),
            ).toBeDisabled();
          }
          const projectResponsePromise = page.waitForResponse(
            (response) =>
              response.url().endsWith("/api/projects") &&
              response.request().method() === "POST",
          );
          releasePending?.(true);
          const [projectResponse] = await Promise.all([
            projectResponsePromise,
            pendingClick,
          ]);
          expect(projectResponse.status()).toBe(201);
          const created = (await projectResponse.json()) as {
            project?: {
              id?: unknown;
              family_id?: unknown;
              name?: unknown;
              description?: unknown;
            };
          };
          const projectId = created.project?.id;
          expect(typeof projectId).toBe("string");
          expect(created.project?.family_id).toBe(FIXTURE_IDS.familyA.family);
          expect(created.project?.name).toBe(`${surface} ${locale} draft`);
          expect(created.project?.description).toBe(
            "Keep this draft while retrying.",
          );
          ownedProjectIds.add(projectId as string);
          await expect(page).toHaveURL(
            new RegExp(`/dashboard/projects/${projectId}$`),
          );
          const persisted = await browserFetch(
            page,
            `/api/projects/${projectId}`,
          );
          expect(persisted.status, persisted.body).toBe(200);
          const persistedProject = JSON.parse(persisted.body).project as {
            family_id?: unknown;
            id?: unknown;
            name?: unknown;
            description?: unknown;
          };
          expect(persistedProject.family_id).toBe(FIXTURE_IDS.familyA.family);
          expect(persistedProject.id).toBe(projectId);
          expect(persistedProject.name).toBe(`${surface} ${locale} draft`);
          expect(persistedProject.description).toBe(
            "Keep this draft while retrying.",
          );
          expect(postBodies.at(-1)).toMatchObject({
            name: `${surface} ${locale} draft`,
            description: "Keep this draft while retrying.",
          });
          if (surface === "sheet") await page.goto("/dashboard/projects");
        }

        await info.attach(`project-create-${locale}-synthetic-transport`, {
          body: JSON.stringify({
            locale,
            surfaces: ["sheet", "direct"],
            postCount: postBodies.length,
            transport:
              "refusal POST was intercepted; the pending retry continued to the real loopback POST, read back the exact created fixture project, and deletes it during cleanup",
          }),
          contentType: "application/json",
        });
      } finally {
        releasePending?.(false);
        await page.unrouteAll({ behavior: "ignoreErrors" });
        const cleanupErrors: unknown[] = [];
        for (const projectId of ownedProjectIds) {
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
        if (featureChanged && originalFeatures) {
          try {
            const restored = await browserSend(
              page,
              "PATCH",
              "/api/family/features",
              { features: originalFeatures },
            );
            expect(restored.status, restored.body).toBe(200);
          } catch (error) {
            cleanupErrors.push(error);
          }
        }
        try {
          await cleanAudit(true);
        } catch (error) {
          cleanupErrors.push(error);
        }
        await context.unrouteAll({ behavior: "ignoreErrors" });
        if (cleanupErrors.length) throw cleanupErrors[0];
      }
      expect(blockedWrites).toEqual([]);
    });
  });
}
