/** #401: run separately with both QA flags and --no-deps; no auth writes. */
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  isPseudolocaleEnabled,
  pseudolocalizeTemplate,
} from "../src/i18n/pseudo";
import { expect, test } from "./support/test";

test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(() => {
  test.skip(
    !isPseudolocaleEnabled(process.env),
    "pseudolocale QA flags are off",
  );
});

for (const view of [
  { route: "/login", heading: "Welcome Back", action: "Sign In" },
  {
    route: "/register",
    heading: "Create Your Account",
    action: "Create Account",
  },
  {
    route: "/forgot-password",
    heading: "Forgot Password",
    action: "Send Reset Link",
  },
]) {
  test(`expanded translated ${view.route} controls stay usable`, async ({
    page,
  }, testInfo) => {
    await page.goto(view.route);
    await expect(page.locator("html")).toHaveAttribute(
      "data-pseudolocalized",
      "true",
    );
    await expect(
      page.getByRole("heading", {
        name: pseudolocalizeTemplate(view.heading),
        exact: true,
      }),
    ).toBeVisible();
    const email = page.getByLabel(pseudolocalizeTemplate("Email Address"), {
      exact: true,
    });
    await email.fill("qa-only@example.test");
    await expect(email).toHaveValue("qa-only@example.test");
    if (view.route === "/register") {
      const name = page.getByLabel(pseudolocalizeTemplate("Full Name"), {
        exact: true,
      });
      await name.fill("李 & Casey {save}");
      await expect(name).toHaveValue("李 & Casey {save}");
    }
    const action = page.getByRole("button", {
      name: pseudolocalizeTemplate(view.action),
      exact: true,
    });
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeVisible();
    const target = await action.boundingBox();
    expect(target).not.toBeNull();
    expect(target!.width).toBeGreaterThanOrEqual(44);
    expect(target!.height).toBeGreaterThanOrEqual(44);
    expect(target!.x).toBeGreaterThanOrEqual(0);
    expect(target!.x + target!.width).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
    await action.focus();
    await expect(action).toBeFocused();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .exclude("next-route-announcer")
      .analyze();
    expect(
      axe.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
    const directory = path.join(process.cwd(), "test-results", "pseudolocale");
    await mkdir(directory, { recursive: true });
    await page.screenshot({
      path: path.join(
        directory,
        `${testInfo.project.name}-${view.route.slice(1)}.png`,
      ),
      fullPage: true,
    });
  });
}
