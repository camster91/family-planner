import {
  FAMILY_CODE_ALPHABET,
  FAMILY_CODE_LENGTH,
  createFamilyInviteCode,
  createInviteToken,
  formatFamilyCode,
  isInviteCodeCollision,
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

describe("normalizeInviteCode: typed and displayed forms", () => {
  it("ignores case, spaces and dashes for a new 12-character code", () => {
    for (const typed of [
      "K7QM-4XPD-2HNA",
      "k7qm-4xpd-2hna",
      "k7qm 4xpd 2hna",
      "  K7QM 4XPD-2HNA ",
      "k7qm4xpd2hna",
      "K7QM\t4XPD\n2HNA",
    ]) {
      expect(normalizeInviteCode(typed)).toBe("k7qm4xpd2hna");
    }
  });

  it("keeps old 24-character and cuid codes exactly, in any case or grouping", () => {
    const o34 = "usm7ghmbcypks2c29m9mdeha";
    expect(normalizeInviteCode(o34)).toBe(o34);
    expect(normalizeInviteCode(o34.toUpperCase())).toBe(o34);
    expect(normalizeInviteCode("usm7 ghmb cypk s2c2 9m9m deha")).toBe(o34);
    const cuid = "clx0o1l9abcdefghijk012345";
    expect(normalizeInviteCode(cuid)).toBe(cuid);
    expect(normalizeInviteCode(formatFamilyCode(cuid))).toBe(cuid);
  });

  it("does not remap look-alikes (old cuid codes contain 0/o/1/l)", () => {
    expect(normalizeInviteCode("c0o1l0o1l0o1")).toBe("c0o1l0o1l0o1");
  });

  it("rejects other punctuation, too-long input and too-short codes", () => {
    expect(normalizeInviteCode("k7qm.4xpd.2hna")).toBeNull();
    expect(normalizeInviteCode("k7qm/4xpd")).toBeNull();
    expect(normalizeInviteCode("a".repeat(65))).toBeNull();
    expect(normalizeInviteCode("k7qm-4xp")).toBeNull(); // 7 after the dash goes
    expect(normalizeInviteCode("- - - - - - - - -")).toBeNull();
  });
});

describe("createFamilyInviteCode", () => {
  it("makes 12 characters from the unambiguous alphabet", () => {
    expect(FAMILY_CODE_LENGTH).toBe(12);
    expect(FAMILY_CODE_ALPHABET).toHaveLength(31);
    expect(FAMILY_CODE_ALPHABET).not.toMatch(/[01ilo]/);
    for (let i = 0; i < 200; i++) {
      const code = createFamilyInviteCode();
      expect(code).toMatch(/^[a-hjkmnp-z2-9]{12}$/);
      expect(normalizeInviteCode(code)).toBe(code);
    }
  });

  it("uses every symbol and repeats rarely", () => {
    const codes = Array.from({ length: 500 }, () => createFamilyInviteCode());
    expect(new Set(codes).size).toBe(codes.length);
    const seen = new Set(codes.join(""));
    expect([...seen].sort().join("")).toBe([...FAMILY_CODE_ALPHABET].sort().join(""));
  });

  it("skips bytes that would bias the alphabet", () => {
    const crypto = require("crypto");
    const spy = jest
      .spyOn(crypto, "randomBytes")
      .mockReturnValueOnce(Buffer.alloc(24, 255)) // all >= 248: discarded
      .mockReturnValueOnce(Buffer.from(Array.from({ length: 24 }, (_, i) => i)));
    expect(createFamilyInviteCode()).toBe(FAMILY_CODE_ALPHABET.slice(0, 12));
    spy.mockRestore();
  });
});

describe("formatFamilyCode", () => {
  it("shows a new code uppercase as XXXX-XXXX-XXXX", () => {
    expect(formatFamilyCode("k7qm4xpd2hna")).toBe("K7QM-4XPD-2HNA");
    expect(formatFamilyCode("K7QM-4XPD-2HNA")).toBe("K7QM-4XPD-2HNA");
  });

  it("groups old codes in 4s, unchanged and lowercase", () => {
    expect(formatFamilyCode("usm7ghmbcypks2c29m9mdeha")).toBe(
      "usm7 ghmb cypk s2c2 9m9m deha",
    );
    expect(formatFamilyCode("clx0o1l9abcdefghijk012345")).toBe(
      "clx0 o1l9 abcd efgh ijk0 1234 5",
    );
  });

  it("round-trips through normalizeInviteCode", () => {
    for (const code of [createFamilyInviteCode(), "usm7ghmbcypks2c29m9mdeha"]) {
      expect(normalizeInviteCode(formatFamilyCode(code))).toBe(code);
    }
  });

  it("leaves something that is not a code as it is", () => {
    expect(formatFamilyCode("x")).toBe("x");
  });
});

describe("isInviteCodeCollision", () => {
  it("is true only for a Prisma unique-constraint error", () => {
    expect(isInviteCodeCollision(Object.assign(new Error("dup"), { code: "P2002" }))).toBe(true);
    expect(isInviteCodeCollision(Object.assign(new Error("x"), { code: "P2025" }))).toBe(false);
    expect(isInviteCodeCollision(new Error("x"))).toBe(false);
    expect(isInviteCodeCollision(null)).toBe(false);
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
  it("trims and lower-cases the email before checking its format", () => {
    const parsed = createEmailInviteSchema.safeParse({
      email: "  Alex@Example.COM ",
      role: "teen",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.email).toBe("alex@example.com");
    expect(
      createEmailInviteSchema.safeParse({ email: "   ", role: "teen" }).success,
    ).toBe(false);
  });

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
