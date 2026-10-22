/** UNRUN. Requires explicitly permitted disposable DB and additive migrations
 * already installed. This file never generates a client or applies DDL. */
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";
import { eventPreparationStorageAvailable } from "../storage";
import {
  preparationCopyFactId,
  recordPreparationRoutineCopyInTx,
  readPreparationRoutineOrigins,
} from "../origin";
import { EVENT_PREPARATION_READY_ENV } from "../owner";
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
run("event preparation scoped metadata and canonical lifecycle", () => {
  const family = `prep-qa-${crypto.randomUUID()}`,
    foreignFamily = `${family}-other`,
    parent = `${family}-parent`,
    foreignParent = `${family}-foreign`;
  let allowed = false;
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    allowed = true;
    expect(await eventPreparationStorageAvailable(prisma!)).toBe(true);
    for (const id of [family, foreignFamily])
      await prisma!.family.create({
        data: { id, name: "Isolated preparation fixture" },
        select: { id: true },
      });
    for (const [id, familyId] of [
      [parent, family],
      [foreignParent, foreignFamily],
    ])
      await prisma!.user.create({
        data: {
          id,
          family_id: familyId,
          name: "Fixture parent",
          email: `${id}@example.invalid`,
          role: "parent",
        },
        select: { id: true },
      });
  });
  afterAll(async () => {
    if (!allowed) return;
    assertFixtureTargetAllowed(process.env);
    await prisma!.family.deleteMany({
      where: { id: { in: [family, foreignFamily] } },
    });
    await prisma!.user.deleteMany({
      where: { id: { in: [parent, foreignParent] } },
    });
    await prisma!.$disconnect();
  });
  async function fixture() {
    const eventId = `event-${crypto.randomUUID()}`,
      choreId = `chore-${crypto.randomUUID()}`,
      planId = `plan-${crypto.randomUUID()}`,
      stepId = `step-${crypto.randomUUID()}`;
    await prisma!.event.create({
      data: {
        id: eventId,
        family_id: family,
        created_by: parent,
        title: "Fixture event",
        start_time: new Date("2026-10-21T14:00:00Z"),
        end_time: new Date("2026-10-21T15:00:00Z"),
      },
      select: { id: true },
    });
    await prisma!.chore.create({
      data: {
        id: choreId,
        family_id: family,
        created_by: parent,
        assigned_to: parent,
        title: "Fixture task",
        due_date: new Date("2026-10-21T00:00:00Z"),
        frequency: "once",
        points: 0,
      },
      select: { id: true },
    });
    const reviewed = "a".repeat(64);
    await prisma!
      .$executeRaw`INSERT INTO "EventPreparation" ("id","family_id","event_id","reviewed_event_source") VALUES (${planId},${family},${eventId},${reviewed})`;
    await prisma!
      .$executeRaw`INSERT INTO "EventPreparationStep" ("id","family_id","preparation_id","chore_id","position") VALUES (${stepId},${family},${planId},${choreId},1)`;
    return { eventId, choreId, planId, stepId };
  }
  const epoch = async (eventId: string) =>
    (
      await prisma!.$queryRaw<
        Array<{ epoch: number }>
      >`SELECT "preparation_epoch" AS epoch FROM "Event" WHERE "id"=${eventId} AND "family_id"=${family}`
    )[0].epoch;
  it("keeps copy provenance after detach, scopes it to its household, suppresses erased sources and rolls back failed facts", async () => {
    const { choreId, planId } = await fixture();
    const stackId = `stack-${crypto.randomUUID()}`,
      sourceId = `source-${crypto.randomUUID()}`;
    await prisma!.routineStack.create({
      data: {
        id: stackId,
        family_id: family,
        label: "Fixture source",
        fingerprint: "f".repeat(64),
        created_by: parent,
      },
      select: { id: true },
    });
    await prisma!.chore.create({
      data: {
        id: sourceId,
        family_id: family,
        created_by: parent,
        assigned_to: parent,
        title: "Fixture source step",
        due_date: new Date("2026-10-20T00:00:00Z"),
        routine_stack_id: stackId,
        frequency: "once",
        points: 0,
      },
      select: { id: true },
    });
    const origin = {
      stackId,
      sourceChoreId: sourceId,
      occurrenceDay: "2026-10-20",
    };
    const copiedAt = new Date("2026-10-22T12:00:00Z");
    await expect(
      prisma!.$transaction(async (tx) => {
        await recordPreparationRoutineCopyInTx(
          tx,
          { userId: parent, familyId: family },
          choreId,
          origin,
          copiedAt,
        );
        throw new Error("Fixture rollback");
      }),
    ).rejects.toThrow("Fixture rollback");
    expect(
      await prisma!.activity.findUnique({
        where: { id: preparationCopyFactId(family, choreId) },
        select: { id: true },
      }),
    ).toBeNull();
    await prisma!.$transaction((tx) =>
      recordPreparationRoutineCopyInTx(
        tx,
        { userId: parent, familyId: family },
        choreId,
        origin,
        copiedAt,
      ),
    );
    await prisma!
      .$executeRaw`DELETE FROM "EventPreparation" WHERE "id"=${planId} AND "family_id"=${family}`;
    const prior = process.env[EVENT_PREPARATION_READY_ENV];
    process.env[EVENT_PREPARATION_READY_ENV] = "1";
    try {
      const scope = {
        userId: parent,
        familyId: family,
        role: "parent",
        tokenVersion: 0,
        choreIds: [choreId],
      };
      expect(await readPreparationRoutineOrigins(prisma!, scope)).toEqual({
        [choreId]: {
          state: "available",
          ...origin,
          copiedAt: copiedAt.toISOString(),
          label: "Fixture source",
        },
      });
      expect(
        await readPreparationRoutineOrigins(prisma!, {
          ...scope,
          userId: foreignParent,
          familyId: foreignFamily,
        }),
      ).toEqual({});
      await prisma!.chore.update({
        where: { id: sourceId },
        data: { member_subject_erased: true },
        select: { id: true },
      });
      expect(await readPreparationRoutineOrigins(prisma!, scope)).toEqual({
        [choreId]: { state: "unavailable", copiedAt: copiedAt.toISOString() },
      });
      await prisma!.chore.update({
        where: { id: choreId },
        data: { member_subject_erased: true },
        select: { id: true },
      });
      expect(await readPreparationRoutineOrigins(prisma!, scope)).toEqual({});
    } finally {
      if (prior === undefined) delete process.env[EVENT_PREPARATION_READY_ENV];
      else process.env[EVENT_PREPARATION_READY_ENV] = prior;
    }
  });
  const revision = async (planId: string) =>
    (
      await prisma!.$queryRaw<
        Array<{ revision: number }>
      >`SELECT "revision" FROM "EventPreparation" WHERE "id"=${planId} AND "family_id"=${family}`
    )[0].revision;
  const steps = async (planId: string) =>
    (
      await prisma!.$queryRaw<
        Array<{ count: number }>
      >`SELECT COUNT(*)::integer AS count FROM "EventPreparationStep" WHERE "preparation_id"=${planId} AND "family_id"=${family}`
    )[0].count;
  it("event deletion removes metadata while keeping the canonical task and its status", async () => {
    const { eventId, choreId, planId } = await fixture();
    await prisma!.event.delete({
      where: { id: eventId },
      select: { id: true },
    });
    expect(await steps(planId)).toBe(0);
    expect(
      await prisma!.chore.findFirst({
        where: { id: choreId, family_id: family },
        select: { status: true },
      }),
    ).toEqual({ status: "pending" });
  });
  it("plan absent/create/delete continuity advances the Event epoch, not the calendar material epoch", async () => {
    const { eventId, choreId, planId } = await fixture(),
      first = await epoch(eventId);
    const before = (
      await prisma!.$queryRaw<
        Array<{ epoch: number }>
      >`SELECT "schedule_epoch" AS epoch FROM "Event" WHERE "id"=${eventId}`
    )[0].epoch;
    await prisma!
      .$executeRaw`DELETE FROM "EventPreparation" WHERE "id"=${planId} AND "family_id"=${family}`;
    expect(await epoch(eventId)).toBeGreaterThan(first);
    expect(
      (
        await prisma!.$queryRaw<
          Array<{ epoch: number }>
        >`SELECT "schedule_epoch" AS epoch FROM "Event" WHERE "id"=${eventId}`
      )[0].epoch,
    ).toBe(before);
    expect(
      await prisma!.chore.count({ where: { id: choreId, family_id: family } }),
    ).toBe(1);
  });
  it("a canonical task cascade deletes only its link; reinsertion advances the plan and cannot revive an old layout", async () => {
    const { eventId, choreId, planId, stepId } = await fixture(),
      first = await revision(planId),
      before = await epoch(eventId);
    await prisma!.chore.delete({
      where: { id: choreId },
      select: { id: true },
    });
    expect(await steps(planId)).toBe(0);
    expect(await revision(planId)).toBe(first);
    expect(await epoch(eventId)).toBe(before);
    await prisma!.chore.create({
      data: {
        id: choreId,
        family_id: family,
        created_by: parent,
        assigned_to: parent,
        title: "Recreated fixture task",
        due_date: new Date("2026-10-21T00:00:00Z"),
        frequency: "once",
      },
      select: { id: true },
    });
    await prisma!
      .$executeRaw`INSERT INTO "EventPreparationStep" ("id","family_id","preparation_id","chore_id","position") VALUES (${stepId},${family},${planId},${choreId},1)`;
    expect(await revision(planId)).toBeGreaterThan(first);
  });
  it("canonical family moves detach associations without transferring the old task or plan", async () => {
    const taskMove = await fixture();
    await prisma!.chore.update({
      where: { id: taskMove.choreId },
      data: {
        family_id: foreignFamily,
        assigned_to: foreignParent,
        created_by: foreignParent,
      },
      select: { id: true },
    });
    expect(await steps(taskMove.planId)).toBe(0);
    const eventMove = await fixture();
    await prisma!.event.update({
      where: { id: eventMove.eventId },
      data: { family_id: foreignFamily, created_by: foreignParent },
      select: { id: true },
    });
    expect(await steps(eventMove.planId)).toBe(0);
    expect(
      await prisma!.chore.count({
        where: { id: eventMove.choreId, family_id: family },
      }),
    ).toBe(1);
  });
  it("rejects cross-family references and duplicate concrete-task links", async () => {
    const first = await fixture(),
      second = await fixture();
    await expect(
      prisma!
        .$executeRaw`INSERT INTO "EventPreparationStep" ("family_id","preparation_id","chore_id","position") VALUES (${family},${second.planId},${first.choreId},2)`,
    ).rejects.toThrow();
    await expect(
      prisma!
        .$executeRaw`INSERT INTO "EventPreparationStep" ("family_id","preparation_id","chore_id","position") VALUES (${foreignFamily},${first.planId},${second.choreId},2)`,
    ).rejects.toThrow();
  });
  it("completion then undo advances preparation continuity without changing consent material epoch", async () => {
    const { choreId } = await fixture();
    const read = async () =>
      (
        await prisma!.$queryRaw<
          Array<{ preparation: number; material: number }>
        >`SELECT "preparation_epoch" AS preparation, "responsibility_epoch" AS material FROM "Chore" WHERE "id"=${choreId} AND "family_id"=${family}`
      )[0];
    const initial = await read();
    await prisma!.chore.update({
      where: { id: choreId },
      data: {
        status: "completed",
        completed_at: new Date("2026-10-21T14:00:00Z"),
      },
      select: { id: true },
    });
    await prisma!.chore.update({
      where: { id: choreId },
      data: { status: "pending", completed_at: null },
      select: { id: true },
    });
    const current = await read();
    expect(current.preparation).toBe(initial.preparation + 2);
    expect(current.material).toBe(initial.material);
  });
});
