/** #441 exact-route inventory proof; synthetic provider/server mode is a separate required QA job. */
import { test, expect, browserFetch, browserSend } from "./support/test";
import type { Page } from "@playwright/test";
import { authFile } from "./support/env";
import { FIXTURE_PASSWORD } from "../src/lib/fixtures/dataset";
import { FIXTURE_EMAILS } from "../src/lib/fixtures/dataset";
import { FIXTURE_LEGACY_MEAL_IDS } from "../src/lib/fixtures/dataset";
import {
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_REPLAYED_HEADER,
} from "../src/lib/idempotency-key";
import { messages } from "../src/i18n";
import {
  navigationMessages,
  type NavigationMessage,
} from "../src/i18n/navigation";
import { pseudolocalizeTemplate } from "../src/i18n/pseudo";
import {
  A,
  B,
  PREFIX,
  ITEM,
  PAST,
  CANARY,
  PRIVATE_NAME,
  PRIVATE_UNIT,
  SYNTHETIC_PNG,
  expanded,
  msg,
  withDb,
  seedRows,
  cleanRows,
  guardContext,
  runtime,
  scope,
  capture,
} from "./support/inventory-localization";
const projects = [
  "phone-390x844",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
];
const api = /\/api\/inventory(?:\?|\/|$)/;

function qaText(value: string) {
  return expanded ? pseudolocalizeTemplate(value) : value;
}

function navigationText(key: NavigationMessage) {
  return qaText(navigationMessages.en[key]);
}

type StringKey<T> = {
  [K in keyof T]: T[K] extends string ? K : never;
}[keyof T];

function notesText(key: StringKey<typeof messages.en.notes>) {
  return qaText(messages.en.notes[key]);
}

function emergencyText(key: StringKey<typeof messages.en.emergency>) {
  return qaText(messages.en.emergency[key]);
}

function commonText(key: StringKey<typeof messages.en.common>) {
  return qaText(messages.en.common[key]);
}

type RapidBackWindow = Window & {
  __pendingNavigationDocument?: string;
  __armPendingRapidBack?: () => void;
  __pendingRapidBackPopstates?: () => number;
  __pendingRapidBackAttempts?: () => number;
  __pendingRapidBackCancelled?: () => number;
  __pendingRapidBackToken?: () => string | null;
  __pendingRapidBackEvents?: () => Array<{
    href: string;
    token: string | null;
  }>;
};

async function installRapidBackProbe(page: Page) {
  await page.addInitScript(() => {
    (window as RapidBackWindow).__pendingNavigationDocument =
      crypto.randomUUID();
    let armed = false;
    let popstates = 0;
    let attempts = 0;
    let cancelled = 0;
    const nativePreventDefault = Event.prototype.preventDefault;
    Event.prototype.preventDefault = function () {
      nativePreventDefault.call(this);
      // Observe real browser cancellation even when the early dispatcher
      // stops later event listeners; preserve the native event behavior.
      if (
        armed &&
        this.type === "navigate" &&
        this.defaultPrevented &&
        (this as Event & { navigationType?: string }).navigationType ===
          "traverse"
      ) {
        cancelled += 1;
      }
    };
    const nativeBack = history.back.bind(history);
    history.back = () => {
      if (armed) attempts += 1;
      nativeBack();
    };
    let events: Array<{ href: string; token: string | null }> = [];
    const target = window as Window & {
      __armPendingRapidBack?: () => void;
      __pendingRapidBackPopstates?: () => number;
      __pendingRapidBackAttempts?: () => number;
      __pendingRapidBackCancelled?: () => number;
      __pendingRapidBackToken?: () => string | null;
      __pendingRapidBackEvents?: () => Array<{
        href: string;
        token: string | null;
      }>;
    };
    target.__armPendingRapidBack = () => {
      armed = true;
      popstates = 0;
      attempts = 0;
      cancelled = 0;
      events = [];
    };
    target.__pendingRapidBackPopstates = () => popstates;
    target.__pendingRapidBackAttempts = () => attempts;
    target.__pendingRapidBackCancelled = () => cancelled;
    target.__pendingRapidBackToken = () => {
      const marker = window.history.state?.__herewovenPendingForm;
      return typeof marker === "string" ? marker : null;
    };
    target.__pendingRapidBackEvents = () => events;
    // Observe committed traversals on hosts using the popstate fallback.
    // The helper issues two real Back attempts before either settles.
    window.addEventListener(
      "popstate",
      () => {
        if (!armed) return;
        popstates += 1;
        const marker = window.history.state?.__herewovenPendingForm;
        events.push({
          href: window.location.href,
          token: typeof marker === "string" ? marker : null,
        });
      },
      true,
    );
  });
}

async function traverseBackTwice(page: Page, path: RegExp) {
  const documentId = await page.evaluate(
    () => (window as RapidBackWindow).__pendingNavigationDocument,
  );
  const sentinelToken = await page.evaluate(
    () => (window as RapidBackWindow).__pendingRapidBackToken?.() ?? null,
  );
  if (sentinelToken === null) {
    throw new Error("Pending form sentinel was not installed before Back");
  }
  await page.evaluate(() => {
    (window as RapidBackWindow).__armPendingRapidBack?.();
    window.history.back();
    queueMicrotask(() => window.history.back());
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as RapidBackWindow).__pendingRapidBackAttempts?.() ?? 0,
      ),
    )
    .toBeGreaterThanOrEqual(2);
  await expect(page).toHaveURL(path);
  expect(
    await page.evaluate(
      () => (window as RapidBackWindow).__pendingNavigationDocument,
    ),
  ).toBe(documentId);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as RapidBackWindow).__pendingRapidBackToken?.() ?? null,
      ),
    )
    .toBe(sentinelToken);
  const events = await page.evaluate(
    () => (window as RapidBackWindow).__pendingRapidBackEvents?.() ?? [],
  );
  const cancelled = await page.evaluate(
    () => (window as RapidBackWindow).__pendingRapidBackCancelled?.() ?? 0,
  );
  const nativeGuardAvailable = await page.evaluate(
    () =>
      typeof (window as Window & { navigation?: EventTarget }).navigation
        ?.addEventListener === "function",
  );
  if (nativeGuardAvailable) {
    expect(cancelled).toBe(2);
    expect(events).toHaveLength(0);
  } else {
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.some((event) => event.href !== page.url())).toBe(true);
  }
  return { sentinelToken, events, cancelled };
}

async function consumeSentinelAndVisitPrior(
  page: Page,
  sentinelToken: string,
  surface: RegExp,
) {
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as RapidBackWindow).__pendingRapidBackToken?.() ?? null,
      ),
    )
    .toBeNull();
  expect(sentinelToken).toEqual(expect.any(String));
  await expect(page).toHaveURL(surface);
  await page.evaluate(() => window.history.back());
  await expect(page).toHaveURL(/\/dashboard\/family\/more$/);
}

async function openPendingSurfaceFromExplore(page: Page, surface: string) {
  await page.goto("/dashboard/family/more");
  const documentId = await page.evaluate(
    () => (window as RapidBackWindow).__pendingNavigationDocument,
  );
  const menu = page.getByRole("button", {
    name: navigationText("userMenu"),
  });
  await menu.click();
  await expect(page.getByTestId("user-menu-explore")).toBeVisible();
  await menu.click();
  const link = page.locator(`a[href="/dashboard/${surface}"]`);
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/${surface}$`));
  expect(
    await page.evaluate(
      () => (window as RapidBackWindow).__pendingNavigationDocument,
    ),
  ).toBe(documentId);
}
function labelPrefix(text: string) {
  return new RegExp("^" + text.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}
test.describe("inventory localization synthetic server", () => {
  test.skip(
    process.env.E2E_INVENTORY_SCAN_STUB !== "1",
    "Requires the separately guarded synthetic-provider inventory QA job; normal disabled-provider coverage remains unchanged",
  );
  let originalFeatures: Array<{ id: string; features: unknown }> = [];
  test.beforeAll(async () => {
    await withDb(async (db) => {
      originalFeatures = (
        await db.query('SELECT id,features FROM "Family" WHERE id IN ($1,$2)', [
          A.family,
          B.family,
        ])
      ).rows;
      expect(originalFeatures).toHaveLength(2);
      await db.query(
        'UPDATE "Family" SET features=COALESCE(features,\'{}\'::jsonb)||\'{"inventory":true,"meals":true}\'::jsonb WHERE id IN ($1,$2)',
        [A.family, B.family],
      );
    });
  });
  test.afterAll(async () => {
    await cleanRows();
    await withDb(async (db) => {
      for (const row of originalFeatures)
        await db.query('UPDATE "Family" SET features=$2::jsonb WHERE id=$1', [
          row.id,
          row.features === null ? null : JSON.stringify(row.features),
        ]);
    });
  });
  test.beforeEach(async ({}, info) => {
    test.skip(
      !projects.includes(info.project.name),
      "Inventory QA representative phone/portrait/fridge viewports",
    );
    await seedRows();
  });
  test.afterEach(async () => {
    await cleanRows();
  });
  for (const role of ["parent", "teen", "child"] as const)
    test.describe(role, () => {
      test.use({
        storageState:
          role === "parent"
            ? authFile("parentA")
            : role === "child"
              ? authFile("childA")
              : { cookies: [], origins: [] },
      });
      for (const locale of ["en", "es"] as const)
        test(`${locale}: role ready filters offline stale and empty`, async ({
          page,
          context,
          baseURL,
        }, info) => {
          await guardContext(context, baseURL!, locale);
          if (role === "teen") {
            await page.goto("/login");
            await page.locator("#email").fill(FIXTURE_EMAILS.familyA.teen);
            await page.locator("#password").fill(FIXTURE_PASSWORD);
            await page.locator('button[type="submit"]').click();
            await expect(page).toHaveURL(/\/dashboard\/?$/);
          }
          const requests: Array<{ url: string; method: string }> = [];
          page.on("request", (r) => {
            if (api.test(r.url()))
              requests.push({ url: r.url(), method: r.method() });
          });
          await page.goto("/dashboard/inventory");
          await expect(
            page.getByRole("heading", {
              name: msg(locale, "title"),
              exact: true,
            }),
          ).toBeVisible();
          const me = await browserFetch(page, "/api/auth/me");
          expect(JSON.parse(me.body).user.role).toBe(role);
          await runtime(page, info, locale, role);
          await expect(page.getByTestId("past-use-by")).toContainText(
            msg(locale, "pastSafety"),
          );
          await expect(
            page
              .getByTestId("inventory-item")
              .filter({ hasText: PRIVATE_NAME }),
          ).toContainText("2 " + PRIVATE_UNIT);
          await expect(scope(page)).not.toContainText(PREFIX + " B canary");
          const soup = page.locator(
            `[data-testid="cook-suggestion"][data-recipe-id="${FIXTURE_LEGACY_MEAL_IDS.familyA.recipeSoup}"]`,
          );
          await expect(soup).toContainText("Tomato soup");
          await expect(soup.getByTestId("cook-coverage")).toContainText(
            msg(locale, "haveAllOne", { count: 1 }),
          );
          const lasagna = page.locator(
            `[data-testid="cook-suggestion"][data-recipe-id="${FIXTURE_LEGACY_MEAL_IDS.familyA.recipeLasagna}"]`,
          );
          await expect(lasagna.getByTestId("cook-missing")).toContainText(
            "Lasagna sheets",
          );
          await expect(lasagna).toContainText(
            msg(locale, "haveSome", { have: 1, total: 2 }),
          );
          await expect(
            page.getByRole("button", {
              name: msg(locale, "scanFridge"),
              exact: true,
            }),
          ).toHaveCount(role === "parent" ? 1 : 0);
          await expect(
            page.getByRole("button", {
              name: msg(locale, "addItem"),
              exact: true,
            }),
          ).toHaveCount(role === "child" ? 0 : 1);
          await capture(page, info, `${role}-${locale}-ready`);
          const search = page.getByRole("searchbox");
          await search.fill("does not match fixture");
          await expect(page.getByTestId("no-matches")).toContainText(
            msg(locale, "noMatches"),
          );
          await capture(page, info, `${role}-${locale}-filtered`, [
            page.getByTestId("no-matches").getByRole("button", {
              name: msg(locale, "clearSearch"),
              exact: true,
            }),
          ]);
          await search.fill("QA");
          const where = page.getByRole("combobox", {
            name: msg(locale, "where"),
            exact: true,
          });
          await where.selectOption("fridge");
          const before = requests.length;
          await search.focus();
          await expect(search).toBeFocused();
          expect(requests).toHaveLength(before);
          await expect(where).toHaveValue("fridge");
          await context.setOffline(true);
          await expect(page.getByTestId("inventory-connection")).toBeVisible();
          if (role !== "child") {
            await page
              .getByRole("button", {
                name: msg(locale, "addItem"),
                exact: true,
              })
              .click();
            await expect(page.getByTestId("inventory-notice")).toContainText(
              msg(locale, "offlineWrite"),
            );
            await expect(page.getByTestId("inventory-modal")).toHaveCount(0);
          }
          await capture(page, info, `${role}-${locale}-offline`);
          expect(requests.filter((r) => r.method !== "GET")).toHaveLength(0);
          await page.route(api, (route) =>
            route.request().method() === "GET"
              ? route.fulfill({ status: 503, json: {} })
              : route.continue(),
          );
          await context.setOffline(false);
          await expect(page.getByTestId("inventory-connection")).toContainText(
            msg(locale, "stale", { time: "__TIME__" }).split("__TIME__")[0],
          );
          await capture(page, info, `${role}-${locale}-stale`, [
            page.getByRole("button", {
              name: msg(locale, "tryAgain"),
              exact: true,
            }),
          ]);
          await page.unroute(api);
          await withDb((db) =>
            db.query('DELETE FROM "InventoryItem" WHERE id IN ($1,$2)', [
              ITEM,
              PAST,
            ]),
          );
          await page.reload();
          await expect(
            page.getByRole("heading", {
              name: msg(locale, "nothingTracked"),
              exact: true,
            }),
          ).toBeVisible();
          await capture(page, info, `${role}-${locale}-empty`);
          if (role === "child")
            for (const [method, path, body] of [
              [
                "POST",
                "/api/inventory",
                { name: PREFIX + " forbidden", location: "fridge" },
              ],
              ["DELETE", `/api/inventory/${ITEM}`, undefined],
              ["POST", `/api/inventory/${ITEM}/consume`, {}],
              ["POST", `/api/inventory/${ITEM}/discard`, {}],
            ] as const) {
              const result = await browserSend(page, method, path, body);
              expect(result.status).toBe(403);
              expect(JSON.parse(result.body).error.code).toBe(
                "INVENTORY_WRITE_FORBIDDEN",
              );
            }
          if (role !== "parent") {
            const scan = await browserSend(page, "POST", "/api/inventory/scan");
            expect(scan.status).toBe(403);
            expect(JSON.parse(scan.body).error.code).toBe(
              "INVENTORY_SCAN_FORBIDDEN",
            );
          }
        });
    });
  test.describe("parent read states", () => {
    test.use({ storageState: authFile("parentA") });
    for (const locale of ["en", "es"] as const)
      test(`${locale}: loading first-load refusal recipe refusal and controlled paging cap`, async ({
        page,
        context,
        baseURL,
      }, info) => {
        await guardContext(context, baseURL!, locale);
        let release!: () => void;
        const pending = new Promise<void>((resolve) => {
          release = resolve;
        });
        await page.route(api, async (route) => {
          await pending;
          await route.fulfill({ status: 503, json: {} });
        });
        await page.goto("/dashboard/inventory");
        try {
          await expect(
            page.getByRole("status", {
              name: msg(locale, "loading"),
              exact: true,
            }),
          ).toBeVisible();
          await runtime(page, info, locale, "parent");
          await capture(page, info, `${locale}-loading`);
        } finally {
          release();
        }
        await expect(
          page.getByRole("heading", {
            name: msg(locale, "loadFailed"),
            exact: true,
          }),
        ).toBeVisible();
        await expect(scope(page)).toContainText(msg(locale, "connectionRetry"));
        await capture(page, info, `${locale}-first-load-refused`, [
          page.getByRole("button", {
            name: msg(locale, "tryAgain"),
            exact: true,
          }),
        ]);
        await page.unroute(api);
        await page.route("**/api/inventory/cook?*", (route) =>
          route.fulfill({ status: 503, json: {} }),
        );
        await page
          .getByRole("button", { name: msg(locale, "tryAgain"), exact: true })
          .click();
        const cook = page.getByTestId("what-can-i-cook");
        await expect(cook).toContainText(msg(locale, "recipesFailed"));
        await expect(
          page.getByTestId("inventory-item").filter({ hasText: PRIVATE_NAME }),
        ).toBeVisible();
        await capture(page, info, `${locale}-recipe-refused`, [
          cook.getByRole("button", {
            name: msg(locale, "tryAgain"),
            exact: true,
          }),
        ]);
        await page.unroute("**/api/inventory/cook?*");
        // Twenty controlled nextOffset responses exercise the existing cap, not a 10,000-row database or load benchmark.
        const pages: string[] = [];
        let template: Record<string, unknown> | undefined;
        await page.route(/\/api\/inventory\?/, async (route) => {
          const url = new URL(route.request().url());
          expect(route.request().method()).toBe("GET");
          expect(url.searchParams.get("limit")).toBe("500");
          expect(url.searchParams.get("offset")).toBe(
            String(pages.length * 500),
          );
          if (pages.length === 0) {
            const response = await route.fetch();
            expect(response.status()).toBe(200);
            const data = await response.json();
            template = data.items.find(
              (item: { id: string }) => item.id === ITEM,
            );
            expect(template?.name).toBe(PRIVATE_NAME);
            expect(template?.unit).toBe(PRIVATE_UNIT);
          }
          pages.push(url.href);
          await route.fulfill({
            json: {
              items: [
                {
                  ...template,
                  id: `controlled-cap-${pages.length}`,
                },
              ],
              nextOffset: pages.length * 500,
            },
          });
        });
        await page.route("**/api/inventory/cook?*", async (route) => {
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          const body = await response.json();
          expect(body.suggestions.length).toBeGreaterThan(0);
          await route.fulfill({
            response,
            json: { ...body, inputsTruncated: true },
          });
        });
        await cook
          .getByRole("button", { name: msg(locale, "tryAgain"), exact: true })
          .click();
        await expect(page.getByTestId("items-capped")).toHaveText(
          msg(locale, "capped", { count: "10,000" }),
        );
        expect(pages).toHaveLength(20);
        await expect(page.getByTestId("inventory-item")).toHaveCount(20);
        await expect(page.getByTestId("cook-incomplete")).toHaveText(
          msg(locale, "recipesIncomplete"),
        );
        await capture(page, info, `${locale}-controlled-paging-and-recipe-cap`);
        const observedPages = pages.slice();
        pages.length = 0;
        await page.unroute("**/api/inventory/cook?*");
        await page.route("**/api/inventory/cook?*", (route) =>
          route.fulfill({
            json: {
              suggestions: [],
              recipesConsidered: 0,
              truncated: false,
              inputsTruncated: true,
            },
          }),
        );
        await page.reload();
        await expect(page.getByTestId("cook-empty")).toHaveText(
          msg(locale, "recipesEmptyCapped"),
        );
        await capture(page, info, `${locale}-controlled-empty-recipe-cap`);
        expect(pages).toHaveLength(20);
        await info.attach("controlled-read-state-responses", {
          body: JSON.stringify({
            controlledPaging: true,
            actualDatabaseCapacityProof: false,
            pages: observedPages,
          }),
          contentType: "application/json",
        });
      });
  });
  test.describe("parent pending navigation", () => {
    test.use({ storageState: authFile("parentA") });

    test("held fabricated writes keep Notes, Emergency and Inventory on-route across two real Back attempts", async ({
      page,
      context,
      baseURL,
    }, info) => {
      test.skip(
        info.project.name !== "phone-390x844",
        "The rapid Back regression runs once at the representative phone size",
      );
      await guardContext(context, baseURL!, "en");
      await installRapidBackProbe(page);

      const completedSurfaces: string[] = [];
      let releaseNotes!: () => void;
      let releaseEmergency!: () => void;
      let releaseInventory!: () => void;
      let notesPosts = 0;
      let emergencyPosts = 0;
      let inventoryPosts = 0;
      let notesResponseReleased = false;
      let emergencyResponseReleased = false;
      let inventoryResponseReleased = false;
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      const heldBeforeCleanup = {
        notes: false,
        emergency: false,
        inventory: false,
      };
      const notesPending = new Promise<void>((resolve) => {
        releaseNotes = resolve;
      });
      const emergencyPending = new Promise<void>((resolve) => {
        releaseEmergency = resolve;
      });
      const inventoryPending = new Promise<void>((resolve) => {
        releaseInventory = resolve;
      });

      try {
        // Every response below is explicitly synthetic and owns no database row.
        // The route guard still keeps the browser on loopback and the fixture
        // session remains the authenticated parentA identity.
        await page.route("**/api/notes", async (route) => {
          if (route.request().method() === "GET") {
            await route.fulfill({ json: { notes: [] } });
            return;
          }
          if (route.request().method() !== "POST") {
            await route.continue();
            return;
          }
          notesPosts += 1;
          await notesPending;
          notesResponseReleased = true;
          await route.fulfill({
            status: 201,
            json: {
              note: {
                id: "synthetic_pending_notes",
                title: "Synthetic pending note",
                body: "No database row",
                color: "yellow",
                created_at: "2026-01-05T12:00:00.000Z",
              },
            },
          });
        });

        await openPendingSurfaceFromExplore(page, "notes");
        await expect(
          page.getByRole("heading", {
            name: notesText("title"),
            exact: true,
          }),
        ).toBeVisible();
        await runtime(page, info, "en", "parent");
        const identity = await browserFetch(page, "/api/auth/me");
        expect(identity.status, identity.body).toBe(200);
        expect(
          (JSON.parse(identity.body) as { user?: { role?: unknown } }).user
            ?.role,
        ).toBe("parent");
        await page.getByLabel(notesText("addNote"), { exact: true }).click();
        const notesDialog = page.getByRole("dialog");
        await notesDialog
          .getByLabel(notesText("noteTitle"), { exact: true })
          .fill("Synthetic pending note");
        await notesDialog
          .getByLabel(notesText("noteBody"), { exact: true })
          .fill("No database row");
        await notesDialog
          .getByRole("button", { name: notesText("save"), exact: true })
          .click();
        await expect.poll(() => notesPosts).toBe(1);
        await expect(
          notesDialog.getByRole("button", {
            name: commonText("saving"),
            exact: true,
          }),
        ).toBeDisabled();
        const notesHistory = await traverseBackTwice(
          page,
          /\/dashboard\/notes$/,
        );
        await expect(notesDialog).toBeVisible();
        await expect(
          notesDialog.getByRole("button", {
            name: commonText("saving"),
            exact: true,
          }),
        ).toBeDisabled();
        expect(notesResponseReleased).toBe(false);
        heldBeforeCleanup.notes = true;
        releaseNotes();
        await expect(notesDialog).toHaveCount(0);
        expect(notesResponseReleased).toBe(true);
        await consumeSentinelAndVisitPrior(
          page,
          notesHistory.sentinelToken,
          /\/dashboard\/notes$/,
        );
        completedSurfaces.push("notes");
        await page.unroute("**/api/notes");

        await page.route("**/api/emergency-contacts", async (route) => {
          if (route.request().method() === "GET") {
            await route.fulfill({
              json: {
                contacts: [
                  {
                    id: "synthetic_pending_emergency",
                    person_id: null,
                    person_name: "Synthetic emergency contact",
                    relationship: "self",
                    blood_type: null,
                    allergies: null,
                    medications: null,
                    medical_conditions: null,
                    doctor_name: null,
                    doctor_phone: null,
                    dentist_name: null,
                    dentist_phone: null,
                    insurance_provider: null,
                    insurance_id: null,
                    emergency_contact_name: null,
                    emergency_contact_phone: null,
                    emergency_contact_relation: null,
                    notes: null,
                  },
                ],
              },
            });
            return;
          }
          if (route.request().method() !== "POST") {
            await route.continue();
            return;
          }
          emergencyPosts += 1;
          await emergencyPending;
          emergencyResponseReleased = true;
          await route.fulfill({
            status: 201,
            json: {
              contact: {
                id: "synthetic_pending_emergency_created",
                person_id: null,
                person_name: "Synthetic pending emergency",
                relationship: "self",
                blood_type: null,
                allergies: null,
                medications: null,
                medical_conditions: null,
                doctor_name: null,
                doctor_phone: null,
                dentist_name: null,
                dentist_phone: null,
                insurance_provider: null,
                insurance_id: null,
                emergency_contact_name: null,
                emergency_contact_phone: null,
                emergency_contact_relation: null,
                notes: null,
              },
            },
          });
        });

        await openPendingSurfaceFromExplore(page, "emergency");
        await expect(
          page.getByRole("heading", {
            name: emergencyText("title"),
            exact: true,
          }),
        ).toBeVisible();
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                document.documentElement.scrollWidth <=
                document.documentElement.clientWidth,
            ),
          )
          .toBe(true);
        await page
          .getByRole("button", {
            name: emergencyText("addCard"),
            exact: true,
          })
          .click();
        const emergencyDialog = page.getByRole("dialog");
        await emergencyDialog
          .getByLabel(emergencyText("personName"), { exact: true })
          .fill("Synthetic pending emergency");
        await emergencyDialog
          .getByRole("button", { name: commonText("save"), exact: true })
          .click();
        await expect.poll(() => emergencyPosts).toBe(1);
        await expect(
          emergencyDialog.getByRole("button", {
            name: commonText("saving"),
            exact: true,
          }),
        ).toBeDisabled();
        const emergencyHistory = await traverseBackTwice(
          page,
          /\/dashboard\/emergency$/,
        );
        await expect(emergencyDialog).toBeVisible();
        await expect(
          emergencyDialog.getByRole("button", {
            name: commonText("saving"),
            exact: true,
          }),
        ).toBeDisabled();
        expect(emergencyResponseReleased).toBe(false);
        heldBeforeCleanup.emergency = true;
        releaseEmergency();
        await expect(emergencyDialog).toHaveCount(0);
        expect(emergencyResponseReleased).toBe(true);
        await consumeSentinelAndVisitPrior(
          page,
          emergencyHistory.sentinelToken,
          /\/dashboard\/emergency$/,
        );
        completedSurfaces.push("emergency");
        await page.unroute("**/api/emergency-contacts");

        await page.route(/\/api\/inventory\?/, async (route) => {
          if (route.request().method() !== "POST") {
            await route.continue();
            return;
          }
          inventoryPosts += 1;
          await inventoryPending;
          inventoryResponseReleased = true;
          await route.fulfill({
            status: 201,
            json: {
              item: {
                id: "synthetic_pending_inventory",
                name: "Synthetic pending inventory",
                location: "fridge",
                amount: null,
                unit: null,
                expires_on: null,
                date_kind: "best_before",
                category: null,
                purchased_on: null,
                opened_on: null,
              },
            },
          });
        });

        await openPendingSurfaceFromExplore(page, "inventory");
        await expect(
          page.getByRole("heading", { name: msg("en", "title"), exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: msg("en", "addItem"), exact: true })
          .click();
        const inventoryDialog = page.getByTestId("inventory-modal");
        await inventoryDialog
          .getByLabel(msg("en", "name"), { exact: true })
          .fill("Synthetic pending inventory");
        await inventoryDialog
          .getByRole("button", { name: msg("en", "save"), exact: true })
          .click();
        await expect.poll(() => inventoryPosts).toBe(1);
        await expect(
          inventoryDialog.getByRole("button", {
            name: msg("en", "saving"),
            exact: true,
          }),
        ).toBeDisabled();
        const inventoryHistory = await traverseBackTwice(
          page,
          /\/dashboard\/inventory$/,
        );
        await expect(inventoryDialog).toBeVisible();
        await expect(
          inventoryDialog.getByRole("button", {
            name: msg("en", "saving"),
            exact: true,
          }),
        ).toBeDisabled();
        expect(inventoryResponseReleased).toBe(false);
        heldBeforeCleanup.inventory = true;
        releaseInventory();
        await expect(inventoryDialog).toHaveCount(0);
        expect(inventoryResponseReleased).toBe(true);
        await consumeSentinelAndVisitPrior(
          page,
          inventoryHistory.sentinelToken,
          /\/dashboard\/inventory$/,
        );
        completedSurfaces.push("inventory");

        await info.attach("pending-navigation-two-back-proof", {
          body: JSON.stringify({
            surfaces: completedSurfaces,
            posts: {
              notes: notesPosts,
              emergency: emergencyPosts,
              inventory: inventoryPosts,
            },
            transport:
              "loopback-only parentA browser session; all mutation responses were fabricated and no database row was created",
            history: {
              requirement:
                "each held request received two real history.back attempts; cancelable native traversals were prevented before commit, with held drafts retained until response release",
              notes: notesHistory,
              emergency: emergencyHistory,
              inventory: inventoryHistory,
            },
          }),
          contentType: "application/json",
        });
      } finally {
        releaseNotes();
        releaseEmergency();
        releaseInventory();
        // Let an already-dispatched synthetic route finish its fulfill before
        // unroute. This keeps cleanup from racing Playwright's route handler
        // and hiding the original assertion with "Route already handled".
        await expect
          .poll(() => notesPosts === 0 || notesResponseReleased, {
            timeout: 5_000,
          })
          .toBe(true)
          .catch(() => undefined);
        await expect
          .poll(() => emergencyPosts === 0 || emergencyResponseReleased, {
            timeout: 5_000,
          })
          .toBe(true)
          .catch(() => undefined);
        await expect
          .poll(() => inventoryPosts === 0 || inventoryResponseReleased, {
            timeout: 5_000,
          })
          .toBe(true)
          .catch(() => undefined);
        await page.unroute("**/api/notes").catch(() => undefined);
        await page.unroute("**/api/emergency-contacts").catch(() => undefined);
        await page.unroute(/\/api\/inventory\?/).catch(() => undefined);
        await info.attach("pending-navigation-cleanup", {
          body: JSON.stringify({
            heldResponses: heldBeforeCleanup,
            settledResponses: {
              notes: notesResponseReleased,
              emergency: emergencyResponseReleased,
              inventory: inventoryResponseReleased,
            },
            pageErrors,
            routesReleased: true,
          }),
          contentType: "application/json",
        });
      }
      expect(pageErrors).toEqual([]);
    });
  });
  test.describe("parent writes", () => {
    test.use({ storageState: authFile("parentA") });
    for (const locale of ["en", "es"] as const) {
      test(`${locale}: canonical add edit partial use undo and removal`, async ({
        page,
        context,
        baseURL,
      }, info) => {
        await guardContext(context, baseURL!, locale);
        await page.goto("/dashboard/inventory");
        await runtime(page, info, locale, "parent");
        const owned = scope(page);
        await owned
          .getByRole("button", { name: msg(locale, "addItem"), exact: true })
          .click();
        const modal = page.getByTestId("inventory-modal");
        await modal
          .getByRole("button", { name: msg(locale, "save"), exact: true })
          .click();
        await expect(modal.getByRole("alert")).toHaveText(
          msg(locale, "enterName"),
        );
        await capture(page, info, `${locale}-add-validation`, [
          modal.getByRole("button", { name: msg(locale, "save"), exact: true }),
        ]);
        const name = PREFIX + " authored {name} 李";
        await modal.getByLabel(msg(locale, "name"), { exact: true }).fill(name);
        await modal.getByLabel(labelPrefix(msg(locale, "amount"))).fill("4");
        await modal
          .getByLabel(labelPrefix(msg(locale, "unit")))
          .fill(PRIVATE_UNIT);
        const creates: Array<{
          method: string;
          url: string;
          body: unknown;
          key: string;
        }> = [];
        await page.route(/\/api\/inventory\?/, async (route) => {
          if (route.request().method() === "POST")
            creates.push({
              method: route.request().method(),
              url: route.request().url(),
              body: route.request().postDataJSON(),
              key: route.request().headers()[IDEMPOTENCY_HEADER.toLowerCase()],
            });
          await route.continue();
        });
        await modal
          .getByRole("button", { name: msg(locale, "save"), exact: true })
          .click();
        await expect(modal).toHaveCount(0);
        await expect(page.getByTestId("inventory-notice")).toHaveText(
          msg(locale, "addedName", { name }),
        );
        expect(creates).toHaveLength(1);
        expect(creates[0].key).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
        expect(creates[0].body).toEqual({
          name,
          location: "fridge",
          amount: 4,
          unit: PRIVATE_UNIT,
          expires_on: null,
          date_kind: "best_before",
          category: null,
          purchased_on: null,
          opened_on: null,
        });
        const added = await withDb(
          async (db) =>
            (
              await db.query(
                'SELECT id,amount,unit FROM "InventoryItem" WHERE family_id=$1 AND name=$2',
                [A.family, name],
              )
            ).rows,
        );
        expect(added).toHaveLength(1);
        expect(Number(added[0].amount)).toBe(4);
        expect(added[0].unit).toBe(PRIVATE_UNIT);
        await capture(page, info, `${locale}-added`);
        await owned
          .getByRole("button", {
            // The row is named by its visible text after the edit verb.
            name: labelPrefix(`${msg(locale, "editAction")} ${name}`),
          })
          .click();
        await modal.getByLabel(labelPrefix(msg(locale, "howMuch"))).fill("1.5");
        await modal
          .getByRole("button", { name: msg(locale, "usedIt"), exact: true })
          .click();
        await expect(modal).toHaveCount(0);
        const toast = page.getByTestId("undo-toast");
        await expect(toast).toContainText(
          msg(locale, "usedAmount", { amount: "1.5 " + PRIVATE_UNIT, name }),
        );
        const state = await withDb(
          async (db) =>
            (
              await db.query(
                'SELECT amount,status FROM "InventoryItem" WHERE id=$1',
                [added[0].id],
              )
            ).rows[0],
        );
        expect(Number(state.amount)).toBe(2.5);
        expect(state.status).toBe("active");
        await capture(page, info, `${locale}-partial-use`, [
          toast.getByRole("button", { name: msg(locale, "undo"), exact: true }),
        ]);
        await page.clock.fastForward(8100);
        await expect(toast).toBeVisible();
        await expect(
          toast.getByRole("button", { name: msg(locale, "undo"), exact: true }),
        ).toBeFocused();
        await toast
          .getByRole("button", { name: msg(locale, "undo"), exact: true })
          .press("Enter");
        await expect(toast).toHaveCount(0);
        await expect(page.getByTestId("inventory-notice")).toHaveText(
          msg(locale, "undoSuccess", { name }),
        );
        const restored = await withDb(
          async (db) =>
            (
              await db.query('SELECT amount FROM "InventoryItem" WHERE id=$1', [
                added[0].id,
              ])
            ).rows[0],
        );
        expect(Number(restored.amount)).toBe(4);
        await capture(page, info, `${locale}-undo-restored`);
        await owned
          .getByRole("button", {
            // The row is named by its visible text after the edit verb.
            name: labelPrefix(`${msg(locale, "editAction")} ${name}`),
          })
          .click();
        const pantry = modal.getByRole("radio", {
          name: msg(locale, "pantry"),
          exact: true,
        });
        await pantry.focus();
        await pantry.press("Space");
        await expect(pantry).toBeChecked();
        await modal
          .getByRole("button", { name: msg(locale, "save"), exact: true })
          .click();
        await expect(modal).toHaveCount(0);
        await expect(page.getByTestId("inventory-notice")).toHaveText(
          msg(locale, "savedName", { name }),
        );
        await capture(page, info, `${locale}-edited`);
        await owned
          .getByRole("button", {
            // The row is named by its visible text after the edit verb.
            name: labelPrefix(`${msg(locale, "editAction")} ${name}`),
          })
          .click();
        page.once("dialog", async (dialog) => {
          expect(dialog.message()).toBe(msg(locale, "removeConfirm", { name }));
          await dialog.dismiss();
        });
        await modal
          .getByRole("button", { name: msg(locale, "remove"), exact: true })
          .click();
        await expect(modal).toBeVisible();
        const removals: Array<{
          url: string;
          body: string | null;
          key: string;
        }> = [];
        let releaseRemoval!: () => void;
        const pendingRemoval = new Promise<void>((resolve) => {
          releaseRemoval = resolve;
        });
        const removeUrl = `**/api/inventory/${added[0].id}`;
        await page.route(removeUrl, async (route) => {
          if (route.request().method() !== "DELETE") return route.continue();
          removals.push({
            url: route.request().url(),
            body: route.request().postData(),
            key: route.request().headers()[IDEMPOTENCY_HEADER.toLowerCase()],
          });
          if (removals.length === 1) {
            await pendingRemoval;
            return route.fulfill({ status: 503, json: {} });
          }
          return route.fulfill({
            status: 409,
            json: { error: { message: "raw removal refusal {name} 李" } },
          });
        });
        for (let attempt = 0; attempt < 2; attempt++) {
          page.once("dialog", (dialog) => dialog.accept());
          await modal
            .getByRole("button", { name: msg(locale, "remove"), exact: true })
            .click();
          if (attempt === 0) {
            try {
              await expect(
                modal.getByRole("button", {
                  name: msg(locale, "remove"),
                  exact: true,
                }),
              ).toBeDisabled();
              await capture(page, info, `${locale}-removal-pending`);
            } finally {
              releaseRemoval();
            }
          }
          await expect(modal.getByRole("alert")).toHaveText(
            attempt === 0
              ? msg(locale, "removeFailed")
              : "raw removal refusal {name} 李",
          );
          await expect(
            modal.getByLabel(msg(locale, "name"), { exact: true }),
          ).toHaveValue(name);
          await capture(page, info, `${locale}-removal-refused-${attempt}`);
        }
        expect(removals).toHaveLength(2);
        expect(removals[0]).toEqual(removals[1]);
        expect(removals[0].key).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
        expect(removals[0].body).toBeNull();
        await page.unroute(removeUrl);
        page.once("dialog", async (dialog) => {
          expect(dialog.message()).toBe(msg(locale, "removeConfirm", { name }));
          await dialog.accept();
        });
        await modal
          .getByRole("button", { name: msg(locale, "remove"), exact: true })
          .click();
        await expect(modal).toHaveCount(0);
        await expect(page.getByTestId("inventory-notice")).toHaveText(
          msg(locale, "removedName", { name }),
        );
        expect(
          await withDb(
            async (db) =>
              (
                await db.query('SELECT id FROM "InventoryItem" WHERE id=$1', [
                  added[0].id,
                ])
              ).rows,
          ),
        ).toEqual([]);
        await capture(page, info, `${locale}-removed`);
      });
      test(`${locale}: late refused saves keep the same draft request and retry key`, async ({
        page,
        context,
        baseURL,
      }, info) => {
        await guardContext(context, baseURL!, locale);
        await page.goto("/dashboard/inventory");
        await runtime(page, info, locale, "parent");
        await scope(page)
          .getByRole("button", { name: msg(locale, "addItem"), exact: true })
          .click();
        const modal = page.getByTestId("inventory-modal");
        const name = PREFIX + " refused {name} 李";
        await modal.getByLabel(msg(locale, "name"), { exact: true }).fill(name);
        await modal
          .getByLabel(labelPrefix(msg(locale, "unit")))
          .fill(PRIVATE_UNIT);
        let release!: () => void;
        const waiting = new Promise<void>((r) => {
          release = r;
        });
        let attempt = 0;
        const writes: Array<{ body: unknown; key: string; url: string }> = [];
        await page.route(/\/api\/inventory\?/, async (route) => {
          if (route.request().method() !== "POST") return route.continue();
          writes.push({
            body: route.request().postDataJSON(),
            key: route.request().headers()[IDEMPOTENCY_HEADER.toLowerCase()],
            url: route.request().url(),
          });
          if (++attempt === 1) {
            await waiting;
            await route.fulfill({ status: 400, json: {} });
          } else
            await route.fulfill({
              status: 400,
              json: { error: { message: "Raw refusal {name} 李" } },
            });
        });
        await modal
          .getByRole("button", { name: msg(locale, "save"), exact: true })
          .click();
        await expect(
          modal.getByRole("button", {
            name: msg(locale, "saving"),
            exact: true,
          }),
        ).toBeDisabled();
        try {
          await capture(page, info, `${locale}-save-pending`);
        } finally {
          release();
        }
        await expect(modal.getByRole("alert")).toHaveText(
          msg(locale, "saveFailed"),
        );
        await expect(
          modal.getByLabel(msg(locale, "name"), { exact: true }),
        ).toHaveValue(name);
        await capture(page, info, `${locale}-save-fallback`, [
          modal.getByRole("button", { name: msg(locale, "save"), exact: true }),
        ]);
        await modal
          .getByRole("button", { name: msg(locale, "save"), exact: true })
          .press("Enter");
        await expect(modal.getByRole("alert")).toHaveText(
          "Raw refusal {name} 李",
        );
        expect(writes).toHaveLength(2);
        expect(writes[0]).toEqual(writes[1]);
        await capture(page, info, `${locale}-save-raw-retry`);
        expect(
          await withDb(
            async (db) =>
              (
                await db.query(
                  'SELECT id FROM "InventoryItem" WHERE family_id=$1 AND name=$2',
                  [A.family, name],
                )
              ).rows,
          ),
        ).toEqual([]);
        await page.keyboard.press("Escape");
        await expect(modal).toHaveCount(0);
      });
    }
  });
  test.describe("parent scan", () => {
    test.use({ storageState: authFile("parentA") });
    for (const locale of ["en", "es"] as const) {
      test(`${locale}: pick scanning controlled failures and empty review`, async ({
        page,
        context,
        baseURL,
      }, info) => {
        await guardContext(context, baseURL!, locale);
        await page.goto("/dashboard/inventory");
        await runtime(page, info, locale, "parent");
        await scope(page)
          .getByRole("button", { name: msg(locale, "scanFridge"), exact: true })
          .click();
        const dialog = page.getByTestId("scan-dialog");
        await expect(dialog).toContainText("Anthropic");
        await expect(dialog).toContainText("Herewoven");
        await capture(page, info, `${locale}-scan-pick`, [
          dialog.getByRole("button", {
            name: msg(locale, "pickPhoto"),
            exact: true,
          }),
        ]);
        let release!: () => void;
        const waiting = new Promise<void>((r) => {
          release = r;
        });
        let index = 0;
        const inputs: Array<{ method: string; type: string; length: number }> =
          [];
        const cases = [
          { status: 404, key: "scanUnavailable" },
          { status: 403, key: "scanForbidden" },
          { status: 503, key: "scanFailed" },
          { status: 429, key: "raw" },
          { status: 0, key: "scanNetwork" },
          { status: 200, key: "empty" },
        ] as const;
        await page.route("**/api/inventory/scan", async (route) => {
          const request = route.request();
          inputs.push({
            method: request.method(),
            type: request.headers()["content-type"],
            length: request.postDataBuffer()?.length ?? 0,
          });
          const result = cases[index++];
          if (index === 1) await waiting;
          if (result.status === 0) return route.abort("failed");
          return route.fulfill({
            status: result.status,
            json:
              result.key === "raw"
                ? { error: "Raw refusal {name} 李" }
                : result.status === 200
                  ? { items: [] }
                  : {},
          });
        });
        for (const [i, result] of cases.entries()) {
          await page.getByTestId("scan-file-input").setInputFiles({
            name: "synthetic.png",
            mimeType: "image/png",
            buffer: SYNTHETIC_PNG,
          });
          if (i === 0) {
            await expect(page.getByTestId("scan-loading")).toHaveText(
              msg(locale, "scanning"),
            );
            try {
              await capture(page, info, `${locale}-scan-pending`);
            } finally {
              release();
            }
          }
          if (result.key === "empty") {
            await expect(dialog).toContainText(msg(locale, "scanEmpty"));
            await capture(page, info, `${locale}-scan-empty`, [
              dialog.getByRole("button", {
                name: msg(locale, "tryPhoto"),
                exact: true,
              }),
            ]);
          } else {
            await expect(page.getByTestId("scan-error")).toHaveText(
              result.key === "raw"
                ? "Raw refusal {name} 李"
                : msg(locale, result.key),
            );
            await capture(page, info, `${locale}-scan-${result.key}`, [
              dialog.getByRole("button", {
                name: msg(locale, "tryPhoto"),
                exact: true,
              }),
            ]);
          }
        }
        expect(inputs).toHaveLength(cases.length);
        expect(
          inputs.every(
            (input) =>
              input.method === "POST" &&
              input.type.startsWith("multipart/form-data;") &&
              input.length > SYNTHETIC_PNG.length,
          ),
        ).toBe(true);
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(
          scope(page).getByRole("button", {
            name: msg(locale, "scanFridge"),
            exact: true,
          }),
        ).toBeFocused();
      });
      test(`${locale}: real synthetic scan and canonical partial lost-response retry`, async ({
        page,
        context,
        baseURL,
      }, info) => {
        await guardContext(context, baseURL!, locale);
        await page.goto("/dashboard/inventory");
        await runtime(page, info, locale, "parent");
        await scope(page)
          .getByRole("button", { name: msg(locale, "scanFridge"), exact: true })
          .click();
        const dialog = page.getByTestId("scan-dialog");
        const scan = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/inventory/scan" &&
            response.request().method() === "POST",
        );
        await page.getByTestId("scan-file-input").setInputFiles({
          name: "synthetic.png",
          mimeType: "image/png",
          buffer: SYNTHETIC_PNG,
        });
        const scanResponse = await scan;
        expect(scanResponse.status()).toBe(200);
        const suggestions = (await scanResponse.json()).items;
        expect(suggestions).toHaveLength(3);
        expect(suggestions[0].name).toBe(PREFIX + " scan {name} 李");
        const rows = page.getByTestId("scan-suggestion");
        await expect(rows).toHaveCount(3);
        for (const [i, key] of [
          "likely",
          "checkConfidence",
          "unsure",
        ].entries()) {
          await expect(rows.nth(i).getByTestId("scan-confidence")).toHaveText(
            msg(locale, key as "likely" | "checkConfidence" | "unsure"),
          );
          if (i < 2)
            await expect(rows.nth(i).getByRole("checkbox")).toBeChecked();
          else
            await expect(rows.nth(i).getByRole("checkbox")).not.toBeChecked();
        }
        await expect(
          rows.first().getByLabel(msg(locale, "unit"), { exact: true }),
        ).toHaveValue(PRIVATE_UNIT);
        await capture(page, info, `${locale}-scan-review`, [
          rows
            .first()
            .locator("label")
            .filter({ has: page.getByRole("checkbox") }),
        ]);
        await rows
          .first()
          .getByLabel(msg(locale, "name"), { exact: true })
          .fill("");
        await dialog.getByTestId("scan-add").click();
        await expect(rows.first().getByTestId("scan-row-error")).toHaveText(
          msg(locale, "enterName"),
        );
        await expect(dialog.getByRole("alert")).toHaveText(
          msg(locale, "fixRows"),
        );
        await capture(page, info, `${locale}-scan-validation`);
        await rows
          .first()
          .getByLabel(msg(locale, "name"), { exact: true })
          .fill(PREFIX + " scan edited {name} 李");
        const writes: Array<{
          body: unknown;
          url: string;
          key: string;
          status: number;
          replayed: string | null;
        }> = [];
        await page.route(/\/api\/inventory\?/, async (route) => {
          if (route.request().method() !== "POST") return route.continue();
          const result = await route.fetch();
          writes.push({
            body: route.request().postDataJSON(),
            url: route.request().url(),
            key: route.request().headers()[IDEMPOTENCY_HEADER.toLowerCase()],
            status: result.status(),
            replayed:
              result.headers()[IDEMPOTENCY_REPLAYED_HEADER.toLowerCase()] ??
              null,
          });
          // Actual second row committed, then its synthetic client response is lost.
          if (writes.length === 2) return route.abort("failed");
          return route.fulfill({ response: result });
        });
        await dialog.getByTestId("scan-add").click();
        await expect(rows).toHaveCount(2);
        await expect(dialog.getByRole("alert")).toHaveText(
          msg(locale, "partialOneOne", { count: 1, failed: 1 }),
        );
        await expect(
          rows.first().getByLabel(msg(locale, "name"), { exact: true }),
        ).toHaveValue(PREFIX + " scan second");
        await capture(page, info, `${locale}-scan-partial-lost-response`, [
          dialog.getByTestId("scan-add"),
        ]);
        await dialog.getByTestId("scan-add").press("Enter");
        await expect(dialog).toHaveCount(0);
        await expect(page.getByTestId("inventory-notice")).toHaveText(
          msg(locale, "photoAddedMany", { count: 2 }),
        );
        expect(writes).toHaveLength(3);
        expect(writes[0].key).not.toBe(writes[1].key);
        expect(writes[1].body).toEqual(writes[2].body);
        expect(writes[1].url).toBe(writes[2].url);
        expect(writes[1].key).toBe(writes[2].key);
        expect(writes[2].replayed).toBe("true");
        expect(writes.every((write) => write.status === 201)).toBe(true);
        expect(writes[0].body).toEqual({
          name: PREFIX + " scan edited {name} 李",
          location: "fridge",
          amount: 2,
          unit: PRIVATE_UNIT,
          expires_on: null,
        });
        const created = await withDb(
          async (db) =>
            (
              await db.query(
                'SELECT name,unit,location,amount FROM "InventoryItem" WHERE family_id=$1 AND name LIKE $2 ORDER BY name',
                [A.family, PREFIX + " scan%"],
              )
            ).rows,
        );
        expect(created).toHaveLength(2);
        expect(
          created.some(
            (row) =>
              row.unit === PRIVATE_UNIT &&
              row.location === "fridge" &&
              Number(row.amount) === 2,
          ),
        ).toBe(true);
        expect(
          created.some((row) => row.name === PREFIX + " scan uncertain"),
        ).toBe(false);
        await capture(page, info, `${locale}-scan-retry-complete`);
      });
      test(`${locale}: scan collision unticks a doubtful retry and close reports already committed rows`, async ({
        page,
        context,
        baseURL,
      }, info) => {
        await guardContext(context, baseURL!, locale);
        await page.goto("/dashboard/inventory");
        await runtime(page, info, locale, "parent");
        await scope(page)
          .getByRole("button", { name: msg(locale, "scanFridge"), exact: true })
          .click();
        const dialog = page.getByTestId("scan-dialog");
        await page.getByTestId("scan-file-input").setInputFiles({
          name: "synthetic.png",
          mimeType: "image/png",
          buffer: SYNTHETIC_PNG,
        });
        const rows = page.getByTestId("scan-suggestion");
        await expect(rows).toHaveCount(3);
        const keys: string[] = [];
        let index = 0;
        await page.route(/\/api\/inventory\?/, async (route) => {
          if (route.request().method() !== "POST") return route.continue();
          keys.push(
            route.request().headers()[IDEMPOTENCY_HEADER.toLowerCase()],
          );
          if (++index === 1) return route.continue();
          return route.fulfill({
            status: 422,
            json: {
              error: {
                code: "IDEMPOTENCY_KEY_REUSED",
                message: "Raw synthetic collision",
              },
            },
          });
        });
        await dialog.getByTestId("scan-add").click();
        await expect(rows).toHaveCount(2);
        await expect(rows.first().getByRole("checkbox")).not.toBeChecked();
        await expect(rows.first().getByTestId("scan-row-error")).toHaveText(
          msg(locale, "probablyAdded"),
        );
        await capture(page, info, `${locale}-scan-collision`, [
          rows
            .first()
            .locator("label")
            .filter({ has: page.getByRole("checkbox") }),
        ]);
        await rows.first().getByRole("checkbox").check();
        await dialog.getByTestId("scan-add").click();
        await expect(rows.first().getByRole("checkbox")).not.toBeChecked();
        expect(keys).toHaveLength(3);
        expect(keys[1]).not.toBe(keys[2]);
        await dialog
          .getByRole("button", { name: msg(locale, "close"), exact: true })
          .click();
        await expect(dialog).toHaveCount(0);
        await expect(page.getByTestId("inventory-notice")).toHaveText(
          msg(locale, "photoAddedOne", { count: 1 }),
        );
        const created = await withDb(
          async (db) =>
            (
              await db.query(
                'SELECT id FROM "InventoryItem" WHERE family_id=$1 AND name LIKE $2',
                [A.family, PREFIX + " scan%"],
              )
            ).rows,
        );
        expect(created).toHaveLength(1);
        await capture(page, info, `${locale}-scan-partial-close`);
      });
    }
  });
  test.describe("family B", () => {
    test.use({ storageState: authFile("parentB") });
    for (const locale of ["en", "es"] as const)
      test(`${locale}: isolated data and foreign direct mutation refusal`, async ({
        page,
        context,
        baseURL,
      }, info) => {
        await guardContext(context, baseURL!, locale);
        await page.goto("/dashboard/inventory");
        await runtime(page, info, locale, "parentB");
        await expect(page.getByTestId("inventory-item")).toHaveCount(1);
        await expect(scope(page)).toContainText(PREFIX + " B canary");
        await expect(scope(page)).not.toContainText(PRIVATE_NAME);
        await capture(page, info, `${locale}-family-b-isolated`);
        for (const id of [ITEM, "fx_e2e_i18n_inventory_missing"]) {
          expect(
            (await browserFetch(page, `/api/inventory/${id}`)).status,
          ).toBe(404);
          for (const [method, path, body] of [
            [
              "PATCH",
              `/api/inventory/${id}`,
              { name: PREFIX + " foreign", location: "fridge" },
            ],
            ["POST", `/api/inventory/${id}/consume`, {}],
            ["POST", `/api/inventory/${id}/discard`, {}],
            ["DELETE", `/api/inventory/${id}`, undefined],
          ] as const)
            expect((await browserSend(page, method, path, body)).status).toBe(
              404,
            );
        }
        expect(
          await withDb(
            async (db) =>
              (
                await db.query(
                  'SELECT status FROM "InventoryItem" WHERE id=$1',
                  [ITEM],
                )
              ).rows[0].status,
          ),
        ).toBe("active");
      });
  });
});
