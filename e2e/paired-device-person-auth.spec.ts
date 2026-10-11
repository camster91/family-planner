/**
 * Real HTTP paired-device/person-session boundary checks for #510.
 *
 * This spec deliberately uses Playwright browser-context request clients rather
 * than route handlers. It seeds one disposable device session under the
 * existing Family A fixture, then sends the actual Next cookies through the
 * running server. Run it against the guarded desktop API project only when the
 * loopback E2E server and fixture database are available.
 *
 * No provider is contacted and no person/device logout is exercised here. The
 * Postgres route integration suite owns logout, expiry, revocation and the
 * shared-device kill-switch contract.
 */
import crypto from "node:crypto";
import pg from "pg";
import type { APIResponse, BrowserContext } from "@playwright/test";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { E2E_ANCHOR, authFile } from "./support/env";
import { expect, test } from "./support/test";

const FAMILY = FIXTURE_IDS.familyA.family;
const PARENT = FIXTURE_IDS.familyA.parent;
const DEVICE = "fx_e2e_pdauth_http_device";
const SESSION = "fx_e2e_pdauth_http_session";
const LABEL = "#510 HTTP synthetic tablet";
const CANARY = "PDAUTH-HTTP-PRIVATE-CANARY";
const PARENT_EMAIL = "parent.a@example.test";

type FamilyState = {
  features: unknown;
  deviceWritesEnabled: boolean;
  captureKey: string | null;
  captureBaseUrl: string | null;
  captureModel: string | null;
};

type Snapshot = FamilyState & {
  eventCount: number;
  pairingCount: number;
};

let originalFamilyState: FamilyState | undefined;
let accessToken = "";
let refreshToken = "";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function issueToken(kind: "a" | "r"): string {
  return `fpd1_${kind}_${crypto.randomBytes(32).toString("base64url")}`;
}

function assertLoopbackDatabase(): void {
  const target = assertFixtureTargetAllowed(process.env);
  const host = (target.host ?? "").replace(/^\[|\]$/g, "").toLowerCase();
  const loopback =
    host === "localhost" ||
    host === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(host);
  if (!loopback) {
    throw new Error("#510 HTTP E2E requires a loopback DATABASE_URL target");
  }
}

function assertLoopbackBaseURL(baseURL: string): void {
  const url = new URL(baseURL);
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const loopback =
    host === "localhost" ||
    host === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(host);
  if (!loopback || !["http:", "https:"].includes(url.protocol)) {
    throw new Error("#510 HTTP E2E requires a loopback HTTP(S) E2E_BASE_URL");
  }
}

async function withDb<T>(fn: (db: pg.Client) => Promise<T>): Promise<T> {
  assertLoopbackDatabase();
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

async function deleteOwnedRows(db: pg.Client): Promise<void> {
  const failures: string[] = [];
  const steps: Array<[string, () => Promise<unknown>]> = [
    [
      "device session",
      () =>
        db.query(
          'DELETE FROM "DeviceSession" WHERE id=$1 AND device_id=$2 AND family_id=$3',
          [SESSION, DEVICE, FAMILY],
        ),
    ],
    [
      "device",
      () =>
        db.query(
          'DELETE FROM "HouseholdDevice" WHERE id=$1 AND family_id=$2 AND label=$3',
          [DEVICE, FAMILY, LABEL],
        ),
    ],
  ];
  for (const [label, remove] of steps) {
    try {
      await remove();
    } catch (error) {
      failures.push(`${label}: ${(error as Error).message}`);
    }
  }
  if (failures.length) {
    throw new Error(
      `Owned #510 HTTP fixture cleanup failed:\n${failures.join("\n")}`,
    );
  }
}

async function restoreFamilyState(db: pg.Client): Promise<void> {
  const state = originalFamilyState;
  if (!state) return;
  await db.query(
    `UPDATE "Family"
       SET features=$2::jsonb,
           device_writes_enabled=$3,
           capture_ai_key_enc=$4,
           capture_ai_base_url=$5,
           capture_ai_model=$6
     WHERE id=$1`,
    [
      FAMILY,
      JSON.stringify(state.features),
      state.deviceWritesEnabled,
      state.captureKey,
      state.captureBaseUrl,
      state.captureModel,
    ],
  );
}

async function seedOwnedDevice(): Promise<void> {
  await withDb(async (db) => {
    await deleteOwnedRows(db);
    const family = await db.query<{
      features: unknown;
      device_writes_enabled: boolean;
      capture_ai_key_enc: string | null;
      capture_ai_base_url: string | null;
      capture_ai_model: string | null;
    }>(
      `SELECT features, device_writes_enabled, capture_ai_key_enc,
              capture_ai_base_url, capture_ai_model
         FROM "Family" WHERE id=$1`,
      [FAMILY],
    );
    expect(family.rowCount).toBe(1);
    const row = family.rows[0];
    originalFamilyState = {
      features: row.features,
      deviceWritesEnabled: row.device_writes_enabled,
      captureKey: row.capture_ai_key_enc,
      captureBaseUrl: row.capture_ai_base_url,
      captureModel: row.capture_ai_model,
    };

    const now = new Date(E2E_ANCHOR);
    await db.query(
      `INSERT INTO "HouseholdDevice"
        (id, family_id, label, platform, created_by, confirmed_by,
         paired_at, created_at, updated_at)
       VALUES ($1,$2,$3,'web',$4,$4,$5,$5,$5)`,
      [DEVICE, FAMILY, LABEL, PARENT, now],
    );

    accessToken = issueToken("a");
    refreshToken = issueToken("r");
    await db.query(
      `INSERT INTO "DeviceSession"
        (id, device_id, family_id, access_token_hash, access_expires_at,
         refresh_token_hash, refresh_expires_at, first_used_at, rotated_at,
         replaced_by_id, revoked_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,NULL,NULL,NULL,$8)`,
      [
        SESSION,
        DEVICE,
        FAMILY,
        hashToken(accessToken),
        new Date(now.getTime() + 60 * 60 * 1000),
        hashToken(refreshToken),
        new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        now,
      ],
    );
  });
}

async function cleanupOwnedDevice(): Promise<void> {
  await withDb(async (db) => {
    const failures: string[] = [];
    try {
      await deleteOwnedRows(db);
    } catch (error) {
      failures.push((error as Error).message);
    }
    try {
      await restoreFamilyState(db);
    } catch (error) {
      failures.push(`family state: ${(error as Error).message}`);
    }
    if (failures.length) throw new Error(failures.join("\n"));
  });
  originalFamilyState = undefined;
  accessToken = "";
  refreshToken = "";
}

async function snapshotFamily(): Promise<Snapshot> {
  return withDb(async (db) => {
    const [family, events, pairings] = await Promise.all([
      db.query<{
        features: unknown;
        device_writes_enabled: boolean;
        capture_ai_key_enc: string | null;
        capture_ai_base_url: string | null;
        capture_ai_model: string | null;
      }>(
        `SELECT features, device_writes_enabled, capture_ai_key_enc,
                capture_ai_base_url, capture_ai_model
           FROM "Family" WHERE id=$1`,
        [FAMILY],
      ),
      db.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM "Event" WHERE family_id=$1',
        [FAMILY],
      ),
      db.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM "DevicePairing" WHERE family_id=$1',
        [FAMILY],
      ),
    ]);
    expect(family.rowCount).toBe(1);
    const row = family.rows[0];
    return {
      features: row.features,
      deviceWritesEnabled: row.device_writes_enabled,
      captureKey: row.capture_ai_key_enc,
      captureBaseUrl: row.capture_ai_base_url,
      captureModel: row.capture_ai_model,
      eventCount: Number(events.rows[0].count),
      pairingCount: Number(pairings.rows[0].count),
    };
  });
}

async function addDeviceCookies(
  context: BrowserContext,
  baseURL: string,
): Promise<void> {
  await context.addCookies([
    { name: "fp_device", value: accessToken, url: baseURL, httpOnly: true },
    {
      name: "fp_device_refresh",
      value: refreshToken,
      url: baseURL,
      httpOnly: true,
    },
  ]);
}

async function request(
  context: BrowserContext,
  baseURL: string,
  path: string,
  method: "GET" | "POST" | "PATCH" = "GET",
  body?: unknown,
): Promise<APIResponse> {
  const csrf =
    (await context.cookies()).find((cookie) => cookie.name === "csrf_token")
      ?.value ?? "";
  const headers: Record<string, string> = {};
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    headers["X-CSRF-Token"] = csrf;
  }
  return context.request.fetch(new URL(path, baseURL).href, {
    method,
    headers,
    data: body,
  });
}

async function expectDeviceRefusal(
  response: APIResponse,
  label = "paired-device refusal",
): Promise<void> {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  expect(response.status(), `${label}: ${text}`).toBe(403);
  expect(body).toMatchObject({ error: { code: "DEVICE_WRITE_NOT_ALLOWED" } });
  expect(response.headers()["cache-control"]).toContain("private, no-store");
  expect(text).not.toContain(CANARY);
}

async function expectCode(
  response: APIResponse,
  status: number,
  code: string,
): Promise<void> {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  expect(response.status(), text).toBe(status);
  expect(body).toMatchObject({ error: { code } });
}

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  await seedOwnedDevice();
});

test.afterEach(async () => {
  await cleanupOwnedDevice();
});

test("#510 paired device cannot use person APIs over real HTTP", async ({
  browser,
  baseURL,
}) => {
  expect(baseURL).toBeTruthy();
  assertLoopbackBaseURL(baseURL!);

  let both: BrowserContext | undefined;
  let deviceOnly: BrowserContext | undefined;
  let personOnly: BrowserContext | undefined;

  try {
    both = await browser.newContext({
      baseURL,
      storageState: authFile("parentA"),
    });
    deviceOnly = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    personOnly = await browser.newContext({
      baseURL,
      storageState: authFile("parentA"),
    });

    await addDeviceCookies(both, baseURL!);
    await addDeviceCookies(deviceOnly, baseURL!);
    const before = await snapshotFamily();

    // These requests deliberately carry invalid bodies/canaries. A 403 here
    // proves the device boundary runs before person auth, body validation,
    // private-file lookup, rate limiting or the configured AI provider.
    const refusalCases: Array<{
      label: string;
      path: string;
      method: "GET" | "POST" | "PATCH";
      body?: unknown;
    }> = [
      { label: "common GET", path: "/api/events", method: "GET" },
      {
        label: "common PATCH",
        path: "/api/events",
        method: "PATCH",
        body: { title: CANARY },
      },
      {
        label: "direct getServerUser GET",
        path: "/api/family/features",
        method: "GET",
      },
      {
        label: "direct getServerUser PATCH",
        path: "/api/family/features",
        method: "PATCH",
        body: { features: CANARY },
      },
      {
        label: "direct members GET",
        path: "/api/family/members",
        method: "GET",
      },
      {
        label: "manager GET",
        path: "/api/family/devices",
        method: "GET",
      },
      {
        label: "manager POST",
        path: "/api/family/devices/pairings",
        method: "POST",
        body: { label: CANARY },
      },
      {
        label: "private file GET",
        path: "/api/files/not-a-photo.txt",
        method: "GET",
      },
      {
        label: "provider-backed assistant POST",
        path: "/api/assistant",
        method: "POST",
        body: { messages: [{ role: "user", content: CANARY }] },
      },
    ];
    for (const item of refusalCases) {
      await expectDeviceRefusal(
        await request(both, baseURL!, item.path, item.method, item.body),
        item.label,
      );
    }

    // Manager routes retain their existing device-only 401 contract. A normal
    // private person route has the stronger 403 paired-device boundary even
    // without a lingering session cookie.
    await expectCode(
      await request(deviceOnly, baseURL!, "/api/family/devices"),
      401,
      "UNAUTHORIZED",
    );
    await expectDeviceRefusal(
      await request(deviceOnly, baseURL!, "/api/files/not-a-photo.txt"),
      "device-only private file GET",
    );

    const dto = await request(deviceOnly, baseURL!, "/api/device/me");
    const dtoText = await dto.text();
    expect(dto.status(), dtoText).toBe(200);
    expect(dtoText).toContain(LABEL);
    expect(dtoText).not.toContain(PARENT_EMAIL);
    expect(dtoText).not.toContain(CANARY);
    expect(dtoText).not.toContain('"family_id"');

    const personEvents = await request(personOnly, baseURL!, "/api/events");
    expect(personEvents.status(), await personEvents.text()).toBe(200);
    const personMembers = await request(
      personOnly,
      baseURL!,
      "/api/family/members",
    );
    expect(personMembers.status(), await personMembers.text()).toBe(200);

    // Protected refusals must not create events/pairings or alter feature and
    // provider configuration. Device last-seen bookkeeping is intentionally
    // outside this snapshot because the allowed DTO request may update it.
    const after = await snapshotFamily();
    expect(after).toEqual(before);
  } finally {
    await Promise.allSettled(
      [both, deviceOnly, personOnly]
        .filter((context): context is BrowserContext => Boolean(context))
        .map((context) => context.close()),
    );
  }
});
