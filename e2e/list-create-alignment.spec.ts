/**
 * Lists create alignment: localized custom lists, private image upload, and
 * the direct-route role boundary. All state-changing transport is synthetic;
 * the authenticated fixture is used only for identity and permission setup.
 */
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import {
  FIXTURE_EMAILS,
  FIXTURE_IDS,
  FIXTURE_PASSWORD,
} from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { listCreateMessages } from "../src/i18n/list-create";
import {
  listOverviewEnglish,
  listOverviewSpanish,
} from "../src/i18n/list-overview";
import { authFile } from "./support/env";
import { browserFetch, expect, test } from "./support/test";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PROJECT_NAMES = new Set([
  "phone-390x844",
  "phone-430x932",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
  "tablet-large-1920x1200",
  "desktop-1366x768",
]);
const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const SYNTHETIC_MUTATIONS = new Set([
  "POST /api/upload",
  "POST /api/lists/create",
]);

type Locale = "en" | "es";
type FixtureRole = "parentA" | "teenA" | "childA";
type UploadMode = "valid" | "malformed" | "failure" | "hold";
type CreateMode = "success" | "failure" | "hold";

function sourceHead(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function sourceTree(): string {
  return execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();
}

function compiledBuiltAt(): string {
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

async function assertRuntimeIdentity(
  page: Page,
  info: TestInfo,
  locale: Locale,
  role: FixtureRole,
): Promise<void> {
  const response = await browserFetch(page, "/api/version");
  expect(response.status, response.body).toBe(200);
  const runtime = JSON.parse(response.body) as {
    version?: unknown;
    commit?: unknown;
    builtAt?: unknown;
  };
  const head = sourceHead();
  expect(head).toMatch(/^[a-f0-9]{40}$/);
  expect(runtime.version).toEqual(expect.any(String));
  expect(runtime.commit).toBe(head);
  if (process.env.RELEASE_SHA?.trim()) {
    expect(process.env.RELEASE_SHA.trim()).toBe(head);
  }
  expect(() =>
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "prisma"], {
      stdio: "ignore",
    }),
  ).not.toThrow();
  expect(runtime.builtAt).toBe(compiledBuiltAt());
  const tree = sourceTree();
  if (process.env.E2E_LIST_CREATE_BUILD_TREE?.trim()) {
    expect(process.env.E2E_LIST_CREATE_BUILD_TREE.trim()).toBe(tree);
  }
  const buildId = fs.readFileSync(".next/BUILD_ID", "utf8").trim();
  expect(buildId).not.toBe("");
  await info.attach(`list-create-${role}-${locale}-runtime-identity`, {
    body: JSON.stringify({
      runtime,
      buildId,
      sourceTree: tree,
      role,
      locale,
      sensitiveActions:
        "list create and upload intercepted with synthetic responses",
    }),
    contentType: "application/json",
  });
}

async function assertFixtureIdentity(
  page: Page,
  role: FixtureRole,
): Promise<void> {
  const response = await browserFetch(page, "/api/auth/me");
  expect(response.status, response.body).toBe(200);
  const body = JSON.parse(response.body) as {
    user?: { id?: unknown; family_id?: unknown; role?: unknown };
  };
  const memberKey =
    role === "parentA" ? "parent" : role === "teenA" ? "teen" : "child";
  expect(body.user?.id).toBe(FIXTURE_IDS.familyA[memberKey]);
  expect(body.user?.family_id).toBe(FIXTURE_IDS.familyA.family);
  expect(body.user?.role).toBe(memberKey);
}

async function installLoopbackGuard(
  context: BrowserContext,
  blockedWrites: string[],
): Promise<void> {
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
    if (
      MUTATING_METHODS.has(request.method()) &&
      !SYNTHETIC_MUTATIONS.has(`${request.method()} ${url.pathname}`)
    ) {
      blockedWrites.push(`${request.method()} ${url.pathname}`);
      await route.abort();
      return;
    }
    await route.continue();
  });
}

async function assertActionGeometry(
  page: Page,
  action: Locator,
): Promise<void> {
  const box = await action.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
}

function fileFixture() {
  return {
    name: "family-list.png",
    mimeType: "image/png",
    buffer: Buffer.from("synthetic list image"),
  };
}

async function installSyntheticTransport(
  page: Page,
  modes: { upload: UploadMode; create: CreateMode },
  uploadRequests: string[],
  createBodies: unknown[],
  controls: {
    releaseUpload: (() => void) | null;
    releaseCreate: (() => void) | null;
  },
): Promise<void> {
  await page.route("**/api/upload", async (route) => {
    uploadRequests.push(route.request().method());
    if (route.request().method() !== "POST") {
      await route.abort();
      return;
    }
    if (modes.upload === "hold") {
      await new Promise<void>((resolve) => {
        controls.releaseUpload = resolve;
      });
    }
    if (modes.upload === "failure") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "synthetic private provider detail" }),
      });
      return;
    }
    if (modes.upload === "malformed") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: "/private/not-a-list-image" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: "/api/files/chores/abcdef0123456789.png" }),
    });
  });

  await page.route("**/api/lists/create", async (route) => {
    createBodies.push(route.request().postDataJSON());
    if (route.request().method() !== "POST") {
      await route.abort();
      return;
    }
    if (modes.create === "hold") {
      await new Promise<void>((resolve) => {
        controls.releaseCreate = resolve;
      });
    }
    if (modes.create === "failure") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "synthetic private create detail" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ list: { id: "synthetic-list-create" } }),
    });
  });
}

function copyFor(locale: Locale) {
  return listCreateMessages[locale];
}

for (const locale of ["en", "es"] as const) {
  test.describe(`${locale} parent list create`, () => {
    test.use({ storageState: authFile("parentA") });

    test(`${locale}: custom list and private image recovery remain localized`, async ({
      page,
      context,
      baseURL,
    }, info) => {
      test.skip(
        !PROJECT_NAMES.has(info.project.name),
        "all configured device sizes are covered",
      );
      assertFixtureTargetAllowed(process.env);
      expect([...LOOPBACK_HOSTS]).toContain(new URL(baseURL!).hostname);
      const blockedWrites: string[] = [];
      const uploadRequests: string[] = [];
      const createBodies: unknown[] = [];
      const modes = {
        upload: "failure" as UploadMode,
        create: "failure" as CreateMode,
      };
      const controls: {
        releaseUpload: (() => void) | null;
        releaseCreate: (() => void) | null;
      } = { releaseUpload: null, releaseCreate: null };
      await installLoopbackGuard(context, blockedWrites);
      await page.addInitScript(
        ({ key, value }) => localStorage.setItem(key, value),
        { key: LOCALE_STORAGE_KEY, value: locale },
      );
      await page.goto("/dashboard/lists/create");

      try {
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await assertRuntimeIdentity(page, info, locale, "parentA");
        await assertFixtureIdentity(page, "parentA");
        const copy = copyFor(locale);
        await expect(
          page.getByRole("heading", { name: copy.title }),
        ).toBeVisible();
        await expect(page.getByLabel(copy.name)).toBeVisible();
        const descriptionSection = page.getByTestId("list-description-section");
        await expect(descriptionSection).not.toHaveAttribute("open", "");
        await expect(
          page.getByLabel(copy.description, { exact: false }),
        ).toBeHidden();
        await assertActionGeometry(page, descriptionSection.locator("summary"));
        await descriptionSection.locator("summary").click();
        await expect(
          page.getByLabel(copy.description, { exact: false }),
        ).toBeVisible();

        await page
          .getByLabel(copy.type, { exact: true })
          .selectOption("custom");
        await expect(
          page.getByText(copy.customGuidance, { exact: true }),
        ).toBeVisible();
        await page.getByLabel(copy.name).fill("Family launch {count} 📷");
        await page
          .getByLabel(copy.description, { exact: false })
          .fill("Packing, school supplies, and weekend plans");

        await installSyntheticTransport(
          page,
          modes,
          uploadRequests,
          createBodies,
          controls,
        );
        const imageInput = page.getByLabel(copy.chooseImage);
        const imagePicker = page.getByTestId("list-image-section");
        await expect(imagePicker).not.toHaveAttribute("open", "");
        await imagePicker.locator("summary").click();
        const form = page.locator("form");
        await imageInput.setInputFiles(fileFixture());
        await expect(imagePicker.getByRole("alert")).toHaveText(
          copy.imageUploadError,
        );
        await expect(imagePicker.getByRole("alert")).not.toContainText(
          "synthetic private provider detail",
        );

        modes.upload = "malformed";
        await imageInput.setInputFiles(fileFixture());
        await expect(imagePicker.getByRole("alert")).toHaveText(
          copy.imageUploadError,
        );

        modes.upload = "hold";
        const heldUpload = imageInput.setInputFiles(fileFixture());
        await expect(
          page.getByRole("button", { name: copy.uploadingImage }),
        ).toBeVisible();
        const create = page.getByRole("button", {
          name: copy.uploadingImageStatus,
        });
        await expect(create).toBeDisabled();
        controls.releaseUpload?.();
        await heldUpload;
        await expect(page.getByAltText(copy.selectedImage)).toBeVisible();

        modes.create = "failure";
        await page.getByRole("button", { name: copy.create }).click();
        await expect(form.getByRole("alert")).toHaveText(copy.createError);
        await expect(form.getByRole("alert")).not.toContainText(
          "synthetic private create detail",
        );

        modes.create = "hold";
        const createButton = page.getByRole("button", { name: copy.create });
        const heldCreate = createButton.click();
        await expect(
          page.getByRole("button", { name: copy.creating }),
        ).toBeDisabled();
        await expect(
          page.getByRole("button", { name: copy.creating }),
        ).toHaveAttribute("aria-busy", "true");
        controls.releaseCreate?.();
        await heldCreate;
        await expect(page.getByRole("status")).toHaveText(copy.created);
        expect(uploadRequests).toHaveLength(3);
        expect(createBodies).toHaveLength(2);
        expect(createBodies[1]).toMatchObject({
          name: "Family launch {count} 📷",
          type: "custom",
          description: "Packing, school supplies, and weekend plans",
          image_url: "/api/files/chores/abcdef0123456789.png",
        });

        await assertActionGeometry(
          page,
          page.getByRole("button", { name: copy.createdButton }),
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        const violations = (
          await new AxeBuilder({ page }).include("main#main-content").analyze()
        ).violations.filter(
          (violation) =>
            violation.impact === "serious" || violation.impact === "critical",
        );
        expect(violations).toEqual([]);
      } finally {
        controls.releaseUpload?.();
        controls.releaseCreate?.();
        await page.unrouteAll({ behavior: "ignoreErrors" });
        await context.unrouteAll({ behavior: "ignoreErrors" });
      }
      expect(blockedWrites).toEqual([]);
    });
  });

  test.describe(`${locale} teen list create`, () => {
    test.use({ storageState: authFile("parentA") });

    test(`${locale}: teen can create a custom list through the sheet and direct route`, async ({
      page,
      context,
      baseURL,
    }, info) => {
      test.skip(
        !PROJECT_NAMES.has(info.project.name),
        "all configured device sizes are covered",
      );
      assertFixtureTargetAllowed(process.env);
      expect([...LOOPBACK_HOSTS]).toContain(new URL(baseURL!).hostname);
      await context.clearCookies();
      const login = await context.request.post("/api/auth/login", {
        data: {
          email: FIXTURE_EMAILS.familyA.teen,
          password: FIXTURE_PASSWORD,
        },
      });
      expect(login.status(), await login.text()).toBe(200);

      const blockedWrites: string[] = [];
      const createBodies: unknown[] = [];
      const controls = { releaseUpload: null, releaseCreate: null } as {
        releaseUpload: (() => void) | null;
        releaseCreate: (() => void) | null;
      };
      const modes = {
        upload: "valid" as UploadMode,
        create: "success" as CreateMode,
      };
      await installLoopbackGuard(context, blockedWrites);
      await page.addInitScript(
        ({ key, value }) => localStorage.setItem(key, value),
        { key: LOCALE_STORAGE_KEY, value: locale },
      );

      try {
        await page.goto("/dashboard/lists");
        const copy = copyFor(locale);
        const overviewAdd =
          locale === "en" ? listOverviewEnglish.add : listOverviewSpanish.add;
        const add = page.getByRole("link", { name: overviewAdd });
        await expect(add).toBeVisible();
        await add.click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText(copy.sheetTitle);
        await expect(dialog).toContainText(copy.draftDescription);

        await installSyntheticTransport(
          page,
          modes,
          [],
          createBodies,
          controls,
        );
        await dialog
          .getByLabel(copy.type, { exact: true })
          .selectOption("custom");
        await expect(
          dialog.getByText(copy.customGuidance, { exact: true }),
        ).toBeVisible();
        await dialog.getByLabel(copy.name).fill("Teen family planning");
        await dialog
          .getByTestId("list-description-section")
          .locator("summary")
          .click();
        await dialog
          .getByLabel(copy.description, { exact: false })
          .fill("School and weekend checklist");
        const create = dialog.getByRole("button", { name: copy.create });
        await assertActionGeometry(page, create);
        await create.click();
        await expect(dialog.getByRole("status")).toHaveText(copy.created);
        expect(createBodies).toHaveLength(1);
        expect(createBodies[0]).toMatchObject({
          name: "Teen family planning",
          type: "custom",
          description: "School and weekend checklist",
        });
        await expect(dialog).toBeVisible();

        await page.goto("/dashboard/lists/create");
        await expect(
          page.getByRole("heading", { name: copy.title }),
        ).toBeVisible();
        await assertRuntimeIdentity(page, info, locale, "teenA");
        await assertFixtureIdentity(page, "teenA");
      } finally {
        controls.releaseUpload?.();
        controls.releaseCreate?.();
        await page.unrouteAll({ behavior: "ignoreErrors" });
        await context.unrouteAll({ behavior: "ignoreErrors" });
      }
      expect(blockedWrites).toEqual([]);
    });
  });

  test.describe(`${locale} child list create refusal`, () => {
    test.use({ storageState: authFile("childA") });

    test(`${locale}: child sees the localized parent handoff without a create form`, async ({
      page,
      context,
      baseURL,
    }, info) => {
      test.skip(
        !PROJECT_NAMES.has(info.project.name),
        "all configured device sizes are covered",
      );
      assertFixtureTargetAllowed(process.env);
      expect([...LOOPBACK_HOSTS]).toContain(new URL(baseURL!).hostname);
      const blockedWrites: string[] = [];
      await installLoopbackGuard(context, blockedWrites);
      await page.addInitScript(
        ({ key, value }) => localStorage.setItem(key, value),
        { key: LOCALE_STORAGE_KEY, value: locale },
      );
      try {
        const copy = copyFor(locale);
        await page.goto("/dashboard/lists");
        await expect(
          page.getByRole("link", {
            name:
              locale === "en"
                ? listOverviewEnglish.add
                : listOverviewSpanish.add,
          }),
        ).toHaveCount(0);
        await page.goto("/dashboard/lists/create");
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await assertRuntimeIdentity(page, info, locale, "childA");
        await assertFixtureIdentity(page, "childA");
        const refused = page.getByTestId("list-create-refused");
        await expect(refused).toBeVisible();
        await expect(refused).toContainText(copy.refusalTitle);
        await expect(refused).toContainText(copy.refusalDescription);
        await expect(
          refused.getByRole("link", { name: copy.back }),
        ).toHaveAttribute("href", "/dashboard/lists");
        await expect(page.getByLabel(copy.name)).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: copy.create }),
        ).toHaveCount(0);
      } finally {
        await page.unrouteAll({ behavior: "ignoreErrors" });
        await context.unrouteAll({ behavior: "ignoreErrors" });
      }
      expect(blockedWrites).toEqual([]);
    });
  });
}
