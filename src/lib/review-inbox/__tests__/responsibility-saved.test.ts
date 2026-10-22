/** @jest-environment jsdom */
/** Authored/unrun adapter coverage; no real storage/server proof. */
import { readSavedReviewRequests } from "../saved-requests";
import { readResponsibilityContext } from "@/lib/responsibility-client";
import { RESPONSIBILITY_RECOVERY } from "@/lib/responsibility-recovery";
import { RESPONSIBILITY_PROTOCOL } from "@/lib/responsibility";
const mockStores = [{ read: jest.fn(), write: jest.fn(), remove: jest.fn() }];
jest.mock("@/lib/responsibility-client", () => ({
  readResponsibilityContext: jest.fn(),
}));
jest.mock("@/lib/event-preparation/client", () => ({
  readPreparationContext: jest.fn(),
}));
jest.mock("@/lib/calendar-planning/schedule-client", () => ({
  readScheduleContext: jest.fn(),
}));
jest.mock("@/lib/offline-queue", () => ({
  queueStoreCandidates: jest.fn(() => ({
    candidates: mockStores,
    persistenceLane: {},
  })),
}));
jest.mock("@/lib/owned-queue-persistence", () => ({
  ownedQueueLocation: (owner: { scope: string }) => ({
    dbName: "fixture-owned",
    key: owner.scope,
  }),
  withOwnedQueueLease: async (_owner: unknown, run: () => Promise<unknown>) =>
    run(),
  rememberQueueOwner: jest.fn(),
}));
const context = {
  contract: RESPONSIBILITY_RECOVERY,
  enabled: false,
  userId: "parent-a",
  familyId: "family-a",
  role: "parent" as const,
  owner: {
    kind: "person" as const,
    ownerId: "parent-a",
    scope: "a".repeat(64),
    householdScope: "b".repeat(64),
    generation: 3,
  },
};
const command = {
  protocol: RESPONSIBILITY_PROTOCOL,
  userId: context.userId,
  familyId: context.familyId,
  target: { kind: "chore", id: "task-a" },
  sourceToken: "c".repeat(64),
  expectedRevision: 0,
  issuedAt: "2026-10-21T12:00:00.000Z",
  action: "set-backup",
  subject: null,
};
function stored(body = command) {
  return JSON.stringify({
    v: 2,
    envelope: "herewoven.queue-store.v2",
    state: "active",
    owner: context.owner,
    runtime: "responsibility_saved_fixture",
    queue: JSON.stringify({
      contract: RESPONSIBILITY_RECOVERY,
      entries: [
        {
          kind: "responsibility",
          key: "private_request_key",
          body: JSON.stringify(body),
        },
      ],
    }),
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, "indexedDB", { configurable: true, value: {} });
  jest.mocked(readResponsibilityContext).mockResolvedValue(context);
  mockStores[0].read.mockResolvedValue(stored());
});
it("discovers paused own requests without replaying or copying their payload", async () => {
  const result = await readSavedReviewRequests("responsibility", {
    userId: context.userId,
    familyId: context.familyId,
  });
  expect(result).toEqual({
    paused: true,
    items: [
      {
        id: "responsibility-0",
        kind: "responsibility",
        issuedAt: command.issuedAt,
        href: "/dashboard/today?responsibilityKind=chore&responsibilityId=task-a",
      },
    ],
  });
  expect(JSON.stringify(result)).not.toContain("private_request_key");
  expect(JSON.stringify(result)).not.toContain(command.sourceToken);
  expect(mockStores[0].write).not.toHaveBeenCalled();
  expect(mockStores[0].remove).not.toHaveBeenCalled();
});
it("refuses a request copied from another household even in the current owner envelope", async () => {
  mockStores[0].read.mockResolvedValue(
    stored({ ...command, familyId: "family-b" }),
  );
  await expect(
    readSavedReviewRequests("responsibility", {
      userId: context.userId,
      familyId: context.familyId,
    }),
  ).rejects.toMatchObject({ reason: "OWNER_CHANGED" });
});
it("does not use a teen's current context for the parent inbox", async () => {
  jest
    .mocked(readResponsibilityContext)
    .mockResolvedValue({ ...context, role: "teen" });
  await expect(
    readSavedReviewRequests("responsibility", {
      userId: context.userId,
      familyId: context.familyId,
    }),
  ).rejects.toMatchObject({ reason: "OWNER_CHANGED" });
  expect(mockStores[0].read).not.toHaveBeenCalled();
});
