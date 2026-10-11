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

const COPY = {
  en: {
    unavailable: "Travel mode is unavailable",
    retry: "Try again",
    turnOff: "Turn off travel mode",
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
      let currentState = { ...ACTIVE };
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
          body: JSON.stringify({ chores: [] }),
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
