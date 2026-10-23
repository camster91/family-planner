/** #499: all-on touch discovery and existing event-create authority, fabricated people only. */
import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, BrowserContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { pickupsMessages } from "../src/i18n/pickups";
import { FEATURES } from "../src/lib/features";
import { FIXTURE_EMAILS, FIXTURE_PASSWORD } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { authFile, E2E_ANCHOR } from "./support/env";
import { ownFeatureAudit } from "./support/feature-audit";
import { browserFetch, browserSend, expect, test } from "./support/test";

const VIEWPORTS = [
  "phone-390x844",
  "phone-430x932",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
  "tablet-large-1920x1200",
  "desktop-1366x768",
];
const SHORTCUTS = [
  "wishlist",
  "allowance",
  "handoff",
  "sick-days",
  "notes",
  "pickups",
];
const ROLE_PICKUP = {
  id: "fx_e2e_role_pickup_same_family",
  title: "Family A school pickup",
  location: "School",
  pickup_time: "2030-10-15T15:00:00.000Z",
  completed: false,
  assigned_to: "fx_user_a_child",
  assignee_name: "Sam",
  assignee_avatar: null,
  notes: null,
};
let teenState: Awaited<ReturnType<APIRequestContext["storageState"]>>;

test.use({ storageState: authFile("parentA") });

test.beforeAll(async ({ playwright, baseURL }, info) => {
  assertFixtureTargetAllowed(process.env);
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
    new URL(baseURL!).hostname,
  );
  // One real fixture login per viewport, in a dedicated TEST-NET rate-limit bucket.
  const request = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: {
      "X-Forwarded-For": `198.51.100.${100 + VIEWPORTS.indexOf(info.project.name)}`,
    },
  });
  try {
    const response = await request.post("/api/auth/login", {
      data: { email: FIXTURE_EMAILS.familyA.teen, password: FIXTURE_PASSWORD },
    });
    expect(response.status()).toBe(200);
    teenState = await request.storageState();
  } finally {
    await request.dispose();
  }
});

async function guard(context: BrowserContext, locale: "en" | "es") {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      ["data:", "blob:"].includes(url.protocol)
      ? route.continue()
      : route.abort();
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
}

for (const role of ["parent", "teen", "child"] as const) {
  for (const locale of ["en", "es"] as const) {
    test(`${role}/${locale}: all-on Today and touch discovery match existing role authority`, async ({
      browser,
      page: parentPage,
      baseURL,
    }, info) => {
      assertFixtureTargetAllowed(process.env);
      await parentPage.goto("/dashboard");
      const original = await browserFetch(parentPage, "/api/family/features");
      expect(original.status, original.body).toBe(200);
      const originalFeatures = JSON.parse(original.body).features;
      const allFeatures = Object.fromEntries(
        FEATURES.map((feature) => [feature.key, true]),
      );
      expect(Object.keys(allFeatures)).toHaveLength(22);
      const cleanAudit = await ownFeatureAudit(Object.keys(allFeatures));
      let restored = false;
      let context: BrowserContext | undefined;
      try {
        context = await browser.newContext({
          baseURL,
          viewport: info.project.use.viewport,
          hasTouch: info.project.use.hasTouch,
          isMobile: info.project.use.isMobile,
          deviceScaleFactor: 1,
          timezoneId: "America/Toronto",
          extraHTTPHeaders: {
            "X-Forwarded-For": `198.51.100.${150 + VIEWPORTS.indexOf(info.project.name)}`,
          },
          storageState:
            role === "teen"
              ? teenState
              : authFile(role === "parent" ? "parentA" : "childA"),
        });
        await guard(context, locale);
        const page = await context.newPage();
        await page.clock.install({ time: E2E_ANCHOR });
        if (role !== "parent") {
          // Exercise the role surface with a fabricated same-family response;
          // this journey never creates a pickup row. Cross-household
          // authorization remains covered by the API permission suites.
          await page.route("**/api/pickups**", async (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (url.pathname === "/api/pickups" && request.method() === "GET") {
              await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ pickups: [ROLE_PICKUP] }),
              });
              return;
            }
            if (
              url.pathname === `/api/pickups/${ROLE_PICKUP.id}` &&
              request.method() === "PATCH"
            ) {
              const body = request.postDataJSON() as { completed?: unknown };
              await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                  pickup: {
                    ...ROLE_PICKUP,
                    completed: body.completed === true,
                  },
                }),
              });
              return;
            }
            await route.continue();
          });
        }
        const enabled = await browserSend(
          parentPage,
          "PATCH",
          "/api/family/features",
          { features: allFeatures },
        );
        expect(enabled.status, enabled.body).toBe(200);
        const canonical = await browserFetch(
          parentPage,
          "/api/family/features",
        );
        expect(canonical.status, canonical.body).toBe(200);
        expect(JSON.parse(canonical.body).features).toEqual(allFeatures);
        await page.goto("/dashboard/today");
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        if (locale === "es")
          await expect(page.locator("html")).toHaveClass(/dark/);
        else await expect(page.locator("html")).not.toHaveClass(/dark/);
        const version = await browserFetch(page, "/api/version");
        expect(version.status, version.body).toBe(200);
        const runtime = JSON.parse(version.body);
        const head = execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim();
        const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
          encoding: "utf8",
        }).trim();
        expect(runtime.commit).toBe(head);
        expect(process.env.RELEASE_SHA).toBe(head);
        if (process.env.E2E_FEATURE_CONTROLS_BUILD_TREE)
          expect(process.env.E2E_FEATURE_CONTROLS_BUILD_TREE).toBe(tree);
        expect(() =>
          execFileSync(
            "git",
            ["diff", "--quiet", "HEAD", "--", "src", "prisma"],
            { stdio: "ignore" },
          ),
        ).not.toThrow();
        const builtTimes = [
          ...new Set(
            fs
              .readFileSync(".next/server/app/api/version/route.js", "utf8")
              .match(/20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g) ?? [],
          ),
        ];
        expect(builtTimes).toHaveLength(1);
        expect(runtime.builtAt).toBe(builtTimes[0]);
        const controls = page.getByRole("navigation", {
          name:
            locale === "es" ? "Acciones rápidas de hoy" : "Today quick actions",
          exact: true,
        });
        const event = controls.getByRole("link", {
          name: locale === "es" ? "Añadir evento" : "Add event",
          exact: true,
        });
        if (role === "child") await expect(event).toHaveCount(0);
        else {
          await expect(event).toHaveAttribute(
            "href",
            "/dashboard/calendar/create",
          );
          await event.click();
          await expect(page).toHaveURL(/\/dashboard\/calendar\/create$/);
          await page.goto("/dashboard/today");
        }
        if (role !== "parent") {
          await expect(
            controls.getByRole("link", {
              name: locale === "es" ? "Añadir tarea" : "Add chore",
              exact: true,
            }),
          ).toHaveCount(0);
          await expect(
            page.locator('a[href="/dashboard/family/features"]'),
          ).toHaveCount(0);
        }
        const userMenu = page.getByRole("button", {
          name: locale === "es" ? "Menú de usuario" : "User menu",
        });
        await userMenu.click();
        const geometry = [];
        for (const key of SHORTCUTS) {
          const link = page.locator(`nav a[href="/dashboard/${key}"]`);
          if (role === "parent") await expect(link).toHaveCount(0);
          else {
            await expect(link).toBeVisible();
            const box = await link.boundingBox();
            expect(box).not.toBeNull();
            expect(box!.width).toBeGreaterThanOrEqual(44);
            expect(box!.height).toBeGreaterThanOrEqual(44);
            expect(box!.y).toBeGreaterThanOrEqual(0);
            expect(box!.y + box!.height).toBeLessThanOrEqual(
              info.project.use.viewport!.height,
            );
            geometry.push({ key, width: box!.width, height: box!.height });
          }
        }
        if (role !== "parent")
          await expect(
            page.locator('nav a[href="/dashboard/family/more"]'),
          ).toHaveCount(0);
        if (role !== "parent") {
          const pickupCopy = pickupsMessages[locale];
          const pickupLink = page.locator('nav a[href="/dashboard/pickups"]');
          await pickupLink.click();
          await expect(page).toHaveURL(/\/dashboard\/pickups$/);
          const pickupMain = page.locator("#main-content");
          await expect(
            pickupMain.getByRole("heading", {
              level: 1,
              name: pickupCopy.title,
            }),
          ).toBeVisible();
          await expect(
            pickupMain.getByRole("button", {
              name: pickupCopy.add,
              exact: true,
            }),
          ).toBeVisible();
          const pickupRow = pickupMain
            .getByRole("checkbox")
            .filter({ hasText: ROLE_PICKUP.title });
          await expect(pickupRow).toBeVisible();
          await expect(pickupRow).toHaveAttribute("aria-checked", "false");
          await pickupRow.click();
          // Completion is the row's accessible checkbox action; the title is
          // household data and stays verbatim while state is announced by ARIA.
          await expect(pickupRow).toHaveAttribute("aria-checked", "true");
          await expect(
            pickupMain.getByRole("button", { name: /delete|eliminar/i }),
          ).toHaveCount(0);
          await expect(
            pickupMain.getByRole("link", { name: /delete|eliminar/i }),
          ).toHaveCount(0);
          // The intercepted response intentionally contains only the current
          // household row; a Family B marker must never appear here.
          await expect(pickupMain).not.toContainText("Family B");
          const pickupViolations = (
            await new AxeBuilder({ page }).include("#main-content").analyze()
          ).violations.filter(
            (v) => v.impact === "serious" || v.impact === "critical",
          );
          expect(pickupViolations).toEqual([]);
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          await info.attach("pickups-role-surface", {
            body: await page.screenshot(),
            contentType: "image/png",
          });
          await page.goto("/dashboard/today");
          await userMenu.click();
        }
        const violations = (
          await new AxeBuilder({ page }).include("nav").analyze()
        ).violations.filter(
          (v) => v.impact === "serious" || v.impact === "critical",
        );
        expect(violations).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await info.attach("all-feature-role-identity-and-controls", {
          body: JSON.stringify({
            runtime,
            tree,
            role,
            locale,
            geometry,
            violations,
            scope:
              "all-on person Today controls and kid touch discovery; fixture features restored; no event/domain writes, no shared-device/native acceptance",
          }),
          contentType: "application/json",
        });
        await info.attach("all-feature-role-menu-viewport", {
          body: await page.screenshot(),
          contentType: "image/png",
        });
        await userMenu.click();
        const disabled = await browserSend(
          parentPage,
          "PATCH",
          "/api/family/features",
          {
            features: {
              ...allFeatures,
              ...Object.fromEntries(SHORTCUTS.map((key) => [key, false])),
            },
          },
        );
        expect(disabled.status, disabled.body).toBe(200);
        await page.reload();
        await userMenu.click();
        for (const key of SHORTCUTS)
          await expect(
            page.locator(`nav a[href="/dashboard/${key}"]`),
          ).toHaveCount(0);
        if (role !== "parent") {
          const pickupCopy = pickupsMessages[locale];
          await page.goto("/dashboard/pickups");
          await expect(
            page.getByRole("heading", {
              name:
                locale === "es"
                  ? "Función desactivada: Recogidas y entregas"
                  : "Pickups & dropoffs is off",
              level: 2,
            }),
          ).toBeVisible();
          await expect(
            page.getByRole("button", { name: pickupCopy.add, exact: true }),
          ).toHaveCount(0);
          await expect(
            page.getByRole("link", { name: /Open Features|Abrir funciones/ }),
          ).toHaveCount(0);
        }
      } finally {
        try {
          let response;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
              response = await browserSend(
                parentPage,
                "PATCH",
                "/api/family/features",
                { features: originalFeatures },
              );
              if (response.status === 200 || response.status < 500) break;
            } catch (error) {
              if (attempt === 1) throw error;
            }
          }
          expect(response).toBeDefined();
          expect(response!.status, response!.body).toBe(200);
          const canonical = await browserFetch(
            parentPage,
            "/api/family/features",
          );
          expect(canonical.status, canonical.body).toBe(200);
          expect(JSON.parse(canonical.body).features).toEqual(originalFeatures);
          restored = true;
        } finally {
          try {
            await cleanAudit(restored);
          } finally {
            await context?.close();
          }
        }
      }
    });
  }
}
