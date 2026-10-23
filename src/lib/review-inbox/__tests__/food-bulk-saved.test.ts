/** @jest-environment jsdom */
/** Authored/unrun. Read-only projection and owner/store race boundaries. */
import { readSavedReviewRequests } from "../saved-requests";
import { readFoodRecoveryContext } from "@/lib/food-planning/client";
import {
  context as foodContext,
  makeEntry as foodRequest,
} from "@/lib/food-planning/__tests__/recovery-fixture";
import { FOOD_RECOVERY } from "@/lib/food-planning/recovery-contract";
import { newFoodDraft } from "@/lib/food-planning/editor";
import { readPrepContext } from "@/lib/meal-prep-recovery/client";
import {
  context as bulkContext,
  entry as bulkRequest,
} from "@/lib/meal-prep-recovery/__tests__/fixture";
import { PREP_RECOVERY } from "@/lib/meal-prep-recovery/contract";
const mockStores = [
  { read: jest.fn(), write: jest.fn(), remove: jest.fn() },
  { read: jest.fn(), write: jest.fn(), remove: jest.fn() },
];
jest.mock("@/lib/food-planning/client", () => ({
  readFoodRecoveryContext: jest.fn(),
}));
jest.mock("@/lib/meal-prep-recovery/client", () => ({
  readPrepContext: jest.fn(),
}));
jest.mock("@/lib/offline-queue", () => ({
  queueStoreCandidates: jest.fn(() => ({ candidates: mockStores })),
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
function stored(contract: string, owner: unknown, entries: unknown[]) {
  return JSON.stringify({
    v: 2,
    envelope: "herewoven.queue-store.v2",
    state: "active",
    owner,
    runtime: "food_bulk_saved_fixture_runtime",
    queue: JSON.stringify({ contract, entries }),
  });
}
function setStores(value: string) {
  mockStores.forEach((store) => store.read.mockResolvedValue(value));
}
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, "indexedDB", { configurable: true, value: {} });
  jest
    .mocked(readFoodRecoveryContext)
    .mockResolvedValue({ ...foodContext(), enabled: false });
  jest
    .mocked(readPrepContext)
    .mockResolvedValue({ ...bulkContext(), enabled: false });
});
afterEach(() => {
  for (const store of mockStores) {
    expect(store.write).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
  }
});
it("projects paused food drafts without copying names, notes, IDs, keys or fabricated timestamps", async () => {
  const draft = newFoodDraft("2026-10-22", "UTC");
  draft.slots[0].name = "PRIVATE FOOD LABEL";
  draft.slots[0].notes = "PRIVATE FOOD NOTE";
  const local = {
    kind: "local-food-draft",
    key: "private_food_draft_key_1234",
    body: JSON.stringify({
      userId: foodContext().userId,
      familyId: foodContext().familyId,
      draft,
    }),
  };
  setStores(stored(FOOD_RECOVERY, foodContext().owner, [local]));
  const result = await readSavedReviewRequests("food", foodContext());
  expect(result).toEqual({
    paused: true,
    items: [
      {
        id: "food-0",
        kind: "food",
        phase: "editing",
        issuedAt: null,
        href: "/dashboard/meals?foodPlan=recovery",
      },
    ],
  });
  for (const privateValue of [
    "PRIVATE FOOD",
    local.key,
    foodContext().userId,
    foodContext().familyId,
  ])
    expect(JSON.stringify(result)).not.toContain(privateValue);
});
it("retains submitted food requests as unchecked and uses the canonical request time when recorded", async () => {
  setStores(stored(FOOD_RECOVERY, foodContext().owner, [foodRequest()]));
  const result = await readSavedReviewRequests("food", foodContext());
  expect(result.items[0]).toMatchObject({
    kind: "food",
    phase: "submitted",
    issuedAt: "2026-10-22T12:00:00.000Z",
    href: "/dashboard/meals?foodPlan=recovery",
  });
});
it("projects bulk pending requests to a target-independent recovery screen during pause", async () => {
  setStores(stored(PREP_RECOVERY, bulkContext().owner, [bulkRequest()]));
  const result = await readSavedReviewRequests("bulk", bulkContext());
  expect(result).toEqual({
    paused: true,
    items: [
      {
        id: "bulk-0",
        kind: "bulk",
        phase: "submitted",
        issuedAt: "2026-10-22T12:00:00.000Z",
        href: "/dashboard/meals?view=bulk&bulkWork=recovery",
      },
    ],
  });
  expect(JSON.stringify(result)).not.toContain("batch-a");
  expect(JSON.stringify(result)).not.toContain(bulkRequest().key);
});
it("refuses non-parent and different-household discovery before projecting private entries", async () => {
  setStores(stored(PREP_RECOVERY, bulkContext().owner, [bulkRequest()]));
  jest
    .mocked(readPrepContext)
    .mockResolvedValueOnce({ ...bulkContext(), role: "teen" });
  await expect(
    readSavedReviewRequests("bulk", bulkContext()),
  ).rejects.toThrow();
  expect(mockStores[0].read).not.toHaveBeenCalled();
  await expect(
    readSavedReviewRequests("bulk", {
      userId: bulkContext().userId,
      familyId: "other-family",
    }),
  ).rejects.toThrow();
});
it("holds divergent or unreadable replicas instead of calling saved work empty", async () => {
  const original = stored(PREP_RECOVERY, bulkContext().owner, [bulkRequest()]);
  setStores(original);
  mockStores[1].read.mockResolvedValue(
    stored(PREP_RECOVERY, bulkContext().owner, []),
  );
  await expect(
    readSavedReviewRequests("bulk", bulkContext()),
  ).rejects.toThrow();
  setStores(original);
  mockStores[1].read.mockRejectedValue(new Error("Synthetic blocked storage"));
  await expect(
    readSavedReviewRequests("bulk", bulkContext()),
  ).rejects.toThrow();
});
it("suppresses a projection when owner generation changes during the read", async () => {
  const original = bulkContext();
  setStores(stored(PREP_RECOVERY, original.owner, [bulkRequest()]));
  jest
    .mocked(readPrepContext)
    .mockResolvedValueOnce(original)
    .mockResolvedValueOnce(original)
    .mockResolvedValueOnce({
      ...original,
      owner: { ...original.owner!, generation: 3, scope: "c".repeat(64) },
    });
  await expect(readSavedReviewRequests("bulk", original)).rejects.toThrow();
});
