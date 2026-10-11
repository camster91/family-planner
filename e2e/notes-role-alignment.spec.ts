/**
 * Notes D9 role alignment (#499 / #102).
 *
 * This is a guarded rendered/API journey for the person-session Notes page.
 * It owns only the four synthetic notes below and restores Family A's feature
 * blob. The shared device deliberately gets no person-session note route.
 */
import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
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
const NOTE_TITLES = {
  parent: `${NOTE_TITLE_PREFIX} parent-owned`,
  teen: `${NOTE_TITLE_PREFIX} teen-owned`,
  child: `${NOTE_TITLE_PREFIX} child-owned`,
  foreign: `${NOTE_TITLE_PREFIX} Family B`,
} as const;

type Locale = "en" | "es";
type Role = "parent" | "teen" | "child";
type Who = "parentA" | "teenA" | "childA" | "parentB";

const COPY: Record<
  Locale,
  { title: string; add: string; save: string; cancel: string; delete: string }
> = {
  en: {
    title: "Notes",
    add: "Add Note",
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
  },
  es: {
    title: "Notas",
    add: "Agregar nota",
    save: "Guardar",
    cancel: "Cancelar",
    delete: "Eliminar",
  },
};

let originalFeatures: unknown;

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
     WHERE id = ANY($1::text[]) OR title LIKE $2`,
    [Object.values(NOTE_IDS), `${NOTE_TITLE_PREFIX}%`],
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
       VALUES ($1, $2, $3, $4, 'yellow', $5, $6)`,
      [id, familyId, title, `${title} body`, createdBy, createdAt],
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
  await guardContext(context, use.baseURL!);
  await configurePresentation(context, locale);
  if (who === "teenA") {
    const login = await context.request.post("/api/auth/login", {
      data: { email: FIXTURE_EMAILS.familyA.teen, password: FIXTURE_PASSWORD },
    });
    expect(login.status(), await login.text()).toBe(200);
  }
  const page = await context.newPage();
  await page.clock.install({ time: E2E_ANCHOR });
  return { context, page };
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
    await seedNotes(db);
  });
});

test.afterAll(async () => {
  await withDb(async (db) => {
    await cleanupNotes(db);
    await restoreFeatures(db);
  });
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
        await dialog
          .getByRole("button", { name: copy.cancel, exact: true })
          .click();

        if (role !== "parent") {
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
    const deleted = await browserSend(
      parent.page,
      "DELETE",
      `/api/notes/${encodeURIComponent(id)}`,
      { id },
    );
    expect(deleted.status, deleted.body).toBe(200);
    expect((await browserFetch(parent.page, "/api/notes")).body).not.toContain(
      id,
    );

    await visitNotes(familyB.page, "en");
    const familyBNotes = await notesBody(familyB.page);
    expect(familyBNotes.notes.map((note) => note.id)).toEqual([
      NOTE_IDS.foreign,
    ]);
    expect(JSON.stringify(familyBNotes)).not.toContain(NOTE_TITLES.parent);
    expect(
      (
        await browserSend(
          familyB.page,
          "PATCH",
          `/api/notes/${NOTE_IDS.parent}`,
          {
            id: NOTE_IDS.parent,
            title: `${NOTE_TITLE_PREFIX} cross-household edit`,
          },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await browserSend(
          familyB.page,
          "DELETE",
          `/api/notes/${NOTE_IDS.parent}`,
          {
            id: NOTE_IDS.parent,
          },
        )
      ).status,
    ).toBe(404);
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
    // Feature metadata currently uses the canonical English feature title in
    // both locales; route-owned buttons remain localized when the feature is on.
    await expect(
      opened.page.getByRole("heading", { name: "Notes is off", level: 2 }),
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
    await restoreFeatures();
  }
  await opened.context.close();
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
    storageState: { cookies: [], origins: [] },
  });
  try {
    await guardContext(context, baseURL!);
    await context.addCookies([
      { name: "fp_device", value: "fpd1_a_synthetic-invalid", url: baseURL! },
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
    expect(apiResponse.status()).toBe(401);
  } finally {
    await context.close();
  }
});
