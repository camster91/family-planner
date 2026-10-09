/** #424: existing planner and review-first import, isolated data and explicit provider UI fixture mode. */
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo, Locator } from "@playwright/test";
import { test, expect, browserFetch, browserSend } from "./support/test";
import { authFile } from "./support/env";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import {
  calendarPlannerMessages,
  type CalendarPlannerMessage,
} from "../src/i18n/calendar-planner";
import {
  calendarImportMessages,
  type CalendarImportMessage,
} from "../src/i18n/calendar-import";
import {
  calendarPageMessages,
  type CalendarPageMessage,
} from "../src/i18n/calendar-page";
import {
  isPseudolocaleEnabled,
  pseudolocalizeTemplate,
} from "../src/i18n/pseudo";
const expanded = isPseudolocaleEnabled(process.env);
const importFixture = process.env.E2E_IMPORT_UI_FIXTURE === "1";
const projects = [
  "phone-390x844",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
];
const privateTitle = "Synthetic {title} — 李 🗓️";
const privateSource = "Synthetic {source} — 李 🗓️";
function text(template: string, params: Record<string, string | number> = {}) {
  return (expanded ? pseudolocalizeTemplate(template) : template).replace(
    /\{(\w+)\}/g,
    (_, key) => String(params[key] ?? `{${key}}`),
  );
}
async function capture(
  page: Page,
  info: TestInfo,
  name: string,
  targets: Locator[] = [],
) {
  for (const target of targets) {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
    if (await target.isEnabled()) {
      await target.focus();
      await expect(target).toBeFocused();
    }
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const violations = (
    await new AxeBuilder({ page }).include("main").analyze()
  ).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  await info.attach(name + "-axe", {
    body: JSON.stringify(violations),
    contentType: "application/json",
  });
  expect(violations).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  const dialog = page.getByRole("dialog");
  if (await dialog.count())
    await dialog.evaluate((el) => {
      el.scrollTop = 0;
    });
  await page.screenshot({
    path: info.outputPath(name + ".png"),
    fullPage: (await dialog.count()) === 0,
  });
}
test.use({ storageState: authFile("parentA"), timezoneId: "America/Toronto" });
test.beforeEach(async ({ page, context, baseURL }, info) => {
  test.skip(
    !projects.includes(info.project.name),
    "Representative existing planner/import viewports",
  );
  assertFixtureTargetAllowed(process.env);
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
    new URL(baseURL!).hostname,
  );
  await context.route("**/*", (route) => {
    const u = new URL(route.request().url());
    return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ||
      ["data:", "blob:"].includes(u.protocol)
      ? route.continue()
      : route.abort();
  });
  await page.goto("/dashboard");
  const auth = await browserFetch(page, "/api/auth/me");
  expect(auth.status).toBe(200);
  expect(JSON.parse(auth.body).user.role).toBe("parent");
  const version = await browserFetch(page, "/api/version");
  expect(version.status).toBe(200);
  await info.attach("actual-runtime-and-mode", {
    body: JSON.stringify({
      runtime: JSON.parse(version.body),
      expanded,
      importFixture,
    }),
    contentType: "application/json",
  });
});
for (const locale of ["en", "es"] as const) {
  const p = (
    key: CalendarPlannerMessage,
    params?: Record<string, string | number>,
  ) => text(calendarPlannerMessages[locale][key], params);
  const i = (
    key: CalendarImportMessage,
    params?: Record<string, string | number>,
  ) => text(calendarImportMessages[locale][key], params);
  const c = (
    key: CalendarPageMessage,
    params?: Record<string, string | number>,
  ) => text(calendarPageMessages[locale][key], params);
  async function visit(
    page: Page,
    path = "/dashboard/calendar?date=2026-01-05&view=agenda",
  ) {
    await page.evaluate(
      (language) => localStorage.setItem("familyPlanner_language", language),
      locale,
    );
    const response = await page.goto(path);
    expect(response!.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    if (expanded)
      await expect(page.locator("html")).toHaveAttribute(
        "data-pseudolocalized",
        "true",
      );
  }
  test(`${locale}: real planner, source filter, private detail and parent edit`, async ({
    page,
  }, info) => {
    await visit(page);
    const dentist = page.getByRole("button", { name: /Dentist \(Casey\)/ });
    await expect(dentist).toBeVisible();
    await capture(page, info, `${locale}-planner-agenda`, [
      page.getByRole("button", { name: p("day"), exact: true }),
      page.getByRole("button", { name: p("next"), exact: true }),
    ]);
    await dentist.click();
    const detail = page.getByRole("dialog");
    await expect(detail.locator("time")).toHaveCount(2);
    await expect(
      page.getByRole("link", { name: p("edit"), exact: true }),
    ).toBeVisible();
    await capture(page, info, `${locale}-planner-detail`, [
      page.getByRole("button", { name: p("close"), exact: true }),
    ]);
    await page.keyboard.press("Escape");
    await expect(dentist).toBeFocused();
    await page
      .getByRole("combobox", { name: p("source"), exact: true })
      .selectOption("connected");
    await expect(
      page.getByRole("heading", { name: p("emptySource") }),
    ).toBeVisible();
    await capture(page, info, `${locale}-planner-source-empty`, [
      page.getByRole("button", { name: p("showAll"), exact: true }),
    ]);
  });
  test(`${locale}: loading, error retry and truthful partial range`, async ({
    page,
  }, info) => {
    let mode: "loading" | "error" | "partial" = "loading",
      requests = 0;
    let release!: () => void;
    const pending = new Promise<void>((done) => {
      release = done;
    });
    await page.route("**/api/events?*", async (route) => {
      requests++;
      if (mode === "loading") await pending;
      if (mode === "error")
        return route.fulfill({
          status: 503,
          json: { error: "Synthetic range failure" },
        });
      return route.fulfill({
        json: {
          events: [],
          hasMore: true,
          nextCursor: `synthetic-page-${requests}`,
        },
      });
    });
    await visit(page);
    await expect(
      page.getByRole("heading", { name: p("loadingWeek") }),
    ).toBeVisible();
    await capture(page, info, `${locale}-planner-loading`);
    mode = "error";
    release();
    await expect(
      page.getByRole("heading", { name: p("loadFailed") }),
    ).toBeVisible();
    await capture(page, info, `${locale}-planner-error`, [
      page.getByRole("button", { name: p("tryAgain"), exact: true }),
    ]);
    mode = "partial";
    await page
      .getByRole("button", { name: p("tryAgain"), exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: p("partial") }),
    ).toBeVisible();
    expect(requests).toBe(11);
    await expect(
      page.getByText(p("partialHelp"), { exact: true }),
    ).toBeVisible();
    await capture(page, info, `${locale}-planner-partial`, [
      page.getByRole("button", { name: p("showDay"), exact: true }),
    ]);
  });
  test(`${locale}: DST fallback and imported read-only private text`, async ({
    page,
  }, info) => {
    await page.route("**/api/events?*", (route) =>
      route.fulfill({
        json: {
          events: [
            {
              id: "synthetic-private",
              title: privateTitle,
              description: "Synthetic {description}",
              location: "Synthetic room",
              start_time: "2026-11-01T06:30:45.123Z",
              end_time: "2026-11-01T06:45:55.456Z",
              event_type: "other",
              source: { name: privateSource, color: null },
              source_subscription_id: "synthetic-source",
            },
          ],
          hasMore: false,
          nextCursor: null,
        },
      }),
    );
    await visit(page, "/dashboard/calendar?date=2026-11-01&view=week");
    const card = page.getByRole("button", {
      name: new RegExp("Synthetic \\{title\\}"),
    });
    await expect(card).toBeVisible();
    await expect(
      page.getByText(p("clockChange"), { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel(p("timed"))).toHaveCount(0);
    await capture(page, info, `${locale}-planner-dst-agenda`);
    await card.click();
    const detail = page.getByRole("dialog");
    await expect(detail).toContainText(privateTitle);
    await expect(detail).toContainText(privateSource);
    await expect(
      detail.locator('time[datetime="2026-11-01T06:30:45.123Z"]'),
    ).toBeVisible();
    await expect(
      detail.getByText(p("readOnly"), { exact: true }),
    ).toBeVisible();
    await expect(
      detail.getByRole("link", { name: p("edit"), exact: true }),
    ).toHaveCount(0);
    await capture(page, info, `${locale}-planner-readonly-detail`, [
      page.getByRole("button", { name: p("close"), exact: true }),
    ]);
  });
  test(`${locale}: import gate, fixture review, lost response replay and real undo`, async ({
    page,
  }, info) => {
    await visit(page);
    const opener = page.getByRole("button", { name: c("import"), exact: true });
    if (!importFixture) {
      await expect(opener).toHaveCount(0);
      return;
    }
    const created = new Set<string>(),
      commits: string[] = [],
      keys: string[] = [];
    const suggestions = [
      {
        title: privateTitle,
        start: "2026-10-09T15:30:00-04:00",
        end: "2026-10-09T17:00:00-04:00",
        allDay: false,
        location: "Synthetic room",
        notes: "Synthetic {notes}",
        confidence: 0.9,
      },
    ];
    let release!: () => void;
    const reading = new Promise<void>((done) => {
      release = done;
    });
    await page.route("**/api/calendar/import-suggestions", async (route) => {
      await reading;
      await route.fulfill({
        json: { suggestions, timeZone: "America/Toronto" },
      });
    });
    await page.route(
      "**/api/calendar/import-suggestions/commit",
      async (route) => {
        commits.push(route.request().postData()!);
        keys.push(route.request().headers()["idempotency-key"]);
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        const body = await response.json();
        body.eventIds.forEach((id: string) => created.add(id));
        if (commits.length === 1) return route.abort("failed");
        expect(response.headers()["idempotency-replayed"]).toBe("true");
        await route.fulfill({ response });
      },
    );
    try {
      await opener.click();
      await expect(
        page.getByRole("dialog", { name: i("title"), exact: true }),
      ).toBeVisible();
      await page
        .getByLabel(i("textLabel"), { exact: true })
        .fill("Synthetic private school flyer");
      await capture(page, info, `${locale}-import-input`, [
        page.getByRole("button", { name: i("find"), exact: true }),
        page.getByRole("button", { name: i("close"), exact: true }),
      ]);
      await page.getByRole("button", { name: i("find"), exact: true }).click();
      await expect(page.getByText(i("reading"), { exact: true })).toBeVisible();
      await capture(page, info, `${locale}-import-reading`);
      release();
      await expect(
        page.getByLabel(i("eventTitle"), { exact: true }),
      ).toHaveValue(privateTitle);
      await expect(page.getByLabel(i("starts"), { exact: true })).toHaveValue(
        "15:30",
      );
      await capture(page, info, `${locale}-import-review`, [
        page.getByTestId("import-add"),
      ]);
      await page.getByLabel(i("eventTitle"), { exact: true }).fill("");
      await page.getByTestId("import-add").click();
      await expect(page.getByTestId("import-card-error")).toHaveText(
        i("enterTitle"),
      );
      await capture(page, info, `${locale}-import-validation`, [
        page.getByTestId("import-add"),
      ]);
      await page
        .getByLabel(i("eventTitle"), { exact: true })
        .fill(privateTitle);
      await page.getByTestId("import-add").click();
      await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
        i("addConnection"),
      );
      await capture(page, info, `${locale}-import-retry`, [
        page.getByTestId("import-add"),
      ]);
      await page.getByTestId("import-add").click();
      await expect(page.getByTestId("import-toast")).toContainText(
        c("addedOne", { count: 1 }),
      );
      expect(commits).toHaveLength(2);
      expect(commits[0]).toBe(commits[1]);
      expect(keys[0]).toBeTruthy();
      expect(keys[0]).toBe(keys[1]);
      expect(created.size).toBe(1);
      await capture(page, info, `${locale}-import-added`, [
        page.getByRole("button", { name: c("undo"), exact: true }),
      ]);
      await page.getByRole("button", { name: c("undo"), exact: true }).click();
      await expect(page.getByTestId("import-toast")).toContainText(
        c("removedOne", { count: 1 }),
      );
      await capture(page, info, `${locale}-import-undone`, [
        page.getByRole("button", { name: c("dismiss"), exact: true }),
      ]);
      for (const id of created) {
        const r = await browserFetch(
          page,
          `/api/events?id=${encodeURIComponent(id)}`,
        );
        expect(r.status).toBe(404);
      }
    } finally {
      for (const id of created) {
        const r = await browserFetch(
          page,
          `/api/events?id=${encodeURIComponent(id)}`,
        );
        if (r.status !== 404) {
          expect(
            (await browserSend(page, "DELETE", "/api/events", { eventId: id }))
              .status,
          ).toBe(200);
          expect(
            (
              await browserFetch(
                page,
                `/api/events?id=${encodeURIComponent(id)}`,
              )
            ).status,
          ).toBe(404);
        }
      }
    }
  });
  test(`${locale}: continuing events and late targets keep actual times`, async ({
    page,
  }, info) => {
    const rows = [
      {
        id: "synthetic-continuing",
        title: "Synthetic continuing {title}",
        start_time: "2026-01-04T10:00:00Z",
        end_time: "2026-01-07T10:00:00Z",
        event_type: "other",
        source: null,
      },
      {
        id: "synthetic-late",
        title: "Synthetic late {title}",
        start_time: "2026-01-06T04:30:00Z",
        end_time: "2026-01-06T04:45:00Z",
        event_type: "other",
        source: null,
      },
    ];
    await page.route("**/api/events?*", (route) =>
      route.fulfill({
        json: { events: rows, hasMore: false, nextCursor: null },
      }),
    );
    await visit(page, "/dashboard/calendar?date=2026-01-05&view=day");
    const late = page.getByRole("button", { name: /Synthetic late \{title\}/ });
    await expect(late).toBeVisible();
    await expect(
      page.getByRole("heading", { name: p("late"), exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(p("continuing"), { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByLabel(p("timed"))
        .getByRole("button", { name: /Synthetic late/ }),
    ).toHaveCount(0);
    await capture(page, info, `${locale}-planner-continuing-late`, [late]);
    await late.click();
    const detail = page.getByRole("dialog");
    await expect(
      detail.locator('time[datetime="2026-01-06T04:30:00Z"]'),
    ).toBeVisible();
    await expect(
      detail.locator('time[datetime="2026-01-06T04:45:00Z"]'),
    ).toBeVisible();
    await capture(page, info, `${locale}-planner-late-detail`, [
      page.getByRole("button", { name: p("close"), exact: true }),
    ]);
  });
}
