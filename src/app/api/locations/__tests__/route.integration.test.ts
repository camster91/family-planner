/**
 * Opt-in PostgreSQL proof for private location writes.
 *
 * The fake isolation suite covers response shape and household projection.
 * This suite exercises the real advisory locks, receipt transaction and
 * same-key replay against a guarded disposable database.
 */
jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);

let mockSessionToken: string | null = null;
jest.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "session_token" && mockSessionToken
        ? { value: mockSessionToken }
        : undefined,
  }),
  headers: async () => new Headers(),
}));

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

import { Client } from "pg";
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";

export {};

const describeWithDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

jest.setTimeout(60_000);

describeWithDatabase("locations routes against PostgreSQL", () => {
  let db: NonNullable<typeof import("@/lib/prisma").prisma>;
  let POST: typeof import("../route").POST;
  let GET: typeof import("../route").GET;
  let PATCH: typeof import("../[id]/route").PATCH;
  let DELETE: typeof import("../[id]/route").DELETE;
  let idem: typeof import("@/lib/idempotency");
  let priorIdempotencyRandom: (() => number) | undefined;
  let fixtureGuardPassed = false;
  let setupSucceeded = false;
  const FAMILY = "locations-route-int-family";
  const OTHER_FAMILY = "locations-route-int-other";
  const PARENT = "locations-route-int-parent";
  const OTHER_PARENT = "locations-route-int-other-parent";
  const KEY = "locations-route-key-20261012";

  function request(
    userId: string,
    body: unknown = { label: "School", address: "2 Main Street" },
    key: string | null = KEY,
  ): any {
    mockSessionToken = `session:${userId}`;
    const headers = new Headers();
    if (key) headers.set("Idempotency-Key", key);
    return {
      url: new URL("http://localhost/api/locations"),
      nextUrl: new URL("http://localhost/api/locations"),
      headers,
      cookies: { get: () => undefined },
      json: async () => body,
    };
  }

  async function cleanup() {
    if (!db) return;
    await db.familyLocation.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.idempotencyRecord.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.family.deleteMany({
      where: { id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.user.deleteMany({
      where: { id: { in: [PARENT, OTHER_PARENT] } },
    });
  }

  function locationParams(id: string) {
    return { params: Promise.resolve({ id }) };
  }

  async function waitForAdvisoryWaiter() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const rows = await db.$queryRaw<Array<{ count: bigint; user_lock: bigint }>>`
        SELECT COUNT(*)::bigint AS count,
               COUNT(*) FILTER (WHERE activity.query ILIKE '%pg_advisory_xact_lock%')::bigint AS user_lock
        FROM pg_locks AS locks
        JOIN pg_stat_activity AS activity ON activity.pid = locks.pid
        WHERE locks.locktype = 'advisory' AND locks.granted = false
      `;
      // The route's lockUser call is the canonical actor lock; checking the
      // SQL activity proves the request reached that waiter before the holder
      // transaction is released rather than merely sleeping and hoping.
      if (Number(rows[0]?.count ?? 0) > 0 && Number(rows[0]?.user_lock ?? 0) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("location mutation did not reach the advisory lock waiter");
  }

  beforeAll(async () => {
    // Refuse non-disposable targets before importing the Prisma singleton.
    assertFixtureTargetAllowed(process.env);
    fixtureGuardPassed = true;
    const mod = await import("@/lib/prisma");
    if (!mod.prisma) throw new Error("Integration database is not configured");
    db = mod.prisma;
    POST = (await import("../route")).POST;
    GET = (await import("../route")).GET;
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
          name: "Locations route integration household",
          invite_code: "locations-route-int-family-invite",
          features: { locations: true },
        },
        {
          id: OTHER_FAMILY,
          name: "Other locations route household",
          invite_code: "locations-route-int-other-invite",
          features: { locations: true },
        },
      ],
    });
    await db.user.createMany({
      data: [
        {
          id: PARENT,
          email: "locations-route-int-parent@example.test",
          name: "Locations route parent",
          role: "parent",
          family_id: FAMILY,
        },
        {
          id: OTHER_PARENT,
          email: "locations-route-int-other@example.test",
          name: "Other locations route parent",
          role: "parent",
          family_id: OTHER_FAMILY,
        },
      ],
    });
    setupSucceeded = true;
  });

  beforeEach(async () => {
    await db.familyLocation.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.idempotencyRecord.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.user.update({
      where: { id: PARENT },
      data: { family_id: FAMILY, role: "parent" },
    });
    await db.family.update({
      where: { id: FAMILY },
      data: { features: { locations: true } },
    });
  });

  afterAll(async () => {
    try {
      if (fixtureGuardPassed && db) await cleanup();
    } finally {
      if (idem && priorIdempotencyRandom) {
        idem.idempotencyRuntime.random = priorIdempotencyRandom;
      }

      await db?.$disconnect();
    }
  });

  it("converges concurrent same-key creates and reads back the one returned id", async () => {
    const body = { label: "School", address: "2 Main Street" };
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => POST(request(PARENT, body))),
    );
    expect(
      responses.every(
        (response) => response.status === 201 || response.status === 409,
      ),
    ).toBe(true);

    const replay = await POST(request(PARENT, body));
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    const replayBody = await replay.json();
    expect(replayBody.location.id).toEqual(expect.any(String));
    expect(
      await db.familyLocation.count({ where: { family_id: FAMILY } }),
    ).toBe(1);

    const readback = await GET(request(PARENT, body, null));
    expect(readback.status).toBe(200);
    expect((await readback.json()).locations).toEqual([
      expect.objectContaining({ id: replayBody.location.id, label: "School" }),
    ]);
  });

  it("re-reads parent and feature state after waiting for the user lock", async () => {
    const holder = new Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();
    let pending: Promise<Response> | undefined;
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `user-membership:${PARENT}`,
      ]);
      pending = POST(
        request(
          PARENT,
          { label: "Office", address: "3 Main" },
          "locations-route-role-race-20261012",
        ),
      );
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (
          await db.idempotencyRecord.count({
            where: {
              scope: `user:${PARENT}`,
              key: "locations-route-role-race-20261012",
            },
          })
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await holder.query('UPDATE "User" SET "role" = $1 WHERE "id" = $2', [
        "teen",
        PARENT,
      ]);
      await holder.query("COMMIT");
      expect((await pending).status).toBe(403);
      expect(
        await db.familyLocation.count({ where: { family_id: FAMILY } }),
      ).toBe(0);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      await holder.end();
      await Promise.allSettled(pending ? [pending] : []);
      await db.user.update({ where: { id: PARENT }, data: { role: "parent" } });
    }
  });

  it("authorizes a completed replay after the actor lock waiter observes a downgrade", async () => {
    const key = "locations-route-replay-role-race-20261012";
    const first = await POST(
      request(PARENT, { label: "Replay office", address: "7 Main" }, key),
    );
    expect(first.status).toBe(201);

    const holder = new Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();
    let pending: Promise<Response> | undefined;
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `user-membership:${PARENT}`,
      ]);
      // The precheck sees the still-parent row; beforeReplay must wait on this
      // lock before it can return the stored private response.
      pending = POST(
        request(PARENT, { label: "Replay office", address: "7 Main" }, key),
      );
      await waitForAdvisoryWaiter();
      await holder.query('UPDATE "User" SET "role" = $1 WHERE "id" = $2', [
        "teen",
        PARENT,
      ]);
      await holder.query("COMMIT");
      expect((await pending).status).toBe(403);
      expect(await db.familyLocation.count({ where: { family_id: FAMILY } })).toBe(1);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      await holder.end();
      await Promise.allSettled(pending ? [pending] : []);
      await db.user.update({ where: { id: PARENT }, data: { role: "parent" } });
    }
  });

  it("re-reads membership after a waiting PATCH and DELETE lock", async () => {
    const patchId = "locations-route-patch-role-race-20261012";
    const deleteId = "locations-route-delete-role-race-20261012";
    await db.familyLocation.create({
      data: {
        id: patchId,
        family_id: FAMILY,
        user_id: PARENT,
        label: "Patch race",
        address: "4 Main",
        is_primary: false,
      },
    });

    const runWaitingMutation = async (
      operation: () => Promise<Response>,
      holder: Client,
    ) => {
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `user-membership:${PARENT}`,
      ]);
      const pending = operation();
      await waitForAdvisoryWaiter();
      await holder.query('UPDATE "User" SET "role" = $1 WHERE "id" = $2', [
        "teen",
        PARENT,
      ]);
      await holder.query("COMMIT");
      return pending;
    };

    const holder = new Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();
    try {
      const patched = await runWaitingMutation(
        () =>
          PATCH(
            request(PARENT, { label: "Changed", address: "5 Main" }, null),
            locationParams(patchId),
          ),
        holder,
      );
      expect((await patched).status).toBe(403);
      const unchanged = await db.familyLocation.findUnique({ where: { id: patchId } });
      expect(unchanged).toMatchObject({ label: "Patch race", address: "4 Main" });

      await db.user.update({ where: { id: PARENT }, data: { role: "parent" } });
      await db.familyLocation.create({
        data: {
          id: deleteId,
          family_id: FAMILY,
          user_id: PARENT,
          label: "Delete race",
          address: "6 Main",
          is_primary: false,
        },
      });
      const deleted = await runWaitingMutation(
        () => DELETE(request(PARENT, {}, null), locationParams(deleteId)),
        holder,
      );
      expect((await deleted).status).toBe(403);
      expect(await db.familyLocation.findUnique({ where: { id: deleteId } })).not.toBeNull();
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      await holder.end();
      await db.user.update({ where: { id: PARENT }, data: { role: "parent" } });
    }
  });

  it("refuses changed payload reuse without a second private row", async () => {
    const key = "locations-route-changed-20261012";
    expect(
      (await POST(request(PARENT, { label: "School", address: "2 Main" }, key)))
        .status,
    ).toBe(201);
    expect(
      (await POST(request(PARENT, { label: "Work", address: "3 Main" }, key)))
        .status,
    ).toBe(422);
    expect(
      await db.familyLocation.count({ where: { family_id: FAMILY } }),
    ).toBe(1);
  });
});
