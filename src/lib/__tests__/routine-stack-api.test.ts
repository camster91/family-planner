jest.mock("@/lib/household-lock", () => ({
  lockHousehold: jest.fn(),
  lockUser: jest.fn(),
}));
jest.mock("@/lib/routine-stack-mutation", () => ({
  mutateRoutineStackInTx: jest.fn(),
}));

import {
  readParentRoutineStack,
  saveParentRoutineStack,
} from "@/lib/routine-stack-api";
import { lockHousehold, lockUser } from "@/lib/household-lock";
import { mutateRoutineStackInTx } from "@/lib/routine-stack-mutation";

const actor = { familyId: "family-a", userId: "parent-a", role: "parent" };

function step(overrides: Record<string, unknown> = {}) {
  return {
    id: "chore-a",
    family_id: "family-a",
    title: "Brush teeth",
    description: "Use the blue timer",
    assigned_to: "child-a",
    assigned_member_id: "member-child-a",
    member_subject_erased: false,
    due_date: new Date("2026-10-11T00:00:00.000Z"),
    recurrence_id: null,
    is_template: false,
    routine: "Morning",
    routine_order: 1,
    status: "pending",
    frequency: "once",
    weekly_days: [],
    difficulty: "easy",
    icon: "brush-teeth",
    points: 10,
    photo_url: "https://family.test/photo/chore-a",
    photo_verified: true,
    verified_at: null,
    verified_notes: "Parent note",
    completed_at: null,
    ...overrides,
  };
}

function readDb() {
  return {
    routineStack: { findFirst: jest.fn() },
    chore: { findMany: jest.fn() },
    householdMember: { findMany: jest.fn() },
  };
}

describe("routine-stack API helper", () => {
  beforeEach(() => jest.clearAllMocks());

  it("keeps the broad read parent-only and family-scoped", async () => {
    const db = readDb();
    const result = await readParentRoutineStack(
      db,
      { ...actor, role: "child" },
      "stack-a",
      "2026-10-11",
    );
    expect(result).toBeNull();
    expect(db.routineStack.findFirst).not.toHaveBeenCalled();

    db.routineStack.findFirst.mockResolvedValue({
      id: "stack-a",
      family_id: "family-a",
      label: "Morning",
      version: 3,
    });
    db.chore.findMany.mockResolvedValue([step()]);
    db.householdMember.findMany.mockResolvedValue([
      {
        id: "member-child-a",
        name: "Child A",
        role: "child",
        archived_at: null,
        erasure_user_id: null,
        legacy_mapping: { user_id: "child-a" },
        account_link: null,
        email: "private@example.test",
      },
      {
        id: "member-archived-a",
        name: "Archived A",
        role: "adult",
        archived_at: new Date("2026-01-01T00:00:00.000Z"),
        erasure_user_id: null,
        legacy_mapping: null,
        account_link: null,
      },
      {
        id: "member-unlinked-a",
        name: "Unlinked A",
        role: "child",
        archived_at: null,
        erasure_user_id: null,
        legacy_mapping: null,
        account_link: null,
      },
    ]);

    const parent = await readParentRoutineStack(
      db,
      actor,
      "stack-a",
      "2026-10-11",
    );

    expect(db.routineStack.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "stack-a", family_id: "family-a" },
      }),
    );
    expect(db.chore.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          family_id: "family-a",
          routine_stack_id: "stack-a",
        }),
      }),
    );
    expect(db.householdMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { family_id: "family-a" } }),
    );
    expect(parent).toMatchObject({
      stack: { id: "stack-a", family_id: "family-a" },
      steps: [
        expect.objectContaining({
          id: "chore-a",
          title: "Brush teeth",
          photo_url: "https://family.test/photo/chore-a",
        }),
      ],
      members: [
        {
          id: "member-child-a",
          displayName: "Child A",
          subjectState: "eligible",
        },
        {
          id: "member-archived-a",
          displayName: "Archived A",
          subjectState: "archived",
        },
        {
          id: "member-unlinked-a",
          displayName: "Unlinked A",
          subjectState: "dormant",
        },
      ],
    });
    expect(JSON.stringify(parent)).not.toContain("private@example.test");
  });

  it("returns a protocol refusal for a stored profile stack instead of hiding it as not found", async () => {
    const previousEnabled = process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED;
    const previousRollback = process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY;
    process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED = "1";
    process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY = "1";
    try {
      const db = readDb();
      db.routineStack.findFirst.mockResolvedValue({
        id: "stack-profile",
        family_id: "family-a",
        label: "Morning",
        version: 1,
      });
      db.chore.findMany.mockResolvedValue([
        step({
          id: "profile-chore",
          assigned_to: null,
          assigned_member_id: "member-toddler",
        }),
      ]);
      db.householdMember.findMany.mockResolvedValue([]);

      const result = await readParentRoutineStack(
        db,
        actor,
        "stack-profile",
        "2026-10-11",
      );

      expect(result).toEqual({
        status: 409,
        body: expect.objectContaining({
          code: "MEMBER_PROTOCOL_UNAVAILABLE",
          recovery: "refresh-and-retain-pending",
          requiredProtocol: 2,
          receivedProtocol: 1,
        }),
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

  it("creates a pending receipt before invoking the atomic coordinator", async () => {
    const draft = {
      family_id: "family-a",
      occurrence_date: "2026-10-11",
      label: "Morning",
      steps: [],
      remove_chore_ids: [],
      expected_fingerprint: "",
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          family_id: "family-a",
          role: "parent",
        }),
      },
      idempotencyRecord: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "receipt-a",
          family_id: "family-a",
          user_id: "parent-a",
          action: "routine-stack.mutate",
          request_hash: "hash-a",
          response_status: null,
          response_body: null,
          expires_at: new Date("2026-10-18T00:00:00.000Z"),
        }),
      },
      householdMember: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: "member-child-a", role: "child" }]),
      },
    };
    const db = {
      $transaction: <T>(callback: (value: unknown) => Promise<T>) =>
        callback(tx),
    };
    jest.mocked(mutateRoutineStackInTx).mockResolvedValue({
      status: 200,
      body: { stack_id: "stack-a" },
    });

    const result = await saveParentRoutineStack(
      db,
      draft,
      actor,
      "key-a",
      new Date("2026-10-11T12:00:00.000Z"),
    );

    expect(result).toEqual({ status: 200, body: { stack_id: "stack-a" } });
    expect(tx.idempotencyRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scope: "user:parent-a",
          key: "key-a",
          family_id: "family-a",
          user_id: "parent-a",
          action: "routine-stack.mutate",
          response_status: null,
        }),
      }),
    );
    expect(mutateRoutineStackInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        family_id: "family-a",
        occurrence_date: "2026-10-11",
      }),
      actor,
      {
        recordId: "receipt-a",
        memberDictionary: [{ id: "member-child-a", role: "child" }],
      },
    );
    expect((lockUser as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (lockHousehold as jest.Mock).mock.invocationCallOrder[0],
    );
  });

  it("reuses the receipt predicates before any domain mutation", async () => {
    const draft = {
      family_id: "family-a",
      occurrence_date: "2026-10-11",
      label: "Morning",
      steps: [],
      remove_chore_ids: [],
      expected_fingerprint: "",
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ family_id: "family-a", role: "parent" }),
      },
      idempotencyRecord: {
        findUnique: jest.fn().mockResolvedValue({
          id: "receipt-a",
          family_id: "family-a",
          user_id: "parent-a",
          action: "different-action",
          request_hash: "different-hash",
          response_status: 200,
          response_body: { private: "never returned" },
          expires_at: new Date("2099-10-18T00:00:00.000Z"),
        }),
      },
    };
    const db = {
      $transaction: <T>(callback: (value: unknown) => Promise<T>) =>
        callback(tx),
    };

    const result = await saveParentRoutineStack(db, draft, actor, "key-a");

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({
      error: { code: "IDEMPOTENCY_KEY_REUSED" },
    });
    expect(mutateRoutineStackInTx).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("refuses a role change observed after authentication before receipt access", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ family_id: "family-a", role: "child" }),
      },
      idempotencyRecord: { findUnique: jest.fn() },
    };
    const db = {
      $transaction: <T>(callback: (value: unknown) => Promise<T>) =>
        callback(tx),
    };

    const result = await saveParentRoutineStack(
      db,
      {
        family_id: "family-a",
        occurrence_date: "2026-10-11",
        label: "Morning",
        steps: [],
        remove_chore_ids: [],
        expected_fingerprint: "",
      },
      actor,
      "key-a",
    );

    expect(result).toMatchObject({
      status: 403,
      body: { error: { code: "FORBIDDEN" } },
    });
    expect(tx.idempotencyRecord.findUnique).not.toHaveBeenCalled();
  });
});

// Authored UNRUN: expired sessions may not inspect/replay receipts or write.
it('refuses a session generation changed while waiting for lifecycle/row locks', async () => {
  const events: string[] = [];
  const tx = {
    $queryRaw: jest.fn(async () => { events.push('row-lock'); return []; }),
    user: { findUnique: jest.fn(async () => { events.push('fresh-user'); return { family_id: 'family-a', role: 'parent', token_version: 4 }; }) },
    idempotencyRecord: { findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
    householdMember: { findMany: jest.fn() },
  };
  const db = { $transaction: <T,>(callback: (value: unknown) => Promise<T>) => callback(tx) };
  const result = await saveParentRoutineStack(db, {
    family_id: 'family-a', occurrence_date: '2026-10-11', label: 'Morning',
    steps: [], remove_chore_ids: [], expected_fingerprint: '',
  }, { ...actor, tokenVersion: 3 }, 'unchanged-request-key');
  expect(result).toMatchObject({ status: 401, body: { error: { code: 'SESSION_CHANGED' } } });
  expect(events).toEqual(['row-lock', 'fresh-user']);
  expect(tx.idempotencyRecord.findUnique).not.toHaveBeenCalled();
  expect(tx.idempotencyRecord.create).not.toHaveBeenCalled();
  expect(tx.idempotencyRecord.delete).not.toHaveBeenCalled();
  expect(tx.householdMember.findMany).not.toHaveBeenCalled();
});

// Authored UNRUN: the window is rechecked after lifecycle/row-lock waits.
it('refuses an expired original issue time before inspecting even a stored receipt', async () => {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: { findUnique: jest.fn().mockResolvedValue({ family_id: 'family-a', role: 'parent', token_version: 0 }) },
    idempotencyRecord: { findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
  };
  const db = { $transaction: <T,>(callback: (value: unknown) => Promise<T>) => callback(tx) };
  const result = await saveParentRoutineStack(db, {
    family_id: 'family-a', occurrence_date: '2026-10-11', label: 'Morning',
    steps: [], remove_chore_ids: [], expected_fingerprint: '',
  }, { ...actor, tokenVersion: 0, issuedAt: '2020-01-01T00:00:00.000Z' }, 'original-key');
  expect(result).toMatchObject({ status: 409, body: { error: { code: 'ROUTINE_STACK_WINDOW_CLOSED' } } });
  expect(tx.idempotencyRecord.findUnique).not.toHaveBeenCalled();
  expect(tx.idempotencyRecord.create).not.toHaveBeenCalled();
  expect(tx.idempotencyRecord.delete).not.toHaveBeenCalled();
});
