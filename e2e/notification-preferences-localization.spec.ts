/** #428: guarded existing preference presentation and actual own-fixture saves. */
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page, TestInfo } from "@playwright/test";
import {
  test,
  expect,
  browserFetch,
  browserSend,
  loginViaUi,
} from "./support/test";
import { authFile } from "./support/env";
import { goOffline, goOnline } from "./support/network";
import { FIXTURE_IDS, FIXTURE_EMAILS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import {
  notificationPreferencesMessages as messages,
  type NotificationPreferencesMessage,
} from "../src/i18n/notification-preferences";
import { navigationMessages } from "../src/i18n/navigation";
import {
  isPseudolocaleEnabled,
  pseudolocalizeTemplate,
} from "../src/i18n/pseudo";
const expanded = isPseudolocaleEnabled(process.env);
const projects = [
  "phone-390x844",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
];
const path = "/api/users/preferences";
function translate(template: string, params: Record<string, string> = {}) {
  return (expanded ? pseudolocalizeTemplate(template) : template).replace(
    /\{(\w+)\}/g,
    (match, key) => params[key] ?? match,
  );
}
async function capture(
  page: Page,
  info: TestInfo,
  name: string,
  targets: Locator[] = [],
) {
  for (const target of targets) {
    await target.evaluate((el) =>
      el.scrollIntoView({ block: "center", inline: "nearest" }),
    );
    await expect
      .poll(async () => (await target.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(44);
    const b = await target.boundingBox();
    const v = page.viewportSize()!;
    expect(b!.width).toBeGreaterThanOrEqual(44);
    expect(b!.x).toBeGreaterThanOrEqual(0);
    expect(b!.y).toBeGreaterThanOrEqual(0);
    expect(b!.x + b!.width).toBeLessThanOrEqual(v.width);
    expect(b!.y + b!.height).toBeLessThanOrEqual(v.height);
    await target.focus();
    await expect(target).toBeFocused();
    expect(
      await target.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return el.contains(
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
        );
      }),
    ).toBe(true);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath(name + ".png"),
    fullPage: false,
    animations: "disabled",
  });
  const violations = (
    await new AxeBuilder({ page })
      .include('[data-testid="notification-preferences"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze()
  ).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  await info.attach(name + "-axe", {
    body: JSON.stringify(violations),
    contentType: "application/json",
  });
  expect(violations).toEqual([]);
}
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
      test(`${locale}: controls retry saves validation offline and restoration`, async ({
        page,
        context,
        baseURL,
      }, info) => {
        test.skip(
          !projects.includes(info.project.name),
          "Representative existing preference viewports",
        );
        assertFixtureTargetAllowed(process.env);
        expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
          new URL(baseURL!).hostname,
        );
        await context.route("**/*", (route) => {
          const u = new URL(route.request().url());
          return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ||
            ["data:", "blob:"].includes(u.protocol)
            ? route.continue()
            : route.abort();
        });
        if (role === "teen") {
          await loginViaUi(page, FIXTURE_EMAILS.familyA.teen);
          await expect(page).toHaveURL(/\/dashboard(?:\/)?$/);
        } else await page.goto("/dashboard");
        const auth = await browserFetch(page, "/api/auth/me");
        expect(auth.status).toBe(200);
        const user = JSON.parse(auth.body).user;
        expect(user.id).toBe(FIXTURE_IDS.familyA[role]);
        expect(user.role).toBe(role);
        const before = await browserFetch(page, path);
        expect(before.status).toBe(200);
        const original = JSON.parse(before.body);
        const version = await browserFetch(page, "/api/version");
        expect(version.status).toBe(200);
        await info.attach("actual-runtime-role-mode", {
          body: JSON.stringify({
            runtime: JSON.parse(version.body),
            role,
            expanded,
          }),
          contentType: "application/json",
        });
        const msg = (
          key: NotificationPreferencesMessage,
          params: Record<string, string> = {},
        ) => translate(messages[locale][key], params);
        const prefs = page.getByTestId("notification-preferences");
        try {
          await page.evaluate(
            (language) =>
              localStorage.setItem("familyPlanner_language", language),
            locale,
          );
          await page.route("**/api/users/preferences", (route) =>
            route.request().method() === "GET"
              ? route.fulfill({
                  status: 503,
                  contentType: "application/json",
                  body: "{}",
                })
              : route.continue(),
          );
          await page.goto(
            role === "child" ? "/dashboard" : "/dashboard/settings",
          );
          await expect(page.locator("html")).toHaveAttribute("lang", locale);
          if (expanded)
            await expect(page.locator("html")).toHaveAttribute(
              "data-pseudolocalized",
              "true",
            );
          if (role === "child") {
            await page
              .getByRole("button", {
                name: translate(navigationMessages[locale].userMenu),
                exact: true,
              })
              .click();
            await page
              .getByRole("button", {
                name: translate(navigationMessages[locale].notifications),
                exact: true,
              })
              .click();
          }
          await expect(prefs.getByRole("alert")).toHaveText(msg("loadFailed"));
          await capture(page, info, `${role}-${locale}-load-failed`, [
            prefs.getByRole("button", { name: msg("retry"), exact: true }),
          ]);
          await page.unroute("**/api/users/preferences");
          await prefs
            .getByRole("button", { name: msg("retry"), exact: true })
            .click();
          const events = prefs.getByRole("switch", {
            name: msg("eventsLabel"),
            exact: true,
          });
          await expect(events).toHaveAttribute(
            "aria-checked",
            String(original.preferences.events),
          );
          const summarySwitch = prefs.getByRole("switch", {
            name: msg("summaryLabel"),
            exact: true,
          });
          const quietSwitch = prefs
            .getByTestId("quiet-hours")
            .getByRole("switch");
          await summarySwitch.evaluate((el) =>
            el.scrollIntoView({ block: "center", inline: "nearest" }),
          );
          await summarySwitch.focus();
          await page.keyboard.press("Tab");
          await expect(quietSwitch).toBeFocused();
          expect(
            await quietSwitch.evaluate((el) => {
              const r = el.getBoundingClientRect();
              return el.contains(
                document.elementFromPoint(
                  r.x + r.width / 2,
                  r.y + r.height / 2,
                ),
              );
            }),
          ).toBe(true);
          await capture(
            page,
            info,
            `${role}-${locale}-ready`,
            await prefs.getByRole("switch").all(),
          );
          const request = page.waitForRequest(
            (r) => r.url().endsWith(path) && r.method() === "PATCH",
          );
          await events.click();
          const patch = await request;
          expect(patch.postDataJSON()).toEqual({
            events: !original.preferences.events,
          });
          expect(patch.headers()["idempotency-key"]).toMatch(
            /^[A-Za-z0-9_-]{16,128}$/,
          );
          await expect(
            prefs.getByText(
              msg("saved", {
                label: msg("eventsLabel"),
                state: msg(
                  !original.preferences.events ? "onState" : "offState",
                ),
              }),
              { exact: true },
            ),
          ).toBeVisible();
          const saved = JSON.parse((await browserFetch(page, path)).body);
          expect(saved.preferences).toEqual({
            ...original.preferences,
            events: !original.preferences.events,
          });
          await capture(page, info, `${role}-${locale}-category-saved`, [
            events,
          ]);
          await page.route("**/api/users/preferences", (route) =>
            route.request().method() === "PATCH"
              ? route.fulfill({
                  status: 500,
                  contentType: "application/json",
                  body: "{}",
                })
              : route.continue(),
          );
          await events.click();
          await expect(
            prefs.getByText(
              msg("failed", {
                label: msg("eventsLabel"),
                state: msg(
                  !original.preferences.events ? "onState" : "offState",
                ),
              }),
              { exact: true },
            ),
          ).toBeVisible();
          await expect(events).toHaveAttribute(
            "aria-checked",
            String(!original.preferences.events),
          );
          await capture(page, info, `${role}-${locale}-category-rollback`, [
            events,
          ]);
          await page.unroute("**/api/users/preferences");
          const from = prefs.getByLabel(msg("quietFrom"), { exact: true }),
            until = prefs.getByLabel(msg("quietUntil"), { exact: true });
          await until.fill(original.quietHours.start);
          // Native time inputs commit on blur in some mobile Chromium/locale
          // combinations. Commit the equal value before clicking the switch so
          // the validation assertion observes the same draft the user sees.
          await until.press("Tab");
          await expect(until).not.toBeFocused();
          await prefs.getByTestId("quiet-hours").getByRole("switch").click();
          await expect(prefs.getByRole("alert")).toHaveText(
            msg("differentTimes"),
          );
          await capture(page, info, `${role}-${locale}-quiet-validation`, [
            from,
            until,
          ]);
          await from.fill("21:30");
          await until.fill("06:45");
          const quietRequest = page.waitForRequest(
            (r) => r.url().endsWith(path) && r.method() === "PATCH",
          );
          await prefs
            .getByRole("button", { name: msg("saveTimes"), exact: true })
            .click();
          const quietPatch = await quietRequest;
          const quietValue = {
            enabled: original.quietHours.enabled,
            start: "21:30",
            end: "06:45",
            timeZone: await page.evaluate(
              () => Intl.DateTimeFormat().resolvedOptions().timeZone,
            ),
          };
          expect(quietPatch.postDataJSON()).toEqual({ quietHours: quietValue });
          expect(quietPatch.headers()["idempotency-key"]).toMatch(
            /^[A-Za-z0-9_-]{16,128}$/,
          );
          await expect
            .poll(
              async () =>
                JSON.parse((await browserFetch(page, path)).body).quietHours,
            )
            .toEqual(quietValue);
          const clocks = await page.evaluate(
            (language) =>
              [new Date(2000, 0, 1, 21, 30), new Date(2000, 0, 1, 6, 45)].map(
                (value) =>
                  value
                    .toLocaleTimeString(language, {
                      hour: "numeric",
                      minute: "2-digit",
                    })
                    .replace(/[\u202f\u00a0]/g, " "),
              ),
            locale,
          );
          const quietFeedback = (enabled: boolean) =>
            enabled
              ? msg("quietSavedOn", { start: clocks[0], end: clocks[1] })
              : msg("quietSavedOff");
          await expect(
            prefs.getByText(quietFeedback(original.quietHours.enabled), {
              exact: true,
            }),
          ).toBeVisible();
          await capture(page, info, `${role}-${locale}-quiet-saved`, [
            from,
            until,
          ]);
          const quietToggleRequest = page.waitForRequest(
            (r) => r.url().endsWith(path) && r.method() === "PATCH",
          );
          await quietSwitch.click();
          const quietTogglePatch = await quietToggleRequest;
          const toggledQuiet = {
            ...quietValue,
            enabled: !original.quietHours.enabled,
          };
          expect(quietTogglePatch.postDataJSON()).toEqual({
            quietHours: toggledQuiet,
          });
          expect(quietTogglePatch.headers()["idempotency-key"]).toMatch(
            /^[A-Za-z0-9_-]{16,128}$/,
          );
          await expect(
            prefs.getByText(quietFeedback(toggledQuiet.enabled), {
              exact: true,
            }),
          ).toBeVisible();
          await expect
            .poll(
              async () =>
                JSON.parse((await browserFetch(page, path)).body).quietHours,
            )
            .toEqual(toggledQuiet);
          await capture(page, info, `${role}-${locale}-quiet-toggled`, [
            from,
            until,
          ]);
          const summary = prefs.getByRole("switch", {
            name: msg("summaryLabel"),
            exact: true,
          });
          const summaryRequest = page.waitForRequest(
            (r) => r.url().endsWith(path) && r.method() === "PATCH",
          );
          await summary.click();
          const summaryPatch = await summaryRequest;
          const summaryValue = {
            enabled: !original.morningSummary.enabled,
            timeZone: quietValue.timeZone,
          };
          expect(summaryPatch.postDataJSON()).toEqual({
            morningSummary: summaryValue,
          });
          expect(summaryPatch.headers()["idempotency-key"]).toMatch(
            /^[A-Za-z0-9_-]{16,128}$/,
          );
          await expect
            .poll(
              async () =>
                JSON.parse((await browserFetch(page, path)).body)
                  .morningSummary,
            )
            .toEqual(summaryValue);
          await expect(
            prefs.getByText(
              msg("saved", {
                label: msg("summaryLabel"),
                state: msg(summaryValue.enabled ? "onState" : "offState"),
              }),
              { exact: true },
            ),
          ).toBeVisible();
          await capture(page, info, `${role}-${locale}-summary-saved`, [
            summary,
          ]);
          await goOffline(page);
          await expect(
            prefs.getByText(msg("offline"), { exact: true }),
          ).toBeVisible();
          for (const control of await prefs.getByRole("switch").all())
            await expect(control).toBeDisabled();
          await prefs
            .getByText(msg("offline"), { exact: true })
            .scrollIntoViewIfNeeded();
          await capture(page, info, `${role}-${locale}-offline`);
          await goOnline(page);
          await expect(
            prefs.getByText(msg("offline"), { exact: true }),
          ).toBeHidden();
          await expect(events).toBeEnabled();
          if (role === "child") {
            await page.keyboard.press("Escape");
            await expect(
              page.getByTestId("notification-preferences-dialog"),
            ).toBeHidden();
            await expect(
              page.getByRole("button", {
                name: translate(navigationMessages[locale].userMenu),
                exact: true,
              }),
            ).toBeFocused();
          }
        } finally {
          await context.setOffline(false);
          await page.unroute("**/api/users/preferences");
          const restored = await browserSend(page, "PATCH", path, {
            ...original.preferences,
            quietHours: original.quietHours,
            morningSummary: original.morningSummary,
          });
          expect(restored.status).toBe(200);
          const readback = await browserFetch(page, path);
          expect(readback.status).toBe(200);
          expect(JSON.parse(readback.body)).toEqual(original);
        }
      });
  });
