/** Two independent authenticated clients: bounded list propagation and deleted queue recovery. */
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { authFile, E2E_ANCHOR } from "./support/env";
import { browserSend, expect, test } from "./support/test";
import { BOARD_POLL_MS } from "../src/lib/board-sync";

test.describe("open grocery list convergence", () => {
  test.use({ storageState: authFile("parentA") });
  let listId = "",
    itemId = "";
  test.beforeEach(async ({ page }, info) => {
    test.skip(
      !["phone-390x844", "fridge-landscape-1280x800"].includes(
        info.project.name,
      ),
      "two representative clients",
    );
    listId = "";
    await page.goto("/dashboard/lists");
    const created = await browserSend(page, "POST", "/api/lists/create", {
      name: "Convergence proof",
      type: "grocery",
    });
    expect(created.status).toBe(200);
    listId = JSON.parse(created.body).list.id;
    const added = await browserSend(page, "POST", "/api/lists/items/create", {
      listId,
      content: "Milk",
    });
    expect(added.status).toBe(200);
    itemId = JSON.parse(added.body).item.id;
    await page.goto(`/dashboard/lists/${listId}`);
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
  test("child and parent editors receive each other's writes while retaining a stale draft", async ({
    page,
    browser,
  }, info) => {
    const context = await browser.newContext({
      storageState: authFile("childA"),
      viewport: info.project.use.viewport,
    });
    const child = await context.newPage();
    try {
      await child.clock.install({ time: E2E_ANCHOR });
      await child.goto(`/dashboard/lists/${listId}`);
      await page
        .getByRole("button", { name: "Edit Milk", exact: true })
        .click();
      await page.getByLabel("Item name", { exact: true }).fill("Parent draft");
      await child
        .getByRole("button", { name: "Edit Milk", exact: true })
        .click();
      await child.getByLabel("Item name", { exact: true }).fill("Child bread");
      await child.getByLabel("Quantity", { exact: true }).fill("2");
      await child
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await expect(child.getByRole("dialog")).toBeHidden();
      await page.clock.fastForward(BOARD_POLL_MS + 1000);
      await expect(
        page.getByText("Current list: Child bread · quantity 2", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByLabel("Item name", { exact: true })).toHaveValue(
        "Parent draft",
      );
      await expect(
        page.getByRole("button", { name: "Save changes", exact: true }),
      ).toBeDisabled();
      expect(
        (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
          .violations,
      ).toEqual([]);
      const dir = path.join(process.cwd(), "test-results", "list-convergence");
      await mkdir(dir, { recursive: true });
      await page.screenshot({
        path: path.join(dir, `${info.project.name}-remote-edit-draft.png`),
      });
      await page
        .getByRole("button", { name: "Use current values", exact: true })
        .click();
      await page.getByLabel("Item name", { exact: true }).fill("Family bread");
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toBeHidden();
      await child.clock.fastForward(BOARD_POLL_MS + 1000);
      await expect(child.locator(`[data-item-id="${itemId}"]`)).toContainText(
        "Family bread",
      );
      await expect(child.getByTestId("list-change-announcement")).toHaveText(
        "The list has been updated.",
      );
    } finally {
      await context.close();
    }
  });
  test("remote deletion removes canonical data but keeps a queued tick recoverable", async ({
    page,
  }, info) => {
    await page.route("**/api/lists/items/update", (route) =>
      route.abort("failed"),
    );
    await page
      .locator(`[data-item-id="${itemId}"]`)
      .getByRole("checkbox")
      .click();
    await expect(page.locator(`[data-item-id="${itemId}"]`)).toHaveAttribute(
      "data-sync-state",
      /pending|syncing/,
    );
    expect(
      (await browserSend(page, "DELETE", `/api/lists/items/${itemId}`)).status,
    ).toBe(200);
    await page.clock.fastForward(BOARD_POLL_MS + 1000);
    const row = page.locator(`[data-item-id="${itemId}"]`);
    await expect(row).toHaveAttribute("data-removed-elsewhere", "true");
    await expect(row).toContainText(
      "Removed from the list. Discard this pending change.",
    );
    await expect(row.getByRole("checkbox")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await page.unroute("**/api/lists/items/update");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(row).toHaveAttribute("data-sync-state", "conflict");
    const dir = path.join(process.cwd(), "test-results", "list-convergence");
    await mkdir(dir, { recursive: true });
    await page.screenshot({
      path: path.join(dir, `${info.project.name}-removed-tick-recovery.png`),
    });
    await row
      .getByRole("button", { name: "Discard change to Milk", exact: true })
      .click();
    await expect(row).toBeHidden();
    await expect(
      page.getByText("No items yet", { exact: true }).last(),
    ).toBeVisible();
  });
});
