/**
 * #499 Sick days sheets: localized parent form and recovery proof.
 *
 * Sick-day and medication records are synthetic browser responses. The real
 * fixture is used only for authenticated parent identity and the reversible
 * sick-days feature toggle; every clinical mutation is held or fulfilled by
 * the browser route and the loopback guard blocks any unhandled write.
 */
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { authFile } from "./support/env";
import { ownFeatureAudit } from "./support/feature-audit";
import { browserFetch, browserSend, expect, test } from "./support/test";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const REPRESENTATIVE_PROJECTS = new Set(["phone-390x844", "desktop-1366x768"]);
const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const FEATURE_PATCH = "PATCH /api/family/features";

const COPY = {
  en: {
    title: "Sick days & medications",
    start: "Start a sick day",
    addMedication: "Add medication",
    markDose: "Mark dose taken",
    name: "Name",
    person: "Person",
    selectPerson: "Select a person",
    symptoms: "Symptoms",
    save: "Save",
    cancel: "Cancel",
    closeForm: "Close sick-day form",
    medicationsFailed:
      "Medication details are temporarily unavailable. Try again to refresh them.",
    authFailed:
      "Couldn’t verify your account. Actions are disabled until you try again.",
    tryAgain: "Try again",
    startFailed: "Couldn’t start the sick day",
  },
  es: {
    title: "Dias de enfermedad y medicamentos",
    start: "Iniciar dia de enfermedad",
    addMedication: "Agregar medicamento",
    markDose: "Marcar dosis tomada",
    name: "Nombre",
    person: "Persona",
    selectPerson: "Seleccionar persona",
    symptoms: "Sintomas",
    save: "Guardar",
    cancel: "Cancelar",
    closeForm: "Cerrar formulario de enfermedad",
    medicationsFailed:
      "Los detalles de los medicamentos no están disponibles temporalmente. Intenta actualizar de nuevo.",
    authFailed:
      "No se pudo verificar tu cuenta. Las acciones están desactivadas hasta que lo intentes de nuevo.",
    tryAgain: "Intentar de nuevo",
    startFailed: "No se pudo iniciar el día de enfermedad",
  },
} as const;

const FAMILY = FIXTURE_IDS.familyA;
const LONG_PERSON_NAME =
  "Synthetic child with a long household name for narrow phone sheets";
const LONG_MEDICATION_NAME = "SyntheticMedicationLabel".repeat(8);
const BASE_MEDICATION = {
  id: "synthetic-sick-medication",
  sick_day_id: "synthetic-sick-day",
  person_id: FAMILY.child,
  name: LONG_MEDICATION_NAME,
  dosage: "500mg",
  schedule: "Twice daily",
  next_dose_at: null,
  last_dose_at: null,
  active: true,
  notes: "Synthetic household note",
};

type Medication = {
  id: string;
  sick_day_id: string | null;
  person_id: string;
  name: string;
  dosage: string;
  schedule: string;
  next_dose_at: string | null;
  last_dose_at: string | null;
  active: boolean;
  notes: string | null;
};

const BASE_SICK_DAY = {
  id: "synthetic-sick-day",
  person_id: FAMILY.child,
  person_name: LONG_PERSON_NAME,
  person_avatar: null,
  started_at: "2026-01-04T12:00:00.000Z",
  ended_at: null,
  symptoms: "Synthetic cough and tiredness",
  severity: "moderate",
  status: "active",
  temperature_log: null,
  notes: "Synthetic clinical note",
  medications: [BASE_MEDICATION],
};

type SickDay = {
  id: string;
  person_id: string;
  person_name: string;
  person_avatar: string | null;
  started_at: string;
  ended_at: string | null;
  symptoms: string | null;
  severity: string;
  status: string;
  temperature_log: null;
  notes: string | null;
  medications: Medication[];
};

async function setLocale(context: BrowserContext, locale: "en" | "es") {
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

async function installLoopbackGuard(
  context: BrowserContext,
  blockedWrites: string[],
) {
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
    const mutation = `${request.method()} ${url.pathname}`;
    if (MUTATING_METHODS.has(request.method()) && mutation !== FEATURE_PATCH) {
      blockedWrites.push(mutation);
      await route.abort();
      return;
    }
    await route.continue();
  });
}

function sourceCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function sourceTree() {
  return execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();
}

function compiledBuiltAt() {
  const route = fs.readFileSync(
    ".next/server/app/api/version/route.js",
    "utf8",
  );
  const timestamps = [
    ...new Set(route.match(/20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g) ?? []),
  ];
  expect(timestamps).toHaveLength(1);
  return timestamps[0]!;
}

async function assertRuntimeReceipt(
  page: Page,
  info: TestInfo,
  locale: "en" | "es",
) {
  const response = await browserFetch(page, "/api/version");
  expect(response.status, response.body).toBe(200);
  const runtime = JSON.parse(response.body) as {
    version?: unknown;
    commit?: unknown;
    builtAt?: unknown;
  };
  const commit = sourceCommit();
  const tree = sourceTree();
  expect(runtime.version).toEqual(expect.any(String));
  expect(runtime.commit).toBe(commit);
  if (process.env.RELEASE_SHA?.trim())
    expect(process.env.RELEASE_SHA.trim()).toBe(commit);
  expect(runtime.builtAt).toBe(compiledBuiltAt());
  expect(() =>
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "prisma"], {
      stdio: "ignore",
    }),
  ).not.toThrow();
  await info.attach(`sick-days-${locale}-runtime-receipt`, {
    body: JSON.stringify({
      runtime,
      sourceCommit: commit,
      sourceTree: tree,
      locale,
    }),
    contentType: "application/json",
  });
}

async function assertBounds(
  locator: Locator,
  viewportWidth: number,
  viewportHeight: number,
  label: string,
) {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a rendered box`).not.toBeNull();
  expect(
    box!.width,
    `${label} should be at least 44px wide`,
  ).toBeGreaterThanOrEqual(44);
  expect(
    box!.height,
    `${label} should be at least 44px tall`,
  ).toBeGreaterThanOrEqual(44);
  expect(box!.x, `${label} should not clip left`).toBeGreaterThanOrEqual(0);
  expect(
    box!.x + box!.width,
    `${label} should not clip right`,
  ).toBeLessThanOrEqual(viewportWidth);
  expect(box!.y, `${label} should not clip above`).toBeGreaterThanOrEqual(0);
  expect(
    box!.y + box!.height,
    `${label} should not clip below`,
  ).toBeLessThanOrEqual(viewportHeight);
}

async function assertReadableText(
  locator: Locator,
  viewportWidth: number,
  viewportHeight: number,
  label: string,
) {
  await assertBounds(locator, viewportWidth, viewportHeight, label);
  const metrics = await locator.evaluate((element) => ({
    clientHeight: element.clientHeight,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    scrollWidth: element.scrollWidth,
  }));
  expect(
    metrics.scrollWidth,
    `${label} should wrap inside its box`,
  ).toBeLessThanOrEqual(metrics.clientWidth);
  expect(
    metrics.scrollHeight,
    `${label} should not clip vertically`,
  ).toBeLessThanOrEqual(metrics.clientHeight);
}

async function assertSurface(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const violations = (
    await new AxeBuilder({ page }).include("main").analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
}

test.use({ storageState: authFile("parentA") });

for (const locale of ["en", "es"] as const) {
  test(`${locale}: Sick days sheets retain drafts and recover safely`, async ({
    page,
    context,
    baseURL,
  }, info: TestInfo) => {
    test.skip(
      !REPRESENTATIVE_PROJECTS.has(info.project.name),
      "Sick days rendered transport runs on the representative phone and desktop projects only",
    );
    assertFixtureTargetAllowed(process.env);
    expect(LOOPBACK_HOSTS.has(new URL(baseURL!).hostname)).toBe(true);
    await setLocale(context, locale);
    const blockedWrites: string[] = [];
    await installLoopbackGuard(context, blockedWrites);

    await page.goto("/dashboard");
    const auth = await browserFetch(page, "/api/auth/me");
    expect(auth.status, auth.body).toBe(200);
    const identity = JSON.parse(auth.body).user;
    expect(identity.id).toBe(FAMILY.parent);
    expect(identity.family_id).toBe(FAMILY.family);
    expect(identity.role).toBe("parent");

    const originalResponse = await browserFetch(page, "/api/family/features");
    expect(originalResponse.status, originalResponse.body).toBe(200);
    const originalFeatures = JSON.parse(originalResponse.body)
      .features as Record<string, boolean>;
    const cleanAudit = await ownFeatureAudit(["sick-days"]);
    let restored = false;
    let authMode: "real" | "failure" = "real";
    let medicationGets = 0;
    let startCalls = 0;
    let doseCalls = 0;
    let releaseStart: (() => void) | undefined;
    let releaseDose: (() => void) | undefined;
    let sickDay: SickDay = structuredClone(BASE_SICK_DAY);
    let medication: Medication = structuredClone(BASE_MEDICATION);

    try {
      const enabled = await browserSend(page, "PATCH", "/api/family/features", {
        features: { ...originalFeatures, "sick-days": true },
      });
      expect(enabled.status, enabled.body).toBe(200);
      const canonical = await browserFetch(page, "/api/family/features");
      expect(canonical.status, canonical.body).toBe(200);
      expect(JSON.parse(canonical.body).features["sick-days"]).toBe(true);

      await page.route("**/api/auth/me", async (route) => {
        if (authMode === "failure") {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "synthetic auth unavailable" }),
          });
          return;
        }
        await route.continue();
      });
      await page.route("**/api/family/members", async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            members: [
              { id: FAMILY.parent, name: "Synthetic parent", avatar_url: null },
              { id: FAMILY.child, name: "Synthetic child", avatar_url: null },
            ],
          }),
        });
      });
      await page.route("**/api/sick-days**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname === "/api/sick-days" && request.method() === "GET") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ sickDays: [sickDay] }),
          });
          return;
        }
        if (url.pathname === "/api/sick-days" && request.method() === "POST") {
          startCalls += 1;
          if (startCalls === 1) {
            await new Promise<void>((resolve) => {
              releaseStart = resolve;
            });
            await route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({ error: "synthetic held failure" }),
            });
            return;
          }
          await route.fulfill({
            status: 201,
            contentType: "application/json",
            body: JSON.stringify({ sickDay }),
          });
          return;
        }
        await route.continue();
      });
      await page.route("**/api/medications**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname === "/api/medications" && request.method() === "GET") {
          medicationGets += 1;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            // The first dependency read fails with a malformed 200. The
            // embedded medication remains the truthful fallback until retry.
            body:
              medicationGets === 1
                ? JSON.stringify({ medications: { malformed: true } })
                : JSON.stringify({ medications: [medication] }),
          });
          return;
        }
        if (
          url.pathname === `/api/medications/${medication.id}` &&
          request.method() === "PATCH"
        ) {
          const body = request.postDataJSON() as Record<string, unknown>;
          if (body.markDoseTaken === true) {
            doseCalls += 1;
            if (doseCalls === 1) {
              await new Promise<void>((resolve) => {
                releaseDose = resolve;
              });
              medication = {
                ...medication,
                last_dose_at: "2026-01-05T12:00:00.000Z",
              };
              sickDay = { ...sickDay, medications: [medication] };
              await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ medication }),
              });
              return;
            }
          }
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ medication }),
          });
          return;
        }
        await route.continue();
      });

      await page.goto("/dashboard/sick-days");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      if (locale === "es")
        await expect(page.locator("html")).toHaveClass(/dark/);
      else await expect(page.locator("html")).not.toHaveClass(/dark/);
      await assertRuntimeReceipt(page, info, locale);
      await expect(
        page.getByRole("heading", { level: 1, name: COPY[locale].title }),
      ).toBeVisible();

      const copy = COPY[locale];
      const medicationFailure = page
        .getByRole("alert")
        .filter({ hasText: copy.medicationsFailed });
      await expect(medicationFailure).toBeVisible();
      await expect(
        page.getByText(medication.name, { exact: true }),
      ).toHaveCount(0);
      await medicationFailure
        .getByRole("button", { name: copy.tryAgain, exact: true })
        .click();
      await expect(medicationFailure).toHaveCount(0);

      const viewportWidth = info.project.use.viewport!.width;
      const viewportHeight = info.project.use.viewport!.height;
      const startButton = page.getByRole("button", {
        name: copy.start,
        exact: true,
      });
      await assertBounds(
        startButton,
        viewportWidth,
        viewportHeight,
        "start sick day",
      );
      await startButton.click();
      let dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const person = dialog.getByLabel(copy.person, { exact: true });
      await person.selectOption(FAMILY.child);
      await dialog
        .getByLabel(copy.symptoms, { exact: true })
        .fill("Synthetic short-sheet draft");
      const save = dialog.getByRole("button", { name: copy.save, exact: true });
      const cancel = dialog.getByRole("button", {
        name: copy.cancel,
        exact: true,
      });
      await assertBounds(
        save,
        viewportWidth,
        viewportHeight,
        "start-sheet save",
      );
      await assertBounds(
        cancel,
        viewportWidth,
        viewportHeight,
        "start-sheet cancel",
      );
      await save.click();
      await expect(save).toBeDisabled();
      await expect(person).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      releaseStart?.();
      await expect(
        page.getByText(copy.startFailed, { exact: true }),
      ).toBeVisible();
      await save.click();
      await expect(dialog).toHaveCount(0);
      expect(startCalls).toBe(2);

      const sicknessRow = page
        .getByRole("button")
        .filter({ hasText: sickDay.person_name })
        .first();
      await sicknessRow.click();
      const detail = page.getByTestId("sick-day-detail");
      await expect(detail).toBeVisible();
      await expect(
        detail.getByText(medication.name, { exact: true }),
      ).toBeVisible();
      await assertReadableText(
        detail.getByRole("heading", { name: sickDay.person_name, exact: true }),
        viewportWidth,
        viewportHeight,
        "long person label",
      );
      await assertReadableText(
        detail.getByText(medication.name, { exact: true }),
        viewportWidth,
        viewportHeight,
        "unbroken medication label",
      );
      const addMedication = detail.getByRole("button", {
        name: `+ ${copy.addMedication}`,
        exact: true,
      });
      await assertBounds(
        addMedication,
        viewportWidth,
        viewportHeight,
        "add medication",
      );
      await addMedication.click();
      dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const draftName = dialog.getByLabel(copy.name, { exact: true });
      await draftName.fill("Synthetic draft only");
      const medSave = dialog.getByRole("button", {
        name: copy.save,
        exact: true,
      });
      await assertBounds(
        medSave,
        viewportWidth,
        viewportHeight,
        "medication-sheet fixed footer",
      );
      await dialog
        .getByRole("button", { name: copy.cancel, exact: true })
        .evaluate((button) => {
          const box = button.getBoundingClientRect();
          if (box.bottom > window.innerHeight)
            throw new Error("medication footer is clipped");
        });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(detail).toBeVisible();
      await detail
        .getByRole("button", { name: `+ ${copy.addMedication}`, exact: true })
        .click();
      dialog = page.getByRole("dialog");
      await expect(dialog.getByLabel(copy.name, { exact: true })).toHaveValue(
        "Synthetic draft only",
      );
      await dialog
        .getByRole("button", { name: copy.cancel, exact: true })
        .click();
      await expect(detail).toBeVisible();

      const doseButton = detail.getByRole("button", {
        name: `${copy.markDose} ${medication.name}`,
        exact: true,
      });
      await assertBounds(
        doseButton,
        viewportWidth,
        viewportHeight,
        "mark dose",
      );
      await doseButton.click();
      await expect(doseButton).toBeDisabled();
      await expect(doseButton).toHaveAttribute("aria-busy", "true");
      await doseButton.evaluate((button) => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(doseCalls).toBe(1);
      releaseDose?.();
      await expect.poll(() => doseCalls).toBe(1);
      await expect(detail.getByText(/Last dose|Ultima dosis/)).toBeVisible();

      authMode = "failure";
      await page.reload();
      await expect(
        page.getByRole("alert").filter({ hasText: copy.authFailed }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: copy.start, exact: true }),
      ).toHaveCount(0);
      authMode = "real";
      await page
        .getByRole("button", { name: copy.tryAgain, exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: copy.start, exact: true }),
      ).toBeVisible();
      await assertSurface(page);
      await info.attach(`sick-days-${locale}-screen`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
      await info.attach(`sick-days-${locale}-scope`, {
        body: JSON.stringify({
          locale,
          project: info.project.name,
          role: "parentA",
          synthetic: [
            "GET /api/sick-days with null temperature_log and embedded medication",
            "GET /api/family/members",
            "GET /api/medications malformed 200 then valid retry",
            "POST /api/sick-days held 503 then retry 201",
            "PATCH /api/medications/:id held synthetic dose response",
          ],
          realFixtureOnly: [
            "/api/auth/me",
            "/api/family/features",
            "/api/version",
          ],
          checks: [
            "parent fixed footer bounds",
            "name-only medication draft retained across Escape",
            "pending fields disabled and Escape protected",
            "embedded medication fallback and retry",
            "one-dose pending guard",
            "auth failure leaves authority unknown and read-only",
            "axe serious/critical",
            "full bounds and no horizontal overflow",
          ],
          blockedWrites,
        }),
        contentType: "application/json",
      });
      expect(blockedWrites).toEqual([]);
    } finally {
      try {
        const restoredResponse = await browserSend(
          page,
          "PATCH",
          "/api/family/features",
          {
            features: originalFeatures,
          },
        );
        expect(restoredResponse.status, restoredResponse.body).toBe(200);
        const canonical = await browserFetch(page, "/api/family/features");
        expect(canonical.status, canonical.body).toBe(200);
        expect(JSON.parse(canonical.body).features).toEqual(originalFeatures);
        restored = true;
      } finally {
        await cleanAudit(restored);
      }
    }
  });
}
