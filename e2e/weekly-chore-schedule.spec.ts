/** #449: weekly weekday selection on the real forms, synthetic reads only. */
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { choreScheduleMessages } from "../src/i18n/chore-schedule";
import { choreFormMessages } from "../src/i18n/chore-forms";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { authFile } from "./support/env";
import { expect, test } from "./support/test";

const PROJECTS = [
  "phone-390x844",
  "phone-430x932",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
  "tablet-large-1920x1200",
  "desktop-1366x768",
] as const;

const FUTURE_ID = "fx_e2e_weekly_future_anchor";
const FUTURE_TEMPLATE_ID = "fx_e2e_weekly_future_template";
const MEMBER_ID = "fx_e2e_weekly_member";
const members = [
  { id: MEMBER_ID, name: "Synthetic Member", role: "child" },
  { id: "fx_e2e_weekly_parent", name: "Synthetic Parent", role: "parent" },
];

function sourceHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function sourceTree() {
  return execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();
}

function builtAt() {
  const route = fs.readFileSync(
    ".next/server/app/api/version/route.js",
    "utf8",
  );
  const values = [
    ...new Set(route.match(/20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g) ?? []),
  ];
  expect(values).toHaveLength(1);
  return values[0]!;
}

async function runtimeIdentity(
  page: Page,
  info: TestInfo,
  locale: "en" | "es",
) {
  const head = sourceHead();
  expect(head).toMatch(/^[a-f0-9]{40}$/);
  expect(() =>
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "prisma"], {
      stdio: "ignore",
    }),
  ).not.toThrow();
  const releaseSha = process.env.RELEASE_SHA?.trim();
  if (releaseSha) expect(releaseSha).toBe(head);

  const tree = sourceTree();
  expect(tree).toMatch(/^[a-f0-9]{40}$/);
  const configuredTree = process.env.E2E_WEEKLY_BUILD_TREE?.trim();
  if (configuredTree) expect(configuredTree).toBe(tree);

  const response = await page.request.get("/api/version");
  expect(response.status()).toBe(200);
  const runtime = (await response.json()) as {
    commit: string;
    builtAt: string;
  };
  expect(runtime.commit).toBe(head);
  expect(runtime.builtAt).toBe(builtAt());

  const proof = {
    runtime,
    buildId: fs.readFileSync(".next/BUILD_ID", "utf8").trim(),
    buildTree: tree,
    configuredBuildTree: configuredTree ?? null,
    locale,
    role: "parent",
    weeklyTransport:
      "GET /api/chores and GET /api/family/members synthetic; writes blocked",
  };
  expect(proof.buildId).not.toBe("");
  await info.attach("actual-weekly-runtime-identity", {
    body: JSON.stringify(proof),
    contentType: "application/json",
  });
}

function futureChore() {
  return {
    id: FUTURE_ID,
    family_id: "fx_e2e_weekly_family",
    title: "Synthetic future weekly chore",
    description: "Synthetic future-anchor row for weekly edit coverage.",
    points: 10,
    assigned_to: MEMBER_ID,
    due_date: "2099-10-15T00:00:00.000Z",
    status: "pending",
    frequency: "once",
    weekly_days: [],
    recurrence_id: FUTURE_TEMPLATE_ID,
    is_template: false,
    difficulty: "easy",
    created_by: "fx_e2e_weekly_parent",
    created_at: "2099-10-01T12:00:00.000Z",
    photo_url: null,
    icon: null,
    routine: null,
    routine_order: null,
  };
}

async function installSyntheticGuards(page: Page, writes: string[]) {
  // Every state-changing request is blocked inside the fabricated transport.
  // Reads used by the real forms are either synthetic or the version proof.
  await page.route("**/api/**", async (route) => {
    if (["GET", "HEAD"].includes(route.request().method())) {
      await route.continue();
      return;
    }
    writes.push(`${route.request().method()} ${route.request().url()}`);
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "Synthetic QA write blocked" }),
    });
  });

  await page.route("**/api/family/members*", async (route) => {
    if (["GET", "HEAD"].includes(route.request().method())) {
      await route.fulfill({ status: 200, json: { members } });
      return;
    }
    writes.push(`${route.request().method()} ${route.request().url()}`);
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "Synthetic QA write blocked" }),
    });
  });

  await page.route("**/api/chores**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!["GET", "HEAD"].includes(request.method())) {
      writes.push(`${request.method()} ${request.url()}`);
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic QA write blocked" }),
      });
      return;
    }

    if (
      url.pathname === "/api/chores" &&
      url.searchParams.get("id") === FUTURE_ID
    ) {
      await route.fulfill({
        status: 200,
        json: {
          chore: futureChore(),
          template: {
            id: FUTURE_TEMPLATE_ID,
            frequency: "weekly",
            weekly_days: [1, 4],
          },
          rotation: null,
        },
      });
      return;
    }
    await route.fulfill({
      status: 200,
      json: { chores: [], nextCursor: null },
    });
  });
}

async function captureForm(
  page: Page,
  info: TestInfo,
  name: string,
  targets: Locator[],
) {
  for (const target of targets) {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    const viewport = page.viewportSize();
    expect(box).toBeTruthy();
    expect(viewport).toBeTruthy();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
    await target.focus();
    await expect(target).toBeFocused();
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const violations = (
    await new AxeBuilder({ page }).include("#main-content").analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  await info.attach(`${name}-axe`, {
    body: JSON.stringify(violations),
    contentType: "application/json",
  });
  expect(violations).toEqual([]);
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
  });
}

async function assertWeekdayControl(
  page: Page,
  label: string,
  expectedChecked: boolean,
) {
  const checkbox = page.getByRole("checkbox", { name: label, exact: true });
  const target = page.locator("label").filter({ hasText: label }).first();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  const viewport = page.viewportSize();
  expect(box).toBeTruthy();
  expect(viewport).toBeTruthy();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  await checkbox.focus();
  await expect(checkbox).toBeFocused();
  if (expectedChecked) await checkbox.press("Space");
  await expect(checkbox).toBeChecked({ checked: expectedChecked });
}

/** Extend existing phone/desktop cases; upload responses are synthetic only. */
async function assertPhotoRecovery(
  page: Page,
  info: TestInfo,
  locale: "en" | "es",
  mode: "create" | "edit",
  writes: string[],
) {
  if (!["phone-390x844", "desktop-1366x768"].includes(info.project.name))
    return;
  const copy = choreFormMessages[locale];
  const photo = page.getByLabel(copy.photo, { exact: true });
  const section = photo.locator("xpath=ancestor::details");
  await section.locator("summary").click();
  const save = page.getByRole("button", {
    name: mode === "create" ? copy.create : copy.save,
    exact: true,
  });
  const title = page.getByLabel(copy.title, { exact: true });
  const draftTitle = await title.inputValue();
  let attempts = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const file = {
    name: "synthetic-photo.png",
    mimeType: "image/png",
    buffer: Buffer.from("synthetic image"),
  };
  const url = "/api/files/chores/1111111111111111.png";
  await page.route("**/api/upload", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    attempts += 1;
    if (attempts === 1)
      return route.fulfill({
        status: 503,
        json: { error: "Synthetic upload refusal" },
      });
    await held;
    await route.fulfill({ status: 200, json: { url } });
  });
  await page.route(`**${url}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  try {
    await photo.setInputFiles(file);
    await expect(section.getByRole("alert")).toHaveText(copy.uploadFailed);
    await expect(title).toHaveValue(draftTitle);
    await expect(photo).toHaveValue("");
    await expect(save).toBeEnabled();
    await info.attach(
      `chore-photo-${locale}-${info.project.name}-${mode}-refused`,
      {
        contentType: "image/png",
        body: await page.screenshot({ fullPage: true }),
      },
    );
    await photo.setInputFiles(file);
    await expect.poll(() => attempts).toBe(2);
    await expect(save).toBeDisabled();
    await expect(section.getByRole("alert")).toHaveCount(0);
    await title.evaluate((node) =>
      (node as HTMLInputElement).form!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    expect(writes).toEqual([]);
    release();
    await expect(save).toBeEnabled();
    await expect(
      section.getByRole("img", { name: copy.preview }),
    ).toHaveAttribute("src", url);
    await expect
      .poll(() =>
        section
          .getByRole("img", { name: copy.preview })
          .evaluate(
            (node) =>
              (node as HTMLImageElement).complete &&
              (node as HTMLImageElement).naturalWidth > 0,
          ),
      )
      .toBe(true);
    await expect(title).toHaveValue(draftTitle);
    expect(writes).toEqual([]);
    await expect(
      section.getByRole("button", { name: copy.removePhoto }),
    ).toBeEnabled();
    const violations = (
      await new AxeBuilder({ page }).include("#main-content").analyze()
    ).violations;
    expect(violations).toEqual([]);
  } finally {
    release();
    await page.unroute("**/api/upload");
    await page.unroute(`**${url}`);
  }
}

test.use({ storageState: authFile("parentA"), timezoneId: "America/Toronto" });

for (const locale of ["en", "es"] as const) {
  test.describe(`${locale} weekly chore schedule`, () => {
    test.use({ colorScheme: locale === "en" ? "light" : "dark" });

    test(`${locale}: create and edit use selected weekdays without a due date`, async ({
      page,
      context,
      baseURL,
    }, info) => {
      test.skip(
        !PROJECTS.includes(info.project.name as (typeof PROJECTS)[number]),
        "Weekly schedule runs at the six representative responsive sizes",
      );
      assertFixtureTargetAllowed(process.env);
      expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
        new URL(baseURL!).hostname,
      );

      const writes: string[] = [];
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
          ["data:", "blob:"].includes(url.protocol)
          ? route.continue()
          : route.abort();
      });
      await page.addInitScript(
        ({ key, value }) => localStorage.setItem(key, value),
        { key: LOCALE_STORAGE_KEY, value: locale },
      );
      await installSyntheticGuards(page, writes);

      await page.goto("/dashboard/chores/create");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      if (locale === "es")
        await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      else await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
      await runtimeIdentity(page, info, locale);

      const weekly = page.getByRole("button", {
        name: choreFormMessages[locale].weekly,
        exact: true,
      });
      await weekly.click();
      await expect(weekly).toHaveAttribute("aria-pressed", "true");
      await expect(
        page.getByLabel(choreFormMessages[locale].dueDate, { exact: true }),
      ).toHaveCount(0);

      const weekdayNames = choreScheduleMessages[locale].weekdayNames;
      const monday = weekdayNames[1];
      const thursday = weekdayNames[4];
      await assertWeekdayControl(page, monday, true);
      await assertWeekdayControl(page, thursday, true);
      const summary = page.getByTestId("weekly-schedule-summary");
      const daySummary = locale === "en" ? "Monday, Thursday" : "lunes, jueves";
      await expect(summary).toHaveText(
        choreScheduleMessages[locale].weeklyDays.replace("{days}", daySummary),
      );
      await expect(summary).not.toContainText(/next|próxima|2026|Oct|oct/);

      await page
        .getByLabel(choreFormMessages[locale].title, { exact: true })
        .fill("Synthetic weekly chore");
      await expect(
        page.getByRole("button", { name: choreFormMessages[locale].create }),
      ).toBeEnabled();
      await assertPhotoRecovery(page, info, locale, "create", writes);
      await captureForm(page, info, `${locale}-${info.project.name}-create`, [
        weekly,
      ]);
      expect(writes).toEqual([]);

      await page.goto(`/dashboard/chores/edit?id=${FUTURE_ID}`);
      await expect(
        page.getByLabel(choreFormMessages[locale].title, { exact: true }),
      ).toHaveValue("Synthetic future weekly chore");
      const editWeekly = page.getByRole("button", {
        name: choreFormMessages[locale].weekly,
        exact: true,
      });
      await expect(editWeekly).toHaveAttribute("aria-pressed", "true");
      await expect(
        page.getByLabel(choreFormMessages[locale].dueDate, { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("checkbox", { name: monday, exact: true }),
      ).toBeChecked();
      await expect(
        page.getByRole("checkbox", { name: thursday, exact: true }),
      ).toBeChecked();
      await expect(page.getByTestId("weekly-schedule-summary")).toHaveText(
        choreScheduleMessages[locale].weeklyDays.replace("{days}", daySummary),
      );
      await assertPhotoRecovery(page, info, locale, "edit", writes);
      await captureForm(page, info, `${locale}-${info.project.name}-edit`, [
        editWeekly,
      ]);
      expect(writes).toEqual([]);
    });
  });
}
