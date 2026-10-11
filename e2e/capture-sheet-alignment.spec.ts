/** Short Capture sheet shell, localized chrome and draft preservation. */
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { authFile } from "./support/env";
import { expect, test } from "./support/test";

test.use({ storageState: authFile("parentA"), timezoneId: "America/Toronto" });

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PROJECTS = [
  "phone-390x844",
  "phone-430x932",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
  "tablet-large-1920x1200",
  "desktop-1366x768",
] as const;

const copy = {
  en: {
    launcher: "Open quick add",
    title: "Quick add",
    close: "Close quick add",
    textbox: "What would you like to add?",
  },
  es: {
    launcher: "Abrir adición rápida",
    title: "Adición rápida",
    close: "Cerrar adición rápida",
    textbox: "¿Qué te gustaría añadir?",
  },
} as const;

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
  const values = [
    ...new Set(route.match(/20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g) ?? []),
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
  locale: "en" | "es",
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
  const head = sourceHead();
  expect(runtime.commit).toBe(head);
  if (process.env.RELEASE_SHA?.trim())
    expect(process.env.RELEASE_SHA.trim()).toBe(head);
  assertCleanTrackedAppSource();
  expect(runtime.builtAt).toBe(compiledBuiltAt());
  const tree = sourceTree();
  if (process.env.E2E_CAPTURE_BUILD_TREE?.trim())
    expect(process.env.E2E_CAPTURE_BUILD_TREE.trim()).toBe(tree);
  const identity = {
    runtime,
    buildId: fs.readFileSync(".next/BUILD_ID", "utf8").trim(),
    buildTree: tree,
    locale,
    role: "parent",
    captureTransport: "GET setup gate only; no provider or mutation transport",
  };
  expect(identity.buildId).not.toBe("");
  await info.attach("actual-capture-sheet-runtime-identity", {
    body: JSON.stringify(identity),
    contentType: "application/json",
  });
  return identity;
}

async function checkTarget(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
}

for (const locale of ["en", "es"] as const) {
  test(`${locale}: Capture opens as a short sheet and preserves an unsent draft`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.skip(
      !PROJECTS.includes(info.project.name as (typeof PROJECTS)[number]),
      "Capture sheet runs at six representative sizes",
    );
    assertFixtureTargetAllowed(process.env);
    expect(LOOPBACK_HOSTS.has(new URL(baseURL!).hostname)).toBe(true);
    const writes: string[] = [];
    await context.route("**/*", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (!["GET", "HEAD"].includes(request.method()))
        writes.push(request.url());
      return LOOPBACK_HOSTS.has(url.hostname) ||
        ["data:", "blob:"].includes(url.protocol)
        ? route.continue()
        : route.abort();
    });
    await context.addInitScript(
      ({ localeKey, language, themeKey }) => {
        localStorage.setItem(localeKey, language);
        localStorage.setItem(themeKey, language === "es" ? "dark" : "light");
      },
      {
        localeKey: LOCALE_STORAGE_KEY,
        language: locale,
        themeKey: THEME_STORAGE_KEY,
      },
    );
    await page.route("**/api/capture", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ configured: true, allowed: true }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/dashboard/calendar");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    if (locale === "es") await expect(page.locator("html")).toHaveClass(/dark/);
    else await expect(page.locator("html")).not.toHaveClass(/dark/);
    const identity = await runtimeIdentity(page, info, locale);
    const labels = copy[locale];
    const launcher = page.getByRole("button", {
      name: labels.launcher,
      exact: true,
    });
    await expect(launcher).toBeVisible();
    await checkTarget(page, launcher);
    await launcher.click();

    const dialog = page.getByRole("dialog", {
      name: labels.title,
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("textbox", { name: labels.textbox }),
    ).toBeFocused();
    const close = dialog.getByRole("button", {
      name: labels.close,
      exact: true,
    });
    await checkTarget(page, close);
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(dialogBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await dialog
      .getByRole("textbox", { name: labels.textbox })
      .fill("Fixture unsent capture draft");
    await close.click();
    await expect(dialog).toHaveCount(0);
    await expect(launcher).toBeFocused();
    await launcher.click();
    await expect(
      page
        .getByRole("dialog", { name: labels.title, exact: true })
        .getByRole("textbox", { name: labels.textbox }),
    ).toHaveValue("Fixture unsent capture draft");

    const violations = (
      await new AxeBuilder({ page }).include('[role="dialog"]').analyze()
    ).violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    );
    expect(violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(writes).toEqual([]);
    await info.attach("capture-sheet-state", {
      body: JSON.stringify({ identity, locale, writes, violations }),
      contentType: "application/json",
    });
    await page.screenshot({
      path: info.outputPath(`capture-sheet-${locale}.png`),
      fullPage: true,
      animations: "disabled",
    });
  });
}
