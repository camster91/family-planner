/** Anniversaries overview states; all anniversary transport stays synthetic. */
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { Page, TestInfo } from "@playwright/test";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { E2E_ANCHOR, authFile } from "./support/env";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { ownFeatureAudit } from "./support/feature-audit";
import { browserFetch, browserSend, expect, test } from "./support/test";

test.use({ storageState: authFile("parentA") });

const READ_ONLY_ID = "fx_e2e_anniversary_read_only";
const OWN_EDIT_ID = "fx_e2e_anniversary_own_edit";
const SOON_ID = "fx_e2e_anniversary_soon";
const FAR_ID = "fx_e2e_anniversary_far";
const FARTHER_ID = "fx_e2e_anniversary_farther";
const READ_ONLY_NAME = "Family date — read-only 家族記念日";
const OWN_EDIT_NAME = "Own editable date";
const LONG_NAME =
  "Mamá & Papá’s family celebration — Schulabschluss 李🎉 with an intentionally long name";
const PRIVATE_NOTES =
  "SYNTHETIC raw note stays inside the read-only detail and is never a control";

function dateAtOffset(days: number) {
  const date = new Date(E2E_ANCHOR.getTime());
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function dateItem(
  id: string,
  name: string,
  days: number,
  options: {
    type?: "birthday" | "anniversary" | "custom";
    notes?: string | null;
    can_edit?: boolean;
    can_delete?: boolean;
  } = {},
) {
  const date = dateAtOffset(days);
  return {
    id,
    name,
    type: options.type ?? "birthday",
    date,
    notes: options.notes ?? null,
    person_id: null,
    created_by: "fixture-parent-a",
    can_edit: options.can_edit ?? false,
    can_delete: options.can_delete ?? false,
    days_until: days,
    next_occurrence: date,
  };
}

const DATES = [
  dateItem(READ_ONLY_ID, READ_ONLY_NAME, 10, {
    type: "anniversary",
    notes: PRIVATE_NOTES,
  }),
  dateItem(OWN_EDIT_ID, OWN_EDIT_NAME, 24, {
    type: "custom",
    can_edit: true,
  }),
  dateItem(SOON_ID, LONG_NAME, 45, {
    type: "birthday",
  }),
  dateItem(FAR_ID, "Later family date", 180, {
    type: "anniversary",
  }),
  dateItem(FARTHER_ID, "Another later date", 240, {
    type: "custom",
  }),
];

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
  await info.attach("anniversaries-overview-source-runtime-proof", {
    body: JSON.stringify({
      runtime,
      buildTree: tree,
      configuredBuildTree: configuredTree ?? null,
      locale,
      transport:
        "feature toggle is restored; anniversary GET is browser-intercepted; no anniversary domain writes",
    }),
    contentType: "application/json",
  });
}

for (const locale of ["en", "es"] as const) {
  test.describe(`${locale} anniversaries overview`, () => {
    test.use({ colorScheme: locale === "en" ? "light" : "dark" });

    test(`${locale}: overview states, permissions, grouping, recovery and responsive controls`, async ({
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
      let phase: "loading" | "valid" | "malformed" | "empty" = "loading";
      let releaseLoading!: () => void;
      const loadingGate = new Promise<void>((resolve) => {
        releaseLoading = resolve;
      });

      try {
        await page.route("**/api/anniversaries**", async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          if (
            request.method() !== "GET" ||
            url.pathname !== "/api/anniversaries"
          ) {
            await route.abort("blockedbyclient");
            throw new Error(
              `Unexpected anniversaries write: ${request.method()} ${url.pathname}`,
            );
          }

          if (phase === "loading") await loadingGate;
          if (phase === "malformed") {
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({ dates: [{ ...DATES[0], id: null }] }),
            });
            return;
          }
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ dates: phase === "empty" ? [] : DATES }),
          });
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
        await expect(page.getByRole("status")).toHaveText(
          locale === "es" ? "Cargando fechas..." : "Loading dates...",
        );
        phase = "valid";
        releaseLoading();
        await runtimeIdentity(page, info, locale);

        const copy =
          locale === "es"
            ? {
                next: "Próximas fechas",
                more: "Más fechas (2)",
                later: "Más adelante en el año",
                add: "Agregar fecha",
                error: "No se pudieron cargar las fechas",
                retry: "Intentar de nuevo",
                empty: "No hay fechas todavía",
                edit: "Editar",
                save: "Guardar",
                delete: "Eliminar",
                close: "Cerrar detalles de la fecha",
                optional: "Detalles opcionales",
              }
            : {
                next: "Next up",
                more: "More dates (2)",
                later: "Later in the year",
                add: "Add Date",
                error: "Could not load dates",
                retry: "Try again",
                empty: "No dates yet",
                edit: "Edit",
                save: "Save",
                delete: "Delete",
                close: "Close date details",
                optional: "Optional details",
              };

        const add = page.getByRole("button", { name: copy.add, exact: true });
        await expect(add).toHaveCount(1);
        const addBox = await add.boundingBox();
        expect(addBox).not.toBeNull();
        expect(addBox!.width).toBeGreaterThanOrEqual(44);
        expect(addBox!.height).toBeGreaterThanOrEqual(44);

        await expect(
          page.getByRole("region", { name: copy.next }),
        ).toBeVisible();
        const moreDetails = page.locator("details");
        await expect(moreDetails).toHaveCount(1);
        await expect(moreDetails).not.toHaveAttribute("open", "");
        await expect(moreDetails.locator("summary")).toHaveText(copy.more);
        await moreDetails.locator("summary").click();
        await expect(
          page.getByRole("button", { name: /Later family date/ }),
        ).toBeVisible();
        await expect(
          moreDetails.getByRole("region", { name: copy.later }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", {
            name: /Mamá & Papá’s family celebration/,
          }),
        ).toBeVisible();

        // A server-granted read-only date opens details without exposing raw notes as controls.
        const readOnlyTrigger = page.getByRole("button", {
          name: READ_ONLY_NAME,
        });
        await readOnlyTrigger.click();
        const readOnly = page.getByRole("dialog", { name: READ_ONLY_NAME });
        await expect(readOnly).toContainText(PRIVATE_NOTES);
        expect(await readOnly.getByRole("textbox").count()).toBe(0);
        expect(
          await readOnly
            .getByRole("button", { name: copy.save, exact: true })
            .count(),
        ).toBe(0);
        expect(
          await readOnly
            .getByRole("button", { name: copy.delete, exact: true })
            .count(),
        ).toBe(0);
        const readOnlyClose = readOnly.getByRole("button", {
          name: copy.close,
          exact: true,
        });
        const readOnlyCloseBox = await readOnlyClose.boundingBox();
        expect(readOnlyCloseBox).not.toBeNull();
        expect(readOnlyCloseBox!.width).toBeGreaterThanOrEqual(44);
        expect(readOnlyCloseBox!.height).toBeGreaterThanOrEqual(44);
        await page.keyboard.press("Escape");
        await expect(readOnly).toHaveCount(0);
        await expect(readOnlyTrigger).toBeFocused();

        // Own edit permission has Save but no parent-only Delete; optional notes stay folded.
        const ownTrigger = page.getByRole("button", { name: OWN_EDIT_NAME });
        await ownTrigger.click();
        const edit = page.getByRole("dialog", { name: copy.edit, exact: true });
        await expect(
          edit.getByRole("button", { name: copy.save, exact: true }),
        ).toBeEnabled();
        expect(
          await edit
            .getByRole("button", { name: copy.delete, exact: true })
            .count(),
        ).toBe(0);
        await expect(edit.locator("details")).not.toHaveAttribute("open", "");
        await expect(edit.locator("details > summary")).toHaveText(
          copy.optional,
        );
        const optionalNotes = edit.getByLabel(
          locale === "es" ? "Notas (opcional)" : "Notes (optional)",
        );
        await expect(optionalNotes).toHaveCount(1);
        await expect(optionalNotes).toBeHidden();
        const editClose = edit.getByRole("button", {
          name: copy.close,
          exact: true,
        });
        const save = edit.getByRole("button", {
          name: copy.save,
          exact: true,
        });
        for (const action of [editClose, save]) {
          const box = await action.boundingBox();
          expect(box).not.toBeNull();
          expect(box!.width).toBeGreaterThanOrEqual(44);
          expect(box!.height).toBeGreaterThanOrEqual(44);
        }
        await page.keyboard.press("Escape");
        await expect(edit).toHaveCount(0);
        await expect(ownTrigger).toBeFocused();

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
          `anniversaries-overview-${locale}-${info.project.name}`,
          {
            body: await page.screenshot({
              fullPage: false,
              animations: "disabled",
            }),
            contentType: "image/png",
          },
        );

        // Malformed successful reads must recover instead of becoming a false empty state.
        phase = "malformed";
        await page.reload();
        await expect(page.getByText(copy.error, { exact: true })).toBeVisible();
        expect(await page.getByText(copy.empty, { exact: true }).count()).toBe(
          0,
        );
        phase = "empty";
        await page
          .getByRole("button", { name: copy.retry, exact: true })
          .click();
        await expect(page.getByText(copy.empty, { exact: true })).toBeVisible();
        const emptyAdd = page.getByRole("button", {
          name: copy.add,
          exact: true,
        });
        await expect(emptyAdd).toHaveCount(1);
        await info.attach(
          `anniversaries-empty-${locale}-${info.project.name}`,
          {
            body: await page.screenshot({
              fullPage: false,
              animations: "disabled",
            }),
            contentType: "image/png",
          },
        );
        await emptyAdd.click();
        const addDialog = page.getByRole("dialog", {
          name: copy.add,
          exact: true,
        });
        await expect(addDialog).toBeVisible();
        const addClose = addDialog.getByRole("button", {
          name: copy.close,
          exact: true,
        });
        const addCloseBox = await addClose.boundingBox();
        expect(addCloseBox).not.toBeNull();
        expect(addCloseBox!.width).toBeGreaterThanOrEqual(44);
        expect(addCloseBox!.height).toBeGreaterThanOrEqual(44);
        await page.keyboard.press("Escape");
        await expect(addDialog).toHaveCount(0);
        await expect(emptyAdd).toBeFocused();
      } finally {
        releaseLoading();
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
