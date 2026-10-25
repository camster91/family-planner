// Authored UNRUN. Shared-handler/strict-path source, not real CAS/SQL proof.
jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/rate-limit-db", () => require("@/__tests__/helpers/two-household").rateLimitMock);
jest.mock("@/lib/notifications-server", () => ({ notificationServiceServer: { sendNotification: jest.fn(async () => true) } }));
jest.mock("@/lib/chore-check-command", () => ({ ...jest.requireActual("@/lib/chore-check-command"), choreCheckCommandsEnabled: jest.fn(() => true), lockOriginalChoreCheckInTx: jest.fn() }));
jest.mock("@/lib/chore-check-notification-event", () => ({ choreCheckNotificationDispatchWindow: () => null, lockChoreCheckNotificationParticipants: async () => undefined, deliverChoreCheckNotificationEventInTx: jest.fn() }));
import { POST } from "../route";
import { db, req, FAMILY_A } from "@/__tests__/helpers/two-household";
import { choreCheckCommandsEnabled, lockOriginalChoreCheckInTx } from "@/lib/chore-check-command";
import { CHORE_CHECK_COMMAND_PROTOCOL, choreCheckSnapshot, sameChoreCheckSnapshot } from "@/lib/chore-check-command-shared";
const enabled = jest.mocked(choreCheckCommandsEnabled);
const lock = jest.mocked(lockOriginalChoreCheckInTx);
const generation = "5b58743a-1f01-40fe-adb1-4628148495cb";
const expected = { generation, materialEpoch: 2, completionEpoch: 7 };
const command = { protocol: CHORE_CHECK_COMMAND_PROTOCOL, owner: { userId: "parent-a", familyId: FAMILY_A, role: "parent", generation: 0 }, choreId: "chore-a", expected, decision: "approve" };
beforeEach(() => {
  db.reset(); enabled.mockReturnValue(true); lock.mockReset();
  Object.assign(db.find("chore", "chore-a")!, { status: "completed", responsibility_generation: generation, responsibility_epoch: 2, preparation_epoch: 7 });
  lock.mockImplementation(async (_tx, family, id, review) => {
    const current = db.find("chore", id); const snapshot = current && choreCheckSnapshot(current);
    return Boolean(current?.family_id === family && snapshot && sameChoreCheckSnapshot(snapshot, review));
  });
});
it("uses the shared canonical mutation only for the exact original reviewed completion", async () => {
  const response = await POST(req({ as: "parentA", body: command }));
  expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(db.find("chore", "chore-a")!.status).toBe("verified");
  expect(lock).toHaveBeenCalledWith(expect.anything(), FAMILY_A, "chore-a", expected);
});
it("holds an old command after a later completion cycle without changing status or XP", async () => {
  db.find("chore", "chore-a")!.preparation_epoch = 9;
  const xp = db.find("user", "child-a")!.xp;
  const response = await POST(req({ as: "parentA", body: { ...command, decision: "reject" } }));
  expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "CHORE_CHECK_CHANGED" });
  expect(db.find("chore", "chore-a")!.status).toBe("completed"); expect(db.find("user", "child-a")!.xp).toBe(xp);
});
it("refuses a different owner before attempting the source guard", async () => {
  const response = await POST(req({ as: "parentA", body: { ...command, owner: { ...command.owner, familyId: "other-family" } } }));
  expect(response.status).toBe(409); expect(lock).not.toHaveBeenCalled();
});
it("does not fall back to legacy mode when disabled or malformed", async () => {
  enabled.mockReturnValue(false);
  expect((await POST(req({ as: "parentA", body: command }))).status).toBe(503);
  enabled.mockReturnValue(true);
  expect((await POST(req({ as: "parentA", body: { ...command, expected: undefined } }))).status).toBe(400);
  expect(lock).not.toHaveBeenCalled(); expect(db.find("chore", "chore-a")!.status).toBe("completed");
});
it("requires a current authenticated parent independent of the claimed owner", async () => {
  expect((await POST(req({ as: "childA", body: command }))).status).toBe(403);
  expect(lock).not.toHaveBeenCalled();
});
