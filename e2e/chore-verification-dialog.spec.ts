/**
 * Parent chore verification dialog, mounted on the real chores route.
 *
 * Each test owns one synthetic completed chore. The row is inserted and
 * removed by the guarded fixture database helpers, while every verification
 * POST is intercepted in the browser. That keeps the journey realistic
 * without changing household history, notifications, XP, or provider data.
 */
import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page, Route, TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import pg from "pg";
import { choreOverviewMessages } from "../src/i18n/chore-overview";
import { choreVerificationMessages } from "../src/i18n/chore-verification";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { E2E_ANCHOR, authFile } from "./support/env";
import { expect, test } from "./support/test";

const A = FIXTURE_IDS.familyA;
const PROJECTS = [
  "phone-390x844",
  "phone-430x932",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
  "tablet-large-1920x1200",
  "desktop-1366x768",
] as const;
const LOCALES = ["en", "es"] as const;
type Locale = (typeof LOCALES)[number];
const FIXTURE_TIMESTAMP = E2E_ANCHOR.toISOString();

type Fixture = { id: string; title: string };

test.use({ storageState: authFile("parentA") });

function fixtureFor(info: TestInfo, locale: Locale): Fixture {
  const scope = `${info.project.name}_${locale}_${info.testId}`
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .slice(-72);
  return {
    id: `fx_e2e_verify_${scope}`,
    title: `QA verification ${info.project.name} ${locale}`,
  };
}

async function withDb<T>(fn: (db: pg.Client) => Promise<T>): Promise<T> {
  assertFixtureTargetAllowed(process.env);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

async function seedFixture(fixture: Fixture) {
  await withDb(async (db) => {
    await db.query(`DELETE FROM "Chore" WHERE id = $1`, [fixture.id]);
    await db.query(
      `INSERT INTO "Chore"
         (id, family_id, title, points, assigned_to, due_date, status, frequency,
          difficulty, created_by, created_at, completed_at)
       VALUES ($1, $2, $3, 10, $4, $5, 'completed', 'once', 'easy', $6, $5, $5)`,
      [
        fixture.id,
        A.family,
        fixture.title,
        A.child,
        FIXTURE_TIMESTAMP,
        A.parent,
      ],
    );
  });
}

async function cleanupFixture(fixture: Fixture) {
  await withDb(async (db) => {
    // Verification is browser-intercepted, so this exact row is the only
    // durable resource this spec can create.
    await db.query(`DELETE FROM "Chore" WHERE id = $1`, [fixture.id]);
  });
}

function checkedCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function checkedSourceTree() {
  const actual = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();
  const configured = process.env.E2E_CHORE_VERIFY_BUILD_TREE?.trim();
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
      "Tracked app source differs from HEAD; rebuild chore verification QA from the checked-out commit.",
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

async function runtimeIdentity(page: Page, info: TestInfo, locale: Locale) {
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
    verificationTransport:
      "synthetic browser responses; no durable verify writes",
  };
  expect(identity.buildId).not.toBe("");
  expect(identity.buildTree).toMatch(/^[a-f0-9]{40}$/);
  await info.attach("actual-chore-verification-runtime-identity", {
    body: JSON.stringify(identity),
    contentType: "application/json",
  });
}

async function blockExternalRequests(context: BrowserContext) {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      ["data:", "blob:"].includes(url.protocol)
      ? route.continue()
      : route.abort();
  });
}

async function expectNoBlockingAxe(
  page: Page,
  info: TestInfo,
  label: string,
  include?: string,
) {
  const builder = new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude("next-route-announcer");
  if (include) builder.include(include);
  const results = await builder.analyze();
  await info.attach(`axe-${label}.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });
  const blocking = results.violations
    .filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    )
    .map((violation) => ({
      rule: violation.id,
      nodes: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")),
    }));
  expect(blocking, `serious/critical axe violations on ${label}`).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

async function expect44px(locator: ReturnType<Page["getByRole"]>) {
  const box = await locator.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
}

function state(
  id: string,
  status: "pending" | "completed",
  notes: string | null = null,
) {
  return {
    id,
    status,
    photo_verified: false,
    verified_at: null,
    verified_notes: notes,
    completed_at: status === "completed" ? FIXTURE_TIMESTAMP : null,
  };
}

function queueFor(page: Page, sendBackLabel: string, locale: Locale) {
  const queue = page
    .locator("section")
    .filter({
      has: page.getByText(choreOverviewMessages[locale].toCheck, {
        exact: true,
      }),
    });
  return queue
    .getByRole("button", { name: sendBackLabel, exact: true })
    .locator("..")
    .locator("..");
}

for (const locale of LOCALES) {
  test.describe(`${locale} parent chore verification`, () => {
    test.beforeEach(async ({}, info) => {
      test.skip(
        !PROJECTS.includes(info.project.name as (typeof PROJECTS)[number]),
        "verification dialog runs at the six representative responsive sizes",
      );
      await seedFixture(fixtureFor(info, locale));
    });

    test.afterEach(async ({}, info) => {
      if (PROJECTS.includes(info.project.name as (typeof PROJECTS)[number])) {
        await cleanupFixture(fixtureFor(info, locale));
      }
    });

    test("keeps notes through 403 and 409 recovery with an exact retry payload", async ({
      page,
      context,
    }, info) => {
      const fixture = fixtureFor(info, locale);
      const copy = choreVerificationMessages[locale];
      await blockExternalRequests(context);
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
      await page.goto("/dashboard/chores");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await runtimeIdentity(page, info, locale);

      const bodies: unknown[] = [];
      const writes = new Set<string>();
      const verifyHandler = async (route: Route) => {
        writes.add(
          `${route.request().method()} ${new URL(route.request().url()).pathname}`,
        );
        bodies.push(route.request().postDataJSON());
        if (bodies.length === 1) {
          await route.fulfill({
            status: 403,
            contentType: "application/json",
            body: JSON.stringify({
              error: "Only parents can perform this action",
            }),
          });
          return;
        }
        if (bodies.length === 2) {
          await route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({
              error: "This chore changed while you were checking it.",
              code: "CHORE_NOT_COMPLETED",
              chore: state(fixture.id, "pending", "Needs another go"),
            }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            chore: state(fixture.id, "pending", "Needs another go"),
          }),
        });
      };
      await page.route("**/api/chores/verify", verifyHandler);

      try {
        const row = queueFor(
          page,
          copy.sendBackAriaLabel.replace("{title}", fixture.title),
          locale,
        );
        await expect(row).toBeVisible();
        const trigger = row.getByRole("button", {
          name: copy.sendBackAriaLabel.replace("{title}", fixture.title),
          exact: true,
        });
        await expect44px(trigger);
        await expectNoBlockingAxe(page, info, `${locale}-queue`);
        await expectNoHorizontalOverflow(page);

        await trigger.click();
        const dialog = page.getByRole("dialog", {
          name: copy.dialogTitle.replace("{title}", fixture.title),
        });
        await expect(dialog).toBeVisible();
        const cancel = dialog.getByRole("button", {
          name: copy.cancel,
          exact: true,
        });
        const submit = dialog.locator('button[type="submit"]');
        await expect(cancel).toBeFocused();
        await expect44px(cancel);
        await expect44px(submit);
        await expectNoBlockingAxe(
          page,
          info,
          `${locale}-dialog`,
          '[role="dialog"]',
        );
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        expect(bodies).toHaveLength(0);
        await expect(trigger).toBeFocused();

        await trigger.click();
        const reopened = page.getByRole("dialog", {
          name: copy.dialogTitle.replace("{title}", fixture.title),
        });
        const reason = reopened.getByRole("textbox", {
          name: copy.reasonLabel,
          exact: true,
        });
        await reason.fill("  Needs another go  ");
        await reopened
          .getByRole("button", { name: copy.sendBack, exact: true })
          .click();
        await expect(reopened.getByRole("alert")).toBeVisible();
        await expect(reason).toHaveValue("  Needs another go  ");
        await expect(
          reopened.getByRole("button", { name: copy.tryAgain, exact: true }),
        ).toBeVisible();

        await reopened
          .getByRole("button", { name: copy.tryAgain, exact: true })
          .click();
        await expect(reopened.getByRole("alert")).toBeVisible();
        await expect(reason).toHaveValue("  Needs another go  ");
        await reopened
          .getByRole("button", { name: copy.tryAgain, exact: true })
          .click();
        await expect(reopened).toHaveCount(0);
        await expect(row).toHaveCount(0);
        await expect(
          page.getByText(copy.sentBackTitle, { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", {
            name: choreOverviewMessages[locale].today,
            exact: true,
          }),
        ).toBeFocused();
        expect(bodies).toEqual([
          {
            choreId: fixture.id,
            decision: "reject",
            verificationNotes: "Needs another go",
          },
          {
            choreId: fixture.id,
            decision: "reject",
            verificationNotes: "Needs another go",
          },
          {
            choreId: fixture.id,
            decision: "reject",
            verificationNotes: "Needs another go",
          },
        ]);
        expect([...writes]).toEqual(["POST /api/chores/verify"]);
        await expectNoBlockingAxe(page, info, `${locale}-recovered`);
        await expectNoHorizontalOverflow(page);
      } finally {
        await page.unroute("**/api/chores/verify", verifyHandler);
      }
    });

    test("keeps the pending dialog modal through network retry and duplicate activation", async ({
      page,
      context,
    }, info) => {
      const fixture = fixtureFor(info, locale);
      const copy = choreVerificationMessages[locale];
      await blockExternalRequests(context);
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
      await page.goto("/dashboard/chores");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await runtimeIdentity(page, info, locale);

      const bodies: unknown[] = [];
      let releasePending: (() => void) | null = null;
      let pendingResponse: Promise<void> | null = null;
      const releasePendingRequest = () => {
        const release = releasePending as (() => void) | null;
        if (release) release();
      };
      const verifyHandler = async (route: Route) => {
        bodies.push(route.request().postDataJSON());
        if (bodies.length === 1) {
          await route.abort("failed");
          return;
        }
        pendingResponse = new Promise<void>((resolve) => {
          releasePending = resolve;
        });
        await pendingResponse;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            chore: state(fixture.id, "pending", "Offline retry"),
          }),
        });
      };
      await page.route("**/api/chores/verify", verifyHandler);

      try {
        const row = queueFor(
          page,
          copy.sendBackAriaLabel.replace("{title}", fixture.title),
          locale,
        );
        const trigger = row.getByRole("button", {
          name: copy.sendBackAriaLabel.replace("{title}", fixture.title),
          exact: true,
        });
        await trigger.click();
        const dialog = page.getByRole("dialog", {
          name: copy.dialogTitle.replace("{title}", fixture.title),
        });
        const reason = dialog.getByRole("textbox", {
          name: copy.reasonLabel,
          exact: true,
        });
        await reason.fill("Offline retry");
        const submit = dialog.locator('button[type="submit"]');
        await submit.click();
        await expect(dialog.getByRole("alert")).toBeVisible();
        await expect(reason).toHaveValue("Offline retry");
        await expect(
          dialog.getByRole("button", { name: copy.tryAgain, exact: true }),
        ).toBeFocused();

        const retry = dialog.getByRole("button", {
          name: copy.tryAgain,
          exact: true,
        });
        // Dispatch both same-tick activations without waiting for the first
        // render to disable the button. The component's synchronous ref latch
        // must own duplicate protection; a second Playwright click otherwise
        // waits forever on the disabled button until this test releases the
        // first request.
        await retry.evaluate((button) => {
          button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        await expect(dialog.locator("form")).toHaveAttribute(
          "aria-busy",
          "true",
        );
        await expect(submit).toBeDisabled();
        await expect(
          dialog.getByRole("button", { name: copy.cancel, exact: true }),
        ).toBeDisabled();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeVisible();
        expect(bodies).toHaveLength(2);
        expect(bodies[0]).toEqual({
          choreId: fixture.id,
          decision: "reject",
          verificationNotes: "Offline retry",
        });
        expect(bodies[1]).toEqual(bodies[0]);
        await expectNoBlockingAxe(
          page,
          info,
          `${locale}-pending`,
          '[role="dialog"]',
        );
        await expectNoHorizontalOverflow(page);

        releasePendingRequest();
        await pendingResponse;
        await expect(dialog).toHaveCount(0);
        await expect(
          page.getByRole("button", {
            name: choreOverviewMessages[locale].today,
            exact: true,
          }),
        ).toBeFocused();
      } finally {
        releasePendingRequest();
        if (pendingResponse) await pendingResponse;
        if (!page.isClosed()) {
          try {
            await page.unroute("**/api/chores/verify", verifyHandler);
          } catch {
            // Preserve the original timeout/assertion if the test runner has
            // already closed the page during teardown.
          }
        }
      }
    });
  });
}
