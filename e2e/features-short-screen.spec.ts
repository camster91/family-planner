/** #499: feature settings remain scannable, keyboard-reachable and bounded at every release viewport. */
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { BrowserContext, Page } from "@playwright/test";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { FEATURES } from "../src/lib/features";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { authFile } from "./support/env";
import { browserFetch, expect, test } from "./support/test";

const GROUPS = {
  en: {
    core: "Core",
    planning: "Planning",
    family: "Family life",
    navigation: "Feature groups",
    openAll: "Open all groups",
    closeAll: "Close all groups",
    search: "Search features",
    clearSearch: "Clear feature search",
    noMatches: "No features match your search.",
  },
  es: {
    core: "Esenciales",
    planning: "Planificación",
    family: "Vida familiar",
    navigation: "Grupos de funciones",
    openAll: "Abrir todos los grupos",
    closeAll: "Cerrar todos los grupos",
    search: "Buscar funciones",
    clearSearch: "Borrar búsqueda de funciones",
    noMatches: "Ninguna función coincide con tu búsqueda.",
  },
} as const;

test.use({ storageState: authFile("parentA") });

async function guard(context: BrowserContext, locale: "en" | "es") {
  await context.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (!local) return route.abort();
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method()))
      return route.abort();
    return route.continue();
  });
  await context.addInitScript(
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

async function assertRuntimeIdentity(page: Page) {
  const response = await browserFetch(page, "/api/version");
  expect(response.status, response.body).toBe(200);
  const runtime = JSON.parse(response.body) as {
    commit?: string;
    builtAt?: string;
  };
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();
  expect(runtime.commit).toBe(head);
  expect(process.env.RELEASE_SHA).toBe(head);
  if (process.env.E2E_FEATURE_CONTROLS_BUILD_TREE)
    expect(process.env.E2E_FEATURE_CONTROLS_BUILD_TREE).toBe(tree);
  expect(() =>
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "prisma"], {
      stdio: "ignore",
    }),
  ).not.toThrow();
  const builtTimes = [
    ...new Set(
      fs
        .readFileSync(".next/server/app/api/version/route.js", "utf8")
        .match(/20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g) ?? [],
    ),
  ];
  expect(builtTimes).toHaveLength(1);
  expect(runtime.builtAt).toBe(builtTimes[0]);
  return { runtime, tree };
}

async function assertNoOverflow(page: Page, label: string) {
  const size = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
  });
  expect(
    size.scrollWidth,
    `${label}: feature settings overflow horizontally`,
  ).toBeLessThanOrEqual(size.clientWidth + 1);
}

async function assertSwitchGeometry(page: Page, label: string) {
  const switches = page.getByRole("switch");
  await expect(switches).toHaveCount(FEATURES.length);
  const viewport = page.viewportSize()!;
  const geometry: Array<{
    name: string;
    width: number;
    height: number;
  }> = [];
  for (let index = 0; index < (await switches.count()); index += 1) {
    const toggle = switches.nth(index);
    await toggle.scrollIntoViewIfNeeded();
    const box = await toggle.boundingBox();
    expect(box, `${label}: switch ${index} has no box`).not.toBeNull();
    expect(
      box!.width,
      `${label}: switch ${index} is too narrow`,
    ).toBeGreaterThanOrEqual(44);
    expect(
      box!.height,
      `${label}: switch ${index} is too short`,
    ).toBeGreaterThanOrEqual(44);
    expect(
      box!.x,
      `${label}: switch ${index} is clipped left`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      box!.x + box!.width,
      `${label}: switch ${index} is clipped right`,
    ).toBeLessThanOrEqual(viewport.width);
    geometry.push({
      name: (await toggle.getAttribute("aria-label")) ?? `switch-${index}`,
      width: box!.width,
      height: box!.height,
    });
  }
  return geometry;
}

for (const locale of ["en", "es"] as const) {
  test(`${locale}: feature settings short-screen controls stay discoverable`, async ({
    browser,
    baseURL,
  }, info) => {
    assertFixtureTargetAllowed(process.env);
    expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
      new URL(baseURL!).hostname,
    );
    const context = await browser.newContext({
      baseURL,
      storageState: authFile("parentA"),
      viewport: info.project.use.viewport,
      hasTouch: info.project.use.hasTouch,
      isMobile: info.project.use.isMobile,
      deviceScaleFactor: 1,
      timezoneId: "America/Toronto",
      extraHTTPHeaders: info.project.use.extraHTTPHeaders,
    });
    try {
      await guard(context, locale);
      const page = await context.newPage();
      const response = await page.goto("/dashboard/features");
      expect(response?.status()).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      if (locale === "es")
        await expect(page.locator("html")).toHaveClass(/dark/);
      else await expect(page.locator("html")).not.toHaveClass(/dark/);
      await info.attach("features-compact-screen", {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
      const identity = await assertRuntimeIdentity(page);
      const profileResponse = await browserFetch(page, "/api/users");
      expect(profileResponse.status, profileResponse.body).toBe(200);
      const profile = JSON.parse(profileResponse.body).user;
      expect(profile.id).toBe(FIXTURE_IDS.familyA.parent);
      expect(profile.family_id).toBe(FIXTURE_IDS.familyA.family);
      expect(profile.role).toBe("parent");
      const copy = GROUPS[locale];
      const groups = page.getByRole("navigation", {
        name: copy.navigation,
        exact: true,
      });
      const groupButtons = groups.getByRole("button");
      await expect(groupButtons).toHaveCount(3);
      for (let index = 0; index < 3; index += 1) {
        const groupButton = groupButtons.nth(index);
        const box = await groupButton.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(
          page.viewportSize()!.width,
        );
      }
      const groupWidth = await groups.evaluate((element) => ({
        client: element.clientWidth,
        scroll: element.scrollWidth,
      }));
      expect(groupWidth.scroll).toBeLessThanOrEqual(groupWidth.client + 1);
      const planning = page.locator("#feature-group-planning");
      const core = page.locator("#feature-group-core");
      const family = page.locator("#feature-group-family");

      // The initial interactive layout is compact for every viewport. Planning is the
      // first useful group; the explicit control opens the complete catalog.
      await expect(planning.getByRole("switch")).toHaveCount(11);
      await expect(core.getByRole("switch")).toHaveCount(0);
      await expect(family.getByRole("switch")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: copy.openAll }),
      ).toBeVisible();

      await page.getByRole("button", { name: copy.openAll }).click();
      await expect(
        page.getByRole("button", { name: copy.closeAll }),
      ).toBeVisible();
      await expect(page.getByRole("switch")).toHaveCount(FEATURES.length);
      await page.getByRole("button", { name: copy.closeAll }).click();
      await expect(page.getByRole("switch")).toHaveCount(0);

      const search = page.getByRole("searchbox", { name: copy.search });
      await search.fill("budget");
      await expect(page.getByText("Budget", { exact: true })).toBeVisible();
      await search.fill("feature-search-no-match");
      await expect(
        page.getByText(copy.noMatches, { exact: true }),
      ).toBeVisible();
      const clear = page.getByRole("button", { name: copy.clearSearch });
      await clear.click();
      await expect(search).toBeFocused();
      await expect(planning.getByRole("switch")).toHaveCount(0);

      const familyJump = groups.getByRole("button", {
        name: new RegExp(`^${copy.family}\\s·`),
      });
      await familyJump.click();
      const familyHeading = page.locator("#feature-group-heading-family");
      await expect(familyHeading).toBeFocused();
      const focusStyle = await familyHeading.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
        };
      });
      expect(focusStyle.outlineStyle).not.toBe("none");
      expect(focusStyle.outlineWidth).not.toBe("0px");

      await page.getByRole("button", { name: copy.openAll }).click();
      const geometry = await assertSwitchGeometry(
        page,
        `${locale}/${info.project.name}`,
      );
      await assertNoOverflow(page, `${locale}/${info.project.name}`);
      const violations = (
        await new AxeBuilder({ page }).include("#main-content").analyze()
      ).violations.filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      );
      expect(violations).toEqual([]);
      await info.attach("features-short-screen-identity", {
        body: JSON.stringify({
          identity,
          locale,
          project: info.project.name,
          geometry,
          violations,
          scope:
            "read-only Features settings discovery; no feature writes, fixture mutation, provider calls or native-device acceptance",
        }),
        contentType: "application/json",
      });
    } finally {
      await context.close();
    }
  });
}
