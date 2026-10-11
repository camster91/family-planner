import { readParentRoutineStackCandidates } from "@/lib/routine-stack-api";

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
