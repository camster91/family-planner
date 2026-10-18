/**
 * #499 Rewards recovery and state proof.
 *
 * Empty and localized copy use the real empty household. Failure-only cases
 * inject a refusal, malformed body, or dropped response at the browser edge;
 * every retry then uses the production route and the same idempotency key. No
 * synthetic success response stands in for a canonical reward mutation.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  FIXTURE_EMAILS,
  FIXTURE_IDS,
  FIXTURE_PASSWORD,
} from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { E2E_ANCHOR, authFile } from "./support/env";
import { ownFeatureAudit } from "./support/feature-audit";
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
const A = FIXTURE_IDS.familyA;
const EMPTY = FIXTURE_IDS.familyEmpty;
type Locale = "en" | "es";
type Who = "parentA" | "childA" | "parentB";

type FeatureSetup = {
  page: Page;
  original: Record<string, unknown>;
  changed: boolean;
  cleanAudit?: (restore: boolean) => Promise<void>;
};

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

async function cleanupReward(
  db: pg.Client,
  id: string | undefined,
  name: string | undefined,
  childXp: number | undefined,
  keys: readonly string[],
): Promise<void> {
  const errors: unknown[] = [];
  const attempt = async (work: () => Promise<void>): Promise<void> => {
    try {
      await work();
    } catch (error) {
      errors.push(error);
    }
  };

  if (id) {
    await attempt(async () => {
      await db.query(
        `DELETE FROM "Reward" WHERE id=$1 AND family_id=$2 AND created_by=$3`,
        [id, A.family, A.parent],
      );
    });
  }
  if (name) {
    await attempt(async () => {
      await db.query(
        `DELETE FROM "Notification"
         WHERE user_id IN (SELECT id FROM "User" WHERE family_id=$1)
           AND message LIKE $2`,
        [A.family, `%${name}%`],
      );
    });
  }
  if (childXp !== undefined) {
    await attempt(async () => {
      await db.query(`UPDATE "User" SET xp=$1 WHERE id=$2 AND family_id=$3`, [
        childXp,
        A.child,
        A.family,
      ]);
    });
  }
  if (keys.length) {
    await attempt(async () => {
      await db.query(
        `DELETE FROM "IdempotencyRecord"
         WHERE family_id=$1 AND user_id = ANY($2::text[]) AND key = ANY($3::text[])`,
        [A.family, [A.parent, A.child], keys],
      );
    });
  }
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, "Rewards database cleanup failed");
  }
}

async function finishRecoveryCleanup(
  label: string,
  routedContext: BrowserContext,
  setup: FeatureSetup | undefined,
  cleanup: () => Promise<void>,
  contexts: readonly BrowserContext[],
): Promise<void> {
  const errors: unknown[] = [];
  const attempt = async (work: () => Promise<void>): Promise<void> => {
    try {
      await work();
    } catch (error) {
      errors.push(error);
    }
  };

  await attempt(() => routedContext.unrouteAll({ behavior: "ignoreErrors" }));
  await attempt(cleanup);
  if (setup) {
    await attempt(() => restoreFeatures(setup));
  }
  for (const context of contexts) {
    await attempt(() => context.close());
  }
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, `${label} cleanup failed`);
  }
}

async function installLoopbackGuard(context: BrowserContext): Promise<void> {
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
    if (
      !["GET", "HEAD"].includes(request.method()) &&
      !(
        (request.method() === "PATCH" &&
          url.pathname === "/api/family/features") ||
        (request.method() === "POST" &&
          [
            "/api/auth/login",
            "/api/rewards",
            "/api/rewards/claim",
            "/api/rewards/approve",
          ].includes(url.pathname))
      )
    ) {
      await route.abort();
      return;
    }
    await route.continue();
  });
}

async function setLocale(
  context: BrowserContext,
  locale: Locale,
): Promise<void> {
  await context.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: LOCALE_STORAGE_KEY, value: locale },
  );
}

async function openAs(
  browser: Browser,
  baseURL: string | undefined,
  info: TestInfo,
  who: Who,
  locale: Locale,
): Promise<{ context: BrowserContext; page: Page }> {
  const use = info.project.use;
  const context = await browser.newContext({
    baseURL,
    storageState:
      who === "parentA" || who === "childA" || who === "parentB"
        ? authFile(who)
        : undefined,
    viewport: use.viewport,
    deviceScaleFactor: use.deviceScaleFactor,
    hasTouch: use.hasTouch,
    isMobile: use.isMobile,
    timezoneId: use.timezoneId,
    colorScheme: locale === "es" ? "dark" : "light",
    reducedMotion: "reduce",
    extraHTTPHeaders: use.extraHTTPHeaders,
  });
  await setLocale(context, locale);
  await installLoopbackGuard(context);
  const page = await context.newPage();
  await page.clock.install({ time: E2E_ANCHOR });
  return { context, page };
}

async function openEmpty(
  browser: Browser,
  baseURL: string | undefined,
  info: TestInfo,
  locale: Locale,
): Promise<{ context: BrowserContext; page: Page }> {
  const use = info.project.use;
  const context = await browser.newContext({
    baseURL,
    viewport: use.viewport,
    deviceScaleFactor: use.deviceScaleFactor,
    hasTouch: use.hasTouch,
    isMobile: use.isMobile,
    timezoneId: use.timezoneId,
    colorScheme: locale === "es" ? "dark" : "light",
    reducedMotion: "reduce",
    extraHTTPHeaders: use.extraHTTPHeaders,
  });
  await setLocale(context, locale);
  await installLoopbackGuard(context);
  const login = await context.request.post("/api/auth/login", {
    data: {
      email: FIXTURE_EMAILS.familyEmpty.parent,
      password: FIXTURE_PASSWORD,
    },
  });
  expect(login.status(), await login.text()).toBe(200);
  const page = await context.newPage();
  await page.clock.install({ time: E2E_ANCHOR });
  return { context, page };
}

async function sendWithKey(
  page: Page,
  path: string,
  body: unknown,
  key: string,
): Promise<{ status: number; body: string }> {
  return page.evaluate(
    async ({ p, b, idempotencyKey }) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((cookie) => cookie.startsWith("csrf_token="))
          ?.slice("csrf_token=".length) ?? "";
      const response = await fetch(p, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf,
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(b),
      });
      return { status: response.status, body: await response.text() };
    },
    { p: path, b: body, idempotencyKey: key },
  );
}

async function prepareFeatures(
  page: Page,
  withAudit = true,
): Promise<FeatureSetup> {
  const cleanAudit = withAudit
    ? await ownFeatureAudit(["gamification", "rewards", "analytics"])
    : undefined;
  const response = await browserFetch(page, "/api/family/features");
  expect(response.status, response.body).toBe(200);
  const original = JSON.parse(response.body).features as Record<
    string,
    unknown
  >;
  const features = {
    ...original,
    gamification: true,
    rewards: true,
    analytics: true,
  };
  const changed = JSON.stringify(features) !== JSON.stringify(original);
  if (changed) {
    const update = await page.evaluate(async (next) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((cookie) => cookie.startsWith("csrf_token="))
          ?.slice("csrf_token=".length) ?? "";
      const result = await fetch("/api/family/features", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ features: next }),
      });
      return { status: result.status, body: await result.text() };
    }, features);
    expect(update.status, update.body).toBe(200);
  }
  return { page, original, changed, cleanAudit };
}

async function restoreFeatures(setup: FeatureSetup): Promise<void> {
  if (setup.changed) {
    const update = await setup.page.evaluate(async (features) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((cookie) => cookie.startsWith("csrf_token="))
          ?.slice("csrf_token=".length) ?? "";
      const result = await fetch("/api/family/features", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ features }),
      });
      return { status: result.status, body: await result.text() };
    }, setup.original);
    expect(update.status, update.body).toBe(200);
  }
  await setup.cleanAudit?.(true);
}

async function assertSurface(page: Page, info: TestInfo): Promise<void> {
  expect(PROJECTS.has(info.project.name), info.project.name).toBe(true);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= window.innerWidth &&
        document.body.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const violations = (
    await new AxeBuilder({ page }).include("main").analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
}

async function captureState(
  page: Page,
  info: TestInfo,
  locale: Locale,
  name: string,
): Promise<void> {
  const path = info.outputPath(`${name}.png`);
  const image = await page.screenshot({ path, fullPage: true });
  const viewport = page.viewportSize();
  await info.attach(`${name}.png`, { path, contentType: "image/png" });
  await info.attach(`${name}.metadata.json`, {
    body: JSON.stringify({
      imagePath: path,
      width: image.readUInt32BE(16),
      height: image.readUInt32BE(20),
      locale,
      viewport,
      project: info.project.name,
    }),
    contentType: "application/json",
  });
}

for (const locale of ["en", "es"] as const) {
  test.describe(`${locale} Rewards recovery`, () => {
    test.use({
      storageState: authFile("childA"),
      colorScheme: locale === "es" ? "dark" : "light",
    });

    test(`${locale}: real empty household and localized responsive surface`, async ({
      browser,
      baseURL,
    }, info) => {
      assertFixtureTargetAllowed(process.env);
      const empty = await openEmpty(browser, baseURL, info, locale);
      let setup: FeatureSetup | undefined;
      try {
        await empty.page.goto("/dashboard");
        setup = await prepareFeatures(empty.page, false);
        await empty.page.goto("/dashboard/rewards");
        await expect(
          empty.page.getByText(
            locale === "es" ? "Aún no hay recompensas" : "No rewards yet",
          ),
        ).toBeVisible();
        await expect(
          empty.page.getByRole("link", {
            name: locale === "es" ? "Crear recompensa" : "Create Reward",
          }),
        ).toBeVisible();
        await assertSurface(empty.page, info);
        await captureState(empty.page, info, locale, "rewards-empty");
        await info.attach(`rewards-empty-${locale}-${info.project.name}`, {
          body: JSON.stringify({
            locale,
            project: info.project.name,
            family: EMPTY.family,
            source: "real authenticated empty fixture",
          }),
          contentType: "application/json",
        });
      } finally {
        if (setup) await restoreFeatures(setup);
        await empty.context.close();
      }
    });

    test(`${locale}: malformed claim keeps reward and retries the same key`, async ({
      browser,
      baseURL,
    }, info) => {
      assertFixtureTargetAllowed(process.env);
      const parent = await openAs(browser, baseURL, info, "parentA", locale);
      const child = await openAs(browser, baseURL, info, "childA", locale);
      let parentSetup: FeatureSetup | undefined;
      const runId = randomUUID();
      const name = `E2E Rewards malformed ${runId}`;
      const keys: string[] = [];
      let rewardId: string | undefined;
      let childXp: number | undefined;
      let claimCalls = 0;
      try {
        await parent.page.goto("/dashboard");
        parentSetup = await prepareFeatures(parent.page);
        const createKey = randomUUID();
        keys.push(createKey);
        const created = await sendWithKey(
          parent.page,
          "/api/rewards",
          {
            name,
            description: "Malformed response recovery",
            cost: 1,
            icon: "🎁",
          },
          createKey,
        );
        expect(created.status, created.body).toBe(200);
        rewardId = (JSON.parse(created.body).reward as { id: string }).id;
        await child.page.goto("/dashboard");
        childXp = (
          JSON.parse((await browserFetch(child.page, "/api/auth/me")).body)
            .user as { xp: number }
        ).xp;
        const target = child.page.locator("article").filter({ hasText: name });
        await expect(target).toBeVisible();
        const claimButton = target.getByRole("button", {
          name: locale === "es" ? "Reclamar" : "Claim",
          exact: true,
        });
        await expect(claimButton).toBeVisible();
        await child.context.route("**/api/rewards/claim", async (route) => {
          if (route.request().method() !== "POST") return route.continue();
          claimCalls += 1;
          keys.push(route.request().headers()["idempotency-key"] ?? "");
          if (claimCalls === 1) {
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({ reward: { id: "malformed" } }),
            });
            return;
          }
          await route.continue();
        });
        await claimButton.click();
        await expect(
          child.page.getByText(
            locale === "es"
              ? "La conexión se interrumpió antes de confirmar."
              : "The connection dropped before we could confirm.",
          ),
        ).toBeVisible();
        await expect(target).toBeVisible();
        await expect(
          child.page.getByText(
            locale === "es" ? "🎉 ¡Reclamada!" : "🎉 Claimed!",
          ),
        ).toHaveCount(0);
        expect(
          (
            JSON.parse((await browserFetch(child.page, "/api/auth/me")).body)
              .user as { xp: number }
          ).xp,
        ).toBe(childXp);
        await captureState(
          child.page,
          info,
          locale,
          "rewards-malformed-recovery",
        );
        const retryResponse = child.page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/rewards/claim") &&
            response.request().method() === "POST",
        );
        await claimButton.click();
        expect((await retryResponse).status()).toBe(200);
        await child.context.unroute("**/api/rewards/claim");
        await expect(
          child.page.getByText(
            locale === "es" ? "🎉 ¡Reclamada!" : "🎉 Claimed!",
            { exact: true },
          ),
        ).toBeVisible();
        expect(claimCalls).toBe(2);
        expect(keys[1]).toBeTruthy();
        expect(keys[2]).toBe(keys[1]);
        const persisted = await browserFetch(child.page, "/api/rewards");
        const row = (
          JSON.parse(persisted.body).rewards as Array<{
            id: string;
            status: string;
          }>
        ).find((item) => item.id === rewardId);
        expect(row?.status).toBe("claimed");
        expect(
          (
            JSON.parse((await browserFetch(child.page, "/api/auth/me")).body)
              .user as { xp: number }
          ).xp,
        ).toBe((childXp as number) - 1);
        await captureState(
          child.page,
          info,
          locale,
          "rewards-malformed-reconciled",
        );
        await assertSurface(child.page, info);
        await info.attach(`rewards-malformed-${locale}-${info.project.name}`, {
          body: JSON.stringify({
            locale,
            project: info.project.name,
            targetName: name,
            claimCalls,
            keys,
            transport: "malformed POST followed by real authenticated retry",
          }),
          contentType: "application/json",
        });
      } finally {
        await finishRecoveryCleanup(
          "Rewards malformed claim",
          child.context,
          parentSetup,
          () =>
            withDb((db) => cleanupReward(db, rewardId, name, childXp, keys)),
          [child.context, parent.context],
        );
      }
    });

    test(`${locale}: dropped claim response retries the same key and only one row/effect`, async ({
      browser,
      baseURL,
    }, info) => {
      assertFixtureTargetAllowed(process.env);
      const parent = await openAs(browser, baseURL, info, "parentA", locale);
      const child = await openAs(browser, baseURL, info, "childA", locale);
      const runId = randomUUID();
      const name = `E2E Rewards recovery ${runId}`;
      let rewardId: string | undefined;
      let childXp: number | undefined;
      let setup: FeatureSetup | undefined;
      let calls = 0;
      const keys: string[] = [];
      const ownedKeys: string[] = [];
      try {
        await parent.page.goto("/dashboard");
        setup = await prepareFeatures(parent.page);
        const createKey = randomUUID();
        ownedKeys.push(createKey);
        const created = await sendWithKey(
          parent.page,
          "/api/rewards",
          { name, description: "Retry-safe reward", cost: 1, icon: "🎁" },
          createKey,
        );
        expect(created.status, created.body).toBe(200);
        rewardId = (JSON.parse(created.body).reward as { id: string }).id;
        await child.page.goto("/dashboard");
        childXp = (
          JSON.parse((await browserFetch(child.page, "/api/auth/me")).body)
            .user as { xp: number }
        ).xp;
        await child.context.route("**/api/rewards/claim", async (route) => {
          if (route.request().method() !== "POST") return route.continue();
          calls += 1;
          keys.push(route.request().headers()["idempotency-key"] ?? "");
          if (calls === 1) {
            const committed = await route.fetch();
            expect(committed.status()).toBe(200);
            await route.abort();
            return;
          }
          await route.continue();
        });
        const card = child.page.locator("article").filter({ hasText: name });
        const claimButton = card.getByRole("button", {
          name: locale === "es" ? "Reclamar" : "Claim",
          exact: true,
        });
        await claimButton.click();
        await expect(
          child.page.getByText(
            locale === "es" ? "Problema de conexión" : "Connection problem",
          ),
        ).toBeVisible();
        const retryResponse = child.page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/rewards/claim") &&
            response.request().method() === "POST",
        );
        await expect(claimButton).toBeVisible();
        await claimButton.click();
        const replay = await retryResponse;
        expect(replay.status()).toBe(200);
        expect(replay.headers()["idempotency-replayed"]).toBe("true");
        await expect(
          child.page.getByText(
            locale === "es" ? "🎉 ¡Reclamada!" : "🎉 Claimed!",
            { exact: true },
          ),
        ).toBeVisible();
        expect(calls).toBe(2);
        expect(keys[0]).toBeTruthy();
        expect(keys[1]).toBe(keys[0]);
        ownedKeys.push(keys[0]);
        const persisted = await browserFetch(child.page, "/api/rewards");
        const rows = (
          JSON.parse(persisted.body).rewards as Array<{
            id: string;
            status: string;
            name: string;
          }>
        ).filter((row) => row.id === rewardId);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.status).toBe("claimed");
        expect(
          (
            JSON.parse((await browserFetch(child.page, "/api/auth/me")).body)
              .user as { xp: number }
          ).xp,
        ).toBe((childXp as number) - 1);
        await captureState(
          child.page,
          info,
          locale,
          "rewards-lost-response-retry",
        );
        await assertSurface(child.page, info);
      } finally {
        await finishRecoveryCleanup(
          "Rewards dropped claim",
          child.context,
          setup,
          () =>
            withDb((db) =>
              cleanupReward(db, rewardId, name, childXp, ownedKeys),
            ),
          [child.context, parent.context],
        );
      }
    });

    test(`${locale}: committed approval response retries the same key`, async ({
      browser,
      baseURL,
    }, info) => {
      assertFixtureTargetAllowed(process.env);
      const parent = await openAs(browser, baseURL, info, "parentA", locale);
      const child = await openAs(browser, baseURL, info, "childA", locale);
      const runId = randomUUID();
      const name = `E2E Rewards approval recovery ${runId}`;
      let rewardId: string | undefined;
      let childXp: number | undefined;
      let setup: FeatureSetup | undefined;
      let approvalCalls = 0;
      const keys: string[] = [];
      const ownedKeys: string[] = [];
      try {
        await parent.page.goto("/dashboard");
        setup = await prepareFeatures(parent.page);
        const createKey = randomUUID();
        ownedKeys.push(createKey);
        const created = await sendWithKey(
          parent.page,
          "/api/rewards",
          { name, description: "Approval recovery", cost: 1, icon: "🎁" },
          createKey,
        );
        expect(created.status, created.body).toBe(200);
        rewardId = (JSON.parse(created.body).reward as { id: string }).id;
        await child.page.goto("/dashboard");
        childXp = (
          JSON.parse((await browserFetch(child.page, "/api/auth/me")).body)
            .user as { xp: number }
        ).xp;
        const claimKey = randomUUID();
        ownedKeys.push(claimKey);
        const claim = await sendWithKey(
          child.page,
          "/api/rewards/claim",
          { rewardId },
          claimKey,
        );
        expect(claim.status, claim.body).toBe(200);
        await parent.page.goto("/dashboard/rewards");
        await parent.context.route("**/api/rewards/approve", async (route) => {
          if (route.request().method() !== "POST") return route.continue();
          approvalCalls += 1;
          keys.push(route.request().headers()["idempotency-key"] ?? "");
          if (approvalCalls === 1) {
            const committed = await route.fetch();
            expect(committed.status()).toBe(200);
            await route.abort();
            return;
          }
          return route.continue();
        });
        const row = parent.page
          .locator('[data-testid="family-reward"]')
          .filter({ hasText: name });
        await row.getByRole("button", { name: new RegExp(name) }).click();
        await expect(
          row.getByRole("button", {
            name: locale === "es" ? "Intentar de nuevo" : "Try again",
            exact: true,
          }),
        ).toBeVisible();
        await captureState(
          parent.page,
          info,
          locale,
          "rewards-approval-recovery",
        );
        const approve = parent.page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/rewards/approve") &&
            response.request().method() === "POST",
        );
        await row
          .getByRole("button", {
            name: locale === "es" ? "Intentar de nuevo" : "Try again",
            exact: true,
          })
          .click();
        const replay = await approve;
        expect(replay.status()).toBe(200);
        expect(replay.headers()["idempotency-replayed"]).toBe("true");
        expect(approvalCalls).toBe(2);
        expect(keys[1]).toBe(keys[0]);
        expect(keys[0]).toBeTruthy();
        ownedKeys.push(keys[0]);
        await expect(
          parent.page
            .locator('[data-testid="family-reward"]')
            .filter({ hasText: name }),
        ).toContainText(locale === "es" ? "Entregada" : "Given");
        await captureState(parent.page, info, locale, "rewards-approval-retry");
        const persisted = await browserFetch(parent.page, "/api/rewards");
        const rowData = (
          JSON.parse(persisted.body).rewards as Array<{
            id: string;
            status: string;
          }>
        ).find((item) => item.id === rewardId);
        expect(rowData?.status).toBe("redeemed");
        await assertSurface(parent.page, info);
      } finally {
        await finishRecoveryCleanup(
          "Rewards approval",
          parent.context,
          setup,
          () =>
            withDb((db) =>
              cleanupReward(db, rewardId, name, childXp, ownedKeys),
            ),
          [parent.context, child.context],
        );
      }
    });
  });
}
