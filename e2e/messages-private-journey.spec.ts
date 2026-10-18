/**
 * #499 Messages private journey.
 *
 * The mutation cases use the real Messages and attachment routes. Transport
 * failures only drop the first response after the server has completed it;
 * the retry therefore proves the production idempotency receipt rather than a
 * fabricated success body. Every created message, upload, receipt and pickup
 * is tracked and removed by an exact guarded cleanup.
 */
import AxeBuilder from "@axe-core/playwright";
import type {
  APIRequestContext,
  Browser,
  BrowserContext,
  Page,
  PlaywrightWorkerArgs,
  TestInfo,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { messagesEnglish, messagesSpanish } from "../src/i18n/messages";
import {
  FIXTURE_EMAILS,
  FIXTURE_IDS,
  FIXTURE_LONG_TEXT,
  FIXTURE_PASSWORD,
} from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { E2E_ANCHOR, authFile } from "./support/env";
import { ownFeatureAudit } from "./support/feature-audit";
import {
  removeOwnedMessageArtifacts,
  type OwnedMessage,
  type OwnedMessageAttachment,
  type OwnedMessageReceipt,
} from "./support/messages-cleanup";
import { browserFetch, browserSend, expect, test } from "./support/test";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PRIMARY_PROJECTS = new Set(["phone-390x844", "desktop-1366x768"]);
const STATE_PROJECTS = new Set([
  "phone-430x932",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
  "tablet-large-1920x1200",
]);
const ROLE_PROJECT = "desktop-1366x768";
const A = FIXTURE_IDS.familyA;
type Locale = "en" | "es";
type Role = "childA" | "teenA";
type PlaywrightFixture = PlaywrightWorkerArgs["playwright"];

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test.use({ storageState: authFile("parentA") });
test.describe.configure({ mode: "serial" });

function copyFor(locale: Locale) {
  return locale === "es" ? messagesSpanish : messagesEnglish;
}

function projectIndex(info: TestInfo): number {
  const names = [
    "phone-390x844",
    "phone-430x932",
    "tablet-portrait-800x1280",
    "fridge-landscape-1280x800",
    "tablet-large-1920x1200",
    "desktop-1366x768",
  ];
  return Math.max(0, names.indexOf(info.project.name));
}

async function installLocale(context: BrowserContext, locale: Locale) {
  await context.addInitScript(
    ({ key, language }) => localStorage.setItem(key, language),
    { key: LOCALE_STORAGE_KEY, language: locale },
  );
}

async function installLoopbackGuard(context: BrowserContext) {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      LOOPBACK_HOSTS.has(url.hostname) ||
      url.protocol === "data:" ||
      url.protocol === "blob:"
    ) {
      await route.continue();
    } else {
      await route.abort();
    }
  });
}

async function assertSurface(page: Page, locale: Locale, populated: boolean) {
  const copy = copyFor(locale);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(
    page.getByRole("heading", { name: copy.title, exact: true }),
  ).toBeVisible();
  if (populated) {
    expect(
      await page.locator("[data-testid='messages-load-error']").count(),
    ).toBe(0);
  }
  const violations = (
    await new AxeBuilder({ page }).include("#main-content").analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= window.innerWidth &&
        document.body.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

async function assertTargetSize(locator: ReturnType<Page["getByRole"]>) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

function csrfFromAuthFile(who: "childA" | "parentB"): string {
  const state = JSON.parse(fs.readFileSync(authFile(who), "utf8")) as {
    cookies?: Array<{ name: string; value: string }>;
  };
  return (
    state.cookies?.find((cookie) => cookie.name === "csrf_token")?.value ?? ""
  );
}

async function loginTeen(
  playwright: PlaywrightFixture,
  baseURL: string | undefined,
  info: TestInfo,
): Promise<Awaited<ReturnType<APIRequestContext["storageState"]>>> {
  const request = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: {
      "X-Forwarded-For": `198.51.100.${180 + projectIndex(info)}`,
    },
  });
  try {
    const response = await request.post("/api/auth/login", {
      data: {
        email: FIXTURE_EMAILS.familyA.teen,
        password: FIXTURE_PASSWORD,
      },
    });
    expect(response.status(), await response.text()).toBe(200);
    return await request.storageState();
  } finally {
    await request.dispose();
  }
}

async function openRole(
  browser: Browser,
  baseURL: string | undefined,
  info: TestInfo,
  locale: Locale,
  storageState: string | Awaited<ReturnType<APIRequestContext["storageState"]>>,
) {
  const use = info.project.use as {
    viewport?: { width: number; height: number };
    hasTouch?: boolean;
    isMobile?: boolean;
  };
  const context = await browser.newContext({
    baseURL,
    storageState,
    viewport: use.viewport,
    hasTouch: use.hasTouch,
    isMobile: use.isMobile,
    deviceScaleFactor: 1,
    locale: locale === "es" ? "es-ES" : "en-US",
    timezoneId: "America/Toronto",
    extraHTTPHeaders: {
      "X-Forwarded-For": `198.51.100.${200 + projectIndex(info)}`,
    },
  });
  await installLocale(context, locale);
  await installLoopbackGuard(context);
  const page = await context.newPage();
  await page.clock.install({ time: E2E_ANCHOR });
  return { context, page };
}

async function createChildMessage(
  playwright: PlaywrightFixture,
  baseURL: string | undefined,
  info: TestInfo,
  content: string,
) {
  const request = await playwright.request.newContext({
    baseURL,
    storageState: authFile("childA"),
    extraHTTPHeaders: {
      "X-Forwarded-For": `198.51.100.${220 + projectIndex(info)}`,
    },
  });
  const key = `e2e-message-${randomUUID()}`;
  try {
    const response = await request.post("/api/messages", {
      headers: {
        "X-CSRF-Token": csrfFromAuthFile("childA"),
        "Idempotency-Key": key,
      },
      data: {
        content,
        type: "text",
        attachment_ids: [],
      },
    });
    const body = await response.text();
    expect(response.status(), body).toBe(200);
    const parsed = JSON.parse(body) as { message?: { id?: string } };
    expect(typeof parsed.message?.id).toBe("string");
    return { id: parsed.message!.id!, key };
  } finally {
    await request.dispose();
  }
}

async function createPickup(page: Page, title: string) {
  const response = await browserSend(page, "POST", "/api/pickups", {
    title,
    pickup_time: new Date(
      E2E_ANCHOR.getTime() + 2 * 60 * 60 * 1000,
    ).toISOString(),
    location: "Fixture school",
    notes: "Owned Messages E2E pickup",
    assigned_to: A.child,
  });
  expect(response.status, response.body).toBe(201);
  const parsed = JSON.parse(response.body) as { pickup?: { id?: string } };
  expect(typeof parsed.pickup?.id).toBe("string");
  return parsed.pickup!.id!;
}

test.describe("Messages private send and recovery", () => {
  for (const locale of ["en", "es"] as const) {
    test(`${locale}: sends one real photo message, retries the same receipt, and recovers reads`, async ({
      page,
      context,
      browser,
      baseURL,
      playwright,
    }, info) => {
      test.skip(
        !PRIMARY_PROJECTS.has(info.project.name),
        "Transport and upload recovery runs once on phone and desktop; the other four sizes keep the state matrix below.",
      );
      assertFixtureTargetAllowed(process.env);
      expect(LOOPBACK_HOSTS.has(new URL(baseURL!).hostname)).toBe(true);
      await installLocale(context, locale);
      await installLoopbackGuard(context);

      const copy = copyFor(locale);
      const runId = randomUUID();
      const childContent = `Messages read recovery ${runId}`;
      const parentContent = `${FIXTURE_LONG_TEXT.description} Messages retry ${runId}`;
      const pickupTitle = `Messages E2E pickup ${runId}`;
      const ownedMessages: OwnedMessage[] = [];
      const ownedAttachments: OwnedMessageAttachment[] = [];
      const ownedReceipts: OwnedMessageReceipt[] = [];
      let pickupId: string | undefined;
      let attachmentId: string | undefined;
      let parentMessageId: string | undefined;
      let originalFeatures: Record<string, boolean> | undefined;
      let cleanAudit: ((restored: boolean) => Promise<void>) | undefined;
      let restored = false;
      let attachmentDraftStatus: number | undefined;
      let readAttempts = 0;
      let sendAttempts = 0;
      let sendKeys: string[] = [];
      let replayHeader: string | null = null;
      let childRequestResult: { id: string; key: string } | undefined;
      let attachmentRoute:
        | ((route: import("@playwright/test").Route) => Promise<void>)
        | undefined;
      let messagesRoute:
        | ((route: import("@playwright/test").Route) => Promise<void>)
        | undefined;

      try {
        await page.goto("/dashboard");
        const featuresResponse = await browserFetch(
          page,
          "/api/family/features",
        );
        expect(featuresResponse.status, featuresResponse.body).toBe(200);
        originalFeatures = (
          JSON.parse(featuresResponse.body) as {
            features: Record<string, boolean>;
          }
        ).features;
        cleanAudit = await ownFeatureAudit(["messages", "pickups"]);
        const enabled = await browserSend(
          page,
          "PATCH",
          "/api/family/features",
          {
            features: { ...originalFeatures, messages: true, pickups: true },
          },
        );
        expect(enabled.status, enabled.body).toBe(200);

        pickupId = await createPickup(page, pickupTitle);
        childRequestResult = await createChildMessage(
          playwright,
          baseURL,
          info,
          childContent,
        );
        ownedMessages.push({
          id: childRequestResult.id,
          familyId: A.family,
          senderId: A.child,
          content: childContent,
        });
        ownedReceipts.push({ key: childRequestResult.key, userId: A.child });

        attachmentRoute = async (route) => {
          if (route.request().method() !== "POST") {
            await route.continue();
            return;
          }
          const upstream = await route.fetch();
          const body = await upstream.body();
          const parsed = JSON.parse(body.toString()) as {
            attachment?: { id?: string };
          };
          expect(upstream.status()).toBe(201);
          expect(typeof parsed.attachment?.id).toBe("string");
          attachmentId = parsed.attachment!.id!;
          ownedAttachments.push({
            id: attachmentId,
            familyId: A.family,
            uploadedBy: A.parent,
            messageId: null,
          });
          attachmentDraftStatus = await page.evaluate(async (id) => {
            const response = await fetch(`/api/messages/attachments/${id}`, {
              cache: "no-store",
            });
            return response.status;
          }, attachmentId);
          await route.fulfill({
            status: upstream.status(),
            headers: upstream.headers(),
            body,
          });
        };
        await page.route("**/api/messages/attachments", attachmentRoute);

        messagesRoute = async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.pathname !== "/api/messages") {
            await route.continue();
            return;
          }
          if (request.method() === "PATCH") {
            readAttempts += 1;
            if (readAttempts === 1) {
              const upstream = await route.fetch();
              await upstream.body();
              await route.abort("failed");
              return;
            }
            await route.continue();
            return;
          }
          if (request.method() !== "POST") {
            await route.continue();
            return;
          }
          sendAttempts += 1;
          sendKeys = [...sendKeys, request.headers()["idempotency-key"] ?? ""];
          if (sendAttempts === 1) {
            const upstream = await route.fetch();
            await upstream.body();
            await route.abort("failed");
            return;
          }
          const upstream = await route.fetch();
          replayHeader = upstream.headers()["idempotency-replayed"] ?? null;
          await route.fulfill({ response: upstream });
        };
        await page.route("**/api/messages", messagesRoute);

        await page.goto("/dashboard/messages");
        await assertSurface(page, locale, true);
        await expect(
          page.getByText(childContent, { exact: true }),
        ).toBeVisible();

        const readRecovery = page.getByTestId("messages-read-recovery");
        await expect(readRecovery).toBeVisible();
        await readRecovery
          .getByRole("button", { name: copy.retryRead, exact: true })
          .click();
        await expect(readRecovery).toHaveCount(0);
        expect(readAttempts).toBe(2);

        const pickupButton = page.getByRole("button", {
          name: copy.linkPickup,
          exact: true,
        });
        await assertTargetSize(pickupButton);
        await pickupButton.click();
        const pickupSelect = page.getByRole("combobox", {
          name: copy.linkPickup,
        });
        await expect(pickupSelect).toBeVisible();
        await pickupSelect.selectOption(pickupId);

        const photoInput = page
          .getByLabel(copy.addPhoto, { exact: true })
          .and(page.locator('input[type="file"]'));
        await photoInput.setInputFiles({
          name: "family-note.png",
          mimeType: "image/png",
          buffer: ONE_PIXEL_PNG,
        });
        await page
          .getByLabel(copy.messageTextLabel, { exact: true })
          .fill(parentContent);
        const sendButton = page.getByRole("button", {
          name: copy.send,
          exact: true,
        });
        await assertTargetSize(sendButton);
        await sendButton.click();
        await expect(
          page.getByRole("alert").filter({ hasText: copy.sendNetworkError }),
        ).toBeVisible();
        await expect(
          page.getByLabel(copy.messageTextLabel, { exact: true }),
        ).toHaveValue(parentContent);
        await sendButton.click();
        await expect(
          page.getByText(parentContent, { exact: true }),
        ).toBeVisible();

        expect(sendAttempts).toBe(2);
        expect(sendKeys[0]).toBeTruthy();
        expect(sendKeys[0]).toBe(sendKeys[1]);
        expect(replayHeader).toBe("true");
        expect(attachmentDraftStatus).toBe(404);
        expect(attachmentId).toBeTruthy();
        await expect(
          page.getByAltText(copy.photoAttachment, { exact: true }),
        ).toBeVisible();

        const current = await browserFetch(page, "/api/messages");
        expect(current.status, current.body).toBe(200);
        const listed = JSON.parse(current.body) as {
          messages: Array<{
            id: string;
            content: string;
            sender_id: string;
            attachments?: string[];
          }>;
        };
        const matching = listed.messages.filter(
          (message) => message.content === parentContent,
        );
        expect(matching).toHaveLength(1);
        parentMessageId = matching[0].id;
        expect(matching[0].sender_id).toBe(A.parent);
        expect(matching[0].attachments).toEqual([
          `/api/messages/attachments/${attachmentId}`,
        ]);
        ownedMessages.push({
          id: parentMessageId,
          familyId: A.family,
          senderId: A.parent,
          content: parentContent,
        });
        ownedReceipts.push({ key: sendKeys[0], userId: A.parent });
        if (ownedAttachments[0])
          ownedAttachments[0].messageId = parentMessageId;

        const ownedImageStatus = await page.evaluate(async (id) => {
          const response = await fetch(`/api/messages/attachments/${id}`, {
            cache: "no-store",
          });
          return response.status;
        }, attachmentId);
        expect(ownedImageStatus).toBe(200);

        const foreign = await playwright.request.newContext({
          baseURL,
          storageState: authFile("parentB"),
          extraHTTPHeaders: {
            "X-Forwarded-For": `198.51.100.${240 + projectIndex(info)}`,
          },
        });
        try {
          const foreignResponse = await foreign.get(
            `/api/messages/attachments/${attachmentId}`,
          );
          expect(foreignResponse.status(), await foreignResponse.text()).toBe(
            404,
          );
        } finally {
          await foreign.dispose();
        }

        await info.attach(`messages-${locale}-${info.project.name}`, {
          body: await page.screenshot({ fullPage: false }),
          contentType: "image/png",
        });
      } finally {
        if (messagesRoute) await page.unroute("**/api/messages", messagesRoute);
        if (attachmentRoute) {
          await page.unroute("**/api/messages/attachments", attachmentRoute);
        }
        try {
          if (parentMessageId === undefined) {
            const current = await browserFetch(page, "/api/messages");
            if (current.status === 200) {
              const listed = JSON.parse(current.body) as {
                messages?: Array<{
                  id: string;
                  content: string;
                  sender_id: string;
                }>;
              };
              const match = listed.messages?.find(
                (message) => message.content === parentContent,
              );
              if (match) {
                parentMessageId = match.id;
                ownedMessages.push({
                  id: match.id,
                  familyId: A.family,
                  senderId: match.sender_id,
                  content: parentContent,
                });
                if (sendKeys[0])
                  ownedReceipts.push({
                    key: sendKeys[0],
                    userId: match.sender_id,
                  });
                if (ownedAttachments[0])
                  ownedAttachments[0].messageId = match.id;
              }
            }
          }
          await removeOwnedMessageArtifacts({
            messages: ownedMessages,
            attachments: ownedAttachments,
            receipts: ownedReceipts,
          });
          if (pickupId) {
            const deletedPickup = await browserSend(
              page,
              "DELETE",
              `/api/pickups/${pickupId}`,
            );
            expect(deletedPickup.status, deletedPickup.body).toBe(200);
          }
          if (originalFeatures) {
            const restoredResponse = await browserSend(
              page,
              "PATCH",
              "/api/family/features",
              { features: originalFeatures },
            );
            expect(restoredResponse.status, restoredResponse.body).toBe(200);
            const canonical = await browserFetch(page, "/api/family/features");
            expect(canonical.status, canonical.body).toBe(200);
            expect(
              (
                JSON.parse(canonical.body) as {
                  features: Record<string, boolean>;
                }
              ).features,
            ).toEqual(originalFeatures);
            restored = true;
          }
        } finally {
          if (cleanAudit) await cleanAudit(restored);
        }
      }
    });
  }
});

test.describe("Messages responsive states", () => {
  for (const locale of ["en", "es"] as const) {
    test(`${locale}: populated long text and real empty household remain readable`, async ({
      page,
      context,
      browser,
      baseURL,
      playwright,
    }, info) => {
      test.skip(
        !STATE_PROJECTS.has(info.project.name),
        "The populated/empty state matrix covers the four non-transport sizes.",
      );
      assertFixtureTargetAllowed(process.env);
      await installLocale(context, locale);
      await installLoopbackGuard(context);
      const runId = randomUUID();
      const longContent = `${FIXTURE_LONG_TEXT.description} State ${runId}`;
      const ownedMessages: OwnedMessage[] = [];
      const ownedReceipts: OwnedMessageReceipt[] = [];
      let originalFeatures: Record<string, boolean> | undefined;
      let cleanAudit: ((restored: boolean) => Promise<void>) | undefined;
      let restored = false;
      let childMessage: { id: string; key: string } | undefined;
      try {
        await page.goto("/dashboard");
        const featuresResponse = await browserFetch(
          page,
          "/api/family/features",
        );
        expect(featuresResponse.status, featuresResponse.body).toBe(200);
        originalFeatures = (
          JSON.parse(featuresResponse.body) as {
            features: Record<string, boolean>;
          }
        ).features;
        cleanAudit = await ownFeatureAudit(["messages", "pickups"]);
        const enabled = await browserSend(
          page,
          "PATCH",
          "/api/family/features",
          {
            features: { ...originalFeatures, messages: true, pickups: true },
          },
        );
        expect(enabled.status, enabled.body).toBe(200);

        childMessage = await createChildMessage(
          playwright,
          baseURL,
          info,
          longContent,
        );
        ownedMessages.push({
          id: childMessage.id,
          familyId: A.family,
          senderId: A.child,
          content: longContent,
        });
        ownedReceipts.push({ key: childMessage.key, userId: A.child });

        await page.goto("/dashboard/messages");
        await assertSurface(page, locale, true);
        await expect(
          page.getByText(longContent, { exact: true }),
        ).toBeVisible();
        await assertTargetSize(
          page.getByRole("button", {
            name: copyFor(locale).linkPickup,
            exact: true,
          }),
        );
        await assertTargetSize(
          page.getByRole("button", { name: copyFor(locale).send, exact: true }),
        );
        await info.attach(`messages-populated-${locale}-${info.project.name}`, {
          body: await page.screenshot({ fullPage: false }),
          contentType: "image/png",
        });

        const emptyContext = await browser.newContext({
          baseURL,
          storageState: authFile("parentB"),
          viewport: info.project.use.viewport as {
            width: number;
            height: number;
          },
          hasTouch: info.project.use.hasTouch as boolean,
          isMobile: info.project.use.isMobile as boolean,
          deviceScaleFactor: 1,
          locale: locale === "es" ? "es-ES" : "en-US",
          timezoneId: "America/Toronto",
          extraHTTPHeaders: {
            "X-Forwarded-For": `198.51.100.${250 + projectIndex(info)}`,
          },
        });
        await installLocale(emptyContext, locale);
        await installLoopbackGuard(emptyContext);
        const emptyPage = await emptyContext.newPage();
        await emptyPage.clock.install({ time: E2E_ANCHOR });
        try {
          await emptyPage.goto("/dashboard/messages");
          await assertSurface(emptyPage, locale, false);
          await expect(
            emptyPage.getByRole("heading", {
              name: copyFor(locale).emptyTitle,
              exact: true,
            }),
          ).toBeVisible();
          await info.attach(`messages-empty-${locale}-${info.project.name}`, {
            body: await emptyPage.screenshot({ fullPage: false }),
            contentType: "image/png",
          });
        } finally {
          await emptyContext.close();
        }
      } finally {
        try {
          await removeOwnedMessageArtifacts({
            messages: ownedMessages,
            attachments: [],
            receipts: ownedReceipts,
          });
        } finally {
          try {
            if (originalFeatures) {
              const restoredResponse = await browserSend(
                page,
                "PATCH",
                "/api/family/features",
                { features: originalFeatures },
              );
              expect(restoredResponse.status, restoredResponse.body).toBe(200);
              const canonical = await browserFetch(
                page,
                "/api/family/features",
              );
              expect(canonical.status, canonical.body).toBe(200);
              expect(
                (
                  JSON.parse(canonical.body) as {
                    features: Record<string, boolean>;
                  }
                ).features,
              ).toEqual(originalFeatures);
              restored = true;
            }
          } finally {
            if (cleanAudit) await cleanAudit(restored);
          }
        }
      }
    });
  }
});

test.describe("Messages role and API boundary", () => {
  for (const locale of ["en", "es"] as const) {
    test(`${locale}: child and teen stay out of the web screen but retain member API access`, async ({
      page,
      context,
      browser,
      baseURL,
      playwright,
    }, info) => {
      test.skip(
        info.project.name !== ROLE_PROJECT,
        "Role boundary runs once at the desktop surface; API isolation remains covered by route tests.",
      );
      assertFixtureTargetAllowed(process.env);
      await installLocale(context, locale);
      await installLoopbackGuard(context);
      let originalFeatures: Record<string, boolean> | undefined;
      let cleanAudit: ((restored: boolean) => Promise<void>) | undefined;
      let restored = false;
      try {
        await page.goto("/dashboard");
        const featuresResponse = await browserFetch(
          page,
          "/api/family/features",
        );
        expect(featuresResponse.status, featuresResponse.body).toBe(200);
        originalFeatures = (
          JSON.parse(featuresResponse.body) as {
            features: Record<string, boolean>;
          }
        ).features;
        cleanAudit = await ownFeatureAudit(["messages"]);
        const enabled = await browserSend(
          page,
          "PATCH",
          "/api/family/features",
          {
            features: { ...originalFeatures, messages: true },
          },
        );
        expect(enabled.status, enabled.body).toBe(200);

        const teenState = await loginTeen(playwright, baseURL, info);
        const roles: Array<{
          role: Role;
          state:
            string | Awaited<ReturnType<APIRequestContext["storageState"]>>;
          id: string;
        }> = [
          { role: "childA", state: authFile("childA"), id: A.child },
          { role: "teenA", state: teenState, id: A.teen },
        ];
        for (const { role, state, id } of roles) {
          const opened = await openRole(browser, baseURL, info, locale, state);
          try {
            await opened.page.goto("/dashboard/messages");
            await expect(opened.page).toHaveURL(/\/dashboard\/?$/);
            await expect(
              opened.page.getByRole("heading", {
                name: copyFor(locale).title,
                exact: true,
              }),
            ).toHaveCount(0);
            const listed = await browserFetch(opened.page, "/api/messages");
            expect(listed.status, listed.body).toBe(200);
            const body = JSON.parse(listed.body) as {
              userId: string;
              messages: Array<{ pickup?: Record<string, unknown> | null }>;
            };
            expect(body.userId).toBe(id);
            for (const message of body.messages) {
              if (message.pickup) {
                expect(message.pickup).not.toHaveProperty("location");
                expect(message.pickup).not.toHaveProperty("notes");
              }
            }
            const markedRead = await browserSend(
              opened.page,
              "PATCH",
              "/api/messages",
              { messageIds: [] },
            );
            expect(markedRead.status, markedRead.body).toBe(200);
            await info.attach(`messages-role-${role}-${locale}`, {
              body: await opened.page.screenshot({ fullPage: false }),
              contentType: "image/png",
            });
          } finally {
            await opened.context.close();
          }
        }
      } finally {
        try {
          if (originalFeatures) {
            const restoredResponse = await browserSend(
              page,
              "PATCH",
              "/api/family/features",
              { features: originalFeatures },
            );
            expect(restoredResponse.status, restoredResponse.body).toBe(200);
            const canonical = await browserFetch(page, "/api/family/features");
            expect(canonical.status, canonical.body).toBe(200);
            expect(
              (
                JSON.parse(canonical.body) as {
                  features: Record<string, boolean>;
                }
              ).features,
            ).toEqual(originalFeatures);
            restored = true;
          }
        } finally {
          if (cleanAudit) await cleanAudit(restored);
        }
      }
    });
  }
});
