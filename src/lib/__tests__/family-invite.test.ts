import { normalizeInviteCode } from "@/lib/family-invite";
import { joinFamilySchema } from "@/lib/validations";

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

describe("joinFamilySchema", () => {
  it("requires inviteCode", () => {
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
});
