import AxeBuilder from "@axe-core/playwright";
import { test, expect, loginViaUi } from "./support/test";
import { FIXTURE_EMAILS } from "../src/lib/fixtures/dataset";

test("Routines keeps Today actionable and other repeating chores dated, grouped and canonical", async ({
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
  await page.goto("/dashboard/chores");
  await page.getByRole("button", { name: "Routines", exact: true }).click();
  const other = page.getByRole("region", { name: "Other chores", exact: true });
  await expect(
    other.getByRole("button", { name: "Complete Vacuum living room" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "All", exact: true }).click();
  const summary = other
    .locator("summary")
    .filter({ hasText: "Vacuum living room" });
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("5 dates");
  await expect(
    other.getByRole("button", { name: "Complete Vacuum living room" }).first(),
  ).not.toBeVisible();
  await summary.click();
  const buttons = other.getByRole("button", {
    name: "Complete Vacuum living room",
  });
  await expect(buttons.first()).toBeVisible();
  const selected = buttons.nth(1);
  const href = await selected
    .locator("..")
    .getByRole("link", { name: "Edit Vacuum living room" })
    .getAttribute("href");
  const expectedId = new URL(href!, "http://localhost").searchParams.get("id");
  const responsePromise = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/chores/complete") &&
      r.request().method() === "POST",
  );
  await selected.click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual({ choreId: expectedId });
  expect(expectedId).toMatch(/^fx_chore_a_weekly_occ_/);
  await expect(other.getByText("Done · awaiting check").first()).toBeVisible();
  const result = await new AxeBuilder({ page })
    .include('section[aria-label="Other chores"]')
    .analyze();
  expect(result.violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await summary.click();
  await other.screenshot({ path: test.info().outputPath("other-chores.png") });
});
