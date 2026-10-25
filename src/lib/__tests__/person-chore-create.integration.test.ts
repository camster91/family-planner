/** Authored, not executed. Requires isolated fixture Postgres in later QA. */
import type { Prisma } from "@prisma/client";
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";
export {};
const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
suite("canonical chore create receipt integrity", () => {
  let db: NonNullable<typeof import("@/lib/prisma").prisma>;
  let create: typeof import("@/lib/person-chore-create").createPersonChore;
  let idem: typeof import("@/lib/idempotency");
  const familyId = "chore-replay-fixture-family";
  const userId = "chore-replay-fixture-parent";
  const actor = { userId, familyId, tokenVersion: 0 };
  const input = {
    title: "Synthetic chore",
    assigned_to: userId,
    points: 10,
    due_date: "2099-10-05",
    frequency: "once" as const,
    difficulty: "medium" as const,
  };
  const ctx = {
    scope: `user:${userId}`,
    userId,
    familyId,
    action: "chore.create",
  };
  const key = "chore-create-fixture-stable-key";
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    db = (await import("@/lib/prisma")).prisma!;
    create = (await import("@/lib/person-chore-create")).createPersonChore;
    idem = await import("@/lib/idempotency");
    await db.family.deleteMany({ where: { id: familyId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.family.create({
      data: {
        id: familyId,
        name: "Synthetic chore tests",
        invite_code: familyId,
      },
    });
    await db.user.create({
      data: {
        id: userId,
        name: "Synthetic parent",
        email: "chore-replay@example.test",
        role: "parent",
        family_id: familyId,
      },
    });
  });
  beforeEach(async () => {
    await db.notificationRecipientDecision.deleteMany({ where: { family_id: familyId } });
    await db.notificationEventOccurrence.deleteMany({ where: { family_id: familyId } });
    await db.notification.deleteMany({ where: { user_id: userId } });
    await db.chore.deleteMany({ where: { family_id: familyId } });
    await db.activity.deleteMany({ where: { family_id: familyId } });
    await db.idempotencyRecord.deleteMany({ where: { family_id: familyId } });
    await db.user.update({
      where: { id: userId },
      data: { token_version: 0, role: "parent", notify_chores: true },
    });
  });
  afterAll(async () => {
    if (!db) return;
    await db.family.deleteMany({ where: { id: familyId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });
  const run = () =>
    idem.withIdempotency(db, key, ctx, input, ({ recordId }) =>
      create(
        db,
        actor,
        input,
        new Date("2099-10-05T00:00:00Z"),
        null,
        recordId,
      ),
    );
  const receipt = () =>
    db.idempotencyRecord.create({
      data: {
        scope: ctx.scope,
        action: ctx.action,
        family_id: familyId,
        user_id: userId,
        key,
        request_hash: idem.hashIdempotentRequest(ctx.action, input),
        expires_at: new Date(Date.now() + idem.IDEMPOTENCY_TTL_MS),
      },
    });
  it("replays a lost reply and never resurrects a subsequently removed chore", async () => {
    const first = await (await run()).json();
    expect(first).toEqual({ choreId: expect.any(String) });
    expect(await (await run()).json()).toEqual(first);
    expect(
      await db.activity.count({
        where: { family_id: familyId, type: "chore_created" },
      }),
    ).toBe(1);
    expect(await db.chore.count({ where: { family_id: familyId } })).toBe(1);
    await db.chore.delete({ where: { id: first.choreId } });
    expect(await (await run()).json()).toEqual(first);
    expect(await db.chore.count({ where: { family_id: familyId } })).toBe(0);
  });
  it("serializes overlapping original and takeover effects on the same receipt", async () => {
    const saved = await receipt();
    const results = await Promise.all(
      [0, 1].map(() =>
        create(
          db,
          actor,
          input,
          new Date("2099-10-05T00:00:00Z"),
          null,
          saved.id,
        ),
      ),
    );
    expect(results[0]).toEqual(results[1]);
    expect(await db.chore.count({ where: { family_id: familyId } })).toBe(1);
  });
  it("rolls back the canonical effect when its atomic receipt cannot be completed", async () => {
    const saved = await receipt();
    const failingDb = {
      $executeRaw: db.$executeRaw.bind(db),
      $transaction: ((
        run: (tx: Prisma.TransactionClient) => Promise<unknown>,
      ) =>
        db.$transaction((tx) =>
          run(
            new Proxy(tx, {
              get(target, property) {
                if (property === "idempotencyRecord")
                  return {
                    ...target.idempotencyRecord,
                    update: async () => {
                      throw new Error("receipt-write-failed");
                    },
                  };
                return Reflect.get(target, property);
              },
            }),
          ),
        )) as typeof db.$transaction,
    };
    await expect(
      create(
        failingDb,
        actor,
        input,
        new Date("2099-10-05T00:00:00Z"),
        null,
        saved.id,
      ),
    ).rejects.toThrow("receipt-write-failed");
    expect(await db.chore.count({ where: { family_id: familyId } })).toBe(0);
  });
  it("renews parent, household and session authority inside the effect transaction", async () => {
    await db.user.update({ where: { id: userId }, data: { token_version: 1 } });
    expect(
      (await create(db, actor, input, new Date(input.due_date), null, null))
        .status,
    ).toBe(401);
    expect(
      (
        await create(
          db,
          { ...actor, tokenVersion: 1, familyId: "foreign-family" },
          input,
          new Date(input.due_date),
          null,
          null,
        )
      ).status,
    ).toBe(403);
    await db.user.update({ where: { id: userId }, data: { role: "teen" } });
    expect(
      (
        await create(
          db,
          { ...actor, tokenVersion: 1 },
          input,
          new Date(input.due_date),
          null,
          null,
        )
      ).status,
    ).toBe(403);
    expect(await db.chore.count({ where: { family_id: familyId } })).toBe(0);
  });
  async function withEventMode(work: () => Promise<void>) {
    const keys = ["NOTIFICATION_EVENT_ADMISSION_ENABLED", "CHORE_CREATE_NOTIFICATION_EVENTS_ENABLED", "CHORE_CREATE_NOTIFICATION_DISPATCH_MS"];
    const prior = keys.map(name => process.env[name]);
    process.env.NOTIFICATION_EVENT_ADMISSION_ENABLED = "1";
    process.env.CHORE_CREATE_NOTIFICATION_EVENTS_ENABLED = "1";
    process.env.CHORE_CREATE_NOTIFICATION_DISPATCH_MS = "60000";
    try {
      await db.family.update({ where: { id: familyId }, data: { features: { chores: true } } });
      await work();
    } finally {
      keys.forEach((name, index) => { if (prior[index] === undefined) delete process.env[name]; else process.env[name] = prior[index]; });
    }
  }
  it("atomically creates one event/recipient/inbox row and skips duplicate legacy send on replay", async () => {
    await withEventMode(async () => {
      const first = await (await run()).json();
      expect(await (await run()).json()).toEqual(first);
      expect(await db.chore.count({ where: { family_id: familyId } })).toBe(1);
      expect(await db.notificationEventOccurrence.count({ where: { family_id: familyId } })).toBe(1);
      expect(await db.notificationRecipientDecision.count({ where: { family_id: familyId } })).toBe(1);
      expect(await db.notification.count({ where: { user_id: userId } })).toBe(1);
      await db.notification.deleteMany({ where: { user_id: userId } });
      await run();
      expect(await db.notification.count({ where: { user_id: userId } })).toBe(0);
      expect(await db.notificationRecipientDecision.count({ where: { family_id: familyId } })).toBe(1);
    });
  });
  it("keeps a suppressed creation terminal after preferences are enabled and the command is replayed", async () => {
    await withEventMode(async () => {
      await db.user.update({ where: { id: userId }, data: { notify_chores: false } });
      await run();
      expect(await db.notificationRecipientDecision.findFirst({ where: { family_id: familyId } })).toMatchObject({ status: "suppressed", notification_id: null });
      await db.user.update({ where: { id: userId }, data: { notify_chores: true } });
      await run();
      expect(await db.notification.count({ where: { user_id: userId } })).toBe(0);
    });
  });

  it("rolls back event, recipient and visible notification with a failed final chore receipt", async () => {
    await withEventMode(async () => {
      const saved = await receipt();
      const failingDb = {
        $executeRaw: db.$executeRaw.bind(db),
        $transaction: ((work: (tx: Prisma.TransactionClient) => Promise<unknown>) => db.$transaction(tx => work(new Proxy(tx, {
          get(target, property) {
            if (property === "idempotencyRecord") return { ...target.idempotencyRecord, update: async () => { throw new Error("fixture-final-receipt-refusal"); } };
            return Reflect.get(target, property);
          },
        })))) as typeof db.$transaction,
      };
      await expect(create(failingDb, actor, input, new Date(input.due_date), null, saved.id)).rejects.toThrow("fixture-final-receipt-refusal");
      expect(await db.chore.count({ where: { family_id: familyId } })).toBe(0);
      expect(await db.notificationEventOccurrence.count({ where: { family_id: familyId } })).toBe(0);
      expect(await db.notificationRecipientDecision.count({ where: { family_id: familyId } })).toBe(0);
      expect(await db.notification.count({ where: { user_id: userId } })).toBe(0);
    });
  });

});
