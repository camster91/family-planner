/** Real guarded PG: additive subjects, reconciliation and explicit erasure. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";
import {
  rehearseHouseholdMembers,
  memberIdForLegacyUser,
} from "../household-members";
import { rehearseChoreMembers } from "../chore-members";
import { prisma } from "@/lib/prisma";
import { eraseAccountProfilesInTx } from "@/lib/household-member-lifecycle";
import { deleteHousehold, deleteMemberAccount } from "@/lib/account-deletion";
import { removeHouseholdMember } from "@/lib/member-removal";
import {
  dropMemberFromRotationsInTx,
  applyRotationEditInTx,
} from "@/lib/chore-rotation";
import { reopenCompletedChoreInTx } from "@/lib/chore-reopen";
import { canonicalChoreAssigneeInTx } from "@/lib/chore-member-subject";
import { choreAssigneeForCreateInTx } from "@/lib/chore-member-subject";
import { expandSeriesInTx } from "@/lib/recurringChores";
import { completeChore, findHouseholdChore } from "@/lib/chore-complete";
import { importChoreChamps } from "@/lib/imports/persist-chore-champs";
import { lockHousehold } from "@/lib/household-lock";

const dbDescribe =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const ROOT = path.resolve(__dirname, "../../../..");
const A = "fx_chore_member_a",
  B = "fx_chore_member_b";
const P = "fx_chore_member_parent",
  C = "fx_chore_member_child",
  BP = "fx_chore_member_b_parent";
const CH = "fx_chore_member_chore",
  AS = "fx_chore_member_assignment";
const migration = fs.readFileSync(
  path.join(ROOT, "database/migration-z-household-member-chore-subjects.sql"),
  "utf8",
);

dbDescribe("chore canonical subject rehearsal", () => {
  let db: pg.Client;
  async function cleanup() {
    await db.query(
      'DELETE FROM "ImportedRecord" WHERE family_id = ANY($1::text[])',
      [[A, B]],
    );
    await db.query(
      'DELETE FROM "ImportJob" WHERE family_id = ANY($1::text[])',
      [[A, B]],
    );
    await db.query('DELETE FROM "Chore" WHERE family_id = ANY($1::text[])', [
      [A, B],
    ]);
    await db.query(
      'DELETE FROM "HouseholdMember" WHERE family_id = ANY($1::text[])',
      [[A, B]],
    );
    await db.query('DELETE FROM "User" WHERE id = ANY($1::text[])', [
      [P, C, BP],
    ]);
    await db.query('DELETE FROM "Family" WHERE id = ANY($1::text[])', [[A, B]]);
  }
  const member = () => memberIdForLegacyUser(A, C);
  const snapshot = async () =>
    (
      await db.query(
        `SELECT
    (SELECT jsonb_agg(to_jsonb(c)-'assigned_member_id'-'member_subject_erased' ORDER BY c.id) FROM "Chore" c WHERE c.family_id=$1) AS chores,
    (SELECT jsonb_agg(to_jsonb(c)-'assigned_member_id'-'member_subject_erased' ORDER BY c.id) FROM "ChoreAssignment" c WHERE c.family_id=$1) AS assignments,
    (SELECT jsonb_agg(to_jsonb(u) ORDER BY u.id) FROM "User" u WHERE u.family_id=$1) AS accounts`,
        [A],
      )
    ).rows[0];
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await db.query(
      fs.readFileSync(
        path.join(ROOT, "database/migration-household-members.sql"),
        "utf8",
      ),
    );
    await db.query(migration);
  });
  beforeEach(async () => {
    await cleanup();
    await db.query(
      'INSERT INTO "Family" (id,name,invite_code) VALUES ($1,$1,$1),($2,$2,$2)',
      [A, B],
    );
    for (const [id, family, role] of [
      [P, A, "parent"],
      [C, A, "child"],
      [BP, B, "parent"],
    ])
      await db.query(
        'INSERT INTO "User" (id,email,name,family_id,role,xp) VALUES ($1,$2,$1,$3,$4,30)',
        [id, `${id}@example.test`, family, role],
      );
    await db.query(
      'INSERT INTO "Chore" (id,family_id,title,assigned_to,created_by,due_date,status,points) VALUES ($1,$2,$1,$3,$4,$5,$6,15)',
      [CH, A, C, P, "2026-01-05", "verified"],
    );
    await db.query(
      'INSERT INTO "ChoreAssignment" (id,family_id,chore_id,assigned_to,due_date,status,completed_by,approved_by,xp_awarded,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$4,$7,15,CURRENT_TIMESTAMP)',
      [AS, A, CH, C, "2026-01-05", "verified", P],
    );
    await rehearseHouseholdMembers(db, A, true);
    await rehearseHouseholdMembers(db, B, true);
  });
  afterAll(async () => {
    await cleanup();
    await db.end();
  });

  it("resolves only explicit create subjects and preserves unmigrated accounts", async () => {
    expect(
      await prisma!.$transaction((tx) => choreAssigneeForCreateInTx(tx, A, C)),
    ).toEqual({ assigned_to: C, assigned_member_id: member() });
    await db.query(
      'DELETE FROM "HouseholdMemberLegacyMapping" WHERE user_id=$1',
      [C],
    );
    expect(
      await prisma!.$transaction((tx) => choreAssigneeForCreateInTx(tx, A, C)),
    ).toEqual({ assigned_to: C });
    await expect(
      prisma!.$transaction((tx) =>
        choreAssigneeForCreateInTx(tx, A, C, { requireCanonical: true }),
      ),
    ).rejects.toMatchObject({ name: "HouseholdMemberIdentityConflict" });
    expect(
      (
        await db.query(
          'SELECT count(*)::int n FROM "User" WHERE family_id=$1',
          [A],
        )
      ).rows[0].n,
    ).toBe(2);
  });
  async function weekly(rotation: string[] = []) {
    await rehearseChoreMembers(db, A, true);
    await db.query(
      'UPDATE "Chore" SET frequency=$2, weekly_days=ARRAY[1,4], recurrence_id=id, is_template=true, rotation_member_ids=$3 WHERE id=$1',
      [CH, "weekly", rotation],
    );
  }
  const expand = () =>
    prisma!.$transaction((tx) =>
      expandSeriesInTx(tx, CH, A, new Date("2026-01-04T12:00:00Z")),
    );
  it("writes canonical multiple-weekday occurrences idempotently without changing credit", async () => {
    await weekly();
    expect(await expand()).toBeGreaterThan(0);
    expect(await expand()).toBe(0);
    const rows = (
      await db.query(
        'SELECT assigned_to,assigned_member_id,due_date,points FROM "Chore" WHERE recurrence_id=$1 AND id<>$1',
        [CH],
      )
    ).rows;
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(row).toMatchObject({
        assigned_to: C,
        assigned_member_id: member(),
        points: 15,
      });
      expect([1, 4]).toContain(new Date(row.due_date).getUTCDay());
    }
    expect(
      (
        await db.query(
          'SELECT assigned_to,xp_awarded FROM "ChoreAssignment" WHERE id=$1',
          [AS],
        )
      ).rows[0],
    ).toEqual({ assigned_to: C, xp_awarded: 15 });
  });
  it("skips archived rotation participants and stops when none remain", async () => {
    await weekly([C, P]);
    await db.query(
      'UPDATE "HouseholdMember" SET archived_at=CURRENT_TIMESTAMP WHERE id=$1',
      [member()],
    );
    expect(await expand()).toBeGreaterThan(0);
    const rows = (
      await db.query(
        'SELECT assigned_to,assigned_member_id FROM "Chore" WHERE recurrence_id=$1 AND id<>$1',
        [CH],
      )
    ).rows;
    expect(
      rows.every(
        (row) =>
          row.assigned_to === P &&
          row.assigned_member_id === memberIdForLegacyUser(A, P),
      ),
    ).toBe(true);
    await db.query('DELETE FROM "Chore" WHERE recurrence_id=$1 AND id<>$1', [
      CH,
    ]);
    await db.query(
      'UPDATE "HouseholdMember" SET archived_at=CURRENT_TIMESTAMP WHERE family_id=$1',
      [A],
    );
    expect(await expand()).toBe(0);
    expect(
      (
        await db.query(
          'SELECT assigned_member_id,status FROM "Chore" WHERE id=$1',
          [CH],
        )
      ).rows[0],
    ).toEqual({ assigned_member_id: member(), status: "verified" });
  });
  it("refuses incomplete canonical rotation reconciliation atomically", async () => {
    await weekly([C, P]);
    await db.query(
      'DELETE FROM "HouseholdMemberLegacyMapping" WHERE user_id=$1',
      [P],
    );
    await expect(expand()).rejects.toMatchObject({
      name: "HouseholdMemberIdentityConflict",
    });
    expect(
      (
        await db.query(
          'SELECT count(*)::int n FROM "Chore" WHERE family_id=$1',
          [A],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("rereads completion metadata and canonical successor subject instead of the caller snapshot", async () => {
    await rehearseChoreMembers(db, A, true);
    await db.query('UPDATE "Chore" SET status=$2,frequency=$3 WHERE id=$1', [
      CH,
      "pending",
      "weekly",
    ]);
    const stale = await findHouseholdChore(prisma!, CH, A);
    await db.query(
      'UPDATE "Chore" SET assigned_to=$2,assigned_member_id=$3,title=$4 WHERE id=$1',
      [CH, P, memberIdForLegacyUser(A, P), "Fresh title"],
    );
    expect(
      await completeChore(
        prisma!,
        stale!,
        { id: P, name: "Parent" },
        { now: new Date("2026-01-05T12:00:00Z") },
      ),
    ).toBe(true);
    expect(
      await completeChore(prisma!, stale!, { id: P, name: "Parent" }),
    ).toBe(false);
    const successors = (
      await db.query(
        'SELECT title,assigned_to,assigned_member_id FROM "Chore" WHERE family_id=$1 AND id<>$2',
        [A, CH],
      )
    ).rows;
    expect(successors).toEqual([
      {
        title: "Fresh title",
        assigned_to: P,
        assigned_member_id: memberIdForLegacyUser(A, P),
      },
    ]);
  });
  it("rolls back completion, activity and successor when canonical ownership is inactive", async () => {
    await rehearseChoreMembers(db, A, true);
    await db.query('UPDATE "Chore" SET status=$2,frequency=$3 WHERE id=$1', [
      CH,
      "pending",
      "weekly",
    ]);
    const chore = await findHouseholdChore(prisma!, CH, A);
    await db.query(
      'UPDATE "HouseholdMember" SET archived_at=CURRENT_TIMESTAMP WHERE id=$1',
      [member()],
    );
    await expect(
      completeChore(prisma!, chore!, { id: P, name: "Parent" }),
    ).rejects.toMatchObject({ name: "HouseholdMemberIdentityConflict" });
    expect(
      (
        await db.query(
          'SELECT status,completed_at,successor_id FROM "Chore" WHERE id=$1',
          [CH],
        )
      ).rows[0],
    ).toEqual({ status: "pending", completed_at: null, successor_id: null });
    expect(
      (
        await db.query(
          'SELECT count(*)::int n FROM "Activity" WHERE family_id=$1',
          [A],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await db.query(
          'SELECT count(*)::int n FROM "Chore" WHERE family_id=$1',
          [A],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  const imported = {
    version: "1",
    family: { id: "source-family", name: "Fixture" },
    kids: [{ id: "kid-1", name: "Sam" }],
    chores: [
      {
        id: "chore-1",
        title: "Dishes",
        basePoints: 12,
        difficulty: "HARD",
        recurring: "DAILY",
        isActive: true,
        createdAt: "2026-08-01T00:00:00Z",
      },
    ],
    assignments: [
      {
        id: "assignment-1",
        choreId: "chore-1",
        kidId: "kid-1",
        dueDate: "2026-08-29T12:00:00Z",
        status: "COMPLETED",
        completedAt: "2026-08-29T13:00:00Z",
        createdAt: "2026-08-28T12:00:00Z",
      },
    ],
  };
  it("imports canonical subjects and reuses content without minting accounts", async () => {
    const options = {
      familyId: A,
      startedBy: P,
      kidToUserId: { "kid-1": C },
      dryRun: false,
    };
    const first = await importChoreChamps(imported, options);
    expect(first.summary.created).toMatchObject({
      Chore: 1,
      ChoreAssignment: 1,
    });
    const second = await importChoreChamps(imported, options);
    expect(second.summary.reused).toMatchObject({
      Chore: 1,
      ChoreAssignment: 1,
    });
    expect(
      (
        await db.query(
          'SELECT assigned_to,assigned_member_id FROM "Chore" WHERE family_id=$1 AND id<>$2',
          [A, CH],
        )
      ).rows,
    ).toEqual([{ assigned_to: C, assigned_member_id: member() }]);
    expect(
      (
        await db.query(
          'SELECT assigned_to,assigned_member_id,status FROM "ChoreAssignment" WHERE family_id=$1 AND id<>$2',
          [A, AS],
        )
      ).rows,
    ).toEqual([
      { assigned_to: C, assigned_member_id: member(), status: "completed" },
    ]);
    expect(
      (
        await db.query(
          'SELECT count(*)::int n FROM "User" WHERE family_id=$1',
          [A],
        )
      ).rows[0].n,
    ).toBe(2);
  });
  it("keeps mixed canonical and unmigrated historical assignments independently", async () => {
    await db.query(
      'DELETE FROM "HouseholdMemberLegacyMapping" WHERE user_id=$1',
      [P],
    );
    const input = {
      ...imported,
      kids: [...imported.kids, { id: "kid-2", name: "Older account" }],
      assignments: [
        ...imported.assignments,
        { ...imported.assignments[0], id: "assignment-2", kidId: "kid-2" },
      ],
    };
    await importChoreChamps(input, {
      familyId: A,
      startedBy: P,
      kidToUserId: { "kid-1": C, "kid-2": P },
      dryRun: false,
    });
    const rows = (
      await db.query(
        'SELECT assigned_to,assigned_member_id FROM "ChoreAssignment" WHERE family_id=$1 AND id<>$2 ORDER BY assigned_to',
        [A, AS],
      )
    ).rows;
    expect(rows).toEqual([
      { assigned_to: C, assigned_member_id: member() },
      { assigned_to: P, assigned_member_id: null },
    ]);
  });
  it("allows archived historical import but refuses new work and erasure-owned history", async () => {
    await db.query(
      'UPDATE "HouseholdMember" SET archived_at=CURRENT_TIMESTAMP WHERE id=$1',
      [member()],
    );
    const options = {
      familyId: A,
      startedBy: P,
      kidToUserId: { "kid-1": C },
      dryRun: false,
    };
    await expect(importChoreChamps(imported, options)).rejects.toMatchObject({
      name: "HouseholdMemberIdentityConflict",
    });
    const history = {
      ...imported,
      chores: [{ ...imported.chores[0], isActive: false }],
    };
    await importChoreChamps(history, options);
    expect(
      (
        await db.query(
          'SELECT assigned_member_id,status FROM "Chore" WHERE family_id=$1 AND id<>$2',
          [A, CH],
        )
      ).rows,
    ).toEqual([{ assigned_member_id: member(), status: "archived" }]);
    await db.query(
      'UPDATE "HouseholdMember" SET erasure_user_id=$2 WHERE id=$1',
      [member(), C],
    );
    const newHistory = {
      ...history,
      chores: [{ ...history.chores[0], id: "chore-erased" }],
      assignments: [
        {
          ...history.assignments[0],
          id: "assignment-erased",
          choreId: "chore-erased",
        },
      ],
    };
    await expect(importChoreChamps(newHistory, options)).rejects.toMatchObject({
      name: "HouseholdMemberIdentityConflict",
    });
  });
  it("rejects foreign unused import mappings and child actors before recording a job", async () => {
    const invalidOptions: Parameters<typeof importChoreChamps>[1][] = [
      {
        familyId: A,
        startedBy: P,
        kidToUserId: { "kid-1": C, unused: BP },
        dryRun: false,
      },
      { familyId: A, startedBy: C, kidToUserId: { "kid-1": C }, dryRun: false },
    ];
    for (const options of invalidOptions)
      await expect(importChoreChamps(imported, options)).rejects.toMatchObject({
        name: "HouseholdMemberIdentityConflict",
      });
    expect(
      (
        await db.query(
          'SELECT count(*)::int n FROM "ImportJob" WHERE family_id=$1',
          [A],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it("reruns additive migration without changing legacy history or assigning members", async () => {
    const before = await snapshot();
    await db.query(migration);
    await db.query(migration);
    expect(await snapshot()).toEqual(before);
    expect(
      (
        await db.query(
          'SELECT assigned_member_id,member_subject_erased FROM "Chore" WHERE id=$1',
          [CH],
        )
      ).rows[0],
    ).toEqual({ assigned_member_id: null, member_subject_erased: false });
  });
  it("defaults CLI to dry-run counts without names/IDs, committed subjects or new accounts/links", async () => {
    const before = await snapshot();
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        "scripts/rehearse-chore-members.mjs",
        "--family",
        A,
      ],
      { cwd: ROOT, env: process.env, encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      choresScanned: 1,
      assignmentsScanned: 1,
      subjectsPlanned: 2,
      subjectsWritten: 0,
      erasedSubjectsSkipped: 0,
    });
    expect(result.stdout).not.toContain(C);
    expect(await snapshot()).toEqual(before);
    expect(
      (
        await db.query('SELECT assigned_member_id FROM "Chore" WHERE id=$1', [
          CH,
        ])
      ).rows[0].assigned_member_id,
    ).toBeNull();
  });
  it("backfills twice, preserving legacy actors, completions, points, dates, accounts and all history", async () => {
    const before = await snapshot();
    expect((await rehearseChoreMembers(db, A, true)).subjectsWritten).toBe(2);
    expect((await rehearseChoreMembers(db, A, true)).subjectsWritten).toBe(0);
    expect(await snapshot()).toEqual(before);
    expect(
      (
        await db.query(
          'SELECT assigned_member_id FROM "ChoreAssignment" WHERE id=$1',
          [AS],
        )
      ).rows[0].assigned_member_id,
    ).toBe(member());
    expect(
      (
        await db.query(
          'SELECT count(*)::int n FROM "HouseholdMemberAccountLink" WHERE family_id=$1',
          [A],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("refuses missing or foreign mappings before any partial assignment write", async () => {
    await db.query(
      'DELETE FROM "HouseholdMemberLegacyMapping" WHERE user_id=$1',
      [C],
    );
    await expect(rehearseChoreMembers(db, A, true)).rejects.toMatchObject({
      code: "SUBJECT_RECONCILIATION_REQUIRED",
    });
    await db.query('UPDATE "ChoreAssignment" SET assigned_to=$1 WHERE id=$2', [
      BP,
      AS,
    ]);
    await expect(rehearseChoreMembers(db, A, true)).rejects.toMatchObject({
      code: "SUBJECT_RECONCILIATION_REQUIRED",
    });
    expect(
      (
        await db.query('SELECT assigned_member_id FROM "Chore" WHERE id=$1', [
          CH,
        ])
      ).rows[0].assigned_member_id,
    ).toBeNull();
  });
  it("refuses inconsistent cross-household/member/account subjects and legacy-only reassignments", async () => {
    await expect(
      db.query('UPDATE "Chore" SET assigned_member_id=$1 WHERE id=$2', [
        memberIdForLegacyUser(B, BP),
        CH,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await rehearseChoreMembers(db, A, true);
    await expect(
      db.query('UPDATE "Chore" SET assigned_to=$1 WHERE id=$2', [P, CH]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.query('UPDATE "Chore" SET assigned_member_id=NULL WHERE id=$1', [CH]),
    ).rejects.toMatchObject({ code: "23514" });
    await db.query(
      'UPDATE "Chore" SET assigned_to=$1, assigned_member_id=$2 WHERE id=$3',
      [P, memberIdForLegacyUser(A, P), CH],
    );
    expect(
      (
        await db.query(
          'SELECT assigned_to FROM "ChoreAssignment" WHERE id=$1',
          [AS],
        )
      ).rows[0].assigned_to,
    ).toBe(C);
  });
  it("preserves canonical history when archived/detached without treating it as a new assignment", async () => {
    await rehearseChoreMembers(db, A, true);
    await db.query(
      'UPDATE "HouseholdMember" SET archived_at=CURRENT_TIMESTAMP,erasure_user_id=$1 WHERE id=$2',
      [C, member()],
    );
    await db.query(
      'DELETE FROM "HouseholdMemberLegacyMapping" WHERE user_id=$1',
      [C],
    );
    await db.query('UPDATE "Chore" SET description=$1 WHERE id=$2', [
      "Historical description",
      CH,
    ]);
    await expect(
      db.query('DELETE FROM "HouseholdMember" WHERE id=$1', [member()]),
    ).rejects.toMatchObject({ code: "23503" });
    expect(
      (
        await db.query('SELECT assigned_member_id FROM "Chore" WHERE id=$1', [
          CH,
        ])
      ).rows[0].assigned_member_id,
    ).toBe(member());
  });
  it("explicit erasure clears canonical identifiers, keeps history/credit, and prevents later backfill restoration", async () => {
    await rehearseChoreMembers(db, A, true);
    await prisma!.$transaction((tx) => eraseAccountProfilesInTx(tx, C, A));
    expect(
      (
        await db.query(
          'SELECT assigned_to,assigned_member_id,member_subject_erased,status,points FROM "Chore" WHERE id=$1',
          [CH],
        )
      ).rows[0],
    ).toEqual({
      assigned_to: C,
      assigned_member_id: null,
      member_subject_erased: true,
      status: "verified",
      points: 15,
    });
    expect(
      (
        await db.query(
          'SELECT completed_by,approved_by,xp_awarded,member_subject_erased FROM "ChoreAssignment" WHERE id=$1',
          [AS],
        )
      ).rows[0],
    ).toEqual({
      completed_by: C,
      approved_by: P,
      xp_awarded: 15,
      member_subject_erased: true,
    });
    expect(
      (await rehearseChoreMembers(db, A, true)).erasedSubjectsSkipped,
    ).toBe(2);
    await expect(
      db.query('UPDATE "Chore" SET member_subject_erased=false WHERE id=$1', [
        CH,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.query(
        'UPDATE "ChoreAssignment" SET member_subject_erased=false WHERE id=$1',
        [AS],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("existing account deletion succeeds with canonical references and preserves the other household", async () => {
    await rehearseChoreMembers(db, A, true);
    await deleteMemberAccount(C, {
      revokeCalendarGrant: async () => undefined,
    });
    expect(
      (await db.query('SELECT id FROM "User" WHERE id=$1', [C])).rows,
    ).toEqual([]);
    expect(
      (
        await db.query('SELECT id FROM "HouseholdMember" WHERE id=$1', [
          member(),
        ])
      ).rows,
    ).toEqual([]);
    expect(
      (await db.query('SELECT id FROM "User" WHERE id=$1', [BP])).rows,
    ).toEqual([{ id: BP }]);
  });
  it("whole-household deletion orders histories before canonical profiles, without touching another family", async () => {
    await rehearseChoreMembers(db, A, true);
    await deleteHousehold(A, P, { revokeCalendarGrant: async () => undefined });
    expect(
      (await db.query('SELECT id FROM "Family" WHERE id=$1', [A])).rows,
    ).toEqual([]);
    expect(
      (
        await db.query('SELECT id FROM "HouseholdMember" WHERE family_id=$1', [
          B,
        ])
      ).rows,
    ).toHaveLength(1);
  });
  it("removal hands open canonical work to the parent and keeps completion subject/credit under existing actor-clearing policy", async () => {
    await db.query('UPDATE "Chore" SET status=$1 WHERE id=$2', ["pending", CH]);
    await rehearseChoreMembers(db, A, true);
    await removeHouseholdMember(
      { actorId: P, familyId: A, targetId: C },
      { revokeCalendarGrant: async () => undefined },
    );
    expect(
      (
        await db.query(
          'SELECT assigned_to,assigned_member_id,status FROM "Chore" WHERE id=$1',
          [CH],
        )
      ).rows[0],
    ).toEqual({
      assigned_to: P,
      assigned_member_id: memberIdForLegacyUser(A, P),
      status: "pending",
    });
    expect(
      (
        await db.query(
          'SELECT assigned_to,assigned_member_id,completed_by,approved_by,xp_awarded FROM "ChoreAssignment" WHERE id=$1',
          [AS],
        )
      ).rows[0],
    ).toEqual({
      assigned_to: C,
      assigned_member_id: member(),
      completed_by: null,
      approved_by: P,
      xp_awarded: 15,
    });
    expect(
      (
        await db.query(
          'SELECT archived_at,erasure_user_id FROM "HouseholdMember" WHERE id=$1',
          [member()],
        )
      ).rows[0],
    ).toEqual({ archived_at: expect.any(Date), erasure_user_id: C });
    expect(
      (
        await db.query(
          'SELECT family_id,token_version FROM "User" WHERE id=$1',
          [C],
        )
      ).rows[0],
    ).toEqual({ family_id: null, token_version: 1 });
    expect(
      (await db.query('SELECT family_id FROM "User" WHERE id=$1', [BP])).rows[0]
        .family_id,
    ).toBe(B);
  });
  it("missing parent reconciliation rolls back removal without losing membership or profiles", async () => {
    await db.query('UPDATE "Chore" SET status=$1 WHERE id=$2', ["pending", CH]);
    await rehearseChoreMembers(db, A, true);
    await db.query(
      'DELETE FROM "HouseholdMemberLegacyMapping" WHERE user_id=$1',
      [P],
    );
    await expect(
      removeHouseholdMember(
        { actorId: P, familyId: A, targetId: C },
        { revokeCalendarGrant: async () => undefined },
      ),
    ).rejects.toMatchObject({ code: "IDENTITY_CONFLICT", status: 409 });
    expect(
      (
        await db.query(
          'SELECT archived_at,erasure_user_id FROM "HouseholdMember" WHERE id=$1',
          [member()],
        )
      ).rows[0],
    ).toEqual({ archived_at: null, erasure_user_id: null });
    expect(
      (
        await db.query(
          'SELECT family_id,token_version FROM "User" WHERE id=$1',
          [C],
        )
      ).rows[0],
    ).toEqual({ family_id: A, token_version: 0 });
    expect(
      (
        await db.query(
          'SELECT assigned_to,assigned_member_id FROM "Chore" WHERE id=$1',
          [CH],
        )
      ).rows[0],
    ).toEqual({ assigned_to: C, assigned_member_id: member() });
  });
  it("rotation removal reassigns open template atomically but retains completed canonical template history", async () => {
    await db.query(
      'UPDATE "Chore" SET rotation_member_ids=$1,status=$2 WHERE id=$3',
      [[C, P], "pending", CH],
    );
    await rehearseChoreMembers(db, A, true);
    await prisma!.$transaction(async (tx) => {
      await lockHousehold(tx, A);
      await dropMemberFromRotationsInTx(tx, A, C);
    });
    expect(
      (
        await db.query(
          'SELECT assigned_to,assigned_member_id,rotation_member_ids FROM "Chore" WHERE id=$1',
          [CH],
        )
      ).rows[0],
    ).toEqual({
      assigned_to: P,
      assigned_member_id: memberIdForLegacyUser(A, P),
      rotation_member_ids: [P],
    });
    await db.query(
      'UPDATE "Chore" SET assigned_to=$1,assigned_member_id=$2,rotation_member_ids=$3,status=$4 WHERE id=$5',
      [C, member(), [C, P], "verified", CH],
    );
    await removeHouseholdMember(
      { actorId: P, familyId: A, targetId: C },
      { revokeCalendarGrant: async () => undefined },
    );
    expect(
      (
        await db.query(
          'SELECT assigned_to,assigned_member_id,rotation_member_ids,status FROM "Chore" WHERE id=$1',
          [CH],
        )
      ).rows[0],
    ).toEqual({
      assigned_to: C,
      assigned_member_id: member(),
      rotation_member_ids: [P],
      status: "verified",
    });
  });
  it.each(["foreign", "archived", "erasure-owned", "conflicting-link"])(
    "refuses %s canonical assignee without mutating rows",
    async (kind) => {
      const userId = kind === "foreign" ? BP : P;
      if (kind === "archived" || kind === "erasure-owned")
        await db.query(
          'UPDATE "HouseholdMember" SET archived_at=CURRENT_TIMESTAMP,erasure_user_id=$1 WHERE id=$2',
          [kind === "erasure-owned" ? P : null, memberIdForLegacyUser(A, P)],
        );
      if (kind === "conflicting-link")
        await db.query(
          'INSERT INTO "HouseholdMemberAccountLink" (member_id,user_id,family_id,verified_at) VALUES ($1,$2,$3,CURRENT_TIMESTAMP)',
          [member(), P, A],
        );
      const before = await snapshot();
      await expect(
        prisma!.$transaction(async (tx) => {
          await lockHousehold(tx, A);
          await canonicalChoreAssigneeInTx(tx, A, userId);
        }),
      ).rejects.toThrow("Household member identity needs review");
      expect(await snapshot()).toEqual(before);
    },
  );
  it("rotation edit updates both assignee IDs on pending future copies while preserving completed history", async () => {
    await rehearseChoreMembers(db, A, true);
    const future = "fx_chore_member_future";
    await prisma!.chore.create({
      data: {
        id: future,
        family_id: A,
        title: "Future",
        assigned_to: C,
        assigned_member_id: member(),
        created_by: P,
        recurrence_id: CH,
        due_date: new Date("2026-01-06T00:00:00Z"),
      },
    });
    await prisma!.$transaction(async (tx) => {
      await lockHousehold(tx, A);
      await applyRotationEditInTx(
        tx,
        CH,
        A,
        [P, C],
        new Date("2026-01-04T00:00:00Z"),
      );
    });
    expect(
      (
        await db.query(
          'SELECT assigned_to,assigned_member_id,rotation_index FROM "Chore" WHERE id=$1',
          [future],
        )
      ).rows[0],
    ).toEqual({
      assigned_to: P,
      assigned_member_id: memberIdForLegacyUser(A, P),
      rotation_index: 0,
    });
    expect(
      (
        await db.query(
          'SELECT assigned_to,assigned_member_id,status FROM "Chore" WHERE id=$1',
          [CH],
        )
      ).rows[0],
    ).toEqual({
      assigned_to: C,
      assigned_member_id: member(),
      status: "verified",
    });
  });
  it("rejecting retained unchecked work after removal hands both IDs to the parent without changing occurrence credit", async () => {
    await db.query('UPDATE "Chore" SET status=$1 WHERE id=$2', [
      "completed",
      CH,
    ]);
    await rehearseChoreMembers(db, A, true);
    await removeHouseholdMember(
      { actorId: P, familyId: A, targetId: C },
      { revokeCalendarGrant: async () => undefined },
    );
    const reopen = () =>
      prisma!.$transaction(async (tx) => {
        await lockHousehold(tx, A);
        return reopenCompletedChoreInTx(
          tx,
          { id: CH, family_id: A },
          { assigned_to: P },
        );
      });
    expect(await reopen()).toBe("reopened");
    expect(await reopen()).toBe("open");
    expect(
      (
        await db.query(
          'SELECT assigned_to,assigned_member_id,status FROM "Chore" WHERE id=$1',
          [CH],
        )
      ).rows[0],
    ).toEqual({
      assigned_to: P,
      assigned_member_id: memberIdForLegacyUser(A, P),
      status: "pending",
    });
    expect(
      (
        await db.query(
          'SELECT assigned_to,assigned_member_id,xp_awarded FROM "ChoreAssignment" WHERE id=$1',
          [AS],
        )
      ).rows[0],
    ).toEqual({ assigned_to: C, assigned_member_id: member(), xp_awarded: 15 });
  });
  it("Undo cannot reopen canonical work for an archived removed assignee", async () => {
    await db.query('UPDATE "Chore" SET status=$1 WHERE id=$2', [
      "completed",
      CH,
    ]);
    await rehearseChoreMembers(db, A, true);
    await removeHouseholdMember(
      { actorId: P, familyId: A, targetId: C },
      { revokeCalendarGrant: async () => undefined },
    );
    await expect(
      prisma!.$transaction((tx) =>
        reopenCompletedChoreInTx(tx, { id: CH, family_id: A }),
      ),
    ).rejects.toThrow("Household member identity needs review");
    expect(
      (
        await db.query(
          'SELECT assigned_to,assigned_member_id,status FROM "Chore" WHERE id=$1',
          [CH],
        )
      ).rows[0],
    ).toEqual({
      assigned_to: C,
      assigned_member_id: member(),
      status: "completed",
    });
  });
  it("rotation edit waits for membership lock and refuses a participant removed before it can read", async () => {
    await rehearseChoreMembers(db, A, true);
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `household-membership:${A}`,
    ]);
    let result: Promise<unknown> | undefined;
    try {
      result = prisma!
        .$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            "SET LOCAL application_name = 'fx_chore_member_rotation_wait'",
          );
          return applyRotationEditInTx(
            tx,
            CH,
            A,
            [P, C],
            new Date("2026-01-04T00:00:00Z"),
          );
        })
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = await db.query(
          "SELECT pid FROM pg_stat_activity WHERE application_name='fx_chore_member_rotation_wait' AND wait_event='advisory'",
        );
        if (rows.rowCount) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      // A controlled membership detachment under the household lock completes
      // while the edit is blocked. Its stale pre-lock participant list must not return.
      await db.query(
        'UPDATE "HouseholdMember" SET archived_at=CURRENT_TIMESTAMP,erasure_user_id=$1 WHERE id=$2',
        [C, member()],
      );
      await db.query(
        'DELETE FROM "HouseholdMemberLegacyMapping" WHERE user_id=$1',
        [C],
      );
      await db.query(
        'UPDATE "User" SET family_id=NULL,token_version=token_version+1 WHERE id=$1',
        [C],
      );
      await db.query("COMMIT");
      expect(await result).toEqual({
        error: expect.objectContaining({
          name: "HouseholdMemberIdentityConflict",
        }),
      });
      expect(
        (
          await db.query(
            'SELECT rotation_member_ids FROM "Chore" WHERE id=$1',
            [CH],
          )
        ).rows[0].rotation_member_ids,
      ).toEqual([]);
    } finally {
      await db.query("ROLLBACK");
      await result;
    }
  });
  it("direct family cascade deletes canonical histories and leaves the other household intact", async () => {
    await rehearseChoreMembers(db, A, true);
    await db.query('DELETE FROM "Family" WHERE id=$1', [A]);
    for (const table of ["Chore", "ChoreAssignment", "HouseholdMember"]) {
      expect(
        (await db.query(`SELECT id FROM "${table}" WHERE family_id=$1`, [A]))
          .rows,
      ).toEqual([]);
    }
    expect(
      (
        await db.query('SELECT id FROM "HouseholdMember" WHERE family_id=$1', [
          B,
        ])
      ).rows,
    ).toHaveLength(1);
  });
  it("refuses non-fixture scope and rolls back injected write failure", async () => {
    await expect(
      rehearseChoreMembers(db, "real-family", true),
    ).rejects.toMatchObject({ code: "FIXTURE_FAMILY_REQUIRED" });
    const query = db.query.bind(db);
    let written = false;
    const broken = {
      query: async (sql: string, args?: unknown[]) => {
        if (sql.startsWith('UPDATE "ChoreAssignment"'))
          throw new Error("injected");
        if (sql.startsWith('UPDATE "Chore"')) written = true;
        return query(sql, args);
      },
    } as unknown as pg.Client;
    await expect(rehearseChoreMembers(broken, A, true)).rejects.toThrow(
      "injected",
    );
    expect(written).toBe(true);
    expect(
      (
        await db.query('SELECT assigned_member_id FROM "Chore" WHERE id=$1', [
          CH,
        ])
      ).rows[0].assigned_member_id,
    ).toBeNull();
  });
});
