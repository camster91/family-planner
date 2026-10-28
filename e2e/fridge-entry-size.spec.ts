import { authFile } from "./support/env";
import { expect, test } from "./support/test";

test.use({ storageState: authFile("parentA") });
test("Fridge mode entry follows available device space and keeps exit reachable", async ({
  page,
}, info) => {
  test.skip(
    ![
      "phone-390x844",
      "tablet-portrait-800x1280",
      "fridge-landscape-1280x800",
      "desktop-1366x768",
    ].includes(info.project.name),
  );
  await page.goto("/dashboard/today");
  const entry = page.getByRole("link", { name: "Fridge mode", exact: true });
  if (info.project.name === "phone-390x844") {
    await expect(entry).not.toBeVisible();
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(entry).not.toBeVisible();
    await page.setViewportSize({ width: 600, height: 960 });
    await expect(entry).not.toBeVisible();
    await page.setViewportSize({ width: 960, height: 600 });
    await expect(entry).not.toBeVisible();
    await page.goto("/dashboard/today?mode=fridge");
    await expect(
      page.getByRole("link", { name: /Exit fridge mode/i }),
    ).toBeVisible();
  } else {
    await expect(entry).toBeVisible();
    await entry.click();
    await expect(page).toHaveURL(/mode=fridge/);
  }
});
