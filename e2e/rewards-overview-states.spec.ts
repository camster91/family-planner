/**
 * #499 Rewards overview rendered proof.
 *
 * The parent creates the first disposable reward through the real Add reward
 * sheet/form and the second through the real route. A child claims one choice
 * and the parent approves it through the real UI. The other choice remains
 * available, so the page proves one row and one XP debit rather than a merely
 * mocked success. Recovery and malformed transport cases live in
 * rewards-recovery.spec.ts; this file keeps the happy path canonical.
 */
import AxeBuilder from "@axe-core/playwright";
import type {
  Browser,
  BrowserContext,
  Locator,
  Page,
  TestInfo,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  FIXTURE_EMAILS,
  FIXTURE_IDS,
  FIXTURE_PASSWORD,
} from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { rewardCreateMessages } from "../src/i18n/reward-create";
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
type Locale = "en" | "es";

type RewardRow = {
  id?: unknown;
  family_id?: unknown;
  created_by?: unknown;
  name?: unknown;
  description?: unknown;
  cost?: unknown;
  icon?: unknown;
  status?: unknown;
  claimedById?: unknown;
  claimed_by?: unknown;
};

type FeatureSetup = {
  original: Record<string, unknown>;
  changed: boolean;
  cleanAudit: (restore: boolean) => Promise<void>;
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

async function removeOwnedRewards(
  db: pg.Client,
  ids: readonly string[],
  names: readonly string[],
  keys: readonly string[],
): Promise<void> {
  if (!ids.length && !names.length && !keys.length) return;
  const values: unknown[] = [A.family, A.parent];
  const selectors: string[] = [];
  if (ids.length) {
    values.push(ids);
    selectors.push(`id = ANY($${values.length}::text[])`);
  }
  if (names.length) {
    values.push(names);
    selectors.push(`name = ANY($${values.length}::text[])`);
  }
  const found = await db.query<{ id: string; name: string }>(
    `SELECT id, name FROM "Reward"
     WHERE family_id=$1 AND created_by=$2 AND (${selectors.join(" OR ")})`,
    values,
  );
  const rewardIds = found.rows.map((row) => row.id);
  const rewardNames = found.rows.map((row) => row.name);
  if (rewardIds.length) {
    await db.query(
      `DELETE FROM "Reward"
       WHERE id = ANY($1::text[]) AND family_id=$2 AND created_by=$3`,
      [rewardIds, A.family, A.parent],
    );
  }
  if (rewardNames.length) {
    // Message matching is restricted to this run's UUID names; it cannot
    // remove another family member's notification or a fixed fixture row.
    await db.query(
      `DELETE FROM "Notification"
       WHERE user_id IN (SELECT id FROM "User" WHERE family_id=$1)
         AND message LIKE ANY($2::text[])`,
      [A.family, rewardNames.map((name) => `%${name}%`)],
    );
  }
  if (keys.length) {
    await db.query(
      `DELETE FROM "IdempotencyRecord"
       WHERE family_id=$1 AND user_id = ANY($2::text[]) AND key = ANY($3::text[])`,
      [A.family, [A.parent, A.child], keys],
    );
  }
}

async function sendWithKey(
  page: Page,
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body: unknown,
  key: string,
): Promise<{ status: number; body: string }> {
  return page.evaluate(
    async ({ m, p, b, idempotencyKey }) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((cookie) => cookie.startsWith("csrf_token="))
          ?.slice("csrf_token=".length) ?? "";
      const response = await fetch(p, {
        method: m,
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
    { m: method, p: path, b: body, idempotencyKey: key },
  );
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

async function configureLocale(page: Page, locale: Locale): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: LOCALE_STORAGE_KEY, value: locale },
  );
}

async function assertLayout(page: Page, info: TestInfo): Promise<void> {
  expect(PROJECTS.has(info.project.name), info.project.name).toBe(true);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= window.innerWidth &&
        document.body.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const primary = page
    .locator("main button, main a")
    .filter({ visible: true })
    .first();
  if (await primary.count()) {
    const box = await primary.boundingBox();
    if (box) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  }
  const violations = (
    await new AxeBuilder({ page }).include("main").analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
}

async function assertHitTarget(locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const metrics = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      width: rect.width,
      height: rect.height,
      hit: hit === element || (hit instanceof Node && element.contains(hit)),
    };
  });
  expect(metrics.width).toBeGreaterThanOrEqual(44);
  expect(metrics.height).toBeGreaterThanOrEqual(44);
  expect(metrics.hit).toBe(true);
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

async function prepareFeatures(page: Page): Promise<FeatureSetup> {
  const cleanAudit = await ownFeatureAudit([
    "gamification",
    "rewards",
    "analytics",
  ]);
  const current = await browserFetch(page, "/api/family/features");
  expect(current.status, current.body).toBe(200);
  const original = JSON.parse(current.body).features as Record<string, unknown>;
  const next = {
    ...original,
    gamification: true,
    rewards: true,
    analytics: true,
  };
  const changed = JSON.stringify(next) !== JSON.stringify(original);
  if (changed) {
    const response = await page.evaluate(async (features) => {
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
    }, next);
    expect(response.status, response.body).toBe(200);
  }
  return { original, changed, cleanAudit };
}

async function restoreFeatures(page: Page, setup: FeatureSetup): Promise<void> {
  const errors: unknown[] = [];
  try {
    if (setup.changed) {
      const response = await page.evaluate(async (features) => {
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
      expect(response.status, response.body).toBe(200);
    }
  } catch (error) {
    errors.push(error);
  }
  try {
    await setup.cleanAudit(true);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length) throw errors[0];
}

async function openRole(
  browser: Browser,
  baseURL: string | undefined,
  info: TestInfo,
  storageState: string,
  locale: Locale,
): Promise<{ context: BrowserContext; page: Page }> {
  const use = info.project.use;
  const context = await browser.newContext({
    baseURL,
    storageState,
    viewport: use.viewport,
    deviceScaleFactor: use.deviceScaleFactor,
    hasTouch: use.hasTouch,
    isMobile: use.isMobile,
    timezoneId: use.timezoneId,
    colorScheme: locale === "es" ? "dark" : "light",
    reducedMotion: "reduce",
    extraHTTPHeaders: use.extraHTTPHeaders,
  });
  await context.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: LOCALE_STORAGE_KEY, value: locale },
  );
  await installLoopbackGuard(context);
  const page = await context.newPage();
  await page.clock.install({ time: E2E_ANCHOR });
  return { context, page };
}

async function openTeen(
  browser: Browser,
  baseURL: string | undefined,
  info: TestInfo,
  locale: Locale,
): Promise<{ context: BrowserContext; page: Page }> {
  const use = info.project.use;
  const bucket =
    [...info.project.name].reduce(
      (sum, character) => sum + character.charCodeAt(0),
      0,
    ) % 180;
  const context = await browser.newContext({
    baseURL,
    storageState: authFile("parentA"),
    viewport: use.viewport,
    deviceScaleFactor: use.deviceScaleFactor,
    hasTouch: use.hasTouch,
    isMobile: use.isMobile,
    timezoneId: use.timezoneId,
    colorScheme: locale === "es" ? "dark" : "light",
    reducedMotion: "reduce",
    extraHTTPHeaders: {
      ...use.extraHTTPHeaders,
      "X-Forwarded-For": `198.51.100.${20 + bucket}`,
    },
  });
  await context.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: LOCALE_STORAGE_KEY, value: locale },
  );
  await installLoopbackGuard(context);
  const login = await context.request.post("/api/auth/login", {
    data: {
      email: FIXTURE_EMAILS.familyA.teen,
      password: FIXTURE_PASSWORD,
    },
  });
  expect(login.status(), await login.text()).toBe(200);
  const page = await context.newPage();
  await page.clock.install({ time: E2E_ANCHOR });
  return { context, page };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

for (const locale of ["en", "es"] as const) {
  test.describe(`${locale} Rewards canonical overview`, () => {
    test.use({
      storageState: authFile("parentA"),
      colorScheme: locale === "es" ? "dark" : "light",
    });

    test(`${locale}: parent creates, child claims one choice, parent approves once`, async ({
      page,
      context,
      browser,
      baseURL,
    }, info) => {
      assertFixtureTargetAllowed(process.env);
      const runId = randomUUID();
      const names = [
        `E2E Rewards ${runId} screen time`,
        `E2E Rewards ${runId} long choice for a family celebration that must wrap cleanly on a phone`,
      ];
      const ownedIds = new Set<string>();
      const ownedNames = new Set(names);
      const ownedKeys = new Set<string>();
      let childXpBefore: number | undefined;
      let featureSetup: FeatureSetup | undefined;
      let childContext: BrowserContext | undefined;
      let teenContext: BrowserContext | undefined;
      let familyBContext: BrowserContext | undefined;
      await installLoopbackGuard(context);
      try {
        await configureLocale(page, locale);
        await page.goto("/dashboard");
        const identity = await browserFetch(page, "/api/auth/me");
        expect(identity.status, identity.body).toBe(200);
        expect(JSON.parse(identity.body).user).toMatchObject({
          id: A.parent,
          family_id: A.family,
          role: "parent",
        });
        featureSetup = await prepareFeatures(page);

        const createCopy = rewardCreateMessages[locale];
        await page.goto("/dashboard/rewards");
        await page
          .getByRole("link", {
            name: locale === "es" ? "Añadir recompensa" : "Add reward",
            exact: true,
          })
          .click();
        const createDialog = page.getByRole("dialog", {
          name: createCopy.sheetTitle,
        });
        await expect(createDialog).toBeVisible();
        const nameField = createDialog.getByLabel(new RegExp(createCopy.name));
        const descriptionField = createDialog.getByLabel(
          createCopy.description,
          { exact: false },
        );
        const submit = createDialog.getByRole("button", {
          name: createCopy.create,
          exact: true,
        });
        await nameField.fill(names[0]);
        await descriptionField.fill(
          `Long description ${runId} — keep every word readable.`,
        );
        await captureState(page, info, locale, "rewards-create-sheet");
        await assertHitTarget(submit);
        const formRequest = page.waitForRequest(
          (request) =>
            request.url().endsWith("/api/rewards") &&
            request.method() === "POST",
        );
        const formResponse = page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/rewards") &&
            response.request().method() === "POST",
        );
        await submit.click();
        const [request, createResponse] = await Promise.all([
          formRequest,
          formResponse,
        ]);
        expect(createResponse.status()).toBe(200);
        const createKey = request.headers()["idempotency-key"];
        if (!createKey) {
          throw new Error("Create reward omitted idempotency key");
        }
        ownedKeys.add(createKey);
        const formReward = (
          (await createResponse.json()) as { reward?: RewardRow }
        ).reward;
        expect(formReward).toMatchObject({
          family_id: A.family,
          created_by: A.parent,
          name: names[0],
          description: `Long description ${runId} — keep every word readable.`,
          cost: 50,
          icon: "🎁",
          status: "available",
        });
        expect(typeof formReward?.id).toBe("string");
        ownedIds.add(formReward?.id as string);
        await expect(page).toHaveURL(/\/dashboard\/rewards$/);

        for (const name of names.slice(1)) {
          const createKey = randomUUID();
          const created = await sendWithKey(
            page,
            "POST",
            "/api/rewards",
            {
              name,
              description: `Long description ${runId} — keep every word readable.`,
              cost: 1,
              icon: "🎁",
            },
            createKey,
          );
          expect(created.status, created.body).toBe(200);
          const reward = (JSON.parse(created.body) as { reward?: RewardRow })
            .reward;
          expect(reward).toBeDefined();
          if (!reward) throw new Error("Reward create response omitted reward");
          expect(reward).toMatchObject({
            family_id: A.family,
            created_by: A.parent,
            name,
            cost: 1,
            status: "available",
          });
          expect(typeof reward?.id).toBe("string");
          ownedIds.add(reward.id as string);
          if (!createKey) {
            throw new Error("Create reward omitted idempotency key");
          }
          ownedKeys.add(createKey);
        }

        await page.goto("/dashboard/rewards");
        await expect(page.locator("main h1").first()).toBeVisible();
        await expect(page.getByText(names[1], { exact: true })).toBeVisible();
        await expect(
          page.locator("a[href='/dashboard/analytics']"),
        ).toHaveCount(1);
        await captureState(page, info, locale, "rewards-parent-overview");
        await assertHitTarget(
          page.getByRole("link", {
            name: locale === "es" ? "Añadir recompensa" : "Add reward",
            exact: true,
          }),
        );
        await assertLayout(page, info);

        const child = await openRole(
          browser,
          baseURL,
          info,
          authFile("childA"),
          locale,
        );
        childContext = child.context;
        const childMe = await browserFetch(child.page, "/api/auth/me");
        expect(childMe.status, childMe.body).toBe(200);
        childXpBefore = (JSON.parse(childMe.body).user as { xp?: unknown })
          .xp as number;
        await child.page.goto("/dashboard");
        await expect(
          child.page.getByText(names[0], { exact: true }),
        ).toBeVisible();
        await expect(
          child.page.getByText(names[1], { exact: true }),
        ).toBeVisible();
        await captureState(child.page, info, locale, "rewards-child-choice");
        const selected = child.page
          .locator("article")
          .filter({ hasText: names[0] });
        const claimButton = selected.getByRole("button", {
          name: locale === "es" ? "Reclamar" : "Claim",
          exact: true,
        });
        await expect(claimButton).toBeVisible();
        await assertHitTarget(claimButton);
        const claimResponse = child.page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/rewards/claim") &&
            response.request().method() === "POST",
        );
        await claimButton.click();
        const response = await claimResponse;
        expect(response.status()).toBe(200);
        const claimKey = response.request().headers()["idempotency-key"];
        if (!claimKey) throw new Error("Claim reward omitted idempotency key");
        ownedKeys.add(claimKey);
        await expect(
          child.page.getByText(
            locale === "es" ? "🎉 ¡Reclamada!" : "🎉 Claimed!",
            { exact: true },
          ),
        ).toBeVisible();
        await captureState(
          child.page,
          info,
          locale,
          "rewards-child-claim-confirmed",
        );
        const childXpAfterClaim = (
          JSON.parse((await browserFetch(child.page, "/api/auth/me")).body)
            .user as { xp?: unknown }
        ).xp;
        expect(childXpAfterClaim).toBe((childXpBefore as number) - 50);
        await assertLayout(child.page, info);

        const teen = await openTeen(browser, baseURL, info, locale);
        teenContext = teen.context;
        await teen.page.goto("/dashboard/rewards");
        await expect(
          teen.page.locator("a[href='/dashboard/analytics']"),
        ).toHaveCount(0);
        const teenAnalytics = await browserFetch(teen.page, "/api/analytics");
        expect(teenAnalytics.status, teenAnalytics.body).toBe(200);
        await teen.page.goto("/dashboard/analytics");
        await expect(teen.page).toHaveURL(/\/dashboard\/?$/);
        const childAnalytics = await browserFetch(child.page, "/api/analytics");
        expect(childAnalytics.status, childAnalytics.body).toBe(200);
        await child.page.goto("/dashboard/analytics");
        await expect(child.page).toHaveURL(/\/dashboard\/?$/);
        await assertLayout(teen.page, info);

        await page.goto("/dashboard/rewards");
        await expect(
          page
            .locator('[data-testid="family-reward"]')
            .filter({ hasText: names[0] }),
        ).toBeVisible();
        const approve = page
          .locator('[data-testid="family-reward"]')
          .filter({ hasText: names[0] })
          .getByRole("button", { name: new RegExp(escapeRegExp(names[0])) });
        await expect(approve).toBeVisible();
        await assertHitTarget(approve);
        const approveResponse = page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/rewards/approve") &&
            response.request().method() === "POST",
        );
        await approve.click();
        const approvalResponse = await approveResponse;
        expect(approvalResponse.status()).toBe(200);
        const approvalKey = approvalResponse.request().headers()[
          "idempotency-key"
        ];
        if (!approvalKey) {
          throw new Error("Approve reward omitted idempotency key");
        }
        ownedKeys.add(approvalKey);
        await expect(
          page
            .locator('[data-testid="family-reward"]')
            .filter({ hasText: names[0] }),
        ).toContainText(locale === "es" ? "Entregada" : "Given");
        await expect(
          page
            .locator('[data-testid="claimable-reward"]')
            .filter({ hasText: names[1] }),
        ).toHaveCount(1);
        await captureState(page, info, locale, "rewards-parent-given");
        const persisted = await browserFetch(page, "/api/rewards");
        expect(persisted.status, persisted.body).toBe(200);
        const persistedRows = (
          JSON.parse(persisted.body).rewards as RewardRow[]
        ).filter((row) => ownedNames.has(String(row.name)));
        expect(persistedRows).toHaveLength(2);
        expect(
          persistedRows.filter((row) => row.name === names[0]),
        ).toHaveLength(1);
        expect(persistedRows.find((row) => row.name === names[0])?.status).toBe(
          "redeemed",
        );
        const selectedPersisted = persistedRows.find(
          (row) => row.name === names[0],
        );
        expect(
          selectedPersisted?.claimedById ?? selectedPersisted?.claimed_by,
        ).toBe(A.child);
        expect(persistedRows.find((row) => row.name === names[1])?.status).toBe(
          "available",
        );
        expect(await browserFetch(page, "/api/analytics")).toMatchObject({
          status: 200,
        });

        // A different household cannot claim this reward, even with a valid
        // person session. This is a real route denial, not a UI-only absence.
        const foreign = await openRole(
          browser,
          baseURL,
          info,
          authFile("parentB"),
          locale,
        );
        familyBContext = foreign.context;
        await foreign.page.goto("/dashboard");
        const foreignClaim = await sendWithKey(
          foreign.page,
          "POST",
          "/api/rewards/claim",
          { rewardId: [...ownedIds][0] },
          randomUUID(),
        );
        expect(foreignClaim.status).toBe(403);
        await assertLayout(foreign.page, info);

        await info.attach(`rewards-overview-${locale}-${info.project.name}`, {
          body: JSON.stringify({
            locale,
            project: info.project.name,
            transport:
              "real authenticated parent create, child claim, parent approve; no synthetic success response",
            rewardIds: [...ownedIds],
            duplicateRewardRows: persistedRows.length,
            childXpBefore,
            childXpAfter: (
              JSON.parse((await browserFetch(child.page, "/api/auth/me")).body)
                .user as { xp?: unknown }
            ).xp,
            analytics: {
              parent: "effective parent link/API present",
              child: "link absent; same-family analytics API remains canonical",
              teen: "link absent; direct page redirects while API remains canonical",
              familyB: foreignClaim.status,
            },
          }),
          contentType: "application/json",
        });
      } finally {
        const errors: unknown[] = [];
        try {
          if (childContext) await childContext.close();
        } catch (error) {
          errors.push(error);
        }
        try {
          if (teenContext) await teenContext.close();
        } catch (error) {
          errors.push(error);
        }
        try {
          if (familyBContext) await familyBContext.close();
        } catch (error) {
          errors.push(error);
        }
        try {
          await withDb(async (db) => {
            await removeOwnedRewards(
              db,
              [...ownedIds],
              [...ownedNames],
              [...ownedKeys],
            );
            if (childXpBefore !== undefined) {
              await db.query(
                `UPDATE "User" SET xp=$1 WHERE id=$2 AND family_id=$3`,
                [childXpBefore, A.child, A.family],
              );
            }
          });
        } catch (error) {
          errors.push(error);
        }
        if (featureSetup) {
          try {
            await restoreFeatures(page, featureSetup);
          } catch (error) {
            errors.push(error);
          }
        }
        if (errors.length) throw errors[0];
      }
    });
  });
}
