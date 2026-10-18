/**
 * Real Wishlist release slice.
 *
 * The normal journey uses the canonical API and creates only rows carrying a
 * unique run prefix.  The browser route hooks are deliberately narrow:
 * `route.fetch()` reaches the real mutation first, then one response is
 * dropped or made ambiguous to prove the client keeps its idempotency key.
 * No successful mutation payload is fabricated.  The household feature flag
 * and every run-owned row are restored in finally blocks.
 * The duplicate-name accessibility state is an explicit synthetic display
 * overlay over real rows; it is reported separately from canonical API data.
 */
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import type {
  Browser,
  BrowserContext,
  Locator,
  Page,
  TestInfo,
} from "@playwright/test";
import {
  FIXTURE_IDS,
  FIXTURE_LONG_TEXT,
  FIXTURE_EMAILS,
  FIXTURE_PASSWORD,
} from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { E2E_ANCHOR, authFile } from "./support/env";
import { ownFeatureAudit } from "./support/feature-audit";
import { browserFetch, browserSend, expect, test } from "./support/test";

const PROJECTS = new Set([
  "phone-390x844",
  "phone-430x932",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
  "tablet-large-1920x1200",
  "desktop-1366x768",
]);
const FULL_TRANSPORT_PROJECTS = new Set(["phone-390x844", "desktop-1366x768"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const RUN_ID = randomUUID();
const RUN_PREFIX = `E2E Wishlist ${RUN_ID.slice(0, 8)}`;

type Locale = "en" | "es";
type Role = "parent" | "child" | "teen";
type Fault = "lost" | "409" | "429";
type FeatureMap = Record<string, unknown>;

type WishlistItem = {
  id: string;
  title: string;
  link: string | null;
  description: string | null;
  approx_price: string | null;
  status: string;
  requested_by: string;
  requester: { id: string; name: string };
};

type Copy = {
  pageTitle: string;
  myIdeas: string;
  addWish: string;
  save: string;
  cancel: string;
  title: string;
  link: string;
  description: string;
  price: string;
  delete: string;
  edit: string;
  retry: string;
  empty: string;
  writeUncertain: string;
  statusRefreshFailed: string;
  statusFor: (title: string) => string;
  editItem: (title: string) => string;
  deleteItem: (title: string) => string;
  sameNameSection: string;
};

const COPY: Record<Locale, Copy> = {
  en: {
    pageTitle: "Family wishlist",
    myIdeas: "My ideas",
    addWish: "Add a wish",
    save: "Save",
    cancel: "Cancel",
    title: "Title",
    link: "Link",
    description: "Description",
    price: "Approximate price",
    delete: "Delete",
    edit: "Edit",
    retry: "Refresh wishlist",
    empty: "No wishes yet",
    writeUncertain:
      "We could not confirm that change. Check the wishlist before trying again.",
    statusRefreshFailed:
      "The status was saved, but the wishlist could not be refreshed.",
    statusFor: (title) => `Status for ${title}`,
    editItem: (title) => `Edit ${title}`,
    deleteItem: (title) => `Delete ${title}`,
    sameNameSection: "Same household name's ideas",
  },
  es: {
    pageTitle: "Lista familiar",
    myIdeas: "Mis ideas",
    addWish: "Agregar un deseo",
    save: "Guardar",
    cancel: "Cancelar",
    title: "Titulo",
    link: "Enlace",
    description: "Descripcion",
    price: "Precio aproximado",
    delete: "Eliminar",
    edit: "Editar",
    retry: "Actualizar deseos",
    empty: "No hay deseos todavia",
    writeUncertain:
      "No pudimos confirmar el cambio. Revisa los deseos antes de intentarlo de nuevo.",
    statusRefreshFailed:
      "El estado se guardo, pero no pudimos actualizar los deseos.",
    statusFor: (title) => `Estado de ${title}`,
    editItem: (title) => `Editar ${title}`,
    deleteItem: (title) => `Eliminar ${title}`,
    sameNameSection: "Ideas de Same household name",
  },
};

type RouteState = {
  sameName: boolean;
  failNextGet: boolean;
  createFaults: Fault[];
  malformedEdit: boolean;
  writes: Array<{ method: string; path: string; key: string }>;
};

function isWishlistPath(pathname: string): boolean {
  return pathname === "/api/wishlist" || pathname.startsWith("/api/wishlist/");
}

function parseItems(body: string): WishlistItem[] {
  const json = JSON.parse(body) as { items?: unknown };
  expect(Array.isArray(json.items), body).toBe(true);
  return json.items as WishlistItem[];
}

function parseItem(body: string): WishlistItem {
  const json = JSON.parse(body) as { item?: WishlistItem };
  expect(json.item, body).toBeTruthy();
  return json.item!;
}

async function setLocale(context: BrowserContext, locale: Locale) {
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
}

async function installLoopbackGuard(context: BrowserContext) {
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
    if (MUTATING_METHODS.has(request.method())) {
      const allowed =
        (isWishlistPath(url.pathname) &&
          (request.method() !== "PATCH" || isWishlistPath(url.pathname))) ||
        (request.method() === "PATCH" &&
          url.pathname === "/api/family/features") ||
        (request.method() === "POST" && url.pathname === "/api/auth/login");
      if (!allowed) {
        await route.abort();
        return;
      }
    }
    await route.continue();
  });
}

async function installWishlistRoutes(page: Page, state: RouteState) {
  await page.route("**/api/wishlist**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!isWishlistPath(url.pathname)) {
      await route.continue();
      return;
    }

    const key = request.headers()["idempotency-key"] ?? "";
    if (request.method() !== "GET") {
      state.writes.push({
        method: request.method(),
        path: url.pathname,
        key,
      });
    }

    if (request.method() === "GET" && url.pathname === "/api/wishlist") {
      if (state.failNextGet) {
        state.failNextGet = false;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "temporary refresh failure" }),
        });
        return;
      }
      const upstream = await route.fetch();
      if (!state.sameName) {
        await route.fulfill({ response: upstream });
        return;
      }
      const body = JSON.parse(await upstream.text()) as {
        items?: WishlistItem[];
      };
      // The rows and requester ids are real. Only the displayed names are
      // aligned so two distinct household members exercise duplicate-name
      // grouping and aria id safety without creating or mutating a user.
      body.items = (body.items ?? []).map((item) => ({
        ...item,
        requester: { ...item.requester, name: "Same household name" },
      }));
      await route.fulfill({
        response: upstream,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
      return;
    }

    if (
      request.method() === "POST" &&
      url.pathname === "/api/wishlist" &&
      state.createFaults.length
    ) {
      const fault = state.createFaults.shift()!;
      const upstream = await route.fetch();
      if (fault === "lost") {
        await upstream.body();
        await route.abort();
        return;
      }
      if (fault === "409") {
        await route.fulfill({
          response: upstream,
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "IDEMPOTENCY_IN_PROGRESS",
              message: "Please retry this wishlist change.",
              retryable: true,
            },
          }),
        });
        return;
      }
      await route.fulfill({
        response: upstream,
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "RATE_LIMITED",
            message: "Please retry this wishlist change.",
            retryable: true,
          },
        }),
      });
      return;
    }

    if (
      request.method() === "PATCH" &&
      /^\/api\/wishlist\/[^/]+$/.test(url.pathname) &&
      state.malformedEdit
    ) {
      state.malformedEdit = false;
      const upstream = await route.fetch();
      const body = JSON.parse(await upstream.text()) as {
        item?: WishlistItem;
      };
      if (body.item)
        body.item = { ...body.item, title: "Wrong response identity" };
      await route.fulfill({
        response: upstream,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
      return;
    }

    await route.continue();
  });
}

function titleFor(locale: Locale, project: string, role: Role, suffix: string) {
  return `${RUN_PREFIX} ${locale} ${project} ${role} ${suffix}`;
}

async function assertTouchTarget(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  const viewport = page.viewportSize();
  expect(box).toBeTruthy();
  expect(viewport).toBeTruthy();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
}

async function assertPageHealth(
  page: Page,
  info: TestInfo,
  locale: Locale,
  state: string,
) {
  expect(await page.locator("html").getAttribute("lang")).toBe(locale);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const results = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  await info.attach(`wishlist-axe-${locale}-${info.project.name}-${state}`, {
    body: JSON.stringify({ locale, state, blocking, all: results.violations }),
    contentType: "application/json",
  });
  expect(blocking).toEqual([]);
}

async function capture(
  page: Page,
  info: TestInfo,
  locale: Locale,
  state: string,
) {
  await info.attach(`wishlist-${locale}-${info.project.name}-${state}`, {
    body: await page.screenshot({ fullPage: false, animations: "disabled" }),
    contentType: "image/png",
  });
  await info.attach(
    `wishlist-${locale}-${info.project.name}-${state}-metadata`,
    {
      body: JSON.stringify({
        locale,
        project: info.project.name,
        state,
        viewport: page.viewportSize(),
        anchor: E2E_ANCHOR.toISOString(),
      }),
      contentType: "application/json",
    },
  );
}

async function createWish(
  page: Page,
  copy: Copy,
  fields: {
    title: string;
    link: string;
    description: string;
    price: string;
  },
): Promise<WishlistItem> {
  await page.getByRole("button", { name: copy.addWish, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: copy.addWish, exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(copy.title, { exact: false }).fill(fields.title);
  await dialog.getByLabel(copy.link, { exact: true }).fill(fields.link);
  await dialog
    .getByLabel(copy.description, { exact: true })
    .fill(fields.description);
  await dialog.getByLabel(copy.price, { exact: true }).fill(fields.price);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/wishlist",
  );
  await dialog.getByRole("button", { name: copy.save, exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const item = parseItem(await response.text());
  await expect(dialog).toHaveCount(0);
  return item;
}

async function createWishAfterFault(
  page: Page,
  copy: Copy,
  fields: { title: string; link: string; description: string; price: string },
  attempts: number,
): Promise<WishlistItem> {
  await page.getByRole("button", { name: copy.addWish, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: copy.addWish, exact: true });
  await dialog.getByLabel(copy.title, { exact: false }).fill(fields.title);
  await dialog.getByLabel(copy.link, { exact: true }).fill(fields.link);
  await dialog
    .getByLabel(copy.description, { exact: true })
    .fill(fields.description);
  await dialog.getByLabel(copy.price, { exact: true }).fill(fields.price);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await dialog.getByRole("button", { name: copy.save, exact: true }).click();
    if (attempt < attempts - 1)
      await expect(dialog.getByRole("alert")).toContainText(
        copy.writeUncertain,
      );
  }
  await expect(dialog).toHaveCount(0);
  const read = await browserFetch(page, "/api/wishlist");
  expect(read.status, read.body).toBe(200);
  const item = parseItems(read.body).find(
    (entry) => entry.title === fields.title,
  );
  expect(item).toBeTruthy();
  return item!;
}

async function deleteWithKey(page: Page, id: string): Promise<number> {
  return page.evaluate(
    async ({ id, key }) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((cookie) => cookie.startsWith("csrf_token="))
          ?.slice("csrf_token=".length) ?? "";
      const response = await fetch(`/api/wishlist/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Idempotency-Key": key, "X-CSRF-Token": csrf },
      });
      return response.status;
    },
    { id, key: randomUUID() },
  );
}

async function cleanupRunRows(page: Page) {
  const read = await browserFetch(page, "/api/wishlist");
  expect(read.status, read.body).toBe(200);
  const allRows = parseItems(read.body);
  const rows = allRows.filter((item) => item.title.startsWith(RUN_PREFIX));
  expect(
    allRows.filter((item) => !item.title.startsWith(RUN_PREFIX)),
    "The dedicated Wishlist fixture contains unrelated rows; refusing to delete them",
  ).toHaveLength(0);
  for (const row of rows) {
    const status = await deleteWithKey(page, row.id);
    expect(status, `Could not delete owned Wishlist row ${row.id}`).toBe(200);
  }

  const after = await browserFetch(page, "/api/wishlist");
  expect(after.status, after.body).toBe(200);
  const leftovers = parseItems(after.body).filter((item) =>
    item.title.startsWith(RUN_PREFIX),
  );
  expect(leftovers, "Owned Wishlist rows remained after cleanup").toHaveLength(
    0,
  );
}

async function assertDedicatedFixtureBaselineEmpty(page: Page) {
  const read = await browserFetch(page, "/api/wishlist");
  expect(read.status, read.body).toBe(200);
  expect(
    parseItems(read.body),
    "The dedicated Wishlist fixture must start empty; refusing to delete unrelated rows",
  ).toHaveLength(0);
}

async function openRole(
  browser: Browser,
  baseURL: string,
  info: TestInfo,
  locale: Locale,
  role: Exclude<Role, "parent">,
): Promise<{ context: BrowserContext; page: Page }> {
  const projectIndex = [...PROJECTS].indexOf(info.project.name);
  const address =
    200 +
    projectIndex * 4 +
    (locale === "es" ? 1 : 0) +
    (role === "teen" ? 2 : 0);
  const context = await browser.newContext({
    baseURL,
    viewport: info.project.use.viewport,
    deviceScaleFactor: info.project.use.deviceScaleFactor,
    hasTouch: info.project.use.hasTouch,
    isMobile: info.project.use.isMobile,
    timezoneId: "America/Toronto",
    colorScheme: locale === "es" ? "dark" : "light",
    extraHTTPHeaders: { "X-Forwarded-For": `198.51.100.${address}` },
    storageState: role === "child" ? authFile("childA") : authFile("parentA"),
  });
  try {
    await setLocale(context, locale);
    await installLoopbackGuard(context);
    if (role === "teen") {
      const login = await context.request.post("/api/auth/login", {
        data: {
          email: FIXTURE_EMAILS.familyA.teen,
          password: FIXTURE_PASSWORD,
        },
      });
      expect(login.status(), await login.text()).toBe(200);
    }
    const page = await context.newPage();
    await page.clock.install({ time: E2E_ANCHOR });
    return { context, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function assertRoleView(
  page: Page,
  role: Exclude<Role, "parent">,
  locale: Locale,
  ownTitle: string,
  otherTitle: string,
) {
  const copy = COPY[locale];
  await page.goto("/dashboard/wishlist");
  await expect(
    page.getByRole("heading", { level: 1, name: copy.myIdeas, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: copy.pageTitle, exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(ownTitle, { exact: true })).toBeVisible();
  await expect(page.getByText(otherTitle, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: copy.editItem(ownTitle), exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: copy.deleteItem(ownTitle), exact: true }),
  ).toBeVisible();
  await assertTouchTarget(
    page,
    page.getByRole("button", { name: copy.addWish, exact: true }),
  );
  expect(role === "child" || role === "teen").toBe(true);
}

for (const locale of ["en", "es"] as const) {
  test.describe(`${locale} Wishlist release overview`, () => {
    test.use({
      storageState: authFile("parentA"),
      colorScheme: locale === "es" ? "dark" : "light",
    });

    test(`${locale}: real canonical states, roles and responsive recovery`, async ({
      browser,
      context,
      page,
      baseURL,
    }, info) => {
      test.skip(
        !PROJECTS.has(info.project.name),
        "Wishlist evidence runs at the six representative responsive sizes",
      );
      assertFixtureTargetAllowed(process.env);
      expect(LOOPBACK_HOSTS.has(new URL(baseURL!).hostname)).toBe(true);

      const copy = COPY[locale];
      const project = info.project.name;
      const parentTitle = titleFor(locale, project, "parent", "long raw idea");
      const childTitle = titleFor(locale, project, "child", "child idea");
      const teenTitle = titleFor(locale, project, "teen", "teen idea");
      const editedTitle = titleFor(locale, project, "parent", "edited idea");
      const longDescription = `${RUN_PREFIX} ${FIXTURE_LONG_TEXT.description}`;
      const fields = (title: string) => ({
        title,
        link: `https://example.com/wishlist/${RUN_ID}/${encodeURIComponent(title.slice(-18))}`,
        description: longDescription,
        // Keep an explicit zero in the real create/edit journey. The API must
        // preserve it through Decimal serialization instead of treating it as
        // an absent price.
        price: "0",
      });
      const routeState: RouteState = {
        sameName: false,
        failNextGet: false,
        createFaults: [],
        malformedEdit: false,
        writes: [],
      };
      let originalFeatures: FeatureMap | undefined;
      let featureAudit: ((restored: boolean) => Promise<void>) | undefined;
      let featureChanged = false;
      let restored = false;
      let childContext: BrowserContext | undefined;
      let teenContext: BrowserContext | undefined;

      await setLocale(context, locale);
      await installLoopbackGuard(context);
      await installWishlistRoutes(page, routeState);

      try {
        await page.goto("/dashboard");
        const feature = await browserFetch(page, "/api/family/features");
        expect(feature.status, feature.body).toBe(200);
        originalFeatures = JSON.parse(feature.body).features as FeatureMap;
        featureAudit = await ownFeatureAudit(["wishlist"]);
        if (originalFeatures.wishlist !== true) {
          const enabled = await browserSend(
            page,
            "PATCH",
            "/api/family/features",
            {
              features: { ...originalFeatures, wishlist: true },
            },
          );
          expect(enabled.status, enabled.body).toBe(200);
          featureChanged = true;
        }

        await page.goto("/dashboard/wishlist");
        await expect(
          page.getByRole("heading", {
            level: 1,
            name: copy.pageTitle,
            exact: true,
          }),
        ).toBeVisible();
        await cleanupRunRows(page);
        await assertDedicatedFixtureBaselineEmpty(page);
        await page.reload();
        await expect(page.getByText(copy.empty, { exact: true })).toBeVisible();
        await assertTouchTarget(
          page,
          page.getByRole("button", { name: copy.addWish, exact: true }),
        );
        await assertPageHealth(page, info, locale, "empty");
        await capture(page, info, locale, "empty");

        const parent = await createWish(page, copy, fields(parentTitle));
        expect(parent.requested_by).toBe(FIXTURE_IDS.familyA.parent);
        expect(parent.requester.id).toBe(FIXTURE_IDS.familyA.parent);
        expect(parent.approx_price).toBe("0");
        await expect(
          page.getByText(parentTitle, { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText(longDescription, { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("link", {
            name: fields(parentTitle).link,
            exact: true,
          }),
        ).toHaveAttribute("href", fields(parentTitle).link);
        await assertPageHealth(page, info, locale, "populated");
        await capture(page, info, locale, "populated");

        const child = await openRole(browser, baseURL!, info, locale, "child");
        childContext = child.context;
        const childItem = await createWish(
          child.page,
          copy,
          fields(childTitle),
        );
        expect(childItem.requested_by).toBe(FIXTURE_IDS.familyA.child);
        const childRead = await browserFetch(child.page, "/api/wishlist");
        expect(childRead.status, childRead.body).toBe(200);
        expect(
          parseItems(childRead.body).some(
            (item) =>
              item.id === childItem.id &&
              item.requested_by === FIXTURE_IDS.familyA.child,
          ),
        ).toBe(true);
        await assertRoleView(
          child.page,
          "child",
          locale,
          childTitle,
          parentTitle,
        );
        await assertPageHealth(child.page, info, locale, "child");
        await capture(child.page, info, locale, "child");

        const teen = await openRole(browser, baseURL!, info, locale, "teen");
        teenContext = teen.context;
        const teenItem = await createWish(teen.page, copy, fields(teenTitle));
        expect(teenItem.requested_by).toBe(FIXTURE_IDS.familyA.teen);
        const teenRead = await browserFetch(teen.page, "/api/wishlist");
        expect(teenRead.status, teenRead.body).toBe(200);
        expect(
          parseItems(teenRead.body).some(
            (item) =>
              item.id === teenItem.id &&
              item.requested_by === FIXTURE_IDS.familyA.teen,
          ),
        ).toBe(true);
        await assertRoleView(teen.page, "teen", locale, teenTitle, parentTitle);
        await assertPageHealth(teen.page, info, locale, "teen");
        await capture(teen.page, info, locale, "teen");

        routeState.sameName = true;
        await page.reload();
        await expect(
          page.getByText(copy.sameNameSection, { exact: true }),
        ).toHaveCount(3);
        const regions = page.locator('section[aria-labelledby^="wishlist-"]');
        await expect(regions).toHaveCount(3);
        const labels = await regions.evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("aria-labelledby")),
        );
        expect(new Set(labels).size).toBe(3);
        await assertPageHealth(page, info, locale, "same-name-overlay");
        await capture(page, info, locale, "same-name-overlay");

        if (FULL_TRANSPORT_PROJECTS.has(project)) {
          routeState.sameName = false;
          const editButton = page.getByRole("button", {
            name: copy.editItem(parentTitle),
            exact: true,
          });
          await editButton.click();
          const editDialog = page.getByRole("dialog", {
            name: copy.edit,
            exact: true,
          });
          await editDialog
            .getByLabel(copy.title, { exact: false })
            .fill(editedTitle);
          await editDialog
            .getByLabel(copy.link, { exact: true })
            .fill(fields(editedTitle).link);
          await editDialog
            .getByLabel(copy.description, { exact: true })
            .fill(longDescription);
          await editDialog
            .getByLabel(copy.price, { exact: true })
            .fill("43.00");
          routeState.malformedEdit = true;
          await editDialog
            .getByRole("button", { name: copy.save, exact: true })
            .click();
          await expect(editDialog.getByRole("alert")).toContainText(
            copy.writeUncertain,
          );
          await assertPageHealth(page, info, locale, "malformed-response");
          await capture(page, info, locale, "malformed-response");
          await editDialog
            .getByRole("button", { name: copy.save, exact: true })
            .click();
          await expect(editDialog).toHaveCount(0);
          await expect(
            page.getByText(editedTitle, { exact: true }),
          ).toBeVisible();
          const editedRead = await browserFetch(page, "/api/wishlist");
          expect(editedRead.status, editedRead.body).toBe(200);
          expect(
            parseItems(editedRead.body).find((item) => item.id === parent.id)
              ?.approx_price,
          ).toBe("0");

          routeState.failNextGet = true;
          const status = page.getByRole("combobox", {
            name: copy.statusFor(editedTitle),
            exact: true,
          });
          await status.selectOption("received");
          const statusNotice = page
            .getByRole("alert")
            .filter({ hasText: copy.statusRefreshFailed });
          await expect(statusNotice).toBeVisible();
          await assertPageHealth(page, info, locale, "refresh-failed");
          await capture(page, info, locale, "refresh-failed");
          await page
            .getByRole("button", { name: copy.retry, exact: true })
            .click();
          await expect(statusNotice).toHaveCount(0);
          await expect(status).toHaveValue("received");

          const lostTitle = titleFor(
            locale,
            project,
            "parent",
            "lost response",
          );
          routeState.createFaults = ["lost"];
          await createWishAfterFault(page, copy, fields(lostTitle), 2);

          const retryTitle = titleFor(
            locale,
            project,
            "parent",
            "409 then 429",
          );
          routeState.createFaults = ["409", "429"];
          await createWishAfterFault(page, copy, fields(retryTitle), 3);
          const retryWrites = routeState.writes.filter(
            (write) =>
              write.method === "POST" && write.path === "/api/wishlist",
          );
          const retryKeys = retryWrites.slice(-3).map((write) => write.key);
          expect(retryKeys).toHaveLength(3);
          expect(new Set(retryKeys).size).toBe(1);
          expect(retryKeys[0]).toMatch(/^[A-Za-z0-9_-]{16,128}$/);

          const deleteButton = page.getByRole("button", {
            name: copy.deleteItem(editedTitle),
            exact: true,
          });
          await deleteButton.click();
          const deleteDialog = page.getByRole("alertdialog", {
            name: copy.delete,
            exact: true,
          });
          const deleteResponse = page.waitForResponse(
            (response) =>
              response.request().method() === "DELETE" &&
              new URL(response.url()).pathname === `/api/wishlist/${parent.id}`,
          );
          await deleteDialog
            .getByRole("button", { name: copy.delete, exact: true })
            .click();
          expect((await deleteResponse).status()).toBe(200);
          await expect(deleteDialog).toHaveCount(0);
          await expect(
            page.getByText(editedTitle, { exact: true }),
          ).toHaveCount(0);
          await assertPageHealth(page, info, locale, "recovered");
          await capture(page, info, locale, "recovered");

          const editWrites = routeState.writes.filter(
            (write) =>
              write.method === "PATCH" &&
              write.path === `/api/wishlist/${parent.id}`,
          );
          expect(editWrites.length).toBeGreaterThanOrEqual(2);
          expect(new Set(editWrites.map((write) => write.key)).size).toBe(1);
          expect(
            routeState.writes.some(
              (write) => write.method === "DELETE" && write.key,
            ),
          ).toBe(true);
        }

        await assertPageHealth(page, info, locale, "final");
      } finally {
        if (childContext) await childContext.close();
        if (teenContext) await teenContext.close();
        try {
          await cleanupRunRows(page);
        } finally {
          if (originalFeatures && featureChanged) {
            const restore = await browserSend(
              page,
              "PATCH",
              "/api/family/features",
              {
                features: originalFeatures,
              },
            );
            restored = restore.status === 200;
          } else {
            restored = true;
          }
          if (featureAudit) await featureAudit(restored);
        }
      }
    });
  });
}
