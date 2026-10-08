/** #409: fabricated personal grocery capture, uncertain edit and explicit tick recovery. */
import { authFile } from "./support/env";
import { browserSend, expect, test } from "./support/test";
import {
  checkGroceryControls,
  groceryText,
} from "./support/grocery-localization";

test.use({ storageState: authFile("parentA") });
const projects = [
  "phone-390x844",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
];
for (const locale of ["en", "es"] as const) {
  test.describe(`${locale} grocery localization`, () => {
    let listId = "",
      itemId = "";
    const text = groceryText(locale);
    test.beforeEach(async ({ page }, info) => {
      test.skip(
        !projects.includes(info.project.name),
        "representative phone, portrait and fridge layouts",
      );
      listId = "";
      await page.addInitScript(
        (value) => localStorage.setItem("familyPlanner_language", value),
        locale,
      );
      await page.goto("/dashboard/lists");
      const created = await browserSend(page, "POST", "/api/lists/create", {
        name: "Localized grocery fixture",
        type: "grocery",
      });
      expect(created.status).toBe(200);
      listId = JSON.parse(created.body).list.id;
      const added = await browserSend(page, "POST", "/api/lists/items/create", {
        listId,
        content: "Leche 🥛",
      });
      expect(added.status).toBe(200);
      itemId = JSON.parse(added.body).item.id;
      await page.goto(`/dashboard/lists/${listId}`);
      // SSR fields can be visible before their handlers hydrate. Prove React
      // accepts an unsent draft before a test goes offline or ticks a row.
      const add = page.getByRole("region", {
        name: text("personSection"),
        exact: true,
      });
      await add
        .getByRole("textbox", { name: text("inputLabel"), exact: true })
        .fill("Hydration check");
      await expect(
        add.getByRole("button", { name: text("add"), exact: true }),
      ).toBeVisible();
      await add.getByRole("textbox").fill("");
      await expect(
        add.getByRole("button", { name: text("add"), exact: true }),
      ).toHaveCount(0);
    });
    test.afterEach(async ({ page }) => {
      await page.context().setOffline(false);
      await page.unrouteAll({ behavior: "ignoreErrors" });
      if (listId) {
        await page.goto("/dashboard/lists");
        expect(
          (await browserSend(page, "DELETE", "/api/lists", { listId })).status,
        ).toBe(200);
      }
    });
    test("personal queued add keeps household text and draft", async ({
      page,
    }, info) => {
      await page.context().setOffline(true);
      const section = page.getByRole("region", {
        name: text("personSection"),
        exact: true,
      });
      await section
        .getByRole("textbox", { name: text("inputLabel"), exact: true })
        .fill("Pan {quantity} 🥖");
      await section
        .getByRole("button", { name: text("add"), exact: true })
        .click();
      await expect(section.getByTestId("queued-grocery-add")).toContainText(
        "Pan {quantity} 🥖",
      );
      await expect(section.getByRole("status")).toContainText(text("queued"));
      await section.getByRole("textbox").fill("Unsent draft 🥛");
      await checkGroceryControls(page, section, info, `personal-add-${locale}`);
      await expect(section.getByRole("textbox")).toHaveValue("Unsent draft 🥛");
    });
    test("uncertain edit keeps original text and quantity", async ({
      page,
    }, info) => {
      await page
        .getByRole("main")
        .locator(`[data-item-id="${itemId}"]`)
        .getByRole("button", { name: "Edit Leche 🥛", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: text("editTitle"),
        exact: true,
      });
      await dialog
        .getByLabel(text("itemName"), { exact: true })
        .fill("Leche {quantity} 🥛");
      await dialog.getByLabel(text("quantity"), { exact: true }).fill("3");
      await page.route("**/api/lists/items/edit", (route) =>
        route.abort("connectionreset"),
      );
      await dialog
        .getByRole("button", { name: text("saveChanges"), exact: true })
        .click();
      await expect(dialog.getByRole("alert")).toContainText(
        text("editUncertain"),
      );
      await expect(
        dialog.getByLabel(text("itemName"), { exact: true }),
      ).toHaveValue("Leche {quantity} 🥛");
      await expect(
        dialog.getByLabel(text("quantity"), { exact: true }),
      ).toHaveValue("3");
      await checkGroceryControls(
        page,
        dialog,
        info,
        `uncertain-edit-${locale}`,
      );
    });
    test("saved tick recovery retains explicit discard warning", async ({
      page,
    }, info) => {
      await page.route("**/api/lists/items/update", (route) =>
        route.abort("internetdisconnected"),
      );
      // Next streaming buffers can retain hidden copies outside the displayed main.
      const row = page.getByRole("main").locator(`[data-item-id="${itemId}"]`);
      await expect(row).toHaveCount(1);
      await row.getByRole("checkbox").click();
      await expect(row).toHaveAttribute("data-sync-state", /pending|syncing/);
      await page.goto("/dashboard/lists");
      await page
        .getByRole("button", { name: text("reviewTicks"), exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: text("tickTitle"),
        exact: true,
      });
      await expect(dialog.getByTestId("pending-tick-recovery-row")).toHaveCount(
        1,
      );
      await expect(dialog).not.toContainText("Leche 🥛");
      await expect(dialog).not.toContainText(itemId);
      await checkGroceryControls(page, dialog, info, `tick-recovery-${locale}`);
      await dialog
        .getByRole("button", {
          name: text("discardChange", { index: 1 }),
          exact: true,
        })
        .click();
      const confirm = page.getByRole("alertdialog", {
        name: text("discardTitle"),
        exact: true,
      });
      await expect(confirm).toContainText(text("discardDescription"));
      await checkGroceryControls(page, confirm, info, `tick-discard-${locale}`);
    });
  });
}
