import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  completeProfileChoreInTx,
  reopenProfileChoreInTx,
} from "@/lib/chore-profile-actions";
import {
  createProfileOnlyChoreEffect,
  isProfileChoreEnabled,
  isProfileChoreRecurrenceSupported,
  profileChoreCreateSchema,
  profileChoreReadRefusal,
  profileChoreProtocolRefusal,
  PROFILE_CHORE_ROLLBACK_READY_ENV,
  PROFILE_CHORE_RECURRENCE_ENABLE_ENV,
  readChoreSubject,
} from "@/lib/chore-profile";

const baseMember = {
  id: "member-child",
  family_id: "family-a",
  name: "Child",
  role: "child",
  age: 7,
  archived_at: null,
  erasure_user_id: null,
  legacy_mapping: null,
  account_link: null,
};

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    assigned_to: null,
    assigned_member_id: baseMember.id,
    member_subject_erased: false,
    assignee: null,
    assigneeMember: baseMember,
    ...overrides,
  };
}

describe("profile-only chore contract", () => {
  const originalGate = process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED;
  const originalRollbackGate =
    process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY;
  const originalRecurrenceGate =
    process.env.HOUSEHOLD_PROFILE_CHORE_RECURRENCE_ENABLED;

  afterEach(() => {
    if (originalGate === undefined)
      delete process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED;
    else process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED = originalGate;
    if (originalRollbackGate === undefined)
      delete process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY;
    else
      process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY = originalRollbackGate;
    if (originalRecurrenceGate === undefined)
      delete process.env[PROFILE_CHORE_RECURRENCE_ENABLE_ENV];
    else
      process.env[PROFILE_CHORE_RECURRENCE_ENABLE_ENV] = originalRecurrenceGate;
  });

  it("returns a typed profile subject without exposing account details", () => {
    expect(readChoreSubject(profileRow(), "family-a")).toEqual({
      kind: "profile",
      memberId: "member-child",
      name: "Child",
      role: "child",
    });
  });

  it("refuses stale, linked, erased, and cross-household profile rows", () => {
    expect(
      readChoreSubject(
        profileRow({
          assigneeMember: { ...baseMember, archived_at: new Date() },
        }),
        "family-a",
      ),
    ).toBeNull();
    expect(
      readChoreSubject(
        profileRow({
          assigneeMember: {
            ...baseMember,
            account_link: { user_id: "user-child" },
          },
        }),
        "family-a",
      ),
    ).toBeNull();
    expect(
      readChoreSubject(profileRow({ member_subject_erased: true }), "family-a"),
    ).toBeNull();
    expect(
      readChoreSubject(
        profileRow({
          assigneeMember: { ...baseMember, family_id: "family-b" },
        }),
        "family-a",
      ),
    ).toBeNull();
  });

  it("keeps reconciled account rows on the legacy typed subject path", () => {
    expect(
      readChoreSubject(
        profileRow({
          assigned_to: "user-child",
          assigned_member_id: baseMember.id,
          assignee: {
            id: "user-child",
            name: "Child account",
            family_id: "family-a",
          },
          assigneeMember: {
            ...baseMember,
            legacy_mapping: { user_id: "user-child" },
          },
        }),
        "family-a",
      ),
    ).toEqual({
      kind: "account",
      accountId: "user-child",
      name: "Child account",
    });
  });

  it("refuses account rows with a conflicting second mapping or link", () => {
    expect(
      readChoreSubject(
        profileRow({
          assigned_to: "user-child",
          assignee: {
            id: "user-child",
            name: "Child account",
            family_id: "family-a",
          },
          assigneeMember: {
            ...baseMember,
            legacy_mapping: { user_id: "user-child" },
            account_link: { user_id: "different-user" },
          },
        }),
        "family-a",
      ),
    ).toBeNull();
  });

  it("requires protocol 2 and validates profile schedules without weakening one-offs", () => {
    const valid = profileChoreCreateSchema.safeParse({
      protocol: 2,
      selection: { memberId: "member-child" },
      title: "Put away shoes",
      due_date: "2026-10-11",
      frequency: "once",
    });
    expect(valid.success).toBe(true);
    expect(
      profileChoreCreateSchema.safeParse({
        protocol: 2,
        selection: { memberId: "member-child" },
        title: "Repeating profile chore",
        due_date: "2026-10-11",
        frequency: "daily",
      }).success,
    ).toBe(true);
    expect(
      profileChoreCreateSchema.parse({
        protocol: 2,
        selection: { memberId: "member-child" },
        title: "Normalized days",
        due_date: "2026-10-11",
        frequency: "weekly",
        weekly_days: [4, 1, 4],
      }).weekly_days,
    ).toEqual([1, 4]);
    expect(
      profileChoreCreateSchema.safeParse({
        protocol: 2,
        selection: { memberId: "member-child" },
        title: "Selected days",
        due_date: "2026-10-11",
        frequency: "weekly",
        weekly_days: [1, 4],
      }).success,
    ).toBe(true);
    expect(
      profileChoreCreateSchema.safeParse({
        protocol: 2,
        selection: { memberId: "member-child" },
        title: "Missing days",
        due_date: "2026-10-11",
        frequency: "weekly",
      }).success,
    ).toBe(false);
    expect(
      profileChoreCreateSchema.safeParse({
        protocol: 2,
        selection: { memberId: "member-child" },
        title: "Monthly profile chore",
        due_date: "2026-10-11",
        frequency: "monthly",
      }).success,
    ).toBe(true);
    expect(
      profileChoreCreateSchema.safeParse({
        protocol: 2,
        selection: { memberId: "member-child" },
        title: "Invalid weekday payload",
        due_date: "2026-10-11",
        frequency: "daily",
        weekly_days: [1],
      }).success,
    ).toBe(false);
    expect(
      profileChoreCreateSchema.safeParse({
        protocol: 2,
        selection: { memberId: "member-child" },
        title: "Routine profile chore",
        due_date: "2026-10-11",
        routine: "Bedtime",
        icon: "brush-teeth",
        routine_order: 2,
      }).success,
    ).toBe(true);
  });

  it("uses the canonical picture, label and step bounds for email-free routines", () => {
    const draft = {
      protocol: 2,
      selection: { memberId: "member-child" },
      title: "Brush teeth",
      due_date: "2026-10-11",
      routine: "  Bedtime   reset  ",
      icon: "brush-teeth",
      routine_order: 2,
    };
    expect(profileChoreCreateSchema.parse(draft).routine).toBe("Bedtime reset");
    for (const invalid of [
      { icon: "unknown-picture" },
      { routine: "x".repeat(41) },
      { routine_order: 0 },
      { routine_order: 100 },
      { routine_order: 1.5 },
      { assigned_to: "fake-account" },
      { email: "child@example.invalid" },
    ]) {
      expect(
        profileChoreCreateSchema.safeParse({ ...draft, ...invalid }).success,
      ).toBe(false);
    }
  });

  it("fails closed while the gate is off and exposes a no-store refusal", () => {
    delete process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED;
    expect(isProfileChoreEnabled()).toBe(false);
    expect(profileChoreReadRefusal({ headers: new Headers() })).toEqual({
      status: 409,
      body: {
        error: "MEMBER_PROTOCOL_UNAVAILABLE",
        ...profileChoreProtocolRefusal(),
      },
    });

    process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED = "1";
    expect(isProfileChoreEnabled()).toBe(false);
    process.env[PROFILE_CHORE_ROLLBACK_READY_ENV] = "1";
    expect(
      profileChoreReadRefusal({
        headers: new Headers({ "X-Member-Protocol": "2" }),
      }),
    ).toBeNull();
    expect(profileChoreReadRefusal({ headers: new Headers() })).toEqual({
      status: 409,
      body: {
        error: "MEMBER_PROTOCOL_UNAVAILABLE",
        ...profileChoreProtocolRefusal(),
      },
    });
  });

  it("keeps recurring profile support behind its separate private opt-in", () => {
    process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED = "1";
    process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY = "1";
    delete process.env[PROFILE_CHORE_RECURRENCE_ENABLE_ENV];
    expect(isProfileChoreRecurrenceSupported()).toBe(false);

    process.env[PROFILE_CHORE_RECURRENCE_ENABLE_ENV] = "1";
    expect(isProfileChoreRecurrenceSupported()).toBe(true);

    delete process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY;
    expect(isProfileChoreRecurrenceSupported()).toBe(false);
  });

  it("locks membership before the live receipt and stores the response in the same effect", async () => {
    const lockSql: string[] = [];
    const receiptUpdate = jest.fn();
    const choreCreate = jest.fn().mockResolvedValue({
      id: "chore-a",
      title: "Put away shoes",
      description: null,
      assigned_to: null,
      assigned_member_id: baseMember.id,
      member_subject_erased: false,
      due_date: new Date("2026-10-11T00:00:00.000Z"),
      status: "pending",
      frequency: "once",
      difficulty: "easy",
      icon: "shoes",
      routine: "Morning",
      routine_order: 1,
      assignee: null,
      assigneeMember: baseMember,
    });
    const tx = {
      $queryRaw: jest.fn(async (query: TemplateStringsArray) => {
        lockSql.push(query[0]);
        return [];
      }),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "parent-a",
          family_id: "family-a",
          role: "parent",
        }),
      },
      idempotencyRecord: {
        findFirst: jest.fn().mockResolvedValue({
          response_status: null,
          response_body: null,
        }),
        update: receiptUpdate,
      },
      householdMember: { findFirst: jest.fn().mockResolvedValue(baseMember) },
      chore: { create: choreCreate },
    };
    const db = {
      $transaction: async (callback: (value: typeof tx) => unknown) =>
        callback(tx),
    };
    const input = profileChoreCreateSchema.parse({
      protocol: 2,
      selection: { memberId: baseMember.id },
      title: "Put away shoes",
      due_date: "2026-10-11",
      difficulty: "easy",
      frequency: "once",
      icon: "shoes",
      routine: "Morning",
      routine_order: 1,
    });

    const result = await createProfileOnlyChoreEffect(
      db as never,
      { id: "parent-a", familyId: "family-a" },
      input,
      new Date("2026-10-11T00:00:00.000Z"),
      null,
      "receipt-a",
      new Date("2026-10-11T12:00:00.000Z"),
    );

    expect(result.status).toBe(200);
    expect(lockSql).toHaveLength(3);
    expect(lockSql[0]).not.toContain('"IdempotencyRecord"');
    expect(lockSql[1]).not.toContain('"IdempotencyRecord"');
    expect(lockSql[2]).toContain('"IdempotencyRecord"');
    expect(receiptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "receipt-a" } }),
    );
    expect(choreCreate).toHaveBeenCalledTimes(1);
    expect(choreCreate.mock.calls[0][0].data).toMatchObject({
      assigned_to: null,
      assigned_member_id: baseMember.id,
      icon: "shoes",
      routine: "Morning",
      routine_order: 1,
    });
    expect(result.body).toMatchObject({
      chore: { icon: "shoes", routine: "Morning", routine_order: 1 },
    });
  });

  it("returns a completed receipt DTO without creating another chore", async () => {
    const stored = { chore: { id: "chore-a", title: "Put away shoes" } };
    const choreCreate = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "parent-a",
          family_id: "family-a",
          role: "parent",
        }),
      },
      idempotencyRecord: {
        findFirst: jest.fn().mockResolvedValue({
          response_status: 200,
          response_body: stored,
        }),
        update: jest.fn(),
      },
      householdMember: { findFirst: jest.fn() },
      chore: { create: choreCreate },
    };
    const result = await createProfileOnlyChoreEffect(
      {
        $transaction: async (callback: (value: typeof tx) => unknown) =>
          callback(tx),
      } as never,
      {
        id: "parent-a",
        familyId: "family-a",
      },
      profileChoreCreateSchema.parse({
        protocol: 2,
        selection: { memberId: baseMember.id },
        title: "Put away shoes",
        due_date: "2026-10-11",
        frequency: "once",
      }),
      new Date("2026-10-11T00:00:00.000Z"),
      null,
      "receipt-a",
    );

    expect(result).toEqual({ status: 200, body: stored });
    expect(choreCreate).not.toHaveBeenCalled();
  });

  it("uses the shared today-somewhere boundary for profile completion", async () => {
    const now = new Date("2026-10-11T00:30:00.000Z");
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      chore: {
        findFirst: jest.fn().mockResolvedValue({
          id: "chore-a",
          family_id: "family-a",
          title: "Put away shoes",
          assigned_to: null,
          assigned_member_id: baseMember.id,
          member_subject_erased: false,
          due_date: new Date("2026-10-10T00:00:00.000Z"),
          status: "pending",
          frequency: "once",
          recurrence_id: null,
          is_template: false,
          rotation_member_ids: [],
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      householdMember: { findFirst: jest.fn().mockResolvedValue(baseMember) },
      deviceAuditEvent: {
        create: jest.fn().mockResolvedValue({ id: "audit-a" }),
      },
    };

    const result = await completeProfileChoreInTx(
      {
        $transaction: async (callback: (value: typeof tx) => unknown) =>
          callback(tx),
      } as never,
      {
        choreId: "chore-a",
        familyId: "family-a",
        memberId: baseMember.id,
        deviceId: "device-a",
        now,
      },
    );

    expect(result).toBe("completed");
    expect(tx.chore.updateMany).toHaveBeenCalled();
  });

  it("finds the matching completion audit when a newer audit belongs to another chore", async () => {
    const now = new Date("2026-10-11T12:00:00.000Z");
    const matchingAuditAt = new Date("2026-10-11T11:59:00.000Z");
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      chore: {
        findFirst: jest.fn().mockResolvedValue({
          id: "chore-a",
          assigned_to: null,
          assigned_member_id: baseMember.id,
          member_subject_erased: false,
          status: "completed",
          completed_at: matchingAuditAt,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      householdMember: { findFirst: jest.fn().mockResolvedValue(baseMember) },
      deviceAuditEvent: {
        findMany: jest.fn().mockResolvedValue([
          {
            created_at: new Date("2026-10-11T11:59:30.000Z"),
            metadata: { action: "chore_complete", targetId: "chore-b" },
          },
          {
            created_at: matchingAuditAt,
            metadata: { action: "chore_complete", targetId: "chore-a" },
          },
        ]),
        create: jest.fn().mockResolvedValue({ id: "audit-undo" }),
      },
    };

    const result = await reopenProfileChoreInTx(
      {
        $transaction: async (callback: (value: typeof tx) => unknown) =>
          callback(tx),
      } as never,
      {
        choreId: "chore-a",
        familyId: "family-a",
        memberId: baseMember.id,
        deviceId: "device-a",
        now,
        windowMs: 2 * 60 * 1000,
      },
    );

    expect(result).toBe("reopened");
    expect(tx.chore.updateMany).toHaveBeenCalled();
  });

  it("keeps the database trigger aligned with profile role and age rules", () => {
    const migration = readFileSync(
      resolve(
        __dirname,
        "../../../database/migration-zzz-profile-chore-vertical-slice.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("role NOT IN ('child', 'teen', 'parent')");
    expect(migration).toContain("role = 'teen' AND (age < 13 OR age > 17)");
    expect(migration).toContain("role = 'parent' AND (age < 18 OR age > 120)");
  });
});
