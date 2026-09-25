// Household membership boundaries (#102): joining by emailed invite token or
// invite code, and the public invite preview. A token only ever binds its own
// household, only for the invited email, and never moves someone who already
// belongs to a family.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/rate-limit-db", () => require("@/__tests__/helpers/two-household").rateLimitMock);

import { POST as join } from "../join/route";
import { GET as preview } from "../invites/preview/route";
import { hashInviteToken } from "@/lib/family-invite";
import { db, req, writesTo } from "@/__tests__/helpers/two-household";

const TOKEN_B = "b".repeat(64);

describe("family membership — two households", () => {
  beforeEach(() => {
    db.reset();
    const invite = db.find("familyInvite", "invite-b")!;
    invite.token_hash = hashInviteToken(TOKEN_B);
    invite.email = "loner@example.test";
    invite.role = "teen";
  });

  it("join returns 401 without a session", async () => {
    expect((await join(req({ body: { token: TOKEN_B } }))).status).toBe(401);
    expect(db.writes).toHaveLength(0);
  });

  it("a member of family A cannot use a family-B invite or code to switch households", async () => {
    db.find("familyInvite", "invite-b")!.email = "parent-a@example.test";
    expect((await join(req({ as: "parentA", body: { token: TOKEN_B } }))).status).toBe(400);
    expect((await join(req({ as: "childA", body: { inviteCode: "INVITEB1" } }))).status).toBe(400);
    expect(writesTo("user")).toHaveLength(0);
    expect(db.find("user", "child-a")?.family_id).toBe("family-A");
  });

  it("an invite token only works for the invited email", async () => {
    db.find("familyInvite", "invite-b")!.email = "someone-else@example.test";
    expect((await join(req({ as: "loner", body: { token: TOKEN_B } }))).status).toBe(403);
    expect(db.find("user", "loner")?.family_id).toBeNull();
  });

  it("the invited user joins exactly the inviting household with the invited role", async () => {
    expect((await join(req({ as: "loner", body: { token: TOKEN_B } }))).status).toBe(200);
    expect(db.find("user", "loner")).toMatchObject({ family_id: "family-B", role: "teen" });
    // Single use.
    db.find("user", "loner")!.family_id = null;
    expect((await join(req({ as: "loner", body: { token: TOKEN_B } }))).status).toBe(404);
  });

  it("preview reveals only the invite's own household, and nothing for spent tokens", async () => {
    const res = await preview(req({ query: { token: TOKEN_B } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ familyName: "Household FOREIGN", role: "teen", email: "loner@example.test" });
    db.find("familyInvite", "invite-b")!.accepted_at = new Date();
    expect((await preview(req({ query: { token: TOKEN_B } }))).status).toBe(404);
    expect((await preview(req({ query: { token: "c".repeat(64) } }))).status).toBe(404);
  });
});
