/** Real adopted journal + inbox + canonical save. Deliberately outside *.spec.ts:
 * only playwright.review-documents.config.ts selects this opt-in scenario. */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { LOCALE_STORAGE_KEY } from "../../src/i18n";
import { FIXTURE_IDS } from "../../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../../src/lib/fixtures/guard";
import { authFile } from "../support/env";
import { expect, test } from "../support/test";

test.use({ storageState: authFile("parentA") });
const copy = {
  en: {
    manual: "Add groceries manually",
    title: "Title",
    quantity: "Quantity",
    saved: "Reviewed fields saved on this device.",
    restore: "Restore review",
    inbox: "Review inbox",
    capture: "Quick add reviews",
    savedTab: "Saved requests",
    savedType: "Type of saved request",
    checkDevice: "Check this device",
    summary: "Saved quick-add work",
    open: "Open recovery screen",
    add: "Add to groceries",
    check: "Check results",
    retry: "Check and add remaining items",
    present: "Saved and still present",
    finish: "Finish review",
    unknown: "Some requests could not be confirmed.",
    empty:
      "No saved requests of this type were found in the checked stores on this device.",
  },
  es: {
    manual: "Añadir compra manualmente",
    title: "Título",
    quantity: "Cantidad",
    saved: "Campos revisados guardados en este dispositivo.",
    restore: "Restaurar revisión",
    inbox: "Bandeja de revisión",
    capture: "Revisar captura rápida",
    savedTab: "Solicitudes guardadas",
    savedType: "Tipo de solicitud guardada",
    checkDevice: "Consultar este dispositivo",
    summary: "Captura rápida guardada",
    open: "Abrir recuperación",
    add: "Añadir a la compra",
    check: "Consultar resultados",
    retry: "Consultar y añadir lo pendiente",
    present: "Guardado y presente",
    finish: "Finalizar revisión",
    unknown: "No se pudieron confirmar algunas solicitudes.",
    empty:
      "No se encontraron solicitudes de este tipo en los almacenes consultados de este dispositivo.",
  },
} as const;

for (const locale of ["en", "es"] as const) {
  test(`${locale}: owned Capture restores in the inbox and inspects a lost canonical save without duplicating it`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    assertFixtureTargetAllowed(process.env);
    expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
      new URL(baseURL!).hostname,
    );
    const text = copy[locale];
    const title = `E2E adopted capture ${randomUUID()}`;
    const errors: string[] = [];
    const unexpectedWrites: string[] = [];
    const submissions: Array<{
      key: string | undefined;
      sha256: string;
      status: number;
    }> = [];
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    page.on("pageerror", (error) => errors.push(error.message));
    await context.addInitScript(
      ({ key, locale }) => localStorage.setItem(key, locale),
      { key: LOCALE_STORAGE_KEY, locale },
    );
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
        return route.abort();
      if (
        !["GET", "HEAD"].includes(request.method()) &&
        url.pathname !== "/api/review-documents/submit"
      ) {
        unexpectedWrites.push(`${request.method()} ${url.pathname}`);
        return route.abort();
      }
      return route.continue();
    });
    try {
      await page.goto("/dashboard/review?source=capture");
      await expect(
        page.getByRole("heading", { name: text.inbox, exact: true }),
      ).toBeVisible();
      const version = await page.request.get("/api/version");
      expect(version.status()).toBe(200);
      const runtime = await version.json();
      expect(runtime.commit).toBe(
        process.env.RELEASE_SHA ||
          execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
          }).trim(),
      );
      await info.attach("adopted-capture-runtime", {
        body: JSON.stringify(runtime),
        contentType: "application/json",
      });
      const owned = await page.evaluate(async () => {
        const response = await fetch(
          "/api/review-documents/context?domain=capture",
        );
        const body = await response.json();
        return {
          status: response.status,
          adopted: body.adopted,
          enabled: body.enabled,
          hasOwner: !!body.owner,
        };
      });
      expect(owned).toEqual({
        status: 200,
        adopted: true,
        enabled: true,
        hasOwner: true,
      });
      await page
        .getByRole("button", { name: text.manual, exact: true })
        .click();
      await page.getByLabel(text.title, { exact: true }).fill(title);
      await page.getByLabel(text.quantity, { exact: true }).fill("3");
      await expect(page.getByText(text.saved, { exact: true })).toBeVisible();
      // Real sibling navigation retains the editor without showing it in summaries.
      const nav = page.getByRole("navigation", {
        name: text.inbox,
        exact: true,
      });
      await nav.getByRole("link", { name: text.savedTab, exact: true }).click();
      await page
        .getByLabel(text.savedType, { exact: true })
        .selectOption("capture");
      await page
        .getByRole("button", { name: text.checkDevice, exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: text.summary, exact: true }),
      ).toBeVisible();
      // The original editor stays mounted but hidden beneath sibling panes.
      // Only the visible read-only summary is projected by Saved Requests.
      await expect(
        page.getByRole("region", { name: text.savedTab, exact: true }),
      ).not.toContainText(title);
      expect(submissions).toHaveLength(0);
      await nav.getByRole("link", { name: text.capture, exact: true }).click();
      await expect(page.getByLabel(text.title, { exact: true })).toHaveValue(
        title,
      );
      await expect(page.getByLabel(text.quantity, { exact: true })).toHaveValue(
        "3",
      );
      // Reload destroys component state; restoration must come from the owned journal.
      await page.reload();
      await page
        .getByRole("button", { name: text.restore, exact: true })
        .click();
      await expect(page.getByLabel(text.title, { exact: true })).toHaveValue(
        title,
      );
      await expect(page.getByLabel(text.quantity, { exact: true })).toHaveValue(
        "3",
      );
      await page.screenshot({
        path: info.outputPath("restored-owned-capture.png"),
        fullPage: true,
      });
      await page.route("**/api/review-documents/submit", async (route) => {
        const response = await route.fetch(); // Commit through the actual canonical adapter.
        submissions.push({
          key: route.request().headers()["idempotency-key"],
          sha256: createHash("sha256")
            .update(route.request().postData() ?? "")
            .digest("hex"),
          status: response.status(),
        });
        await route.abort("failed"); // Lose only the reply, never fabricate commitment.
      });
      await page.getByRole("button", { name: text.add, exact: true }).click();
      await expect(
        page.getByText(text.unknown, { exact: false }),
      ).toBeVisible();
      expect(submissions).toHaveLength(1);
      expect(submissions[0]!.status).toBe(200);
      expect(submissions[0]!.key).toBeTruthy();
      await page.reload();
      await expect(
        page.getByRole("button", { name: text.check, exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel(text.title, { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: text.retry, exact: true }).click();
      await expect(page.getByText(text.present, { exact: true })).toBeVisible();
      expect(submissions).toHaveLength(1); // Same-save retry inspects the original receipt.
      const rows = await db.query<{ family_id: string; quantity: number }>(
        'SELECT l.family_id, i.quantity FROM "ListItem" i JOIN "List" l ON l.id=i.list_id WHERE i.content=$1',
        [title],
      );
      expect(rows.rows).toEqual([
        { family_id: FIXTURE_IDS.familyA.family, quantity: 3 },
      ]);
      await page.screenshot({
        path: info.outputPath("confirmed-owned-capture.png"),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: text.finish, exact: true })
        .click();
      // Retirement is asynchronous; wait before destroying the original editor.
      await expect(
        page.getByRole("button", { name: text.manual, exact: true }),
      ).toBeEnabled();
      await expect(
        page.getByRole("button", { name: text.check, exact: true }),
      ).toHaveCount(0);
      await page.goto("/dashboard/review?source=saved");
      await page
        .getByLabel(text.savedType, { exact: true })
        .selectOption("capture");
      await page
        .getByRole("button", { name: text.checkDevice, exact: true })
        .click();
      await expect(page.getByText(text.empty, { exact: true })).toBeVisible();
      expect(submissions).toHaveLength(1);
      expect(unexpectedWrites).toEqual([]);
      expect(errors).toEqual([]);
      await info.attach("owned-capture-receipt-proof", {
        body: JSON.stringify({
          locale,
          project: info.project.name,
          submissions,
          canonicalRows: rows.rowCount,
          unknownRecovered: true,
        }),
        contentType: "application/json",
      });
    } finally {
      // Only this fabricated row, only the fixture household; the whole CI DB is disposable.
      await db.query(
        'DELETE FROM "ListItem" WHERE content=$1 AND list_id IN (SELECT id FROM "List" WHERE family_id=$2)',
        [title, FIXTURE_IDS.familyA.family],
      );
      await db.end();
    }
  });
}
