// Two-household + parent-only isolation for the family settings/membership API
// (#102): family, features, ai-settings, feed-token, invites, invites/[id],
// members and travel. lookup has its own test; join and invites/preview are
// token/code-keyed and covered by the account-level tests below.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));
jest.mock("@/lib/rate-limit-db", () => require("@/__tests__/helpers/two-household").rateLimitMock);
jest.mock("@/lib/mail", () => ({
  sendMail: jest.fn(async () => undefined),
  familyInviteEmail: () => ({ subject: "s", html: "h", text: "t" }),
  isMailConfigured: () => true,
}));

import * as family from "../route";
import * as features from "../features/route";
import * as aiSettings from "../ai-settings/route";
import * as feedToken from "../feed-token/route";
import * as invites from "../invites/route";
import { DELETE as revokeInvite } from "../invites/[id]/route";
import { GET as members } from "../members/route";
import * as travel from "../travel/route";
import { db, req, params, writesTo, expectDenied, expectNoForeignData, type UserKey } from "@/__tests__/helpers/two-household";

describe("family settings — two households", () => {
  beforeEach(() => db.reset());

  it("returns 401 to an unauthenticated caller on every handler", async () => {
    const statuses = [
      (await family.GET(req())).status,
      (await family.POST(req({ body: { name: "x" } }))).status,
      (await family.PATCH(req({ body: { familyId: "family-A", name: "x" } }))).status,
      (await family.DELETE(req({ body: { familyId: "family-A" } }))).status,
      (await aiSettings.GET(req())).status,
      (await aiSettings.POST(req({ body: { clear: true } }))).status,
      (await feedToken.GET(req())).status,
      (await feedToken.POST(req({ body: {} }))).status,
      (await invites.GET(req())).status,
      (await invites.POST(req({ body: { email: "x@y.test", role: "child" } }))).status,
      (await revokeInvite(req(), params({ id: "invite-a" }))).status,
    ];
    req({ as: null });
    statuses.push(
      (await features.GET()).status,
      (await features.PATCH(req({ body: { key: "meals", enabled: false } }))).status,
      (await members()).status,
      (await travel.GET()).status,
      (await travel.PATCH(req({ body: { travel_mode_active: false } }))).status
    );
    expect(new Set(statuses)).toEqual(new Set([401]));
    expect(db.writes).toHaveLength(0);
  });

  it("GET /api/family returns only the caller's family and hides the invite code from kids", async () => {
    const parent = await expectNoForeignData(await family.GET(req({ as: "parentA" })));
    expect(parent.family).toMatchObject({ id: "family-A", invite_code: "INVITEA1" });
    const child = await expectNoForeignData(await family.GET(req({ as: "childA" })));
    expect(child.family.invite_code).toBeNull();
  });

  it("a parent cannot rename or delete another family by id", async () => {
    await expectDenied(await family.PATCH(req({ as: "parentA", body: { familyId: "family-B", name: "x" } })));
    await expectDenied(await family.DELETE(req({ as: "parentA", body: { familyId: "family-B" } })));
    expect(db.writes).toHaveLength(0);
    expect(db.find("family", "family-B")).toBeDefined();
  });

  it("a user already in a family cannot create another", async () => {
    expect((await family.POST(req({ as: "parentA", body: { name: "Second" } }))).status).toBe(400);
    expect(writesTo("family")).toHaveLength(0);
  });

  it.each<[UserKey]>([["teenA"], ["childA"]])("%s is refused every parent-only settings handler", async (who) => {
    const statuses = [
      (await family.PATCH(req({ as: who, body: { familyId: "family-A", name: "x" } }))).status,
      (await family.DELETE(req({ as: who, body: { familyId: "family-A" } }))).status,
      (await aiSettings.GET(req({ as: who }))).status,
      (await aiSettings.POST(req({ as: who, body: { clear: true } }))).status,
      (await feedToken.GET(req({ as: who }))).status,
      (await feedToken.POST(req({ as: who, body: { regenerate: true } }))).status,
      (await invites.GET(req({ as: who }))).status,
      (await invites.POST(req({ as: who, body: { email: "x@y.test", role: "child" } }))).status,
      (await revokeInvite(req({ as: who }), params({ id: "invite-a" }))).status,
      (await features.PATCH(req({ as: who, body: { key: "meals", enabled: false } }))).status,
      (await travel.PATCH(req({ as: who, body: { travel_mode_active: false } }))).status,
    ];
    req({ as: who });
    statuses.push((await travel.GET()).status);
    expect(new Set(statuses)).toEqual(new Set([403]));
    expect(db.writes).toHaveLength(0);
  });

  it("kids never see travel plans (parent-only)", async () => {
    req({ as: "teenA" });
    const res = await travel.GET();
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain("Lisbon");
  });

  it("reads and writes only ever target the caller's own family row", async () => {
    const token = await expectNoForeignData(await feedToken.GET(req({ as: "parentA" })));
    expect(token.feedToken).toBe("feed-token-a");
    const inv = await expectNoForeignData(await invites.GET(req({ as: "parentA" })));
    expect(inv.invites.map((i: any) => i.id)).toEqual(["invite-a"]);
    req({ as: "childA" });
    const mem = await expectNoForeignData(await members());
    expect(mem.members.map((m: any) => m.id).sort()).toEqual(["child-a", "parent-a", "teen-a"]);
    req({ as: "parentA" });
    const trip = await expectNoForeignData(await travel.GET());
    expect(trip.travel_destination).toBe("Lisbon");

    await feedToken.POST(req({ as: "parentA", body: { regenerate: true } }));
    await aiSettings.POST(req({ as: "parentA", body: { clear: true } }));
    await features.PATCH(req({ as: "parentA", body: { key: "meals", enabled: false } }));
    await travel.PATCH(req({ as: "parentA", body: { travel_mode_active: false } }));
    for (const w of writesTo("family")) expect(w.args.where).toEqual({ id: "family-A" });
    expect(db.find("family", "family-B")?.feed_token).toBe("feed-token-b");
  });

  it("a parent cannot revoke another family's invite", async () => {
    await expectDenied(await revokeInvite(req({ as: "parentA" }), params({ id: "invite-b" })));
    expect(db.find("familyInvite", "invite-b")).toBeDefined();
    expect((await revokeInvite(req({ as: "parentA" }), params({ id: "invite-a" }))).status).toBe(200);
  });

  it("a new invite is created for the caller's family", async () => {
    const res = await invites.POST(req({ as: "parentA", body: { email: "new@x.test", role: "teen", family_id: "family-B" } }));
    expect(res.status).toBe(200);
    expect(writesTo("familyInvite").find((w) => w.op === "create")?.args.data).toMatchObject({ family_id: "family-A" });
  });
});
