// Authored UNRUN. Shared-handler strict routes only; no actual SQL/isolation proof.
jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/rate-limit-db", () => require("@/__tests__/helpers/two-household").rateLimitMock);
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));
jest.mock("@/lib/beta-metrics", () => ({ recordBetaMetric: jest.fn(async () => undefined) }));
jest.mock("@/lib/notifications-server", () => ({ notificationServiceServer: { sendNotification: jest.fn(async () => true) } }));
jest.mock("@/lib/reward-action-command", () => ({ ...jest.requireActual("@/lib/reward-action-command"), rewardActionCommandsEnabled: jest.fn(() => true), checkRewardActionSourceInTx: jest.fn(async () => null) }));
import { POST as claim } from "../claim/owned/route";
import { POST as approve } from "../approve/owned/route";
import { db, req, FAMILY_A } from "@/__tests__/helpers/two-household";
import { checkRewardActionSourceInTx, rewardActionCommandsEnabled, REWARD_ACTION_PROTOCOL } from "@/lib/reward-action-command";
const check = jest.mocked(checkRewardActionSourceInTx); const enabled = jest.mocked(rewardActionCommandsEnabled);
const generation = "5b58743a-1f01-40fe-adb1-4628148495cb";
const key = "5860e58e-8fbf-441b-a416-b8de07de13dc";
const packet = () => ({ protocol: REWARD_ACTION_PROTOCOL, kind: "claim", rewardId: "reward-a", sourceGeneration: generation, issuedAt: Date.now() - 1000, expectedCost: 10, owner: { userId: "child-a", familyId: FAMILY_A, role: "child", generation: 0 } });
beforeEach(() => { db.reset(); enabled.mockReturnValue(true); check.mockReset().mockResolvedValue(null); db.find("family", FAMILY_A)!.features = { rewards: true, gamification: true }; db.find("reward", "reward-a")!.notification_generation = generation; });
it("shares the canonical claim/XP mutation with an exact original packet", async () => {
  const response = await claim(req({ as: "childA", body: packet(), headers: { "Idempotency-Key": key } }));
  expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("X-Herewoven-Reward-Protocol")).toBe(REWARD_ACTION_PROTOCOL);
  expect(db.find("reward", "reward-a")!.status).toBe("claimed"); expect(check).toHaveBeenCalled();
});
it("refuses a changed owner and a missing key before source mutation", async () => {
  const changed = { ...packet(), owner: { ...packet().owner, generation: 3 } };
  expect((await claim(req({ as: "childA", body: changed, headers: { "Idempotency-Key": key } }))).status).toBe(409);
  expect((await claim(req({ as: "childA", body: packet() }))).status).toBe(400);
  expect(db.find("reward", "reward-a")!.status).toBe("available"); expect(check).not.toHaveBeenCalled();
});
it("holds a changed source before XP or status effects", async () => {
  check.mockResolvedValue({ status: 409, body: { code: "REWARD_COMMAND_SOURCE_CHANGED" } });
  const xp = db.find("user", "child-a")!.xp;
  const response = await claim(req({ as: "childA", body: packet(), headers: { "Idempotency-Key": key } }));
  expect(response.status).toBe(409); expect(db.find("user", "child-a")!.xp).toBe(xp); expect(db.find("reward", "reward-a")!.status).toBe("available");
});
it("does not use legacy mode when disabled or when sent an unversioned body", async () => {
  enabled.mockReturnValue(false); expect((await claim(req({ as: "childA", body: packet() }))).status).toBe(503);
  enabled.mockReturnValue(true); expect((await claim(req({ as: "childA", body: { rewardId: "reward-a" }, headers: { "Idempotency-Key": key } }))).status).toBe(400);
  expect(db.find("reward", "reward-a")!.status).toBe("available");
});
it("requires current parent authority for strict approval regardless of claimed owner", async () => {
  const claimPacket = packet(); const { expectedCost: _cost, ...common } = claimPacket;
  expect((await approve(req({ as: "childA", body: { ...common, kind: "approve", expectedClaimantId: "child-a" }, headers: { "Idempotency-Key": key } }))).status).toBe(403);
});
