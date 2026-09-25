/**
 * Browser journeys (#155): login, role gates, household isolation, logout.
 * Data: the #154 fixture households, seeded by e2e/global-setup.ts.
 */
import {
  FIXTURE_EMAILS,
  FIXTURE_IDS,
  FIXTURE_LONG_TEXT,
} from "../src/lib/fixtures/dataset";
import { authFile } from "./support/env";
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
];
/** Titles that exist only in Family A. */
const FAMILY_A_ONLY = [
  "Avery Fixture-A",
  "Take out recycling",
  "Dentist (Casey)",
  "Weekend to-dos",
  "Mow the lawn",
];

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
    // Seeded chores and "upcoming" events from the busy household.
    await expect(main.getByText("Take out recycling")).toBeVisible();
    await expect(main.getByText("Dentist (Casey)")).toBeVisible();
    await expect(main.getByText("Soccer practice")).toBeVisible();
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
    await expect(main.getByText("Pack school bag")).toBeVisible();
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

  test("sign out ends the browser session", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "User menu" }).click();
    await page.getByRole("button", { name: "Sign Out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard$/);
  });
});

test.describe("Family B parent", () => {
  test.use({ storageState: authFile("parentB") });

  test("sees only its own sparse household", async ({ page }) => {
    await page.goto("/dashboard");
    const main = page.locator("#main-content");
    await expect(main.getByText("Water the plants")).toBeVisible();
    const text = await page.locator("body").innerText();
    for (const title of FAMILY_A_ONLY) {
      expect(text, `Family B dashboard leaked "${title}"`).not.toContain(title);
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
