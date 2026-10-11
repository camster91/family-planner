import AxeBuilder from "@axe-core/playwright";
import {
  test,
  expect,
  loginViaUi,
  browserSend,
  browserFetch,
} from "./support/test";
import { FIXTURE_EMAILS, FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { E2E_ANCHOR } from "./support/env";

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
  // Own a fresh series: generated non-fixture copies from earlier local runs
  // are intentionally not removed by fixture seeding. Shared fixture state
  // must not determine this test's expected group count.
  const title = "QA weekly routine grouping";
  const created = await browserSend(page, "POST", "/api/chores/create", {
    title,
    assigned_to: FIXTURE_IDS.familyA.teen,
    due_date: E2E_ANCHOR.toISOString().slice(0, 10),
    difficulty: "easy",
    frequency: "weekly",
    points: 10,
  });
  expect(created.status).toBe(200);
  const seriesId = JSON.parse(created.body).chore.id as string;
  const ownedIds = [seriesId];
  try {
    const records = await browserFetch(page, "/api/chores?limit=200");
    expect(records.status).toBe(200);
    const series = (
      JSON.parse(records.body).chores as Array<{
        id: string;
        recurrence_id: string;
      }>
    ).filter((c) => c.recurrence_id === seriesId);
    ownedIds.splice(0, ownedIds.length, ...series.map((c) => c.id));
    expect(ownedIds).toHaveLength(4);
    await page.goto("/dashboard/chores");
    await page.getByRole("button", { name: "Routines", exact: true }).click();
    const other = page.getByRole("region", {
      name: "Other chores",
      exact: true,
    });
    await expect(
      other.getByRole("button", { name: `Complete ${title}` }),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "All", exact: true }).click();
    const summary = other.locator("summary").filter({ hasText: title });
    await expect(summary).toBeVisible();
    // The fresh fixed-clock series has its template today plus three weekly copies.
    // The four-occurrence window counts its template; it must not grow a fifth
    // row simply because the page is opened.
    await expect(summary).toContainText("4 dates");
    await expect(
      other.getByRole("button", { name: `Complete ${title}` }).first(),
    ).not.toBeVisible();
    await summary.click();
    const buttons = other.getByRole("button", {
      name: `Complete ${title}`,
    });
    await expect(buttons).toHaveCount(4);
    await expect(buttons.first()).toBeVisible();
    const selected = buttons.nth(1);
    const href = await selected
      .locator("..")
      .getByRole("link", { name: `Edit ${title}` })
      .getAttribute("href");
    const expectedId = new URL(href!, "http://localhost").searchParams.get(
      "id",
    );
    const responsePromise = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/chores/complete") &&
        r.request().method() === "POST",
    );
    await selected.click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toEqual({ choreId: expectedId });
    expect(ownedIds).toContain(expectedId);
    expect(expectedId).not.toBe(seriesId);
    await expect(
      other.getByText("Done · awaiting check").first(),
    ).toBeVisible();
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
    await other.screenshot({
      path: test.info().outputPath("other-chores.png"),
    });
  } finally {
    // Delete only records created by this test, through the canonical API.
    for (const choreId of ownedIds) {
      const removed = await browserSend(page, "DELETE", "/api/chores", {
        choreId,
      });
      expect(removed.status).toBe(200);
    }
  }
});
