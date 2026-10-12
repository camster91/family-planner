/** Initial-load recovery for the private Messages and parent-only Locations lists. */
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { locationsEnglish, locationsSpanish } from "../src/i18n/locations";
import { messagesEnglish, messagesSpanish } from "../src/i18n/messages";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { authFile } from "./support/env";
import { ownFeatureAudit } from "./support/feature-audit";
import { browserFetch, browserSend, expect, test } from "./support/test";

test.use({ storageState: authFile("parentA") });

const recoveryCopy = {
  en: { messages: messagesEnglish, locations: locationsEnglish },
  es: { messages: messagesSpanish, locations: locationsSpanish },
} as const;

for (const locale of ["en", "es"] as const) {
  test(`${locale}: Messages and Locations recover from a false-empty initial failure`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.skip(
      ![
        "phone-390x844",
        "phone-430x932",
        "tablet-portrait-800x1280",
        "fridge-landscape-1280x800",
        "tablet-large-1920x1200",
        "desktop-1366x768",
      ].includes(info.project.name),
      "Recovery runs at the six representative responsive sizes",
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
    const versionResponse = await browserFetch(page, "/api/version");
    expect(versionResponse.status, versionResponse.body).toBe(200);
    const runtime = JSON.parse(versionResponse.body) as { commit: string };
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    expect(runtime.commit).toBe(head);
    const releaseSha = process.env.RELEASE_SHA?.trim();
    if (releaseSha) expect(releaseSha).toBe(head);
    expect(() =>
      execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "prisma"], {
        stdio: "ignore",
      }),
    ).not.toThrow();

    const featuresResponse = await browserFetch(page, "/api/family/features");
    expect(featuresResponse.status, featuresResponse.body).toBe(200);
    const originalFeatures = (
      JSON.parse(featuresResponse.body) as { features: Record<string, boolean> }
    ).features;
    const cleanFeatureAudit = await ownFeatureAudit(["messages", "locations"]);
    let restored = false;
    let messageAttempts = 0;
    let locationAttempts = 0;

    try {
      await page.route("**/api/messages**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() !== "GET" || url.pathname !== "/api/messages") {
          await route.abort();
          return;
        }
        messageAttempts += 1;
        if (messageAttempts === 1) {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Synthetic messages outage" }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            messages: [],
            members: [{ id: "fixture-parent-a", name: "Fixture parent" }],
            userId: "fixture-parent-a",
          }),
        });
      });
      await page.route("**/api/locations**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() !== "GET" || url.pathname !== "/api/locations") {
          await route.abort();
          return;
        }
        locationAttempts += 1;
        if (locationAttempts === 1) {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Synthetic locations outage" }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ locations: [] }),
        });
      });

      const enabled = await browserSend(page, "PATCH", "/api/family/features", {
        features: { ...originalFeatures, messages: true, locations: true },
      });
      expect(enabled.status, enabled.body).toBe(200);

      await page.goto("/dashboard/messages");
      const messagesMain = page.locator("#main-content");
      const messagesRecovery = messagesMain.getByTestId("messages-load-error");
      await expect(messagesRecovery).toContainText(
        recoveryCopy[locale].messages.loadErrorTitle,
      );
      await expect(
        messagesMain.getByText("No messages yet", { exact: true }),
      ).toHaveCount(0);
      const messageRetry = messagesRecovery.getByRole("button", {
        name: recoveryCopy[locale].messages.retry,
        exact: true,
      });
      const messageBox = await messageRetry.boundingBox();
      expect(messageBox).not.toBeNull();
      expect(messageBox!.width).toBeGreaterThanOrEqual(44);
      expect(messageBox!.height).toBeGreaterThanOrEqual(44);
      await messageRetry.click();
      await expect(
        messagesMain.getByRole("heading", {
          name: "No messages yet",
          exact: true,
        }),
      ).toBeVisible();
      expect(messageAttempts).toBe(2);

      await page.goto("/dashboard/locations");
      const locationsMain = page.locator("#main-content");
      const locationsRecovery = locationsMain.getByTestId(
        "locations-load-error",
      );
      await expect(locationsRecovery).toContainText(
        recoveryCopy[locale].locations.loadErrorTitle,
      );
      await expect(
        locationsMain.getByRole("heading", {
          name: "No locations yet",
          exact: true,
        }),
      ).toHaveCount(0);
      const locationRetry = locationsRecovery.getByRole("button", {
        name: recoveryCopy[locale].locations.retry,
        exact: true,
      });
      const locationBox = await locationRetry.boundingBox();
      expect(locationBox).not.toBeNull();
      expect(locationBox!.width).toBeGreaterThanOrEqual(44);
      expect(locationBox!.height).toBeGreaterThanOrEqual(44);
      await locationRetry.click();
      await expect(
        locationsMain.getByRole("heading", {
          name: "No locations yet",
          exact: true,
        }),
      ).toBeVisible();
      expect(locationAttempts).toBe(2);
      const violations = (
        await new AxeBuilder({ page }).include("#main-content").analyze()
      ).violations.filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      );
      expect(violations).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await info.attach("messages-locations-recovery-proof", {
        body: JSON.stringify({
          locale,
          runtime,
          messageAttempts,
          locationAttempts,
          violations,
          transport:
            "GETs browser-intercepted; feature rows restored in finally; no household list writes",
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
        expect(
          (JSON.parse(canonical.body) as { features: Record<string, boolean> })
            .features,
        ).toEqual(originalFeatures);
        restored = true;
      } finally {
        try {
          await cleanFeatureAudit(restored);
        } finally {
          await page.unroute("**/api/messages**");
          await page.unroute("**/api/locations**");
        }
      }
    }
  });
}
