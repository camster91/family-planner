/**
 * #499: rendered Projects deletion confirmation.
 *
 * This uses one uniquely marked disposable Family A project per viewport and
 * locale. The DELETE route is intercepted only for the UI recovery sequence:
 * a held request, synthetic 500, synthetic network failure, then synthetic
 * 200. The final cleanup DELETE is real and is sent only after the route is
 * removed. No production or non-fixture household is touched.
 */
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { authFile } from "./support/env";
import { ownFeatureAudit } from "./support/feature-audit";
import { projectOverviewMessages } from "../src/i18n/project-overview";
import { browserFetch, browserSend, expect, test } from "./support/test";

test.use({ storageState: authFile("parentA") });

type Locale = "en" | "es";

function sourceHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

async function installGuard(context: BrowserContext, locale: Locale) {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      ["data:", "blob:"].includes(url.protocol)
      ? route.continue()
      : route.abort();
  });
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

async function runtimeIdentity(
  page: Page,
  info: TestInfo,
  locale: Locale,
  projectId: string,
) {
  const head = sourceHead();
  expect(head).toMatch(/^[a-f0-9]{40}$/);
  expect(() =>
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "prisma"], {
      stdio: "ignore",
    }),
  ).not.toThrow();
  expect(process.env.RELEASE_SHA?.trim()).toBe(head);

  const buildTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();
  expect(buildTree).toMatch(/^[a-f0-9]{40}$/);
  const configuredTree = process.env.E2E_PROJECT_DELETE_BUILD_TREE?.trim();
  if (configuredTree) expect(configuredTree).toBe(buildTree);

  const response = await page.request.get("/api/version");
  expect(response.status()).toBe(200);
  const runtime = (await response.json()) as {
    commit: string;
    builtAt: string;
  };
  expect(runtime.commit).toBe(head);
  const route = fs.readFileSync(
    ".next/server/app/api/version/route.js",
    "utf8",
  );
  const builtAtValues = [
    ...new Set(route.match(/20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g)),
  ];
  expect(builtAtValues).toHaveLength(1);
  expect(runtime.builtAt).toBe(builtAtValues[0]);
  await info.attach("actual-project-delete-runtime-identity", {
    body: JSON.stringify({
      runtime,
      buildTree,
      configuredBuildTree: configuredTree ?? null,
      locale,
      fixtureFamily: FIXTURE_IDS.familyA.family,
      fixtureParent: FIXTURE_IDS.familyA.parent,
      fixtureProjectId: projectId,
      sensitiveActions:
        "scoped project DELETE intercepted for pending/500/network/synthetic-200; cleanup DELETE is real",
    }),
    contentType: "application/json",
  });
}

async function checkActionGeometry(page: Page, action: Locator) {
  const box = await action.boundingBox();
  const viewport = page.viewportSize();
  expect(box).toBeTruthy();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
  expect(
    await action.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return el.contains(
        document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        ),
      );
    }),
  ).toBe(true);
}

async function openDelete(page: Page, locale: Locale) {
  const opener = page.getByRole("button", {
    name: projectOverviewMessages[locale].actions,
    exact: true,
  });
  await opener.click();
  const menu = page.getByRole("menu");
  await expect(
    menu.getByRole("menuitem", {
      name: locale === "es" ? "Eliminar" : "Delete",
      exact: true,
    }),
  ).toBeVisible();
  await menu
    .getByRole("menuitem", {
      name: locale === "es" ? "Eliminar" : "Delete",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("alertdialog", {
    name: locale === "es" ? /¿Eliminar «/ : /Delete “/,
  });
  await expect(dialog).toBeVisible();
  return { opener, dialog };
}

for (const locale of ["en", "es"] as const) {
  test.describe(`${locale} Projects deletion`, () => {
    test.use({ colorScheme: locale === "en" ? "light" : "dark" });

    test(`${locale}: named deletion confirmation stays recoverable across viewport`, async ({
      browser,
      page,
      context,
      baseURL,
    }, info) => {
      assertFixtureTargetAllowed(process.env);
      expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
        new URL(baseURL!).hostname,
      );
      await installGuard(context, locale);

      await page.goto("/dashboard");
      await expect(page).toHaveURL(/\/dashboard\/today$/);
      const originalProfile = await browserFetch(page, "/api/users");
      expect(originalProfile.status, originalProfile.body).toBe(200);
      const profile = JSON.parse(originalProfile.body).user as {
        id?: string;
        family_id?: string;
        role?: string;
      };
      expect(profile.id).toBe(FIXTURE_IDS.familyA.parent);
      expect(profile.family_id).toBe(FIXTURE_IDS.familyA.family);
      expect(profile.role).toBe("parent");

      const originalFeaturesResponse = await browserFetch(
        page,
        "/api/family/features",
      );
      expect(
        originalFeaturesResponse.status,
        originalFeaturesResponse.body,
      ).toBe(200);
      const originalFeatures = JSON.parse(
        originalFeaturesResponse.body,
      ).features;
      const cleanAudit = await ownFeatureAudit(["projects"]);
      let projectId: string | undefined;
      let pairedContext: BrowserContext | undefined;
      let releasePending: (() => void) | undefined;
      let pendingStarted = false;
      let releasePendingFinished: (() => void) | undefined;
      const pendingFinished = new Promise<void>((resolve) => {
        releasePendingFinished = resolve;
      });
      const deleteRequests: Array<{ mode: string; body: string | null }> = [];

      try {
        const enabled = await browserSend(
          page,
          "PATCH",
          "/api/family/features",
          {
            features: { ...originalFeatures, projects: true },
          },
        );
        expect(enabled.status, enabled.body).toBe(200);

        const projectName = `E2E project delete ${locale} ${info.project.name} ${randomUUID().slice(0, 8)}`;
        const created = await browserSend(page, "POST", "/api/projects", {
          name: projectName,
          description: "Disposable project for the Projects deletion dialog.",
          color: "#3B82F6",
          status: "active",
        });
        expect(created.status, created.body).toBe(201);
        const createdProject = JSON.parse(created.body).project as {
          family_id?: unknown;
          id?: unknown;
          name?: unknown;
        };
        expect(createdProject.family_id).toBe(FIXTURE_IDS.familyA.family);
        expect(createdProject.name).toBe(projectName);
        projectId = createdProject.id as string | undefined;
        expect(projectId).toMatch(/^\w/);

        const pairedPage = await (async () => {
          pairedContext = await browser.newContext({
            baseURL,
            storageState: authFile("parentB"),
          });
          await installGuard(pairedContext, locale);
          const pairedPage = await pairedContext.newPage();
          await pairedPage.goto("/dashboard");
          await expect(pairedPage).toHaveURL(/\/dashboard\/today$/);
          const pairedProfile = await browserFetch(pairedPage, "/api/users");
          expect(pairedProfile.status, pairedProfile.body).toBe(200);
          const pairedUser = JSON.parse(pairedProfile.body).user as {
            family_id?: string;
            id?: string;
            role?: string;
          };
          expect(pairedUser.id).toBe(FIXTURE_IDS.familyB.parent);
          expect(pairedUser.family_id).toBe(FIXTURE_IDS.familyB.family);
          expect(pairedUser.role).toBe("parent");
          return pairedPage;
        })();
        const pairedProjects = await browserFetch(pairedPage, "/api/projects");
        expect([200, 403]).toContain(pairedProjects.status);
        if (pairedProjects.status === 200) {
          const visible = JSON.parse(pairedProjects.body).projects as Array<{
            name?: string;
          }>;
          expect(visible.some((project) => project.name === projectName)).toBe(
            false,
          );
        }
        await info.attach("family-b-project-visibility", {
          body: JSON.stringify({
            status: pairedProjects.status,
            evidence:
              pairedProjects.status === 403
                ? "feature-gate refusal; no cross-household list assertion"
                : "enabled list response excludes the Family A project",
            projectName,
            fixtureFamily: FIXTURE_IDS.familyB.family,
          }),
          contentType: "application/json",
        });
        await pairedPage.close();

        await page.goto(`/dashboard/projects/${projectId}`);
        await expect(
          page.getByRole("heading", { name: projectName, exact: true }),
        ).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        if (locale === "es")
          await expect(page.locator("html")).toHaveClass(/dark/);
        else await expect(page.locator("html")).not.toHaveClass(/dark/);
        await runtimeIdentity(page, info, locale, projectId!);

        const projectPath = `/api/projects/${projectId}`;
        const gate = new Promise<void>((resolve) => {
          releasePending = resolve;
        });
        await page.route(`**${projectPath}`, async (route) => {
          const request = route.request();
          if (request.method() !== "DELETE") return route.continue();
          const attempt = deleteRequests.length + 1;
          deleteRequests.push({
            mode:
              ["pending-500", "network", "synthetic-200"][attempt - 1] ??
              "unexpected",
            body: request.postData(),
          });
          expect(request.postData()).toBeNull();
          if (attempt === 1) {
            pendingStarted = true;
            await gate;
            try {
              await route.fulfill({
                status: 500,
                contentType: "application/json",
                body: JSON.stringify({
                  error: "Synthetic project refusal only",
                }),
              });
            } finally {
              releasePendingFinished?.();
            }
          } else if (attempt === 2) {
            await route.abort("failed");
          } else if (attempt === 3) {
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({ success: true, synthetic: true }),
            });
          } else {
            throw new Error(`Unexpected project DELETE attempt ${attempt}`);
          }
        });

        const { opener, dialog } = await openDelete(page, locale);
        const cancel = dialog.getByRole("button", {
          name: locale === "es" ? "Cancelar" : "Cancel",
          exact: true,
        });
        const action = dialog.getByRole("button", {
          name: locale === "es" ? "Eliminar" : "Delete",
          exact: true,
        });
        await expect(cancel).toBeFocused();
        await expect(dialog).toContainText(projectName);
        await expect(dialog).toContainText(
          locale === "es" ? "permanentemente" : "permanently",
        );
        await checkActionGeometry(page, cancel);
        await checkActionGeometry(page, action);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        const blocking = (
          await new AxeBuilder({ page })
            .include('[data-testid="delete-project-dialog"]')
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
            .analyze()
        ).violations.filter(
          (violation) =>
            violation.impact === "serious" || violation.impact === "critical",
        );
        expect(blocking).toEqual([]);
        await info.attach(`project-delete-${locale}-${info.project.name}`, {
          body: await page.screenshot({
            fullPage: false,
            animations: "disabled",
          }),
          contentType: "image/png",
        });

        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(opener).toBeFocused();
        expect(deleteRequests).toHaveLength(0);

        await openDelete(page, locale);
        const retryDialog = page.getByRole("alertdialog");
        const submit = retryDialog.getByRole("button", {
          name: locale === "es" ? "Eliminar" : "Delete",
          exact: true,
        });
        await submit.click();
        await expect.poll(() => deleteRequests.length).toBe(1);
        const pendingSubmit = retryDialog.getByRole("button", {
          name: locale === "es" ? "Eliminando…" : "Deleting…",
          exact: true,
        });
        await expect(pendingSubmit).toBeDisabled();
        await expect(
          retryDialog.getByRole("button", {
            name: locale === "es" ? "Cancelar" : "Cancel",
            exact: true,
          }),
        ).toBeDisabled();
        await pendingSubmit.dispatchEvent("click");
        expect(deleteRequests).toHaveLength(1);
        await page.keyboard.press("Escape");
        await expect(retryDialog).toBeVisible();
        await expect(retryDialog.getByRole("button")).toHaveCount(2);

        releasePending?.();
        if (pendingStarted) await pendingFinished;
        await expect(retryDialog.getByRole("alert")).toHaveText(
          locale === "es"
            ? "No se pudo eliminar el proyecto. Inténtalo de nuevo."
            : "The project could not be deleted. Try again.",
        );
        const retry = retryDialog.getByRole("button", {
          name: locale === "es" ? "Intentar de nuevo" : "Try again",
          exact: true,
        });
        await retry.click();
        await expect(retryDialog.getByRole("alert")).toHaveText(
          locale === "es"
            ? "No se pudo eliminar el proyecto. Revisa tu conexión e inténtalo de nuevo."
            : "The project could not be deleted. Check your connection and try again.",
        );
        await retryDialog
          .getByRole("button", {
            name: locale === "es" ? "Intentar de nuevo" : "Try again",
            exact: true,
          })
          .click();
        await expect(retryDialog).toHaveCount(0);
        await expect(page).toHaveURL(/\/dashboard\/projects$/);
        await expect(
          page.getByText(
            locale === "es" ? "Proyecto eliminado" : "Project deleted",
            { exact: true },
          ),
        ).toBeVisible();
        expect(deleteRequests).toHaveLength(3);
        expect(deleteRequests.map(({ mode }) => mode)).toEqual([
          "pending-500",
          "network",
          "synthetic-200",
        ]);
        const remains = await browserFetch(page, projectPath);
        expect(remains.status, remains.body).toBe(200);
      } finally {
        releasePending?.();
        if (pendingStarted) await pendingFinished.catch(() => undefined);
        await page.unrouteAll({ behavior: "ignoreErrors" });
        try {
          if (pairedContext) await pairedContext.close();
        } finally {
          try {
            if (projectId) {
              const cleanup = await browserSend(
                page,
                "DELETE",
                `/api/projects/${projectId}`,
              );
              expect(cleanup.status, cleanup.body).toBe(200);
              const removed = await browserFetch(
                page,
                `/api/projects/${projectId}`,
              );
              expect(removed.status, removed.body).toBe(404);
            }
          } finally {
            let restored = false;
            try {
              const response = await browserSend(
                page,
                "PATCH",
                "/api/family/features",
                { features: originalFeatures },
              );
              expect(response.status, response.body).toBe(200);
              const readBack = await browserFetch(page, "/api/family/features");
              expect(readBack.status, readBack.body).toBe(200);
              expect(JSON.parse(readBack.body).features).toEqual(
                originalFeatures,
              );
              restored = true;
            } finally {
              await cleanAudit(restored);
            }
          }
        }
      }
    });
  });
}
