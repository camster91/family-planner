/**
 * Parent-only Pickups UI matrix (#499).
 *
 * The document route only changes the serialized feature seed for this
 * fabricated browser journey. Pickups GET/POST/PATCH and member GET responses
 * are intercepted below, so this spec never writes a family or pickup row.
 * API authority and child/teen route policy remain covered by the direct API
 * suites; this matrix intentionally exercises the mounted parent page only.
 */
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { pickupsMessages } from "../src/i18n/pickups";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { authFile } from "./support/env";
import { expect, test } from "./support/test";

test.use({ storageState: authFile("parentA") });

const PICKUP = {
  id: "fx_e2e_pickup_initial",
  title: "School pickup",
  location: "School",
  pickup_time: "2030-10-15T15:00:00.000Z",
  completed: false,
  assigned_to: "member-1",
  assignee_name: "Sam",
  assignee_avatar: null,
  notes: null,
};

const CREATED_PICKUP = {
  ...PICKUP,
  id: "fx_e2e_pickup_created",
  title: "Library pickup",
  location: "Library",
  assigned_to: "member-1",
  notes: "Bring booster seat",
};

function checkedCommit() {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  expect(head).toMatch(/^[a-f0-9]{40}$/);
  return head;
}

function checkedTree() {
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();
  expect(tree).toMatch(/^[a-f0-9]{40}$/);
  const configured = process.env.E2E_PICKUPS_BUILD_TREE?.trim();
  if (configured) expect(configured).toBe(tree);
  return tree;
}

function assertCleanAppSource() {
  expect(() =>
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "prisma"], {
      stdio: "ignore",
    }),
  ).not.toThrow();
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
  return values[0];
}

async function runtimeIdentity(
  page: Page,
  info: TestInfo,
  locale: "en" | "es",
) {
  const head = checkedCommit();
  assertCleanAppSource();
  // A rendered result is only evidence for the checkout that was built.
  expect(process.env.RELEASE_SHA?.trim()).toBe(head);
  const tree = checkedTree();
  const response = await page.request.get("/api/version");
  expect(response.status(), await response.text()).toBe(200);
  const runtime = (await response.json()) as {
    version?: string;
    commit: string;
    builtAt: string;
  };
  expect(runtime.commit).toBe(head);
  expect(runtime.builtAt).toBe(compiledBuiltAt());
  const buildId = fs.readFileSync(".next/BUILD_ID", "utf8").trim();
  expect(buildId).not.toBe("");
  await info.attach("pickups-runtime-identity", {
    body: JSON.stringify({
      runtime,
      buildId,
      buildTree: tree,
      locale,
      role: "parentA",
      scope:
        "parent Pickups page; feature seed and pickup/member transport fabricated; no domain writes; child/teen route coverage excluded",
    }),
    contentType: "application/json",
  });
}

async function checkActionGeometry(page: Page, action: Locator) {
  await action.scrollIntoViewIfNeeded();
  const box = await action.boundingBox();
  const viewport = page.viewportSize();
  expect(box).toBeTruthy();
  expect(viewport).toBeTruthy();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
  expect(
    await action.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return element.contains(
        document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        ),
      );
    }),
  ).toBe(true);
}

async function checkNoBlockingA11y(page: Page, selector: string) {
  const violations = (
    await new AxeBuilder({ page })
      .include(selector)
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
}

async function checkNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

for (const locale of ["en", "es"] as const) {
  test.describe(`${locale} parent Pickups alignment`, () => {
    test.use({ colorScheme: locale === "en" ? "light" : "dark" });

    test(`${locale}: load, retry, draft sheet, guarded writes and row rollback`, async ({
      page,
      context,
      baseURL,
    }, info) => {
      assertFixtureTargetAllowed(process.env);
      expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
        new URL(baseURL!).hostname,
      );

      const unexpectedApiMutations: string[] = [];
      const mutatingMethods = new Set(["POST", "PATCH", "PUT", "DELETE"]);
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (
          !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
          !["data:", "blob:"].includes(url.protocol)
        ) {
          await route.abort();
          return;
        }
        const method = route.request().method();
        const allowedSyntheticMutation =
          (url.pathname === "/api/pickups" && method === "POST") ||
          (url.pathname === `/api/pickups/${PICKUP.id}` && method === "PATCH");
        if (
          url.pathname.startsWith("/api/") &&
          mutatingMethods.has(method) &&
          !allowedSyntheticMutation
        ) {
          unexpectedApiMutations.push(`${method} ${url.pathname}`);
          await route.abort();
          return;
        }
        await route.continue();
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

      // Pickups is opt-in and intentionally remains off in the disposable
      // fixture. Rewrite only the serialized feature seed for this page; the
      // actual feature API is never called or mutated by this test.
      await page.route("**/dashboard/pickups**", async (route) => {
        const response = await route.fetch();
        const body = await response.text();
        const patched = body
          .replaceAll('"pickups":false', '"pickups":true')
          .replaceAll('\\"pickups\\":false', '\\"pickups\\":true')
          .replaceAll("pickups%3Afalse", "pickups%3Atrue");
        await route.fulfill({ response, body: patched });
      });

      const copy = pickupsMessages[locale];
      let pickupGets = 0;
      let posts = 0;
      let patches = 0;
      const postBodies: unknown[] = [];
      const patchBodies: unknown[] = [];
      let releasePost: (() => void) | undefined;
      let releasePatch: (() => void) | undefined;

      await page.route("**/api/family/members", async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            members: [
              { id: "member-1", name: "Sam", avatar_url: null, role: "child" },
            ],
          }),
        });
      });

      await page.route("**/api/pickups**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname === "/api/pickups" && request.method() === "GET") {
          pickupGets += 1;
          const pickups =
            pickupGets === 1
              ? undefined
              : pickupGets === 2
                ? [PICKUP]
                : [PICKUP, CREATED_PICKUP];
          if (!pickups) {
            await route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({ error: "Synthetic load refusal" }),
            });
          } else {
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({ pickups }),
            });
          }
          return;
        }
        if (url.pathname === "/api/pickups" && request.method() === "POST") {
          posts += 1;
          postBodies.push(request.postDataJSON());
          if (posts === 1) {
            await route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({ error: "Synthetic add refusal" }),
            });
            return;
          }
          const gate = new Promise<void>((resolve) => {
            releasePost = resolve;
          });
          await gate;
          await route.fulfill({
            status: 201,
            contentType: "application/json",
            body: JSON.stringify({ pickup: CREATED_PICKUP }),
          });
          return;
        }
        if (
          url.pathname === `/api/pickups/${PICKUP.id}` &&
          request.method() === "PATCH"
        ) {
          patches += 1;
          patchBodies.push(request.postDataJSON());
          const gate = new Promise<void>((resolve) => {
            releasePatch = resolve;
          });
          await gate;
          await route.fulfill({
            status: 403,
            contentType: "application/json",
            body: JSON.stringify({ error: "Synthetic update refusal" }),
          });
          return;
        }
        await route.continue();
      });

      try {
        await page.goto("/dashboard/pickups");
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        if (locale === "es") {
          await expect(page.locator("html")).toHaveClass(/\bdark\b/);
        } else {
          await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
        }
        await runtimeIdentity(page, info, locale);

        const main = page.locator("#main-content");
        await expect(
          main.getByRole("heading", { level: 1, name: copy.title }),
        ).toBeVisible();
        const add = page.getByRole("button", { name: copy.add, exact: true });
        await expect(add).toBeVisible();
        await checkActionGeometry(page, add);

        // A failed first load is a real error state, never a false empty state.
        await expect(main.getByRole("alert")).toContainText(
          copy.loadErrorTitle,
        );
        await expect(main).not.toContainText(copy.emptyTitle);
        await checkActionGeometry(
          page,
          main.getByRole("button", { name: copy.retry, exact: true }),
        );
        await checkNoHorizontalOverflow(page);
        await checkNoBlockingA11y(page, "#main-content");

        await main
          .getByRole("button", { name: copy.retry, exact: true })
          .click();
        await expect(main.getByRole("checkbox")).toHaveCount(1);
        await expect(main.getByRole("alert")).toHaveCount(0);
        expect(pickupGets).toBe(2);
        await checkNoHorizontalOverflow(page);

        // Opening and dismissing the rounded form sheet is read-only and keeps
        // the draft across close, reopen and browser-back.
        await add.click();
        const dialog = page.getByRole("dialog", { name: copy.newPickup });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByLabel(copy.titleLabel)).toBeFocused();
        await dialog.getByLabel(copy.titleLabel).fill("Library pickup");
        await dialog.getByLabel(copy.location).fill("Library");
        await dialog.getByLabel(copy.notes).fill("Bring booster seat");
        await checkActionGeometry(
          page,
          dialog.getByRole("button", { name: copy.cancel, exact: true }),
        );
        await checkActionGeometry(
          page,
          dialog.getByRole("button", { name: copy.save, exact: true }),
        );
        await checkNoBlockingA11y(page, '[role="dialog"]');
        await dialog
          .getByRole("button", { name: copy.closeForm, exact: true })
          .click();
        await expect(dialog).toHaveCount(0);
        await expect(add).toBeFocused();
        expect(posts).toBe(0);

        await add.click();
        await expect(dialog.getByLabel(copy.titleLabel)).toHaveValue(
          "Library pickup",
        );
        await expect(dialog.getByLabel(copy.location)).toHaveValue("Library");
        await expect(dialog.getByLabel(copy.notes)).toHaveValue(
          "Bring booster seat",
        );
        await page.evaluate(() => window.history.back());
        await expect(dialog).toHaveCount(0);
        await expect(add).toBeFocused();
        expect(posts).toBe(0);
        await add.click();
        await expect(dialog.getByLabel(copy.titleLabel)).toHaveValue(
          "Library pickup",
        );
        await dialog.getByLabel(copy.when).fill("2030-10-15T11:00");
        await dialog.getByLabel(copy.assignedTo).selectOption("member-1");
        const expectedPickupTime = await dialog
          .getByLabel(copy.when)
          .evaluate((input) =>
            new Date((input as HTMLInputElement).value).toISOString(),
          );

        const expectedBody = {
          title: "Library pickup",
          location: "Library",
          pickup_time: expectedPickupTime,
          assigned_to: "member-1",
          notes: "Bring booster seat",
        };
        const save = dialog.getByRole("button", {
          name: copy.save,
          exact: true,
        });
        await save.click();
        await expect.poll(() => posts).toBe(1);
        await expect(
          page.getByText(copy.addFailed, { exact: true }),
        ).toBeVisible();
        await expect(dialog).toBeVisible();
        await save.click();
        await expect.poll(() => posts).toBe(2);
        const saving = dialog.getByRole("button", {
          name: copy.saving,
          exact: true,
        });
        await expect(saving).toBeDisabled();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeVisible();
        await expect(saving).toBeDisabled();
        expect(
          dialog.getByRole("button", { name: copy.closeForm, exact: true }),
        ).toHaveCount(0);
        releasePost?.();
        await expect(dialog).toHaveCount(0);
        expect(postBodies).toEqual([expectedBody, expectedBody]);
        await expect(
          main.getByText(CREATED_PICKUP.title, { exact: true }),
        ).toBeVisible();
        expect(pickupGets).toBe(3);

        // A row toggle is optimistic but serialized. A second activation while
        // the first PATCH is pending does not create another request; refusal
        // restores the exact prior checked state.
        const toggle = main
          .getByRole("checkbox")
          .filter({ hasText: PICKUP.title });
        await expect(toggle).toHaveAttribute("aria-checked", "false");
        await toggle.click();
        await expect.poll(() => patches).toBe(1);
        await expect(toggle).toHaveAttribute("aria-disabled", "true");
        // The control intentionally exposes aria-disabled rather than native
        // disabled so the row remains in the focus order. Dispatching the
        // second activation directly avoids Playwright waiting on a moving
        // optimistic row while still exercising the synchronous latch.
        await toggle.dispatchEvent("click");
        expect(patches).toBe(1);
        expect(patchBodies).toEqual([{ completed: true }]);
        releasePatch?.();
        await expect(toggle).toHaveAttribute("aria-checked", "false");
        await expect(
          page.getByText(copy.updateFailed, { exact: true }),
        ).toBeVisible();
        await expect(toggle).not.toHaveAttribute("aria-disabled", "true");
        await checkActionGeometry(page, toggle);
        await checkNoHorizontalOverflow(page);
        await checkNoBlockingA11y(page, "#main-content");

        // Enter Pickups from a real same-origin route so a programmatic close
        // can be checked against the history entry that came before it. The
        // close must consume its form marker in place; one real browser Back
        // then exits to the safe route instead of stopping on Pickups again.
        await page.goto("/dashboard/calendar");
        await expect(page).toHaveURL(/\/dashboard\/calendar$/);
        await page.goto("/dashboard/pickups");
        await expect(
          page.getByRole("heading", { level: 1, name: copy.title }),
        ).toBeVisible();
        const routeAdd = page.getByRole("button", {
          name: copy.add,
          exact: true,
        });
        const historyBeforeOpen = await page.evaluate(
          () => window.history.length,
        );
        await routeAdd.click();
        const routeDialog = page.getByRole("dialog", {
          name: copy.newPickup,
        });
        await expect(routeDialog).toBeVisible();
        // The effect pushes the marker after the dialog mounts.
        await expect
          .poll(() => page.evaluate(() => window.history.length))
          .toBe(historyBeforeOpen + 1);
        await routeDialog
          .getByRole("button", { name: copy.closeForm, exact: true })
          .click();
        await expect(routeDialog).toHaveCount(0);
        await expect
          .poll(async () => {
            const pickupFormMarker = await page.evaluate(() => {
              const state = window.history.state;
              return Boolean(
                state && typeof state === "object" && "pickupForm" in state,
              );
            });
            return {
              pathname: new URL(page.url()).pathname,
              pickupFormMarker,
            };
          })
          .toEqual({
            pathname: "/dashboard/pickups",
            pickupFormMarker: false,
          });
        expect(await page.evaluate(() => window.history.length)).toBe(
          historyBeforeOpen + 1,
        );
        await page.goBack();
        await expect(page).toHaveURL(/\/dashboard\/calendar$/);

        expect(unexpectedApiMutations).toEqual([]);
        await info.attach("pickups-mutation-audit", {
          body: JSON.stringify({
            unexpectedApiMutations,
            intercepted: {
              post: postBodies.length,
              patch: patchBodies.length,
            },
          }),
          contentType: "application/json",
        });

        await info.attach(`pickups-${locale}-${info.project.name}`, {
          body: await page.screenshot({
            fullPage: false,
            animations: "disabled",
          }),
          contentType: "image/png",
        });
      } finally {
        releasePost?.();
        releasePatch?.();
        await page.unrouteAll({ behavior: "ignoreErrors" });
        await context.unrouteAll({ behavior: "ignoreErrors" });
      }
    });
  });
}
