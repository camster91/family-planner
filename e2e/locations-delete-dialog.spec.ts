/** #499: disposable-fixture Locations confirmation; DELETE is browser-intercepted. */
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { authFile } from "./support/env";
import { ownFeatureAudit } from "./support/feature-audit";
import { browserFetch, browserSend, expect, test } from "./support/test";

test.use({ storageState: authFile("parentA") });
const LABEL = "School and after-school activities — family pickup 李";
const PRIVATE_ADDRESS =
  "SYNTHETIC private street address must stay outside the confirmation";
const ID = "fx_e2e_location_dialog";

for (const locale of ["en", "es"] as const) {
  test(`${locale}: Locations deletion is named, guarded and recoverable`, async ({
    page,
    context,
    baseURL,
  }, info) => {
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
    const original = await browserFetch(page, "/api/family/features");
    expect(original.status, original.body).toBe(200);
    const originalFeatures = JSON.parse(original.body).features;
    const cleanAudit = await ownFeatureAudit(["locations"]);
    let restored = false;
    let deleted = false;
    let writes = 0;
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/locations**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "GET" && url.pathname === "/api/locations") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            locations: deleted
              ? []
              : [
                  {
                    id: ID,
                    label: LABEL,
                    address: PRIVATE_ADDRESS,
                    is_primary: false,
                    user_id: FIXTURE_IDS.familyA.parent,
                  },
                ],
          }),
        });
      } else if (
        request.method() === "DELETE" &&
        url.pathname === `/api/locations/${ID}`
      ) {
        expect(request.postData()).toBeNull();
        expect(request.headers()["x-csrf-token"]).toBeTruthy();
        writes += 1;
        if (writes === 1) {
          await pending;
          await route.fulfill({
            status: 403,
            contentType: "application/json",
            body: JSON.stringify({ error: PRIVATE_ADDRESS }),
          });
        } else if (writes === 2) {
          await route.abort("failed");
        } else {
          deleted = true;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ok: true }),
          });
        }
      } else await route.continue();
    });
    const contextRequest = async (
      method: "GET" | "PATCH",
      path: string,
      body?: unknown,
    ) => {
      const csrf =
        (await context.cookies()).find((cookie) => cookie.name === "csrf_token")
          ?.value ?? "";
      return context.request.fetch(new URL(path, baseURL!).href, {
        method,
        data: body,
        headers:
          method === "GET"
            ? {}
            : { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      });
    };
    try {
      const enabled = await browserSend(page, "PATCH", "/api/family/features", {
        features: { ...originalFeatures, locations: true },
      });
      expect(enabled.status, enabled.body).toBe(200);
      await page.goto("/dashboard/locations");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      if (locale === "es")
        await expect(page.locator("html")).toHaveClass(/dark/);
      else await expect(page.locator("html")).not.toHaveClass(/dark/);
      const runtimeResponse = await browserFetch(page, "/api/version");
      expect(runtimeResponse.status, runtimeResponse.body).toBe(200);
      const runtime = JSON.parse(runtimeResponse.body);
      const head = execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim();
      const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
        encoding: "utf8",
      }).trim();
      expect(runtime.commit).toBe(head);
      expect(process.env.RELEASE_SHA).toBe(head);
      if (process.env.E2E_LOCATIONS_BUILD_TREE)
        expect(process.env.E2E_LOCATIONS_BUILD_TREE).toBe(tree);
      expect(() =>
        execFileSync(
          "git",
          ["diff", "--quiet", "HEAD", "--", "src", "prisma"],
          { stdio: "ignore" },
        ),
      ).not.toThrow();
      const compiledTimes = [
        ...new Set(
          fs
            .readFileSync(".next/server/app/api/version/route.js", "utf8")
            .match(/20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g) ?? [],
        ),
      ];
      expect(compiledTimes).toHaveLength(1);
      expect(runtime.builtAt).toBe(compiledTimes[0]);
      const trigger = page.getByRole("button", {
        name: `${locale === "es" ? "Quitar" : "Remove"} ${LABEL}`,
        exact: true,
      });
      await trigger.click();
      const dialog = page.getByRole("alertdialog", {
        name: locale === "es" ? `¿Quitar «${LABEL}»?` : `Remove “${LABEL}”?`,
        exact: true,
      });
      const cancel = dialog.getByRole("button", {
        name: locale === "es" ? "Cancelar" : "Cancel",
        exact: true,
      });
      await expect(cancel).toBeFocused();
      await expect(dialog).not.toContainText(PRIVATE_ADDRESS);
      await cancel.click();
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      expect(writes).toBe(0);
      await trigger.click();
      await dialog
        .getByRole("button", {
          name: locale === "es" ? "Eliminar" : "Delete",
          exact: true,
        })
        .click();
      await expect.poll(() => writes).toBe(1);
      await expect(cancel).toBeDisabled();
      const removing = dialog.getByRole("button", {
        name: locale === "es" ? "Quitando…" : "Removing…",
        exact: true,
      });
      await expect(removing).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button")).toHaveCount(2);
      await removing.dispatchEvent("click");
      expect(writes).toBe(1);
      release!();
      await expect(dialog.getByRole("alert")).toHaveText(
        locale === "es"
          ? "No se pudo quitar el lugar. Inténtalo de nuevo."
          : "The location could not be removed. Try again.",
      );
      const retry = dialog.getByRole("button", {
        name: locale === "es" ? "Intentar de nuevo" : "Try again",
        exact: true,
      });
      await expect(dialog).not.toContainText(PRIVATE_ADDRESS);
      await retry.click();
      await expect(dialog.getByRole("alert")).toHaveText(
        locale === "es"
          ? "No se pudo quitar el lugar. Revisa tu conexión e inténtalo de nuevo."
          : "The location could not be removed. Check your connection and try again.",
      );
      expect(writes).toBe(2);
      const geometry = [];
      for (const button of await dialog.getByRole("button").all()) {
        const box = await button.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
        geometry.push({ width: box!.width, height: box!.height });
      }
      const violations = (
        await new AxeBuilder({ page })
          .include('[data-testid="remove-location-dialog"]')
          .analyze()
      ).violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(violations).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await info.attach("locations-source-recovery-proof", {
        body: JSON.stringify({
          runtime,
          tree,
          locale,
          geometry,
          violations,
          transport:
            "fixture feature toggle and restore; location GET/DELETE browser-intercepted; no actual location writes",
        }),
        contentType: "application/json",
      });
      await info.attach("locations-recovery-viewport", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
      await page.screenshot({
        path: info.outputPath(`locations-${locale}-recovery.png`),
        fullPage: true,
      });
      await retry.click();
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Add", exact: true }),
      ).toBeFocused();
      await expect(trigger).toHaveCount(0);
      expect(writes).toBe(3);
    } finally {
      release?.();
      try {
        let response;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            response = await contextRequest("PATCH", "/api/family/features", {
              features: originalFeatures,
            });
            if (response.status() === 200 || response.status() < 500) break;
          } catch (error) {
            if (attempt === 1) throw error;
          }
        }
        expect(response).toBeDefined();
        const responseBody = await response!.text();
        expect(response!.status(), responseBody).toBe(200);
        const canonical = await contextRequest("GET", "/api/family/features");
        const canonicalBody = await canonical.text();
        expect(canonical.status(), canonicalBody).toBe(200);
        expect(JSON.parse(canonicalBody).features).toEqual(originalFeatures);
        restored = true;
      } finally {
        try {
          await cleanAudit(restored);
        } finally {
          if (!page.isClosed()) await page.unroute("**/api/locations**");
        }
      }
    }
  });
}
