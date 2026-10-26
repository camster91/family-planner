// Authored UNRUN: late authority loss never discloses the saved envelope.
jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("@/lib/reward-mutations", () => ({ authorizeRewardReplay: jest.fn(), authorizeRewardActorInTx: jest.fn() }));
import { NextResponse } from "next/server";
import { authorizeRewardActorInTx, authorizeRewardReplay } from "../reward-mutations";
import { protectRewardResponse } from "../reward-response";
const renew = jest.mocked(authorizeRewardReplay);
const actor = { userId: "fixture-parent", familyId: "fixture-family", role: "parent", tokenVersion: 2 };
beforeEach(() => { renew.mockReset(); jest.mocked(authorizeRewardActorInTx).mockReset(); });
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

it("does not imply a write occurred when a readonly response loses access", async () => {
  renew.mockResolvedValue({ status: 401, body: {} });
  const response = await protectRewardResponse({} as any, actor, false, NextResponse.json({ rewards: [{ name: "Private fixture" }] }), "read");
  const body = await response.json(); expect(body.error).not.toContain("saved"); expect(JSON.stringify(body)).not.toContain("Private fixture");
});

it("preserves a source-review hold without calling it account-access loss", async () => {
  renew.mockResolvedValue({ status: 409, body: { code: "REWARD_COMMAND_SOURCE_CHANGED" } });
  const response = await protectRewardResponse({} as any, actor, false, NextResponse.json({ reward: { name: "Private fixture" } }));
  expect(await response.json()).toMatchObject({ code: "REWARD_COMMAND_SOURCE_CHANGED" });
});

// Authored source coverage only; no test run during this implementation pass.
it("replaces cached replay relationships with current scoped names and keeps receipt headers", async () => {
  renew.mockResolvedValue(null);
  jest.mocked(authorizeRewardActorInTx).mockResolvedValue(null);
  const findMany = jest.fn().mockResolvedValue([{ id: "creator", family_id: actor.familyId, name: "Current name" }]);
  const tx = { user: { findMany } };
  const db = { $transaction: jest.fn(async (work: (tx: unknown) => unknown) => work(tx)) } as any;
  const original = NextResponse.json({ reward: {
    id: "reward", family_id: actor.familyId, created_by: "creator", claimed_by: "departed",
    creator: { id: "creator", name: "Old name", email: "private@example.invalid" },
    claimer: { id: "departed", name: "Former member" },
  }, xp: 42 }, { headers: { "Idempotency-Replayed": "true", "Content-Length": "999" } });
  const response = await protectRewardResponse(db, actor, true, original);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ reward: {
    id: "reward", family_id: actor.familyId, created_by: "creator", claimed_by: "departed",
    creator: { id: "creator", name: "Current name" }, claimer: null,
  }, xp: 42 });
  expect(response.headers.get("Idempotency-Replayed")).toBe("true");
  expect(response.headers.has("Content-Length")).toBe(false);
  expect(findMany.mock.calls[0][0].where.family_id).toBe(actor.familyId);
  expect(renew).toHaveBeenCalledTimes(2);
});
it("holds a successful legacy snapshot with missing ownership instead of disclosing cached people", async () => {
  renew.mockResolvedValue(null);
  jest.mocked(authorizeRewardActorInTx).mockResolvedValue(null);
  const findMany = jest.fn();
  const db = { $transaction: async (work: (tx: unknown) => unknown) => work({ user: { findMany } }) } as any;
  const response = await protectRewardResponse(db, actor, true, NextResponse.json({ reward: {
    id: "legacy-reward", creator: { name: "Hidden person" },
  } }));
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain("Hidden person");
  expect(findMany).not.toHaveBeenCalled();
});
it("withholds the projected mutation envelope after a final authority loss", async () => {
  renew.mockResolvedValueOnce(null).mockResolvedValueOnce({ status: 401, body: {} });
  jest.mocked(authorizeRewardActorInTx).mockResolvedValue(null);
  const db = { $transaction: async (work: (tx: unknown) => unknown) => work({ user: { findMany: async () => [] } }) } as any;
  const response = await protectRewardResponse(db, actor, true, NextResponse.json({ reward: {
    family_id: actor.familyId, created_by: "creator", claimed_by: null, name: "Private reward",
  }, xp: 42 }));
  expect(response.status).toBe(401);
  const body = await response.json();
  expect(JSON.stringify(body)).not.toContain("Private reward");
  expect(body).not.toHaveProperty("xp");
});
