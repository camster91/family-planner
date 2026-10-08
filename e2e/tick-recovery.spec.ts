import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { authFile } from "./support/env";
import { browserSend, expect, test } from "./support/test";

test.describe("saved tick recovery after page restart", () => {
  test.use({ storageState: authFile("parentA") });
  let listId = "",
    itemId = "";
  test.beforeEach(async ({ page }, info) => {
    test.skip(
      !["phone-390x844", "fridge-landscape-1280x800"].includes(
        info.project.name,
      ),
      "representative phone and fridge",
    );
    listId = "";
    await page.goto("/dashboard/lists");
    const created = await browserSend(page, "POST", "/api/lists/create", {
      name: "Restart recovery proof",
      type: "grocery",
    });
    expect(created.status).toBe(200);
    listId = JSON.parse(created.body).list.id;
    const added = await browserSend(page, "POST", "/api/lists/items/create", {
      listId,
      content: "Private recovery item",
    });
    expect(added.status).toBe(200);
    itemId = JSON.parse(added.body).item.id;
  });
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    if (listId) {
      await page.goto("/dashboard/lists");
      expect(
        (await browserSend(page, "DELETE", "/api/lists", { listId })).status,
      ).toBe(200);
    }
  });
  test("recovers a persisted tick for a deleted item without item names or live row context", async ({
    page,
  }, info) => {
    const keys: string[] = [];
    await page.route("**/api/lists/items/update", async (route) => {
      keys.push(route.request().headers()["idempotency-key"]);
      await route.abort("failed");
    });
    await page.goto(`/dashboard/lists/${listId}`);
    const row = page.locator(`[data-item-id="${itemId}"]`);
    await row.getByRole("checkbox").click();
    await expect(row).toHaveAttribute("data-sync-state", /pending|syncing/);
    expect(
      (await browserSend(page, "DELETE", `/api/lists/items/${itemId}`)).status,
    ).toBe(200);
    // Full page navigation restarts JS; only the mutation endpoint is unavailable,
    // since a wholly offline cold page cannot boot this app without a cached document.
    await page.goto("/dashboard/lists");
    await page.reload();
    await page.getByRole("button", { name: "Review waiting ticks" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Waiting ticks",
      exact: true,
    });
    await expect(dialog.getByTestId("pending-tick-recovery-row")).toHaveCount(
      1,
    );
    await expect(dialog).not.toContainText("Private recovery item");
    await expect(dialog).not.toContainText(itemId);
    await page.unroute("**/api/lists/items/update");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(dialog.getByTestId("pending-tick-recovery-row")).toContainText(
      "Needs review",
    );
    const retryRequest = page.waitForRequest(
      (r) =>
        r.method() === "PATCH" && r.url().endsWith("/api/lists/items/update"),
    );
    await dialog.getByRole("button", { name: "Retry change 1" }).click();
    expect((await retryRequest).headers()["idempotency-key"]).toBe(keys[0]);
    await expect(dialog.getByTestId("pending-tick-recovery-row")).toContainText(
      "Needs review",
    );
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
        .violations,
    ).toEqual([]);
    const dir = path.join(process.cwd(), "test-results", "tick-recovery");
    await mkdir(dir, { recursive: true });
    await page.screenshot({
      path: path.join(dir, `${info.project.name}-restart-recovery.png`),
    });
    await dialog.getByRole("button", { name: "Discard change 1" }).click();
    const confirm = page.getByRole("alertdialog", {
      name: "Discard this pending tick?",
    });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Keep pending tick" }).click();
    await expect(confirm).toBeHidden();
    await expect(dialog.getByTestId("pending-tick-recovery-row")).toHaveCount(
      1,
    );
    await dialog.getByRole("button", { name: "Discard change 1" }).click();
    expect(
      (await new AxeBuilder({ page }).include('[role="alertdialog"]').analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({
      path: path.join(dir, `${info.project.name}-discard-confirmation.png`),
    });
    await page
      .getByRole("button", { name: "Discard pending tick", exact: true })
      .click();
    await expect(dialog.getByText("No saved ticks are waiting.")).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Review waiting ticks" }),
    ).toBeFocused();
    await page.reload();
    await page.getByRole("button", { name: "Review waiting ticks" }).click();
    await expect(page.getByText("No saved ticks are waiting.")).toBeVisible();
  });
});
