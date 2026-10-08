/** Versioned online grocery edits (#135): real auth, CAS, replay and canonical recovery. */
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { authFile } from "./support/env";
import { browserFetch, browserSend, expect, test } from "./support/test";

const EDIT = "**/api/lists/items/edit";
async function capture(page: Page, name: string, project: string) {
  const dir = path.join(process.cwd(), "test-results", "grocery-edit");
  await mkdir(dir, { recursive: true });
  await page.screenshot({
    path: path.join(dir, `${project}-${name}.png`),
    fullPage: false,
  });
}
async function item(page: Page, listId: string, itemId: string) {
  const result = await browserFetch(page, `/api/lists/items?listId=${listId}`);
  expect(result.status).toBe(200);
  return JSON.parse(result.body).items.find(
    (row: { id: string }) => row.id === itemId,
  );
}

test.describe("grocery field edit conflicts", () => {
  test.use({ storageState: authFile("parentA") });
  let listId = "";
  let itemId = "";
  test.beforeEach(async ({ page }, info) => {
    test.skip(
      !["phone-390x844", "fridge-landscape-1280x800"].includes(
        info.project.name,
      ),
      "representative phone and fridge edit journeys",
    );
    listId = "";
    await page.goto("/dashboard/lists");
    const created = await browserSend(page, "POST", "/api/lists/create", {
      name: "Grocery edit proof",
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
    await page.getByRole("button", { name: "Edit Milk", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Edit grocery item" }),
    ).toBeVisible();
  });
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.context().setOffline(false);
    if (listId) {
      await page.goto("/dashboard/lists");
      expect(
        (await browserSend(page, "DELETE", "/api/lists", { listId })).status,
      ).toBe(200);
    }
  });
  test("a second writer wins; stale draft is retained until current values are adopted", async ({
    page,
  }, info) => {
    await page.getByLabel("Item name", { exact: true }).fill("Oat milk draft");
    const written = await browserSend(
      page,
      "PATCH",
      "/api/lists/items/update",
      { itemId, content: "Fresh bread", quantity: 2 },
    );
    expect(written.status).toBe(200);
    const result = page.waitForResponse((r) =>
      r.url().endsWith("/api/lists/items/edit"),
    );
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    expect((await result).status()).toBe(409);
    await expect(
      page.getByText("Current list: Fresh bread · quantity 2", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Item name", { exact: true })).toHaveValue(
      "Oat milk draft",
    );
    await expect(
      page.getByRole("button", { name: "Save changes", exact: true }),
    ).toBeDisabled();
    expect((await item(page, listId, itemId)).content).toBe("Fresh bread");
    await capture(page, "conflict", info.project.name);
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
        .violations,
    ).toEqual([]);
    await page
      .getByRole("button", { name: "Use current values", exact: true })
      .click();
    await page
      .getByLabel("Item name", { exact: true })
      .fill("Bread for dinner");
    await page.getByLabel("Quantity", { exact: true }).fill("3");
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.locator(`[data-item-id="${itemId}"]`)).toContainText(
      "Bread for dinner",
    );
    expect(await item(page, listId, itemId)).toMatchObject({
      content: "Bread for dinner",
      quantity: 3,
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await capture(page, "confirmed", info.project.name);
  });
  test("a committed lost response retries the identical intent and refreshes past a newer edit", async ({
    page,
  }, info) => {
    const requests: Array<{ body: string | null; key: string | undefined }> =
      [];
    let sends = 0;
    await page.route(EDIT, async (route) => {
      requests.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (++sends === 1) await route.abort("failed");
      else {
        expect(response.headers()["idempotency-replayed"]).toBe("true");
        await route.fulfill({ response });
      }
    });
    await page.getByLabel("Item name", { exact: true }).fill("Committed milk");
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Retry save", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Item name", { exact: true })).toBeDisabled();
    await capture(page, "uncertain", info.project.name);
    expect((await item(page, listId, itemId)).content).toBe("Committed milk");
    expect(
      (
        await browserSend(page, "PATCH", "/api/lists/items/update", {
          itemId,
          content: "Newest shared edit",
          quantity: 4,
        })
      ).status,
    ).toBe(200);
    await page.getByRole("button", { name: "Retry save", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    await expect(page.locator(`[data-item-id="${itemId}"]`)).toContainText(
      "Newest shared edit",
    );
    expect((await item(page, listId, itemId)).quantity).toBe(4);
  });
  test("offline draft and removed-row recovery never queue an edit or resurrect the item", async ({
    page,
  }, info) => {
    await page.context().setOffline(true);
    await page
      .getByLabel("Item name", { exact: true })
      .fill("Offline milk draft");
    await expect(
      page.getByRole("button", { name: "Save changes", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText("You’re offline. Connect before saving.", { exact: true }),
    ).toBeVisible();
    await capture(page, "offline-draft", info.project.name);
    await page.context().setOffline(false);
    expect(
      (await browserSend(page, "DELETE", `/api/lists/items/${itemId}`)).status,
    ).toBe(200);
    const result = page.waitForResponse((r) =>
      r.url().endsWith("/api/lists/items/edit"),
    );
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    expect((await result).status()).toBe(404);
    await expect(
      page.getByText(
        "This item is no longer on the list. Close this window to continue.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save changes", exact: true }),
    ).toBeDisabled();
    expect(await item(page, listId, itemId)).toBeUndefined();
    await capture(page, "removed", info.project.name);
  });
});
