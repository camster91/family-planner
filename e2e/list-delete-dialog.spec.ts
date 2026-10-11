/** #499: rendered list deletion confirmation; DELETE is refused by synthetic transport. */
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { authFile } from "./support/env";
import { expect, test } from "./support/test";

test.use({ storageState: authFile("parentA") });

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

  const expectedCommit = process.env.RELEASE_SHA?.trim();
  expect(expectedCommit).toBe(head);
  const actualTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();
  expect(actualTree).toMatch(/^[a-f0-9]{40}$/);
  const configuredTree = process.env.E2E_LIST_DELETE_BUILD_TREE?.trim();
  if (configuredTree) expect(configuredTree).toBe(actualTree);

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
  await info.attach("actual-list-delete-runtime-identity", {
    body: JSON.stringify({
      runtime,
      buildTree: actualTree,
      configuredBuildTree: configuredTree ?? null,
      locale,
      sensitiveActions: "list DELETE intercepted with synthetic refusal",
      fixtureListId: FIXTURE_IDS.familyA.list,
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
      const r = el.getBoundingClientRect();
      return el.contains(
        document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
      );
    }),
  ).toBe(true);
}

for (const locale of ["en", "es"] as const) {
  test.describe(`${locale} list deletion`, () => {
    test.use({ colorScheme: locale === "en" ? "light" : "dark" });
    test(`${locale}: list deletion is named, reversible before submit and safely refused`, async ({
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
      await page.addInitScript(
        ({ key, value }) => localStorage.setItem(key, value),
        { key: LOCALE_STORAGE_KEY, value: locale },
      );

      const deletes: unknown[] = [];
      await page.route("**/api/lists", async (route) => {
        if (route.request().method() !== "DELETE") return route.continue();
        deletes.push(route.request().postDataJSON());
        await route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ error: "Synthetic refusal only" }),
        });
      });

      try {
        await page.goto(`/dashboard/lists/${FIXTURE_IDS.familyA.list}`);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        if (locale === "es") {
          await expect(page.locator("html")).toHaveClass(/\bdark\b/);
        } else {
          await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
        }
        await runtimeIdentity(page, info, locale);

        const listName = await page
          .getByRole("heading", { level: 1 })
          .innerText();
        const opener = page.getByRole("button", {
          name: locale === "en" ? /Delete list/ : /Eliminar lista/,
          exact: false,
        });
        await expect(opener).toBeVisible();
        await opener.click();

        const dialog = page.getByRole("alertdialog");
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText(listName);
        await expect(dialog).toContainText(
          locale === "en" ? "permanently" : "permanentemente",
        );
        const cancel = dialog.getByRole("button", {
          name: locale === "en" ? "Cancel" : "Cancelar",
          exact: true,
        });
        const action = dialog.getByRole("button", {
          name: locale === "en" ? "Delete" : "Eliminar",
          exact: true,
        });
        await expect(cancel).toBeFocused();
        await checkActionGeometry(page, cancel);
        await checkActionGeometry(page, action);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        const blocking = (
          await new AxeBuilder({ page })
            .include('[data-testid="delete-list-dialog"]')
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
            .analyze()
        ).violations.filter(
          (violation) =>
            violation.impact === "serious" || violation.impact === "critical",
        );
        expect(blocking).toEqual([]);
        await info.attach(`list-delete-${locale}-${info.project.name}`, {
          body: await page.screenshot({
            fullPage: false,
            animations: "disabled",
          }),
          contentType: "image/png",
        });

        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(opener).toBeFocused();
        expect(deletes).toHaveLength(0);

        await opener.click();
        await dialog
          .getByRole("button", {
            name: locale === "en" ? "Delete" : "Eliminar",
            exact: true,
          })
          .click();
        await expect(dialog.getByRole("alert")).toBeVisible();
        const retry = dialog.getByRole("button", {
          name: locale === "en" ? "Try again" : "Intentar de nuevo",
          exact: true,
        });
        await expect(retry).toBeEnabled();
        await retry.click();
        await expect(dialog.getByRole("alert")).toBeVisible();
        expect(deletes).toHaveLength(2);
        expect(deletes).toEqual([
          { listId: FIXTURE_IDS.familyA.list },
          { listId: FIXTURE_IDS.familyA.list },
        ]);
      } finally {
        await page.unrouteAll({ behavior: "ignoreErrors" });
        await context.unrouteAll({ behavior: "ignoreErrors" });
      }
    });
  });
}
