/**
 * Bounded assistant Analytics discovery proof.
 *
 * This covers the parent Explore tab, effective gamification dependency and the
 * assistant's role filter. Assistant responses are intercepted at the local
 * `/api/assistant` boundary with a synthetic proposal; no provider is enabled.
 * Feature PATCHes are intercepted before dispatch, so the disposable fixture
 * family is never changed and needs no database cleanup.
 */
import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { isFeatureEnabled, type FamilyFeatures } from "../src/lib/features";
import { FIXTURE_EMAILS, FIXTURE_PASSWORD } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { E2E_ANCHOR, authFile } from "./support/env";
import { browserFetch, expect, test } from "./support/test";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PROJECTS = new Set([
  "phone-390x844",
  "phone-430x932",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
  "tablet-large-1920x1200",
  "desktop-1366x768",
]);
const ALLOWED_MUTATIONS = new Set([
  "/api/assistant",
  "/api/auth/login",
  "/api/family/features",
]);

type Who = "parentA" | "teenA" | "childA";

type FeatureState = {
  initial: FamilyFeatures;
  current: FamilyFeatures;
  patches: Array<{ key: string; enabled: boolean }>;
};

type GuardState = {
  assistant: boolean;
  features: { current: FeatureState | null };
  assistantRequests: Array<{ message: string }>;
  externalRequests: string[];
};

function checkedHead(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function checkedTree(): string {
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();
  const expected = process.env.E2E_ASSISTANT_BUILD_TREE?.trim();
  if (expected) expect(tree).toBe(expected);
  return tree;
}

function compiledBuiltAt(): string {
  const versionRoute = fs.readFileSync(
    ".next/server/app/api/version/route.js",
    "utf8",
  );
  const values = [
    ...new Set(
      versionRoute.match(/20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g) ?? [],
    ),
  ];
  expect(values).toHaveLength(1);
  return values[0]!;
}

function assertCleanTrackedAppSource(): void {
  expect(() =>
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "prisma"], {
      stdio: "ignore",
    }),
  ).not.toThrow();
}

async function runtimeIdentity(
  page: Page,
  info: TestInfo,
  role: "parent" | "teen" | "child",
) {
  const response = await page.evaluate(async () => {
    const result = await fetch("/api/version", { credentials: "same-origin" });
    return { status: result.status, body: await result.text() };
  });
  expect(response.status, response.body).toBe(200);
  const runtime = JSON.parse(response.body) as {
    version: string;
    commit: string;
    builtAt: string;
  };
  const head = checkedHead();
  expect(runtime.commit).toBe(head);
  if (process.env.RELEASE_SHA?.trim())
    expect(process.env.RELEASE_SHA.trim()).toBe(head);
  assertCleanTrackedAppSource();
  expect(runtime.builtAt).toBe(compiledBuiltAt());
  const identity = {
    runtime,
    buildId: fs.readFileSync(".next/BUILD_ID", "utf8").trim(),
    buildTree: checkedTree(),
    role,
    locale: "en",
    transport:
      "synthetic local assistant proposal; feature PATCH intercepted before dispatch; no provider or domain write",
  };
  expect(identity.buildId).not.toBe("");
  expect(identity.buildTree).toMatch(/^[a-f0-9]{40}$/);
  await info.attach(`assistant-analytics-runtime-${role}`, {
    body: JSON.stringify(identity),
    contentType: "application/json",
  });
  return identity;
}

async function installGuard(
  context: BrowserContext,
  state: GuardState,
): Promise<void> {
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const loopback = LOOPBACK_HOSTS.has(url.hostname);
    const localProtocol = ["data:", "blob:"].includes(url.protocol);

    if (!loopback && !localProtocol) {
      state.externalRequests.push(request.url());
      await route.abort();
      return;
    }

    if (
      loopback &&
      url.pathname === "/api/assistant" &&
      request.method() === "POST" &&
      state.assistant
    ) {
      const body = request.postDataJSON() as {
        messages?: Array<{ role?: unknown; content?: unknown }>;
      } | null;
      const last = body?.messages?.at(-1);
      if (last?.role !== "user" || typeof last.content !== "string") {
        await route.abort();
        return;
      }
      state.assistantRequests.push({ message: last.content });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "private, no-store" },
        body: JSON.stringify({
          reply: "Synthetic analytics navigation proposal",
          action: { kind: "open", destination: "analytics" },
        }),
      });
      return;
    }

    if (
      loopback &&
      url.pathname === "/api/family/features" &&
      request.method() === "PATCH" &&
      state.features.current
    ) {
      const body = request.postDataJSON() as {
        key?: unknown;
        enabled?: unknown;
      } | null;
      if (
        (body?.key !== "gamification" && body?.key !== "analytics") ||
        typeof body.enabled !== "boolean"
      ) {
        await route.abort();
        return;
      }
      const featureState = state.features.current;
      featureState.current = {
        ...featureState.current,
        [body.key]: body.enabled,
      };
      featureState.patches.push({
        key: body.key,
        enabled: body.enabled,
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ features: featureState.current }),
      });
      return;
    }

    if (
      loopback &&
      !["GET", "HEAD"].includes(request.method()) &&
      !ALLOWED_MUTATIONS.has(url.pathname)
    ) {
      await route.abort();
      return;
    }
    await route.continue();
  });
}

async function openAs(
  browser: Browser,
  baseURL: string,
  info: TestInfo,
  who: Who,
  state: GuardState,
): Promise<{ context: BrowserContext; page: Page; writes: string[] }> {
  const use = info.project.use;
  const context = await browser.newContext({
    baseURL,
    viewport: use.viewport,
    deviceScaleFactor: use.deviceScaleFactor,
    hasTouch: use.hasTouch,
    isMobile: use.isMobile,
    timezoneId: use.timezoneId,
    colorScheme: "light",
    reducedMotion: "reduce",
    storageState: who === "teenA" ? authFile("parentA") : authFile(who),
    extraHTTPHeaders: use.extraHTTPHeaders,
  });
  try {
    if (who === "teenA") {
      const login = await context.request.post("/api/auth/login", {
        data: {
          email: FIXTURE_EMAILS.familyA.teen,
          password: FIXTURE_PASSWORD,
        },
      });
      expect(login.status(), await login.text()).toBe(200);
    }
    await context.addInitScript(
      ({ localeKey, themeKey }) => {
        localStorage.setItem(localeKey, "en");
        localStorage.setItem(themeKey, "light");
      },
      { localeKey: LOCALE_STORAGE_KEY, themeKey: THEME_STORAGE_KEY },
    );
    await installGuard(context, state);
    const page = await context.newPage();
    await page.clock.install({ time: E2E_ANCHOR });
    const writes: string[] = [];
    page.on("request", (request) => {
      if (!["GET", "HEAD"].includes(request.method()))
        writes.push(new URL(request.url()).pathname);
    });
    return { context, page, writes };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function goMore(page: Page): Promise<void> {
  const nav =
    page.viewportSize()!.width < 768
      ? page.getByRole("navigation", { name: "Tabs", exact: true })
      : page.getByTestId("top-tabs");
  const more = nav.getByRole("link", { name: "Explore", exact: true });
  await expect(more).toHaveCount(1);
  await expect(more).toBeVisible();
  await expect(more).toHaveAttribute("href", "/dashboard/family/more");
  await more.click();
  await expect(page).toHaveURL(/\/dashboard\/family\/more\/?$/);
}

async function goToday(page: Page): Promise<void> {
  const today = page.locator('a[href="/dashboard/today"]:visible').first();
  await expect(today).toBeVisible();
  await today.click();
  await expect(page).toHaveURL(/\/dashboard\/today\/?$/);
}

async function goFeatures(page: Page): Promise<void> {
  const features = page
    .locator('a[href="/dashboard/features"]:visible')
    .first();
  await expect(features).toBeVisible();
  await features.click();
  await expect(page).toHaveURL(/\/dashboard\/features\/?$/);
}

async function ensureAnalyticsEnabled(
  page: Page,
  state: FeatureState,
): Promise<void> {
  await page.goto("/dashboard/features");
  if (state.current.gamification !== true) {
    const toggle = page.getByRole("switch", {
      name: "Enable Points & streaks",
      exact: true,
    });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(
      page.getByRole("switch", {
        name: "Disable Points & streaks",
        exact: true,
      }),
    ).toHaveAttribute("aria-checked", "true");
  }
  if (!isFeatureEnabled(state.current, "analytics")) {
    const toggle = page.getByRole("switch", {
      name: "Enable Analytics",
      exact: true,
    });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(
      page.getByRole("switch", { name: "Disable Analytics", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
  }
  expect(isFeatureEnabled(state.current, "analytics")).toBe(true);
}

async function disableGamification(
  page: Page,
  state: FeatureState,
): Promise<void> {
  const toggle = page.getByRole("switch", {
    name: "Disable Points & streaks",
    exact: true,
  });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(
    page.getByRole("switch", {
      name: "Enable Points & streaks",
      exact: true,
    }),
  ).toHaveAttribute("aria-checked", "false");
  expect(isFeatureEnabled(state.current, "analytics")).toBe(false);
}

async function askForAnalytics(
  page: Page,
  expectProposal: boolean,
): Promise<void> {
  const launcher = page
    .getByRole("navigation", { name: "Today quick actions" })
    .getByRole("button", { name: "Add or ask", exact: true });
  await expect(launcher).toBeVisible();
  await launcher.click();
  const quickAdd = page.getByTestId("quick-add-dialog");
  await expect(quickAdd).toBeVisible();
  await quickAdd.getByRole("button", { name: /Ask the assistant/ }).click();
  const dialog = page.getByRole("dialog", {
    name: "AI assistant",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel("Your message", { exact: true })
    .fill("Open Analytics");
  await dialog.getByRole("button", { name: "Send", exact: true }).click();
  await expect(dialog.getByRole("log")).toContainText(
    "Synthetic analytics navigation proposal",
  );
  const proposal = dialog.locator('[aria-label="Review proposed action"]');
  if (expectProposal) {
    await expect(proposal).toBeVisible();
    await expect(proposal).toContainText("Open Analytics");
    await proposal
      .getByRole("button", { name: "Open section", exact: true })
      .click();
    await expect(page).toHaveURL(/\/dashboard\/analytics\/?$/);
  } else {
    await expect(proposal).toHaveCount(0);
    await expect(page).toHaveURL(/\/dashboard\/today\/?$/);
  }
}

test("parent, teen and child Analytics assistant discovery obey effective role gates", async ({
  browser,
  baseURL,
}, info) => {
  test.skip(
    !PROJECTS.has(info.project.name),
    "Analytics assistant proof runs at the six representative sizes",
  );
  assertFixtureTargetAllowed(process.env);
  expect(baseURL).toBeTruthy();
  expect(LOOPBACK_HOSTS.has(new URL(baseURL!).hostname)).toBe(true);

  const parentState: GuardState = {
    assistant: true,
    features: { current: null },
    assistantRequests: [],
    externalRequests: [],
  };
  const parent = await openAs(browser, baseURL!, info, "parentA", parentState);
  try {
    await parent.page.goto("/dashboard/today");
    await expect(parent.page.locator("html")).toHaveAttribute("lang", "en");
    await runtimeIdentity(parent.page, info, "parent");

    const featureResponse = await browserFetch(
      parent.page,
      "/api/family/features",
    );
    expect(featureResponse.status, featureResponse.body).toBe(200);
    const initial = JSON.parse(featureResponse.body).features as FamilyFeatures;
    parentState.features.current = {
      initial: { ...initial },
      current: { ...initial },
      patches: [],
    };
    const featureState = parentState.features.current;
    expect(featureState).not.toBeNull();

    // The fixture is normally already enabled, but this synthetic setup also
    // handles an earlier isolated run that left Analytics or its dependency off.
    await ensureAnalyticsEnabled(parent.page, featureState!);
    await goMore(parent.page);
    const moreList = parent.page.getByTestId("more-list");
    const analyticsLink = moreList.locator('a[href="/dashboard/analytics"]');
    await expect(analyticsLink).toHaveCount(1);
    await expect(analyticsLink).toBeVisible();
    await analyticsLink.click();
    await expect(parent.page).toHaveURL(/\/dashboard\/analytics\/?$/);
    await goToday(parent.page);
    await askForAnalytics(parent.page, true);

    // Turn only the dependency off through an intercepted PATCH. The provider
    // state changes in the mounted FeaturesProvider, while the fixture DB stays
    // at its original map for every other role and test.
    await goMore(parent.page);
    await goFeatures(parent.page);
    await disableGamification(parent.page, featureState!);
    await goMore(parent.page);
    await expect(
      parent.page
        .getByTestId("more-list")
        .locator('a[href="/dashboard/analytics"]'),
    ).toHaveCount(0);
    await goToday(parent.page);
    await askForAnalytics(parent.page, false);

    const unchanged = await browserFetch(parent.page, "/api/family/features");
    expect(unchanged.status, unchanged.body).toBe(200);
    expect(JSON.parse(unchanged.body).features).toEqual(featureState!.initial);
    expect(parentState.externalRequests).toEqual([]);
    expect(parent.writes.every((path) => ALLOWED_MUTATIONS.has(path))).toBe(
      true,
    );
    expect(parentState.assistantRequests).toHaveLength(2);
    expect(
      parentState.features.current!.patches.every((patch) =>
        ["gamification", "analytics"].includes(patch.key),
      ),
    ).toBe(true);
    expect(
      parentState.features.current!.patches.some(
        (patch) => patch.key === "gamification" && patch.enabled === false,
      ),
    ).toBe(true);
  } finally {
    await parent.context.close();
  }

  const teenState: GuardState = {
    assistant: true,
    features: { current: null },
    assistantRequests: [],
    externalRequests: [],
  };
  const teen = await openAs(browser, baseURL!, info, "teenA", teenState);
  try {
    await teen.page.goto("/dashboard/today");
    await runtimeIdentity(teen.page, info, "teen");
    await askForAnalytics(teen.page, false);
    expect(teenState.externalRequests).toEqual([]);
    expect(teen.writes).toEqual(["/api/assistant"]);
    expect(teenState.assistantRequests).toHaveLength(1);
  } finally {
    await teen.context.close();
  }

  const childState: GuardState = {
    assistant: false,
    features: { current: null },
    assistantRequests: [],
    externalRequests: [],
  };
  const child = await openAs(browser, baseURL!, info, "childA", childState);
  try {
    await child.page.goto("/dashboard/today");
    await runtimeIdentity(child.page, info, "child");
    await expect(
      child.page.getByRole("button", { name: "Add or ask", exact: true }),
    ).toHaveCount(0);
    const refusal = await child.page.evaluate(async () => {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Open Analytics" }],
          localNow: new Date().toString(),
          timeZone: "America/Toronto",
        }),
      });
      return { status: response.status, body: await response.text() };
    });
    expect(refusal.status, refusal.body).toBe(403);
    expect(childState.externalRequests).toEqual([]);
    expect(child.writes).toEqual(["/api/assistant"]);
    expect(childState.assistantRequests).toEqual([]);
  } finally {
    await child.context.close();
  }
});
