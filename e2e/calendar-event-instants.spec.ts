import AxeBuilder from "@axe-core/playwright";
import { test, expect, browserFetch, browserSend } from "./support/test";
import { authFile } from "./support/env";
import { FIXTURE_EMAILS, FIXTURE_ID_PREFIX } from "../src/lib/fixtures/dataset";
import type { Page, TestInfo } from "@playwright/test";

test.use({ storageState: authFile("parentA"), timezoneId: "America/Toronto" });
test.beforeEach(async ({ context, baseURL, page }, info) => {
  test.skip(
    ![
      "phone-390x844",
      "tablet-portrait-800x1280",
      "fridge-landscape-1280x800",
    ].includes(info.project.name),
    "Representative calendar form projects",
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
  const auth = await browserFetch(page, "/api/auth/me");
  expect(auth.status).toBe(200);
  const user = JSON.parse(auth.body).user;
  expect(user.email).toBe(FIXTURE_EMAILS.familyA.parent);
  expect(user.family_id).toMatch(new RegExp(`^${FIXTURE_ID_PREFIX}`));
});

async function checkForm(page: Page, info: TestInfo, name: string) {
  const save = page.getByRole("button", {
    name: /^(Save Changes|Create Event)$/,
  });
  await save.scrollIntoViewIfNeeded();
  const box = await save.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(
    await save.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(
        document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2),
      );
    }),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const results = await new AxeBuilder({ page }).include("main").analyze();
  const violations = results.violations.filter(
    (x) => x.impact === "serious" || x.impact === "critical",
  );
  await info.attach(`${name}-axe`, {
    body: JSON.stringify(violations),
    contentType: "application/json",
  });
  expect(violations).toEqual([]);
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
  });
}

for (const locale of ["en", "es"] as const) {
  test(`${locale} exact event instants survive metadata edits in the persisted app language`, async ({
    page,
  }, info) => {
    const ids: string[] = [];
    const rows = [
      ["first-fold", "2026-11-01T05:30:45.123Z", "2026-11-01T05:45:55.456Z"],
      ["second-fold", "2026-11-01T06:30:45.123Z", "2026-11-01T06:45:55.456Z"],
      ["cross-fold", "2026-11-01T05:30:45.123Z", "2026-11-01T06:15:55.456Z"],
      ["ordinary", "2026-10-06T19:00:45.123Z", "2026-10-06T20:00:55.456Z"],
      ["year-boundary", "2027-01-01T04:30:45.123Z", "2027-01-01T05:30:55.456Z"],
    ];
    try {
      for (const [name, start_time, end_time] of rows) {
        const created = await browserSend(page, "POST", "/api/events", {
          title: `Synthetic timezone ${name}`,
          start_time,
          end_time,
          event_type: "other",
        });
        expect(created.status).toBe(200);
        const id = JSON.parse(created.body).event.id as string;
        ids.push(id);
        await page.evaluate(
          (language) =>
            localStorage.setItem("familyPlanner_language", language),
          locale,
        );
        const response = await page.goto(
          `/dashboard/calendar/edit?id=${encodeURIComponent(id)}`,
        );
        expect(response!.status()).toBe(200);
        await expect(page.getByLabel("Title")).toHaveValue(
          `Synthetic timezone ${name}`,
        );
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        const title = `Synthetic revised ${name} — household text {unchanged} 🗓️`;
        await page.getByLabel("Title").fill(title);
        await page.getByLabel("Location").fill("Synthetic fixture location");
        await page
          .getByLabel("Description")
          .fill("Synthetic fixture description");
        await checkForm(page, info, `${locale}-${name}-edited`);
        const patch = page.waitForRequest(
          (request) =>
            new URL(request.url()).pathname === "/api/events" &&
            request.method() === "PATCH",
        );
        const result = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/events" &&
            response.request().method() === "PATCH",
        );
        await page.getByRole("button", { name: "Save Changes" }).click();
        expect((await patch).postDataJSON()).toMatchObject({
          eventId: id,
          title,
          start_time,
          end_time,
        });
        expect((await result).status()).toBe(200);
        await expect(page).toHaveURL(/\/dashboard\/calendar(?:\?|$)/);
        const stored = await browserFetch(
          page,
          `/api/events?id=${encodeURIComponent(id)}`,
        );
        expect(stored.status).toBe(200);
        expect(JSON.parse(stored.body).event).toMatchObject({
          title,
          start_time,
          end_time,
          location: "Synthetic fixture location",
          description: "Synthetic fixture description",
        });
      }
    } finally {
      for (const eventId of ids) {
        expect(
          (await browserSend(page, "DELETE", "/api/events", { eventId }))
            .status,
        ).toBe(200);
        expect(
          (
            await browserFetch(
              page,
              `/api/events?id=${encodeURIComponent(eventId)}`,
            )
          ).status,
        ).toBe(404);
      }
      await info.attach("isolated-fixture-cleanup", {
        body: JSON.stringify({
          created: ids.length,
          deletedAndReadBack404: ids.length,
        }),
        contentType: "application/json",
      });
    }
  });
  test(`${locale} nonexistent Toronto local minute is announced without creating an event`, async ({
    page,
  }, info) => {
    await page.evaluate(
      (language) => localStorage.setItem("familyPlanner_language", language),
      locale,
    );
    const response = await page.goto("/dashboard/calendar/create");
    expect(response!.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const posts: string[] = [];
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === "/api/events" &&
        request.method() === "POST"
      )
        posts.push(request.url());
    });
    await page.getByLabel("Title").fill("Synthetic nonexistent-time fixture");
    await page.locator("#startDate").fill("2026-03-08");
    await page.locator("#startTime").fill("02:30");
    await page.getByRole("button", { name: "Create Event" }).click();
    await expect(page.getByRole("alert")).toHaveText("Invalid date/time");
    expect(posts).toEqual([]);
    await expect(page.locator("#startTime")).toHaveValue("02:30");
    await checkForm(page, info, `${locale}-nonexistent-time-error`);
  });
  test(`${locale} late previous-record response cannot replace the current editor`, async ({
    page,
  }, info) => {
    const ids: string[] = [];
    let release = () => {};
    let held = false;
    let ready!: () => void;
    const readyPromise = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      for (const title of [
        "Synthetic previous record",
        "Synthetic current record",
      ]) {
        const created = await browserSend(page, "POST", "/api/events", {
          title,
          start_time: "2026-11-01T06:30:45.123Z",
          end_time: "2026-11-01T06:45:55.456Z",
          event_type: "other",
        });
        expect(created.status).toBe(200);
        ids.push(JSON.parse(created.body).event.id);
      }
      await page.route("**/api/events?*", async (route) => {
        if (
          new URL(route.request().url()).searchParams.get("id") === ids[0] &&
          !held
        ) {
          held = true;
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          ready();
          await released;
          return route.fulfill({ response });
        }
        return route.continue();
      });
      await page.evaluate(
        (language) => localStorage.setItem("familyPlanner_language", language),
        locale,
      );
      const initial = await page.goto(
        `/dashboard/calendar/edit?id=${encodeURIComponent(ids[0])}`,
      );
      expect(initial!.status()).toBe(200);
      await readyPromise;
      await expect(page.getByText("Loading...", { exact: true })).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`${locale}-previous-record-loading.png`),
        fullPage: true,
      });
      // Native history changes the query on this mounted App Router page.
      await page.evaluate(
        (path) => window.history.pushState(null, "", path),
        `/dashboard/calendar/edit?id=${encodeURIComponent(ids[1])}`,
      );
      await expect(page.getByLabel("Title")).toHaveValue(
        "Synthetic current record",
      );
      release();
      await expect
        .poll(async () =>
          page.evaluate(
            () =>
              performance
                .getEntriesByType("resource")
                .filter((entry) => entry.name.includes("/api/events?id="))
                .length,
          ),
        )
        .toBeGreaterThanOrEqual(2);
      await expect(page.getByLabel("Title")).toHaveValue(
        "Synthetic current record",
      );
      await page.getByLabel("Title").fill("Synthetic current record revised");
      await checkForm(
        page,
        info,
        `${locale}-current-record-after-late-response`,
      );
      const patch = page.waitForRequest(
        (request) =>
          new URL(request.url()).pathname === "/api/events" &&
          request.method() === "PATCH",
      );
      const response = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/events" &&
          response.request().method() === "PATCH",
      );
      await page.getByRole("button", { name: "Save Changes" }).click();
      expect((await patch).postDataJSON()).toMatchObject({
        eventId: ids[1],
        title: "Synthetic current record revised",
        start_time: "2026-11-01T06:30:45.123Z",
        end_time: "2026-11-01T06:45:55.456Z",
      });
      expect((await response).status()).toBe(200);
      await page.unroute("**/api/events?*");
      const previous = await browserFetch(
        page,
        `/api/events?id=${encodeURIComponent(ids[0])}`,
      );
      expect(previous.status).toBe(200);
      expect(JSON.parse(previous.body).event.title).toBe(
        "Synthetic previous record",
      );
      const current = await browserFetch(
        page,
        `/api/events?id=${encodeURIComponent(ids[1])}`,
      );
      expect(JSON.parse(current.body).event).toMatchObject({
        title: "Synthetic current record revised",
        start_time: "2026-11-01T06:30:45.123Z",
        end_time: "2026-11-01T06:45:55.456Z",
      });
    } finally {
      release();
      await page.unroute("**/api/events?*");
      for (const eventId of ids) {
        expect(
          (await browserSend(page, "DELETE", "/api/events", { eventId }))
            .status,
        ).toBe(200);
        expect(
          (
            await browserFetch(
              page,
              `/api/events?id=${encodeURIComponent(eventId)}`,
            )
          ).status,
        ).toBe(404);
      }
      await info.attach("navigation-fixture-cleanup", {
        body: JSON.stringify({
          created: ids.length,
          deletedAndReadBack404: ids.length,
        }),
        contentType: "application/json",
      });
    }
  });
}
