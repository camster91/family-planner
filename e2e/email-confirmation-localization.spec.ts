/** #437: explicit confirmation presentation; every verification POST is intercepted. */
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { test, expect } from "./support/test";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { emailConfirmationMessages } from "../src/i18n/email-confirmation";
import { PRODUCT_BRAND } from "../src/lib/brand";
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
const translate = (text: string) =>
  expanded ? pseudolocalizeTemplate(text) : text;
async function capture(
  page: Page,
  info: TestInfo,
  name: string,
  targets: Locator[],
) {
  for (const target of targets) {
    await target.evaluate((el) =>
      el.scrollIntoView({ block: "center", inline: "nearest" }),
    );
    await target.focus();
    await expect(target).toBeFocused();
    const b = (await target.boundingBox())!;
    const v = page.viewportSize()!;
    expect(b.width).toBeGreaterThanOrEqual(44);
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(v.width);
    expect(b.y + b.height).toBeLessThanOrEqual(v.height);
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
    animations: "disabled",
    fullPage: false,
  });
  const blocking = (
    await new AxeBuilder({ page })
      .include(".auth-panel")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze()
  ).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  await info.attach(name + "-axe", {
    body: JSON.stringify(blocking),
    contentType: "application/json",
  });
  expect(blocking).toEqual([]);
}

test.use({ storageState: { cookies: [], origins: [] } });
for (const locale of ["en", "es"] as const)
  test(`${locale}: email confirmation consumes only explicit synthetic requests`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.skip(
      !projects.includes(info.project.name),
      "Representative anonymous confirmation sizes",
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
    await context.addInitScript(
      (language) => localStorage.setItem("familyPlanner_language", language),
      locale,
    );
    const copy = (key: keyof typeof emailConfirmationMessages.en) =>
      translate(emailConfirmationMessages[locale][key]);
    const posts: Array<{ path: string; method: string; body: unknown }> = [];
    const token = "synthetic-{token}+ / 李";
    let mode:
      | "hold"
      | "network"
      | "rate"
      | "malformed"
      | "invalid"
      | "already"
      | "verified" = "hold";
    let finish!: (status: number, body: unknown) => Promise<void>;
    await context.route("**/api/auth/**", (route) => {
      const request = route.request();
      expect(new URL(request.url()).pathname).toBe("/api/auth/verify-email");
      expect(request.method()).toBe("POST");
      posts.push({
        path: new URL(request.url()).pathname,
        method: request.method(),
        body: request.postDataJSON(),
      });
      if (mode === "network") return route.abort("failed");
      if (mode === "hold") {
        finish = (status, body) =>
          route.fulfill({
            status,
            contentType: "application/json",
            body: JSON.stringify(body),
          });
        return;
      }
      const status = mode === "rate" ? 429 : mode === "invalid" ? 400 : 200;
      const body =
        mode === "malformed"
          ? "not-json"
          : JSON.stringify(
              mode === "already"
                ? { status: "already_verified" }
                : mode === "verified"
                  ? { status: "verified" }
                  : { error: "Synthetic raw error must remain undisplayed" },
            );
      return route.fulfill({ status, contentType: "application/json", body });
    });
    await page.goto("/verify-email");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    if (expanded)
      await expect(page.locator("html")).toHaveAttribute(
        "data-pseudolocalized",
        "true",
      );
    else
      await expect(page.locator("html")).not.toHaveAttribute(
        "data-pseudolocalized",
        "true",
      );
    const runtime = await page.request.get("/api/version");
    expect(runtime.status()).toBe(200);
    const actualRuntime = await runtime.json();
    if (process.env.RELEASE_SHA)
      expect(actualRuntime.commit).toBe(process.env.RELEASE_SHA);
    await info.attach("runtime-version", {
      body: JSON.stringify({ runtime: actualRuntime, locale, expanded }),
      contentType: "application/json",
    });
    await expect(
      page.getByText(copy("missing"), { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: copy("confirm") }),
    ).toHaveCount(0);
    const signIn = () => page.getByRole("link", { name: copy("signIn") });
    await expect(signIn()).toHaveAttribute("href", "/login");
    await capture(page, info, "confirm-missing", [signIn()]);
    expect(posts).toEqual([]);
    const open = async () => {
      await page.goto("/verify-email?token=" + encodeURIComponent(token));
      await expect(
        page.getByRole("heading", { name: copy("title") }),
      ).toBeVisible();
      await expect(
        page.getByText(
          copy("instruction").replace("{brand}", PRODUCT_BRAND.name),
          { exact: true },
        ),
      ).toBeVisible();
    };
    await open();
    const confirm = () =>
      page.getByRole("button", { name: copy("confirm"), exact: true });
    await confirm().focus();
    await page.keyboard.press("Tab");
    await expect(signIn()).toBeFocused();
    await capture(page, info, "confirm-ready", [confirm(), signIn()]);
    expect(posts).toEqual([]);
    await confirm().click();
    await expect.poll(() => posts.length).toBe(1);
    await expect(
      page.getByRole("button", { name: copy("confirming") }),
    ).toBeDisabled();
    await capture(page, info, "confirm-pending", [signIn()]);
    await finish(503, {});
    await expect(page.locator(".auth-panel").getByRole("alert")).toHaveText(
      copy("error"),
    );
    await capture(page, info, "confirm-server-error", [confirm(), signIn()]);
    mode = "network";
    await confirm().click();
    await expect.poll(() => posts.length).toBe(2);
    await expect(confirm()).toBeEnabled();
    await expect(page.locator(".auth-panel").getByRole("alert")).toHaveText(
      copy("error"),
    );
    await capture(page, info, "confirm-network", [confirm()]);
    mode = "rate";
    await confirm().click();
    await expect(page.locator(".auth-panel").getByRole("alert")).toHaveText(
      copy("rate_limited"),
    );
    await capture(page, info, "confirm-rate-limited", [confirm()]);
    mode = "malformed";
    await confirm().click();
    await expect(page.locator(".auth-panel").getByRole("alert")).toHaveText(
      copy("error"),
    );
    await capture(page, info, "confirm-malformed", [confirm()]);
    mode = "invalid";
    await confirm().click();
    await expect(page.locator(".auth-panel").getByRole("alert")).toHaveText(
      copy("invalid"),
    );
    await expect(confirm()).toHaveCount(0);
    await expect(
      page.getByText("Synthetic raw error must remain undisplayed"),
    ).toHaveCount(0);
    await capture(page, info, "confirm-invalid", [signIn()]);
    expect(posts.length).toBe(5);
    await open();
    expect(posts.length).toBe(5);
    mode = "already";
    await confirm().click();
    await expect(page.locator(".auth-panel").getByRole("status")).toHaveText(
      copy("already_verified"),
    );
    await expect(confirm()).toHaveCount(0);
    await capture(page, info, "confirm-already-verified", [signIn()]);
    expect(posts.length).toBe(6);
    await open();
    expect(posts.length).toBe(6);
    mode = "verified";
    await confirm().click();
    await expect(page).toHaveURL(/\/login\?verified=1$/);
    await page.screenshot({
      path: info.outputPath("confirm-redirect.png"),
      animations: "disabled",
      fullPage: false,
    });
    expect(posts).toEqual(
      Array(7).fill({
        path: "/api/auth/verify-email",
        method: "POST",
        body: { token },
      }),
    );
  });
