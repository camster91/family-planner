/**
 * Picture routines for young kids (#272).
 *
 * The Family A child has a three-step "Morning" routine due today (picture
 * cards on the kid home, in step order, the next step highlighted). They tap
 * the pictures in order, Undo one tap on the way, and finish the routine; the
 * parent then sees the three steps waiting for a check on the home and on the
 * chores page, and sends one back (POST /api/chores/verify, decision reject),
 * which reopens it without awarding anything.
 *
 * Spec-owned rows (`fx_e2e_routine_*`): three Morning chores for the child due
 * on the anchor day plus one due tomorrow (must not show), inserted before the
 * file and deleted after it, with the activity and notification rows the
 * journey writes. Nothing is verified, so no XP moves. Runs at 390x844,
 * 800x1280 and 1366x768.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import pg from "pg";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { E2E_ANCHOR, authFile } from "./support/env";
import { expect, test } from "./support/test";

const A = FIXTURE_IDS.familyA;
const PROJECTS = [
  "phone-390x844",
  "tablet-portrait-800x1280",
  "desktop-1366x768",
];
const STEPS = [
  { id: "fx_e2e_routine_1", title: "Brush teeth", icon: "brush-teeth" },
  { id: "fx_e2e_routine_2", title: "Get dressed", icon: "get-dressed" },
  { id: "fx_e2e_routine_3", title: "Pack your backpack", icon: "backpack" },
];
const TOMORROW = {
  id: "fx_e2e_routine_tomorrow",
  title: "Tomorrow's hat",
  icon: "hat",
};
const IDS = [...STEPS.map((s) => s.id), TOMORROW.id];

const utcDay = (offset: number) =>
  new Date(
    Date.UTC(
      E2E_ANCHOR.getUTCFullYear(),
      E2E_ANCHOR.getUTCMonth(),
      E2E_ANCHOR.getUTCDate() + offset,
    ),
  );

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

async function statuses(): Promise<Record<string, string>> {
  return withDb(async (db) => {
    const r = await db.query(
      `SELECT id, status FROM "Chore" WHERE id = ANY($1)`,
      [IDS],
    );
    return Object.fromEntries(r.rows.map((row) => [row.id, row.status]));
  });
}

async function cleanup(db: pg.Client) {
  await db.query(`DELETE FROM "Chore" WHERE id = ANY($1)`, [IDS]);
  for (const s of [...STEPS, TOMORROW]) {
    await db.query(
      `DELETE FROM "Activity" WHERE family_id = $1 AND title LIKE $2`,
      [A.family, `%"${s.title}"%`],
    );
    await db.query(
      `DELETE FROM "Notification" WHERE user_id = $1 AND message LIKE $2`,
      [A.child, `%"${s.title}"%`],
    );
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await withDb(async (db) => {
    await cleanup(db);
    const rows = [
      ...STEPS.map((s, i) => ({ ...s, order: i + 1, day: utcDay(0) })),
      { ...TOMORROW, order: 4, day: utcDay(1) },
    ];
    for (const r of rows) {
      await db.query(
        `INSERT INTO "Chore" (id, family_id, title, points, assigned_to, due_date, status, frequency, difficulty,
           created_by, created_at, icon, routine, routine_order)
         VALUES ($1, $2, $3, 10, $4, $5, 'pending', 'once', 'easy', $6, $7, $8, 'Morning', $9)`,
        [
          r.id,
          A.family,
          r.title,
          A.child,
          r.day,
          A.parent,
          E2E_ANCHOR,
          r.icon,
          r.order,
        ],
      );
    }
  });
});

test.afterAll(async () => {
  await withDb(cleanup);
});

test.beforeEach(async ({}, testInfo) => {
  test.skip(
    !PROJECTS.includes(testInfo.project.name),
    "routine journey runs at 390x844, 800x1280 and 1366x768",
  );
});

async function expectNoSeriousAxe(
  page: Page,
  testInfo: TestInfo,
  label: string,
) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude("next-route-announcer")
    .analyze();
  await testInfo.attach(`axe-${label.replace(/\W+/g, "_")}.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });
  const blocking = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      rule: v.id,
      nodes: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
    }));
  expect(blocking, `serious/critical axe violations on ${label}`).toEqual([]);
}

const morning = (page: Page) => page.getByRole("region", { name: "Morning" });
const steps = (page: Page) => morning(page).getByTestId("routine-step");

async function tap(page: Page, index: number, path = "/api/chores/complete") {
  const response = page.waitForResponse(
    (r) => r.url().endsWith(path) && r.request().method() === "POST",
  );
  await steps(page).nth(index).click();
  expect((await response).status()).toBe(200);
}

test.describe("Family A child", () => {
  test.use({ storageState: authFile("childA") });

  test("completes the morning routine by tapping pictures", async ({
    page,
  }, testInfo) => {
    await page.goto("/dashboard");
    await expect(morning(page)).toBeVisible();
    await expect(steps(page)).toHaveCount(3);
    // In step order, the first one is the next step; tomorrow's is not shown.
    for (const [i, s] of STEPS.entries()) {
      await expect(steps(page).nth(i)).toHaveAttribute(
        "aria-label",
        new RegExp(`^${s.title}, step ${i + 1} of 3`),
      );
      const icon = steps(page).nth(i).locator(`svg[data-icon="${s.icon}"]`);
      const box = await icon.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(88);
      expect(box?.height).toBeGreaterThanOrEqual(88);
    }
    await expect(steps(page).first()).toHaveAttribute("aria-current", "step");
    await expect(page.getByText("Next", { exact: true })).toHaveCount(1);
    await expect(page.getByText(TOMORROW.title)).toHaveCount(0);
    await expect(morning(page).getByTestId("routine-progress")).toHaveText(
      "0 of 3 done",
    );
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    await expectNoSeriousAxe(page, testInfo, "kid home routine");

    // Tap, then Undo.
    await tap(page, 0);
    await expect(steps(page).first()).toHaveAttribute("data-state", "waiting");
    await expect(steps(page).first()).toContainText("Done");
    await expect(steps(page).nth(1)).toHaveAttribute("aria-current", "step");
    await expect(page.getByText("A parent will check it.")).toBeVisible();
    const undone = page.waitForResponse((r) =>
      r.url().endsWith("/api/chores/uncomplete"),
    );
    await page.getByRole("button", { name: "Undo" }).click();
    expect((await undone).status()).toBe(200);
    await expect(steps(page).first()).toHaveAttribute("aria-current", "step");
    expect((await statuses())[STEPS[0].id]).toBe("pending");

    // Now the whole routine, in order, the highlight moving along.
    for (let i = 0; i < 3; i++) {
      await expect(steps(page).nth(i)).toHaveAttribute("aria-current", "step");
      await tap(page, i);
      await expect(steps(page).nth(i)).toHaveAttribute(
        "aria-label",
        /done, waiting for a parent to check$/,
      );
    }
    await expect(morning(page).getByTestId("routine-progress")).toHaveText(
      "All done",
    );
    await expect(page.getByText("Next", { exact: true })).toHaveCount(0);
    const after = await statuses();
    for (const s of STEPS) expect(after[s.id]).toBe("completed");
    expect(after[TOMORROW.id]).toBe("pending");

    // The server state survives a reload.
    await page.reload();
    await expect(steps(page)).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expect(steps(page).nth(i)).toHaveAttribute("data-state", "waiting");
    }
    await expectNoSeriousAxe(page, testInfo, "kid home routine done");
  });
});

test.describe("Family A parent", () => {
  test.use({ storageState: authFile("parentA") });

  test("sees the routine awaiting a check and sends one step back", async ({
    page,
  }) => {
    await page.goto("/dashboard/today");
    // The fixture's one completed chore plus the three routine steps.
    await expect(
      page.getByRole("link", { name: /4 chores to check/ }),
    ).toBeVisible();

    await page.goto("/dashboard/chores");
    const queue = page
      .locator("section")
      .filter({ has: page.getByText("Pending Verification") });
    for (const s of STEPS) await expect(queue.getByText(s.title)).toBeVisible();

    page.once("dialog", (d) => d.accept("Teeth need another go"));
    const checked = page.waitForResponse((r) =>
      r.url().endsWith("/api/chores/verify"),
    );
    await queue
      .getByRole("button", { name: `Send back “${STEPS[0].title}”` })
      .click();
    const res = await checked;
    expect(res.status()).toBe(200);
    expect(res.request().postDataJSON()).toEqual({
      choreId: STEPS[0].id,
      decision: "reject",
      verificationNotes: "Teeth need another go",
    });
    expect((await res.json()).chore).toMatchObject({
      status: "pending",
      verified_notes: "Teeth need another go",
    });
    await expect(queue.getByText(STEPS[0].title)).toHaveCount(0);
    await expect(page.getByText("Sent back")).toBeVisible();
    const after = await statuses();
    expect(after[STEPS[0].id]).toBe("pending");
    expect(after[STEPS[1].id]).toBe("completed");

    await page.goto("/dashboard/today");
    await expect(
      page.getByRole("link", { name: /3 chores to check/ }),
    ).toBeVisible();
  });
});
