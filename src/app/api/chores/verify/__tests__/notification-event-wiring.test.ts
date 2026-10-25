// Authored UNRUN. Route wiring uses fake Prisma, not real rollback/SQL proof.
jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/rate-limit-db", () => require("@/__tests__/helpers/two-household").rateLimitMock);
jest.mock("@/lib/notifications-server", () => ({ notificationServiceServer: { sendNotification: jest.fn(async () => true) } }));
jest.mock("@/lib/chore-check-notification-event", () => ({ choreCheckNotificationDispatchWindow: jest.fn(() => 60000), lockChoreCheckNotificationParticipants: jest.fn(async () => undefined), deliverChoreCheckNotificationEventInTx: jest.fn(async () => ({ kind: "created", notificationId: "notice-a" })) }));
import { POST } from "../route";
import { db, req, fakePrisma } from "@/__tests__/helpers/two-household";
import { notificationServiceServer } from "@/lib/notifications-server";
import { choreCheckNotificationDispatchWindow, lockChoreCheckNotificationParticipants, deliverChoreCheckNotificationEventInTx } from "@/lib/chore-check-notification-event";
const mode = jest.mocked(choreCheckNotificationDispatchWindow);
const locks = jest.mocked(lockChoreCheckNotificationParticipants);
const deliver = jest.mocked(deliverChoreCheckNotificationEventInTx);
const send = jest.mocked(notificationServiceServer.sendNotification);
beforeEach(() => {
  db.reset(); mode.mockReturnValue(60000); locks.mockReset().mockResolvedValue(undefined); deliver.mockReset().mockResolvedValue({ kind: "created", notificationId: "notice-a" }); send.mockClear();
  const chore = db.find("chore", "chore-a")!;
  chore.status = "completed"; chore.responsibility_generation = "f2487353-a64d-4ebc-bf8d-9de31e08662e";
});
it("composes a fresh approval notice with its accepted activity and never sends again on unchanged-state replay", async () => {
  expect((await POST(req({ as: "parentA", body: { choreId: "chore-a" } }))).status).toBe(200);
  expect(deliver).toHaveBeenCalledTimes(1);
  const [tx, actor, input] = deliver.mock.calls[0];
  expect(tx).toBe(fakePrisma); expect(actor).toMatchObject({ userId: "parent-a", tokenVersion: 0 });
  expect(input).toMatchObject({ choreId: "chore-a", decision: "approve", recipientId: "child-a", activityId: expect.any(String) });
  const fact = db.find("activity", input.activityId)!;
  expect(fact).toMatchObject({ type: "chore_verified", user_id: "parent-a" });
  expect(input.activityAt).toEqual(fact.created_at);
  expect(send).not.toHaveBeenCalled();
  await POST(req({ as: "parentA", body: { choreId: "chore-a" } }));
  expect(deliver).toHaveBeenCalledTimes(1); expect(send).not.toHaveBeenCalled();
});
it("gives a later accepted rejection a different activity identity after a real new completion state", async () => {
  await POST(req({ as: "parentA", body: { choreId: "chore-a", decision: "reject" } }));
  await POST(req({ as: "parentA", body: { choreId: "chore-a", decision: "reject" } }));
  expect(deliver).toHaveBeenCalledTimes(1);
  db.find("chore", "chore-a")!.status = "completed";
  await POST(req({ as: "parentA", body: { choreId: "chore-a", decision: "reject" } }));
  expect(deliver).toHaveBeenCalledTimes(2);
  expect(deliver.mock.calls[0][2].activityId).not.toBe(deliver.mock.calls[1][2].activityId);
  expect(send).not.toHaveBeenCalled();
});
it("holds an original session revoked while participants are locked", async () => {
  locks.mockImplementation(async () => { db.find("user", "parent-a")!.token_version = 1; });
  expect((await POST(req({ as: "parentA", body: { choreId: "chore-a" } }))).status).toBe(401);
  expect(deliver).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  expect(db.find("chore", "chore-a")!.status).toBe("completed");
});
it("holds a changed assignee rather than acquiring a new recipient after source locks", async () => {
  locks.mockImplementation(async () => { db.find("chore", "chore-a")!.assigned_to = "parent-a"; });
  expect((await POST(req({ as: "parentA", body: { choreId: "chore-a", decision: "reject" } }))).status).toBe(409);
  expect(deliver).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
});
it("keeps the old best-effort sender in default mode", async () => {
  mode.mockReturnValue(null);
  expect((await POST(req({ as: "parentA", body: { choreId: "chore-a" } }))).status).toBe(200);
  expect(deliver).not.toHaveBeenCalled(); expect(send).toHaveBeenCalled();
});
