import { readParentRoutineStackCandidates } from "@/lib/routine-stack-api";
import { fingerprintRoutineStackSelectedStep } from "@/lib/routine-stack";

const actor = { familyId: "family-a", userId: "parent-a", role: "parent" };
const date = "2026-10-11";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "chore-good",
    title: "Brush teeth",
    description: "Use the blue timer",
    assigned_to: "user-good",
    assigned_member_id: "member-good",
    member_subject_erased: false,
    due_date: new Date(`${date}T00:00:00.000Z`),
    recurrence_id: null,
    is_template: false,
    routine: null,
    routine_order: null,
    status: "pending",
    frequency: "once",
    weekly_days: [],
    difficulty: "easy",
    icon: "brush-teeth",
    routine_stack_id: null,
    ...overrides,
  };
}

function db() {
  return {
    user: { findMany: jest.fn() },
    householdMember: { findMany: jest.fn() },
    householdMemberLegacyMapping: { findMany: jest.fn() },
    householdMemberAccountLink: { findMany: jest.fn() },
    chore: { findMany: jest.fn() },
  };
}

function setup(
  database: ReturnType<typeof db>,
  rows: Array<Record<string, unknown>> = [row()],
) {
  database.user.findMany.mockResolvedValue([
    { id: "user-good", name: "Good", role: "child" },
    { id: "user-unmapped", name: "Unmapped", role: "parent" },
    { id: "user-archived", name: "Archived", role: "child" },
    { id: "user-foreign", name: "Foreign", role: "teen" },
  ]);
  database.householdMember.findMany.mockResolvedValue([
    { id: "member-good", archived_at: null, erasure_user_id: null },
    {
      id: "member-archived",
      archived_at: new Date("2026-01-01T00:00:00.000Z"),
      erasure_user_id: null,
    },
    { id: "member-dormant", archived_at: null, erasure_user_id: null },
  ]);
  database.householdMemberLegacyMapping.findMany.mockResolvedValue([
    { user_id: "user-good", member_id: "member-good", family_id: "family-a" },
    {
      user_id: "user-archived",
      member_id: "member-archived",
      family_id: "family-a",
    },
    {
      user_id: "user-foreign",
      member_id: "member-b",
      family_id: "family-b",
    },
  ]);
  database.householdMemberAccountLink.findMany.mockResolvedValue([]);
  database.chore.findMany.mockImplementation(
    async (args: { where?: { id?: unknown } }) => (args.where?.id ? [] : rows),
  );
}

describe("readParentRoutineStackCandidates", () => {
  it("returns only eligible, unstacked current rows and account options", async () => {
    const database = db();
    setup(database, [
      row(),
      row({
        id: "chore-unmapped",
        assigned_to: "user-unmapped",
        assigned_member_id: null,
      }),
      row({ id: "chore-stacked", routine_stack_id: "stack-a" }),
      row({ id: "chore-template", is_template: true }),
      row({ id: "chore-erased", member_subject_erased: true }),
      row({
        id: "chore-archived",
        assigned_to: "user-archived",
        assigned_member_id: "member-archived",
      }),
      row({ id: "chore-dormant", assigned_member_id: "member-dormant" }),
      row({
        id: "chore-foreign",
        assigned_to: "user-foreign",
        assigned_member_id: null,
      }),
      row({ id: "chore-mismatched", assigned_member_id: "member-dormant" }),
    ]);

    const result = await readParentRoutineStackCandidates(
      database,
      actor,
      date,
    );

    expect(result?.candidates.map((candidate) => candidate.id)).toEqual([
      "chore-good",
      "chore-unmapped",
    ]);
    expect(result?.assignmentOptions).toEqual([
      { accountId: "user-good", name: "Good", role: "child" },
      { accountId: "user-unmapped", name: "Unmapped", role: "parent" },
    ]);
    expect(result?.candidates[0]?.expected_fingerprint).toBe(
      fingerprintRoutineStackSelectedStep({
        id: "chore-good",
        family_id: "family-a",
        assigned_to: "user-good",
        assigned_member_id: "member-good",
        member_subject_erased: false,
        due_date: new Date(`${date}T00:00:00.000Z`),
        recurrence_id: null,
        is_template: false,
        routine: null,
        routine_order: null,
      }),
    );
    expect(JSON.stringify(result)).not.toContain("email");
    expect(JSON.stringify(result)).not.toContain("member-archived");
    expect(JSON.stringify(result)).not.toContain("member-dormant");
    expect(database.chore.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          family_id: "family-a",
          routine_stack_id: null,
          is_template: false,
          due_date: {
            gte: new Date(`${date}T00:00:00.000Z`),
            lt: new Date("2026-10-12T00:00:00.000Z"),
          },
        }),
        take: 201,
      }),
    );
  });

  it("exposes eligible email-free profile rows only for protocol 2", async () => {
    const previousEnabled = process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED;
    const previousRollback = process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY;
    process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED = "1";
    process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY = "1";
    try {
      const database = db();
      setup(database, [
        row({
          id: "chore-profile",
          assigned_to: null,
          assigned_member_id: "member-toddler",
          frequency: "once",
          recurrence_id: null,
        }),
      ]);
      database.householdMember.findMany.mockResolvedValue([
        {
          id: "member-toddler",
          name: "Toddler",
          role: "child",
          age: 3,
          archived_at: null,
          erasure_user_id: null,
          legacy_mapping: null,
          account_link: null,
        },
      ]);

      const result = await readParentRoutineStackCandidates(
        database,
        { ...actor, memberProtocol: 2 },
        date,
      );

      expect(result?.candidates.map((candidate) => candidate.id)).toEqual([
        "chore-profile",
      ]);
      expect(result?.candidates[0]).toMatchObject({
        assigned_to: null,
        assigned_member_id: "member-toddler",
      });
      expect(result?.assignmentOptions).toContainEqual({
        memberId: "member-toddler",
        name: "Toddler",
        role: "child",
      });

      const protocolOne = await readParentRoutineStackCandidates(
        database,
        actor,
        date,
      );
      expect(protocolOne?.candidates).toEqual([]);
      expect(protocolOne?.assignmentOptions).not.toContainEqual({
        memberId: "member-toddler",
        name: "Toddler",
        role: "child",
      });
    } finally {
      if (previousEnabled === undefined) {
        delete process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED;
      } else {
        process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED = previousEnabled;
      }
      if (previousRollback === undefined) {
        delete process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY;
      } else {
        process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY = previousRollback;
      }
    }
  });

  it("does not offer archived, linked, or repeating profile subjects", async () => {
    const previousEnabled = process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED;
    const previousRollback = process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY;
    process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED = "1";
    process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY = "1";
    try {
      const database = db();
      setup(database, [
        row({
          id: "chore-archived-profile",
          assigned_to: null,
          assigned_member_id: "member-archived-profile",
        }),
        row({
          id: "chore-linked-profile",
          assigned_to: null,
          assigned_member_id: "member-linked-profile",
        }),
        row({
          id: "chore-repeating-profile",
          assigned_to: null,
          assigned_member_id: "member-good-profile",
          frequency: "weekly",
        }),
      ]);
      database.householdMember.findMany.mockResolvedValue([
        {
          id: "member-archived-profile",
          name: "Archived",
          role: "child",
          age: 4,
          archived_at: new Date("2026-01-01T00:00:00.000Z"),
          erasure_user_id: null,
          legacy_mapping: null,
          account_link: null,
        },
        {
          id: "member-linked-profile",
          name: "Linked",
          role: "child",
          age: 4,
          archived_at: null,
          erasure_user_id: null,
          legacy_mapping: null,
          account_link: { user_id: "user-linked" },
        },
        {
          id: "member-good-profile",
          name: "Good",
          role: "child",
          age: 4,
          archived_at: null,
          erasure_user_id: null,
          legacy_mapping: null,
          account_link: null,
        },
      ]);

      const result = await readParentRoutineStackCandidates(
        database,
        { ...actor, memberProtocol: 2 },
        date,
      );
      expect(result?.candidates).toEqual([]);
      expect(result?.assignmentOptions).toEqual(
        expect.arrayContaining([
          { accountId: "user-unmapped", name: "Unmapped", role: "parent" },
          { memberId: "member-good-profile", name: "Good", role: "child" },
        ]),
      );
      expect(result?.assignmentOptions).toHaveLength(2);
      expect(result?.assignmentOptions).not.toEqual(
        expect.arrayContaining([
          {
            memberId: "member-archived-profile",
            name: "Archived",
            role: "child",
          },
          {
            memberId: "member-linked-profile",
            name: "Linked",
            role: "child",
          },
        ]),
      );
    } finally {
      if (previousEnabled === undefined) {
        delete process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED;
      } else {
        process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED = previousEnabled;
      }
      if (previousRollback === undefined) {
        delete process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY;
      } else {
        process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY = previousRollback;
      }
    }
  });

  it("preserves valid generated recurrence metadata and rejects bad anchors", async () => {
    const database = db();
    setup(database, [
      row({
        id: "generated-good",
        recurrence_id: "series-good",
        frequency: "once",
      }),
      row({
        id: "generated-bad",
        recurrence_id: "series-bad",
        frequency: "once",
      }),
    ]);
    database.chore.findMany.mockImplementation(
      async (args: { where?: { id?: unknown } }) => {
        if (args.where?.id) {
          return [
            {
              id: "series-good",
              family_id: "family-a",
              recurrence_id: "series-good",
              is_template: true,
              frequency: "weekly",
            },
            {
              id: "series-bad",
              family_id: "family-a",
              recurrence_id: "series-bad",
              is_template: false,
              frequency: "weekly",
            },
          ];
        }
        return [
          row({
            id: "generated-good",
            recurrence_id: "series-good",
            frequency: "once",
          }),
          row({
            id: "generated-bad",
            recurrence_id: "series-bad",
            frequency: "once",
          }),
        ];
      },
    );

    const result = await readParentRoutineStackCandidates(
      database,
      actor,
      date,
    );

    expect(result?.candidates).toHaveLength(1);
    expect(result?.candidates[0]).toMatchObject({
      id: "generated-good",
      recurrence_id: "series-good",
      frequency: "once",
      is_template: false,
    });
  });

  it("reports a bounded partial catalog with a continuation cursor", async () => {
    const database = db();
    const rows = Array.from({ length: 3 }, (_, index) =>
      row({
        id: `chore-${index}`,
        due_date: new Date(`${date}T00:00:00.000Z`),
      }),
    );
    setup(database, rows);

    const result = await readParentRoutineStackCandidates(
      database,
      actor,
      date,
      {
        limit: 2,
      },
    );

    expect(result?.candidates).toHaveLength(2);
    expect(result?.hasMore).toBe(true);
    expect(result?.nextCursor).toEqual(expect.any(String));
    expect(result?.nextCursor).not.toContain("user-good");
  });

  it("does not read any household details for a non-parent actor", async () => {
    const database = db();
    const result = await readParentRoutineStackCandidates(
      database,
      { ...actor, role: "child" },
      date,
    );

    expect(result).toBeNull();
    expect(database.user.findMany).not.toHaveBeenCalled();
  });
});
