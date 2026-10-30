/** Local transport states; no note records are written by this spec. */
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { test, expect, browserFetch } from "./support/test";
import { authFile } from "./support/env";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { THEME_STORAGE_KEY } from "../src/lib/theme";

let originalFeatures: unknown;
let captured = false;
async function db<T>(fn: (client: pg.Client) => Promise<T>) {
  assertFixtureTargetAllowed(process.env);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
test.use({ storageState: authFile("parentA") });
test.beforeAll(async () => {
  await db(async (client) => {
    const result = await client.query(
      'SELECT features FROM "Family" WHERE id=$1',
      [FIXTURE_IDS.familyA.family],
    );
    expect(result.rowCount).toBe(1);
    originalFeatures = result.rows[0].features;
    captured = true;
    await client.query(
      "UPDATE \"Family\" SET features=COALESCE(features, '{}'::jsonb) || '{\"notes\":true}'::jsonb WHERE id=$1",
      [FIXTURE_IDS.familyA.family],
    );
  });
});
test.afterAll(async () => {
  if (!captured) return;
  await db(async (client) => {
    await client.query('UPDATE "Family" SET features=$1::jsonb WHERE id=$2', [
      originalFeatures === null ? null : JSON.stringify(originalFeatures),
      FIXTURE_IDS.familyA.family,
    ]);
    const result = await client.query(
      'SELECT features FROM "Family" WHERE id=$1',
      [FIXTURE_IDS.familyA.family],
    );
    expect(result.rows[0].features).toEqual(originalFeatures);
  });
});
test.beforeEach(async ({ context, baseURL }) => {
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
    new URL(baseURL!).hostname,
  );
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      ["data:", "blob:"].includes(url.protocol)
      ? route.continue()
      : route.abort();
  });
});

for (const locale of ["en", "es"] as const) {
  test(`${locale}: confirmed writes, failed refresh, offline drafts, malformed/empty and early household recovery`, async ({
    page,
    context,
  }, info) => {
    const copy =
      locale === "en"
        ? {
            add: "Add Note",
            save: "Save",
            cancel: "Cancel",
            retry: "Retry",
            title: "Title",
            loading: "Loading notes...",
            error: "Could not load notes",
            empty: "No notes yet. Add your first one.",
            savedRefresh:
              "Note saved. Refresh the list to see the latest notes.",
            network: "Check your connection and try again.",
            household: "Choose your household",
            create: "Create household",
            join: "Join household",
          }
        : {
            add: "Agregar nota",
            save: "Guardar",
            cancel: "Cancelar",
            retry: "Reintentar",
            title: "Titulo",
            loading: "Cargando notas...",
            error: "No se pudieron cargar las notas",
            empty: "No hay notas todavia. Agrega la primera.",
            savedRefresh:
              "Nota guardada. Actualiza la lista para ver las notas más recientes.",
            network: "Revisa tu conexion e intentalo de nuevo.",
            household: "Elige tu hogar",
            create: "Crear un hogar",
            join: "Unirse a un hogar",
          };
    await page.addInitScript(
      ({ locale, localeKey, themeKey }) => {
        localStorage.setItem(localeKey, locale);
        localStorage.setItem(themeKey, locale === "es" ? "dark" : "light");
      },
      { locale, localeKey: LOCALE_STORAGE_KEY, themeKey: THEME_STORAGE_KEY },
    );
    await page.goto("/dashboard/notes");
    const originalPage = JSON.parse(
      (await browserFetch(page, "/api/notes")).body,
    );
    const before = originalPage.notes;
    const runtime = JSON.parse((await browserFetch(page, "/api/version")).body);
    expect(runtime.commit).toBe(
      execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    );
    await info.attach("actual-notes-runtime", {
      body: JSON.stringify(runtime),
      contentType: "application/json",
    });
    const note = {
      id: "fx_transport_notes_state",
      title: "E2E Notes state",
      body: "Raw {body} 李",
      color: "purple",
      created_at: "2026-01-05T12:00:00.000Z",
      can_edit: true,
      can_delete: true,
    };
    let phase: "valid" | "refresh" | "invalid" | "empty" | "household" =
      "valid";
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let heldResponse: Promise<void> | null = null;
    await page.route(/\/api\/notes(?:\?.*)?$/, (route) => {
      expect(route.request().method()).toBe("GET");
      if (phase === "household") {
        heldResponse = gate.then(() =>
          route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({ error: "You must belong to a family" }),
          }),
        );
        return heldResponse;
      }
      return route.fulfill({
        status: phase === "refresh" ? 503 : 200,
        contentType: "application/json",
        body: JSON.stringify({
          nextCursor: null,
          writeContext: originalPage.writeContext,
          notes:
            phase === "empty"
              ? []
              : [
                  {
                    ...note,
                    color: phase === "invalid" ? "unknown" : note.color,
                  },
                ],
        }),
      });
    });
    const writes: string[] = [];
    await page.route(`**/api/notes/${note.id}`, (route) => {
      writes.push(route.request().method());
      phase = "refresh";
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ note }),
      });
    });
    try {
      await page.reload();
      await page.getByRole("button", { name: note.title, exact: true }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: copy.save, exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
      await expect(page.getByRole("main").getByRole("status")).toHaveText(
        copy.savedRefresh,
      );
      expect(writes).toEqual(["PATCH"]);
      phase = "valid";
      await page.getByRole("button", { name: copy.retry, exact: true }).click();
      await expect(page.getByTestId("note-card")).toHaveCount(1);
      expect(writes).toEqual(["PATCH"]);

      await page.unroute(`**/api/notes/${note.id}`);
      await page.getByRole("button", { name: note.title, exact: true }).click();
      const dialog = page.getByRole("dialog");
      try {
        await context.setOffline(true);
        await dialog
          .getByRole("button", { name: copy.save, exact: true })
          .click();
        await expect(dialog.getByRole("alert")).toContainText(copy.network);
        await expect(
          dialog.getByLabel(copy.title, { exact: true }),
        ).toHaveValue(note.title);
      } finally {
        await context.setOffline(false);
      }
      await dialog
        .getByRole("button", { name: copy.cancel, exact: true })
        .click();

      phase = "invalid";
      await page.reload();
      await expect(
        page.getByRole("heading", { name: copy.error, exact: true }),
      ).toBeVisible();
      await expect(page.getByText(copy.empty, { exact: true })).toHaveCount(0);
      phase = "empty";
      await page.getByRole("button", { name: copy.retry, exact: true }).click();
      await expect(
        page.getByRole("heading", { name: copy.empty, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: copy.add, exact: true }),
      ).toHaveCount(1);

      phase = "household";
      await page.reload();
      await expect(page.getByRole("main").getByRole("status")).toHaveText(
        copy.loading,
      );
      await page.getByRole("button", { name: copy.add, exact: true }).click();
      await page
        .getByRole("dialog")
        .getByLabel(copy.title, { exact: true })
        .fill("Early draft");
      await expect(
        page
          .getByRole("dialog")
          .getByRole("button", { name: copy.save, exact: true }),
      ).toBeDisabled();
      release();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: copy.household, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: copy.add, exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: copy.create, exact: true }),
      ).toHaveAttribute("href", "/dashboard/family/create");
      await expect(
        page.getByRole("link", { name: copy.join, exact: true }),
      ).toHaveAttribute("href", "/join");
      expect(writes).toEqual(["PATCH"]);
      expect(
        (
          await new AxeBuilder({ page })
            .include("main")
            .withTags(["wcag2a", "wcag2aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`notes-household-${locale}.png`),
        fullPage: true,
      });
    } finally {
      release();
      if (heldResponse) await heldResponse;
      await context.setOffline(false);
      await page.unroute(/\/api\/notes(?:\?.*)?$/);
      await page.unroute(`**/api/notes/${note.id}`);
    }
    expect(
      JSON.parse((await browserFetch(page, "/api/notes")).body).notes,
    ).toEqual(before);
  });
}
