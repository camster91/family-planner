/** #443 real server role/household boundaries, isolated fabricated rows only. */
import pg from "pg";
import { test, expect, browserFetch, loginViaUi } from "./support/test";
import { authFile } from "./support/env";
import { FIXTURE_IDS, FIXTURE_EMAILS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import {
  SettingsRequests,
  guard,
  install,
  identity,
  language,
  capture,
  msg,
  enabled,
} from "./support/settings-localization";
import type { BrowserContext } from "@playwright/test";

test.skip(
  !["enabled", "unavailable"].includes(process.env.E2E_SETTINGS_QA ?? ""),
  "Requires isolated opted-in Settings server; normal gates unchanged",
);
const ids = ["fx_settings_qa_isolation_a", "fx_settings_qa_isolation_b"];
async function withDb<T>(fn: (db: pg.Client) => Promise<T>) {
  assertFixtureTargetAllowed(process.env);
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
    new URL(process.env.DATABASE_URL!).hostname,
  );
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}
async function canaries() {
  await withDb(async (db) => {
    await db.query("BEGIN");
    try {
      const found = await db.query(
        'SELECT id FROM "CalendarSubscription" WHERE id = ANY($1::text[])',
        [ids],
      );
      expect(found.rows).toEqual([]);
      const connections = await db.query(
        'SELECT id FROM "CalendarConnection" WHERE id = ANY($1::text[])',
        [ids],
      );
      expect(connections.rows).toEqual([]);
      for (const [i, family] of [
        FIXTURE_IDS.familyA,
        FIXTURE_IDS.familyB,
      ].entries()) {
        await db.query(
          'INSERT INTO "CalendarSubscription" (id,family_id,created_by,name,url_enc,last_status) VALUES ($1,$2,$3,$4,$5,$6)',
          [
            ids[i],
            family.family,
            family.parent,
            `Synthetic Settings isolation ${i}`,
            "synthetic-unused-not-a-calendar-url",
            "pending",
          ],
        );
        await db.query(
          'INSERT INTO "CalendarConnection" (id,family_id,user_id,provider,updated_at) VALUES ($1,$2,$3,$4,NOW())',
          [
            ids[i],
            family.family,
            family.parent,
            "synthetic-settings-isolation",
          ],
        );
      }
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  });
}
async function clean() {
  await withDb(async (db) => {
    // Only these exact synthetic rows with the expected fixture family owner.
    for (const [i, family] of [
      FIXTURE_IDS.familyA,
      FIXTURE_IDS.familyB,
    ].entries()) {
      await db.query(
        'DELETE FROM "CalendarConnection" WHERE id=$1 AND family_id=$2 AND user_id=$3 AND provider=$4',
        [ids[i], family.family, family.parent, "synthetic-settings-isolation"],
      );
      await db.query(
        'DELETE FROM "CalendarSubscription" WHERE id=$1 AND family_id=$2 AND created_by=$3 AND name=$4',
        [
          ids[i],
          family.family,
          family.parent,
          `Synthetic Settings isolation ${i}`,
        ],
      );
    }
    expect(
      (
        await db.query(
          'SELECT id FROM "CalendarConnection" WHERE id=ANY($1::text[])',
          [ids],
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await db.query(
          'SELECT id FROM "CalendarSubscription" WHERE id=ANY($1::text[])',
          [ids],
        )
      ).rows,
    ).toEqual([]);
  });
}
async function actual(
  context: BrowserContext,
  baseURL: string,
  path: string,
  method = "GET",
  body?: unknown,
) {
  const csrf =
    (await context.cookies()).find((c) => c.name === "csrf_token")?.value ?? "";
  return context.request.fetch(new URL(path, baseURL).href, {
    method,
    data: body,
    headers: method === "GET" ? {} : { "X-CSRF-Token": csrf },
  });
}
for (const role of ["parentA", "parentB", "teen", "child"] as const)
  test.describe(role, () => {
    test.use({
      storageState:
        role === "teen"
          ? { cookies: [], origins: [] }
          : authFile(role === "child" ? "childA" : role),
    });
    for (const locale of ["en", "es"] as const)
      test(`${locale}: actual Settings role visibility sensitive API boundaries and two-household isolation`, async ({
        page,
        context,
        baseURL,
      }, info) => {
        await guard(context, baseURL!, locale);
        if (role === "teen") {
          await loginViaUi(page, FIXTURE_EMAILS.familyA.teen);
          await expect(page).toHaveURL(/\/dashboard\/?$/);
        } else await page.goto("/dashboard");
        const auth = await browserFetch(page, "/api/auth/me");
        expect(auth.status).toBe(200);
        const user = JSON.parse(auth.body).user;
        const family =
            role === "parentB" ? FIXTURE_IDS.familyB : FIXTURE_IDS.familyA,
          who = role === "teen" || role === "child" ? role : "parent";
        expect(user.id).toBe(family[who]);
        expect(user.role).toBe(who);
        await canaries();
        const s = new SettingsRequests();
        try {
          const list = await actual(
            context,
            baseURL!,
            "/api/calendar/subscriptions",
          );
          if (role === "child") expect(list.status()).toBe(403);
          else {
            expect(list.status()).toBe(200);
            const data = await list.json();
            expect(
              data.subscriptions.map((v: { id: string }) => v.id),
            ).toContain(ids[role === "parentB" ? 1 : 0]);
            expect(
              data.subscriptions.map((v: { id: string }) => v.id),
            ).not.toContain(ids[role === "parentB" ? 0 : 1]);
            if (role === "teen")
              expect(
                data.subscriptions.every(
                  (v: Record<string, unknown>) => !Object.hasOwn(v, "url_hint"),
                ),
              ).toBe(true);
          }
          const connections = await actual(
            context,
            baseURL!,
            "/api/calendar/connections",
          );
          if (!enabled) expect(connections.status()).toBe(404);
          else if (who !== "parent") expect(connections.status()).toBe(403);
          else {
            expect(connections.status()).toBe(200);
            const data = await connections.json();
            expect(data.connections.map((v: { id: string }) => v.id)).toContain(
              ids[role === "parentB" ? 1 : 0],
            );
            expect(
              data.connections.map((v: { id: string }) => v.id),
            ).not.toContain(ids[role === "parentB" ? 0 : 1]);
            const foreign = ids[role === "parentB" ? 0 : 1];
            expect(
              (
                await actual(
                  context,
                  baseURL!,
                  "/api/calendar/sync-connections/" + foreign,
                  "DELETE",
                )
              ).status(),
            ).toBe(404);
            expect(
              (
                await withDb((db) =>
                  db.query('SELECT id FROM "CalendarConnection" WHERE id=$1', [
                    foreign,
                  ]),
                )
              ).rows,
            ).toHaveLength(1);
          }
          if (who !== "parent") {
            for (const path of [
              "/api/family/feed-token",
              "/api/family/ai-settings",
            ])
              expect((await actual(context, baseURL!, path)).status()).toBe(
                403,
              );
            expect(
              (
                await actual(
                  context,
                  baseURL!,
                  "/api/family/beta-metrics",
                  "PATCH",
                  { enabled: true },
                )
              ).status(),
            ).toBe(403);
            expect(
              (
                await actual(
                  context,
                  baseURL!,
                  "/api/users/elevation-pin",
                  "PUT",
                  { pin: "546827", currentPassword: "synthetic-never-valid" },
                )
              ).status(),
            ).toBe(enabled ? 403 : 404);
            expect(
              (
                await actual(
                  context,
                  baseURL!,
                  "/api/calendar/subscriptions",
                  "POST",
                  {
                    name: "Synthetic forbidden",
                    url: "https://example.test/never.ics",
                  },
                )
              ).status(),
            ).toBe(403);
          }
          await install(page, s);
          await page.goto("/dashboard/settings");
          if (role === "child") {
            await expect(page).toHaveURL(/\/dashboard\/?$/);
            await identity(page, info, locale, role);
            await expect(page.locator("#profileName")).toHaveCount(0);
            await capture(
              page,
              info,
              "child-settings-redirect",
              [],
              page.locator("main"),
            );
          } else {
            await expect(page.locator("#profileName")).toBeVisible();
            await identity(page, info, locale, role);
            const before = s.calls.length;
            await language(page, locale === "en" ? "es" : "en");
            expect(s.calls).toHaveLength(before);
            if (role === "teen") {
              await expect(page.locator("#settings-family")).toHaveCount(0);
              await expect(page.getByTestId("beta-metrics-switch")).toHaveCount(
                0,
              );
              await expect(page.getByTestId("tablet-pin")).toHaveCount(0);
              await expect(page.locator("#aiKey")).toHaveCount(0);
              for (const path of [
                "/api/family/feed-token",
                "/api/family/ai-settings",
                "/api/calendar/subscriptions",
                "/api/calendar/connections",
              ])
                expect(s.count("GET", path)).toBe(0);
              await expect(
                page.getByRole("button", {
                  name: msg(locale === "en" ? "es" : "en", "dataExport"),
                  exact: false,
                }),
              ).toBeVisible();
              await expect(
                page.getByRole("button", {
                  name: msg(locale === "en" ? "es" : "en", "deleteAccount"),
                  exact: true,
                }),
              ).toBeVisible();
            } else await expect(page.locator("#settings-family")).toBeVisible();
            await capture(page, info, role + "-settings-visibility");
            const currentLocale = locale === "en" ? "es" : "en";
            const exportButton = page.getByRole("button", {
              name: msg(currentLocale, "dataExport"),
              exact: false,
            });
            s.reply("GET", "/api/users/export", { status: 503 });
            await exportButton.click();
            await expect(
              page.getByText(msg(currentLocale, "exportFailed"), {
                exact: true,
              }),
            ).toBeVisible();
            const release = s.hold("GET", "/api/users/export");
            await exportButton.click();
            await s.arrived("GET", "/api/users/export", 2);
            await expect(
              page.getByRole("button", {
                name: msg(currentLocale, "preparingData"),
                exact: false,
              }),
            ).toBeDisabled();
            await capture(page, info, role + "-synthetic-export-pending");
            const day = await page.evaluate(() =>
              new Date().toISOString().slice(0, 10),
            );
            const download = page.waitForEvent("download");
            release({
              body: { synthetic: true, fixture: user.id, noRealExport: true },
            });
            const file = await download;
            expect(file.suggestedFilename()).toBe(
              `family-planner-export-${day}.json`,
            );
            s.assertLast("GET", "/api/users/export");
            expect(s.count("GET", "/api/users/export")).toBe(2);
            const deleteButton = page.getByRole("button", {
              name: msg(currentLocale, "deleteAccount"),
              exact: true,
            });
            await deleteButton.click();
            const modal = page.getByTestId("delete-account-dialog");
            await expect(modal).toBeVisible();
            await page.keyboard.press("Tab");
            expect(
              await modal.evaluate((el) => el.contains(document.activeElement)),
            ).toBe(true);
            await capture(page, info, role + "-deletion-consent-cancel");
            await page.keyboard.press("Escape");
            await expect(modal).toHaveCount(0);
            await expect(deleteButton).toBeFocused();
            expect(s.calls.filter((c) => c.method === "DELETE")).toEqual([]);
          }
        } finally {
          try {
            s.finish();
          } finally {
            await clean();
          }
        }
      });
  });
