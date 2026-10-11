import {
  isProfileChoreEnabled,
  profileChoreCreateSchema,
  profileChoreReadRefusal,
  profileChoreProtocolRefusal,
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

  afterEach(() => {
    if (originalGate === undefined)
      delete process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED;
    else process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED = originalGate;
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
});
