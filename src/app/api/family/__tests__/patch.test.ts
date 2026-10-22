// PATCH /api/family: a parent renames the household. The plan
// (subscription_tier) is billing state and cannot be switched here, and the
// response never echoes the feed token, invite code or AI key.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));

import { PATCH as patchFamily } from "@/app/api/family/route";
import { bodyOf, db, req, FAMILY_A } from "@/__tests__/helpers/two-household";

const familyA = () => db.rows("family").find((f: any) => f.id === FAMILY_A) as any;

describe("PATCH /api/family", () => {
  it("renames the household and returns only display fields", async () => {
    familyA().capture_ai_key_enc = "enc:secret";

    const res: any = await patchFamily(req({ as: "parentA", method: "PATCH", body: { familyId: FAMILY_A, name: "The A Team" } }));

    expect(res.status).toBe(200);
    const { family } = await bodyOf(res);
    expect(family.name).toBe("The A Team");
    expect(family).not.toHaveProperty("feed_token");
    expect(family).not.toHaveProperty("invite_code");
    expect(family).not.toHaveProperty("capture_ai_key_enc");
    expect(family).not.toHaveProperty("capture_ai_base_url");
  });

  it("ignores a subscription_tier sent by a parent", async () => {
    const before = familyA().subscription_tier;

    const res: any = await patchFamily(
      req({ as: "parentA", method: "PATCH", body: { familyId: FAMILY_A, subscription_tier: "premium" } }),
    );

    expect(res.status).toBe(200);
    expect(familyA().subscription_tier).toBe(before);
    expect(before).not.toBe("premium");
  });
});
