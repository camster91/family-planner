/**
 * Real-Postgres proof for parent allowance creation and keyed replay safety.
 * Opt in only with RUN_DB_INTEGRATION=1, FIXTURES_ALLOW=1 and a guarded
 * disposable DATABASE_URL.
 */
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";

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
  });

  beforeEach(async () => {
    await db.idempotencyRecord.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.allowance.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
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
            // Keep the single owner in-flight while the other callers collide
            // with its receipt. This makes the concurrent branch deterministic;
            // the post-settlement replay below proves the stored 201 path.
            await new Promise((resolve) => setTimeout(resolve, 200));
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
    expect(
      responses.every(
        (response) =>
          response.status === 409 ||
          (response.status === 201 &&
            response.headers.get("Idempotency-Replayed") === "true"),
      ),
    ).toBe(true);
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
});
