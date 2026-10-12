/**
 * Locations add/edit recovery proof.
 *
 * The first test is deliberately synthetic: it holds and refuses POSTs to
 * prove pending Back/Escape, draft retention, and idempotency-key behavior at
 * every responsive/localized surface without writing a row. The second test
 * sends the real parent POST/PATCH, aborts only the first browser response,
 * reads the exact persisted row back, and removes only that owned row/receipt.
 */
import type { BrowserContext, Page, TestInfo } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { locationsEnglish, locationsSpanish } from "../src/i18n/locations";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { authFile } from "./support/env";
import { ownFeatureAudit } from "./support/feature-audit";
import {
  removeOwnedLocations,
  type OwnedLocation,
} from "./support/locations-cleanup";
import { browserFetch, browserSend, expect, test } from "./support/test";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PROJECT_NAMES = new Set([
  "phone-390x844",
  "tablet-portrait-800x1280",
  "desktop-1366x768",
]);
const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const A = FIXTURE_IDS.familyA;

type Locale = "en" | "es";
type LocationRow = OwnedLocation & { user_id?: string };

function copyFor(locale: Locale) {
  return locale === "es" ? locationsSpanish : locationsEnglish;
}

async function setLocale(page: Page, locale: Locale) {
  await page.addInitScript(
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

async function installLoopbackGuard(
  context: BrowserContext,
  blockedWrites: string[],
  ownedIds: Set<string>,
) {
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

    const locationId = url.pathname.startsWith("/api/locations/")
      ? url.pathname.slice("/api/locations/".length)
      : "";
    const allowedMutation =
      (request.method() === "PATCH" &&
        url.pathname === "/api/family/features") ||
      (request.method() === "POST" && url.pathname === "/api/locations") ||
      (request.method() === "PATCH" && ownedIds.has(locationId)) ||
      (request.method() === "DELETE" && ownedIds.has(locationId));
    if (MUTATING_METHODS.has(request.method()) && !allowedMutation) {
      blockedWrites.push(`${request.method()} ${url.pathname}`);
      await route.abort();
      return;
    }
    await route.continue();
  });
}

async function assertDialogSurface(
  page: Page,
  dialog: ReturnType<Page["getByRole"]>,
) {
  for (const button of await dialog.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= window.innerWidth &&
        document.body.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

function exactMatches(rows: LocationRow[], expected: OwnedLocation) {
  return rows.filter(
    (row) =>
      row.user_id === A.parent &&
      row.label === expected.label &&
      row.address === expected.address,
  );
}

async function removeExactRows(
  page: Page,
  expected: OwnedLocation[],
  idempotencyKeys: string[],
) {
  const read = await browserFetch(page, "/api/locations");
  expect(read.status, read.body).toBe(200);
  const rows = (JSON.parse(read.body).locations ?? []) as LocationRow[];
  const owned: OwnedLocation[] = [];
  for (const location of expected) {
    const byId = rows.filter(
      (row) => row.id === location.id && row.user_id === A.parent,
    );
    if (byId.length > 1)
      throw new Error(`duplicate owned location id ${location.id}`);
    const matches = byId.length ? byId : exactMatches(rows, location);
    if (matches.length > 1) {
      throw new Error(`ambiguous owned location cleanup for ${location.label}`);
    }
    const row = matches[0];
    if (row) {
      expect(row.id).toBe(location.id);
      owned.push({ id: row.id, label: row.label, address: row.address });
    } else if (location.id) {
      // The exact returned id remains the cleanup authority after a lost GET.
      owned.push(location);
    }
  }
  await removeOwnedLocations({
    familyId: A.family,
    userId: A.parent,
    locations: owned,
    idempotencyKeys,
  });
}

test.use({ storageState: authFile("parentA") });

for (const locale of ["en", "es"] as const) {
  test(`${locale}: Locations sheet keeps draft through pending navigation and retries`, async ({
    page,
    context,
    baseURL,
  }, info: TestInfo) => {
    test.skip(
      !PROJECT_NAMES.has(info.project.name),
      "covered by the intended three responsive projects",
    );
    assertFixtureTargetAllowed(process.env);
    expect(LOOPBACK_HOSTS.has(new URL(baseURL!).hostname)).toBe(true);
    const copy = copyFor(locale);
    const blockedWrites: string[] = [];
    const postKeys: string[] = [];
    const postBodies: unknown[] = [];
    let releasePending: (() => void) | undefined;
    let restored = false;
    await setLocale(page, locale);
    await page.goto("/dashboard");
    const originalResponse = await browserFetch(page, "/api/family/features");
    expect(originalResponse.status, originalResponse.body).toBe(200);
    const originalFeatures = JSON.parse(originalResponse.body)
      .features as Record<string, boolean>;
    const cleanAudit = await ownFeatureAudit(["locations"]);
    const recoveryPage = await context.newPage();
    await setLocale(recoveryPage, locale);
    await installLoopbackGuard(context, blockedWrites, new Set());
    try {
      const enabled = await browserSend(page, "PATCH", "/api/family/features", {
        features: { ...originalFeatures, locations: true },
      });
      expect(enabled.status, enabled.body).toBe(200);
      await page.route("**/api/locations**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() === "GET" && url.pathname === "/api/locations") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              locations: [
                {
                  id: "synthetic-location",
                  label: "Existing place",
                  address: "synthetic-private-address",
                  is_primary: false,
                  user_id: A.parent,
                },
              ],
            }),
          });
          return;
        }
        if (request.method() !== "POST" || url.pathname !== "/api/locations") {
          await route.continue();
          return;
        }
        postKeys.push(request.headers()["idempotency-key"] ?? "");
        postBodies.push(request.postDataJSON());
        if (postKeys.length === 1) {
          await new Promise<void>((resolve) => {
            releasePending = resolve;
          });
        }
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "synthetic location refusal" }),
        });
      });

      await page.goto("/dashboard/locations");
      await page.getByRole("button", { name: copy.add, exact: true }).click();
      const dialog = page.getByRole("dialog", {
        name: copy.newTitle,
        exact: true,
      });
      await expect(dialog).toBeVisible();
      const draftLabel = `Synthetic ${locale} ${randomUUID()}`;
      const draftAddress = `Synthetic address ${randomUUID()}`;
      await dialog.getByLabel(copy.label, { exact: true }).fill(draftLabel);
      await dialog.getByLabel(copy.address, { exact: true }).fill(draftAddress);
      await assertDialogSurface(page, dialog);
      await dialog
        .getByRole("button", { name: copy.save, exact: true })
        .click();
      await expect.poll(() => postKeys.length).toBe(1);
      await expect(
        dialog.getByRole("button", { name: copy.saving, exact: true }),
      ).toBeDisabled();
      await expect(
        dialog.getByLabel(copy.label, { exact: true }),
      ).toBeDisabled();
      await expect(
        dialog.getByLabel(copy.address, { exact: true }),
      ).toBeDisabled();
      await expect(
        dialog.getByRole("button", { name: copy.cancel, exact: true }),
      ).toBeDisabled();
      await expect(
        dialog.getByRole("button", { name: copy.closeForm, exact: true }),
      ).toHaveCount(0);

      await page
        .goBack({ waitUntil: "commit", timeout: 2_000 })
        .catch(() => null);
      await expect(page).toHaveURL(/\/dashboard\/locations$/);
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      releasePending?.();
      releasePending = undefined;
      await expect(dialog.getByRole("alert")).toHaveText(copy.saveFailed);

      await dialog
        .getByRole("button", { name: copy.retrySave, exact: true })
        .click();
      await expect.poll(() => postKeys.length).toBe(2);
      expect(postKeys[1]).toBe(postKeys[0]);
      expect(postBodies[1]).toEqual(postBodies[0]);
      await expect(dialog.getByRole("alert")).toHaveText(copy.saveFailed);

      const changedAddress = `${draftAddress} changed`;
      await dialog
        .getByLabel(copy.address, { exact: true })
        .fill(changedAddress);
      await dialog
        .getByRole("button", { name: copy.retrySave, exact: true })
        .click();
      await expect.poll(() => postKeys.length).toBe(3);
      expect(postKeys[2]).not.toBe(postKeys[0]);
      expect(postBodies[2]).not.toEqual(postBodies[0]);
      await expect(dialog.getByRole("alert")).toHaveText(copy.saveFailed);
      await dialog
        .getByRole("button", { name: copy.cancel, exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      expect(blockedWrites).toEqual([]);
      await info.attach(`locations-${locale}-synthetic-transport`, {
        body: JSON.stringify({
          locale,
          project: info.project.name,
          transport:
            "synthetic POST pending/refusal only; no FamilyLocation row was written",
          postKeys,
          samePayloadRetry:
            JSON.stringify(postBodies[1]) === JSON.stringify(postBodies[0]),
          changedPayloadFreshKey: postKeys[2] !== postKeys[0],
        }),
        contentType: "application/json",
      });
    } finally {
      releasePending?.();
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await context.unrouteAll({ behavior: "ignoreErrors" });
      try {
        await recoveryPage.goto("/dashboard");
        const restoredResponse = await browserSend(
          recoveryPage,
          "PATCH",
          "/api/family/features",
          {
            features: originalFeatures,
          },
        );
        expect(restoredResponse.status, restoredResponse.body).toBe(200);
        const canonical = await browserFetch(
          recoveryPage,
          "/api/family/features",
        );
        expect(canonical.status, canonical.body).toBe(200);
        expect(JSON.parse(canonical.body).features).toEqual(originalFeatures);
        restored = true;
      } finally {
        try {
          await cleanAudit(restored);
        } finally {
          await recoveryPage.close({ runBeforeUnload: false }).catch(() => {});
        }
      }
    }
  });
}

for (const locale of ["en", "es"] as const) {
  test(`${locale}: real Locations create/read/edit uses the lost-response receipt`, async ({
    page,
    context,
    browser,
    baseURL,
  }, info: TestInfo) => {
    test.skip(
      !PROJECT_NAMES.has(info.project.name),
      "covered by the intended three responsive projects",
    );
    assertFixtureTargetAllowed(process.env);
    expect(LOOPBACK_HOSTS.has(new URL(baseURL!).hostname)).toBe(true);
    const copy = copyFor(locale);
    const blockedWrites: string[] = [];
    const ownedIds = new Set<string>();
    const postKeys: string[] = [];
    const expected: OwnedLocation[] = [];
    let originalFeatures: Record<string, boolean> | undefined;
    let restored = false;
    await setLocale(page, locale);
    await page.goto("/dashboard");
    const originalResponse = await browserFetch(page, "/api/family/features");
    expect(originalResponse.status, originalResponse.body).toBe(200);
    originalFeatures = JSON.parse(originalResponse.body).features as Record<
      string,
      boolean
    >;
    const cleanAudit = await ownFeatureAudit(["locations"]);
    const recoveryPage = await context.newPage();
    await setLocale(recoveryPage, locale);
    try {
      const enabled = await browserSend(page, "PATCH", "/api/family/features", {
        features: { ...originalFeatures, locations: true },
      });
      expect(enabled.status, enabled.body).toBe(200);
      await installLoopbackGuard(context, blockedWrites, ownedIds);
      let firstResponseLost = false;
      const postBodies: unknown[] = [];
      await page.route("**/api/locations", async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        postKeys.push(route.request().headers()["idempotency-key"] ?? "");
        postBodies.push(route.request().postDataJSON());
        if (!firstResponseLost) {
          firstResponseLost = true;
          await route.fetch();
          await route.abort("failed");
          return;
        }
        await route.continue();
      });

      await page.goto("/dashboard/locations");
      await page.getByRole("button", { name: copy.add, exact: true }).click();
      const dialog = page.getByRole("dialog", {
        name: copy.newTitle,
        exact: true,
      });
      await expect(dialog).toBeVisible();
      const label = `E2E location ${locale} ${randomUUID()}`;
      const address = `E2E private address ${randomUUID()}`;
      expected.push({ id: "", label, address });
      await dialog.getByLabel(copy.label, { exact: true }).fill(label);
      await dialog.getByLabel(copy.address, { exact: true }).fill(address);
      await dialog
        .getByRole("button", { name: copy.save, exact: true })
        .click();
      await expect(dialog.getByRole("alert")).toHaveText(copy.saveNetworkError);
      const retryResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/api/locations" &&
          response.status() === 201,
      );
      await dialog
        .getByRole("button", { name: copy.retrySave, exact: true })
        .click();
      const response = await retryResponse;
      const responseBody = await response.text();
      const created = JSON.parse(responseBody) as { location?: LocationRow };
      expect(created.location?.id).toEqual(expect.any(String));
      expect(created.location).toMatchObject({
        label,
        address,
        user_id: A.parent,
      });
      expected[0].id = created.location!.id;
      ownedIds.add(created.location!.id);
      expect(postKeys).toHaveLength(2);
      expect(postKeys[0]).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
      expect(postKeys[1]).toBe(postKeys[0]);
      expect(postBodies[1]).toEqual(postBodies[0]);
      await expect(dialog).toHaveCount(0);

      const read = await browserFetch(page, "/api/locations");
      expect(read.status, read.body).toBe(200);
      const persisted = (
        (JSON.parse(read.body).locations ?? []) as LocationRow[]
      ).find((row) => row.id === created.location!.id);
      expect(persisted).toMatchObject({
        id: created.location!.id,
        label,
        address,
        user_id: A.parent,
      });

      const editedLabel = `${label} edited`;
      const editedAddress = `${address} edited`;
      const editButton = page.getByRole("button", {
        name: copy.editButton.replace("{label}", label),
        exact: true,
      });
      await editButton.click();
      const editDialog = page.getByRole("dialog", {
        name: copy.editTitle,
        exact: true,
      });
      await expect(editDialog).toBeVisible();
      await editDialog
        .getByLabel(copy.label, { exact: true })
        .fill(editedLabel);
      await editDialog
        .getByLabel(copy.address, { exact: true })
        .fill(editedAddress);
      const patchResponse = page.waitForResponse(
        (candidate) =>
          candidate.request().method() === "PATCH" &&
          new URL(candidate.url()).pathname ===
            `/api/locations/${created.location!.id}`,
      );
      await editDialog
        .getByRole("button", { name: copy.saveChanges, exact: true })
        .click();
      const patched = await patchResponse;
      const patchedBody = await patched.text();
      expect(patched.status(), patchedBody).toBe(200);
      const patchedLocation = (
        JSON.parse(patchedBody) as { location?: LocationRow }
      ).location;
      expect(patchedLocation).toMatchObject({
        id: created.location!.id,
        label: editedLabel,
        address: editedAddress,
        user_id: A.parent,
      });
      expected[0] = {
        id: created.location!.id,
        label: editedLabel,
        address: editedAddress,
      };
      await expect(editDialog).toHaveCount(0);
      const editedRead = await browserFetch(page, "/api/locations");
      expect(editedRead.status, editedRead.body).toBe(200);
      expect(
        ((JSON.parse(editedRead.body).locations ?? []) as LocationRow[]).find(
          (row) => row.id === created.location!.id,
        ),
      ).toMatchObject(expected[0]);

      const childContext = await browser.newContext({
        baseURL,
        storageState: authFile("childA"),
        viewport: page.viewportSize() ?? undefined,
      });
      const childPage = await childContext.newPage();
      await setLocale(childPage, locale);
      try {
        await childPage.goto("/dashboard");
        const refused = await browserFetch(childPage, "/api/locations");
        expect(refused.status, refused.body).toBe(403);
        expect(refused.body).not.toContain(editedAddress);
        await childPage.goto("/dashboard/locations");
        await expect(childPage.locator("body")).not.toContainText(
          editedAddress,
        );
      } finally {
        await childContext.close();
      }

      await info.attach(`locations-${locale}-real-receipt`, {
        body: JSON.stringify({
          locale,
          project: info.project.name,
          locationId: created.location!.id,
          idempotencyKeys: postKeys,
          transport:
            "first real POST committed and its browser response was aborted; unchanged retry replayed one receipt; PATCH/read-back used the exact returned id",
          rolePrivacy:
            "child GET refused with no private address in body or page",
        }),
        contentType: "application/json",
      });
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await context.unrouteAll({ behavior: "ignoreErrors" });
      const cleanupErrors: unknown[] = [];
      try {
        await recoveryPage.goto("/dashboard");
        await removeExactRows(recoveryPage, expected, postKeys);
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        await recoveryPage.goto("/dashboard");
        const restoredResponse = await browserSend(
          recoveryPage,
          "PATCH",
          "/api/family/features",
          {
            features: originalFeatures,
          },
        );
        expect(restoredResponse.status, restoredResponse.body).toBe(200);
        const canonical = await browserFetch(
          recoveryPage,
          "/api/family/features",
        );
        expect(canonical.status, canonical.body).toBe(200);
        expect(JSON.parse(canonical.body).features).toEqual(originalFeatures);
        restored = true;
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        await cleanAudit(restored);
      } catch (error) {
        cleanupErrors.push(error);
      } finally {
        await recoveryPage.close({ runBeforeUnload: false }).catch(() => {});
      }
      if (cleanupErrors.length) throw cleanupErrors[0];
    }
    expect(blockedWrites).toEqual([]);
  });
}
