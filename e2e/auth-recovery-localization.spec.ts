/** #434: anonymous recovery presentation; every recovery POST is intercepted. */
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { test, expect } from "./support/test";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { authRecoveryMessages } from "../src/i18n/auth-recovery";
import { messages } from "../src/i18n";
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
  test(`${locale}: anonymous password recovery keeps exact drafts and synthetic requests`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.skip(
      !projects.includes(info.project.name),
      "Representative anonymous recovery sizes",
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
    const copy = (key: keyof typeof authRecoveryMessages.en) =>
      translate(authRecoveryMessages[locale][key]);
    const auth = (key: keyof typeof messages.en.auth) =>
      translate(messages[locale].auth[key]);
    const posts: Array<{ path: string; body: unknown }> = [];
    let mode: "hold" | "success" | "network" = "hold";
    let finish!: (status: number, body: unknown) => Promise<void>;
    await context.route(
      /\/api\/auth\/(forgot-password|reset-password)$/,
      (route) => {
        expect(route.request().method()).toBe("POST");
        posts.push({
          path: new URL(route.request().url()).pathname,
          body: route.request().postDataJSON(),
        });
        if (mode === "network") return route.abort("failed");
        if (mode === "success")
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: "{}",
          });
        finish = (status, body) =>
          route.fulfill({
            status,
            contentType: "application/json",
            body: JSON.stringify(body),
          });
      },
    );
    await page.goto("/forgot-password");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    if (expanded)
      await expect(page.locator("html")).toHaveAttribute(
        "data-pseudolocalized",
        "true",
      );
    const runtime = await page.request.get("/api/version");
    expect(runtime.status()).toBe(200);
    await info.attach("runtime-version", {
      body: JSON.stringify({ runtime: await runtime.json(), locale, expanded }),
      contentType: "application/json",
    });
    const email = page.getByLabel(auth("email"));
    const send = page.getByRole("button", {
      name: auth("sendResetLink"),
      exact: true,
    });
    const fakeEmail = "Private+QA@example.test";
    await email.fill(fakeEmail);
    await expect(email).toHaveAttribute(
      "placeholder",
      copy("emailPlaceholder"),
    );
    await capture(page, info, "forgot-ready", [email, send]);
    await send.click();
    await expect.poll(() => posts.length).toBe(1);
    await expect(
      page.getByRole("button", { name: auth("sendingResetLink") }),
    ).toBeDisabled();
    await capture(page, info, "forgot-pending", [email]);
    await finish(503, {});
    await expect(page.locator(".auth-panel").getByRole("alert")).toHaveText(
      translate(messages[locale].common.error),
    );
    await expect(email).toHaveValue(fakeEmail);
    await capture(page, info, "forgot-refused", [send]);
    mode = "success";
    await send.click();
    await expect(
      page.getByRole("heading", { name: copy("checkEmail") }),
    ).toBeVisible();
    expect(await page.getByText(fakeEmail, { exact: true }).textContent()).toBe(
      fakeEmail,
    );
    const back = page.getByRole("link", { name: auth("backToSignIn") });
    await expect(back).toHaveAttribute("href", "/login");
    await capture(page, info, "forgot-success", [back]);
    expect(posts.slice(0, 2)).toEqual(
      Array(2).fill({
        path: "/api/auth/forgot-password",
        body: { email: fakeEmail },
      }),
    );
    await page.goto("/reset-password");
    await expect(
      page.getByRole("heading", { name: copy("invalidTitle") }),
    ).toBeVisible();
    const newLink = page.getByRole("link", { name: auth("sendResetLink") });
    await expect(newLink).toHaveAttribute("href", "/forgot-password");
    await capture(page, info, "reset-invalid", [newLink]);
    expect(posts.length).toBe(2);
    const token = "synthetic-public-qa-token";
    const fakePassword = "synthetic-reset-password";
    await page.goto("/reset-password?token=" + token);
    const password = page.getByLabel(auth("password"), { exact: true });
    const confirm = page.getByLabel(auth("confirmPassword"));
    const reset = page.getByRole("button", {
      name: auth("resetPasswordBtn"),
      exact: true,
    });
    await password.fill(fakePassword);
    await confirm.fill("synthetic-mismatch");
    await password.focus();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: copy("showPassword") }).first(),
    ).toBeFocused();
    await capture(page, info, "reset-ready", [
      password,
      confirm,
      reset,
      page.getByRole("button", { name: copy("showPassword") }).first(),
      page.getByRole("button", { name: copy("showPassword") }).last(),
    ]);
    await reset.click();
    await expect(page.locator(".auth-panel").getByRole("alert")).toHaveText(
      auth("passwordMismatch"),
    );
    expect(posts.length).toBe(2);
    await capture(page, info, "reset-validation", [reset]);
    await confirm.fill(fakePassword);
    await page
      .getByRole("button", { name: copy("showPassword") })
      .first()
      .click();
    await expect(password).toHaveAttribute("type", "text");
    mode = "hold";
    await reset.click();
    await expect.poll(() => posts.length).toBe(3);
    await expect(
      page.getByRole("button", { name: auth("resetting") }),
    ).toBeDisabled();
    await capture(page, info, "reset-pending", [password, confirm]);
    await finish(400, { error: "Synthetic raw refusal {token} / 李" });
    await expect(page.locator(".auth-panel").getByRole("alert")).toHaveText(
      "Synthetic raw refusal {token} / 李",
    );
    await capture(page, info, "reset-refused", [reset]);
    mode = "network";
    await reset.click();
    await expect(page.locator(".auth-panel").getByRole("alert")).toHaveText(
      auth("unexpectedError"),
    );
    await expect(password).toHaveValue(fakePassword);
    await expect(confirm).toHaveValue(fakePassword);
    await capture(page, info, "reset-network", [reset]);
    mode = "success";
    await reset.click();
    await expect(
      page.getByText(copy("resetSuccess"), { exact: true }),
    ).toBeVisible();
    await capture(page, info, "reset-success", [
      page.getByRole("button", { name: auth("signIn"), exact: true }),
    ]);
    expect(posts.slice(2)).toEqual(
      Array(3).fill({
        path: "/api/auth/reset-password",
        body: { token, password: fakePassword },
      }),
    );
    expect(posts.length).toBe(5);
    await page
      .getByRole("button", { name: auth("signIn"), exact: true })
      .click();
    await expect(page).toHaveURL(/\/login$/);
  });
