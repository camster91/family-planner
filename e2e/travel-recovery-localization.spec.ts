/**
 * Travel recovery/localization journey. The feature flag and auth are real
 * fixture boundaries; Travel and chore responses are synthetic and local.
 * This spec is authored for the six configured responsive projects and is not
 * a provider, private-record, or production acceptance test.
 */
import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page, TestInfo } from "@playwright/test";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { authFile } from "./support/env";
import { ownFeatureAudit } from "./support/feature-audit";
import { browserFetch, browserSend, expect, test } from "./support/test";

const ACTIVE = {
  travel_mode_active: true,
  travel_start_date: "2026-10-01",
  travel_end_date: "2026-10-05",
  travel_destination: "Lisbon",
};
const LONG_CHORE_TITLE =
  "Before leaving, check every window upstairs and leave the spare keys with the neighbour 李 " +
  "HouseholdInstructions".repeat(8);
const LONG_ASSIGNEE = "Alexandria Household Member 李 ".repeat(5);

const COPY = {
  en: {
    unavailable: "Travel mode is unavailable",
    retry: "Try again",
    turnOff: "Turn off travel mode",
    turnOn: "Turn on travel mode",
    destination: "Destination",
    save: "Save",
    refusal: "Couldn't change travel mode",
    uncertain: "We couldn't confirm the change",
    check: "Check current state",
  },
  es: {
    unavailable: "El modo viaje no está disponible",
    retry: "Intentar de nuevo",
    turnOff: "Desactivar modo viaje",
    turnOn: "Activar modo viaje",
    destination: "Destino",
    save: "Guardar",
    refusal: "No se pudo cambiar el modo viaje",
    uncertain: "No pudimos confirmar el cambio",
    check: "Comprobar estado actual",
  },
} as const;

test.use({ storageState: authFile("parentA") });

async function guard(context: BrowserContext, locale: "en" | "es") {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return local || ["data:", "blob:"].includes(url.protocol)
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

async function assertPrimaryTarget(control: ReturnType<Page["getByRole"]>) {
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

async function assertSurface(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
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

for (const locale of ["en", "es"] as const) {
  test(`${locale}: Travel recovery keeps confirmed state and drafts across localized responsive states`, async ({
    page,
    context,
    baseURL,
  }, info: TestInfo) => {
    assertFixtureTargetAllowed(process.env);
    expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
      new URL(baseURL!).hostname,
    );
    await guard(context, locale);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard\/today$/);

    const auth = await browserFetch(page, "/api/auth/me");
    expect(auth.status, auth.body).toBe(200);
    const user = JSON.parse(auth.body).user;
    expect(user.id).toBe(FIXTURE_IDS.familyA.parent);
    expect(user.role).toBe("parent");

    const originalResponse = await browserFetch(page, "/api/family/features");
    expect(originalResponse.status, originalResponse.body).toBe(200);
    const originalFeatures = JSON.parse(originalResponse.body)
      .features as Record<string, boolean>;
    const cleanAudit = await ownFeatureAudit(["travel"]);
    let restored = false;
    try {
      const enabled = await browserSend(page, "PATCH", "/api/family/features", {
        features: { ...originalFeatures, travel: true },
      });
      expect(enabled.status, enabled.body).toBe(200);
      const canonical = await browserFetch(page, "/api/family/features");
      expect(canonical.status, canonical.body).toBe(200);
      expect(JSON.parse(canonical.body).features.travel).toBe(true);

      let travelGets = 0;
      let travelPatches = 0;
      let currentState: {
        travel_mode_active: boolean;
        travel_start_date: string | null;
        travel_end_date: string | null;
        travel_destination: string | null;
      } = { ...ACTIVE };
      await page.route("**/api/family/travel", async (route) => {
        const request = route.request();
        if (request.method() === "GET") {
          travelGets += 1;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(travelGets === 1 ? {} : currentState),
          });
          return;
        }
        if (request.method() === "PATCH") {
          travelPatches += 1;
          if (travelPatches === 1) {
            await route.fulfill({
              status: 403,
              contentType: "application/json",
              body: JSON.stringify({ error: "Parents only" }),
            });
            return;
          }
          if (travelPatches === 2) {
            await route.abort("failed");
            return;
          }
          if (travelPatches === 3) {
            currentState = { ...currentState, travel_destination: "Madrid" };
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({ travel_mode_active: "yes" }),
            });
            return;
          }
          if (travelPatches === 4) {
            // The server applies the details before a 503 reaches the client.
            // The follow-up GET must win without discarding the local draft or
            // allowing a duplicate PATCH.
            currentState = {
              ...currentState,
              travel_destination: "Committed after 503",
            };
            await route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({ error: "upstream unavailable" }),
            });
            return;
          }
          if (travelPatches === 5) {
            // The toggle is also committed before its response is lost. The
            // explicit GET below must reconcile the inactive server state.
            currentState = {
              ...currentState,
              travel_mode_active: false,
              travel_start_date: null,
              travel_end_date: null,
              travel_destination: null,
            };
            await route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({ error: "upstream unavailable" }),
            });
            return;
          }
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(currentState),
          });
          return;
        }
        await route.continue();
      });
      await page.route("**/api/chores?*", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            chores: [
              {
                id: "synthetic-travel-long-chore",
                title: LONG_CHORE_TITLE,
                status: "pending",
                due_date: "2026-10-02",
                assignee: { name: LONG_ASSIGNEE },
              },
            ],
          }),
        });
      });

      const copy = COPY[locale];
      await page.goto("/dashboard/travel");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      if (locale === "es")
        await expect(page.locator("html")).toHaveClass(/dark/);
      else await expect(page.locator("html")).not.toHaveClass(/dark/);

      // Successful HTTP with an unusable body is unavailable until a normal retry.
      await expect(
        page.getByRole("alert").filter({ hasText: copy.unavailable }),
      ).toBeVisible();
      await expect(page.getByRole("switch")).toHaveCount(0);
      await page.getByRole("button", { name: copy.retry, exact: true }).click();
      const toggle = page.getByRole("switch", {
        name: copy.turnOff,
        exact: true,
      });
      await expect(toggle).toBeVisible();

      // Household text stays fully readable, including unbroken pasted text,
      // beside the due date on narrow phone and shared-tablet layouts.
      for (const text of [LONG_CHORE_TITLE, LONG_ASSIGNEE]) {
        const content = page.getByText(text, { exact: true });
        await expect(content).toBeVisible();
        expect(
          await content.evaluate(
            (el) =>
              el.scrollWidth <= el.clientWidth &&
              el.scrollHeight <= el.clientHeight,
          ),
        ).toBe(true);
      }
      await assertSurface(page);
      await info.attach("travel-long-household-text", {
        body: await page.screenshot(),
        contentType: "image/png",
      });

      const destination = page.getByLabel(copy.destination, { exact: true });
      const save = page.getByRole("button", { name: copy.save, exact: true });
      await assertPrimaryTarget(toggle);
      await assertPrimaryTarget(save);
      await toggle.focus();
      await expect(toggle).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(destination).toBeFocused();
      await assertSurface(page);

      // A confirmed refusal remains a refusal and does not enter unknown state.
      await toggle.click();
      await expect(page.getByText(copy.refusal, { exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: copy.check, exact: true }),
      ).toHaveCount(0);
      await expect(page.getByText("Parents only", { exact: true })).toHaveCount(
        0,
      );
      expect(travelPatches).toBe(1);

      // A network failure blocks more writes until an explicit current-state GET.
      await destination.fill("Lisbon draft");
      await save.click();
      await expect(
        page.getByText(copy.uncertain, { exact: true }),
      ).toBeVisible();
      await expect(toggle).toBeDisabled();
      await expect(save).toBeDisabled();
      const check = page.getByRole("button", { name: copy.check, exact: true });
      await assertPrimaryTarget(check);
      expect(travelPatches).toBe(2);
      currentState = { ...currentState, travel_destination: "Rome" };
      await check.click();
      await expect(page.getByText(copy.uncertain, { exact: true })).toHaveCount(
        0,
      );
      await expect(destination).toHaveValue("Lisbon draft");
      expect(travelPatches).toBe(2);
      expect(travelGets).toBe(3);

      // A malformed successful PATCH is also unknown; a later GET reconciles
      // the confirmed state without replacing the still-visible draft.
      await save.click();
      await expect(
        page.getByText(copy.uncertain, { exact: true }),
      ).toBeVisible();
      await expect(toggle).toBeDisabled();
      expect(travelPatches).toBe(3);
      const secondCheck = page.getByRole("button", {
        name: copy.check,
        exact: true,
      });
      await assertPrimaryTarget(secondCheck);
      await secondCheck.click();
      await expect(page.getByText(copy.uncertain, { exact: true })).toHaveCount(
        0,
      );
      await expect(destination).toHaveValue("Lisbon draft");
      expect(travelPatches).toBe(3);
      expect(travelGets).toBe(4);

      // A 503 after the server commits details is unknown, just like a lost
      // response. Reconciliation keeps the user's draft until they choose
      // what to do with the confirmed server state and never retries blindly.
      await destination.fill("Lisbon after 503");
      await save.click();
      await expect(
        page.getByText(copy.uncertain, { exact: true }),
      ).toBeVisible();
      await expect(toggle).toBeDisabled();
      await expect(save).toBeDisabled();
      expect(travelPatches).toBe(4);
      const thirdCheck = page.getByRole("button", {
        name: copy.check,
        exact: true,
      });
      await assertPrimaryTarget(thirdCheck);
      await thirdCheck.click();
      await expect(page.getByText(copy.uncertain, { exact: true })).toHaveCount(
        0,
      );
      await expect(destination).toHaveValue("Lisbon after 503");
      expect(travelPatches).toBe(4);
      expect(travelGets).toBe(5);

      // A 503 after a toggle commit is reconciled as well. The server's
      // inactive state replaces the active view only after the explicit GET.
      await toggle.click();
      await expect(
        page.getByText(copy.uncertain, { exact: true }),
      ).toBeVisible();
      await expect(toggle).toBeDisabled();
      await expect(save).toBeDisabled();
      expect(travelPatches).toBe(5);
      const fourthCheck = page.getByRole("button", {
        name: copy.check,
        exact: true,
      });
      await assertPrimaryTarget(fourthCheck);
      await fourthCheck.click();
      await expect(page.getByText(copy.uncertain, { exact: true })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("switch", { name: copy.turnOn, exact: true }),
      ).toBeVisible();
      expect(travelPatches).toBe(5);
      expect(travelGets).toBe(6);
      await assertSurface(page);
      await info.attach("travel-recovery-screen", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
      await info.attach("travel-recovery-localization-scope", {
        body: JSON.stringify({
          project: info.project.name,
          locale,
          role: "parentA",
          synthetic: [
            "GET /api/family/travel",
            "PATCH /api/family/travel",
            "GET /api/chores",
          ],
          realFixtureOnly: ["/api/auth/me", "/api/family/features"],
          checks: [
            "malformed GET",
            "403 refusal",
            "network unknown",
            "malformed 200 PATCH",
            "503 after details commit",
            "503 after toggle commit",
            "draft retained",
            "explicit GET reconciliation",
            "axe",
            "44px",
            "no overflow",
          ],
          execution:
            "rendered journey; synthetic domain responses with guarded fixture auth and feature changes",
        }),
        contentType: "application/json",
      });
    } finally {
      try {
        const restoredResponse = await browserSend(
          page,
          "PATCH",
          "/api/family/features",
          { features: originalFeatures },
        );
        expect(restoredResponse.status, restoredResponse.body).toBe(200);
        const canonical = await browserFetch(page, "/api/family/features");
        expect(canonical.status, canonical.body).toBe(200);
        expect(JSON.parse(canonical.body).features).toEqual(originalFeatures);
        restored = true;
      } finally {
        await cleanAudit(restored);
      }
    }
  });
}
