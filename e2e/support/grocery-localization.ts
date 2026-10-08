/** #409: expected templates and rendered checks for the complete recovery controls. */
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect } from "./test";
import {
  groceryEnglish,
  grocerySpanish,
  type GroceryMessage,
} from "../../src/i18n/grocery-controls";
import {
  isPseudolocaleEnabled,
  pseudolocalizeTemplate,
} from "../../src/i18n/pseudo";

export function groceryText(locale: "en" | "es") {
  return (key: GroceryMessage, params?: Record<string, string | number>) => {
    const template = (locale === "en" ? groceryEnglish : grocerySpanish)[key];
    const expanded = isPseudolocaleEnabled(process.env)
      ? pseudolocalizeTemplate(template)
      : template;
    return params
      ? expanded.replace(/\{(\w+)\}/g, (_, key) =>
          String(params[key] ?? `{${key}}`),
        )
      : expanded;
  };
}

export async function checkGroceryControls(
  page: Page,
  scope: Locator,
  info: TestInfo,
  name: string,
) {
  await expect(scope).toBeVisible();
  for (const button of await scope.getByRole("button").all()) {
    if (!(await button.isVisible())) continue;
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(
      await button.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    if (await button.isEnabled()) {
      await button.focus();
      await expect(button).toBeFocused();
    }
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .include(
          await scope.evaluate((el) => {
            // A unique temporary QA attribute selects this scope without changing app behavior.
            el.setAttribute("data-grocery-localization-qa", "current");
            return '[data-grocery-localization-qa="current"]';
          }),
        )
        .analyze()
    ).violations,
  ).toEqual([]);
  await scope.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
  await scope.evaluate((el) =>
    el.removeAttribute("data-grocery-localization-qa"),
  );
}
