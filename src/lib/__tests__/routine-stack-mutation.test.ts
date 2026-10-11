import { hashIdempotentRequest } from "@/lib/idempotency";
import {
  fingerprintRoutineStackSnapshot,
  normalizeRoutineStackDraft,
} from "@/lib/routine-stack";
import { mutateRoutineStackInTx } from "@/lib/routine-stack-mutation";

type Row = Record<string, unknown>;

function makeTx(initial: { stack?: Row; chores?: Row[]; record?: Row } = {}) {
  const state = {
    stack: initial.stack ?? null,
    chores: initial.chores ?? [],
    record: initial.record ?? null,
    writes: [] as string[],
    queries: [] as string[],
  };
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      state.queries.push(
        `${Array.from(strings).join("?")} ${values.map(String).join("|")}`,
      );
      return [{ id: "family-a" }];
    },
    family: { findFirst: async () => ({ id: "family-a" }) },
    routineStack: {
      findFirst: async () => state.stack,
      create: async ({ data }: { data: Row }) => {
        state.stack = { ...data };
        state.writes.push("stack.create");
        return state.stack;
      },
      update: async ({ data }: { data: Row }) => {
        state.stack = { ...(state.stack ?? {}), ...data };
        state.writes.push("stack.update");
        return state.stack;
      },
      findMany: async () => [],
    },
    chore: {
      findFirst: async () => null,
      findMany: async ({ where }: { where: Row }) => {
        const ids = (where.id as { in?: string[] } | undefined)?.in;
        if (ids)
          return state.chores.filter((row) => ids.includes(String(row.id)));
        return state.chores.filter(
          (row) => row.routine_stack_id === where.routine_stack_id,
        );
      },
      create: async ({ data }: { data: Row }) => {
        const row = { id: `created-${state.chores.length + 1}`, ...data };
        state.chores.push(row);
        state.writes.push("chore.create");
        return row;
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = state.chores.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error("missing chore");
        Object.assign(row, data);
        state.writes.push(`chore.update:${String(where.id)}`);
        return row;
      },
    },
    idempotencyRecord: {
      findFirst: async () => state.record,
      update: async ({ data }: { data: Row }) => {
        if (state.record) Object.assign(state.record, data);
        state.writes.push("receipt.update");
        return state.record;
      },
      create: async () => null,
      findMany: async () => [],
    },
  };
  return { tx, state };
}

function existingChore(overrides: Row = {}): Row {
  return {
    id: "chore-a",
    family_id: "family-a",
    title: "Brush teeth",
    description: null,
    assigned_to: "user-a",
    assigned_member_id: "member-a",
    member_subject_erased: false,
    due_date: "2026-10-12",
    recurrence_id: null,
    is_template: false,
    routine: "Morning",
    routine_order: 1,
    status: "pending",
    frequency: "once",
    weekly_days: [],
    icon: null,
    routine_stack_id: "stack-a",
    ...overrides,
  };
}

function seriesAnchor(overrides: Row = {}): Row {
  return existingChore({
    id: "series-a",
    title: "Series template",
    due_date: "2026-10-05",
    frequency: "weekly",
    weekly_days: [1],
    recurrence_id: "series-a",
    is_template: true,
    routine_stack_id: null,
    ...overrides,
  });
}

function input(overrides: Row = {}) {
  return {
    family_id: "family-a",
    stack_id: "stack-a",
    occurrence_date: "2026-10-12",
    label: "Morning",
    steps: [
      {
        chore_id: "chore-a",
        assigned_to: "user-a",
        assigned_member_id: "member-a",
        due_date: "2026-10-12",
        frequency: "once",
      },
    ],
    remove_chore_ids: [],
    expected_fingerprint: "",
    ...overrides,
  };
}

describe("routine stack transaction coordinator", () => {
  it("locks the occurrence, preserves dual assignee fields, and commits the receipt with the row update", async () => {
    const chore = existingChore();
    const draft = normalizeRoutineStackDraft(
      input({
        expected_fingerprint: fingerprintRoutineStackSnapshot([chore as never]),
      }),
    );
    const record = {
      action: "routine-stack.mutate",
      request_hash: hashIdempotentRequest("routine-stack.mutate", draft),
      response_status: null,
      response_body: null,
    };
    const { tx, state } = makeTx({
      stack: {
        id: "stack-a",
        family_id: "family-a",
        version: 2,
        label: "Morning",
        fingerprint: draft.expected_fingerprint,
      },
      chores: [chore],
      record,
    });

    const result = await mutateRoutineStackInTx(
      tx,
      draft,
      { familyId: "family-a", userId: "parent-a", role: "parent" },
      {
        recordId: "record-a",
        resolveAssignee: async () => ({
          assigned_to: "user-a",
          assigned_member_id: "member-a",
        }),
      },
    );

    expect(result.status).toBe(200);
    expect(state.writes).toEqual(
      expect.arrayContaining([
        "chore.update:chore-a",
        "stack.update",
        "receipt.update",
      ]),
    );
    expect(chore).toMatchObject({
      assigned_to: "user-a",
      assigned_member_id: "member-a",
      routine_stack_id: "stack-a",
      routine_order: 1,
    });
    expect(state.record).toMatchObject({ response_status: 200 });
    const userLock = state.queries.findIndex((query) =>
      query.includes("user-membership:parent-a"),
    );
    const householdLock = state.queries.findIndex((query) =>
      query.includes("household-membership:family-a"),
    );
    const receiptLock = state.queries.findIndex((query) =>
      query.includes('"IdempotencyRecord"'),
    );
    expect(userLock).toBeGreaterThanOrEqual(0);
    expect(userLock).toBeLessThan(householdLock);
    expect(householdLock).toBeLessThan(receiptLock);
  });

  it("replays a completed key without re-running the chore write", async () => {
    const chore = existingChore();
    const draft = normalizeRoutineStackDraft(
      input({
        expected_fingerprint: fingerprintRoutineStackSnapshot([chore as never]),
      }),
    );
    const record = {
      action: "routine-stack.mutate",
      request_hash: hashIdempotentRequest("routine-stack.mutate", draft),
      response_status: 200,
      response_body: { stack_id: "stack-a", version: 3 },
    };
    const { tx, state } = makeTx({
      stack: { id: "stack-a", family_id: "family-a", version: 2 },
      chores: [chore],
      record,
    });

    const result = await mutateRoutineStackInTx(
      tx,
      draft,
      { familyId: "family-a", userId: "parent-a", role: "parent" },
      { recordId: "record-a" },
    );

    expect(result).toMatchObject({
      status: 200,
      replayed: true,
      body: record.response_body,
    });
    expect(state.writes).toEqual([]);
  });

  it("returns changed-payload reuse as 422 before locking domain rows", async () => {
    const chore = existingChore();
    const draft = normalizeRoutineStackDraft(
      input({
        expected_fingerprint: fingerprintRoutineStackSnapshot([chore as never]),
      }),
    );
    const record = {
      action: "routine-stack.mutate",
      request_hash: "different-request",
      response_status: null,
      response_body: null,
    };
    const { tx, state } = makeTx({
      stack: { id: "stack-a", family_id: "family-a", version: 2 },
      chores: [chore],
      record,
    });

    const result = await mutateRoutineStackInTx(
      tx,
      draft,
      { familyId: "family-a", userId: "parent-a", role: "parent" },
      { recordId: "record-a" },
    );

    expect(result.status).toBe(422);
    expect(state.writes).toEqual([]);
  });

  it("requires a non-empty current fingerprint and rejects omitted occurrence rows", async () => {
    const first = existingChore();
    const second = existingChore({
      id: "chore-b",
      title: "Pack bag",
      routine_order: 2,
    });
    const fullFingerprint = fingerprintRoutineStackSnapshot([
      first as never,
      second as never,
    ]);
    const { tx } = makeTx({
      stack: { id: "stack-a", family_id: "family-a", version: 2 },
      chores: [first, second],
    });

    await expect(
      mutateRoutineStackInTx(tx, input({ expected_fingerprint: "" }), {
        familyId: "family-a",
        userId: "parent-a",
        role: "parent",
      }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      mutateRoutineStackInTx(
        tx,
        input({ expected_fingerprint: fullFingerprint }),
        { familyId: "family-a", userId: "parent-a", role: "parent" },
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("runs canonical chore validation for a new routine step", async () => {
    const { tx } = makeTx();
    await expect(
      mutateRoutineStackInTx(
        tx,
        {
          family_id: "family-a",
          occurrence_date: "2026-10-12",
          label: "Morning",
          steps: [
            {
              title: "New step",
              assigned_to: "user-a",
              due_date: "2026-10-12",
              frequency: "once",
              icon: "not-a-built-in-icon",
            },
          ],
          remove_chore_ids: [],
          expected_fingerprint: "",
        },
        { familyId: "family-a", userId: "parent-a", role: "parent" },
        { resolveAssignee: async () => ({ assigned_to: "user-a" }) },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("stacks a generated recurring occurrence without changing its canonical history", async () => {
    const anchor = seriesAnchor();
    const chore = existingChore({
      recurrence_id: "series-a",
      status: "completed",
      points: 25,
      photo_url: "photo-a",
      verified_at: new Date("2026-10-12T09:00:00.000Z"),
      verified_notes: "Checked by parent",
      completed_at: new Date("2026-10-12T08:00:00.000Z"),
    });
    const draft = normalizeRoutineStackDraft(
      input({
        steps: [
          {
            chore_id: "chore-a",
            assigned_to: "user-a",
            assigned_member_id: "member-a",
            due_date: "2026-10-12",
            frequency: "once",
            recurrence_id: "series-a",
          },
        ],
        expected_fingerprint: fingerprintRoutineStackSnapshot([chore as never]),
      }),
    );
    const { tx, state } = makeTx({
      stack: { id: "stack-a", family_id: "family-a", version: 2 },
      chores: [anchor, chore],
    });

    const result = await mutateRoutineStackInTx(tx, draft, {
      familyId: "family-a",
      userId: "parent-a",
      role: "parent",
    });

    expect(result.status).toBe(200);
    expect(state.writes).toEqual(
      expect.arrayContaining(["chore.update:chore-a", "stack.update"]),
    );
    expect(chore).toMatchObject({
      recurrence_id: "series-a",
      status: "completed",
      points: 25,
      photo_url: "photo-a",
      verified_notes: "Checked by parent",
    });
    expect(chore.verified_at).toEqual(new Date("2026-10-12T09:00:00.000Z"));
    expect(chore.completed_at).toEqual(new Date("2026-10-12T08:00:00.000Z"));
  });

  it("rejects a submitted series identity that differs from the locked occurrence", async () => {
    const anchor = seriesAnchor();
    const chore = existingChore({ recurrence_id: "series-a" });
    const draft = normalizeRoutineStackDraft(
      input({
        steps: [
          {
            chore_id: "chore-a",
            assigned_to: "user-a",
            assigned_member_id: "member-a",
            due_date: "2026-10-12",
            frequency: "once",
            recurrence_id: "series-b",
          },
        ],
        expected_fingerprint: fingerprintRoutineStackSnapshot([chore as never]),
      }),
    );
    const { tx, state } = makeTx({
      stack: { id: "stack-a", family_id: "family-a", version: 2 },
      chores: [anchor, chore],
    });

    await expect(
      mutateRoutineStackInTx(tx, draft, {
        familyId: "family-a",
        userId: "parent-a",
        role: "parent",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(state.writes).toEqual([]);
  });

  it("rejects an omitted series identity on a generated occurrence", async () => {
    const anchor = seriesAnchor();
    const chore = existingChore({ recurrence_id: "series-a" });
    const draft = normalizeRoutineStackDraft(
      input({
        expected_fingerprint: fingerprintRoutineStackSnapshot([chore as never]),
      }),
    );
    const { tx, state } = makeTx({
      stack: { id: "stack-a", family_id: "family-a", version: 2 },
      chores: [anchor, chore],
    });

    await expect(
      mutateRoutineStackInTx(tx, draft, {
        familyId: "family-a",
        userId: "parent-a",
        role: "parent",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(state.writes).toEqual([]);
  });

  it("accepts a stopped series anchor and legacy null-series row", async () => {
    const stopped = seriesAnchor({
      id: "stopped-a",
      due_date: "2026-10-12",
      frequency: "once",
      weekly_days: [],
      recurrence_id: "stopped-a",
      is_template: false,
      routine_stack_id: null,
    });
    const legacy = existingChore({
      id: "legacy-a",
      recurrence_id: null,
      frequency: "weekly",
      weekly_days: [1],
      routine_stack_id: null,
    });
    const draft = normalizeRoutineStackDraft({
      family_id: "family-a",
      stack_id: null,
      occurrence_date: "2026-10-12",
      label: "Morning",
      steps: [
        {
          chore_id: "stopped-a",
          assigned_to: "user-a",
          assigned_member_id: "member-a",
          due_date: "2026-10-12",
          frequency: "once",
          difficulty: "medium",
          recurrence_id: "stopped-a",
        },
        {
          chore_id: "legacy-a",
          assigned_to: "user-a",
          assigned_member_id: "member-a",
          due_date: "2026-10-12",
          frequency: "weekly",
          weekly_days: [1],
          difficulty: "medium",
        },
      ],
      remove_chore_ids: [],
      expected_fingerprint: "",
    });
    const { tx, state } = makeTx({ chores: [stopped, legacy] });

    const result = await mutateRoutineStackInTx(
      tx,
      draft,
      { familyId: "family-a", userId: "parent-a", role: "parent" },
      { resolveAssignee: async () => ({ assigned_to: "user-a" }) },
    );

    expect(result.status).toBe(200);
    expect(stopped).toMatchObject({
      recurrence_id: "stopped-a",
      is_template: false,
      routine_stack_id: expect.any(String),
    });
    expect(legacy).toMatchObject({
      recurrence_id: null,
      frequency: "weekly",
      routine_stack_id: expect.any(String),
    });
  });

  it.each([
    { label: "orphan", seriesId: "missing-series" },
    {
      label: "malformed anchor",
      seriesId: "malformed-series",
      anchor: seriesAnchor({
        id: "malformed-series",
        recurrence_id: "different-series",
      }),
    },
    {
      label: "foreign anchor",
      seriesId: "foreign-series",
      anchor: seriesAnchor({
        id: "foreign-series",
        family_id: "family-b",
      }),
    },
  ])(
    "rejects a $label recurrence identity before writes",
    async ({ seriesId, anchor }) => {
      const chore = existingChore({ recurrence_id: seriesId });
      const draft = normalizeRoutineStackDraft(
        input({
          expected_fingerprint: fingerprintRoutineStackSnapshot([
            chore as never,
          ]),
        }),
      );
      const { tx, state } = makeTx({
        stack: { id: "stack-a", family_id: "family-a", version: 2 },
        chores: [chore, ...(anchor ? [anchor] : [])],
      });

      await expect(
        mutateRoutineStackInTx(tx, draft, {
          familyId: "family-a",
          userId: "parent-a",
          role: "parent",
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(state.writes).toEqual([]);
    },
  );

  it("removes a generated occurrence by stable id without rewriting its series history", async () => {
    const anchor = seriesAnchor();
    const recurring = existingChore({
      recurrence_id: "series-a",
      status: "completed",
      points: 20,
      photo_url: "photo-a",
      routine_order: 1,
    });
    const retained = existingChore({
      id: "chore-b",
      title: "Pack bag",
      routine_order: 2,
    });
    const draft = normalizeRoutineStackDraft(
      input({
        steps: [
          {
            chore_id: "chore-b",
            assigned_to: "user-a",
            assigned_member_id: "member-a",
            due_date: "2026-10-12",
            frequency: "once",
          },
        ],
        remove_chore_ids: ["chore-a"],
        expected_fingerprint: fingerprintRoutineStackSnapshot([
          recurring as never,
          retained as never,
        ]),
      }),
    );
    const { tx, state } = makeTx({
      stack: { id: "stack-a", family_id: "family-a", version: 2 },
      chores: [anchor, recurring, retained],
    });

    const result = await mutateRoutineStackInTx(tx, draft, {
      familyId: "family-a",
      userId: "parent-a",
      role: "parent",
    });

    expect(result.status).toBe(200);
    expect(recurring).toMatchObject({
      recurrence_id: "series-a",
      status: "completed",
      points: 20,
      photo_url: "photo-a",
      routine_stack_id: null,
      routine: null,
      routine_order: null,
    });
    expect(state.writes).toEqual(
      expect.arrayContaining(["chore.update:chore-a", "chore.update:chore-b"]),
    );
  });

  it("rejects foreign-stack rows for both a new stack and a different existing stack", async () => {
    const foreign = existingChore({ routine_stack_id: "stack-b" });
    const { tx: newStackTx } = makeTx({ chores: [foreign] });
    await expect(
      mutateRoutineStackInTx(
        newStackTx,
        input({ stack_id: null, expected_fingerprint: "" }),
        { familyId: "family-a", userId: "parent-a", role: "parent" },
      ),
    ).rejects.toMatchObject({ status: 409 });

    const { tx: existingStackTx } = makeTx({
      stack: { id: "stack-a", family_id: "family-a", version: 2 },
      chores: [foreign],
    });
    await expect(
      mutateRoutineStackInTx(
        existingStackTx,
        input({ expected_fingerprint: fingerprintRoutineStackSnapshot([]) }),
        { familyId: "family-a", userId: "parent-a", role: "parent" },
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("does not allow an occurrence routine to become empty", async () => {
    const first = existingChore();
    const second = existingChore({
      id: "chore-b",
      title: "Pack bag",
      routine_order: 2,
    });
    const { tx, state } = makeTx({
      stack: { id: "stack-a", family_id: "family-a", version: 2 },
      chores: [first, second],
    });
    await expect(
      mutateRoutineStackInTx(
        tx,
        input({
          steps: [],
          remove_chore_ids: ["chore-a", "chore-b"],
          expected_fingerprint: fingerprintRoutineStackSnapshot([
            first as never,
            second as never,
          ]),
        }),
        { familyId: "family-a", userId: "parent-a", role: "parent" },
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(state.writes).toEqual([]);
  });

  it("does not expose mutation details to a child or teen", async () => {
    const { tx, state } = makeTx();
    const result = await mutateRoutineStackInTx(tx, input(), {
      familyId: "family-a",
      userId: "child-a",
      role: "child",
    });
    expect(result.status).toBe(403);
    expect(state.writes).toEqual([]);
  });
});
