/** Disposable-fixture Handoff confirmation; all handoff mutations are intercepted. */
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { Page, TestInfo } from "@playwright/test";
import { LOCALE_STORAGE_KEY, messages } from "../src/i18n";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { authFile } from "./support/env";
import { ownFeatureAudit } from "./support/feature-audit";
import { browserFetch, browserSend, expect, test } from "./support/test";

const PROJECTS = [
  "phone-390x844",
  "phone-430x932",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
  "tablet-large-1920x1200",
  "desktop-1366x768",
] as const;

test.use({ storageState: authFile("parentA") });

const LABEL = "Grandma & Grandpa’s 家族 babysitting — Schulabschluss 李🎉";
const PRIVATE_NOTES =
  "SYNTHETIC private family notes must stay outside the removal confirmation";
const PRIVATE_TOKEN = "synthetic-private-share-token";
const ID = "fx_e2e_handoff_dialog";

const HANDOFF = {
  id: ID,
  sitter_name: LABEL,
  sitter_phone: "(555) 010-2044",
  arrival_time: "2099-04-10T20:00:00.000Z",
  departure_time: "2099-04-11T01:00:00.000Z",
  kids_bedtimes: "Emma: 8pm",
  where_snacks: "Pantry shelf two",
  pickup_authorized: "Grandpa",
  code_words: "PINEAPPLE",
  pet_care: "Feed the cat",
  emergency_notes: PRIVATE_NOTES,
  house_notes: "Synthetic house note",
  general_notes: "Synthetic general note",
  share_token: PRIVATE_TOKEN,
  share_expires_at: "2099-04-11T02:00:00.000Z",
  created_at: "2099-01-01T00:00:00.000Z",
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
  const configuredTree = process.env.E2E_HANDOFF_BUILD_TREE?.trim();
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
  await info.attach("handoff-source-runtime-proof", {
    body: JSON.stringify({
      runtime,
      buildTree: tree,
      configuredBuildTree: configuredTree ?? null,
      locale,
      transport:
        "feature toggle is restored; handoff GET/PATCH/DELETE/share are browser-intercepted; no handoff domain writes",
    }),
    contentType: "application/json",
  });
}

for (const locale of ["en", "es"] as const) {
  const copy = messages[locale];
  const deletionCopy =
    locale === "es"
      ? {
          title: `¿Quitar «${LABEL}»?`,
          description: `Esto quitará permanentemente «${LABEL}» e invalidará su enlace compartido para la niñera.`,
          failed: "No se pudo quitar la entrega. Inténtalo de nuevo.",
          network:
            "No se pudo quitar la entrega. Revisa tu conexión e inténtalo de nuevo.",
          deleting: "Quitando…",
        }
      : {
          title: `Remove “${LABEL}”?`,
          description: `This permanently removes “${LABEL}” and invalidates its shared sitter link.`,
          failed: "The handoff could not be removed. Try again.",
          network:
            "The handoff could not be removed. Check your connection and try again.",
          deleting: "Removing…",
        };

  test.describe(`${locale} handoff deletion`, () => {
    test.use({ colorScheme: locale === "en" ? "light" : "dark" });

    test(`${locale}: deletion is named, private, guarded and recoverable`, async ({
      page,
      context,
      baseURL,
    }, info) => {
      test.skip(
        !PROJECTS.includes(info.project.name as (typeof PROJECTS)[number]),
        "Handoff deletion runs at the six representative responsive sizes",
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

      await page.goto("/dashboard");
      const original = await browserFetch(page, "/api/family/features");
      expect(original.status, original.body).toBe(200);
      const originalFeatures = JSON.parse(original.body).features;
      let cleanAudit: Awaited<ReturnType<typeof ownFeatureAudit>> | undefined;
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
        cleanAudit = await ownFeatureAudit(["handoff"]);
        await page.route("**/api/handoff**", async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          if (request.method() === "GET" && url.pathname === "/api/handoff") {
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
                body: JSON.stringify({ handoffs: deleted ? [] : [HANDOFF] }),
              });
            }
          } else if (
            request.method() === "GET" &&
            url.pathname === `/api/handoff/share/${PRIVATE_TOKEN}`
          ) {
            if (deleted) {
              await route.fulfill({
                status: 404,
                contentType: "application/json",
                body: JSON.stringify({ error: "Not found" }),
              });
            } else {
              await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                  handoff: {
                    sitter_name: LABEL,
                    arrival_time: HANDOFF.arrival_time,
                    departure_time: HANDOFF.departure_time,
                  },
                }),
              });
            }
          } else if (
            request.method() === "PATCH" &&
            url.pathname === `/api/handoff/${ID}`
          ) {
            expect(request.headers()["x-csrf-token"]).toBeTruthy();
            patchWrites += 1;
            expect(request.postDataJSON()).toMatchObject({
              sitter_name: expect.any(String),
            });
            if (patchWrites === 1) await pendingPatch;
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({ handoff: HANDOFF }),
            });
          } else if (
            request.method() === "DELETE" &&
            url.pathname === `/api/handoff/${ID}`
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
              `Unexpected handoff request: ${request.method()} ${url.pathname}`,
            );
          }
        });

        const enabled = await browserSend(
          page,
          "PATCH",
          "/api/family/features",
          {
            features: { ...originalFeatures, handoff: true },
          },
        );
        expect(enabled.status, enabled.body).toBe(200);
        await page.goto("/dashboard/handoff");
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        if (locale === "es") {
          await expect(page.locator("html")).toHaveClass(/\bdark\b/);
        } else {
          await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
        }
        await runtimeIdentity(page, info, locale);

        const publicBefore = await browserFetch(
          page,
          `/api/handoff/share/${PRIVATE_TOKEN}`,
        );
        expect(publicBefore.status, publicBefore.body).toBe(200);
        expect(publicBefore.body).not.toContain(PRIVATE_NOTES);
        expect(publicBefore.body).not.toContain(PRIVATE_TOKEN);

        const card = page.getByTestId(`handoff-card-${ID}`);
        await expect(card).toBeVisible();
        const editTrigger = card.getByRole("button", {
          name: copy.handoff.editHandoff,
          exact: true,
        });

        // A pending save keeps the edit sheet mounted and blocks deletion.
        await editTrigger.click();
        const edit = page.getByRole("dialog", {
          name: copy.handoff.editHandoff,
          exact: true,
        });
        await edit
          .getByLabel(copy.handoff.sitterName, { exact: true })
          .fill(`Draft ${LABEL}`);
        await edit
          .getByRole("button", { name: copy.common.save, exact: true })
          .click();
        await expect(
          edit.getByRole("button", {
            name: copy.common.saving,
            exact: true,
          }),
        ).toBeDisabled();
        await expect(
          edit.getByRole("button", {
            name: copy.handoff.deleteHandoff,
            exact: true,
          }),
        ).toBeDisabled();
        await page.keyboard.press("Escape");
        await expect(edit).toBeVisible();
        expect(deleteWrites).toBe(0);
        releasePatch!();
        await expect(edit).toHaveCount(0);
        expect(patchWrites).toBe(1);

        // Cancel returns focus to Delete and preserves the unsaved edit draft.
        await editTrigger.click();
        const editAgain = page.getByRole("dialog", {
          name: copy.handoff.editHandoff,
          exact: true,
        });
        const draft = editAgain.getByLabel(copy.handoff.sitterName, {
          exact: true,
        });
        await draft.fill(`Draft ${LABEL}`);
        const editDelete = editAgain.getByRole("button", {
          name: copy.handoff.deleteHandoff,
          exact: true,
        });
        await editDelete.click();
        const dialog = page.getByRole("alertdialog", {
          name: deletionCopy.title,
          exact: true,
        });
        const cancel = dialog.getByRole("button", {
          name: copy.common.cancel,
          exact: true,
        });
        const confirm = dialog.getByRole("button", {
          name: copy.common.delete,
          exact: true,
        });
        await expect(cancel).toBeFocused();
        await expect(dialog).toContainText(LABEL);
        await expect(dialog).toContainText(deletionCopy.description);
        await expect(dialog).not.toContainText(PRIVATE_NOTES);
        await expect(dialog).not.toContainText(PRIVATE_TOKEN);
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
            .include('[data-testid="remove-handoff-dialog"]')
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
            .analyze()
        ).violations.filter(
          (violation) =>
            violation.impact === "serious" || violation.impact === "critical",
        );
        expect(violations).toEqual([]);
        await info.attach(
          `handoff-${locale}-${info.project.name}-confirmation`,
          {
            body: await page.screenshot({
              fullPage: false,
              animations: "disabled",
            }),
            contentType: "image/png",
          },
        );

        await cancel.click();
        await expect(dialog).toHaveCount(0);
        await expect(editDelete).toBeFocused();
        await expect(draft).toHaveValue(`Draft ${LABEL}`);
        expect(deleteWrites).toBe(0);

        // A pending refusal cannot be dismissed or submitted twice.
        await editDelete.click();
        await page
          .getByRole("alertdialog")
          .getByRole("button", { name: copy.common.delete, exact: true })
          .click();
        await expect.poll(() => deleteWrites).toBe(1);
        await expect(
          dialog.getByRole("button", {
            name: deletionCopy.deleting,
            exact: true,
          }),
        ).toBeDisabled();
        await expect(cancel).toBeDisabled();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeVisible();
        await dialog
          .getByRole("button", {
            name: deletionCopy.deleting,
            exact: true,
          })
          .dispatchEvent("click");
        expect(deleteWrites).toBe(1);
        releaseDelete!();
        await expect(dialog.getByRole("alert")).toHaveText(deletionCopy.failed);
        await expect(dialog).not.toContainText(PRIVATE_NOTES);
        const retry = dialog.getByRole("button", {
          name: copy.routeState.tryAgain,
          exact: true,
        });
        await retry.click();
        await expect(dialog.getByRole("alert")).toHaveText(
          deletionCopy.network,
        );
        expect(deleteWrites).toBe(2);
        await retry.click();
        await expect(dialog).toHaveCount(0);
        await expect(card).toHaveCount(0);
        await expect(
          page
            .getByRole("button", {
              name: copy.handoff.createHandoff,
              exact: true,
            })
            .first(),
        ).toBeFocused();
        expect(deleteWrites).toBe(3);
        const publicAfter = await browserFetch(
          page,
          `/api/handoff/share/${PRIVATE_TOKEN}`,
        );
        expect(publicAfter.status, publicAfter.body).toBe(404);
        expect(publicAfter.body).not.toContain(PRIVATE_NOTES);
        expect(publicAfter.body).not.toContain(PRIVATE_TOKEN);
        await expect(
          page.getByRole("button", { name: copy.handoff.shareWithSitter }),
        ).toHaveCount(0);

        // A failed post-delete refresh leaves the deleted handoff and share controls gone.
        deleted = false;
        deleteWrites = 2;
        failNextRefresh = true;
        await page.reload();
        await expect(page.getByTestId(`handoff-card-${ID}`)).toBeVisible();
        const refreshCard = page.getByTestId(`handoff-card-${ID}`);
        await refreshCard
          .getByRole("button", {
            name: copy.handoff.editHandoff,
            exact: true,
          })
          .click();
        await page
          .getByRole("dialog", { name: copy.handoff.editHandoff, exact: true })
          .getByRole("button", {
            name: copy.handoff.deleteHandoff,
            exact: true,
          })
          .click();
        await page
          .getByRole("alertdialog")
          .getByRole("button", { name: copy.common.delete, exact: true })
          .click();
        await expect(
          page.getByRole("alert").filter({ hasText: copy.handoff.errorLoad }),
        ).toBeVisible();
        await expect(page.getByTestId(`handoff-card-${ID}`)).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: copy.handoff.shareWithSitter }),
        ).toHaveCount(0);
        await expect(page.getByText(PRIVATE_NOTES)).toHaveCount(0);
        await expect(page.getByText(PRIVATE_TOKEN)).toHaveCount(0);
        await expect(
          page.getByRole("button", {
            name: copy.routeState.tryAgain,
            exact: true,
          }),
        ).toBeFocused();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(page.getByRole("alertdialog")).toHaveCount(0);
        await info.attach(
          `handoff-${locale}-${info.project.name}-refresh-recovery`,
          {
            body: await page.screenshot({
              fullPage: false,
              animations: "disabled",
            }),
            contentType: "image/png",
          },
        );
      } finally {
        releaseDelete?.();
        releasePatch?.();
        if (cleanAudit) {
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
            expect(JSON.parse(canonical.body).features).toEqual(
              originalFeatures,
            );
            restored = true;
          } finally {
            try {
              await cleanAudit(restored);
            } finally {
              await page.unrouteAll({ behavior: "ignoreErrors" });
              await context.unrouteAll({ behavior: "ignoreErrors" });
            }
          }
        } else {
          await context.unrouteAll({ behavior: "ignoreErrors" });
        }
      }
    });
  });
}
