/** Initial-load recovery for the parent-only Babysitter Handoff feature. */
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { LOCALE_STORAGE_KEY, messages } from "../src/i18n";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { ownFeatureAudit } from "./support/feature-audit";
import { authFile } from "./support/env";
import { browserFetch, browserSend, expect, test } from "./support/test";

const PROJECTS = [
  "phone-390x844",
  "phone-430x932",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
  "tablet-large-1920x1200",
  "desktop-1366x768",
] as const;

test.use({ storageState: authFile("parentA") });

function checkedSourceTree() {
  const actual = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();
  const configured = process.env.E2E_HANDOFF_BUILD_TREE?.trim();
  if (configured) expect(configured).toBe(actual);
  return actual;
}

function checkedCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
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
      "Tracked app source differs from HEAD; rebuild handoff QA from the checked-out commit.",
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

async function runtimeIdentity(
  page: Page,
  info: TestInfo,
  locale: "en" | "es",
) {
  const response = await browserFetch(page, "/api/version");
  expect(response.status, response.body).toBe(200);
  const runtime = JSON.parse(response.body) as {
    version: string;
    commit: string;
    builtAt: string;
  };
  const expectedCommit = checkedCommit();
  expect(runtime.commit).toBe(expectedCommit);
  const releaseSha = process.env.RELEASE_SHA?.trim();
  if (releaseSha) expect(releaseSha).toBe(expectedCommit);
  assertCleanTrackedAppSource();
  expect(runtime.builtAt).toBe(compiledBuiltAt());

  const identity = {
    runtime,
    buildId: fs.readFileSync(".next/BUILD_ID", "utf8").trim(),
    buildTree: checkedSourceTree(),
    locale,
    role: "parent",
    canonicalFeatureTransport: "PATCH /api/family/features enable and restore",
    handoffTransport: "GET /api/handoff synthetic 503 then empty 200",
  };
  expect(identity.buildId).not.toBe("");
  expect(identity.buildTree).toMatch(/^[a-f0-9]{40}$/);
  await info.attach("actual-handoff-runtime-identity", {
    body: JSON.stringify(identity),
    contentType: "application/json",
  });
  return identity;
}

async function captureState(
  page: Page,
  info: TestInfo,
  state: "error" | "loading" | "empty",
  identity: Awaited<ReturnType<typeof runtimeIdentity>>,
) {
  const overflowFree = await page.evaluate(
    () => document.documentElement.scrollWidth <= innerWidth,
  );
  const violations = (
    await new AxeBuilder({ page }).include("#main-content").analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  await info.attach(`${state}-source-identity`, {
    body: JSON.stringify({ identity, state, overflowFree, violations }),
    contentType: "application/json",
  });
  await info.attach(`${state}-axe`, {
    body: JSON.stringify(violations),
    contentType: "application/json",
  });
  await page.screenshot({
    path: info.outputPath(`handoff-${state}.png`),
    fullPage: true,
  });
  expect(overflowFree).toBe(true);
  expect(violations).toEqual([]);
}

for (const locale of ["en", "es"] as const) {
  const copy = messages[locale];

  test(`${locale}: handoff initial load can recover with a localized Retry`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.skip(
      !PROJECTS.includes(info.project.name as (typeof PROJECTS)[number]),
      "Handoff recovery runs at the six representative responsive sizes",
    );
    assertFixtureTargetAllowed(process.env);
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
    await context.addInitScript(
      ({ key, language }) => localStorage.setItem(key, language),
      { key: LOCALE_STORAGE_KEY, language: locale },
    );

    await page.goto("/dashboard");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const identity = await runtimeIdentity(page, info, locale);
    const featuresResponse = await browserFetch(page, "/api/family/features");
    expect(featuresResponse.status, featuresResponse.body).toBe(200);
    const originalFeatures = JSON.parse(featuresResponse.body)
      .features as Record<string, boolean>;

    const cleanFeatureAudit = await ownFeatureAudit(["handoff"]);

    let handoffAttempts = 0;
    const releaseSuccessfulResponse = {
      current: null as (() => void) | null,
    };
    const successfulResponse = new Promise<void>((resolve) => {
      releaseSuccessfulResponse.current = resolve;
    });

    await page.route("**/api/handoff**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() !== "GET" || url.pathname !== "/api/handoff") {
        await route.continue();
        return;
      }

      handoffAttempts += 1;
      if (handoffAttempts === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Synthetic initial handoff refusal" }),
        });
        return;
      }

      await successfulResponse;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ handoffs: [] }),
      });
    });

    try {
      const enabled = await browserSend(page, "PATCH", "/api/family/features", {
        features: { ...originalFeatures, handoff: true },
      });
      expect(enabled.status, enabled.body).toBe(200);

      const firstHandoffResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "GET" &&
          new URL(response.url()).pathname === "/api/handoff",
      );
      await page.goto("/dashboard/handoff");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);

      const main = page.locator("#main-content");
      const loadError = main.getByRole("alert");
      await expect(loadError).toContainText(copy.handoff.errorLoad);
      expect((await firstHandoffResponse).status()).toBe(503);
      expect(handoffAttempts).toBe(1);
      await captureState(page, info, "error", identity);

      const retry = main.getByRole("button", {
        name: copy.routeState.tryAgain,
        exact: true,
      });
      await expect(retry).toBeVisible();
      const retryBox = await retry.boundingBox();
      expect(retryBox).not.toBeNull();
      expect(retryBox!.height).toBeGreaterThanOrEqual(44);
      expect(retryBox!.width).toBeGreaterThanOrEqual(44);

      const retryResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "GET" &&
          new URL(response.url()).pathname === "/api/handoff",
      );
      await retry.click();
      await expect(
        main.getByText(copy.common.loading, { exact: true }),
      ).toBeVisible();
      expect(handoffAttempts).toBe(2);
      await captureState(page, info, "loading", identity);

      releaseSuccessfulResponse.current?.();
      expect((await retryResponse).status()).toBe(200);
      await expect(
        main.getByRole("heading", { name: copy.handoff.empty, exact: true }),
      ).toBeVisible();
      await expect(loadError).toHaveCount(0);
      await captureState(page, info, "empty", identity);
    } finally {
      releaseSuccessfulResponse.current?.();
      try {
        let restored;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            restored = await browserSend(
              page,
              "PATCH",
              "/api/family/features",
              {
                features: originalFeatures,
              },
            );
            if (restored.status === 200 || restored.status < 500) break;
          } catch (error) {
            if (attempt === 1) throw error;
          }
        }
        expect(restored).toBeDefined();
        expect(restored!.status, restored!.body).toBe(200);
        const canonical = await browserFetch(page, "/api/family/features");
        expect(canonical.status, canonical.body).toBe(200);
        expect(
          (JSON.parse(canonical.body) as { features: unknown }).features,
        ).toEqual(originalFeatures);
      } finally {
        try {
          await cleanFeatureAudit();
        } finally {
          await page.unroute("**/api/handoff**");
        }
      }
    }
  });
}
