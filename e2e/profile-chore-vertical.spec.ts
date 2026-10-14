/**
 * Opt-in end-to-end proof for the first email-free profile chore vertical.
 *
 * This journey deliberately starts with a real, unverified account, completes
 * the real onboarding/profile/chore/pairing flows, and only uses the database
 * for verification-token replacement, the disposable device-write opt-in and
 * owner-scoped teardown. Profile/chore/status responses are never mocked.
 *
 * Run only against the guarded loopback E2E server with all profile gates on:
 * HOUSEHOLD_PROFILE_SETUP_ENABLED=1 HOUSEHOLD_PROFILE_CHORE_ENABLED=1
 * HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY=1.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { E2E_ANCHOR } from "./support/env";
import { onboardingEnglish } from "../src/i18n/onboarding";
import { browserFetch, expect, loginViaUi, test } from "./support/test";

const PROFILE_GATES_ON =
  process.env.HOUSEHOLD_PROFILE_SETUP_ENABLED === "1" &&
  process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED === "1" &&
  process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY === "1";
const PASSWORD = [
  "A",
  "a",
  "1",
  crypto.randomBytes(12).toString("base64url"),
].join("");
const PROJECT_IPS: Record<string, string> = {
  "phone-390x844": "198.51.100.230",
  "phone-430x932": "198.51.100.231",
  "tablet-portrait-800x1280": "198.51.100.232",
  "fridge-landscape-1280x800": "198.51.100.233",
  "tablet-large-1920x1200": "198.51.100.234",
  "desktop-1366x768": "198.51.100.235",
};

type OwnedNames = {
  prefix: string;
  family: string;
  parent: { name: string; email: string };
  profiles: { name: string; role: "child" | "teen" | "parent"; age: number }[];
  chore: string;
};

type ProfileRoutineChore = {
  id: string;
  title: string;
  profileId: string;
  profileName: string;
  icon: string;
  routine: string;
  order: number;
};

function names(info: TestInfo): OwnedNames {
  const project = info.project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const suffix = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
  const prefix = `fx-e2e-profile-${project}-${suffix}`;
  return {
    prefix,
    family: `${prefix} home`,
    parent: { name: "Jordan Profileparent", email: `${prefix}@example.test` },
    profiles: [
      { name: "Robin Profilechild", role: "child", age: 3 },
      { name: "Taylor Profileteen", role: "teen", age: 15 },
      { name: "Morgan Profileparent", role: "parent", age: 32 },
    ],
    chore: `${prefix} profile chore`,
  };
}

function clientIp(info: TestInfo): string {
  const value = PROJECT_IPS[info.project.name];
  if (!value)
    throw new Error(
      `No dedicated profile E2E client address for ${info.project.name}`,
    );
  return value;
}

function loopbackDatabase(): void {
  const target = assertFixtureTargetAllowed(process.env);
  const host = (target.host ?? "").replace(/^\[|\]$/g, "").toLowerCase();
  if (!(
    host === "localhost" ||
    host === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  )) {
    throw new Error(
      "Profile chore E2E requires a loopback DATABASE_URL target",
    );
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

async function identity(page: Page, info: TestInfo): Promise<void> {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();
  expect(head).toMatch(/^[a-f0-9]{40}$/);
  expect(tree).toMatch(/^[a-f0-9]{40}$/);
  expect(() =>
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "prisma"], {
      stdio: "ignore",
    }),
  ).not.toThrow();
  expect(process.env.RELEASE_SHA?.trim()).toBe(head);
  const response = await page.request.get("/api/version");
  expect(response.status()).toBe(200);
  const runtime = (await response.json()) as {
    commit?: string;
    builtAt?: string;
  };
  expect(runtime.commit).toBe(head);
  const route = fs.readFileSync(
    ".next/server/app/api/version/route.js",
    "utf8",
  );
  const builtAt = [
    ...new Set(route.match(/20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g) ?? []),
  ];
  expect(builtAt).toHaveLength(1);
  expect(runtime.builtAt).toBe(builtAt[0]);
  await info.attach("profile-chore-runtime-identity", {
    body: JSON.stringify({
      runtime,
      sourceHead: head,
      sourceTree: tree,
      project: info.project.name,
      fixture: "unique profile family",
    }),
    contentType: "application/json",
  });
}

async function register(
  page: Page,
  person: { name: string; email: string },
  ip: string,
): Promise<void> {
  await page.goto("/register");
  await page.getByLabel("Full Name").fill(person.name);
  await page.getByLabel("Email Address").fill(person.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm Password").fill(PASSWORD);
  await page.locator("#terms").check();
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/auth/register") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create Account" }).click();
  expect((await response).status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Check Your Email" }),
  ).toBeVisible();
  await verifyEmail(page, person.email, ip);
}

async function verifyEmail(
  page: Page,
  email: string,
  ip: string,
): Promise<void> {
  const token = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  await withDb(async (db) => {
    const result = await db.query(
      `UPDATE "User" SET verify_token=$2 WHERE email=$1 AND verify_token IS NOT NULL`,
      [email, hash],
    );
    expect(result.rowCount).toBe(1);
  });
  const response = await page.request.get(
    `/api/auth/verify-email?token=${token}`,
    {
      headers: { "X-Forwarded-For": ip },
      maxRedirects: 0,
    },
  );
  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  await page.goto(`/verify-email?token=${token}`);
  await page.getByRole("button", { name: "Confirm my email" }).click();
  await page.waitForURL(/\/login\?verified=1$/);
}

async function openContext(
  browser: Browser,
  info: TestInfo,
  storageState?: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const use = info.project.use;
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
    extraHTTPHeaders: {
      ...(use.extraHTTPHeaders ?? {}),
      "X-Forwarded-For": clientIp(info),
    },
    ...(storageState ? { storageState } : {}),
  });
  const page = await context.newPage();
  await page.clock.install({ time: E2E_ANCHOR });
  return { context, page };
}

async function saveProfiles(
  page: Page,
  profiles: OwnedNames["profiles"],
): Promise<Record<string, string>> {
  await page.getByRole("button", { name: "Add a household profile" }).click();
  const dialog = page.getByTestId("profile-setup-dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "Add someone without an account" }),
  ).toBeVisible();
  for (const profile of profiles) {
    await dialog.locator("#profile-name").fill(profile.name);
    await dialog.locator("#profile-role").selectOption(profile.role);
    await dialog.locator("#profile-age").fill(String(profile.age));
    await dialog.getByRole("button", { name: /Save profile/ }).click();
    await expect(
      dialog.getByRole("status").filter({ hasText: /Profile saved/ }),
    ).toBeVisible();
  }
  const listed = await browserFetch(page, "/api/family/profiles");
  expect(listed.status, listed.body).toBe(200);
  const payload = JSON.parse(listed.body) as {
    profiles?: { id: string; name: string }[];
  };
  const ids: Record<string, string> = {};
  for (const profile of profiles) {
    const found = payload.profiles?.find(
      (candidate) => candidate.name === profile.name,
    );
    expect(found, `created profile ${profile.name}`).toBeTruthy();
    ids[profile.name] = found!.id;
  }
  await dialog.getByRole("button", { name: "Close" }).click();
  return ids;
}

async function createFamilyAndProfiles(
  page: Page,
  x: OwnedNames,
): Promise<Record<string, string>> {
  await loginViaUi(page, x.parent.email, PASSWORD);
  await page.waitForURL(/\/dashboard$/);
  await page
    .getByRole("button", { name: onboardingEnglish.getStarted, exact: true })
    .click();
  await page
    .getByLabel(onboardingEnglish.familyNameLabel, { exact: true })
    .fill(x.family);
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/family") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: onboardingEnglish.createFamily, exact: true })
    .click();
  expect((await response).status()).toBe(200);
  await expect(
    page.getByRole("heading", {
      name: onboardingEnglish.addEveryoneTitle,
      exact: true,
    }),
  ).toBeVisible();
  const profileIds = await saveProfiles(page, x.profiles);
  await page
    .getByRole("link", { name: onboardingEnglish.finishLater, exact: true })
    .click();
  await page.waitForURL(/\/dashboard\/today/);
  return profileIds;
}

async function enableOwnedDeviceWrites(
  x: OwnedNames,
): Promise<{ familyId: string; original: boolean }> {
  return withDb(async (db) => {
    const row = await db.query<{ id: string; device_writes_enabled: boolean }>(
      `SELECT f.id, f.device_writes_enabled FROM "Family" f JOIN "User" u ON u.family_id=f.id WHERE u.email=$1 AND f.name=$2`,
      [x.parent.email, x.family],
    );
    expect(row.rows).toHaveLength(1);
    await db.query(
      `UPDATE "Family" SET device_writes_enabled=true WHERE id=$1`,
      [row.rows[0].id],
    );
    return {
      familyId: row.rows[0].id,
      original: row.rows[0].device_writes_enabled,
    };
  });
}

async function createProfileChore(
  page: Page,
  x: OwnedNames,
  childId: string,
): Promise<string> {
  return createProfileRoutineChore(page, {
    title: x.chore,
    profileId: childId,
    profileName: x.profiles[0].name,
    profileRole: "child",
  });
}

async function createProfileRoutineChore(
  page: Page,
  input: Omit<ProfileRoutineChore, "id" | "icon" | "routine" | "order"> & {
    profileRole: "child" | "teen" | "parent";
    icon?: string;
    routine?: string;
    order?: number;
  },
): Promise<string> {
  await page.goto("/dashboard/chores/create");
  await expect(
    page.locator(`#assignedTo option[value="profile:${input.profileId}"]`),
  ).toHaveCount(1);
  await page.locator("#title").fill(input.title);
  await page.locator("#assignedTo").selectOption(`profile:${input.profileId}`);
  await page.locator("#dueDate").fill(E2E_ANCHOR.toISOString().slice(0, 10));
  const pictureRoutine = page
    .locator("details")
    .filter({ has: page.getByTestId("routine-icon-picker") });
  await pictureRoutine.locator("summary").click();
  if (input.icon) {
    await page
      .getByTestId("routine-icon-picker")
      .locator(`[data-icon-key="${input.icon}"]`)
      .click();
  }
  if (input.routine) {
    await page.locator("#chore-routine").fill(input.routine);
    await page.locator("#chore-routine-order").fill(String(input.order ?? 1));
  }
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/chores/create") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create Chore" }).click();
  const result = await response;
  const resultText = await result.text();
  expect(result.status(), resultText).toBe(200);
  const body = JSON.parse(resultText) as {
    chore?: {
      id?: string;
      icon?: string | null;
      routine?: string | null;
      routine_order?: number | null;
      subject?: {
        kind: string;
        memberId?: string;
        name?: string;
        role?: string;
      };
    };
  };
  expect(body.chore?.id).toBeTruthy();
  expect(body.chore?.subject).toEqual({
    kind: "profile",
    memberId: input.profileId,
    name: input.profileName,
    role: input.profileRole,
  });
  expect(body.chore).not.toHaveProperty("assigned_to");
  expect(body.chore).not.toHaveProperty("assigned_member_id");
  if (input.icon) expect(body.chore?.icon).toBe(input.icon);
  if (input.routine) {
    expect(body.chore?.routine).toBe(input.routine);
    expect(body.chore?.routine_order).toBe(input.order ?? 1);
  }
  await page.waitForURL(/\/dashboard\/chores/);
  return body.chore!.id!;
}

async function readProfileRoutineStack(
  page: Page,
  stackId: string,
): Promise<{
  stack: { id: string; label: string };
  steps: Array<{
    id: string;
    assigned_to: string | null;
    assigned_member_id: string | null;
    routine_order: number | null;
    icon: string | null;
  }>;
}> {
  const response = await page.request.get(
    `/api/chores/stacks?stack_id=${encodeURIComponent(stackId)}&occurrence_date=${E2E_ANCHOR.toISOString().slice(0, 10)}`,
    { headers: { "X-Member-Protocol": "2" } },
  );
  const responseText = await response.text();
  expect(response.status(), responseText).toBe(200);
  return JSON.parse(responseText) as {
    stack: { id: string; label: string };
    steps: Array<{
      id: string;
      assigned_to: string | null;
      assigned_member_id: string | null;
      routine_order: number | null;
      icon: string | null;
    }>;
  };
}

async function routineStepTitles(page: Page): Promise<string[]> {
  return page
    .locator("[data-testid='routine-stack-editor'] ol > li")
    .evaluateAll((rows) =>
      rows
        .map((row) => row.querySelector("p")?.textContent?.trim() ?? "")
        .filter(Boolean),
    );
}

async function pairViaApi(
  parent: Page,
  tablet: Page,
  label: string,
): Promise<void> {
  await parent.goto("/dashboard/settings/devices");
  const csrf = await parent.evaluate(
    () =>
      document.cookie
        .split("; ")
        .find((c) => c.startsWith("csrf_token="))
        ?.slice(11) ?? "",
  );
  const created = await parent.evaluate(
    async ({ csrfToken, tabletLabel }) => {
      const res = await fetch("/api/family/devices/pairings", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ label: tabletLabel }),
      });
      return { status: res.status, body: await res.text() };
    },
    { csrfToken: csrf, tabletLabel: label },
  );
  expect(created.status, created.body).toBe(201);
  const { pairingId, code } = JSON.parse(created.body) as {
    pairingId: string;
    code: string;
  };
  await tablet.goto("/device/pair");
  const claim = await tablet.evaluate(async (pairingCode) => {
    const csrfToken =
      document.cookie
        .split("; ")
        .find((c) => c.startsWith("csrf_token="))
        ?.slice(11) ?? "";
    const res = await fetch("/api/device/pair/claim", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({
        code: pairingCode,
        platform: "web",
        appVersion: "profile-e2e",
      }),
    });
    return { status: res.status, body: await res.text() };
  }, code);
  expect(claim.status, claim.body).toBe(200);
  const { claimToken, confirmDigits } = JSON.parse(claim.body) as {
    claimToken: string;
    confirmDigits: string;
  };
  const confirm = await parent.evaluate(
    async ({ id, digits }) => {
      const csrfToken =
        document.cookie
          .split("; ")
          .find((c) => c.startsWith("csrf_token="))
          ?.slice(11) ?? "";
      const res = await fetch(`/api/family/devices/pairings/${id}/confirm`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ digits }),
      });
      return { status: res.status, body: await res.text() };
    },
    { id: pairingId, digits: confirmDigits },
  );
  expect(confirm.status, confirm.body).toBe(200);
  const status = await tablet.evaluate(async (token) => {
    const csrfToken =
      document.cookie
        .split("; ")
        .find((c) => c.startsWith("csrf_token="))
        ?.slice(11) ?? "";
    const res = await fetch("/api/device/pair/status", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({ claimToken: token }),
    });
    return { status: res.status, body: await res.text() };
  }, claimToken);
  expect(status.status, status.body).toBe(200);
  expect(JSON.parse(status.body).status).toBe("paired");
  await tablet.goto("/device/today");
  await expect(tablet).toHaveURL(/\/device\/today$/);
}

async function deviceFetch(
  page: Page,
  path: string,
  protocol?: "2",
): Promise<{ status: number; body: string }> {
  return page.evaluate(
    async ({ requestPath, memberProtocol }) => {
      const res = await fetch(requestPath, {
        credentials: "same-origin",
        headers: memberProtocol ? { "X-Member-Protocol": memberProtocol } : {},
      });
      return { status: res.status, body: await res.text() };
    },
    { requestPath: path, memberProtocol: protocol },
  );
}

async function inspectBoard(
  page: Page,
  title: string,
  info: TestInfo,
  label: string,
): Promise<void> {
  await expect(page.getByTestId("today-board")).toBeVisible();
  await expect(page.getByTestId("today-board")).toContainText(title);
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, `${label} horizontal overflow`).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations, `${label} accessibility`).toEqual([]);
  await info.attach(label, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

async function cleanupOwned(x: OwnedNames): Promise<void> {
  await withDb(async (db) => {
    const users = await db.query<{ id: string; family_id: string | null }>(
      `SELECT id, family_id FROM "User" WHERE email=$1`,
      [x.parent.email],
    );
    const familyRows = await db.query<{ id: string }>(
      `SELECT id FROM "Family" WHERE name=$1`,
      [x.family],
    );
    const familyIds = [
      ...new Set(
        [
          ...users.rows.map((row) => row.family_id),
          ...familyRows.rows.map((row) => row.id),
        ].filter((id): id is string => Boolean(id)),
      ),
    ];
    if (!familyIds.length && !users.rows.length) return;
    const deviceRows = await db.query<{ id: string }>(
      `SELECT id FROM "HouseholdDevice" WHERE family_id=ANY($1)`,
      [familyIds],
    );
    const pairingRows = await db.query<{ id: string }>(
      `SELECT id FROM "DevicePairing" WHERE family_id=ANY($1)`,
      [familyIds],
    );
    const rateLimitKeys = [
      ...deviceRows.rows.flatMap(({ id }) => [
        `device-write:${id}`,
        `device-board-version:${id}`,
      ]),
      ...pairingRows.rows.map(({ id }) => `device-pair-status:${id}`),
      ...users.rows.flatMap(({ id }) => [
        `device-pair-create:${id}`,
        `device-pair-poll:${id}`,
      ]),
      ...familyIds.map((id) => `device-pair-create-fam:${id}`),
    ];
    await db.query(`DELETE FROM "HouseholdDevice" WHERE family_id=ANY($1)`, [
      familyIds,
    ]);
    await db.query(`DELETE FROM "DevicePairing" WHERE family_id=ANY($1)`, [
      familyIds,
    ]);
    await db.query(`DELETE FROM "DeviceAuditEvent" WHERE family_id=ANY($1)`, [
      familyIds,
    ]);
    await db.query(`DELETE FROM "Chore" WHERE family_id=ANY($1)`, [familyIds]);
    await db.query(`DELETE FROM "Family" WHERE id=ANY($1)`, [familyIds]);
    await db.query(`DELETE FROM "User" WHERE id=ANY($1)`, [
      users.rows.map((row) => row.id),
    ]);
    await db.query(
      `DELETE FROM "RateLimitEntry" WHERE key LIKE $1 OR key=ANY($2)`,
      [`%${x.prefix}%`, rateLimitKeys],
    );
  });
}

test.describe.serial("email-free profile chore vertical", () => {
  test("creates, pairs, completes, undoes and verifies a profile chore", async ({
    page,
    browser,
  }, info) => {
    test.skip(
      !PROFILE_GATES_ON,
      "Requires HOUSEHOLD_PROFILE_SETUP_ENABLED=1, HOUSEHOLD_PROFILE_CHORE_ENABLED=1 and HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY=1",
    );
    test.setTimeout(240_000);
    assertFixtureTargetAllowed(process.env);
    const x = names(info);
    const ip = clientIp(info);
    let tabletContext: BrowserContext | undefined;
    let foreignContext: { context: BrowserContext; page: Page } | undefined;
    let familyId = "";
    let originalDeviceWrites = false;
    try {
      await page.setExtraHTTPHeaders({ "X-Forwarded-For": ip });
      await register(page, x.parent, ip);
      await createFamilyAndProfiles(page, x);
      await identity(page, info);
      const profileResponse = await browserFetch(page, "/api/family/profiles");
      expect(profileResponse.status, profileResponse.body).toBe(200);
      const profileRows = (
        JSON.parse(profileResponse.body) as {
          profiles: { id: string; name: string }[];
        }
      ).profiles;
      const child = profileRows.find(
        (profile) => profile.name === x.profiles[0].name,
      );
      expect(child).toBeTruthy();
      const device = await enableOwnedDeviceWrites(x);
      familyId = device.familyId;
      originalDeviceWrites = device.original;
      const choreId = await createProfileChore(page, x, child!.id);
      const persisted = await withDb((db) =>
        db.query<{
          assigned_member_id: string | null;
          assigned_to: string | null;
        }>(
          `SELECT assigned_member_id, assigned_to FROM "Chore" WHERE id=$1 AND family_id=$2`,
          [choreId, familyId],
        ),
      );
      expect(persisted.rows).toEqual([
        { assigned_member_id: child!.id, assigned_to: null },
      ]);

      const tablet = await openContext(browser, info);
      tabletContext = tablet.context;
      await pairViaApi(page, tablet.page, "Profile QA tablet");
      const p1 = await deviceFetch(tablet.page, "/api/device/today");
      expect(p1.status, p1.body).toBe(409);
      expect(JSON.parse(p1.body).error.code).toBe(
        "MEMBER_PROTOCOL_UNAVAILABLE",
      );
      const board = await deviceFetch(tablet.page, "/api/device/today", "2");
      expect(board.status, board.body).toBe(200);
      expect(board.body).toContain(x.chore);
      expect(board.body).toContain(x.profiles[0].name);
      expect(board.body).not.toMatch(
        /email|avatar_url|family_id|\"age\"|\"role\"|assigned_to/,
      );
      const versionP1 = await deviceFetch(
        tablet.page,
        "/api/device/today/version",
      );
      expect(versionP1.status).toBe(409);
      await inspectBoard(
        tablet.page,
        x.chore,
        info,
        `${info.project.name}-profile-device-board`,
      );

      const choreButton = tablet.page
        .getByTestId("board-chore")
        .filter({ hasText: x.chore })
        .getByRole("button");
      const complete = tablet.page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/device/chores/${choreId}/complete`) &&
          response.request().method() === "POST",
      );
      await choreButton.click();
      const chooser = tablet.page.getByTestId("who-is-this");
      await expect(chooser).toBeVisible();
      await chooser
        .getByRole("button", { name: x.profiles[0].name, exact: true })
        .click();
      expect((await complete).status()).toBe(200);
      await expect(tablet.page.getByTestId("undo-toast")).toBeVisible();
      const undo = tablet.page
        .getByTestId("undo-toast")
        .getByRole("button", { name: "Undo", exact: true });
      const uncomplete = tablet.page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/device/chores/${choreId}/uncomplete`) &&
          response.request().method() === "POST",
      );
      await undo.click();
      expect((await uncomplete).status()).toBe(200);
      await expect(
        tablet.page.getByTestId("board-chore").filter({ hasText: x.chore }),
      ).toBeVisible();

      const completeAgain = tablet.page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/device/chores/${choreId}/complete`) &&
          response.request().method() === "POST",
      );
      await tablet.page
        .getByTestId("board-chore")
        .filter({ hasText: x.chore })
        .getByRole("button")
        .click();
      expect((await completeAgain).status()).toBe(200);
      await expect(tablet.page.getByTestId("undo-toast")).toBeVisible();

      await page.goto("/dashboard/chores");
      await expect(page.getByText(x.chore, { exact: true })).toBeVisible();
      const verify = page.getByRole("button", {
        name: `Verify “${x.chore}”`,
        exact: true,
      });
      await expect(verify).toBeVisible();
      const verified = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/chores/verify") &&
          response.request().method() === "POST",
      );
      await verify.click();
      expect((await verified).status()).toBe(200);
      await expect(
        page.getByRole("button", { name: `Verify “${x.chore}”`, exact: true }),
      ).toHaveCount(0);
      await expectNoHorizontalOverflow(page, "parent chores verification");

      foreignContext = await openContext(
        browser,
        info,
        "e2e/.auth/parentB.json",
      );
      await foreignContext.page.goto("/dashboard/today");
      await expect(
        foreignContext.page.getByTestId("today-board"),
      ).toBeVisible();
      await expect(foreignContext.page.locator("body")).not.toContainText(
        x.chore,
      );
      const foreignVersion = await browserFetch(
        foreignContext.page,
        "/api/family/board-version",
      );
      expect(foreignVersion.status).toBe(200);
      await info.attach("profile-chore-foreign-privacy", {
        body: await foreignContext.page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    } finally {
      await tabletContext?.close().catch(() => undefined);
      await foreignContext?.context.close().catch(() => undefined);
      if (familyId) {
        await withDb((db) =>
          db.query(`UPDATE "Family" SET device_writes_enabled=$2 WHERE id=$1`, [
            familyId,
            originalDeviceWrites,
          ]),
        ).catch(() => undefined);
      }
      await cleanupOwned(x);
    }
  });

  test("builds, persists and completes a picture routine for email-free profiles", async ({
    page,
    browser,
  }, info) => {
    test.skip(
      !PROFILE_GATES_ON,
      "Requires HOUSEHOLD_PROFILE_SETUP_ENABLED=1, HOUSEHOLD_PROFILE_CHORE_ENABLED=1 and HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY=1",
    );
    test.setTimeout(300_000);
    assertFixtureTargetAllowed(process.env);
    const x = names(info);
    const ip = clientIp(info);
    const routine = `${x.prefix} morning picture routine`;
    const date = E2E_ANCHOR.toISOString().slice(0, 10);
    const profileSpecs = [
      { profile: x.profiles[0], icon: "brush-teeth", order: 1 },
      { profile: x.profiles[1], icon: "backpack", order: 2 },
      { profile: x.profiles[2], icon: "make-bed", order: 3 },
    ];
    let tabletContext: BrowserContext | undefined;
    let foreignContext: { context: BrowserContext; page: Page } | undefined;
    let familyId = "";
    let originalDeviceWrites = false;
    try {
      await page.setExtraHTTPHeaders({ "X-Forwarded-For": ip });
      await register(page, x.parent, ip);
      const profileIds = await createFamilyAndProfiles(page, x);
      await identity(page, info);
      const device = await enableOwnedDeviceWrites(x);
      familyId = device.familyId;
      originalDeviceWrites = device.original;

      const chores: ProfileRoutineChore[] = [];
      for (const [index, spec] of profileSpecs.entries()) {
        const title = `${x.prefix} ${spec.profile.role} picture step`;
        const id = await createProfileRoutineChore(page, {
          title,
          profileId: profileIds[spec.profile.name],
          profileName: spec.profile.name,
          profileRole: spec.profile.role,
          icon: spec.icon,
          routine,
          order: spec.order,
        });
        chores.push({
          id,
          title,
          profileId: profileIds[spec.profile.name],
          profileName: spec.profile.name,
          icon: spec.icon,
          routine,
          order: spec.order,
        });
        const persisted = await withDb((db) =>
          db.query<{
            assigned_member_id: string | null;
            assigned_to: string | null;
            icon: string | null;
            routine: string | null;
            routine_order: number | null;
          }>(
            `SELECT assigned_member_id, assigned_to, icon, routine, routine_order FROM "Chore" WHERE id=$1 AND family_id=$2`,
            [id, familyId],
          ),
        );
        expect(persisted.rows).toEqual([
          {
            assigned_member_id: profileIds[spec.profile.name],
            assigned_to: null,
            icon: spec.icon,
            routine,
            routine_order: spec.order,
          },
        ]);
        expect(index).toBeLessThan(profileSpecs.length);
      }

      // The stack API is deliberately opt-in for the email-free member
      // protocol. Keep the header on this parent page only; no account or
      // device request is widened by the profile journey.
      await page.setExtraHTTPHeaders({
        "X-Forwarded-For": ip,
        "X-Member-Protocol": "2",
      });
      await page.goto("/dashboard/chores");
      await page.getByRole("button", { name: "Routines", exact: true }).click();
      await page
        .getByRole("link", { name: "Build a routine", exact: true })
        .click();
      await expect(page.getByTestId("routine-stack-editor")).toBeVisible();
      await expect(
        page.getByText(chores[0].title, { exact: true }),
      ).toBeVisible();

      // Add each real profile chore, then use the editor's move control so the
      // persisted order proves an actual reorder rather than insertion order.
      for (const chore of chores) {
        const candidate = page
          .locator("[data-testid='routine-stack-editor'] li")
          .filter({ hasText: chore.title })
          .filter({
            has: page.getByRole("button", { name: "Add", exact: true }),
          })
          .first();
        await candidate
          .getByRole("button", { name: "Add", exact: true })
          .click();
      }
      await page.locator("#routine-label").fill(routine);
      await expect(
        page.locator("[data-testid='routine-stack-editor'] ol > li"),
      ).toHaveCount(3);
      await page
        .locator("[data-testid='routine-stack-editor'] ol > li")
        .filter({ hasText: chores[0].title })
        .getByRole("button", {
          name: `Move ${chores[0].title} down`,
          exact: true,
        })
        .click();
      expect(await routineStepTitles(page)).toEqual([
        chores[1].title,
        chores[0].title,
        chores[2].title,
      ]);
      await expect(
        page.locator("select[id^='routine-assignee-']").first(),
      ).toContainText(chores[0].profileName);

      const saveResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/chores/stacks") &&
          response.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Save routine", exact: true })
        .click();
      const saved = await saveResponse;
      const savedText = await saved.text();
      expect(saved.status(), savedText).toBe(200);
      const savedBody = JSON.parse(savedText) as { stack_id?: string };
      expect(savedBody.stack_id).toMatch(/^[a-z0-9-]+$/);
      const stackId = savedBody.stack_id!;

      const read = await readProfileRoutineStack(page, stackId);
      expect(read.stack).toMatchObject({ id: stackId, label: routine });
      expect(read.steps.map((step) => step.id)).toEqual([
        chores[1].id,
        chores[0].id,
        chores[2].id,
      ]);
      expect(read.steps).toEqual(
        expect.arrayContaining(
          chores.map((chore) =>
            expect.objectContaining({
              id: chore.id,
              assigned_to: null,
              assigned_member_id: chore.profileId,
              routine_order: expect.any(Number),
              icon: chore.icon,
            }),
          ),
        ),
      );
      await page.goto(
        `/dashboard/chores/routines?stack_id=${encodeURIComponent(stackId)}&occurrence_date=${date}`,
      );
      await expect(page.locator("#routine-label")).toHaveValue(routine);
      expect(await routineStepTitles(page)).toEqual([
        chores[1].title,
        chores[0].title,
        chores[2].title,
      ]);
      await expectNoHorizontalOverflow(page, "profile routine editor");
      const editorAxe = await new AxeBuilder({ page }).analyze();
      expect(
        editorAxe.violations,
        "profile routine editor accessibility",
      ).toEqual([]);

      const tablet = await openContext(browser, info);
      tabletContext = tablet.context;
      await pairViaApi(page, tablet.page, "Profile routine QA tablet");
      const board = await deviceFetch(tablet.page, "/api/device/today", "2");
      expect(board.status, board.body).toBe(200);
      for (const chore of chores) {
        const choreButton = tablet.page
          .getByTestId("board-chore")
          .filter({ hasText: chore.title })
          .getByRole("button");
        await expect(choreButton).toBeVisible();
        const completion = tablet.page.waitForResponse(
          (response) =>
            response
              .url()
              .endsWith(`/api/device/chores/${chore.id}/complete`) &&
            response.request().method() === "POST",
        );
        await choreButton.click();
        const chooser = tablet.page.getByTestId("who-is-this");
        await expect(chooser).toBeVisible();
        await chooser
          .getByRole("button", { name: chore.profileName, exact: true })
          .click();
        expect((await completion).status()).toBe(200);
        await expect(
          tablet.page
            .getByTestId("board-chore")
            .filter({ hasText: chore.title }),
        ).toHaveCount(0);
      }

      // Completion is visible in the parent's real Done/history projection;
      // verify each row through the existing parent action before asserting
      // the durable history surface.
      await page.goto("/dashboard/chores");
      await page.getByRole("button", { name: "All", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Done", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Done", exact: true }).click();
      for (const chore of chores) {
        await expect(
          page.getByText(chore.title, { exact: true }),
        ).toBeVisible();
        const verify = page.getByRole("button", {
          name: `Verify “${chore.title}”`,
          exact: true,
        });
        await expect(verify).toBeVisible();
        const verified = page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/chores/verify") &&
            response.request().method() === "POST",
        );
        await verify.click();
        expect((await verified).status()).toBe(200);
      }
      await page.getByRole("button", { name: "All", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Done", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Done", exact: true }).click();
      for (const chore of chores)
        await expect(
          page.getByText(chore.title, { exact: true }),
        ).toBeVisible();
      await expectNoHorizontalOverflow(page, "profile routine history");

      foreignContext = await openContext(
        browser,
        info,
        "e2e/.auth/parentB.json",
      );
      await foreignContext.page.goto("/dashboard/chores");
      await expect(
        foreignContext.page.getByText(routine, { exact: true }),
      ).toHaveCount(0);
      await expect(foreignContext.page.locator("body")).not.toContainText(
        chores[0].title,
      );
    } finally {
      await tabletContext?.close().catch(() => undefined);
      await foreignContext?.context.close().catch(() => undefined);
      if (familyId) {
        await withDb((db) =>
          db.query(`UPDATE "Family" SET device_writes_enabled=$2 WHERE id=$1`, [
            familyId,
            originalDeviceWrites,
          ]),
        ).catch(() => undefined);
      }
      await cleanupOwned(x);
    }
  });
});

async function expectNoHorizontalOverflow(
  page: Page,
  label: string,
): Promise<void> {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, `${label} horizontal overflow`).toBeLessThanOrEqual(0);
}
