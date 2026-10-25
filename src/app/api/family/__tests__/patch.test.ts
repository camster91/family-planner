// PATCH /api/family: a parent renames the household. The plan
// (subscription_tier) is billing state and cannot be switched here, and the
// response never echoes the feed token, invite code or AI key.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));

import { PATCH as patchName } from "@/app/api/family/name/route";
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

// Strict rename/revocation source cases authored UNRUN; fixtures only.
describe('strict family name intent', () => {
  beforeEach(() => db.reset());
  it('refuses an old base name instead of overwriting another rename', async () => {
    familyA().name = 'Changed elsewhere';
    const response = await patchName(req({ as: 'parentA', method: 'PATCH', body: { name_protocol: 1, familyId: FAMILY_A, baseName: 'Before', name: 'My draft' } }));
    expect(response.status).toBe(409);
    expect(await bodyOf(response)).toMatchObject({ code: 'FAMILY_NAME_CHANGED' });
    expect(familyA().name).toBe('Changed elsewhere'); expect(db.writes).toHaveLength(0);
  });
  it('confirms an already-matching uncertain retry without writing again', async () => {
    familyA().name = 'My draft';
    const response = await patchName(req({ as: 'parentA', method: 'PATCH', body: { name_protocol: 1, familyId: FAMILY_A, baseName: 'Before', name: 'My draft' } }));
    expect(response.status).toBe(200);
    expect((await bodyOf(response)).family.name).toBe('My draft');
    expect(db.writes).toHaveLength(0);
  });
  it.each([['role', 'child', 403], ['family_id', 'family-B', 403], ['token_version', 1, 401]])('renews %s after body waits before the family write', async (field, value, status) => {
    const before = familyA().name;
    const input = req({ as: 'parentA', method: 'PATCH', body: { name_protocol: 1, familyId: FAMILY_A, baseName: before, name: 'Must not save' } });
    const decode = input.json;
    input.json = async () => { db.find('user', 'parent-a')![field] = value; return decode(); };
    const response = await patchName(input);
    expect(response.status).toBe(status);
    expect(familyA().name).toBe(before); expect(db.writes).toHaveLength(0);
  });
  it('requires the modern base/protocol and bounds decoding before effects', async () => {
    expect((await patchName(req({ as: 'parentA', method: 'PATCH', body: { familyId: FAMILY_A, name: 'No base' } }))).status).toBe(400);
    const input = req({ as: 'parentA', method: 'PATCH', headers: { 'content-length': '8193' }, body: {} });
    input.json = jest.fn();
    expect((await patchName(input)).status).toBe(413);
    expect(input.json).not.toHaveBeenCalled(); expect(db.writes).toHaveLength(0);
  });
});
