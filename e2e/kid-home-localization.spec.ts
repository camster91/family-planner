/**
 * Child-home localization and routine presentation (#499).
 *
 * This is a read-only browser journey after setup: disposable routine rows
 * exercise today's, completed, checked, catch-up and tomorrow states for the
 * real Family A child session. The parent session checks that the same rows
 * remain available on the parent chores surface. Household text is intentionally
 * accented and is asserted verbatim; only product copy is expected to change
 * with the locale.
 */
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import type { Locator, Page, TestInfo } from "@playwright/test";
import pg from "pg";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { kidHomeMessages } from "../src/i18n/kid-home";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { E2E_ANCHOR, authFile } from "./support/env";
import { browserFetch, expect, test } from "./support/test";

const A = FIXTURE_IDS.familyA;
const PROJECTS = new Set([
  "phone-390x844",
  "phone-430x932",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
  "tablet-large-1920x1200",
  "desktop-1366x768",
]);
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const routineName = `Morning café ${suffix}`;
const catchupName = `After school ${suffix}`;
const retryNote = `Use the blue towel — café ${suffix}`;
const todayMission = `Feed the cat — café ${suffix}`;
const tomorrowMission = `Pack the lunchbox — café ${suffix}`;
const routineStepTitles = [
  `Brush teeth — café ${suffix}`,
  `Get dressed — café ${suffix}`,
  `Shoes on — café ${suffix}`,
] as const;
const IDS = {
  next: `fx_e2e_kid_localization_${suffix}_next`,
  waiting: `fx_e2e_kid_localization_${suffix}_waiting`,
  checked: `fx_e2e_kid_localization_${suffix}_checked`,
  catchup: `fx_e2e_kid_localization_${suffix}_catchup`,
  today: `fx_e2e_kid_localization_${suffix}_today`,
  tomorrow: `fx_e2e_kid_localization_${suffix}_tomorrow`,
};
const ALL_IDS = Object.values(IDS);

type Locale = "en" | "es";
type KidHomeKey = keyof typeof kidHomeMessages.en;

function utcDay(offset: number) {
  return new Date(
    Date.UTC(
      E2E_ANCHOR.getUTCFullYear(),
      E2E_ANCHOR.getUTCMonth(),
      E2E_ANCHOR.getUTCDate() + offset,
    ),
  ).toISOString();
}

function copy(
  locale: Locale,
  key: KidHomeKey,
  params: Record<string, string | number> = {},
) {
  return kidHomeMessages[locale][key].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(params[name] ?? `{${name}}`),
  );
}

async function withDb<T>(fn: (db: pg.Client) => Promise<T>): Promise<T> {
  assertFixtureTargetAllowed(process.env);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

async function cleanup(db: pg.Client) {
  await db.query(`DELETE FROM "Chore" WHERE id = ANY($1::text[])`, [ALL_IDS]);
  await db.query(
    `DELETE FROM "Activity" WHERE family_id = $1 AND title LIKE $2`,
    [A.family, `%${suffix}%`],
  );
  await db.query(
    `DELETE FROM "Notification" WHERE user_id = $1 AND message LIKE $2`,
    [A.child, `%${suffix}%`],
  );
}

async function seedRows() {
  await withDb(async (db) => {
    await cleanup(db);
    const rows = [
      {
        id: IDS.next,
        title: `Brush teeth — café ${suffix}`,
        due: utcDay(0),
        status: "pending",
        icon: "brush-teeth",
        routine: routineName,
        order: 1,
        notes: retryNote,
        completedAt: null,
        verifiedAt: null,
      },
      {
        id: IDS.waiting,
        title: `Get dressed — café ${suffix}`,
        due: utcDay(0),
        status: "completed",
        icon: "get-dressed",
        routine: routineName,
        order: 2,
        notes: null,
        completedAt: E2E_ANCHOR.toISOString(),
        verifiedAt: null,
      },
      {
        id: IDS.checked,
        title: `Shoes on — café ${suffix}`,
        due: utcDay(0),
        status: "verified",
        icon: "shoes",
        routine: routineName,
        order: 3,
        notes: null,
        completedAt: E2E_ANCHOR.toISOString(),
        verifiedAt: E2E_ANCHOR.toISOString(),
      },
      {
        id: IDS.catchup,
        title: `Catch-up step — café ${suffix}`,
        due: utcDay(-1),
        status: "pending",
        icon: "backpack",
        routine: catchupName,
        order: 1,
        notes: null,
        completedAt: null,
        verifiedAt: null,
      },
      {
        id: IDS.today,
        title: todayMission,
        due: utcDay(0),
        status: "pending",
        icon: null,
        routine: null,
        order: null,
        notes: null,
        completedAt: null,
        verifiedAt: null,
      },
      {
        id: IDS.tomorrow,
        title: tomorrowMission,
        due: utcDay(1),
        status: "pending",
        icon: null,
        routine: null,
        order: null,
        notes: null,
        completedAt: null,
        verifiedAt: null,
      },
    ];
    for (const row of rows) {
      await db.query(
        `INSERT INTO "Chore" (
          id, family_id, title, points, assigned_to, due_date, status,
          frequency, difficulty, created_by, created_at, icon, routine,
          routine_order, verified_notes, completed_at, verified_at
        ) VALUES ($1, $2, $3, 10, $4, $5, $6, 'once', 'easy', $7, $8,
          $9, $10, $11, $12, $13, $14)`,
        [
          row.id,
          A.family,
          row.title,
          A.child,
          row.due,
          row.status,
          A.parent,
          E2E_ANCHOR.toISOString(),
          row.icon,
          row.routine,
          row.order,
          row.notes,
          row.completedAt,
          row.verifiedAt,
        ],
      );
    }
  });
}

async function configureContext(
  page: Page,
  locale: Locale,
  baseURL: string | undefined,
) {
  assertFixtureTargetAllowed(process.env);
  expect(baseURL).toBeTruthy();
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
    new URL(baseURL!).hostname,
  );
  await page.addInitScript(
    ({ language, localeKey, themeKey }) => {
      localStorage.setItem(localeKey, language);
      localStorage.setItem(themeKey, language === "es" ? "dark" : "light");
    },
    {
      language: locale,
      localeKey: LOCALE_STORAGE_KEY,
      themeKey: THEME_STORAGE_KEY,
    },
  );
  await page.context().route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      ["data:", "blob:"].includes(url.protocol)
      ? route.continue()
      : route.abort();
  });
}

async function capture(
  page: Page,
  info: TestInfo,
  label: string,
  targets: Locator[] = [],
) {
  for (const target of targets) {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height, `${label} target height`).toBeGreaterThanOrEqual(44);
    expect(box!.width, `${label} target width`).toBeGreaterThanOrEqual(44);
    await target.focus();
    await expect(target).toBeFocused();
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const violations = (
    await new AxeBuilder({ page }).include("main").analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  await info.attach(`${label}-axe.json`, {
    body: JSON.stringify(violations, null, 2),
    contentType: "application/json",
  });
  expect(violations, `serious/critical axe violations on ${label}`).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  const path = info.outputPath(`${label}-${info.project.name}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach(`${label}.png`, { path, contentType: "image/png" });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(seedRows);
test.afterAll(async () => {
  await withDb(cleanup);
});

test.beforeEach(async ({}, info) => {
  test.skip(
    !PROJECTS.has(info.project.name),
    "Child localization runs across the six configured viewport projects",
  );
});

for (const locale of ["en", "es"] as const) {
  test.describe(`${locale} child home`, () => {
    test.use({
      storageState: authFile("childA"),
      timezoneId: "America/Toronto",
    });
    test.beforeEach(async ({ page, baseURL }) => {
      await configureContext(page, locale, baseURL);
    });

    test(`${locale}: localized routine states keep household text and targets usable`, async ({
      page,
    }, info) => {
      const writes: string[] = [];
      page.on("request", (request) => {
        if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) {
          writes.push(new URL(request.url()).pathname);
        }
      });
      const response = await page.goto("/dashboard");
      expect(response?.status()).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      const auth = await browserFetch(page, "/api/auth/me");
      expect(auth.status).toBe(200);
      expect(JSON.parse(auth.body).user).toMatchObject({
        id: A.child,
        role: "child",
        family_id: A.family,
      });

      const text = (
        key: KidHomeKey,
        params?: Record<string, string | number>,
      ) => copy(locale, key, params);
      await expect(
        page.getByRole("heading", {
          name: text("greeting", { name: "Casey" }),
          exact: true,
        }),
      ).toBeVisible();
      const routine = page
        .getByTestId("kid-routine")
        .filter({ hasText: routineName });
      await expect(routine).toHaveCount(1);
      await expect(routine.getByTestId("routine-step")).toHaveCount(3);
      await expect(routine.getByTestId("routine-progress")).toHaveText(
        text("progressDone", { done: 2, total: 3 }),
      );
      await expect(routine.getByTestId("routine-step").nth(0)).toHaveAttribute(
        "aria-current",
        "step",
      );
      await expect(
        routine.getByText(text("next"), { exact: true }),
      ).toHaveCount(1);
      await expect(
        routine.getByText(text("done"), { exact: true }),
      ).toHaveCount(2);
      await expect(page.getByText(retryNote, { exact: true })).toBeVisible();

      const first = routine.getByTestId("routine-step").nth(0);
      // Keep the focus and capture target on the actionable card itself. The
      // test id is intentionally on the button, not its layout wrapper.
      await expect(first).toHaveRole("button");
      await expect(first).toHaveAttribute(
        "aria-label",
        [
          `Brush teeth — café ${suffix}`,
          text("stepOf", { step: 1, total: 3 }),
          `${text("haveAnotherGo")}: ${retryNote}`,
          text("nextStep"),
        ].join(", "),
      );
      await expect(routine.getByTestId("routine-step").nth(1)).toHaveAttribute(
        "aria-label",
        [
          `Get dressed — café ${suffix}`,
          text("stepOf", { step: 2, total: 3 }),
          text("doneWaiting"),
        ].join(", "),
      );
      await expect(routine.getByTestId("routine-step").nth(2)).toHaveAttribute(
        "aria-label",
        [
          `Shoes on — café ${suffix}`,
          text("stepOf", { step: 3, total: 3 }),
          text("doneChecked"),
        ].join(", "),
      );

      await expect(
        page.getByRole("heading", {
          name: text("routineCatchup"),
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText(text("wasDue", { date: text("yesterday") }), {
          exact: false,
        }),
      ).toBeVisible();
      await expect(page.getByText(todayMission, { exact: true })).toBeVisible();
      const tomorrowSection = page
        .locator("section")
        .filter({ hasText: tomorrowMission });
      await expect(tomorrowSection).toHaveCount(1);
      await expect(
        tomorrowSection.getByText(text("tomorrow"), { exact: true }),
      ).toHaveCount(1);
      await expect(
        tomorrowSection.getByText(tomorrowMission, { exact: true }),
      ).toHaveCount(1);

      const comingUpSection = page
        .locator("section")
        .filter({ hasText: text("comingUp") });
      await expect(comingUpSection).toHaveCount(1);
      const dentistRow = comingUpSection.locator(".row-apple").filter({
        has: page.getByText("Dentist (Casey)", { exact: true }),
      });
      await expect(dentistRow).toHaveCount(1);
      await expect(
        dentistRow.getByText(text("today"), { exact: true }),
      ).toHaveCount(1);
      await expect(
        page.getByText(text("level", { level: 2 }), { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(text("pointsToGo", { count: 80 }), { exact: true }),
      ).toBeVisible();

      const steps = routine.getByTestId("routine-step");
      for (const step of await steps.all()) {
        const box = await step.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
      }
      expect(writes).toEqual([]);
      await capture(page, info, `${locale}-child-home`, [first]);
    });
  });

  test.describe(`${locale} parent chores view`, () => {
    test.use({
      storageState: authFile("parentA"),
      timezoneId: "America/Toronto",
    });
    test.beforeEach(async ({ page, baseURL }) => {
      await configureContext(page, locale, baseURL);
    });

    test(`${locale}: parent sees routine rows without child-only home copy`, async ({
      page,
    }, info) => {
      const response = await page.goto("/dashboard/chores");
      expect(response?.status()).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      const auth = await browserFetch(page, "/api/auth/me");
      expect(auth.status).toBe(200);
      expect(JSON.parse(auth.body).user).toMatchObject({
        id: A.parent,
        role: "parent",
        family_id: A.family,
      });
      await expect(page.getByText(routineName, { exact: true })).toBeVisible();
      await expect(
        page.getByText(textForParent(locale, "routinePanel"), { exact: true }),
      ).toBeVisible();
      // The parent surface keeps the routine workspace in its existing
      // expandable panel. Explicitly verify the panel is open before checking
      // every seeded row, including completed and verified steps; this avoids
      // passing solely because the routine label exists above a collapsed list.
      const routineSummary = page
        .locator("summary")
        .filter({ hasText: textForParent(locale, "routinePanel") });
      await expect(routineSummary).toHaveCount(1);
      const routinePanel = routineSummary.locator("..");
      if (
        !(await routinePanel.evaluate((element) =>
          element.hasAttribute("open"),
        ))
      ) {
        await routineSummary.click();
      }
      await expect(routinePanel).toHaveAttribute("open", "");
      const routineStacks = routinePanel.getByRole("region", {
        name: textForParent(locale, "routinePanel"),
        exact: true,
      });
      await expect(routineStacks).toHaveCount(1);
      const seededStack = routineStacks.getByRole("region", {
        name: new RegExp(routineName),
      });
      await expect(seededStack).toHaveCount(1);
      const seededRows = seededStack.locator("ol > li");
      await expect(seededRows).toHaveCount(3);
      // The open parent row keeps its raw title; completed and verified rows
      // render their canonical routine order before the raw household title.
      await expect(
        seededRows.nth(0).getByText(routineStepTitles[0], { exact: true }),
      ).toBeVisible();
      await expect(
        seededRows
          .nth(1)
          .getByText(`2. ${routineStepTitles[1]}`, { exact: true }),
      ).toBeVisible();
      await expect(
        seededRows
          .nth(2)
          .getByText(`3. ${routineStepTitles[2]}`, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(copy(locale, "greeting", { name: "Casey" }), {
          exact: true,
        }),
      ).toHaveCount(0);
      await capture(page, info, `${locale}-parent-chores`);
    });
  });
}

function textForParent(locale: Locale, key: "routinePanel") {
  return locale === "es" ? "Rutinas paso a paso" : "Routine stacks";
}
