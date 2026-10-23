/**
 * #460/#499: Explore -> preview -> RecipeEditor, localized and recoverable.
 *
 * Search, preview and save responses are synthetic loopback transport. The
 * provider is never contacted and the save never reaches Postgres. The page
 * still loads through the real Family A parent session and the real Meals
 * route, with all external requests blocked by the context guard.
 */
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { recipeEditorMessages } from "../src/i18n/recipe-editor";
import { recipeExploreMessages } from "../src/i18n/recipe-explore";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { authFile } from "./support/env";
import { browserFetch, expect, test } from "./support/test";

test.use({ storageState: authFile("parentA") });

type Locale = "en" | "es";

const sourceUrl = "https://www.bbcgoodfood.com/recipes/synthetic-soup";
const preview = {
  title: "Synthetic Provider Soup",
  description: "A provider preview used only for this browser check.",
  instructions: "Stir, simmer, and serve.",
  ingredientLines: ["1 cup rice", "Salt to taste"],
  source: sourceUrl,
  servings: 4,
  prep_time: 15,
  cook_time: 25,
};

const copy = {
  en: {
    explore: recipeExploreMessages.en,
    editor: recipeEditorMessages.en,
  },
  es: {
    explore: recipeExploreMessages.es,
    editor: recipeEditorMessages.es,
  },
} as const;

function sourceHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

async function installGuard(
  context: BrowserContext,
  locale: Locale,
  externalRequests: string[],
) {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      ["data:", "blob:"].includes(url.protocol)
    ) {
      return route.continue();
    }
    externalRequests.push(
      `${route.request().method()} ${url.origin}${url.pathname}`,
    );
    return route.abort();
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
  syntheticRecipeId: string,
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
  const configuredTree = process.env.E2E_MEALS_EXPLORE_BUILD_TREE?.trim();
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
  await info.attach("actual-meals-explore-runtime-identity", {
    body: JSON.stringify({
      runtime,
      buildTree,
      configuredBuildTree: configuredTree ?? null,
      locale,
      fixtureFamily: FIXTURE_IDS.familyA.family,
      fixtureParent: FIXTURE_IDS.familyA.parent,
      syntheticRecipeId,
      sensitiveActions:
        "discover, preview and recipe save are synthetic loopback responses; no provider or database write",
    }),
    contentType: "application/json",
  });
}

async function expectTargets(page: Page, scope: Locator) {
  const controls = scope.locator("button, a[href], input, textarea, select");
  for (const control of await controls.all()) {
    if (!(await control.isVisible())) continue;
    // Native checkboxes/radios remain small controls, while their associated
    // labels provide the intended full-size touch target. Other controls keep
    // the direct target assertion.
    const label = control.locator("xpath=ancestor::label[1]");
    const nativeChoice = await control.evaluate(
      (element) =>
        element.tagName === "INPUT" &&
        ["checkbox", "radio"].includes((element as HTMLInputElement).type),
    );
    const target = nativeChoice && (await label.count()) > 0 ? label : control;
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(
      await target.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return hit === element || element.contains(hit);
      }),
    ).toBe(true);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(
    await scope.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
}

async function expectNoSeriousAxe(page: Page, info: TestInfo, label: string) {
  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .exclude("next-route-announcer")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = results.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  await info.attach(`meals-explore-${label}-axe`, {
    body: JSON.stringify(blocking, null, 2),
    contentType: "application/json",
  });
  expect(blocking).toEqual([]);
}

for (const locale of ["en", "es"] as const) {
  test.describe(`${locale} Meals Explore and RecipeEditor`, () => {
    test.use({ colorScheme: locale === "es" ? "dark" : "light" });

    test(`${locale}: searches, recovers provider preview, preserves editor draft and saves safely`, async ({
      page,
      context,
      baseURL,
    }, info) => {
      assertFixtureTargetAllowed(process.env);
      expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
        new URL(baseURL!).hostname,
      );
      const externalRequests: string[] = [];
      await installGuard(context, locale, externalRequests);

      let discoverCalls = 0;
      let previewCalls = 0;
      let saveCalls = 0;
      const saveBodies: unknown[] = [];
      let releaseSave: (() => void) | undefined;
      let saveStarted = false;
      let releaseSaveFinished: (() => void) | undefined;
      const saveFinished = new Promise<void>((resolve) => {
        releaseSaveFinished = resolve;
      });
      const saveGate = new Promise<void>((resolve) => {
        releaseSave = resolve;
      });

      await page.route("**/api/recipes**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname === "/api/recipes" && request.method() === "GET") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              recipes: [],
              nextOffset: null,
              synthetic: "Meals Explore UI fixture only",
            }),
          });
          return;
        }
        if (
          url.pathname === "/api/recipes/discover" &&
          request.method() === "POST"
        ) {
          discoverCalls += 1;
          expect(request.postDataJSON()).toEqual({
            query: "soup",
            source: "BBC Good Food",
          });
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              results: [{ title: "Synthetic Provider Soup", url: sourceUrl }],
            }),
          });
          return;
        }
        if (
          url.pathname === "/api/recipes/preview" &&
          request.method() === "POST"
        ) {
          previewCalls += 1;
          expect(request.postDataJSON()).toEqual({ url: sourceUrl });
          if (previewCalls === 1) {
            await route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({
                error: "Synthetic provider token detail must stay private",
              }),
            });
          } else {
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                recipe: preview,
                synthetic: "provider preview response; no external request",
              }),
            });
          }
          return;
        }
        if (url.pathname === "/api/recipes" && request.method() === "POST") {
          saveCalls += 1;
          const body = request.postDataJSON() as Record<string, unknown>;
          saveBodies.push(body);
          expect(typeof body.title).toBe("string");
          if (saveCalls === 1) {
            saveStarted = true;
            await saveGate;
            try {
              await route.fulfill({
                status: 422,
                contentType: "application/json",
                body: JSON.stringify({
                  error: "Synthetic private save detail must stay private",
                  synthetic: "save refusal response; no database write",
                }),
              });
            } finally {
              releaseSaveFinished?.();
            }
          } else if (saveCalls === 2) {
            await route.fulfill({
              status: 201,
              contentType: "application/json",
              body: JSON.stringify({
                recipe: {
                  id: "synthetic-recipe-saved",
                  title: body.title,
                  description: body.description ?? null,
                  instructions: body.instructions ?? null,
                  prep_time: body.prep_time ?? null,
                  cook_time: body.cook_time ?? null,
                  servings: body.servings ?? 2,
                },
                synthetic: "recipe save response; no database write",
              }),
            });
          } else {
            throw new Error(`Unexpected synthetic recipe save ${saveCalls}`);
          }
          return;
        }
        return route.continue();
      });

      try {
        const response = await page.goto("/dashboard/meals/explore");
        expect(response?.status()).toBe(200);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        if (locale === "es")
          await expect(page.locator("html")).toHaveClass(/\bdark\b/);
        else await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);

        const profileResponse = await browserFetch(page, "/api/users");
        expect(profileResponse.status, profileResponse.body).toBe(200);
        const profile = JSON.parse(profileResponse.body).user as {
          family_id?: string;
          id?: string;
          role?: string;
        };
        expect(profile.id).toBe(FIXTURE_IDS.familyA.parent);
        expect(profile.family_id).toBe(FIXTURE_IDS.familyA.family);
        expect(profile.role).toBe("parent");
        await runtimeIdentity(page, info, locale, "synthetic-recipe-saved");

        const text = copy[locale].explore;
        const editorText = copy[locale].editor;
        await expect(
          page.getByRole("heading", { name: text.title, level: 1 }),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: text.recipeBox }),
        ).toBeVisible();

        await page.getByLabel(text.searchPrompt).fill("soup");
        await page
          .getByRole("button", { name: text.searchRecipes, exact: true })
          .click();
        await expect.poll(() => discoverCalls).toBe(1);
        const result = page
          .getByRole("listitem")
          .filter({ hasText: preview.title });
        await expect(result).toBeVisible();
        await result
          .getByRole("button", { name: text.readRecipe, exact: true })
          .click();
        await expect.poll(() => previewCalls).toBe(1);
        const providerAlert = page
          .getByRole("alert")
          .filter({ hasText: text.readFailed });
        await expect(providerAlert).toBeVisible();
        await expect(providerAlert).not.toContainText("provider token detail");

        await result
          .getByRole("button", { name: text.readRecipe, exact: true })
          .click();
        await expect.poll(() => previewCalls).toBe(2);
        const dialog = page.getByRole("dialog", { name: preview.title });
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByRole("button", { name: text.reviewAndSave, exact: true }),
        ).toBeVisible();
        await expectTargets(page, dialog);
        await expectNoSeriousAxe(page, info, `${locale}-preview`);
        await info.attach(`meals-explore-${locale}-preview`, {
          body: await page.screenshot({
            fullPage: false,
            animations: "disabled",
          }),
          contentType: "image/png",
        });

        await dialog
          .getByRole("button", { name: text.reviewAndSave, exact: true })
          .click();
        await expect(dialog.getByLabel(editorText.recipeName)).toBeVisible();
        const draftTitle = `${preview.title} ${locale} family draft ${"with long text ".repeat(4).trim()}`;
        await dialog.getByLabel(editorText.recipeName).fill(draftTitle);
        await dialog
          .getByLabel(editorText.description)
          .fill("Draft description retained while the save is pending.");
        await expectTargets(page, dialog);
        await expectNoSeriousAxe(page, info, `${locale}-editor-before-save`);

        await dialog
          .getByRole("button", { name: editorText.saveRecipe, exact: true })
          .click();
        await expect.poll(() => saveCalls).toBe(1);
        await expect(
          dialog.getByRole("button", { name: editorText.saving, exact: true }),
        ).toBeDisabled();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeVisible();
        await expect(dialog.getByLabel(editorText.recipeName)).toHaveValue(
          draftTitle,
        );
        await expect(dialog.getByLabel(editorText.description)).toHaveValue(
          "Draft description retained while the save is pending.",
        );

        releaseSave?.();
        if (saveStarted) await saveFinished;
        await expect(dialog.getByRole("alert")).toHaveText(editorText.rejected);
        await expect(dialog.getByRole("alert")).not.toContainText(
          "private save detail",
        );
        await expect(dialog.getByLabel(editorText.recipeName)).toHaveValue(
          draftTitle,
        );
        await expect(dialog.getByLabel(editorText.description)).toHaveValue(
          "Draft description retained while the save is pending.",
        );
        await dialog
          .getByRole("button", { name: editorText.saveRecipe, exact: true })
          .click();
        await expect.poll(() => saveCalls).toBe(2);
        await expect(
          dialog.getByRole("link", { name: text.openSavedRecipe, exact: true }),
        ).toHaveAttribute(
          "href",
          "/dashboard/meals/recipes/synthetic-recipe-saved",
        );
        await expectTargets(page, dialog);
        await expectNoSeriousAxe(page, info, `${locale}-saved-preview`);
        await expect(
          dialog.getByRole("button", { name: text.closeRecipe }),
        ).toBeVisible();
        expect(saveBodies).toHaveLength(2);
        expect(saveBodies[0]).toEqual(saveBodies[1]);
        await dialog.getByRole("button", { name: text.closeRecipe }).click();
        await expect(dialog).toHaveCount(0);
        expect(externalRequests).toEqual([]);
        await info.attach(`meals-explore-${locale}-transport`, {
          body: JSON.stringify({
            discoverCalls,
            previewCalls,
            saveCalls,
            saveBodies,
            externalRequests,
            syntheticOnly:
              "provider search/preview and recipe save were intercepted; no external/provider/database mutation",
          }),
          contentType: "application/json",
        });
      } finally {
        releaseSave?.();
        if (saveStarted) await saveFinished.catch(() => undefined);
        await page.unrouteAll({ behavior: "ignoreErrors" });
        await context.unrouteAll({ behavior: "ignoreErrors" });
      }
    });
  });
}
