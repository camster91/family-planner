import {
  createInviteToken,
  hashInviteToken,
  normalizeEmail,
  normalizeInviteCode,
  normalizeInviteToken,
} from "@/lib/family-invite";
import { createEmailInviteSchema, joinFamilySchema } from "@/lib/validations";

describe("normalizeInviteCode", () => {
  it("accepts a cuid-shaped invite code", () => {
    expect(normalizeInviteCode("clxyz0123456789abcd")).toBe(
      "clxyz0123456789abcd",
    );
  });

  it("trims whitespace", () => {
    expect(normalizeInviteCode("  clxyz0123456789abcd  ")).toBe(
      "clxyz0123456789abcd",
    );
  });

  it("rejects FAM- prefix codes", () => {
    expect(normalizeInviteCode("FAM-C")).toBeNull();
    expect(normalizeInviteCode("FAM-clxyz012")).toBeNull();
    expect(normalizeInviteCode("fam-ABCD1234")).toBeNull();
  });

  it("rejects short, empty, and non-string values", () => {
    expect(normalizeInviteCode("abc")).toBeNull();
    expect(normalizeInviteCode("")).toBeNull();
    expect(normalizeInviteCode(null)).toBeNull();
    expect(normalizeInviteCode({ inviteCode: "x" })).toBeNull();
  });
});

describe("legacy auth checkRateLimit stub", () => {
  it("throws instead of always allowing", () => {
    const { checkRateLimit } = require("@/lib/auth");
    expect(() => checkRateLimit("lookup:u1")).toThrow(/rate-limit-db/);
  });
});

describe("email invite tokens", () => {
  it("hashes tokens one-way", () => {
    const token = createInviteToken();
    expect(token).toHaveLength(64);
    expect(hashInviteToken(token)).toHaveLength(64);
    expect(hashInviteToken(token)).not.toBe(token);
    expect(hashInviteToken(token)).toBe(hashInviteToken(token));
  });

  it("normalizes emails and tokens", () => {
    expect(normalizeEmail("  Alex@Family.ASHBI.CA ")).toBe(
      "alex@family.ashbi.ca",
    );
    expect(normalizeInviteToken("not-a-token")).toBeNull();
    const token = createInviteToken();
    expect(normalizeInviteToken(token)).toBe(token);
  });
});

describe("joinFamilySchema", () => {
  it("requires inviteCode or token", () => {
    expect(joinFamilySchema.safeParse({}).success).toBe(false);
    expect(joinFamilySchema.safeParse({ familyId: "clfamilyid" }).success).toBe(
      false,
    );
  });

  it("accepts inviteCode and ignores familyId", () => {
    const parsed = joinFamilySchema.safeParse({
      inviteCode: "clxyz0123456789abcd",
      familyId: "should-not-be-enough",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.inviteCode).toBe("clxyz0123456789abcd");
      expect(parsed.data).not.toHaveProperty("familyId");
    }
  });

  it("accepts a 64-character email invite token", () => {
    const token = createInviteToken();
    const parsed = joinFamilySchema.safeParse({ token });
    expect(parsed.success).toBe(true);
  });
});

describe("createEmailInviteSchema", () => {
  it("requires a role and email", () => {
    expect(
      createEmailInviteSchema.safeParse({ email: "a@b.co" }).success,
    ).toBe(false);
    expect(
      createEmailInviteSchema.safeParse({
        email: "alex@example.com",
        role: "parent",
      }).success,
    ).toBe(true);
  });
});
