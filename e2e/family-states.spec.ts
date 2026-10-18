/** Transport-only state fixtures; canonical household records stay unchanged. */
import AxeBuilder from "@axe-core/playwright";
import { test, expect, browserFetch } from "./support/test";
import { authFile } from "./support/env";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { familyOverviewMessages } from "../src/i18n/family-overview";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { THEME_STORAGE_KEY } from "../src/lib/theme";

test.use({ storageState: authFile("parentA") });
test.beforeEach(async ({ context, baseURL }) => {
  assertFixtureTargetAllowed(process.env);
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
    new URL(baseURL!).hostname,
  );
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      ["data:", "blob:"].includes(url.protocol)
      ? route.continue()
      : route.abort();
  });
});

for (const locale of ["en", "es"] as const) {
  test(`${locale}: loading, retry, empty, missing household and offline removal recover`, async ({
    page,
    context,
  }, info) => {
    const text = familyOverviewMessages[locale];
    await page.addInitScript(
      ({ locale, localeKey, themeKey }) => {
        localStorage.setItem(localeKey, locale);
        localStorage.setItem(themeKey, locale === "es" ? "dark" : "light");
      },
      { locale, localeKey: LOCALE_STORAGE_KEY, themeKey: THEME_STORAGE_KEY },
    );
    await page.goto("/dashboard/family");
    await expect(page.getByTestId("family-member")).toHaveCount(4);
    const before = JSON.parse(
      (await browserFetch(page, "/api/family/members")).body,
    ).members;
    const me = JSON.parse((await browserFetch(page, "/api/auth/me")).body);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let pendingResponse: Promise<void> | null = null;
    await page.route("**/api/family/members", (route) => {
      pendingResponse = held.then(() =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: "{}",
        }),
      );
      return pendingResponse;
    });
    try {
      await page.reload();
      await expect(page.getByText(text.loading, { exact: true })).toBeVisible();
      await expect(page.getByTestId("family-member")).toHaveCount(0);
      release();
      await expect(page.getByRole("main").getByRole("alert")).toContainText(
        text.loadFailed,
      );
      await expect(
        page.getByText(text.emptyTitle, { exact: true }),
      ).toHaveCount(0);
    } finally {
      release();
      if (pendingResponse) await pendingResponse;
      await page.unroute("**/api/family/members");
    }
    await page
      .getByRole("button", { name: text.tryAgain, exact: true })
      .click();
    await expect(page.getByTestId("family-member")).toHaveCount(before.length);

    await page.route("**/api/family/members", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ members: [] }),
      }),
    );
    await page.reload();
    await expect(
      page.getByText(text.emptyTitle, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: text.inviteMembers, exact: true }),
    ).toHaveAttribute("href", "/dashboard/family/invite");
    await page.unroute("**/api/family/members");

    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...me, user: { ...me.user, family_id: null } }),
      }),
    );
    await page.reload();
    await expect(
      page.getByText(text.chooseHousehold, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: text.createHousehold, exact: true }),
    ).toHaveAttribute("href", "/dashboard/family/create");
    await expect(
      page.getByRole("link", { name: text.joinHousehold, exact: true }),
    ).toHaveAttribute("href", "/join");
    await expect(
      page.getByRole("link", { name: text.addMember, exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      text.title,
    );
    expect(
      (
        await new AxeBuilder({ page })
          .include("main")
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`family-no-household-${locale}.png`),
      fullPage: true,
    });
    await page.unroute("**/api/auth/me");

    await page.reload();
    await expect(page.getByTestId("family-member")).toHaveCount(before.length);
    const opener = page
      .getByTestId("family-member")
      .filter({ hasText: "Casey Fixture-A" })
      .getByRole("button");
    await opener.click();
    const dialog = page.getByRole("dialog");
    try {
      await context.setOffline(true);
      await dialog
        .getByRole("button", { name: text.removeConfirm, exact: true })
        .click();
      await expect(dialog.getByRole("alert")).toHaveText(text.removeNetwork);
      await expect(
        dialog.getByRole("button", { name: text.removeConfirm, exact: true }),
      ).toBeEnabled();
      await expect(page.getByTestId("family-member")).toHaveCount(
        before.length,
      );
    } finally {
      await context.setOffline(false);
    }
    await dialog
      .getByRole("button", { name: text.cancel, exact: true })
      .click();
    await expect(opener).toBeFocused();
    expect(
      JSON.parse((await browserFetch(page, "/api/family/members")).body)
        .members,
    ).toEqual(before);
  });
}
