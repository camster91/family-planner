// Route allowlist (#240, SHARED_DEVICE.md §14.1 item 1, ADR-0006 decision 1).
//
// Walks EVERY src/app/api/**/route.ts, calls every exported handler with only
// a valid device cookie of tablet D1 (household H1) plus CSRF, and asserts:
//   * routes outside DEVICE_ALLOWED_ROUTES refuse it (401/404, or 403 for the
//     routes in DEVICE_REFUSED_ROUTES that name the device) — except the
//     public, non-cookie routes listed in PUBLIC_ROUTES, which do not
//     authenticate anyone by cookie;
//   * no response carries an H1 canary.
// A new route that starts accepting device cookies, or a new public route,
// fails this test until it is reviewed and listed.
//
// Also covers §14.6 item 42: with the kill switch off every device and
// device-management route is 404, even for a parent session.

jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock(
  "next/headers",
  () => require("@/__tests__/helpers/two-household").nextHeadersMock,
);
jest.mock(
  "@/lib/session",
  () => require("@/__tests__/helpers/two-household").sessionMock,
);
jest.mock("@/lib/prisma", () => ({
  prisma: require("@/__tests__/helpers/two-household").fakePrisma,
}));

import fs from "fs";
import { FAMILY_A, FOREIGN } from "@/__tests__/helpers/two-household";
import path from "path";
import {
  H1_CANARIES,
  db,
  deviceReq,
  clearsDeviceCookies,
  disableSharedDevice,
  enableSharedDevice,
  resetClock,
  seedDevices,
  setNow,
  setPassword,
  setPin,
} from "@/__tests__/helpers/device";

const API_ROOT = path.join(__dirname, "..");
const METHODS = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
] as const;

/** The only handlers that accept a device cookie (SHARED_DEVICE.md §12.2–§12.3). */
const DEVICE_ALLOWED_ROUTES = new Set([
  "GET /api/device/me",
  "GET /api/device/today",
  "GET /api/device/today/version", // #271 change version of the same board
  "POST /api/device/session/refresh",
  "POST /api/device/elevation",
  "DELETE /api/device/elevation",
  "POST /api/device/revoke-self", // requires elevation on top
  "PATCH /api/device/label", // requires elevation on top
  // #274 tablet writes (§9.2): each also needs the household opt-in
  // (Family.device_writes_enabled, default off), an Idempotency-Key and a
  // household actingMemberId. Tested in src/app/api/device/__tests__/device-writes.test.ts.
  "PATCH /api/device/lists/items/[id]",
  "POST /api/device/lists/[id]/items",
  "POST /api/device/chores/[id]/complete",
  "POST /api/device/chores/[id]/uncomplete", // the tablet's own completion, 2-minute window
  // #274 board setup on the tablet: requires elevation on top (no photos, O-15).
  "GET /api/device/elevated/board-settings",
  "PATCH /api/device/elevated/board-settings",
  "GET /api/device/elevated/board-settings/places",
  "POST /api/device/pair/claim", // public: needs a pairing code, not a cookie
  "POST /api/device/pair/status", // public: needs a claim token, not a cookie
]);

/**
 * Handlers that authenticate nobody by cookie (credentials, bearer token in
 * the URL, cron secret, or no auth at all). A device cookie is irrelevant to
 * them; they are still checked for H1 canaries. Status noted per route.
 */
const PUBLIC_ROUTES: Record<string, number[]> = {
  "POST /api/auth/login": [409], // device cookie present → DEVICE_MODE_LOGIN_BLOCKED
  "POST /api/auth/register": [409], // device cookie present → DEVICE_MODE_LOGIN_BLOCKED (invite branch issues a session)
  "POST /api/auth/forgot-password": [400],
  "POST /api/auth/reset-password": [400],
  "POST /api/auth/resend-verification": [400],
  "GET /api/auth/verify-email": [307], // never consumes: redirects to /verify-email or the sign-in page
  "POST /api/auth/verify-email": [400], // the confirm button (O-24); needs the emailed token, not a cookie
  "POST /api/auth/logout": [200], // clears session_token only; nothing to revoke
  "GET /api/health": [200, 503],
  "GET /api/health/live": [200],
  "GET /api/version": [200], // build identity only (#161): { version, commit, builtAt }
  "GET /api/capabilities": [200], // static public protocol metadata (#473); no household or device state
  "POST /api/analytics/event": [200, 204, 400], // anonymous callers are a no-op
  "GET /api/family/invites/preview": [400, 404],
  "GET /api/handoff/share/[token]": [404],
  "GET /api/calendar/feed": [400, 401, 404],
  "POST /api/cron/recurring-chores": [401, 500],
  "POST /api/cron/morning-summary": [401, 500], // O-40: cron secret only, fail closed
};

/**
 * Person write routes that recognise a paired tablet and refuse it explicitly
 * with 403 DEVICE_WRITE_NOT_ALLOWED before person auth (ADR-0007 child D,
 * #253: shared devices stay read-only until #157 device writes exist).
 */
const DEVICE_REFUSED_ROUTES: Record<string, number[]> = {
  // Grocery review is a person-only read: paired tablets are explicitly refused.
  "GET /api/lists/items/from-recipe/review": [403],
  "POST /api/lists/items/from-recipe": [403],
  "POST /api/lists/items/undo-add": [403],
  // Food inventory writes (#263): read-only on a shared device like the above.
  "POST /api/inventory": [403],
  "PATCH /api/inventory/[id]": [403],
  "DELETE /api/inventory/[id]": [403],
  // Consume / discard / undo (#158/#121): refused before person auth.
  "POST /api/inventory/[id]/consume": [403],
  "POST /api/inventory/[id]/discard": [403],
  "POST /api/inventory/adjustments/[id]/undo": [403],
  // Fridge photo scan (#265): spends the provider quota and is parent-only.
  "POST /api/inventory/scan": [403],
  // Review-first event import (#270): spends the provider quota; its undo deletes events.
  "POST /api/calendar/import-suggestions": [403],
  "POST /api/calendar/import-suggestions/commit": [403],
  "POST /api/calendar/import-suggestions/undo": [403],
  // Grocery store sections (#273): "Move to…" and the per-list sorting switch.
  "PATCH /api/lists/items/section": [403],
  "PATCH /api/lists/section-sort": [403],
  // REST list-item delete (route inventory F-6, #289): new route, no new tablet write.
  "DELETE /api/lists/items/[id]": [403],
  // Household search (route inventory F-3): a person read, never the tablet's.
  "GET /api/search": [403],
  // Account and household deletion (D-3, ACCOUNT_DELETION.md): never from a shared tablet.
  "DELETE /api/users": [403],
  "DELETE /api/family": [403],
  "GET /api/users/deletion": [403],
  // Notification preferences (#286): a person's own switches, never the tablet's.
  "GET /api/users/preferences": [403],
  "PATCH /api/users/preferences": [403],
  // Household audit history (#285): parent person read, never the tablet's.
  "GET /api/audit": [403],
  // Beta usage counts switch (#287): a parent's choice, never the tablet's.
  "PATCH /api/family/beta-metrics": [403],
  // Member controls (O-34): a parent's household account controls, never the tablet's.
  "POST /api/family/invite-code": [403],
  "DELETE /api/family/members/[id]": [403],
  // A configured OAuth callback reaches authenticateWithFamily and therefore
  // returns the explicit refusal; an unconfigured/malformed callback remains
  // a 401/404 redirect or not-found response.
  "GET /api/calendar/connections/[provider]/callback": [401, 403, 404],
  // Pinned notes are person-session routes; paired tablets are refused before auth.
  "GET /api/notes": [403],
  "POST /api/notes": [403],
  "PATCH /api/notes/[id]": [403],
  "DELETE /api/notes/[id]": [403],
};

/**
 * Private person routes that must reject a live paired tablet before the
 * lingering person session can authenticate it. Keep this list explicit so a
 * new private domain cannot silently inherit the combined-cookie gap (#510).
 */
const PRIVATE_PERSON_ROUTES = [
  {
    route: "GET /api/budget/categories",
    module: "../budget/categories/route",
    method: "GET",
    path: "/api/budget/categories",
  },
  {
    route: "POST /api/budget/categories",
    module: "../budget/categories/route",
    method: "POST",
    path: "/api/budget/categories",
  },
  {
    route: "PATCH /api/budget/categories/[id]",
    module: "../budget/categories/[id]/route",
    method: "PATCH",
    path: "/api/budget/categories/unknown-id",
  },
  {
    route: "DELETE /api/budget/categories/[id]",
    module: "../budget/categories/[id]/route",
    method: "DELETE",
    path: "/api/budget/categories/unknown-id",
  },
  {
    route: "GET /api/budget/stats",
    module: "../budget/stats/route",
    method: "GET",
    path: "/api/budget/stats",
  },
  {
    route: "GET /api/budget/transactions",
    module: "../budget/transactions/route",
    method: "GET",
    path: "/api/budget/transactions",
  },
  {
    route: "POST /api/budget/transactions",
    module: "../budget/transactions/route",
    method: "POST",
    path: "/api/budget/transactions",
  },
  {
    route: "PATCH /api/budget/transactions/[id]",
    module: "../budget/transactions/[id]/route",
    method: "PATCH",
    path: "/api/budget/transactions/unknown-id",
  },
  {
    route: "DELETE /api/budget/transactions/[id]",
    module: "../budget/transactions/[id]/route",
    method: "DELETE",
    path: "/api/budget/transactions/unknown-id",
  },
  {
    route: "GET /api/messages",
    module: "../messages/route",
    method: "GET",
    path: "/api/messages",
  },
  {
    route: "POST /api/messages",
    module: "../messages/route",
    method: "POST",
    path: "/api/messages",
  },
  {
    route: "PATCH /api/messages",
    module: "../messages/route",
    method: "PATCH",
    path: "/api/messages",
  },
  {
    route: "GET /api/analytics",
    module: "../analytics/route",
    method: "GET",
    path: "/api/analytics",
  },
  {
    route: "GET /api/locations",
    module: "../locations/route",
    method: "GET",
    path: "/api/locations",
  },
  {
    route: "POST /api/locations",
    module: "../locations/route",
    method: "POST",
    path: "/api/locations",
  },
  {
    route: "DELETE /api/locations/[id]",
    module: "../locations/[id]/route",
    method: "DELETE",
    path: "/api/locations/unknown-id",
  },
  {
    route: "GET /api/handoff",
    module: "../handoff/route",
    method: "GET",
    path: "/api/handoff",
  },
  {
    route: "POST /api/handoff",
    module: "../handoff/route",
    method: "POST",
    path: "/api/handoff",
  },
  {
    route: "PATCH /api/handoff/[id]",
    module: "../handoff/[id]/route",
    method: "PATCH",
    path: "/api/handoff/unknown-id",
  },
  {
    route: "DELETE /api/handoff/[id]",
    module: "../handoff/[id]/route",
    method: "DELETE",
    path: "/api/handoff/unknown-id",
  },
  {
    route: "POST /api/handoff/[id]/regenerate-token",
    module: "../handoff/[id]/regenerate-token/route",
    method: "POST",
    path: "/api/handoff/unknown-id/regenerate-token",
  },
  {
    route: "GET /api/emergency-contacts",
    module: "../emergency-contacts/route",
    method: "GET",
    path: "/api/emergency-contacts",
  },
  {
    route: "POST /api/emergency-contacts",
    module: "../emergency-contacts/route",
    method: "POST",
    path: "/api/emergency-contacts",
  },
  {
    route: "PATCH /api/emergency-contacts/[id]",
    module: "../emergency-contacts/[id]/route",
    method: "PATCH",
    path: "/api/emergency-contacts/unknown-id",
  },
  {
    route: "DELETE /api/emergency-contacts/[id]",
    module: "../emergency-contacts/[id]/route",
    method: "DELETE",
    path: "/api/emergency-contacts/unknown-id",
  },
  {
    route: "GET /api/sick-days",
    module: "../sick-days/route",
    method: "GET",
    path: "/api/sick-days",
  },
  {
    route: "POST /api/sick-days",
    module: "../sick-days/route",
    method: "POST",
    path: "/api/sick-days",
  },
  {
    route: "PATCH /api/sick-days/[id]",
    module: "../sick-days/[id]/route",
    method: "PATCH",
    path: "/api/sick-days/unknown-id",
  },
  {
    route: "DELETE /api/sick-days/[id]",
    module: "../sick-days/[id]/route",
    method: "DELETE",
    path: "/api/sick-days/unknown-id",
  },
  // Person-only routes that read the session through getServerUser rather
  // than authenticateRequest. These are intentionally listed separately so
  // the combined-cookie regression catches bypasses of the common API guard.
  {
    route: "GET /api/allowance",
    module: "../allowance/route",
    method: "GET",
    path: "/api/allowance",
  },
  {
    route: "POST /api/allowance",
    module: "../allowance/route",
    method: "POST",
    path: "/api/allowance",
  },
  {
    route: "PATCH /api/allowance/[id]",
    module: "../allowance/[id]/route",
    method: "PATCH",
    path: "/api/allowance/unknown-id",
  },
  {
    route: "GET /api/family/features",
    module: "../family/features/route",
    method: "GET",
    path: "/api/family/features",
  },
  {
    route: "PATCH /api/family/features",
    module: "../family/features/route",
    method: "PATCH",
    path: "/api/family/features",
  },
  {
    route: "GET /api/family/members",
    module: "../family/members/route",
    method: "GET",
    path: "/api/family/members",
  },
  // Dormant name-only profile routes remain person-session-only. A paired
  // device carrying a valid parent session must receive the explicit refusal
  // before profile authentication or any roster read/write.
  {
    route: "GET /api/family/profiles",
    module: "../family/profiles/route",
    method: "GET",
    path: "/api/family/profiles",
  },
  {
    route: "POST /api/family/profiles",
    module: "../family/profiles/route",
    method: "POST",
    path: "/api/family/profiles",
  },
  {
    route: "PATCH /api/family/profiles/[id]",
    module: "../family/profiles/[id]/route",
    method: "PATCH",
    path: "/api/family/profiles/unknown-id",
  },
  {
    route: "POST /api/family/profiles/[id]/archive",
    module: "../family/profiles/[id]/archive/route",
    method: "POST",
    path: "/api/family/profiles/unknown-id/archive",
  },
  {
    route: "GET /api/family/travel",
    module: "../family/travel/route",
    method: "GET",
    path: "/api/family/travel",
  },
  {
    route: "PATCH /api/family/travel",
    module: "../family/travel/route",
    method: "PATCH",
    path: "/api/family/travel",
  },
  {
    route: "GET /api/medications",
    module: "../medications/route",
    method: "GET",
    path: "/api/medications",
  },
  {
    route: "POST /api/medications",
    module: "../medications/route",
    method: "POST",
    path: "/api/medications",
  },
  {
    route: "PATCH /api/medications/[id]",
    module: "../medications/[id]/route",
    method: "PATCH",
    path: "/api/medications/unknown-id",
  },
  {
    route: "DELETE /api/medications/[id]",
    module: "../medications/[id]/route",
    method: "DELETE",
    path: "/api/medications/unknown-id",
  },
  {
    route: "GET /api/pickups",
    module: "../pickups/route",
    method: "GET",
    path: "/api/pickups",
  },
  {
    route: "POST /api/pickups",
    module: "../pickups/route",
    method: "POST",
    path: "/api/pickups",
  },
  {
    route: "PATCH /api/pickups/[id]",
    module: "../pickups/[id]/route",
    method: "PATCH",
    path: "/api/pickups/unknown-id",
  },
  {
    route: "DELETE /api/pickups/[id]",
    module: "../pickups/[id]/route",
    method: "DELETE",
    path: "/api/pickups/unknown-id",
  },
] as const;

/**
 * Parent management handlers use requireDeviceManager rather than the
 * ordinary person/private route helpers. A paired device carrying a valid
 * parent session must still be refused before any manager mutation or read.
 * Keep this separate from DEVICE_REFUSED_ROUTES: device-only calls have no
 * person session and correctly remain 401 in the all-route matrix.
 */
const DEVICE_MANAGER_ROUTES = [
  {
    route: "GET /api/family/devices",
    module: "../family/devices/route",
    method: "GET",
    path: "/api/family/devices",
  },
  {
    route: "PATCH /api/family/devices/[id]",
    module: "../family/devices/[id]/route",
    method: "PATCH",
    path: "/api/family/devices/unknown-id",
  },
  {
    route: "GET /api/family/devices/[id]/events",
    module: "../family/devices/[id]/events/route",
    method: "GET",
    path: "/api/family/devices/unknown-id/events",
  },
  {
    route: "POST /api/family/devices/[id]/revoke",
    module: "../family/devices/[id]/revoke/route",
    method: "POST",
    path: "/api/family/devices/unknown-id/revoke",
  },
  {
    route: "POST /api/family/devices/pairings",
    module: "../family/devices/pairings/route",
    method: "POST",
    path: "/api/family/devices/pairings",
  },
  {
    route: "GET /api/family/devices/pairings/[id]",
    module: "../family/devices/pairings/[id]/route",
    method: "GET",
    path: "/api/family/devices/pairings/unknown-id",
  },
  {
    route: "DELETE /api/family/devices/pairings/[id]",
    module: "../family/devices/pairings/[id]/route",
    method: "DELETE",
    path: "/api/family/devices/pairings/unknown-id",
  },
  {
    route: "POST /api/family/devices/pairings/[id]/confirm",
    module: "../family/devices/pairings/[id]/confirm/route",
    method: "POST",
    path: "/api/family/devices/pairings/unknown-id/confirm",
  },
  {
    route: "PUT /api/users/elevation-pin",
    module: "../users/elevation-pin/route",
    method: "PUT",
    path: "/api/users/elevation-pin",
  },
  {
    route: "DELETE /api/users/elevation-pin",
    module: "../users/elevation-pin/route",
    method: "DELETE",
    path: "/api/users/elevation-pin",
  },
] as const;

/** Calendar sync routes are gated before auth when no provider is configured. */
const CALENDAR_SYNC_ROUTES = [
  "GET /api/calendar/connections",
  "POST /api/calendar/connections/[provider]/start",
  "GET /api/calendar/sync-connections/[id]/calendars",
  "PATCH /api/calendar/sync-connections/[id]",
  "DELETE /api/calendar/sync-connections/[id]",
  "POST /api/calendar/sync-connections/[id]/sync",
] as const;

/**
 * All other person-authenticated handler methods. They inherit the refusal
 * from authenticateRequest, so keep their method inventory explicit alongside
 * the route allowlist: a newly authenticated handler must be reviewed here
 * before it can become a shared-device surface.
 */
const COMMON_PERSON_AUTH_ROUTES = [
  "GET /api/activity",
  "GET /api/auth/me",
  "POST /api/admin/imports/[source]",
  "GET /api/admin/imports",
  "PATCH /api/anniversaries/[id]",
  "DELETE /api/anniversaries/[id]",
  "GET /api/anniversaries",
  "POST /api/anniversaries",
  "POST /api/assistant",
  "POST /api/auth/change-password",
  "POST /api/calendar/subscriptions/[id]/refresh",
  "PATCH /api/calendar/subscriptions/[id]",
  "DELETE /api/calendar/subscriptions/[id]",
  "GET /api/calendar/subscriptions",
  "POST /api/calendar/subscriptions",
  "GET /api/capture",
  "POST /api/capture",
  "POST /api/capture/grocery",
  "GET /api/capture/receipt",
  "POST /api/chores/complete",
  "POST /api/chores/create",
  "GET /api/chores",
  "PATCH /api/chores",
  "DELETE /api/chores",
  "POST /api/chores/uncomplete",
  "POST /api/chores/verify",
  "GET /api/chores/stacks",
  "POST /api/chores/stacks",
  "GET /api/chores/stacks/candidates",
  "GET /api/events",
  "POST /api/events",
  "PATCH /api/events",
  "DELETE /api/events",
  "GET /api/family/ai-settings",
  "POST /api/family/ai-settings",
  "GET /api/family/board-settings/places",
  "GET /api/family/board-settings",
  "PATCH /api/family/board-settings",
  "GET /api/family/board-version",
  "GET /api/family/feed-token",
  "POST /api/family/feed-token",
  "DELETE /api/family/invites/[id]",
  "GET /api/family/invites",
  "POST /api/family/invites",
  "POST /api/family/join",
  "GET /api/family/lookup",
  "POST /api/family",
  "GET /api/family",
  "PATCH /api/family",
  "GET /api/feedback",
  "POST /api/feedback",
  "GET /api/files/[filename]",
  "GET /api/files/chores/[filename]",
  "GET /api/inventory/[id]",
  "GET /api/inventory/adjustments",
  "GET /api/inventory/cook",
  "GET /api/inventory",
  "GET /api/inventory/use-soon",
  "GET /api/lists/[id]/version",
  "POST /api/lists/create",
  "POST /api/lists/default-grocery",
  "POST /api/lists/items/create",
  "DELETE /api/lists/items/delete",
  "PATCH /api/lists/items/edit",
  "POST /api/lists/items/grocery-add",
  "GET /api/lists/items",
  "PATCH /api/lists/items/update",
  "GET /api/lists",
  "DELETE /api/lists",
  "PATCH /api/meals/[id]",
  "DELETE /api/meals/[id]",
  "GET /api/meals",
  "POST /api/meals",
  "PATCH /api/notes/[id]",
  "DELETE /api/notes/[id]",
  "GET /api/notes",
  "POST /api/notes",
  "GET /api/notifications",
  "POST /api/notifications",
  "PATCH /api/notifications",
  "DELETE /api/notifications",
  "PATCH /api/notifications/snooze",
  "GET /api/projects/[id]",
  "PATCH /api/projects/[id]",
  "DELETE /api/projects/[id]",
  "POST /api/projects/[id]/send-to-calendar",
  "PATCH /api/projects/[id]/tasks/[taskId]",
  "DELETE /api/projects/[id]/tasks/[taskId]",
  "GET /api/projects/[id]/tasks",
  "POST /api/projects/[id]/tasks",
  "GET /api/projects",
  "POST /api/projects",
  "GET /api/recipes/[id]",
  "PATCH /api/recipes/[id]",
  "DELETE /api/recipes/[id]",
  "POST /api/recipes/discover",
  "POST /api/recipes/preview",
  "GET /api/recipes",
  "POST /api/recipes",
  "POST /api/rewards/approve",
  "POST /api/rewards/claim",
  "GET /api/rewards",
  "POST /api/rewards",
  "PATCH /api/rewards",
  "GET /api/search",
  "POST /api/upload",
  "GET /api/users/export",
  "GET /api/users",
  "PATCH /api/users",
  "PATCH /api/wishlist/[id]",
  "DELETE /api/wishlist/[id]",
  "PATCH /api/wishlist/[id]/status",
  "GET /api/wishlist",
  "POST /api/wishlist",
] as const;

for (const route of COMMON_PERSON_AUTH_ROUTES) {
  DEVICE_REFUSED_ROUTES[route] = [403];
}

// Keep the existing all-route device-only allowlist in sync with the focused
// combined-cookie regression above. These handlers now intentionally return
// the explicit refusal response even when no person session is supplied.
for (const { route } of PRIVATE_PERSON_ROUTES) {
  DEVICE_REFUSED_ROUTES[route] = [403];
}

// Calendar sync checks its provider kill switch before person auth. The
// configured path is an explicit paired-device refusal; the default-off path
// remains a safe 404 and is accepted by the all-route matrix.
for (const route of CALENDAR_SYNC_ROUTES) {
  DEVICE_REFUSED_ROUTES[route] = [403, 404];
}

function enableAuditedPrivateFeatures() {
  const family = db.find("family", FAMILY_A)!;
  family.features = {
    budget: true,
    messages: true,
    analytics: true,
    gamification: true,
    locations: true,
    handoff: true,
    emergency: true,
    "sick-days": true,
  };
}

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === "__tests__" ? [] : routeFiles(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

function urlPath(file: string): string {
  return (
    "/api/" +
    path.relative(API_ROOT, path.dirname(file)).split(path.sep).join("/")
  );
}

const anyParam = new Proxy(
  {},
  { get: (_t, key) => (key === "then" ? undefined : "unknown-id") },
);

async function bodyText(res: any): Promise<string> {
  if (!res) return "";
  try {
    return typeof res.text === "function"
      ? String(await res.text())
      : JSON.stringify(res.body ?? null);
  } catch {
    return "";
  }
}

const files = routeFiles(API_ROOT).sort();

describe("device cookie route allowlist", () => {
  beforeAll(() => {
    for (const level of ["log", "warn", "error", "info"] as const)
      jest.spyOn(console, level).mockImplementation(() => undefined);
  });
  beforeEach(() => {
    db.reset();
    enableSharedDevice();
    setNow(new Date());
  });
  afterAll(() => {
    disableSharedDevice();
    resetClock();
  });

  it("finds every API route file", () => {
    expect(files.length).toBeGreaterThanOrEqual(105);
  });

  it("no route outside the allowlist accepts a device cookie, and none leaks H1 data", async () => {
    const seen = new Set<string>();
    const failures: string[] = [];

    for (const file of files) {
      const mod = require(file);
      for (const method of METHODS) {
        const handler = mod[method];
        if (typeof handler !== "function") continue;
        const route = `${method} ${urlPath(file)}`;
        seen.add(route);

        db.reset();
        const fx = seedDevices();
        const csrf = "c".repeat(64);
        const req = deviceReq({
          method,
          path: urlPath(file).replace(/\[(\w+)\]/g, "unknown-id"),
          cookies: { ...fx.d1.cookies, csrf_token: csrf },
          headers: { "x-csrf-token": csrf, "x-cron-secret": "wrong" },
          body: {},
        });

        let res: any;
        try {
          res = await handler(req, { params: Promise.resolve(anyParam) });
        } catch (error) {
          failures.push(`${route}: threw ${(error as Error).message}`);
          continue;
        }
        const text = await bodyText(res);
        if (DEVICE_ALLOWED_ROUTES.has(route)) {
          // D1 may read its own household here, never another one.
          if (text.includes(FOREIGN))
            failures.push(`${route}: leaked H2 data to D1`);
          continue;
        }
        const leaked = H1_CANARIES.filter((c) => text.includes(c));
        if (leaked.length)
          failures.push(`${route}: leaked ${leaked.join(", ")}`);
        const expected = PUBLIC_ROUTES[route] ??
          DEVICE_REFUSED_ROUTES[route] ?? [401, 404];
        if (!expected.includes(res?.status))
          failures.push(
            `${route}: status ${res?.status}, expected ${expected.join("/")}`,
          );
      }
    }

    expect(failures).toEqual([]);
    // Every allowlisted and public route exists, so the lists cannot go stale.
    for (const route of [
      ...DEVICE_ALLOWED_ROUTES,
      ...Object.keys(PUBLIC_ROUTES),
      ...Object.keys(DEVICE_REFUSED_ROUTES),
      ...DEVICE_MANAGER_ROUTES.map(({ route }) => route),
    ]) {
      expect(seen).toContain(route);
    }
  });

  it("refuses every private feature route when a paired device also carries a valid parent session", async () => {
    const failures: string[] = [];

    for (const entry of PRIVATE_PERSON_ROUTES) {
      db.reset();
      enableSharedDevice();
      // Turn on the audited domains so the regression proves the device guard,
      // rather than stopping at a feature-disabled response.
      enableAuditedPrivateFeatures();
      const fx = seedDevices();
      const csrf = "c".repeat(64);
      const mod = require(entry.module);
      const res = await mod[entry.method](
        deviceReq({
          method: entry.method,
          path: entry.path,
          cookies: { ...fx.d1.cookies, csrf_token: csrf },
          headers: { "x-csrf-token": csrf },
          as: "parentA",
        }),
        { params: Promise.resolve({ id: "unknown-id" }) },
      );
      const text = await bodyText(res);
      if (res?.status !== 403 || !text.includes("DEVICE_WRITE_NOT_ALLOWED")) {
        failures.push(`${entry.route}: status ${res?.status}, body ${text}`);
      }
      const leaked = H1_CANARIES.filter((canary) => text.includes(canary));
      if (leaked.length)
        failures.push(`${entry.route}: leaked ${leaked.join(", ")}`);
      if (db.writes.length)
        failures.push(`${entry.route}: wrote ${JSON.stringify(db.writes)}`);
    }

    expect(failures).toEqual([]);
  });

  it("refuses every common person-auth route before a paired device can use a parent session", async () => {
    const failures: string[] = [];

    for (const route of COMMON_PERSON_AUTH_ROUTES) {
      const [method, routePath] = route.split(" ", 2);
      const file = files.find((candidate) => urlPath(candidate) === routePath);
      if (!file) {
        failures.push(`${route}: route file not found`);
        continue;
      }

      db.reset();
      enableSharedDevice();
      const fx = seedDevices();
      const csrf = "c".repeat(64);
      const mod = require(file);
      const handler = mod[method];
      if (typeof handler !== "function") {
        failures.push(`${route}: handler not found`);
        continue;
      }

      let res: any;
      try {
        res = await handler(
          deviceReq({
            method,
            path: routePath.replace(/\[(\w+)\]/g, "unknown-id"),
            cookies: { ...fx.d1.cookies, csrf_token: csrf },
            headers: { "x-csrf-token": csrf },
            as: "parentA",
            body: {},
          }),
          { params: Promise.resolve(anyParam) },
        );
      } catch (error) {
        failures.push(`${route}: threw ${(error as Error).message}`);
        continue;
      }

      const text = await bodyText(res);
      if (res?.status !== 403 || !text.includes("DEVICE_WRITE_NOT_ALLOWED")) {
        failures.push(`${route}: status ${res?.status}, body ${text}`);
      }
      const leaked = H1_CANARIES.filter((canary) => text.includes(canary));
      if (leaked.length) failures.push(`${route}: leaked ${leaked.join(", ")}`);
      if (db.writes.length)
        failures.push(`${route}: wrote ${JSON.stringify(db.writes)}`);
    }

    expect(failures).toEqual([]);
  });

  it("refuses every device-manager route before a paired device can use a parent session", async () => {
    const failures: string[] = [];

    for (const entry of DEVICE_MANAGER_ROUTES) {
      db.reset();
      enableSharedDevice();
      const fx = seedDevices();
      const csrf = "c".repeat(64);
      const mod = require(entry.module);
      const handler = mod[entry.method];
      if (typeof handler !== "function") {
        failures.push(`${entry.route}: handler not found`);
        continue;
      }

      let res: any;
      try {
        const request = deviceReq({
          method: entry.method,
          path: entry.path,
          cookies: { ...fx.d1.cookies, csrf_token: csrf },
          headers: { "x-csrf-token": csrf },
          as: "parentA",
          body: {},
        });
        res = await handler(request, { params: Promise.resolve(anyParam) });
      } catch (error) {
        failures.push(`${entry.route}: threw ${(error as Error).message}`);
        continue;
      }

      const text = await bodyText(res);
      if (res?.status !== 403 || !text.includes("DEVICE_WRITE_NOT_ALLOWED")) {
        failures.push(`${entry.route}: status ${res?.status}, body ${text}`);
      }
      const leaked = H1_CANARIES.filter((canary) => text.includes(canary));
      if (leaked.length)
        failures.push(`${entry.route}: leaked ${leaked.join(", ")}`);
      if (db.writes.length)
        failures.push(`${entry.route}: wrote ${JSON.stringify(db.writes)}`);
    }

    expect(failures).toEqual([]);
  });

  it.each(["revoked", "expired", "switch-off"] as const)(
    "keeps a clean person session working when the paired credential is %s",
    async (state) => {
      db.reset();
      enableAuditedPrivateFeatures();
      const fx = seedDevices();
      if (state === "revoked") {
        db.find("householdDevice", fx.d1.deviceId)!.revoked_at = new Date();
      } else if (state === "expired") {
        const session = db.find("deviceSession", fx.d1.sessionId)!;
        session.access_expires_at = new Date(Date.now() - 60_000);
        session.refresh_expires_at = new Date(Date.now() - 60_000);
      } else {
        disableSharedDevice();
      }

      const res = await require("../messages/route").GET(
        deviceReq({ cookies: fx.d1.cookies, as: "parentA" }),
      );
      expect(res.status).toBe(200);
      expect(await bodyText(res)).toContain("Home hello");
    },
  );

  it("calendar sync routes (#264) refuse a device cookie before auth when sync is configured", async () => {
    const {
      setSyncEnv,
      clearSyncEnv,
    } = require("@/lib/calendar-sync/__tests__/fakes");
    setSyncEnv();
    try {
      const syncFiles = files.filter((f) =>
        /\/api\/calendar\/(connections|sync-connections)(\/|$)/.test(
          urlPath(f),
        ),
      );
      expect(syncFiles.length).toBe(6);
      for (const file of syncFiles) {
        const mod = require(file);
        for (const method of METHODS) {
          if (typeof mod[method] !== "function") continue;
          db.reset();
          const fx = seedDevices();
          const csrf = "c".repeat(64);
          const res = await mod[method](
            deviceReq({
              method,
              path: urlPath(file).replace(/\[(\w+)\]/g, "google"),
              cookies: { ...fx.d1.cookies, csrf_token: csrf },
              headers: { "x-csrf-token": csrf },
              body: { push_mode: "all" },
            }),
            { params: Promise.resolve({ provider: "google", id: "google" }) },
          );
          expect([`${method} ${urlPath(file)}`, res.status]).toEqual([
            `${method} ${urlPath(file)}`,
            403,
          ]);
          expect(db.writes).toEqual([]);
        }
      }
    } finally {
      clearSyncEnv();
    }
  });

  it("calendar sync routes remain refused with both cookies when sync is configured", async () => {
    const {
      setSyncEnv,
      clearSyncEnv,
    } = require("@/lib/calendar-sync/__tests__/fakes");
    setSyncEnv();
    try {
      const failures: string[] = [];
      for (const route of CALENDAR_SYNC_ROUTES) {
        const [method, routePath] = route.split(" ", 2);
        const file = files.find(
          (candidate) => urlPath(candidate) === routePath,
        );
        if (!file) {
          failures.push(`${route}: route file not found`);
          continue;
        }
        db.reset();
        const fx = seedDevices();
        const csrf = "c".repeat(64);
        const mod = require(file);
        const handler = mod[method];
        if (typeof handler !== "function") {
          failures.push(`${route}: handler not found`);
          continue;
        }
        const res = await handler(
          deviceReq({
            method,
            path: routePath.replace(/\[(\w+)\]/g, "unknown-id"),
            cookies: { ...fx.d1.cookies, csrf_token: csrf },
            headers: { "x-csrf-token": csrf },
            as: "parentA",
            body: {},
          }),
          { params: Promise.resolve({ provider: "google", id: "unknown-id" }) },
        );
        const text = await bodyText(res);
        if (res?.status !== 403 || !text.includes("DEVICE_WRITE_NOT_ALLOWED")) {
          failures.push(`${route}: status ${res?.status}, body ${text}`);
        }
        if (db.writes.length)
          failures.push(`${route}: wrote ${JSON.stringify(db.writes)}`);
      }
      expect(failures).toEqual([]);
    } finally {
      clearSyncEnv();
    }
  });

  it("calendar OAuth callback refuses a paired device carrying a lingering person session", async () => {
    const {
      setSyncEnv,
      clearSyncEnv,
    } = require("@/lib/calendar-sync/__tests__/fakes");
    setSyncEnv();
    try {
      db.reset();
      const fx = seedDevices();
      const csrf = "c".repeat(64);
      const mod = require("../calendar/connections/[provider]/callback/route");
      const res = await mod.GET(
        deviceReq({
          method: "GET",
          path: "/api/calendar/connections/google/callback?code=ignored&state=ignored",
          cookies: { ...fx.d1.cookies, csrf_token: csrf },
          headers: { "x-csrf-token": csrf },
          as: "parentA",
        }),
        { params: Promise.resolve({ provider: "google" }) },
      );
      expect(res.status).toBe(403);
      expect(await bodyText(res)).toContain("DEVICE_WRITE_NOT_ALLOWED");
      expect(db.writes).toEqual([]);
    } finally {
      clearSyncEnv();
    }
  });

  it("grocery review is classified as refused, never device-allowed or public, and leaks no household data", async () => {
    const route = "GET /api/lists/items/from-recipe/review";
    expect(DEVICE_ALLOWED_ROUTES.has(route)).toBe(false);
    expect(PUBLIC_ROUTES[route]).toBeUndefined();
    expect(DEVICE_REFUSED_ROUTES[route]).toEqual([403]);
    const fx = seedDevices();
    const mod = require("../lists/items/from-recipe/review/route");
    const res = await mod.GET(
      deviceReq({
        method: "GET",
        path: "/api/lists/items/from-recipe/review?recipeId=recipe-a",
        cookies: fx.d1.cookies,
      }),
    );
    expect(res.status).toBe(403);
    const text = await bodyText(res);
    expect(H1_CANARIES.filter((canary) => text.includes(canary))).toEqual([]);
    expect(text).not.toContain(FOREIGN);
    expect(db.writes).toEqual([]);
  });

  it("the allowlisted read routes do accept the device cookie", async () => {
    const fx = seedDevices();
    for (const p of ["me", "today", "today/version"]) {
      const mod = require(path.join(API_ROOT, "device", p, "route.ts"));
      const res = await mod.GET(deviceReq({ cookies: fx.d1.cookies }));
      expect(res.status).toBe(200);
    }
  });

  it("kill switch off: every device and device-management route is 404 and expires device cookies, whoever calls", async () => {
    disableSharedDevice();
    const deviceFiles = files.filter(
      (f) =>
        /\/api\/(device|family\/devices)\//.test(urlPath(f) + "/") ||
        urlPath(f) === "/api/users/elevation-pin",
    );
    expect(deviceFiles.length).toBe(23);
    for (const file of deviceFiles) {
      const mod = require(file);
      for (const method of METHODS) {
        if (typeof mod[method] !== "function") continue;
        for (const as of [null, "parentA"] as const) {
          db.reset();
          const fx = seedDevices();
          setPassword("parentA", "parent-a-password");
          setPin("parentA", "482913");
          const res = await mod[method](
            deviceReq({
              method,
              as,
              cookies: fx.d1.cookies,
              body: {
                label: "x",
                code: "ABCD-EFGH",
                platform: "web",
                userId: "parent-a",
                method: "pin",
                secret: "482913",
              },
            }),
            { params: Promise.resolve(anyParam) },
          );
          expect([`${method} ${urlPath(file)}`, res.status]).toEqual([
            `${method} ${urlPath(file)}`,
            404,
          ]);
          expect(db.writes).toEqual([]);
          // HttpOnly device cookies are expired server-side (the tablet's JS cannot).
          expect([
            `${method} ${urlPath(file)}`,
            clearsDeviceCookies(res),
          ]).toEqual([`${method} ${urlPath(file)}`, true]);
        }
      }
    }
  });
});
