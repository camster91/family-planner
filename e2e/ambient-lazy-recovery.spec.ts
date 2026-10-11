/** #499: the optional fridge calm-display chunk can recover without waking the board. */
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { todayBoardMessages } from "../src/i18n/today-board";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { authFile, E2E_ANCHOR } from "./support/env";
import { browserFetch, expect, test } from "./support/test";

const PROJECTS = [
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
] as const;
const MINUTE = 60 * 1000;

test.use({ storageState: authFile("parentA") });

function checkedCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function checkedSourceTree() {
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();
  const configured = process.env.E2E_AMBIENT_BUILD_TREE?.trim();
  if (configured) expect(configured).toBe(tree);
  return tree;
}

function assertCleanTrackedAppSource() {
  try {
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "prisma"], {
      stdio: "ignore",
    });
  } catch {
    throw new Error(
      "Tracked app source differs from HEAD; rebuild ambient QA from the checked-out commit.",
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

/** Find the built React.lazy chunk without baking a stale webpack hash into the test. */
function ambientChunkName() {
  const chunkDir = ".next/static/chunks";
  const chunk = fs
    .readdirSync(chunkDir)
    .filter((name) => name.endsWith(".js"))
    .find((name) => {
      const source = fs.readFileSync(path.join(chunkDir, name), "utf8");
      return (
        source.includes("ambient-photo") && source.includes("AmbientCover")
      );
    });
  expect(
    chunk,
    "the production build must contain the ambient cover chunk",
  ).toBeTruthy();
  return chunk!;
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
  const head = checkedCommit();
  expect(runtime.commit).toBe(head);
  const releaseSha = process.env.RELEASE_SHA?.trim();
  if (releaseSha) expect(releaseSha).toBe(head);
  assertCleanTrackedAppSource();
  expect(runtime.builtAt).toBe(compiledBuiltAt());
  const identity = {
    runtime,
    buildId: fs.readFileSync(".next/BUILD_ID", "utf8").trim(),
    buildTree: checkedSourceTree(),
    locale,
    role: "parentA",
    ambientChunk: ambientChunkName(),
    scope:
      "default Family A fridge display; rejected optional ambient chunk only; no API/domain writes",
  };
  expect(identity.buildId).not.toBe("");
  expect(identity.buildTree).toMatch(/^[a-f0-9]{40}$/);
  await info.attach("ambient-lazy-runtime-identity", {
    body: JSON.stringify(identity),
    contentType: "application/json",
  });
  return identity;
}

async function captureState(
  page: Page,
  info: TestInfo,
  state: "error" | "loading" | "ready",
  identity: Awaited<ReturnType<typeof runtimeIdentity>>,
  writes: string[],
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
    body: JSON.stringify({ identity, state, overflowFree, violations, writes }),
    contentType: "application/json",
  });
  await info.attach(`${state}-axe`, {
    body: JSON.stringify(violations),
    contentType: "application/json",
  });
  await page.screenshot({
    path: info.outputPath(`ambient-lazy-${state}.png`),
    fullPage: true,
  });
  expect(overflowFree).toBe(true);
  expect(violations).toEqual([]);
}

for (const locale of ["en", "es"] as const) {
  const copy = todayBoardMessages[locale];

  test(`${locale}: rejected ambient chunk retries with Enter while the board stays inert`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.skip(
      !PROJECTS.includes(info.project.name as (typeof PROJECTS)[number]),
      "ambient lazy recovery runs on the portrait tablet and fridge landscape",
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

    const writes: string[] = [];
    page.on("request", (request) => {
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
        writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    });

    const chunk = ambientChunkName();
    let chunkAttempts = 0;
    let releaseRetryChunk: () => void = () => undefined;
    const retryChunkReleased = new Promise<void>((resolve) => {
      releaseRetryChunk = resolve;
    });
    await page.route(`**/_next/static/chunks/${chunk}`, async (route) => {
      chunkAttempts += 1;
      if (chunkAttempts === 1) {
        await route.abort("failed");
        return;
      }
      if (chunkAttempts === 2) await retryChunkReleased;
      await route.continue();
    });

    let identity: Awaited<ReturnType<typeof runtimeIdentity>> | undefined;
    try {
      await page.goto("/dashboard/today?mode=fridge");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      const board = page.getByTestId("today-board");
      await expect(board).toBeVisible();
      identity = await runtimeIdentity(page, info, locale);

      // The fixture's default calm-display setting is five minutes. No settings
      // or domain rows are changed by this test; only the browser clock advances.
      await page.clock.runFor(5 * MINUTE + 20 * 1000);
      const cover = page.getByTestId("ambient-cover");
      await expect(cover).toBeVisible();
      await expect(cover).toHaveAttribute("role", "dialog");
      await expect(cover).toHaveAttribute("aria-modal", "true");
      await expect(board).toHaveAttribute("inert", "");
      await expect(cover.getByRole("alert")).toHaveText(copy.lazyAmbientError);
      expect(chunkAttempts).toBe(1);

      const retry = cover.getByRole("button", {
        name: copy.retry,
        exact: true,
      });
      await expect(retry).toBeFocused();
      const retryBox = await retry.boundingBox();
      expect(retryBox).not.toBeNull();
      expect(retryBox!.width).toBeGreaterThanOrEqual(44);
      expect(retryBox!.height).toBeGreaterThanOrEqual(44);
      await captureState(page, info, "error", identity, writes);

      await retry.press("Enter");
      await expect(cover.getByRole("status")).toHaveText(
        copy.lazyAmbientLoading,
      );
      await expect(board).toHaveAttribute("inert", "");
      expect(chunkAttempts).toBe(2);
      await captureState(page, info, "loading", identity, writes);

      releaseRetryChunk();
      releaseRetryChunk = () => undefined;
      await expect(cover.getByTestId("ambient-clock")).toBeVisible();
      await expect(
        cover.getByRole("button", { name: copy.showBoard }),
      ).toBeVisible();
      await expect(board).toHaveAttribute("inert", "");
      await captureState(page, info, "ready", identity, writes);

      // A click at the covered board's real calendar link is consumed by the
      // modal cover. It wakes the board, but must not follow the link underneath.
      const calendarLink = board.getByTestId("region-link-today");
      const box = await calendarLink.boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await expect(page).toHaveURL(/\/dashboard\/today\?mode=fridge$/);
      await expect(cover).toHaveCount(0);
      await expect(board).not.toHaveAttribute("inert", "");
      expect(writes).toEqual([]);
    } finally {
      releaseRetryChunk();
      await page.unroute(`**/_next/static/chunks/${chunk}`);
      expect(writes).toEqual([]);
    }
  });
}
