/**
 * Synthetic Dates recovery journey.
 *
 * Every anniversary read and mutation is intercepted in the browser. The
 * guarded feature toggle is restored in finally; no Anniversary row is
 * created, changed, or deleted by this spec.
 */
import AxeBuilder from "@axe-core/playwright";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { E2E_ANCHOR, authFile } from "./support/env";
import { ownFeatureAudit } from "./support/feature-audit";
import { browserFetch, browserSend, expect, test } from "./support/test";

test.use({ storageState: authFile("parentA") });

const DATE_ID = "fx_e2e_anniversary_recovery";
const DATE_NAME = "Synthetic editable date";
const OTHER_ID = "fx_e2e_anniversary_recovery_other";
const OTHER_NAME = "Synthetic read-only date";
const CREATED_ID = "fx_e2e_anniversary_recovery_created";
const CREATED_NAME = "Synthetic created date";

const dateAtOffset = (days: number) => {
  const date = new Date(E2E_ANCHOR.getTime());
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
};

function dateItem(
  id: string,
  name: string,
  days: number,
  grants: { can_edit: boolean; can_delete: boolean },
) {
  const date = dateAtOffset(days);
  return {
    id,
    name,
    type: "birthday" as const,
    date,
    notes: `${name} synthetic notes`,
    person_id: null,
    created_by: "fixture-parent-a",
    ...grants,
    days_until: days,
    next_occurrence: date,
  };
}

const EDITABLE = dateItem(DATE_ID, DATE_NAME, 10, {
  can_edit: true,
  can_delete: true,
});
const READ_ONLY = dateItem(OTHER_ID, OTHER_NAME, 20, {
  can_edit: false,
  can_delete: false,
});
const CREATED = dateItem(CREATED_ID, CREATED_NAME, 14, {
  can_edit: true,
  can_delete: true,
});

for (const locale of ["en", "es"] as const) {
  test.describe(`${locale} Dates recovery`, () => {
    test.use({ colorScheme: locale === "es" ? "dark" : "light" });

    test(`${locale}: retryable writes keep intent and failed refreshes stay read-only`, async ({
      page,
      context,
      baseURL,
    }, info) => {
      test.skip(
        !["phone-390x844", "desktop-1366x768"].includes(info.project.name),
        "Dates transport recovery runs on phone and desktop; overview and deletion retain all six sizes",
      );
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

      const copy =
        locale === "es"
          ? {
              title: "Fechas",
              add: "Agregar fecha",
              save: "Guardar",
              delete: "Eliminar",
              close: "Cerrar detalles de la fecha",
              name: "Nombre",
              date: "Fecha",
              savedRefresh:
                "Fecha guardada. No se pudo actualizar la lista; inténtalo de nuevo para comprobarla.",
              removedRefresh:
                "Fecha quitada. No se pudo actualizar la lista; inténtalo de nuevo para comprobarla.",
              network:
                "No se pudo guardar la fecha. Revisa tu conexión e inténtalo de nuevo.",
              unknown:
                "No pudimos confirmar que se guardó la fecha. Inténtalo de nuevo.",
              retry: "Intentar de nuevo",
            }
          : {
              title: "Dates",
              add: "Add Date",
              save: "Save",
              delete: "Delete",
              close: "Close date details",
              name: "Name",
              date: "Date",
              savedRefresh:
                "Date saved. The list could not be refreshed; try again to check it.",
              removedRefresh:
                "Date removed. The list could not be refreshed; try again to check it.",
              network:
                "The date could not be saved. Check your connection and try again.",
              unknown: "We couldn't confirm the date was saved. Try again.",
              retry: "Try again",
            };

      await page.goto("/dashboard");
      await expect(page).toHaveURL(/\/dashboard\/today$/);
      const originalFeatures = await browserFetch(page, "/api/family/features");
      expect(originalFeatures.status, originalFeatures.body).toBe(200);
      const features = JSON.parse(originalFeatures.body).features;
      const cleanAudit = await ownFeatureAudit(["anniversaries"]);
      let restored = false;
      let scenario: "post" | "aba" | "malformed" | "delete" = "post";
      let getAttempts = 0;
      let postAttempts = 0;
      let patchAttempts = 0;
      let deleteAttempts = 0;
      let failNextSaveRefresh = false;
      let failNextDeleteRefresh = false;
      const patchKeys: string[] = [];
      const patchBodies: string[] = [];
      const postKeys: string[] = [];
      const postBodies: string[] = [];

      const setScenario = (next: typeof scenario) => {
        scenario = next;
        getAttempts = 0;
        postAttempts = 0;
        patchAttempts = 0;
        deleteAttempts = 0;
        failNextSaveRefresh = false;
        failNextDeleteRefresh = false;
        patchKeys.length = 0;
        patchBodies.length = 0;
        postKeys.length = 0;
        postBodies.length = 0;
      };

      try {
        const enabled = await browserSend(
          page,
          "PATCH",
          "/api/family/features",
          {
            features: { ...features, anniversaries: true },
          },
        );
        expect(enabled.status, enabled.body).toBe(200);

        await page.route("**/api/anniversaries**", async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          const path = url.pathname;
          const method = request.method();

          if (method === "GET" && path === "/api/anniversaries") {
            getAttempts += 1;
            if (scenario === "post") {
              if (failNextSaveRefresh) {
                failNextSaveRefresh = false;
                await route.fulfill({
                  status: 503,
                  contentType: "application/json",
                  body: JSON.stringify({ error: "synthetic refresh failure" }),
                });
              } else {
                await route.fulfill({
                  status: 200,
                  contentType: "application/json",
                  body: JSON.stringify({
                    dates: postAttempts >= 2 ? [CREATED] : [],
                  }),
                });
              }
              return;
            }
            if (scenario === "delete") {
              await route.fulfill({
                status: failNextDeleteRefresh ? 503 : 200,
                contentType: "application/json",
                body: JSON.stringify(
                  failNextDeleteRefresh
                    ? { error: "synthetic refresh failure" }
                    : {
                        dates:
                          deleteAttempts === 0
                            ? [EDITABLE, READ_ONLY]
                            : [READ_ONLY],
                      },
                ),
              });
              failNextDeleteRefresh = false;
              return;
            }
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                dates: scenario === "malformed" ? [EDITABLE] : [EDITABLE],
              }),
            });
            return;
          }

          if (method === "POST" && path === "/api/anniversaries") {
            expect(scenario).toBe("post");
            postAttempts += 1;
            postKeys.push(request.headers()["idempotency-key"] ?? "");
            postBodies.push(request.postData() ?? "");
            if (postAttempts === 1) {
              await route.abort("failed");
              return;
            }
            failNextSaveRefresh = true;
            await route.fulfill({
              status: 201,
              contentType: "application/json",
              body: JSON.stringify({ date: CREATED }),
            });
            return;
          }

          if (method === "PATCH" && path === `/api/anniversaries/${DATE_ID}`) {
            expect(["aba", "malformed"]).toContain(scenario);
            patchAttempts += 1;
            patchKeys.push(request.headers()["idempotency-key"] ?? "");
            patchBodies.push(request.postData() ?? "");
            if (scenario === "aba" && patchAttempts < 3) {
              await route.abort("failed");
              return;
            }
            if (scenario === "malformed" && patchAttempts === 1) {
              await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ date: { id: DATE_ID } }),
              });
              return;
            }
            const body = request.postDataJSON() as { name?: string };
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                date: {
                  ...EDITABLE,
                  name: body.name ?? DATE_NAME,
                },
              }),
            });
            return;
          }

          if (method === "DELETE" && path === `/api/anniversaries/${DATE_ID}`) {
            expect(scenario).toBe("delete");
            deleteAttempts += 1;
            failNextDeleteRefresh = true;
            expect(request.postData()).toBeNull();
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({ success: true }),
            });
            return;
          }

          await route.abort("blockedbyclient");
          throw new Error(
            `Unexpected synthetic Dates request: ${method} ${path}`,
          );
        });

        await page.goto("/dashboard/anniversaries");
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(
          page.getByRole("heading", { name: copy.title, level: 1 }),
        ).toBeVisible();

        // A lost POST response is retried with the same key and canonical body.
        const add = page.getByRole("button", { name: copy.add, exact: true });
        await expect(add).toHaveCount(1);
        const addBox = await add.boundingBox();
        expect(addBox).not.toBeNull();
        expect(addBox!.width).toBeGreaterThanOrEqual(44);
        expect(addBox!.height).toBeGreaterThanOrEqual(44);
        await add.click();
        const addDialog = page.getByRole("dialog", {
          name: copy.add,
          exact: true,
        });
        await addDialog.getByLabel(copy.name).fill(CREATED_NAME);
        await addDialog
          .getByLabel(copy.date, { exact: true })
          .fill("2026-01-19");
        const addClose = addDialog.getByRole("button", {
          name: copy.close,
          exact: true,
        });
        const addCloseBox = await addClose.boundingBox();
        expect(addCloseBox).not.toBeNull();
        expect(addCloseBox!.width).toBeGreaterThanOrEqual(44);
        expect(addCloseBox!.height).toBeGreaterThanOrEqual(44);
        await addDialog
          .getByRole("button", { name: copy.save, exact: true })
          .click();
        await expect(addDialog).toContainText(copy.network);
        await addDialog
          .getByRole("button", { name: copy.save, exact: true })
          .click();
        await expect(
          page.getByText(copy.savedRefresh, { exact: true }),
        ).toBeVisible();
        await info.attach(
          `anniversaries-recovery-${locale}-${info.project.name}-saved-refresh-failed`,
          {
            body: await page.screenshot({
              fullPage: false,
              animations: "disabled",
            }),
            contentType: "image/png",
          },
        );
        expect(postAttempts).toBe(2);
        expect(postKeys[0]).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
        expect(postKeys[1]).toBe(postKeys[0]);
        expect(postBodies[1]).toBe(postBodies[0]);
        const createdRow = page.getByRole("button", {
          name: /Synthetic created date/,
        });
        await expect(createdRow).toBeVisible();
        await createdRow.click();
        const createdEdit = page.getByRole("dialog", {
          name: locale === "es" ? "Editar" : "Edit",
        });
        await expect(
          createdEdit.getByRole("button", { name: copy.save, exact: true }),
        ).toBeEnabled();
        await expect(
          createdEdit.getByRole("button", { name: copy.delete, exact: true }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(createdRow).toBeFocused();
        const saveGetCountBeforeRetry = getAttempts;
        const saveRetry = page.getByRole("button", {
          name: copy.retry,
          exact: true,
        });
        await saveRetry.click();
        await expect(
          page.getByText(copy.savedRefresh, { exact: true }),
        ).toHaveCount(0);
        expect(postAttempts).toBe(2);
        expect(getAttempts).toBe(saveGetCountBeforeRetry + 1);

        // A -> B -> A keeps A's receipt, including after cancelling active B.
        setScenario("aba");
        await page.reload();
        const editable = page.getByRole("button", { name: DATE_NAME });
        await editable.click();
        let edit = page.getByRole("dialog", {
          name: locale === "es" ? "Editar" : "Edit",
        });
        const editName = edit.getByLabel(copy.name);
        await editName.fill("Grandma A");
        await edit
          .getByRole("button", { name: copy.save, exact: true })
          .click();
        await expect(edit).toContainText(copy.network);
        await editName.fill("Grandma B");
        await edit
          .getByRole("button", { name: copy.save, exact: true })
          .click();
        await expect(edit).toContainText(copy.network);
        await page.keyboard.press("Escape");
        await expect(edit).toHaveCount(0);
        await expect(editable).toBeFocused();
        await editable.click();
        edit = page.getByRole("dialog", {
          name: locale === "es" ? "Editar" : "Edit",
        });
        await edit.getByLabel(copy.name).fill("Grandma A");
        await edit
          .getByRole("button", { name: copy.save, exact: true })
          .click();
        await expect(edit).toHaveCount(0);
        expect(patchAttempts).toBe(3);
        expect(patchKeys[0]).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
        expect(patchKeys[2]).toBe(patchKeys[0]);
        expect(patchKeys[1]).not.toBe(patchKeys[0]);
        expect(patchBodies[2]).toBe(patchBodies[0]);
        expect(patchBodies[1]).not.toBe(patchBodies[0]);

        // A malformed 2xx does not close or lose the retry key.
        setScenario("malformed");
        await page.reload();
        await page.getByRole("button", { name: DATE_NAME }).click();
        edit = page.getByRole("dialog", {
          name: locale === "es" ? "Editar" : "Edit",
        });
        await edit.getByLabel(copy.name).fill("Malformed draft");
        await edit
          .getByRole("button", { name: copy.save, exact: true })
          .click();
        await expect(edit).toContainText(copy.unknown);
        await expect(edit.getByLabel(copy.name)).toHaveValue("Malformed draft");
        await edit
          .getByRole("button", { name: copy.save, exact: true })
          .click();
        await expect(edit).toHaveCount(0);
        expect(patchAttempts).toBe(2);
        expect(patchKeys[1]).toBe(patchKeys[0]);

        // Confirmed delete plus failed refresh keeps the remaining row and only retries GET.
        setScenario("delete");
        await page.reload();
        const readOnly = page.getByRole("button", { name: OTHER_NAME });
        await readOnly.click();
        const readOnlyDialog = page.getByRole("dialog", { name: OTHER_NAME });
        expect(
          await readOnlyDialog
            .getByRole("button", { name: copy.save, exact: true })
            .count(),
        ).toBe(0);
        expect(
          await readOnlyDialog
            .getByRole("button", { name: copy.delete, exact: true })
            .count(),
        ).toBe(0);
        await page.keyboard.press("Escape");
        await expect(readOnly).toBeFocused();
        await page.getByRole("button", { name: DATE_NAME }).click();
        edit = page.getByRole("dialog", {
          name: locale === "es" ? "Editar" : "Edit",
        });
        const deleteButton = edit.getByRole("button", {
          name: copy.delete,
          exact: true,
        });
        const deleteBox = await deleteButton.boundingBox();
        expect(deleteBox).not.toBeNull();
        expect(deleteBox!.width).toBeGreaterThanOrEqual(44);
        expect(deleteBox!.height).toBeGreaterThanOrEqual(44);
        await deleteButton.click();
        const confirmation = page.getByRole("alertdialog");
        await confirmation
          .getByRole("button", { name: copy.delete, exact: true })
          .click();
        await expect(
          page.getByText(copy.removedRefresh, { exact: true }),
        ).toBeVisible();
        await info.attach(
          `anniversaries-recovery-${locale}-${info.project.name}-deleted-refresh-failed`,
          {
            body: await page.screenshot({
              fullPage: false,
              animations: "disabled",
            }),
            contentType: "image/png",
          },
        );
        await expect(
          page.getByRole("button", { name: OTHER_NAME }),
        ).toBeVisible();
        await expect(page.getByRole("button", { name: DATE_NAME })).toHaveCount(
          0,
        );
        const deleteGetCountBeforeRetry = getAttempts;
        const deleteRetry = page.getByRole("button", {
          name: copy.retry,
          exact: true,
        });
        await deleteRetry.click();
        await expect(
          page.getByText(copy.removedRefresh, { exact: true }),
        ).toHaveCount(0);
        expect(deleteAttempts).toBe(1);
        expect(getAttempts).toBe(deleteGetCountBeforeRetry + 1);

        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        const violations = (
          await new AxeBuilder({ page })
            .include("main")
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze()
        ).violations;
        expect(violations).toEqual([]);
        await info.attach(
          `anniversaries-recovery-${locale}-${info.project.name}`,
          {
            body: await page.screenshot({
              fullPage: false,
              animations: "disabled",
            }),
            contentType: "image/png",
          },
        );
      } finally {
        try {
          const restoredResponse = await browserSend(
            page,
            "PATCH",
            "/api/family/features",
            {
              features,
            },
          );
          expect(restoredResponse.status, restoredResponse.body).toBe(200);
          const canonical = await browserFetch(page, "/api/family/features");
          expect(canonical.status, canonical.body).toBe(200);
          expect(JSON.parse(canonical.body).features).toEqual(features);
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
