// Authored UNRUN: original-owner read routing/projection only, not SQL proof.
jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/rate-limit-db", () => require("@/__tests__/helpers/two-household").rateLimitMock);
jest.mock("@/lib/reward-action-command", () => ({ ...jest.requireActual("@/lib/reward-action-command"), rewardActionCommandsEnabled: () => true }));
jest.mock("@/lib/reward-read-access", () => ({ withRewardReadAccess: jest.fn() }));
jest.mock("@/lib/reward-response", () => ({ protectRewardResponse: async (_db: unknown, _actor: unknown, _parent: unknown, response: unknown) => response }));
import { GET } from "../owned/route";
import { db, req, FAMILY_A } from "@/__tests__/helpers/two-household";
import { withRewardReadAccess } from "@/lib/reward-read-access";
import { REWARD_ACTION_OWNER_HEADER } from "@/lib/reward-action-shared";
const read = jest.mocked(withRewardReadAccess);
const owner = { userId: "child-a", familyId: FAMILY_A, role: "child", generation: 0 };
beforeEach(() => { db.reset(); read.mockReset().mockResolvedValue({ kind: "data", value: [] }); });
it("echoes matching original owner and neutral missing-target data privately", async () => {
  const response = await GET(req({ as: "childA", query: { rewardId: "reward-a" }, headers: { [REWARD_ACTION_OWNER_HEADER]: JSON.stringify(owner) } }));
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ owner, rewards: [] });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect(read).toHaveBeenCalled();
});
it("refuses a different original owner before reading any target", async () => {
  const response = await GET(req({ as: "childA", query: { rewardId: "reward-a" }, headers: { [REWARD_ACTION_OWNER_HEADER]: JSON.stringify({ ...owner, generation: 2 }) } }));
  expect(response.status).toBe(409); expect(read).not.toHaveBeenCalled();
});
