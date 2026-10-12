/**
 * #504: Capture's launcher can recover from a transient availability failure.
 *
 * This is a browser-only transport rehearsal. The fixture parent and runtime
 * identity are real, while availability and provider responses are synthetic;
 * no capture, event or grocery write is allowed to reach the database.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import type { CaptureRecoveryEnvelope } from "../src/lib/capture-recovery";
import { captureRecoveryStorageKey } from "../src/lib/capture-recovery";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { authFile } from "./support/env";
import { browserFetch, expect, test } from "./support/test";

test.use({ storageState: authFile("parentA"), timezoneId: "America/Toronto" });

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PROJECT_NAMES = new Set([
  "phone-390x844",
  "phone-430x932",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
  "tablet-large-1920x1200",
  "desktop-1366x768",
]);
const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

const copy = {
  en: {
    launcher: "Open quick add",
    title: "Quick add",
    retry: "Retry",
    readIt: "Read it",
    textbox: "What would you like to add?",
    retryFor: (title: string) => `Retry ${title}`,
    providerTitle: "Synthetic provider preview",
  },
  es: {
    launcher: "Abrir adición rápida",
    title: "Adición rápida",
    retry: "Reintentar",
    readIt: "Leerlo",
    textbox: "¿Qué te gustaría añadir?",
    retryFor: (title: string) => `Reintentar ${title}`,
    providerTitle: "Synthetic provider preview",
  },
} as const;

type AvailabilityMode =
  | "transient"
  | "available"
  | "disabled"
  | "refused"
  | "refused403";

function sourceHead(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function sourceTree(): string {
  return execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();
}

function compiledBuiltAt(): string {
  const route = fs.readFileSync(
    ".next/server/app/api/version/route.js",
    "utf8",
  );
  const timestamps = [
    ...new Set(route.match(/20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g) ?? []),
  ];
  expect(timestamps).toHaveLength(1);
  return timestamps[0]!;
}

function assertCleanTrackedAppSource(): void {
  expect(() =>
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "prisma"], {
      stdio: "ignore",
    }),
  ).not.toThrow();
}

async function assertRuntimeIdentity(
  page: Page,
  info: TestInfo,
  locale: "en" | "es",
): Promise<void> {
  const response = await browserFetch(page, "/api/version");
  expect(response.status, response.body).toBe(200);
  const runtime = JSON.parse(response.body) as {
    version?: unknown;
    commit?: unknown;
    builtAt?: unknown;
  };
  const head = sourceHead();
  expect(runtime.version).toEqual(expect.any(String));
  expect(runtime.commit).toBe(head);
  if (process.env.RELEASE_SHA?.trim()) {
    expect(process.env.RELEASE_SHA.trim()).toBe(head);
  }
  assertCleanTrackedAppSource();
  expect(runtime.builtAt).toBe(compiledBuiltAt());
  const tree = sourceTree();
  if (process.env.E2E_CAPTURE_BUILD_TREE?.trim()) {
    expect(process.env.E2E_CAPTURE_BUILD_TREE.trim()).toBe(tree);
  }
  const buildId = fs.readFileSync(".next/BUILD_ID", "utf8").trim();
  expect(buildId).not.toBe("");
  await info.attach("capture-availability-runtime-identity", {
    body: JSON.stringify({
      runtime,
      buildId,
      sourceTree: tree,
      locale,
      role: "parentA",
      scope:
        "synthetic availability/provider transport; no capture, event or grocery writes",
    }),
    contentType: "application/json",
  });
}

async function fixtureIdentity(page: Page): Promise<{
  userId: string;
  familyId: string;
}> {
  const response = await browserFetch(page, "/api/auth/me");
  expect(response.status, response.body).toBe(200);
  const body = JSON.parse(response.body) as {
    user?: { id?: unknown; family_id?: unknown };
  };
  const userId = body.user?.id;
  const familyId = body.user?.family_id;
  expect(typeof userId).toBe("string");
  expect(typeof familyId).toBe("string");
  if (typeof userId !== "string" || typeof familyId !== "string") {
    throw new Error("Fixture parent identity response was incomplete");
  }
  expect(userId).toBe(FIXTURE_IDS.familyA.parent);
  expect(familyId).toBe(FIXTURE_IDS.familyA.family);
  return { userId, familyId };
}

async function installLoopbackGuard(
  context: BrowserContext,
  blockedWrites: string[],
): Promise<void> {
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      !LOOPBACK_HOSTS.has(url.hostname) &&
      !["data:", "blob:"].includes(url.protocol)
    ) {
      await route.abort();
      return;
    }
    if (MUTATING_METHODS.has(request.method())) {
      // The page-level /api/capture route supplies the provider rehearsal. All
      // other mutation paths are blocked before they can touch the fixture DB.
      if (request.method() !== "POST" || url.pathname !== "/api/capture") {
        blockedWrites.push(`${request.method()} ${url.pathname}`);
        await route.abort();
        return;
      }
    }
    await route.continue();
  });
}

async function seedRecoveryRow(
  page: Page,
  storageKey: string,
  title: string,
): Promise<void> {
  const row: CaptureRecoveryEnvelope = {
    version: 1,
    key: "capture-availability-recovery-01",
    action: "event.create",
    requestHash: "a".repeat(64),
    body: JSON.stringify({
      title,
      start_time: "2026-01-06T19:00:00.000Z",
      event_type: "other",
    }),
    title,
    kind: "event",
    createdAt: 0,
    photo: false,
  };
  await page.evaluate(
    ({ key, value }) =>
      window.localStorage.setItem(
        key,
        JSON.stringify([{ ...value, createdAt: Date.now() }]),
      ),
    { key: storageKey, value: row },
  );
}

async function assertTarget(page: Page, selector: Locator): Promise<void> {
  const box = await selector.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
}

for (const locale of ["en", "es"] as const) {
  test(`${locale}: Capture availability recovers and preserves marked rows`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.skip(
      !PROJECT_NAMES.has(info.project.name),
      "Capture availability runs at six representative responsive sizes",
    );
    assertFixtureTargetAllowed(process.env);
    expect(baseURL).toBeTruthy();
    expect(LOOPBACK_HOSTS.has(new URL(baseURL!).hostname)).toBe(true);

    const blockedWrites: string[] = [];
    const providerPosts: string[] = [];
    await installLoopbackGuard(context, blockedWrites);
    await context.addInitScript(
      ({ language }) => {
        localStorage.setItem("familyPlanner_language", language);
        localStorage.setItem(
          "familyPlanner_theme_v2",
          language === "es" ? "dark" : "light",
        );
      },
      { language: locale },
    );

    let availabilityMode: AvailabilityMode = "transient";
    let availabilityGets = 0;
    await page.route("**/api/capture", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname !== "/api/capture") {
        await route.continue();
        return;
      }
      if (request.method() === "GET") {
        availabilityGets += 1;
        if (availabilityMode === "transient") {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "synthetic transient outage" }),
          });
          return;
        }
        if (
          availabilityMode === "refused" ||
          availabilityMode === "refused403"
        ) {
          await route.fulfill({
            status: availabilityMode === "refused" ? 401 : 403,
            body: "",
          });
          return;
        }
        const fixture = {
          allowed: true,
          configured: availabilityMode === "available",
          userId: FIXTURE_IDS.familyA.parent,
          familyId: FIXTURE_IDS.familyA.family,
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(fixture),
        });
        return;
      }
      if (request.method() === "POST") {
        providerPosts.push(request.postData() ?? "");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            draft: {
              kind: "event",
              title: copy[locale].providerTitle,
              start_time: "2026-01-06T19:00:00.000Z",
              confidence: "high",
            },
          }),
        });
        return;
      }
      blockedWrites.push(`${request.method()} ${url.pathname}`);
      await route.abort();
    });

    await page.goto("/dashboard/calendar");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    if (locale === "es") await expect(page.locator("html")).toHaveClass(/dark/);
    else await expect(page.locator("html")).not.toHaveClass(/dark/);
    await assertRuntimeIdentity(page, info, locale);
    const fixture = await fixtureIdentity(page);
    const title = `Marked recovery ${locale}`;
    const storageKey = captureRecoveryStorageKey(
      fixture.userId,
      fixture.familyId,
    );
    await seedRecoveryRow(page, storageKey, title);

    const labels = copy[locale];
    const launcher = page.getByRole("button", {
      name: labels.launcher,
      exact: true,
    });
    await expect(launcher).toBeVisible();
    await assertTarget(page, launcher);
    await launcher.click();
    const dialog = page.getByRole("dialog", {
      name: labels.title,
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("capture-availability-retry")).toBeVisible();
    await expect(dialog.getByRole("alert")).toContainText(
      locale === "es" ? "No se pudo conectar" : "could not connect",
    );
    const retry = page
      .getByTestId("capture-availability-retry")
      .getByRole("button", {
        name: labels.retry,
        exact: true,
      });
    await assertTarget(page, retry);

    // The marked row is seeded before retry and must appear after the valid
    // availability response, without navigating or making a domain write.
    availabilityMode = "available";
    await retry.click();
    await expect.poll(() => availabilityGets).toBe(2);
    const recovery = page.getByTestId("capture-recovery");
    await expect(recovery).toBeVisible();
    await expect(recovery).toContainText(title);
    await expect(
      recovery.getByRole("button", {
        name: labels.retryFor(title),
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: labels.textbox, exact: true }),
    ).toBeFocused();
    await expect(
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? "[]"),
        storageKey,
      ),
    ).resolves.toEqual([expect.objectContaining({ title })]);

    // Provider parsing is synthetic and read-only; Add it / event writes are
    // never clicked, while the transport firewall blocks every other writer.
    const input = page.getByRole("textbox", {
      name: labels.textbox,
      exact: true,
    });
    await input.fill("synthetic dentist preview");
    await dialog
      .getByRole("button", { name: labels.readIt, exact: true })
      .click();
    await expect(dialog).toContainText(labels.providerTitle);
    expect(providerPosts).toHaveLength(1);
    expect(blockedWrites).toEqual([]);

    // Explicit disabled responses remove the launcher. Authenticated refusal
    // is a recovery boundary: it also purges the marked private envelope.
    availabilityMode = "disabled";
    await page.reload();
    await expect(
      page.getByRole("button", { name: labels.launcher, exact: true }),
    ).toHaveCount(0);
    availabilityMode = "refused";
    await page.reload();
    await expect(
      page.getByRole("button", { name: labels.launcher, exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? "[]"),
        storageKey,
      ),
    ).toEqual([]);
    await seedRecoveryRow(page, storageKey, title);
    await page.evaluate((key) => {
      localStorage.setItem("family-planner:capture-recovery:v1:active", key);
    }, storageKey);
    availabilityMode = "refused403";
    await page.reload();
    await expect(
      page.getByRole("button", { name: labels.launcher, exact: true }),
    ).toHaveCount(0);
    expect(availabilityGets).toBe(5);
    expect(providerPosts).toHaveLength(1);
    expect(blockedWrites).toEqual([]);
    expect(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? "[]"),
        storageKey,
      ),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
