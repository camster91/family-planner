/**
 * Notes D9 role alignment (#499 / #102).
 *
 * This is a guarded rendered/API journey for the person-session Notes page.
 * It owns only the four synthetic notes below and restores Family A's feature
 * blob. The shared device deliberately gets no person-session note route.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { hashDeviceToken } from "../src/lib/device-session";
import pg from "pg";
import {
  FIXTURE_EMAILS,
  FIXTURE_IDS,
  FIXTURE_PASSWORD,
} from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { E2E_ANCHOR, E2E_BASE_URL, authFile } from "./support/env";
import { browserFetch, browserSend, expect, test } from "./support/test";

const A = FIXTURE_IDS.familyA;
const B = FIXTURE_IDS.familyB;
const PROJECTS = [
  "phone-390x844",
  "phone-430x932",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
  "tablet-large-1920x1200",
  "desktop-1366x768",
] as const;

const NOTE_IDS = {
  parent: "fx_e2e_notes_parent",
  teen: "fx_e2e_notes_teen",
  child: "fx_e2e_notes_child",
  foreign: "fx_e2e_notes_foreign",
} as const;
const NOTE_TITLE_PREFIX = "E2E Notes D9";
const LONG_NOTE_BODY =
  "Shared household information ".repeat(70) + "\nFinal shared line.";
const NOTES_DEVICE_ID = "fx_e2e_notes_device";
const NOTES_DEVICE_ACCESS = "fpd1_a_e2e_notes_valid";
const NOTES_DEVICE_REFRESH = "fpd1_r_e2e_notes_valid";
const NOTE_FAMILIES = [A.family, B.family] as const;
const NOTE_OWNERS = [A.parent, A.teen, A.child, B.parent] as const;
const NOTE_TITLES = {
  parent: `${NOTE_TITLE_PREFIX} parent-owned`,
  teen: `${NOTE_TITLE_PREFIX} teen-owned`,
  child: `${NOTE_TITLE_PREFIX} child-owned`,
  foreign: `${NOTE_TITLE_PREFIX} Family B`,
} as const;

type Locale = "en" | "es";
type Role = "parent" | "teen" | "child";
type Who = "parentA" | "teenA" | "childA" | "parentB";
type NoteCopy = {
  title: string;
  titleLabel: string;
  add: string;
  retry: string;
  loading: string;
  save: string;
  cancel: string;
  delete: string;
  colors: readonly string[];
};

const COPY: Record<Locale, NoteCopy> = {
  en: {
    title: "Notes",
    titleLabel: "Title",
    add: "Add Note",
    retry: "Retry",
    loading: "Loading notes...",
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
    colors: ["Yellow", "Pink", "Blue", "Green", "Purple"],
  },
  es: {
    title: "Notas",
    titleLabel: "Titulo",
    add: "Agregar nota",
    retry: "Reintentar",
    loading: "Cargando notas...",
    save: "Guardar",
    cancel: "Cancelar",
    delete: "Eliminar",
    colors: ["Amarillo", "Rosa", "Azul", "Verde", "Morado"],
  },
};

let originalFeatures: unknown;
let originalFeaturesCaptured = false;

async function withDb<T>(fn: (db: pg.Client) => Promise<T>): Promise<T> {
  assertFixtureTargetAllowed(process.env);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

async function restoreFeatures(db?: pg.Client) {
  if (!originalFeaturesCaptured) {
    throw new Error("Notes fixture original feature state was not captured");
  }
  const run = async (client: pg.Client) => {
    await client.query(
      `UPDATE "Family" SET features = $1::jsonb WHERE id = $2`,
      [
        originalFeatures === null ? null : JSON.stringify(originalFeatures),
        A.family,
      ],
    );
  };
  if (db) return run(db);
  return withDb(run);
}

async function seedSharedDevice(db: pg.Client) {
  await cleanupSharedDevice(db);
  await db.query(
    `INSERT INTO "HouseholdDevice" (id, family_id, label, platform, created_by, confirmed_by, paired_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'web', $4, $4, $5, $5, $5)`,
    [NOTES_DEVICE_ID, A.family, "Notes fixture tablet", A.parent, E2E_ANCHOR],
  );
  await db.query(
    `INSERT INTO "DeviceSession" (id, device_id, family_id, access_token_hash, refresh_token_hash, access_expires_at, refresh_expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      `${NOTES_DEVICE_ID}_session`,
      NOTES_DEVICE_ID,
      A.family,
      hashDeviceToken(NOTES_DEVICE_ACCESS),
      hashDeviceToken(NOTES_DEVICE_REFRESH),
      new Date(E2E_ANCHOR.getTime() + 60 * 60 * 1000),
      new Date(E2E_ANCHOR.getTime() + 30 * 24 * 60 * 60 * 1000),
      E2E_ANCHOR,
    ],
  );
}

async function cleanupSharedDevice(db: pg.Client) {
  await db.query(`DELETE FROM "HouseholdDevice" WHERE id = $1`, [
    NOTES_DEVICE_ID,
  ]);
}

async function setNotesFeature(enabled: boolean) {
  await withDb((db) =>
    db.query(
      `UPDATE "Family"
       SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object('notes', $1::boolean)
       WHERE id = $2`,
      [enabled, A.family],
    ),
  );
}

async function cleanupNotes(db: pg.Client) {
  await db.query(
    `DELETE FROM "PinnedNote"
     WHERE id = ANY($1::text[])
        OR (title LIKE $2 AND family_id = ANY($3::text[]) AND created_by = ANY($4::text[]))`,
    [
      Object.values(NOTE_IDS),
      `${NOTE_TITLE_PREFIX}%`,
      NOTE_FAMILIES,
      NOTE_OWNERS,
    ],
  );
}

async function seedNotes(db: pg.Client) {
  await cleanupNotes(db);
  const createdAt = E2E_ANCHOR.toISOString();
  const rows = [
    [NOTE_IDS.parent, A.family, NOTE_TITLES.parent, A.parent],
    [NOTE_IDS.teen, A.family, NOTE_TITLES.teen, A.teen],
    [NOTE_IDS.child, A.family, NOTE_TITLES.child, A.child],
    [NOTE_IDS.foreign, B.family, NOTE_TITLES.foreign, B.parent],
  ] as const;
  for (const [id, familyId, title, createdBy] of rows) {
    await db.query(
      `INSERT INTO "PinnedNote" (id, family_id, title, body, color, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        familyId,
        title,
        `${title} body\n${LONG_NOTE_BODY}`,
        id === NOTE_IDS.parent
          ? "green"
          : id === NOTE_IDS.teen
            ? "purple"
            : "yellow",
        createdBy,
        createdAt,
      ],
    );
  }
}

async function guardContext(context: BrowserContext, baseURL: string) {
  assertFixtureTargetAllowed(process.env);
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
    new URL(baseURL).hostname,
  );
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      ["data:", "blob:"].includes(url.protocol)
      ? route.continue()
      : route.abort();
  });
}

async function configurePresentation(context: BrowserContext, locale: Locale) {
  await context.addInitScript(
    ({ locale: language, localeKey, themeKey }) => {
      localStorage.setItem(localeKey, language);
      localStorage.setItem(themeKey, language === "es" ? "dark" : "light");
    },
    {
      locale,
      localeKey: LOCALE_STORAGE_KEY,
      themeKey: "familyPlanner_theme_v2",
    },
  );
}

/** Open a fixture identity while keeping the teen login inside the guarded context. */
async function openAs(
  browser: Browser,
  testInfo: TestInfo,
  who: Who,
  locale: Locale,
): Promise<{ context: BrowserContext; page: Page }> {
  const use = testInfo.project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport,
    deviceScaleFactor: use.deviceScaleFactor,
    hasTouch: use.hasTouch,
    isMobile: use.isMobile,
    locale: locale === "es" ? "es-ES" : "en-US",
    timezoneId: use.timezoneId,
    colorScheme: locale === "es" ? "dark" : "light",
    reducedMotion: "reduce",
    extraHTTPHeaders: use.extraHTTPHeaders,
    storageState:
      who === "teenA" || who === "parentB"
        ? authFile(who === "parentB" ? "parentB" : "parentA")
        : authFile(who),
  });
  try {
    await guardContext(context, use.baseURL!);
    await configurePresentation(context, locale);
    if (who === "teenA") {
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
    try {
      await context.close();
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        "Notes identity setup and context cleanup failed",
      );
    }
    throw error;
  }
}

async function visitNotes(page: Page, locale: Locale) {
  const copy = COPY[locale];
  await page.goto("/dashboard/notes");
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  if (locale === "es") {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  } else {
    await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  }
  await expect(
    page.getByRole("heading", { name: copy.title, level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: copy.add, exact: true }),
  ).toBeVisible();
}

async function notesBody(page: Page) {
  const response = await browserFetch(page, "/api/notes");
  expect(response.status, response.body).toBe(200);
  return JSON.parse(response.body) as {
    notes: Array<{
      id: string;
      title: string;
      body: string;
      can_edit?: boolean;
      can_delete?: boolean;
    }>;
  };
}

function roleFor(who: Who): Role {
  return who === "parentA" || who === "parentB"
    ? "parent"
    : who === "teenA"
      ? "teen"
      : "child";
}

function titleFor(role: Role) {
  return NOTE_TITLES[role];
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await withDb(async (db) => {
    const current = await db.query(
      `SELECT features FROM "Family" WHERE id = $1`,
      [A.family],
    );
    expect(current.rows).toHaveLength(1);
    originalFeatures = current.rows[0].features;
    originalFeaturesCaptured = true;
    await seedNotes(db);
    await seedSharedDevice(db);
  });
});

test.afterAll(async () => {
  const errors: Error[] = [];
  const attempt = async (label: string, work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      errors.push(
        new Error(
          `${label}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  };
  await attempt("Notes fixture cleanup", () =>
    withDb(async (db) => {
      await cleanupNotes(db);
    }),
  );
  await attempt("Notes device cleanup", () =>
    withDb(async (db) => {
      await cleanupSharedDevice(db);
    }),
  );
  await attempt("Notes feature restoration", () => restoreFeatures());
  if (errors.length > 0) {
    throw new AggregateError(errors, "Notes D9 E2E cleanup failed");
  }
});

test.beforeEach(async ({}, testInfo) => {
  test.skip(
    !PROJECTS.includes(testInfo.project.name as (typeof PROJECTS)[number]),
    "Notes D9 alignment runs at all six representative responsive sizes",
  );
  await withDb(async (db) => {
    await restoreFeatures(db);
    await seedNotes(db);
  });
});

for (const locale of ["en", "es"] as const) {
  test(`${locale}: parent, teen and child read/create/edit their own notes with bounded controls`, async ({
    browser,
  }, info) => {
    for (const who of ["parentA", "teenA", "childA"] as const) {
      const { context, page } = await openAs(browser, info, who, locale);
      const role = roleFor(who);
      const copy = COPY[locale];
      try {
        await visitNotes(page, locale);
        const body = await notesBody(page);
        expect(body.notes.map((note) => note.id)).not.toContain(
          NOTE_IDS.foreign,
        );
        expect(JSON.stringify(body)).not.toContain(NOTE_TITLES.foreign);

        await expect(page.getByTestId("note-card")).toHaveCount(
          body.notes.length,
        );
        await expect(
          page.getByRole("button", { name: copy.add, exact: true }),
        ).toHaveCount(1);
        const width = await page.getByTestId("notes-workspace").boundingBox();
        expect(width!.width).toBeGreaterThanOrEqual(
          info.project.use.viewport!.width - 72,
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          ),
        ).toBeLessThanOrEqual(0);
        for (const preview of await page
          .getByTestId("note-card")
          .locator("p")
          .all()) {
          const geometry = await preview.evaluate((node) => ({
            height: node.clientHeight,
            lineHeight: Number.parseFloat(getComputedStyle(node).lineHeight),
          }));
          expect(
            geometry.height,
            "A preview must fit three lines rather than clipping inside its card",
          ).toBeLessThanOrEqual(geometry.lineHeight * 3 + 1);
        }
        expect(
          (
            await new AxeBuilder({ page })
              .include("main")
              .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
              .analyze()
          ).violations,
        ).toEqual([]);
        await page.screenshot({
          path: info.outputPath(`notes-${who}-${locale}.png`),
          fullPage: true,
          animations: "disabled",
        });

        if (info.project.use.viewport!.width < 768) {
          await page.evaluate(() =>
            window.scrollTo(0, document.documentElement.scrollHeight),
          );
          const bar = await page.locator("nav.tab-bar").boundingBox();
          expect(bar).not.toBeNull();
          for (const launcher of await page
            .locator("[data-person-assistant] > button")
            .all()) {
            await launcher.focus();
            const box = await launcher.boundingBox();
            expect(box!.y).toBeGreaterThanOrEqual(64);
            expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y - 8);
            expect(box!.width).toBeGreaterThanOrEqual(44);
            expect(box!.height).toBeGreaterThanOrEqual(44);
            expect(
              await launcher.evaluate((button) => {
                const rect = button.getBoundingClientRect();
                return button.contains(
                  document.elementFromPoint(
                    rect.x + rect.width / 2,
                    rect.y + rect.height / 2,
                  ),
                );
              }),
            ).toBe(true);
          }
          await page.screenshot({
            path: info.outputPath(`notes-footer-${who}-${locale}.png`),
            fullPage: false,
            animations: "disabled",
          });
        }

        const own = body.notes.find((note) => note.id === NOTE_IDS[role]);
        const parent = body.notes.find((note) => note.id === NOTE_IDS.parent);
        expect(own).toMatchObject({
          can_edit: true,
          can_delete: role === "parent",
        });
        expect(parent).toMatchObject({
          can_edit: role === "parent",
          can_delete: role === "parent",
        });

        const created = await browserSend(page, "POST", "/api/notes", {
          title: `${NOTE_TITLE_PREFIX} ${role} created`,
          body: "Synthetic owned note",
          color: "yellow",
        });
        expect(created.status, created.body).toBe(201);
        const createdId = (JSON.parse(created.body) as { note: { id: string } })
          .note.id;
        const edited = await browserSend(
          page,
          "PATCH",
          `/api/notes/${encodeURIComponent(createdId)}`,
          {
            id: createdId,
            title: `${NOTE_TITLE_PREFIX} ${role} edited`,
            body: "Synthetic owned edit",
          },
        );
        expect(edited.status, edited.body).toBe(200);

        const ownCard = page.locator(
          `[role="button"][aria-label="${titleFor(role)}"]`,
        );
        await expect(ownCard).toHaveCount(1);
        const parentCard = page.locator(
          `[role="button"][aria-label="${NOTE_TITLES.parent}"]`,
        );
        await expect(parentCard).toHaveCount(role === "parent" ? 1 : 0);
        await ownCard.click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByRole("button", { name: copy.save, exact: true }),
        ).toBeVisible();
        await expect(
          dialog.getByRole("button", { name: copy.delete, exact: true }),
        ).toHaveCount(role === "parent" ? 1 : 0);
        for (const color of copy.colors) {
          await expect(
            dialog.getByRole("button", { name: color, exact: true }),
          ).toBeVisible();
        }
        await dialog
          .getByRole("button", { name: copy.cancel, exact: true })
          .click();

        if (role !== "parent") {
          const readLabel = locale === "es" ? "Leer nota" : "Read note";
          const readOpener = page.getByRole("button", {
            name: `${readLabel}: ${NOTE_TITLES.parent}`,
            exact: true,
          });
          const target = await readOpener.boundingBox();
          expect(target!.height).toBeGreaterThanOrEqual(44);
          expect(target!.width).toBeGreaterThanOrEqual(44);
          await readOpener.press("Enter");
          const readDialog = page.getByRole("dialog", {
            name: NOTE_TITLES.parent,
            exact: true,
          });
          await expect(
            readDialog.getByText(parent!.body, { exact: true }),
          ).toBeVisible();
          await expect(readDialog.locator("input, textarea")).toHaveCount(0);
          await expect(
            readDialog.getByRole("button", { name: copy.save, exact: true }),
          ).toHaveCount(0);
          await expect(
            readDialog.getByRole("button", { name: copy.delete, exact: true }),
          ).toHaveCount(0);
          expect(
            (
              await new AxeBuilder({ page })
                .include('[role="dialog"]')
                .withTags(["wcag2a", "wcag2aa"])
                .analyze()
            ).violations,
          ).toEqual([]);
          await page.keyboard.press("Escape");
          await expect(readDialog).toHaveCount(0);
          await expect(readOpener).toBeFocused();
          const forbiddenEdit = await browserSend(
            page,
            "PATCH",
            `/api/notes/${NOTE_IDS.parent}`,
            {
              id: NOTE_IDS.parent,
              title: `${NOTE_TITLE_PREFIX} forbidden edit`,
            },
          );
          expect(forbiddenEdit.status).toBe(403);
          const forbiddenDelete = await browserSend(
            page,
            "DELETE",
            `/api/notes/${NOTE_IDS[role]}`,
            {
              id: NOTE_IDS[role],
            },
          );
          expect(forbiddenDelete.status).toBe(403);
        }
      } finally {
        await context.close();
      }
    }
  });

  test(`${locale}: failed Notes load has a keyboard retry and touch-sized color controls`, async ({
    browser,
  }, info) => {
    const { context, page } = await openAs(browser, info, "parentA", locale);
    const copy = COPY[locale];
    let releaseRetry: (() => void) | undefined;
    const retryGate = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    let getAttempts = 0;
    try {
      await page.route("**/api/notes", async (route) => {
        if (route.request().method() !== "GET") {
          await route.continue();
          return;
        }
        getAttempts += 1;
        if (getAttempts === 1) {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "synthetic temporary failure" }),
          });
          return;
        }
        if (getAttempts === 2) await retryGate;
        await route.continue();
      });

      await visitNotes(page, locale);
      await expect(
        page.getByRole("button", { name: copy.retry, exact: true }),
      ).toBeVisible();
      const retry = page.getByTestId("notes-retry");
      await retry.focus();
      await page.keyboard.press("Enter");
      await expect(retry).toBeDisabled();
      await expect(retry).toHaveAttribute("aria-busy", "true");
      await expect(retry).toHaveAccessibleName(copy.loading);
      expect(getAttempts).toBe(2);
      releaseRetry?.();
      releaseRetry = undefined;
      await expect(
        page.locator(`[role="button"][aria-label="${NOTE_TITLES.parent}"]`),
      ).toBeVisible();
      await expect(page.getByTestId("notes-retry")).toHaveCount(0);

      const parentCard = page.locator(
        `[role="button"][aria-label="${NOTE_TITLES.parent}"]`,
      );
      await parentCard.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByLabel(copy.titleLabel, { exact: true }),
      ).toHaveValue(NOTE_TITLES.parent);

      const pink = dialog.getByRole("button", {
        name: copy.colors[1],
        exact: true,
      });
      await expect(pink).toHaveAttribute("aria-pressed", "false");
      await pink.focus();
      await page.keyboard.press("Space");
      await expect(pink).toHaveAttribute("aria-pressed", "true");
      const box = await pink.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    } finally {
      releaseRetry?.();
      await context.close();
    }
  });
}

test("parent delete remains available while Family B cannot cross household boundaries", async ({
  browser,
}, info) => {
  test.skip(
    info.project.name !== "desktop-1366x768",
    "API/privacy boundary proof runs once at desktop size",
  );
  const parent = await openAs(browser, info, "parentA", "en");
  const familyB = await openAs(browser, info, "parentB", "en");
  try {
    await visitNotes(parent.page, "en");
    const created = await browserSend(parent.page, "POST", "/api/notes", {
      title: `${NOTE_TITLE_PREFIX} parent delete`,
      body: "Synthetic deletion candidate",
      color: "yellow",
    });
    expect(created.status, created.body).toBe(201);
    const id = (JSON.parse(created.body) as { note: { id: string } }).note.id;
    await visitNotes(parent.page, "en");
    await parent.page
      .getByRole("button", {
        name: `${NOTE_TITLE_PREFIX} parent delete`,
        exact: true,
      })
      .click();
    const reply = parent.page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        new URL(response.url()).pathname ===
          `/api/notes/${encodeURIComponent(id)}`,
    );
    await parent.page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    const deleted = await reply;
    expect(deleted.status(), await deleted.text()).toBe(200);
    await expect(parent.page.getByRole("dialog")).toHaveCount(0);
    await expect(
      parent.page.getByRole("heading", { name: "Notes", level: 1 }),
    ).toBeFocused();
    expect((await browserFetch(parent.page, "/api/notes")).body).not.toContain(
      id,
    );

    await visitNotes(familyB.page, "en");
    const familyBNotes = await notesBody(familyB.page);
    expect(familyBNotes.notes.map((note) => note.id)).toEqual([
      NOTE_IDS.foreign,
    ]);
    expect(JSON.stringify(familyBNotes)).not.toContain(NOTE_TITLES.parent);
    const crossHouseholdEdit = await browserSend(
      familyB.page,
      "PATCH",
      `/api/notes/${NOTE_IDS.parent}`,
      {
        id: NOTE_IDS.parent,
        title: `${NOTE_TITLE_PREFIX} cross-household edit`,
      },
    );
    expect(crossHouseholdEdit.status).toBe(403);
    const crossHouseholdDelete = await browserSend(
      familyB.page,
      "DELETE",
      `/api/notes/${NOTE_IDS.parent}`,
      {
        id: NOTE_IDS.parent,
      },
    );
    expect(crossHouseholdDelete.status).toBe(403);
    const parentNotesAfter = await notesBody(parent.page);
    expect(
      parentNotesAfter.notes.find((note) => note.id === NOTE_IDS.parent),
    ).toMatchObject({
      id: NOTE_IDS.parent,
      title: NOTE_TITLES.parent,
    });
  } finally {
    await parent.context.close();
    await familyB.context.close();
  }
});

test("feature-off keeps Notes locked and refuses reads and writes", async ({
  browser,
}, info) => {
  test.skip(
    info.project.name !== "desktop-1366x768",
    "Feature-off boundary proof runs once at desktop size",
  );
  const opened = await openAs(browser, info, "parentA", "en");
  try {
    await setNotesFeature(false);
    await opened.page.goto("/dashboard/notes");
    await expect(
      opened.page.getByRole("heading", {
        name: "Pinned notes is off",
        level: 1,
      }),
    ).toBeVisible();
    await expect(
      opened.page.getByRole("button", { name: "Add Note", exact: true }),
    ).toHaveCount(0);
    expect((await browserFetch(opened.page, "/api/notes")).status).toBe(403);
    expect(
      (
        await browserSend(opened.page, "POST", "/api/notes", {
          title: `${NOTE_TITLE_PREFIX} blocked`,
          body: "Should not be written",
          color: "yellow",
        })
      ).status,
    ).toBe(403);
  } finally {
    const errors: Error[] = [];
    try {
      await restoreFeatures();
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
    try {
      await opened.context.close();
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Notes feature-off cleanup failed");
    }
  }
});

test("shared-device cookies cannot enter the person Notes route or API", async ({
  browser,
  baseURL,
}, info) => {
  test.skip(
    info.project.name !== "desktop-1366x768",
    "Shared-device exclusion proof runs once at desktop size",
  );
  const context = await browser.newContext({
    baseURL,
    storageState: authFile("parentA"),
  });
  try {
    await guardContext(context, baseURL!);
    await context.addCookies([
      { name: "fp_device", value: NOTES_DEVICE_ACCESS, url: baseURL! },
    ]);
    const pageResponse = await context.request.get(
      `${baseURL}/dashboard/notes`,
      { maxRedirects: 0 },
    );
    expect([307, 308]).toContain(pageResponse.status());
    expect(new URL(pageResponse.headers().location!, baseURL).pathname).toBe(
      "/device/today",
    );
    const apiResponse = await context.request.get(`${baseURL}/api/notes`);
    expect(apiResponse.status()).toBe(403);
    expect((await apiResponse.json()).error.code).toBe(
      "DEVICE_WRITE_NOT_ALLOWED",
    );
  } finally {
    await context.close();
  }
});
