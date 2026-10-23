/**
 * Guarded session-boundary coverage for capture recovery storage (#504).
 *
 * The login test clears a real fixture session before entering /login. The
 * account and household deletion tests intercept the destructive request and
 * return a synthetic success, so no fixture account or household is deleted.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { Page, TestInfo } from "@playwright/test";
import {
  CAPTURE_RECOVERY_ACTIVE_STORAGE_KEY,
  captureRecoveryStorageKey,
} from "../src/lib/capture-recovery";
import { FIXTURE_IDS, FIXTURE_PASSWORD } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { messages as sharedMessages } from "../src/i18n";
import { accountDeletionMessages } from "../src/i18n/account-deletion";
import { navigationMessages } from "../src/i18n/navigation";
import { settingsMessages } from "../src/i18n/settings";
import { authFile } from "./support/env";
import { browserFetch, expect, test } from "./support/test";

const PROJECTS = new Set(["phone-390x844", "desktop-1366x768"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const UNRELATED_STORAGE_KEY = "family-planner:e2e-capture-purge-unrelated";

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

async function runtimeIdentity(
  page: Page,
  info: TestInfo,
  locale: "en" | "es",
  role: "parent" | "child",
): Promise<{ userId: string; familyId: string }> {
  const head = sourceHead();
  const tree = sourceTree();
  expect(head).toMatch(/^[a-f0-9]{40}$/);
  expect(tree).toMatch(/^[a-f0-9]{40}$/);
  expect(() =>
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "prisma"], {
      stdio: "ignore",
    }),
  ).not.toThrow();
  const releaseSha = process.env.RELEASE_SHA?.trim();
  if (releaseSha) expect(releaseSha).toBe(head);
  const configuredTree = process.env.E2E_CAPTURE_PURGE_BUILD_TREE?.trim();
  if (configuredTree) expect(configuredTree).toBe(tree);

  const version = await browserFetch(page, "/api/version");
  expect(version.status, version.body).toBe(200);
  const runtime = JSON.parse(version.body) as {
    commit: string;
    builtAt: string;
  };
  expect(runtime.commit).toBe(head);
  expect(runtime.builtAt).toBe(compiledBuiltAt());

  const me = await browserFetch(page, "/api/auth/me");
  expect(me.status, me.body).toBe(200);
  const user = JSON.parse(me.body).user as {
    id?: unknown;
    role?: unknown;
    family_id?: unknown;
  };
  expect(user.id).toBe(
    role === "parent" ? FIXTURE_IDS.familyA.parent : FIXTURE_IDS.familyA.child,
  );
  expect(user.role).toBe(role);
  expect(user.family_id).toBe(FIXTURE_IDS.familyA.family);
  if (typeof user.id !== "string" || typeof user.family_id !== "string") {
    throw new Error("Fixture session identity response was incomplete");
  }
  await info.attach("actual-capture-purge-runtime", {
    body: JSON.stringify({
      runtime,
      buildTree: tree,
      configuredTree: configuredTree ?? null,
      locale,
      role,
      scope:
        "real fixture session; marked local capture storage; synthetic destructive response; no durable account or household deletion",
    }),
    contentType: "application/json",
  });
  return { userId: user.id, familyId: user.family_id };
}

function captureKeyFor(userId: string, familyId: string): string {
  expect(familyId).toBe(FIXTURE_IDS.familyA.family);
  return captureRecoveryStorageKey(userId, familyId);
}

async function seedCaptureStorage(
  page: Page,
  userId: string,
  familyId: string,
): Promise<string> {
  const captureKey = captureKeyFor(userId, familyId);
  const markedValue = JSON.stringify([
    {
      version: 1,
      key: "e2e-capture-purge-12345678",
      action: "event.create",
      requestHash: "",
      body: JSON.stringify({ title: "E2E capture purge fixture" }),
      title: "E2E capture purge fixture",
      kind: "event",
      createdAt: Date.now(),
      photo: false,
    },
  ]);
  await page.evaluate(
    ({ activeKey, captureKey: key, marked, unrelatedKey }) => {
      localStorage.setItem(key, marked);
      localStorage.setItem(activeKey, key);
      localStorage.setItem(unrelatedKey, "keep-this-unrelated-value");
    },
    {
      activeKey: CAPTURE_RECOVERY_ACTIVE_STORAGE_KEY,
      captureKey,
      marked: markedValue,
      unrelatedKey: UNRELATED_STORAGE_KEY,
    },
  );
  return captureKey;
}

async function expectCapturePurged(page: Page, captureKey: string) {
  const values = await page.evaluate(
    ({ activeKey, captureKey: key, unrelatedKey }) => ({
      capture: localStorage.getItem(key),
      active: localStorage.getItem(activeKey),
      unrelated: localStorage.getItem(unrelatedKey),
    }),
    {
      activeKey: CAPTURE_RECOVERY_ACTIVE_STORAGE_KEY,
      captureKey,
      unrelatedKey: UNRELATED_STORAGE_KEY,
    },
  );
  expect(values.capture).toBeNull();
  expect(values.active).toBeNull();
  expect(values.unrelated).toBe("keep-this-unrelated-value");
}

for (const locale of ["en", "es"] as const) {
  test.describe(`${locale} capture session purge`, () => {
    test.describe("unauthenticated login entry", () => {
      test.use({ storageState: authFile("parentA") });

      test(`${locale}: login entry purges capture storage and keeps unrelated storage`, async ({
        page,
        context,
        baseURL,
      }, info) => {
        test.skip(
          !PROJECTS.has(info.project.name),
          "Capture purge runs on representative phone and desktop sizes",
        );
        assertFixtureTargetAllowed(process.env);
        expect(LOOPBACK_HOSTS.has(new URL(baseURL!).hostname)).toBe(true);

        let guardInstalled = false;
        const unknownWrites: string[] = [];
        try {
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
              url.pathname.startsWith("/api/") &&
              !["GET", "HEAD", "OPTIONS"].includes(request.method())
            ) {
              unknownWrites.push(`${request.method()} ${url.pathname}`);
              await route.abort();
              return;
            }
            await route.continue();
          });
          guardInstalled = true;

          await page.addInitScript(
            ({ key, value }) => localStorage.setItem(key, value),
            { key: "familyPlanner_language", value: locale },
          );
          await page.goto("/dashboard");
          await expect(page.locator("html")).toHaveAttribute("lang", locale);
          const identity = await runtimeIdentity(page, info, locale, "parent");
          const captureKey = await seedCaptureStorage(
            page,
            identity.userId,
            identity.familyId,
          );

          await context.clearCookies();
          await page.goto("/login");
          await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
          await expect(
            page.getByLabel(sharedMessages[locale].auth.email, { exact: true }),
          ).toBeVisible();
          await expectCapturePurged(page, captureKey);
          expect(unknownWrites).toEqual([]);
        } finally {
          if (guardInstalled) await context.unroute("**/*");
        }
      });
    });

    for (const deletion of [
      {
        kind: "account" as const,
        role: "child" as const,
        auth: "childA" as const,
      },
      {
        kind: "household" as const,
        role: "parent" as const,
        auth: "parentA" as const,
      },
    ]) {
      test.describe(`successful ${deletion.kind} deletion`, () => {
        test.use({ storageState: authFile(deletion.auth) });

        test(`${locale}: synthetic ${deletion.kind} deletion purges capture storage`, async ({
          page,
          context,
          baseURL,
        }, info) => {
          test.skip(
            !PROJECTS.has(info.project.name),
            "Capture purge runs on representative phone and desktop sizes",
          );
          assertFixtureTargetAllowed(process.env);
          expect(LOOPBACK_HOSTS.has(new URL(baseURL!).hostname)).toBe(true);

          let guardInstalled = false;
          let deletionRouteInstalled = false;
          const unknownWrites: string[] = [];
          const deletes: Array<{ path: string; body: unknown }> = [];
          try {
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
              const syntheticDelete =
                request.method() === "DELETE" &&
                /^\/api\/(?:users|family)$/.test(url.pathname);
              if (
                url.pathname.startsWith("/api/") &&
                !["GET", "HEAD", "OPTIONS"].includes(request.method()) &&
                !syntheticDelete
              ) {
                unknownWrites.push(`${request.method()} ${url.pathname}`);
                await route.abort();
                return;
              }
              await route.continue();
            });
            guardInstalled = true;
            await page.route(/\/api\/(?:users|family)$/, async (route) => {
              const request = route.request();
              if (["GET", "HEAD", "OPTIONS"].includes(request.method())) {
                await route.fallback();
                return;
              }
              if (request.method() !== "DELETE") {
                unknownWrites.push(
                  `${request.method()} ${new URL(request.url()).pathname}`,
                );
                await route.abort();
                return;
              }
              deletes.push({
                path: new URL(request.url()).pathname,
                body: request.postDataJSON(),
              });
              // Model the server clearing the authenticated session after a
              // successful deletion. Without this, the real middleware
              // redirects the still-authenticated fixture back to /dashboard
              // instead of allowing the deletion landing page to render.
              await context.clearCookies();
              await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ success: true, mode: deletion.kind }),
              });
            });
            deletionRouteInstalled = true;

            await page.addInitScript(
              ({ key, value }) => localStorage.setItem(key, value),
              { key: "familyPlanner_language", value: locale },
            );
            await page.goto("/dashboard");
            await expect(page.locator("html")).toHaveAttribute("lang", locale);
            const identity = await runtimeIdentity(
              page,
              info,
              locale,
              deletion.role,
            );
            const captureKey = await seedCaptureStorage(
              page,
              identity.userId,
              identity.familyId,
            );
            const optionsResponse = await browserFetch(
              page,
              "/api/users/deletion",
            );
            expect(optionsResponse.status, optionsResponse.body).toBe(200);
            const options = JSON.parse(optionsResponse.body) as {
              canDeleteHousehold: boolean;
              household?: { id: string; name: string };
            };
            const household = deletion.kind === "household";
            expect(household ? options.canDeleteHousehold : true).toBe(true);

            if (deletion.role === "parent") {
              await page.goto("/dashboard/settings");
              await page
                .getByRole("button", {
                  name: settingsMessages[locale].deleteAccount,
                  exact: true,
                })
                .click();
            } else {
              await page
                .getByRole("button", {
                  name: navigationMessages[locale].userMenu,
                })
                .click();
              await page
                .getByRole("button", {
                  name: navigationMessages[locale].deleteAccount,
                  exact: true,
                })
                .click();
            }
            const dialog = page.getByTestId("delete-account-dialog");
            await expect(dialog).toBeVisible();
            const expected = household ? options.household?.name : "DELETE";
            expect(expected).toBeTruthy();
            await dialog
              .getByLabel(accountDeletionMessages[locale].password, {
                exact: true,
              })
              .fill(FIXTURE_PASSWORD);
            await dialog.locator("#delete-account-confirm").fill(expected!);
            const submit = dialog.getByRole("button", {
              name: accountDeletionMessages[locale][
                household ? "householdTitle" : "deleteAccount"
              ],
              exact: true,
            });
            await expect(submit).toBeEnabled();
            await Promise.all([
              page.waitForURL(new RegExp(`/login\\?deleted=${deletion.kind}$`)),
              submit.click(),
            ]);
            expect(deletes).toHaveLength(1);
            expect(deletes[0]?.path).toBe(
              household ? "/api/family" : "/api/users",
            );
            expect(deletes[0]?.body).toEqual(
              household
                ? {
                    familyId: options.household?.id,
                    password: FIXTURE_PASSWORD,
                    confirmation: options.household?.name,
                  }
                : { password: FIXTURE_PASSWORD, confirmation: "DELETE" },
            );
            await expectCapturePurged(page, captureKey);
            expect(unknownWrites).toEqual([]);
          } finally {
            // A stopped/interrupted browser can close the page before the
            // fixture reaches cleanup. The test fixture will clean up the
            // context; avoid turning that interruption into a cleanup error.
            if (!page.isClosed()) {
              if (deletionRouteInstalled)
                await page.unroute(/\/api\/(?:users|family)$/);
              if (guardInstalled) await context.unroute("**/*");
            }
          }
        });
      });
    }
  });
}
