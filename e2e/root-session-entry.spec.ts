import { authFile } from "./support/env";
import { expect, test } from "./support/test";

test.beforeEach(async ({}, info) => {
  test.skip(!["phone-390x844", "desktop-1366x768"].includes(info.project.name));
});
for (const actor of ["parentA", "childA"] as const) {
  test.describe(actor, () => {
    test.use({ storageState: authFile(actor) });
    test("opening the app root resumes the signed-in role view", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(page).toHaveURL(
        actor === "parentA" ? /\/dashboard\/today$/ : /\/dashboard$/,
      );
      await expect(page.locator("#hero-title")).toHaveCount(0);
      await page.goto("/?utm_source=bookmark");
      await expect(page).toHaveURL(
        actor === "parentA" ? /\/dashboard\/today$/ : /\/dashboard$/,
      );
      await page.reload();
      await expect(page).toHaveURL(
        actor === "parentA" ? /\/dashboard\/today$/ : /\/dashboard$/,
      );
    });
  });
}
test("signed-out visitors can still open the homepage", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#hero-title")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});
