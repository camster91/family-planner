/**
 * #472: rendered recovery for a capture whose write response is lost.
 *
 * The first test commits a real, fixture-scoped event through the canonical
 * API, aborts only the browser's response, then verifies receipt state after
 * reload and after deletion. Unknown and absent receipt states are explicitly
 * synthetic transport responses: they exercise the rendered safety behavior
 * without fabricating a database row or replaying a production write.
 *
 * The photo test uses synthetic capture/creation transports because the image
 * parser is provider-backed and this spec must not enable a paid provider.
 * It proves partial rows, reload-without-replay, and terminal absent recovery.
 */
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import type { CaptureRecoveryEnvelope } from "../src/lib/capture-recovery";
import { captureRecoveryStorageKey } from "../src/lib/capture-recovery";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { authFile } from "./support/env";
import { browserFetch, browserSend, expect, test } from "./support/test";

test.use({ storageState: authFile("parentA"), timezoneId: "America/Toronto" });

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PROJECT_NAMES = new Set([
  "phone-390x844",
  "phone-430x932",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
  "tablet-large-1920x1200",
  "desktop-1366x768",
]);

// The events API defaults to a rolling last-30-days window. The capture
// fixture event is Jan 6, 2026, so cleanup and marker assertions use the
// documented bounded range endpoint around the fixed E2E anchor.
const CAPTURE_EVENT_RANGE =
  "/api/events?start=2026-01-05T00%3A00%3A00.000Z&end=2026-01-12T00%3A00%3A00.000Z&limit=200";

interface RuntimeIdentity {
  runtime: { version: string; commit: string; builtAt: string };
  buildId: string;
  buildTree: string;
  locale: "en";
  role: "parent";
}

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

function assertCleanTrackedAppSource(): void {
  expect(() =>
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "prisma"], {
      stdio: "ignore",
    }),
  ).not.toThrow();
}

async function runtimeIdentity(
  page: Page,
  info: TestInfo,
): Promise<RuntimeIdentity> {
  const head = sourceHead();
  expect(head).toMatch(/^[a-f0-9]{40}$/);
  expect(process.env.RELEASE_SHA?.trim()).toBe(head);
  assertCleanTrackedAppSource();

  const tree = sourceTree();
  expect(tree).toMatch(/^[a-f0-9]{40}$/);
  const configuredTree = process.env.E2E_CAPTURE_BUILD_TREE?.trim();
  if (configuredTree) expect(configuredTree).toBe(tree);

  const response = await browserFetch(page, "/api/version");
  expect(response.status, response.body).toBe(200);
  const runtime = JSON.parse(response.body) as RuntimeIdentity["runtime"];
  expect(runtime.commit).toBe(head);
  expect(runtime.builtAt).toBe(compiledBuiltAt());

  const identity: RuntimeIdentity = {
    runtime,
    buildId: fs.readFileSync(".next/BUILD_ID", "utf8").trim(),
    buildTree: tree,
    locale: "en",
    role: "parent",
  };
  expect(identity.buildId).not.toBe("");
  await info.attach("actual-capture-runtime-identity", {
    body: JSON.stringify({
      ...identity,
      configuredBuildTree: configuredTree ?? null,
      captureTransport: "loopback synthetic parser response",
      eventTransport: "actual fixture event write; browser response aborted",
      receiptUnknownAndAbsent: "synthetic loopback receipt responses",
    }),
    contentType: "application/json",
  });
  return identity;
}

async function checkActionGeometry(page: Page, action: Locator): Promise<void> {
  const box = await action.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
  expect(
    await action.evaluate((element) => {
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

async function captureState(
  page: Page,
  info: TestInfo,
  identity: RuntimeIdentity,
  state: string,
): Promise<void> {
  const overflowFree = await page.evaluate(
    () => document.documentElement.scrollWidth <= innerWidth,
  );
  const violations = (
    await new AxeBuilder({ page }).include("#main-content").analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  const recovery = page.getByTestId("capture-recovery");
  if (await recovery.count()) {
    for (const action of await recovery.getByRole("button").all()) {
      await checkActionGeometry(page, action);
    }
  }
  await info.attach(`${state}-source-identity`, {
    body: JSON.stringify({ identity, state, overflowFree, violations }),
    contentType: "application/json",
  });
  await info.attach(`${state}-axe`, {
    body: JSON.stringify(violations),
    contentType: "application/json",
  });
  await page.screenshot({
    path: info.outputPath(`capture-recovery-${state}.png`),
    fullPage: true,
    animations: "disabled",
  });
  expect(overflowFree).toBe(true);
  expect(violations).toEqual([]);
}

async function installLoopbackNetworkGuard(
  context: BrowserContext,
): Promise<void> {
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

interface CaptureTransport {
  captureReady: Promise<void>;
}

async function installCaptureTransport(
  page: Page,
  userId: string,
  familyId: string,
  eventTitle: string,
): Promise<CaptureTransport> {
  let resolveCaptureReady!: () => void;
  const captureReady = new Promise<void>((resolve) => {
    resolveCaptureReady = resolve;
  });

  await page.route("**/api/capture", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname !== "/api/capture") {
      await route.continue();
      return;
    }
    if (request.method() === "GET") {
      resolveCaptureReady();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          configured: true,
          allowed: true,
          userId,
          familyId,
        }),
      });
      return;
    }
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }

    const body = request.postDataJSON() as Record<string, unknown> | null;
    if (body && typeof body.imageBase64 === "string") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          image: {
            events: [
              {
                title: "Synthetic photo success",
                start_time: "2026-01-06T19:00:00.000Z",
              },
              {
                title: "Synthetic photo failure",
                start_time: "2026-01-06T20:00:00.000Z",
              },
            ],
            note: "Synthetic parser response; no provider enabled.",
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        draft: {
          kind: "event",
          title: eventTitle,
          start_time: "2026-01-06T19:00:00.000Z",
          confidence: "high",
        },
      }),
    });
  });

  return { captureReady };
}

async function fixtureIdentity(page: Page): Promise<{
  userId: string;
  familyId: string;
}> {
  const response = await browserFetch(page, "/api/auth/me");
  expect(response.status, response.body).toBe(200);
  const data = JSON.parse(response.body) as {
    user?: { id?: unknown; family_id?: unknown };
  };
  const userId = data.user?.id;
  const familyId = data.user?.family_id;
  expect(typeof userId).toBe("string");
  expect(typeof familyId).toBe("string");
  return { userId: String(userId), familyId: String(familyId) };
}

async function readEnvelope(
  page: Page,
  storageKey: string,
): Promise<CaptureRecoveryEnvelope> {
  const envelope = await page.evaluate((key) => {
    const rows = JSON.parse(
      window.localStorage.getItem(key) ?? "[]",
    ) as unknown;
    return Array.isArray(rows) ? rows[0] : undefined;
  }, storageKey);
  expect(envelope).toBeTruthy();
  return envelope as CaptureRecoveryEnvelope;
}

async function restoreEnvelope(
  page: Page,
  storageKey: string,
  envelope: CaptureRecoveryEnvelope,
): Promise<void> {
  await page.evaluate(
    ({ key, value }) =>
      window.localStorage.setItem(key, JSON.stringify([value])),
    { key: storageKey, value: envelope },
  );
}

async function discoverOwnedCaptureEvents(
  page: Page,
  fixture: FixtureEventIdentity,
  title: string,
): Promise<string[]> {
  const list = await browserFetch(page, CAPTURE_EVENT_RANGE);
  expect(list.status, list.body).toBe(200);
  const data = JSON.parse(list.body) as { events?: unknown };
  if (!Array.isArray(data.events)) {
    throw new Error("Capture event query did not return an events array");
  }
  return data.events.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const event = value as {
      id?: unknown;
      title?: unknown;
      creator?: { id?: unknown } | null;
    };
    return event.title === title &&
      event.creator?.id === fixture.userId &&
      typeof event.id === "string"
      ? [event.id]
      : [];
  });
}

interface FixtureEventIdentity {
  userId: string;
  familyId: string;
}

/**
 * Teardown is deliberately fixture-scoped and marker-scoped. The server may
 * commit before a connection-reset response lets the route handler read the
 * returned id, so discovery is a required fallback rather than an optional
 * convenience. Every candidate is re-read and must still belong to the
 * authenticated parent and exact marker before DELETE.
 */
async function cleanupOwnedCaptureEvents(
  page: Page,
  info: TestInfo,
  fixture: FixtureEventIdentity,
  title: string,
  knownEventId: string | null,
): Promise<void> {
  assertFixtureTargetAllowed(process.env);
  expect(fixture.userId).toBe(FIXTURE_IDS.familyA.parent);
  expect(fixture.familyId).toBe(FIXTURE_IDS.familyA.family);

  // Seed the response-observed id before discovery. If the bounded listing is
  // transiently unavailable, the committed response can still be verified and
  // removed safely by this independent detail read.
  const candidateIds = new Set<string>();
  if (knownEventId) candidateIds.add(knownEventId);
  const cleanupErrors: string[] = [];
  try {
    for (const candidateId of await discoverOwnedCaptureEvents(
      page,
      fixture,
      title,
    )) {
      candidateIds.add(candidateId);
    }
  } catch (error) {
    cleanupErrors.push(
      `marker discovery: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const deleted: string[] = [];
  // Every candidate is isolated so a bad detail read/delete cannot strand the
  // other exact-marker rows. Each candidate is re-read and must still belong
  // to the authenticated parent before DELETE.
  for (const candidateId of candidateIds) {
    try {
      const detail = await browserFetch(
        page,
        `/api/events?id=${encodeURIComponent(candidateId)}`,
      );
      if (detail.status === 404) continue;
      expect(detail.status, detail.body).toBe(200);
      const detailData = JSON.parse(detail.body) as {
        event?: {
          id?: unknown;
          title?: unknown;
          creator?: { id?: unknown } | null;
        };
      };
      const event = detailData.event;
      if (
        !event ||
        event.id !== candidateId ||
        event.title !== title ||
        event.creator?.id !== fixture.userId
      ) {
        throw new Error(
          `Capture cleanup refused event ${candidateId}: marker/owner mismatch`,
        );
      }
      const response = await browserSend(page, "DELETE", "/api/events", {
        eventId: candidateId,
      });
      if (response.status !== 200 && response.status !== 404) {
        throw new Error(
          `Capture cleanup failed for ${candidateId}: ${response.status}`,
        );
      }
      deleted.push(candidateId);
    } catch (error) {
      cleanupErrors.push(
        `event ${candidateId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  await info.attach("capture-event-cleanup", {
    body: JSON.stringify({
      fixtureFamily: fixture.familyId,
      fixtureUser: fixture.userId,
      marker: title,
      knownEventId,
      discoveredCandidates: [...candidateIds],
      deleted,
      cleanupErrors,
    }),
    contentType: "application/json",
  });
  if (cleanupErrors.length) {
    throw new Error(
      `Capture event cleanup failed: ${cleanupErrors.join("; ")}`,
    );
  }
}

function assertFixtureAndLoopback(baseURL: string | undefined): void {
  assertFixtureTargetAllowed(process.env);
  expect(baseURL).toBeTruthy();
  expect(LOOPBACK_HOSTS.has(new URL(baseURL!).hostname)).toBe(true);
}

test.describe("capture receipt recovery", () => {
  test("committed event recovery survives reload, deletion and terminal receipt states", async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.skip(
      !PROJECT_NAMES.has(info.project.name),
      "Capture receipt recovery runs at the six representative responsive sizes",
    );
    assertFixtureAndLoopback(baseURL);
    await installLoopbackNetworkGuard(context);

    await page.goto("/dashboard");
    const fixture = await fixtureIdentity(page);
    expect(fixture.userId).toBe(FIXTURE_IDS.familyA.parent);
    expect(fixture.familyId).toBe(FIXTURE_IDS.familyA.family);
    const eventTitle = `Capture receipt ${info.project.name} ${randomUUID()}`;
    const { userId, familyId } = fixture;
    const { captureReady } = await installCaptureTransport(
      page,
      userId,
      familyId,
      eventTitle,
    );
    await page.goto("/dashboard/calendar");
    await captureReady;
    await expect(
      page.getByRole("heading", { name: "Quick add", exact: true }),
    ).toBeVisible();
    const identity = await runtimeIdentity(page, info);
    const storageKey = captureRecoveryStorageKey(userId, familyId);

    let eventPostCount = 0;
    let createdEventId: string | null = null;
    const serverEventIds: string[] = [];
    const eventRequests: Array<{ key?: string; body?: string }> = [];
    let receiptMode: "actual" | "unknown" | "absent" = "actual";
    await page.route("**/api/events", async (route) => {
      const request = route.request();
      if (request.method() !== "POST") {
        await route.continue();
        return;
      }
      eventPostCount += 1;
      eventRequests.push({
        key: request.headers()["idempotency-key"],
        body: request.postData() ?? undefined,
      });
      const response = await route.fetch();
      const responseBody = await response.body();
      const body = JSON.parse(responseBody.toString("utf8")) as {
        event?: { id?: unknown };
      };
      expect([200, 201]).toContain(response.status());
      expect(typeof body.event?.id).toBe("string");
      serverEventIds.push(String(body.event?.id));
      if (eventPostCount === 1) {
        createdEventId = String(body.event?.id);
        // The server has committed the event and receipt; only the client
        // response is lost, exactly like a dropped connection after commit.
        await route.abort("connectionreset");
        return;
      }
      await route.fulfill({
        status: response.status(),
        headers: response.headers(),
        body: responseBody,
      });
    });
    await page.route("**/api/capture/receipt", async (route) => {
      if (receiptMode === "actual") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          receiptMode === "unknown"
            ? { state: "committed", current: "unknown" }
            : { state: "absent" },
        ),
      });
    });

    const requests: Array<{
      url: string;
      key: string | undefined;
      action: string | undefined;
      hash: string | undefined;
    }> = [];
    const requestListener = (request: import("@playwright/test").Request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/capture/receipt") {
        const headers = request.headers();
        requests.push({
          url: request.url(),
          key: headers["idempotency-key"],
          action: headers["x-capture-action"],
          hash: headers["x-capture-request-hash"],
        });
      }
    };
    page.on("request", requestListener);

    try {
      const input = page.getByRole("textbox", {
        name: "What would you like to add?",
      });
      await input.fill("add a family event");
      await page.getByRole("button", { name: "Read it", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Add it", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Add it", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText(
        "Could not confirm whether this was saved",
      );
      expect(eventPostCount).toBe(1);
      expect(createdEventId).toBeTruthy();
      const envelope = await readEnvelope(page, storageKey);
      expect(envelope.title).toBe(eventTitle);
      expect(envelope.action).toBe("event.create");
      expect(envelope.key).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
      expect(envelope.requestHash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.parse(envelope.body)).toMatchObject({ title: eventTitle });
      await captureState(page, info, identity, "lost-response");

      // The rendered Retry must reuse the same key/body before reload. The
      // server answers this keyed replay from its committed receipt, so no
      // duplicate event is created.
      await page.getByRole("button", { name: `Retry ${eventTitle}` }).click();
      await expect(page.getByRole("status")).toContainText(
        `Already added “${eventTitle}”`,
      );
      expect(eventPostCount).toBe(2);
      expect(eventRequests).toHaveLength(2);
      expect(eventRequests[1]!.key).toBe(eventRequests[0]!.key);
      expect(eventRequests[1]!.body).toBe(eventRequests[0]!.body);
      expect(serverEventIds).toEqual([createdEventId, createdEventId]);
      expect(
        await discoverOwnedCaptureEvents(page, fixture, eventTitle),
      ).toHaveLength(1);

      // Recreate only the local envelope for the reload proof. This is a test
      // harness restoration, not another write or a second operation.
      await restoreEnvelope(page, storageKey, envelope);
      await page.reload();
      await expect(page.getByTestId("capture-recovery")).toContainText(
        eventTitle,
      );
      expect(eventPostCount).toBe(2);
      expect(
        await discoverOwnedCaptureEvents(page, fixture, eventTitle),
      ).toHaveLength(1);
      await captureState(page, info, identity, "reload-pending");

      await page
        .getByRole("button", { name: `Check status for ${eventTitle}` })
        .click();
      await expect(page.getByRole("status")).toContainText(
        `Already added “${eventTitle}”`,
      );
      expect(eventPostCount).toBe(2);
      expect(requests).toHaveLength(1);
      expect(new URL(requests[0]!.url).search).toBe("");
      expect(requests[0]!.key).toBe(envelope.key);
      expect(requests[0]!.action).toBe(envelope.action);
      expect(requests[0]!.hash).toBe(envelope.requestHash);
      await captureState(page, info, identity, "committed-present");

      const deleted = await browserSend(page, "DELETE", "/api/events", {
        eventId: createdEventId,
      });
      expect(deleted.status, deleted.body).toBe(200);
      const absentEvent = await browserFetch(
        page,
        `/api/events?id=${encodeURIComponent(createdEventId!)}`,
      );
      expect(absentEvent.status).toBe(404);
      expect(
        await discoverOwnedCaptureEvents(page, fixture, eventTitle),
      ).toHaveLength(0);

      await restoreEnvelope(page, storageKey, envelope);
      await page.reload();
      await expect(page.getByTestId("capture-recovery")).toContainText(
        eventTitle,
      );
      await page
        .getByRole("button", { name: `Check status for ${eventTitle}` })
        .click();
      await expect(page.getByRole("alert")).toContainText(
        "no longer present. It was not recreated",
      );
      expect(eventPostCount).toBe(2);
      await captureState(page, info, identity, "committed-removed");

      // The opaque committed state is safe: the UI must not claim present or
      // replay an operation when the server cannot identify the resource.
      receiptMode = "unknown";
      await restoreEnvelope(page, storageKey, envelope);
      await page.reload();
      await expect(page.getByTestId("capture-recovery")).toContainText(
        eventTitle,
      );
      await page
        .getByRole("button", { name: `Check status for ${eventTitle}` })
        .click();
      await expect(page.getByRole("alert")).toContainText(
        "saved earlier. Refresh the app before making a new preview",
      );
      expect(eventPostCount).toBe(2);
      await captureState(page, info, identity, "committed-unknown-synthetic");

      // A missing/pruned receipt is terminal. It removes the local envelope
      // and leaves the person with a new-preview instruction, never a replay.
      receiptMode = "absent";
      await restoreEnvelope(page, storageKey, envelope);
      await page.reload();
      await expect(page.getByTestId("capture-recovery")).toContainText(
        eventTitle,
      );
      await page
        .getByRole("button", { name: `Check status for ${eventTitle}` })
        .click();
      const recovery = page.getByTestId("capture-recovery");
      await expect(recovery).toContainText(
        "No saved result was found. Start a new preview.",
      );
      await expect(
        recovery.getByRole("button", { name: `Retry ${eventTitle}` }),
      ).toHaveCount(0);
      expect(eventPostCount).toBe(2);
      expect(
        await page.evaluate(
          (key) => window.localStorage.getItem(key),
          storageKey,
        ),
      ).toBe("[]");
      await captureState(page, info, identity, "absent-terminal-synthetic");
    } finally {
      const cleanupErrors: string[] = [];
      const attemptCleanup = async (
        label: string,
        action: () => unknown | Promise<unknown>,
      ) => {
        try {
          await action();
        } catch (error) {
          cleanupErrors.push(
            `${label}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      };
      await attemptCleanup("request listener", () =>
        page.off("request", requestListener),
      );
      // Unroute every synthetic transport independently, even when one cleanup
      // operation fails, so the context cannot leak a provider/API intercept.
      await attemptCleanup("receipt route", () =>
        page.unroute("**/api/capture/receipt"),
      );
      await attemptCleanup("event route", () => page.unroute("**/api/events"));
      await attemptCleanup("capture route", () =>
        page.unroute("**/api/capture"),
      );
      await attemptCleanup("owned event cleanup", () =>
        cleanupOwnedCaptureEvents(
          page,
          info,
          fixture,
          eventTitle,
          createdEventId,
        ),
      );
      if (cleanupErrors.length) {
        throw new Error(
          `Capture receipt cleanup failed: ${cleanupErrors.join("; ")}`,
        );
      }
    }
  });

  test("partial photo rows recover after reload without automatic writes", async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.skip(
      !PROJECT_NAMES.has(info.project.name),
      "Capture receipt recovery runs at the six representative responsive sizes",
    );
    assertFixtureAndLoopback(baseURL);
    await installLoopbackNetworkGuard(context);

    await page.goto("/dashboard");
    const { userId, familyId } = await fixtureIdentity(page);
    const { captureReady } = await installCaptureTransport(
      page,
      userId,
      familyId,
      "Unused synthetic event",
    );
    await page.goto("/dashboard/calendar");
    await captureReady;
    await expect(
      page.getByRole("heading", { name: "Quick add", exact: true }),
    ).toBeVisible();
    const identity = await runtimeIdentity(page, info);
    const storageKey = captureRecoveryStorageKey(userId, familyId);

    let photoPostCount = 0;
    await page.route("**/api/events", async (route) => {
      const request = route.request();
      if (request.method() !== "POST") {
        await route.continue();
        return;
      }
      photoPostCount += 1;
      const body = request.postDataJSON() as { title?: unknown };
      const failed = body.title === "Synthetic photo failure";
      await route.fulfill({
        status: failed ? 500 : 201,
        contentType: "application/json",
        body: JSON.stringify(
          failed
            ? { error: "Synthetic refusal only" }
            : { event: { id: "synthetic-photo-success" } },
        ),
      });
    });
    await page.route("**/api/capture/receipt", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ state: "absent" }),
      });
    });

    try {
      const input = page.getByLabel("Choose a photo of a flyer or timetable");
      const onePixelPng = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      );
      await input.setInputFiles({
        name: "synthetic-schedule.png",
        mimeType: "image/png",
        buffer: onePixelPng,
      });
      await expect(
        page.getByText("Found 2 events", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Add 2", exact: true }).click();
      await expect(page.getByRole("status")).toContainText(
        "Added 1 of 2 events",
      );
      await expect(page.getByRole("alert")).toContainText(
        "1 event could not be saved",
      );
      await expect(
        page.getByText("Synthetic photo failure", { exact: true }),
      ).toBeVisible();
      expect(photoPostCount).toBe(2);
      const envelope = await readEnvelope(page, storageKey);
      expect(envelope.title).toBe("Synthetic photo failure");
      expect(envelope.photo).toBe(true);
      expect(envelope.requestHash).toMatch(/^[a-f0-9]{64}$/);
      await captureState(page, info, identity, "photo-partial");

      await page.reload();
      await expect(page.getByTestId("capture-recovery")).toContainText(
        "Synthetic photo failure",
      );
      expect(photoPostCount).toBe(2);
      await captureState(page, info, identity, "photo-reload-no-replay");

      await page
        .getByRole("button", {
          name: "Check status for Synthetic photo failure",
        })
        .click();
      await expect(page.getByTestId("capture-recovery")).toContainText(
        "No saved result was found. Start a new preview.",
      );
      await expect(
        page.getByRole("button", {
          name: "Retry Synthetic photo failure",
        }),
      ).toHaveCount(0);
      expect(photoPostCount).toBe(2);
      expect(
        await page.evaluate(
          (key) => window.localStorage.getItem(key),
          storageKey,
        ),
      ).toBe("[]");
      await captureState(page, info, identity, "photo-absent-terminal");
    } finally {
      await page.unroute("**/api/capture/receipt");
      await page.unroute("**/api/events");
      await page.unroute("**/api/capture");
    }
  });
});
