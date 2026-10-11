import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";
import { manageHouseholdProfile } from "@/lib/household-profile-management";
import { IDEMPOTENCY_TTL_MS } from "@/lib/idempotency";

const dbDescribe =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const A = "fx_profile_commands_a";
const B = "fx_profile_commands_b";
const P = "fx_profile_commands_parent";
const T = "fx_profile_commands_teen";
const BP = "fx_profile_commands_b_parent";
const actor = { userId: P, familyId: A, tokenVersion: 0 };
const key = "profile_command_key_01";
const input = { action: "create", name: "Alex", age: 3 };
const now = new Date("2026-01-05T12:00:00Z");

dbDescribe(
  "name-only child profile commands against guarded PostgreSQL",
  () => {
    let db: PrismaClient;
    async function clean() {
      await db.family.deleteMany({ where: { id: { in: [A, B] } } });
      await db.user.deleteMany({ where: { id: { in: [P, T, BP] } } });
    }
    const run = (
      body: unknown,
      requestKey = key,
      person = actor,
      clock = now,
    ) => manageHouseholdProfile(db, person, requestKey, body, clock);
    beforeAll(async () => {
      assertFixtureTargetAllowed(process.env);
      db = (await import("@/lib/prisma")).prisma!;
      // Real custom SQL, including owner guards/deferral absent from Prisma's DSL.
      const pg = await import("pg");
      const sqlDb = new pg.Client({
        connectionString: process.env.DATABASE_URL,
      });
      await sqlDb.connect();
      try {
        await sqlDb.query(
          fs.readFileSync(
            path.resolve(
              __dirname,
              "../../../database/migration-household-members.sql",
            ),
            "utf8",
          ),
        );
      } finally {
        await sqlDb.end();
      }
    });
    beforeEach(async () => {
      await clean();
      for (const id of [A, B])
        await db.family.create({ data: { id, name: id, invite_code: id } });
      for (const [id, family_id, role] of [
        [P, A, "parent"],
        [T, A, "teen"],
        [BP, B, "parent"],
      ]) {
        await db.user.create({
          data: { id, family_id, role, name: id, email: `${id}@example.test` },
        });
      }
    });
    afterAll(async () => {
      if (db) {
        await clean();
        await db.$disconnect();
      }
    });

    it("creates one child with no new account, link, invitation or notification", async () => {
      const before = await Promise.all([
        db.user.count(),
        db.notification.count(),
        db.familyInvite.count(),
        db.householdMemberAccountLink.count(),
      ]);
      const result = await run(input);
      expect(result.profile).toMatchObject({
        name: "Alex",
        role: "child",
        age: 3,
        family_id: A,
        revision: 0,
        archived_at: null,
      });
      expect(Object.keys(result.profile).sort()).toEqual([
        "age",
        "archived_at",
        "family_id",
        "id",
        "name",
        "revision",
        "role",
      ]);
      expect(
        await Promise.all([
          db.user.count(),
          db.notification.count(),
          db.familyInvite.count(),
          db.householdMemberAccountLink.count(),
        ]),
      ).toEqual(before);
      expect(
        await db.householdMemberLegacyMapping.count({
          where: { family_id: A },
        }),
      ).toBe(0);
    });
    it("serializes duplicate creation and commits one replay record with the effect", async () => {
      const results = await Promise.all([run(input), run(input)]);
      expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
      expect(results[0].profile).toEqual(results[1].profile);
      expect(await db.householdMember.count({ where: { family_id: A } })).toBe(
        1,
      );
      expect(
        await db.idempotencyRecord.count({ where: { family_id: A } }),
      ).toBe(1);
      await expect(run({ ...input, name: "Different" })).rejects.toMatchObject({
        code: "KEY_REUSED",
      });
    });
    it("refuses stale account authority before replay and rejects shared profile attribution as login", async () => {
      const result = await run(input);
      await db.user.update({ where: { id: P }, data: { token_version: 1 } });
      await expect(run(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(
        run(input, key, { ...actor, userId: result.profile.id }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await db.user.update({
        where: { id: P },
        data: { token_version: 0, role: "teen" },
      });
      await expect(run(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
    it("refuses teens and foreign households; foreign targets look absent", async () => {
      await expect(
        run(input, key, { ...actor, userId: T }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        run(input, key, { ...actor, familyId: B }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const foreign = await run(input, key, {
        userId: BP,
        familyId: B,
        tokenVersion: 0,
      });
      await expect(
        run(
          { action: "archive", id: foreign.profile.id, revision: 0 },
          "profile_archive_key_01",
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
    it("edits with revision checks and archives without deleting the person or replay records", async () => {
      const created = await run(input);
      const edited = await run(
        {
          action: "edit",
          id: created.profile.id,
          revision: 0,
          name: "Alex Junior",
        },
        "profile_edit_key_01",
      );
      expect(edited.profile).toMatchObject({
        name: "Alex Junior",
        age: 3,
        revision: 1,
      });
      await expect(
        run(
          {
            action: "edit",
            id: created.profile.id,
            revision: 0,
            name: "Stale",
          },
          "profile_edit_key_02",
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const command = {
        action: "archive",
        id: created.profile.id,
        revision: 1,
      };
      const archived = await run(command, "profile_archive_key_01");
      expect(archived.profile).toMatchObject({
        name: "Alex Junior",
        revision: 2,
        archived_at: now.toISOString(),
      });
      expect(
        await db.householdMember.count({ where: { id: created.profile.id } }),
      ).toBe(1);
      expect((await run(command, "profile_archive_key_01")).replayed).toBe(
        true,
      );
      await expect(
        run(
          {
            action: "edit",
            id: created.profile.id,
            revision: 2,
            name: "Revive",
          },
          "profile_edit_key_03",
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
    it("never edits/unlinks a mapped account profile through name-only controls", async () => {
      const created = await run(input);
      await db.householdMemberLegacyMapping.create({
        data: { user_id: T, member_id: created.profile.id, family_id: A },
      });
      await expect(
        run(
          { action: "archive", id: created.profile.id, revision: 0 },
          "profile_archive_key_01",
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(
        await db.householdMemberLegacyMapping.count({ where: { user_id: T } }),
      ).toBe(1);
    });
    it("late replay after retention cannot create a second person", async () => {
      await run(input);
      await expect(
        run(
          input,
          key,
          actor,
          new Date(now.getTime() + IDEMPOTENCY_TTL_MS + 1),
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await db.householdMember.count({ where: { family_id: A } })).toBe(
        1,
      );
    });
    it("rolls the person back when the replay-record write fails", async () => {
      const failingDb = {
        $transaction: (fn: (tx: any) => Promise<unknown>) =>
          db.$transaction((tx) =>
            fn(
              new Proxy(tx, {
                get(target, prop) {
                  return prop === "idempotencyRecord"
                    ? {
                        ...target.idempotencyRecord,
                        create: async () => {
                          throw new Error("injected replay write failure");
                        },
                      }
                    : Reflect.get(target, prop);
                },
              }),
            ),
          ),
      } as Pick<PrismaClient, "$transaction">;
      await expect(
        manageHouseholdProfile(failingDb, actor, key, input, now),
      ).rejects.toThrow("injected replay write failure");
      expect(await db.householdMember.count({ where: { family_id: A } })).toBe(
        0,
      );
    });
  },
);

describe("profile command input boundary", () => {
  it.each([
    { ...input, role: "parent" },
    { ...input, email: "child@example.test" },
    { ...input, name: " " },
    { ...input, age: -1 },
    { ...input, age: 18 },
  ])("rejects invalid/authority-bearing fields before writes", async (body) => {
    const db = { $transaction: jest.fn() } as unknown as Pick<
      PrismaClient,
      "$transaction"
    >;
    await expect(
      manageHouseholdProfile(db, actor, key, body, now),
    ).rejects.toMatchObject({ code: "INVALID" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
