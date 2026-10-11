/**
 * Budget recovery journey.
 *
 * The parent session and mounted budget route are real fixture surfaces. The
 * stats, category and transaction transports are explicitly synthetic and
 * intercepted in the browser, so this spec never reads or writes private
 * financial rows. Unknown state-changing API requests are blocked.
 */
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { budgetMessages } from "../src/i18n/budget";
import { FIXTURE_EMAILS, FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { authFile } from "./support/env";
import { expect, test } from "./support/test";

const PROJECTS = [
  "phone-390x844",
  "phone-430x932",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
  "tablet-large-1920x1200",
  "desktop-1366x768",
] as const;

const SYNTHETIC_CATEGORY = {
  id: "fx_e2e_budget_food",
  name: "Synthetic Food",
  icon: "F",
  color: "#6B7280",
  type: "expense",
  budget_limit: 500,
};

const SYNTHETIC_TRANSACTION = {
  id: "fx_e2e_budget_saved",
  amount: 42,
  type: "expense",
  description: "Synthetic saved budget row",
  notes: null,
  category_id: SYNTHETIC_CATEGORY.id,
  date: "2026-01-05T00:00:00.000Z",
  is_recurring: false,
  recurring_interval: null,
  category: {
    id: SYNTHETIC_CATEGORY.id,
    name: SYNTHETIC_CATEGORY.name,
    icon: SYNTHETIC_CATEGORY.icon,
    color: SYNTHETIC_CATEGORY.color,
  },
  user: {
    id: FIXTURE_IDS.familyA.parent,
    name: "Avery Fixture-A",
    avatar_url: null,
  },
};

const RECOVERED_TRANSACTION = {
  ...SYNTHETIC_TRANSACTION,
  id: "fx_e2e_budget_recovered",
  description: "Synthetic recovered budget row",
};

const FRESH_TRANSACTION = {
  ...SYNTHETIC_TRANSACTION,
  id: "fx_e2e_budget_fresh",
  description: "Synthetic post-save budget row",
};

function statsWith(transaction: typeof SYNTHETIC_TRANSACTION) {
  return {
    month: "2026-01",
    total_income: 1000,
    total_expenses: transaction.amount,
    balance: 1000 - transaction.amount,
    budget_limit: 500,
    category_breakdown: [
      {
        category_id: SYNTHETIC_CATEGORY.id,
        name: SYNTHETIC_CATEGORY.name,
        icon: SYNTHETIC_CATEGORY.icon,
        color: SYNTHETIC_CATEGORY.color,
        budget_limit: SYNTHETIC_CATEGORY.budget_limit,
        total: transaction.amount,
        percentage: 100,
      },
    ],
    recent_transactions: [transaction],
    monthly_trend: [
      {
        month: "2026-01",
        income: 1000,
        expenses: transaction.amount,
      },
    ],
  };
}

function sourceHead() {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  expect(head).toMatch(/^[a-f0-9]{40}$/);
  return head;
}

function sourceTree() {
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();
  expect(tree).toMatch(/^[a-f0-9]{40}$/);
  const configured = process.env.E2E_BUDGET_BUILD_TREE?.trim();
  if (configured) expect(configured).toBe(tree);
  return tree;
}

function builtAt() {
  const route = fs.readFileSync(
    ".next/server/app/api/version/route.js",
    "utf8",
  );
  const values = [
    ...new Set(route.match(/20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g) ?? []),
  ];
  expect(values).toHaveLength(1);
  return values[0]!;
}

async function runtimeIdentity(
  page: Page,
  info: TestInfo,
  locale: "en" | "es",
) {
  const head = sourceHead();
  expect(() =>
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "prisma"], {
      stdio: "ignore",
    }),
  ).not.toThrow();
  const releaseSha = process.env.RELEASE_SHA?.trim();
  if (releaseSha) expect(releaseSha).toBe(head);

  const tree = sourceTree();
  const response = await page.request.get("/api/version");
  expect(response.status(), await response.text()).toBe(200);
  const runtime = (await response.json()) as {
    commit: string;
    builtAt: string;
  };
  expect(runtime.commit).toBe(head);
  expect(runtime.builtAt).toBe(builtAt());

  const meResponse = await page.request.get("/api/auth/me");
  expect(meResponse.status(), await meResponse.text()).toBe(200);
  const me = (await meResponse.json()) as {
    user?: { id?: string; email?: string; role?: string };
  };
  expect(me.user?.id).toBe(FIXTURE_IDS.familyA.parent);
  expect(me.user?.email).toBe(FIXTURE_EMAILS.familyA.parent);
  expect(me.user?.role).toBe("parent");

  const proof = {
    runtime,
    buildId: fs.readFileSync(".next/BUILD_ID", "utf8").trim(),
    buildTree: tree,
    locale,
    role: me.user?.role,
    fixtureUser: me.user?.id,
    scope:
      "real Family A parent route; synthetic stats/categories/transaction responses; unknown writes blocked; no durable financial writes",
  };
  expect(proof.buildId).not.toBe("");
  await info.attach("budget-runtime-identity", {
    body: JSON.stringify(proof),
    contentType: "application/json",
  });
}

async function assertTouchTarget(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  const viewport = page.viewportSize();
  expect(box).toBeTruthy();
  expect(viewport).toBeTruthy();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
}

async function assertAccessibleAndContained(
  page: Page,
  info: TestInfo,
  label: string,
) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const violations = (
    await new AxeBuilder({ page })
      .include("#main-content")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  await info.attach(`${label}-accessibility`, {
    body: JSON.stringify({ label, violations }),
    contentType: "application/json",
  });
  expect(violations).toEqual([]);
}

type BudgetHarness = {
  statsCalls: number;
  categoryCalls: number;
  transactionPosts: number;
  unexpectedWrites: string[];
  pendingStats: HeldRequest | null;
  pendingPost: HeldRequest | null;
};

type HeldRequest = {
  release: () => void;
  complete: Promise<void>;
};

async function installSyntheticTransport(
  page: Page,
  context: BrowserContext,
): Promise<BudgetHarness> {
  const state: BudgetHarness = {
    statsCalls: 0,
    categoryCalls: 0,
    transactionPosts: 0,
    unexpectedWrites: [],
    pendingStats: null,
    pendingPost: null,
  };

  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      !["data:", "blob:"].includes(url.protocol)
    ) {
      await route.abort();
      return;
    }
    const method = route.request().method();
    if (
      url.pathname.startsWith("/api/") &&
      ["POST", "PATCH", "PUT", "DELETE"].includes(method) &&
      !(url.pathname === "/api/budget/transactions" && method === "POST")
    ) {
      state.unexpectedWrites.push(`${method} ${url.pathname}`);
      await route.abort();
      return;
    }
    await route.continue();
  });

  await page.route("**/api/budget/stats*", async (route) => {
    state.statsCalls += 1;
    switch (state.statsCalls) {
      case 1:
        await route.fulfill({
          status: 200,
          json: statsWith(SYNTHETIC_TRANSACTION),
        });
        return;
      case 2:
        // Synthetic malformed 200: the saved row must remain visible.
        await route.fulfill({ status: 200, json: { month: "2026-01" } });
        return;
      case 3:
        await route.fulfill({
          status: 503,
          json: { error: "synthetic upstream failure" },
        });
        return;
      case 4:
        await route.fulfill({
          status: 200,
          json: statsWith(RECOVERED_TRANSACTION),
        });
        return;
      case 5:
        {
          let release!: () => void;
          let complete!: () => void;
          const released = new Promise<void>((resolve) => {
            release = resolve;
          });
          const completed = new Promise<void>((resolve) => {
            complete = resolve;
          });
          state.pendingStats = { release, complete: completed };
          try {
            await released;
            await route.fulfill({
              status: 200,
              json: statsWith(RECOVERED_TRANSACTION),
            });
          } finally {
            state.pendingStats = null;
            complete();
          }
        }
        return;
      case 6:
        await route.fulfill({
          status: 200,
          json: statsWith(FRESH_TRANSACTION),
        });
        return;
      default:
        await route.fulfill({
          status: 200,
          json: statsWith(FRESH_TRANSACTION),
        });
    }
  });

  await page.route("**/api/budget/categories*", async (route) => {
    if (route.request().method() !== "GET") {
      state.unexpectedWrites.push(
        `${route.request().method()} ${route.request().url()}`,
      );
      await route.abort();
      return;
    }
    state.categoryCalls += 1;
    if (state.categoryCalls === 1) {
      await route.fulfill({
        status: 503,
        json: { error: "synthetic category service failure" },
      });
      return;
    }
    await route.fulfill({
      status: 200,
      json: { categories: [SYNTHETIC_CATEGORY] },
    });
  });

  await page.route("**/api/budget/transactions", async (route) => {
    if (route.request().method() !== "POST") {
      state.unexpectedWrites.push(
        `${route.request().method()} ${route.request().url()}`,
      );
      await route.abort();
      return;
    }
    state.transactionPosts += 1;
    if (state.transactionPosts === 1) {
      await route.fulfill({
        status: 201,
        json: { transaction: { id: "fx_e2e_budget_created" } },
      });
      return;
    }
    if (state.transactionPosts === 3) {
      let release!: () => void;
      let complete!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const completed = new Promise<void>((resolve) => {
        complete = resolve;
      });
      state.pendingPost = { release, complete: completed };
      try {
        await released;
      } finally {
        state.pendingPost = null;
        complete();
      }
    }
    await route.fulfill({
      status: 409,
      json: {
        error: {
          code: "IDENTITY_CONFLICT",
          message: "synthetic private financial implementation detail",
        },
      },
    });
  });

  return state;
}

async function disposeSyntheticTransport(
  page: Page,
  context: BrowserContext,
  state: BudgetHarness,
) {
  const held = [state.pendingStats, state.pendingPost].filter(
    (request): request is HeldRequest => request !== null,
  );
  for (const request of held) request.release();
  await Promise.all(held.map((request) => request.complete));
  await Promise.allSettled([
    page.unroute("**/api/budget/stats*"),
    page.unroute("**/api/budget/categories*"),
    page.unroute("**/api/budget/transactions"),
    context.unroute("**/*"),
  ]);
}

test.use({ storageState: authFile("parentA"), timezoneId: "America/Toronto" });

for (const locale of ["en", "es"] as const) {
  test.describe(`${locale} budget recovery`, () => {
    test.use({ colorScheme: locale === "en" ? "light" : "dark" });

    test(`${locale}: saved budget recovery and protected transaction draft`, async ({
      page,
      context,
      baseURL,
    }, info) => {
      test.skip(
        !PROJECTS.includes(info.project.name as (typeof PROJECTS)[number]),
        "Budget recovery runs at the six representative responsive sizes",
      );
      assertFixtureTargetAllowed(process.env);
      expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
        new URL(baseURL!).hostname,
      );

      await page.addInitScript(
        ({ key, value }) => localStorage.setItem(key, value),
        { key: LOCALE_STORAGE_KEY, value: locale },
      );
      const harness = await installSyntheticTransport(page, context);

      try {
        await page.goto("/dashboard/budget");
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(
          page
            .locator("#main-content")
            .getByRole("heading", { name: "Budget" }),
        ).toBeVisible();
        await runtimeIdentity(page, info, locale);

        const copy = budgetMessages[locale];
        const refresh = page.locator('button[aria-label="Refresh budget"]');
        const refreshRecovery = page
          .locator("#main-content")
          .getByRole("alert")
          .filter({ hasText: copy.refreshFailed });
        await refresh.click();
        await expect(
          page.getByText(SYNTHETIC_TRANSACTION.description),
        ).toBeVisible();
        await expect.poll(() => harness.statsCalls).toBe(1);

        // A malformed successful response and an ordinary failed refresh both
        // preserve the last known good financial row and expose retry UI.
        await refresh.click();
        await expect(refreshRecovery).toContainText(copy.refreshFailed);
        await expect(
          page.getByText(SYNTHETIC_TRANSACTION.description),
        ).toBeVisible();
        await expect.poll(() => harness.statsCalls).toBe(2);

        await refresh.click();
        await expect(refreshRecovery).toContainText(copy.refreshFailed);
        await expect(
          page.getByText(SYNTHETIC_TRANSACTION.description),
        ).toBeVisible();
        await expect.poll(() => harness.statsCalls).toBe(3);

        await page.getByRole("button", { name: copy.retryRefresh }).click();
        await expect(
          page.getByText(RECOVERED_TRANSACTION.description),
        ).toBeVisible();
        await expect(
          page.getByText(SYNTHETIC_TRANSACTION.description),
        ).toHaveCount(0);
        await expect.poll(() => harness.statsCalls).toBe(4);

        // Keep an older stats response open, then complete a synthetic save. The
        // dashboard must queue a second refresh instead of accepting the stale
        // response that was already in flight.
        await refresh.click();
        await expect.poll(() => harness.statsCalls).toBe(5);
        await expect(
          page.locator('button[aria-label="Refreshing budget"]'),
        ).toBeDisabled();

        await page.locator('button[aria-label="Add transaction"]').click();
        const dialog = page.getByRole("dialog", { name: "Add Transaction" });
        await expect(dialog).toBeVisible();
        await expect.poll(() => harness.categoryCalls).toBe(1);
        await expect(dialog.getByRole("alert")).toContainText(
          copy.categoriesUnavailable,
        );
        const retryCategories = dialog.getByRole("button", {
          name: copy.retryCategories,
        });
        await assertTouchTarget(page, retryCategories);
        await retryCategories.click();
        await expect(
          dialog.getByRole("option", { name: /Synthetic Food/ }),
        ).toBeVisible();
        await dialog
          .getByRole("combobox", { name: "Category" })
          .selectOption(SYNTHETIC_CATEGORY.id);
        await dialog.getByLabel("Amount").fill("25");
        await dialog.getByLabel("Description").fill("Synthetic queued save");

        const submit = dialog.getByRole("button", { name: "Add Transaction" });
        const cancel = dialog.getByRole("button", { name: "Cancel" });
        await assertTouchTarget(page, submit);
        await assertTouchTarget(page, cancel);
        await assertAccessibleAndContained(
          page,
          info,
          `${locale}-${info.project.name}-form`,
        );
        await submit.click();
        await expect.poll(() => harness.transactionPosts).toBe(1);
        await expect(dialog).toHaveCount(0);
        expect(harness.pendingStats).toBeTruthy();
        harness.pendingStats!.release();
        await expect.poll(() => harness.statsCalls).toBe(6);
        await expect(
          page.getByText(FRESH_TRANSACTION.description),
        ).toBeVisible();

        // A structured error envelope cannot leak its code/message, and the
        // failed save keeps the user's draft available for correction/retry.
        await page.locator('button[aria-label="Add transaction"]').click();
        const recoveryDialog = page.getByRole("dialog", {
          name: "Add Transaction",
        });
        await expect(
          recoveryDialog.getByRole("option", { name: /Synthetic Food/ }),
        ).toBeVisible();
        await recoveryDialog.getByLabel("Amount").fill("50");
        await recoveryDialog
          .getByLabel("Description")
          .fill("Synthetic draft to preserve");
        await recoveryDialog
          .getByRole("button", { name: "Add Transaction" })
          .click();
        const saveError = recoveryDialog.getByRole("alert");
        await expect(saveError).toContainText(copy.saveFailed);
        await expect(saveError).not.toContainText("IDENTITY_CONFLICT");
        await expect(saveError).not.toContainText(
          "synthetic private financial implementation detail",
        );
        await expect(recoveryDialog.getByLabel("Amount")).toHaveValue("50");
        await expect(recoveryDialog.getByLabel("Description")).toHaveValue(
          "Synthetic draft to preserve",
        );

        // The next synthetic request stays pending. Escape and Cancel must not
        // dismiss the sheet or lose its draft while the mutation is unresolved.
        await recoveryDialog.getByLabel("Amount").fill("60");
        await recoveryDialog
          .getByRole("button", { name: "Add Transaction" })
          .click();
        await expect.poll(() => harness.transactionPosts).toBe(3);
        await expect(
          recoveryDialog.getByRole("button", { name: "Cancel" }),
        ).toBeDisabled();
        await expect(
          recoveryDialog.getByRole("button", { name: "Add Transaction" }),
        ).toBeDisabled();
        await expect(recoveryDialog.getByLabel("Close")).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(recoveryDialog).toBeVisible();
        await expect(recoveryDialog.getByLabel("Amount")).toHaveValue("60");
        expect(harness.pendingPost).toBeTruthy();
        harness.pendingPost!.release();
        await expect(recoveryDialog.getByRole("alert")).toContainText(
          copy.saveFailed,
        );
        await expect(recoveryDialog.getByLabel("Description")).toHaveValue(
          "Synthetic draft to preserve",
        );
        await assertAccessibleAndContained(
          page,
          info,
          `${locale}-${info.project.name}-recovered`,
        );
        await expect(harness.unexpectedWrites).toEqual([]);
      } finally {
        await disposeSyntheticTransport(page, context, harness);
      }
    });
  });
}
