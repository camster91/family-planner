/** #430: localized destructive presentation; all DELETEs are refused synthetic responses. */
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { test, expect, browserFetch, loginViaUi } from "./support/test";
import { authFile } from "./support/env";
import { FIXTURE_IDS, FIXTURE_EMAILS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import {
  accountDeletionMessages as messages,
  type AccountDeletionMessage,
} from "../src/i18n/account-deletion";
import { navigationMessages } from "../src/i18n/navigation";
import {
  isPseudolocaleEnabled,
  pseudolocalizeTemplate,
} from "../src/i18n/pseudo";
const expanded = isPseudolocaleEnabled(process.env);
const projects = [
  "phone-390x844",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
];
function translate(value: string) {
  return expanded ? pseudolocalizeTemplate(value) : value;
}
async function capture(
  page: Page,
  info: TestInfo,
  name: string,
  targets: Locator[] = [],
) {
  for (const target of targets) {
    await target.evaluate((el) =>
      el.scrollIntoView({ block: "center", inline: "nearest" }),
    );
    await target.focus();
    await expect(target).toBeFocused();
    const b = await target.boundingBox();
    const v = page.viewportSize()!;
    expect(b!.height).toBeGreaterThanOrEqual(44);
    expect(b!.width).toBeGreaterThanOrEqual(44);
    expect(b!.x).toBeGreaterThanOrEqual(0);
    expect(b!.y).toBeGreaterThanOrEqual(0);
    expect(b!.x + b!.width).toBeLessThanOrEqual(v.width);
    expect(b!.y + b!.height).toBeLessThanOrEqual(v.height);
    expect(
      await target.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return el.contains(
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
        );
      }),
    ).toBe(true);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath(name + ".png"),
    fullPage: false,
    animations: "disabled",
  });
  const blocking = (
    await new AxeBuilder({ page })
      .include('[data-testid="delete-account-dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze()
  ).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  await info.attach(name + "-axe", {
    body: JSON.stringify(blocking),
    contentType: "application/json",
  });
  expect(blocking).toEqual([]);
}
for (const role of ["parent", "teen", "child"] as const)
  test.describe(role, () => {
    test.use({
      storageState:
        role === "parent"
          ? authFile("parentA")
          : role === "child"
            ? authFile("childA")
            : { cookies: [], origins: [] },
    });
    for (const locale of ["en", "es"] as const)
      test(`${locale}: loading export pending and refused recovery preserve the own fixture`, async ({
        page,
        context,
        baseURL,
      }, info) => {
        test.skip(
          !projects.includes(info.project.name),
          "Representative account-dialog viewports",
        );
        assertFixtureTargetAllowed(process.env);
        expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
          new URL(baseURL!).hostname,
        );
        await context.route("**/*", (route) => {
          const u = new URL(route.request().url());
          return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ||
            ["data:", "blob:"].includes(u.protocol)
            ? route.continue()
            : route.abort();
        });
        // Never allow this new presentation suite to send a real destructive request.
        const deletes: Array<{
          url: string;
          body: unknown;
          key: string | undefined;
        }> = [];
        let offlineRefusal = false;
        let finishDelete!: () => Promise<void>;
        let pendingDelete!: () => void;
        const pendingSeen = new Promise<void>((r) => (pendingDelete = r));
        await context.route(/\/api\/(users|family)$/, async (route) => {
          if (route.request().method() !== "DELETE") return route.continue();
          deletes.push({
            url: new URL(route.request().url()).pathname,
            body: route.request().postDataJSON(),
            key: route.request().headers()["idempotency-key"],
          });
          if (offlineRefusal) return route.abort("failed");
          if (deletes.length === 1) {
            finishDelete = () =>
              route.fulfill({
                status: 409,
                contentType: "application/json",
                body: JSON.stringify({
                  error: { code: "IDEMPOTENCY_IN_PROGRESS" },
                }),
              });
            pendingDelete();
            return;
          }
          return route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({ error: "Synthetic {message} / 李 refusal" }),
          });
        });
        try {
          if (role === "teen") {
            await loginViaUi(page, FIXTURE_EMAILS.familyA.teen);
            await expect(page).toHaveURL(/\/dashboard(?:\/)?$/);
          } else await page.goto("/dashboard");
          const auth = await browserFetch(page, "/api/auth/me");
          expect(auth.status).toBe(200);
          expect(JSON.parse(auth.body).user.id).toBe(FIXTURE_IDS.familyA[role]);
          const before = await browserFetch(page, "/api/users/deletion");
          expect(before.status).toBe(200);
          const options = JSON.parse(before.body);
          const version = await browserFetch(page, "/api/version");
          expect(version.status).toBe(200);
          await info.attach("actual-runtime-role-mode", {
            body: JSON.stringify({
              runtime: JSON.parse(version.body),
              role,
              expanded,
            }),
            contentType: "application/json",
          });
          const msg = (key: AccountDeletionMessage) =>
            translate(messages[locale][key]);
          await page.evaluate(
            (language) =>
              localStorage.setItem("familyPlanner_language", language),
            locale,
          );
          let finishLoad!: () => Promise<void>;
          let loadSeen!: () => void;
          const loadingSeen = new Promise<void>((r) => (loadSeen = r));
          await page.route("**/api/users/deletion", (route) => {
            finishLoad = () =>
              route.fulfill({
                status: 503,
                contentType: "application/json",
                body: "{}",
              });
            loadSeen();
          });
          await page.goto(
            role === "child" ? "/dashboard" : "/dashboard/settings",
          );
          await expect(page.locator("html")).toHaveAttribute("lang", locale);
          if (expanded)
            await expect(page.locator("html")).toHaveAttribute(
              "data-pseudolocalized",
              "true",
            );
          if (role === "child") {
            await page
              .getByRole("button", {
                name: translate(navigationMessages[locale].userMenu),
                exact: true,
              })
              .click();
            await page
              .getByRole("button", {
                name: translate(navigationMessages[locale].deleteAccount),
                exact: true,
              })
              .click();
          } else
            await page
              .getByRole("button", { name: "Delete Account", exact: true })
              .click();
          const dialog = page.getByTestId("delete-account-dialog");
          await loadingSeen;
          await expect(dialog.getByRole("status")).toHaveText(msg("loading"));
          await capture(page, info, `${role}-${locale}-loading`, [
            dialog.getByRole("button", { name: msg("close"), exact: true }),
          ]);
          await finishLoad();
          await expect(dialog.getByRole("alert")).toHaveText(msg("loadFailed"));
          await capture(page, info, `${role}-${locale}-load-failed`, [
            dialog.getByRole("button", { name: msg("retry"), exact: true }),
          ]);
          await page.unroute("**/api/users/deletion");
          await dialog
            .getByRole("button", { name: msg("retry"), exact: true })
            .click();
          const household = role === "parent" && options.canDeleteHousehold;
          await expect(dialog).toHaveAccessibleName(
            msg(household ? "householdTitle" : "accountTitle"),
          );
          await expect(
            dialog.getByText(msg("irreversible"), { exact: true }),
          ).toBeVisible();
          const download = dialog.getByRole("button", {
            name: msg("export"),
            exact: true,
          });
          await capture(page, info, `${role}-${locale}-ready`, [
            dialog.getByRole("button", { name: msg("close"), exact: true }),
            download,
          ]);
          await page.route("**/api/users/export", (route) =>
            route.fulfill({
              status: 503,
              contentType: "application/json",
              body: "{}",
            }),
          );
          await download.click();
          await expect(
            dialog.getByText(msg("exportFailed"), { exact: true }),
          ).toBeVisible();
          await capture(page, info, `${role}-${locale}-export-failed`, [
            download,
          ]);
          const password = dialog.getByLabel(msg("password"), { exact: true });
          const confirmation = dialog.locator("#delete-account-confirm");
          await password.fill("fabricated-password");
          await confirmation.fill("ELIMINAR");
          const submit = dialog.getByRole("button", {
            name: msg(household ? "householdTitle" : "deleteAccount"),
            exact: true,
          });
          await expect(submit).toBeDisabled();
          const expected = household ? options.household.name : "DELETE";
          await confirmation.fill(expected);
          await expect(submit).toBeEnabled();
          await password.focus();
          await page.keyboard.press("Tab");
          await expect(confirmation).toBeFocused();
          await capture(page, info, `${role}-${locale}-confirmed`, [
            password,
            confirmation,
            submit,
          ]);
          await submit.click();
          await pendingSeen;
          await expect(
            dialog.getByRole("button", { name: msg("deleting"), exact: true }),
          ).toBeDisabled();
          await expect(
            dialog.getByRole("button", { name: msg("close"), exact: true }),
          ).toHaveCount(0);
          await page.keyboard.press("Escape");
          await expect(dialog).toBeVisible();
          await capture(page, info, `${role}-${locale}-pending`);
          await finishDelete();
          await expect(dialog.getByRole("alert")).toHaveText(
            msg("stillWorking"),
          );
          await expect(password).toHaveValue("fabricated-password");
          await expect(confirmation).toHaveValue(expected);
          await capture(page, info, `${role}-${locale}-still-working`, [
            submit,
          ]);
          await submit.click();
          await expect(dialog.getByRole("alert")).toHaveText(
            "Synthetic {message} / 李 refusal",
          );
          expect(deletes).toHaveLength(2);
          offlineRefusal = true;
          await context.setOffline(true);
          await expect
            .poll(() => page.evaluate(() => navigator.onLine))
            .toBe(false);
          await submit.click();
          await expect(dialog.getByRole("alert")).toHaveText(
            msg("noConnection"),
          );
          await expect(password).toHaveValue("fabricated-password");
          await expect(confirmation).toHaveValue(expected);
          await capture(page, info, `${role}-${locale}-offline-recovery`, [
            submit,
          ]);
          offlineRefusal = false;
          await context.setOffline(false);
          await expect
            .poll(() => page.evaluate(() => navigator.onLine))
            .toBe(true);
          await submit.click();
          await expect(dialog.getByRole("alert")).toHaveText(
            "Synthetic {message} / 李 refusal",
          );
          expect(deletes).toHaveLength(5);
          expect(deletes[2].key).not.toBe(deletes[0].key);
          expect(
            new Set(deletes.slice(2).map((request) => request.key)).size,
          ).toBe(1);
          expect(deletes[0].key).toMatch(/^[0-9a-f-]{36}$/);
          expect(deletes[1].key).toBe(deletes[0].key);
          const body = household
            ? {
                familyId: options.household.id,
                password: "fabricated-password",
                confirmation: expected,
              }
            : { password: "fabricated-password", confirmation: expected };
          deletes.forEach((request) => {
            expect(request.body).toEqual(body);
            expect(request.url).toBe(household ? "/api/family" : "/api/users");
          });
          await capture(page, info, `${role}-${locale}-refused`, [
            submit,
            dialog.getByRole("button", { name: msg("cancel"), exact: true }),
          ]);
          await page.keyboard.press("Escape");
          await expect(dialog).toHaveCount(0);
          const after = await browserFetch(page, "/api/users/deletion");
          expect(after.status).toBe(200);
          expect(JSON.parse(after.body)).toEqual(options);
          const stillAuth = await browserFetch(page, "/api/auth/me");
          expect(stillAuth.status).toBe(200);
          expect(JSON.parse(stillAuth.body).user.id).toBe(
            FIXTURE_IDS.familyA[role],
          );
        } finally {
          await context.setOffline(false);
          await page.unroute("**/api/users/deletion");
          await page.unroute("**/api/users/export");
        }
      });
  });
