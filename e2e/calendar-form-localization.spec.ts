/** #421: real fixture data, ordinary or explicitly flagged expanded-copy QA. */
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";
import type { Page, TestInfo, Locator } from "@playwright/test";
import { test, expect, browserFetch, browserSend } from "./support/test";
import { authFile } from "./support/env";
import { FIXTURE_EMAILS, FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import {
  calendarFormMessages,
  type CalendarFormMessage,
} from "../src/i18n/calendar-forms";
import {
  isPseudolocaleEnabled,
  pseudolocalizeTemplate,
} from "../src/i18n/pseudo";
const expanded = isPseudolocaleEnabled(process.env);
const projects = [
  "phone-390x844",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
];
const A = FIXTURE_IDS.familyA;
const privateTitle = "Synthetic household {title} — 李 🗓️";
const sourceName = "Synthetic source {source} — 李 🗓️";
function ids(info: { project: { name: string } }) {
  const prefix =
    "fx_e2e_calendar_locale_" + info.project.name.replaceAll("-", "_");
  return { event: prefix + "_event", subscription: prefix + "_subscription" };
}
async function dbUse<T>(fn: (db: pg.Client) => Promise<T>): Promise<T> {
  assertFixtureTargetAllowed(process.env);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}
test.use({ storageState: authFile("parentA"), timezoneId: "America/Toronto" });
test.beforeAll(async ({}, info) => {
  if (!projects.includes(info.project.name)) return;
  const own = ids(info);
  await dbUse(async (db) => {
    const user = await db.query(
      'SELECT family_id,email FROM "User" WHERE id=$1',
      [A.parent],
    );
    expect(user.rows).toEqual([
      { family_id: A.family, email: FIXTURE_EMAILS.familyA.parent },
    ]);
    await db.query(
      'INSERT INTO "CalendarSubscription" (id,family_id,name,url_enc,created_by,updated_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [
        own.subscription,
        A.family,
        sourceName,
        "v1:CALENDAR-LOCALE-FIXTURE-NOT-A-REAL-URL",
        A.parent,
        new Date("2026-01-05T12:00:00Z").toISOString(),
      ],
    );
    await db.query(
      'INSERT INTO "Event" (id,family_id,title,start_time,end_time,created_by,source_subscription_id,source_uid,source_occurrence_start,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$4,$9)',
      // Prisma DateTime columns store UTC without a zone: pass ISO strings,
      // not node-postgres Date objects serialized in the runner timezone.
      [
        own.event,
        A.family,
        privateTitle,
        new Date("2026-11-01T06:30:45.123Z").toISOString(),
        new Date("2026-11-01T06:45:55.456Z").toISOString(),
        A.parent,
        own.subscription,
        "synthetic-locale-import",
        new Date("2026-01-05T12:00:00Z").toISOString(),
      ],
    );
  });
});
test.afterAll(async ({}, info) => {
  if (!projects.includes(info.project.name)) return;
  const own = ids(info);
  await dbUse(async (db) => {
    await db.query('DELETE FROM "Event" WHERE id=$1 AND family_id=$2', [
      own.event,
      A.family,
    ]);
    await db.query(
      'DELETE FROM "CalendarSubscription" WHERE id=$1 AND family_id=$2',
      [own.subscription, A.family],
    );
    expect(
      (await db.query('SELECT id FROM "Event" WHERE id=$1', [own.event])).rows,
    ).toEqual([]);
    expect(
      (
        await db.query('SELECT id FROM "CalendarSubscription" WHERE id=$1', [
          own.subscription,
        ])
      ).rows,
    ).toEqual([]);
  });
});
test.beforeEach(async ({ page, context, baseURL }, info) => {
  test.skip(
    !projects.includes(info.project.name),
    "Representative existing calendar form projects",
  );
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
  expect(JSON.parse(auth.body).user).toMatchObject({
    id: A.parent,
    family_id: A.family,
    email: FIXTURE_EMAILS.familyA.parent,
  });
});
async function capture(
  page: Page,
  info: TestInfo,
  name: string,
  actions: Locator[],
) {
  for (const target of actions) {
    await target.evaluate((el) =>
      el.scrollIntoView({ block: "center", inline: "nearest" }),
    );
    const box = await target.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    if (await target.isEnabled()) {
      await target.focus();
      await expect(target).toBeFocused();
      expect(
        await target.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return el.contains(
            document.elementFromPoint(
              r.left + r.width / 2,
              r.top + r.height / 2,
            ),
          );
        }),
      ).toBe(true);
    } else {
      // Empty create intentionally disables pointer events; it must explain why.
      await expect(target).toBeDisabled();
      await expect(target).toHaveAttribute(
        "aria-describedby",
        "create-event-hint",
      );
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
  await page.screenshot({
    path: info.outputPath(name + ".png"),
    // Modal overlays belong to the viewport; full-page stitching adds off-screen background.
    fullPage: (await page.getByRole("dialog").count()) === 0,
  });
}
for (const locale of ["en", "es"] as const) {
  const text = (key: CalendarFormMessage) =>
    expanded
      ? pseudolocalizeTemplate(calendarFormMessages[locale][key])
      : calendarFormMessages[locale][key];
  async function visit(page: Page, path: string) {
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
    else
      await expect(page.locator("html")).not.toHaveAttribute(
        "data-pseudolocalized",
        "true",
      );
  }
  test(`${locale} expanded=${expanded} create hints and gap rejection recover to exact canonical save`, async ({
    page,
  }, info) => {
    let eventId: string | null = null;
    try {
      await visit(page, "/dashboard/calendar/create");
      await expect(
        page.getByRole("heading", { name: text("newEvent"), exact: true }),
      ).toBeVisible();
      const create = page.getByRole("button", {
        name: text("create"),
        exact: true,
      });
      await expect(create).toBeDisabled();
      await expect(
        page.getByText(text("requiredBoth"), { exact: true }),
      ).toBeVisible();
      await capture(
        page,
        info,
        `${locale}-${expanded ? "expanded" : "ordinary"}-create-empty`,
        [create],
      );
      await page.getByLabel(text("title"), { exact: true }).fill(privateTitle);
      await expect(
        page.getByText(text("requiredStart"), { exact: true }),
      ).toBeVisible();
      await page.locator("#startDate").fill("2026-03-08");
      await page.locator("#startTime").fill("02:30");
      let posts = 0;
      page.on("request", (r) => {
        if (
          new URL(r.url()).pathname === "/api/events" &&
          r.method() === "POST"
        )
          posts++;
      });
      await create.click();
      await expect(page.locator("main").getByRole("alert")).toHaveText(
        text("invalidTime"),
      );
      expect(posts).toBe(0);
      await expect(page.getByLabel(text("title"), { exact: true })).toHaveValue(
        privateTitle,
      );
      await expect(page.locator("#startTime")).toHaveValue("02:30");
      await capture(
        page,
        info,
        `${locale}-${expanded ? "expanded" : "ordinary"}-create-gap-error`,
        [create],
      );
      await page.locator("#startTime").fill("03:30");
      const result = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === "/api/events" &&
          r.request().method() === "POST",
      );
      await create.click();
      const created = await result;
      expect(created.status()).toBe(200);
      eventId = (await created.json()).event.id;
      expect(posts).toBe(1);
      await expect(page).toHaveURL(/\/dashboard\/calendar(?:\?|$)/);
      const saved = await browserFetch(
        page,
        `/api/events?id=${encodeURIComponent(eventId!)}`,
      );
      expect(saved.status).toBe(200);
      expect(JSON.parse(saved.body).event).toMatchObject({
        title: privateTitle,
        start_time: "2026-03-08T07:30:00.000Z",
        end_time: "2026-03-08T07:30:00.000Z",
      });
    } finally {
      if (eventId) {
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
    }
  });
  test(`${locale} expanded=${expanded} edit and delete confirmation preserve private text and exact timestamps`, async ({
    page,
  }, info) => {
    let eventId: string | null = null;
    const start = "2026-11-01T06:30:45.123Z",
      end = "2026-11-01T06:45:55.456Z";
    try {
      const created = await browserSend(page, "POST", "/api/events", {
        title: privateTitle,
        start_time: start,
        end_time: end,
        description: "Synthetic {description} 李",
        location: "Synthetic {location} 李",
      });
      expect(created.status).toBe(200);
      eventId = JSON.parse(created.body).event.id;
      await visit(
        page,
        `/dashboard/calendar/edit?id=${encodeURIComponent(eventId!)}`,
      );
      const title = page.getByLabel(text("title"), { exact: true }),
        save = page.getByRole("button", { name: text("save"), exact: true }),
        remove = page.getByRole("button", {
          name: text("deleteEvent"),
          exact: true,
        });
      await expect(title).toHaveValue(privateTitle);
      await expect(page.locator("#startTime")).toHaveValue("01:30");
      await expect(page.locator("#endTime")).toHaveValue("01:45");
      await remove.click();
      const dialog = page.getByRole("dialog", {
        name: text("deleteTitle"),
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(
        text("deleteDescription").replace("{title}", privateTitle),
      );
      const cancel = dialog.getByRole("button", {
        name: text("cancel"),
        exact: true,
      });
      await expect(cancel).toBeFocused();
      await capture(
        page,
        info,
        `${locale}-${expanded ? "expanded" : "ordinary"}-delete-confirm`,
        [
          cancel,
          dialog.getByRole("button", { name: text("delete"), exact: true }),
          dialog.getByRole("button", { name: text("close"), exact: true }),
        ],
      );
      await cancel.click();
      await expect(dialog).not.toBeVisible();
      await expect(remove).toBeFocused();
      await expect(title).toHaveValue(privateTitle);
      await title.fill(privateTitle + " revised");
      await capture(
        page,
        info,
        `${locale}-${expanded ? "expanded" : "ordinary"}-edit`,
        [save],
      );
      const patch = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === "/api/events" &&
          r.request().method() === "PATCH",
      );
      await save.click();
      expect((await patch).status()).toBe(200);
      await expect(page).toHaveURL(/\/dashboard\/calendar(?:\?|$)/);
      const saved = await browserFetch(
        page,
        `/api/events?id=${encodeURIComponent(eventId!)}`,
      );
      expect(saved.status).toBe(200);
      expect(JSON.parse(saved.body).event).toMatchObject({
        title: privateTitle + " revised",
        start_time: start,
        end_time: end,
        description: "Synthetic {description} 李",
        location: "Synthetic {location} 李",
      });
      await visit(
        page,
        `/dashboard/calendar/edit?id=${encodeURIComponent(eventId!)}`,
      );
      await page
        .getByRole("button", { name: text("deleteEvent"), exact: true })
        .click();
      const response = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === "/api/events" &&
          r.request().method() === "DELETE",
      );
      await page
        .getByRole("dialog")
        .getByRole("button", { name: text("delete"), exact: true })
        .click();
      expect((await response).status()).toBe(200);
      expect(
        (
          await browserFetch(
            page,
            `/api/events?id=${encodeURIComponent(eventId!)}`,
          )
        ).status,
      ).toBe(404);
      eventId = null;
    } finally {
      if (eventId) {
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
    }
  });
  test(`${locale} expanded=${expanded} imported read-only and empty states keep source values verbatim`, async ({
    page,
  }, info) => {
    const own = ids(info);
    await visit(
      page,
      `/dashboard/calendar/edit?id=${encodeURIComponent(own.event)}`,
    );
    await expect(
      page.getByRole("heading", { name: privateTitle, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(text("from").replace("{source}", sourceName), {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(text("readOnly"), { exact: true }),
    ).toBeVisible();
    expect(await page.locator("form").count()).toBe(0);
    expect(
      await page
        .getByRole("button", { name: text("deleteEvent"), exact: true })
        .count(),
    ).toBe(0);
    await capture(
      page,
      info,
      `${locale}-${expanded ? "expanded" : "ordinary"}-imported-read-only`,
      [page.getByRole("link", { name: text("back"), exact: true })],
    );
    const stored = await browserFetch(
      page,
      `/api/events?id=${encodeURIComponent(own.event)}`,
    );
    expect(stored.status).toBe(200);
    expect(JSON.parse(stored.body).event).toMatchObject({
      title: privateTitle,
      start_time: "2026-11-01T06:30:45.123Z",
      end_time: "2026-11-01T06:45:55.456Z",
    });
    await visit(page, "/dashboard/calendar/edit");
    await expect(
      page.getByRole("heading", { name: text("noEvent"), exact: true }),
    ).toBeVisible();
    await capture(
      page,
      info,
      `${locale}-${expanded ? "expanded" : "ordinary"}-no-event`,
      [page.getByRole("link", { name: text("back"), exact: true })],
    );
  });
}
