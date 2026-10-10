import AxeBuilder from "@axe-core/playwright";
import { test, expect, loginViaUi } from "./support/test";
import { FIXTURE_EMAILS } from "../src/lib/fixtures/dataset";

test("Help app details are deliberate, readable and recover when server identity is unavailable", async ({
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
  let reads = 0;
  await page.route("**/api/version", (route) => {
    reads += 1;
    return route.fulfill({ status: 404, body: "" });
  });
  await loginViaUi(page, FIXTURE_EMAILS.familyA.parent);
  await expect(page).toHaveURL(/\/dashboard(?:\/|$)/);
  await page.goto("/dashboard/help");
  const card = page.getByRole("region", { name: "App details", exact: true });
  await expect(card).toBeVisible();
  expect(reads).toBe(0);
  const view = card.getByRole("button", {
    name: "View app details",
    exact: true,
  });
  const size = await view.boundingBox();
  expect(size!.height).toBeGreaterThanOrEqual(44);
  await view.click();
  await expect(card.getByText("Web browser", { exact: true })).toBeVisible();
  await expect(card.getByText("Unavailable", { exact: true })).toBeVisible();
  expect(reads).toBe(1);
  await card.getByText("Report for support", { exact: true }).click();
  await expect(card.getByTestId("app-diagnostics-report")).toContainText(
    '"server": null',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const audit = await new AxeBuilder({ page })
    .include('section[aria-labelledby="help-app-details"]')
    .analyze();
  expect(audit.violations).toEqual([]);
  await card.screenshot({ path: test.info().outputPath("app-details.png") });
});
