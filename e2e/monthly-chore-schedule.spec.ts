/** #471: monthly date-only policy on the real chore forms, synthetic reads only. */
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

const MONTHLY_DATE = "2026-01-31";
const LEGACY_ID = "fx_e2e_monthly_legacy_jan31";
const MEMBER_ID = "fx_e2e_monthly_member";
const members = [
  { id: MEMBER_ID, name: "Synthetic Member", role: "child" },
  { id: "fx_e2e_monthly_parent", name: "Synthetic Parent", role: "parent" },
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
  const configuredTree = process.env.E2E_MONTHLY_BUILD_TREE?.trim();
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
    monthlyTransport:
      "GET /api/chores and GET /api/family/members synthetic; writes blocked",
  };
  expect(proof.buildId).not.toBe("");
  await info.attach("actual-monthly-runtime-identity", {
    body: JSON.stringify(proof),
    contentType: "application/json",
  });
  return proof;
}

function legacyChore() {
  return {
    id: LEGACY_ID,
    family_id: "fx_e2e_monthly_family",
    title: "Synthetic legacy monthly chore",
    description: "Synthetic legacy row for date-only edit coverage.",
    points: 10,
    assigned_to: MEMBER_ID,
    due_date: `${MONTHLY_DATE}T00:00:00.000Z`,
    status: "pending",
    frequency: "monthly",
    weekly_days: [],
    recurrence_id: null,
    is_template: false,
    difficulty: "easy",
    created_by: "fx_e2e_monthly_parent",
    created_at: `${MONTHLY_DATE}T12:00:00.000Z`,
    photo_url: null,
    icon: null,
    routine: null,
    routine_order: null,
  };
}

async function installSyntheticGuards(page: Page, writes: string[]) {
  // Keep every state-changing API request inside the fabricated transport. A
  // failed assertion must never turn this read-only visual journey into a
  // domain mutation.
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
      url.searchParams.get("id") === LEGACY_ID
    ) {
      await route.fulfill({
        status: 200,
        json: { chore: legacyChore(), template: null, rotation: null },
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
    expect(
      await target.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          ),
        );
      }),
    ).toBe(true);
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

test.use({ storageState: authFile("parentA"), timezoneId: "America/Toronto" });

for (const locale of ["en", "es"] as const) {
  test.describe(`${locale} monthly chore schedule`, () => {
    test.use({ colorScheme: locale === "en" ? "light" : "dark" });

    test(`${locale}: ordinary, routine and legacy Jan 31 forms keep the monthly contract`, async ({
      page,
      context,
      baseURL,
    }, info) => {
      test.skip(
        !PROJECTS.includes(info.project.name as (typeof PROJECTS)[number]),
        "Monthly schedule runs at the six representative responsive sizes",
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

      const frequency = page.getByRole("button", {
        name: choreFormMessages[locale].monthly,
        exact: true,
      });
      const dueDate = page.getByLabel(choreFormMessages[locale].startDate, {
        exact: true,
      });
      await expect(
        page.getByLabel(choreFormMessages[locale].assignTo, { exact: true }),
      ).toHaveValue(MEMBER_ID);
      await frequency.click();
      await dueDate.fill(MONTHLY_DATE);
      await expect(frequency).toHaveAttribute("aria-pressed", "true");
      await expect(dueDate).toHaveValue(MONTHLY_DATE);
      await expect(
        page.getByText(choreScheduleMessages[locale].monthlyHint, {
          exact: true,
        }),
      ).toBeVisible();
      await captureForm(page, info, `${locale}-${info.project.name}-ordinary`, [
        frequency,
        dueDate,
      ]);

      // The routine entry point is the same CreateChoreForm. Its query
      // prefill must retain the Jan 31 date when the schedule becomes monthly.
      await page.goto(
        "/dashboard/chores/create?routine=Morning&step=1&date=2026-01-31",
      );
      await expect(
        page.getByLabel(choreFormMessages[locale].routine, { exact: true }),
      ).toHaveValue("Morning");
      await expect(
        page.getByLabel(choreFormMessages[locale].step, { exact: true }),
      ).toHaveValue("1");
      const routineFrequency = page.getByRole("button", {
        name: choreFormMessages[locale].monthly,
        exact: true,
      });
      const routineDate = page.getByLabel(choreFormMessages[locale].startDate, {
        exact: true,
      });
      await routineFrequency.click();
      await expect(routineDate).toHaveValue(MONTHLY_DATE);
      await expect(
        page.getByText(choreScheduleMessages[locale].monthlyHint, {
          exact: true,
        }),
      ).toBeVisible();
      await captureForm(page, info, `${locale}-${info.project.name}-routine`, [
        routineFrequency,
        routineDate,
      ]);

      // A legacy recurring row has no series template. Opening it must show
      // the stored Jan 31 date unchanged until a parent explicitly saves.
      await page.goto(`/dashboard/chores/edit?id=${LEGACY_ID}`);
      await expect(
        page.getByLabel(choreFormMessages[locale].title, { exact: true }),
      ).toHaveValue("Synthetic legacy monthly chore");
      const legacyFrequency = page.getByRole("button", {
        name: choreFormMessages[locale].monthly,
        exact: true,
      });
      const legacyDate = page.getByLabel(
        choreFormMessages[locale].scheduledDate,
        {
          exact: true,
        },
      );
      await expect(legacyFrequency).toHaveAttribute("aria-pressed", "true");
      await expect(legacyDate).toHaveValue(MONTHLY_DATE);
      await expect(
        page.getByText(choreScheduleMessages[locale].monthlyHint, {
          exact: true,
        }),
      ).toBeVisible();
      await captureForm(page, info, `${locale}-${info.project.name}-legacy`, [
        legacyFrequency,
        legacyDate,
      ]);
      expect(writes).toEqual([]);
    });
  });
}
