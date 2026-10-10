/** #467: mounted real routes, fabricated fixture session, no writes/providers. */
import { test, expect } from "./support/test";
import { authFile } from "./support/env";

test.use({ storageState: authFile("parentA") });

test("weekly chores select multiple weekdays without a due-date field", async ({
  page,
}, info) => {
  await page.goto("/dashboard/chores/create");
  await page.getByRole("button", { name: "Weekly", exact: true }).click();
  await expect(page.getByLabel("Due Date", { exact: true })).toHaveCount(0);
  const monday = page.getByRole("checkbox", { name: "Monday", exact: true });
  const thursday = page.getByRole("checkbox", {
    name: "Thursday",
    exact: true,
  });
  await monday.check();
  await thursday.check();
  await expect(monday).toBeChecked();
  await expect(thursday).toBeChecked();
  await info.attach("weekly-days", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("custom lists explain their purpose and offer image selection", async ({
  page,
}, info) => {
  await page.goto("/dashboard/lists/create");
  await page.getByRole("button", { name: /Custom/ }).click();
  await expect(
    page.getByText(
      "A checklist for anything your family needs—packing, school supplies, or weekend plans.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add image", exact: true }),
  ).toBeVisible();
  await info.attach("custom-list", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("private report and AI dialogs close back to Today without submitting", async ({
  page,
}, info) => {
  await page.goto("/dashboard/today");
  const writes: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method())) writes.push(request.url());
  });
  await page
    .getByRole("button", { name: "Report / Suggest", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await info.attach("private-report", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByText("Household records are not attached.", { exact: false }),
  ).toBeVisible();
  await info.attach("assistant", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(writes).toEqual([]);
});
