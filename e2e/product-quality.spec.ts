/**
 * Product quality smoke coverage for the current parent candidate (#543).
 *
 * This file deliberately uses the signed-in fixture and rendered routes. It
 * blocks every non-loopback request, owns only its random inventory rows,
 * weather cache fixture and feature-audit entries, and leaves domain writes
 * mocked or unsubmitted.
 */
import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { bulkCookingMessages } from "../src/i18n/bulk-cooking";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { assistantEnglish, assistantSpanish } from "../src/i18n/assistant";
import { moreMessages } from "../src/i18n/more";
import { getFeatureDisplayCopy } from "../src/i18n/feature-display";
import { FEATURES } from "../src/lib/features";
import { featureNavMeta } from "../src/lib/feature-nav-meta";
import { MORE_FEATURE_KEYS } from "../src/lib/nav-items";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { E2E_ANCHOR, authFile } from "./support/env";
import { ownFeatureAudit } from "./support/feature-audit";
import { browserFetch, browserSend, expect, test } from "./support/test";

const A = FIXTURE_IDS.familyA;
const PROJECTS = [
  "phone-390x844",
  "phone-430x932",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
  "tablet-large-1920x1200",
  "desktop-1366x768",
] as const;
const INVENTORY_PREFIX = `fx_e2e_product_quality_${randomUUID()}_`;
const INVENTORY_ROWS = [
  ["spinach", "QA spinach", "fridge", -1],
  ["milk", "QA oat milk", "fridge", 0],
  ["bread", "QA sourdough", "pantry", 1],
  ["pasta", "QA pasta", "pantry", 2],
  ["berries", "QA berries", "fridge", 3],
  ["chicken", "QA chicken", "freezer", 3],
] as const;
const WEATHER_PLACE = {
  label: "Toronto, Ontario, Canada",
  latitude: 43.65,
  longitude: -79.38,
};
const WEATHER_SNAPSHOT = {
  utcOffsetSeconds: -18000,
  timezone: "America/Toronto",
  current: { temperatureC: -3.4, code: 71, isDay: true },
  daily: [
    {
      day: "2026-01-05",
      highC: -1.2,
      lowC: -8.5,
      code: 71,
      precipitationChance: 80,
    },
    {
      day: "2026-01-06",
      highC: 2.6,
      lowC: -4,
      code: 3,
      precipitationChance: 10,
    },
    { day: "2026-01-07", highC: 4, lowC: -2, code: 0, precipitationChance: 0 },
    { day: "2026-01-08", highC: 5, lowC: 1, code: 61, precipitationChance: 70 },
  ],
};

type WeatherState = {
  family: {
    weather_enabled: boolean;
    weather_latitude: number | null;
    weather_longitude: number | null;
    weather_label: string | null;
    weather_unit: string;
  };
  cache: {
    family_id: string;
    latitude: number;
    longitude: number;
    status: string;
    payload: unknown;
    fetched_at: Date;
    updated_at: Date;
  } | null;
};

type Locale = "en" | "es";

test.use({ storageState: authFile("parentA") });

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

function dateKey(offset: number) {
  const date = new Date(E2E_ANCHOR);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function seedInventory() {
  await withDb(async (db) => {
    await db.query(
      `DELETE FROM "InventoryItem" WHERE family_id = $1 AND id LIKE $2`,
      [A.family, `${INVENTORY_PREFIX}%`],
    );
    for (const [suffix, name, location, days] of INVENTORY_ROWS) {
      await db.query(
        `INSERT INTO "InventoryItem" (id, family_id, name, location, expires_on, amount, added_by)
         VALUES ($1, $2, $3, $4, $5, 1, $6)`,
        [
          INVENTORY_PREFIX + suffix,
          A.family,
          name,
          location,
          dateKey(days),
          A.parent,
        ],
      );
    }
  });
}

async function removeInventory() {
  await withDb(async (db) => {
    await db.query(
      `DELETE FROM "InventoryItem" WHERE family_id = $1 AND id LIKE $2`,
      [A.family, `${INVENTORY_PREFIX}%`],
    );
    const remaining = await db.query(
      `SELECT id FROM "InventoryItem" WHERE family_id = $1 AND id LIKE $2`,
      [A.family, `${INVENTORY_PREFIX}%`],
    );
    expect(remaining.rows).toHaveLength(0);
  });
}

async function captureWeatherState(): Promise<WeatherState> {
  return withDb(async (db) => {
    const family = (
      await db.query(
        `SELECT weather_enabled, weather_latitude, weather_longitude, weather_label, weather_unit
           FROM "Family" WHERE id = $1`,
        [A.family],
      )
    ).rows[0] as WeatherState["family"] | undefined;
    if (!family) throw new Error("Family A weather fixture is missing");
    const cache = (
      await db.query(
        `SELECT family_id, latitude, longitude, status, payload, fetched_at, updated_at
           FROM "WeatherCache" WHERE family_id = $1`,
        [A.family],
      )
    ).rows[0] as WeatherState["cache"] | undefined;
    return { family, cache: cache ?? null };
  });
}

async function setProductQualityWeather(enabled: boolean) {
  await withDb(async (db) => {
    if (!enabled) {
      await db.query(
        `UPDATE "Family" SET weather_enabled = false, weather_latitude = NULL,
           weather_longitude = NULL, weather_label = NULL, weather_unit = 'celsius'
         WHERE id = $1`,
        [A.family],
      );
      await db.query(`DELETE FROM "WeatherCache" WHERE family_id = $1`, [
        A.family,
      ]);
      return;
    }
    await db.query(
      `UPDATE "Family" SET weather_enabled = true, weather_latitude = $2,
         weather_longitude = $3, weather_label = $4, weather_unit = 'celsius'
       WHERE id = $1`,
      [
        A.family,
        WEATHER_PLACE.latitude,
        WEATHER_PLACE.longitude,
        WEATHER_PLACE.label,
      ],
    );
    await db.query(
      `INSERT INTO "WeatherCache" (family_id, latitude, longitude, status, payload, fetched_at, updated_at)
       VALUES ($1, $2, $3, 'ok', $4, $5, now())
       ON CONFLICT (family_id) DO UPDATE SET latitude = $2, longitude = $3,
         status = 'ok', payload = $4, fetched_at = $5, updated_at = now()`,
      [
        A.family,
        WEATHER_PLACE.latitude,
        WEATHER_PLACE.longitude,
        JSON.stringify(WEATHER_SNAPSHOT),
        new Date(E2E_ANCHOR.getTime() + 6 * 60 * 60 * 1000),
      ],
    );
  });
}

async function restoreWeatherState(state: WeatherState) {
  await withDb(async (db) => {
    await db.query(
      `UPDATE "Family" SET weather_enabled = $2, weather_latitude = $3,
         weather_longitude = $4, weather_label = $5, weather_unit = $6
       WHERE id = $1`,
      [
        A.family,
        state.family.weather_enabled,
        state.family.weather_latitude,
        state.family.weather_longitude,
        state.family.weather_label,
        state.family.weather_unit,
      ],
    );
    await db.query(`DELETE FROM "WeatherCache" WHERE family_id = $1`, [
      A.family,
    ]);
    if (state.cache) {
      await db.query(
        `INSERT INTO "WeatherCache" (family_id, latitude, longitude, status, payload, fetched_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          state.cache.family_id,
          state.cache.latitude,
          state.cache.longitude,
          state.cache.status,
          state.cache.payload == null
            ? null
            : JSON.stringify(state.cache.payload),
          state.cache.fetched_at,
          state.cache.updated_at,
        ],
      );
    }
  });
}

async function installLocalOnlyGuard(context: BrowserContext) {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      ["data:", "blob:"].includes(url.protocol)
    ) {
      await route.continue();
      return;
    }
    await route.abort();
  });
}

async function setLocale(page: Page, locale: Locale) {
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
}

function checkedCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function checkedSourceTree() {
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();
  const configured = process.env.E2E_PRODUCT_QUALITY_BUILD_TREE?.trim();
  if (configured) expect(configured).toBe(tree);
  return tree;
}

function assertCleanTrackedAppSource() {
  try {
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "prisma"], {
      stdio: "ignore",
    });
  } catch {
    throw new Error(
      "Tracked app source differs from HEAD; rebuild product-quality QA from the checked-out commit.",
    );
  }
}

function compiledBuiltAt() {
  const route = fs.readFileSync(
    ".next/server/app/api/version/route.js",
    "utf8",
  );
  const times = [
    ...new Set(route.match(/20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g) ?? []),
  ];
  expect(times).toHaveLength(1);
  return times[0]!;
}

async function runtimeIdentity(page: Page, info: TestInfo, locale: Locale) {
  const response = await page.evaluate(async () => {
    const result = await fetch("/api/version", { credentials: "same-origin" });
    return { status: result.status, body: await result.text() };
  });
  expect(response.status, response.body).toBe(200);
  const runtime = JSON.parse(response.body) as {
    commit: string;
    builtAt: string;
    version: string;
  };
  const head = checkedCommit();
  expect(runtime.commit).toBe(head);
  if (process.env.RELEASE_SHA?.trim())
    expect(process.env.RELEASE_SHA.trim()).toBe(head);
  assertCleanTrackedAppSource();
  expect(runtime.builtAt).toBe(compiledBuiltAt());
  const identity = {
    runtime,
    buildId: fs.readFileSync(".next/BUILD_ID", "utf8").trim(),
    buildTree: checkedSourceTree(),
    locale,
    role: "parent",
  };
  expect(identity.buildId).not.toBe("");
  expect(identity.buildTree).toMatch(/^[a-f0-9]{40}$/);
  await info.attach("product-quality-runtime", {
    body: JSON.stringify(identity),
    contentType: "application/json",
  });
  return identity;
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

async function expectNoSeriousAxe(
  page: Page,
  info: TestInfo,
  selector: string,
  label: string,
) {
  const result = await new AxeBuilder({ page })
    .include(selector)
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  await info.attach(`axe-${label}.json`, {
    body: JSON.stringify(result.violations, null, 2),
    contentType: "application/json",
  });
  expect(
    result.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    ),
    `serious/critical axe violations on ${label}`,
  ).toEqual([]);
}

async function expectPrimaryTargets(scope: Locator) {
  const undersized = await scope
    .locator("button:visible, a[href]:visible, select:visible")
    .evaluateAll((elements) =>
      elements
        .map((element) => {
          const box = element.getBoundingClientRect();
          return {
            label:
              element.getAttribute("aria-label") ??
              (element.textContent ?? "").trim().slice(0, 80),
            width: Math.round(box.width),
            height: Math.round(box.height),
          };
        })
        .filter((target) => target.height < 44 || target.width < 44),
    );
  expect(
    undersized,
    "primary product-quality targets smaller than 44px",
  ).toEqual([]);
}

async function assertFirstUseSoonMetadataFit(useSoon: Locator) {
  const metadata = useSoon
    .getByTestId("use-soon-item")
    .first()
    .locator("p")
    .nth(1);
  await expect(metadata).toBeVisible();
  const metadataLayout = await metadata.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const region = element.closest("section")!.getBoundingClientRect();
    return {
      top: box.top,
      bottom: box.bottom,
      regionTop: region.top,
      regionBottom: region.bottom,
      viewportBottom: window.innerHeight,
      height: box.height,
    };
  });
  expect(
    metadataLayout.height,
    "The first Use Soon metadata line must have rendered height",
  ).toBeGreaterThan(0);
  expect(
    metadataLayout.top,
    "The first Use Soon metadata must start inside its tile",
  ).toBeGreaterThanOrEqual(metadataLayout.regionTop);
  expect(
    metadataLayout.bottom,
    "The first Use Soon expiry and storage metadata must be glanceable without scrolling",
  ).toBeLessThanOrEqual(metadataLayout.regionBottom + 1);
  expect(
    metadataLayout.bottom,
    "The first Use Soon metadata must remain inside the viewport",
  ).toBeLessThanOrEqual(metadataLayout.viewportBottom + 1);
}

async function preparePage(
  page: Page,
  context: BrowserContext,
  locale: Locale,
  info: TestInfo,
) {
  assertFixtureTargetAllowed(process.env);
  expect(PROJECTS).toContain(info.project.name);
  await installLocalOnlyGuard(context);
  await setLocale(page, locale);
}

const assistantCopy = (locale: Locale) =>
  locale === "es"
    ? {
        launcher: assistantSpanish.launcherAssistant,
        message: assistantSpanish.yourMessage,
        send: assistantSpanish.send,
        working: assistantSpanish.working,
        retry: assistantSpanish.retryChat,
        unavailable: assistantSpanish.chatUnavailable,
        offline: assistantSpanish.chatOffline,
        interrupted: assistantSpanish.connectionInterrupted,
        actionFailed: assistantSpanish.actionFailed,
        checkCalendar: assistantSpanish.checkCalendar,
        confirm: assistantSpanish.confirmSave,
        close: assistantSpanish.close,
        tabAssistant: assistantSpanish.tabAssistant,
        tabReport: assistantSpanish.tabReport,
        tabReports: assistantSpanish.tabReports,
        reportsLoadFailed: assistantSpanish.reportsLoadFailed,
      }
    : {
        launcher: assistantEnglish.launcherAssistant,
        message: assistantEnglish.yourMessage,
        send: assistantEnglish.send,
        working: assistantEnglish.working,
        retry: assistantEnglish.retryChat,
        unavailable: assistantEnglish.chatUnavailable,
        offline: assistantEnglish.chatOffline,
        interrupted: assistantEnglish.connectionInterrupted,
        actionFailed: assistantEnglish.actionFailed,
        checkCalendar: assistantEnglish.checkCalendar,
        confirm: assistantEnglish.confirmSave,
        close: assistantEnglish.close,
        tabAssistant: assistantEnglish.tabAssistant,
        tabReport: assistantEnglish.tabReport,
        tabReports: assistantEnglish.tabReports,
        reportsLoadFailed: assistantEnglish.reportsLoadFailed,
      };

for (const locale of ["en", "es"] as const) {
  test(`${locale}: discovery, grouped More and calendar connection guidance`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    await preparePage(page, context, locale, info);
    expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
      new URL(baseURL!).hostname,
    );
    await page.goto("/dashboard/today");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    if (locale === "es") await expect(page.locator("html")).toHaveClass(/dark/);
    else await expect(page.locator("html")).not.toHaveClass(/dark/);
    const identity = await runtimeIdentity(page, info, locale);
    const originalResponse = await browserFetch(page, "/api/family/features");
    expect(originalResponse.status, originalResponse.body).toBe(200);
    const originalFeatures = JSON.parse(originalResponse.body)
      .features as Record<string, boolean>;
    const allFeatures = Object.fromEntries(
      FEATURES.map((feature) => [feature.key, true]),
    );
    expect(Object.keys(allFeatures)).toHaveLength(22);
    const cleanFeatureAudit = await ownFeatureAudit(Object.keys(allFeatures));
    let featuresRestored = false;
    try {
      const enabled = await browserSend(page, "PATCH", "/api/family/features", {
        features: allFeatures,
      });
      expect(enabled.status, enabled.body).toBe(200);
      const canonical = await browserFetch(page, "/api/family/features");
      expect(canonical.status, canonical.body).toBe(200);
      expect(JSON.parse(canonical.body).features).toEqual(allFeatures);

      await page.goto("/dashboard/family/more");
      const more = page.getByTestId("more-list");
      await expect(more).toBeVisible();
      const moreKeys = ["chores", ...MORE_FEATURE_KEYS] as const;
      for (const key of moreKeys) {
        const meta = featureNavMeta(key);
        expect(meta, `missing More metadata for ${key}`).toBeTruthy();
        const link = more.locator(`a[href="${meta!.href}"]`);
        await expect(link).toHaveCount(1);
        await expect(link).toContainText(
          getFeatureDisplayCopy(locale, key).title,
        );
      }
      await expect(more.getByRole("listitem")).toHaveCount(moreKeys.length);
      const featureSearch = more.getByRole("searchbox", {
        name: moreMessages[locale].searchLabel,
      });
      await featureSearch.fill(getFeatureDisplayCopy(locale, "budget").title);
      await expect(more.locator('a[href="/dashboard/budget"]')).toHaveCount(1);
      await expect(more.getByRole("listitem")).toHaveCount(1);
      await more
        .getByRole("button", {
          name: moreMessages[locale].clearSearch,
          exact: true,
        })
        .click();
      await expect(featureSearch).toHaveValue("");
      await expect(more.getByRole("listitem")).toHaveCount(moreKeys.length);
      await expect(
        more.getByRole("heading", {
          name: locale === "es" ? "Esenciales" : "Core",
          exact: true,
        }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectPrimaryTargets(more);
      await expectNoSeriousAxe(
        page,
        info,
        '[data-testid="more-list"]',
        `${locale}-more`,
      );

      const nav = page.locator("[data-dashboard-navigation]");
      const explore = nav.getByTestId("desktop-explore");
      if ((page.viewportSize()?.width ?? 0) >= 768) {
        await expect(explore).toBeVisible();
        await expect(explore).toHaveAttribute("href", "/dashboard/family/more");
        await expectPrimaryTargets(nav);
        const rects = await nav.locator("a:visible").evaluateAll((anchors) =>
          anchors.map((anchor) => {
            const box = anchor.getBoundingClientRect();
            return {
              left: box.left,
              right: box.right,
              top: box.top,
              bottom: box.bottom,
            };
          }),
        );
        for (let i = 0; i < rects.length; i += 1)
          for (let j = i + 1; j < rects.length; j += 1)
            expect(
              !(
                rects[i]!.left < rects[j]!.right &&
                rects[j]!.left < rects[i]!.right &&
                rects[i]!.top < rects[j]!.bottom &&
                rects[j]!.top < rects[i]!.bottom
              ),
              `header links overlap at ${rects[i]!.left}/${rects[j]!.left}`,
            ).toBe(true);
        if (info.project.name === "tablet-portrait-800x1280") {
          const originalViewport = page.viewportSize()!;
          try {
            await page.setViewportSize({ width: 1024, height: 768 });
            await expect(explore).toBeVisible();
            await expectNoHorizontalOverflow(page);
            await expectPrimaryTargets(nav);
            const boxes = await nav
              .locator("a:visible, button:visible")
              .evaluateAll((controls) =>
                controls.map((control) => {
                  const box = control.getBoundingClientRect();
                  return {
                    left: box.left,
                    right: box.right,
                    top: box.top,
                    bottom: box.bottom,
                  };
                }),
              );
            for (let i = 0; i < boxes.length; i++)
              for (let j = i + 1; j < boxes.length; j++) {
                expect(
                  !(
                    boxes[i]!.left < boxes[j]!.right &&
                    boxes[j]!.left < boxes[i]!.right &&
                    boxes[i]!.top < boxes[j]!.bottom &&
                    boxes[j]!.top < boxes[i]!.bottom
                  ),
                  "Header controls must not overlap at 1024px",
                ).toBe(true);
              }
          } finally {
            await page.setViewportSize(originalViewport);
          }
        }
      } else {
        await expect(explore).toBeHidden();
      }

      await page.goto("/dashboard/calendar");
      const calendar = page.locator("main").first();
      await expect(calendar).toBeVisible();
      const connection = calendar
        .locator("details")
        .filter({ hasText: /conexión|connection/i });
      await expect(connection).toHaveCount(1);
      await connection.locator("summary").click();
      await expect(connection).toContainText(/Google|Outlook/);
      await expect(connection).toContainText(
        locale === "es"
          ? /no está disponible|no está configurada/i
          : /not available|not configured/i,
      );
      await expect(connection).toContainText(
        locale === "es" ? /solo lectura/i : /read-only/i,
      );
      const links = await connection
        .locator("a")
        .evaluateAll((anchors) =>
          anchors.map((anchor) => anchor.getAttribute("href")),
        );
      expect(links).toEqual(["/dashboard/settings#calendar-subscriptions"]);
      await expectNoHorizontalOverflow(page);
      await expectPrimaryTargets(connection);
      await expectNoSeriousAxe(page, info, "main", `${locale}-calendar`);
      await info.attach(`discovery-${locale}`, {
        body: JSON.stringify({
          identity,
          moreKeys,
          viewport: page.viewportSize(),
          calendarLinks: links,
        }),
        contentType: "application/json",
      });
    } finally {
      try {
        const restored = await browserSend(
          page,
          "PATCH",
          "/api/family/features",
          {
            features: originalFeatures,
          },
        );
        expect(restored.status, restored.body).toBe(200);
        const canonical = await browserFetch(page, "/api/family/features");
        expect(canonical.status, canonical.body).toBe(200);
        expect(JSON.parse(canonical.body).features).toEqual(originalFeatures);
        featuresRestored = true;
      } finally {
        await cleanFeatureAudit(featuresRestored);
      }
    }
  });

  test(`${locale}: meals and fridge layouts stay glanceable at the configured sizes`, async ({
    page,
    context,
  }, info) => {
    await preparePage(page, context, locale, info);
    await page.goto("/dashboard/meals?view=week");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const mealDays = page.getByTestId("meal-day");
    await expect(mealDays).toHaveCount(7);
    await expectNoHorizontalOverflow(page);
    if ((page.viewportSize()?.width ?? 0) >= 1280) {
      const yPositions = await mealDays.evaluateAll((cards) =>
        cards.map((card) => Math.round(card.getBoundingClientRect().top)),
      );
      expect(
        new Set(yPositions).size,
        "seven-day meal cards should share a row",
      ).toBe(1);
      expect(
        await mealDays.evaluateAll((cards) =>
          cards.every((card) => card.scrollWidth <= card.clientWidth),
        ),
      ).toBe(true);
    }
    const copy = bulkCookingMessages[locale];
    await page.goto("/dashboard/meals?view=bulk");
    const bulk = page.getByTestId("bulk-cooking-panel");
    await expect(bulk).toBeVisible();
    await expect(
      bulk.getByRole("button", { name: copy.add, exact: true }),
    ).toBeEnabled();
    expect(
      await page
        .getByRole("button", { name: /^(Add meal|Añadir comida)$/i })
        .count(),
    ).toBe(0);
    await bulk.getByRole("button", { name: copy.add, exact: true }).click();
    const editor = page.getByTestId("meal-prep-editor");
    await expect(editor).toBeVisible();
    await expect(editor).toHaveAttribute("role", "dialog");
    await expectNoHorizontalOverflow(page);
    await expectPrimaryTargets(bulk);
    await expectNoSeriousAxe(
      page,
      info,
      '[data-testid="bulk-cooking-panel"]',
      `${locale}-bulk`,
    );
    const cancel = editor.getByRole("button", {
      name: copy.cancel,
      exact: true,
    });
    if (await cancel.count()) await cancel.click();

    const originalResponse = await browserFetch(page, "/api/family/features");
    expect(originalResponse.status, originalResponse.body).toBe(200);
    const originalFeatures = JSON.parse(originalResponse.body)
      .features as Record<string, boolean>;
    const cleanFeatureAudit = await ownFeatureAudit(["inventory"]);
    let featuresRestored = false;
    const compactFridgeMetadataViewport =
      info.project.name === "fridge-landscape-1280x800" ||
      info.project.name === "desktop-1366x768";
    let originalWeather: WeatherState | null = null;
    try {
      await seedInventory();
      const enabled = await browserSend(page, "PATCH", "/api/family/features", {
        features: { ...originalFeatures, inventory: true },
      });
      expect(enabled.status, enabled.body).toBe(200);
      if (compactFridgeMetadataViewport) {
        originalWeather = await captureWeatherState();
        await setProductQualityWeather(false);
      }
      await page.goto("/dashboard/today?mode=fridge");
      const board = page.getByTestId("today-board");
      await expect(board).toHaveAttribute("data-mode", "fridge");
      const groceries = page.getByTestId("region-groceries");
      await expect(groceries).toBeVisible();
      await expect(groceries.getByTestId("grocery-item")).toHaveCount(5);
      await expect(
        groceries.getByText(
          locale === "es" ? /1 más por comprar/i : /1 more to buy/i,
        ),
      ).toBeVisible();
      await expect(
        groceries.getByRole("link", {
          name: /shared lists|listas compartidas/i,
        }),
      ).toHaveAttribute("href", "/dashboard/lists");
      await expect(
        groceries.getByRole("link", {
          name: /grocery lists|listas de compras/i,
        }),
      ).toHaveAttribute("href", "/dashboard/lists/groceries");
      const useSoon = page.getByTestId("board-slot-use-soon");
      await expect(useSoon).toBeVisible();
      await expect(useSoon.getByTestId("use-soon-item")).toHaveCount(5);
      await expect(useSoon).toContainText("QA spinach");
      await expect(useSoon.getByRole("heading")).toHaveText(
        locale === "es" ? "Usar pronto" : "Use soon",
      );
      await expect(useSoon).toContainText(
        locale === "es"
          ? "El consumo preferente fue ayer"
          : "Best before was yesterday",
      );
      await expect(useSoon).toContainText(
        locale === "es" ? "Refrigerador" : "Fridge",
      );
      if (compactFridgeMetadataViewport) {
        await expect(page.getByTestId("board-weather")).toHaveCount(0);
        await assertFirstUseSoonMetadataFit(useSoon);

        await setProductQualityWeather(true);
        await page.goto("/dashboard/today?mode=fridge");
        await expect(page.getByTestId("board-weather")).toBeVisible();
        const weatherUseSoon = page.getByTestId("board-slot-use-soon");
        await expect(weatherUseSoon).toBeVisible();
        await expect(weatherUseSoon).toContainText(
          locale === "es" ? "Refrigerador" : "Fridge",
        );
        await assertFirstUseSoonMetadataFit(weatherUseSoon);
      }
      const groceryList = groceries.locator("ul").first();
      await expect(groceryList).toHaveAttribute("tabindex", "0");
      await groceryList.focus();
      await expect(groceryList).toBeFocused();
      const groceryLayout = await groceryList.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          overflowY: style.overflowY,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        };
      });
      expect(groceryLayout.scrollWidth).toBeLessThanOrEqual(
        groceryLayout.clientWidth,
      );
      if (
        info.project.name === "fridge-landscape-1280x800" ||
        info.project.name === "tablet-large-1920x1200"
      ) {
        expect(groceryLayout.overflowY).toMatch(/auto|scroll/);
        const continuation = groceries.getByRole("link", {
          name: locale === "es" ? /1 más por comprar/i : /1 more to buy/i,
        });
        const sharedLists = groceries.getByRole("link", {
          name: /shared lists|listas compartidas/i,
        });
        for (const control of [continuation, sharedLists]) {
          expect(
            await control.evaluate((element) => {
              const box = element.getBoundingClientRect();
              const region = element
                .closest("section")!
                .getBoundingClientRect();
              const hit = document.elementFromPoint(
                box.left + box.width / 2,
                box.top + box.height / 2,
              );
              return (
                box.top >= region.top &&
                box.bottom <= region.bottom &&
                box.bottom <= window.innerHeight &&
                !!hit &&
                element.contains(hit)
              );
            }),
            "Grocery continuation must be fully visible inside its tile without scrolling the tile",
          ).toBe(true);
        }
        expect(
          groceryLayout.clientHeight,
          "The grocery preview must show at least one touch-sized item",
        ).toBeGreaterThanOrEqual(44);
      }
      const regionLayout = await groceries.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return {
          right: box.right,
          viewport: window.innerWidth,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        };
      });
      expect(regionLayout.right).toBeLessThanOrEqual(regionLayout.viewport + 1);
      expect(regionLayout.scrollWidth).toBeLessThanOrEqual(
        regionLayout.clientWidth,
      );
      await expectNoHorizontalOverflow(page);
      await expectPrimaryTargets(groceries);
      await expectNoSeriousAxe(
        page,
        info,
        '[data-testid="today-board"]',
        `${locale}-fridge`,
      );
      await info.attach(`fridge-${locale}-${info.project.name}.png`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    } finally {
      try {
        if (originalWeather) await restoreWeatherState(originalWeather);
      } finally {
        try {
          const restored = await browserSend(
            page,
            "PATCH",
            "/api/family/features",
            {
              features: originalFeatures,
            },
          );
          expect(restored.status, restored.body).toBe(200);
          featuresRestored = true;
        } finally {
          await cleanFeatureAudit(featuresRestored);
          await removeInventory();
        }
      }
    }
  });

  test(`${locale}: Family AI keeps drafts and never replays a failed event action`, async ({
    page,
    context,
  }, info) => {
    await preparePage(page, context, locale, info);
    await page.goto("/dashboard/today");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await runtimeIdentity(page, info, locale);
    const copy = assistantCopy(locale);
    const assistantRequests: unknown[] = [];
    const mutationPaths: string[] = [];
    let releaseRetry: (() => void) | undefined;
    page.on("request", (request) => {
      if (!["GET", "HEAD"].includes(request.method()))
        mutationPaths.push(new URL(request.url()).pathname);
    });
    await page.route("**/api/assistant", async (route) => {
      assistantRequests.push(JSON.parse(route.request().postData() ?? "{}"));
      if (assistantRequests.length === 1) {
        await route.abort("failed");
        return;
      }
      if (assistantRequests.length === 2)
        await new Promise<void>((resolve) => {
          releaseRetry = resolve;
        });
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "provider unavailable" }),
      });
    });
    const launcher = page.getByRole("button", {
      name: copy.launcher,
      exact: true,
    });
    await expect(launcher).toBeVisible();
    await launcher.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const message = dialog.getByLabel(copy.message, { exact: true });
    await message.fill("Original provider request");
    await dialog.getByRole("button", { name: copy.send, exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(copy.offline);
    await expect(
      dialog.getByRole("button", { name: copy.retry, exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: copy.retry, exact: true }).click();
    try {
      await expect.poll(() => assistantRequests.length).toBe(2);
      await expect(
        dialog.getByRole("button", { name: copy.retry, exact: true }),
      ).toBeDisabled();
      await expect(
        dialog.getByRole("button", { name: copy.working, exact: true }),
      ).toBeDisabled();
    } finally {
      releaseRetry?.();
    }
    await expect(dialog.getByRole("alert")).toContainText(copy.unavailable);
    await message.fill("Newer unsent draft");
    await dialog.getByRole("button", { name: copy.retry, exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(copy.unavailable);
    await expect(message).toHaveValue("Newer unsent draft");
    expect(assistantRequests).toHaveLength(3);
    expect(assistantRequests[1]).toEqual(assistantRequests[0]);
    expect(assistantRequests[2]).toEqual(assistantRequests[0]);
    expect(mutationPaths).toEqual([
      "/api/assistant",
      "/api/assistant",
      "/api/assistant",
    ]);
    await expectPrimaryTargets(dialog);
    await expectNoSeriousAxe(
      page,
      info,
      '[role="dialog"]',
      `${locale}-ai-provider`,
    );

    await dialog.getByRole("button", { name: copy.close, exact: true }).click();
    await page.unroute("**/api/assistant");
    const actionCalls: unknown[] = [];
    await page.route("**/api/assistant", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          reply: "I can prepare that event for review.",
          action: {
            kind: "event_create",
            title: "QA event proposal",
            start: "2026-01-05T09:00",
            end: "2026-01-05T10:00",
            location: "Home",
          },
        }),
      });
    });
    await page.route("**/api/events", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      actionCalls.push(JSON.parse(route.request().postData() ?? "{}"));
      await route.abort("failed");
    });
    await launcher.click();
    const actionDialog = page.getByRole("dialog");
    const actionMessage = actionDialog.getByLabel(copy.message, {
      exact: true,
    });
    await actionMessage.fill("Add a family event");
    await actionDialog
      .getByRole("button", { name: copy.send, exact: true })
      .click();
    await expect(
      actionDialog.getByRole("button", { name: copy.confirm, exact: true }),
    ).toBeVisible();
    await actionDialog
      .getByRole("button", { name: copy.confirm, exact: true })
      .click();
    await expect(actionDialog.getByRole("alert")).toContainText(
      copy.interrupted,
    );
    await expect(
      actionDialog.getByRole("link", { name: copy.checkCalendar, exact: true }),
    ).toHaveAttribute("href", "/dashboard/calendar");
    await expect(
      actionDialog.getByRole("button", { name: copy.retry, exact: true }),
    ).toHaveCount(0);
    expect(actionCalls).toHaveLength(1);
    await page.route("**/api/feedback", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "QA report read unavailable" }),
      });
    });
    await actionDialog
      .getByRole("button", { name: copy.tabReports, exact: true })
      .click();
    await expect(actionDialog.getByRole("alert")).toContainText(
      copy.reportsLoadFailed,
    );
    await actionDialog
      .getByRole("button", { name: copy.tabAssistant, exact: true })
      .click();
    await expect(actionDialog.getByRole("alert")).toContainText(
      copy.interrupted,
    );
    await expect(
      actionDialog.getByRole("link", { name: copy.checkCalendar, exact: true }),
    ).toHaveAttribute("href", "/dashboard/calendar");
    await actionDialog
      .getByRole("button", { name: copy.tabReport, exact: true })
      .click();
    await actionDialog
      .getByRole("button", { name: copy.tabAssistant, exact: true })
      .click();
    await expect(actionDialog.getByRole("alert")).toContainText(
      copy.interrupted,
    );
    await expect(
      actionDialog.getByRole("link", { name: copy.checkCalendar, exact: true }),
    ).toHaveAttribute("href", "/dashboard/calendar");
    await expect(
      actionDialog.getByRole("button", { name: copy.retry, exact: true }),
    ).toHaveCount(0);
    await expect(
      actionDialog.getByRole("button", { name: copy.confirm, exact: true }),
    ).toHaveCount(0);
    await page.waitForTimeout(100);
    expect(actionCalls).toHaveLength(1);
    await expectNoSeriousAxe(
      page,
      info,
      '[role="dialog"]',
      `${locale}-ai-action-failure`,
    );
    await info.attach(`ai-${locale}-${info.project.name}`, {
      body: JSON.stringify({ assistantRequests, actionCalls, mutationPaths }),
      contentType: "application/json",
    });
  });
}
