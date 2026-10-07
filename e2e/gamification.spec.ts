/**
 * Points, streaks and the leaderboard as a family setting (#248).
 *
 * A Family A parent turns "Points & streaks" off in Features settings. Then,
 * for the parent, the teen and the child, no XP / level / streak / points UI
 * is shown on the dashboard (parent home and kid home) or the chores page, no
 * such value is in the HTML or its RSC payload, the leaderboard (analytics)
 * and rewards APIs refuse, and the rewards page shows its off state. Turning
 * it back on restores the XP UI.
 *
 * Fixture households model existing households, so they start with the
 * setting ON (src/lib/fixtures/dataset.ts FIXTURE_FEATURES). The flag is put
 * back afterwards, and the global seed restores it on every run anyway.
 * Runs in one project only: it is a data/privacy check, not a layout check.
 */
import type { Browser, Page } from "@playwright/test";
import pg from "pg";
import {
  FIXTURE_EMAILS,
  FIXTURE_FEATURES,
  FIXTURE_IDS,
  FIXTURE_PASSWORD,
} from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { E2E_ANCHOR, E2E_BASE_URL, authFile } from "./support/env";
import { browserFetch, expect, test } from "./support/test";

const A = FIXTURE_IDS.familyA;
const PROJECT = "desktop-1366x768";
type Who = "parentA" | "teenA" | "childA";
const ROLES: Who[] = ["parentA", "teenA", "childA"];

/**
 * A gamification value in JSON: `"xp":`, or `\"xp\":` inside the RSC payload
 * strings. Keys only, so text like "Level" in unrelated copy cannot match.
 */
const GAMIFICATION_KEY =
  /\\?"(xp|level|streak|best_streak|bestStreak|last_chore_date|points)\\?":/;
/** Visible gamification copy. */
const GAMIFICATION_TEXT =
  /\bXP\b|Level \d|XP to go|points to go|\d+ more points|Leaderboard|day streak/;

async function withDb<T>(fn: (db: pg.Client) => Promise<T>): Promise<T> {
  assertFixtureTargetAllowed(process.env);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

async function storedFlag(): Promise<unknown> {
  return withDb(async (db) => {
    const res = await db.query(
      `SELECT features->'gamification' AS g FROM "Family" WHERE id = $1`,
      [A.family],
    );
    return res.rows[0]?.g;
  });
}

async function restoreFixtureFlags() {
  await withDb((db) =>
    db.query(`UPDATE "Family" SET features = $1::jsonb WHERE id = $2`, [
      JSON.stringify(FIXTURE_FEATURES),
      A.family,
    ]),
  );
}

/**
 * A signed-in context for `who`. The teen has no stored session: journeys.spec
 * signs the Family A teen out (bumping token_version) in earlier projects, so
 * the teen signs in here through the real endpoint, from its own client address
 * (login rate-limit bucket).
 */
async function openAs(browser: Browser, who: Who) {
  const ctx = await browser.newContext(
    who === "teenA"
      ? {
          baseURL: E2E_BASE_URL,
          extraHTTPHeaders: { "X-Forwarded-For": "198.51.100.248" },
        }
      : { storageState: authFile(who), baseURL: E2E_BASE_URL },
  );
  if (who === "teenA") {
    const res = await ctx.request.post("/api/auth/login", {
      data: { email: FIXTURE_EMAILS.familyA.teen, password: FIXTURE_PASSWORD },
    });
    expect(res.status(), await res.text()).toBe(200);
  }
  const page = await ctx.newPage();
  await page.clock.install({ time: E2E_ANCHOR });
  return { ctx, page };
}

/** Raw server HTML (includes the inline RSC payload) for a path. */
async function rawHtml(page: Page, path: string): Promise<string> {
  const res = await page.request.get(path);
  expect(res.status(), path).toBe(200);
  return res.text();
}

async function setFlagViaSettings(page: Page, on: boolean) {
  await page.goto("/dashboard/features");
  const toggle = page.getByRole("switch", {
    name: `${on ? "Enable" : "Disable"} Points & streaks`,
  });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(
    page.getByRole("switch", {
      name: `${on ? "Disable" : "Enable"} Points & streaks`,
    }),
  ).toHaveAttribute("aria-checked", String(on));
  await expect.poll(storedFlag).toBe(on);
}

/** Open the command palette and check whether Rewards/Analytics are offered. */
async function expectPaletteDestinations(page: Page, offered: boolean) {
  await expect(page.locator("#main-content h1").first()).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(
    page.getByPlaceholder("Search or type a command…"),
  ).toBeVisible();
  // Budget is on for the fixture family: proves the list rendered.
  await expect(
    page.getByRole("button", { name: "Budget", exact: true }),
  ).toBeVisible();
  for (const name of ["Rewards", "Analytics"]) {
    await expect(
      page.getByRole("button", { name, exact: true }),
      name,
    ).toHaveCount(offered ? 1 : 0);
  }
  await page.keyboard.press("Escape");
}

test.describe.configure({ mode: "serial" });

test.describe("Points & streaks setting (#248)", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== PROJECT,
      "Data/privacy check; one viewport is enough.",
    );
  });
  test.beforeAll(restoreFixtureFlags);
  test.afterAll(restoreFixtureFlags);

  test("fixture households start with it on (existing households)", async ({
    browser,
  }) => {
    expect(await storedFlag()).toBe(true);
    const { ctx, page } = await openAs(browser, "parentA");
    try {
      // The parent's home is the Today board (#269), which never shows
      // points; the chores page carries them while the setting is on.
      await page.goto("/dashboard/chores");
      await expect(
        page
          .locator("#main-content")
          .getByText(/^\+\d+$/)
          .first(),
      ).toBeVisible();
      expect(await rawHtml(page, "/dashboard/chores")).toMatch(
        GAMIFICATION_KEY,
      );
    } finally {
      await ctx.close();
    }
  });

  test("a teen and a child cannot change it", async ({ browser }) => {
    for (const who of ["teenA", "childA"] as const) {
      const { ctx, page } = await openAs(browser, who);
      try {
        await page.goto("/dashboard");
        const res = await page.evaluate(async () => {
          const csrf =
            document.cookie
              .split("; ")
              .find((c) => c.startsWith("csrf_token="))
              ?.slice("csrf_token=".length) ?? "";
          const r = await fetch("/api/family/features", {
            method: "PATCH",
            credentials: "same-origin",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": csrf,
            },
            body: JSON.stringify({ key: "gamification", enabled: false }),
          });
          return r.status;
        });
        expect(res, who).toBe(403);
        // Features settings is parent-only: kids are sent home.
        await page.goto("/dashboard/features");
        await expect(page).toHaveURL(/\/dashboard$/);
      } finally {
        await ctx.close();
      }
    }
    expect(await storedFlag()).toBe(true);
  });

  test("off: no XP, level, streak, points or leaderboard for any role", async ({
    browser,
  }) => {
    const parent = await openAs(browser, "parentA");
    try {
      await setFlagViaSettings(parent.page, false);
    } finally {
      await parent.ctx.close();
    }

    for (const who of ROLES) {
      const { ctx, page } = await openAs(browser, who);
      try {
        // Dashboard: parent home or kid home.
        await page.goto("/dashboard");
        const main = page.locator("#main-content");
        await expect(main.locator("h1").first()).toBeVisible();
        await expect(main, `${who} dashboard`).not.toContainText(
          GAMIFICATION_TEXT,
        );
        const dashHtml = await rawHtml(page, "/dashboard");
        expect(dashHtml, `${who} dashboard payload`).not.toMatch(
          GAMIFICATION_KEY,
        );

        // The chores page is parent-only; kids see their chores on kid home.
        if (who === "parentA") {
          await page.goto("/dashboard/chores");
          await expect(page.locator("#main-content h1").first()).toBeVisible();
          await expect(page.locator("#main-content")).not.toContainText(
            GAMIFICATION_TEXT,
          );
          await expect(page.locator("#main-content")).not.toContainText(
            /\+\d+\b/,
          );
          expect(await rawHtml(page, "/dashboard/chores")).not.toMatch(
            GAMIFICATION_KEY,
          );

          // Rewards page: the calm off state, no XP balance.
          await page.goto("/dashboard/rewards");
          await expect(page.getByText("Rewards is off")).toBeVisible();
          expect(await rawHtml(page, "/dashboard/rewards")).not.toContain(
            "XP Balance",
          );
        }

        // APIs behind those surfaces.
        for (const path of ["/api/analytics", "/api/rewards"]) {
          expect(
            (await browserFetch(page, path)).status,
            `${who} ${path}`,
          ).toBe(403);
        }
        for (const path of ["/api/auth/me", "/api/users", "/api/chores"]) {
          const res = await browserFetch(page, path);
          expect(res.status, `${who} ${path}`).toBe(200);
          expect(res.body, `${who} ${path}`).not.toMatch(GAMIFICATION_KEY);
        }

        // The command palette no longer offers Rewards or Analytics (parent).
        if (who === "parentA") {
          await page.goto("/dashboard");
          await expectPaletteDestinations(page, false);
        }
      } finally {
        await ctx.close();
      }
    }
  });

  test("chore completion still works while it is off", async ({ browser }) => {
    expect(await storedFlag()).toBe(false);
    const startedAt = new Date();
    const { ctx, page } = await openAs(browser, "teenA");
    try {
      await page.goto("/dashboard");
      const res = await page.evaluate(async (choreId) => {
        const csrf =
          document.cookie
            .split("; ")
            .find((c) => c.startsWith("csrf_token="))
            ?.slice("csrf_token=".length) ?? "";
        const r = await fetch("/api/chores/complete", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: JSON.stringify({ choreId }),
        });
        return { status: r.status, body: await r.text() };
      }, A.chore);
      expect(res.status, res.body).toBe(200);
      expect(res.body).not.toMatch(GAMIFICATION_KEY);
      const status = await withDb(async (db) => {
        const r = await db.query(`SELECT status FROM "Chore" WHERE id = $1`, [
          A.chore,
        ]);
        return r.rows[0]?.status;
      });
      expect(status).toBe("completed");
    } finally {
      await ctx.close();
      // Put the fixture chore back for the specs that run after this one.
      await withDb(async (db) => {
        await db.query(
          `UPDATE "Chore" SET status = 'pending', completed_at = NULL WHERE id = $1`,
          [A.chore],
        );
        await db.query(
          `DELETE FROM "Activity" WHERE family_id = $1 AND user_id = $2 AND type = 'chore_completed' AND created_at >= $3`,
          [A.family, A.teen, startedAt],
        );
      });
    }
  });

  test("turning it back on restores the XP UI", async ({ browser }) => {
    const parent = await openAs(browser, "parentA");
    try {
      await setFlagViaSettings(parent.page, true);
      await parent.page.goto("/dashboard/chores");
      await expect(
        parent.page
          .locator("#main-content")
          .getByText(/^\+\d+$/)
          .first(),
      ).toBeVisible();
      expect(await rawHtml(parent.page, "/dashboard/chores")).toMatch(
        GAMIFICATION_KEY,
      );
      expect((await browserFetch(parent.page, "/api/analytics")).status).toBe(
        200,
      );
      await expectPaletteDestinations(parent.page, true);
    } finally {
      await parent.ctx.close();
    }

    const child = await openAs(browser, "childA");
    try {
      await child.page.goto("/dashboard");
      await expect(
        child.page.locator("#main-content").getByText(/Level \d/),
      ).toBeVisible();
    } finally {
      await child.ctx.close();
    }
  });
});
