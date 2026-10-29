/**
 * Family AI Today: opt-in rendered proof for the dormant person-chat slice.
 *
 * The browser uses the real fixture parent session and verifies the actual
 * `/api/users` role/household. The `/api/assistant` POST is intercepted with a
 * synthetic assistant transport, so this spec proves rendered client behavior
 * rather than the server route, provider or Today database broker. External
 * traffic and every other state-changing request are blocked. The server must
 * be started with ASSISTANT_TODAY_ENABLED=1.
 */
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import type { BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { E2E_ANCHOR, authFile } from "./support/env";
import { expect, test } from "./support/test";

type Locale = "en" | "es";
type AssistantCall = {
  includeToday?: boolean;
  messages: Array<{ role: string; content: string }>;
};

const PROJECTS = [
  "phone-390x844",
  "phone-430x932",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
  "tablet-large-1920x1200",
  "desktop-1366x768",
] as const;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const TODAY_PROTOCOL = "herewoven.assistant-today.v1";
const TODAY_GENERATED = "2026-10-11T14:00:00.000Z";

// The setup project creates this state; dependencies do not apply it to tests.
test.use({ storageState: authFile("parentA") });

const COPY = {
  en: {
    launcher: "Add or ask",
    ask: "Ask the assistant",
    close: "Close",
    message: "Your message",
    send: "Send",
    includeToday: "Include Today",
    unavailable: "Today context is unavailable right now.",
    expired: "This Today context has expired.",
    refresh: "Refresh Today context",
  },
  es: {
    launcher: "Añadir o preguntar",
    ask: "Preguntar al asistente",
    close: "Cerrar",
    message: "Tu mensaje",
    send: "Enviar",
    includeToday: "Incluir Hoy",
    unavailable: "El contexto de Hoy no está disponible ahora.",
    expired: "Este contexto de Hoy ha caducado.",
    refresh: "Actualizar contexto de Hoy",
  },
} as const;

function todayHeaders(ttlMs = 30_000): Record<string, string> {
  return {
    "X-Assistant-Today-Protocol": TODAY_PROTOCOL,
    "X-Assistant-Today-Generated-At": TODAY_GENERATED,
    "X-Assistant-Today-Expires-At": new Date(
      Date.parse(TODAY_GENERATED) + ttlMs,
    ).toISOString(),
  };
}

function replyBody(includeToday: boolean) {
  return JSON.stringify({
    reply: includeToday
      ? "I found a Today preview for review."
      : "I did not use Today context for this request.",
    action: includeToday
      ? { kind: "list_create", title: "Fixture Today list", type: "custom" }
      : null,
  });
}

async function setLocale(context: BrowserContext, locale: Locale) {
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

async function assertRuntimePerson(page: Page, info: TestInfo, locale: Locale) {
  const [version, users] = await Promise.all([
    page.evaluate(async () => {
      const response = await fetch("/api/version", {
        credentials: "same-origin",
      });
      return { status: response.status, body: await response.text() };
    }),
    page.evaluate(async () => {
      const response = await fetch("/api/users", {
        credentials: "same-origin",
      });
      return { status: response.status, body: await response.text() };
    }),
  ]);
  expect(version.status, version.body).toBe(200);
  expect(users.status, users.body).toBe(200);
  const runtime = JSON.parse(version.body) as { commit?: string };
  const user = JSON.parse(users.body).user as {
    id?: string;
    family_id?: string;
    role?: string;
  };
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  expect(runtime.commit).toBe(commit);
  if (process.env.RELEASE_SHA?.trim())
    expect(process.env.RELEASE_SHA.trim()).toBe(commit);
  expect(user.id).toBe(FIXTURE_IDS.familyA.parent);
  expect(user.family_id).toBe(FIXTURE_IDS.familyA.family);
  expect(user.role).toBe("parent");
  await info.attach("assistant-today-runtime-identity", {
    body: JSON.stringify({
      runtime,
      role: user.role,
      familyId: user.family_id,
      locale,
      transport: "synthetic local assistant transport; real parent session",
    }),
    contentType: "application/json",
  });
}

async function assertDialogSurface(
  page: Page,
  dialog: Locator,
  copy: (typeof COPY)[Locale],
) {
  const buttons = dialog.locator("button:visible");
  for (let index = 0; index < (await buttons.count()); index += 1) {
    const box = await buttons.nth(index).boundingBox();
    expect(box, `button ${index} has no rendered box`).not.toBeNull();
    expect(box!.width, `button ${index} is too narrow`).toBeGreaterThanOrEqual(
      44,
    );
    expect(box!.height, `button ${index} is too short`).toBeGreaterThanOrEqual(
      44,
    );
  }
  const includeRow = dialog.locator("label").filter({
    hasText: copy.includeToday,
  });
  const rowBox = await includeRow.boundingBox();
  expect(rowBox, "Include Today row has no rendered box").not.toBeNull();
  expect(rowBox!.height).toBeGreaterThanOrEqual(44);

  const checkbox = dialog.getByRole("checkbox", {
    name: new RegExp(copy.includeToday),
  });
  await checkbox.focus();
  await expect(checkbox).toBeFocused();

  const violations = (
    await new AxeBuilder({ page }).include('[role="dialog"]').analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

for (const locale of ["en", "es"] as const) {
  test(`${locale}: Today context is explicit, fresh and review-only`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.skip(
      process.env.ASSISTANT_TODAY_ENABLED?.trim() !== "1",
      "Rendered Today context proof requires the E2E-only ASSISTANT_TODAY_ENABLED=1 server flag",
    );
    test.skip(
      !PROJECTS.includes(info.project.name as (typeof PROJECTS)[number]),
      "Assistant Today proof runs at the six representative responsive sizes",
    );
    assertFixtureTargetAllowed(process.env);
    expect(LOCAL_HOSTS).toContain(new URL(baseURL!).hostname);

    const calls: AssistantCall[] = [];
    const blockedExternal: string[] = [];
    const blockedWrites: string[] = [];
    let resolveDelayedSeen: (() => void) | null = null;
    const delayedSeen = new Promise<void>((resolve) => {
      resolveDelayedSeen = resolve;
    });
    const releaseDelayed: { current: (() => void) | null } = { current: null };

    await setLocale(context, locale);
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (["data:", "blob:"].includes(url.protocol)) {
        await route.continue();
        return;
      }
      if (!LOCAL_HOSTS.has(url.hostname)) {
        blockedExternal.push(`${request.method()} ${request.url()}`);
        await route.abort();
        return;
      }
      if (url.pathname === "/api/assistant" && request.method() === "POST") {
        const parsed = JSON.parse(request.postData() ?? "{}") as AssistantCall;
        calls.push(parsed);
        const includeToday = parsed.includeToday === true;
        if (!includeToday) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: replyBody(false),
          });
          return;
        }
        const todayCall = calls.filter(
          (call) => call.includeToday === true,
        ).length;
        if (todayCall === 1) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: {
              ...todayHeaders(),
              "X-Assistant-Today-Protocol": "malformed.protocol",
            },
            body: replyBody(true),
          });
          return;
        }
        if (todayCall === 2) {
          resolveDelayedSeen?.();
          await new Promise<void>((resolve) => {
            releaseDelayed.current = resolve;
          });
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: todayHeaders(),
          body: replyBody(true),
        });
        return;
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
        blockedWrites.push(`${request.method()} ${url.pathname}`);
        await route.abort();
        return;
      }
      await route.continue();
    });

    try {
      const response = await page.goto("/dashboard/today");
      expect(response?.status()).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      if (locale === "es")
        await expect(page.locator("html")).toHaveClass(/dark/);
      else await expect(page.locator("html")).not.toHaveClass(/dark/);
      await assertRuntimePerson(page, info, locale);

      const copy = COPY[locale];
      const launcher = page
        .getByRole("navigation", { name: "Today quick actions" })
        .getByRole("button", { name: copy.launcher, exact: true });
      await expect(launcher).toBeVisible();
      await launcher.click();
      const quickAdd = page.getByTestId("quick-add-dialog");
      await expect(quickAdd).toBeVisible();
      await quickAdd
        .getByRole("button", { name: new RegExp(copy.ask) })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const checkbox = dialog.getByRole("checkbox", {
        name: new RegExp(copy.includeToday),
      });
      await expect(checkbox).not.toBeChecked();
      await assertDialogSurface(page, dialog, copy);

      // Opening the panel never opts the request into household Today data.
      const message = dialog.getByLabel(copy.message, { exact: true });
      await message.fill("What should I do first?");
      await dialog
        .getByRole("button", { name: copy.send, exact: true })
        .click();
      await expect(dialog.getByRole("log")).toContainText(
        "I did not use Today context for this request.",
      );
      expect(calls[0]?.includeToday).toBeUndefined();

      // Opting in sends a distinct request. A malformed freshness envelope
      // fails closed while retaining the unsent question.
      await checkbox.check();
      const malformedDraft = "What is on Today?";
      await message.fill(malformedDraft);
      await dialog
        .getByRole("button", { name: copy.send, exact: true })
        .click();
      await expect(dialog.getByRole("alert")).toContainText(copy.unavailable);
      await expect(message).toHaveValue(malformedDraft);
      expect(calls[1]?.includeToday).toBe(true);

      // A response that arrives after the request-start lease is also rejected.
      const delayedDraft = "Show my plan after a delay.";
      await message.fill(delayedDraft);
      const delayedSend = dialog.getByRole("button", {
        name: copy.send,
        exact: true,
      });
      await delayedSend.click();
      await delayedSeen;
      await page.clock.fastForward(61_000);
      releaseDelayed.current?.();
      await expect(dialog.getByRole("alert")).toContainText(copy.unavailable);
      await expect(message).toHaveValue(delayedDraft);
      expect(calls[2]?.includeToday).toBe(true);

      // A fresh preview may propose an action, but expiry disables confirmation.
      const actionDraft = "Create a list from Today.";
      await message.fill(actionDraft);
      await delayedSend.click();
      const confirm = dialog.getByRole("button", {
        name: locale === "es" ? "Confirmar y guardar" : "Confirm and save",
        exact: true,
      });
      await expect(confirm).toBeVisible();
      await expect(confirm).toBeEnabled();
      await page.clock.fastForward(61_000);
      await expect(confirm).toBeDisabled();
      await expect(dialog.getByText(new RegExp(copy.expired))).toBeVisible();

      // Refreshing the preview does not erase a newer unsent draft.
      const newerDraft = "Keep this newer unsent question.";
      await message.fill(newerDraft);
      await dialog
        .getByRole("button", { name: copy.refresh, exact: true })
        .click();
      await expect(confirm).toBeEnabled();
      await expect(message).toHaveValue(newerDraft);
      expect(calls[4]?.includeToday).toBe(true);
      expect(calls).toHaveLength(5);

      await assertDialogSurface(page, dialog, copy);
      expect(blockedExternal).toEqual([]);
      expect(blockedWrites).toEqual([]);
      await info.attach("assistant-today-opt-in-state", {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });

      await dialog
        .getByRole("button", { name: copy.close, exact: true })
        .click();
      await expect(launcher).toBeFocused();
    } finally {
      releaseDelayed.current?.();
    }
  });
}

// A real child session remains a role boundary even when the server capability
// is enabled. This runs once on the desktop project; the parent journey above
// is the six-size rendered proof.
test("child person session never receives Today assistant capability", async ({
  browser,
  baseURL,
}, info) => {
  test.skip(
    process.env.ASSISTANT_TODAY_ENABLED?.trim() !== "1",
    "Rendered Today context proof requires the E2E-only ASSISTANT_TODAY_ENABLED=1 server flag",
  );
  test.skip(
    info.project.name !== "desktop-1366x768",
    "The role-boundary check runs once; parent proof covers all six sizes",
  );
  assertFixtureTargetAllowed(process.env);
  const blockedExternal: string[] = [];
  const blockedWrites: string[] = [];
  const context = await browser.newContext({
    baseURL,
    storageState: authFile("childA"),
    viewport: info.project.use.viewport,
    hasTouch: info.project.use.hasTouch,
    isMobile: info.project.use.isMobile,
    deviceScaleFactor: 1,
    extraHTTPHeaders: info.project.use.extraHTTPHeaders,
  });
  try {
    await context.addInitScript(
      ({ localeKey, themeKey }) => {
        localStorage.setItem(localeKey, "en");
        localStorage.setItem(themeKey, "light");
      },
      { localeKey: LOCALE_STORAGE_KEY, themeKey: THEME_STORAGE_KEY },
    );
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (["data:", "blob:"].includes(url.protocol)) {
        await route.continue();
        return;
      }
      if (!LOCAL_HOSTS.has(url.hostname)) {
        blockedExternal.push(`${request.method()} ${request.url()}`);
        await route.abort();
        return;
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
        blockedWrites.push(`${request.method()} ${url.pathname}`);
        await route.abort();
        return;
      }
      await route.continue();
    });
    const page = await context.newPage();
    await page.clock.install({ time: E2E_ANCHOR });
    const response = await page.goto("/dashboard/today");
    expect(response?.status()).toBe(200);
    const user = await page.evaluate(async () => {
      const result = await fetch("/api/users", { credentials: "same-origin" });
      return { status: result.status, body: await result.text() };
    });
    expect(user.status, user.body).toBe(200);
    const current = JSON.parse(user.body).user as {
      id?: string;
      family_id?: string;
      role?: string;
    };
    expect(current.id).toBe(FIXTURE_IDS.familyA.child);
    expect(current.family_id).toBe(FIXTURE_IDS.familyA.family);
    expect(current.role).toBe("child");
    await expect(
      page.getByRole("button", { name: "Add or ask", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText("Include Today", { exact: true })).toHaveCount(
      0,
    );
    expect(blockedExternal).toEqual([]);
    expect(blockedWrites).toEqual([]);
  } finally {
    await context.close();
  }
});
