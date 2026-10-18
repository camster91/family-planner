import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./support/test";
import { authFile } from "./support/env";
import { choreOverviewMessages } from "../src/i18n/chore-overview";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { THEME_STORAGE_KEY } from "../src/lib/theme";

test.use({ storageState: authFile("parentA") });

for (const locale of ["en", "es"] as const) {
  test(`${locale}: daily, weekly and series work keep advanced views reachable`, async ({
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
    await loginViaUi(page, FIXTURE_EMAILS.familyA.parent);
    await expect(page).toHaveURL(/\/dashboard(?:\/|$)/);
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
    await page.goto("/dashboard/chores");
    const text = choreOverviewMessages[locale];
    const views = page.getByRole("group", { name: text.views, exact: true });
    const more = page.getByRole("combobox", { name: text.more, exact: true });
    await expect(views.getByRole("button")).toHaveCount(3);
    const check = async (selected: "today" | "week" | "series" | null) => {
      await expect(views.locator('[aria-pressed="true"]')).toHaveCount(
        selected ? 1 : 0,
      );
      if (selected)
        await expect(
          views.getByRole("button", { name: text[selected], exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
      for (const target of [...(await views.getByRole("button").all()), more]) {
        const box = await target.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    };
    await expect(
      page.getByRole("heading", { name: text.title, exact: true }),
    ).toBeVisible();
    await check("today");
    await views
      .getByRole("button", { name: text.week, exact: true })
      .press("Enter");
    await check("week");
    await views
      .getByRole("button", { name: text.series, exact: true })
      .press("Enter");
    await check("series");
    await more.selectOption("all");
    await check(null);
    await expect(
      page.locator("summary").filter({ hasText: text.routinePanel }),
    ).toHaveCount(0);
    await more.selectOption("routines");
    const range = page.getByRole("combobox", {
      name: text.routineRange,
      exact: true,
    });
    await expect(range).toHaveValue("all");
    await range.selectOption("week");
    await expect(more).toHaveValue("routines");
    await expect(range).toHaveValue("week");
    await check(null);
    await views
      .getByRole("button", { name: text.today, exact: true })
      .press("Enter");
    await check("today");
    await expect(range).toHaveCount(0);
    expect(
      (
        await new AxeBuilder({ page })
          .include("main")
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(writes).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath(`chore-overview-${locale}.png`),
      fullPage: true,
    });
  });
}
