/** Spanish Notes feature-off copy and role gate, using the real feature API. */
import type { Browser, BrowserContext, TestInfo } from "@playwright/test";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { E2E_ANCHOR, authFile } from "./support/env";
import { browserFetch, browserSend, expect, test } from "./support/test";

const PROJECTS = ["phone-390x844", "desktop-1366x768"] as const;

const COPY = {
  title: "Las notas fijadas están desactivadas",
  parentDescription:
    "Las notas fijadas están desactivadas para tu familia. Puedes activarlas en la configuración de funciones.",
  childDescription:
    "Las notas fijadas están desactivadas para tu familia. Pide a un padre que las active.",
  openFeatures: "Abrir funciones",
  addNote: "Agregar nota",
} as const;

async function guardContext(context: BrowserContext, baseURL: string) {
  assertFixtureTargetAllowed(process.env);
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
    new URL(baseURL).hostname,
  );
  await context.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const local =
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      ["data:", "blob:"].includes(url.protocol);
    if (!local) return route.abort();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      return route.continue();
    }
    if (
      request.method() === "PATCH" &&
      url.pathname === "/api/family/features"
    ) {
      return route.continue();
    }
    return route.abort();
  });
}

async function setSpanish(context: BrowserContext) {
  await context.addInitScript(
    ({ localeKey, themeKey }) => {
      localStorage.setItem(localeKey, "es");
      localStorage.setItem(themeKey, "dark");
    },
    { localeKey: LOCALE_STORAGE_KEY, themeKey: THEME_STORAGE_KEY },
  );
}

async function openChild(browser: Browser, info: TestInfo, baseURL: string) {
  const context = await browser.newContext({
    baseURL,
    storageState: authFile("childA"),
    viewport: info.project.use.viewport,
    hasTouch: info.project.use.hasTouch,
    isMobile: info.project.use.isMobile,
    deviceScaleFactor: info.project.use.deviceScaleFactor,
    timezoneId: info.project.use.timezoneId,
    extraHTTPHeaders: info.project.use.extraHTTPHeaders,
  });
  await guardContext(context, baseURL);
  await setSpanish(context);
  const page = await context.newPage();
  await page.clock.install({ time: E2E_ANCHOR });
  return { context, page };
}

test.use({ storageState: authFile("parentA") });

test("Spanish Notes feature-off state preserves parent and child role copy", async ({
  browser,
  page,
  baseURL,
}, info) => {
  test.skip(
    !PROJECTS.includes(info.project.name as (typeof PROJECTS)[number]),
    "Spanish feature-off rendering runs at phone and desktop sizes",
  );
  assertFixtureTargetAllowed(process.env);
  const parentContext = page.context();
  await guardContext(parentContext, baseURL!);
  await setSpanish(parentContext);

  // The fixture page starts at about:blank. Bootstrap the authenticated
  // origin before same-origin browserFetch/browserSend calls.
  const bootstrap = await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard\/today$/);
  expect(bootstrap?.status()).toBe(200);
  const profile = await browserFetch(page, "/api/users");
  expect(profile.status, profile.body).toBe(200);
  const profileUser = (
    JSON.parse(profile.body) as {
      user: { id?: string; family_id?: string; role?: string };
    }
  ).user;
  expect(profileUser.id).toBe(FIXTURE_IDS.familyA.parent);
  expect(profileUser.family_id).toBe(FIXTURE_IDS.familyA.family);
  expect(profileUser.role).toBe("parent");

  const originalResponse = await browserFetch(page, "/api/family/features");
  expect(originalResponse.status, originalResponse.body).toBe(200);
  const originalFeatures = (
    JSON.parse(originalResponse.body) as { features: Record<string, boolean> }
  ).features;
  const disabledFeatures = { ...originalFeatures, notes: false };
  let childContext: BrowserContext | undefined;
  try {
    const disabled = await browserSend(page, "PATCH", "/api/family/features", {
      features: disabledFeatures,
    });
    expect(disabled.status, disabled.body).toBe(200);

    await page.goto("/dashboard/notes");
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await expect(
      page.getByRole("heading", { name: COPY.title, level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText(COPY.parentDescription, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: COPY.openFeatures, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: COPY.addNote, exact: true }),
    ).toHaveCount(0);
    expect((await browserFetch(page, "/api/notes")).status).toBe(403);

    const child = await openChild(browser, info, baseURL!);
    childContext = child.context;
    await child.page.goto("/dashboard/notes");
    await expect(child.page.locator("html")).toHaveAttribute("lang", "es");
    await expect(
      child.page.getByRole("heading", { name: COPY.title, level: 1 }),
    ).toBeVisible();
    await expect(
      child.page.getByText(COPY.childDescription, { exact: true }),
    ).toBeVisible();
    await expect(
      child.page.getByRole("link", { name: COPY.openFeatures, exact: true }),
    ).toHaveCount(0);
    await expect(
      child.page.getByRole("button", { name: COPY.addNote, exact: true }),
    ).toHaveCount(0);
  } finally {
    await childContext?.close();
    const restored = await browserSend(page, "PATCH", "/api/family/features", {
      features: originalFeatures,
    });
    expect(restored.status, restored.body).toBe(200);
    const canonical = await browserFetch(page, "/api/family/features");
    expect(canonical.status, canonical.body).toBe(200);
    expect(
      (JSON.parse(canonical.body) as { features: Record<string, boolean> })
        .features,
    ).toEqual(originalFeatures);
  }
});
