/** #443 real-route QA. Sensitive work is intercepted, never sent to providers or stored. */
import AxeBuilder from "@axe-core/playwright";
import type {
  BrowserContext,
  Locator,
  Page,
  Route,
  TestInfo,
} from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { expect, browserFetch } from "./test";
import { E2E_BASE_URL } from "./env";
import { assertFixtureTargetAllowed } from "../../src/lib/fixtures/guard";
import {
  settingsMessages,
  type SettingsMessage,
} from "../../src/i18n/settings";
import {
  isPseudolocaleEnabled,
  pseudolocalizeTemplate,
} from "../../src/i18n/pseudo";

export type Locale = "en" | "es";
export const expanded = isPseudolocaleEnabled(process.env);
export const enabled = process.env.E2E_SETTINGS_QA === "enabled";
export const PROFILE = "Synthetic {name} 李";
export const RAW = "Raw {name} <b>李</b> refusal";
export const KEY = "synthetic-settings-key-never-a-provider";
export const PRIVATE_URL = "https://example.test/synthetic/{name}/private.ics";
export const MODEL = "synthetic {model} 李";
export const TOKEN = "synthetic-settings-feed-only";
export const SUB_ID = "synthetic/sub 李";
export const CON_ID = "synthetic/connection 李";
export const msg = (
  locale: Locale,
  key: SettingsMessage,
  params: Record<string, string | number> = {},
) => {
  const template = settingsMessages[locale][key];
  return (expanded ? pseudolocalizeTemplate(template) : template).replace(
    /\{(\w+)\}/g,
    (match, key) => String(params[key] ?? match),
  );
};
type Reply = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  network?: boolean;
};
export type Call = {
  path: string;
  method: string;
  body: unknown;
  contentType: string | null;
};
const key = (method: string, path: string) => `${method} ${path}`;
export class SettingsRequests {
  calls: Call[] = [];
  unexpected: string[] = [];
  reads = new Map<string, Reply>([
    ["/api/family/feed-token", { body: { feedToken: null } }],
    [
      "/api/family/ai-settings",
      { body: { configured: false, keyHint: null, baseUrl: "", model: "" } },
    ],
    ["/api/calendar/subscriptions", { body: { subscriptions: [] } }],
    [
      "/api/calendar/connections",
      {
        body: {
          providers: [
            { id: "google", label: "Google Calendar" },
            { id: "microsoft", label: "Outlook / Microsoft 365" },
          ],
          connections: [],
        },
      },
    ],
  ]);
  private queue = new Map<string, Promise<Reply>[]>();
  private releases: (() => void)[] = [];
  count(method: string, path: string) {
    return this.calls.filter((c) => c.method === method && c.path === path)
      .length;
  }
  reply(method: string, path: string, reply: Reply) {
    this.enqueue(method, path, Promise.resolve(reply));
  }
  hold(method: string, path: string) {
    let release!: (reply: Reply) => void;
    this.enqueue(
      method,
      path,
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    this.releases.push(() =>
      release({ status: 503, body: { error: "Synthetic test teardown" } }),
    );
    return release;
  }
  private enqueue(method: string, path: string, reply: Promise<Reply>) {
    const name = key(method, path);
    this.queue.set(name, [...(this.queue.get(name) ?? []), reply]);
  }
  async arrived(method: string, path: string, count = 1) {
    await expect.poll(() => this.count(method, path)).toBe(count);
  }
  assertLast(
    method: string,
    path: string,
    body?: unknown,
    json = body !== undefined,
  ) {
    const call = this.calls
      .filter((c) => c.method === method && c.path === path)
      .at(-1);
    expect(call).toEqual({
      method,
      path,
      body: body ?? null,
      contentType: json ? "application/json" : null,
    });
  }
  async handle(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== new URL(E2E_BASE_URL).origin) {
      this.unexpected.push("non-fixture API origin");
      return route.abort();
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const path = url.pathname + url.search;
    const method = request.method();
    const raw = request.postData();
    let body: unknown = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    this.calls.push({
      path,
      method,
      body,
      contentType: request.headers()["content-type"] ?? null,
    });
    const queued = this.queue.get(key(method, path))?.shift();
    let response = queued
      ? await queued
      : method === "GET"
        ? this.reads.get(path)
        : undefined;
    if (!response && method !== "GET") {
      this.unexpected.push(key(method, path));
      response = {
        status: 409,
        body: { error: "Unplanned synthetic Settings write refused" },
      };
    }
    if (!response) return route.continue();
    if (response.network) return route.abort("failed");
    return route.fulfill({
      status: response.status ?? 200,
      contentType: "application/json",
      body:
        response.status === 204
          ? undefined
          : JSON.stringify(response.body ?? {}),
      headers: {
        "x-e2e-settings": "intercepted-synthetic-only",
        ...response.headers,
      },
    });
  }
  finish() {
    this.releases.forEach((fn) => fn());
    expect(this.unexpected).toEqual([]);
  }
}
export async function guard(
  context: BrowserContext,
  baseURL: string,
  locale: Locale,
) {
  assertFixtureTargetAllowed(process.env);
  const origin = new URL(baseURL).origin;
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
    new URL(origin).hostname,
  );
  await context.route("**/*", (route) => {
    const u = new URL(route.request().url());
    return u.origin === origin || ["data:", "blob:"].includes(u.protocol)
      ? route.continue()
      : route.abort();
  });
  await context.addInitScript((language) => {
    localStorage.setItem("familyPlanner_language", language);
    // Clipboard writes remain in the page, never Cameron's clipboard.
    const copied: string[] = [];
    Object.defineProperty(window, "__settingsClipboard", { value: copied });
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (value: string) => {
          copied.push(value);
          if (
            (window as unknown as { __settingsCopyRefuse?: boolean })
              .__settingsCopyRefuse
          )
            throw new Error("Synthetic clipboard refusal");
        },
      },
      configurable: true,
    });
  }, locale);
}
export async function install(page: Page, controller: SettingsRequests) {
  await page.route("**/api/**", (route) => controller.handle(route));
}
export async function language(page: Page, locale: Locale) {
  // The actual existing native Settings selector; no remount or storage event.
  await page.locator("#preferredLanguage").selectOption(locale);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}
export async function open(page: Page, locale: Locale, name: SettingsMessage) {
  const heading = page.getByRole("heading", {
    name: msg(locale, name),
    exact: true,
  });
  const summary = heading.locator("xpath=ancestor::summary");
  const details = summary.locator("..");
  await summary.focus();
  if (!(await details.getAttribute("open"))) {
    // Empty-string open attributes also mean open.
    if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open)))
      await page.keyboard.press("Enter");
  }
  await expect(details).toHaveAttribute("open", "");
  return details;
}
export async function identity(
  page: Page,
  info: TestInfo,
  locale: Locale,
  role: string,
) {
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
  const response = await browserFetch(page, "/api/version");
  expect(response.status).toBe(200);
  const actual = JSON.parse(response.body);
  expect(actual.commit).toBe(process.env.RELEASE_SHA);
  const route = fs.readFileSync(
    ".next/server/app/api/version/route.js",
    "utf8",
  );
  const times = [
    ...new Set(route.match(/20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g)),
  ];
  expect(times).toHaveLength(1);
  expect(actual.builtAt).toBe(times[0]);
  const proof = {
    runtime: actual,
    buildId: fs.readFileSync(".next/BUILD_ID", "utf8").trim(),
    buildTree: process.env.E2E_SETTINGS_BUILD_TREE,
    role,
    locale,
    expanded,
    availability: process.env.E2E_SETTINGS_QA,
    sensitiveActions: "intercepted synthetic only",
  };
  expect(proof.buildTree).toMatch(/^[a-f0-9]{40}$/);
  await info.attach("actual-settings-runtime-role-mode", {
    body: JSON.stringify(proof),
    contentType: "application/json",
  });
  return proof;
}
export async function capture(
  page: Page,
  info: TestInfo,
  state: string,
  targets: Locator[] = [],
  owned?: Locator,
) {
  for (const target of targets) {
    await target.scrollIntoViewIfNeeded();
    const input = (await target.evaluate((el) => el.tagName === "LABEL"))
      ? target.locator("input")
      : target;
    await input.focus();
    await expect(input).toBeFocused();
    const box = (await target.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
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
  const dialog = page.getByRole("dialog");
  const scope =
    owned ??
    ((await dialog.count())
      ? dialog
      : page.locator("#settings-account").locator(".."));
  await scope.evaluate((el) => el.setAttribute("data-settings-qa-scope", ""));
  const violations = (
    await new AxeBuilder({ page })
      .include("[data-settings-qa-scope]")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze()
  ).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  await info.attach(state + "-axe", {
    body: JSON.stringify(violations),
    contentType: "application/json",
  });
  expect(violations).toEqual([]);
  const png = await page.screenshot({
    path: info.outputPath(state + ".png"),
    fullPage: false,
    animations: "disabled",
  });
  await info.attach(state + "-capture-proof", {
    body: JSON.stringify({
      state,
      sha256: createHash("sha256").update(png).digest("hex"),
      width: png.readUInt32BE(16),
      height: png.readUInt32BE(20),
      viewport: page.viewportSize(),
      expanded,
      availability: process.env.E2E_SETTINGS_QA,
    }),
    contentType: "application/json",
  });
  await scope.evaluate((el) => el.removeAttribute("data-settings-qa-scope"));
}
