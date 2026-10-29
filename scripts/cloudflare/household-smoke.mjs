#!/usr/bin/env node

/**
 * A small, browser-level household smoke journey for the local runtime.
 *
 * This is deliberately one bounded journey, not a replacement for the E2E
 * suite. It uses fabricated accounts supplied by the caller, blocks every
 * request outside the loopback app origin, and never creates invites or calls
 * a provider. The root runtime runner owns starting the app and executing
 * this file.
 */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  tablet: { width: 800, height: 1280 },
  desktop: { width: 1366, height: 768 },
};

function readArg(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return undefined;
}

function required(value, name) {
  if (!value)
    throw new Error(
      `Missing ${name}. Pass --${name}=... or set the matching environment variable.`,
    );
  return value;
}

function loopbackOrigin(value) {
  const url = new URL(value);
  assert.ok(
    ["http:", "https:"].includes(url.protocol),
    "--url must use http or https",
  );
  assert.ok(
    LOOPBACK_HOSTS.has(url.hostname),
    `--url must be loopback-only, got ${url.hostname}`,
  );
  return url.origin;
}

function executableCandidates() {
  return [
    process.env.CHROME_EXECUTABLE_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
}

async function pathExists(file) {
  try {
    const { access } = await import("node:fs/promises");
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function chooseExecutable(explicit) {
  if (explicit) {
    assert.ok(
      await pathExists(explicit),
      `Chrome executable does not exist: ${explicit}`,
    );
    return explicit;
  }
  for (const candidate of executableCandidates()) {
    if (await pathExists(candidate)) return candidate;
  }
  // Playwright's managed browser is a safe local fallback. Callers that need
  // an installed Chrome can pass CHROME_EXECUTABLE_PATH and get a clear check.
  return undefined;
}

function dateOnly(daysFromToday = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function safeFilePart(value) {
  return (
    value
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "step"
  );
}

async function textOf(response) {
  const body = await response.text().catch(() => "");
  try {
    return { body, json: body ? JSON.parse(body) : null };
  } catch {
    return { body, json: null };
  }
}

async function main() {
  const origin = loopbackOrigin(
    required(readArg("url") ?? process.env.HOUSEHOLD_SMOKE_URL, "url"),
  );
  const outputDir = path.resolve(
    readArg("output-dir") ??
      process.env.HOUSEHOLD_SMOKE_OUTPUT_DIR ??
      path.join(os.tmpdir(), "herewoven-household-smoke"),
  );
  await mkdir(outputDir, { recursive: true });

  const account = {
    email: required(
      readArg("email") ?? process.env.HOUSEHOLD_SMOKE_EMAIL,
      "email",
    ),
    password: required(
      readArg("password") ?? process.env.HOUSEHOLD_SMOKE_PASSWORD,
      "password",
    ),
  };
  const child = {
    email: readArg("child-email") ?? process.env.HOUSEHOLD_SMOKE_CHILD_EMAIL,
    password:
      readArg("child-password") ?? process.env.HOUSEHOLD_SMOKE_CHILD_PASSWORD,
  };
  const executablePath = await chooseExecutable(
    readArg("executable-path") ?? process.env.CHROME_EXECUTABLE_PATH,
  );
  const startedAt = new Date().toISOString();
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const prefix = `Smoke ${runId}`;
  const evidence = [];
  const screenshots = [];
  const requestFailures = [];
  const consoleErrors = [];
  let browser;
  let context;
  let page;

  const record = (name, status, details = {}) => {
    evidence.push({ name, status, ...details });
  };

  const installLoopbackGuard = async (targetContext) => {
    await targetContext.route("**/*", async (route) => {
      const requestUrl = route.request().url();
      if (
        requestUrl === "about:blank" ||
        requestUrl.startsWith("data:") ||
        requestUrl.startsWith("blob:")
      ) {
        await route.continue();
        return;
      }
      const url = new URL(requestUrl);
      if (url.origin === origin && LOOPBACK_HOSTS.has(url.hostname)) {
        await route.continue();
      } else {
        await route.abort();
      }
    });
  };

  const settle = async (targetPage = page) => {
    await targetPage
      .waitForLoadState("domcontentloaded")
      .catch(() => undefined);
    await targetPage.waitForTimeout(120);
  };

  const appPath = (targetPage = page) => new URL(targetPage.url()).pathname;
  const goto = async (targetPage, route) => {
    const response = await targetPage.goto(`${origin}${route}`, {
      waitUntil: "domcontentloaded",
    });
    await settle(targetPage);
    assert.ok(
      response && response.status() < 500,
      `GET ${route} returned ${response?.status()}`,
    );
    return response;
  };

  const screenshot = async (name, targetPage = page, fullPage = false) => {
    const filename = `${safeFilePart(name)}.png`;
    await targetPage.screenshot({
      path: path.join(outputDir, filename),
      fullPage,
    });
    screenshots.push({
      name,
      filename,
      path: path.join(outputDir, filename),
      url: targetPage.url(),
    });
  };

  const login = async (targetPage, credentials) => {
    await goto(targetPage, "/login");
    await targetPage
      .getByLabel("Email", { exact: true })
      .fill(credentials.email);
    await targetPage
      .getByLabel("Password", { exact: true })
      .fill(credentials.password);
    await targetPage.getByRole("button", { name: /^Sign In$/i }).click();
    await targetPage.waitForURL(/\/dashboard(?:\/|$)|\/onboarding(?:\/|$)/, {
      timeout: 15_000,
    });
    await settle(targetPage);
    assert.match(
      appPath(targetPage),
      /^\/(dashboard|onboarding)/,
      "login did not reach the household app",
    );
  };

  const api = async (targetPage, route, init = {}) => {
    return targetPage.evaluate(
      async ({
        origin: requestOrigin,
        route: requestRoute,
        init: requestInit,
      }) => {
        const response = await fetch(`${requestOrigin}${requestRoute}`, {
          ...requestInit,
          headers: {
            ...(requestInit.headers ?? {}),
            Accept: "application/json",
          },
        });
        return {
          status: response.status,
          ...(await response.text().then((body) => {
            try {
              return { body, json: body ? JSON.parse(body) : null };
            } catch {
              return { body, json: null };
            }
          })),
        };
      },
      { origin, route, init },
    );
  };

  const setupFamilyIfNeeded = async () => {
    const familyInput = page.locator("#onboarding-family-name");
    if (!(await familyInput.count())) {
      record("family-setup", "already-family", { path: appPath() });
      return;
    }
    const getStarted = page.getByRole("button", { name: /get started/i });
    if (await getStarted.count()) await getStarted.click();
    await familyInput.fill(`${prefix} Household`);
    await page.getByRole("button", { name: /create family/i }).click();
    await page
      .getByRole("heading", { name: /add everyone in your family/i })
      .waitFor();

    const profileButton = page.getByRole("button", {
      name: /add a household profile/i,
    });
    // Availability is checked asynchronously after family creation. A missing
    // required profile flow is a failure, rather than an unsupported pass.
    await profileButton.waitFor({ state: "visible", timeout: 15_000 });
    await profileButton.click();
    const dialog = page.getByTestId("profile-setup-dialog");
    await dialog.waitFor();
    const profileName = dialog.locator("#profile-name");
    await profileName.waitFor({ state: "visible", timeout: 15_000 });
    await profileName.fill("Smoke shared-screen child");
    await dialog.locator("#profile-role").selectOption("child");
    await dialog.locator("#profile-age").fill("3");
    await dialog.getByRole("button", { name: /save profile/i }).click();
    await dialog
      .getByRole("status")
      .filter({ hasText: /profile saved/i })
      .waitFor();
    record("email-free-profile", "passed", { role: "child", age: 3 });
    const close = dialog.getByRole("button", { name: /close/i });
    if (await close.count()) await close.first().click();

    const finish = page
      .getByRole("link", { name: /continue to today|finish later/i })
      .first();
    if (await finish.count()) await finish.click();
    await page.waitForURL(/\/dashboard(?:\/|$)/, { timeout: 15_000 });
    await settle();
    record("family-setup", "passed", {
      familyName: `${prefix} Household`,
      path: appPath(),
    });
  };

  const listJourney = async () => {
    const listName = `${prefix} groceries`;
    await goto(page, "/dashboard/lists/create");
    await page.locator("#name").fill(listName);
    await page.locator("#list-type").selectOption("grocery");
    await page.getByRole("button", { name: /create list/i }).click();
    await page.waitForURL(/\/dashboard\/lists(?:\?|$)/, { timeout: 15_000 });
    await settle();
    const listText = page.getByText(listName, { exact: true }).first();
    await listText.waitFor();
    await listText.click();
    await page.waitForURL(/\/dashboard\/lists\/[^/]+/, { timeout: 15_000 });
    await settle();
    const listId = appPath().split("/").filter(Boolean).at(-1);
    assert.ok(listId, "created list URL did not include a list id");

    const itemName = `${prefix} apples`;
    const addInput = page.getByLabel("Add an item", { exact: true });
    await addInput.fill(itemName);
    await addInput.press("Enter");
    const row = page
      .getByTestId("list-item")
      .filter({ hasText: itemName })
      .first();
    await row.waitFor({ state: "visible", timeout: 15_000 });
    const checkbox = row.getByRole("checkbox");
    const updateResponsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/lists/items/update" &&
        response.request().method() === "PATCH",
      { timeout: 15_000 },
    );
    await checkbox.click();
    const updateResponse = await updateResponsePromise;
    assert.equal(
      updateResponse.status(),
      200,
      (await textOf(updateResponse)).body,
    );
    await page.waitForFunction(
      (item) => item?.getAttribute("aria-checked") === "true",
      await checkbox.elementHandle(),
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await settle();
    const refreshedRow = page
      .getByTestId("list-item")
      .filter({ hasText: itemName })
      .first();
    await refreshedRow.waitFor({ state: "visible", timeout: 15_000 });
    await assert.equal(
      await refreshedRow.getByRole("checkbox").getAttribute("aria-checked"),
      "true",
    );
    record("list-create-item-check-refresh", "passed", {
      listName,
      itemName,
      path: appPath(),
    });
    return listId;
  };

  const calendarJourney = async () => {
    const eventTitle = `${prefix} calendar event`;
    await goto(page, "/dashboard/calendar/create");
    await page.locator("#title").fill(eventTitle);
    await page.locator("#startDate").fill(dateOnly(1));
    await page.locator("#startTime").fill("09:00");
    await page.locator("#eventDuration").selectOption("30");
    const createResponsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/events" &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: /create event/i }).click();
    const createResponse = await createResponsePromise;
    const created = await textOf(createResponse);
    assert.equal(createResponse.status(), 200, created.body);
    const eventId = created.json?.event?.id;
    assert.equal(
      typeof eventId,
      "string",
      "event create response did not include event.id",
    );
    await page.waitForURL(/\/dashboard\/calendar(?:\?|$)/, { timeout: 15_000 });
    await settle();

    await goto(
      page,
      `/dashboard/calendar/edit?id=${encodeURIComponent(eventId)}`,
    );
    await page.locator("#title").fill(`${eventTitle} revised`);
    await page.locator("#eventDuration").selectOption("60");
    const patchResponsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/events" &&
        response.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: /save changes/i }).click();
    const patchResponse = await patchResponsePromise;
    assert.equal(
      patchResponse.status(),
      200,
      (await textOf(patchResponse)).body,
    );
    await page.waitForURL(/\/dashboard\/calendar(?:\?|$)/, { timeout: 15_000 });
    await settle();
    record("calendar-create-edit-duration", "passed", {
      eventId,
      durationMinutes: 60,
      path: appPath(),
    });
  };

  const bulkMealJourney = async () => {
    await goto(page, "/dashboard/meals?view=bulk");
    const panel = page.getByTestId("bulk-cooking-panel");
    await panel.waitFor({ state: "visible", timeout: 15_000 });
    await panel.getByRole("button", { name: /plan a prep session/i }).click();
    const dialog = page.getByTestId("meal-prep-editor");
    await dialog.waitFor();
    const prepDates = dialog.locator('input[type="date"]');
    await prepDates.nth(0).fill(dateOnly(1));
    await prepDates.nth(1).fill(dateOnly(8));
    await dialog.getByRole("button", { name: /^next$/i }).click();

    const firstDish = `${prefix} pasta`;
    await dialog.getByLabel("Dish name", { exact: true }).fill(firstDish);
    await dialog.getByLabel("Total portions", { exact: true }).fill("6");
    await dialog.getByRole("button", { name: /add another dish/i }).click();
    await dialog
      .getByLabel("Dish name", { exact: true })
      .fill(`${prefix} vegetables`);
    await dialog.getByLabel("Total portions", { exact: true }).fill("4");
    await dialog.getByRole("button", { name: /^next$/i }).click();
    await dialog.getByRole("button", { name: /save prep session/i }).click();
    await dialog
      .getByRole("status")
      .filter({ hasText: /save confirmed/i })
      .waitFor({ timeout: 15_000 });
    record("meals-bulk-prep-several-dishes", "passed", {
      dishes: 2,
      path: appPath(),
    });
    const close = dialog.getByRole("button", { name: /close bulk cooking/i });
    if (await close.count()) await close.first().click();
  };

  const captureResponsiveToday = async () => {
    await goto(page, "/dashboard/today");
    for (const [name, viewport] of Object.entries(VIEWPORTS)) {
      await page.setViewportSize(viewport);
      await settle();
      await screenshot(`today-${name}`, page, false);
    }
    record("responsive-today-evidence", "passed", { viewports: VIEWPORTS });
  };

  const childAndLogoutJourney = async (parentListId) => {
    if (!child.email || !child.password) {
      record("child-private-household-negative", "skipped", {
        reason:
          "Pass both --child-email/--child-password or HOUSEHOLD_SMOKE_CHILD_* to run the child role check.",
      });
    } else {
      const childContext = await browser.newContext({
        serviceWorkers: "block",
        locale: "en-US",
        timezoneId: "America/Toronto",
        reducedMotion: "reduce",
        viewport: VIEWPORTS.phone,
      });
      await installLoopbackGuard(childContext);
      const childPage = await childContext.newPage();
      await childPage.on("requestfailed", (request) =>
        requestFailures.push({
          url: request.url(),
          error: request.failure()?.errorText,
          role: "child",
        }),
      );
      try {
        await login(childPage, child);
        const budget = await api(childPage, "/api/budget/categories");
        const aiSettings = await api(childPage, "/api/family/ai-settings");
        assert.ok(
          [401, 403].includes(budget.status),
          `child budget endpoint was not denied (${budget.status})`,
        );
        assert.ok(
          [401, 403].includes(aiSettings.status),
          `child AI settings endpoint was not denied (${aiSettings.status})`,
        );
        record("child-private-household-negative", "passed", {
          denied: ["/api/budget/categories", "/api/family/ai-settings"],
          statuses: [budget.status, aiSettings.status],
        });
        const parentList = await api(
          childPage,
          `/api/lists/items?listId=${encodeURIComponent(parentListId)}`,
        );
        if ([401, 403, 404].includes(parentList.status)) {
          record("private-household-negative", "passed", {
            endpoint: "/api/lists/items",
            status: parentList.status,
            reason: "child credentials are outside the parent household",
          });
        } else {
          assert.equal(
            parentList.status,
            200,
            `unexpected cross-household list response (${parentList.status})`,
          );
          record("private-household-negative", "same-household", {
            endpoint: "/api/lists/items",
            status: parentList.status,
            reason:
              "child credentials share the parent household; role guards were checked above",
          });
        }
      } finally {
        await childContext.close();
      }
    }

    await goto(page, "/dashboard/today");
    await page.getByRole("button", { name: /user menu/i }).click();
    await page.getByRole("button", { name: /^sign out$/i }).click();
    await page.waitForURL(/\/login(?:\?|$)/, { timeout: 15_000 });
    const afterLogout = await api(page, "/api/auth/me");
    assert.ok(
      [401, 403].includes(afterLogout.status),
      `auth/me remained usable after logout (${afterLogout.status})`,
    );
    await goto(page, "/dashboard/today");
    assert.equal(
      appPath(),
      "/login",
      "a logged-out browser reached the dashboard",
    );
    record("logout-token-rejection", "passed", {
      authMeStatus: afterLogout.status,
      redirectedPath: appPath(),
    });
  };

  try {
    const launchOptions = {
      headless: true,
      args: [
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
      ],
    };
    if (executablePath) launchOptions.executablePath = executablePath;
    browser = await chromium.launch(launchOptions);
    context = await browser.newContext({
      serviceWorkers: "block",
      locale: "en-US",
      timezoneId: "America/Toronto",
      reducedMotion: "reduce",
      viewport: VIEWPORTS.desktop,
    });
    await installLoopbackGuard(context);
    page = await context.newPage();
    page.on("requestfailed", (request) =>
      requestFailures.push({
        url: request.url(),
        error: request.failure()?.errorText,
        role: "parent",
      }),
    );
    page.on("pageerror", (error) =>
      consoleErrors.push({ message: error.message, role: "parent" }),
    );
    page.on("console", (message) => {
      if (message.type() === "error")
        consoleErrors.push({ message: message.text(), role: "parent" });
    });

    await goto(page, "/dashboard/today");
    assert.equal(
      appPath(),
      "/login",
      "unauthenticated dashboard did not redirect to login",
    );
    record("login-root-redirect", "passed", { unauthenticatedPath: appPath() });
    await login(page, account);
    await goto(page, "/");
    assert.match(
      appPath(),
      /^\/(dashboard|onboarding)/,
      "authenticated root did not stay in the app",
    );
    await setupFamilyIfNeeded();
    await captureResponsiveToday();
    const parentListId = await listJourney();
    await calendarJourney();
    await bulkMealJourney();
    await childAndLogoutJourney(parentListId);
  } catch (error) {
    record("run", "failed", {
      error: error instanceof Error ? error.message : String(error),
      path: page ? appPath(page) : null,
    });
    throw error;
  } finally {
    const manifest = {
      startedAt,
      finishedAt: new Date().toISOString(),
      origin,
      runId,
      executablePath: executablePath ?? "playwright-managed",
      fabricatedAccount: account.email,
      childAccountProvided: Boolean(child.email && child.password),
      evidence,
      screenshots,
      requestFailures,
      consoleErrors,
    };
    await writeFile(
      path.join(outputDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    if (context) await context.close().catch(() => undefined);
    if (browser) await browser.close().catch(() => undefined);
    console.log(
      JSON.stringify(
        { outputDir, evidence, screenshots, requestFailures, consoleErrors },
        null,
        2,
      ),
    );
  }
}

await main();
