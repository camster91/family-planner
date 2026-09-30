/**
 * New household, start to finish: the only journey that starts from nothing
 * instead of the seeded fixture households. Runs in `phone-390x844` and
 * `desktop-1366x768`.
 *
 * 1. A new parent registers on /register with a unique address and sees
 *    "Check Your Email". Signing in before verifying is refused with the
 *    verify message and a "Resend verification email" button.
 * 2. Email verification. The E2E server has no mail provider, and only
 *    sha256(token) is stored (src/lib/tokens.ts), so the spec cannot read the
 *    link. Instead it replaces the stored hash with the hash of a token it
 *    generated (expiry untouched), then opens the REAL
 *    GET /api/auth/verify-email?token=… . That route marks the account
 *    verified and redirects to `<NEXT_PUBLIC_APP_URL>/login?verified=1`; the
 *    redirect is not followed (the app URL is baked in at build time), the
 *    spec opens /login?verified=1 on the E2E server and checks the notice. No
 *    app code or test-only switch is involved.
 * 3. The parent signs in, lands on onboarding, creates the household and is
 *    sent to the Today board (empty chores region).
 * 4. Settings → Invite → "In person instead" shows the family code (the one
 *    stored for the new household).
 * 5. The child registers and verifies the same way in a second browser
 *    context, signs in, follows onboarding's "Join an existing family" to
 *    /join, checks the code, joins and lands on the kid home.
 * 6. The parent assigns the first chore (due on the anchor day) to the child.
 * 7. The child sees it under "Today's Missions" and marks it done.
 * 8. The parent sees "1 chore to check" on the board and verifies it on the
 *    chores page; the child's missions are then clear.
 *
 * No horizontal overflow on any screen of the journey (the check matters at
 * 390px). Every row it creates is removed before and after the test:
 * chores, the household (its cascades: audit log, activity, beta counts,
 * notifications…), both users, and the rate-limit rows keyed by their ids and
 * by registration. Addresses are `fx-e2e-signup-<project>-…@example.test`.
 */
import crypto from "crypto";
import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import pg from "pg";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { E2E_ANCHOR } from "./support/env";
import { expect, loginViaUi, test } from "./support/test";

const PROJECTS = ["phone-390x844", "desktop-1366x768"];
// Generated per run so no credential literal lives in the repository: one
// upper-case letter, one lower-case letter and one digit, then random bytes.
function makeTestSecret(): string {
  return ["A", "a", "1", crypto.randomBytes(12).toString("base64url")].join("");
}
const PASSWORD = makeTestSecret();

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

function names(testInfo: TestInfo) {
  const slug = testInfo.project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const emailPrefix = `fx-e2e-signup-${slug}-`;
  const run = Date.now().toString(36);
  return {
    emailPrefix,
    familyName: `E2E Signup Home ${slug}`,
    parent: {
      name: "Jordan Newparent",
      email: `${emailPrefix}parent-${run}@example.test`,
    },
    child: {
      name: "Robin Newkid",
      email: `${emailPrefix}child-${run}@example.test`,
    },
    chore: "Feed the goldfish",
  };
}

/** Removes everything a run of this spec (in this project) can have created. */
async function removeSpecRows(db: pg.Client, x: ReturnType<typeof names>) {
  const users = await db.query<{ id: string; family_id: string | null }>(
    `SELECT id, family_id FROM "User" WHERE email LIKE $1`,
    [`${x.emailPrefix}%`],
  );
  const userIds = users.rows.map((r) => r.id);
  const families = await db.query<{ id: string }>(
    `SELECT id FROM "Family" WHERE name = $1 OR id = ANY($2)`,
    [
      x.familyName,
      users.rows.map((r) => r.family_id).filter((f): f is string => !!f),
    ],
  );
  const familyIds = families.rows.map((r) => r.id);
  // Chores reference their assignee and creator without a cascade, so they go
  // first; the household delete then cascades to every family-owned row.
  await db.query(
    `DELETE FROM "Chore" WHERE family_id = ANY($1) OR assigned_to = ANY($2) OR created_by = ANY($2)`,
    [familyIds, userIds],
  );
  await db.query(`DELETE FROM "Family" WHERE id = ANY($1)`, [familyIds]);
  await db.query(`DELETE FROM "User" WHERE id = ANY($1)`, [userIds]);
  // Registration is limited per client address; join and code lookup per user.
  await db.query(
    `DELETE FROM "RateLimitEntry" WHERE key LIKE 'register:%' OR key LIKE ANY($1)`,
    [userIds.map((id) => `%${id}%`)],
  );
}

/** A second browser context with the same project settings (viewport, zone, client address). */
async function openContext(
  browser: Browser,
  testInfo: TestInfo,
): Promise<{ context: BrowserContext; page: Page }> {
  const use = testInfo.project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport,
    deviceScaleFactor: use.deviceScaleFactor,
    hasTouch: use.hasTouch,
    isMobile: use.isMobile,
    locale: use.locale,
    timezoneId: use.timezoneId,
    colorScheme: "light",
    reducedMotion: "reduce",
    extraHTTPHeaders: use.extraHTTPHeaders,
  });
  const page = await context.newPage();
  await page.clock.install({ time: E2E_ANCHOR });
  return { context, page };
}

async function expectNoHorizontalOverflow(page: Page, where: string) {
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, `horizontal overflow on ${where}`).toBeLessThanOrEqual(0);
}

/** Registers through the /register form and checks the "Check Your Email" state. */
async function registerViaUi(page: Page, who: { name: string; email: string }) {
  await page.goto("/register");
  await expect(
    page.getByRole("heading", { name: "Create Your Account" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page, "/register");
  await page.getByLabel("Full Name").fill(who.name);
  await page.getByLabel("Email Address").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm Password").fill(PASSWORD);
  await page.locator("#terms").check();
  const registered = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/auth/register") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create Account" }).click();
  const res = await registered;
  expect(res.status(), await res.text()).toBe(200);
  expect(await res.json()).toMatchObject({ requiresVerification: true });
  await expect(
    page.getByRole("heading", { name: "Check Your Email" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to Sign In" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "check your email");
}

/**
 * Verifies the address through the real verification link. Only the hash is
 * stored, so the spec swaps in the hash of a token it knows (same expiry) and
 * opens GET /api/auth/verify-email with the plaintext, like the email link.
 */
async function verifyEmailViaLink(page: Page, email: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const updated = await withDb(async (db) => {
    const before = await db.query(
      `SELECT email_verified, verify_token IS NOT NULL AS has_token,
              verify_token_expires > $2 AS unexpired
         FROM "User" WHERE email = $1`,
      [email, E2E_ANCHOR],
    );
    expect(before.rows[0]).toEqual({
      email_verified: false,
      has_token: true,
      unexpired: true,
    });
    return db.query(
      `UPDATE "User" SET verify_token = $2 WHERE email = $1 AND verify_token IS NOT NULL`,
      [email, hash],
    );
  });
  expect(updated.rowCount).toBe(1);

  const res = await page.request.get(`/api/auth/verify-email?token=${token}`, {
    maxRedirects: 0,
  });
  expect(res.status()).toBeGreaterThanOrEqual(300);
  expect(res.status()).toBeLessThan(400);
  expect(res.headers()["location"]).toMatch(/\/login\?verified=1$/);

  const after = await withDb((db) =>
    db.query(
      `SELECT email_verified, verify_token FROM "User" WHERE email = $1`,
      [email],
    ),
  );
  expect(after.rows[0]).toEqual({ email_verified: true, verify_token: null });

  // Where the redirect lands, on this server.
  await page.goto("/login?verified=1");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Your email is verified. Sign in to get started." }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page, "/login?verified=1");
}

test.describe("new household sign-up journey", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      !PROJECTS.includes(testInfo.project.name),
      "phone and desktop only",
    );
    await withDb((db) => removeSpecRows(db, names(testInfo)));
  });

  test.afterEach(async ({}, testInfo) => {
    if (!PROJECTS.includes(testInfo.project.name)) return;
    await withDb((db) => removeSpecRows(db, names(testInfo)));
  });

  test("a new parent signs up, sets up the household, and a child finishes the first chore", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    const x = names(testInfo);
    let familyId = "";
    let inviteCode = "";

    await test.step("parent registers and cannot sign in before verifying", async () => {
      await registerViaUi(page, x.parent);

      await loginViaUi(page, x.parent.email, PASSWORD);
      await expect(
        page
          .getByRole("alert")
          .filter({ hasText: "Please verify your email before signing in." }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Resend verification email" }),
      ).toBeVisible();
      await expect(page).toHaveURL(/\/login/);
    });

    await test.step("parent verifies the email address", async () => {
      await verifyEmailViaLink(page, x.parent.email);
    });

    await test.step("parent signs in and creates the household", async () => {
      await loginViaUi(page, x.parent.email, PASSWORD);
      await page.waitForURL(/\/dashboard$/);
      await expect(
        page.getByRole("heading", { name: "Welcome to Family Planner!" }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page, "onboarding welcome");
      await page.getByRole("button", { name: "Get Started" }).click();

      await expect(
        page.getByRole("heading", { name: "Create Your Family" }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Join an existing family" }),
      ).toHaveAttribute("href", "/join");
      await expectNoHorizontalOverflow(page, "onboarding create family");
      await page.getByPlaceholder("e.g., The Smith Family").fill(x.familyName);
      const created = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/family") && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Create Family" }).click();
      expect((await created).status()).toBe(200);

      // A parent's home is the Today board (#269).
      await page.waitForURL(/\/dashboard\/today/);
      await expect(page.getByTestId("region-chores")).toContainText(
        "No chores due today.",
      );
      await expectNoHorizontalOverflow(page, "Today board (new household)");

      const row = await withDb((db) =>
        db.query<{ family_id: string; role: string; invite_code: string }>(
          `SELECT u.family_id, u.role, f.invite_code
             FROM "User" u JOIN "Family" f ON f.id = u.family_id
            WHERE u.email = $1 AND f.name = $2`,
          [x.parent.email, x.familyName],
        ),
      );
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0].role).toBe("parent");
      familyId = row.rows[0].family_id;
      inviteCode = row.rows[0].invite_code;
    });

    await test.step("parent finds the in-person family code", async () => {
      await page.goto("/dashboard/family/invite");
      await page.getByText("In person instead").click();
      await expect(page.getByText(inviteCode, { exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Copy code" }),
      ).toBeEnabled();
      await expectNoHorizontalOverflow(page, "invite page");
    });

    const { context: childContext, page: kid } = await openContext(
      browser,
      testInfo,
    );
    try {
      await test.step("child registers, verifies and joins with the code", async () => {
        await registerViaUi(kid, x.child);
        await verifyEmailViaLink(kid, x.child.email);
        await loginViaUi(kid, x.child.email, PASSWORD);
        await kid.waitForURL(/\/dashboard$/);
        await kid.getByRole("button", { name: "Get Started" }).click();
        await kid
          .getByRole("link", { name: "Join an existing family" })
          .click();
        await kid.waitForURL(/\/join$/);
        await expect(
          kid.getByRole("heading", { name: "Join a Family" }),
        ).toBeVisible();
        await expectNoHorizontalOverflow(kid, "/join");

        await kid.getByLabel("Family Code").fill(inviteCode);
        await kid.getByRole("button", { name: "Check Code" }).click();
        await expect(
          kid.getByText("Ready to join as a child or teen."),
        ).toBeVisible();
        await expect(
          kid.getByText(x.familyName, { exact: true }),
        ).toBeVisible();
        const joined = kid.waitForResponse(
          (r) =>
            r.url().endsWith("/api/family/join") &&
            r.request().method() === "POST",
        );
        await kid.getByRole("button", { name: "Join Family" }).click();
        expect((await joined).status()).toBe(200);
        await expect(
          kid.getByText(`Successfully joined ${x.familyName}!`),
        ).toBeVisible();

        // The kid home, not the parent's board.
        await kid.waitForURL(/\/dashboard$/, { timeout: 15_000 });
        await expect(
          kid.getByRole("heading", { name: `Hi, ${x.child.name}!` }),
        ).toBeVisible();
        await expect(kid.getByText("All done for today!")).toBeVisible();
        await expectNoHorizontalOverflow(kid, "kid home (no chores)");

        const member = await withDb((db) =>
          db.query(
            `SELECT family_id, role, email_verified FROM "User" WHERE email = $1`,
            [x.child.email],
          ),
        );
        expect(member.rows[0]).toEqual({
          family_id: familyId,
          role: "child",
          email_verified: true,
        });
      });

      await test.step("parent assigns the first chore to the child", async () => {
        await page.goto("/dashboard/chores/create");
        await expect(
          page.getByRole("heading", { name: "New Chore" }),
        ).toBeVisible();
        const assignee = page.getByLabel("Assign To");
        // Members load after mount.
        await expect(
          assignee.locator("option", { hasText: x.child.name }),
        ).toHaveCount(1);
        await page.getByLabel("Title", { exact: true }).fill(x.chore);
        await assignee.selectOption({ label: x.child.name });
        // Date-only, the anchor's UTC day (the form's own minimum).
        await page
          .getByLabel("Due Date")
          .fill(E2E_ANCHOR.toISOString().slice(0, 10));
        await expectNoHorizontalOverflow(page, "new chore form");
        const created = page.waitForResponse(
          (r) =>
            r.url().endsWith("/api/chores/create") &&
            r.request().method() === "POST",
        );
        await page.getByRole("button", { name: "Create Chore" }).click();
        expect((await created).status()).toBe(200);

        await page.waitForURL(/\/dashboard\/chores$/);
        await expect(page.getByText(x.chore).first()).toBeVisible();
        await expectNoHorizontalOverflow(page, "chores page");
      });

      await test.step("child sees the chore and marks it done", async () => {
        await kid.goto("/dashboard");
        await expect(kid.getByText("Today's Missions")).toBeVisible();
        const mission = kid.getByRole("button", { name: new RegExp(x.chore) });
        await expect(mission).toBeEnabled();
        await expectNoHorizontalOverflow(kid, "kid home (one chore)");

        const done = kid.waitForResponse(
          (r) =>
            r.url().endsWith("/api/chores/complete") &&
            r.request().method() === "POST",
        );
        await mission.click();
        expect((await done).status()).toBe(200);
        await expect(mission).toContainText("You did it!");
        await expect(mission).toBeDisabled();
        await expect(
          kid.getByText("A parent will check it.").first(),
        ).toBeVisible();
      });

      await test.step("parent verifies the chore", async () => {
        await page.goto("/dashboard/today");
        await expect(
          page.getByRole("link", { name: "1 chore to check" }).first(),
        ).toBeVisible();
        await expectNoHorizontalOverflow(page, "Today board (one to check)");

        await page.goto("/dashboard/chores");
        const queue = page
          .locator("section")
          .filter({ has: page.getByText("Pending Verification") });
        await expect(queue.getByText(x.chore)).toBeVisible();
        const checked = page.waitForResponse(
          (r) =>
            r.url().endsWith("/api/chores/verify") &&
            r.request().method() === "POST",
        );
        await queue
          .getByRole("button", { name: `Verify “${x.chore}”` })
          .click();
        expect((await checked).status()).toBe(200);
        await expect(
          page.getByText("Chore verified", { exact: true }).first(),
        ).toBeVisible();
        await expect(page.getByText("Pending Verification")).toHaveCount(0);
        await expectNoHorizontalOverflow(page, "chores page (verified)");

        const chore = await withDb((db) =>
          db.query(
            `SELECT c.status, a.email AS assignee, cr.email AS creator
               FROM "Chore" c
               JOIN "User" a ON a.id = c.assigned_to
               JOIN "User" cr ON cr.id = c.created_by
              WHERE c.family_id = $1`,
            [familyId],
          ),
        );
        expect(chore.rows).toEqual([
          {
            status: "verified",
            assignee: x.child.email,
            creator: x.parent.email,
          },
        ]);

        // The child's missions are clear again.
        await kid.goto("/dashboard");
        await expect(kid.getByText("All done for today!")).toBeVisible();
      });
    } finally {
      await childContext.close();
    }
  });
});
