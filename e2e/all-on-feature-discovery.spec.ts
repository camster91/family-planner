/**
 * #499: parent all-on More/Features discovery. This QA changes only the
 * disposable Family A feature row through its real parent API, then restores
 * the exact canonical map. Role controls already have their bounded R36
 * coverage in all-feature-role-controls.spec.ts.
 */
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import { FEATURES, type FamilyFeatures } from "../src/lib/features";
import { moreItemsFor } from "../src/lib/nav-items";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { authFile } from "./support/env";
import { ownFeatureAudit } from "./support/feature-audit";
import { browserFetch, browserSend, expect, test } from "./support/test";

const ALL_ON: FamilyFeatures = Object.fromEntries(
  FEATURES.map((feature) => [feature.key, true]),
) as FamilyFeatures;

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const FEATURE_KEYS = FEATURES.map((feature) => feature.key);
const ALLOWED_MUTATIONS = new Set([
  "PATCH /api/family/features",
  "POST /api/auth/login",
]);

type ApiObservation = {
  method: string;
  path: string;
  status: number;
  body?: unknown;
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
        "parent More and Features all-on discovery; guarded Family A feature row; no domain writes",
    }),
    contentType: "application/json",
  });
  return { runtime, sourceCommit: head, sourceTree: tree };
}

function parseFeatureMap(body: string, label: string): FamilyFeatures {
  const parsed = JSON.parse(body) as { features?: unknown };
  const map = parsed.features;
  expect(map, label).toBeDefined();
  expect(typeof map, label).toBe("object");
  expect(Array.isArray(map), label).toBe(false);
  const record = map as Record<string, unknown>;
  expect(Object.keys(record).sort(), label).toEqual([...FEATURE_KEYS].sort());
  for (const key of FEATURE_KEYS) {
    expect(typeof record[key], `${label}: ${key}`).toBe("boolean");
  }
  return record as FamilyFeatures;
}

function observeFeatureTransport(
  page: Page,
  api: ApiObservation[],
  domainWrites: string[],
) {
  const pendingResponses = new Set<Promise<void>>();
  page.on("request", (request) => {
    if (!MUTATING_METHODS.has(request.method())) return;
    const path = new URL(request.url()).pathname;
    const mutation = `${request.method()} ${path}`;
    if (!ALLOWED_MUTATIONS.has(mutation)) domainWrites.push(mutation);
  });
  page.on("response", (response) => {
    const request = response.request();
    const path = new URL(request.url()).pathname;
    if (path !== "/api/family/features") return;
    const pending = Promise.resolve().then(() => {
      const raw = request.postData();
      let body: unknown;
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      api.push({
        method: request.method(),
        path,
        status: response.status(),
        body,
      });
    });
    pendingResponses.add(pending);
    void pending.then(
      () => pendingResponses.delete(pending),
      () => pendingResponses.delete(pending),
    );
  });
  return async () => {
    while (pendingResponses.size > 0) {
      await Promise.all([...pendingResponses]);
    }
  };
}

async function installRequestFirewall(
  context: BrowserContext,
  blockedMutations: string[],
) {
  await context.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const local =
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      ["data:", "blob:"].includes(url.protocol);
    if (!local) {
      if (MUTATING_METHODS.has(method)) {
        blockedMutations.push(`${method} ${url.origin}${url.pathname}`);
      }
      return route.abort();
    }

    if (!MUTATING_METHODS.has(method)) return route.continue();
    const mutation = `${method} ${url.pathname}`;
    if (ALLOWED_MUTATIONS.has(mutation)) return route.continue();
    blockedMutations.push(mutation);
    return route.abort();
  });
}

async function setAndVerifyFeatures(
  page: Page,
  features: FamilyFeatures,
  label: string,
) {
  const response = await browserSend(page, "PATCH", "/api/family/features", {
    features,
  });
  expect(response.status, `${label} PATCH: ${response.body}`).toBe(200);
  expect(parseFeatureMap(response.body, `${label} PATCH response`)).toEqual(
    features,
  );
  const canonical = await browserFetch(page, "/api/family/features");
  expect(canonical.status, `${label} GET: ${canonical.body}`).toBe(200);
  expect(parseFeatureMap(canonical.body, `${label} canonical GET`)).toEqual(
    features,
  );
}

async function restoreAndVerifyFeatures(
  page: Page,
  originalFeatures: FamilyFeatures,
) {
  let response: { status: number; body: string } | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await browserSend(page, "PATCH", "/api/family/features", {
        features: originalFeatures,
      });
      if (response.status === 200 || response.status < 500) break;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  expect(response, "feature restore response").toBeDefined();
  expect(response!.status, `feature restore PATCH: ${response!.body}`).toBe(
    200,
  );
  expect(
    parseFeatureMap(response!.body, "feature restore PATCH response"),
  ).toEqual(originalFeatures);
  const canonical = await browserFetch(page, "/api/family/features");
  expect(canonical.status, `feature restore GET: ${canonical.body}`).toBe(200);
  expect(
    parseFeatureMap(canonical.body, "feature restore canonical GET"),
  ).toEqual(originalFeatures);
}

function expectedMore(features: FamilyFeatures) {
  return moreItemsFor("parent", features);
}

function errorSummary(error: unknown) {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
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
  const main = page.locator("#main-content");
  await expect(
    main.getByRole("heading", { name: "Features", exact: true }),
  ).toBeVisible();
  const switches = main.getByRole("switch");
  expect(await switches.count()).toBe(FEATURES.length);
  const enabledToggles: Locator[] = [];
  for (const feature of FEATURES) {
    const checked =
      features[feature.key] === true &&
      (!feature.requires || features[feature.requires] === true);
    const toggle = main.getByRole("switch", {
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
    await expect(main.getByText(feature.title, { exact: true })).toHaveCount(1);
    await expect(
      main.getByText(feature.description, { exact: true }),
    ).toHaveCount(1);
    if (
      feature.group !== "core" &&
      !(feature.requires && !features[feature.requires])
    ) {
      enabledToggles.push(toggle);
    }
  }

  // Disabled HTML buttons are excluded from keyboard focus. Start at the
  // first enabled switch and traverse only enabled controls; if a disabled
  // core/dependent switch entered the tab sequence, the next expectation
  // would fail at that exact position.
  if (enabledToggles.length > 0) {
    await enabledToggles[0]!.focus();
    await expect(enabledToggles[0]!).toBeFocused();
    for (let index = 1; index < enabledToggles.length; index += 1) {
      await page.keyboard.press("Tab");
      await expect(enabledToggles[index]!).toBeFocused();
    }
  }
  await assertNoHorizontalOverflow(page);
  await assertMainA11y(page);
}

for (const locale of ["en", "es"] as const) {
  test(`${locale}: parent all-on More and Features stay discoverable and dependency-aware`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    assertFixtureTargetAllowed(process.env);
    expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
      new URL(baseURL!).hostname,
    );
    const featureApi: ApiObservation[] = [];
    const domainWrites: string[] = [];
    const blockedMutations: string[] = [];
    await installRequestFirewall(context, blockedMutations);
    const flushFeatureTransport = observeFeatureTransport(
      page,
      featureApi,
      domainWrites,
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

    const bootstrap = await page.goto("/dashboard");
    expect(bootstrap?.status()).toBe(200);
    const profileResponse = await browserFetch(page, "/api/users");
    expect(profileResponse.status, profileResponse.body).toBe(200);
    const profile = JSON.parse(profileResponse.body).user as {
      id?: string;
      family_id?: string | null;
      role?: string;
    };
    expect(profile.id).toBe(FIXTURE_IDS.familyA.parent);
    expect(profile.family_id).toBe(FIXTURE_IDS.familyA.family);
    expect(profile.role).toBe("parent");
    const originalResponse = await browserFetch(page, "/api/family/features");
    expect(originalResponse.status, originalResponse.body).toBe(200);
    const originalFeatures = parseFeatureMap(
      originalResponse.body,
      "original canonical GET",
    );
    const cleanFeatureAudit = await ownFeatureAudit(FEATURE_KEYS);
    let testFailure: unknown;
    let restored = false;
    let evidence:
      | {
          runtime: Awaited<ReturnType<typeof attachRuntimeIdentity>>;
          dependencyOff: FamilyFeatures;
        }
      | undefined;

    try {
      await setAndVerifyFeatures(page, ALL_ON, "all-on");
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
      expect(
        parseFeatureMap(featureResponse.body, "all-on canonical GET"),
      ).toEqual(ALL_ON);
      await assertMoreSurface(page, ALL_ON);

      const featuresResponse = await page.goto("/dashboard/features");
      expect(featuresResponse?.status()).toBe(200);
      await assertFeaturesSurface(page, ALL_ON);
      const gamification = page.getByRole("switch", {
        name: /^(?:Disable|Enable) Points & streaks$/,
      });
      await expect(gamification).toHaveAttribute("aria-checked", "true");
      const dependencyOff = { ...ALL_ON, gamification: false };
      const gamificationPatchPromise = page.waitForResponse((response) => {
        const request = response.request();
        return (
          request.method() === "PATCH" &&
          new URL(response.url()).pathname === "/api/family/features"
        );
      });
      await gamification.click();
      const gamificationPatch = await gamificationPatchPromise;
      expect(gamificationPatch.status()).toBe(200);
      const requestBody = gamificationPatch.request().postData();
      expect(requestBody).toBeTruthy();
      expect(JSON.parse(requestBody!)).toEqual({
        key: "gamification",
        enabled: false,
      });
      expect(
        parseFeatureMap(
          await gamificationPatch.text(),
          "gamification PATCH response",
        ),
      ).toEqual(dependencyOff);
      await flushFeatureTransport();
      const gamificationOff = page.getByRole("switch", {
        name: "Enable Points & streaks",
        exact: true,
      });
      await expect(gamificationOff).toHaveAttribute("aria-checked", "false");
      await expect(
        page.getByRole("switch", { name: "Enable Rewards", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("switch", { name: "Enable Analytics", exact: true }),
      ).toBeDisabled();

      const dependencyResponse = await browserFetch(
        page,
        "/api/family/features",
      );
      expect(dependencyResponse.status, dependencyResponse.body).toBe(200);
      expect(
        parseFeatureMap(dependencyResponse.body, "gamification canonical GET"),
      ).toEqual(dependencyOff);
      const dependencyMoreResponse = await page.goto("/dashboard/family/more");
      expect(dependencyMoreResponse?.status()).toBe(200);
      await assertMoreSurface(page, dependencyOff);
      await expect(page.locator('a[href="/dashboard/rewards"]')).toHaveCount(0);
      await expect(page.locator('a[href="/dashboard/analytics"]')).toHaveCount(
        0,
      );
      evidence = { runtime, dependencyOff };
    } catch (error) {
      testFailure = error;
    }

    const cleanupFailures: unknown[] = [];
    try {
      await restoreAndVerifyFeatures(page, originalFeatures);
      restored = true;
    } catch (error) {
      cleanupFailures.push(error);
    }
    try {
      await cleanFeatureAudit(restored);
    } catch (error) {
      cleanupFailures.push(error);
    }
    try {
      await flushFeatureTransport();
    } catch (error) {
      cleanupFailures.push(error);
    }

    if (evidence) {
      const featureObservations = featureApi.filter(
        (observation) => observation.path === "/api/family/features",
      );
      try {
        expect(
          featureObservations.every(
            (observation) => observation.status === 200,
          ),
        ).toBe(true);
        expect(
          featureObservations.some(
            (observation) =>
              observation.method === "PATCH" &&
              (observation.body as { key?: string; enabled?: boolean })?.key ===
                "gamification" &&
              (observation.body as { key?: string; enabled?: boolean })
                ?.enabled === false,
          ),
        ).toBe(true);
        expect(domainWrites).toEqual([]);
        expect(blockedMutations).toEqual([]);
      } catch (error) {
        testFailure = testFailure ?? error;
      }
      await info.attach("all-on-discovery-api-and-scope", {
        body: JSON.stringify({
          runtime: evidence.runtime,
          locale,
          allOnKeys: FEATURE_KEYS,
          allOnMoreHrefs: expectedMore(ALL_ON).map((item) => item.href),
          dependencyOffMoreHrefs: expectedMore(evidence.dependencyOff).map(
            (item) => item.href,
          ),
          featureApi: featureObservations,
          domainWrites,
          blockedMutations,
          restored,
          scope:
            "real parent feature API; guarded Family A feature row restored; no domain writes",
        }),
        contentType: "application/json",
      });
    }

    if (cleanupFailures.length) {
      throw new AggregateError(
        [...(testFailure ? [testFailure] : []), ...cleanupFailures],
        `All-on discovery cleanup failed: ${cleanupFailures.map(errorSummary).join("; ")}`,
      );
    }
    if (testFailure) throw testFailure;
  });
}
