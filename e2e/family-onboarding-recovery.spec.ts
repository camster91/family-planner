/**
 * Guarded onboarding recovery coverage for a disposable, real parent account.
 *
 * Family creation and authentication use the real loopback E2E server. The
 * profile and invite surfaces are intercepted in the browser so this journey
 * never creates an invite, sends mail, or calls an external provider. The
 * invite cases exercise the same pending lock and draft-retention paths the
 * production UI uses: held response, Escape/back, refusal, malformed 2xx,
 * error status, and a delayed roster response that must become truthful
 * stale state. Run only with FAMILY_ONBOARDING_E2E=1 and a loopback database.
 *
 * The first case also proves the default public v1 capability surface keeps
 * the no-email control hidden when the parent-scoped profile endpoint refuses
 * setup. The second case proves the authenticated opt-in profile read exposes
 * the private v2 setup flow on both the dashboard onboarding route and the
 * shared roster refresh.
 */
import crypto from "node:crypto";
import type { BrowserContext, Page, TestInfo } from "@playwright/test";
import pg from "pg";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { expect, loginViaUi, test } from "./support/test";

const TARGET_PROJECTS = ["phone-390x844", "desktop-1366x768"];
const ONBOARDING_E2E_ON = process.env.FAMILY_ONBOARDING_E2E === "1";
const PASSWORD = [
  "A",
  "a",
  "1",
  crypto.randomBytes(12).toString("base64url"),
].join("");

const PROJECT_IPS: Record<string, string> = {
  "phone-390x844": "198.51.100.240",
  "desktop-1366x768": "198.51.100.241",
};

type TestNames = {
  prefix: string;
  family: string;
  clientIp: string;
  parent: { name: string; email: string };
};

type ProfileMode = "unavailable" | "available";
type InviteMode = "held" | "success" | "refusal" | "malformed" | "status";

function names(info: TestInfo): TestNames {
  const project = info.project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const suffix = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
  const prefix = `fx-e2e-onboarding-${project}-${suffix}`;
  return {
    prefix,
    family: `${prefix} home`,
    clientIp: clientIp(info),
    parent: {
      name: "Jordan Onboardingparent",
      email: `${prefix}@example.test`,
    },
  };
}

function clientIp(info: TestInfo): string {
  const value = PROJECT_IPS[info.project.name];
  if (!value) {
    throw new Error(
      `No onboarding E2E client address for ${info.project.name}`,
    );
  }
  return value;
}

function loopbackDatabase(): void {
  const target = assertFixtureTargetAllowed(process.env);
  const host = (target.host ?? "").replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host !== "localhost" &&
    host !== "::1" &&
    !/^127(?:\.\d{1,3}){3}$/.test(host)
  ) {
    throw new Error("Onboarding E2E requires a loopback DATABASE_URL target");
  }
}

async function withDb<T>(fn: (db: pg.Client) => Promise<T>): Promise<T> {
  loopbackDatabase();
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

async function removeRows(db: pg.Client, x: TestNames): Promise<void> {
  const users = await db.query<{ id: string; family_id: string | null }>(
    `SELECT id, family_id FROM "User" WHERE email LIKE $1`,
    [`${x.prefix}%`],
  );
  const userIds = users.rows.map((row) => row.id);
  const families = await db.query<{ id: string }>(
    `SELECT id FROM "Family" WHERE name = $1 OR id = ANY($2)`,
    [
      x.family,
      users.rows
        .map((row) => row.family_id)
        .filter((family): family is string => Boolean(family)),
    ],
  );
  const familyIds = families.rows.map((row) => row.id);
  const ownedRateLimitKeys = [
    `register:${x.clientIp}`,
    `login:${x.clientIp}`,
    `verify-email:${x.clientIp}`,
  ];
  await db.query(
    `DELETE FROM "Chore"
       WHERE family_id = ANY($1) OR assigned_to = ANY($2) OR created_by = ANY($2)`,
    [familyIds, userIds],
  );
  await db.query(`DELETE FROM "Family" WHERE id = ANY($1)`, [familyIds]);
  await db.query(`DELETE FROM "User" WHERE id = ANY($1)`, [userIds]);
  await db.query(
    `DELETE FROM "RateLimitEntry"
       WHERE key = ANY($1::text[]) OR key LIKE ANY($2::text[])`,
    [ownedRateLimitKeys, userIds.map((id) => `%${id}%`)],
  );

  const remaining = await db.query<{
    families: string;
    users: string;
    members: string;
    invites: string;
    rate_limits: string;
  }>(
    `SELECT
       (SELECT count(*)::text FROM "Family"
          WHERE id = ANY($1::text[]) OR name = $2) AS families,
       (SELECT count(*)::text FROM "User"
          WHERE id = ANY($3::text[]) OR email LIKE $4) AS users,
       (SELECT count(*)::text FROM "HouseholdMember"
          WHERE family_id = ANY($1::text[])) AS members,
       (SELECT count(*)::text FROM "FamilyInvite"
          WHERE family_id = ANY($1::text[]) OR created_by = ANY($3::text[])) AS invites,
       (SELECT count(*)::text FROM "RateLimitEntry"
          WHERE key = ANY($5::text[]) OR key LIKE ANY($6::text[])) AS rate_limits`,
    [
      familyIds,
      x.family,
      userIds,
      `${x.prefix}%`,
      ownedRateLimitKeys,
      userIds.map((id) => `%${id}%`),
    ],
  );
  const leftovers = remaining.rows[0];
  if (
    leftovers.families !== "0" ||
    leftovers.users !== "0" ||
    leftovers.members !== "0" ||
    leftovers.invites !== "0" ||
    leftovers.rate_limits !== "0"
  ) {
    throw new Error(
      `Onboarding E2E cleanup left owned rows: ${JSON.stringify(leftovers)}`,
    );
  }
}

async function registerViaUi(
  page: Page,
  who: TestNames["parent"],
): Promise<void> {
  await page.goto("/register");
  await expect(
    page.getByRole("heading", { name: "Create Your Account" }),
  ).toBeVisible();
  await page.getByLabel("Full Name").fill(who.name);
  await page.getByLabel("Email Address").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm Password").fill(PASSWORD);
  await page.locator("#terms").check();
  const registered = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/register") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create Account" }).click();
  const response = await registered;
  expect(response.status(), await response.text()).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    requiresVerification: true,
  });
  await expect(
    page.getByRole("heading", { name: "Check Your Email" }),
  ).toBeVisible();
}

async function verifyEmailViaLink(
  page: Page,
  email: string,
  ip: string,
): Promise<void> {
  const token = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const updated = await withDb(async (db) =>
    db.query(
      `UPDATE "User" SET verify_token = $2
         WHERE email = $1 AND verify_token IS NOT NULL`,
      [email, hash],
    ),
  );
  expect(updated.rowCount).toBe(1);
  const response = await page.request.get(
    `/api/auth/verify-email?token=${token}`,
    { headers: { "X-Forwarded-For": ip }, maxRedirects: 0 },
  );
  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  await page.goto(`/verify-email?token=${token}`);
  await page.getByRole("button", { name: "Confirm my email" }).click();
  await page.waitForURL(/\/login\?verified=1$/);
}

async function blockExternalBrowserRequests(
  context: BrowserContext,
  baseURL: string,
): Promise<void> {
  const localHost = new URL(baseURL).hostname;
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === localHost ||
      ["data:", "blob:"].includes(url.protocol)
      ? route.continue()
      : route.abort();
  });
}

async function createFamily(
  page: Page,
  path: "/dashboard" | "/dashboard/family/create",
  family: string,
): Promise<void> {
  // loginViaUi submits the real form but intentionally leaves navigation
  // synchronization to the journey. Wait for the authenticated landing page
  // before replacing it with either onboarding entry point; otherwise a fast
  // goto can race the login response and leave the page on /login.
  await page.waitForURL(/\/dashboard$/);
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "Welcome to Herewoven" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Get started" }).click();
  await expect(
    page.getByRole("heading", { name: "Create your family" }),
  ).toBeVisible();
  await page.getByLabel("Family name").fill(family);
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/family") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create family" }).click();
  expect((await created).status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Add everyone in your family" }),
  ).toBeVisible();
}

async function installSurfaceRoutes(
  page: Page,
  profileMode: ProfileMode,
): Promise<{
  setInviteMode: (mode: InviteMode) => void;
  releaseInvite: () => void;
  setStallNextRoster: () => void;
  rosterReads: () => number;
}> {
  let inviteMode: InviteMode = "success";
  let inviteRelease: (() => void) | undefined;
  let heldInvite = Promise.resolve();
  let stallNextRoster = false;
  let rosterReadCount = 0;
  let profiles: Array<{
    id: string;
    name: string;
    role: "child" | "teen" | "parent";
    age: number | null;
    archived_at: string | null;
    revision: number;
  }> = [];

  await page.route("**/api/capabilities", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ memberProtocols: [1], householdProfiles: false }),
    }),
  );
  await page.route("**/api/family/profiles", async (route) => {
    if (profileMode === "unavailable") {
      return route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "PROFILE_SETUP_UNSUPPORTED" } }),
      });
    }
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ profiles }),
      });
    }
    if (route.request().method() === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}");
      const profile = {
        id: "fx_e2e_onboarding_profile",
        name: body.name,
        role: body.role,
        age: typeof body.age === "number" ? body.age : null,
        archived_at: null,
        revision: 1,
      } as const;
      profiles = [...profiles, profile];
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ profile }),
      });
    }
    return route.continue();
  });
  await page.route("**/api/family/members", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    rosterReadCount += 1;
    if (!stallNextRoster) return route.continue();
    stallNextRoster = false;
    // This delayed full response exercises the client timeout without
    // issuing any request to a provider or an external server. A streamed
    // body stall remains covered by the focused source/unit tests.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    try {
      return await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ members: [{ id: "fx_e2e_onboarding_parent" }] }),
      });
    } catch {
      // The browser timeout may abort the delayed intercepted request after
      // the client has already shown the truthful stale state.
      return;
    }
  });
  await page.route("**/api/family/invites", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    if (inviteMode === "held") await heldInvite;
    if (inviteMode === "refusal") {
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic invite refusal" }),
      });
    }
    if (inviteMode === "malformed") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    }
    if (inviteMode === "status") {
      return route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          error: { message: "Synthetic invite rate limit" },
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        invite: {
          email: JSON.parse(route.request().postData() ?? "{}").email,
          role: "child",
          expires_at: "2030-01-01T00:00:00.000Z",
        },
      }),
    });
  });

  return {
    setInviteMode: (mode) => {
      inviteMode = mode;
      if (mode === "held") {
        heldInvite = new Promise<void>((resolve) => {
          inviteRelease = resolve;
        });
      }
    },
    releaseInvite: () => {
      inviteRelease?.();
      inviteRelease = undefined;
    },
    setStallNextRoster: () => {
      stallNextRoster = true;
    },
    rosterReads: () => rosterReadCount,
  };
}

async function openInvite(page: Page, email: string): Promise<void> {
  await page.getByRole("button", { name: "Invite an account" }).click();
  const dialog = page.getByTestId("onboarding-account-invite");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Email").fill(email);
}

test.describe.serial("family onboarding recovery", () => {
  test.beforeEach(async ({}, info) => {
    test.skip(
      !ONBOARDING_E2E_ON || !process.env.DATABASE_URL,
      "explicit guarded onboarding E2E gate is off",
    );
    test.skip(
      !TARGET_PROJECTS.includes(info.project.name),
      "phone and desktop only",
    );
    loopbackDatabase();
  });

  test("public v1 capability keeps shared-screen setup hidden", async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.setTimeout(180_000);
    const x = names(info);
    const ip = clientIp(info);
    await page.setExtraHTTPHeaders({ "X-Forwarded-For": ip });
    await blockExternalBrowserRequests(context, baseURL!);
    try {
      await installSurfaceRoutes(page, "unavailable");
      await registerViaUi(page, x.parent);
      await verifyEmailViaLink(page, x.parent.email, ip);
      await loginViaUi(page, x.parent.email, PASSWORD);
      await createFamily(page, "/dashboard/family/create", x.family);

      await expect(
        page.getByText(
          "Shared-screen profiles are unavailable on this server.",
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Add a household profile" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: "Invite an account" }),
      ).toHaveCount(0);
    } finally {
      await withDb((db) => removeRows(db, x));
    }
  });

  test("private v2 setup and invite recovery preserve the parent draft", async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.setTimeout(180_000);
    const x = names(info);
    const ip = clientIp(info);
    await page.setExtraHTTPHeaders({ "X-Forwarded-For": ip });
    await blockExternalBrowserRequests(context, baseURL!);
    try {
      const surface = await installSurfaceRoutes(page, "available");
      await registerViaUi(page, x.parent);
      await verifyEmailViaLink(page, x.parent.email, ip);
      await loginViaUi(page, x.parent.email, PASSWORD);
      await createFamily(page, "/dashboard", x.family);

      await expect(
        page.getByRole("button", { name: "Add a household profile" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Add a household profile" })
        .click();
      const profileDialog = page.getByTestId("profile-setup-dialog");
      await expect(profileDialog).toBeVisible();
      await profileDialog.getByLabel("Name").fill("Robin Sharedscreen");
      await profileDialog.getByLabel("Age").fill("3");
      await profileDialog.getByRole("button", { name: "Save profile" }).click();
      await expect(
        profileDialog.getByRole("status").filter({ hasText: "Profile saved" }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "2 household people added" }),
      ).toBeVisible();
      await expect.poll(surface.rosterReads).toBeGreaterThan(0);
      await profileDialog.getByRole("button", { name: "Close" }).click();
      await expect(profileDialog).toBeHidden();

      // Every invite POST below is fulfilled in the browser; no invite row,
      // email, or provider call can be created by this spec.
      surface.setInviteMode("held");
      await openInvite(page, "held@example.test");
      const heldSubmit = page
        .getByTestId("onboarding-account-invite")
        .getByRole("button", { name: "Send invite" });
      await heldSubmit.click();
      await expect(
        page.getByTestId("onboarding-account-invite").getByRole("button", {
          name: "Sending invite…",
        }),
      ).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("onboarding-account-invite")).toBeVisible();
      const heldUrl = page.url();
      const back = page.goBack({ timeout: 1_000 }).catch(() => null);
      await expect.poll(() => page.url()).toBe(heldUrl);
      surface.releaseInvite();
      await back;
      await expect(page.getByTestId("onboarding-account-invite")).toBeHidden();
      await expect(
        page.getByRole("status").filter({ hasText: "Invite sent" }),
      ).toBeVisible();

      for (const [mode, email] of [
        ["refusal", "refusal@example.test"],
        ["malformed", "malformed@example.test"],
        ["status", "status@example.test"],
      ] as const) {
        surface.setInviteMode(mode);
        await openInvite(page, email);
        const dialog = page.getByTestId("onboarding-account-invite");
        await dialog.getByRole("button", { name: "Send invite" }).click();
        await expect(dialog.getByRole("alert")).toBeVisible();
        await expect(dialog.getByLabel("Email")).toHaveValue(email);
        await expect(dialog).toBeVisible();
        await dialog.getByRole("button", { name: "Close" }).click();
        await expect(dialog).toBeHidden();
      }

      surface.setInviteMode("success");
      surface.setStallNextRoster();
      await openInvite(page, "stale-roster@example.test");
      await page
        .getByTestId("onboarding-account-invite")
        .getByRole("button", { name: "Send invite" })
        .click();
      await expect(
        page.getByRole("status").filter({ hasText: "Invite sent" }),
      ).toBeVisible();
      await expect(
        page.getByRole("status").filter({
          hasText:
            "Saved. The roster is not current yet; your changes are safe.",
        }),
      ).toBeVisible({ timeout: 8_000 });
      await page.getByRole("button", { name: "Refresh roster" }).click();
      await expect(
        page.getByRole("status").filter({
          hasText:
            "Saved. The roster is not current yet; your changes are safe.",
        }),
      ).toHaveCount(0);
    } finally {
      await withDb((db) => removeRows(db, x));
    }
  });
});
