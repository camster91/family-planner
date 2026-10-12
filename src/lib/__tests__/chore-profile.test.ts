import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  completeProfileChoreInTx,
  reopenProfileChoreInTx,
} from "@/lib/chore-profile-actions";
import {
  isProfileChoreEnabled,
  profileChoreCreateSchema,
  profileChoreReadRefusal,
  profileChoreProtocolRefusal,
  PROFILE_CHORE_ROLLBACK_READY_ENV,
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

  afterEach(() => {
    if (originalGate === undefined)
      delete process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED;
    else process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED = originalGate;
    if (originalRollbackGate === undefined)
      delete process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY;
    else process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY = originalRollbackGate;
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

  it("requires protocol 2 for profile creation and rejects recurring fields", () => {
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
        frequency: "weekly",
      }).success,
    ).toBe(false);
    expect(
      profileChoreCreateSchema.safeParse({
        protocol: 2,
        selection: { memberId: "member-child" },
        title: "Routine profile chore",
        due_date: "2026-10-11",
        routine: "Bedtime",
      }).success,
    ).toBe(false);
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
