/** #405: device-only preferences, fabricated household, no profile save. */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "./support/test";
import { authFile } from "./support/env";
import {
  isPseudolocaleEnabled,
  pseudolocalizeTemplate,
} from "../src/i18n/pseudo";

test.use({ storageState: authFile("parentA") });

for (const locale of ["en", "es"] as const) {
  test(`${locale} Language and Theme controls preserve independent preferences`, async ({
    page,
  }, info) => {
    const pseudo = isPseudolocaleEnabled(process.env);
    const text = (value: string) =>
      pseudo ? pseudolocalizeTemplate(value) : value;
    await page.addInitScript(
      ({ locale }) => {
        localStorage.setItem("familyPlanner_language", locale);
        localStorage.setItem("familyPlanner_theme_v2", "dark");
      },
      { locale },
    );
    await page.goto("/dashboard/settings");
    const select = page.getByLabel(
      text(locale === "en" ? "Preferred language" : "Idioma preferido"),
      { exact: true },
    );
    await expect(select).toHaveValue(locale);
    const group = page.getByRole("group", {
      name: text(locale === "en" ? "Theme" : "Tema"),
      exact: true,
    });
    await expect(group).toBeVisible();
    await expect(
      group.getByRole("button", {
        name: text(locale === "en" ? "Dark" : "Oscuro"),
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    const name = page.locator("#profileName");
    await name.fill("Casey QA unsaved");
    const light = group.getByRole("button", {
      name: text(locale === "en" ? "Light" : "Claro"),
      exact: true,
    });
    await light.click();
    await expect(select).toHaveValue(locale);
    await expect(name).toHaveValue("Casey QA unsaved");
    for (const button of await group.getByRole("button").all()) {
      await button.focus();
      await expect(button).toBeFocused();
      const box = await button.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(
        await button.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
    }
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await group.scrollIntoViewIfNeeded();
    const directory = path.join(
      process.cwd(),
      "test-results",
      "preferences-locale",
    );
    await mkdir(directory, { recursive: true });
    await page.screenshot({
      path: path.join(
        directory,
        `${info.project.name}-${locale}${pseudo ? "-pseudo" : ""}.png`,
      ),
      fullPage: true,
    });
    const other = locale === "en" ? "es" : "en";
    await select.selectOption(other);
    await expect(
      page.getByLabel(
        text(other === "en" ? "Preferred language" : "Idioma preferido"),
        { exact: true },
      ),
    ).toHaveValue(other);
    await expect(name).toHaveValue("Casey QA unsaved");
    expect(
      await page.evaluate(() => localStorage.getItem("familyPlanner_theme_v2")),
    ).toBe("light");
  });
}
