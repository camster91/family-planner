import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./support/test";
import { authFile } from "./support/env";
import { bulkCookingMessages } from "../src/i18n/bulk-cooking";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { THEME_STORAGE_KEY } from "../src/lib/theme";

test.use({ storageState: authFile("parentA") });

for (const locale of ["en", "es"] as const) {
  test(`${locale}: Plan, Explore and Prep share week context and keyboard navigation`, async ({
    page,
    context,
  }) => {
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return ["localhost", "127.0.0.1"].includes(url.hostname) ||
        ["data:", "blob:"].includes(url.protocol)
        ? route.continue()
        : route.abort();
    });
    await page.addInitScript(
      ({ locale, localeKey, themeKey }) => {
        localStorage.setItem(localeKey, locale);
        localStorage.setItem(themeKey, locale === "es" ? "dark" : "light");
      },
      { locale, localeKey: LOCALE_STORAGE_KEY, themeKey: THEME_STORAGE_KEY },
    );
    const writes: string[] = [];
    page.on("request", (request) => {
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method()))
        writes.push(new URL(request.url()).pathname);
    });
    await page.goto("/dashboard/meals?start=2026-01-05");
    const text = bulkCookingMessages[locale];
    const nav = page.getByRole("navigation", { name: text.views });
    const check = async (name: string) => {
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
      await expect(
        nav.getByRole("link", { name, exact: true }),
      ).toHaveAttribute("aria-current", "page");
      for (const link of await nav.getByRole("link").all()) {
        const box = await link.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
        const url = new URL(
          (await link.getAttribute("href"))!,
          "http://localhost",
        );
        expect(url.searchParams.get("start")).toBe("2026-01-05");
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .include('nav[aria-label="' + text.views + '"]')
            .withTags(["wcag2a", "wcag2aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
    };
    await check(text.navPlan);
    await expect(page.getByTestId("meal-day")).toHaveCount(7);
    await nav
      .getByRole("link", { name: text.navExplore, exact: true })
      .press("Enter");
    await expect(page).toHaveURL(/\/meals\/explore\?start=2026-01-05$/);
    await check(text.navExplore);
    await nav
      .getByRole("link", { name: text.navPrep, exact: true })
      .press("Enter");
    await expect(page).toHaveURL(/\/meals\?start=2026-01-05&view=bulk$/);
    await check(text.navPrep);
    await expect(page.getByTestId("bulk-cooking-panel")).toBeVisible();
    await nav
      .getByRole("link", { name: text.navPlan, exact: true })
      .press("Enter");
    await expect(page).toHaveURL(/\/meals\?start=2026-01-05$/);
    await check(text.navPlan);
    await page.goBack();
    await expect(page).toHaveURL(/view=bulk/);
    await check(text.navPrep);
    expect(writes).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath(`meal-navigation-${locale}.png`),
      fullPage: true,
    });
  });
}
