/**
 * Real-Postgres proof for event capture receipts (#472).
 *
 * This suite calls the actual event POST and capture receipt GET handlers with
 * a disposable database. It is opt-in only and never runs against a normal
 * application database.
 */

jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock("@/lib/session", () => ({
  verifySessionToken: async (token: string) => {
    if (!token?.startsWith("session:")) return null;
    const { prisma } = require("@/lib/prisma");
    const user = await prisma.user.findUnique({
      where: { id: token.slice("session:".length) },
    });
    return user
      ? {
          userId: user.id,
          email: user.email,
          role: user.role,
          family_id: user.family_id,
          tv: user.token_version,
        }
      : null;
  },
  getTokenVersion: async () => 0,
}));

import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";
import { hashIdempotentRequest } from "@/lib/idempotency";

export {};

const describeWithDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

jest.setTimeout(60_000);

describeWithDatabase("event capture receipts against Postgres", () => {
  let db: NonNullable<typeof import("@/lib/prisma").prisma>;
  let POST: typeof import("../../../events/route").POST;
  let GET: typeof import("../route").GET;
  let idem: typeof import("@/lib/idempotency");

  const FAMILY = "capture-event-receipt-family";
  const OTHER_FAMILY = "capture-event-receipt-other-family";
  const PARENT = "capture-event-receipt-parent";
  const SECOND_PARENT = "capture-event-receipt-second-parent";
  const OTHER_PARENT = "capture-event-receipt-other-parent";
  const priorSharedDeviceEnabled = process.env.SHARED_DEVICE_ENABLED;
  let priorIdempotencyRandom: (() => number) | undefined;
  let fixtureGuardPassed = false;
  let setupSucceeded = false;
  let sequence = 0;

  const key = (label: string) =>
    `capture-event-${label}-${Date.now().toString(36)}-${(sequence++).toString(36)}`;
  const eventBody = (title: string) => ({
    title,
    start_time: "2026-11-01T06:30:00.000Z",
    end_time: "2026-11-01T07:00:00.000Z",
    event_type: "other" as const,
  });

  function postRequest(
    userId: string,
    body: unknown,
    idempotencyKey?: string,
  ): any {
    const headers = new Headers();
    if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
    const url = new URL("http://localhost/api/events");
    return {
      url: url.toString(),
      nextUrl: url,
      headers,
      cookies: {
        get: (name: string) =>
          name === "session_token" ? { value: `session:${userId}` } : undefined,
      },
      json: async () => body,
    };
  }

  function receiptRequest(
    userId: string,
    idempotencyKey: string,
    action: string,
    requestHash: string,
  ): any {
    return {
      url: "http://localhost/api/capture/receipt",
      headers: new Headers({
        "Idempotency-Key": idempotencyKey,
        "X-Capture-Action": action,
        "X-Capture-Request-Hash": requestHash,
      }),
      cookies: {
        get: (name: string) =>
          name === "session_token" ? { value: `session:${userId}` } : undefined,
      },
    };
  }

  async function cleanup(): Promise<void> {
    if (!db) return;
    await db.idempotencyRecord.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.activity.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.event.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.family.deleteMany({
      where: { id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.user.deleteMany({
      where: {
        id: { in: [PARENT, SECOND_PARENT, OTHER_PARENT] },
      },
    });
  }

  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    fixtureGuardPassed = true;
    process.env.SHARED_DEVICE_ENABLED = "1";

    const mod = await import("@/lib/prisma");
    if (!mod.prisma) throw new Error("Integration database is not configured");
    db = mod.prisma;
    POST = (await import("../../../events/route")).POST;
    GET = (await import("../route")).GET;
    idem = await import("@/lib/idempotency");
    priorIdempotencyRandom = idem.idempotencyRuntime.random;

    await cleanup();
    await db.family.createMany({
      data: [
        {
          id: FAMILY,
          name: "Capture event receipt household",
          invite_code: "capture-event-receipt-family-invite",
        },
        {
          id: OTHER_FAMILY,
          name: "Other capture event receipt household",
          invite_code: "capture-event-receipt-other-invite",
        },
      ],
    });
    await db.user.createMany({
      data: [
        {
          id: PARENT,
          email: "capture-event-receipt-parent@example.test",
          name: "Capture event parent",
          role: "parent",
          family_id: FAMILY,
        },
        {
          id: SECOND_PARENT,
          email: "capture-event-receipt-second@example.test",
          name: "Second capture event parent",
          role: "parent",
          family_id: FAMILY,
        },
        {
          id: OTHER_PARENT,
          email: "capture-event-receipt-other@example.test",
          name: "Other capture event parent",
          role: "parent",
          family_id: OTHER_FAMILY,
        },
      ],
    });
    idem.idempotencyRuntime.random = () => 0.99;
    setupSucceeded = true;
  });

  beforeEach(async () => {
    await db.idempotencyRecord.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.activity.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.event.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.user.updateMany({
      where: { id: PARENT },
      data: { family_id: FAMILY },
    });
  });

  afterEach(async () => {
    await db.user.updateMany({
      where: { id: PARENT },
      data: { family_id: FAMILY },
    });
  });

  afterAll(async () => {
    const database = db;
    const idempotency = idem;
    let cleanupError: unknown;
    try {
      if (fixtureGuardPassed && database) {
        await database.user.updateMany({
          where: { id: PARENT },
          data: { family_id: FAMILY },
        });
        await cleanup();
      }
    } catch (error) {
      cleanupError = error;
    } finally {
      try {
        if (idempotency && priorIdempotencyRandom) {
          idempotency.idempotencyRuntime.random = priorIdempotencyRandom;
        }
        if (priorSharedDeviceEnabled === undefined) {
          delete process.env.SHARED_DEVICE_ENABLED;
        } else {
          process.env.SHARED_DEVICE_ENABLED = priorSharedDeviceEnabled;
        }
        await database?.$disconnect();
      } catch (error) {
        cleanupError ??= error;
      }
    }
    // If beforeAll failed, keep that original setup error visible instead of
    // replacing it with a best-effort cleanup failure.
    if (cleanupError && setupSucceeded) throw cleanupError;
  });

  it("reports real event present and removed receipt states", async () => {
    const body = eventBody("Receipt event");
    const requestKey = key("lifecycle");
    const requestHash = hashIdempotentRequest("event.create", body);

    const created = await POST(postRequest(PARENT, body, requestKey));
    expect(created.status).toBe(200);
    const createdBody = await created.json();
    const eventId = createdBody.event.id as string;

    const present = await GET(
      receiptRequest(PARENT, requestKey, "event.create", requestHash),
    );
    expect(present.status).toBe(200);
    expect(await present.json()).toEqual({
      state: "committed",
      current: "present",
    });
    expect(present.headers.get("Cache-Control")).toBe("private, no-store");

    await db.event.delete({ where: { id: eventId } });
    const removed = await GET(
      receiptRequest(PARENT, requestKey, "event.create", requestHash),
    );
    expect(await removed.json()).toEqual({
      state: "committed",
      current: "removed",
    });
  });

  it("reports pending, expired and opaque committed states without receipt data", async () => {
    const pendingKey = key("pending");
    const pendingBody = eventBody("Pending event");
    const pendingHash = hashIdempotentRequest("event.create", pendingBody);
    await db.idempotencyRecord.create({
      data: {
        scope: `user:${PARENT}`,
        key: pendingKey,
        family_id: FAMILY,
        user_id: PARENT,
        action: "event.create",
        request_hash: pendingHash,
        response_status: null,
        expires_at: new Date(Date.now() + 60_000),
      },
    });
    const pending = await GET(
      receiptRequest(PARENT, pendingKey, "event.create", pendingHash),
    );
    expect(await pending.json()).toEqual({ state: "pending" });

    const expiredKey = key("expired");
    const expiredBody = eventBody("Expired event");
    const expiredHash = hashIdempotentRequest("event.create", expiredBody);
    await db.idempotencyRecord.create({
      data: {
        scope: `user:${PARENT}`,
        key: expiredKey,
        family_id: FAMILY,
        user_id: PARENT,
        action: "event.create",
        request_hash: expiredHash,
        response_status: 200,
        response_body: { success: true, event: { id: "expired-event" } },
        expires_at: new Date(Date.now() - 1),
      },
    });
    const expired = await GET(
      receiptRequest(PARENT, expiredKey, "event.create", expiredHash),
    );
    expect(await expired.json()).toEqual({ state: "expired" });

    const opaqueKey = key("opaque");
    const opaqueBody = eventBody("Opaque event");
    const opaqueHash = hashIdempotentRequest("event.create", opaqueBody);
    await db.idempotencyRecord.create({
      data: {
        scope: `user:${PARENT}`,
        key: opaqueKey,
        family_id: FAMILY,
        user_id: PARENT,
        action: "event.create",
        request_hash: opaqueHash,
        response_status: 200,
        response_body: { success: true, private: "must-not-leak" },
        expires_at: new Date(Date.now() + 60_000),
      },
    });
    const opaque = await GET(
      receiptRequest(PARENT, opaqueKey, "event.create", opaqueHash),
    );
    const opaqueBodyResponse = await opaque.json();
    expect(opaqueBodyResponse).toEqual({
      state: "committed",
      current: "unknown",
    });
    expect(JSON.stringify(opaqueBodyResponse)).not.toContain("must-not-leak");
  });

  it("rejects action/hash conflicts and keeps an in-progress POST retryable", async () => {
    const body = eventBody("Conflicting receipt event");
    const requestKey = key("conflict");
    const requestHash = hashIdempotentRequest("event.create", body);
    expect((await POST(postRequest(PARENT, body, requestKey))).status).toBe(
      200,
    );

    const changedHash = await GET(
      receiptRequest(PARENT, requestKey, "event.create", "b".repeat(64)),
    );
    expect(changedHash.status).toBe(409);
    expect((await changedHash.json()).error.code).toBe(
      "CAPTURE_RECEIPT_CONFLICT",
    );

    const changedAction = await GET(
      receiptRequest(PARENT, requestKey, "capture.grocery.add", requestHash),
    );
    expect(changedAction.status).toBe(409);
    expect((await changedAction.json()).error.code).toBe(
      "CAPTURE_RECEIPT_CONFLICT",
    );

    const inProgressKey = key("in-progress");
    const inProgressBody = eventBody("In progress event");
    const inProgressHash = hashIdempotentRequest(
      "event.create",
      inProgressBody,
    );
    await db.idempotencyRecord.create({
      data: {
        scope: `user:${PARENT}`,
        key: inProgressKey,
        family_id: FAMILY,
        user_id: PARENT,
        action: "event.create",
        request_hash: inProgressHash,
        created_at: new Date(),
        response_status: null,
        expires_at: new Date(Date.now() + 60_000),
      },
    });
    const inProgress = await POST(
      postRequest(PARENT, inProgressBody, inProgressKey),
    );
    expect(inProgress.status).toBe(409);
    expect((await inProgress.json()).error.code).toBe(
      "IDEMPOTENCY_IN_PROGRESS",
    );
    expect(await db.event.count({ where: { family_id: FAMILY } })).toBe(1);
  });

  it("does not confirm a receipt to another user or household", async () => {
    const body = eventBody("Private receipt event");
    const requestKey = key("scope");
    const requestHash = hashIdempotentRequest("event.create", body);
    expect((await POST(postRequest(PARENT, body, requestKey))).status).toBe(
      200,
    );

    const sameFamilyOtherUser = await GET(
      receiptRequest(SECOND_PARENT, requestKey, "event.create", requestHash),
    );
    expect(await sameFamilyOtherUser.json()).toEqual({ state: "absent" });

    await db.user.update({
      where: { id: PARENT },
      data: { family_id: OTHER_FAMILY },
    });
    const movedHousehold = await GET(
      receiptRequest(PARENT, requestKey, "event.create", requestHash),
    );
    expect(await movedHousehold.json()).toEqual({ state: "absent" });
  });

  it("preserves legacy no-key event writes as distinct deliberate creates", async () => {
    const body = eventBody("Legacy event");
    const first = await POST(postRequest(PARENT, body));
    const second = await POST(postRequest(PARENT, body));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers.get("Idempotency-Replayed")).toBeNull();
    expect(second.headers.get("Idempotency-Replayed")).toBeNull();
    expect(
      await db.event.count({ where: { family_id: FAMILY, title: body.title } }),
    ).toBe(2);
    expect(
      await db.activity.count({
        where: { family_id: FAMILY, type: "event_created" },
      }),
    ).toBe(2);
  });
});
