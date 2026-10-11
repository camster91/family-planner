/** Disposable-fixture Anniversaries confirmation; all date mutations are intercepted. */
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { Page, TestInfo } from "@playwright/test";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { authFile } from "./support/env";
import { ownFeatureAudit } from "./support/feature-audit";
import { browserFetch, browserSend, expect, test } from "./support/test";

test.use({ storageState: authFile("parentA") });

const LABEL = "Mamá & Papá’s 家族記念日 — Schulabschluss 李🎉";
const PRIVATE_NOTES =
  "SYNTHETIC private note must stay outside the removal confirmation";
const ID = "fx_e2e_anniversary_dialog";

const DATE = {
  id: ID,
  name: LABEL,
  type: "anniversary" as const,
  date: "2099-04-10T00:00:00.000Z",
  notes: PRIVATE_NOTES,
  person_id: null,
  created_by: "fixture-parent-a",
  days_until: 10,
  next_occurrence: "2099-04-10T00:00:00.000Z",
};

function sourceHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

async function runtimeIdentity(
  page: Page,
  info: TestInfo,
  locale: "en" | "es",
) {
  const head = sourceHead();
  expect(head).toMatch(/^[a-f0-9]{40}$/);
  expect(() =>
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "prisma"], {
      stdio: "ignore",
    }),
  ).not.toThrow();
  expect(process.env.RELEASE_SHA?.trim()).toBe(head);
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();
  expect(tree).toMatch(/^[a-f0-9]{40}$/);
  const configuredTree = process.env.E2E_ANNIVERSARIES_BUILD_TREE?.trim();
  if (configuredTree) expect(configuredTree).toBe(tree);

  const response = await browserFetch(page, "/api/version");
  expect(response.status, response.body).toBe(200);
  const runtime = JSON.parse(response.body) as {
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
  await info.attach("anniversaries-source-runtime-proof", {
    body: JSON.stringify({
      runtime,
      buildTree: tree,
      configuredBuildTree: configuredTree ?? null,
      locale,
      transport:
        "feature toggle is restored; anniversary GET/PATCH/DELETE are browser-intercepted; no anniversary domain writes",
    }),
    contentType: "application/json",
  });
}

for (const locale of ["en", "es"] as const) {
  test.describe(`${locale} anniversary deletion`, () => {
    test.use({ colorScheme: locale === "en" ? "light" : "dark" });

    test(`${locale}: deletion is named, private, guarded and recoverable`, async ({
      page,
      context,
      baseURL,
    }, info) => {
      assertFixtureTargetAllowed(process.env);
      expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
        new URL(baseURL!).hostname,
      );
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

      await page.goto("/dashboard");
      const original = await browserFetch(page, "/api/family/features");
      expect(original.status, original.body).toBe(200);
      const originalFeatures = JSON.parse(original.body).features;
      const cleanAudit = await ownFeatureAudit(["anniversaries"]);
      let restored = false;
      let deleted = false;
      let deleteWrites = 0;
      let patchWrites = 0;
      let failNextRefresh = false;
      let releaseDelete: (() => void) | undefined;
      let releasePatch: (() => void) | undefined;
      const pendingDelete = new Promise<void>((resolve) => {
        releaseDelete = resolve;
      });
      const pendingPatch = new Promise<void>((resolve) => {
        releasePatch = resolve;
      });

      try {
        await page.route("**/api/anniversaries**", async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          if (
            request.method() === "GET" &&
            url.pathname === "/api/anniversaries"
          ) {
            if (deleted && failNextRefresh) {
              failNextRefresh = false;
              await route.fulfill({
                status: 503,
                contentType: "application/json",
                body: JSON.stringify({ error: "synthetic refresh failure" }),
              });
            } else {
              await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ dates: deleted ? [] : [DATE] }),
              });
            }
          } else if (
            request.method() === "PATCH" &&
            url.pathname === `/api/anniversaries/${ID}`
          ) {
            expect(request.headers()["x-csrf-token"]).toBeTruthy();
            patchWrites += 1;
            expect(request.postDataJSON()).toMatchObject({
              name: expect.any(String),
            });
            if (patchWrites === 1) await pendingPatch;
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({ date: DATE }),
            });
          } else if (
            request.method() === "DELETE" &&
            url.pathname === `/api/anniversaries/${ID}`
          ) {
            expect(request.postData()).toBeNull();
            expect(request.headers()["x-csrf-token"]).toBeTruthy();
            deleteWrites += 1;
            if (deleteWrites === 1) {
              await pendingDelete;
              await route.fulfill({
                status: 403,
                contentType: "application/json",
                body: JSON.stringify({ error: PRIVATE_NOTES }),
              });
            } else if (deleteWrites === 2) {
              await route.abort("failed");
            } else {
              deleted = true;
              await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ success: true }),
              });
            }
          } else {
            await route.abort("blockedbyclient");
            throw new Error(
              `Unexpected anniversaries request: ${request.method()} ${url.pathname}`,
            );
          }
        });

        const enabled = await browserSend(
          page,
          "PATCH",
          "/api/family/features",
          {
            features: { ...originalFeatures, anniversaries: true },
          },
        );
        expect(enabled.status, enabled.body).toBe(200);
        await page.goto("/dashboard/anniversaries");
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        if (locale === "es") {
          await expect(page.locator("html")).toHaveClass(/\bdark\b/);
        } else {
          await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
        }
        await runtimeIdentity(page, info, locale);

        const trigger = page.getByRole("button", { name: new RegExp(LABEL) });
        await expect(trigger).toBeVisible();

        // Save must retain the edit sheet and prevent a concurrent destructive action.
        await trigger.click();
        const edit = page.getByRole("dialog", {
          name: locale === "es" ? "Editar" : "Edit",
          exact: true,
        });
        const name = edit.getByLabel(locale === "es" ? "Nombre" : "Name");
        await name.fill(`Draft ${LABEL}`);
        await edit
          .getByRole("button", {
            name: locale === "es" ? "Guardar" : "Save",
            exact: true,
          })
          .click();
        await expect(
          edit.getByRole("button", {
            name: locale === "es" ? "Guardando..." : "Saving...",
            exact: true,
          }),
        ).toBeDisabled();
        await expect(
          edit.getByRole("button", {
            name: locale === "es" ? "Eliminar" : "Delete",
            exact: true,
          }),
        ).toBeDisabled();
        await page.keyboard.press("Escape");
        await expect(edit).toBeVisible();
        expect(deleteWrites).toBe(0);
        releasePatch!();
        await expect(edit).toHaveCount(0);
        expect(patchWrites).toBe(1);

        // Cancel restores focus to the edit action and never writes a DELETE.
        await trigger.click();
        const editAgain = page.getByRole("dialog", {
          name: locale === "es" ? "Editar" : "Edit",
          exact: true,
        });
        await editAgain
          .getByRole("button", {
            name: locale === "es" ? "Eliminar" : "Delete",
            exact: true,
          })
          .click();
        const dialog = page.getByRole("alertdialog", {
          name: locale === "es" ? `¿Quitar «${LABEL}»?` : `Remove “${LABEL}”?`,
          exact: true,
        });
        const cancel = dialog.getByRole("button", {
          name: locale === "es" ? "Cancelar" : "Cancel",
          exact: true,
        });
        const confirm = dialog.getByRole("button", {
          name: locale === "es" ? "Eliminar" : "Delete",
          exact: true,
        });
        await expect(cancel).toBeFocused();
        await expect(dialog).toContainText(LABEL);
        await expect(dialog).not.toContainText(PRIVATE_NOTES);
        await expect(dialog.getByRole("button")).toHaveCount(3);
        for (const action of [cancel, confirm]) {
          const box = await action.boundingBox();
          expect(box).not.toBeNull();
          expect(box!.width).toBeGreaterThanOrEqual(44);
          expect(box!.height).toBeGreaterThanOrEqual(44);
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        const violations = (
          await new AxeBuilder({ page })
            .include('[data-testid="remove-anniversary-dialog"]')
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
            .analyze()
        ).violations.filter(
          (violation) =>
            violation.impact === "serious" || violation.impact === "critical",
        );
        expect(violations).toEqual([]);
        await info.attach(`anniversaries-${locale}-${info.project.name}`, {
          body: await page.screenshot({
            fullPage: false,
            animations: "disabled",
          }),
          contentType: "image/png",
        });
        await page.screenshot({
          path: info.outputPath(`anniversaries-${locale}-confirmation.png`),
          fullPage: true,
        });

        await cancel.click();
        await expect(dialog).toHaveCount(0);
        await expect(
          editAgain.getByRole("button", {
            name: locale === "es" ? "Eliminar" : "Delete",
            exact: true,
          }),
        ).toBeFocused();
        expect(deleteWrites).toBe(0);

        // A pending refusal cannot be dismissed or submitted twice.
        await editAgain
          .getByRole("button", {
            name: locale === "es" ? "Eliminar" : "Delete",
            exact: true,
          })
          .click();
        await dialog
          .getByRole("button", {
            name: locale === "es" ? "Eliminar" : "Delete",
            exact: true,
          })
          .click();
        await expect.poll(() => deleteWrites).toBe(1);
        await expect(
          dialog.getByRole("button", {
            name: locale === "es" ? "Quitando…" : "Removing…",
            exact: true,
          }),
        ).toBeDisabled();
        await expect(cancel).toBeDisabled();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeVisible();
        await dialog
          .getByRole("button", {
            name: locale === "es" ? "Quitando…" : "Removing…",
            exact: true,
          })
          .dispatchEvent("click");
        expect(deleteWrites).toBe(1);
        releaseDelete!();
        await expect(dialog.getByRole("alert")).toHaveText(
          locale === "es"
            ? "No se pudo quitar la fecha. Inténtalo de nuevo."
            : "The date could not be removed. Try again.",
        );
        await expect(dialog).not.toContainText(PRIVATE_NOTES);
        const retry = dialog.getByRole("button", {
          name: locale === "es" ? "Intentar de nuevo" : "Try again",
          exact: true,
        });
        await retry.click();
        await expect(dialog.getByRole("alert")).toHaveText(
          locale === "es"
            ? "No se pudo quitar la fecha. Revisa tu conexión e inténtalo de nuevo."
            : "The date could not be removed. Check your connection and try again.",
        );
        expect(deleteWrites).toBe(2);
        await retry.click();
        await expect(dialog).toHaveCount(0);
        await expect(
          page
            .getByRole("button", {
              name: locale === "es" ? "Agregar fecha" : "Add Date",
              exact: true,
            })
            .first(),
        ).toBeFocused();
        expect(deleteWrites).toBe(3);
        expect(page.getByText(PRIVATE_NOTES)).toHaveCount(0);

        // A failed post-delete refresh moves focus to Retry and leaves no stale modal.
        deleted = false;
        await page.reload();
        await expect(
          page.getByRole("button", { name: new RegExp(LABEL) }),
        ).toBeVisible();
        failNextRefresh = true;
        const refreshTrigger = page.getByRole("button", {
          name: new RegExp(LABEL),
        });
        await refreshTrigger.click();
        const refreshEdit = page.getByRole("dialog", {
          name: locale === "es" ? "Editar" : "Edit",
          exact: true,
        });
        await refreshEdit
          .getByRole("button", {
            name: locale === "es" ? "Eliminar" : "Delete",
            exact: true,
          })
          .click();
        await page
          .getByRole("alertdialog")
          .getByRole("button", {
            name: locale === "es" ? "Eliminar" : "Delete",
            exact: true,
          })
          .click();
        await expect(
          page.getByText(
            locale === "es"
              ? "No se pudieron cargar las fechas"
              : "Could not load dates",
          ),
        ).toBeVisible();
        await expect(
          page.getByRole("button", {
            name: locale === "es" ? "Intentar de nuevo" : "Try again",
            exact: true,
          }),
        ).toBeFocused();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(page.getByRole("alertdialog")).toHaveCount(0);
        await info.attach(`anniversaries-${locale}-refresh-recovery`, {
          body: await page.screenshot({
            fullPage: false,
            animations: "disabled",
          }),
          contentType: "image/png",
        });
      } finally {
        releaseDelete?.();
        releasePatch?.();
        try {
          let response;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
              response = await browserSend(
                page,
                "PATCH",
                "/api/family/features",
                { features: originalFeatures },
              );
              if (response.status === 200 || response.status < 500) break;
            } catch (error) {
              if (attempt === 1) throw error;
            }
          }
          expect(response).toBeDefined();
          expect(response!.status, response!.body).toBe(200);
          const canonical = await browserFetch(page, "/api/family/features");
          expect(canonical.status, canonical.body).toBe(200);
          expect(JSON.parse(canonical.body).features).toEqual(originalFeatures);
          restored = true;
        } finally {
          try {
            await cleanAudit(restored);
          } finally {
            await page.unrouteAll({ behavior: "ignoreErrors" });
            await context.unrouteAll({ behavior: "ignoreErrors" });
          }
        }
      }
    });
  });
}
