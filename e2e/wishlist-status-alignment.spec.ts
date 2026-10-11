/**
 * Guarded Wishlist status recovery journey.
 *
 * The parent route and feature toggle use the disposable Family A fixture.
 * Wishlist reads and status changes are fabricated in the browser; every
 * other state-changing API request is blocked. This keeps the denial,
 * pending-lock and uncertain-reconciliation journey reviewable without
 * writing a real wishlist row.
 */
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { authFile } from "./support/env";
import { ownFeatureAudit } from "./support/feature-audit";
import { browserFetch, browserSend, expect, test } from "./support/test";

test.use({ storageState: authFile("parentA") });

const VIEWPORT_PROJECTS = [
  "phone-390x844",
  "phone-430x932",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
  "tablet-large-1920x1200",
  "desktop-1366x768",
] as const;

type Locale = "en" | "es";

const COPY: Record<
  Locale,
  {
    title: string;
    deny: string;
    reason: string;
    placeholder: string;
    confirm: string;
    cancel: string;
    idle: string;
    received: string;
    tryAgain: string;
    uncertain: string;
    statusError: string;
  }
> = {
  en: {
    title: "Wishlist",
    deny: "Deny wish",
    reason: "Reason for denial",
    placeholder: "Tell the family why this wish is denied.",
    confirm: "Deny wish",
    cancel: "Cancel",
    idle: "Idle",
    received: "Received",
    tryAgain: "Please try again.",
    uncertain:
      "We could not confirm the status change. The wishlist was refreshed; check the current status before trying again.",
    statusError: "Couldn't change the status.",
  },
  es: {
    title: "Lista de deseos",
    deny: "Denegar deseo",
    reason: "Razon de denegacion",
    placeholder: "Explica a la familia por que se deniega este deseo.",
    confirm: "Denegar deseo",
    cancel: "Cancelar",
    idle: "Pendiente",
    received: "Recibido",
    tryAgain: "Intentalo de nuevo.",
    uncertain:
      "No pudimos confirmar el cambio de estado. Actualizamos los deseos; revisa el estado actual antes de intentarlo de nuevo.",
    statusError: "No se pudo cambiar el estado.",
  },
};

type WishlistItem = {
  id: string;
  title: string;
  link: string | null;
  description: string | null;
  approx_price: string | null;
  status: string;
  denied_reason: string | null;
  requested_by: string;
  created_at: string;
  requester: { id: string; name: string };
};

const ITEMS = {
  pending: "fx_e2e_wishlist_pending",
  uncertain: "fx_e2e_wishlist_uncertain",
  denial: "fx_e2e_wishlist_denial",
} as const;

function initialItems(): WishlistItem[] {
  const requester = {
    id: FIXTURE_IDS.familyA.parent,
    name: "Synthetic Family A",
  };
  return [
    {
      id: ITEMS.pending,
      title: "Synthetic pending bicycle",
      link: null,
      description: "Fabricated status-recovery item.",
      approx_price: "42.00",
      status: "idle",
      denied_reason: null,
      requested_by: FIXTURE_IDS.familyA.parent,
      created_at: "2026-01-05T12:00:00.000Z",
      requester,
    },
    {
      id: ITEMS.uncertain,
      title: "Synthetic uncertain art set",
      link: null,
      description: "Fabricated uncertain-retry item.",
      approx_price: null,
      status: "idle",
      denied_reason: null,
      requested_by: FIXTURE_IDS.familyA.parent,
      created_at: "2026-01-05T12:01:00.000Z",
      requester,
    },
    {
      id: ITEMS.denial,
      title: "Synthetic denied wish",
      link: null,
      description: "Fabricated denial-dialog item.",
      approx_price: null,
      status: "idle",
      denied_reason: null,
      requested_by: FIXTURE_IDS.familyA.parent,
      created_at: "2026-01-05T12:02:00.000Z",
      requester,
    },
  ];
}

function cloneItems(items: WishlistItem[]) {
  return items.map((item) => ({
    ...item,
    requester: { ...item.requester },
  }));
}

function sourceCommit() {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  expect(commit).toMatch(/^[a-f0-9]{40}$/);
  return commit;
}

function sourceTree() {
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();
  expect(tree).toMatch(/^[a-f0-9]{40}$/);
  const configured = process.env.E2E_WISHLIST_BUILD_TREE?.trim();
  if (configured) expect(configured).toBe(tree);
  return tree;
}

function compiledBuiltAt() {
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

async function runtimeIdentity(page: Page, info: TestInfo, locale: Locale) {
  const commit = sourceCommit();
  expect(process.env.RELEASE_SHA?.trim()).toBe(commit);
  expect(() =>
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "prisma"], {
      stdio: "ignore",
    }),
  ).not.toThrow();

  const tree = sourceTree();
  const response = await browserFetch(page, "/api/version");
  expect(response.status, response.body).toBe(200);
  const runtime = JSON.parse(response.body) as {
    version: string;
    commit: string;
    builtAt: string;
  };
  expect(runtime.commit).toBe(commit);
  expect(runtime.builtAt).toBe(compiledBuiltAt());

  const auth = await browserFetch(page, "/api/auth/me");
  expect(auth.status, auth.body).toBe(200);
  const me = JSON.parse(auth.body) as {
    user?: { id?: string; family_id?: string; role?: string };
  };
  expect(me.user).toMatchObject({
    id: FIXTURE_IDS.familyA.parent,
    family_id: FIXTURE_IDS.familyA.family,
    role: "parent",
  });

  const identity = {
    runtime,
    buildTree: tree,
    locale,
    role: me.user?.role,
    fixtureFamily: FIXTURE_IDS.familyA.family,
    transport:
      "Wishlist GET/status PATCH responses are fabricated; feature toggle is restored; unknown writes are blocked",
  };
  await info.attach("wishlist-runtime-identity", {
    body: JSON.stringify(identity),
    contentType: "application/json",
  });
  return identity;
}

async function assertTouchTarget(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  const viewport = page.viewportSize();
  expect(box).toBeTruthy();
  expect(viewport).toBeTruthy();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
}

async function assertPageHealth(page: Page, info: TestInfo, locale: Locale) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const violations = (
    await new AxeBuilder({ page })
      .include("#main-content")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  await info.attach(`wishlist-${locale}-accessibility`, {
    body: JSON.stringify({ locale, violations }),
    contentType: "application/json",
  });
  expect(violations).toEqual([]);
}

for (const locale of ["en", "es"] as const) {
  test.describe(`${locale} Wishlist status alignment`, () => {
    test.use({ colorScheme: locale === "es" ? "dark" : "light" });

    test(`${locale}: denial and status recovery stay localized, focused and write-safe`, async ({
      page,
      context,
      baseURL,
    }, info) => {
      expect(VIEWPORT_PROJECTS).toContain(
        info.project.name as (typeof VIEWPORT_PROJECTS)[number],
      );
      assertFixtureTargetAllowed(process.env);
      expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
        new URL(baseURL!).hostname,
      );

      const copy = COPY[locale];
      const blockedWrites: string[] = [];
      const items = initialItems();
      let pendingPatchAttempts = 0;
      let uncertainPatchAttempts = 0;
      let denialPatchAttempts = 0;
      let wishlistGets = 0;
      let releasePendingPatch: (() => void) | undefined;
      let pendingPatchComplete: Promise<void> | undefined;
      let releaseDenialPatch: (() => void) | undefined;
      let denialPatchComplete: Promise<void> | undefined;

      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(
          url.hostname,
        );
        if (!isLocal && !["data:", "blob:"].includes(url.protocol)) {
          await route.abort();
          return;
        }
        const method = route.request().method();
        const isFeatureRestore =
          method === "PATCH" && url.pathname === "/api/family/features";
        const isWishlistTransport = url.pathname.startsWith("/api/wishlist");
        if (
          isLocal &&
          url.pathname.startsWith("/api/") &&
          !["GET", "HEAD", "OPTIONS"].includes(method) &&
          !isFeatureRestore &&
          !isWishlistTransport
        ) {
          blockedWrites.push(`${method} ${url.pathname}`);
          await route.abort();
          return;
        }
        await route.continue();
      });

      await context.addInitScript(
        ({ language, localeKey, themeKey }) => {
          localStorage.setItem(localeKey, language);
          localStorage.setItem(themeKey, language === "es" ? "dark" : "light");
        },
        {
          language: locale,
          localeKey: LOCALE_STORAGE_KEY,
          themeKey: THEME_STORAGE_KEY,
        },
      );

      await page.goto("/dashboard");
      const originalFeaturesResponse = await browserFetch(
        page,
        "/api/family/features",
      );
      expect(
        originalFeaturesResponse.status,
        originalFeaturesResponse.body,
      ).toBe(200);
      const originalFeatures = JSON.parse(originalFeaturesResponse.body)
        .features as Record<string, boolean>;
      const cleanFeatureAudit = await ownFeatureAudit(["wishlist"]);
      let featuresRestored = false;

      await page.route("**/api/wishlist**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() === "GET" && url.pathname === "/api/wishlist") {
          wishlistGets += 1;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ items: cloneItems(items) }),
          });
          return;
        }

        const statusMatch = url.pathname.match(
          /^\/api\/wishlist\/([^/]+)\/status$/,
        );
        if (request.method() === "PATCH" && statusMatch) {
          const id = statusMatch[1];
          const body = request.postDataJSON() as {
            status?: string;
            denied_reason?: string;
          };
          expect(body.status).toBeTruthy();
          expect(request.headers()["content-type"]).toContain(
            "application/json",
          );

          if (id === ITEMS.pending) {
            pendingPatchAttempts += 1;
            expect(body.status).toBe("received");
            if (pendingPatchAttempts === 1) {
              let release!: () => void;
              let complete!: () => void;
              const pending = new Promise<void>((resolve) => {
                release = resolve;
              });
              pendingPatchComplete = new Promise<void>((resolve) => {
                complete = resolve;
              });
              releasePendingPatch = release;
              try {
                await pending;
                const item = items.find((candidate) => candidate.id === id)!;
                item.status = "received";
                await route.fulfill({
                  status: 503,
                  contentType: "application/json",
                  body: JSON.stringify({
                    error: "SYNTHETIC_STATUS_UPSTREAM_DETAIL",
                  }),
                });
              } finally {
                complete();
              }
              return;
            }
          }

          if (id === ITEMS.uncertain) {
            uncertainPatchAttempts += 1;
            expect(body.status).toBe("received");
            if (uncertainPatchAttempts === 1) {
              await route.abort("failed");
              return;
            }
          }

          if (id === ITEMS.denial) {
            denialPatchAttempts += 1;
            expect(body.status).toBe("denied");
            expect(body.denied_reason).toBe("Synthetic family reason");
            if (denialPatchAttempts === 1) {
              let release!: () => void;
              let complete!: () => void;
              const pending = new Promise<void>((resolve) => {
                release = resolve;
              });
              denialPatchComplete = new Promise<void>((resolve) => {
                complete = resolve;
              });
              releaseDenialPatch = release;
              try {
                await pending;
                await route.fulfill({
                  status: 403,
                  contentType: "application/json",
                  body: JSON.stringify({}),
                });
              } finally {
                complete();
              }
              return;
            }
          }

          const item = items.find((candidate) => candidate.id === id);
          expect(item).toBeTruthy();
          item!.status = body.status!;
          item!.denied_reason =
            body.status === "denied" ? (body.denied_reason ?? null) : null;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ item: { ...item } }),
          });
          return;
        }

        if (request.method() !== "GET") {
          blockedWrites.push(`${request.method()} ${url.pathname}`);
          await route.abort();
          return;
        }
        await route.fulfill({
          status: 404,
          json: { error: "Unknown wishlist route" },
        });
      });

      try {
        const enabled = await browserSend(
          page,
          "PATCH",
          "/api/family/features",
          {
            features: { ...originalFeatures, wishlist: true },
          },
        );
        expect(enabled.status, enabled.body).toBe(200);

        await page.goto("/dashboard/wishlist");
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        if (locale === "es") {
          await expect(page.locator("html")).toHaveClass(/\bdark\b/);
        } else {
          await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
        }
        await expect(
          page.getByRole("heading", { name: copy.title, level: 1 }),
        ).toBeVisible();
        await runtimeIdentity(page, info, locale);
        expect(blockedWrites).toEqual([]);

        const statusFor = (title: string) =>
          page.getByRole("combobox", {
            name: `Status for ${title}`,
            exact: true,
          });
        const pendingSelect = statusFor("Synthetic pending bicycle");
        const uncertainSelect = statusFor("Synthetic uncertain art set");
        const denialSelect = statusFor("Synthetic denied wish");
        await expect(pendingSelect).toHaveValue("idle");
        await expect(uncertainSelect).toHaveValue("idle");
        await expect(denialSelect).toHaveValue("idle");

        for (const select of [pendingSelect, uncertainSelect, denialSelect]) {
          await assertTouchTarget(page, select);
        }

        await pendingSelect.selectOption("received");
        await expect.poll(() => pendingPatchAttempts).toBe(1);
        await expect(pendingSelect).toBeDisabled();
        await expect(pendingSelect).toHaveAttribute("aria-busy", "true");
        // The lock is per wishlist item: another status select remains usable.
        await expect(uncertainSelect).toBeEnabled();
        releasePendingPatch?.();
        await pendingPatchComplete;
        await expect(pendingSelect).toHaveValue("received");
        expect(wishlistGets).toBeGreaterThanOrEqual(2);
        await expect(page.locator("body")).not.toContainText(
          "SYNTHETIC_STATUS_UPSTREAM_DETAIL",
        );

        await denialSelect.selectOption("denied");
        const denialDialog = page.getByRole("dialog", {
          name: copy.deny,
          exact: true,
        });
        await expect(denialDialog).toBeVisible();
        await expect(denialDialog).toHaveClass(/rounded-t/);
        const reason = denialDialog.getByLabel(copy.reason, { exact: true });
        await expect(reason).toBeFocused();
        await expect(reason).toHaveAttribute("placeholder", copy.placeholder);
        for (const button of await denialDialog.getByRole("button").all()) {
          await assertTouchTarget(page, button);
        }
        await expect(
          denialDialog.getByRole("button", { name: copy.cancel, exact: true }),
        ).toHaveCount(2);
        await reason.fill("Synthetic family reason");
        await denialDialog
          .getByRole("button", { name: copy.confirm, exact: true })
          .click();
        await expect.poll(() => denialPatchAttempts).toBe(1);
        await expect(reason).toHaveValue("Synthetic family reason");
        await expect(
          denialDialog
            .getByRole("button", { name: copy.cancel, exact: true })
            .nth(1),
        ).toBeDisabled();
        await expect(
          denialDialog.getByRole("button", { name: copy.confirm, exact: true }),
        ).toBeDisabled();
        await expect(reason).toHaveValue("Synthetic family reason");
        await expect(denialDialog).toContainText(copy.reason);
        // Keep the first denial request in flight until the pending lock is
        // observed. This makes the state assertion deterministic on phones;
        // the response is still the same fabricated 403.
        releaseDenialPatch?.();
        if (denialPatchComplete) await denialPatchComplete;
        await expect(denialDialog.getByRole("alert")).toHaveText(copy.tryAgain);
        await denialDialog
          .getByRole("button", { name: copy.confirm, exact: true })
          .click();
        await expect(denialDialog).toHaveCount(0);
        await expect(denialSelect).toHaveValue("denied");
        await expect(denialSelect).toBeFocused();
        expect(denialPatchAttempts).toBe(2);

        await uncertainSelect.selectOption("received");
        await expect.poll(() => uncertainPatchAttempts).toBe(1);
        await expect(uncertainSelect).toHaveValue("idle");
        const uncertainAlert = page
          .getByRole("alert")
          .filter({ hasText: copy.uncertain });
        await expect(uncertainAlert).toBeVisible();
        await expect(uncertainAlert).toContainText(copy.statusError);
        await expect(uncertainSelect).toBeEnabled();
        // The user retries only after the refresh could not confirm the first
        // request. The second response is a valid, reconciled synthetic save.
        await uncertainSelect.selectOption("received");
        await expect.poll(() => uncertainPatchAttempts).toBe(2);
        await expect(uncertainSelect).toHaveValue("received");
        expect(wishlistGets).toBeGreaterThanOrEqual(4);
        expect(blockedWrites).toEqual([]);

        await assertPageHealth(page, info, locale);
        await info.attach(`wishlist-${locale}-transport-proof`, {
          body: JSON.stringify({
            locale,
            project: info.project.name,
            fabricatedIds: Object.values(ITEMS),
            writes: {
              pending503Reconciled: pendingPatchAttempts,
              denial403DraftRetained: denialPatchAttempts,
              uncertainNetworkThenRetry: uncertainPatchAttempts,
            },
            wishlistGets,
            blockedWrites,
            scope:
              "Family A parent auth and feature audit only; wishlist GET/status PATCH intercepted; no real wishlist writes",
          }),
          contentType: "application/json",
        });
      } finally {
        releasePendingPatch?.();
        if (pendingPatchComplete) await pendingPatchComplete;
        releaseDenialPatch?.();
        if (denialPatchComplete) await denialPatchComplete;
        try {
          const restored = await browserSend(
            page,
            "PATCH",
            "/api/family/features",
            {
              features: originalFeatures,
            },
          );
          expect(restored.status, restored.body).toBe(200);
          const canonical = await browserFetch(page, "/api/family/features");
          expect(canonical.status, canonical.body).toBe(200);
          expect(JSON.parse(canonical.body).features).toEqual(originalFeatures);
          featuresRestored = true;
        } finally {
          try {
            await cleanFeatureAudit(featuresRestored);
          } finally {
            await page.unrouteAll({ behavior: "ignoreErrors" });
            await context.unrouteAll({ behavior: "ignoreErrors" });
          }
        }
      }
    });
  });
}
