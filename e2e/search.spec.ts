/**
 * Household search (route inventory F-3): /dashboard/search and GET /api/search
 * against the seeded fixture households.
 *
 * - Parent (Family A): typing finds a grocery item and a recipe, grouped by
 *   kind, and the result opens its page; `?q=` pre-fills the box; another
 *   household's words find nothing; targets >= 44px; no horizontal overflow;
 *   axe (serious/critical).
 * - Child (Family A): the page redirects home (parent-only, kid allowlist);
 *   the API returns only lists, list items and food, never a recipe.
 * - Family B parent: never sees Family A's rows.
 *
 * Read-only: nothing is created, so seeded data and the visual baselines are
 * unchanged. Runs at 390x844 and 1366x768.
 */
import AxeBuilder from "@axe-core/playwright";
import type { TestInfo } from "@playwright/test";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { authFile } from "./support/env";
import { browserFetch, expect, test } from "./support/test";

const A = FIXTURE_IDS.familyA;
const PROJECTS = ["phone-390x844", "desktop-1366x768"];

function onlyOnSomeProjects(testInfo: TestInfo) {
  test.skip(
    !PROJECTS.includes(testInfo.project.name),
    "search journey runs at 390x844 and 1366x768",
  );
}

type Result = { type: string; id: string; title: string; href: string };

async function apiSearch(
  page: import("@playwright/test").Page,
  q: string,
): Promise<{ status: number; results: Result[] }> {
  const res = await browserFetch(
    page,
    `/api/search?q=${encodeURIComponent(q)}`,
  );
  const body = JSON.parse(res.body) as { results?: Result[] };
  return { status: res.status, results: body.results ?? [] };
}

test.describe("search (Family A parent)", () => {
  test.use({ storageState: authFile("parentA") });

  test("finds household items and recipes and opens them", async ({
    page,
  }, testInfo) => {
    onlyOnSomeProjects(testInfo);
    await page.goto("/dashboard/search");
    const box = page.getByRole("searchbox", { name: "Search your household" });
    await expect(page.getByTestId("search-idle")).toBeVisible();

    await box.fill("milk");
    const results = page.getByTestId("search-results");
    await expect(
      results.getByRole("heading", { name: "On a list" }),
    ).toBeVisible();
    const milk = results.getByRole("link", { name: /^Milk\b.*On Groceries/ });
    await expect(milk).toHaveAttribute(
      "href",
      `/dashboard/lists/${A.groceryList}`,
    );
    await expect(page).toHaveURL(/\/dashboard\/search\?q=milk$/);

    await box.fill("lasagna");
    const recipe = results.getByRole("link", { name: /Veggie lasagna/ });
    await expect(recipe).toBeVisible();
    await expect(
      results.getByRole("heading", { name: "Recipes" }),
    ).toBeVisible();

    // Targets and reflow.
    const box44 = await recipe.boundingBox();
    expect(box44?.height ?? 0).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      axe.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => v.id),
    ).toEqual([]);

    await recipe.click();
    await expect(page).toHaveURL(/\/dashboard\/meals\/recipes\/[^/]+$/);
  });

  test("opens with ?q= and finds nothing from another household", async ({
    page,
  }, testInfo) => {
    onlyOnSomeProjects(testInfo);
    await page.goto("/dashboard/search?q=Family%20B");
    await expect(
      page.getByRole("searchbox", { name: "Search your household" }),
    ).toHaveValue("Family B");
    await expect(page.getByTestId("search-empty")).toContainText(
      "Nothing matches “Family B”.",
    );
    const api = await apiSearch(page, "Printer ink");
    expect(api).toEqual({ status: 200, results: [] });
  });
});

test.describe("search (Family A child)", () => {
  test.use({ storageState: authFile("childA") });

  test("the page is parent-only and the API returns only kid-openable kinds", async ({
    page,
  }, testInfo) => {
    onlyOnSomeProjects(testInfo);
    await page.goto("/dashboard/search");
    await expect(page).toHaveURL(/\/dashboard$/);
    const milk = await apiSearch(page, "milk");
    expect(milk.status).toBe(200);
    expect(milk.results.length).toBeGreaterThan(0);
    for (const r of milk.results)
      expect(["list", "list_item", "inventory"]).toContain(r.type);
    expect((await apiSearch(page, "lasagna")).results).toEqual([]);
  });
});

test.describe("search (Family B parent)", () => {
  test.use({ storageState: authFile("parentB") });

  test("never sees Family A rows", async ({ page }, testInfo) => {
    onlyOnSomeProjects(testInfo);
    await page.goto("/dashboard/search");
    for (const q of ["milk", "lasagna", "Groceries", "Weekend"]) {
      expect(await apiSearch(page, q)).toEqual({ status: 200, results: [] });
    }
    const own = await apiSearch(page, "Printer ink");
    expect(own.results.map((r) => r.title)).toEqual(["Printer ink (Family B)"]);
  });
});
