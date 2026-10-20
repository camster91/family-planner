/** UNRUN: real DDL/FK/trigger acceptance requires an explicitly allowed disposable DB with migrations already applied. */
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";
import { lockUser, lockHousehold } from "@/lib/household-lock";
import {
  readResponsibilitySource,
  responsibilityStorageAvailable,
} from "@/lib/responsibility-storage";
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
run("responsibility target continuity and identity retirement", () => {
  const familyId = `responsibility-qa-${crypto.randomUUID()}`,
    foreignFamily = `${familyId}-other`;
  const parentId = `${familyId}-parent`,
    backupId = `${familyId}-backup`,
    foreignUser = `${familyId}-foreign`;
  const profileId = `${familyId}-profile`;
  let fixturesAllowed = false;
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    fixturesAllowed = true;
    expect(await responsibilityStorageAvailable(prisma!)).toBe(true);
    for (const id of [familyId, foreignFamily])
      await prisma!.family.create({
        data: { id, name: "Isolated responsibility fixture" },
        select: { id: true },
      });
    for (const [id, family] of [
      [parentId, familyId],
      [backupId, familyId],
      [foreignUser, foreignFamily],
    ])
      await prisma!.user.create({
        data: {
          id,
          family_id: family,
          name: "Fixture account",
          email: `${id}@example.invalid`,
          role: "parent",
        },
        select: { id: true },
      });
    await prisma!.householdMember.create({
      data: {
        id: profileId,
        family_id: familyId,
        name: "Fixture profile",
        role: "child",
        age: 3,
      },
      select: { id: true },
    });
  });
  afterAll(async () => {
    if (!fixturesAllowed) return;
    assertFixtureTargetAllowed(process.env);
    await prisma!.family.deleteMany({
      where: { id: { in: [familyId, foreignFamily] } },
    });
    await prisma!.user.deleteMany({
      where: { id: { in: [parentId, backupId, foreignUser] } },
    });
    await prisma!.$disconnect();
  });
  const pickup = async (id = `pickup-${crypto.randomUUID()}`) =>
    (
      await prisma!.pickup.create({
        data: {
          id,
          family_id: familyId,
          created_by: parentId,
          assigned_to: parentId,
          title: "Fixture pickup",
          pickup_time: new Date("2026-10-24T15:00:00Z"),
        },
        select: { id: true },
      })
    ).id;
  const chore = async (id: string, recurrenceId: string | null = null) =>
    (
      await prisma!.chore.create({
        data: {
          id,
          family_id: familyId,
          created_by: parentId,
          assigned_to: parentId,
          title: "Fixture chore",
          due_date: new Date("2026-10-24T00:00:00Z"),
          recurrence_id: recurrenceId,
          is_template: recurrenceId === id,
        },
        select: { id: true },
      })
    ).id;
  const source = (kind: "chore" | "pickup" | "handoff", id: string) =>
    prisma!.$transaction(async (tx) => {
      await lockUser(tx, parentId);
      await lockHousehold(tx, familyId);
      return readResponsibilitySource(tx, familyId, { kind, id });
    });
  const count = async (id: string) =>
    (
      await prisma!.$queryRaw<
        Array<{ count: number }>
      >`SELECT COUNT(*)::integer AS count FROM "ResponsibilityState" WHERE "id" = ${id}`
    )[0].count;
  async function nameBackup(pickupId: string, accountId = backupId) {
    const id = `state-${crypto.randomUUID()}`,
      token = await source("pickup", pickupId);
    await prisma!
      .$executeRaw`INSERT INTO "ResponsibilityState" ("id", "family_id", "pickup_id", "source_token", "backup_account_id") VALUES (${id}, ${familyId}, ${pickupId}, ${token}, ${accountId})`;
    return id;
  }
  it("changes source on legacy edits away/back and on same-ID deletion/recreation", async () => {
    const id = await pickup(),
      first = await source("pickup", id);
    await prisma!.pickup.update({
      where: { id },
      data: { assigned_to: backupId },
      select: { id: true },
    });
    await prisma!.pickup.update({
      where: { id },
      data: { assigned_to: parentId },
      select: { id: true },
    });
    const restored = await source("pickup", id);
    expect(restored).not.toBe(first);
    await prisma!.pickup.delete({ where: { id }, select: { id: true } });
    await pickup(id);
    expect(await source("pickup", id)).not.toBe(restored);
  });
  it("binds a child occurrence to material root edits without rewriting the child's domain row", async () => {
    const root = `root-${crypto.randomUUID()}`,
      child = `child-${crypto.randomUUID()}`;
    await chore(root, root);
    await chore(child, root);
    const first = await source("chore", child);
    await prisma!.chore.update({
      where: { id: root },
      data: { description: "Updated routine instructions" },
      select: { id: true },
    });
    expect(await source("chore", child)).not.toBe(first);
  });
  it("rejects foreign-family backup and ambiguous target links using real constraints", async () => {
    const id = await pickup();
    await expect(nameBackup(id, foreignUser)).rejects.toThrow();
    const handoff = await prisma!.handoff.create({
      data: {
        family_id: familyId,
        created_by: parentId,
        sitter_name: "Fixture sitter",
      },
      select: { id: true },
    });
    const token = await source("pickup", id);
    await expect(
      prisma!
        .$executeRaw`INSERT INTO "ResponsibilityState" ("id", "family_id", "pickup_id", "handoff_id", "source_token") VALUES (${crypto.randomUUID()}, ${familyId}, ${id}, ${handoff.id}, ${token})`,
    ).rejects.toThrow();
  });
  it("retires named backup participation before member detachment and advances source before metadata recreation", async () => {
    const id = await pickup(),
      stateId = await nameBackup(id),
      before = await source("pickup", id);
    await prisma!.user.update({
      where: { id: backupId },
      data: { family_id: null },
      select: { id: true },
    });
    expect(await count(stateId)).toBe(0);
    expect(await source("pickup", id)).not.toBe(before);
    expect(
      (
        await prisma!.pickup.findUnique({
          where: { id },
          select: { assigned_to: true },
        })
      )?.assigned_to,
    ).toBe(parentId);
    await prisma!.user.update({
      where: { id: backupId },
      data: { family_id: familyId },
      select: { id: true },
    });
  });
  it("retires profile participation before archiving and target deletion cascades all metadata", async () => {
    const id = await chore(`profile-chore-${crypto.randomUUID()}`),
      token = await source("chore", id),
      stateId = crypto.randomUUID();
    await prisma!
      .$executeRaw`INSERT INTO "ResponsibilityState" ("id", "family_id", "chore_id", "source_token", "backup_member_id") VALUES (${stateId}, ${familyId}, ${id}, ${token}, ${profileId})`;
    await prisma!.householdMember.update({
      where: { id: profileId },
      data: { archived_at: new Date() },
      select: { id: true },
    });
    expect(await count(stateId)).toBe(0);
    expect(await source("chore", id)).not.toBe(token);
    const pickupId = await pickup(),
      otherState = await nameBackup(pickupId);
    await prisma!.pickup.delete({
      where: { id: pickupId },
      select: { id: true },
    });
    expect(await count(otherState)).toBe(0);
  });
  it("invalidates first pending confirmations on role changes even before a metadata row exists", async () => {
    const id = await pickup();
    await prisma!.pickup.update({
      where: { id },
      data: { assigned_to: backupId },
      select: { id: true },
    });
    const before = await source("pickup", id);
    await prisma!.user.update({
      where: { id: backupId },
      data: { role: "teen" },
      select: { id: true },
    });
    await prisma!.user.update({
      where: { id: backupId },
      data: { role: "parent" },
      select: { id: true },
    });
    expect(await source("pickup", id)).not.toBe(before);
  });
  it("holds saturated consent continuity while leaving ordinary target updates usable", async () => {
    const id = await pickup();
    await prisma!
      .$executeRaw`UPDATE "Pickup" SET "responsibility_epoch" = 2147483647 WHERE "id" = ${id}`;
    await expect(source("pickup", id)).rejects.toThrow("UNAVAILABLE");
    await expect(
      prisma!.pickup.update({
        where: { id },
        data: { title: "Still editable" },
        select: { id: true },
      }),
    ).resolves.toEqual({ id });
    await expect(source("pickup", id)).rejects.toThrow("UNAVAILABLE");
  });
  it("refuses partial consent columns rather than accepting an anonymous or undated statement", async () => {
    const id = await pickup(),
      token = await source("pickup", id);
    await expect(prisma!.$executeRaw`INSERT INTO "ResponsibilityState"
      ("id", "family_id", "pickup_id", "source_token", "primary_subject_account_id", "primary_decision", "primary_by_id", "primary_method")
      VALUES (${crypto.randomUUID()}, ${familyId}, ${id}, ${token}, ${parentId}, 'accepted', ${parentId}, 'self')`).rejects.toThrow();
  });
});
