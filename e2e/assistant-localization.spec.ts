/** Assistant shell localization and draft recovery, with no AI or report writes. */
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { authFile } from "./support/env";
import { expect, test } from "./support/test";

const PROJECTS = [
  "phone-390x844",
  "phone-430x932",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
  "tablet-large-1920x1200",
  "desktop-1366x768",
] as const;

test.use({ storageState: authFile("parentA") });

function checkedCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function checkedSourceTree() {
  const actual = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();
  const configured = process.env.E2E_ASSISTANT_BUILD_TREE?.trim();
  if (configured) expect(configured).toBe(actual);
  return actual;
}

function assertCleanTrackedAppSource() {
  try {
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "prisma"], {
      stdio: "ignore",
    });
  } catch {
    throw new Error(
      "Tracked app source differs from HEAD; rebuild assistant QA from the checked-out commit.",
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
  const response = await page.evaluate(async () => {
    const res = await fetch("/api/version", { credentials: "same-origin" });
    return { status: res.status, body: await res.text() };
  });
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
    assistantTransport: "panel-only; no AI, report or action writes",
  };
  expect(identity.buildId).not.toBe("");
  expect(identity.buildTree).toMatch(/^[a-f0-9]{40}$/);
  await info.attach("actual-assistant-runtime-identity", {
    body: JSON.stringify(identity),
    contentType: "application/json",
  });
  return identity;
}

for (const locale of ["en", "es"] as const) {
  test(`${locale}: assistant shell and draft remain usable across the representative sizes`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.skip(
      !PROJECTS.includes(info.project.name as (typeof PROJECTS)[number]),
      "Assistant localization runs at the six representative responsive sizes",
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
    await page.goto("/dashboard/today");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const identity = await runtimeIdentity(page, info, locale);
    const copy =
      locale === "es"
        ? {
            launcher: "Asistente de IA",
            message: "Tu mensaje",
            reportTab: "Informar / Sugerir",
            reportTitle: "Título",
            reportDetails: "¿Qué ocurrió o qué ayudaría?",
            voice: "Entrada de voz",
            close: "Cerrar",
          }
        : {
            launcher: "AI assistant",
            message: "Your message",
            reportTab: "Report / Suggest",
            reportTitle: "Title",
            reportDetails: "What happened or what would help?",
            voice: "Voice input",
            close: "Close",
          };
    const writes: string[] = [];
    page.on("request", (request) => {
      if (!["GET", "HEAD"].includes(request.method()))
        writes.push(request.url());
    });
    const launcher = page.getByRole("button", {
      name: copy.launcher,
      exact: true,
    });
    await launcher.scrollIntoViewIfNeeded();
    await expect(launcher).toBeVisible();
    await launcher.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByLabel(copy.message, { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: copy.voice, exact: true }),
    ).toBeVisible();
    await dialog
      .getByLabel(copy.message, { exact: true })
      .fill("Fixture unsent chat draft");
    await dialog
      .getByRole("button", { name: copy.reportTab, exact: true })
      .click();
    await expect(
      dialog.getByLabel(copy.reportTitle, { exact: true }),
    ).toBeVisible();
    await dialog
      .getByLabel(copy.reportTitle, { exact: true })
      .fill("Fixture report draft");
    await dialog
      .getByLabel(copy.reportDetails, { exact: true })
      .fill("Fixture details remain private and unsent.");
    await dialog.getByRole("button", { name: copy.close, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await launcher.click();
    await expect(
      page.getByRole("dialog").getByLabel(copy.message, { exact: true }),
    ).toHaveValue("Fixture unsent chat draft");
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
    await info.attach("assistant-shell-source-identity", {
      body: JSON.stringify({ identity, locale, writes, violations }),
      contentType: "application/json",
    });
    expect(writes).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`assistant-${locale}-shell.png`),
      fullPage: true,
    });
  });
}
