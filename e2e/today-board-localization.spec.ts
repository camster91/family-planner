/** #499: localized Today regions with every feature available; fabricated loopback household only. */
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { FEATURES } from "../src/lib/features";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { authFile } from "./support/env";
import { browserFetch, browserSend, expect, test } from "./support/test";

test.use({ storageState: authFile("parentA") });

for (const locale of ["en", "es"] as const) {
  test(`${locale}: Today regions remain localized and usable with all features available`, async ({
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
    await page.goto("/dashboard/today");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const original = await browserFetch(page, "/api/family/features");
    expect(original.status, original.body).toBe(200);
    const originalFeatures = JSON.parse(original.body).features as Record<
      string,
      boolean
    >;
    const allFeatures = Object.fromEntries(
      FEATURES.map((feature) => [feature.key, true]),
    );
    expect(Object.keys(allFeatures)).toHaveLength(22);
    try {
      const enabled = await browserSend(page, "PATCH", "/api/family/features", {
        features: allFeatures,
      });
      expect(enabled.status, enabled.body).toBe(200);
      const canonical = await browserFetch(page, "/api/family/features");
      expect(canonical.status, canonical.body).toBe(200);
      expect(JSON.parse(canonical.body).features).toEqual(allFeatures);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      if (locale === "es")
        await expect(page.locator("html")).toHaveClass(/dark/);
      else await expect(page.locator("html")).not.toHaveClass(/dark/);
      const head = execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim();
      const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
        encoding: "utf8",
      }).trim();
      expect(process.env.RELEASE_SHA).toBe(head);
      if (process.env.E2E_TODAY_BOARD_BUILD_TREE)
        expect(process.env.E2E_TODAY_BOARD_BUILD_TREE).toBe(tree);
      expect(() =>
        execFileSync(
          "git",
          ["diff", "--quiet", "HEAD", "--", "src", "prisma"],
          { stdio: "ignore" },
        ),
      ).not.toThrow();
      const version = await browserFetch(page, "/api/version");
      expect(version.status, version.body).toBe(200);
      const runtime = JSON.parse(version.body);
      expect(runtime.commit).toBe(head);
      const compiled = fs.readFileSync(
        ".next/server/app/api/version/route.js",
        "utf8",
      );
      const times = [
        ...new Set(
          compiled.match(/20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g) ?? [],
        ),
      ];
      expect(times).toHaveLength(1);
      expect(runtime.builtAt).toBe(times[0]);
      const board = page.getByTestId("today-board");
      await expect(board).toBeVisible();
      const headings =
        locale === "es"
          ? [
              "Hoy, abrir calendario",
              "Cena de esta noche, abrir comidas",
              "Tareas de hoy, abrir tareas",
              "Compras, abrir listas de compras",
              "Próximamente",
            ]
          : [
              "Today, open calendar",
              "Dinner tonight, open meals",
              "Chores today, open chores",
              "Groceries, open grocery lists",
              "Coming up",
            ];
      for (const heading of headings)
        await expect(
          board.getByRole("heading", { name: heading, exact: true }),
        ).toBeVisible();
      await expect(
        board.getByText("Dentist (Casey)", { exact: true }),
      ).toBeVisible();
      await expect(
        board
          .getByText(locale === "es" ? "Añadido por Avery" : "Added by Avery", {
            exact: true,
          })
          .first(),
      ).toBeVisible();
      await expect(
        board.getByText(
          locale === "es"
            ? "Aún no hay cena planificada."
            : "No dinner planned yet.",
          { exact: true },
        ),
      ).toBeVisible();
      const actions = board.locator("button:visible, a:visible");
      const geometry = [];
      for (const action of await actions.all()) {
        const box = await action.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
        geometry.push({
          label:
            (await action.getAttribute("aria-label")) ||
            (await action.textContent()),
          width: box!.width,
          height: box!.height,
        });
      }
      const violations = (
        await new AxeBuilder({ page })
          .include('[data-testid="today-board"]')
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
      await info.attach("all-feature-board-source-and-geometry", {
        body: JSON.stringify({
          runtime,
          tree,
          locale,
          enabledFeatureKeys: Object.keys(allFeatures),
          geometry,
          violations,
          scope:
            "parent Today board regions; no domain actions submitted; physical/shared-device acceptance separate",
        }),
        contentType: "application/json",
      });
      await info.attach("today-board-viewport", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
      await page.screenshot({
        path: info.outputPath(`today-${locale}-all-features.png`),
        fullPage: true,
      });
    } finally {
      let restored;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          restored = await browserSend(page, "PATCH", "/api/family/features", {
            features: originalFeatures,
          });
          if (restored.status === 200 || restored.status < 500) break;
        } catch (error) {
          if (attempt === 1) throw error;
        }
      }
      expect(restored).toBeDefined();
      expect(restored!.status, restored!.body).toBe(200);
      const canonical = await browserFetch(page, "/api/family/features");
      expect(canonical.status, canonical.body).toBe(200);
      expect(JSON.parse(canonical.body).features).toEqual(originalFeatures);
    }
  });
}
