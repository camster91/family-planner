/**
 * Real-Postgres proof for the protocol-aware Today board reader.
 *
 * This is intentionally opt-in: RUN_DB_INTEGRATION=1, FIXTURES_ALLOW=1, a
 * disposable DATABASE_URL, and a generated client that includes the nullable
 * HouseholdMember/Chore subject columns via PROFILE_CHORE_PRISMA_CLIENT_MODULE.
 * The suite only owns the fixture families below and never enables the profile
 * feature outside the individual reader calls that need protocol 2.
 */
import type { PrismaClient } from "@prisma/client";
import pg from "pg";
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";
import { choresDueTodayByPerson } from "@/components/fridge/board-model";
import { loadHomeSummary } from "../home-summary-data";

const dbDescribe =
  process.env.RUN_DB_INTEGRATION === "1" && process.env.FIXTURES_ALLOW === "1"
    ? describe
    : describe.skip;

jest.setTimeout(90_000);

const FAMILY_A = "fx_today_profile_family_a";
const FAMILY_B = "fx_today_profile_family_b";
const PARENT_A = "fx_today_profile_parent_a";
const MAP_USER = "fx_today_profile_map_user";
const LINK_USER = "fx_today_profile_link_user";
const PARENT_B = "fx_today_profile_parent_b";

const CHILD_A = "fx_today_profile_child_a";
const TEEN_A = "fx_today_profile_teen_a";
const PARENT_PROFILE_A = "fx_today_profile_parent_profile_a";
const ARCHIVED_A = "fx_today_profile_archived_a";
const MAPPED_A = "fx_today_profile_mapped_a";
const LINKED_A = "fx_today_profile_linked_a";
const ERASED_A = "fx_today_profile_erased_a";
const CHILD_B = "fx_today_profile_child_b";

const PROFILE_CHILD_CHORE = "fx_today_profile_chore_child";
const PROFILE_TEEN_CHORE = "fx_today_profile_chore_teen";
const PROFILE_PARENT_CHORE = "fx_today_profile_chore_parent";
const ARCHIVED_CHORE = "fx_today_profile_chore_archived";
const MAPPED_CHORE = "fx_today_profile_chore_mapped";
const LINKED_CHORE = "fx_today_profile_chore_linked";
const ERASED_CHORE = "fx_today_profile_chore_erased";
const ACCOUNT_CHORE = "fx_today_profile_chore_account";
const FOREIGN_CHORE = "fx_today_profile_chore_foreign";

const FAMILY_IDS = [FAMILY_A, FAMILY_B];
const USER_IDS = [PARENT_A, MAP_USER, LINK_USER, PARENT_B];
const NOW = new Date("2026-10-11T12:00:00.000Z");
const DUE = new Date("2026-10-11T00:00:00.000Z");

// The nullable generated client is supplied by the root-owned integration
// runner. Keep this structural so the normal unit client is never generated or
// mutated by this test.
type TestDb = PrismaClient & Record<string, any>;

type BoardLib = typeof import("../board-snapshot");

async function loadDatabase(): Promise<TestDb> {
  const configuredModule = process.env.PROFILE_CHORE_PRISMA_CLIENT_MODULE;
  if (!configuredModule) {
    throw new Error(
      "Today profile board integration requires PROFILE_CHORE_PRISMA_CLIENT_MODULE with the root-owned generated client.",
    );
  }
  const loaded = await import(configuredModule);
  const candidate = loaded as {
    prisma?: unknown;
    default?: { prisma?: unknown } | unknown;
  };
  const configured =
    candidate.prisma ??
    (candidate.default &&
    typeof candidate.default === "object" &&
    "prisma" in candidate.default
      ? (candidate.default as { prisma: unknown }).prisma
      : candidate.default) ??
    loaded;
  if (!configured || typeof configured !== "object") {
    throw new Error(
      "Today profile board integration could not find a Prisma client export.",
    );
  }
  const db = configured as TestDb;
  for (const model of ["family", "user", "chore", "householdMember"]) {
    if (!db[model]) {
      throw new Error(
        `Today profile board integration needs generated client model ${model}.`,
      );
    }
  }
  return db;
}

async function withProfileGate<T>(
  enabled: boolean,
  run: () => Promise<T>,
): Promise<T> {
  const previous = process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED;
  const previousRollback = process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY;
  if (enabled) process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED = "1";
  else delete process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED;
  if (enabled) process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY = "1";
  else delete process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY;
  try {
    return await run();
  } finally {
    if (previous === undefined)
      delete process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED;
    else process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED = previous;
    if (previousRollback === undefined)
      delete process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY;
    else process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY = previousRollback;
  }
}

dbDescribe("Today profile subjects against disposable PostgreSQL", () => {
  let db: TestDb;
  let sql: pg.Client;
  let lib: BoardLib;

  async function cleanup() {
    if (!sql) return;
    // Explicit dependent cleanup keeps this safe with NO ACTION profile FKs
    // and proves that no unrelated household is being swept.
    await sql.query(
      'DELETE FROM "ChoreAssignment" WHERE family_id = ANY($1::text[])',
      [FAMILY_IDS],
    );
    await sql.query('DELETE FROM "Chore" WHERE family_id = ANY($1::text[])', [
      FAMILY_IDS,
    ]);
    await sql.query(
      'DELETE FROM "HouseholdMemberLegacyMapping" WHERE family_id = ANY($1::text[])',
      [FAMILY_IDS],
    );
    await sql.query(
      'DELETE FROM "HouseholdMemberAccountLink" WHERE family_id = ANY($1::text[])',
      [FAMILY_IDS],
    );
    await sql.query(
      'DELETE FROM "HouseholdMember" WHERE family_id = ANY($1::text[])',
      [FAMILY_IDS],
    );
    await sql.query('DELETE FROM "Family" WHERE id = ANY($1::text[])', [
      FAMILY_IDS,
    ]);
    await sql.query('DELETE FROM "User" WHERE id = ANY($1::text[])', [
      USER_IDS,
    ]);
  }

  async function seed() {
    await sql.query(
      'INSERT INTO "Family" (id, name, invite_code) VALUES ($1, $2, $3), ($4, $5, $6)',
      [
        FAMILY_A,
        "Today profile A",
        `${FAMILY_A}-invite`,
        FAMILY_B,
        "Today profile B",
        `${FAMILY_B}-invite`,
      ],
    );
    await sql.query(
      'INSERT INTO "User" (id, email, name, family_id, role) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $4, $5), ($9, $10, $11, $4, $5), ($12, $13, $14, $15, $5)',
      [
        PARENT_A,
        `${PARENT_A}@example.test`,
        "Fixture Today parent",
        FAMILY_A,
        "parent",
        MAP_USER,
        `${MAP_USER}@example.test`,
        "Fixture mapped account",
        LINK_USER,
        `${LINK_USER}@example.test`,
        "Fixture linked account",
        PARENT_B,
        `${PARENT_B}@example.test`,
        "Fixture other household parent",
        FAMILY_B,
      ],
    );
    await sql.query(
      'INSERT INTO "HouseholdMember" (id, family_id, name, role, age, board_color) VALUES ($1, $2, $3, $4, $5, $6), ($7, $2, $8, $9, $10, $11), ($12, $2, $13, $14, $15, $16), ($17, $2, $18, $19, $20, $21), ($22, $2, $23, $24, $25, $26), ($27, $2, $28, $29, $30, $31), ($32, $2, $33, $34, $35, $36), ($37, $38, $39, $40, $41, $42)',
      [
        CHILD_A,
        FAMILY_A,
        "Profile child",
        "child",
        8,
        "purple",
        TEEN_A,
        "Profile teen",
        "teen",
        15,
        "sky",
        PARENT_PROFILE_A,
        "Profile parent",
        "parent",
        32,
        "orange",
        ARCHIVED_A,
        "Archived profile",
        "child",
        7,
        "red",
        MAPPED_A,
        "Mapped profile",
        "child",
        9,
        "green",
        LINKED_A,
        "Linked profile",
        "teen",
        16,
        "pink",
        ERASED_A,
        "Erased profile",
        "child",
        6,
        "yellow",
        CHILD_B,
        FAMILY_B,
        "Foreign profile",
        "child",
        8,
        "indigo",
      ],
    );
    await sql.query(
      'INSERT INTO "Chore" (id, family_id, title, assigned_to, assigned_member_id, member_subject_erased, due_date, created_by) VALUES ($1, $2, $3, NULL, $4, FALSE, $5, $6), ($7, $2, $8, NULL, $9, FALSE, $5, $6), ($10, $2, $11, NULL, $12, FALSE, $5, $6), ($13, $2, $14, NULL, $15, FALSE, $5, $6), ($16, $2, $17, NULL, $18, FALSE, $5, $6), ($19, $2, $20, NULL, $21, FALSE, $5, $6), ($22, $2, $23, NULL, $24, FALSE, $5, $6), ($25, $2, $26, $6, NULL, FALSE, $5, $6), ($27, $28, $29, NULL, $30, FALSE, $5, $31)',
      [
        PROFILE_CHILD_CHORE,
        FAMILY_A,
        "Profile child chore",
        CHILD_A,
        DUE.toISOString(),
        PARENT_A,
        PROFILE_TEEN_CHORE,
        "Profile teen chore",
        TEEN_A,
        PROFILE_PARENT_CHORE,
        "Profile parent chore",
        PARENT_PROFILE_A,
        ARCHIVED_CHORE,
        "Archived profile chore",
        ARCHIVED_A,
        MAPPED_CHORE,
        "Mapped profile chore",
        MAPPED_A,
        LINKED_CHORE,
        "Linked profile chore",
        LINKED_A,
        ERASED_CHORE,
        "Erased profile chore",
        ERASED_A,
        ACCOUNT_CHORE,
        "Account chore",
        FOREIGN_CHORE,
        FAMILY_B,
        "Foreign household chore",
        CHILD_B,
        PARENT_B,
      ],
    );
    await sql.query(
      'INSERT INTO "HouseholdMemberLegacyMapping" (user_id, member_id, family_id) VALUES ($1, $2, $3)',
      [MAP_USER, MAPPED_A, FAMILY_A],
    );
    await sql.query(
      'INSERT INTO "HouseholdMemberAccountLink" (member_id, user_id, family_id, verified_at) VALUES ($1, $2, $3, $4)',
      [LINKED_A, LINK_USER, FAMILY_A, NOW],
    );
    await sql.query(
      'UPDATE "HouseholdMember" SET archived_at = $1 WHERE id = $2',
      [NOW, ARCHIVED_A],
    );
    await sql.query(
      'UPDATE "HouseholdMember" SET archived_at = $1, erasure_user_id = $2 WHERE id = $3',
      [NOW, PARENT_A, ERASED_A],
    );
    await sql.query(
      'UPDATE "Chore" SET assigned_member_id = NULL, member_subject_erased = TRUE WHERE id = $1',
      [ERASED_CHORE],
    );
  }

  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    if (
      process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED === "1" ||
      process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY === "1"
    ) {
      throw new Error(
        "Today profile board integration must start with the profile gate off.",
      );
    }
    db = await loadDatabase();
    sql = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await sql.connect();
    lib = await import("../board-snapshot");
  });

  beforeEach(async () => {
    await cleanup();
    await seed();
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      if (sql) await sql.end();
      if (db) await db.$disconnect();
    }
  });

  it("reads active unlinked profiles across child, teen, and parent ages with typed matching and privacy-safe DTOs", async () => {
    const board = await withProfileGate(true, () =>
      lib.loadTodayBoard(db, {
        familyId: FAMILY_A,
        audience: "device",
        memberProtocol: 2,
        now: NOW,
      }),
    );

    expect(board.memberProtocol).toBe(2);
    expect(board.protocolError).toBeUndefined();
    expect(
      board.members
        .map((member) =>
          member.subject?.kind === "profile" ? member.subject.memberId : null,
        )
        .filter((memberId): memberId is string => memberId !== null)
        .sort(),
    ).toEqual([CHILD_A, TEEN_A, PARENT_PROFILE_A].sort());
    expect(
      board.chores
        .map((chore) =>
          chore.subject?.kind === "profile" ? chore.subject.memberId : null,
        )
        .filter((memberId): memberId is string => memberId !== null)
        .sort(),
    ).toEqual([CHILD_A, TEEN_A, PARENT_PROFILE_A].sort());
    expect(
      board.chores.some(
        (chore) =>
          chore.id === ACCOUNT_CHORE && chore.subject?.kind === "account",
      ),
    ).toBe(true);
    expect(board.chores.map((chore) => chore.id)).not.toEqual(
      expect.arrayContaining([
        ARCHIVED_CHORE,
        MAPPED_CHORE,
        LINKED_CHORE,
        ERASED_CHORE,
        FOREIGN_CHORE,
      ]),
    );
    expect(board.members.map((member) => member.id)).not.toEqual(
      expect.arrayContaining([
        `profile:${ARCHIVED_A}`,
        `profile:${MAPPED_A}`,
        `profile:${LINKED_A}`,
        `profile:${ERASED_A}`,
      ]),
    );

    for (const member of board.members) {
      expect(Object.keys(member).sort()).toEqual([
        "color",
        "id",
        "name",
        "subject",
      ]);
      if (member.subject)
        expect(Object.keys(member.subject).sort()).toEqual(
          member.subject.kind === "profile"
            ? ["color", "kind", "memberId", "name"]
            : ["accountId", "kind", "name"],
        );
    }
    for (const chore of board.chores) {
      expect(Object.keys(chore).sort()).toEqual(
        chore.subject?.kind === "profile"
          ? [
              "actionAvailability",
              "dueDay",
              "icon",
              "id",
              "status",
              "subject",
              "title",
            ]
          : [
              "assigneeId",
              "dueDay",
              "icon",
              "id",
              "status",
              "subject",
              "title",
            ],
      );
      if (chore.subject?.kind === "profile") {
        expect(chore.actionAvailability).toEqual({
          state: "active",
          requiresCompatibleClient: false,
          actions: { complete: true, undo: true, verify: true, reject: true },
        });
      }
      if (chore.subject)
        expect(Object.keys(chore.subject).sort()).toEqual(
          chore.subject.kind === "profile"
            ? ["color", "kind", "memberId", "name"]
            : ["accountId", "kind", "name"],
        );
    }
    expect(JSON.stringify(board)).not.toContain("@example.test");

    const grouped = choresDueTodayByPerson(board.chores, board.members, NOW);
    expect(grouped.map((group) => group.member.name).sort()).toEqual(
      [
        "Fixture Today parent",
        "Profile child",
        "Profile teen",
        "Profile parent",
      ].sort(),
    );
    expect(
      grouped
        .find((group) => group.member.name === "Profile child")
        ?.open.map((chore) => chore.id),
    ).toEqual([PROFILE_CHILD_CHORE]);
  });

  it("returns a stable protocol-1 refusal instead of dropping stored profile rows", async () => {
    const board = await withProfileGate(true, () =>
      lib.loadTodayBoard(db, {
        familyId: FAMILY_A,
        role: "parent",
        memberProtocol: 1,
        now: NOW,
      }),
    );

    expect(board.memberProtocol).toBe(1);
    expect(board.protocolError).toEqual({
      code: "MEMBER_PROTOCOL_UNAVAILABLE",
      recovery: "refresh-and-retain-pending",
      requiredProtocol: 2,
      receivedProtocol: 1,
    });
    expect(board.chores.some((chore) => chore.id === PROFILE_CHILD_CHORE)).toBe(
      false,
    );
    expect(board.chores.some((chore) => chore.id === ACCOUNT_CHORE)).toBe(true);
    expect(
      board.members.some((member) => member.id === `profile:${CHILD_A}`),
    ).toBe(false);
  });

  it("keeps the same refusal after a profile-gate rollback and refuses protocol 2 while the gate is off", async () => {
    const legacy = await withProfileGate(false, () =>
      lib.loadTodayBoard(db, {
        familyId: FAMILY_A,
        role: "parent",
        memberProtocol: 1,
        now: NOW,
      }),
    );
    expect(legacy.protocolError?.code).toBe("MEMBER_PROTOCOL_UNAVAILABLE");
    expect(legacy.memberProtocol).toBe(1);

    const unavailable = await withProfileGate(false, () =>
      lib.loadTodayBoard(db, {
        familyId: FAMILY_A,
        role: "parent",
        memberProtocol: 2,
        now: NOW,
      }),
    );
    expect(unavailable.protocolError?.code).toBe("MEMBER_PROTOCOL_UNAVAILABLE");
    expect(unavailable.memberProtocol).toBe(2);
    expect(
      unavailable.chores.some((chore) => chore.id === PROFILE_CHILD_CHORE),
    ).toBe(false);
  });

  it("detects a profile chore after the bounded board and home-summary caps", async () => {
    await sql.query('DELETE FROM "Chore" WHERE id = $1', [FOREIGN_CHORE]);
    const accountIds = Array.from(
      { length: 120 },
      (_, index) =>
        `fx_today_profile_cap_account_${String(index).padStart(2, "0")}`,
    );
    const values = accountIds.flatMap((id) => [
      id,
      FAMILY_B,
      "Capped account chore",
      PARENT_B,
      DUE.toISOString(),
      PARENT_B,
    ]);
    const tuples = accountIds
      .map((_, index) => {
        const offset = index * 6;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, NULL, FALSE, $${offset + 5}, $${offset + 6})`;
      })
      .join(", ");
    await sql.query(
      `INSERT INTO "Chore" (id, family_id, title, assigned_to, assigned_member_id, member_subject_erased, due_date, created_by) VALUES ${tuples}`,
      values,
    );
    await sql.query(
      'INSERT INTO "Chore" (id, family_id, title, assigned_to, assigned_member_id, member_subject_erased, due_date, created_by) VALUES ($1, $2, $3, NULL, $4, FALSE, $5, $6)',
      [
        "fx_today_profile_cap_profile",
        FAMILY_B,
        "Capped profile chore",
        CHILD_B,
        DUE.toISOString(),
        PARENT_B,
      ],
    );

    const board = await withProfileGate(true, () =>
      lib.loadTodayBoard(db, {
        familyId: FAMILY_B,
        role: "parent",
        memberProtocol: 1,
        now: NOW,
      }),
    );
    expect(board.protocolError?.code).toBe("MEMBER_PROTOCOL_UNAVAILABLE");
    expect(
      board.chores.some((chore) => chore.id === "fx_today_profile_cap_profile"),
    ).toBe(false);
    expect(board.chores).toHaveLength(80);

    const home = await loadHomeSummary(db, {
      familyId: FAMILY_B,
      role: "parent",
      memberProtocol: 1,
      now: NOW,
    });
    expect(home.protocolError?.code).toBe("MEMBER_PROTOCOL_UNAVAILABLE");
    expect(
      home.chores.some((chore) => chore.id === "fx_today_profile_cap_profile"),
    ).toBe(false);
    expect(home.chores).toHaveLength(120);

    const rollback = await withProfileGate(false, () =>
      lib.loadTodayBoard(db, {
        familyId: FAMILY_B,
        role: "parent",
        memberProtocol: 1,
        now: NOW,
      }),
    );
    expect(rollback.protocolError?.code).toBe("MEMBER_PROTOCOL_UNAVAILABLE");

    await sql.query(
      'DELETE FROM "Chore" WHERE id = ANY($1::text[])',
      [[...accountIds, "fx_today_profile_cap_profile"]],
    );
    const inactiveMember = "fx_today_profile_cap_inactive_member";
    await sql.query(
      'INSERT INTO "HouseholdMember" (id, family_id, name, role, age, board_color) VALUES ($1, $2, $3, $4, $5, $6)',
      [inactiveMember, FAMILY_B, "Archived cap profile", "child", 8, "red"],
    );
    await sql.query(
      'INSERT INTO "Chore" (id, family_id, title, assigned_to, assigned_member_id, member_subject_erased, due_date, created_by) VALUES ($1, $2, $3, NULL, $4, FALSE, $5, $6), ($7, $8, $9, NULL, $10, FALSE, $11, $12), ($13, $14, $15, NULL, $16, FALSE, $17, $18)',
      [
        "fx_today_profile_cap_inactive_chore",
        FAMILY_B,
        "Archived cap chore",
        inactiveMember,
        DUE.toISOString(),
        PARENT_B,
        "fx_today_profile_cap_out_of_window",
        FAMILY_B,
        "Out of window cap chore",
        CHILD_B,
        new Date("2026-12-01T00:00:00.000Z").toISOString(),
        PARENT_B,
        "fx_today_profile_cap_foreign",
        FAMILY_A,
        "Foreign cap chore",
        CHILD_A,
        DUE.toISOString(),
        PARENT_A,
      ],
    );
    await sql.query(
      'UPDATE "HouseholdMember" SET archived_at = $1 WHERE id = $2',
      [NOW, inactiveMember],
    );
    const noFalseRefusal = await withProfileGate(true, () =>
      lib.loadTodayBoard(db, {
        familyId: FAMILY_B,
        role: "parent",
        memberProtocol: 1,
        now: NOW,
      }),
    );
    expect(noFalseRefusal.protocolError).toBeUndefined();
    const noFalseHomeRefusal = await loadHomeSummary(db, {
      familyId: FAMILY_B,
      role: "parent",
      memberProtocol: 1,
      now: NOW,
    });
    expect(noFalseHomeRefusal.protocolError).toBeUndefined();
  });

  it("changes version only for owned profile-board changes", async () => {
    const first = await withProfileGate(true, () =>
      lib.loadTodayBoard(db, {
        familyId: FAMILY_A,
        role: "parent",
        memberProtocol: 2,
        now: NOW,
      }),
    );
    await sql.query('UPDATE "Chore" SET status = $1 WHERE id = $2', [
      "completed",
      FOREIGN_CHORE,
    ]);
    const foreignChange = await withProfileGate(true, () =>
      lib.loadTodayBoard(db, {
        familyId: FAMILY_A,
        role: "parent",
        memberProtocol: 2,
        now: NOW,
      }),
    );
    expect(foreignChange.version).toBe(first.version);

    await sql.query('UPDATE "Chore" SET status = $1 WHERE id = $2', [
      "completed",
      PROFILE_CHILD_CHORE,
    ]);
    const ownedChange = await withProfileGate(true, () =>
      lib.loadTodayBoard(db, {
        familyId: FAMILY_A,
        role: "parent",
        memberProtocol: 2,
        now: NOW,
      }),
    );
    expect(ownedChange.version).not.toBe(first.version);
  });
});
