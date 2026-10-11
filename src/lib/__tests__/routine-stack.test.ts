import {
  fingerprintRoutineStackSnapshot,
  normalizeRoutineStackDraft,
  projectRoutineStackResponse,
  routineStackResponseByteLength,
  RoutineStackValidationError,
} from "@/lib/routine-stack";

const step = (overrides: Record<string, unknown> = {}) => ({
  title: "Brush teeth",
  assigned_to: "user-a",
  due_date: "2026-10-12",
  frequency: "weekly",
  weekly_days: [1, 3, 1],
  ...overrides,
});

describe("routine stack contract", () => {
  it("normalizes the current occurrence draft and weekday order", () => {
    const draft = normalizeRoutineStackDraft({
      family_id: "family-a",
      occurrence_date: "2026-10-12",
      label: "  Morning   routine ",
      steps: [step({ chore_id: "chore-a", weekly_days: [3, 1] })],
      expected_fingerprint: "",
    });

    expect(draft).toMatchObject({
      scope: "occurrence",
      label: "Morning routine",
      occurrence_date: "2026-10-12",
    });
    expect(draft.steps[0]?.weekly_days).toEqual([1, 3]);
  });

  it("rejects future-series scope, duplicate rows, and invalid weekday cadence", () => {
    expect(() =>
      normalizeRoutineStackDraft({
        family_id: "family-a",
        occurrence_date: "2026-10-12",
        label: "Morning",
        scope: "future-series",
        steps: [],
        expected_fingerprint: "",
      }),
    ).toThrow(RoutineStackValidationError);

    expect(() =>
      normalizeRoutineStackDraft({
        family_id: "family-a",
        occurrence_date: "2026-10-12",
        label: "Morning",
        steps: [
          step({ chore_id: "chore-a", weekly_days: [1] }),
          step({ chore_id: "chore-a", weekly_days: [1] }),
        ],
        expected_fingerprint: "",
      }),
    ).toThrow(/selected more than once/);

    expect(() =>
      normalizeRoutineStackDraft({
        family_id: "family-a",
        occurrence_date: "2026-10-12",
        label: "Morning",
        steps: [
          step({ chore_id: "chore-a", frequency: "daily", weekly_days: [1] }),
        ],
        expected_fingerprint: "",
      }),
    ).toThrow(/require a weekly routine/);

    expect(() =>
      normalizeRoutineStackDraft({
        family_id: "family-a",
        occurrence_date: "2026-10-12",
        label: "Morning",
        steps: [
          step({
            is_template: true,
            recurrence_id: "series-a",
            frequency: "once",
            weekly_days: [],
          }),
        ],
        expected_fingerprint: "",
      }),
    ).toThrow(/recurring templates/);

    expect(() =>
      normalizeRoutineStackDraft({
        family_id: "family-a",
        occurrence_date: "2026-10-12",
        label: "Morning",
        steps: [step({ frequency: "weekly", weekly_days: [1] })],
        expected_fingerprint: "",
      }),
    ).toThrow(/one-time occurrences/);

    expect(() =>
      normalizeRoutineStackDraft({
        family_id: "family-a",
        occurrence_date: "2026-10-12",
        label: "Morning",
        steps: [
          step({
            title: "New step",
            due_date: "2026-10-13",
            frequency: "once",
            weekly_days: [],
          }),
        ],
        expected_fingerprint: "",
      }),
    ).toThrow(/selected occurrence date/);
  });

  it("fingerprints the selected row data independent of request ordering", () => {
    const base = [
      {
        id: "b",
        family_id: "family-a",
        title: "Pack bag",
        assigned_to: "user-b",
        assigned_member_id: "member-b",
        due_date: "2026-10-12",
        status: "pending",
        frequency: "once",
        weekly_days: [],
        routine: "Morning",
        routine_order: 2,
      },
      {
        id: "a",
        family_id: "family-a",
        title: "Brush teeth",
        assigned_to: "user-a",
        assigned_member_id: "member-a",
        due_date: "2026-10-12",
        status: "pending",
        frequency: "once",
        weekly_days: [],
        routine: "Morning",
        routine_order: 1,
      },
    ];
    expect(fingerprintRoutineStackSnapshot(base)).toBe(
      fingerprintRoutineStackSnapshot([...base].reverse()),
    );
    expect(fingerprintRoutineStackSnapshot(base)).not.toBe(
      fingerprintRoutineStackSnapshot(
        base.map((row) =>
          row.id === "a" ? { ...row, assigned_to: "user-c" } : row,
        ),
      ),
    );
    expect(fingerprintRoutineStackSnapshot(base)).not.toBe(
      fingerprintRoutineStackSnapshot(
        base.map((row) =>
          row.id === "a"
            ? {
                ...row,
                points: 20,
                photo_url: "/uploads/proof.jpg",
                photo_verified: true,
                verified_at: "2026-10-12T12:00:00.000Z",
                verified_notes: "Looks good",
                completed_at: "2026-10-12T11:00:00.000Z",
              }
            : row,
        ),
      ),
    );
  });

  it("returns a bounded projection without descriptions or private user-authored data", () => {
    const response = projectRoutineStackResponse({
      stack_id: "stack-a",
      version: 3,
      fingerprint: "f".repeat(64),
      steps: [
        {
          id: "chore-a",
          assigned_to: "user-a",
          assigned_member_id: "member-a",
          description: "private note should not appear",
        },
      ],
      members: [{ id: "member-a", role: "child" }],
    });

    expect(response.steps).toEqual([["chore-a", 1, 0]]);
    expect(response.assignments).toEqual([["user-a", "member-a"]]);
    expect(JSON.stringify(response)).not.toContain("private note");
    expect(routineStackResponseByteLength(response)).toBeLessThanOrEqual(8192);
  });

  it("enforces the UTF-8 receipt cap for an oversized 99-step projection", () => {
    const longId = "x".repeat(250);
    expect(() =>
      projectRoutineStackResponse({
        stack_id: "stack-a",
        version: 1,
        fingerprint: "f".repeat(64),
        steps: Array.from({ length: 99 }, (_, index) => ({
          id: `${longId}-${index}`,
          assigned_to: "user-a",
          assigned_member_id: null,
        })),
      }),
    ).toThrow(/too large/);
  });
});
