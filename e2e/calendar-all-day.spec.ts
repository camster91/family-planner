import { test, expect, browserFetch } from "./support/test";
import { E2E_ANCHOR, authFile } from "./support/env";
import { FIXTURE_EMAILS } from "../src/lib/fixtures/dataset";

// An all-day event: made with the "All day" switch, shown in its own strip on
// the calendar, and listed first with "All day" on Today.
test.use({ storageState: authFile("parentA"), timezoneId: "America/Toronto" });
test.beforeEach(async ({ context, baseURL, page }, info) => {
  test.skip(
    ![
      "phone-390x844",
      "fridge-landscape-1280x800",
      "desktop-1366x768",
    ].includes(info.project.name),
    "Representative all-day event projects",
  );
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
    new URL(baseURL!).hostname,
  );
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      ["data:", "blob:"].includes(url.protocol)
      ? route.continue()
      : route.abort();
  });
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard\/today$/);
  const auth = await browserFetch(page, "/api/auth/me");
  expect(JSON.parse(auth.body).user.email).toBe(FIXTURE_EMAILS.familyA.parent);
});

test("an all-day event shows in the calendar strip and first on Today", async ({
  page,
  request,
}, info) => {
  await page.evaluate(() =>
    localStorage.setItem("familyPlanner_language", "en"),
  );
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(E2E_ANCHOR);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  const title = `Synthetic all day ${info.project.name} attempt ${info.retry}`;
  let eventId: string | undefined;
  try {
    await page.goto(`/dashboard/calendar?date=${date}&view=agenda`);
    await expect(page.getByText("Updated just now")).toBeVisible();
    await page.getByRole("link", { name: "Add event", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "New Event" });
    await expect(sheet).toBeVisible();
    await sheet.getByLabel("Title", { exact: true }).fill(title);
    await sheet.locator("#startDate").fill(date);

    // The switch is a full-size target; on, it hides the time and duration.
    const allDay = sheet.getByRole("switch", { name: "All day" });
    await expect(allDay).toHaveAttribute("aria-checked", "false");
    await expect(sheet.locator("#startTime")).toBeVisible();
    const box = (await allDay.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    await allDay.click();
    await expect(allDay).toHaveAttribute("aria-checked", "true");
    await expect(sheet.locator("#startTime")).toHaveCount(0);
    await expect(sheet.locator("#eventDuration")).toHaveCount(0);
    await expect(sheet.locator("#startDate")).toHaveValue(date);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);

    const created = page.waitForResponse(
      (res) =>
        new URL(res.url()).pathname === "/api/events" &&
        res.request().method() === "POST",
    );
    await sheet
      .getByRole("button", { name: "Create Event", exact: true })
      .click();
    const response = await created;
    expect(response.status()).toBe(200);
    const event = (await response.json()).event;
    eventId = event.id;
    expect(event.all_day).toBe(true);
    // Toronto midnight to 23:59 of the same day.
    expect(
      new Date(event.end_time).getTime() - new Date(event.start_time).getTime(),
    ).toBe(24 * 3_600_000 - 60_000);

    // Agenda: its own strip at the top of the day, "All day" and no clock time.
    await expect(page).toHaveURL(new RegExp(`date=${date}.*view=agenda`));
    const agendaEvent = page
      .getByTestId("calendar-all-day")
      .getByRole("button", { name: new RegExp(title) });
    await expect(agendaEvent).toBeVisible();
    await expect(agendaEvent).toContainText("All day");
    await expect(agendaEvent).not.toContainText(/12:00|11:59/);
    expect((await agendaEvent.boundingBox())!.height).toBeGreaterThanOrEqual(
      44,
    );

    // Day view: the strip sits above the hour grid.
    await page.goto(`/dashboard/calendar?date=${date}&view=day`);
    const dayEvent = page
      .getByTestId("calendar-all-day")
      .getByRole("button", { name: new RegExp(title) });
    await expect(dayEvent).toBeVisible();
    const grid = page.getByLabel("Timed calendar, all 24 hours");
    await expect(grid).toBeVisible();
    await expect(
      grid.getByRole("button", { name: new RegExp(title) }),
    ).toHaveCount(0);
    expect((await dayEvent.boundingBox())!.y).toBeLessThan(
      (await grid.boundingBox())!.y,
    );
    await dayEvent.click();
    await expect(page.getByTestId("event-detail-all-day")).toContainText(
      "All day",
    );
    await page.screenshot({
      path: info.outputPath("calendar-all-day.png"),
      fullPage: true,
    });

    // Today: listed with "All day" in the time column, before any timed event.
    await page.goto("/dashboard/today");
    const row = page.getByTestId("today-event").filter({ hasText: title });
    await expect(row).toBeVisible();
    await expect(row.locator("p").first()).toHaveText("All day");
    await expect(page.getByTestId("today-event").first()).toContainText(
      "All day",
    );
    await page.screenshot({
      path: info.outputPath("today-all-day.png"),
      fullPage: true,
    });
  } finally {
    if (eventId) {
      const csrf = (await request.storageState()).cookies.find(
        (cookie) => cookie.name === "csrf_token",
      )?.value;
      expect(csrf).toBeTruthy();
      const removed = await request.delete("/api/events", {
        headers: { "X-CSRF-Token": csrf! },
        data: { eventId },
      });
      expect(removed.status()).toBe(200);
    }
  }
});
