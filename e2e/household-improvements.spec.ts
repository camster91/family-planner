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
  const report = page.getByRole("button", {
    name: "Report / Suggest",
    exact: true,
  });
  await report.scrollIntoViewIfNeeded();
  expect(
    await report.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      return button.contains(
        document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        ),
      );
    }),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Report / Suggest", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Title", { exact: true }).fill("Fixture report draft");
  await page
    .getByLabel("What happened or what would help?", { exact: true })
    .fill("Fixture details remain private and unsent.");
  await info.attach("private-report", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(report).toBeFocused();
  await report.click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Fixture report draft",
  );
  await expect(
    page.getByLabel("What happened or what would help?", { exact: true }),
  ).toHaveValue("Fixture details remain private and unsent.");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.locator("#assistant-message").fill("Fixture unsent chat draft");
  await expect(
    page.getByText("Household records are not attached.", { exact: false }),
  ).toBeVisible();
  await info.attach("assistant", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const assistant = page.getByRole("button", {
    name: "AI assistant",
    exact: true,
  });
  await expect(assistant).toBeFocused();
  await assistant.click();
  await expect(page.locator("#assistant-message")).toHaveValue(
    "Fixture unsent chat draft",
  );
  await page.keyboard.press("Escape");
  expect(writes).toEqual([]);
});
