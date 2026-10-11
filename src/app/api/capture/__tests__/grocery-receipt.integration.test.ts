/**
 * Real-Postgres proof for the capture grocery writer and state-only receipt
 * lookup (#472). The route unit tests mock the transaction and receipt query;
 * this suite exercises their actual rows, locks, household relations and
 * rollback boundary against a disposable database.
 *
 * Opt in only with RUN_DB_INTEGRATION=1 and a guarded disposable DATABASE_URL.
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
jest.mock("@/lib/feature-gate-server", () => ({
  featureGate: async () => null,
}));

import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";
import { hashIdempotentRequest } from "@/lib/idempotency";

export {};

const describeWithDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

jest.setTimeout(60_000);

describeWithDatabase("capture grocery and receipt against Postgres", () => {
  let db: NonNullable<typeof import("@/lib/prisma").prisma>;
  let POST: typeof import("../grocery/route").POST;
  let GET: typeof import("../receipt/route").GET;
  let idem: typeof import("@/lib/idempotency");
  let resolveDefaultGroceryListInTx: typeof import("@/lib/grocery-from-recipe").resolveDefaultGroceryListInTx;
  let createPersonListItemInTx: typeof import("@/lib/person-list-item-create").createPersonListItemInTx;

  const FAMILY = "capint-family";
  const OTHER_FAMILY = "capint-other-family";
  const PARENT = "capint-parent";
  const OTHER_PARENT = "capint-other-parent";
  let sequence = 0;

  const key = (label: string) =>
    `capint-${label}-${Date.now().toString(36)}-${(sequence++).toString(36)}`;
  const captureBody = (content: string) => ({ content, quantity: 1 });
  const captureAction = "capture.grocery.add";

  function request(userId: string, body: unknown, idempotencyKey: string): any {
    return {
      headers: new Headers({ "Idempotency-Key": idempotencyKey }),
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
    await db.idempotencyRecord.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.list.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.family.deleteMany({
      where: { id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.user.deleteMany({ where: { id: { in: [PARENT, OTHER_PARENT] } } });
  }

  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    const mod = await import("@/lib/prisma");
    if (!mod.prisma) throw new Error("Integration database is not configured");
    db = mod.prisma;
    POST = (await import("../grocery/route")).POST;
    GET = (await import("../receipt/route")).GET;
    idem = await import("@/lib/idempotency");
    resolveDefaultGroceryListInTx = (await import("@/lib/grocery-from-recipe"))
      .resolveDefaultGroceryListInTx;
    createPersonListItemInTx = (await import("@/lib/person-list-item-create"))
      .createPersonListItemInTx;
    await cleanup();
    await db.family.createMany({
      data: [
        {
          id: FAMILY,
          name: "Capture integration household",
          invite_code: "capint-family-invite",
        },
        {
          id: OTHER_FAMILY,
          name: "Other capture household",
          invite_code: "capint-other-invite",
        },
      ],
    });
    await db.user.createMany({
      data: [
        {
          id: PARENT,
          email: "capint-parent@example.test",
          name: "Capture parent",
          role: "parent",
          family_id: FAMILY,
        },
        {
          id: OTHER_PARENT,
          email: "capint-other@example.test",
          name: "Other parent",
          role: "parent",
          family_id: OTHER_FAMILY,
        },
      ],
    });
    idem.idempotencyRuntime.random = () => 0.99;
  });

  beforeEach(async () => {
    await db.idempotencyRecord.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.list.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
  });

  afterAll(async () => {
    if (!db) return;
    if (idem) idem.idempotencyRuntime.random = () => Math.random();
    try {
      await cleanup();
    } finally {
      await db.$disconnect();
    }
  });

  it("runs one actual default-list add under concurrent same-key replay", async () => {
    const body = captureBody("Concurrent milk");
    const requestKey = key("concurrent");
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => POST(request(PARENT, body, requestKey))),
    );

    expect(
      responses.every(
        (response) => response.status === 200 || response.status === 409,
      ),
    ).toBe(true);
    expect(
      responses.filter(
        (response) =>
          response.status === 200 &&
          response.headers.get("Idempotency-Replayed") === null,
      ),
    ).toHaveLength(1);
    expect(await db.list.count({ where: { family_id: FAMILY } })).toBe(1);
    expect(
      await db.listItem.count({
        where: { list: { family_id: FAMILY }, content: "Concurrent milk" },
      }),
    ).toBe(1);
    expect(
      await db.idempotencyRecord.count({
        where: { family_id: FAMILY, key: requestKey },
      }),
    ).toBe(1);

    const replay = await POST(request(PARENT, body, requestKey));
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    const replayBody = await replay.json();
    const record = await db.idempotencyRecord.findFirstOrThrow({
      where: { family_id: FAMILY, key: requestKey },
    });
    const item = await db.listItem.findFirstOrThrow({
      where: { list: { family_id: FAMILY }, content: "Concurrent milk" },
    });
    expect(record.action).toBe(captureAction);
    expect(record.response_status).toBe(200);
    expect(item.source_request_id).toBe(record.id);
    expect(replayBody.item.id).toBe(item.id);
  });

  it("keeps the established 422 conflict when a capture key receives changed content", async () => {
    const requestKey = key("changed");
    expect(
      (await POST(request(PARENT, captureBody("Milk"), requestKey))).status,
    ).toBe(200);
    const changed = await POST(
      request(PARENT, captureBody("Eggs"), requestKey),
    );
    expect(changed.status).toBe(422);
    expect((await changed.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(
      await db.listItem.count({ where: { list: { family_id: FAMILY } } }),
    ).toBe(1);
    expect(
      await db.listItem.count({
        where: { list: { family_id: FAMILY }, content: "Eggs" },
      }),
    ).toBe(0);
  });

  it("rolls back a newly resolved list and item when completion storage fails", async () => {
    const body = captureBody("Rollback milk");
    const requestKey = key("rollback");
    const context = {
      scope: `user:${PARENT}`,
      familyId: FAMILY,
      userId: PARENT,
      action: captureAction,
    };
    const failingDb: any = {
      $transaction: (callback: any) =>
        db.$transaction((tx) =>
          callback(
            new Proxy(tx, {
              get(target, property) {
                if (property === "idempotencyRecord") {
                  return new Proxy(target.idempotencyRecord, {
                    get(delegate, method) {
                      if (method === "update")
                        return async () => {
                          throw new Error("completion write failed");
                        };
                      return Reflect.get(delegate, method);
                    },
                  });
                }
                return Reflect.get(target, property);
              },
            }),
          ),
        ),
    };

    await expect(
      idem.withIdempotency(db, requestKey, context, body, ({ recordId }) =>
        failingDb.$transaction(async (tx: any) => {
          const list = await resolveDefaultGroceryListInTx(tx, FAMILY, PARENT);
          return createPersonListItemInTx(
            tx,
            { listId: list.id, ...body },
            { familyId: FAMILY, addedBy: PARENT },
            recordId,
            { groceryOnly: true },
          );
        }),
      ),
    ).rejects.toThrow("completion write failed");
    expect(await db.list.count({ where: { family_id: FAMILY } })).toBe(0);
    expect(
      await db.listItem.count({ where: { list: { family_id: FAMILY } } }),
    ).toBe(0);
    expect(
      await db.idempotencyRecord.count({
        where: { family_id: FAMILY, key: requestKey },
      }),
    ).toBe(0);

    expect((await POST(request(PARENT, body, requestKey))).status).toBe(200);
    expect(await db.list.count({ where: { family_id: FAMILY } })).toBe(1);
    expect(
      await db.listItem.count({ where: { list: { family_id: FAMILY } } }),
    ).toBe(1);
  });

  it("returns real grocery receipt state without exposing content across family boundaries", async () => {
    const body = captureBody("Receipt milk");
    const requestKey = key("receipt");
    const requestHash = hashIdempotentRequest(captureAction, body);
    const added = await POST(request(PARENT, body, requestKey));
    expect(added.status).toBe(200);
    const addedBody = await added.json();

    const present = await GET(
      receiptRequest(PARENT, requestKey, captureAction, requestHash),
    );
    expect(present.status).toBe(200);
    expect(await present.json()).toEqual({
      state: "committed",
      current: "present",
    });
    expect(present.headers.get("Cache-Control")).toBe("private, no-store");

    await db.listItem.delete({ where: { id: addedBody.item.id } });
    const removed = await GET(
      receiptRequest(PARENT, requestKey, captureAction, requestHash),
    );
    expect(await removed.json()).toEqual({
      state: "committed",
      current: "removed",
    });
    expect(JSON.stringify(await removed.json())).not.toContain("Receipt milk");

    const foreignKey = key("foreign-record");
    await db.idempotencyRecord.create({
      data: {
        scope: `user:${OTHER_PARENT}`,
        key: foreignKey,
        family_id: FAMILY,
        user_id: OTHER_PARENT,
        action: captureAction,
        request_hash: requestHash,
        response_status: 200,
        response_body: { success: true, item: { id: "private-item-id" } },
        expires_at: new Date(Date.now() + 60_000),
      },
    });
    const crossFamily = await GET(
      receiptRequest(OTHER_PARENT, foreignKey, captureAction, requestHash),
    );
    expect(await crossFamily.json()).toEqual({ state: "absent" });

    const expiredKey = key("expired");
    await db.idempotencyRecord.create({
      data: {
        scope: `user:${PARENT}`,
        key: expiredKey,
        family_id: FAMILY,
        user_id: PARENT,
        action: captureAction,
        request_hash: requestHash,
        response_status: 200,
        response_body: { success: true, item: { id: "private-item-id" } },
        expires_at: new Date(Date.now() - 1),
      },
    });
    const expired = await GET(
      receiptRequest(PARENT, expiredKey, captureAction, requestHash),
    );
    expect(await expired.json()).toEqual({ state: "expired" });
  });
});
