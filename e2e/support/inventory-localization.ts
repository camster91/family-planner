/** Isolated #441 data and capture helpers; every record belongs to disposable fixtures. */
import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import pg from "pg";
import { expect, browserFetch } from "./test";
import { E2E_ANCHOR } from "./env";
import {
  FIXTURE_IDS,
  FIXTURE_LEGACY_MEAL_IDS,
} from "../../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../../src/lib/fixtures/guard";
import {
  inventoryMessages,
  type InventoryMessage,
} from "../../src/i18n/inventory";
import {
  isPseudolocaleEnabled,
  pseudolocalizeTemplate,
} from "../../src/i18n/pseudo";
export const expanded = isPseudolocaleEnabled(process.env);
export const A = FIXTURE_IDS.familyA;
export const B = FIXTURE_IDS.familyB;
export const PREFIX = "E2E inventory QA";
export const ITEM = "fx_e2e_i18n_inventory_a";
export const PAST = "fx_e2e_i18n_inventory_past";
export const CANARY = "fx_e2e_i18n_inventory_b";
export const PRIVATE_NAME = `${PREFIX} {name} 李 ${"long farmhouse label ".repeat(5).trim()}`;
export const PRIVATE_UNIT = "raw {unit} 李";
export const SYNTHETIC_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
function anchorDay(offset: number) {
  const day = new Date(E2E_ANCHOR);
  day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0, 10);
}
export function msg(
  locale: "en" | "es",
  key: InventoryMessage,
  params: Record<string, string | number> = {},
) {
  const text = inventoryMessages[locale][key];
  return (expanded ? pseudolocalizeTemplate(text) : text).replace(
    /\{(\w+)\}/g,
    (match, key) => String(params[key] ?? match),
  );
}
export async function withDb<T>(fn: (db: pg.Client) => Promise<T>) {
  assertFixtureTargetAllowed(process.env);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}
export async function cleanRows() {
  await withDb(async (db) => {
    // Only this spec's records; cascades remove this spec's adjustment history.
    await db.query(
      'DELETE FROM "InventoryItem" WHERE family_id IN ($1,$2) AND (id = ANY($3::text[]) OR name LIKE $4)',
      [A.family, B.family, [ITEM, PAST, CANARY], PREFIX + "%"],
    );
    await db.query(
      "DELETE FROM \"IdempotencyRecord\" WHERE family_id IN ($1,$2) AND (action LIKE 'inventory-item.%' OR action = 'inventory-adjustment.undo')",
      [A.family, B.family],
    );
    const day = E2E_ANCHOR.toISOString().slice(0, 10);
    await db.query('DELETE FROM "RateLimitEntry" WHERE key = ANY($1::text[])', [
      [
        `inventory-scan:user:${A.parent}`,
        `inventory-scan:family:${A.family}`,
        `inventory-scan:day:${A.family}:${day}`,
        `inventory-scan:user:${B.parent}`,
        `inventory-scan:family:${B.family}`,
        `inventory-scan:day:${B.family}:${day}`,
      ],
    ]);
  });
}
export async function seedRows() {
  await cleanRows();
  await withDb(async (db) => {
    for (const [id, family, owner, name, location, date, kind] of [
      [
        ITEM,
        A.family,
        A.parent,
        PRIVATE_NAME,
        "fridge",
        anchorDay(1),
        "best_before",
      ],
      [
        PAST,
        A.family,
        A.parent,
        PREFIX + " past safety",
        "fridge",
        anchorDay(-1),
        "use_by",
      ],
      [
        CANARY,
        B.family,
        B.parent,
        PREFIX + " B canary",
        "pantry",
        null,
        "best_before",
      ],
    ])
      await db.query(
        "INSERT INTO \"InventoryItem\" (id,family_id,added_by,name,location,amount,unit,expires_on,date_kind,category) VALUES ($1,$2,$3,$4,$5,2,$6,$7,$8,'produce')",
        [id, family, owner, name, location, PRIVATE_UNIT, date, kind],
      );
    await db.query('UPDATE "InventoryItem" SET ingredient_id=$2 WHERE id=$1', [
      ITEM,
      FIXTURE_LEGACY_MEAL_IDS.familyA.ingredientTomatoes,
    ]);
  });
}
export async function guardContext(
  context: BrowserContext,
  baseURL: string,
  locale: "en" | "es",
) {
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
export async function runtime(
  page: Page,
  info: TestInfo,
  locale: "en" | "es",
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
  const version = await browserFetch(page, "/api/version");
  expect(version.status).toBe(200);
  const actual = JSON.parse(version.body);
  if (process.env.RELEASE_SHA)
    expect(actual.commit).toBe(process.env.RELEASE_SHA);
  await info.attach("actual-runtime-role-mode", {
    body: JSON.stringify({
      runtime: actual,
      role,
      locale,
      expanded,
      scanTransport:
        "guarded synthetic fixed-endpoint server; no real provider",
    }),
    contentType: "application/json",
  });
}
export function scope(page: Page) {
  return page.getByTestId("inventory-notice").locator("..");
}
export async function capture(
  page: Page,
  info: TestInfo,
  name: string,
  targets: Locator[] = [],
) {
  for (const target of targets) {
    await target.evaluate((el) =>
      el.scrollIntoView({ block: "center", inline: "nearest" }),
    );
    const input = (await target.evaluate((el) => el.tagName === "LABEL"))
      ? target.locator("input")
      : target;
    await input.focus();
    await expect(input).toBeFocused();
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
  const active = page.getByTestId("scan-dialog");
  const modal = page.getByTestId("inventory-modal");
  const selector = (await active.count())
    ? '[data-testid="scan-dialog"]'
    : (await modal.count())
      ? '[data-testid="inventory-modal"]'
      : '[data-testid="inventory-notice"]';
  // The ordinary page includes every owned region rather than unrelated dashboard chrome.
  const owned =
    selector === '[data-testid="inventory-notice"]'
      ? scope(page)
      : page.locator(selector);
  await owned.evaluate((el) => el.setAttribute("data-inventory-qa-scope", ""));
  const toast = page.getByTestId("undo-toast");
  if (await toast.count())
    await toast.evaluate((el) =>
      el.setAttribute("data-inventory-qa-scope", ""),
    );
  const violations = (
    await new AxeBuilder({ page })
      .include("[data-inventory-qa-scope]")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze()
  ).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  await info.attach(name + "-axe", {
    body: JSON.stringify(violations),
    contentType: "application/json",
  });
  expect(violations).toEqual([]);
  await page.screenshot({
    path: info.outputPath(name + ".png"),
    fullPage: false,
    animations: "disabled",
  });
  await owned.evaluate((el) => el.removeAttribute("data-inventory-qa-scope"));
  if (await toast.count())
    await toast.evaluate((el) => el.removeAttribute("data-inventory-qa-scope"));
}
