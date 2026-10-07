import AxeBuilder from "@axe-core/playwright";
import {
  test,
  expect,
  loginViaUi,
  browserFetch,
  browserSend,
} from "./support/test";
import { FIXTURE_EMAILS } from "../src/lib/fixtures/dataset";

test.use({ timezoneId: "America/New_York" });
test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["localhost", "127.0.0.1"].includes(url.hostname) ||
      ["data:", "blob:"].includes(url.protocol)
      ? route.continue()
      : route.abort();
  });
});

// Uses the canonical synthetic January fixture, not the current day.
test("parent planning: real range, fixed clock geometry, source empty, detail and editor", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginViaUi(page, FIXTURE_EMAILS.familyA.parent);
  await expect(page).toHaveURL(/\/dashboard(?:\/|$)/);
  await page.goto("/dashboard/calendar?date=2026-01-05&view=week");
  const dentist = page.getByRole("button", { name: /Dentist \(Casey\)/ });
  await expect(dentist).toBeVisible();
  const geometry = await dentist.evaluate((button) => {
    const nine = [...document.querySelectorAll('[class*="hours"] span')].find(
      (el) => el.textContent === "9 AM",
    )!;
    const target = button.getBoundingClientRect(),
      clock = nine.getBoundingClientRect();
    return {
      delta: target.top - clock.top,
      height: target.height,
      width: target.width,
    };
  });
  expect(Math.abs(geometry.delta)).toBeLessThanOrEqual(12);
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  expect(geometry.width).toBeGreaterThanOrEqual(44);
  await test.info().attach("week-clock-geometry", {
    body: JSON.stringify(geometry),
    contentType: "application/json",
  });
  await page.screenshot({
    path: test.info().outputPath("parent-week.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  const longEvent = page.getByRole("button", {
    name: /Parent-teacher conference/,
  });
  await longEvent.click();
  const detail = page.getByRole("dialog");
  await expect(detail).toContainText(
    "interdisciplinary science-and-art exhibition",
  );
  await expect(detail.locator("time")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(longEvent).toBeFocused();
  await page
    .getByRole("button", { name: "Connected calendar", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No events from this calendar" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page).toHaveURL(/date=2026-01-12/);
  await expect(
    page.getByText("Showing: Connected calendar", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show all sources" }).click();
  await page.goto("/dashboard/calendar?date=2026-01-05&view=agenda");
  await page.getByRole("button", { name: /Parent-teacher conference/ }).click();
  await page.getByRole("link", { name: "Edit event", exact: true }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    /Parent-teacher conference/,
  );
  await expect(
    page.getByRole("button", { name: "Delete event", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("parent-editor-form.png"),
    fullPage: true,
  });
});

test("phone defaults to agenda, explicit week wins, teen can open details but not edit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginViaUi(page, FIXTURE_EMAILS.familyA.teen);
  await expect(page).toHaveURL(/\/dashboard(?:\/|$)/);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/dashboard/calendar?date=2026-01-05");
  await expect(
    page.getByRole("button", { name: "Agenda", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Dentist \(Casey\)/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("dialog").getByRole("link", { name: "Edit event" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("link", { name: "Add event", exact: true }),
  ).toBeVisible();
  expect(
    requests.some((url) => url.includes("/api/calendar/connections")),
  ).toBe(false);
  await page.goto("/dashboard/calendar?date=2026-01-05&view=week");
  await expect(
    page.getByRole("button", { name: "Week", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("actual range requests use 23- and 25-hour viewer days at DST boundaries", async ({
  page,
}) => {
  await loginViaUi(page, FIXTURE_EMAILS.familyA.parent);
  await expect(page).toHaveURL(/\/dashboard(?:\/|$)/);
  for (const [date, hours] of [
    ["2026-03-08", 23],
    ["2026-11-01", 25],
  ] as const) {
    const request = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === "/api/events" &&
        new URL(request.url()).searchParams.has("start"),
    );
    await page.goto(`/dashboard/calendar?date=${date}&view=day`);
    const query = new URL((await request).url()).searchParams;
    expect(
      (Date.parse(query.get("end")!) - Date.parse(query.get("start")!)) /
        3600000,
    ).toBe(hours);
  }
});

test("failed real request is not empty and Retry recovers", async ({
  page,
}) => {
  await loginViaUi(page, FIXTURE_EMAILS.familyA.parent);
  await expect(page).toHaveURL(/\/dashboard(?:\/|$)/);
  await page.route("**/api/events?*", (route) => route.abort());
  await page.goto("/dashboard/calendar?date=2026-01-05&view=agenda");
  await expect(
    page.getByRole("heading", { name: "Calendar couldn’t load" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /No events/ })).toHaveCount(0);
  await page.unroute("**/api/events?*");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("button", { name: /Dentist \(Casey\)/ }),
  ).toBeVisible();
});

test("actual planning region has no axe AA violations in light and dark phone states", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginViaUi(page, FIXTURE_EMAILS.familyA.parent);
  await expect(page).toHaveURL(/\/dashboard(?:\/|$)/);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto("/dashboard/calendar?date=2026-01-05&view=agenda");
    await expect(
      page.getByRole("button", { name: /Dentist \(Casey\)/ }),
    ).toBeVisible();
    const result = await new AxeBuilder({ page })
      .include('[class*="planner_"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    const paint = await page
      .getByRole("button", { name: "Agenda", exact: true })
      .evaluate((button) => {
        const css = getComputedStyle(button);
        return {
          color: css.color,
          background: css.backgroundColor,
          minHeight: css.minHeight,
          dark: matchMedia("(prefers-color-scheme: dark)").matches,
        };
      });
    expect(paint.dark).toBe(colorScheme === "dark");
    expect(paint.minHeight).toBe("44px");
    expect(paint.background).not.toBe("rgba(0, 0, 0, 0)");
    await test.info().attach(`phone-${colorScheme}-paint-axe`, {
      body: JSON.stringify({ paint, violations: result.violations }),
      contentType: "application/json",
    });
    await page.screenshot({
      path: test.info().outputPath(`phone-${colorScheme}.png`),
      fullPage: true,
    });
    expect(result.violations).toEqual([]);
  }
});

// Opt-in writes target only the guarded disposable preview. Events are read back,
// exercised through actual HTTP, deleted in finally, and verified absent.
test("real edge fixtures: clock-change Agenda and bounded late-event geometry", async ({
  page,
  baseURL,
}) => {
  test.skip(
    process.env.CALENDAR_PLANNING_EDGE_FIXTURES !== "1",
    "Requires guarded disposable fixture preview",
  );
  expect(baseURL).toBe("http://127.0.0.1:3217");
  await loginViaUi(page, FIXTURE_EMAILS.familyA.parent);
  await expect(page).toHaveURL(/\/dashboard(?:\/|$)/, { timeout: 30000 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const rows = [
    ["Final grid one", "2026-01-07T04:00:00Z", "2026-01-07T04:20:00Z"],
    ["Final grid overlap", "2026-01-07T04:15:00Z", "2026-01-07T04:25:00Z"],
    ["Late half hour", "2026-01-07T04:30:00Z", "2026-01-07T04:45:00Z"],
    ["Late overlap", "2026-01-07T04:35:00Z", "2026-01-07T04:50:00Z"],
    ["Late zero minute", "2026-01-07T04:59:00Z", "2026-01-07T04:59:00Z"],
    ["Fall folded hour", "2026-11-01T05:30:00Z", "2026-11-01T06:15:00Z"],
    ["Spring skipped hour", "2026-03-08T06:30:00Z", "2026-03-08T07:15:00Z"],
  ];
  const ids: string[] = [];
  try {
    for (const [title, start_time, end_time] of rows) {
      const created = await browserSend(page, "POST", "/api/events", {
        title: `UI verification ${title}`,
        start_time,
        end_time,
        event_type: "other",
        recurrence: null,
        description:
          "Synthetic disposable calendar verification fixture; not current-day data.",
        location: null,
      });
      expect(created.status).toBe(200);
      const id = JSON.parse(created.body).event.id as string;
      ids.push(id);
      const stored = await browserFetch(
        page,
        `/api/events?id=${encodeURIComponent(id)}`,
      );
      expect(stored.status).toBe(200);
      expect(JSON.parse(stored.body).event.start_time).toBe(
        new Date(start_time).toISOString(),
      );
      expect(JSON.parse(stored.body).event.end_time).toBe(
        new Date(end_time).toISOString(),
      );
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/dashboard/calendar?date=2026-01-06&view=day");
    const late = page.getByRole("region", { name: "Late events", exact: true });
    await expect(late.getByRole("button")).toHaveCount(3);
    await expect(late).toContainText("Tuesday, January 6");
    await expect(late).toContainText("11:30 PM – 11:45 PM");
    await expect(late).toContainText("11:59 PM");
    const geometry = await page
      .locator('[class*="dayGrid_"]')
      .evaluateAll((grids) =>
        grids.map((grid) => ({
          height: grid.getBoundingClientRect().height,
          tracks: getComputedStyle(grid).gridTemplateRows.split(" ").length,
          slots: [...grid.children].map((slot) => ({
            fixture:
              slot.textContent?.includes("UI verification Final grid") ?? false,
            row: getComputedStyle(slot).gridRow,
            width: slot.querySelector("button")!.getBoundingClientRect().width,
            height: slot.querySelector("button")!.getBoundingClientRect()
              .height,
          })),
        })),
      );
    expect(geometry).toHaveLength(1);
    expect(geometry[0].height).toBe(1536);
    expect(geometry[0].tracks).toBe(48);
    expect(geometry[0].slots.filter((slot) => slot.fixture)).toHaveLength(2);
    for (const slot of geometry[0].slots) {
      expect(Number(slot.row.split("/")[1].trim())).toBeLessThanOrEqual(49);
      expect(slot.width).toBeGreaterThanOrEqual(44);
      expect(slot.height).toBeGreaterThanOrEqual(44);
    }
    const targets = await late.getByRole("button").evaluateAll((buttons) =>
      buttons.map((button) => ({
        width: button.getBoundingClientRect().width,
        height: button.getBoundingClientRect().height,
        insideGrid: !!button.closest('[class*="dayGrid_"]'),
      })),
    );
    for (const target of targets) {
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(56);
      expect(target.insideGrid).toBe(false);
    }
    await test.info().attach("late-geometry", {
      body: JSON.stringify({ geometry, targets }),
      contentType: "application/json",
    });
    await page.screenshot({
      path: test.info().outputPath("late-events-day.png"),
      fullPage: true,
    });
    await late.getByRole("button", { name: /Late zero minute/ }).click();
    await expect(page.getByRole("dialog").locator("time")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await page.locator('[class*="gridScroll_"]').evaluate((grid) => {
      grid.scrollTop = grid.scrollHeight;
    });
    await page.screenshot({
      path: test.info().outputPath("late-day-final-clock.png"),
      fullPage: true,
    });
    await page.goto("/dashboard/calendar?date=2026-01-06&view=week");
    await expect(
      page.getByRole("region", { name: "Late events" }).getByRole("button"),
    ).toHaveCount(3);
    const weekGeometry = await page
      .locator('[class*="dayGrid_"]')
      .evaluateAll((grids) =>
        grids.map((grid) => ({
          height: grid.getBoundingClientRect().height,
          tracks: getComputedStyle(grid).gridTemplateRows.split(" ").length,
        })),
      );
    expect(weekGeometry).toHaveLength(7);
    for (const grid of weekGeometry)
      expect(grid).toEqual({ height: 1536, tracks: 48 });
    const weekTargets = page.getByRole("button", {
      name: /UI verification Final grid/,
    });
    await expect(weekTargets).toHaveCount(2);
    for (const target of await weekTargets.all()) {
      const size = await target.boundingBox();
      expect(size!.width).toBeGreaterThanOrEqual(44);
      expect(size!.height).toBeGreaterThanOrEqual(44);
    }
    await page.locator('[class*="gridScroll_"]').evaluate((grid) => {
      grid.scrollTop = grid.scrollHeight;
    });
    await page.screenshot({
      path: test.info().outputPath("late-week-final-clock.png"),
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: "dark" });
    const lateDarkAxe = await new AxeBuilder({ page })
      .include('[class*="planner_"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(lateDarkAxe.violations).toEqual([]);
    await test.info().attach("late-week-geometry-dark-axe", {
      body: JSON.stringify({
        weekGeometry,
        violations: lateDarkAxe.violations,
      }),
      contentType: "application/json",
    });
    await page.screenshot({
      path: test.info().outputPath("late-week-dark.png"),
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: "light" });
    for (const [date, label, text] of [
      ["2026-11-01", "Fall folded hour", "1:30 AM EDT – 1:15 AM EST"],
      ["2026-03-08", "Spring skipped hour", "1:30 AM EST – 3:15 AM EDT"],
    ]) {
      for (const view of ["day", "week"]) {
        await page.goto(`/dashboard/calendar?date=${date}&view=${view}`);
        const event = page.getByRole("button", { name: new RegExp(label) });
        await expect(event).toBeVisible();
        await expect(event).toContainText(text);
        await expect(
          page.getByText(/Clock change in this range/),
        ).toBeVisible();
        await expect(page.locator('[class*="dayGrid_"]')).toHaveCount(0);
        await expect(
          page.getByRole("button", {
            name: view === "day" ? "Day" : "Week",
            exact: true,
          }),
        ).toHaveAttribute("aria-pressed", "true");
        await page.screenshot({
          path: test.info().outputPath(`clock-${date}-${view}.png`),
          fullPage: true,
        });
      }
    }
    expect(errors).toEqual([]);
  } finally {
    for (const id of ids) {
      const deleted = await browserSend(page, "DELETE", "/api/events", {
        eventId: id,
      });
      expect(deleted.status).toBe(200);
      expect(
        (await browserFetch(page, `/api/events?id=${encodeURIComponent(id)}`))
          .status,
      ).toBe(404);
    }
    await test.info().attach("fixture-cleanup", {
      body: JSON.stringify({
        created: ids.length,
        deletedAndReadBack404: ids.length,
      }),
      contentType: "application/json",
    });
  }
});

for (const [zone, unsupported, valid, direction] of [
  ["Etc/GMT-14", "0001-01-01", "0001-01-02", "Previous"],
  ["Etc/GMT+12", "9999-12-31", "9999-12-30", "Next"],
] as const) {
  test.describe(`browser complete UTC bounds ${zone}`, () => {
    test.use({ timezoneId: zone });
    test("unsupported range does not fetch, valid edge disables navigation, Today recovers", async ({
      page,
    }) => {
      await loginViaUi(page, FIXTURE_EMAILS.familyA.parent);
      await expect(page).toHaveURL(/\/dashboard(?:\/|$)/, { timeout: 30000 });
      const requests: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.pathname === "/api/events" && url.searchParams.has("start"))
          requests.push(url.href);
      });
      await page.goto(`/dashboard/calendar?date=${unsupported}&view=day`);
      await expect(
        page.getByRole("heading", { name: "Unsupported calendar date" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: direction, exact: true }),
      ).toBeDisabled();
      await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(
        0,
      );
      expect(requests).toHaveLength(0);
      await page.screenshot({
        path: test.info().outputPath("unsupported-bound.png"),
        fullPage: true,
      });
      await page.goto(`/dashboard/calendar?date=${valid}&view=day`);
      await expect(
        page.getByRole("heading", { name: "No events in this range" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: direction, exact: true }),
      ).toBeDisabled();
      expect(requests).toHaveLength(1);
      if (direction === "Next") {
        await expect(
          page.getByRole("button", { name: "Week", exact: true }),
        ).toBeDisabled();
        await expect(
          page.getByRole("button", { name: "Agenda", exact: true }),
        ).toBeDisabled();
      }
      await page.getByRole("button", { name: "Today", exact: true }).click();
      await expect(
        page.getByRole("button", { name: /Dentist \(Casey\)/ }),
      ).toBeVisible();
      expect(requests).toHaveLength(2);
      await test.info().attach("actual-boundary-requests", {
        body: JSON.stringify({ zone, unsupported, valid, requests }),
        contentType: "application/json",
      });
    });
  });
}
