/**
 * Opt-in PostgreSQL proof for Wishlist mutation receipts.
 *
 * The suite imports the real route handlers only after the fixture-target
 * guard. It is skipped by default and must use a disposable fp_* database.
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

describeWithDatabase("Wishlist routes against PostgreSQL", () => {
  let db: NonNullable<typeof import("@/lib/prisma").prisma>;
  let POST: typeof import("../route").POST;
  let PATCH: typeof import("../[id]/route").PATCH;
  let DELETE: typeof import("../[id]/route").DELETE;
  let SET_STATUS: typeof import("../[id]/status/route").PATCH;
  let idem: typeof import("@/lib/idempotency");
  let priorRandom: (() => number) | undefined;
  let fixtureGuardPassed = false;

  const FAMILY = "wishlist-route-int-family";
  const OTHER_FAMILY = "wishlist-route-int-other-family";
  const PARENT = "wishlist-route-int-parent";
  const TEEN = "wishlist-route-int-teen";
  const CHILD = "wishlist-route-int-child";
  const OTHER_PARENT = "wishlist-route-int-other-parent";

  const BASE_BODY = {
    title: "Route integration bike",
    link: "https://example.test/bike",
    description: "synthetic wishlist item",
    approx_price: 12.5,
  };

  function request(
    userId: string,
    body?: unknown,
    key?: string,
    path = "/api/wishlist",
  ): any {
    const headers = new Headers();
    if (key) headers.set("Idempotency-Key", key);
    const url = new URL(`http://localhost${path}`);
    return {
      url: url.toString(),
      nextUrl: url,
      headers,
      cookies: {
        get: (name: string) =>
          name === "session_token"
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
    await db.wishlistItem.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.family.deleteMany({
      where: { id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.user.deleteMany({
      where: { id: { in: [PARENT, TEEN, CHILD, OTHER_PARENT] } },
    });
  }

  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    fixtureGuardPassed = true;
    const mod = await import("@/lib/prisma");
    if (!mod.prisma) throw new Error("Integration database is not configured");
    db = mod.prisma;
    POST = (await import("../route")).POST;
    PATCH = (await import("../[id]/route")).PATCH;
    DELETE = (await import("../[id]/route")).DELETE;
    SET_STATUS = (await import("../[id]/status/route")).PATCH;
    idem = await import("@/lib/idempotency");
    priorRandom = idem.idempotencyRuntime.random;
    idem.idempotencyRuntime.random = () => 0.99;

    await cleanup();
    await db.family.createMany({
      data: [
        {
          id: FAMILY,
          name: "Wishlist route integration household",
          invite_code: "wishlist-route-int-family-invite",
          features: { wishlist: true },
        },
        {
          id: OTHER_FAMILY,
          name: "Other Wishlist route household",
          invite_code: "wishlist-route-int-other-invite",
          features: { wishlist: true },
        },
      ],
    });
    await db.user.createMany({
      data: [
        {
          id: PARENT,
          email: "wishlist-route-int-parent@example.test",
          name: "Wishlist route parent",
          role: "parent",
          family_id: FAMILY,
        },
        {
          id: TEEN,
          email: "wishlist-route-int-teen@example.test",
          name: "Wishlist route teen",
          role: "teen",
          family_id: FAMILY,
        },
        {
          id: CHILD,
          email: "wishlist-route-int-child@example.test",
          name: "Wishlist route child",
          role: "child",
          family_id: FAMILY,
        },
        {
          id: OTHER_PARENT,
          email: "wishlist-route-int-other-parent@example.test",
          name: "Other Wishlist route parent",
          role: "parent",
          family_id: OTHER_FAMILY,
        },
      ],
    });
  });

  beforeEach(async () => {
    await db.idempotencyRecord.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.wishlistItem.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.family.update({
      where: { id: FAMILY },
      data: { features: { wishlist: true } },
    });
    await db.family.update({
      where: { id: OTHER_FAMILY },
      data: { features: { wishlist: true } },
    });
    await db.user.update({
      where: { id: PARENT },
      data: { family_id: FAMILY, role: "parent" },
    });
    await db.user.update({
      where: { id: TEEN },
      data: { family_id: FAMILY, role: "teen" },
    });
    await db.user.update({
      where: { id: CHILD },
      data: { family_id: FAMILY, role: "child" },
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

  it("converges overlapping same-key creates to one row and receipt", async () => {
    const key = "wishlist-create-concurrent-20261018";
    const responses = await Promise.all([
      POST(request(PARENT, BASE_BODY, key)),
      POST(request(PARENT, BASE_BODY, key)),
    ]);
    expect(
      responses.every(({ status }) => status === 201 || status === 409),
    ).toBe(true);
    const winner = responses.find(({ status }) => status === 201);
    expect(winner).toBeDefined();
    const winnerBody = await winner!.json();
    const retry = await POST(request(PARENT, BASE_BODY, key));
    expect(retry.status).toBe(201);
    expect(retry.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await retry.json()).toEqual(winnerBody);
    expect(await db.wishlistItem.count({ where: { family_id: FAMILY } })).toBe(
      1,
    );
    expect(
      await db.idempotencyRecord.count({
        where: {
          family_id: FAMILY,
          scope: `user:${PARENT}`,
          key,
          response_status: 201,
        },
      }),
    ).toBe(1);
  });

  it("returns in-progress and conflict responses without duplicate effects", async () => {
    const inProgressKey = "wishlist-create-in-progress-20261018";
    const normalizedBody = {
      title: BASE_BODY.title,
      link: BASE_BODY.link,
      description: BASE_BODY.description,
      approx_price: BASE_BODY.approx_price,
    };
    await db.idempotencyRecord.create({
      data: {
        scope: `user:${PARENT}`,
        key: inProgressKey,
        family_id: FAMILY,
        user_id: PARENT,
        action: "wishlist.create",
        request_hash: idem.hashIdempotentRequest(
          "wishlist.create",
          normalizedBody,
        ),
        expires_at: new Date(Date.now() + idem.IDEMPOTENCY_TTL_MS),
      },
    });
    const inProgress = await POST(
      request(PARENT, BASE_BODY, inProgressKey),
    );
    expect(inProgress.status).toBe(409);
    expect((await inProgress.json()).error).toMatchObject({
      code: "IDEMPOTENCY_IN_PROGRESS",
      retryable: true,
    });
    expect(await db.wishlistItem.count({ where: { family_id: FAMILY } })).toBe(
      0,
    );

    const conflictKey = "wishlist-create-conflict-20261018";
    expect((await POST(request(PARENT, BASE_BODY, conflictKey))).status).toBe(
      201,
    );
    const conflict = await POST(
      request(PARENT, { ...BASE_BODY, title: "Different body" }, conflictKey),
    );
    expect(conflict.status).toBe(422);
    expect((await conflict.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await db.wishlistItem.count({ where: { family_id: FAMILY } })).toBe(
      1,
    );
  });

  it("replays edit and status while applying current role, ownership and feature checks", async () => {
    const created = await POST(request(TEEN, BASE_BODY));
    expect(created.status).toBe(201);
    const itemId = (await created.json()).item.id;

    const editKey = "wishlist-edit-replay-20261018";
    const editBody = { title: "Teen edit" };
    const firstEdit = await PATCH(
      request(TEEN, editBody, editKey, `/api/wishlist/${itemId}`),
      params(itemId),
    );
    expect(firstEdit.status).toBe(200);
    const editReplay = await PATCH(
      request(TEEN, editBody, editKey, `/api/wishlist/${itemId}`),
      params(itemId),
    );
    expect(editReplay.status).toBe(200);
    expect(editReplay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await editReplay.json()).toEqual(await firstEdit.json());

    await db.user.update({ where: { id: TEEN }, data: { role: "child" } });
    const stillOwns = await PATCH(
      request(TEEN, editBody, editKey, `/api/wishlist/${itemId}`),
      params(itemId),
    );
    expect(stillOwns.status).toBe(200);
    await db.user.update({ where: { id: TEEN }, data: { role: "teen" } });

    const parentEditKey = "wishlist-parent-edit-role-replay-20261018";
    const parentEditBody = { title: "Parent moderation edit" };
    expect(
      (
        await PATCH(
          request(PARENT, parentEditBody, parentEditKey, `/api/wishlist/${itemId}`),
          params(itemId),
        )
      ).status,
    ).toBe(200);
    await db.user.update({ where: { id: PARENT }, data: { role: "child" } });
    try {
      const refusedOwnership = await PATCH(
        request(PARENT, parentEditBody, parentEditKey, `/api/wishlist/${itemId}`),
        params(itemId),
      );
      expect(refusedOwnership.status).toBe(403);
    } finally {
      await db.user.update({ where: { id: PARENT }, data: { role: "parent" } });
    }

    const statusKey = "wishlist-status-replay-20261018";
    const firstStatus = await SET_STATUS(
      request(PARENT, { status: "received" }, statusKey, `/api/wishlist/${itemId}/status`),
      params(itemId),
    );
    expect(firstStatus.status).toBe(200);
    const statusReplay = await SET_STATUS(
      request(PARENT, { status: "received" }, statusKey, `/api/wishlist/${itemId}/status`),
      params(itemId),
    );
    expect(statusReplay.status).toBe(200);
    expect(statusReplay.headers.get("Idempotency-Replayed")).toBe("true");

    await db.user.update({ where: { id: PARENT }, data: { role: "child" } });
    try {
      const refusedStatus = await SET_STATUS(
        request(PARENT, { status: "received" }, statusKey, `/api/wishlist/${itemId}/status`),
        params(itemId),
      );
      expect(refusedStatus.status).toBe(403);
    } finally {
      await db.user.update({ where: { id: PARENT }, data: { role: "parent" } });
    }

    await db.family.update({
      where: { id: FAMILY },
      data: { features: { wishlist: false } },
    });
    try {
      const refusedEdit = await PATCH(
        request(TEEN, editBody, editKey, `/api/wishlist/${itemId}`),
        params(itemId),
      );
      expect(refusedEdit.status).toBe(403);
    } finally {
      await db.family.update({
        where: { id: FAMILY },
        data: { features: { wishlist: true } },
      });
    }
  });

  it("replays a keyed delete after removal without resurrecting the item", async () => {
    const created = await POST(request(CHILD, BASE_BODY));
    expect(created.status).toBe(201);
    const itemId = (await created.json()).item.id;
    const key = "wishlist-delete-replay-20261018";
    const first = await DELETE(
      request(CHILD, undefined, key, `/api/wishlist/${itemId}`),
      params(itemId),
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(await db.wishlistItem.findUnique({ where: { id: itemId } })).toBeNull();

    const replay = await DELETE(
      request(CHILD, undefined, key, `/api/wishlist/${itemId}`),
      params(itemId),
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await replay.json()).toEqual(firstBody);
    expect(await db.wishlistItem.findUnique({ where: { id: itemId } })).toBeNull();
  });
});
