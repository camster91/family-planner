import { authFile } from "./support/env";
import { expect, test } from "./support/test";

test.use({ storageState: authFile("parentA") });
test.beforeEach(async ({}, info) => {
  test.skip(
    ![
      "phone-390x844",
      "fridge-landscape-1280x800",
      "desktop-1366x768",
    ].includes(info.project.name),
    "representative personal dashboard layouts",
  );
});

test("Today Add or ask leads to a composer without starting AI or writes", async ({
  page,
}, info) => {
  const submissions: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/api\/(assistant|capture)(\/|$)/.test(new URL(request.url()).pathname)
    )
      submissions.push(request.url());
  });
  await page.goto("/dashboard/today");
  const entry = page
    .getByRole("navigation", { name: "Today quick actions" })
    .getByRole("button", { name: "Add or ask", exact: true });
  await entry.click();
  const sheet = page.getByTestId("quick-add-dialog");
  await expect(sheet).toBeVisible();
  await expect(
    sheet.getByRole("link", { name: "Add event", exact: true }),
  ).toHaveAttribute("href", "/dashboard/calendar/create");
  await page.screenshot({
    path: `/tmp/family-action-${info.project.name}-sheet.png`,
  });
  await info.attach("01-add-or-ask", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await sheet.getByRole("button", { name: /Ask the assistant/ }).click();
  await expect(sheet).not.toBeVisible();
  const composer = page.locator("#assistant-message");
  await expect(composer).toBeVisible();
  const browse = page
    .locator("summary")
    .filter({ hasText: "Browse actions and help" });
  await expect(browse).toBeVisible();
  expect(
    await browse.evaluate(
      (el) => (el.parentElement as HTMLDetailsElement).open,
    ),
  ).toBe(false);
  const composerBox = await composer.boundingBox();
  expect(composerBox).not.toBeNull();
  expect(composerBox!.y).toBeGreaterThanOrEqual(0);
  expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height,
  );
  await page.screenshot({
    path: `/tmp/family-action-${info.project.name}-composer.png`,
  });
  await info.attach("02-composer", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(entry).toBeFocused();
  expect(submissions).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("photo handoff explains unavailable capture and offers manual entry", async ({
  page,
}) => {
  // Deterministic unavailable capability; no provider or private household data.
  await page.route("**/api/capture", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ configured: false, allowed: true }),
        })
      : route.abort(),
  );
  await page.goto("/dashboard/today");
  await page
    .getByRole("navigation", { name: "Today quick actions" })
    .getByRole("button", { name: "Add or ask", exact: true })
    .click();
  await page
    .getByTestId("quick-add-dialog")
    .getByRole("link", { name: "Add from a photo" })
    .click();
  await expect(page).toHaveURL(/\/dashboard\/calendar\?capture=1/);
  await expect(
    page.getByText(
      "Photo and quick add are not available for this account right now.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Add an event manually" }),
  ).toHaveAttribute("href", "/dashboard/calendar/create");
});

test("Today keeps secondary actions tucked away and restores their dialog focus", async ({
  page,
}, info) => {
  await page.goto("/dashboard/today");
  const nav = page.getByRole("navigation", { name: "Today quick actions" });
  const controls = nav.locator("summary", { hasText: "Today controls" });
  const explore = nav.getByRole("button", { name: "Explore", exact: true });
  await expect(explore).not.toBeVisible();
  await page.screenshot({
    path: `/tmp/today-hierarchy-${info.project.name}.png`,
  });
  await controls.click();
  await page.screenshot({
    path: `/tmp/today-hierarchy-${info.project.name}-controls.png`,
  });
  await expect(explore).toHaveCount(0);
  const dialog = page.getByRole("dialog");
  const customize = nav.getByRole("button", {
    name: "Customize Today",
    exact: true,
  });
  await expect(customize).toBeEnabled();
  await customize.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(customize).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(controls).toBeFocused();
  await expect(explore).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("wide Today puts dinner beside the schedule without changing saved section order", async ({
  page,
}, info) => {
  await page.goto("/dashboard/today");
  const grid = page.getByTestId("board-grid");
  const next = grid.locator(':scope > [data-today-section="next"]');
  const dinner = grid.locator(':scope > [data-today-section="dinner"]');
  await expect(dinner).toBeVisible();
  const nextBox = await next.boundingBox();
  const dinnerBox = await dinner.boundingBox();
  expect(nextBox).not.toBeNull();
  expect(dinnerBox).not.toBeNull();
  if (page.viewportSize()!.width >= 1280) {
    expect(Math.abs(nextBox!.y - dinnerBox!.y)).toBeLessThan(2);
    expect(dinnerBox!.x).toBeGreaterThan(nextBox!.x + nextBox!.width);
  } else {
    expect(dinnerBox!.y).toBeGreaterThanOrEqual(nextBox!.y + nextBox!.height);
  }
  expect(
    await grid
      .locator(":scope > div")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-today-section")),
      ),
  ).toEqual(["next", "dinner", "groceries", "coming"]);
  await page.screenshot({
    path: `/tmp/today-dinner-${info.project.name}.png`,
    fullPage: true,
  });
  // Preview a real customization without saving fixture preferences.
  const nav = page.getByRole("navigation", { name: "Today quick actions" });
  await nav.locator("summary", { hasText: "Today controls" }).click();
  await nav
    .getByRole("button", { name: "Customize Today", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Make Today yours" });
  await editor.getByRole("button", { name: "Move Dinner up" }).click();
  await editor.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(grid.locator(":scope > div").first()).toHaveAttribute(
    "data-today-section",
    "dinner",
  );
  const customNext = await next.boundingBox();
  const customDinner = await dinner.boundingBox();
  expect(customNext!.y).toBeGreaterThanOrEqual(
    customDinner!.y + customDinner!.height,
  );
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await expect(grid.locator(":scope > div").first()).toHaveAttribute(
    "data-today-section",
    "next",
  );
});
