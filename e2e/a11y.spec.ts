/**
 * Accessibility smoke gate (#155): axe-core on key pages at every viewport.
 *
 * Fails on any `serious` or `critical` violation that is not in the explicit
 * allowlist below. `minor`/`moderate` findings are attached to the report but
 * do not fail the run yet. Allowlist policy: docs/testing/E2E.md.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { authFile } from "./support/env";
import { useStoredTheme } from "./support/network";
import { expect, test } from "./support/test";

type Impact = "minor" | "moderate" | "serious" | "critical";

interface AllowlistEntry {
  /** axe rule id, e.g. 'color-contrast'. */
  rule: string;
  /** Page label the exemption applies to (as passed to scan()), or '*'. */
  page: string;
  /** Exact axe target selector. Only these nodes are exempt; any other node failing the same rule still fails. */
  target: string;
  /** Tracking issue; an exemption without one is not allowed. */
  issue: string;
  reason: string;
}

/**
 * Known, pre-existing serious/critical violations. Each entry must reference an
 * open issue and is removed when that issue is fixed. Never add an entry to make
 * a new regression pass.
 */
const A11Y_ALLOWLIST: AllowlistEntry[] = [
  // Empty. The two #131 colour-contrast entries ("Review" label on
  // /dashboard, "Reject" .btn-destructive on /dashboard/chores) were removed
  // when --warning-text / --danger-fill tokens landed; axe now enforces them.
];

const BLOCKING: Impact[] = ["serious", "critical"];

async function scan(page: Page, testInfo: TestInfo, path: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    // The Next.js route announcer is framework-owned and empty by design.
    .exclude("next-route-announcer")
    .analyze();

  await testInfo.attach(`axe-${path.replace(/\W+/g, "_")}.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });

  const isAllowed = (rule: string, target: string) =>
    A11Y_ALLOWLIST.some(
      (a) =>
        a.rule === rule &&
        a.target === target &&
        (a.page === "*" || a.page === path),
    );

  const blocking = results.violations
    .filter((v) => BLOCKING.includes(v.impact as Impact))
    .map((v) => ({
      ...v,
      nodes: v.nodes.filter((n) => !isAllowed(v.id, n.target.join(" "))),
    }))
    .filter((v) => v.nodes.length > 0);

  const summary = blocking.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 5).map((n) => ({
      target: n.target.join(" "),
      // First line of axe's explanation, e.g. the measured contrast ratio.
      why: (n.failureSummary ?? "").split("\n").slice(1, 2).join("").trim(),
    })),
  }));
  expect(summary, `serious/critical axe violations on ${path}`).toEqual([]);
}

async function settle(page: Page) {
  await expect(page.locator("body")).toBeVisible();
  // Let client components hydrate and fetch before scanning.
  await page.waitForLoadState("load");
  await page.waitForTimeout(500);
}

test.describe("a11y: signed out", () => {
  test("login", async ({ page }, testInfo) => {
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "Welcome Back" }),
    ).toBeVisible();
    await settle(page);
    await scan(page, testInfo, "/login");
  });
});

test.describe("a11y: Family A parent", () => {
  test.use({ storageState: authFile("parentA") });

  for (const path of [
    "/dashboard",
    "/dashboard/chores",
    "/dashboard/calendar",
  ]) {
    test(path, async ({ page }, testInfo) => {
      await page.goto(path);
      await expect(page.locator("#main-content")).toBeVisible();
      await settle(page);
      await scan(page, testInfo, path);
    });
  }

  test("/dashboard (dark)", async ({ page }, testInfo) => {
    await useStoredTheme(page, "dark");
    await page.goto("/dashboard");
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await settle(page);
    await scan(page, testInfo, "/dashboard (dark)");
  });
});

test.describe("a11y: Family A child", () => {
  test.use({ storageState: authFile("childA") });

  test("kid home", async ({ page }, testInfo) => {
    await page.goto("/dashboard");
    await expect(
      page.locator("#main-content").getByText("Hi, Casey Fixture-A!"),
    ).toBeVisible();
    await settle(page);
    await scan(page, testInfo, "/dashboard (kid)");
  });
});
