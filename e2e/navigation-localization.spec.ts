/** #426: existing role navigation and shared browser-network presentation. */
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo, Locator } from "@playwright/test";
import {
  test,
  expect,
  browserFetch,
  browserSend,
  loginViaUi,
} from "./support/test";
import { authFile } from "./support/env";
import { goOffline, goOnline } from "./support/network";
import {
  FIXTURE_EMAILS,
  FIXTURE_IDS,
  FIXTURE_LONG_TEXT,
} from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import {
  navigationMessages,
  type NavigationMessage,
} from "../src/i18n/navigation";
import { offlineBannerMessages } from "../src/i18n/offline-banner";
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
function text(value: string) {
  return expanded ? pseudolocalizeTemplate(value) : value;
}
async function capture(
  page: Page,
  info: TestInfo,
  name: string,
  targets: Locator[] = [],
) {
  for (const target of targets) {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
    const viewport = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
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
      .include("nav")
      .include("[data-offline-banner]")
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
    test.beforeEach(async ({ page, context, baseURL }, info) => {
      test.skip(
        !projects.includes(info.project.name),
        "Representative existing role-navigation viewports",
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
      expect(JSON.parse(auth.body).user.role).toBe(role);
      const version = await browserFetch(page, "/api/version");
      expect(version.status).toBe(200);
      await info.attach("actual-runtime-role-and-mode", {
        body: JSON.stringify({
          runtime: JSON.parse(version.body),
          role,
          expanded,
        }),
        contentType: "application/json",
      });
    });
    for (const locale of ["en", "es"] as const) {
      if (role === "parent")
        test(`${locale}: long private name preserves all navigation targets`, async ({
          page,
        }, info) => {
          const profile = await browserFetch(page, "/api/users");
          expect(profile.status).toBe(200);
          const user = JSON.parse(profile.body).user;
          expect(user.id).toBe(FIXTURE_IDS.familyA.parent);
          expect(user.family_id).toBe(FIXTURE_IDS.familyA.family);
          const original = user.name;
          const name = FIXTURE_LONG_TEXT.name + " {name} — 李";
          try {
            expect(
              (await browserSend(page, "PATCH", "/api/users", { name })).status,
            ).toBe(200);
            await page.evaluate(
              (language) =>
                localStorage.setItem("familyPlanner_language", language),
              locale,
            );
            await page.goto("/dashboard/lists");
            if (expanded)
              await expect(page.locator("html")).toHaveAttribute(
                "data-pseudolocalized",
                "true",
              );
            const msg = (key: NavigationMessage) =>
              text(navigationMessages[locale][key]);
            const nav = page.getByRole("navigation", {
              name: msg("mainNavigation"),
              exact: true,
            });
            const opener = page.getByRole("button", {
              name: msg("userMenu"),
              exact: true,
            });
            const bounds = await opener.boundingBox(),
              viewport = page.viewportSize()!;
            expect(bounds!.x).toBeGreaterThanOrEqual(0);
            expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
              viewport.width,
            );
            const tabs =
              info.project.name === "phone-390x844"
                ? page.getByRole("navigation", {
                    name: msg("tabs"),
                    exact: true,
                  })
                : page.getByTestId("top-tabs");
            await capture(page, info, `${locale}-long-name-tabs`, [
              ...(await tabs.getByRole("link").all()),
              opener,
            ]);
            await opener.click();
            await expect(nav.getByText(name, { exact: true })).toBeVisible();
            await capture(page, info, `${locale}-long-name-menu`, [
              opener,
              page.getByRole("button", { name: msg("signOut"), exact: true }),
            ]);
            expect(
              JSON.parse((await browserFetch(page, "/api/users")).body).user
                .name,
            ).toBe(name);
          } finally {
            expect(
              (
                await browserSend(page, "PATCH", "/api/users", {
                  name: original,
                })
              ).status,
            ).toBe(200);
            expect(
              JSON.parse((await browserFetch(page, "/api/users")).body).user
                .name,
            ).toBe(original);
          }
        });
      test(`${locale}: role tabs menu focus and offline recovery`, async ({
        page,
      }, info) => {
        const msg = (key: NavigationMessage) =>
          text(navigationMessages[locale][key]);
        await page.evaluate(
          (language) =>
            localStorage.setItem("familyPlanner_language", language),
          locale,
        );
        const response = await page.goto("/dashboard/lists");
        expect(response!.status()).toBe(200);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        if (expanded)
          await expect(page.locator("html")).toHaveAttribute(
            "data-pseudolocalized",
            "true",
          );
        const nav =
          info.project.name === "phone-390x844"
            ? page.getByRole("navigation", { name: msg("tabs"), exact: true })
            : page.getByTestId("top-tabs");
        const keys: NavigationMessage[] =
          role === "parent"
            ? ["today", "calendar", "meals", "lists", "family"]
            : role === "teen"
              ? ["today", "calendar", "meals", "lists", "emergency"]
              : ["today", "lists", "emergency"];
        const hrefs =
          role === "parent"
            ? [
                "/dashboard/today",
                "/dashboard/calendar",
                "/dashboard/meals",
                "/dashboard/lists",
                "/dashboard/family",
              ]
            : role === "teen"
              ? [
                  "/dashboard",
                  "/dashboard/calendar",
                  "/dashboard/meals",
                  "/dashboard/lists",
                  "/dashboard/emergency",
                ]
              : ["/dashboard", "/dashboard/lists", "/dashboard/emergency"];
        await expect(nav.getByRole("link")).toHaveText(keys.map(msg));
        for (let index = 0; index < hrefs.length; index++)
          await expect(nav.getByRole("link").nth(index)).toHaveAttribute(
            "href",
            hrefs[index],
          );
        await expect(
          nav.getByRole("link", { name: msg("lists"), exact: true }),
        ).toHaveAttribute("aria-current", "page");
        await capture(
          page,
          info,
          `${role}-${locale}-tabs`,
          await nav.getByRole("link").all(),
        );
        const opener = page.getByRole("button", {
          name: msg("userMenu"),
          exact: true,
        });
        await opener.click();
        await expect(page.getByText(msg(role), { exact: true })).toBeVisible();
        await expect(
          page
            .getByRole("navigation", {
              name: msg("mainNavigation"),
              exact: true,
            })
            .getByText(
              role === "parent"
                ? "Avery Fixture-A"
                : role === "teen"
                  ? "Taylor Fixture-A"
                  : "Casey Fixture-A",
              { exact: true },
            ),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: msg("signOut"), exact: true }),
        ).toBeVisible();
        if (role === "child") {
          await expect(
            page.getByRole("link", { name: msg("settings"), exact: true }),
          ).toHaveCount(0);
          await expect(
            page.getByRole("button", {
              name: msg("deleteAccount"),
              exact: true,
            }),
          ).toBeVisible();
        } else
          await expect(
            page.getByRole("link", { name: msg("settings"), exact: true }),
          ).toBeVisible();
        await capture(page, info, `${role}-${locale}-menu`, [
          opener,
          page.getByRole("button", { name: msg("signOut"), exact: true }),
        ]);
        await page.keyboard.press("Escape");
        await expect(opener).toHaveAttribute("aria-expanded", "false");
        await expect(opener).toBeFocused();
        const banner = page.getByTestId("app-offline-banner");
        await expect(banner).toHaveCount(0);
        await goOffline(page);
        try {
          await expect(banner).toHaveText(
            text(offlineBannerMessages[locale].offline),
          );
          await expect(page.locator("[data-offline-banner]")).toHaveAttribute(
            "aria-live",
            "polite",
          );
          if (info.project.name === "phone-390x844") {
            const b = await banner.boundingBox(),
              tab = await nav.boundingBox();
            expect(b!.y + b!.height).toBeLessThanOrEqual(tab!.y);
          }
          await capture(page, info, `${role}-${locale}-offline`);
        } finally {
          await goOnline(page);
        }
        await expect(banner).toHaveText(
          text(offlineBannerMessages[locale].back),
        );
        // Capture while recovery is present, before another accessibility scan.
        // Mounted unit tests prove the exact unchanged three-second deadline.
        await page.screenshot({
          path: info.outputPath(`${role}-${locale}-back-online.png`),
          fullPage: false,
        });
        await expect(banner).toHaveCount(0, { timeout: 10000 });
        expect(new URL(page.url()).pathname).toBe("/dashboard/lists");
      });
      if (role === "parent")
        test(`${locale}: fresh normal chrome and fridge visibility`, async ({
          page,
        }, info) => {
          const msg = (key: NavigationMessage) =>
            text(navigationMessages[locale][key]);
          await page.evaluate(
            (language) =>
              localStorage.setItem("familyPlanner_language", language),
            locale,
          );
          await page.goto("/dashboard/lists");
          if (expanded)
            await expect(page.locator("html")).toHaveAttribute(
              "data-pseudolocalized",
              "true",
            );
          const mainNav = page.getByRole("navigation", {
            name: msg("mainNavigation"),
            exact: true,
          });
          const opener = page.getByRole("button", {
            name: msg("userMenu"),
            exact: true,
          });
          await expect(opener).toBeVisible();
          const bounds = await opener.boundingBox(),
            viewport = page.viewportSize()!;
          expect(bounds!.x).toBeGreaterThanOrEqual(0);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
          await page.screenshot({
            path: info.outputPath(`${locale}-fresh-normal-chrome.png`),
            fullPage: false,
          });
          await page.goto("/dashboard/today?mode=fridge");
          await expect(page.locator("html")).toHaveAttribute("lang", locale);
          if (expanded)
            await expect(page.locator("html")).toHaveAttribute(
              "data-pseudolocalized",
              "true",
            );
          await expect(mainNav).toBeHidden();
          await expect(page.locator(".tab-bar")).toBeHidden();
          await expect(page.locator("[data-offline-banner]")).toBeHidden();
          await page.screenshot({
            path: info.outputPath(`${locale}-fridge-hidden-chrome.png`),
            fullPage: false,
          });
        });
    }
  });

// #143: direct discovery reuses the canonical, role-gated feature hub.
test.describe("Explore feature shortcut", () => {
  test.use({ storageState: authFile("parentA") });
  test("opens the feature hub without passing through Family", async ({
    page,
  }, info) => {
    assertFixtureTargetAllowed(process.env);
    await page.goto("/dashboard/today");
    const viewport = page.viewportSize()!;
    if (viewport.width < 1280) {
      await page
        .getByRole("button", {
          name: text(navigationMessages.en.userMenu),
          exact: true,
        })
        .click();
    }
    const explore = page
      .getByRole("link", {
        name: text(navigationMessages.en.explore),
        exact: true,
      })
      .filter({ visible: true });
    await expect(explore).toHaveCount(1);
    await capture(page, info, "explore-shortcut", [explore]);
    await explore.click();
    await expect(page).toHaveURL(/\/dashboard\/family\/more$/);
    await expect(
      page.getByRole("heading", { name: "More", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Features", exact: true }),
    ).toBeVisible();
  });
});
