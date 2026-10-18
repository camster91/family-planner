/**
 * #499: Rewards create form and intercepted sheet.
 *
 * The first POST in each surface is deliberately synthetic so the journey
 * proves localized refusal feedback and draft retention. The pending retry is
 * allowed through the loopback app, reads the exact persisted reward back
 * through the real GET endpoint, and removes only the fixture-owned reward
 * and its notification rows in guarded cleanup. No email or provider is used.
 */
import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { isValidIdempotencyKey } from "../src/lib/idempotency-key";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { rewardCreateMessages } from "../src/i18n/reward-create";
import { rewardsEnglish, rewardsSpanish } from "../src/i18n/rewards";
import { authFile } from "./support/env";
import { ownFeatureAudit } from "./support/feature-audit";
import { browserFetch, browserSend, expect, test } from "./support/test";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const A = FIXTURE_IDS.familyA;

type Locale = "en" | "es";
type Surface = "sheet" | "direct";

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
  idempotencyKeys: readonly string[],
): Promise<void> {
  if (ids.length || names.length) {
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
    const rewards = await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM "Reward"
       WHERE family_id=$1 AND created_by=$2 AND (${selectors.join(" OR ")})`,
      values,
    );
    const rewardIds = rewards.rows.map((row) => row.id);
    const rewardNames = rewards.rows.map((row) => row.name);

    if (rewardIds.length) {
      const deleted = await db.query(
        `DELETE FROM "Reward"
         WHERE id = ANY($1::text[]) AND family_id=$2 AND created_by=$3
           AND name = ANY($4::text[])`,
        [rewardIds, A.family, A.parent, rewardNames],
      );
      expect(deleted.rowCount).toBe(rewardIds.length);
    }
    if (rewardNames.length) {
      await db.query(
        `DELETE FROM "Notification"
         WHERE user_id IN (SELECT id FROM "User" WHERE family_id=$1 AND id <> $2)
           AND title = 'New Reward Available!'
           AND message = ANY($3::text[])`,
        [
          A.family,
          A.parent,
          rewardNames.map((name) => `${name} is now available for 50 points`),
        ],
      );
    }
  }

  const keys = [...new Set(idempotencyKeys)];
  if (keys.length) {
    const receipts = await db.query<{
      id: string;
      key: string;
      family_id: string;
      user_id: string | null;
      action: string;
    }>(
      `SELECT id, key, family_id, user_id, action
       FROM "IdempotencyRecord"
       WHERE family_id = $1 AND user_id = $2
         AND key = ANY($3::text[]) AND action = 'reward.create'`,
      [A.family, A.parent, keys],
    );
    expect(receipts.rows.map((row) => row.key).sort()).toEqual(keys.sort());
    for (const row of receipts.rows) {
      expect(row).toMatchObject({
        family_id: A.family,
        user_id: A.parent,
        action: "reward.create",
      });
    }
    const deleted = await db.query<{ id: string }>(
      `DELETE FROM "IdempotencyRecord"
       WHERE id = ANY($1::text[])
         AND family_id = $2 AND user_id = $3
         AND key = ANY($4::text[]) AND action = 'reward.create'
       RETURNING id`,
      [receipts.rows.map((row) => row.id), A.family, A.parent, keys],
    );
    expect(deleted.rows).toHaveLength(receipts.rows.length);
    const remaining = await db.query<{ id: string }>(
      `SELECT id FROM "IdempotencyRecord"
       WHERE family_id = $1 AND user_id = $2
         AND key = ANY($3::text[]) AND action = 'reward.create'`,
      [A.family, A.parent, keys],
    );
    expect(remaining.rows).toHaveLength(0);
  }
}

async function installLoopbackGuard(
  context: BrowserContext,
  blockedWrites: string[],
) {
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

    const allowedMutation =
      (request.method() === "PATCH" &&
        url.pathname === "/api/family/features") ||
      (request.method() === "POST" && url.pathname === "/api/rewards");
    if (MUTATING_METHODS.has(request.method()) && !allowedMutation) {
      blockedWrites.push(`${request.method()} ${url.pathname}`);
      await route.abort();
      return;
    }
    await route.continue();
  });
}

async function assertActionGeometry(page: Page, action: Locator) {
  const box = await action.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
}

async function assertNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= window.innerWidth &&
        document.body.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

async function assertA11y(page: Page, surface: Surface) {
  const scope = surface === "sheet" ? '[role="dialog"]' : "main";
  const violations = (
    await new AxeBuilder({ page }).include(scope).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
}

async function assertFeatureIdentity(page: Page) {
  const response = await browserFetch(page, "/api/auth/me");
  expect(response.status, response.body).toBe(200);
  const body = JSON.parse(response.body) as {
    user?: { id?: unknown; family_id?: unknown; role?: unknown };
  };
  expect(body.user?.id).toBe(A.parent);
  expect(body.user?.family_id).toBe(A.family);
  expect(body.user?.role).toBe("parent");
}

async function openSurface(page: Page, surface: Surface, locale: Locale) {
  const copy = rewardCreateMessages[locale];
  const boardCopy = locale === "es" ? rewardsSpanish : rewardsEnglish;
  if (surface === "sheet") {
    await page.goto("/dashboard/rewards");
    await page.getByRole("link", { name: boardCopy.addReward, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: copy.sheetTitle });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: copy.closeLabel }),
    ).toBeFocused();
    await assertActionGeometry(
      page,
      dialog.getByRole("button", { name: copy.closeLabel }),
    );
    return dialog;
  }

  await page.goto("/dashboard/rewards/create");
  await expect(page.getByRole("heading", { name: copy.title })).toBeVisible();
  await expect(
    page.getByRole("link", { name: copy.back, exact: true }),
  ).toHaveAttribute("href", "/dashboard/rewards");
  return page.locator("main");
}

for (const locale of ["en", "es"] as const) {
  test.describe(`${locale} parent Rewards create`, () => {
    test.use({
      storageState: authFile("parentA"),
      colorScheme: locale === "es" ? "dark" : "light",
    });

    test(`${locale}: refusal, pending retry, and persisted reward cleanup`, async ({
      page,
      context,
    }, testInfo: TestInfo) => {
      assertFixtureTargetAllowed(process.env);
      const blockedWrites: string[] = [];
      const postBodies: unknown[] = [];
      const postIdempotencyKeys: string[] = [];
      const ownedReceiptKeys = new Set<string>();
      const ownedRewardIds = new Set<string>();
      const ownedRewardNames = new Set<string>();
      const rewardRunId = randomUUID();
      const rewardNamePrefix = `E2E Reward Create ${rewardRunId} `;
      const cleanAudit = await ownFeatureAudit(["gamification", "rewards"]);
      let originalFeatures: Record<string, unknown> | undefined;
      let featureChanged = false;
      let mode: "failure" | "pending" = "failure";
      let finishPendingRequest:
        ((continueRequest: boolean) => void) | undefined;

      await installLoopbackGuard(context, blockedWrites);
      await page.addInitScript(
        ({ key, value }) => localStorage.setItem(key, value),
        { key: LOCALE_STORAGE_KEY, value: locale },
      );
      await page.route("**/api/rewards", async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        postBodies.push(route.request().postDataJSON());
        const idempotencyKey = route.request().headers()["idempotency-key"] ?? "";
        postIdempotencyKeys.push(idempotencyKey);
        expect(isValidIdempotencyKey(idempotencyKey)).toBe(true);
        if (mode === "failure") {
          await route.fulfill({
            status: 403,
            contentType: "application/json",
            body: JSON.stringify({ error: "Only parents can create rewards" }),
          });
          return;
        }
        const continueRequest = await new Promise<boolean>((resolve) => {
          finishPendingRequest = resolve;
        });
        if (continueRequest) {
          ownedReceiptKeys.add(idempotencyKey);
          await route.continue();
        }
        else await route.abort();
      });

      try {
        await page.goto("/dashboard");
        await assertFeatureIdentity(page);
        const originalFeaturesResponse = await browserFetch(
          page,
          "/api/family/features",
        );
        expect(
          originalFeaturesResponse.status,
          originalFeaturesResponse.body,
        ).toBe(200);
        originalFeatures = JSON.parse(originalFeaturesResponse.body)
          .features as Record<string, unknown>;
        if (
          originalFeatures.gamification !== true ||
          originalFeatures.rewards !== true
        ) {
          const enabled = await browserSend(
            page,
            "PATCH",
            "/api/family/features",
            {
              features: {
                ...originalFeatures,
                gamification: true,
                rewards: true,
              },
            },
          );
          expect(enabled.status, enabled.body).toBe(200);
          featureChanged = true;
        }

        for (const surface of ["sheet", "direct"] as const) {
          if (surface === "direct") mode = "failure";
          const form = await openSurface(page, surface, locale);
          const copy = rewardCreateMessages[locale];
          const name = form.getByLabel(new RegExp(copy.name));
          const description = form.getByLabel(copy.description, {
            exact: false,
          });
          const submit = form.getByRole("button", { name: copy.create });
          await expect(name).toBeVisible();
          await expect(description).toBeVisible();
          await assertActionGeometry(page, submit);
          await assertNoHorizontalOverflow(page);
          await assertA11y(page, surface);

          const rewardName = `${rewardNamePrefix}${locale}-${surface}`;
          ownedRewardNames.add(rewardName);
          await name.fill(rewardName);
          await description.fill("Keep this draft while retrying.");
          await submit.click();
          await expect(form.getByRole("alert")).toContainText(
            surface === "sheet" ? copy.permissionError : copy.permissionError,
          );
          await expect(name).toHaveValue(rewardName);
          await expect(description).toHaveValue(
            "Keep this draft while retrying.",
          );

          mode = "pending";
          const pendingClick = submit.click();
          await expect(
            form.getByRole("button", { name: copy.creating }),
          ).toBeDisabled();
          if (surface === "sheet") {
            await expect(
              page.getByRole("dialog").getByText(copy.pendingDescription),
            ).toBeVisible();
            await expect(
              form.getByRole("button", { name: copy.closeLabel }),
            ).toHaveCount(0);
            await page.keyboard.press("Escape");
            await expect(page).toHaveURL(/\/dashboard\/rewards\/create$/);
          }

          const rewardResponsePromise = page.waitForResponse(
            (response) =>
              response.url().endsWith("/api/rewards") &&
              response.request().method() === "POST",
          );
          finishPendingRequest?.(true);
          const [rewardResponse] = await Promise.all([
            rewardResponsePromise,
            pendingClick,
          ]);
          expect(rewardResponse.status()).toBe(200);
          const created = (await rewardResponse.json()) as {
            reward?: {
              id?: unknown;
              family_id?: unknown;
              created_by?: unknown;
              name?: unknown;
              description?: unknown;
              cost?: unknown;
              icon?: unknown;
            };
          };
          const rewardId = created.reward?.id;
          expect(typeof rewardId).toBe("string");
          expect(created.reward?.family_id).toBe(A.family);
          expect(created.reward?.created_by).toBe(A.parent);
          expect(created.reward?.name).toBe(rewardName);
          expect(created.reward?.description).toBe(
            "Keep this draft while retrying.",
          );
          expect(created.reward?.cost).toBe(50);
          expect(created.reward?.icon).toBe("🎁");
          ownedRewardIds.add(rewardId as string);

          await expect(page).toHaveURL(/\/dashboard\/rewards$/);
          const persisted = await browserFetch(page, "/api/rewards");
          expect(persisted.status, persisted.body).toBe(200);
          const persistedReward = (
            JSON.parse(persisted.body).rewards as Array<{
              id?: unknown;
              family_id?: unknown;
              created_by?: unknown;
              name?: unknown;
              description?: unknown;
              cost?: unknown;
              icon?: unknown;
            }>
          ).find((reward) => reward.id === rewardId);
          expect(persistedReward).toMatchObject({
            id: rewardId,
            family_id: A.family,
            created_by: A.parent,
            name: rewardName,
            description: "Keep this draft while retrying.",
            cost: 50,
            icon: "🎁",
          });
          expect(postBodies.at(-1)).toMatchObject({
            name: rewardName,
            description: "Keep this draft while retrying.",
            cost: 50,
            icon: "🎁",
          });

          if (surface === "sheet") await page.goto("/dashboard/rewards");
        }
        expect(postIdempotencyKeys).toHaveLength(4);
        expect(new Set(postIdempotencyKeys).size).toBe(postIdempotencyKeys.length);
        for (const key of postIdempotencyKeys) {
          expect(isValidIdempotencyKey(key)).toBe(true);
        }
        await testInfo.attach(`reward-create-${locale}-transport`, {
          body: JSON.stringify({
            locale,
            surfaces: ["sheet", "direct"],
            postCount: postBodies.length,
            idempotencyKeys: postIdempotencyKeys,
            transport:
              "Each refusal was synthetic; each pending retry continued to the real authenticated POST, read the persisted reward through GET, and cleaned only the exact fixture-owned rows.",
          }),
          contentType: "application/json",
        });
      } finally {
        // A failed run must abort a paused POST; it must never release a real
        // reward write merely because teardown is running.
        finishPendingRequest?.(false);
        await page.unrouteAll({ behavior: "ignoreErrors" });
        const cleanupErrors: unknown[] = [];
        try {
          await withDb((db) =>
            removeOwnedRewards(
              db,
              [...ownedRewardIds],
              [...ownedRewardNames],
              [...ownedReceiptKeys],
            ),
          );
        } catch (error) {
          cleanupErrors.push(error);
        }
        if (featureChanged && originalFeatures) {
          try {
            const restored = await browserSend(
              page,
              "PATCH",
              "/api/family/features",
              { features: originalFeatures },
            );
            expect(restored.status, restored.body).toBe(200);
          } catch (error) {
            cleanupErrors.push(error);
          }
        }
        try {
          await cleanAudit(true);
        } catch (error) {
          cleanupErrors.push(error);
        }
        await context.unrouteAll({ behavior: "ignoreErrors" });
        if (cleanupErrors.length) throw cleanupErrors[0];
      }
      expect(blockedWrites).toEqual([]);
    });
  });
}
