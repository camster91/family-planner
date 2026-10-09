/** #439: anonymous, synthetic entry feedback; every auth/invitation request is intercepted. */
import AxeBuilder from "@axe-core/playwright";
import type {
  BrowserContext,
  Locator,
  Page,
  Route,
  TestInfo,
} from "@playwright/test";
import { test, expect } from "./support/test";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { authEntryMessages } from "../src/i18n/auth-entry";
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
const format = (text: string) =>
  expanded ? pseudolocalizeTemplate(text) : text;
const identity = {
  email: "synthetic@example.test",
  password: "synthetic-{password} 李",
  name: "Synthetic {name} 李",
};
const token = "synthetic-{token}+ / 李";
const rawError = "Please verify synthetic {email} 李";
type RequestProof = { path: string; method: string; body: unknown };
async function setup(
  context: BrowserContext,
  baseURL: string,
  locale: "en" | "es",
  info: TestInfo,
) {
  test.skip(
    !projects.includes(info.project.name),
    "Representative anonymous entry sizes",
  );
  assertFixtureTargetAllowed(process.env);
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
    new URL(baseURL).hostname,
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
}
async function runtime(page: Page, info: TestInfo, locale: "en" | "es") {
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
  const response = await page.request.get("/api/version");
  expect(response.status()).toBe(200);
  const actual = await response.json();
  if (process.env.RELEASE_SHA)
    expect(actual.commit).toBe(process.env.RELEASE_SHA);
  await info.attach("runtime-version", {
    body: JSON.stringify({ runtime: actual, locale, expanded }),
    contentType: "application/json",
  });
}
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
    // The checkbox's associated label supplies the real 44px hit area; keyboard
    // focus remains on the native required checkbox, never on a fake control.
    const focus = (await target.evaluate((el) => el.tagName === "LABEL"))
      ? target.locator("input")
      : target;
    await focus.focus();
    await expect(focus).toBeFocused();
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
function respond(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}
test.use({ storageState: { cookies: [], origins: [] } });
for (const locale of ["en", "es"] as const) {
  const copy = (key: keyof typeof authEntryMessages.en) =>
    format(authEntryMessages[locale][key]);
  const shared = (key: keyof typeof messages.en.auth) =>
    format(messages[locale].auth[key]);
  test(`${locale}: login owned feedback and neutral resend keep synthetic requests exact`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    await setup(context, baseURL!, locale, info);
    const posts: RequestProof[] = [];
    let mode: "hold" | "fallback" | "network" | "raw" = "hold";
    let finish!: (status: number, body: unknown) => Promise<void>;
    await context.route("**/api/auth/**", (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      expect(["/api/auth/login", "/api/auth/resend-verification"]).toContain(
        path,
      );
      expect(request.method()).toBe("POST");
      posts.push({
        path,
        method: request.method(),
        body: request.postDataJSON(),
      });
      if (mode === "network") return route.abort("failed");
      if (mode === "hold") {
        finish = (status, body) => respond(route, status, body);
        return;
      }
      return respond(route, 403, mode === "raw" ? { error: rawError } : {});
    });
    const open = () =>
      page.goto(
        "/login?token=" +
          encodeURIComponent(token) +
          "&verified=1&deleted=account",
      );
    await open();
    await runtime(page, info, locale);
    const panel = page.locator(".auth-panel");
    await expect(panel.getByRole("status")).toHaveCount(2);
    await expect(
      page.getByText(copy("verified"), { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(copy("accountDeleted"), { exact: true }),
    ).toBeVisible();
    const signUp = page.getByRole("link", {
      name: shared("signUp"),
      exact: true,
    });
    const forgot = page.getByRole("link", {
      name: shared("forgotPassword"),
      exact: true,
    });
    await expect(signUp).toHaveAttribute(
      "href",
      "/register?token=" + encodeURIComponent(token),
    );
    await expect(forgot).toHaveAttribute("href", "/forgot-password");
    await expect(page.locator("#email")).toHaveAttribute(
      "placeholder",
      copy("emailPlaceholder"),
    );
    const submit = page.getByRole("button", {
      name: shared("signIn"),
      exact: true,
    });
    await page.locator("#email").fill(identity.email);
    await page.locator("#password").fill(identity.password);
    const reveal = page.getByRole("button", {
      name: copy("showPassword"),
      exact: true,
    });
    await reveal.focus();
    await page.keyboard.press("Enter");
    const hide = page.getByRole("button", {
      name: copy("hidePassword"),
      exact: true,
    });
    await expect(hide).toBeFocused();
    await expect(page.locator("#password")).toHaveAttribute("type", "text");
    await expect(page.locator("#password")).toHaveValue(identity.password);
    await capture(page, info, "login-arrival-revealed", [
      hide,
      forgot,
      submit,
      signUp,
    ]);
    expect(posts).toEqual([]);
    await submit.click();
    await expect.poll(() => posts.length).toBe(1);
    await expect(
      page.getByRole("button", { name: shared("signingIn"), exact: true }),
    ).toBeDisabled();
    await expect(panel.getByRole("status")).toHaveCount(0);
    await capture(page, info, "login-pending", [hide, forgot]);
    await finish(503, {});
    await expect(panel.getByRole("alert")).toHaveText(shared("loginFailed"));
    await capture(page, info, "login-fallback", [submit]);
    mode = "network";
    await submit.click();
    await expect(panel.getByRole("alert")).toHaveText(
      shared("unexpectedError"),
    );
    await capture(page, info, "login-network", [submit]);
    mode = "raw";
    await submit.click();
    await expect(panel.getByRole("alert")).toHaveText(rawError);
    const resend = page.getByRole("button", {
      name: copy("resend"),
      exact: true,
    });
    await capture(page, info, "login-raw-refusal", [resend, submit]);
    mode = "hold";
    await resend.click();
    await expect.poll(() => posts.length).toBe(4);
    await expect(
      page.getByRole("button", { name: copy("sending"), exact: true }),
    ).toBeDisabled();
    await capture(page, info, "login-resend-pending", [submit]);
    await finish(429, {});
    await expect(
      page.getByRole("button", { name: copy("resendComplete"), exact: true }),
    ).toBeDisabled();
    await capture(page, info, "login-resend-neutral", [submit]);
    for (const [query, key] of [
      ["error=invalid_token", "invalidToken"],
      ["error=missing_token", "missingToken"],
      ["error=server", "verificationError"],
    ] as const) {
      await page.goto("/login?" + query);
      await expect(panel.getByRole("alert")).toHaveText(copy(key));
      await capture(page, info, "login-arrival-" + key, [
        page.getByRole("button", { name: shared("signIn"), exact: true }),
      ]);
    }
    expect(posts).toEqual([
      ...Array(3).fill({
        path: "/api/auth/login",
        method: "POST",
        body: { email: identity.email, password: identity.password },
      }),
      {
        path: "/api/auth/resend-verification",
        method: "POST",
        body: { email: identity.email },
      },
    ]);
  });
  test(`${locale}: registration and invited identity retain consent and neutral feedback`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    await setup(context, baseURL!, locale, info);
    const requests: RequestProof[] = [];
    let mode: "hold" | "fallback" | "network" | "raw" | "success" = "hold";
    let finish!: (status: number, body: unknown) => Promise<void>;
    await context.route("**/api/auth/**", (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      expect(["/api/auth/register", "/api/auth/resend-verification"]).toContain(
        path,
      );
      expect(request.method()).toBe("POST");
      requests.push({
        path,
        method: request.method(),
        body: request.postDataJSON(),
      });
      if (mode === "network") return route.abort("failed");
      if (mode === "hold") {
        finish = (status, body) => respond(route, status, body);
        return;
      }
      return respond(
        route,
        mode === "success" ? 200 : 403,
        mode === "raw" ? { error: "Synthetic raw refusal {name} 李" } : {},
      );
    });
    await context.route("**/api/family/invites/preview?**", (route) => {
      const request = route.request();
      expect(request.method()).toBe("GET");
      expect(new URL(request.url()).searchParams.get("token")).toBe(token);
      requests.push({
        path: new URL(request.url()).pathname + new URL(request.url()).search,
        method: "GET",
        body: null,
      });
      return respond(route, 200, {
        email: identity.email,
        familyName: identity.name,
        role: "parent",
      });
    });
    await page.goto("/register");
    await runtime(page, info, locale);
    const panel = page.locator(".auth-panel");
    await expect(page.locator("#name")).toHaveAttribute(
      "placeholder",
      copy("namePlaceholder"),
    );
    await expect(page.locator("#email")).toHaveAttribute(
      "placeholder",
      copy("emailPlaceholder"),
    );
    await page.locator("#name").fill(identity.name);
    await page.locator("#email").fill(identity.email);
    await page.locator("#password").fill(identity.password);
    await page
      .locator("#confirmPassword")
      .fill(identity.password + "different");
    const consent = page
      .locator('label[for="terms"]')
      .filter({ has: page.locator("input#terms") });
    const checkbox = page.locator("#terms");
    await checkbox.focus();
    await page.keyboard.press("Space");
    await expect(checkbox).toBeChecked();
    await consent.click({ position: { x: 3, y: 3 } });
    await expect(checkbox).not.toBeChecked();
    await consent.click({ position: { x: 3, y: 3 } });
    await expect(checkbox).toBeChecked();
    const submit = page.getByRole("button", {
      name: shared("createAccountBtn"),
      exact: true,
    });
    await capture(page, info, "register-ready", [consent, submit]);
    expect(requests).toEqual([]);
    await submit.click();
    await expect(panel.getByRole("alert")).toHaveText(
      shared("passwordMismatch"),
    );
    await capture(page, info, "register-mismatch", [consent, submit]);
    expect(requests).toEqual([]);
    await page.locator("#confirmPassword").fill(identity.password);
    await submit.click();
    await expect.poll(() => requests.length).toBe(1);
    await expect(
      page.getByRole("button", {
        name: shared("creatingAccount"),
        exact: true,
      }),
    ).toBeDisabled();
    await capture(page, info, "register-pending", [consent]);
    await finish(503, {});
    await expect(panel.getByRole("alert")).toHaveText(
      shared("registrationFailed"),
    );
    await capture(page, info, "register-fallback", [submit]);
    mode = "network";
    await submit.click();
    await expect(panel.getByRole("alert")).toHaveText(
      shared("unexpectedError"),
    );
    await capture(page, info, "register-network", [submit]);
    mode = "raw";
    await submit.click();
    await expect(panel.getByRole("alert")).toHaveText(
      "Synthetic raw refusal {name} 李",
    );
    await capture(page, info, "register-raw-refusal", [submit]);
    await expect(checkbox).toBeChecked();
    await expect(page.locator("#password")).toHaveValue(identity.password);
    mode = "success";
    await submit.click();
    await expect(
      page.getByRole("heading", { name: copy("checkEmail"), exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(copy("verificationGuidance"), { exact: true }),
    ).toBeVisible();
    const signIn = page.getByRole("link", {
      name: copy("signIn"),
      exact: true,
    });
    const resend = page.getByRole("button", {
      name: copy("resend"),
      exact: true,
    });
    await expect(signIn).toHaveAttribute("href", "/login");
    await capture(page, info, "register-check-email", [signIn, resend]);
    mode = "hold";
    await resend.click();
    await expect.poll(() => requests.length).toBe(5);
    await expect(
      page.getByRole("button", { name: copy("sending"), exact: true }),
    ).toBeDisabled();
    await capture(page, info, "register-resend-pending", [signIn]);
    await finish(503, {});
    await expect(
      page.getByRole("button", { name: copy("resendComplete"), exact: true }),
    ).toBeDisabled();
    await capture(page, info, "register-resend-neutral", [signIn]);
    await page.goto("/register?token=" + encodeURIComponent(token));
    await expect(page.locator("#email")).toHaveAttribute("readonly");
    await expect(page.locator("#email")).toHaveValue(identity.email);
    const invitation = copy("invitation").replace(
      /\{(familyName|role)\}/g,
      (_, key: string) =>
        key === "familyName" ? identity.name : copy("parent"),
    );
    await expect(page.getByText(invitation, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("link", { name: shared("signInLink"), exact: true }),
    ).toHaveAttribute("href", "/login");
    await capture(page, info, "register-invited", [
      consent,
      page.getByRole("button", {
        name: shared("createAccountBtn"),
        exact: true,
      }),
    ]);
    expect(requests).toEqual([
      ...Array(4).fill({
        path: "/api/auth/register",
        method: "POST",
        body: identity,
      }),
      {
        path: "/api/auth/resend-verification",
        method: "POST",
        body: { email: identity.email },
      },
      {
        path: "/api/family/invites/preview?token=" + encodeURIComponent(token),
        method: "GET",
        body: null,
      },
    ]);
  });
}
