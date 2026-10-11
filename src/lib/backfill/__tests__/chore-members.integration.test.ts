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
