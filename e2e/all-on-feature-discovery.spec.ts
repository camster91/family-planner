/**
 * #499: parent all-on More/Features discovery. The feature transport and the
 * server-rendered feature seed are intercepted so this QA never changes a
 * household row. Role controls already have their bounded R36 coverage in
 * all-feature-role-controls.spec.ts.
 */
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { Page, Route, TestInfo } from "@playwright/test";
import { FEATURES, type FamilyFeatures } from "../src/lib/features";
import { moreItemsFor } from "../src/lib/nav-items";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { authFile } from "./support/env";
import { replaceFeatureSeed } from "./support/feature-seed";
import { browserFetch, expect, test } from "./support/test";

const ALL_ON: FamilyFeatures = Object.fromEntries(
  FEATURES.map((feature) => [feature.key, true]),
) as FamilyFeatures;

const DOCUMENT_PATH = /\/dashboard\/(?:family\/more|features)(?:\?.*)?$/;
const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

type ApiObservation = {
  method: string;
  path: string;
  status: number;
  body?: unknown;
};

type FeatureTransport = {
  features: FamilyFeatures;
  api: ApiObservation[];
  domainWrites: string[];
};

test.use({ storageState: authFile("parentA") });

function checkedCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function checkedTree() {
  return execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();
}

function assertCleanTrackedAppSource() {
  try {
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "prisma"], {
      stdio: "ignore",
    });
  } catch {
    throw new Error(
      "Tracked app source differs from HEAD; rebuild all-on discovery QA from the checked-out commit.",
    );
  }
}

function compiledBuiltAt() {
  const source = fs.readFileSync(
    ".next/server/app/api/version/route.js",
    "utf8",
  );
  const times = [
    ...new Set(source.match(/20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g) ?? []),
  ];
  expect(times).toHaveLength(1);
  return times[0]!;
}

async function attachRuntimeIdentity(
  page: Page,
  info: TestInfo,
  locale: string,
) {
  const response = await browserFetch(page, "/api/version");
  expect(response.status, response.body).toBe(200);
  const runtime = JSON.parse(response.body) as {
    version: string;
    commit: string;
    builtAt: string;
  };
  const head = checkedCommit();
  const tree = checkedTree();
  expect(runtime.version).not.toBe("");
  expect(runtime.commit).toBe(head);
  if (process.env.RELEASE_SHA?.trim()) {
    expect(process.env.RELEASE_SHA.trim()).toBe(head);
  }
  assertCleanTrackedAppSource();
  expect(runtime.builtAt).toBe(compiledBuiltAt());
  await info.attach("all-on-discovery-runtime-identity", {
    body: JSON.stringify({
      runtime,
      sourceCommit: head,
      sourceTree: tree,
      locale,
      role: "parentA",
      scope:
        "parent More and Features all-on discovery; feature API intercepted; no domain writes",
    }),
    contentType: "application/json",
  });
  return { runtime, sourceCommit: head, sourceTree: tree };
}

async function installInterceptedFeatureTransport(
  page: Page,
  transport: FeatureTransport,
) {
  page.on("request", (request) => {
    if (!MUTATING_METHODS.has(request.method())) return;
    const path = new URL(request.url()).pathname;
    if (path !== "/api/family/features") {
      transport.domainWrites.push(`${request.method()} ${path}`);
    }
  });

  await page.route("**/api/family/features", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET") {
      transport.api.push({ method: "GET", path, status: 200 });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ features: transport.features }),
      });
    }
    if (request.method() === "PATCH") {
      const raw = request.postData() ?? "{}";
      const body = JSON.parse(raw) as {
        key?: string;
        enabled?: boolean;
        features?: Partial<FamilyFeatures>;
      };
      if (body.features && typeof body.features === "object") {
        transport.features = { ...transport.features, ...body.features };
      } else if (
        typeof body.key === "string" &&
        typeof body.enabled === "boolean" &&
        FEATURES.some((feature) => feature.key === body.key)
      ) {
        transport.features = {
          ...transport.features,
          [body.key]: body.enabled,
        };
      } else {
        throw new Error(`Unexpected feature PATCH body: ${raw}`);
      }
      transport.api.push({ method: "PATCH", path, status: 200, body });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ features: transport.features }),
      });
    }
    transport.api.push({ method: request.method(), path, status: 405 });
    return route.fulfill({
      status: 405,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unsupported test method" }),
    });
  });

  await page.route(DOCUMENT_PATH, async (route: Route) => {
    if (route.request().resourceType() !== "document") {
      return route.continue();
    }
    const response = await route.fetch();
    const body = await response.text();
    return route.fulfill({
      response,
      body: replaceFeatureSeed(body, transport.features),
    });
  });
}

function expectedMore(features: FamilyFeatures) {
  return moreItemsFor("parent", features);
}

async function assertNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

async function assertMainA11y(page: Page) {
  const results = await new AxeBuilder({ page })
    .include("#main-content")
    .analyze();
  const serious = results.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(serious).toEqual([]);
}

async function assertMoreSurface(page: Page, features: FamilyFeatures) {
  await expect(
    page.getByRole("heading", { name: "More", exact: true }),
  ).toBeVisible();
  const items = expectedMore(features);
  const list = page.getByTestId("more-list");
  const links = list.locator("a");
  const hrefs = await links.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("href")),
  );
  const expectedHrefs = items.map((item) => item.href);
  expect(hrefs).toEqual(expectedHrefs);
  expect(new Set(hrefs).size).toBe(expectedHrefs.length);
  expect(await links.count()).toBe(expectedHrefs.length);

  for (const item of items) {
    const link = list.locator(`a[href="${item.href}"]`);
    await expect(link).toHaveCount(1);
    await expect(link).toBeVisible();
    await expect(link).toContainText(item.title);
    const box = await link.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  const featuresLink = page.getByRole("link", {
    name: /Turn features on or off/,
  });
  await expect(featuresLink).toHaveCount(1);
  await expect(featuresLink).toBeVisible();

  // Verify keyboard order across the complete parent More surface, then into
  // its Features control. Each long feature label remains in the accessible DOM
  // even where the compact row uses visual truncation.
  for (const item of items) {
    await expect(list.locator(`a[href="${item.href}"]`)).toContainText(
      item.title,
    );
  }
  await links.first().focus();
  await expect(links.first()).toBeFocused();
  for (let index = 1; index < expectedHrefs.length; index += 1) {
    await page.keyboard.press("Tab");
    await expect(
      list.locator(`a[href="${expectedHrefs[index]}"]`),
    ).toBeFocused();
  }
  await page.keyboard.press("Tab");
  await expect(featuresLink).toBeFocused();

  await assertNoHorizontalOverflow(page);
  await assertMainA11y(page);
}

async function assertFeaturesSurface(page: Page, features: FamilyFeatures) {
  await expect(
    page.getByRole("heading", { name: "Features", exact: true }),
  ).toBeVisible();
  const switches = page.getByRole("switch");
  expect(await switches.count()).toBe(FEATURES.length);
  for (const feature of FEATURES) {
    const checked =
      features[feature.key] === true &&
      (!feature.requires || features[feature.requires] === true);
    const toggle = page.getByRole("switch", {
      name: `${checked ? "Disable" : "Enable"} ${feature.title}`,
      exact: true,
    });
    await expect(toggle).toHaveCount(1);
    await expect(toggle).toHaveAttribute("aria-checked", String(checked));
    if (
      feature.group === "core" ||
      (feature.requires && !features[feature.requires])
    ) {
      await expect(toggle).toBeDisabled();
    } else {
      await expect(toggle).toBeEnabled();
    }
    const box = await toggle.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByText(feature.title, { exact: true })).toHaveCount(1);
    await expect(
      page.getByText(feature.description, { exact: true }),
    ).toHaveCount(1);
  }

  for (const feature of FEATURES) {
    const checked =
      features[feature.key] === true &&
      (!feature.requires || features[feature.requires] === true);
    const toggle = page.getByRole("switch", {
      name: `${checked ? "Disable" : "Enable"} ${feature.title}`,
      exact: true,
    });
    await toggle.focus();
    await expect(toggle).toBeFocused();
  }
  await assertNoHorizontalOverflow(page);
  await assertMainA11y(page);
}

for (const locale of ["en", "es"] as const) {
  test(`${locale}: parent all-on More and Features stay discoverable and dependency-aware`, async ({
    page,
  }, info) => {
    assertFixtureTargetAllowed(process.env);
    const transport: FeatureTransport = {
      features: { ...ALL_ON },
      api: [],
      domainWrites: [],
    };
    await installInterceptedFeatureTransport(page, transport);
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

    const moreResponse = await page.goto("/dashboard/family/more");
    expect(moreResponse?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    if (locale === "es") {
      await expect(page.locator("html")).toHaveClass(/dark/);
    } else {
      await expect(page.locator("html")).not.toHaveClass(/dark/);
    }
    const runtime = await attachRuntimeIdentity(page, info, locale);
    const featureResponse = await browserFetch(page, "/api/family/features");
    expect(featureResponse.status, featureResponse.body).toBe(200);
    expect(JSON.parse(featureResponse.body).features).toEqual(ALL_ON);
    await assertMoreSurface(page, ALL_ON);

    const featuresResponse = await page.goto("/dashboard/features");
    expect(featuresResponse?.status()).toBe(200);
    await assertFeaturesSurface(page, ALL_ON);
    const gamification = page.getByRole("switch", {
      name: "Disable Points & streaks",
      exact: true,
    });
    await gamification.click();
    await expect(gamification).toHaveAttribute("aria-checked", "false");
    await expect(
      page.getByRole("switch", { name: "Enable Rewards", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("switch", { name: "Enable Analytics", exact: true }),
    ).toBeDisabled();

    const dependencyOff = { ...ALL_ON, gamification: false };
    const dependencyMoreResponse = await page.goto("/dashboard/family/more");
    expect(dependencyMoreResponse?.status()).toBe(200);
    await assertMoreSurface(page, dependencyOff);
    await expect(page.locator('a[href="/dashboard/rewards"]')).toHaveCount(0);
    await expect(page.locator('a[href="/dashboard/analytics"]')).toHaveCount(0);

    const featureApi = transport.api.filter(
      (observation) => observation.path === "/api/family/features",
    );
    expect(featureApi.every((observation) => observation.status === 200)).toBe(
      true,
    );
    expect(
      featureApi.some(
        (observation) =>
          observation.method === "PATCH" &&
          (observation.body as { key?: string; enabled?: boolean })?.key ===
            "gamification" &&
          (observation.body as { key?: string; enabled?: boolean })?.enabled ===
            false,
      ),
    ).toBe(true);
    expect(transport.domainWrites).toEqual([]);
    await info.attach("all-on-discovery-api-and-scope", {
      body: JSON.stringify({
        runtime,
        locale,
        allOnKeys: FEATURES.map((feature) => feature.key),
        allOnMoreHrefs: expectedMore(ALL_ON).map((item) => item.href),
        dependencyOffMoreHrefs: expectedMore(dependencyOff).map(
          (item) => item.href,
        ),
        featureApi,
        domainWrites: transport.domainWrites,
        scope:
          "server feature seed and feature API intercepted; no household/domain writes",
      }),
      contentType: "application/json",
    });
  });
}
