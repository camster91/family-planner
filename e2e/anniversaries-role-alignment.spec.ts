/**
 * Guarded Anniversaries role-alignment journey (#499 / D9).
 *
 * The rows and paired device are disposable Family A/B fixtures. The browser
 * exercises the real route/API and cleans only these IDs and their prefix.
 */
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { hashDeviceToken } from "../src/lib/device-session";
import pg from "pg";
import {
  FIXTURE_EMAILS,
  FIXTURE_IDS,
  FIXTURE_PASSWORD,
} from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { E2E_ANCHOR, authFile } from "./support/env";
import { browserFetch, browserSend, expect, test } from "./support/test";

const A = FIXTURE_IDS.familyA;
const B = FIXTURE_IDS.familyB;
const PROJECTS = [
  "phone-390x844",
  "phone-430x932",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
  "tablet-large-1920x1200",
  "desktop-1366x768",
] as const;

const DATE_IDS = {
  parent: "fx_e2e_anniversary_role_parent",
  teen: "fx_e2e_anniversary_role_teen",
  child: "fx_e2e_anniversary_role_child",
  foreign: "fx_e2e_anniversary_role_foreign",
} as const;
const SEEDED_DATE_IDS = [
  DATE_IDS.parent,
  DATE_IDS.teen,
  DATE_IDS.child,
] as const;
const DATE_PREFIX = "E2E Anniversaries D9";
const DATE_TITLES = {
  parent: `${DATE_PREFIX} parent-owned`,
  teen: `${DATE_PREFIX} teen-owned`,
  child: `${DATE_PREFIX} child-owned`,
  foreign: `${DATE_PREFIX} Family B`,
} as const;
const DEVICE_ID = "fx_e2e_anniversaries_device";
const DEVICE_ACCESS = "fpd1_a_e2e_anniversaries_valid";
const DEVICE_REFRESH = "fpd1_r_e2e_anniversaries_valid";
const FAMILIES = [A.family, B.family] as const;
const OWNERS = [A.parent, A.teen, A.child, B.parent] as const;

type Locale = "en" | "es";
type Role = "parent" | "teen" | "child";
type Who = "parentA" | "teenA" | "childA" | "parentB";

const COPY: Record<
  Locale,
  { title: string; add: string; save: string; delete: string }
> = {
  en: { title: "Dates", add: "Add Date", save: "Save", delete: "Delete" },
  es: {
    title: "Fechas",
    add: "Agregar fecha",
    save: "Guardar",
    delete: "Eliminar",
  },
};

let originalFeatures: unknown;
let originalFeaturesCaptured = false;
let originalFamilyBFeatures: unknown;
let originalFamilyBFeaturesCaptured = false;

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

async function restoreFeatures(db?: pg.Client) {
  if (!originalFeaturesCaptured || !originalFamilyBFeaturesCaptured) {
    throw new Error("Anniversaries fixture feature state was not captured");
  }
  const restore = async (client: pg.Client) => {
    await client.query(
      `UPDATE "Family" SET features = $1::jsonb WHERE id = $2`,
      [
        originalFeatures === null ? null : JSON.stringify(originalFeatures),
        A.family,
      ],
    );
    await client.query(
      `UPDATE "Family" SET features = $1::jsonb WHERE id = $2`,
      [
        originalFamilyBFeatures === null
          ? null
          : JSON.stringify(originalFamilyBFeatures),
        B.family,
      ],
    );
  };
  return db ? restore(db) : withDb(restore);
}

async function enableAnniversaries(db: pg.Client) {
  await db.query(
    `UPDATE "Family"
     SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object('anniversaries', true)
     WHERE id = ANY($1::text[])`,
    [[A.family, B.family]],
  );
}

async function cleanupDates(db: pg.Client) {
  await db.query(
    `DELETE FROM "Anniversary"
     WHERE id = ANY($1::text[])
        OR (name LIKE $2 AND family_id = ANY($3::text[]) AND created_by = ANY($4::text[]))`,
    [Object.values(DATE_IDS), `${DATE_PREFIX}%`, FAMILIES, OWNERS],
  );
}

async function seedDates(db: pg.Client) {
  await cleanupDates(db);
  const rows = [
    [DATE_IDS.parent, A.family, DATE_TITLES.parent, A.parent],
    [DATE_IDS.teen, A.family, DATE_TITLES.teen, A.teen],
    [DATE_IDS.child, A.family, DATE_TITLES.child, A.child],
    [DATE_IDS.foreign, B.family, DATE_TITLES.foreign, B.parent],
  ] as const;
  for (const [id, familyId, name, createdBy] of rows) {
    await db.query(
      `INSERT INTO "Anniversary"
        (id, family_id, name, type, date, notes, person_id, created_by, created_at)
       VALUES ($1, $2, $3, 'anniversary', $4, $5, NULL, $6, $7)`,
      [
        id,
        familyId,
        name,
        id === DATE_IDS.parent ? "2026-01-17" : "2026-02-12",
        `${name} synthetic notes`,
        createdBy,
        E2E_ANCHOR,
      ],
    );
  }
}

async function cleanupDevice(db: pg.Client) {
  await db.query(`DELETE FROM "HouseholdDevice" WHERE id = $1`, [DEVICE_ID]);
}

async function seedDevice(db: pg.Client) {
  await cleanupDevice(db);
  await db.query(
    `INSERT INTO "HouseholdDevice"
      (id, family_id, label, platform, created_by, confirmed_by, paired_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'web', $4, $4, $5, $5, $5)`,
    [DEVICE_ID, A.family, "Anniversaries fixture tablet", A.parent, E2E_ANCHOR],
  );
  await db.query(
    `INSERT INTO "DeviceSession"
      (id, device_id, family_id, access_token_hash, refresh_token_hash,
       access_expires_at, refresh_expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      `${DEVICE_ID}_session`,
      DEVICE_ID,
      A.family,
      hashDeviceToken(DEVICE_ACCESS),
      hashDeviceToken(DEVICE_REFRESH),
      new Date(E2E_ANCHOR.getTime() + 60 * 60 * 1000),
      new Date(E2E_ANCHOR.getTime() + 30 * 24 * 60 * 60 * 1000),
      E2E_ANCHOR,
    ],
  );
}

async function guardContext(context: BrowserContext, baseURL: string) {
  assertFixtureTargetAllowed(process.env);
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
    new URL(baseURL).hostname,
  );
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      ["data:", "blob:"].includes(url.protocol)
      ? route.continue()
      : route.abort();
  });
}

async function openAs(
  browser: Browser,
  info: TestInfo,
  who: Who,
  locale: Locale,
): Promise<{ context: BrowserContext; page: Page }> {
  const use = info.project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport,
    deviceScaleFactor: use.deviceScaleFactor,
    hasTouch: use.hasTouch,
    isMobile: use.isMobile,
    locale: locale === "es" ? "es-ES" : "en-US",
    timezoneId: use.timezoneId,
    colorScheme: locale === "es" ? "dark" : "light",
    reducedMotion: "reduce",
    extraHTTPHeaders: use.extraHTTPHeaders,
    storageState:
      who === "teenA" || who === "parentB"
        ? authFile(who === "parentB" ? "parentB" : "parentA")
        : authFile(who),
  });
  try {
    await guardContext(context, use.baseURL!);
    await context.addInitScript(
      ({ language, localeKey }) => {
        localStorage.setItem(localeKey, language);
        localStorage.setItem(
          "familyPlanner_theme_v2",
          language === "es" ? "dark" : "light",
        );
      },
      { language: locale, localeKey: LOCALE_STORAGE_KEY },
    );
    if (who === "teenA") {
      const login = await context.request.post("/api/auth/login", {
        data: {
          email: FIXTURE_EMAILS.familyA.teen,
          password: FIXTURE_PASSWORD,
        },
      });
      expect(login.status(), await login.text()).toBe(200);
    }
    const page = await context.newPage();
    await page.clock.install({ time: E2E_ANCHOR });
    return { context, page };
  } catch (error) {
    try {
      await context.close();
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        "Anniversaries identity setup and cleanup failed",
      );
    }
    throw error;
  }
}

function roleFor(who: Who): Role {
  return who === "parentA" || who === "parentB"
    ? "parent"
    : who === "teenA"
      ? "teen"
      : "child";
}

async function visitDates(page: Page, locale: Locale) {
  await page.goto("/dashboard/anniversaries");
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  if (locale === "es") {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  } else {
    await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  }
  await expect(
    page.getByRole("heading", { name: COPY[locale].title, level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: COPY[locale].add, exact: true }),
  ).toBeVisible();
}

async function datesBody(page: Page) {
  const response = await browserFetch(page, "/api/anniversaries");
  expect(response.status, response.body).toBe(200);
  return JSON.parse(response.body) as {
    dates: Array<{
      id: string;
      name: string;
      created_by: string | null;
      can_edit: boolean;
      can_delete: boolean;
    }>;
  };
}

function compiledBuiltAt() {
  const route = fs.readFileSync(
    ".next/server/app/api/version/route.js",
    "utf8",
  );
  const values = [
    ...new Set(route.match(/20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g) ?? []),
  ];
  expect(values).toHaveLength(1);
  return values[0];
}

async function assertRuntimeIdentity(
  page: Page,
  info: TestInfo,
  locale: Locale,
) {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  expect(head).toMatch(/^[a-f0-9]{40}$/);
  expect(process.env.RELEASE_SHA?.trim()).toBe(head);
  expect(() =>
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "prisma"], {
      stdio: "ignore",
    }),
  ).not.toThrow();
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();
  expect(tree).toMatch(/^[a-f0-9]{40}$/);
  const configuredTree = process.env.E2E_ANNIVERSARIES_BUILD_TREE?.trim();
  if (configuredTree) expect(configuredTree).toBe(tree);

  const response = await browserFetch(page, "/api/version");
  expect(response.status, response.body).toBe(200);
  const runtime = JSON.parse(response.body) as {
    version: string;
    commit: string;
    builtAt: string;
  };
  expect(runtime.commit).toBe(head);
  expect(runtime.builtAt).toBe(compiledBuiltAt());
  await info.attach(`anniversaries-${locale}-runtime-identity`, {
    body: JSON.stringify({
      runtime,
      sourceTree: tree,
      configuredTree: configuredTree ?? null,
    }),
    contentType: "application/json",
  });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await withDb(async (db) => {
    const current = await db.query(
      `SELECT id, features FROM "Family" WHERE id = ANY($1::text[])`,
      [[A.family, B.family]],
    );
    expect(current.rows).toHaveLength(2);
    originalFeatures = current.rows.find(
      (row) => row.id === A.family,
    )?.features;
    originalFamilyBFeatures = current.rows.find(
      (row) => row.id === B.family,
    )?.features;
    originalFeaturesCaptured = true;
    originalFamilyBFeaturesCaptured = true;
    await enableAnniversaries(db);
    await seedDates(db);
    await seedDevice(db);
  });
});

test.afterAll(async () => {
  const errors: Error[] = [];
  const attempt = async (label: string, work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      errors.push(
        new Error(
          `${label}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  };
  await attempt("Anniversaries row cleanup", () =>
    withDb((db) => cleanupDates(db)),
  );
  await attempt("Anniversaries device cleanup", () =>
    withDb((db) => cleanupDevice(db)),
  );
  await attempt("Anniversaries feature restoration", () => restoreFeatures());
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      "Anniversaries role-alignment cleanup failed",
    );
  }
});

test.beforeEach(async ({}, info) => {
  test.skip(
    !PROJECTS.includes(info.project.name as (typeof PROJECTS)[number]),
    "Anniversaries role alignment runs at six representative responsive sizes",
  );
  await withDb(async (db) => {
    await restoreFeatures(db);
    await enableAnniversaries(db);
    await seedDates(db);
  });
});

for (const locale of ["en", "es"] as const) {
  test(`${locale}: parent, teen and child see only permitted anniversary actions`, async ({
    browser,
  }, info) => {
    for (const who of ["parentA", "teenA", "childA"] as const) {
      const opened = await openAs(browser, info, who, locale);
      const role = roleFor(who);
      try {
        await visitDates(opened.page, locale);
        await assertRuntimeIdentity(opened.page, info, locale);
        if (role !== "parent") {
          const menu = opened.page.getByRole("button", {
            name: locale === "es" ? "Menú de usuario" : "User menu",
            exact: true,
          });
          await menu.click();
          const datesLink = opened.page
            .getByTestId("kid-feature-menu-group")
            .getByRole("link", {
              name:
                locale === "es"
                  ? "Cumpleaños y aniversarios"
                  : "Birthdays & anniversaries",
              exact: true,
            });
          await expect(datesLink).toBeVisible();
          await expect(datesLink).toHaveAttribute(
            "href",
            "/dashboard/anniversaries",
          );
          await menu.click();
        }
        const body = await datesBody(opened.page);
        expect(body.dates.map((date) => date.id)).not.toContain(
          DATE_IDS.foreign,
        );
        expect(JSON.stringify(body)).not.toContain(DATE_TITLES.foreign);
        expect(
          body.dates.filter((date) =>
            (SEEDED_DATE_IDS as readonly string[]).includes(date.id),
          ),
        ).toHaveLength(3);

        const own = body.dates.find((date) => date.id === DATE_IDS[role]);
        const parent = body.dates.find((date) => date.id === DATE_IDS.parent);
        expect(own).toMatchObject({
          can_edit: true,
          can_delete: role === "parent",
        });
        expect(parent).toMatchObject({
          can_edit: role === "parent",
          can_delete: role === "parent",
        });
        expect(
          await opened.page.getByRole("main").evaluate((main) => {
            const root = main.ownerDocument.documentElement;
            return root.scrollWidth - root.clientWidth;
          }),
        ).toBeLessThanOrEqual(0);
        expect(
          (
            await new AxeBuilder({ page: opened.page })
              .include("main")
              .analyze()
          ).violations,
        ).toEqual([]);

        const created = await browserSend(
          opened.page,
          "POST",
          "/api/anniversaries",
          {
            name: `${DATE_PREFIX} ${role} created`,
            type: "anniversary",
            date: "2026-03-03",
            notes: "Synthetic owned date",
          },
        );
        expect(created.status, created.body).toBe(201);
        const createdId = (JSON.parse(created.body) as { date: { id: string } })
          .date.id;
        const edited = await browserSend(
          opened.page,
          "PATCH",
          `/api/anniversaries/${encodeURIComponent(createdId)}`,
          {
            name: `${DATE_PREFIX} ${role} edited`,
            type: "anniversary",
            date: "2026-03-04",
          },
        );
        expect(edited.status, edited.body).toBe(200);

        const ownButton = opened.page.getByRole("button", {
          name: new RegExp(DATE_TITLES[role]),
        });
        await expect(ownButton).toHaveCount(1);
        await ownButton.click();
        const dialog = opened.page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByRole("button", { name: COPY[locale].save, exact: true }),
        ).toBeVisible();
        await expect(
          dialog.getByRole("button", {
            name: COPY[locale].delete,
            exact: true,
          }),
        ).toHaveCount(role === "parent" ? 1 : 0);
        await opened.page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);

        if (role !== "parent") {
          const parentButton = opened.page.getByRole("button", {
            name: new RegExp(DATE_TITLES.parent),
          });
          await expect(parentButton).toHaveCount(1);
          await parentButton.click();
          const readOnly = opened.page.getByRole("dialog", {
            name: DATE_TITLES.parent,
          });
          await expect(readOnly).toBeVisible();
          await expect(readOnly.locator("input, textarea")).toHaveCount(0);
          await expect(
            readOnly.getByRole("button", {
              name: COPY[locale].save,
              exact: true,
            }),
          ).toHaveCount(0);
          await expect(
            readOnly.getByRole("button", {
              name: COPY[locale].delete,
              exact: true,
            }),
          ).toHaveCount(0);
          await opened.page.keyboard.press("Escape");
          await expect(readOnly).toHaveCount(0);

          const forbiddenEdit = await browserSend(
            opened.page,
            "PATCH",
            `/api/anniversaries/${DATE_IDS.parent}`,
            {
              name: `${DATE_PREFIX} forbidden edit`,
              type: "anniversary",
              date: "2026-01-17",
            },
          );
          expect(forbiddenEdit.status, forbiddenEdit.body).toBe(403);
          const forbiddenDelete = await browserSend(
            opened.page,
            "DELETE",
            `/api/anniversaries/${DATE_IDS[role]}`,
            { id: DATE_IDS[role] },
          );
          expect(forbiddenDelete.status, forbiddenDelete.body).toBe(403);
        }
      } finally {
        await opened.context.close();
      }
    }
  });
}

test("Family B cannot read or mutate Family A dates", async ({
  browser,
}, info) => {
  test.skip(
    info.project.name !== "desktop-1366x768",
    "Cross-household boundary runs once at desktop size",
  );
  const familyB = await openAs(browser, info, "parentB", "en");
  try {
    await visitDates(familyB.page, "en");
    const body = await datesBody(familyB.page);
    expect(body.dates.map((date) => date.id)).toEqual([DATE_IDS.foreign]);
    expect(JSON.stringify(body)).not.toContain(DATE_TITLES.parent);
    for (const method of ["PATCH", "DELETE"] as const) {
      const response = await browserSend(
        familyB.page,
        method,
        `/api/anniversaries/${DATE_IDS.parent}`,
        method === "PATCH"
          ? {
              name: `${DATE_PREFIX} cross-household`,
              type: "anniversary",
              date: "2026-01-17",
            }
          : { id: DATE_IDS.parent },
      );
      expect(response.status, response.body).toBe(403);
    }
  } finally {
    await familyB.context.close();
  }
});

test("paired-device cookies refuse all Anniversaries handlers before person authority", async ({
  browser,
  baseURL,
}, info) => {
  test.skip(
    info.project.name !== "desktop-1366x768",
    "Paired-device exclusion runs once at desktop size",
  );
  const context = await browser.newContext({
    baseURL,
    storageState: authFile("parentA"),
  });
  try {
    await guardContext(context, baseURL!);
    await context.addCookies([
      { name: "fp_device", value: DEVICE_ACCESS, url: baseURL! },
    ]);
    const page = await context.newPage();
    await page.goto("/dashboard/anniversaries", {
      waitUntil: "domcontentloaded",
    });
    const routeResponse = await context.request.get(
      `${baseURL}/dashboard/anniversaries`,
      { maxRedirects: 0 },
    );
    expect([307, 308]).toContain(routeResponse.status());
    expect(new URL(routeResponse.headers().location!, baseURL).pathname).toBe(
      "/device/today",
    );

    const replies = [
      await browserFetch(page, "/api/anniversaries"),
      await browserSend(page, "POST", "/api/anniversaries", {
        name: `${DATE_PREFIX} device write`,
        type: "anniversary",
        date: "2026-03-05",
      }),
      await browserSend(
        page,
        "PATCH",
        `/api/anniversaries/${DATE_IDS.parent}`,
        {
          name: `${DATE_PREFIX} device edit`,
          type: "anniversary",
          date: "2026-01-17",
        },
      ),
      await browserSend(
        page,
        "DELETE",
        `/api/anniversaries/${DATE_IDS.parent}`,
        {
          id: DATE_IDS.parent,
        },
      ),
    ];
    for (const reply of replies) {
      expect(reply.status, reply.body).toBe(403);
      expect(JSON.parse(reply.body).error.code).toBe(
        "DEVICE_WRITE_NOT_ALLOWED",
      );
    }
  } finally {
    await context.close();
  }
});
