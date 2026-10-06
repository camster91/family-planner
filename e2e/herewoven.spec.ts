import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { authFile } from "./support/env";
import { useStoredTheme } from "./support/network";
import { expect, test } from "./support/test";

function dinnerMarkup(mealsEnabled: boolean, privateMode = false): string {
  return execFileSync(
    process.execPath,
    [
      path.join(__dirname, "support/dinner-markup.cjs"),
      String(mealsEnabled),
      privateMode ? "private" : "person",
    ],
    { encoding: "utf8" },
  );
}

// Render the production component and production CSS without changing household
// settings. Both authorized destinations and the shared-device null-link state
// remain explicit; this labelled fixture never writes to the database.
test.describe("Herewoven dinner pressed states", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const theme of ["light", "dark"] as const) {
    for (const mealsEnabled of [true, false]) {
      const name = mealsEnabled ? "Plan dinner" : "Turn on meal planning";
      const href = mealsEnabled ? "/dashboard/meals" : "/dashboard/features";
      test(`${name} stays readable while pressed in ${theme}`, async ({
        page,
      }, testInfo) => {
        await useStoredTheme(page, theme);
        await page.goto("/login");
        await expect(
          page.getByRole("link", { name: "Herewoven home" }),
        ).toBeVisible();
        await expect
          .poll(() =>
            page.evaluate(() =>
              document.documentElement.classList.contains("dark"),
            ),
          )
          .toBe(theme === "dark");
        await page.evaluate(() => document.fonts.ready);
        const markup = dinnerMarkup(mealsEnabled);
        await page.locator("main").evaluate((node, html) => {
          node.innerHTML = `<p>Labelled synthetic dinner-action fixture</p><div class="bg-[var(--surface-grouped)] [&_[data-testid=region-dinner]]:bg-accent-tint">${html}</div>`;
        }, markup);
        const action = page
          .getByTestId("region-dinner")
          .getByRole("link", { name, exact: true });
        await expect(action).toHaveAttribute("href", href);
        const states = [];
        for (const state of ["normal", "focus", "pressed"] as const) {
          if (state === "focus") await action.focus();
          if (state === "pressed") {
            await action.scrollIntoViewIfNeeded();
            const box = (await action.boundingBox())!;
            await page.mouse.move(
              box.x + box.width / 2,
              box.y + box.height / 2,
            );
            await page.mouse.down();
            await expect(action).toHaveJSProperty("tagName", "A");
            expect(
              await action.evaluate((node) => node.matches(":active")),
            ).toBe(true);
          }
          const paints = await action.evaluate((node) => ({
            foreground: getComputedStyle(node).color,
            buttonBackground: getComputedStyle(node).backgroundColor,
            dinnerBackground: getComputedStyle(node.closest("section")!)
              .backgroundColor,
            focusOutline: getComputedStyle(node).outlineStyle,
          }));
          expect(
            paints.buttonBackground,
            "production utilities must be loaded",
          ).not.toBe("rgba(0, 0, 0, 0)");
          expect(
            paints.dinnerBackground,
            "production dinner tint must be loaded",
          ).not.toBe("rgba(0, 0, 0, 0)");
          const result = await new AxeBuilder({ page })
            .include('[data-testid="region-dinner"]')
            .withRules(["color-contrast"])
            .analyze();
          states.push({ state, paints, violations: result.violations });
          await testInfo.attach(`dinner-${state}-${theme}.json`, {
            body: JSON.stringify(states.at(-1), null, 2),
            contentType: "application/json",
          });
          expect
            .soft(
              result.violations,
              JSON.stringify({ theme, name, state, paints }),
            )
            .toEqual([]);
        }
        // Cancel the press outside the link; checking a pressed state must not
        // navigate or mutate anything. Assert the destination still exists.
        await page.mouse.move(0, 0);
        await page.mouse.up();
        await expect(action).toHaveAttribute("href", href);
        const privateMarkup = dinnerMarkup(mealsEnabled, true);
        await page.locator("main").evaluate((node, html) => {
          node.innerHTML = html;
        }, privateMarkup);
        await expect(
          page.getByTestId("region-dinner").getByRole("link"),
        ).toHaveCount(0);
      });
    }
  }
});

test.describe("Herewoven auth home target", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const theme of ["light", "dark"] as const) {
    test(`home escape is at least 44px on every auth screen in ${theme}`, async ({
      page,
    }, testInfo) => {
      await useStoredTheme(page, theme);
      const verifyRequests: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname === "/api/auth/verify-email")
          verifyRequests.push(request.method());
      });
      const measurements = [];
      for (const route of [
        "/login",
        "/register",
        "/forgot-password",
        "/reset-password",
        "/verify-email",
        "/verify-email?token=synthetic-review-token",
      ]) {
        await page.goto(route);
        const home = page.getByRole("link", {
          name: "Herewoven home",
          exact: true,
        });
        await expect(home).toHaveAttribute("href", "/");
        await expect
          .poll(() =>
            page.evaluate(() =>
              document.documentElement.classList.contains("dark"),
            ),
          )
          .toBe(theme === "dark");
        await page.evaluate(() => document.fonts.ready);
        const box = (await home.boundingBox())!;
        measurements.push({ route, ...box });
        expect.soft(box.height, route).toBeGreaterThanOrEqual(44);
        expect.soft(box.width, route).toBeGreaterThanOrEqual(44);
        await home.focus();
        await expect(home).toBeFocused();
        expect(
          await home.evaluate((node) => getComputedStyle(node).outlineStyle),
        ).toBe("solid");
        await expect(page.getByRole("main")).toHaveCount(1);
      }
      await expect(
        page.getByText(
          "Press the button to finish setting up your Herewoven account.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Confirm my email", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Go to sign in", exact: true }),
      ).toHaveAttribute("href", "/login");
      expect(
        verifyRequests,
        "opening verification must not consume its token",
      ).toEqual([]);
      await testInfo.attach("auth-home-targets.json", {
        body: JSON.stringify({ theme, measurements, verifyRequests }, null, 2),
        contentType: "application/json",
      });
      await page
        .getByRole("link", { name: "Herewoven home", exact: true })
        .click();
      await expect(page).toHaveURL(/\/$/);
    });
  }
});

test.describe("Herewoven dinner actions", () => {
  test.use({ storageState: authFile("parentA") });

  for (const theme of ["light", "dark"] as const) {
    test(`the empty dinner action has readable contrast in ${theme}`, async ({
      page,
    }, testInfo) => {
      await useStoredTheme(page, theme);
      await page.goto("/dashboard/today");
      const dinner = page.getByTestId("region-dinner");
      const action = dinner.getByRole("link", {
        name: "Plan dinner",
        exact: true,
      });
      await expect(action).toBeVisible();
      await expect(action).toHaveAttribute("href", "/dashboard/meals");
      await page.evaluate(() => document.fonts.ready);
      const paints = await action.evaluate((node) => ({
        foreground: getComputedStyle(node).color,
        buttonBackground: getComputedStyle(node).backgroundColor,
        dinnerBackground: getComputedStyle(node.closest("section")!)
          .backgroundColor,
      }));
      const result = await new AxeBuilder({ page })
        .include('[data-testid="region-dinner"]')
        .withRules(["color-contrast"])
        .analyze();
      await testInfo.attach("dinner-contrast.json", {
        body: JSON.stringify(
          { theme, paints, violations: result.violations },
          null,
          2,
        ),
        contentType: "application/json",
      });
      expect(result.violations, JSON.stringify({ theme, paints })).toEqual([]);
    });
  }
});
