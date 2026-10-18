/**
 * Opt-in PostgreSQL proof for Anniversaries idempotency (#499 follow-up).
 *
 * This calls the real route handlers against a guarded disposable database.
 * It is skipped unless RUN_DB_INTEGRATION=1 and never targets an unapproved
 * database because assertFixtureTargetAllowed runs before Prisma is imported.
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

export {};

const describeWithDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

jest.setTimeout(60_000);

describeWithDatabase("anniversaries routes against PostgreSQL", () => {
  let db: NonNullable<typeof import("@/lib/prisma").prisma>;
  let POST: typeof import("../route").POST;
  let PATCH: typeof import("../[id]/route").PATCH;
  let DELETE: typeof import("../[id]/route").DELETE;
  let idem: typeof import("@/lib/idempotency");
  let priorIdempotencyRandom: (() => number) | undefined;
  let fixtureGuardPassed = false;

  const FAMILY = "ann-route-int-family";
  const OTHER_FAMILY = "ann-route-int-other-family";
  const PARENT = "ann-route-int-parent";
  const SECOND_PARENT = "ann-route-int-second-parent";
  const TEEN = "ann-route-int-teen";
  const OTHER_PARENT = "ann-route-int-other-parent";
  const BASE_BODY = {
    name: "Route integration birthday",
    type: "birthday" as const,
    date: "2026-12-01",
    notes: "synthetic",
  };

  function request(userId: string, body: unknown, key?: string): any {
    const headers = new Headers();
    if (key) headers.set("Idempotency-Key", key);
    const url = new URL("http://localhost/api/anniversaries");
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

  function params(id: string) {
    return { params: Promise.resolve({ id }) };
  }

  async function cleanup() {
    if (!db) return;
    await db.idempotencyRecord.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.anniversary.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.family.deleteMany({
      where: { id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.user.deleteMany({
      where: { id: { in: [PARENT, SECOND_PARENT, TEEN, OTHER_PARENT] } },
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
    idem = await import("@/lib/idempotency");
    priorIdempotencyRandom = idem.idempotencyRuntime.random;
    idem.idempotencyRuntime.random = () => 0.99;

    await cleanup();
    await db.family.createMany({
      data: [
        {
          id: FAMILY,
          name: "Anniversaries route integration household",
          invite_code: "ann-route-int-family-invite",
          features: { anniversaries: true },
        },
        {
          id: OTHER_FAMILY,
          name: "Other anniversaries route household",
          invite_code: "ann-route-int-other-invite",
          features: { anniversaries: true },
        },
      ],
    });
    await db.user.createMany({
      data: [
        {
          id: PARENT,
          email: "ann-route-int-parent@example.test",
          name: "Anniversaries route parent",
          role: "parent",
          family_id: FAMILY,
        },
        {
          id: SECOND_PARENT,
          email: "ann-route-int-second-parent@example.test",
          name: "Second anniversaries route parent",
          role: "parent",
          family_id: FAMILY,
        },
        {
          id: TEEN,
          email: "ann-route-int-teen@example.test",
          name: "Anniversaries route teen",
          role: "teen",
          family_id: FAMILY,
        },
        {
          id: OTHER_PARENT,
          email: "ann-route-int-other@example.test",
          name: "Other anniversaries route parent",
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
    await db.anniversary.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.user.update({
      where: { id: PARENT },
      data: { family_id: FAMILY, role: "parent" },
    });
    await db.user.update({
      where: { id: TEEN },
      data: { family_id: FAMILY, role: "teen" },
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
        if (idem && priorIdempotencyRandom) {
          idem.idempotencyRuntime.random = priorIdempotencyRandom;
        }
        await db?.$disconnect();
      } catch (error) {
        cleanupError ??= error;
      }
    }
    if (cleanupError) throw cleanupError;
  });

  it("replays a keyed create after a lost response and rejects changed body", async () => {
    const key = "ann-create-replay-20261018";
    const first = await POST(request(PARENT, BASE_BODY, key));
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    expect(firstBody.date).toMatchObject({
      can_edit: true,
      can_delete: true,
    });

    const replay = await POST(request(PARENT, BASE_BODY, key));
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await replay.json()).toEqual(firstBody);

    const changed = await POST(
      request(PARENT, { ...BASE_BODY, name: "Changed request" }, key),
    );
    expect(changed.status).toBe(422);
    expect((await changed.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await db.anniversary.count({ where: { family_id: FAMILY } })).toBe(
      1,
    );
  });

  it("returns the canonical in-progress response without writing a row", async () => {
    const key = "ann-create-in-progress-20261018";
    await db.idempotencyRecord.create({
      data: {
        scope: `user:${PARENT}`,
        key,
        family_id: FAMILY,
        user_id: PARENT,
        action: "anniversary.create",
        request_hash: idem.hashIdempotentRequest(
          "anniversary.create",
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
    expect(await db.anniversary.count({ where: { family_id: FAMILY } })).toBe(
      0,
    );
  });

  it("replays a completed delete after its row is gone", async () => {
    const row = await db.anniversary.create({
      data: {
        family_id: FAMILY,
        name: "Delete replay",
        type: "custom",
        date: new Date("2026-12-02T00:00:00.000Z"),
        created_by: PARENT,
      },
    });
    const key = "ann-delete-replay-20261018";
    const first = await DELETE(request(PARENT, undefined, key), params(row.id));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(
      await db.anniversary.findUnique({ where: { id: row.id } }),
    ).toBeNull();

    const replay = await DELETE(
      request(PARENT, undefined, key),
      params(row.id),
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await replay.json()).toEqual(firstBody);
  });

  it("replays a completed update without resurrecting a deleted row", async () => {
    const row = await db.anniversary.create({
      data: {
        family_id: FAMILY,
        name: "Update replay",
        type: "custom",
        date: new Date("2026-12-03T00:00:00.000Z"),
        created_by: PARENT,
      },
    });
    const key = "ann-update-replay-20261018";
    const body = { name: "Updated replay" };
    const first = await PATCH(request(PARENT, body, key), params(row.id));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    await db.anniversary.delete({ where: { id: row.id } });

    const replay = await PATCH(request(PARENT, body, key), params(row.id));
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await replay.json()).toEqual(firstBody);
    expect(
      await db.anniversary.findUnique({ where: { id: row.id } }),
    ).toBeNull();
  });

  it("does not replay a family receipt after the authenticated user moves", async () => {
    const key = "ann-create-family-scope-20261018";
    const first = await POST(request(PARENT, BASE_BODY, key));
    expect(first.status).toBe(201);

    await db.user.update({
      where: { id: PARENT },
      data: { family_id: OTHER_FAMILY },
    });
    const moved = await POST(request(PARENT, BASE_BODY, key));
    expect(moved.status).toBe(422);
    expect((await moved.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(
      await db.anniversary.count({ where: { family_id: OTHER_FAMILY } }),
    ).toBe(0);
  });

  it("returns live grants for a teen's own edit while retaining parent-only delete", async () => {
    const created = await POST(request(TEEN, BASE_BODY));
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.date).toMatchObject({
      can_edit: true,
      can_delete: false,
    });

    const rowId = createdBody.date.id;
    const updated = await PATCH(
      request(TEEN, { name: "Teen edited date" }, "ann-teen-edit-20261018"),
      params(rowId),
    );
    expect(updated.status).toBe(200);
    expect((await updated.json()).date).toMatchObject({
      name: "Teen edited date",
      can_edit: true,
      can_delete: false,
    });

    const deniedDelete = await DELETE(
      request(TEEN, undefined, "ann-teen-delete-20261018"),
      params(rowId),
    );
    expect(deniedDelete.status).toBe(403);
    expect(
      await db.anniversary.findUnique({ where: { id: rowId } }),
    ).toMatchObject({ name: "Teen edited date", created_by: TEEN });
  });

  it("reprojects a completed parent create replay after a child downgrade", async () => {
    const key = "ann-create-role-replay-20261018";
    const first = await POST(request(PARENT, BASE_BODY, key));
    expect(first.status).toBe(201);
    expect((await first.json()).date).toMatchObject({
      can_edit: true,
      can_delete: true,
    });

    await db.user.update({
      where: { id: PARENT },
      data: { role: "child" },
    });
    try {
      const replay = await POST(request(PARENT, BASE_BODY, key));
      expect(replay.status).toBe(201);
      expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
      expect((await replay.json()).date).toMatchObject({
        can_edit: true,
        can_delete: false,
      });
      expect(await db.anniversary.count({ where: { family_id: FAMILY } })).toBe(
        1,
      );
    } finally {
      await db.user.update({
        where: { id: PARENT },
        data: { role: "parent", family_id: FAMILY },
      });
    }
  });

  it("denies a completed receipt when the feature is turned off", async () => {
    const key = "ann-create-feature-off-20261018";
    const first = await POST(request(PARENT, BASE_BODY, key));
    expect(first.status).toBe(201);

    await db.family.update({
      where: { id: FAMILY },
      data: { features: { anniversaries: false } },
    });
    try {
      const denied = await POST(request(PARENT, BASE_BODY, key));
      expect(denied.status).toBe(403);
      expect((await denied.json()).error).toBe(
        "This feature is turned off for your family",
      );
      expect(await db.anniversary.count({ where: { family_id: FAMILY } })).toBe(
        1,
      );
      await expect(
        db.idempotencyRecord.findFirstOrThrow({
          where: { scope: `user:${PARENT}`, key },
        }),
      ).resolves.toMatchObject({ response_status: 201 });
    } finally {
      await db.family.update({
        where: { id: FAMILY },
        data: { features: { anniversaries: true } },
      });
    }
  });

  it("denies a parent receipt replay after the actor is downgraded to child", async () => {
    const row = await db.anniversary.create({
      data: {
        family_id: FAMILY,
        name: "Role replay",
        type: "custom",
        date: new Date("2026-12-04T00:00:00.000Z"),
        created_by: SECOND_PARENT,
      },
    });
    const key = "ann-update-role-replay-20261018";
    const body = { name: "Parent updated role replay" };
    const first = await PATCH(request(PARENT, body, key), params(row.id));
    expect(first.status).toBe(200);
    await db.anniversary.delete({ where: { id: row.id } });

    await db.user.update({
      where: { id: PARENT },
      data: { role: "child" },
    });
    try {
      const denied = await PATCH(request(PARENT, body, key), params(row.id));
      expect(denied.status).toBe(403);
      expect((await denied.json()).error).toBe(
        "You can only edit dates you added",
      );
      expect(
        await db.anniversary.findUnique({ where: { id: row.id } }),
      ).toBeNull();
      await expect(
        db.idempotencyRecord.findFirstOrThrow({
          where: { scope: `user:${PARENT}`, key },
        }),
      ).resolves.toMatchObject({ response_status: 200 });
    } finally {
      await db.user.update({
        where: { id: PARENT },
        data: { role: "parent", family_id: FAMILY },
      });
    }
  });
});
