import AxeBuilder from "@axe-core/playwright";
import { authFile } from "./support/env";
import { expect, test } from "./support/test";

test.use({ storageState: authFile("childA") });
test("a failed account-controls download retries without deleting anything", async ({
  page,
}, testInfo) => {
  test.skip(
    ![
      "phone-390x844",
      "tablet-portrait-800x1280",
      "fridge-landscape-1280x800",
    ].includes(testInfo.project.name),
    "representative phone, portrait and fridge layouts",
  );
  expect((await page.goto("/dashboard"))?.status()).toBe(200);
  const menu = page.getByRole("button", { name: "User menu" });
  await menu.click();
  await page.waitForLoadState("networkidle");
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "DELETE")
      writes.push(new URL(request.url()).pathname);
  });
  let blocked = false;
  await page.route("**/_next/static/**/*.js", async (route) => {
    if (!blocked) {
      blocked = true;
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Delete my account" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete account" });
  await expect(dialog.getByRole("alert")).toHaveText(
    "Could not load your account details.",
  );
  expect(blocked).toBe(true);
  const retry = dialog.getByRole("button", { name: "Try again" });
  const box = await retry.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(
    (
      await new AxeBuilder({ page })
        .include('[data-testid="delete-account-dialog"]')
        .analyze()
    ).violations,
  ).toEqual([]);
  await retry.click();
  await expect(dialog.getByLabel("Your password")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Delete my account" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(menu).toBeFocused();
  expect(writes).toEqual([]);
});
