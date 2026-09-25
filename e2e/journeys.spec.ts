/**
 * Browser journeys (#155): login, role gates, household isolation, logout.
 * Data: the #154 fixture households, seeded by e2e/global-setup.ts.
 */
import type { Page } from "@playwright/test";
import {
  buildFixtureDataset,
  FIXTURE_EMAILS,
  FIXTURE_IDS,
  FIXTURE_LONG_TEXT,
} from "../src/lib/fixtures/dataset";
import { authFile, E2E_ANCHOR } from "./support/env";
import { delayRoute, goOffline, goOnline } from "./support/network";
import { browserFetch, expect, loginViaUi, test } from "./support/test";

/** Titles that exist only in Family B. None may ever render for Family A. */
const FAMILY_B_ONLY = [
  "Blair Fixture-B",
  "Family B dentist",
  "Water the plants",
  "Family B movie night",
  "Family B to-dos",
  "Book car service",
  "Family B shopping",
  "Printer ink (Family B)",
  "Light bulbs (Family B)",
];
/** Titles that exist only in Family A. */
const FAMILY_A_ONLY = [
  "Avery Fixture-A",
  "Take out recycling",
  "Dentist (Casey)",
  "Weekend to-dos",
  "Mow the lawn",
  "Groceries",
  "Cheddar cheese",
  "Dish soap",
];

/** Dashboard Shopping card size (getOpenShoppingItems default limit). */
const SHOPPING_CARD_LIMIT = 5;

/**
 * Open items of a family's grocery/shopping lists in the order the dashboard
 * Shopping card shows them (oldest first, then id), as rendered titles.
 */
function openShoppingTitles(familyId: string) {
  const ds = buildFixtureDataset(E2E_ANCHOR);
  const lists = new Set(
    ds.lists
      .filter(
        (l) =>
          l.family_id === familyId &&
          (l.type === "grocery" || l.type === "shopping"),
      )
      .map((l) => l.id),
  );
  return ds.listItems
    .filter((i) => lists.has(i.list_id) && !i.checked)
    .sort(
      (a, b) =>
        (a.created_at as Date).getTime() - (b.created_at as Date).getTime() ||
        a.id.localeCompare(b.id),
    )
    .map((i) =>
      (i.quantity ?? 1) > 1 ? `${i.content} × ${i.quantity}` : i.content,
    );
}

function shoppingCard(page: Page) {
  return page.locator("#main-content section").filter({
    has: page.locator("p.section-header", { hasText: /^Shopping$/ }),
  });
}

/** The routes middleware must bounce a child/teen away from (src/lib/kid-access.ts). */
const PARENT_ONLY_ROUTES = [
  "/dashboard/budget",
  "/dashboard/locations",
  "/dashboard/allowance",
  "/dashboard/settings",
  "/dashboard/chores",
  "/dashboard/family",
];

test.describe("signed out", () => {
  test("protected route redirects to login with a return path", async ({
    page,
  }) => {
    await page.goto("/dashboard/chores");
    await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard%2Fchores$/);
    await expect(
      page.getByRole("heading", { name: "Welcome Back" }),
    ).toBeVisible();
  });

  test("wrong password shows an error and stays on login", async ({ page }) => {
    await loginViaUi(
      page,
      FIXTURE_EMAILS.familyA.parent,
      "not-the-fixture-password",
    );
    // Scoped to the form: Next.js also renders an (empty) role=alert route announcer.
    await expect(page.locator("form").getByRole("alert")).toHaveText(
      "Invalid email or password",
    );
    await expect(page).toHaveURL(/\/login$/);
  });

  test("offline sign-in shows a recoverable error", async ({ page }) => {
    await page.goto("/login");
    await goOffline(page);
    await page.getByLabel("Email").fill(FIXTURE_EMAILS.familyA.parent);
    await page.getByLabel("Password", { exact: true }).fill("any-password");
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page.locator("form").getByRole("alert")).toHaveText(
      "An unexpected error occurred",
    );
    await goOnline(page);
    await expect(page.getByRole("button", { name: "Sign In" })).toBeEnabled();
  });

  test("slow sign-in shows a busy state", async ({ page }) => {
    await delayRoute(page, "**/api/auth/login", 1_500);
    await loginViaUi(page, FIXTURE_EMAILS.familyA.parent);
    await expect(
      page.getByRole("button", { name: "Signing in..." }),
    ).toBeDisabled();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("parent logs in through the form and sees real Family A data", async ({
    page,
  }) => {
    await loginViaUi(page, FIXTURE_EMAILS.familyA.parent);
    await expect(page).toHaveURL(/\/dashboard$/);

    const main = page.locator("#main-content");
    // Server clock (E2E_SERVER_NOW) and browser clock both sit on the anchor.
    await expect(main.getByText("Monday, January 5")).toBeVisible();
    await expect(
      main.getByText("Avery Fixture-A", { exact: true }).first(),
    ).toBeAttached();
    // "My chores" is scoped to the signed-in parent, who has none assigned;
    // the progress card counts the household's chores due today.
    await expect(main.getByText("All done for today!")).toBeVisible();
    await expect(main.getByText("Take out recycling")).toHaveCount(0);
    await expect(main.getByText(/^\d+ of \d+ done today$/)).toBeVisible();
    // Seeded "upcoming" events from the busy household.
    await expect(main.getByText("Dentist (Casey)")).toBeVisible();
    await expect(main.getByText("Soccer practice")).toBeVisible();
    // Budget card: real month totals; the fixtures set no category limits.
    await expect(main.getByText("Budget this month")).toBeVisible();
    await expect(main.getByText("No budget set")).toBeVisible();
    // Completed-but-unverified chore lands in the parent review queue.
    await expect(main.getByText("Unload dishwasher")).toBeVisible();
  });
});

test.describe("Family A parent", () => {
  test.use({ storageState: authFile("parentA") });

  test("chores page lists fixture chores and the verification queue", async ({
    page,
  }) => {
    await page.goto("/dashboard/chores");
    const main = page.locator("#main-content");
    await expect(
      main.getByRole("heading", { name: "Chores", level: 1 }),
    ).toBeVisible();
    // Due dates are UTC-midnight date-only values. In America/Toronto the
    // "Today" filter must not pull in tomorrow's chore (it used to, because the
    // date was parsed in local time and landed on the previous evening).
    await expect(
      main.getByText("Taylor Fixture-A · Today").first(),
    ).toBeVisible();
    await expect(main.getByText("Pack school bag")).toHaveCount(0);
    await main.getByRole("button", { name: "Week", exact: true }).click();
    await expect(main.getByText("Pack school bag")).toBeVisible();
    await expect(main.getByText("Casey Fixture-A · Tomorrow")).toBeVisible();
    await expect(main.getByText("Unload dishwasher")).toBeVisible();
  });

  test("calendar shows the anchor month and fixture events", async ({
    page,
  }) => {
    await page.goto("/dashboard/calendar");
    const main = page.locator("#main-content");
    await expect(main.getByText("January 2026")).toBeVisible();
    await expect(main.getByText("School drop-off")).toBeVisible();
    await expect(main.getByText(FIXTURE_LONG_TEXT.eventTitle)).toBeVisible();
  });

  test("parent-only budget page is reachable", async ({ page }) => {
    await page.goto("/dashboard/budget");
    await expect(page).toHaveURL(/\/dashboard\/budget$/);
    await expect(
      page.locator("#main-content").getByRole("heading", { name: "Budget" }),
    ).toBeVisible();
  });

  test("never renders Family B records on shared pages", async ({ page }) => {
    for (const path of [
      "/dashboard",
      "/dashboard/chores",
      "/dashboard/calendar",
      "/dashboard/lists",
    ]) {
      await page.goto(path);
      await expect(page.locator("#main-content")).toBeVisible();
      const text = await page.locator("body").innerText();
      for (const title of FAMILY_B_ONLY) {
        expect(text, `${path} leaked "${title}"`).not.toContain(title);
      }
    }
  });

  test("dashboard Shopping card shows open grocery items and links to the list", async ({
    page,
  }) => {
    const open = openShoppingTitles(FIXTURE_IDS.familyA.family);
    expect(open.length).toBeGreaterThan(SHOPPING_CARD_LIMIT);
    const shown = open.slice(0, SHOPPING_CARD_LIMIT);
    const hidden = open.slice(SHOPPING_CARD_LIMIT);

    await page.goto("/dashboard");
    const card = shoppingCard(page);
    await expect(card).toHaveCount(1);
    // Oldest open items first; quantity > 1 renders as "× n".
    await expect(card.getByRole("link")).toHaveCount(shown.length + 1);
    for (const [i, title] of shown.entries()) {
      const row = card.getByRole("link").nth(i);
      await expect(row).toContainText(title);
      await expect(row).toContainText("Groceries");
      await expect(row).toHaveAttribute(
        "href",
        `/dashboard/lists/${FIXTURE_IDS.familyA.groceryList}`,
      );
    }
    expect(shown).toContain("Milk × 2");
    expect(shown).toContain(FIXTURE_LONG_TEXT.groceryItem);
    // Items past the limit collapse into one "N more to buy" row.
    for (const title of hidden) {
      await expect(card.getByText(title, { exact: true })).toHaveCount(0);
    }
    const more = card.getByRole("link", {
      name: `${hidden.length} more to buy`,
    });
    await expect(more).toBeVisible();
    await expect(more).toHaveAttribute("href", "/dashboard/lists");
    // Checked items and the other household's items never appear.
    for (const title of [
      "Coffee beans",
      "Olive oil",
      ...openShoppingTitles(FIXTURE_IDS.familyB.family),
    ]) {
      await expect(card.getByText(title)).toHaveCount(0);
    }

    // The item row opens its list.
    await card.getByRole("link").first().click();
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/lists/${FIXTURE_IDS.familyA.groceryList}$`),
    );
    const main = page.locator("#main-content");
    await expect(main.getByText("Cheddar cheese")).toBeVisible();
    await expect(main.getByText(hidden[0])).toBeVisible();
  });

  test("own list shows its seeded items", async ({ page }) => {
    await page.goto(`/dashboard/lists/${FIXTURE_IDS.familyA.list}`);
    const main = page.locator("#main-content");
    await expect(main.getByText("Return library books")).toBeVisible();
    await expect(main.getByText("No items yet")).toHaveCount(0);
  });

  test("Family B list id in the URL does not expose its items", async ({
    page,
  }) => {
    await page.goto(`/dashboard/lists/${FIXTURE_IDS.familyB.list}`);
    await expect(page.locator("body")).not.toContainText("Book car service");
    await expect(page.locator("body")).not.toContainText("Family B to-dos");
  });

  test("collection APIs return no Family B rows", async ({ page }) => {
    await page.goto("/dashboard");
    for (const path of [
      "/api/chores",
      "/api/events",
      "/api/lists",
      "/api/rewards",
    ]) {
      const { status, body } = await browserFetch(page, path);
      expect(status, `${path} status`).toBe(200);
      expect(body, path).not.toContain(FIXTURE_IDS.familyB.family);
      for (const id of [
        FIXTURE_IDS.familyB.chore,
        FIXTURE_IDS.familyB.event,
        FIXTURE_IDS.familyB.list,
        FIXTURE_IDS.familyB.reward,
      ]) {
        expect(body, `${path} leaked ${id}`).not.toContain(id);
      }
    }
  });
});

test.describe("sign out", () => {
  // Logout bumps the user's token_version, revoking every session of that user.
  // Use an account whose session is not shared through e2e/.auth storage state.
  test("ends the session and revokes the old cookie", async ({
    page,
    context,
  }) => {
    await loginViaUi(page, FIXTURE_EMAILS.familyA.teen);
    await expect(page).toHaveURL(/\/dashboard$/);
    const oldSession = (await context.cookies()).find(
      (c) => c.name === "session_token",
    );
    expect(oldSession).toBeTruthy();

    await page.getByRole("button", { name: "User menu" }).click();
    await page.getByRole("button", { name: "Sign Out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard$/);

    // Replaying the pre-logout cookie no longer authenticates.
    await context.addCookies([oldSession!]);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard$/);
  });
});

test.describe("Family B parent", () => {
  test.use({ storageState: authFile("parentB") });

  test("sees only its own sparse household", async ({ page }) => {
    await page.goto("/dashboard");
    const main = page.locator("#main-content");
    // Water the plants is the teen's chore: not in the parent's "My chores",
    // but listed on the household chores page.
    await expect(main.getByText("All done for today!")).toBeVisible();
    let text = await page.locator("body").innerText();
    for (const title of FAMILY_A_ONLY) {
      expect(text, `Family B dashboard leaked "${title}"`).not.toContain(title);
    }
    // Shopping card: B's single open item, no overflow row, nothing from A.
    const card = shoppingCard(page);
    const open = openShoppingTitles(FIXTURE_IDS.familyB.family);
    expect(open).toEqual(["Printer ink (Family B)"]);
    await expect(card.getByRole("link")).toHaveCount(1);
    await expect(card.getByRole("link").first()).toContainText(open[0]);
    await expect(card.getByRole("link").first()).toHaveAttribute(
      "href",
      `/dashboard/lists/${FIXTURE_IDS.familyB.shoppingList}`,
    );
    await expect(card.getByText(/more to buy$/)).toHaveCount(0);
    await expect(card.getByText("Light bulbs (Family B)")).toHaveCount(0);
    for (const title of openShoppingTitles(FIXTURE_IDS.familyA.family)) {
      await expect(card.getByText(title)).toHaveCount(0);
    }

    await page.goto("/dashboard/chores");
    await expect(
      page.locator("#main-content").getByText("Water the plants"),
    ).toBeVisible();
    text = await page.locator("body").innerText();
    for (const title of FAMILY_A_ONLY) {
      expect(text, `Family B chores page leaked "${title}"`).not.toContain(
        title,
      );
    }
  });
});

test.describe("Family A child", () => {
  test.use({ storageState: authFile("childA") });

  test("lands on the kid home with only their own missions", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    const main = page.locator("#main-content");
    await expect(main.getByText("Hi, Casey Fixture-A!")).toBeVisible();
    await expect(main.getByText("Tidy bedroom")).toBeVisible();
    await expect(main.getByText("Pack school bag")).toBeVisible();
    // The teen's chores and parent-only panels are not on a child's home.
    await expect(main.getByText("Take out recycling")).toHaveCount(0);
    await expect(main.getByText("Budget this month")).toHaveCount(0);
    await expect(
      main.getByText("Needs your review", { exact: false }),
    ).toHaveCount(0);
  });

  for (const route of PARENT_ONLY_ROUTES) {
    test(`is redirected away from ${route}`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(
        page.locator("#main-content").getByText("Hi, Casey Fixture-A!"),
      ).toBeVisible();
    });
  }

  test("nav hides links the child would be redirected away from", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(
      page.locator("#main-content").getByText("Hi, Casey Fixture-A!"),
    ).toBeVisible();
    for (const path of [
      "/dashboard/calendar",
      "/dashboard/lists",
      "/dashboard/family",
    ]) {
      await expect(page.locator(`nav a[href="${path}"]`)).toHaveCount(0);
    }
    await expect(
      page.locator('nav a[href="/dashboard/emergency"]').first(),
    ).toBeAttached();
  });

  test("kid-allowlisted emergency page stays reachable", async ({ page }) => {
    await page.goto("/dashboard/emergency");
    await expect(page).toHaveURL(/\/dashboard\/emergency$/);
  });

  test("parent-only APIs refuse a direct request", async ({ page }) => {
    await page.goto("/dashboard");
    for (const path of ["/api/budget/transactions", "/api/budget/stats"]) {
      const { status } = await browserFetch(page, path);
      expect(status, path).toBe(403);
    }
  });
});
