/**
 * Opt-in PostgreSQL proof for Budget transaction idempotency.
 *
 * The route handlers are imported only after the fixture guard has run. This
 * suite is skipped by default and must never be pointed at an unapproved
 * database. The request object is a small transport seam; authentication,
 * authorization, row writes, and receipts use the real route and database.
 */
jest.mock("next/server", () => {
  const { nextServerMock } = require("@/__tests__/helpers/two-household");
  const BaseResponse = nextServerMock.NextResponse;
  class WireResponse extends BaseResponse {
    constructor(
      body?: unknown,
      init?: { status?: number; headers?: Record<string, string> },
    ) {
      super(body, init);
    }
    static json(
      data: unknown,
      init?: { status?: number; headers?: Record<string, string> },
    ) {
      const wireBody =
        data === undefined ? null : JSON.parse(JSON.stringify(data));
      return new WireResponse(wireBody, init);
    }
  }
  return { ...nextServerMock, NextResponse: WireResponse };
});
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

const describeWithDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

jest.setTimeout(60_000);

describeWithDatabase("Budget transaction routes against PostgreSQL", () => {
  let db: NonNullable<typeof import("@/lib/prisma").prisma>;
  let POST: typeof import("../transactions/route").POST;
  let PATCH: typeof import("../transactions/[id]/route").PATCH;
  let DELETE: typeof import("../transactions/[id]/route").DELETE;
  let idem: typeof import("@/lib/idempotency");
  let priorRandom: (() => number) | undefined;
  let fixtureGuardPassed = false;

  const FAMILY = "budget-tx-int-family";
  const OTHER_FAMILY = "budget-tx-int-other-family";
  const PARENT = "budget-tx-int-parent";
  const TEEN = "budget-tx-int-teen";
  const OTHER_PARENT = "budget-tx-int-other-parent";
  const CATEGORY = "budget-tx-int-category";
  const OTHER_CATEGORY = "budget-tx-int-other-category";

  const BASE_BODY = {
    amount: 42.5,
    type: "expense" as const,
    category_id: CATEGORY,
    description: "Route integration groceries",
    notes: "synthetic",
    date: "2026-10-18",
    is_recurring: false,
  };

  function request(userId: string | null, body?: unknown, key?: string): any {
    const headers = new Headers();
    if (key) headers.set("Idempotency-Key", key);
    const url = new URL("http://localhost/api/budget/transactions");
    return {
      url: url.toString(),
      nextUrl: url,
      headers,
      cookies: {
        get: (name: string) =>
          name === "session_token" && userId
            ? { value: `session:${userId}` }
            : undefined,
      },
      json: async () => body,
    };
  }

  function params(id: string) {
    return { params: Promise.resolve({ id }) };
  }

  async function cleanup() {
    if (!db) return;
    await db.idempotencyRecord.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.transaction.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.budgetCategory.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.family.deleteMany({
      where: { id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.user.deleteMany({
      where: { id: { in: [PARENT, TEEN, OTHER_PARENT] } },
    });
  }

  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    fixtureGuardPassed = true;
    const mod = await import("@/lib/prisma");
    if (!mod.prisma) throw new Error("Integration database is not configured");
    db = mod.prisma;
    POST = (await import("../transactions/route")).POST;
    PATCH = (await import("../transactions/[id]/route")).PATCH;
    DELETE = (await import("../transactions/[id]/route")).DELETE;
    idem = await import("@/lib/idempotency");
    priorRandom = idem.idempotencyRuntime.random;
    idem.idempotencyRuntime.random = () => 0.99;

    await cleanup();
    await db.family.createMany({
      data: [
        {
          id: FAMILY,
          name: "Budget transaction integration household",
          invite_code: "budget-tx-int-family-invite",
          features: { budget: true },
        },
        {
          id: OTHER_FAMILY,
          name: "Other Budget transaction household",
          invite_code: "budget-tx-int-other-invite",
          features: { budget: true },
        },
      ],
    });
    await db.user.createMany({
      data: [
        {
          id: PARENT,
          email: "budget-tx-int-parent@example.test",
          name: "Budget transaction parent",
          role: "parent",
          family_id: FAMILY,
        },
        {
          id: TEEN,
          email: "budget-tx-int-teen@example.test",
          name: "Budget transaction teen",
          role: "teen",
          family_id: FAMILY,
        },
        {
          id: OTHER_PARENT,
          email: "budget-tx-int-other-parent@example.test",
          name: "Other Budget transaction parent",
          role: "parent",
          family_id: OTHER_FAMILY,
        },
      ],
    });
    await db.budgetCategory.createMany({
      data: [
        {
          id: CATEGORY,
          family_id: FAMILY,
          name: "Integration groceries",
          type: "expense",
          created_by: PARENT,
        },
        {
          id: OTHER_CATEGORY,
          family_id: OTHER_FAMILY,
          name: "Other groceries",
          type: "expense",
          created_by: OTHER_PARENT,
        },
      ],
    });
  });

  beforeEach(async () => {
    await db.idempotencyRecord.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.transaction.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.user.update({
      where: { id: PARENT },
      data: { family_id: FAMILY, role: "parent" },
    });
    await db.family.update({
      where: { id: FAMILY },
      data: { features: { budget: true } },
    });
    await db.family.update({
      where: { id: OTHER_FAMILY },
      data: { features: { budget: true } },
    });
  });

  afterAll(async () => {
    let cleanupError: unknown;
    try {
      if (fixtureGuardPassed && db) await cleanup();
    } catch (error) {
      cleanupError = error;
    } finally {
      try {
        if (idem && priorRandom) idem.idempotencyRuntime.random = priorRandom;
        await db?.$disconnect();
      } catch (error) {
        cleanupError ??= error;
      }
    }
    if (cleanupError) throw cleanupError;
  });

  it("does CRUD with no key and does not create a receipt", async () => {
    const created = await POST(request(PARENT, BASE_BODY));
    expect(created.status).toBe(201);
    const transactionId = (await created.json()).transaction.id;

    const updated = await PATCH(
      request(PARENT, { amount: 43.75 }),
      params(transactionId),
    );
    expect(updated.status).toBe(200);
    expect((await updated.json()).transaction.amount).toBe(43.75);

    const deleted = await DELETE(request(PARENT), params(transactionId));
    expect(deleted.status).toBe(200);
    expect(
      await db.transaction.findUnique({ where: { id: transactionId } }),
    ).toBeNull();
    expect(
      await db.idempotencyRecord.count({ where: { family_id: FAMILY } }),
    ).toBe(0);
  });

  it("replays a keyed create exactly once and rejects changed bodies", async () => {
    const key = "budget-create-replay-20261018";
    const first = await POST(request(PARENT, BASE_BODY, key));
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const replay = await POST(request(PARENT, BASE_BODY, key));
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await replay.json()).toEqual(firstBody);
    expect(await db.transaction.count({ where: { family_id: FAMILY } })).toBe(
      1,
    );

    const changed = await POST(
      request(PARENT, { ...BASE_BODY, amount: 44 }, key),
    );
    expect(changed.status).toBe(422);
    expect((await changed.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await db.transaction.count({ where: { family_id: FAMILY } })).toBe(
      1,
    );
  });

  it("returns the in-progress response without writing a transaction", async () => {
    const key = "budget-create-in-progress-20261018";
    await db.idempotencyRecord.create({
      data: {
        scope: `user:${PARENT}`,
        key,
        family_id: FAMILY,
        user_id: PARENT,
        action: "budget.transaction.create",
        request_hash: idem.hashIdempotentRequest(
          "budget.transaction.create",
          BASE_BODY,
        ),
        expires_at: new Date(Date.now() + idem.IDEMPOTENCY_TTL_MS),
      },
    });

    const response = await POST(request(PARENT, BASE_BODY, key));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatchObject({
      code: "IDEMPOTENCY_IN_PROGRESS",
      retryable: true,
    });
    expect(await db.transaction.count({ where: { family_id: FAMILY } })).toBe(
      0,
    );
  });

  it("replays keyed update and delete after the row is gone", async () => {
    const created = await db.transaction.create({
      data: {
        family_id: FAMILY,
        user_id: PARENT,
        amount: 12,
        type: "expense",
        category_id: CATEGORY,
        description: "Replay target",
        date: new Date("2026-10-18T00:00:00.000Z"),
      },
    });
    const updateKey = "budget-update-replay-20261018";
    const updateBody = { description: "Updated replay" };
    const firstUpdate = await PATCH(
      request(PARENT, updateBody, updateKey),
      params(created.id),
    );
    expect(firstUpdate.status).toBe(200);
    const firstUpdateBody = await firstUpdate.json();
    const updateReplay = await PATCH(
      request(PARENT, updateBody, updateKey),
      params(created.id),
    );
    expect(updateReplay.status).toBe(200);
    expect(updateReplay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await updateReplay.json()).toEqual(firstUpdateBody);
    const changedUpdate = await PATCH(
      request(PARENT, { description: "Different replay" }, updateKey),
      params(created.id),
    );
    expect(changedUpdate.status).toBe(422);

    const deleteKey = "budget-delete-replay-20261018";
    const firstDelete = await DELETE(
      request(PARENT, undefined, deleteKey),
      params(created.id),
    );
    expect(firstDelete.status).toBe(200);
    const firstDeleteBody = await firstDelete.json();
    expect(
      await db.transaction.findUnique({ where: { id: created.id } }),
    ).toBeNull();
    const deleteReplay = await DELETE(
      request(PARENT, undefined, deleteKey),
      params(created.id),
    );
    expect(deleteReplay.status).toBe(200);
    expect(deleteReplay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await deleteReplay.json()).toEqual(firstDeleteBody);
  });

  it("rolls back foreign-category attempts and allows the same key to retry", async () => {
    const key = "budget-foreign-category-20261018";
    const refused = await POST(
      request(PARENT, { ...BASE_BODY, category_id: OTHER_CATEGORY }, key),
    );
    expect(refused.status).toBe(403);
    expect(await db.transaction.count({ where: { family_id: FAMILY } })).toBe(
      0,
    );
    expect(
      await db.idempotencyRecord.findFirst({
        where: { family_id: FAMILY, key },
      }),
    ).toBeNull();

    const retried = await POST(request(PARENT, BASE_BODY, key));
    expect(retried.status).toBe(201);
    expect(await db.transaction.count({ where: { family_id: FAMILY } })).toBe(
      1,
    );

    const foreignRow = await db.transaction.create({
      data: {
        family_id: OTHER_FAMILY,
        user_id: OTHER_PARENT,
        amount: 9,
        type: "expense",
        category_id: OTHER_CATEGORY,
        description: "Foreign row",
        date: new Date("2026-10-18T00:00:00.000Z"),
      },
    });
    expect(
      (
        await PATCH(
          request(PARENT, { amount: 10 }, "budget-foreign-row-update"),
          params(foreignRow.id),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await DELETE(
          request(PARENT, undefined, "budget-foreign-row-delete"),
          params(foreignRow.id),
        )
      ).status,
    ).toBe(403);
    expect(
      await db.transaction.findUnique({ where: { id: foreignRow.id } }),
    ).toMatchObject({ amount: 9, family_id: OTHER_FAMILY });
  });

  it("rechecks live parent and feature authority before replay", async () => {
    const key = "budget-authority-replay-20261018";
    expect((await POST(request(PARENT, BASE_BODY, key))).status).toBe(201);

    await db.user.update({ where: { id: PARENT }, data: { role: "teen" } });
    expect((await POST(request(PARENT, BASE_BODY, key))).status).toBe(403);
    await db.user.update({ where: { id: PARENT }, data: { role: "parent" } });
    await db.family.update({
      where: { id: FAMILY },
      data: { features: { budget: false } },
    });
    expect((await POST(request(PARENT, BASE_BODY, key))).status).toBe(403);
  });
});
