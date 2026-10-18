/**
 * Real PostgreSQL coverage for receipt-safe Rewards mutations.
 *
 * This suite is opt-in and must only run against an explicitly disposable
 * fixture database. It exercises the domain transactions directly while
 * applying the same receipt/replay guard that the HTTP routes use. The route
 * tests cover the response and notification wiring; this suite proves the
 * real row, XP, and receipt changes are atomic under PostgreSQL.
 */
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";
import crypto from "node:crypto";

jest.mock("@/lib/notifications-server", () => ({
  notificationServiceServer: {
    sendNotification: jest.fn(async () => undefined),
  },
}));

import { notificationServiceServer } from "@/lib/notifications-server";

export {};

const databaseSuiteEnabled =
  process.env.RUN_DB_INTEGRATION === "1" &&
  process.env.FIXTURES_ALLOW === "1" &&
  process.env.NODE_ENV !== "production";
const describeWithDatabase = databaseSuiteEnabled ? describe : describe.skip;

jest.setTimeout(120_000);

type Db = NonNullable<typeof import("@/lib/prisma").prisma>;
type RewardActor = import("@/lib/reward-mutations").RewardActor;
type EffectResult = import("@/lib/idempotency").EffectResult;

const PREFIX = `reward-int-${process.pid}`;
const FAMILY_A = `${PREFIX}-family-a`;
const FAMILY_B = `${PREFIX}-family-b`;
const PARENT_A = `${PREFIX}-parent-a`;
const TEEN_A = `${PREFIX}-teen-a`;
const CHILD_A = `${PREFIX}-child-a`;
const PARENT_B = `${PREFIX}-parent-b`;

const FEATURES_ON = {
  gamification: true,
  rewards: true,
};

function actor(userId: string, familyId = FAMILY_A, role = "parent"): RewardActor {
  return { familyId, userId, role };
}

function context(actorValue: RewardActor, action: string) {
  return {
    scope: `user:${actorValue.userId}`,
    familyId: actorValue.familyId,
    userId: actorValue.userId,
    action,
  };
}

function freshKey(): string {
  // Idempotency keys are UUIDs in the public contract. A per-test random key
  // also keeps a crashed disposable run from colliding with this run.
  return crypto.randomUUID();
}

describeWithDatabase("Rewards mutations against disposable PostgreSQL", () => {
  let db: Db;
  let createReward: typeof import("@/lib/reward-mutations").createReward;
  let claimReward: typeof import("@/lib/reward-mutations").claimReward;
  let approveReward: typeof import("@/lib/reward-mutations").approveReward;
  let authorizeRewardReplay: typeof import("@/lib/reward-mutations").authorizeRewardReplay;
  let idempotency: typeof import("@/lib/idempotency");
  let InsufficientRewardXpError: typeof import("@/lib/reward-mutations").InsufficientRewardXpError;

  async function removeFixtures(): Promise<void> {
    if (!db) return;
    await db.idempotencyRecord.deleteMany({
      where: { family_id: { in: [FAMILY_A, FAMILY_B] } },
    });
    await db.reward.deleteMany({
      where: { family_id: { in: [FAMILY_A, FAMILY_B] } },
    });
    await db.user.deleteMany({
      where: {
        id: { in: [PARENT_A, TEEN_A, CHILD_A, PARENT_B] },
      },
    });
    await db.family.deleteMany({ where: { id: { in: [FAMILY_A, FAMILY_B] } } });
  }

  async function seedFixtures(): Promise<void> {
    await removeFixtures();
    await db.family.createMany({
      data: [
        {
          id: FAMILY_A,
          name: "Rewards integration A",
          invite_code: `${PREFIX}-invite-a`,
          features: FEATURES_ON,
        },
        {
          id: FAMILY_B,
          name: "Rewards integration B",
          invite_code: `${PREFIX}-invite-b`,
          features: FEATURES_ON,
        },
      ],
    });
    await db.user.createMany({
      data: [
        {
          id: PARENT_A,
          email: `${PREFIX}-parent-a@example.test`,
          name: "Parent A",
          role: "parent",
          family_id: FAMILY_A,
          xp: 500,
        },
        {
          id: TEEN_A,
          email: `${PREFIX}-teen-a@example.test`,
          name: "Teen A",
          role: "teen",
          family_id: FAMILY_A,
          xp: 500,
        },
        {
          id: CHILD_A,
          email: `${PREFIX}-child-a@example.test`,
          name: "Child A",
          role: "child",
          family_id: FAMILY_A,
          xp: 500,
        },
        {
          id: PARENT_B,
          email: `${PREFIX}-parent-b@example.test`,
          name: "Parent B",
          role: "parent",
          family_id: FAMILY_B,
          xp: 500,
        },
      ],
    });
  }

  async function createFixtureReward(
    id: string,
    status: string = "available",
    cost = 10,
  ): Promise<void> {
    await db.reward.create({
      data: {
        id,
        family_id: FAMILY_A,
        name: id,
        description: null,
        cost,
        icon: "gift",
        status,
        created_by: PARENT_A,
        claimed_by: status === "claimed" ? CHILD_A : null,
        claimed_at: status === "claimed" ? new Date() : null,
      },
    });
  }

  async function runEffect(
    key: string,
    actorValue: RewardActor,
    action: string,
    body: unknown,
    effect: (recordId: string) => Promise<EffectResult>,
    beforeReplay?: () => Promise<EffectResult | null>,
  ) {
    return idempotency.withIdempotency(
      db,
      key,
      context(actorValue, action),
      body,
      ({ recordId }) => {
        if (!recordId) throw new Error("Expected a keyed receipt");
        return effect(recordId);
      },
      beforeReplay ? { beforeReplay } : undefined,
    );
  }

  beforeAll(async () => {
    // The guard runs before the Prisma module is loaded. A malformed or
    // production-like DATABASE_URL therefore cannot open a client at all.
    assertFixtureTargetAllowed(process.env);
    const loaded = await import("@/lib/prisma");
    if (!loaded.prisma) throw new Error("Rewards integration needs Prisma");
    db = loaded.prisma;
    const mutations = await import("@/lib/reward-mutations");
    createReward = mutations.createReward;
    claimReward = mutations.claimReward;
    approveReward = mutations.approveReward;
    authorizeRewardReplay = mutations.authorizeRewardReplay;
    InsufficientRewardXpError = mutations.InsufficientRewardXpError;
    idempotency = await import("@/lib/idempotency");
    await seedFixtures();
  });

  afterEach(async () => {
    if (db) await seedFixtures();
  });

  afterAll(async () => {
    await removeFixtures();
    await db?.$disconnect();
  });

  it("commits a create and its receipt together, and rolls both back on claim failure", async () => {
    const parent = actor(PARENT_A);
    const createBody = { name: "Atomic reward", cost: 25, icon: "gift" };
    const created = await runEffect(
      freshKey(),
      parent,
      "reward.create",
      createBody,
      async (recordId) => (await createReward(db, createBody, parent, recordId)).result,
    );
    expect(created.status).toBe(200);
    expect(await db.reward.count({ where: { family_id: FAMILY_A } })).toBe(1);
    expect(await db.idempotencyRecord.count({ where: { family_id: FAMILY_A, response_status: 200 } })).toBe(1);

    await createFixtureReward(`${PREFIX}-too-expensive`, "available", 900);
    await db.user.update({ where: { id: CHILD_A }, data: { xp: 10 } });
    const child = actor(CHILD_A, FAMILY_A, "child");
    const claimBody = { rewardId: `${PREFIX}-too-expensive` };
    const key = freshKey();
    await expect(
      runEffect(key, child, "reward.claim", claimBody, async (recordId) =>
        (await claimReward(db, claimBody, child, recordId)).result,
      ),
    ).rejects.toBeInstanceOf(InsufficientRewardXpError);
    expect(await db.user.findUnique({ where: { id: CHILD_A }, select: { xp: true } })).toEqual({ xp: 10 });
    expect(await db.reward.findUnique({ where: { id: `${PREFIX}-too-expensive` }, select: { status: true } })).toEqual({ status: "available" });
    expect(await db.idempotencyRecord.count({ where: { key } })).toBe(0);
  });

  it("replays create without a second row and rejects changed body or an active receipt", async () => {
    const parent = actor(PARENT_A);
    const key = freshKey();
    const body = { name: "Replay once", cost: 15, icon: "gift" };
    const first = await runEffect(
      key,
      parent,
      "reward.create",
      body,
      async (recordId) => (await createReward(db, body, parent, recordId)).result,
    );
    const retry = await runEffect(
      key,
      parent,
      "reward.create",
      body,
      async (recordId) => (await createReward(db, body, parent, recordId)).result,
    );
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(retry.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await db.reward.count({ where: { family_id: FAMILY_A, name: body.name } })).toBe(1);

    const changed = await runEffect(
      key,
      parent,
      "reward.create",
      { ...body, cost: 16 },
      async (recordId) =>
        (await createReward(db, { ...body, cost: 16 }, parent, recordId)).result,
    );
    expect(changed.status).toBe(422);

    const pendingKey = freshKey();
    await db.idempotencyRecord.create({
      data: {
        scope: context(parent, "reward.create").scope,
        key: pendingKey,
        family_id: FAMILY_A,
        user_id: PARENT_A,
        action: "reward.create",
        request_hash: idempotency.hashIdempotentRequest("reward.create", body),
        expires_at: new Date(Date.now() + idempotency.IDEMPOTENCY_TTL_MS),
      },
    });
    const pending = await runEffect(
      pendingKey,
      parent,
      "reward.create",
      body,
      async (recordId) => (await createReward(db, body, parent, recordId)).result,
    );
    expect(pending.status).toBe(409);
    expect((await pending.json()).error.code).toBe("IDEMPOTENCY_IN_PROGRESS");
  });

  it("charges XP once for concurrent same-key claims and preserves the replay envelope", async () => {
    const rewardId = `${PREFIX}-concurrent-claim`;
    await createFixtureReward(rewardId, "available", 100);
    const child = actor(CHILD_A, FAMILY_A, "child");
    const body = { rewardId };
    const key = freshKey();
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        runEffect(
          key,
          child,
          "reward.claim",
          body,
          async (recordId) => (await claimReward(db, body, child, recordId)).result,
        ),
      ),
    );
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(5);
    expect(await db.user.findUnique({ where: { id: CHILD_A }, select: { xp: true } })).toEqual({ xp: 400 });
    expect(await db.reward.findUnique({ where: { id: rewardId }, select: { status: true, claimed_by: true } })).toEqual({ status: "claimed", claimed_by: CHILD_A });

    const replay = await runEffect(
      key,
      child,
      "reward.claim",
      body,
      async (recordId) => (await claimReward(db, body, child, recordId)).result,
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await db.user.findUnique({ where: { id: CHILD_A }, select: { xp: true } })).toEqual({ xp: 400 });
  });

  it("transitions approval once and invokes the test notification transport only once", async () => {
    const rewardId = `${PREFIX}-approval`;
    await createFixtureReward(rewardId, "claimed", 10);
    const parent = actor(PARENT_A);
    const body = { rewardId };
    const notify = notificationServiceServer.sendNotification as jest.Mock;
    notify.mockClear();
    const approve = (key: string) =>
      runEffect(
        key,
        parent,
        "reward.approve",
        body,
        async (recordId) => {
          const mutation = await approveReward(db, body, parent, recordId);
          if (mutation.applied && mutation.claimerId) {
            await notify({
              familyId: FAMILY_A,
              userId: mutation.claimerId,
              title: "Reward Approved!",
              message: "Enjoy your reward!",
              type: "reward",
            });
          }
          return mutation.result;
        },
      );

    const approvalKey = freshKey();
    const first = await approve(approvalKey);
    const retry = await approve(approvalKey);
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(retry.headers.get("Idempotency-Replayed")).toBe("true");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(await db.reward.findUnique({ where: { id: rewardId }, select: { status: true, approved: true } })).toEqual({ status: "redeemed", approved: true });

    const freshKeyResponse = await approve(freshKey());
    expect(freshKeyResponse.status).toBe(400);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("rechecks role, household membership, and effective feature state before replay", async () => {
    const parent = actor(PARENT_A);
    const body = { name: "Authority replay", cost: 20, icon: "gift" };
    const key = freshKey();
    const first = await runEffect(
      key,
      parent,
      "reward.create",
      body,
      async (recordId) => (await createReward(db, body, parent, recordId)).result,
    );
    expect(first.status).toBe(200);

    await db.user.update({ where: { id: PARENT_A }, data: { role: "teen" } });
    const downgraded = await runEffect(
      key,
      parent,
      "reward.create",
      body,
      async (recordId) => (await createReward(db, body, parent, recordId)).result,
      () => authorizeRewardReplay(db, parent, true),
    );
    expect(downgraded.status).toBe(403);
    expect(await db.reward.count({ where: { family_id: FAMILY_A, name: body.name } })).toBe(1);

    await db.user.update({ where: { id: PARENT_A }, data: { role: "parent", family_id: FAMILY_B } });
    const moved = await runEffect(
      key,
      parent,
      "reward.create",
      body,
      async (recordId) => (await createReward(db, body, parent, recordId)).result,
      () => authorizeRewardReplay(db, parent, true),
    );
    expect(moved.status).toBe(400);

    await db.user.update({ where: { id: PARENT_A }, data: { family_id: FAMILY_A } });
    await db.family.update({ where: { id: FAMILY_A }, data: { features: { gamification: false, rewards: true } } });
    const disabled = await runEffect(
      key,
      parent,
      "reward.create",
      body,
      async (recordId) => (await createReward(db, body, parent, recordId)).result,
      () => authorizeRewardReplay(db, parent, true),
    );
    expect(disabled.status).toBe(403);
    expect(await db.reward.count({ where: { family_id: FAMILY_A, name: body.name } })).toBe(1);
  });
});
