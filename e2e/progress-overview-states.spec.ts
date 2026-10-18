/**
 * Progress overview visual and transport-state coverage (#499).
 *
 * The analytics response is synthetic and request-scoped: this suite never
 * writes chores, points, members, or progress rows. The real analytics and
 * gamification feature flags are enabled through the parent API only for the
 * duration of this suite and restored with feature-audit ownership checks.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Browser, BrowserContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { authFile } from "./support/env";
import { ownFeatureAudit } from "./support/feature-audit";
import { browserFetch, browserSend, expect, test } from "./support/test";

test.use({ storageState: authFile("parentA") });
test.describe.configure({ mode: "serial" });

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const FEATURE_KEYS = ["analytics", "gamification"];
const VIEWPORT_PROJECTS = [
  "phone-390x844",
  "phone-430x932",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
  "tablet-large-1920x1200",
  "desktop-1366x768",
] as const;

type Locale = "en" | "es";
type Phase = "loading" | "populated" | "malformed" | "error" | "retry-empty";

interface FeatureSetup {
  original: Record<string, boolean>;
  cleanAudit: Awaited<ReturnType<typeof ownFeatureAudit>>;
}

const populated = {
  weeklyCompletion: 68,
  gamification: true,
  summary: {
    totalChores: 25,
    completedChores: 17,
    completionRate: 68,
    currentStreak: 4,
    mostActiveDay: { day: "Saturday", count: 6 },
  },
  weeklyTrend: [
    { date: "2026-10-05", day: "Mon", count: 2, points: 20 },
    { date: "2026-10-06", day: "Tue", count: 3, points: 30 },
    { date: "2026-10-07", day: "Wed", count: 1, points: 10 },
    { date: "2026-10-08", day: "Thu", count: 4, points: 40 },
    { date: "2026-10-09", day: "Fri", count: 0, points: 0 },
    { date: "2026-10-10", day: "Sat", count: 6, points: 60 },
    { date: "2026-10-11", day: "Sun", count: 1, points: 10 },
  ],
  members: [
    {
      id: "fx-progress-cameron",
      name: "Cameron",
      role: "parent",
      avatar_url: null,
      completedChores: 9,
      totalChores: 12,
      xp: 185,
      level: 4,
      streak: 4,
      best_streak: 9,
    },
    {
      id: "fx-progress-alexandria",
      name: "Alexandria-Margaret Household Member",
      role: "child",
      avatar_url: null,
      completedChores: 8,
      totalChores: 13,
      xp: 120,
      level: 3,
      streak: 2,
      best_streak: 5,
    },
  ],
  futureField: { source: "synthetic-e2e", ignoredByClient: true },
};

const empty = {
  weeklyCompletion: 0,
  gamification: true,
  summary: {
    totalChores: 0,
    completedChores: 0,
    completionRate: 0,
    currentStreak: 0,
    mostActiveDay: null,
  },
  weeklyTrend: [],
  members: [],
};

const copy = (locale: Locale) =>
  locale === "en"
    ? {
        title: "Progress",
        loading: "Loading progress…",
        loadError: "Could not load progress.",
        retry: "Try again",
        noProgress: "No progress yet",
        noTrend: "No chores completed in this window.",
        member: "Alexandria-Margaret Household Member",
      }
    : {
        title: "Progreso",
        loading: "Cargando progreso…",
        loadError: "No se pudo cargar el progreso.",
        retry: "Intentar de nuevo",
        noProgress: "Aún no hay progreso",
        noTrend: "No hay tareas completadas en este período.",
        member: "Alexandria-Margaret Household Member",
      };

function assertLocalTarget(baseURL: string | undefined) {
  expect(baseURL).toBeTruthy();
  expect(LOCAL_HOSTS).toContain(new URL(baseURL!).hostname);
}

async function guardNetwork(
  context: BrowserContext,
  baseURL: string | undefined,
) {
  assertLocalTarget(baseURL);
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return LOCAL_HOSTS.has(url.hostname) ||
      ["data:", "blob:"].includes(url.protocol)
      ? route.continue()
      : route.abort();
  });
}

async function enableProgressFeatures(
  browser: Browser,
  baseURL: string | undefined,
): Promise<FeatureSetup> {
  assertFixtureTargetAllowed(process.env);
  assertLocalTarget(baseURL);
  const context = await browser.newContext({
    baseURL,
    storageState: authFile("parentA"),
  });
  try {
    await guardNetwork(context, baseURL);
    const page = await context.newPage();
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    const response = await browserFetch(page, "/api/family/features");
    expect(response.status, response.body).toBe(200);
    const original = JSON.parse(response.body).features as Record<
      string,
      boolean
    >;
    const cleanAudit = await ownFeatureAudit([...FEATURE_KEYS]);
    const enabled = { ...original, analytics: true, gamification: true };
    const update = await browserSend(page, "PATCH", "/api/family/features", {
      features: enabled,
    });
    expect(update.status, update.body).toBe(200);
    expect(JSON.parse(update.body).features).toEqual(enabled);
    return { original, cleanAudit };
  } finally {
    await context.close();
  }
}

async function restoreProgressFeatures(
  browser: Browser,
  baseURL: string | undefined,
  setup: FeatureSetup,
) {
  assertFixtureTargetAllowed(process.env);
  assertLocalTarget(baseURL);
  const context = await browser.newContext({
    baseURL,
    storageState: authFile("parentA"),
  });
  let restored = false;
  try {
    await guardNetwork(context, baseURL);
    const page = await context.newPage();
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    const update = await browserSend(page, "PATCH", "/api/family/features", {
      features: setup.original,
    });
    expect(update.status, update.body).toBe(200);
    expect(JSON.parse(update.body).features).toEqual(setup.original);
    restored = true;
  } finally {
    await context.close();
    await setup.cleanAudit(restored);
  }
}

let featureSetup: FeatureSetup | undefined;

test.beforeAll(async ({ browser, baseURL }) => {
  featureSetup = await enableProgressFeatures(browser, baseURL);
});

test.afterAll(async ({ browser, baseURL }) => {
  if (featureSetup)
    await restoreProgressFeatures(browser, baseURL, featureSetup);
});

test.beforeEach(async ({ context, baseURL }) => {
  assertFixtureTargetAllowed(process.env);
  await guardNetwork(context, baseURL);
});

for (const locale of ["en", "es"] as const) {
  test(`${locale}: progress loading, populated, malformed, error and retry states`, async ({
    page,
  }, info) => {
    expect(VIEWPORT_PROJECTS).toContain(info.project.name);
    const text = copy(locale);
    await page.addInitScript(
      ({ locale, localeKey, themeKey }) => {
        localStorage.setItem(localeKey, locale);
        localStorage.setItem(themeKey, locale === "es" ? "dark" : "light");
      },
      { locale, localeKey: LOCALE_STORAGE_KEY, themeKey: THEME_STORAGE_KEY },
    );

    let phase: Phase = "loading";
    let releaseLoading!: () => void;
    const loadingGate = new Promise<void>((resolve) => {
      releaseLoading = resolve;
    });
    const analyticsPattern = /\/api\/analytics\?/;
    await page.route(analyticsPattern, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const requestPhase = phase;
      if (requestPhase === "loading") {
        await loadingGate;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(populated),
        });
        return;
      }
      if (requestPhase === "malformed") {
        // Missing `members` is a malformed 200, not a legitimate empty family.
        const malformed: Record<string, unknown> = { ...empty };
        delete malformed.members;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(malformed),
        });
        return;
      }
      if (requestPhase === "error") {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "synthetic analytics outage" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          requestPhase === "retry-empty" ? empty : populated,
        ),
      });
    });

    const assertA11y = async (label: string) => {
      const result = await new AxeBuilder({ page })
        .include("main")
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      const serious = result.violations.filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      );
      expect(serious, `${label}: ${JSON.stringify(serious)}`).toEqual([]);
    };
    const assertNoOverflow = async (label: string) => {
      const geometry = await page.evaluate(() => ({
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        main: document.querySelector("main")?.getBoundingClientRect().toJSON(),
      }));
      expect(
        geometry.documentWidth,
        `${label}: horizontal overflow`,
      ).toBeLessThanOrEqual(geometry.viewport + 1);
      if (geometry.main) {
        expect(
          geometry.main.right,
          `${label}: main overflows right edge`,
        ).toBeLessThanOrEqual(geometry.viewport + 1);
      }
    };
    const capture = async (state: string) => {
      await info.attach(`progress-${locale}-${state}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    };

    try {
      await page.goto("/dashboard/analytics");
      await expect(page.getByRole("status")).toContainText(text.loading);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      if (locale === "es") {
        await expect(page.locator("html")).toHaveClass(/dark/);
      } else {
        await expect(page.locator("html")).not.toHaveClass(/dark/);
      }

      // The page is now same-origin, so this proves the served runtime before
      // the held analytics request is released.
      const runtimeResponse = await browserFetch(page, "/api/version");
      expect(runtimeResponse.status, runtimeResponse.body).toBe(200);
      const runtime = JSON.parse(runtimeResponse.body) as {
        commit: string;
        builtAt?: string;
      };
      const head = execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim();
      expect(runtime.commit).toBe(head);
      if (process.env.RELEASE_SHA?.trim()) {
        expect(runtime.commit).toBe(process.env.RELEASE_SHA.trim());
      }
      await info.attach("progress-runtime", {
        body: JSON.stringify(runtime),
        contentType: "application/json",
      });

      phase = "populated";
      releaseLoading();
      await expect(
        page.getByRole("heading", { name: text.title, exact: true }),
      ).toBeVisible();
      await expect(page.getByText(text.member, { exact: true })).toBeVisible();
      await expect(page.getByTestId("weekly-trend")).toBeVisible();
      await expect(
        page.getByTestId("weekly-trend").locator('[role="group"]'),
      ).toHaveCount(7);
      await expect(
        page.locator('[role="group"][aria-label]').first(),
      ).toBeVisible();
      await expect(page.getByTestId("family-points")).toHaveText("305");
      await expect(page.getByTestId("best-streak")).toHaveText(
        locale === "es" ? "9 d" : "9d",
      );
      await assertNoOverflow("populated");
      await assertA11y("populated");
      await capture("populated");

      phase = "malformed";
      await page.reload();
      await expect(page.getByRole("alert")).toContainText(text.loadError);
      await expect(
        page.getByText(text.noProgress, { exact: true }),
      ).toHaveCount(0);
      await assertNoOverflow("malformed");
      await assertA11y("malformed");

      phase = "error";
      await page.reload();
      await expect(page.getByRole("alert")).toContainText(text.loadError);
      const retry = page.getByRole("button", { name: text.retry, exact: true });
      await expect(retry).toBeVisible();
      const retryBox = await retry.boundingBox();
      expect(
        retryBox,
        "retry control should have a measurable hit target",
      ).not.toBeNull();
      expect(retryBox!.width).toBeGreaterThanOrEqual(44);
      expect(retryBox!.height).toBeGreaterThanOrEqual(44);
      await assertNoOverflow("error");
      await assertA11y("error");
      await capture("error");

      phase = "retry-empty";
      await retry.click();
      await expect(
        page.getByText(text.noProgress, { exact: true }),
      ).toBeVisible();
      await expect(page.getByTestId("weekly-trend-empty")).toContainText(
        text.noTrend,
      );
      await expect(page.getByRole("alert")).toHaveCount(0);
      await assertNoOverflow("retry-empty");
      await assertA11y("retry-empty");
      await capture("retry-empty");
    } finally {
      releaseLoading();
    }
  });
}
