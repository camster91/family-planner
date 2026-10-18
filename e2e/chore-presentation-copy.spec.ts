import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./support/test";
import { authFile } from "./support/env";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { choreOverviewMessages } from "../src/i18n/chore-overview";
import { rowActionMessages } from "../src/i18n/row-actions";
import { profileSetupMessages } from "../src/i18n/profile-setup";

test.use({ storageState: authFile("parentA") });
for (const locale of ["en", "es"] as const) {
  test(`${locale}: chore actions and reassignment stay readable, focused and write-free on cancel`, async ({
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
    await page.goto("/dashboard/chores");
    const text = choreOverviewMessages[locale];
    const row = rowActionMessages[locale];
    const menuName = row.forItem
      .replace("{label}", row.more)
      .replace("{item}", "“Tidy bedroom”");
    await expect(page.getByText(text.toCheck, { exact: true })).toBeVisible();
    await expect(
      page.getByText(`Casey Fixture-A · ${text.today}`, { exact: true }),
    ).toBeVisible();
    const opener = page.getByRole("button", { name: menuName, exact: true });
    await opener.press("Enter");
    const sheet = page.getByRole("dialog", { name: menuName, exact: true });
    for (const name of [
      text.snooze,
      text.edit,
      text.reassign,
      text.markComplete,
      text.cancel,
    ]) {
      const action = sheet.getByRole("button", { name, exact: true });
      await expect(action).toBeVisible();
      const box = await action.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    expect(
      (
        await new AxeBuilder({ page })
          .include('[role="dialog"]')
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await sheet
      .getByRole("button", { name: text.reassign, exact: true })
      .press("Enter");
    const dialog = page.getByRole("dialog", {
      name: text.reassignTitle,
      exact: true,
    });
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole("button", {
      name: text.confirm,
      exact: true,
    });
    await expect(confirm).toBeDisabled();
    const child = dialog
      .getByRole("group", { name: text.assignTo, exact: true })
      .getByRole("button", {
        name: new RegExp(
          `Casey Fixture-A.*${profileSetupMessages[locale].roleChild}`,
        ),
      });
    await child.click();
    await expect(child).toHaveAttribute("aria-pressed", "true");
    await expect(confirm).toBeEnabled();
    expect(
      (
        await new AxeBuilder({ page })
          .include('[role="dialog"]')
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await dialog.screenshot({
      path: test.info().outputPath(`chore-reassign-${locale}.png`),
    });
    await dialog
      .getByRole("button", { name: text.cancel, exact: true })
      .press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(writes).toEqual([]);
  });
}
