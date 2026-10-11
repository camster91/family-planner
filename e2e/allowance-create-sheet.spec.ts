/**
 * Allowance creation proof.
 *
 * The responsive/localized recovery journey uses synthetic roster and POST
 * responses and never writes a household row. The real proof uses the fixture
 * POST and read-back at every supported viewport, then removes only exact
 * returned allowance and idempotency receipt ids. No broad reset is used.
 */
import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page, TestInfo } from "@playwright/test";
import { allowanceCreateMessages } from "../src/i18n/allowance-create";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { authFile } from "./support/env";
import { removeOwnedAllowanceArtifacts } from "./support/allowance-cleanup";
import { ownFeatureAudit } from "./support/feature-audit";
import { browserFetch, browserSend, expect, test } from "./support/test";

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

type Locale = "en" | "es";

async function installLocalGuard(
  context: BrowserContext,
  blockedWrites: string[],
  allowedWrites: Set<string>,
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
    const mutation = `${request.method()} ${url.pathname}`;
    if (
      MUTATING_METHODS.has(request.method()) &&
      !allowedWrites.has(mutation)
    ) {
      blockedWrites.push(mutation);
      await route.abort();
      return;
    }
    await route.continue();
  });
}

async function setLocale(page: Page, locale: Locale) {
  await page.addInitScript(
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
}

async function assertSheetSurface(
  page: Page,
  dialog: ReturnType<Page["getByRole"]>,
) {
  const save = dialog.getByRole("button", { name: /Guardar|Save/ });
  const box = await save.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const violations = (
    await new AxeBuilder({ page }).include('[role="dialog"]').analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
}

test.use({ storageState: authFile("parentA") });

for (const locale of ["en", "es"] as const) {
  test(`${locale}: allowance sheet retains draft and blocks pending dismissal at every supported size`, async ({
    page,
    context,
    browser,
    baseURL,
  }, info: TestInfo) => {
    test.skip(
      !PROJECT_NAMES.has(info.project.name),
      "all configured responsive projects are covered",
    );
    assertFixtureTargetAllowed(process.env);
    expect(LOOPBACK_HOSTS.has(new URL(baseURL!).hostname)).toBe(true);
    await setLocale(page, locale);

    const originalResponse = await browserFetch(page, "/api/family/features");
    expect(originalResponse.status, originalResponse.body).toBe(200);
    const originalFeatures = JSON.parse(originalResponse.body)
      .features as Record<string, boolean>;
    const cleanAudit = await ownFeatureAudit(["allowance"]);
    const recoveryPage = await context.newPage();
    const blockedWrites: string[] = [];
    const allowedWrites = new Set([
      "PATCH /api/family/features",
      "POST /api/allowance",
    ]);
    let releasePost: (() => void) | undefined;
    let restored = false;
    try {
      const enabled = await browserSend(page, "PATCH", "/api/family/features", {
        features: { ...originalFeatures, allowance: true },
      });
      expect(enabled.status, enabled.body).toBe(200);
      await installLocalGuard(context, blockedWrites, allowedWrites);

      let memberAttempts = 0;
      await page.route("**/api/family/members", async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        memberAttempts += 1;
        if (memberAttempts === 1) {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "synthetic roster refusal" }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            members: [{ id: "synthetic-child", name: "Sam", avatar_url: null }],
          }),
        });
      });

      const postHeaders: string[] = [];
      const postBodies: unknown[] = [];
      await page.route("**/api/allowance", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        postHeaders.push(route.request().headers()["idempotency-key"] ?? "");
        postBodies.push(route.request().postDataJSON());
        await new Promise<void>((resolve) => {
          releasePost = resolve;
        });
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ allowance: { id: "synthetic-allowance" } }),
        });
      });

      await page.goto("/dashboard/allowance");
      const copy = allowanceCreateMessages[locale];
      await page.getByRole("link", { name: copy.add }).click();
      const dialog = page.getByRole("dialog", { name: copy.sheetTitle });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("alert")).toContainText(copy.rosterError);
      await dialog.getByLabel(copy.amount).fill("10.00");
      await dialog.getByLabel(copy.reason).fill("Weekly allowance");
      await dialog.getByRole("button", { name: copy.tryAgain }).click();
      await expect(dialog.getByRole("option", { name: "Sam" })).toBeVisible();
      await dialog.getByLabel(copy.forLabel).selectOption("synthetic-child");
      await assertSheetSurface(page, dialog);
      const save = dialog.getByRole("button", { name: copy.save });
      await save.click();
      await expect(
        dialog.getByRole("button", { name: copy.saving }),
      ).toBeDisabled();
      await expect(dialog.getByLabel(copy.forLabel)).toBeDisabled();
      await expect(dialog.getByLabel(copy.amount)).toBeDisabled();
      await expect(dialog.getByLabel(copy.reason)).toBeDisabled();
      await expect(
        dialog.getByRole("button", { name: copy.closeLabel }),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      expect(postHeaders[0]).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
      expect(postBodies[0]).toEqual({
        to_user_id: "synthetic-child",
        amount: 10,
        reason: "Weekly allowance",
      });
      const release = releasePost;
      if (release) release();
      await expect(dialog).toHaveCount(0);
      expect(blockedWrites).toEqual([]);

      // The refusal path is a separate child view: no synthetic POST is
      // installed or sent, and the API remains the authority for the role.
      const childContext = await browser.newContext({
        baseURL,
        storageState: authFile("childA"),
      });
      const childPage = await childContext.newPage();
      await setLocale(childPage, locale);
      try {
        await childPage.goto("/dashboard/allowance");
        await expect(
          childPage.getByRole("link", { name: copy.add }),
        ).toHaveCount(0);
        await childPage.goto("/dashboard/allowance/create");
        const refused = childPage.getByTestId("allowance-create-refused");
        await expect(refused).toBeVisible();
        await expect(refused).toContainText(copy.refusalTitle);
        await expect(childPage.getByLabel(copy.amount)).toHaveCount(0);
      } finally {
        await childContext.close();
      }
    } finally {
      const release = releasePost;
      if (release) release();
      await context.unrouteAll({ behavior: "ignoreErrors" });
      try {
        await recoveryPage.goto("/dashboard");
        const restoredResponse = await browserSend(
          recoveryPage,
          "PATCH",
          "/api/family/features",
          { features: originalFeatures },
        );
        expect(restoredResponse.status, restoredResponse.body).toBe(200);
        const canonical = await browserFetch(
          recoveryPage,
          "/api/family/features",
        );
        expect(canonical.status, canonical.body).toBe(200);
        expect(JSON.parse(canonical.body).features).toEqual(originalFeatures);
        restored = true;
      } finally {
        try {
          await cleanAudit(restored);
        } finally {
          await recoveryPage.close({ runBeforeUnload: false }).catch(() => {});
        }
      }
    }
  });
}

for (const locale of ["en", "es"] as const) {
  test(`${locale}: real allowance create/read-back uses one lost-response key at every supported size`, async ({
    page,
    context,
    baseURL,
  }) => {
    assertFixtureTargetAllowed(process.env);
    expect(LOOPBACK_HOSTS.has(new URL(baseURL!).hostname)).toBe(true);
    await setLocale(page, locale);

    const originalResponse = await browserFetch(page, "/api/family/features");
    expect(originalResponse.status, originalResponse.body).toBe(200);
    const originalFeatures = JSON.parse(originalResponse.body)
      .features as Record<string, boolean>;
    const cleanAudit = await ownFeatureAudit(["allowance"]);
    const recoveryPage = await context.newPage();
    const blockedWrites: string[] = [];
    const allowedWrites = new Set([
      "PATCH /api/family/features",
      "POST /api/allowance",
    ]);
    let allowanceId: string | null = null;
    let reason = "";
    const postKeys: string[] = [];
    let restored = false;

    try {
      const enabled = await browserSend(page, "PATCH", "/api/family/features", {
        features: { ...originalFeatures, allowance: true },
      });
      expect(enabled.status, enabled.body).toBe(200);
      await installLocalGuard(context, blockedWrites, allowedWrites);
      let firstResponseLost = false;
      await page.route("**/api/allowance", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        postKeys.push(route.request().headers()["idempotency-key"] ?? "");
        if (!firstResponseLost) {
          firstResponseLost = true;
          // The origin commits the first request; only its browser response is
          // lost, so the next click must replay the same intent and key.
          await route.fetch();
          await route.abort("failed");
          return;
        }
        await route.continue();
      });

      const copy = allowanceCreateMessages[locale];
      await page.goto("/dashboard/allowance/create");
      reason = `E2E allowance ${crypto.randomUUID()}`;
      const form = page.getByTestId("allowance-create-form");
      await expect(form).toBeVisible();
      await form
        .getByLabel(copy.forLabel)
        .selectOption(FIXTURE_IDS.familyA.child);
      await form.getByLabel(copy.amount).fill("17.35");
      await form.getByLabel(copy.reason).fill(reason);
      await form.getByRole("button", { name: copy.save }).click();
      await expect(form.getByRole("alert")).toContainText(copy.networkError);

      const postResponse = page.waitForResponse(
        (candidate) =>
          candidate.request().method() === "POST" &&
          new URL(candidate.url()).pathname === "/api/allowance",
      );
      await form.getByRole("button", { name: copy.save }).click();
      const createdResponse = await postResponse;
      const createdBody = await createdResponse.text();
      expect(createdResponse.status(), createdBody).toBe(201);
      const envelope = JSON.parse(createdBody) as {
        allowance?: { id?: string; reason?: string | null };
      };
      allowanceId = envelope.allowance?.id ?? null;
      expect(allowanceId).toEqual(expect.any(String));
      expect(envelope.allowance?.reason).toBe(reason);
      expect(postKeys).toHaveLength(2);
      expect(postKeys[0]).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
      expect(postKeys[1]).toBe(postKeys[0]);
      await expect(page).toHaveURL(/\/dashboard\/allowance$/);

      const readBack = await browserFetch(page, "/api/allowance");
      expect(readBack.status, readBack.body).toBe(200);
      const rows = (
        JSON.parse(readBack.body).items as Array<Record<string, unknown>>
      ).filter((item) => item.reason === reason);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: allowanceId,
        from_user_id: FIXTURE_IDS.familyA.parent,
        to_user_id: FIXTURE_IDS.familyA.child,
        reason,
        amount: 17.35,
      });
    } finally {
      // Remove exact, verified rows and receipts through the guarded PG helper.
      // This runs before feature restoration so a failed UI path cannot leave
      // a money row behind as a cancelled record.
      try {
        await context.unrouteAll({ behavior: "ignoreErrors" });
        await recoveryPage.goto("/dashboard");
        const cleanupIds = new Set<string>();
        if (allowanceId) cleanupIds.add(allowanceId);
        if (reason) {
          const cleanupRead = await browserFetch(
            recoveryPage,
            "/api/allowance",
          );
          expect(cleanupRead.status, cleanupRead.body).toBe(200);
          for (const item of (JSON.parse(cleanupRead.body).items ??
            []) as Array<Record<string, unknown>>) {
            if (item.reason === reason && typeof item.id === "string") {
              cleanupIds.add(item.id);
            }
          }
        }
        await removeOwnedAllowanceArtifacts({
          familyId: FIXTURE_IDS.familyA.family,
          fromUserId: FIXTURE_IDS.familyA.parent,
          toUserId: FIXTURE_IDS.familyA.child,
          reason,
          allowanceIds: [...cleanupIds],
          idempotencyKeys: postKeys,
        });
      } finally {
        // A separate owned page keeps restoration possible if the journey page
        // was closed by a failed navigation or an interrupted response.
        try {
          await recoveryPage.goto("/dashboard");
          const restoredResponse = await browserSend(
            recoveryPage,
            "PATCH",
            "/api/family/features",
            { features: originalFeatures },
          );
          expect(restoredResponse.status, restoredResponse.body).toBe(200);
          const canonical = await browserFetch(
            recoveryPage,
            "/api/family/features",
          );
          expect(canonical.status, canonical.body).toBe(200);
          expect(JSON.parse(canonical.body).features).toEqual(originalFeatures);
          restored = true;
        } finally {
          try {
            await cleanAudit(restored);
          } finally {
            await recoveryPage
              .close({ runBeforeUnload: false })
              .catch(() => {});
          }
        }
      }
    }
    expect(blockedWrites).toEqual([]);
  });
}
