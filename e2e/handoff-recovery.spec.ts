/** Initial-load recovery for the parent-only Babysitter Handoff feature. */
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { LOCALE_STORAGE_KEY, messages } from "../src/i18n";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { ownFeatureAudit } from "./support/feature-audit";
import { authFile } from "./support/env";
import { browserFetch, browserSend, expect, test } from "./support/test";

const PROJECTS = ["phone-390x844", "desktop-1366x768"] as const;

const SYNTHETIC_HANDOFF_ID = "e2e_handoff_recovery";
const SYNTHETIC_PUBLIC_TOKEN = "synthetic-handoff-recovery-token";
const SYNTHETIC_EXPIRED_TOKEN = "synthetic-handoff-expired-token";
const SYNTHETIC_HANDOFF = {
  id: SYNTHETIC_HANDOFF_ID,
  sitter_name: "Synthetic sitter",
  sitter_phone: "555-0100",
  arrival_time: "2099-04-10T20:00:00.000Z",
  departure_time: null,
  kids_bedtimes: null,
  where_snacks: null,
  pickup_authorized: null,
  code_words: null,
  pet_care: null,
  emergency_notes: null,
  house_notes: "Synthetic house notes",
  general_notes: null,
  share_token: SYNTHETIC_PUBLIC_TOKEN,
  share_expires_at: "2099-04-11T02:00:00.000Z",
};
const SYNTHETIC_PUBLIC_HANDOFF = {
  id: SYNTHETIC_HANDOFF_ID,
  sitter_name: SYNTHETIC_HANDOFF.sitter_name,
  sitter_phone: null,
  arrival_time: SYNTHETIC_HANDOFF.arrival_time,
  departure_time: null,
  kids_bedtimes: null,
  where_snacks: null,
  pickup_authorized: null,
  code_words: null,
  pet_care: null,
  emergency_notes: null,
  house_notes: null,
  general_notes: null,
  family: { name: "Synthetic household" },
};

test.use({ storageState: authFile("parentA") });

function checkedSourceTree() {
  const actual = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();
  const configured = process.env.E2E_HANDOFF_BUILD_TREE?.trim();
  if (configured) expect(configured).toBe(actual);
  return actual;
}

function checkedCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function assertCleanTrackedAppSource() {
  try {
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "prisma"], {
      stdio: "ignore",
    });
  } catch {
    throw new Error(
      "Tracked app source differs from HEAD; rebuild handoff QA from the checked-out commit.",
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
  const response = await browserFetch(page, "/api/version");
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
    canonicalFeatureTransport: "PATCH /api/family/features enable and restore",
    handoffTransport:
      "GET /api/handoff synthetic 503/malformed/empty recovery; POST and public share responses intercepted",
  };
  expect(identity.buildId).not.toBe("");
  expect(identity.buildTree).toMatch(/^[a-f0-9]{40}$/);
  await info.attach("actual-handoff-runtime-identity", {
    body: JSON.stringify(identity),
    contentType: "application/json",
  });
  return identity;
}

async function captureState(
  page: Page,
  info: TestInfo,
  state:
    | "error"
    | "loading"
    | "malformed"
    | "empty"
    | "create-pending"
    | "create-error"
    | "create-success"
    | "public-error"
    | "public-malformed"
    | "public-valid"
    | "public-expired",
  identity: Awaited<ReturnType<typeof runtimeIdentity>>,
  scope = "#main-content",
) {
  const overflowFree = await page.evaluate(
    () => document.documentElement.scrollWidth <= innerWidth,
  );
  const violations = (
    await new AxeBuilder({ page }).include(scope).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  await info.attach(`${state}-source-identity`, {
    body: JSON.stringify({ identity, state, overflowFree, violations }),
    contentType: "application/json",
  });
  await info.attach(`${state}-axe`, {
    body: JSON.stringify(violations),
    contentType: "application/json",
  });
  await page.screenshot({
    path: info.outputPath(`handoff-${state}.png`),
    fullPage: true,
  });
  expect(overflowFree).toBe(true);
  expect(violations).toEqual([]);
}

for (const locale of ["en", "es"] as const) {
  const copy = messages[locale];

  test(`${locale}: handoff initial load can recover with a localized Retry`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.skip(
      !PROJECTS.includes(info.project.name as (typeof PROJECTS)[number]),
      "Handoff transport recovery runs on phone and desktop; deletion layout retains all six sizes",
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
      ({ key, language }) => localStorage.setItem(key, language),
      { key: LOCALE_STORAGE_KEY, language: locale },
    );

    await page.goto("/dashboard");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const identity = await runtimeIdentity(page, info, locale);
    const featuresResponse = await browserFetch(page, "/api/family/features");
    expect(featuresResponse.status, featuresResponse.body).toBe(200);
    const originalFeatures = JSON.parse(featuresResponse.body)
      .features as Record<string, boolean>;

    const cleanFeatureAudit = await ownFeatureAudit(["handoff"]);

    let featuresRestored = false;
    let handoffAttempts = 0;
    let createWrites = 0;
    let publicAttempts = 0;
    let createAccepted = false;
    const interceptedWrites: string[] = [];
    const blockedWrites: string[] = [];
    const releaseSuccessfulResponse = {
      current: null as (() => void) | null,
    };
    const successfulResponse = new Promise<void>((resolve) => {
      releaseSuccessfulResponse.current = resolve;
    });
    const releaseCreateResponse = {
      current: null as (() => void) | null,
    };
    const pendingCreateResponse = new Promise<void>((resolve) => {
      releaseCreateResponse.current = resolve;
    });

    await page.route("**/api/handoff**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "GET" && url.pathname === "/api/handoff") {
        handoffAttempts += 1;
        if (handoffAttempts === 1) {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: "Synthetic initial handoff refusal",
            }),
          });
          return;
        }
        if (handoffAttempts === 2) {
          await successfulResponse;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ handoffs: null }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            handoffs: createAccepted ? [SYNTHETIC_HANDOFF] : [],
          }),
        });
        return;
      }

      if (
        request.method() === "GET" &&
        url.pathname === `/api/handoff/share/${SYNTHETIC_EXPIRED_TOKEN}`
      ) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "Synthetic expired handoff" }),
        });
        return;
      }

      if (
        request.method() === "GET" &&
        url.pathname === `/api/handoff/share/${SYNTHETIC_PUBLIC_TOKEN}`
      ) {
        publicAttempts += 1;
        if (publicAttempts === 1) {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Synthetic public handoff outage" }),
          });
        } else if (publicAttempts === 2) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: "null",
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ handoff: SYNTHETIC_PUBLIC_HANDOFF }),
          });
        }
        return;
      }

      if (request.method() === "POST" && url.pathname === "/api/handoff") {
        expect(request.headers()["x-csrf-token"]).toBeTruthy();
        createWrites += 1;
        interceptedWrites.push(`${request.method()} ${url.pathname}`);
        expect(request.postDataJSON()).toMatchObject({
          sitter_name: SYNTHETIC_HANDOFF.sitter_name,
          sitter_phone: SYNTHETIC_HANDOFF.sitter_phone,
          house_notes: SYNTHETIC_HANDOFF.house_notes,
        });
        if (createWrites === 1) {
          await pendingCreateResponse;
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Synthetic handoff save refusal" }),
          });
        } else {
          createAccepted = true;
          await route.fulfill({
            status: 201,
            contentType: "application/json",
            body: JSON.stringify({ handoff: SYNTHETIC_HANDOFF }),
          });
        }
        return;
      }

      const method = request.method();
      if (["POST", "PATCH", "PUT", "DELETE"].includes(method)) {
        blockedWrites.push(`${method} ${url.pathname}`);
        await route.abort("blockedbyclient");
        return;
      }

      blockedWrites.push(`${method} ${url.pathname}`);
      await route.abort("blockedbyclient");
    });

    try {
      const enabled = await browserSend(page, "PATCH", "/api/family/features", {
        features: { ...originalFeatures, handoff: true },
      });
      expect(enabled.status, enabled.body).toBe(200);

      const firstHandoffResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "GET" &&
          new URL(response.url()).pathname === "/api/handoff",
      );
      await page.goto("/dashboard/handoff");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);

      const main = page.locator("#main-content");
      const loadError = main.getByRole("alert");
      await expect(loadError).toContainText(copy.handoff.errorLoad);
      expect((await firstHandoffResponse).status()).toBe(503);
      expect(handoffAttempts).toBe(1);
      await captureState(page, info, "error", identity);

      const retry = main.getByRole("button", {
        name: copy.routeState.tryAgain,
        exact: true,
      });
      await expect(retry).toBeVisible();
      const retryBox = await retry.boundingBox();
      expect(retryBox).not.toBeNull();
      expect(retryBox!.height).toBeGreaterThanOrEqual(44);
      expect(retryBox!.width).toBeGreaterThanOrEqual(44);

      const retryResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "GET" &&
          new URL(response.url()).pathname === "/api/handoff",
      );
      await retry.click();
      await expect(
        main.getByText(copy.common.loading, { exact: true }),
      ).toBeVisible();
      expect(handoffAttempts).toBe(2);
      await captureState(page, info, "loading", identity);

      releaseSuccessfulResponse.current?.();
      expect((await retryResponse).status()).toBe(200);
      await expect(loadError).toContainText(copy.handoff.errorLoad);
      await captureState(page, info, "malformed", identity);

      const malformedRetry = main.getByRole("button", {
        name: copy.routeState.tryAgain,
        exact: true,
      });
      await malformedRetry.click();
      await expect(
        main.getByRole("heading", { name: copy.handoff.empty, exact: true }),
      ).toBeVisible();
      await expect(loadError).toHaveCount(0);
      await captureState(page, info, "empty", identity);

      const createTrigger = main
        .getByRole("button", { name: copy.handoff.createHandoff, exact: true })
        .first();
      await createTrigger.click();
      const createDialog = page.getByRole("dialog", {
        name: copy.handoff.createHandoff,
        exact: true,
      });
      const optionalDetails = createDialog.getByTestId(
        "handoff-optional-details",
      );
      const optionalDetailsCopy =
        locale === "es" ? "Detalles opcionales" : "Optional details";
      await optionalDetails
        .getByText(optionalDetailsCopy, { exact: true })
        .click();
      await expect(optionalDetails).toHaveAttribute("open", "");
      await createDialog
        .getByLabel(copy.handoff.sitterName, { exact: true })
        .fill(SYNTHETIC_HANDOFF.sitter_name);
      await createDialog
        .getByLabel(copy.handoff.arrivalTime, { exact: true })
        .fill("2099-04-10T20:00");
      await createDialog
        .getByLabel(copy.handoff.sitterPhone, { exact: true })
        .fill(SYNTHETIC_HANDOFF.sitter_phone);
      await createDialog
        .getByLabel(copy.handoff.houseNotes, { exact: true })
        .fill(SYNTHETIC_HANDOFF.house_notes);

      const createResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/api/handoff",
      );
      await createDialog
        .getByRole("button", { name: copy.common.save, exact: true })
        .click();
      await expect.poll(() => createWrites).toBe(1);
      await expect(
        createDialog.getByRole("button", {
          name: copy.common.saving,
          exact: true,
        }),
      ).toBeDisabled();
      for (const control of await createDialog
        .locator("input, textarea, select")
        .all()) {
        await expect(control).toBeDisabled();
      }
      await expect(
        createDialog.getByTestId("handoff-form-footer"),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(createDialog).toBeVisible();
      await expect(
        createDialog.getByLabel(copy.handoff.sitterName, { exact: true }),
      ).toHaveValue(SYNTHETIC_HANDOFF.sitter_name);
      await captureState(page, info, "create-pending", identity);

      releaseCreateResponse.current?.();
      expect((await createResponse).status()).toBe(503);
      await expect(createDialog.getByRole("alert")).toContainText(
        "Synthetic handoff save refusal",
      );
      await expect(
        createDialog.getByLabel(copy.handoff.sitterName, { exact: true }),
      ).toHaveValue(SYNTHETIC_HANDOFF.sitter_name);
      await expect(
        createDialog.getByLabel(copy.handoff.houseNotes, { exact: true }),
      ).toHaveValue(SYNTHETIC_HANDOFF.house_notes);
      await captureState(page, info, "create-error", identity);

      const successfulCreateResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/api/handoff",
      );
      await createDialog
        .getByRole("button", { name: copy.common.save, exact: true })
        .click();
      expect((await successfulCreateResponse).status()).toBe(201);
      await expect(createDialog).toHaveCount(0);
      await expect(
        main.getByText(SYNTHETIC_HANDOFF.sitter_name, { exact: true }),
      ).toBeVisible();
      expect(createWrites).toBe(2);
      await captureState(page, info, "create-success", identity);

      const publicRecoveryCopy =
        locale === "es"
          ? "No se pudo cargar esta entrega"
          : "This handoff could not be loaded";
      await page.goto(`/handoff/${SYNTHETIC_PUBLIC_TOKEN}`);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      const publicMain = page.locator("body");
      await expect(
        publicMain.getByRole("heading", {
          name: publicRecoveryCopy,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        publicMain.getByRole("button", {
          name: copy.routeState.tryAgain,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        publicMain.getByText(copy.handoff.linkInvalid, { exact: true }),
      ).toHaveCount(0);
      await captureState(page, info, "public-error", identity, "body");

      const publicRetry = publicMain.getByRole("button", {
        name: copy.routeState.tryAgain,
        exact: true,
      });
      await publicRetry.click();
      await expect(
        publicMain.getByRole("heading", {
          name: publicRecoveryCopy,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        publicMain.getByText(copy.handoff.linkInvalid, { exact: true }),
      ).toHaveCount(0);
      await captureState(page, info, "public-malformed", identity, "body");

      await publicRetry.click();
      await expect(
        publicMain.getByRole("heading", {
          name: copy.handoff.handoffFor.replace(
            "{family}",
            SYNTHETIC_PUBLIC_HANDOFF.family.name,
          ),
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        publicMain.getByText(SYNTHETIC_PUBLIC_HANDOFF.sitter_name, {
          exact: true,
        }),
      ).toBeVisible();
      await captureState(page, info, "public-valid", identity, "body");

      await page.goto(`/handoff/${SYNTHETIC_EXPIRED_TOKEN}`);
      await expect(
        page.locator("body").getByRole("heading", {
          name: copy.handoff.linkInvalid,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page
          .locator("body")
          .getByRole("heading", { name: publicRecoveryCopy, exact: true }),
      ).toHaveCount(0);
      await captureState(page, info, "public-expired", identity, "body");

      expect(blockedWrites).toEqual([]);
      await info.attach("handoff-domain-write-receipts", {
        body: JSON.stringify({
          identity,
          interceptedWrites,
          blockedWrites,
          createWrites,
          publicAttempts,
        }),
        contentType: "application/json",
      });
    } finally {
      releaseSuccessfulResponse.current?.();
      releaseCreateResponse.current?.();
      try {
        let restored;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            restored = await browserSend(
              page,
              "PATCH",
              "/api/family/features",
              {
                features: originalFeatures,
              },
            );
            if (restored.status === 200 || restored.status < 500) break;
          } catch (error) {
            if (attempt === 1) throw error;
          }
        }
        expect(restored).toBeDefined();
        expect(restored!.status, restored!.body).toBe(200);
        const canonical = await browserFetch(page, "/api/family/features");
        expect(canonical.status, canonical.body).toBe(200);
        expect(
          (JSON.parse(canonical.body) as { features: unknown }).features,
        ).toEqual(originalFeatures);
        featuresRestored = true;
      } finally {
        try {
          await cleanFeatureAudit(featuresRestored);
        } finally {
          await page.unroute("**/api/handoff**");
        }
      }
    }
  });
}
