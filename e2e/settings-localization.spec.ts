/** Full owned #443 route matrix. Synthetic actions are never real provider/credential acceptance. */
import type { Page, BrowserContext, TestInfo } from "@playwright/test";
import { test as base, expect, browserFetch, loginViaUi } from "./support/test";
import { authFile, E2E_ANCHOR } from "./support/env";
import { FIXTURE_IDS, FIXTURE_EMAILS } from "../src/lib/fixtures/dataset";
import { PRODUCT_BRAND } from "../src/lib/brand";
import {
  SettingsRequests,
  type Locale,
  enabled,
  msg,
  guard,
  install,
  identity,
  language,
  open,
  capture,
  PROFILE,
  RAW,
  KEY,
  PRIVATE_URL,
  MODEL,
  TOKEN,
  SUB_ID,
  CON_ID,
} from "./support/settings-localization";
const test = base.extend<{ settings: SettingsRequests }>({
  settings: async ({ page }, provide) => {
    const requests = new SettingsRequests();
    await install(page, requests);
    try {
      await provide(requests);
    } finally {
      requests.finish();
    }
  },
});
test.skip(
  !["enabled", "unavailable"].includes(process.env.E2E_SETTINGS_QA ?? ""),
  "Requires isolated opted-in Settings server; normal gates unchanged",
);
async function begin(
  page: Page,
  context: BrowserContext,
  baseURL: string,
  locale: Locale,
  requests: SettingsRequests,
  info: TestInfo,
  ready = true,
) {
  await guard(context, baseURL, locale);
  await page.goto("/dashboard");
  const auth = await browserFetch(page, "/api/auth/me");
  expect(auth.status).toBe(200);
  const user = JSON.parse(auth.body).user;
  expect(user.id).toBe(FIXTURE_IDS.familyA.parent);
  expect(user.role).toBe("parent");
  requests.calls = [];
  await page.goto("/dashboard/settings");
  if (ready) await expect(page.locator("#profileName")).toBeVisible();
  await identity(page, info, locale, "parentA");
}
const other = (locale: Locale): Locale => (locale === "en" ? "es" : "en");
test.describe("parentA", () => {
  test.use({ storageState: authFile("parentA") });
  for (const locale of ["en", "es"] as const) {
    test(`${locale}: profile loading drafts pending current raw refusal success and theme`, async ({
      page,
      context,
      baseURL,
      settings: s,
    }, info) => {
      const release = s.hold("GET", "/api/users");
      await begin(page, context, baseURL!, locale, s, info, false);
      const loading = page.getByText(msg(locale, "loading"), { exact: true });
      await expect(loading).toBeVisible();
      await capture(
        page,
        info,
        "profile-first-loading",
        [],
        loading.locator(".."),
      );
      release({
        body: {
          user: {
            id: FIXTURE_IDS.familyA.parent,
            name: PROFILE,
            email: FIXTURE_EMAILS.familyA.parent,
            age: 31,
            role: "parent",
          },
        },
      });
      const name = page.locator("#profileName");
      await expect(name).toHaveValue(PROFILE);
      await name.fill(PROFILE + " draft");
      await page.locator("#profileAge").fill("37");
      const pending = s.hold("PATCH", "/api/users");
      await page
        .getByRole("button", { name: msg(locale, "saveProfile"), exact: true })
        .click();
      await s.arrived("PATCH", "/api/users");
      s.assertLast("PATCH", "/api/users", {
        name: PROFILE + " draft",
        age: 37,
      });
      await expect(
        page.getByRole("button", { name: msg(locale, "saving"), exact: true }),
      ).toBeDisabled();
      const count = s.calls.length;
      const next = other(locale);
      await language(page, next);
      await expect(name).toHaveValue(PROFILE + " draft");
      await expect(page.locator("#profileAge")).toHaveValue("37");
      expect(s.calls).toHaveLength(count);
      await capture(page, info, "profile-pending-locale");
      pending({ status: 400, body: {} });
      await expect(
        page.getByText(msg(next, "profileFailed"), { exact: true }),
      ).toBeVisible();
      await language(page, locale);
      await expect(
        page.getByText(msg(locale, "profileFailed"), { exact: true }),
      ).toBeVisible();
      s.reply("PATCH", "/api/users", { status: 400, body: { error: RAW } });
      await page
        .getByRole("button", { name: msg(locale, "saveProfile"), exact: true })
        .click();
      await expect(page.getByText(RAW, { exact: true })).toBeVisible();
      await language(page, next);
      await expect(page.getByText(RAW, { exact: true })).toBeVisible();
      expect(await page.locator("b").count()).toBe(0);
      await capture(page, info, "profile-raw-refusal");
      s.reply("PATCH", "/api/users", {
        body: { user: { name: PROFILE + " draft" } },
      });
      await page
        .getByRole("button", { name: msg(next, "saveProfile"), exact: true })
        .click();
      await expect(
        page.getByText(msg(next, "profileUpdated"), { exact: true }),
      ).toBeVisible();
      await expect(name).toHaveValue(PROFILE + " draft");
      await language(page, locale);
      await expect(
        page.getByText(msg(locale, "profileUpdated"), { exact: true }),
      ).toBeVisible();
      await capture(page, info, "profile-saved-visible", [
        page.getByRole("button", {
          name: msg(locale, "saveProfile"),
          exact: true,
        }),
      ]);
      expect(s.count("PATCH", "/api/users")).toBe(3);
      expect(s.count("GET", "/api/users")).toBe(1);
      // Theme remains the canonical device preference, independent of locale.
      const themes = page
        .locator("#settings-account")
        .getByRole("group")
        .first()
        .getByRole("button");
      await expect(themes).toHaveCount(3);
      await themes.nth(1).click();
      await expect(themes.nth(1)).toHaveAttribute("aria-pressed", "true");
      await language(page, next);
      await expect(themes.nth(1)).toHaveAttribute("aria-pressed", "true");
      expect(
        await page.evaluate(() =>
          localStorage.getItem("familyPlanner_theme_v2"),
        ),
      ).toBe("dark");
      await themes.nth(2).click();
      await expect(themes.nth(2)).toHaveAttribute("aria-pressed", "true");
    });
    test(`${locale}: password native validation drafts pending refusal fallback success timer and focus`, async ({
      page,
      context,
      baseURL,
      settings: s,
    }, info) => {
      await begin(page, context, baseURL!, locale, s, info);
      const opener = page.getByRole("button", {
        name: msg(locale, "changePassword"),
        exact: true,
      });
      await opener.click();
      let modal = page.getByRole("dialog");
      const current = modal.locator("#currentPassword"),
        password = modal.locator("#newPassword"),
        confirm = modal.locator("#confirmNewPassword");
      await expect(current).toHaveAttribute("autocomplete", "current-password");
      await expect(password).toHaveAttribute("autocomplete", "new-password");
      await current.fill("synthetic-current");
      await password.fill("abc");
      await confirm.fill("different");
      await modal
        .getByRole("button", {
          name: msg(locale, "changePassword"),
          exact: true,
        })
        .click();
      await expect(
        modal.getByText(msg(locale, "passwordMismatch"), { exact: true }),
      ).toBeVisible();
      expect(s.count("POST", "/api/auth/change-password")).toBe(0);
      await confirm.fill("abc");
      await modal
        .getByRole("button", {
          name: msg(locale, "changePassword"),
          exact: true,
        })
        .click();
      await expect(
        modal.getByText(msg(locale, "passwordShort"), { exact: true }),
      ).toBeVisible();
      await password.fill("synthetic-new-password");
      await confirm.fill("synthetic-new-password");
      s.reply("POST", "/api/auth/change-password", {
        status: 400,
        body: { error: RAW },
      });
      await modal
        .getByRole("button", {
          name: msg(locale, "changePassword"),
          exact: true,
        })
        .click();
      await expect(modal.getByText(RAW, { exact: true })).toBeVisible();
      await expect(current).toHaveValue("synthetic-current");
      await expect(password).toHaveValue("synthetic-new-password");
      await capture(page, info, "password-native-raw-refusal", [
        modal.getByRole("button", { name: msg(locale, "close"), exact: true }),
      ]);
      await page.keyboard.press("Escape");
      await expect(modal).toHaveCount(0);
      await expect(opener).toBeFocused();
      await language(page, other(locale));
      await language(page, locale);
      await opener.click();
      modal = page.getByRole("dialog");
      await expect(modal.locator("#currentPassword")).toHaveValue("");
      await expect(modal.locator("#newPassword")).toHaveValue("");
      await modal.locator("#currentPassword").fill("synthetic-current");
      await modal.locator("#newPassword").fill("synthetic-new-password");
      await modal.locator("#confirmNewPassword").fill("synthetic-new-password");
      const late = s.hold("POST", "/api/auth/change-password");
      await modal
        .getByRole("button", {
          name: msg(locale, "changePassword"),
          exact: true,
        })
        .click();
      await s.arrived("POST", "/api/auth/change-password", 2);
      s.assertLast("POST", "/api/auth/change-password", {
        currentPassword: "synthetic-current",
        newPassword: "synthetic-new-password",
      });
      await expect(
        modal.getByRole("button", {
          name: msg(locale, "changing"),
          exact: true,
        }),
      ).toBeDisabled();
      // Native modal owns focus; do not bypass it to click the background language selector.
      await page.keyboard.press("Tab");
      expect(
        await modal.evaluate((el) => el.contains(document.activeElement)),
      ).toBe(true);
      await capture(page, info, "password-pending");
      late({ status: 503, body: {} });
      await expect(
        modal.getByText(msg(locale, "passwordFailed"), { exact: true }),
      ).toBeVisible();
      s.reply("POST", "/api/auth/change-password", { body: {} });
      await modal
        .getByRole("button", {
          name: msg(locale, "changePassword"),
          exact: true,
        })
        .click();
      await expect(
        modal.getByText(msg(locale, "passwordUpdated"), { exact: true }),
      ).toBeVisible();
      await capture(page, info, "password-success");
      await page.clock.runFor(2001);
      await expect(modal).toHaveCount(0);
      await expect(opener).toBeFocused();
      expect(s.count("POST", "/api/auth/change-password")).toBe(3);
    });
    test(`${locale}: private feed absent pending refusal create clipboard reset and mounted lifetime`, async ({
      page,
      context,
      baseURL,
      settings: s,
    }, info) => {
      await begin(page, context, baseURL!, locale, s, info);
      const feed = await open(page, locale, "feed");
      await expect(
        feed.getByText(msg(locale, "createDescription"), { exact: true }),
      ).toBeVisible();
      const pending = s.hold("POST", "/api/family/feed-token");
      await feed
        .getByRole("button", { name: msg(locale, "createFeed"), exact: true })
        .click();
      await s.arrived("POST", "/api/family/feed-token");
      s.assertLast("POST", "/api/family/feed-token", { regenerate: false });
      const before = s.calls.length;
      const next = other(locale);
      await language(page, next);
      await expect(feed).toHaveAttribute("open", "");
      expect(s.calls).toHaveLength(before);
      await expect(
        feed.getByRole("button", { name: msg(next, "creating"), exact: true }),
      ).toBeDisabled();
      await capture(page, info, "feed-pending-locale");
      pending({ status: 503, body: {} });
      await expect(
        feed.getByText(msg(next, "feedFailed"), { exact: true }),
      ).toBeVisible();
      s.reply("POST", "/api/family/feed-token", {
        status: 400,
        body: { error: RAW },
      });
      await feed
        .getByRole("button", { name: msg(next, "createFeed"), exact: true })
        .click();
      await expect(feed.getByText(RAW, { exact: true })).toBeVisible();
      s.reply("POST", "/api/family/feed-token", { body: { feedToken: TOKEN } });
      await feed
        .getByRole("button", { name: msg(next, "createFeed"), exact: true })
        .click();
      const url =
        new URL(baseURL!).origin + "/api/calendar/feed?token=" + TOKEN;
      await expect(feed.locator("#feedUrl")).toHaveValue(url);
      await feed
        .getByRole("button", { name: msg(next, "copyLink"), exact: true })
        .click();
      await expect(
        feed.getByRole("button", { name: msg(next, "copied"), exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { __settingsClipboard: string[] })
              .__settingsClipboard,
        ),
      ).toEqual([url]);
      await page.clock.runFor(1100);
      await language(page, locale);
      await expect(
        feed.getByRole("button", { name: msg(locale, "copied"), exact: true }),
      ).toBeVisible();
      await page.clock.runFor(901);
      await expect(
        feed.getByRole("button", {
          name: msg(locale, "copyLink"),
          exact: true,
        }),
      ).toBeVisible();
      await page.evaluate(() => {
        (
          window as unknown as { __settingsCopyRefuse: boolean }
        ).__settingsCopyRefuse = true;
      });
      await feed
        .getByRole("button", { name: msg(locale, "copyLink"), exact: true })
        .click();
      await expect(
        feed.getByText(msg(locale, "copyFailed"), { exact: true }),
      ).toBeVisible();
      await capture(page, info, "feed-manual-copy-refusal", [
        feed.locator("#feedUrl"),
      ]);
      s.reply("POST", "/api/family/feed-token", {
        body: { feedToken: TOKEN + "-reset" },
      });
      await feed
        .getByRole("button", { name: msg(locale, "resetLink"), exact: true })
        .click();
      await expect(feed.locator("#feedUrl")).toHaveValue(url + "-reset");
      s.assertLast("POST", "/api/family/feed-token", { regenerate: true });
      expect(s.count("POST", "/api/family/feed-token")).toBe(4);
      await capture(page, info, "feed-synthetic-reset", [
        feed.getByRole("button", {
          name: msg(locale, "resetLink"),
          exact: true,
        }),
      ]);
    });
    if (enabled)
      test(`${locale}: AI masked private drafts pending fallback raw save clear and feedback lifetime`, async ({
        page,
        context,
        baseURL,
        settings: s,
      }, info) => {
        s.reads.set("/api/family/ai-settings", {
          body: {
            configured: true,
            keyHint: "synthetic••••hint",
            baseUrl: PRIVATE_URL,
            model: MODEL,
          },
        });
        await begin(page, context, baseURL!, locale, s, info);
        const ai = await open(page, locale, "aiCapture");
        await expect(ai.locator("#aiKey")).toHaveAttribute(
          "placeholder",
          msg(locale, "savedKeyHint", { hint: "synthetic••••hint" }),
        );
        await ai.locator("#aiKey").fill("  " + KEY + "  ");
        await ai.locator("#aiBaseUrl").fill("  " + PRIVATE_URL + "  ");
        await ai.locator("#aiModel").fill("  " + MODEL + "  ");
        const pending = s.hold("POST", "/api/family/ai-settings");
        await ai
          .getByRole("button", { name: msg(locale, "save"), exact: true })
          .click();
        await s.arrived("POST", "/api/family/ai-settings");
        s.assertLast("POST", "/api/family/ai-settings", {
          apiKey: KEY,
          baseUrl: PRIVATE_URL,
          model: MODEL,
        });
        const before = s.calls.length;
        const next = other(locale);
        await language(page, next);
        expect(s.calls).toHaveLength(before);
        await expect(ai).toHaveAttribute("open", "");
        await expect(ai.locator("#aiModel")).toHaveValue("  " + MODEL + "  ");
        await expect(
          ai.getByRole("button", {
            name: msg(next, "savingEllipsis"),
            exact: true,
          }),
        ).toBeDisabled();
        await capture(page, info, "ai-pending-private-drafts");
        pending({ status: 503, body: {} });
        await expect(
          ai.getByText(msg(next, "aiSaveFailed"), { exact: true }),
        ).toBeVisible();
        s.reply("POST", "/api/family/ai-settings", {
          status: 400,
          body: { error: RAW },
        });
        await ai
          .getByRole("button", { name: msg(next, "save"), exact: true })
          .click();
        await expect(ai.getByText(RAW, { exact: true })).toBeVisible();
        s.reply("POST", "/api/family/ai-settings", {
          body: {
            configured: true,
            keyHint: "synthetic••••new",
            baseUrl: PRIVATE_URL,
            model: MODEL,
          },
        });
        await ai
          .getByRole("button", { name: msg(next, "save"), exact: true })
          .click();
        await expect(
          ai.getByText(msg(next, "saved"), { exact: true }),
        ).toBeVisible();
        await expect(ai.locator("#aiKey")).toHaveValue("");
        await page.clock.runFor(1200);
        await language(page, locale);
        await expect(
          ai.getByText(msg(locale, "saved"), { exact: true }),
        ).toBeVisible();
        await capture(page, info, "ai-synthetic-saved");
        await page.clock.runFor(1301);
        await expect(
          ai.getByText(msg(locale, "saved"), { exact: true }),
        ).toHaveCount(0);
        s.reply("POST", "/api/family/ai-settings", {
          body: { configured: false, keyHint: null },
        });
        await ai
          .getByRole("button", { name: msg(locale, "removeKey"), exact: true })
          .click();
        await expect(
          ai.getByText(msg(locale, "aiRemoved"), { exact: true }),
        ).toBeVisible();
        s.assertLast("POST", "/api/family/ai-settings", { clear: true });
        expect(s.count("POST", "/api/family/ai-settings")).toBe(4);
        await capture(page, info, "ai-synthetic-clear");
      });
  }
});

const subscription = (patch: Record<string, unknown> = {}) => ({
  id: SUB_ID,
  name: PROFILE,
  color: "#2563eb",
  url_hint: "example.test",
  last_fetched_at: null,
  last_status: "pending",
  last_error: null,
  ...patch,
});
const connection = (patch: Record<string, unknown> = {}) => ({
  id: CON_ID,
  provider: "google",
  provider_label: "Google Calendar",
  calendar_id: "synthetic-calendar",
  calendar_name: PROFILE,
  push_mode: "linked",
  status: "ok",
  last_synced_at: null,
  last_error: null,
  conflicts_count: 1,
  owner: { id: FIXTURE_IDS.familyA.parent, name: PROFILE },
  is_mine: true,
  ...patch,
});
const subPath = `/api/calendar/subscriptions/${encodeURIComponent(SUB_ID)}`;
const conPath = `/api/calendar/sync-connections/${encodeURIComponent(CON_ID)}`;
test.describe("parentA household controls", () => {
  test.use({ storageState: authFile("parentA") });
  for (const locale of ["en", "es"] as const) {
    test(`${locale}: subscriptions loading empty add native colour rename refresh unknown states and confirm removal`, async ({
      page,
      context,
      baseURL,
      settings: s,
    }, info) => {
      const release = s.hold("GET", "/api/calendar/subscriptions");
      await begin(page, context, baseURL!, locale, s, info);
      const section = await open(page, locale, "subscriptions");
      await expect(
        section.getByText(msg(locale, "loadingEllipsis"), { exact: true }),
      ).toBeVisible();
      await capture(page, info, "subscriptions-loading");
      release({ body: { subscriptions: [] } });
      await expect(
        section.getByText(msg(locale, "noSubscriptions"), { exact: true }),
      ).toBeVisible();
      await section.locator("#calendarSubName").fill("  " + PROFILE + "  ");
      await section.locator("#calendarSubUrl").fill("  " + PRIVATE_URL + "  ");
      const blue = section.getByRole("radio", {
        name: msg(locale, "blue"),
        exact: true,
      });
      await blue.focus();
      await page.keyboard.press("ArrowRight");
      await expect(
        section.getByRole("radio", { name: msg(locale, "green"), exact: true }),
      ).toBeChecked();
      const add = s.hold("POST", "/api/calendar/subscriptions");
      s.reply("POST", subPath + "/refresh", {
        body: {
          subscription: subscription({ color: "#16a34a", last_status: "ok" }),
          result: { status: "ok", created: 2, updated: 3, deleted: 4 },
        },
      });
      await section
        .getByRole("button", { name: msg(locale, "addCalendar"), exact: true })
        .click();
      await s.arrived("POST", "/api/calendar/subscriptions");
      s.assertLast("POST", "/api/calendar/subscriptions", {
        name: PROFILE,
        url: PRIVATE_URL,
        color: "#16a34a",
      });
      const next = other(locale),
        before = s.calls.length;
      await language(page, next);
      expect(s.calls).toHaveLength(before);
      await expect(section.locator("#calendarSubName")).toHaveValue(
        "  " + PROFILE + "  ",
      );
      await expect(
        section.getByRole("radio", { name: msg(next, "green"), exact: true }),
      ).toBeChecked();
      await capture(page, info, "subscriptions-add-pending-native-colour");
      add({ body: { subscription: subscription({ color: "#16a34a" }) } });
      await expect(
        section.getByText(
          msg(next, "refreshedCounts", { created: 2, updated: 3, deleted: 4 }),
          { exact: true },
        ),
      ).toBeVisible();
      await s.arrived("POST", subPath + "/refresh");
      s.assertLast("POST", subPath + "/refresh");
      await expect(section.locator("#calendarSubName")).toHaveValue("");
      await expect(section.locator("#calendarSubUrl")).toHaveValue("");
      await section
        .getByRole("button", {
          name: msg(next, "renameLabel", { name: PROFILE }),
          exact: true,
        })
        .click();
      await section
        .getByLabel(msg(next, "newName"), { exact: true })
        .fill("  " + PROFILE + " renamed  ");
      await language(page, locale);
      await expect(
        section.getByLabel(msg(locale, "newName"), { exact: true }),
      ).toHaveValue("  " + PROFILE + " renamed  ");
      const rename = s.hold("PATCH", subPath);
      await section
        .getByRole("button", { name: msg(locale, "save"), exact: true })
        .click();
      await s.arrived("PATCH", subPath);
      s.assertLast("PATCH", subPath, { name: PROFILE + " renamed" });
      rename({
        body: { subscription: subscription({ name: PROFILE + " renamed" }) },
      });
      const named = PROFILE + " renamed";
      await expect(
        section.getByRole("button", {
          name: msg(locale, "refreshLabel", { name: named }),
          exact: true,
        }),
      ).toBeVisible();
      for (const result of [
        { status: "not_modified" },
        { status: "future_status" },
      ]) {
        s.reply("POST", subPath + "/refresh", {
          body: {
            subscription: subscription({
              name: named,
              last_status: "ok",
              last_error: "Synthetic large feed note",
            }),
            result,
          },
        });
        await section
          .getByRole("button", {
            name: msg(locale, "refreshLabel", { name: named }),
            exact: true,
          })
          .click();
        if (result.status === "not_modified")
          await expect(
            section.getByText(msg(locale, "upToDate"), { exact: true }),
          ).toBeVisible();
        else
          await expect(
            section.getByText(msg(locale, "upToDate"), { exact: true }),
          ).toHaveCount(0);
      }
      const refresh = s.hold("POST", subPath + "/refresh");
      await section
        .getByRole("button", {
          name: msg(locale, "refreshLabel", { name: named }),
          exact: true,
        })
        .click();
      await s.arrived("POST", subPath + "/refresh", 4);
      await language(page, next);
      refresh({ status: 503, body: {} });
      await expect(
        section.getByText(msg(next, "refreshFailed"), { exact: true }),
      ).toBeVisible();
      s.reply("POST", subPath + "/refresh", {
        status: 400,
        body: { error: RAW },
      });
      await section
        .getByRole("button", {
          name: msg(next, "refreshLabel", { name: named }),
          exact: true,
        })
        .click();
      await expect(section.getByText(RAW, { exact: true })).toBeVisible();
      await capture(page, info, "subscriptions-refresh-raw-fallback");
      page.once("dialog", async (d) => {
        expect(d.message()).toBe(
          msg(next, "removeSubscriptionConfirm", { name: named }),
        );
        await d.dismiss();
      });
      await section
        .getByRole("button", {
          name: msg(next, "removeLabel", { name: named }),
          exact: true,
        })
        .click();
      expect(s.count("DELETE", subPath)).toBe(0);
      s.reply("DELETE", subPath, { body: {} });
      page.once("dialog", async (d) => {
        expect(d.message()).toBe(
          msg(next, "removeSubscriptionConfirm", { name: named }),
        );
        await d.accept();
      });
      await section
        .getByRole("button", {
          name: msg(next, "removeLabel", { name: named }),
          exact: true,
        })
        .click();
      await expect(
        section.getByText(msg(next, "removedSubscription", { name: named }), {
          exact: true,
        }),
      ).toBeVisible();
      s.assertLast("DELETE", subPath);
      expect(s.count("GET", "/api/calendar/subscriptions")).toBe(1);
      await capture(page, info, "subscriptions-synthetic-removed");
    });
    test(`${locale}: subscription failed clock raw large-feed future and invalid timestamps stay canonical`, async ({
      page,
      context,
      baseURL,
      settings: s,
    }, info) => {
      const now = new Date(E2E_ANCHOR);
      // The configured canonical fixture anchor is used below, rather than host time.
      s.reads.set("/api/calendar/subscriptions", {
        body: {
          subscriptions: [
            subscription({
              last_status: "error",
              last_fetched_at: new Date(+now - 180000).toISOString(),
              last_error: RAW,
            }),
            subscription({
              id: "synthetic-note",
              name: PROFILE + " large",
              last_status: "ok",
              last_fetched_at: now.toISOString(),
              last_error: "Synthetic large feed note",
            }),
            subscription({
              id: "synthetic-future",
              name: PROFILE + " future",
              last_status: "future",
              last_fetched_at: "not-a-date",
            }),
          ],
        },
      });
      await begin(page, context, baseURL!, locale, s, info);
      const section = await open(page, locale, "subscriptions");
      await expect(
        section.getByText(
          msg(locale, "problem") +
            msg(locale, "lastTried", {
              message: RAW + ".",
              time: msg(locale, "minutesAgo", { count: 3 }),
            }),
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        section.getByText(
          msg(locale, "lastUpdated", { time: msg(locale, "justNow") }) +
            " Synthetic large feed note.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        section.getByText(
          msg(locale, "lastUpdated", { time: msg(locale, "aWhileAgo") }),
          { exact: true },
        ),
      ).toBeVisible();
      await capture(page, info, "subscriptions-clock-raw-large-future");
      const count = s.calls.length;
      await language(page, other(locale));
      expect(s.calls).toHaveLength(count);
      await expect(
        section.getByText(
          msg(other(locale), "lastUpdated", {
            time: msg(other(locale), "aWhileAgo"),
          }),
          { exact: true },
        ),
      ).toBeVisible();
      await page.clock.runFor(60001);
      await expect(
        section.getByText(
          msg(other(locale), "lastUpdated", {
            time: msg(other(locale), "minutesAgo", { count: 1 }),
          }) + " Synthetic large feed note.",
          { exact: true },
        ),
      ).toBeVisible();
      await capture(page, info, "subscriptions-clock-tick-current-locale");
    });
    test(`${locale}: beta optimistic pending authoritative off rollback both ways and offline`, async ({
      page,
      context,
      baseURL,
      settings: s,
    }, info) => {
      await begin(page, context, baseURL!, locale, s, info);
      const section = page.getByTestId("beta-metrics-switch");
      const toggle = section.getByRole("switch");
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      const pending = s.hold("PATCH", "/api/family/beta-metrics");
      await toggle.click();
      await s.arrived("PATCH", "/api/family/beta-metrics");
      s.assertLast("PATCH", "/api/family/beta-metrics", { enabled: true });
      await expect(toggle).toBeDisabled();
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      const next = other(locale),
        before = s.calls.length;
      await language(page, next);
      expect(s.calls).toHaveLength(before);
      await capture(page, info, "beta-pending-mounted-locale");
      pending({ body: { betaMetrics: { enabled: true } } });
      await expect(
        section.getByText(msg(next, "betaOn"), { exact: true }),
      ).toBeVisible();
      s.reply("PATCH", "/api/family/beta-metrics", { status: 503 });
      await toggle.click();
      await expect(
        section.getByText(msg(next, "betaFailedOn"), { exact: true }),
      ).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      s.reply("PATCH", "/api/family/beta-metrics", {
        body: { betaMetrics: { enabled: false } },
      });
      await toggle.click();
      await expect(
        section.getByText(msg(next, "betaOff"), { exact: true }),
      ).toBeVisible();
      s.assertLast("PATCH", "/api/family/beta-metrics", { enabled: false });
      s.reply("PATCH", "/api/family/beta-metrics", { status: 503 });
      await toggle.click();
      await expect(
        section.getByText(msg(next, "betaFailedOff"), { exact: true }),
      ).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      s.reply("PATCH", "/api/family/beta-metrics", {
        body: { betaMetrics: { enabled: false } },
      });
      await toggle.click();
      await expect(
        section.getByText(msg(next, "betaOff"), { exact: true }),
      ).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await expect(section.getByRole("link")).toHaveAttribute(
        "href",
        "/privacy#beta-usage-counts",
      );
      await capture(page, info, "beta-authoritative-rollback", [toggle]);
      const count = s.calls.length;
      await context.setOffline(true);
      await expect(
        section.getByText(msg(next, "betaOffline"), { exact: true }),
      ).toBeVisible();
      await expect(toggle).toBeDisabled();
      await capture(page, info, "beta-offline");
      await context.setOffline(false);
      await expect(toggle).toBeEnabled();
      expect(s.calls).toHaveLength(count);
      expect(s.count("PATCH", "/api/family/beta-metrics")).toBe(5);
    });
    if (enabled)
      test(`${locale}: PIN native filtering validation codes pending secret cleanup set change remove`, async ({
        page,
        context,
        baseURL,
        settings: s,
      }, info) => {
        await begin(page, context, baseURL!, locale, s, info);
        const pin = page.getByTestId("tablet-pin");
        await expect(
          pin.getByText(msg(locale, "pinUnsetDescription"), { exact: true }),
        ).toBeVisible();
        const opener = pin.getByRole("button", {
          name: msg(locale, "setPin"),
          exact: true,
        });
        await opener.click();
        const dialog = page.getByTestId("pin-dialog");
        const first = dialog.locator("#tablet-pin-new"),
          confirm = dialog.locator("#tablet-pin-confirm"),
          password = dialog.locator("#tablet-pin-password"),
          save = dialog.getByRole("button", {
            name: msg(locale, "savePin"),
            exact: true,
          });
        await expect(first).toBeFocused();
        await first.fill("12x3");
        await expect(first).toHaveValue("123");
        await save.click();
        await expect(
          dialog.getByText(msg(locale, "pinDigits"), { exact: true }),
        ).toBeVisible();
        await first.fill("546827");
        await confirm.fill("546826");
        await save.click();
        await expect(
          dialog.getByText(msg(locale, "pinMismatch"), { exact: true }),
        ).toBeVisible();
        await confirm.fill("546827");
        await save.click();
        await expect(
          dialog.getByText(msg(locale, "pinPasswordRequired"), { exact: true }),
        ).toBeVisible();
        expect(s.count("PUT", "/api/users/elevation-pin")).toBe(0);
        await password.fill("synthetic-current");
        for (const outcome of [
          {
            status: 400,
            body: { error: { code: "PIN_TOO_WEAK" } },
            message: "pinWeak",
          },
          {
            status: 401,
            body: { error: { code: "INVALID_PASSWORD" } },
            message: "pinPasswordIncorrect",
          },
          {
            status: 429,
            headers: { "Retry-After": "60" },
            message: "pinRateMinute",
          },
          {
            status: 429,
            headers: { "Retry-After": "125" },
            message: "pinRateMinutes",
          },
          { status: 503, message: "pinSaveFailed" },
          { network: true, message: "pinNetwork" },
        ] as const) {
          const { message, ...response } = outcome;
          s.reply("PUT", "/api/users/elevation-pin", response);
          await save.click();
          await expect(
            dialog.getByText(
              msg(locale, message, { minutes: 3, brand: PRODUCT_BRAND.name }),
              { exact: true },
            ),
          ).toBeVisible();
          await expect(first).toHaveValue("546827");
          await expect(password).toHaveValue("synthetic-current");
          await capture(page, info, "pin-" + message);
        }
        const pending = s.hold("PUT", "/api/users/elevation-pin");
        await save.click();
        await s.arrived("PUT", "/api/users/elevation-pin", 7);
        s.assertLast("PUT", "/api/users/elevation-pin", {
          pin: "546827",
          currentPassword: "synthetic-current",
        });
        await expect(save).toBeDisabled();
        await page.keyboard.press("Tab");
        expect(
          await dialog.evaluate((el) => el.contains(document.activeElement)),
        ).toBe(true);
        await capture(page, info, "pin-pending-native-focus");
        pending({ status: 204 });
        await expect(dialog).toHaveCount(0);
        await expect(
          page.getByText(msg(locale, "pinSaved"), { exact: true }),
        ).toBeVisible();
        const change = pin.getByRole("button", {
          name: msg(locale, "changePin"),
          exact: true,
        });
        await change.click();
        await expect(page.locator("#tablet-pin-new")).toHaveValue("");
        await expect(page.locator("#tablet-pin-password")).toHaveValue("");
        await page.locator("#tablet-pin-new").fill("546827");
        await page
          .getByRole("button", { name: msg(locale, "close"), exact: true })
          .click();
        await expect(change).toBeFocused();
        await change.click();
        await expect(page.locator("#tablet-pin-new")).toHaveValue("");
        await page.keyboard.press("Escape");
        await language(page, other(locale));
        const next = other(locale),
          remove = pin.getByRole("button", {
            name: msg(next, "removePin"),
            exact: true,
          });
        await remove.click();
        await page
          .getByTestId("remove-pin")
          .getByRole("button", { name: msg(next, "cancel"), exact: true })
          .click();
        expect(s.count("DELETE", "/api/users/elevation-pin")).toBe(0);
        s.reply("DELETE", "/api/users/elevation-pin", { status: 503 });
        await remove.click();
        await page
          .getByTestId("remove-pin")
          .getByRole("button", { name: msg(next, "removePin"), exact: true })
          .click();
        await expect(
          page.getByText(msg(next, "pinRemoveFailed"), { exact: true }),
        ).toBeVisible();
        s.reply("DELETE", "/api/users/elevation-pin", { status: 204 });
        await remove.click();
        await page
          .getByTestId("remove-pin")
          .getByRole("button", { name: msg(next, "removePin"), exact: true })
          .click();
        await expect(
          page.getByText(msg(next, "pinRemoved"), { exact: true }),
        ).toBeVisible();
        await expect(
          pin.getByText(msg(next, "pinUnsetDescription"), { exact: true }),
        ).toBeVisible();
        s.assertLast("DELETE", "/api/users/elevation-pin");
        await capture(page, info, "pin-synthetic-removed");
      });
  }
});

test.describe("parentA connected calendars", () => {
  test.use({ storageState: authFile("parentA") });
  for (const locale of ["en", "es"] as const)
    if (enabled) {
      test(`${locale}: own other-parent unknown provider clock counts native push picker sync and consent`, async ({
        page,
        context,
        baseURL,
        settings: s,
      }, info) => {
        const owner = "Synthetic other {name} 李",
          provider = "Synthetic {provider} 李";
        s.reads.set("/api/calendar/connections", {
          body: {
            providers: [
              { id: "google", label: "Google Calendar" },
              { id: "microsoft", label: "Outlook / Microsoft 365" },
              { id: "constructor", label: provider },
            ],
            connections: [
              connection(),
              connection({
                id: "synthetic-other",
                provider: "microsoft",
                provider_label: "Outlook / Microsoft 365",
                owner: { id: "synthetic-other-parent", name: owner },
                is_mine: false,
                status: "reauth_required",
                conflicts_count: 2,
              }),
              connection({
                id: "synthetic-future",
                provider: "constructor",
                provider_label: provider,
                status: "future_status",
                calendar_id: null,
                calendar_name: null,
                is_mine: false,
                owner: { id: "synthetic-owner", name: owner },
                conflicts_count: 0,
              }),
            ],
          },
        });
        await begin(page, context, baseURL!, locale, s, info);
        const section = await open(page, locale, "connectedCalendars");
        const own = section.locator("li").first();
        await expect(
          section.getByText(msg(locale, "ownerReconnect", { name: owner }), {
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          section.getByText(msg(locale, "waitingOwner", { name: owner }), {
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          own.getByText(msg(locale, "conflictOne", { count: 1 }), {
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          section.getByText(msg(locale, "conflictMany", { count: 2 }), {
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          section.getByRole("button", {
            name: msg(locale, "connectProvider", { provider }),
            exact: true,
          }),
        ).toBeVisible();
        expect(
          await section.locator("li").nth(1).getByRole("radio").count(),
        ).toBe(0);
        await capture(page, info, "connections-own-other-unknown-provider");
        const modes = own.getByRole("radio");
        await modes.first().focus();
        const push = s.hold("PATCH", conPath);
        await page.keyboard.press("ArrowRight");
        await s.arrived("PATCH", conPath);
        s.assertLast("PATCH", conPath, { push_mode: "all" });
        const next = other(locale),
          before = s.calls.length;
        await language(page, next);
        expect(s.calls).toHaveLength(before);
        await expect(modes.first()).toBeDisabled();
        push({ body: { connection: connection({ push_mode: "all" }) } });
        await expect(
          section.getByText(msg(next, "allEventsSaved"), { exact: true }),
        ).toBeVisible();
        await expect(modes.last()).toBeChecked();
        const sync = s.hold("POST", conPath + "/sync");
        await own
          .getByRole("button", {
            name: msg(next, "syncLabel", { provider: "Google Calendar" }),
            exact: true,
          })
          .click();
        await s.arrived("POST", conPath + "/sync");
        s.assertLast("POST", conPath + "/sync");
        await language(page, locale);
        await expect(
          own.getByRole("button", {
            name: msg(locale, "syncLabel", { provider: "Google Calendar" }),
            exact: true,
          }),
        ).toBeDisabled();
        await capture(page, info, "connections-sync-pending-locale");
        sync({
          body: {
            connection: connection({ push_mode: "all" }),
            result: {
              status: "ok",
              pulled: { created: 1, updated: 0, deleted: 0 },
              pushed: { created: 3, updated: 4, deleted: 5 },
            },
          },
        });
        await expect(
          section.getByText(
            msg(locale, "syncedOne", { inCount: 1, outCount: 12 }),
            { exact: true },
          ),
        ).toBeVisible();
        s.reply("POST", conPath + "/sync", {
          body: {
            result: {
              status: "ok",
              pulled: { created: 2, updated: 1, deleted: 4 },
              pushed: { created: 0, updated: 0, deleted: 0 },
            },
          },
        });
        await own
          .getByRole("button", {
            name: msg(locale, "syncLabel", { provider: "Google Calendar" }),
            exact: true,
          })
          .click();
        await expect(
          section.getByText(
            msg(locale, "syncedMany", { inCount: 7, outCount: 0 }),
            { exact: true },
          ),
        ).toBeVisible();
        s.reply("POST", conPath + "/sync", {
          body: { result: { status: "future", error: RAW } },
        });
        await own
          .getByRole("button", {
            name: msg(locale, "syncLabel", { provider: "Google Calendar" }),
            exact: true,
          })
          .click();
        await expect(section.getByText(RAW, { exact: true })).toBeVisible();
        s.reply("POST", conPath + "/sync", { status: 503, body: {} });
        await own
          .getByRole("button", {
            name: msg(locale, "syncLabel", { provider: "Google Calendar" }),
            exact: true,
          })
          .click();
        await expect(
          section.getByText(msg(locale, "syncFailed"), { exact: true }),
        ).toBeVisible();
        s.reply("GET", conPath + "/calendars", { body: { calendars: [] } });
        await own
          .getByRole("button", {
            name: msg(locale, "changeCalendarLabel", {
              provider: "Google Calendar",
            }),
            exact: true,
          })
          .click();
        await expect(
          own.getByText(msg(locale, "noWritableCalendars"), { exact: true }),
        ).toBeVisible();
        await expect(
          own.getByRole("button", { name: msg(locale, "save"), exact: true }),
        ).toBeDisabled();
        await capture(page, info, "connections-no-writable-calendar");
        await own
          .getByRole("button", { name: msg(locale, "cancel"), exact: true })
          .click();
        s.reply("GET", conPath + "/calendars", {
          status: 503,
          body: { error: RAW },
        });
        await own
          .getByRole("button", {
            name: msg(locale, "changeCalendarLabel", {
              provider: "Google Calendar",
            }),
            exact: true,
          })
          .click();
        await expect(section.getByText(RAW, { exact: true })).toBeVisible();
        s.reply("GET", conPath + "/calendars", {
          body: {
            calendars: [
              {
                id: "synthetic-first",
                name: PROFILE + " first",
                primary: false,
              },
              {
                id: "synthetic-second",
                name: PROFILE + " main",
                primary: true,
              },
              {
                id: "synthetic-calendar",
                name: PROFILE + " current",
                primary: false,
              },
            ],
          },
        });
        await own
          .getByRole("button", {
            name: msg(locale, "changeCalendarLabel", {
              provider: "Google Calendar",
            }),
            exact: true,
          })
          .click();
        const picker = own.getByLabel(msg(locale, "calendarToSync"), {
          exact: true,
        });
        await expect(picker).toHaveValue("synthetic-calendar");
        await picker.focus();
        await page.keyboard.press("Home");
        await expect(picker).toHaveValue("synthetic-first");
        const pickerCount = s.calls.length;
        await language(page, next);
        expect(s.calls).toHaveLength(pickerCount);
        await expect(
          own.getByLabel(msg(next, "calendarToSync"), { exact: true }),
        ).toHaveValue("synthetic-first");
        const save = s.hold("PATCH", conPath);
        s.reply("POST", conPath + "/sync", {
          body: {
            connection: connection({
              calendar_id: "synthetic-first",
              calendar_name: PROFILE + " first",
            }),
            result: {
              status: "ok",
              pulled: { created: 1, updated: 0, deleted: 0 },
              pushed: { created: 0, updated: 0, deleted: 0 },
            },
          },
        });
        await own
          .getByRole("button", { name: msg(next, "save"), exact: true })
          .click();
        await s.arrived("PATCH", conPath, 2);
        s.assertLast("PATCH", conPath, { calendar_id: "synthetic-first" });
        await capture(page, info, "connections-picker-save-pending");
        save({
          body: {
            connection: connection({
              calendar_id: "synthetic-first",
              calendar_name: PROFILE + " first",
            }),
          },
        });
        await expect(
          section.getByText(
            msg(next, "syncedOne", { inCount: 1, outCount: 0 }),
            { exact: true },
          ),
        ).toBeVisible();
        expect(s.count("POST", conPath + "/sync")).toBe(5);
        const disconnect = own.getByRole("button", {
          name: msg(next, "disconnectLabel", { provider: "Google Calendar" }),
          exact: true,
        });
        const confirmation = msg(next, "disconnectMineConfirm", {
          provider: "Google Calendar",
          calendar: ` (${PROFILE} first)`,
          name: PROFILE,
        });
        page.once("dialog", async (d) => {
          expect(d.message()).toBe(confirmation);
          await d.dismiss();
        });
        await disconnect.click();
        expect(s.count("DELETE", conPath)).toBe(0);
        s.reply("DELETE", conPath, { body: {} });
        page.once("dialog", async (d) => {
          expect(d.message()).toBe(confirmation);
          await d.accept();
        });
        await disconnect.click();
        await expect(
          section.getByText(
            msg(next, "disconnected", { provider: "Google Calendar" }),
            { exact: true },
          ),
        ).toBeVisible();
        s.assertLast("DELETE", conPath);
        expect(s.count("GET", "/api/calendar/connections")).toBe(1);
        await capture(page, info, "connections-synthetic-disconnected");
      });
      test(`${locale}: all eight provider-return outcomes and unknown query remain mounted`, async ({
        page,
        context,
        baseURL,
        settings: s,
      }, info) => {
        await begin(page, context, baseURL!, locale, s, info);
        const outcomes = {
          connected: "connected",
          denied: "connectionDenied",
          state: "connectionState",
          exchange: "connectionExchange",
          forbidden: "connectionForbidden",
          limit: "connectionLimit",
          scope: "connectionScope",
          error: "connectionError",
        } as const;
        for (const [outcome, message] of Object.entries(outcomes)) {
          await page.goto(
            "/dashboard/settings?calendar_sync=" + outcome + "&keep=synthetic",
          );
          await expect(page.locator("#profileName")).toBeVisible();
          const section = page.locator("#calendar-sync");
          await expect(
            section.getByText(msg(locale, message), { exact: true }),
          ).toBeVisible();
          expect(new URL(page.url()).searchParams.has("calendar_sync")).toBe(
            false,
          );
          expect(new URL(page.url()).searchParams.get("keep")).toBe(
            "synthetic",
          );
          const count = s.calls.length;
          await language(page, other(locale));
          await expect(
            section.getByText(msg(other(locale), message), { exact: true }),
          ).toBeVisible();
          expect(s.calls).toHaveLength(count);
          await capture(page, info, "connection-return-" + outcome);
          await language(page, locale);
        }
        for (const outcome of ["constructor", "toString", "future_status"]) {
          await page.goto(
            "/dashboard/settings?calendar_sync=" + outcome + "&keep=synthetic",
          );
          await expect(page.locator("#profileName")).toBeVisible();
          await expect(
            page.getByRole("heading", {
              name: msg(locale, "connectedCalendars"),
              exact: true,
            }),
          ).toBeVisible();
          expect(new URL(page.url()).searchParams.get("calendar_sync")).toBe(
            outcome,
          );
          const count = s.calls.length;
          await language(page, other(locale));
          expect(s.calls).toHaveLength(count);
          expect(new URL(page.url()).searchParams.get("calendar_sync")).toBe(
            outcome,
          );
          await language(page, locale);
        }
        await capture(page, info, "connection-unknown-return-preserved");
        expect(s.calls.filter((c) => c.method !== "GET")).toEqual([]);
      });
      test(`${locale}: reconnect pending local raw refusal and same-origin synthetic OAuth sink`, async ({
        page,
        context,
        baseURL,
        settings: s,
      }, info) => {
        s.reads.set("/api/calendar/connections", {
          body: {
            providers: [],
            connections: [
              connection({ status: "reauth_required", last_error: null }),
            ],
          },
        });
        await begin(page, context, baseURL!, locale, s, info);
        const section = await open(page, locale, "connectedCalendars"),
          start = "/api/calendar/connections/google/start";
        await expect(
          section.getByText(
            msg(locale, "problem") + msg(locale, "reconnectFallback"),
            { exact: true },
          ),
        ).toBeVisible();
        s.reply("POST", start, { status: 503, body: {} });
        await section
          .getByRole("button", { name: msg(locale, "reconnect"), exact: true })
          .click();
        await expect(
          section.getByText(msg(locale, "connectFailed"), { exact: true }),
        ).toBeVisible();
        s.reply("POST", start, { status: 400, body: { error: RAW } });
        await section
          .getByRole("button", { name: msg(locale, "reconnect"), exact: true })
          .click();
        await expect(section.getByText(RAW, { exact: true })).toBeVisible();
        const sink = new URL("/__synthetic/settings-oauth", baseURL!).href;
        await page.route(sink, (r) =>
          r.fulfill({
            contentType: "text/html",
            body: "<!doctype html><html lang='en'><title>Synthetic OAuth sink</title><main>Synthetic only. No provider request or connection.</main></html>",
          }),
        );
        const pending = s.hold("POST", start);
        await section
          .getByRole("button", { name: msg(locale, "reconnect"), exact: true })
          .click();
        await s.arrived("POST", start, 3);
        s.assertLast("POST", start);
        const count = s.calls.length;
        await language(page, other(locale));
        expect(s.calls).toHaveLength(count);
        await capture(page, info, "connection-start-pending-synthetic");
        pending({ body: { authorize_url: sink } });
        await expect(page).toHaveURL(sink);
        await expect(
          page.getByText("Synthetic only. No provider request or connection.", {
            exact: true,
          }),
        ).toBeVisible();
        expect(s.count("POST", start)).toBe(3);
      });
    }
});

// A dormant server wrapper must hide the controls before any client read, even if
// intercepted API responses could claim availability. This tests the actual wrapper.
if (!enabled)
  test.describe("unavailable parent gates", () => {
    test.use({ storageState: authFile("parentA") });
    for (const locale of ["en", "es"] as const)
      test(`${locale}: dormant AI PIN and connected calendars never mount or fetch`, async ({
        page,
        context,
        baseURL,
        settings: s,
      }, info) => {
        await begin(page, context, baseURL!, locale, s, info);
        await expect(
          page.getByRole("heading", {
            name: msg(locale, "aiCapture"),
            exact: true,
          }),
        ).toHaveCount(0);
        await expect(page.locator("#calendar-sync")).toHaveCount(0);
        await expect(page.getByTestId("tablet-pin")).toHaveCount(0);
        expect(s.count("GET", "/api/family/ai-settings")).toBe(0);
        expect(s.count("GET", "/api/calendar/connections")).toBe(0);
        await open(page, locale, "feed");
        await open(page, locale, "subscriptions");
        await language(page, other(locale));
        expect(s.count("GET", "/api/family/feed-token")).toBe(1);
        expect(s.count("GET", "/api/calendar/subscriptions")).toBe(1);
        await capture(page, info, "settings-unavailable-feature-gates");
      });
  });

if (enabled)
  test.describe("parentA actual calendar return loading", () => {
    test.use({ storageState: authFile("parentA") });
    for (const locale of ["en", "es"] as const)
      test(`${locale}: provider read unavailable then delayed first profile retains connected picker exactly once`, async ({
        page,
        context,
        baseURL,
        settings: s,
      }, info) => {
        s.reads.set("/api/calendar/connections", { status: 503, body: {} });
        await begin(page, context, baseURL!, locale, s, info);
        await expect(page.locator("#calendar-sync")).toHaveCount(0);
        const calls = s.calls.length;
        await language(page, other(locale));
        expect(s.calls).toHaveLength(calls);
        await language(page, locale);
        await capture(page, info, "connections-unavailable-response");
        s.reads.set("/api/calendar/connections", {
          body: {
            providers: [{ id: "google", label: "Google Calendar" }],
            connections: [
              connection({
                calendar_id: null,
                calendar_name: null,
                status: "pending",
                conflicts_count: 0,
              }),
            ],
          },
        });
        s.reply("GET", conPath + "/calendars", {
          body: {
            calendars: [
              { id: "synthetic-primary", name: PROFILE, primary: true },
            ],
          },
        });
        const release = s.hold("GET", "/api/users");
        s.calls = [];
        await page.goto(
          "/dashboard/settings?calendar_sync=connected&keep=synthetic",
        );
        await expect(
          page.getByText(msg(locale, "loading"), { exact: true }),
        ).toBeVisible();
        expect(s.count("GET", "/api/calendar/connections")).toBe(0);
        expect(new URL(page.url()).searchParams.get("calendar_sync")).toBe(
          "connected",
        );
        release({
          body: {
            user: {
              id: FIXTURE_IDS.familyA.parent,
              name: PROFILE,
              email: FIXTURE_EMAILS.familyA.parent,
              age: 31,
              role: "parent",
            },
          },
        });
        const section = page.locator("#calendar-sync");
        await expect(
          section.getByText(msg(locale, "connected"), { exact: true }),
        ).toBeVisible();
        await expect(
          section.getByLabel(msg(locale, "calendarToSync"), { exact: true }),
        ).toHaveValue("synthetic-primary");
        expect(new URL(page.url()).searchParams.has("calendar_sync")).toBe(
          false,
        );
        expect(new URL(page.url()).searchParams.get("keep")).toBe("synthetic");
        expect(s.count("GET", "/api/calendar/connections")).toBe(1);
        expect(s.count("GET", "/api/calendar/subscriptions")).toBe(1);
        expect(s.count("GET", conPath + "/calendars")).toBe(1);
        const before = s.calls.length;
        await language(page, other(locale));
        expect(s.calls).toHaveLength(before);
        await expect(
          section.getByText(msg(other(locale), "connected"), { exact: true }),
        ).toBeVisible();
        await expect(
          section.getByLabel(msg(other(locale), "calendarToSync"), {
            exact: true,
          }),
        ).toHaveValue("synthetic-primary");
        await capture(
          page,
          info,
          "connection-return-delayed-profile-mounted-picker",
        );
      });
  });
