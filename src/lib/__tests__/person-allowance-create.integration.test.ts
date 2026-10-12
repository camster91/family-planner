/**
 * Real-Postgres proof for parent allowance creation and keyed replay safety.
 * Opt in only with RUN_DB_INTEGRATION=1, FIXTURES_ALLOW=1 and a guarded
 * disposable DATABASE_URL.
 */
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";
import pg from "pg";
import { householdLockKey, userLockKey } from "@/lib/household-lock";

export {};

const describeWithDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

jest.setTimeout(60_000);

describeWithDatabase("person allowance create replay integrity", () => {
  let db: NonNullable<typeof import("@/lib/prisma").prisma>;
  let create: typeof import("@/lib/person-allowance-create").createPersonAllowance;
  let idem: typeof import("@/lib/idempotency");
  let priorRandom: (() => number) | undefined;

  const FAMILY = "allowance-create-int-family";
  const OTHER_FAMILY = "allowance-create-int-other";
  const PARENT = "allowance-create-int-parent";
  const CHILD = "allowance-create-int-child";
  const OTHER_CHILD = "allowance-create-int-other-child";
  const TEEN = "allowance-create-int-teen";
  const key = (label: string) => `allowance-create-${label}-20261011`;
  const input = (to_user_id = CHILD, amount = 7) => ({
    to_user_id,
    amount,
    reason: "Weekly allowance",
  });
  const actor = { familyId: FAMILY, userId: PARENT };
  const context = {
    scope: `user:${PARENT}`,
    familyId: FAMILY,
    userId: PARENT,
    action: "allowance.create",
  };

  /**
   * Hold the advisory lock the deletion transaction owns, then run the
   * allowance transaction while it is blocked. The SQL is the bounded
   * critical section of the corresponding member/household deletion: it
   * removes the receipt while still holding that membership lock, then
   * commits so the allowance can observe the deletion and finish.
   */
  async function holdDeletionLock<T>(
    lockKey: string,
    during: () => Promise<T>,
    deletionSql: Array<[string, unknown[]]>,
  ): Promise<T> {
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    let inTransaction = false;
    try {
      await client.query("BEGIN");
      inTransaction = true;
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        lockKey,
      ]);
      const pending = during();
      pending.catch(() => undefined);
      const deadline = Date.now() + 5_000;
      let waiting = false;
      while (Date.now() < deadline) {
        const result = await client.query<{ waiting: string }>(`
          SELECT count(*)::text AS waiting
          FROM pg_stat_activity
          WHERE pid <> pg_backend_pid()
            AND wait_event_type = 'Lock'
            AND query LIKE '%pg_advisory_xact_lock%'
        `);
        if (Number(result.rows[0]?.waiting) > 0) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(waiting).toBe(true);
      for (const [query, params] of deletionSql) {
        await client.query(query, params);
      }
      await client.query("COMMIT");
      inTransaction = false;
      return await pending;
    } finally {
      if (inTransaction) await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  }

  async function pendingReceipt(label: string): Promise<string> {
    const body = input();
    const record = await db.idempotencyRecord.create({
      data: {
        scope: context.scope,
        key: key(label),
        family_id: FAMILY,
        user_id: PARENT,
        action: context.action,
        request_hash: idem.hashIdempotentRequest(context.action, body),
        expires_at: new Date(Date.now() + idem.IDEMPOTENCY_TTL_MS),
      },
      select: { id: true },
    });
    return record.id;
  }

  async function cleanup() {
    await db.idempotencyRecord.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.allowance.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.family.deleteMany({
      where: { id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.user.deleteMany({
      where: { id: { in: [PARENT, CHILD, OTHER_CHILD, TEEN] } },
    });
  }

  async function seed() {
    await db.family.createMany({
      data: [
        {
          id: FAMILY,
          name: "Allowance create tests",
          invite_code: "allowance-create-int-invite",
        },
        {
          id: OTHER_FAMILY,
          name: "Other allowance tests",
          invite_code: "allowance-create-int-other-invite",
        },
      ],
    });
    await db.user.createMany({
      data: [
        {
          id: PARENT,
          email: "allowance-create-parent@example.test",
          name: "Allowance parent",
          role: "parent",
          family_id: FAMILY,
        },
        {
          id: CHILD,
          email: "allowance-create-child@example.test",
          name: "Allowance child",
          role: "child",
          family_id: FAMILY,
        },
        {
          id: TEEN,
          email: "allowance-create-teen@example.test",
          name: "Allowance teen",
          role: "teen",
          family_id: FAMILY,
        },
        {
          id: OTHER_CHILD,
          email: "allowance-create-other-child@example.test",
          name: "Other child",
          role: "child",
          family_id: OTHER_FAMILY,
        },
      ],
    });
  }

  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    const prisma = await import("@/lib/prisma");
    if (!prisma.prisma)
      throw new Error("Integration database is not configured");
    db = prisma.prisma;
    create = (await import("@/lib/person-allowance-create"))
      .createPersonAllowance;
    idem = await import("@/lib/idempotency");
    priorRandom = idem.idempotencyRuntime.random;
    idem.idempotencyRuntime.random = () => 0.99;
    await cleanup();
  });

  beforeEach(async () => {
    await cleanup();
    await seed();
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      if (idem && priorRandom) idem.idempotencyRuntime.random = priorRandom;
      await db?.$disconnect();
    }
  });

  it("converges concurrent same-key creates to one allowance and one replay receipt", async () => {
    const body = input();
    const requestKey = key("concurrent");
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        idem.withIdempotency(
          db,
          requestKey,
          context,
          body,
          async ({ recordId }) => {
            return create(db, body, actor, recordId);
          },
        ),
      ),
    );

    const original = responses.filter(
      (response) =>
        response.status === 201 &&
        response.headers.get("Idempotency-Replayed") === null,
    );
    expect(original).toHaveLength(1);
    const owner = original[0];
    for (const response of responses) {
      if (response === owner) continue;

      if (response.status === 409) {
        expect((await response.json()).error.code).toBe(
          "IDEMPOTENCY_IN_PROGRESS",
        );
        continue;
      }

      expect(response.status).toBe(201);
      expect(response.headers.get("Idempotency-Replayed")).toBe("true");
    }

    const successfulBodies = await Promise.all(
      responses
        .filter((response) => response.status === 201)
        .map((response) => response.json()),
    );
    expect(
      new Set(successfulBodies.map((body) => body.allowance?.id)).size,
    ).toBe(1);
    expect(await db.allowance.count({ where: { family_id: FAMILY } })).toBe(1);
    expect(
      await db.idempotencyRecord.count({
        where: { family_id: FAMILY, key: requestKey, response_status: 201 },
      }),
    ).toBe(1);

    const replay = await idem.withIdempotency(
      db,
      requestKey,
      context,
      body,
      ({ recordId }) => create(db, body, actor, recordId),
    );
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await db.allowance.count({ where: { family_id: FAMILY } })).toBe(1);
  });

  it("rejects a changed payload with the canonical replay conflict and creates no second row", async () => {
    const requestKey = key("changed");
    const body = input();
    await idem.withIdempotency(db, requestKey, context, body, ({ recordId }) =>
      create(db, body, actor, recordId),
    );

    const changed = await idem.withIdempotency(
      db,
      requestKey,
      context,
      input(CHILD, 8),
      ({ recordId }) => create(db, input(CHILD, 8), actor, recordId),
    );
    expect(changed.status).toBe(422);
    expect((await changed.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await db.allowance.count({ where: { family_id: FAMILY } })).toBe(1);
  });

  it("rechecks parent role and recipient membership inside the transaction", async () => {
    const childAttempt = await create(
      db,
      input(),
      { familyId: FAMILY, userId: CHILD },
      null,
    );
    expect(childAttempt.status).toBe(403);
    expect(await db.allowance.count({ where: { family_id: FAMILY } })).toBe(0);

    const foreignAttempt = await create(db, input(OTHER_CHILD), actor, null);
    expect(foreignAttempt.status).toBe(400);
    expect((foreignAttempt.body as { error: string }).error).toBe(
      "Target user not in your family",
    );
    expect(await db.allowance.count({ where: { family_id: FAMILY } })).toBe(0);
  });

  it("replays the committed allowance after the first response is discarded", async () => {
    const body = input(TEEN, 12);
    const requestKey = key("response-loss");
    const first = await idem.withIdempotency(
      db,
      requestKey,
      context,
      body,
      ({ recordId }) => create(db, body, actor, recordId),
    );
    expect(first.status).toBe(201);
    expect(await db.allowance.count({ where: { family_id: FAMILY } })).toBe(1);

    const retry = await idem.withIdempotency(
      db,
      requestKey,
      context,
      body,
      ({ recordId }) => create(db, body, actor, recordId),
    );
    expect(retry.status).toBe(201);
    expect(retry.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await retry.json()).toEqual(await first.json());
    expect(await db.allowance.count({ where: { family_id: FAMILY } })).toBe(1);
  });

  it("does not hold the receipt while waiting on a member deletion lock", async () => {
    const receiptId = await pendingReceipt("member-delete-race");
    const result = await holdDeletionLock(
      userLockKey(PARENT),
      () => create(db, input(), actor, receiptId),
      [
        ['DELETE FROM "IdempotencyRecord" WHERE "id" = $1', [receiptId]],
        ['DELETE FROM "User" WHERE "id" = $1', [PARENT]],
      ],
    );

    expect(result.status).toBe(409);
    expect((result.body as { error?: { code?: string } }).error?.code).toBe(
      "IDEMPOTENCY_IN_PROGRESS",
    );
    expect(await db.allowance.count({ where: { family_id: FAMILY } })).toBe(0);
    expect(await db.user.findUnique({ where: { id: PARENT } })).toBeNull();
  });

  it("does not hold the receipt while waiting on a household deletion lock", async () => {
    const receiptId = await pendingReceipt("household-delete-race");
    const result = await holdDeletionLock(
      householdLockKey(FAMILY),
      () => create(db, input(), actor, receiptId),
      [
        ['DELETE FROM "IdempotencyRecord" WHERE "id" = $1', [receiptId]],
        ['DELETE FROM "User" WHERE "family_id" = $1', [FAMILY]],
        ['DELETE FROM "Family" WHERE "id" = $1', [FAMILY]],
      ],
    );

    expect(result.status).toBe(409);
    expect((result.body as { error?: { code?: string } }).error?.code).toBe(
      "IDEMPOTENCY_IN_PROGRESS",
    );
    expect(await db.allowance.count({ where: { family_id: FAMILY } })).toBe(0);
    expect(await db.family.findUnique({ where: { id: FAMILY } })).toBeNull();
  });
});
