/**
 * Shared tablet (#241; contract docs/architecture/SHARED_DEVICE.md).
 *
 * The E2E server runs with SHARED_DEVICE_ENABLED=1 (playwright.config.ts).
 * In each test the default `page` is the tablet (no person session) and a
 * second browser context is the Family A parent's phone.
 *
 * Covers: pairing through the settings dialog while the tablet claims the
 * code (§5), the board on /device/today from the device DTO, no person
 * email/age/XP or prohibited canary in the HTML, RSC payload or API JSON
 * (§14.1 items 2-3), parent mode with a tablet PIN set in Settings, banner,
 * "Done", hide and reload (§14.5 items 35-36), removal from settings purging
 * the tablet on its next refresh (§14.3 item 23), removal from the tablet,
 * invalid and cancelled pairings, teens/children never reaching device
 * management, axe scans and visual baselines.
 *
 * Every device, pairing, PIN, audit and `device-*` rate-limit row is reset
 * before each test; parent-only canaries (ids `fx_e2e_device_*`) are inserted
 * before the tests and removed afterwards. The fixture guard refuses
 * production-like databases.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import pg from "pg";
import {
  FIXTURE_EMAILS,
  FIXTURE_IDS,
  FIXTURE_PASSWORD,
} from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { E2E_ANCHOR, authFile } from "./support/env";
import { browserFetch, expect, test } from "./support/test";

const A = FIXTURE_IDS.familyA;
const FAMILIES = [
  FIXTURE_IDS.familyA.family,
  FIXTURE_IDS.familyB.family,
  FIXTURE_IDS.familyEmpty.family,
];
const PARENT_NAME = "Avery Fixture-A";
const PIN = "246810";
const TABLET_PROJECTS = [
  "fridge-landscape-1280x800",
  "tablet-portrait-800x1280",
];

const IDS = {
  transaction: "fx_e2e_device_txn",
  message: "fx_e2e_device_msg",
  medication: "fx_e2e_device_med",
};

/** Must never reach a device page, its RSC payload or the device API. */
const CANARIES = [
  "DEVICE-CANARY-BUDGET",
  "DEVICE-CANARY-PRIVATE-MESSAGE",
  "DEVICE-CANARY-MEDICATION",
  "DEVICE-CANARY-MEDICAL-NOTE",
  // Fixture event locations (one is a street address).
  "123 Example Street",
  "Fixture Elementary",
  // Every fixture email.
  ...Object.values(FIXTURE_EMAILS).flatMap((f) => Object.values(f)),
  "example.test",
];

/** Person-profile keys that must not be serialised for a device. */
const PROHIBITED_KEYS = [
  '"email"',
  '"age"',
  '"avatar_url"',
  '"xp"',
  '"level"',
  '"streak"',
  '"best_streak"',
  '"family_id"',
];

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

async function resetDeviceState(db: pg.Client) {
  // HouseholdDevice cascades to DeviceSession.
  await db.query(`DELETE FROM "HouseholdDevice" WHERE family_id = ANY($1)`, [
    FAMILIES,
  ]);
  await db.query(`DELETE FROM "DevicePairing" WHERE family_id = ANY($1)`, [
    FAMILIES,
  ]);
  await db.query(`DELETE FROM "DeviceAuditEvent" WHERE family_id = ANY($1)`, [
    FAMILIES,
  ]);
  await db.query(`DELETE FROM "ParentElevationPin" WHERE family_id = ANY($1)`, [
    FAMILIES,
  ]);
  await db.query(`DELETE FROM "RateLimitEntry" WHERE key LIKE 'device-%'`);
}

async function removeCanaries(db: pg.Client) {
  await db.query(`DELETE FROM "Transaction" WHERE id = $1`, [IDS.transaction]);
  await db.query(`DELETE FROM "Message" WHERE id = $1`, [IDS.message]);
  await db.query(`DELETE FROM "Medication" WHERE id = $1`, [IDS.medication]);
}

test.beforeAll(async () => {
  await withDb(async (db) => {
    await removeCanaries(db);
    const now = new Date();
    await db.query(
      `INSERT INTO "Transaction" (id, family_id, user_id, amount, type, description, date, created_at, updated_at)
       VALUES ($1, $2, $3, 4321.09, 'expense', 'DEVICE-CANARY-BUDGET', $4, $5, $5)`,
      [IDS.transaction, A.family, A.parent, E2E_ANCHOR, now],
    );
    await db.query(
      `INSERT INTO "Message" (id, family_id, sender_id, content, attachments, read_by, created_at)
       VALUES ($1, $2, $3, 'DEVICE-CANARY-PRIVATE-MESSAGE', '{}', '{}', $4)`,
      [IDS.message, A.family, A.parent, now],
    );
    await db.query(
      `INSERT INTO "Medication" (id, family_id, person_id, name, dosage, schedule, notes, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, 'DEVICE-CANARY-MEDICATION', '5 ml', 'daily', 'DEVICE-CANARY-MEDICAL-NOTE', $4, $5, $5)`,
      [IDS.medication, A.family, A.child, A.parent, now],
    );
  });
});

test.afterAll(async () => {
  await withDb(async (db) => {
    await removeCanaries(db);
    await resetDeviceState(db);
  });
});

test.beforeEach(async () => {
  await withDb(resetDeviceState);
});

// ---------------------------------------------------------------------------
// Helpers

/** A second browser context with the same project settings (viewport, zone, client address). */
async function openContext(
  browser: Browser,
  testInfo: TestInfo,
  storageState?: string,
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
    storageState,
  });
  const page = await context.newPage();
  await page.clock.install({ time: E2E_ANCHOR });
  return { context, page };
}

/** Same-origin JSON request from inside the page, with the CSRF header (any method). */
async function send(
  page: Page,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return page.evaluate(
    async ({ m, p, b, h }) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((c) => c.startsWith("csrf_token="))
          ?.slice("csrf_token=".length) ?? "";
      const res = await fetch(p, {
        method: m,
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf,
          ...h,
        },
        body: b === undefined ? undefined : JSON.stringify(b),
      });
      return { status: res.status, body: await res.text() };
    },
    { m: method, p: path, b: body, h: headers },
  );
}

const region = (page: Page, name: string) => page.getByTestId(`region-${name}`);

async function expectBoard(tablet: Page) {
  await expect(tablet).toHaveURL(/\/device\/today$/);
  await expect(region(tablet, "today")).toBeVisible();
  await expect(region(tablet, "today")).toContainText("Dentist (Casey)");
  await expect(region(tablet, "groceries")).toContainText("Milk");
}

/** Pair through the real UI on both sides (parent dialog + tablet screen). */
async function pairViaUi(parent: Page, tablet: Page, label: string) {
  await parent.goto("/dashboard/settings/devices");
  await parent.getByRole("button", { name: "Pair a tablet" }).click();
  const dialog = parent.getByTestId("pair-dialog");
  await dialog.getByLabel("Tablet name").fill(label);
  await dialog.getByRole("button", { name: "Get a code" }).click();
  const code = (await dialog.getByTestId("pairing-code").innerText()).trim();
  expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  await expect(dialog.getByTestId("pairing-expiry")).toContainText(
    "Expires in",
  );

  await tablet.goto("/device/pair");
  // Lower case with a space instead of the dash: normalised on input.
  const input = tablet.getByLabel("Pairing code");
  await input.fill(code.toLowerCase().replace("-", " "));
  await expect(input).toHaveValue(code);
  await tablet.getByRole("button", { name: "Connect" }).click();
  const digits = (
    await tablet.getByTestId("confirm-digits").innerText()
  ).trim();
  expect(digits).toMatch(/^\d{4}$/);
  await expect(
    tablet.getByRole("status").filter({ hasText: "Waiting for a parent" }),
  ).toBeVisible();

  // The parent's dialog polls and switches to the confirmation step.
  const digitsInput = dialog.getByLabel("Number on the tablet");
  await expect(digitsInput).toBeVisible({ timeout: 15_000 });
  await digitsInput.fill(digits);
  await dialog.getByRole("button", { name: "Connect tablet" }).click();

  // The tablet polls, gets its cookies and opens the board.
  await expect(tablet).toHaveURL(/\/device\/today$/, { timeout: 20_000 });
  await expect(dialog.getByText(`${label} is connected`)).toBeVisible({
    timeout: 15_000,
  });
  await dialog.getByRole("button", { name: "Done" }).click();
}

/** Fast pairing through the same public/parent APIs (for tests about later states). */
async function pairViaApi(
  parent: Page,
  tablet: Page,
  label = "Kitchen tablet",
) {
  await parent.goto("/dashboard/settings/devices");
  const created = await send(parent, "POST", "/api/family/devices/pairings", {
    label,
  });
  expect(created.status, created.body).toBe(201);
  const { pairingId, code } = JSON.parse(created.body);

  await tablet.goto("/device/pair");
  const claim = await send(tablet, "POST", "/api/device/pair/claim", {
    code,
    platform: "web",
    appVersion: "web",
  });
  expect(claim.status, claim.body).toBe(200);
  const { claimToken, confirmDigits } = JSON.parse(claim.body);

  const confirm = await send(
    parent,
    "POST",
    `/api/family/devices/pairings/${pairingId}/confirm`,
    { digits: confirmDigits },
  );
  expect(confirm.status, confirm.body).toBe(200);

  const status = await send(tablet, "POST", "/api/device/pair/status", {
    claimToken,
  });
  expect(status.status, status.body).toBe(200);
  expect(JSON.parse(status.body).status).toBe("paired");

  await tablet.goto("/device/today");
  await expectBoard(tablet);
}

async function setPinViaSettings(parent: Page, pin: string) {
  await parent.goto("/dashboard/settings");
  const row = parent.getByTestId("tablet-pin");
  await row.getByRole("button", { name: /Set PIN|Change PIN/ }).click();
  const dialog = parent.getByTestId("pin-dialog");
  await dialog.getByLabel("New 6-digit PIN").fill(pin);
  await dialog.getByLabel("Confirm PIN").fill(pin);
  await dialog.getByLabel("Current password").fill(FIXTURE_PASSWORD);
  await dialog.getByRole("button", { name: "Save PIN" }).click();
}

async function elevate(tablet: Page) {
  await tablet.getByRole("button", { name: "Parent", exact: true }).click();
  const sheet = tablet.getByTestId("elevation-sheet");
  await sheet.getByRole("button", { name: PARENT_NAME }).click();
  const pad = sheet.getByRole("group", {
    name: `Tablet PIN pad for ${PARENT_NAME}`,
  });
  for (const digit of PIN) {
    await pad.getByRole("button", { name: digit, exact: true }).click();
  }
  await expect(tablet.getByTestId("elevated-banner")).toBeVisible();
  await expect(sheet).toBeHidden();
}

async function storageDump(page: Page): Promise<string> {
  return page.evaluate(() =>
    JSON.stringify({
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage),
    }),
  );
}

async function axeScan(
  page: Page,
  testInfo: TestInfo,
  label: string,
  include?: string,
) {
  let builder = new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude("next-route-announcer");
  // Scope to this change's UI on pages that also hold older, unrelated sections.
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
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

function expectClean(body: string, where: string) {
  for (const canary of CANARIES) {
    expect(body, `"${canary}" leaked into ${where}`).not.toContain(canary);
  }
  for (const key of PROHIBITED_KEYS) {
    expect(body, `${key} serialised into ${where}`).not.toContain(key);
  }
}

// ---------------------------------------------------------------------------

test.describe("Shared tablet", () => {
  test("a parent pairs a tablet from settings and the tablet shows the board", async ({
    page: tablet,
    browser,
  }, testInfo) => {
    const parent = await openContext(browser, testInfo, authFile("parentA"));
    try {
      await pairViaUi(parent.page, tablet, "Kitchen tablet");
      await expectBoard(tablet);

      // Device audience: no links into person pages.
      const hrefs = await tablet
        .getByTestId("today-board")
        .locator("a")
        .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
      expect(hrefs.filter((h) => h?.startsWith("/dashboard"))).toEqual([]);
      await expect(
        tablet.getByRole("button", { name: "Parent", exact: true }),
      ).toBeVisible();

      // The tablet holds device cookies only, never a person session.
      const names = (await tablet.context().cookies()).map((c) => c.name);
      expect(names).toEqual(
        expect.arrayContaining(["fp_device", "fp_device_refresh"]),
      );
      expect(names).not.toContain("session_token");

      // HTML, RSC payload and the device API carry no person profile or canary.
      expectClean(await tablet.content(), "/device/today HTML");
      const rsc = await tablet.evaluate(async () => {
        const res = await fetch("/device/today", { headers: { RSC: "1" } });
        return res.text();
      });
      expect(rsc.length).toBeGreaterThan(0);
      expectClean(rsc, "/device/today RSC payload");
      const api = await browserFetch(tablet, "/api/device/today");
      expect(api.status).toBe(200);
      expectClean(api.body, "GET /api/device/today");
      const me = await browserFetch(tablet, "/api/device/me");
      expect(me.status).toBe(200);
      expectClean(me.body, "GET /api/device/me");

      // A device alone never reaches a person page (§4 cold-launch redirect).
      await tablet.goto("/dashboard/budget");
      await expect(tablet).toHaveURL(/\/device\/today$/);
      await tablet.goto("/login");
      await expect(tablet).toHaveURL(/\/device\/today$/);

      // The parent's list shows it as active, with its recent activity.
      await parent.page.goto("/dashboard/settings/devices");
      const row = parent.page.getByTestId("device-row");
      await expect(row).toHaveCount(1);
      await expect(row).toContainText("Kitchen tablet");
      await expect(row).toContainText("Active");
      await expect(row).toContainText("Active now");
      await row.getByRole("button", { name: "Recent activity" }).click();
      await expect(row.getByTestId("device-activity")).toContainText(
        `Paired by ${PARENT_NAME}`,
      );
    } finally {
      await parent.context.close();
    }
  });

  test("parent mode with a tablet PIN: banner, Done, hide, reload, rename and remove", async ({
    page: tablet,
    browser,
  }, testInfo) => {
    const parent = await openContext(browser, testInfo, authFile("parentA"));
    try {
      // PIN set in Settings → Privacy & Security → Tablet PIN; common PINs are refused.
      await setPinViaSettings(parent.page, "123456");
      await expect(parent.page.getByTestId("pin-dialog")).toContainText(
        "too easy to guess",
      );
      await parent.page
        .getByTestId("pin-dialog")
        .getByRole("button", { name: "Cancel" })
        .click();
      await setPinViaSettings(parent.page, PIN);
      await expect(parent.page.getByTestId("tablet-pin")).toContainText(
        "Tablet PIN saved.",
      );

      await pairViaApi(parent.page, tablet);

      // A wrong PIN is refused without elevating.
      await tablet.getByRole("button", { name: "Parent", exact: true }).click();
      const sheet = tablet.getByTestId("elevation-sheet");
      await sheet.getByRole("button", { name: PARENT_NAME }).click();
      const pad = sheet.getByRole("group", {
        name: `Tablet PIN pad for ${PARENT_NAME}`,
      });
      for (const digit of "135790") {
        await pad.getByRole("button", { name: digit, exact: true }).click();
      }
      await expect(sheet.getByRole("alert")).toContainText(
        "That PIN didn't work",
      );
      await sheet.getByRole("button", { name: "Close" }).click();

      // 1. Elevate, then "Done".
      await elevate(tablet);
      const banner = tablet.getByTestId("elevated-banner");
      await expect(banner).toContainText(`Parent mode: ${PARENT_NAME}`);
      const dump = await storageDump(tablet);
      expect(dump).not.toContain("fpd1_");
      await banner.getByRole("button", { name: "Done" }).click();
      await expect(banner).toBeHidden();
      await expect(tablet.getByTestId("device-status")).toContainText(
        "Parent mode ended.",
      );
      // Back in shared mode, an elevated-only action is refused.
      const refused = await send(tablet, "PATCH", "/api/device/label", {
        label: "Sneaky",
      });
      expect(refused.status).toBe(403);
      expect(JSON.parse(refused.body).error.code).toBe("ELEVATION_REQUIRED");

      // 2. Backgrounding the app ends parent mode.
      await elevate(tablet);
      await tablet.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await expect(tablet.getByTestId("elevated-banner")).toBeHidden();
      await tablet.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "visible",
        });
      });

      // 3. A reload ends parent mode (memory-only token).
      await elevate(tablet);
      await tablet.reload();
      await expect(region(tablet, "today")).toBeVisible();
      await expect(tablet.getByTestId("elevated-banner")).toBeHidden();
      expect(await storageDump(tablet)).not.toContain("fpd1_");

      // 4. Rename under parent mode.
      await elevate(tablet);
      await tablet
        .getByTestId("elevated-banner")
        .getByRole("button", { name: "Rename tablet" })
        .click();
      const rename = tablet.getByTestId("device-rename");
      await rename.getByLabel("Tablet name").fill("Hall tablet");
      await rename.getByRole("button", { name: "Save name" }).click();
      await expect(tablet.getByTestId("device-status")).toContainText(
        "Renamed to Hall tablet.",
      );

      // 5. "Remove this tablet" under parent mode purges and shows the removed screen.
      await tablet.evaluate(() =>
        localStorage.setItem("fp-device:v1:probe", "x"),
      );
      await tablet
        .getByTestId("elevated-banner")
        .getByRole("button", { name: "Remove this tablet" })
        .click();
      await tablet
        .getByTestId("device-remove")
        .getByRole("button", { name: "Remove tablet" })
        .click();
      await expect(tablet).toHaveURL(/\/device\/removed$/);
      await expect(tablet.getByTestId("device-removed")).toBeVisible();
      expect(await storageDump(tablet)).not.toContain("fp-device:v1:");

      await parent.page.goto("/dashboard/settings/devices");
      const row = parent.page.getByTestId("device-row");
      await expect(row).toContainText("Hall tablet");
      await expect(row).toHaveAttribute("data-status", "removed");
    } finally {
      await parent.context.close();
    }
  });

  test("removing the tablet in settings purges it on its next refresh", async ({
    page: tablet,
    browser,
  }, testInfo) => {
    const parent = await openContext(browser, testInfo, authFile("parentA"));
    try {
      await pairViaApi(parent.page, tablet);
      await tablet.evaluate(() => {
        localStorage.setItem("fp-device:v1:probe:today", '{"cached":true}');
        localStorage.setItem("fp-device:v1:queue", "[]");
        sessionStorage.setItem("fp-device:v1:scratch", "x");
        localStorage.setItem("unrelated-key", "kept");
      });

      await parent.page.goto("/dashboard/settings/devices");
      const row = parent.page.getByTestId("device-row");
      await row.getByRole("button", { name: "Remove tablet" }).click();
      const dialog = parent.page.getByTestId("remove-device");
      await expect(dialog).toContainText(
        "It stops showing your family's information the next time it connects.",
      );
      await dialog.getByLabel("Lost or stolen").check();
      await dialog.getByRole("button", { name: "Remove tablet" }).click();
      await expect(row).toHaveAttribute("data-status", "removed");
      await expect(row).toContainText("Removed");
      await expect(row).toContainText("(lost)");

      // The board's own 5-minute refresh hits DEVICE_REVOKED and purges.
      await tablet.clock.runFor(5 * 60 * 1000);
      await expect(tablet).toHaveURL(/\/device\/removed$/);
      await expect(
        tablet.getByRole("heading", { name: "This tablet is disconnected" }),
      ).toBeVisible();
      const dump = await storageDump(tablet);
      expect(dump).not.toContain("fp-device:v1:");
      expect(dump).toContain("unrelated-key");
      const names = (await tablet.context().cookies()).map((c) => c.name);
      expect(names).not.toContain("fp_device");
      expect(names).not.toContain("fp_device_refresh");

      // Back never returns to the household's data.
      await tablet.goBack();
      await expect(tablet.getByTestId("today-board")).toHaveCount(0);
      // The board route now sends the tablet to pairing.
      await tablet.goto("/device/today");
      await expect(tablet).toHaveURL(/\/device\/pair$/);

      await tablet.goto("/device/removed");
      await tablet.getByRole("link", { name: "Pair this tablet" }).click();
      await expect(tablet).toHaveURL(/\/device\/pair$/);
    } finally {
      await parent.context.close();
    }
  });

  test("replacing a tablet works at the 5-tablet limit and removes the old one", async ({
    page: oldTablet,
    browser,
  }, testInfo) => {
    const parent = await openContext(browser, testInfo, authFile("parentA"));
    const newTablet = await openContext(browser, testInfo);
    try {
      await pairViaApi(parent.page, oldTablet);
      // Fill the household to the limit with four more (spec-owned) tablets.
      await withDb(async (db) => {
        for (let i = 1; i <= 4; i++) {
          await db.query(
            `INSERT INTO "HouseholdDevice" (id, family_id, label, platform, paired_at, created_at, updated_at)
             VALUES ($1, $2, $3, 'web', $4, $4, $4)`,
            [
              `fx_e2e_device_spare_${i}`,
              A.family,
              `Spare tablet ${i}`,
              E2E_ANCHOR,
            ],
          );
        }
      });

      await parent.page.goto("/dashboard/settings/devices");
      await expect(parent.page.getByTestId("device-row")).toHaveCount(5);
      // A plain pairing is refused at the limit.
      await parent.page.getByRole("button", { name: "Pair a tablet" }).click();
      const dialog = parent.page.getByTestId("pair-dialog");
      await dialog.getByRole("button", { name: "Get a code" }).click();
      await expect(dialog.getByRole("alert")).toContainText("5 tablets");
      await dialog.getByRole("button", { name: "Cancel" }).click();

      const oldRow = parent.page
        .getByTestId("device-row")
        .filter({ hasText: "Kitchen tablet" });
      await oldRow.getByRole("button", { name: "Replace" }).click();
      await expect(
        dialog.getByLabel(
          "Remove Kitchen tablet when the new one is connected",
        ),
      ).toBeChecked();
      await dialog.getByLabel("Tablet name").fill("New kitchen tablet");
      await dialog.getByRole("button", { name: "Get a code" }).click();
      const code = (
        await dialog.getByTestId("pairing-code").innerText()
      ).trim();

      await newTablet.page.goto("/device/pair");
      await newTablet.page.getByLabel("Pairing code").fill(code);
      await newTablet.page.getByRole("button", { name: "Connect" }).click();
      const digits = (
        await newTablet.page.getByTestId("confirm-digits").innerText()
      ).trim();
      const digitsInput = dialog.getByLabel("Number on the tablet");
      await expect(digitsInput).toBeVisible({ timeout: 15_000 });
      await digitsInput.fill(digits);
      await dialog.getByRole("button", { name: "Connect tablet" }).click();
      await expect(newTablet.page).toHaveURL(/\/device\/today$/, {
        timeout: 20_000,
      });
      // Reported from the server's answer, not assumed.
      await expect(dialog.getByRole("status")).toContainText(
        "Kitchen tablet was removed.",
        { timeout: 15_000 },
      );
      await dialog.getByRole("button", { name: "Done" }).click();

      await expect(
        parent.page
          .getByTestId("device-row")
          .filter({ hasText: "New kitchen tablet" }),
      ).toHaveAttribute("data-status", "active");
      await expect(
        parent.page
          .getByTestId("device-row")
          .filter({ hasText: /^Kitchen tablet/ }),
      ).toHaveAttribute("data-status", "removed");
      await expect(
        parent.page.locator(
          '[data-testid="device-row"][data-status="removed"]',
        ),
      ).toContainText("(replaced)");

      // The old tablet is purged on its next refresh.
      await oldTablet.clock.runFor(5 * 60 * 1000);
      await expect(oldTablet).toHaveURL(/\/device\/removed$/);
    } finally {
      await newTablet.context.close();
      await parent.context.close();
    }
  });

  test("pairing handles an invalid code and a parent who cancels", async ({
    page: tablet,
    browser,
  }, testInfo) => {
    await tablet.goto("/device/pair");
    await tablet.getByLabel("Pairing code").fill("ZZZZ-ZZZZ");
    await tablet.getByRole("button", { name: "Connect" }).click();
    await expect(
      tablet.getByTestId("device-pair").getByRole("alert"),
    ).toContainText("That code did not work");

    const parent = await openContext(browser, testInfo, authFile("parentA"));
    try {
      await parent.page.goto("/dashboard/settings/devices");
      await parent.page.getByRole("button", { name: "Pair a tablet" }).click();
      const dialog = parent.page.getByTestId("pair-dialog");
      await dialog.getByRole("button", { name: "Get a code" }).click();
      const code = (
        await dialog.getByTestId("pairing-code").innerText()
      ).trim();

      await tablet.getByLabel("Pairing code").fill(code);
      await tablet.getByRole("button", { name: "Connect" }).click();
      await expect(tablet.getByTestId("confirm-digits")).toBeVisible();

      await dialog
        .getByRole("button", { name: "This isn't my tablet" })
        .click({ timeout: 15_000 });
      await expect(dialog.getByRole("alert")).toContainText(
        "Pairing cancelled.",
      );
      await expect(
        tablet.getByRole("heading", { name: "Pairing was cancelled" }),
      ).toBeVisible({ timeout: 15_000 });
      await tablet.getByRole("button", { name: "Enter a new code" }).click();
      await expect(tablet.getByLabel("Pairing code")).toHaveValue("");
    } finally {
      await parent.context.close();
    }
  });

  test("teens and children never see device management", async ({
    browser,
  }, testInfo) => {
    const child = await openContext(browser, testInfo, authFile("childA"));
    try {
      await child.page.goto("/dashboard/settings/devices");
      await expect(child.page).toHaveURL(/\/dashboard$/);
      const api = await browserFetch(child.page, "/api/family/devices");
      expect(api.status).toBe(403);
    } finally {
      await child.context.close();
    }

    const teen = await openContext(browser, testInfo);
    try {
      const login = await teen.page.request.post("/api/auth/login", {
        data: {
          email: FIXTURE_EMAILS.familyA.teen,
          password: FIXTURE_PASSWORD,
        },
      });
      expect(login.status(), await login.text()).toBe(200);
      await teen.page.goto("/dashboard/settings/devices");
      await expect(teen.page).toHaveURL(/\/dashboard$/);
      await teen.page.goto("/dashboard/settings");
      await expect(teen.page).toHaveURL(/\/dashboard$/);
      const api = await browserFetch(teen.page, "/api/family/devices");
      expect(api.status).toBe(403);
      const pin = await send(teen.page, "PUT", "/api/users/elevation-pin", {
        pin: PIN,
        currentPassword: FIXTURE_PASSWORD,
      });
      expect(pin.status).toBe(403);
    } finally {
      await teen.context.close();
    }
  });

  test("axe: pair, removed, elevated banner and device list", async ({
    page: tablet,
    browser,
  }, testInfo) => {
    await tablet.goto("/device/pair");
    await expect(tablet.getByLabel("Pairing code")).toBeVisible();
    await axeScan(tablet, testInfo, "/device/pair");

    await tablet.goto("/device/removed");
    await expect(tablet.getByTestId("device-removed")).toBeVisible();
    await axeScan(tablet, testInfo, "/device/removed");

    const parent = await openContext(browser, testInfo, authFile("parentA"));
    try {
      await setPinViaSettings(parent.page, PIN);
      await expect(parent.page.getByTestId("tablet-pin")).toContainText(
        "Tablet PIN saved.",
      );
      await axeScan(
        parent.page,
        testInfo,
        "/dashboard/settings (tablet PIN row)",
        '[data-testid="tablet-pin"]',
      );
      await parent.page
        .getByTestId("tablet-pin")
        .getByRole("button", { name: "Change PIN" })
        .click();
      await expect(parent.page.getByTestId("pin-dialog")).toBeVisible();
      await axeScan(
        parent.page,
        testInfo,
        "tablet PIN dialog",
        '[data-testid="pin-dialog"]',
      );
      await parent.page
        .getByTestId("pin-dialog")
        .getByRole("button", { name: "Cancel" })
        .click();

      await pairViaApi(parent.page, tablet);
      await elevate(tablet);
      await axeScan(tablet, testInfo, "/device/today (parent mode)");

      await parent.page.goto("/dashboard/settings/devices");
      await expect(parent.page.getByTestId("device-row")).toHaveCount(1);
      await axeScan(parent.page, testInfo, "/dashboard/settings/devices");

      await parent.page.getByRole("button", { name: "Pair a tablet" }).click();
      await parent.page
        .getByTestId("pair-dialog")
        .getByRole("button", { name: "Get a code" })
        .click();
      await expect(
        parent.page.getByTestId("pair-dialog").getByTestId("pairing-code"),
      ).toBeVisible();
      await axeScan(parent.page, testInfo, "pair dialog (code)");
    } finally {
      await parent.context.close();
    }
  });

  test("@visual shared tablet baselines", async ({
    page: tablet,
    browser,
  }, testInfo) => {
    test.skip(
      !TABLET_PROJECTS.includes(testInfo.project.name),
      "Tablet baselines are kept for the two primary tablet sizes only.",
    );

    await tablet.goto("/device/pair");
    await expect(tablet.getByLabel("Pairing code")).toBeVisible();
    await tablet.evaluate(() => document.fonts.ready);
    await tablet.mouse.move(0, 0);
    await expect(tablet).toHaveScreenshot("device-pair.png", {
      fullPage: true,
    });

    await tablet.goto("/device/removed");
    await expect(tablet.getByTestId("device-removed")).toBeVisible();
    await tablet.evaluate(() => document.fonts.ready);
    await expect(tablet).toHaveScreenshot("device-removed.png", {
      fullPage: true,
    });

    const parent = await openContext(browser, testInfo, authFile("parentA"));
    try {
      await setPinViaSettings(parent.page, PIN);
      await expect(parent.page.getByTestId("tablet-pin")).toContainText(
        "Tablet PIN saved.",
      );
      await pairViaApi(parent.page, tablet);
      await elevate(tablet);
      await tablet.evaluate(() => document.fonts.ready);
      await tablet.mouse.move(0, 0);
      await expect(tablet.getByTestId("elevated-banner")).toHaveScreenshot(
        "device-elevated-banner.png",
      );

      await parent.page.goto("/dashboard/settings/devices");
      const list = parent.page.getByTestId("device-list");
      await expect(list.getByTestId("device-row")).toContainText("Active now");
      await parent.page.evaluate(() => document.fonts.ready);
      await parent.page.mouse.move(0, 0);
      await expect(list).toHaveScreenshot("device-list.png");
    } finally {
      await parent.context.close();
    }
  });
});
