/**
 * PostgreSQL contract checks for the routine-stack core (#499 follow-up).
 *
 * This suite is deliberately opt-in. It must only run against a disposable
 * database with both explicit integration gates enabled. The normal Prisma
 * client is used by default; ROOT-owned validation can point
 * ROUTINE_STACK_PRISMA_CLIENT_MODULE at a generated client that contains the
 * additive RoutineStack model without mutating this checkout's shared client.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import {
  fingerprintRoutineStackSnapshot,
  fingerprintRoutineStackSelectedStep,
  normalizeRoutineStackDraft,
  projectRoutineStackResponse,
  routineStackResponseByteLength,
  type RoutineStackDraft,
} from "@/lib/routine-stack";
import { hashIdempotentRequest } from "@/lib/idempotency";
import {
  readParentRoutineStackCandidates,
  readParentRoutineStack,
  saveParentRoutineStack,
} from "@/lib/routine-stack-api";
import { decodeChoreCursor } from "@/lib/chore-paging";
import {
  mutateRoutineStack,
  mutateRoutineStackInTx,
  type RoutineStackActor,
} from "@/lib/routine-stack-mutation";

function looksLikeDisposableDatabase(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    const localHost = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);
    const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
    return (
      localHost.has(url.hostname) &&
      /(?:^|[-_])(ci|e2e|test|integration|routine)(?:[-_]|$)/i.test(
        databaseName,
      )
    );
  } catch {
    return false;
  }
}

const databaseSuiteEnabled =
  process.env.RUN_DB_INTEGRATION === "1" &&
  process.env.FIXTURES_ALLOW === "1" &&
  process.env.NODE_ENV !== "production" &&
  looksLikeDisposableDatabase(process.env.DATABASE_URL);
const describeWithDatabase = databaseSuiteEnabled ? describe : describe.skip;

jest.setTimeout(120_000);

type Db = any;

const PREFIX = `rstack-int-${process.pid}`;
const FAMILY_A = `${PREFIX}-family-a`;
const FAMILY_B = `${PREFIX}-family-b`;
const PARENT_A = `${PREFIX}-parent-a`;
const OTHER_PARENT_A = `${PREFIX}-parent-2`;
const CHILD_A = `${PREFIX}-child-a`;
const PARENT_B = `${PREFIX}-parent-b`;
const MEMBER_PARENT_A = `${PREFIX}-member-parent-a`;
const MEMBER_OTHER_PARENT_A = `${PREFIX}-member-parent-2`;
const MEMBER_CHILD_A = `${PREFIX}-member-child-a`;
const MEMBER_PARENT_B = `${PREFIX}-member-parent-b`;
const MEMBER_DORMANT_A = `${PREFIX}-member-dormant-a`;
const MEMBER_ARCHIVED_A = `${PREFIX}-member-archived-a`;
const MEMBER_ERASED_A = `${PREFIX}-member-erased-a`;
const CANDIDATE_LEGACY_USER = `${PREFIX}-candidate-legacy-user`;
const CANDIDATE_ARCHIVED_USER = `${PREFIX}-candidate-archived-user`;
const CANDIDATE_ERASED_USER = `${PREFIX}-candidate-erased-user`;
const CANDIDATE_ARCHIVED_MEMBER = `${PREFIX}-candidate-archived-member`;
const CANDIDATE_ERASED_MEMBER = `${PREFIX}-candidate-erased-member`;
const CANDIDATE_DORMANT_MEMBER = `${PREFIX}-candidate-dormant-member`;
const CANDIDATE_CANONICAL = `${PREFIX}-candidate-canonical`;
const CANDIDATE_LEGACY = `${PREFIX}-candidate-legacy`;
const CANDIDATE_ARCHIVED = `${PREFIX}-candidate-archived`;
const CANDIDATE_ERASED = `${PREFIX}-candidate-erased`;
const CANDIDATE_DORMANT = `${PREFIX}-candidate-dormant`;
const CANDIDATE_FOREIGN_ACCOUNT = `${PREFIX}-candidate-foreign-account`;
const CANDIDATE_ORPHAN = `${PREFIX}-candidate-orphan`;
const CANDIDATE_TEMPLATE = `${PREFIX}-candidate-template`;
const STACK_A = `${PREFIX}-stack-a`;
const STACK_FOREIGN = `${PREFIX}-stack-foreign`;
const STACK_B = `${PREFIX}-stack-b`;
const CHORE_A = `${PREFIX}-chore-a`;
const CHORE_FOREIGN = `${PREFIX}-chore-foreign`;
const CHORE_B = `${PREFIX}-chore-b`;
const RECURRING_TEMPLATE = `${PREFIX}-recurring-template`;
const CHORE_RECURRING = `${PREFIX}-chore-recurring`;
const LEGACY_UNSTACKED = `${PREFIX}-legacy-unstacked-remove`;
const STOPPED_ANCHOR = `${PREFIX}-stopped-anchor`;
const LEGACY_OCCURRENCE = `${PREFIX}-legacy-occurrence`;
const ORPHAN_OCCURRENCE = `${PREFIX}-orphan-occurrence`;
const FOREIGN_ANCHOR = `${PREFIX}-foreign-anchor`;
const FOREIGN_OCCURRENCE = `${PREFIX}-foreign-occurrence`;
const MALFORMED_ANCHOR = `${PREFIX}-malformed-anchor`;
const MALFORMED_OCCURRENCE = `${PREFIX}-malformed-occurrence`;
const EMPTY_OCCURRENCE = `${PREFIX}-empty-occurrence`;
const OCCURRENCE_DATE = "2026-10-12";
const OCCURRENCE = new Date(`${OCCURRENCE_DATE}T00:00:00.000Z`);

async function loadDatabase(): Promise<Db> {
  const configuredModule = process.env.ROUTINE_STACK_PRISMA_CLIENT_MODULE;
  const loaded = configuredModule
    ? await import(configuredModule)
    : await import("@/lib/prisma");
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
      "Routine-stack integration needs a generated Prisma client module with a prisma export.",
    );
  }
  const db = configured as Db;
  if (!db.routineStack) {
    throw new Error(
      "Routine-stack integration needs the Prisma client generated from the RoutineStack schema; set ROUTINE_STACK_PRISMA_CLIENT_MODULE for the ROOT-owned client.",
    );
  }
  return db;
}

async function runRoutineStackMigrationTwice(): Promise<void> {
  const migrationPath = path.resolve(
    process.cwd(),
    "database/migration-routine-stacks.sql",
  );
  const sql = fs.readFileSync(migrationPath, "utf8");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql);
    // A repeat is part of the release contract: deployment retries must not
    // rebuild the table, alter existing rows, or fail on duplicate constraints.
    await client.query(sql);
    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'RoutineStack'
       AND column_name IN ('created_by')`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual(["created_by"]);
    const constraints = await client.query<{ constraint_name: string }>(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE table_schema = 'public' AND table_name = 'RoutineStack'
       AND constraint_name IN ('RoutineStack_created_by_fkey', 'RoutineStack_id_family_id_key')
       ORDER BY constraint_name`,
    );
    expect(constraints.rows.map((row) => row.constraint_name)).toEqual([
      "RoutineStack_created_by_fkey",
      "RoutineStack_id_family_id_key",
    ]);
  } finally {
    await client.end();
  }
}

describeWithDatabase("routine stack against disposable PostgreSQL", () => {
  let db: Db;
  let accountDeletion: typeof import("@/lib/account-deletion");
  let migrationVerified = false;

  const actorA: RoutineStackActor = {
    familyId: FAMILY_A,
    userId: PARENT_A,
    role: "parent",
  };
  const actorB: RoutineStackActor = {
    familyId: FAMILY_B,
    userId: PARENT_B,
    role: "parent",
  };

  async function cleanup(): Promise<void> {
    // Chore_routine_stack_fkey is deliberately NO ACTION: children must be
    // removed before stack identities, mirroring the account deletion plan.
    await db.chore.deleteMany({
      where: { family_id: { in: [FAMILY_A, FAMILY_B] } },
    });
    await db.routineStack.deleteMany({
      where: { family_id: { in: [FAMILY_A, FAMILY_B] } },
    });
    await db.idempotencyRecord.deleteMany({
      where: { family_id: { in: [FAMILY_A, FAMILY_B] } },
    });
    await db.user.deleteMany({
      where: {
        id: {
          in: [
            PARENT_A,
            OTHER_PARENT_A,
            CHILD_A,
            PARENT_B,
            CANDIDATE_LEGACY_USER,
            CANDIDATE_ARCHIVED_USER,
            CANDIDATE_ERASED_USER,
          ],
        },
      },
    });
    await db.family.deleteMany({ where: { id: { in: [FAMILY_A, FAMILY_B] } } });
  }

  async function seed(): Promise<void> {
    await db.family.createMany({
      data: [
        {
          id: FAMILY_A,
          name: "Routine integration A",
          invite_code: `${PREFIX}-invite-a`,
        },
        {
          id: FAMILY_B,
          name: "Routine integration B",
          invite_code: `${PREFIX}-invite-b`,
        },
      ],
    });
    await db.user.createMany({
      data: [
        {
          id: PARENT_A,
          email: `${PARENT_A}@example.test`,
          name: "Parent A",
          role: "parent",
          family_id: FAMILY_A,
        },
        {
          id: OTHER_PARENT_A,
          email: `${OTHER_PARENT_A}@example.test`,
          name: "Other parent A",
          role: "parent",
          family_id: FAMILY_A,
        },
        {
          id: CHILD_A,
          email: `${CHILD_A}@example.test`,
          name: "Child A",
          role: "child",
          family_id: FAMILY_A,
        },
        {
          id: PARENT_B,
          email: `${PARENT_B}@example.test`,
          name: "Parent B",
          role: "parent",
          family_id: FAMILY_B,
        },
      ],
    });
    await db.householdMember.createMany({
      data: [
        {
          id: MEMBER_PARENT_A,
          family_id: FAMILY_A,
          name: "Parent A profile",
          role: "parent",
        },
        {
          id: MEMBER_OTHER_PARENT_A,
          family_id: FAMILY_A,
          name: "Other parent A profile",
          role: "parent",
        },
        {
          id: MEMBER_CHILD_A,
          family_id: FAMILY_A,
          name: "Child A profile",
          role: "child",
        },
        {
          id: MEMBER_PARENT_B,
          family_id: FAMILY_B,
          name: "Parent B profile",
          role: "parent",
        },
      ],
    });
    await db.householdMemberLegacyMapping.createMany({
      data: [
        {
          member_id: MEMBER_PARENT_A,
          user_id: PARENT_A,
          family_id: FAMILY_A,
        },
        {
          member_id: MEMBER_OTHER_PARENT_A,
          user_id: OTHER_PARENT_A,
          family_id: FAMILY_A,
        },
        {
          member_id: MEMBER_CHILD_A,
          user_id: CHILD_A,
          family_id: FAMILY_A,
        },
        {
          member_id: MEMBER_PARENT_B,
          user_id: PARENT_B,
          family_id: FAMILY_B,
        },
      ],
    });
    await db.routineStack.createMany({
      data: [
        {
          id: STACK_A,
          family_id: FAMILY_A,
          label: "Morning",
          fingerprint: "seed-a",
          created_by: PARENT_A,
        },
        {
          id: STACK_FOREIGN,
          family_id: FAMILY_A,
          label: "Foreign stack",
          fingerprint: "seed-foreign",
          created_by: OTHER_PARENT_A,
        },
        {
          id: STACK_B,
          family_id: FAMILY_B,
          label: "Other household",
          fingerprint: "seed-b",
          created_by: PARENT_B,
        },
      ],
    });
    await db.chore.createMany({
      data: [
        {
          id: CHORE_A,
          family_id: FAMILY_A,
          title: "Brush teeth",
          assigned_to: CHILD_A,
          due_date: OCCURRENCE,
          created_by: PARENT_A,
          routine_stack_id: STACK_A,
          routine: "Morning",
          routine_order: 1,
          frequency: "once",
          weekly_days: [],
        },
        {
          id: CHORE_FOREIGN,
          family_id: FAMILY_A,
          title: "Foreign stack step",
          assigned_to: CHILD_A,
          due_date: OCCURRENCE,
          created_by: OTHER_PARENT_A,
          routine_stack_id: STACK_FOREIGN,
          routine: "Foreign stack",
          routine_order: 1,
          frequency: "once",
          weekly_days: [],
        },
        {
          id: CHORE_B,
          family_id: FAMILY_B,
          title: "Other household step",
          assigned_to: PARENT_B,
          due_date: OCCURRENCE,
          created_by: PARENT_B,
          routine_stack_id: STACK_B,
          routine: "Other household",
          routine_order: 1,
          frequency: "once",
          weekly_days: [],
        },
      ],
    });
  }

  async function existingDraft(
    stackId = STACK_A,
    choreId = CHORE_A,
  ): Promise<RoutineStackDraft> {
    const row = await db.chore.findUniqueOrThrow({ where: { id: choreId } });
    return {
      scope: "occurrence",
      family_id: FAMILY_A,
      stack_id: stackId,
      occurrence_date: OCCURRENCE_DATE,
      label: "Morning",
      steps: [
        {
          chore_id: choreId,
          assigned_to: row.assigned_to,
          assigned_member_id: row.assigned_member_id ?? null,
          due_date: OCCURRENCE_DATE,
          frequency: "once",
          difficulty: "medium",
          is_template: false,
        },
      ],
      remove_chore_ids: [],
      expected_fingerprint: fingerprintRoutineStackSnapshot([row]),
    };
  }

  function newDraft(
    label = "New routine",
    familyId = FAMILY_A,
    assignedTo = CHILD_A,
  ): RoutineStackDraft {
    return {
      scope: "occurrence",
      family_id: familyId,
      stack_id: null,
      occurrence_date: OCCURRENCE_DATE,
      label,
      steps: [
        {
          title: "Pack bag",
          description: null,
          assigned_to: assignedTo,
          assigned_member_id: null,
          due_date: OCCURRENCE_DATE,
          frequency: "once",
          difficulty: "easy",
          icon: null,
          is_template: false,
        },
      ],
      remove_chore_ids: [],
      expected_fingerprint: "",
    };
  }

  function largeCrossMemberDraft(): RoutineStackDraft {
    const assignees = [
      { userId: PARENT_A, memberId: MEMBER_PARENT_A },
      { userId: OTHER_PARENT_A, memberId: MEMBER_OTHER_PARENT_A },
      { userId: CHILD_A, memberId: MEMBER_CHILD_A },
    ];
    return {
      scope: "occurrence",
      family_id: FAMILY_A,
      stack_id: null,
      occurrence_date: OCCURRENCE_DATE,
      label: "Long cross-member routine",
      steps: Array.from({ length: 99 }, (_, index) => {
        const assignee = assignees[index % assignees.length];
        return {
          title: `Routine step ${String(index + 1).padStart(2, "0")}`,
          description: null,
          assigned_to: assignee.userId,
          assigned_member_id: assignee.memberId,
          due_date: OCCURRENCE_DATE,
          frequency: "once" as const,
          difficulty: "medium" as const,
          icon: null,
          is_template: false,
        };
      }),
      remove_chore_ids: [],
      expected_fingerprint: "",
    };
  }

  async function createReceipt(
    id: string,
    key: string,
    draft: RoutineStackDraft,
    responseStatus: number | null = null,
  ): Promise<void> {
    await db.idempotencyRecord.create({
      data: {
        id,
        scope: `user:${PARENT_A}`,
        key,
        family_id: FAMILY_A,
        user_id: PARENT_A,
        action: "routine-stack.mutate",
        request_hash: hashIdempotentRequest("routine-stack.mutate", draft),
        response_status: responseStatus,
        response_body: null,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  }

  beforeAll(async () => {
    db = await loadDatabase();
    accountDeletion = await import("@/lib/account-deletion");
    await runRoutineStackMigrationTwice();
    migrationVerified = true;
  });

  beforeEach(async () => {
    await cleanup();
    await seed();
  });

  afterAll(async () => {
    if (!db) return;
    await cleanup();
    if (typeof db.$disconnect === "function") await db.$disconnect();
  });

  it("applies the additive migration twice without changing the contract", () => {
    expect(migrationVerified).toBe(true);
  });

  it("anonymizes the erased routine creator and preserves another member's chore", async () => {
    const result = await accountDeletion.deleteMemberAccount(PARENT_A, {
      db,
      uploadDir: path.join(process.cwd(), ".tmp-routine-stack-integration"),
      removeFile: async () => undefined,
      revokeCalendarGrant: async () => undefined,
    });
    expect(result.deleted).toBe(true);
    const stack = await db.routineStack.findUniqueOrThrow({
      where: { id: STACK_A },
    });
    const chore = await db.chore.findUniqueOrThrow({ where: { id: CHORE_A } });
    expect(stack.created_by).toBeNull();
    expect(chore.created_by).toBe(OTHER_PARENT_A);
    expect(chore.assigned_to).toBe(CHILD_A);
    expect(await db.user.findUnique({ where: { id: PARENT_A } })).toBeNull();
  });

  it("deletes occurrence chores before their stack and then removes the household", async () => {
    const result = await accountDeletion.deleteHousehold(FAMILY_B, PARENT_B, {
      db,
      uploadDir: path.join(process.cwd(), ".tmp-routine-stack-integration"),
      removeFile: async () => undefined,
      revokeCalendarGrant: async () => undefined,
    });
    expect(result.deleted).toBe(true);
    expect(await db.chore.findUnique({ where: { id: CHORE_B } })).toBeNull();
    expect(
      await db.routineStack.findUnique({ where: { id: STACK_B } }),
    ).toBeNull();
    expect(await db.family.findUnique({ where: { id: FAMILY_B } })).toBeNull();
  });

  it("refuses cross-family, cross-stack, and empty-occurrence mutations without writes", async () => {
    const crossFamily = { ...(await existingDraft()), family_id: FAMILY_B };
    await expect(
      mutateRoutineStack(db, crossFamily, actorA),
    ).rejects.toMatchObject({
      status: 404,
    });

    const foreignDraft = {
      ...(await existingDraft()),
      steps: [
        {
          chore_id: CHORE_FOREIGN,
          assigned_to: CHILD_A,
          assigned_member_id: null,
          due_date: OCCURRENCE_DATE,
          frequency: "once" as const,
          difficulty: "medium" as const,
          is_template: false,
        },
      ],
      expected_fingerprint: fingerprintRoutineStackSnapshot([
        await db.chore.findUniqueOrThrow({ where: { id: CHORE_A } }),
      ]),
    };
    await expect(
      mutateRoutineStack(db, foreignDraft, actorA),
    ).rejects.toMatchObject({
      status: 409,
    });

    const emptyDraft = {
      ...(await existingDraft()),
      steps: [],
      remove_chore_ids: [CHORE_A],
    };
    await expect(
      mutateRoutineStack(db, emptyDraft, actorA),
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(
      await db.chore.findUniqueOrThrow({ where: { id: CHORE_A } }),
    ).toMatchObject({
      routine_stack_id: STACK_A,
    });
  });

  it("rejects removals from a new stack without changing a legacy chore", async () => {
    const label = `${PREFIX}-reject-remove`;
    await db.chore.create({
      data: {
        id: LEGACY_UNSTACKED,
        family_id: FAMILY_A,
        title: "Legacy unstacked step",
        assigned_to: CHILD_A,
        due_date: OCCURRENCE,
        created_by: PARENT_A,
        routine: "Legacy grouping",
        routine_order: 4,
        routine_stack_id: null,
        frequency: "once",
        weekly_days: [],
      },
    });

    try {
      const beforeChore = await db.chore.findUniqueOrThrow({
        where: { id: LEGACY_UNSTACKED },
      });
      const beforeChoreCount = await db.chore.count({
        where: { family_id: FAMILY_A },
      });
      const beforeStackCount = await db.routineStack.count({
        where: { family_id: FAMILY_A },
      });
      const beforeReceiptCount = await db.idempotencyRecord.count({
        where: { family_id: FAMILY_A },
      });

      await expect(
        mutateRoutineStack(
          db,
          {
            ...newDraft(label),
            remove_chore_ids: [LEGACY_UNSTACKED],
          },
          actorA,
        ),
      ).rejects.toMatchObject({
        status: 400,
        code: "ROUTINE_STACK_INVALID_DRAFT",
      });

      expect(
        await db.chore.findUniqueOrThrow({ where: { id: LEGACY_UNSTACKED } }),
      ).toEqual(beforeChore);
      expect(await db.chore.count({ where: { family_id: FAMILY_A } })).toBe(
        beforeChoreCount,
      );
      expect(
        await db.routineStack.count({ where: { family_id: FAMILY_A } }),
      ).toBe(beforeStackCount);
      expect(
        await db.idempotencyRecord.count({ where: { family_id: FAMILY_A } }),
      ).toBe(beforeReceiptCount);
    } finally {
      // Keep the fixture safe even if a pre-fix implementation unexpectedly
      // creates the new stack and step before the assertion fails.
      await db.chore.deleteMany({
        where: { family_id: FAMILY_A, routine: label },
      });
      await db.routineStack.deleteMany({
        where: { family_id: FAMILY_A, label },
      });
      await db.chore.deleteMany({
        where: { id: LEGACY_UNSTACKED, family_id: FAMILY_A },
      });
    }
  });

  it("stacks, reorders, and un-stacks a generated occurrence without changing its series history", async () => {
    const template = await db.chore.create({
      data: {
        id: RECURRING_TEMPLATE,
        family_id: FAMILY_A,
        title: "Water plants",
        assigned_to: CHILD_A,
        assigned_member_id: MEMBER_CHILD_A,
        due_date: new Date("2026-10-05T00:00:00.000Z"),
        created_by: PARENT_A,
        frequency: "weekly",
        weekly_days: [1],
        recurrence_id: RECURRING_TEMPLATE,
        is_template: true,
      },
    });
    const generated = await db.chore.create({
      data: {
        id: CHORE_RECURRING,
        family_id: FAMILY_A,
        title: "Water plants",
        assigned_to: CHILD_A,
        assigned_member_id: MEMBER_CHILD_A,
        due_date: OCCURRENCE,
        created_by: PARENT_A,
        points: 17,
        status: "verified",
        frequency: "once",
        weekly_days: [],
        recurrence_id: RECURRING_TEMPLATE,
        is_template: false,
        photo_url: "/uploads/routine-proof.jpg",
        photo_verified: true,
        verified_at: new Date("2026-10-12T09:00:00.000Z"),
        verified_notes: "Checked by parent",
        completed_at: new Date("2026-10-12T08:00:00.000Z"),
      },
    });
    const initialStackRow = await db.chore.findUniqueOrThrow({
      where: { id: CHORE_A },
    });

    await expect(
      mutateRoutineStack(
        db,
        {
          scope: "occurrence",
          family_id: FAMILY_A,
          stack_id: STACK_A,
          occurrence_date: OCCURRENCE_DATE,
          label: "Morning",
          steps: [
            {
              chore_id: CHORE_A,
              assigned_to: CHILD_A,
              assigned_member_id: initialStackRow.assigned_member_id ?? null,
              due_date: OCCURRENCE_DATE,
              frequency: "once",
              difficulty: "medium",
              is_template: false,
            },
            {
              chore_id: CHORE_RECURRING,
              assigned_to: CHILD_A,
              assigned_member_id: MEMBER_CHILD_A,
              due_date: OCCURRENCE_DATE,
              frequency: "once",
              difficulty: "medium",
              is_template: false,
            },
          ],
          remove_chore_ids: [],
          expected_fingerprint: fingerprintRoutineStackSnapshot([
            initialStackRow,
          ]),
        },
        actorA,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await db.chore.findUniqueOrThrow({ where: { id: CHORE_RECURRING } }),
    ).toMatchObject({ routine_stack_id: null });

    const stackDraft = (
      steps: RoutineStackDraft["steps"],
    ): RoutineStackDraft => ({
      scope: "occurrence",
      family_id: FAMILY_A,
      stack_id: STACK_A,
      occurrence_date: OCCURRENCE_DATE,
      label: "Morning",
      steps,
      remove_chore_ids: [],
      expected_fingerprint: fingerprintRoutineStackSnapshot([initialStackRow]),
    });
    const first = await mutateRoutineStack(
      db,
      stackDraft([
        {
          chore_id: CHORE_A,
          assigned_to: CHILD_A,
          assigned_member_id: initialStackRow.assigned_member_id ?? null,
          due_date: OCCURRENCE_DATE,
          frequency: "once",
          difficulty: "medium",
          is_template: false,
        },
        {
          chore_id: CHORE_RECURRING,
          assigned_to: CHILD_A,
          assigned_member_id: MEMBER_CHILD_A,
          due_date: OCCURRENCE_DATE,
          frequency: "once",
          difficulty: "medium",
          recurrence_id: RECURRING_TEMPLATE,
          is_template: false,
          expected_fingerprint: fingerprintRoutineStackSelectedStep({
            id: CHORE_RECURRING,
            family_id: FAMILY_A,
            assigned_to: CHILD_A,
            assigned_member_id: MEMBER_CHILD_A,
            member_subject_erased: false,
            due_date: OCCURRENCE,
            recurrence_id: RECURRING_TEMPLATE,
            is_template: false,
            routine: null,
            routine_order: null,
          }),
        },
      ]),
      actorA,
    );
    expect(first.status).toBe(200);

    const stackedRows = await db.chore.findMany({
      where: { id: { in: [CHORE_A, CHORE_RECURRING] } },
      orderBy: { routine_order: "asc" },
    });
    expect(stackedRows.map((row: Db) => row.id)).toEqual([
      CHORE_A,
      CHORE_RECURRING,
    ]);
    const stackedGenerated = await db.chore.findUniqueOrThrow({
      where: { id: CHORE_RECURRING },
    });
    expect(stackedGenerated).toMatchObject({
      recurrence_id: RECURRING_TEMPLATE,
      is_template: false,
      status: "verified",
      points: 17,
      photo_url: "/uploads/routine-proof.jpg",
      photo_verified: true,
      verified_notes: "Checked by parent",
      routine_stack_id: STACK_A,
    });
    expect(template).toMatchObject({
      id: RECURRING_TEMPLATE,
      recurrence_id: RECURRING_TEMPLATE,
      is_template: true,
      routine_stack_id: null,
    });

    const stackedFingerprint = fingerprintRoutineStackSnapshot(stackedRows);
    const reorderedSteps: RoutineStackDraft["steps"] = [
      {
        chore_id: CHORE_RECURRING,
        assigned_to: CHILD_A,
        assigned_member_id: MEMBER_CHILD_A,
        due_date: OCCURRENCE_DATE,
        frequency: "once",
        difficulty: "medium",
        recurrence_id: RECURRING_TEMPLATE,
        is_template: false,
      },
      {
        chore_id: CHORE_A,
        assigned_to: CHILD_A,
        assigned_member_id: initialStackRow.assigned_member_id ?? null,
        due_date: OCCURRENCE_DATE,
        frequency: "once",
        difficulty: "medium",
        is_template: false,
      },
    ];
    const reordered = await mutateRoutineStack(
      db,
      {
        ...stackDraft(reorderedSteps),
        expected_fingerprint: stackedFingerprint,
      },
      actorA,
    );
    expect(reordered.status).toBe(200);
    const reorderedRows = await db.chore.findMany({
      where: { id: { in: [CHORE_A, CHORE_RECURRING] } },
      orderBy: { routine_order: "asc" },
    });
    expect(reorderedRows.map((row: Db) => row.id)).toEqual([
      CHORE_RECURRING,
      CHORE_A,
    ]);

    const beforeMismatch = await db.chore.findMany({
      where: { id: { in: [CHORE_A, CHORE_RECURRING] } },
      orderBy: { id: "asc" },
    });
    await expect(
      mutateRoutineStack(
        db,
        {
          ...stackDraft(reorderedSteps),
          expected_fingerprint: fingerprintRoutineStackSnapshot(reorderedRows),
          steps: reorderedSteps.map((step) =>
            step.chore_id === CHORE_RECURRING
              ? { ...step, recurrence_id: `${RECURRING_TEMPLATE}-wrong` }
              : step,
          ),
        },
        actorA,
      ),
    ).rejects.toMatchObject({ status: 409 });
    const afterMismatch = await db.chore.findMany({
      where: { id: { in: [CHORE_A, CHORE_RECURRING] } },
      orderBy: { id: "asc" },
    });
    expect(afterMismatch).toEqual(beforeMismatch);

    const unstacked = await mutateRoutineStack(
      db,
      {
        ...stackDraft([reorderedSteps[1]!]),
        remove_chore_ids: [CHORE_RECURRING],
        expected_fingerprint: fingerprintRoutineStackSnapshot(reorderedRows),
      },
      actorA,
    );
    expect(unstacked.status).toBe(200);
    const finalGenerated = await db.chore.findUniqueOrThrow({
      where: { id: CHORE_RECURRING },
    });
    expect(finalGenerated).toMatchObject({
      recurrence_id: RECURRING_TEMPLATE,
      is_template: false,
      status: "verified",
      points: 17,
      photo_url: "/uploads/routine-proof.jpg",
      photo_verified: true,
      verified_notes: "Checked by parent",
      routine_stack_id: null,
      routine: null,
      routine_order: null,
    });
    expect(finalGenerated.verified_at).toEqual(
      new Date("2026-10-12T09:00:00.000Z"),
    );
    expect(finalGenerated.completed_at).toEqual(
      new Date("2026-10-12T08:00:00.000Z"),
    );
    const finalTemplate = await db.chore.findUniqueOrThrow({
      where: { id: RECURRING_TEMPLATE },
    });
    expect(finalTemplate).toMatchObject({
      id: RECURRING_TEMPLATE,
      recurrence_id: RECURRING_TEMPLATE,
      is_template: true,
      frequency: "weekly",
    });
  });

  it("round-trips a generated recurring occurrence through the parent API helpers", async () => {
    await db.chore.create({
      data: {
        id: RECURRING_TEMPLATE,
        family_id: FAMILY_A,
        title: "Water plants",
        assigned_to: CHILD_A,
        assigned_member_id: MEMBER_CHILD_A,
        due_date: new Date("2026-10-05T00:00:00.000Z"),
        created_by: PARENT_A,
        frequency: "weekly",
        weekly_days: [1],
        recurrence_id: RECURRING_TEMPLATE,
        is_template: true,
      },
    });
    await db.chore.create({
      data: {
        id: CHORE_RECURRING,
        family_id: FAMILY_A,
        title: "Water plants",
        assigned_to: CHILD_A,
        assigned_member_id: MEMBER_CHILD_A,
        due_date: OCCURRENCE,
        created_by: PARENT_A,
        frequency: "once",
        weekly_days: [],
        recurrence_id: RECURRING_TEMPLATE,
        is_template: false,
      },
    });
    const recurring = await db.chore.findUniqueOrThrow({
      where: { id: CHORE_RECURRING },
    });
    const draft: RoutineStackDraft = {
      scope: "occurrence",
      family_id: FAMILY_A,
      stack_id: null,
      occurrence_date: OCCURRENCE_DATE,
      label: "Recurring API routine",
      steps: [
        {
          chore_id: CHORE_RECURRING,
          assigned_to: CHILD_A,
          assigned_member_id: MEMBER_CHILD_A,
          due_date: OCCURRENCE_DATE,
          frequency: "once",
          difficulty: "medium",
          recurrence_id: RECURRING_TEMPLATE,
          is_template: false,
          expected_fingerprint: fingerprintRoutineStackSelectedStep({
            id: CHORE_RECURRING,
            family_id: FAMILY_A,
            assigned_to: CHILD_A,
            assigned_member_id: MEMBER_CHILD_A,
            member_subject_erased: false,
            due_date: OCCURRENCE,
            recurrence_id: RECURRING_TEMPLATE,
            is_template: false,
            routine: null,
            routine_order: null,
          }),
        },
      ],
      remove_chore_ids: [],
      expected_fingerprint: "",
    };

    const saved = await saveParentRoutineStack(
      db,
      draft,
      actorA,
      `${PREFIX}-api-recurring-roundtrip`,
    );
    expect(saved.status).toBe(200);
    const stackId = (saved.body as { stack_id?: string }).stack_id;
    expect(stackId).toEqual(expect.any(String));

    const read = await readParentRoutineStack(
      db,
      actorA,
      stackId!,
      OCCURRENCE_DATE,
    );
    expect(read).toMatchObject({
      occurrence_date: OCCURRENCE_DATE,
      steps: [
        expect.objectContaining({
          id: CHORE_RECURRING,
          recurrence_id: RECURRING_TEMPLATE,
          is_template: false,
          frequency: "once",
        }),
      ],
    });
    const persistedRows = await db.chore.findMany({
      where: {
        family_id: FAMILY_A,
        routine_stack_id: stackId,
        due_date: {
          gte: OCCURRENCE,
          lt: new Date("2026-10-13T00:00:00.000Z"),
        },
      },
    });
    expect(read?.fingerprint).toBe(
      fingerprintRoutineStackSnapshot(persistedRows),
    );
    expect(read?.compact.fingerprint).toBe(read?.fingerprint);
  });

  it("reads only eligible parent candidates and keeps account options privacy-safe", async () => {
    await db.user.createMany({
      data: [
        {
          id: CANDIDATE_LEGACY_USER,
          email: `${CANDIDATE_LEGACY_USER}@example.test`,
          name: "Legacy account",
          role: "child",
          family_id: FAMILY_A,
        },
        {
          id: CANDIDATE_ARCHIVED_USER,
          email: `${CANDIDATE_ARCHIVED_USER}@example.test`,
          name: "Archived account",
          role: "child",
          family_id: FAMILY_A,
        },
        {
          id: CANDIDATE_ERASED_USER,
          email: `${CANDIDATE_ERASED_USER}@example.test`,
          name: "Erased account",
          role: "child",
          family_id: FAMILY_A,
        },
      ],
    });
    await db.householdMember.createMany({
      data: [
        {
          id: CANDIDATE_ARCHIVED_MEMBER,
          family_id: FAMILY_A,
          name: "Archived subject",
          role: "child",
          archived_at: new Date("2026-10-01T00:00:00.000Z"),
        },
        {
          id: CANDIDATE_ERASED_MEMBER,
          family_id: FAMILY_A,
          name: "Erased subject",
          role: "child",
          archived_at: new Date("2026-10-02T00:00:00.000Z"),
          erasure_user_id: PARENT_A,
        },
        {
          id: CANDIDATE_DORMANT_MEMBER,
          family_id: FAMILY_A,
          name: "Dormant subject",
          role: "child",
        },
      ],
    });
    await db.householdMemberLegacyMapping.createMany({
      data: [
        {
          member_id: CANDIDATE_ARCHIVED_MEMBER,
          user_id: CANDIDATE_ARCHIVED_USER,
          family_id: FAMILY_A,
        },
        {
          member_id: CANDIDATE_ERASED_MEMBER,
          user_id: CANDIDATE_ERASED_USER,
          family_id: FAMILY_A,
        },
      ],
    });
    await db.chore.createMany({
      data: [
        {
          id: CANDIDATE_CANONICAL,
          family_id: FAMILY_A,
          title: "Canonical candidate",
          assigned_to: CHILD_A,
          assigned_member_id: MEMBER_CHILD_A,
          due_date: OCCURRENCE,
          created_by: PARENT_A,
          frequency: "once",
          weekly_days: [],
        },
        {
          id: CANDIDATE_LEGACY,
          family_id: FAMILY_A,
          title: "Legacy candidate",
          assigned_to: CANDIDATE_LEGACY_USER,
          assigned_member_id: null,
          due_date: OCCURRENCE,
          created_by: PARENT_A,
          frequency: "once",
          weekly_days: [],
        },
        {
          id: CANDIDATE_ARCHIVED,
          family_id: FAMILY_A,
          title: "Archived candidate",
          assigned_to: CANDIDATE_ARCHIVED_USER,
          assigned_member_id: CANDIDATE_ARCHIVED_MEMBER,
          due_date: OCCURRENCE,
          created_by: PARENT_A,
          frequency: "once",
          weekly_days: [],
        },
        {
          id: CANDIDATE_ERASED,
          family_id: FAMILY_A,
          title: "Erased candidate",
          assigned_to: CANDIDATE_ERASED_USER,
          assigned_member_id: null,
          member_subject_erased: true,
          due_date: OCCURRENCE,
          created_by: PARENT_A,
          frequency: "once",
          weekly_days: [],
        },
        {
          id: CANDIDATE_FOREIGN_ACCOUNT,
          family_id: FAMILY_A,
          title: "Foreign account candidate",
          assigned_to: PARENT_B,
          assigned_member_id: null,
          due_date: OCCURRENCE,
          created_by: PARENT_A,
          frequency: "once",
          weekly_days: [],
        },
        {
          id: CANDIDATE_ORPHAN,
          family_id: FAMILY_A,
          title: "Orphan candidate",
          assigned_to: CHILD_A,
          assigned_member_id: MEMBER_CHILD_A,
          due_date: OCCURRENCE,
          created_by: PARENT_A,
          recurrence_id: `${PREFIX}-missing-anchor`,
          frequency: "once",
          weekly_days: [],
        },
        {
          id: CANDIDATE_TEMPLATE,
          family_id: FAMILY_A,
          title: "Template candidate",
          assigned_to: CHILD_A,
          assigned_member_id: MEMBER_CHILD_A,
          due_date: OCCURRENCE,
          created_by: PARENT_A,
          recurrence_id: CANDIDATE_TEMPLATE,
          is_template: true,
          frequency: "weekly",
          weekly_days: [1],
        },
      ],
    });
    // Profile-only/dormant assignments are rejected by the canonical subject
    // trigger before they can enter this catalog. Keep that impossible shape
    // as an explicit no-write assertion instead of disabling the constraint.
    await expect(
      db.chore.create({
        data: {
          id: CANDIDATE_DORMANT,
          family_id: FAMILY_A,
          title: "Dormant candidate",
          assigned_to: CHILD_A,
          assigned_member_id: CANDIDATE_DORMANT_MEMBER,
          due_date: OCCURRENCE,
          created_by: PARENT_A,
          frequency: "once",
          weekly_days: [],
        },
      }),
    ).rejects.toThrow(
      "chore member subject needs explicit account reconciliation",
    );
    expect(
      await db.chore.findUnique({ where: { id: CANDIDATE_DORMANT } }),
    ).toBeNull();

    const result = await readParentRoutineStackCandidates(
      db,
      actorA,
      OCCURRENCE_DATE,
      { limit: 200 },
    );

    expect(result).toMatchObject({
      occurrence_date: OCCURRENCE_DATE,
      hasMore: false,
      nextCursor: null,
    });
    expect(result?.candidates.map((candidate) => candidate.id)).toEqual([
      CANDIDATE_CANONICAL,
      CANDIDATE_LEGACY,
    ]);
    expect(result?.assignmentOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: CHILD_A, role: "child" }),
        expect.objectContaining({
          accountId: CANDIDATE_LEGACY_USER,
          name: "Legacy account",
          role: "child",
        }),
      ]),
    );
    expect(result?.assignmentOptions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: CANDIDATE_ARCHIVED_USER }),
        expect.objectContaining({ accountId: CANDIDATE_ERASED_USER }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain("@example.test");
    expect(JSON.stringify(result)).not.toContain("archived_at");
  });

  it("walks the raw candidate page without duplicates or a false complete catalog", async () => {
    const ids = Array.from(
      { length: 201 },
      (_, index) =>
        `${PREFIX}-candidate-page-${String(index).padStart(3, "0")}`,
    );
    await db.chore.createMany({
      data: ids.map((id) => ({
        id,
        family_id: FAMILY_A,
        title: `Paged candidate ${id.slice(-3)}`,
        assigned_to: CHILD_A,
        assigned_member_id: MEMBER_CHILD_A,
        due_date: OCCURRENCE,
        created_by: PARENT_A,
        frequency: "once",
        weekly_days: [],
      })),
    });

    const first = await readParentRoutineStackCandidates(
      db,
      actorA,
      OCCURRENCE_DATE,
      { limit: 200 },
    );
    expect(first?.candidates).toHaveLength(200);
    expect(first?.hasMore).toBe(true);
    expect(first?.nextCursor).toEqual(expect.any(String));

    const cursor = decodeChoreCursor(first?.nextCursor ?? "");
    expect(cursor).toEqual({
      dueDate: OCCURRENCE,
      id: ids[199],
    });
    const second = await readParentRoutineStackCandidates(
      db,
      actorA,
      OCCURRENCE_DATE,
      { limit: 200, cursor },
    );
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
    expect(second?.candidates).toHaveLength(1);
    expect(second?.candidates[0]?.id).toBe(ids[200]);
    expect(
      new Set([
        ...(first?.candidates.map((candidate) => candidate.id) ?? []),
        ...(second?.candidates.map((candidate) => candidate.id) ?? []),
      ]),
    ).toEqual(new Set(ids));
  });

  it("rejects a candidate save when its unstacked assignment changed after the read", async () => {
    await db.chore.create({
      data: {
        id: CANDIDATE_CANONICAL,
        family_id: FAMILY_A,
        title: "Concurrent candidate",
        assigned_to: CHILD_A,
        assigned_member_id: MEMBER_CHILD_A,
        due_date: OCCURRENCE,
        created_by: PARENT_A,
        frequency: "once",
        weekly_days: [],
      },
    });
    const catalog = await readParentRoutineStackCandidates(
      db,
      actorA,
      OCCURRENCE_DATE,
    );
    const candidate = catalog?.candidates.find(
      (row) => row.id === CANDIDATE_CANONICAL,
    );
    expect(candidate?.expected_fingerprint).toEqual(expect.any(String));
    await db.chore.update({
      where: { id: CANDIDATE_CANONICAL },
      data: {
        assigned_to: OTHER_PARENT_A,
        assigned_member_id: MEMBER_OTHER_PARENT_A,
      },
    });

    await expect(
      saveParentRoutineStack(
        db,
        {
          scope: "occurrence",
          family_id: FAMILY_A,
          stack_id: null,
          occurrence_date: OCCURRENCE_DATE,
          label: "Concurrent candidate routine",
          steps: [
            {
              chore_id: CANDIDATE_CANONICAL,
              assigned_to: CHILD_A,
              assigned_member_id: MEMBER_CHILD_A,
              due_date: OCCURRENCE_DATE,
              frequency: "once",
              difficulty: "medium",
              expected_fingerprint: candidate!.expected_fingerprint,
              is_template: false,
            },
          ],
          remove_chore_ids: [],
          expected_fingerprint: "",
        },
        actorA,
        `${PREFIX}-candidate-concurrent-save`,
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "ROUTINE_STACK_CONFLICT",
    });
    expect(
      await db.chore.findUniqueOrThrow({
        where: { id: CANDIDATE_CANONICAL },
      }),
    ).toMatchObject({
      assigned_to: OTHER_PARENT_A,
      assigned_member_id: MEMBER_OTHER_PARENT_A,
      routine_stack_id: null,
    });
    expect(
      await db.routineStack.findMany({
        where: { family_id: FAMILY_A, label: "Concurrent candidate routine" },
      }),
    ).toHaveLength(0);
  });

  it("creates a first stack from a candidate and round-trips assignment and series identity", async () => {
    await db.chore.createMany({
      data: [
        {
          id: RECURRING_TEMPLATE,
          family_id: FAMILY_A,
          title: "Pack lunch",
          assigned_to: CHILD_A,
          assigned_member_id: MEMBER_CHILD_A,
          due_date: new Date("2026-10-05T00:00:00.000Z"),
          created_by: PARENT_A,
          recurrence_id: RECURRING_TEMPLATE,
          is_template: true,
          frequency: "weekly",
          weekly_days: [1],
        },
        {
          id: CHORE_RECURRING,
          family_id: FAMILY_A,
          title: "Pack lunch",
          assigned_to: CHILD_A,
          assigned_member_id: MEMBER_CHILD_A,
          due_date: OCCURRENCE,
          created_by: PARENT_A,
          recurrence_id: RECURRING_TEMPLATE,
          is_template: false,
          frequency: "once",
          weekly_days: [],
        },
      ],
    });
    const catalog = await readParentRoutineStackCandidates(
      db,
      actorA,
      OCCURRENCE_DATE,
    );
    const candidate = catalog?.candidates.find(
      (row) => row.id === CHORE_RECURRING,
    );
    expect(candidate).toMatchObject({
      assigned_to: CHILD_A,
      assigned_member_id: MEMBER_CHILD_A,
      recurrence_id: RECURRING_TEMPLATE,
      is_template: false,
    });

    const saved = await saveParentRoutineStack(
      db,
      {
        scope: "occurrence",
        family_id: FAMILY_A,
        stack_id: null,
        occurrence_date: OCCURRENCE_DATE,
        label: "School morning",
        steps: [
          {
            chore_id: CHORE_RECURRING,
            assigned_to: candidate!.assigned_to,
            assigned_member_id: candidate!.assigned_member_id,
            due_date: OCCURRENCE_DATE,
            frequency: candidate!.frequency as "once",
            difficulty: candidate!.difficulty ?? "medium",
            recurrence_id: candidate!.recurrence_id ?? undefined,
            is_template: false,
            expected_fingerprint: candidate!.expected_fingerprint,
          },
        ],
        remove_chore_ids: [],
        expected_fingerprint: "",
      },
      actorA,
      `${PREFIX}-api-candidate-first-stack`,
    );
    expect(saved.status).toBe(200);
    const stackId = (saved.body as { stack_id?: string }).stack_id;
    expect(stackId).toEqual(expect.any(String));

    const fresh = await readParentRoutineStack(
      db,
      actorA,
      stackId!,
      OCCURRENCE_DATE,
    );
    expect(fresh).toMatchObject({
      occurrence_date: OCCURRENCE_DATE,
      fingerprint: expect.any(String),
      compact: { fingerprint: expect.any(String) },
      steps: [
        expect.objectContaining({
          id: CHORE_RECURRING,
          assigned_to: CHILD_A,
          assigned_member_id: MEMBER_CHILD_A,
          recurrence_id: RECURRING_TEMPLATE,
          is_template: false,
        }),
      ],
    });
    expect(fresh?.compact.fingerprint).toBe(fresh?.fingerprint);
    expect(
      await db.chore.findUniqueOrThrow({ where: { id: CHORE_RECURRING } }),
    ).toMatchObject({
      routine_stack_id: stackId,
      assigned_to: CHILD_A,
      assigned_member_id: MEMBER_CHILD_A,
      recurrence_id: RECURRING_TEMPLATE,
    });
  });

  it("accepts stopped anchors and legacy null-series rows, but rejects orphaned and foreign series ids", async () => {
    await db.chore.createMany({
      data: [
        {
          id: STOPPED_ANCHOR,
          family_id: FAMILY_A,
          title: "Stopped series",
          assigned_to: CHILD_A,
          assigned_member_id: MEMBER_CHILD_A,
          due_date: OCCURRENCE,
          created_by: PARENT_A,
          frequency: "once",
          weekly_days: [],
          recurrence_id: STOPPED_ANCHOR,
          is_template: false,
          status: "completed",
        },
        {
          id: LEGACY_OCCURRENCE,
          family_id: FAMILY_A,
          title: "Legacy recurring row",
          assigned_to: CHILD_A,
          assigned_member_id: MEMBER_CHILD_A,
          due_date: OCCURRENCE,
          created_by: PARENT_A,
          frequency: "weekly",
          weekly_days: [1],
          recurrence_id: null,
          is_template: false,
        },
        {
          id: ORPHAN_OCCURRENCE,
          family_id: FAMILY_A,
          title: "Orphaned series row",
          assigned_to: CHILD_A,
          assigned_member_id: MEMBER_CHILD_A,
          due_date: OCCURRENCE,
          created_by: PARENT_A,
          frequency: "once",
          weekly_days: [],
          recurrence_id: `${PREFIX}-missing-series`,
          is_template: false,
        },
        {
          id: FOREIGN_OCCURRENCE,
          family_id: FAMILY_A,
          title: "Foreign series row",
          assigned_to: CHILD_A,
          assigned_member_id: MEMBER_CHILD_A,
          due_date: OCCURRENCE,
          created_by: PARENT_A,
          frequency: "once",
          weekly_days: [],
          recurrence_id: FOREIGN_ANCHOR,
          is_template: false,
        },
        {
          id: FOREIGN_ANCHOR,
          family_id: FAMILY_B,
          title: "Other household series",
          assigned_to: PARENT_B,
          due_date: new Date("2026-10-05T00:00:00.000Z"),
          created_by: PARENT_B,
          frequency: "weekly",
          weekly_days: [1],
          recurrence_id: FOREIGN_ANCHOR,
          is_template: true,
        },
        {
          id: MALFORMED_ANCHOR,
          family_id: FAMILY_A,
          title: "Malformed stopped series",
          assigned_to: CHILD_A,
          assigned_member_id: MEMBER_CHILD_A,
          due_date: new Date("2026-10-05T00:00:00.000Z"),
          created_by: PARENT_A,
          frequency: "weekly",
          weekly_days: [1],
          recurrence_id: MALFORMED_ANCHOR,
          is_template: false,
        },
        {
          id: MALFORMED_OCCURRENCE,
          family_id: FAMILY_A,
          title: "Malformed series row",
          assigned_to: CHILD_A,
          assigned_member_id: MEMBER_CHILD_A,
          due_date: OCCURRENCE,
          created_by: PARENT_A,
          frequency: "once",
          weekly_days: [],
          recurrence_id: MALFORMED_ANCHOR,
          is_template: false,
        },
        {
          id: EMPTY_OCCURRENCE,
          family_id: FAMILY_A,
          title: "Empty series row",
          assigned_to: CHILD_A,
          assigned_member_id: MEMBER_CHILD_A,
          due_date: OCCURRENCE,
          created_by: PARENT_A,
          frequency: "once",
          weekly_days: [],
          recurrence_id: "",
          is_template: false,
        },
      ],
    });

    const stoppedAndLegacy = await mutateRoutineStack(
      db,
      {
        scope: "occurrence",
        family_id: FAMILY_A,
        stack_id: null,
        occurrence_date: OCCURRENCE_DATE,
        label: "Compatibility routine",
        steps: [
          {
            chore_id: STOPPED_ANCHOR,
            assigned_to: CHILD_A,
            assigned_member_id: MEMBER_CHILD_A,
            due_date: OCCURRENCE_DATE,
            frequency: "once",
            difficulty: "medium",
            recurrence_id: STOPPED_ANCHOR,
            is_template: false,
            expected_fingerprint: fingerprintRoutineStackSelectedStep({
              id: STOPPED_ANCHOR,
              family_id: FAMILY_A,
              assigned_to: CHILD_A,
              assigned_member_id: MEMBER_CHILD_A,
              member_subject_erased: false,
              due_date: OCCURRENCE,
              recurrence_id: STOPPED_ANCHOR,
              is_template: false,
              routine: null,
              routine_order: null,
            }),
          },
          {
            chore_id: LEGACY_OCCURRENCE,
            assigned_to: CHILD_A,
            assigned_member_id: MEMBER_CHILD_A,
            due_date: OCCURRENCE_DATE,
            frequency: "weekly",
            weekly_days: [1],
            difficulty: "medium",
            is_template: false,
            expected_fingerprint: fingerprintRoutineStackSelectedStep({
              id: LEGACY_OCCURRENCE,
              family_id: FAMILY_A,
              assigned_to: CHILD_A,
              assigned_member_id: MEMBER_CHILD_A,
              member_subject_erased: false,
              due_date: OCCURRENCE,
              recurrence_id: null,
              is_template: false,
              routine: null,
              routine_order: null,
            }),
          },
        ],
        remove_chore_ids: [],
        expected_fingerprint: "",
      },
      actorA,
    );
    expect(stoppedAndLegacy.status).toBe(200);
    expect(
      await db.chore.findMany({
        where: { id: { in: [STOPPED_ANCHOR, LEGACY_OCCURRENCE] } },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: STOPPED_ANCHOR,
          recurrence_id: STOPPED_ANCHOR,
          is_template: false,
          routine_stack_id: expect.any(String),
        }),
        expect.objectContaining({
          id: LEGACY_OCCURRENCE,
          recurrence_id: null,
          frequency: "weekly",
          routine_stack_id: expect.any(String),
        }),
      ]),
    );

    for (const { id, submittedRecurrenceId } of [
      {
        id: ORPHAN_OCCURRENCE,
        submittedRecurrenceId: `${PREFIX}-missing-series`,
      },
      { id: FOREIGN_OCCURRENCE, submittedRecurrenceId: FOREIGN_ANCHOR },
      {
        id: MALFORMED_OCCURRENCE,
        submittedRecurrenceId: MALFORMED_ANCHOR,
      },
      { id: EMPTY_OCCURRENCE, submittedRecurrenceId: undefined },
    ] as const) {
      await expect(
        mutateRoutineStack(
          db,
          {
            scope: "occurrence",
            family_id: FAMILY_A,
            stack_id: null,
            occurrence_date: OCCURRENCE_DATE,
            label: "Rejected routine",
            steps: [
              {
                chore_id: id,
                assigned_to: CHILD_A,
                assigned_member_id: MEMBER_CHILD_A,
                due_date: OCCURRENCE_DATE,
                frequency: "once",
                difficulty: "medium",
                is_template: false,
                ...(submittedRecurrenceId === undefined
                  ? {}
                  : { recurrence_id: submittedRecurrenceId }),
              },
            ],
            remove_chore_ids: [],
            expected_fingerprint: "",
          },
          actorA,
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(await db.chore.findUniqueOrThrow({ where: { id } })).toMatchObject(
        {
          routine_stack_id: null,
        },
      );
    }
  });

  it("accepts the compact 99-step UTF-8 response within the replay cap", () => {
    const assignees = [PARENT_A, OTHER_PARENT_A, CHILD_A];
    const memberIds = [MEMBER_PARENT_A, MEMBER_OTHER_PARENT_A, MEMBER_CHILD_A];
    const body = projectRoutineStackResponse({
      stack_id: STACK_A,
      version: 1,
      fingerprint: "f".repeat(64),
      steps: Array.from({ length: 99 }, (_, index) => ({
        id: `${PREFIX}-chore-${String(index + 1).padStart(3, "0")}`,
        assigned_to: assignees[index % assignees.length]!,
        assigned_member_id: memberIds[index % memberIds.length]!,
      })),
      members: memberIds.map((id) => ({
        id,
        role: "child",
      })),
    });
    expect(body.steps).toHaveLength(99);
    expect(body.assignments).toHaveLength(3);
    expect(routineStackResponseByteLength(body)).toBeLessThanOrEqual(8192);
  });

  it("persists and replays a realistic 99-step cross-member mutation", async () => {
    const input = largeCrossMemberDraft();
    const draft = normalizeRoutineStackDraft(input);
    const receiptId = `${PREFIX}-receipt-99`;
    await createReceipt(receiptId, `${PREFIX}-key-99`, draft);
    const members = [
      { id: MEMBER_PARENT_A, role: "parent" },
      { id: MEMBER_OTHER_PARENT_A, role: "parent" },
      { id: MEMBER_CHILD_A, role: "child" },
    ];

    const first = await mutateRoutineStack(db, input, actorA, {
      recordId: receiptId,
      memberDictionary: members,
    });
    expect(first.status).toBe(200);
    expect(first.replayed).toBeUndefined();
    const firstBody = first.body as {
      steps: readonly unknown[];
      assignments: readonly unknown[];
    };
    expect(firstBody.steps).toHaveLength(99);
    expect(firstBody.assignments).toHaveLength(3);
    expect(routineStackResponseByteLength(first.body)).toBeLessThanOrEqual(
      8192,
    );

    const persisted = await db.idempotencyRecord.findUniqueOrThrow({
      where: { id: receiptId },
    });
    expect(persisted.response_status).toBe(200);
    expect(persisted.response_body).toEqual(first.body);
    expect(
      await db.routineStack.count({ where: { family_id: FAMILY_A } }),
    ).toBe(3);
    expect(await db.chore.count({ where: { family_id: FAMILY_A } })).toBe(101);
    expect(
      await db.chore.count({
        where: {
          family_id: FAMILY_A,
          routine_stack_id: (first.body as { stack_id: string }).stack_id,
        },
      }),
    ).toBe(99);
    const assignedMemberIds = await db.chore.findMany({
      where: {
        family_id: FAMILY_A,
        routine_stack_id: (first.body as { stack_id: string }).stack_id,
      },
      select: { assigned_to: true, assigned_member_id: true },
      orderBy: { routine_order: "asc" },
    });
    expect(
      new Set(assignedMemberIds.map((row: Db) => row.assigned_to)),
    ).toEqual(new Set([PARENT_A, OTHER_PARENT_A, CHILD_A]));
    expect(
      new Set(assignedMemberIds.map((row: Db) => row.assigned_member_id)),
    ).toEqual(
      new Set([MEMBER_PARENT_A, MEMBER_OTHER_PARENT_A, MEMBER_CHILD_A]),
    );

    const replay = await mutateRoutineStack(db, input, actorA, {
      recordId: receiptId,
      memberDictionary: members,
    });
    expect(replay).toEqual({ status: 200, body: first.body, replayed: true });
    expect(await db.chore.count({ where: { family_id: FAMILY_A } })).toBe(101);
  });

  it("serializes same-key writes, replays a lost response, and rejects changed payload reuse", async () => {
    const draft = newDraft();
    // The coordinator hashes its normalized draft. Keep the pre-created
    // receipt identical to that canonical payload so the concurrent replay
    // assertion exercises locking rather than a fixture hash mismatch.
    const normalized = normalizeRoutineStackDraft(draft);
    const receiptId = `${PREFIX}-receipt-concurrent`;
    await createReceipt(receiptId, `${PREFIX}-key-concurrent`, normalized);

    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        mutateRoutineStack(db, normalized, actorA, { recordId: receiptId }),
      ),
    );
    expect(
      responses.filter((response) => response.status === 200),
    ).toHaveLength(4);
    expect(responses.filter((response) => response.replayed)).toHaveLength(3);
    expect(
      await db.routineStack.count({ where: { family_id: FAMILY_A } }),
    ).toBe(3);
    expect(await db.chore.count({ where: { family_id: FAMILY_A } })).toBe(3);

    const replay = await mutateRoutineStack(db, normalized, actorA, {
      recordId: receiptId,
    });
    expect(replay).toMatchObject({ status: 200, replayed: true });

    const changedPayload = { ...normalized, label: "Changed payload" };
    const changed = await mutateRoutineStack(db, changedPayload, actorA, {
      recordId: receiptId,
    });
    expect(changed).toMatchObject({ status: 422 });
    expect(
      await db.routineStack.count({ where: { family_id: FAMILY_A } }),
    ).toBe(3);
  });

  it("rolls back writes after a forced post-write failure and detects fingerprint conflicts", async () => {
    const beforeStacks = await db.routineStack.count({
      where: { family_id: FAMILY_A },
    });
    const draft = newDraft("Rollback routine");
    await expect(
      db.$transaction(async (tx: unknown) => {
        const result = await mutateRoutineStackInTx(
          tx as object,
          draft,
          actorA,
        );
        expect(result.status).toBe(200);
        throw new Error("forced response-loss rollback");
      }),
    ).rejects.toThrow("forced response-loss rollback");
    expect(
      await db.routineStack.count({ where: { family_id: FAMILY_A } }),
    ).toBe(beforeStacks);
    expect(await db.chore.count({ where: { family_id: FAMILY_A } })).toBe(2);

    const current = await existingDraft();
    await db.chore.update({ where: { id: CHORE_A }, data: { points: 37 } });
    await expect(mutateRoutineStack(db, current, actorA)).rejects.toMatchObject(
      {
        status: 409,
      },
    );
    expect(
      await db.chore.findUniqueOrThrow({ where: { id: CHORE_A } }),
    ).toMatchObject({
      points: 37,
      routine_stack_id: STACK_A,
    });
  });

  it("reads a parent routine with eligible, archived, erased, and dormant members only from its household", async () => {
    await db.householdMember.createMany({
      data: [
        {
          id: MEMBER_DORMANT_A,
          family_id: FAMILY_A,
          name: "Dormant profile",
          role: "child",
        },
        {
          id: MEMBER_ARCHIVED_A,
          family_id: FAMILY_A,
          name: "Archived profile",
          role: "child",
          archived_at: new Date("2026-10-01T00:00:00.000Z"),
        },
        {
          id: MEMBER_ERASED_A,
          family_id: FAMILY_A,
          name: "Erased profile",
          role: "child",
          archived_at: new Date("2026-10-02T00:00:00.000Z"),
          erasure_user_id: PARENT_A,
        },
      ],
    });

    const parent = await readParentRoutineStack(
      db,
      { ...actorA, role: "parent" },
      STACK_A,
      OCCURRENCE_DATE,
    );

    expect(parent).toMatchObject({
      stack: { id: STACK_A, family_id: FAMILY_A, label: "Morning" },
      occurrence_date: OCCURRENCE_DATE,
      steps: [expect.objectContaining({ id: CHORE_A })],
    });
    expect(parent?.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: MEMBER_CHILD_A,
          subjectState: "eligible",
        }),
        expect.objectContaining({
          id: MEMBER_ARCHIVED_A,
          subjectState: "archived",
        }),
        expect.objectContaining({
          id: MEMBER_ERASED_A,
          subjectState: "erased",
        }),
        expect.objectContaining({
          id: MEMBER_DORMANT_A,
          subjectState: "dormant",
        }),
      ]),
    );
    expect(
      parent?.members.every((member) => member.id.startsWith(PREFIX)),
    ).toBe(true);
    expect(
      parent?.members.some((member) => member.id === MEMBER_PARENT_B),
    ).toBe(false);
    expect(JSON.stringify(parent)).not.toContain("erasure_user_id");
    expect(JSON.stringify(parent)).not.toContain("@example.test");

    await expect(
      readParentRoutineStack(db, actorA, STACK_B, OCCURRENCE_DATE),
    ).resolves.toBeNull();
    await expect(
      readParentRoutineStack(db, actorB, STACK_B, OCCURRENCE_DATE),
    ).resolves.toMatchObject({
      stack: { id: STACK_B, family_id: FAMILY_B },
      steps: [expect.objectContaining({ id: CHORE_B })],
    });
  });

  it("atomically saves, replays, and rejects changed receipt payloads per household", async () => {
    const draft = newDraft("API morning routine");
    const key = `${PREFIX}-api-save-a`;
    const first = await saveParentRoutineStack(db, draft, actorA, key);

    expect(first.status).toBe(200);
    expect(first.replayed).toBeUndefined();
    const firstBody = first.body as { stack_id: string };
    expect(firstBody.stack_id).toBeTruthy();

    const receipt = await db.idempotencyRecord.findFirstOrThrow({
      where: { scope: `user:${PARENT_A}`, key },
    });
    expect(receipt).toMatchObject({
      family_id: FAMILY_A,
      user_id: PARENT_A,
      action: "routine-stack.mutate",
      response_status: 200,
      response_body: first.body,
    });
    expect(
      await db.routineStack.count({ where: { family_id: FAMILY_A } }),
    ).toBe(3);
    expect(await db.chore.count({ where: { family_id: FAMILY_A } })).toBe(3);

    const replay = await saveParentRoutineStack(db, draft, actorA, key);
    expect(replay).toEqual({ status: 200, body: first.body, replayed: true });
    expect(
      await db.routineStack.count({ where: { family_id: FAMILY_A } }),
    ).toBe(3);
    expect(await db.chore.count({ where: { family_id: FAMILY_A } })).toBe(3);

    const changed = await saveParentRoutineStack(
      db,
      { ...draft, label: "Changed payload" },
      actorA,
      key,
    );
    expect(changed).toMatchObject({
      status: 422,
      body: { error: { code: "IDEMPOTENCY_KEY_REUSED" } },
    });
    expect(
      await db.routineStack.count({ where: { family_id: FAMILY_A } }),
    ).toBe(3);
    expect(await db.chore.count({ where: { family_id: FAMILY_A } })).toBe(3);

    const familyB = await saveParentRoutineStack(
      db,
      newDraft("Other household routine", FAMILY_B, PARENT_B),
      actorB,
      `${PREFIX}-api-save-b`,
    );
    expect(familyB.status).toBe(200);
    expect(
      await db.routineStack.count({ where: { family_id: FAMILY_B } }),
    ).toBe(2);
    expect(await db.chore.count({ where: { family_id: FAMILY_B } })).toBe(2);
    await expect(
      readParentRoutineStack(
        db,
        actorA,
        (familyB.body as { stack_id: string }).stack_id,
        OCCURRENCE_DATE,
      ),
    ).resolves.toBeNull();
  });

  it("rereads the current role before creating a receipt", async () => {
    const receiptsBefore = await db.idempotencyRecord.count({
      where: { family_id: FAMILY_A },
    });
    const staleParent = {
      ...actorA,
      role: "parent",
      userId: CHILD_A,
    };

    const result = await saveParentRoutineStack(
      db,
      newDraft("Stale role routine"),
      staleParent,
      `${PREFIX}-api-stale-role`,
    );

    expect(result).toMatchObject({
      status: 403,
      body: { error: { code: "FORBIDDEN" } },
    });
    expect(
      await db.idempotencyRecord.count({ where: { family_id: FAMILY_A } }),
    ).toBe(receiptsBefore);
    expect(
      await db.routineStack.count({ where: { family_id: FAMILY_A } }),
    ).toBe(2);
    expect(await db.chore.count({ where: { family_id: FAMILY_A } })).toBe(2);
  });
});
