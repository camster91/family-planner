// Authored UNRUN: late authority loss never discloses the saved envelope.
jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("@/lib/reward-mutations", () => ({ authorizeRewardReplay: jest.fn() }));
import { NextResponse } from "next/server";
import { authorizeRewardReplay } from "../reward-mutations";
import { protectRewardResponse } from "../reward-response";
const renew = jest.mocked(authorizeRewardReplay);
const actor = { userId: "fixture-parent", familyId: "fixture-family", role: "parent", tokenVersion: 2 };
beforeEach(() => renew.mockReset());
it("withholds a committed response after original access is revoked", async () => {
  renew.mockResolvedValue({ status: 401, body: { error: "Unauthorized" } });
  const response = await protectRewardResponse({} as any, actor, true, NextResponse.json({ reward: { name: "Private fixture" }, xp: 50 }));
  expect(response.status).toBe(401); expect(JSON.stringify(await response.json())).not.toContain("Private fixture");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
it("treats renewal failure as uncertainty without exposing private response data", async () => {
  renew.mockRejectedValue(new Error("fixture failure"));
  const response = await protectRewardResponse({} as any, actor, false, NextResponse.json({ xp: 50 }));
  expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: "REWARD_ACCESS_UNCONFIRMED" });
});
it("preserves a known refusal without reclassifying it as an uncertain success", async () => {
  const original = NextResponse.json({ error: "This feature is turned off for your family" }, { status: 403 });
  expect(await protectRewardResponse({} as any, actor, true, original)).toBe(original); expect(renew).not.toHaveBeenCalled();
});
