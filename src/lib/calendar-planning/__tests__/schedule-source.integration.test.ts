/** UNRUN. Requires explicitly allowed disposable DB, with migrations already
 * applied. No schema/generation/migration is invoked by this source file. */
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";
import { lockUser, lockHousehold } from "@/lib/household-lock";
import {
  scheduleStorageAvailable,
  lockScheduleTarget,
  readScheduleComparisonInTx,
  applyComparedScheduleMoveInTx,
  type ScheduleEventSource,
} from "../schedule-source";
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
run("canonical event material versions and atomic compared moves", () => {
  const family = `schedule-qa-${crypto.randomUUID()}`,
    otherFamily = `${family}-other`,
    actor = `${family}-parent`,
    foreignActor = `${family}-foreign-parent`;
  const range = { start: "2026-10-19T00:00:00Z", end: "2026-10-26T00:00:00Z" };
  let allowed = false;
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    allowed = true;
    expect(await scheduleStorageAvailable(prisma!)).toBe(true);
    for (const id of [family, otherFamily])
      await prisma!.family.create({
        data: { id, name: "Isolated schedule fixture" },
        select: { id: true },
      });
    for (const [id, familyId] of [
      [actor, family],
      [foreignActor, otherFamily],
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
      where: { id: { in: [family, otherFamily] } },
    });
    await prisma!.user.deleteMany({
      where: { id: { in: [actor, foreignActor] } },
    });
    await prisma!.$disconnect();
  });
  const create = async (
    id = `event-${crypto.randomUUID()}`,
    familyId = family,
  ) =>
    (
      await prisma!.event.create({
        data: {
          id,
          family_id: familyId,
          created_by: familyId === family ? actor : foreignActor,
          title: "Fixture event",
          start_time: new Date("2026-10-20T10:00:00Z"),
          end_time: new Date("2026-10-20T11:00:00Z"),
        },
        select: { id: true },
      })
    ).id;
  const read = (id: string) =>
    prisma!.$transaction(async (tx) => {
      await lockUser(tx, actor);
      await lockHousehold(tx, family);
      await tx.$queryRaw`SELECT "id" FROM "Family" WHERE "id" = ${family} FOR SHARE`;
      return lockScheduleTarget(tx, family, id);
    });
  function move(id: string, compared: ScheduleEventSource[]) {
    return prisma!.$transaction(async (tx) => {
      await lockUser(tx, actor);
      await lockHousehold(tx, family);
      await tx.$queryRaw`SELECT "id" FROM "Family" WHERE "id" = ${family} FOR SHARE`;
      await lockScheduleTarget(tx, family, id);
      // Tests exercise the internal guard, not an independent public writer.
      return applyComparedScheduleMoveInTx(tx, {
        familyId: family,
        targetId: id,
        range,
        compared,
        start: "2026-10-20T12:00:00Z",
        end: "2026-10-20T13:00:00Z",
      });
    });
  }
  const versions = async (id: string) =>
    (await readScheduleComparisonInTx(prisma!, family, id, range)).map(
      ({ id, generation, epoch }) => ({ id, generation, epoch }),
    );
  it("advances through material away/back edits but not technical updated_at alone", async () => {
    const id = await create(),
      initial = await read(id);
    await prisma!.event.update({
      where: { id },
      data: { title: "Changed" },
      select: { id: true },
    });
    await prisma!.event.update({
      where: { id },
      data: { title: "Fixture event" },
      select: { id: true },
    });
    const restored = await read(id);
    expect(restored.epoch).toBe(initial.epoch + 2);
    expect(restored.sourceToken).not.toBe(initial.sourceToken);
    await prisma!.event.update({
      where: { id },
      data: { updated_at: new Date() },
      select: { id: true },
    });
    expect((await read(id)).sourceToken).toBe(restored.sourceToken);
  });
  it("preserves insertion identity against an update and gives a recreated ID a new one", async () => {
    const id = await create(),
      initial = await read(id);
    await prisma!
      .$executeRaw`UPDATE "Event" SET "schedule_generation" = ${crypto.randomUUID()} WHERE "id" = ${id} AND "family_id" = ${family}`;
    expect((await read(id)).generation).toBe(initial.generation);
    await prisma!.event.delete({ where: { id }, select: { id: true } });
    await create(id);
    expect((await read(id)).generation).not.toBe(initial.generation);
  });
  it("rejects a new compared-range event inserted after the earlier read, while a foreign event is irrelevant", async () => {
    const id = await create(),
      before = await versions(id);
    await create(undefined, otherFamily);
    await expect(move(id, before)).resolves.toMatchObject({ id });
    const current = await versions(id);
    await create();
    await expect(move(id, current)).rejects.toMatchObject({ code: "STALE" });
  });
  it("refuses deleted or changed-away/back blockers and compares unchanged sources atomically with the time effect", async () => {
    const id = await create(),
      blocker = await create(),
      before = await versions(id);
    await prisma!.event.update({
      where: { id: blocker },
      data: { title: "Changed blocker" },
      select: { id: true },
    });
    await prisma!.event.update({
      where: { id: blocker },
      data: { title: "Fixture event" },
      select: { id: true },
    });
    await expect(move(id, before)).rejects.toMatchObject({ code: "STALE" });
    const refreshed = await versions(id);
    await prisma!.event.delete({
      where: { id: blocker },
      select: { id: true },
    });
    await expect(move(id, refreshed)).rejects.toMatchObject({ code: "STALE" });
    await expect(move(id, await versions(id))).resolves.toMatchObject({
      id,
      start: new Date("2026-10-20T12:00:00Z"),
      end: new Date("2026-10-20T13:00:00Z"),
    });
  });
  it("does not reveal a foreign target and holds saturated epochs while ordinary edits remain possible", async () => {
    const foreign = await create(undefined, otherFamily);
    await expect(read(foreign)).rejects.toMatchObject({ code: "MISSING" });
    const id = await create();
    await prisma!
      .$executeRaw`UPDATE "Event" SET "schedule_epoch" = 2147483647 WHERE "id" = ${id} AND "family_id" = ${family}`;
    await expect(read(id)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(
      prisma!.event.update({
        where: { id },
        data: { title: "Ordinary edit" },
        select: { id: true },
      }),
    ).resolves.toMatchObject({ id });
  });
});
