import {
  accountSubjectSchema,
  authenticatedActorSchema,
  checkMemberSubjectProtocol,
  legacyAccountSelectionSchema,
  memberActionContextSchema,
  profileSelectionSchema,
  profileSubjectSchema,
} from "@/lib/member-subject-contract";

const familyId = "family-a";

describe("name-only member actor and subject contract", () => {
  it.each([
    ["child", 3],
    ["teen", 13],
    ["parent", 42],
  ] as const)(
    "accepts %s as presentation metadata without changing actor authority",
    (role, age) => {
      const subject = profileSubjectSchema.parse({
        kind: "profile",
        memberId: `hm-${role}`,
        familyId,
        name: `${role} fixture`,
        role,
        age,
      });
      const actor = authenticatedActorSchema.parse({
        kind: "person",
        userId: "user-parent",
        familyId,
        role: "parent",
      });

      expect(subject).toMatchObject({ kind: "profile", role, age });
      expect(actor).toMatchObject({ kind: "person", role: "parent" });
      expect(subject).not.toHaveProperty("userId");
    },
  );

  it("accepts an unknown age for every presentation role but rejects incompatible supplied ages", () => {
    for (const role of ["child", "teen", "parent"] as const) {
      expect(() =>
        profileSubjectSchema.parse({
          kind: "profile",
          memberId: `hm-${role}`,
          familyId,
          name: role,
          role,
          age: null,
        }),
      ).not.toThrow();
    }
    expect(() =>
      profileSubjectSchema.parse({
        kind: "profile",
        memberId: "hm-parent",
        familyId,
        name: "Adult",
        role: "parent",
        age: 17,
      }),
    ).toThrow();
    expect(() =>
      profileSubjectSchema.parse({
        kind: "profile",
        memberId: "hm-teen",
        familyId,
        name: "Teen",
        role: "teen",
        age: 12,
      }),
    ).toThrow();
  });

  it("keeps protocol 1 account-compatible and refuses a profile subject without translating it", () => {
    const account = accountSubjectSchema.parse({
      kind: "account",
      accountId: "user-child",
      familyId,
      name: "Account child",
    });
    const profile = profileSubjectSchema.parse({
      kind: "profile",
      memberId: "hm-child",
      familyId,
      name: "Tablet child",
      role: "child",
      age: 3,
    });

    expect(checkMemberSubjectProtocol(1, account)).toEqual({ supported: true });
    expect(checkMemberSubjectProtocol(2, account)).toEqual({ supported: true });
    expect(checkMemberSubjectProtocol(1, profile)).toMatchObject({
      supported: false,
      code: "MEMBER_PROTOCOL_UNAVAILABLE",
      recovery: "refresh-and-retain-pending",
    });
    expect(checkMemberSubjectProtocol(2, profile)).toEqual({ supported: true });
  });

  it("keeps legacy actingMemberId separate from protocol-2 memberId", () => {
    expect(
      legacyAccountSelectionSchema.safeParse({ actingMemberId: "user-child" })
        .success,
    ).toBe(true);
    expect(
      profileSelectionSchema.safeParse({ memberId: "hm-child" }).success,
    ).toBe(true);
    expect(
      profileSelectionSchema.safeParse({ actingMemberId: "user-child" })
        .success,
    ).toBe(false);
    expect(
      profileSelectionSchema.safeParse({
        memberId: "user-child",
        actingMemberId: "user-parent",
      }).success,
    ).toBe(false);
  });

  it("requires protocol 2 for profile attribution and keeps device credentials separate", () => {
    const profile = {
      kind: "profile" as const,
      memberId: "hm-child",
      familyId,
      name: "Child",
      role: "child" as const,
      age: 3,
    };
    const device = { kind: "device" as const, deviceId: "device-a", familyId };

    expect(
      memberActionContextSchema.safeParse({
        actor: device,
        subject: profile,
        protocol: 1,
      }).success,
    ).toBe(false);
    expect(
      memberActionContextSchema.safeParse({
        actor: device,
        subject: profile,
        protocol: 2,
      }).success,
    ).toBe(true);
    expect(
      memberActionContextSchema.safeParse({
        actor: { kind: "device", deviceId: "device-a", familyId: "family-b" },
        subject: profile,
        protocol: 2,
      }).success,
    ).toBe(false);
    expect(
      memberActionContextSchema.safeParse({
        actor: {
          kind: "person",
          userId: "user-parent",
          familyId: "family-b",
          role: "parent",
        },
        subject: profile,
        protocol: 2,
      }).success,
    ).toBe(false);
    const accepted = memberActionContextSchema.safeParse({
      actor: device,
      subject: profile,
      protocol: 2,
    });
    expect(accepted.success).toBe(true);
    if (accepted.success)
      expect(accepted.data.actor).not.toHaveProperty("userId");
  });

  it("does not compare a profile presentation role with the authenticated person role", () => {
    const result = memberActionContextSchema.safeParse({
      actor: { kind: "person", userId: "user-teen", familyId, role: "teen" },
      subject: {
        kind: "profile",
        memberId: "hm-parent-label",
        familyId,
        name: "Parent profile",
        role: "parent",
        age: 40,
      },
      protocol: 2,
    });
    expect(result.success).toBe(true);
  });
});
