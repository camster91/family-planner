/** @jest-environment jsdom */
/** Authored only; no browser-store or role-isolation runtime evidence yet. */
import { readSavedReviewRequests } from "../saved-requests";
import { readReviewDocumentContext } from "@/lib/review-document-browser";
import { REVIEW_DOCUMENT_CONTRACT } from "@/lib/review-document-contract";
const mockStores = [{ read: jest.fn(), write: jest.fn(), remove: jest.fn() }];
jest.mock("@/lib/review-document-browser", () => ({
  readReviewDocumentContext: jest.fn(),
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
const context = {
  contract: REVIEW_DOCUMENT_CONTRACT as typeof REVIEW_DOCUMENT_CONTRACT,
  domain: "recipe" as const,
  role: "parent" as const,
  userId: "fixture-parent",
  familyId: "fixture-family",
  enabled: false,
  adopted: true,
  owner: {
    kind: "person" as const,
    ownerId: "fixture-parent",
    generation: 0,
    scope: "a".repeat(64),
    householdScope: "b".repeat(64),
  },
};
const payload = {
  userId: context.userId,
  familyId: context.familyId,
  createdAt: 1000,
  updatedAt: 1000,
  expiresAt: 2000,
  phase: "editing" as const,
  provenance: {
    source: "manual",
    sourceUrl: null,
    confidence: "unknown",
    unknowns: [],
    evaluatedAt: null,
  },
  draft: {
    domain: "recipe",
    title: "PRIVATE RECIPE",
    description: "PRIVATE NOTE",
    instructions: "PRIVATE METHOD",
    servings: "",
    prep: "1.",
    cook: "",
    sourceUrl: null,
    sourceCopy: false,
    lines: [
      {
        clientId: "private_line_id",
        name: "PRIVATE INGREDIENT",
        amount: "1/2",
        unit: "",
        note: "",
        ingredientId: null,
        originalName: null,
      },
    ],
  },
};
function stored(
  document: unknown = payload,
  kind = "editable-review-document",
) {
  return JSON.stringify({
    v: 2,
    envelope: "herewoven.queue-store.v2",
    state: "active",
    owner: context.owner,
    runtime: "fixture_review_inbox_runtime",
    queue: JSON.stringify({
      contract: REVIEW_DOCUMENT_CONTRACT as typeof REVIEW_DOCUMENT_CONTRACT,
      entries: [
        { key: "private_document_key", kind, body: JSON.stringify(document) },
      ],
    }),
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, "indexedDB", { configurable: true, value: {} });
  jest.mocked(readReviewDocumentContext).mockResolvedValue(context);
  mockStores[0].read.mockResolvedValue(stored());
});
it("projects an expired paused editable draft without copying private content or touching storage", async () => {
  const result = await readSavedReviewRequests("recipe", context);
  expect(result).toEqual({
    paused: true,
    items: [
      {
        id: "recipe-0",
        kind: "recipe",
        phase: "editing",
        issuedAt: "1970-01-01T00:00:01.000Z",
        href: "/dashboard/meals/review",
      },
    ],
  });
  expect(JSON.stringify(result)).not.toMatch(
    /PRIVATE|private_|fixture-parent|fixture-family/,
  );
  expect(mockStores[0].write).not.toHaveBeenCalled();
  expect(mockStores[0].remove).not.toHaveBeenCalled();
});
it("keeps submitted/unknown work distinct from an editable draft", async () => {
  mockStores[0].read.mockResolvedValue(
    stored(
      {
        ...payload,
        phase: "submitted",
        frozenAt: 1000,
        requests: [
          {
            key: "private_request_key",
            action: "recipe.create",
            body: '{"creation_protocol":"herewoven.recipe-create.v1","title":"PRIVATE RECIPE","description":null,"instructions":null,"prep_time":null,"cook_time":null,"servings":4,"ingredients":[{"name":"PRIVATE INGREDIENT","amount":0.5,"unit":"cup","note":null}]}',
          },
        ],
      },
      "submitted-review-document",
    ),
  );
  const result = await readSavedReviewRequests("recipe", context);
  expect(result.items[0].phase).toBe("submitted");
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE|private_request_key/);
});
it("refuses a foreign body, downgraded parent and unadopted recovery instead of reporting empty", async () => {
  mockStores[0].read.mockResolvedValue(
    stored({ ...payload, familyId: "fixture-other-family" }),
  );
  await expect(
    readSavedReviewRequests("recipe", context),
  ).rejects.toMatchObject({ reason: "OWNER_CHANGED" });
  mockStores[0].read.mockResolvedValue(stored());
  jest
    .mocked(readReviewDocumentContext)
    .mockResolvedValue({ ...context, role: "teen" });
  await expect(
    readSavedReviewRequests("recipe", context),
  ).rejects.toMatchObject({ reason: "OWNER_CHANGED" });
  jest
    .mocked(readReviewDocumentContext)
    .mockResolvedValue({ ...context, adopted: false });
  await expect(
    readSavedReviewRequests("recipe", context),
  ).rejects.toMatchObject({ reason: "DISABLED" });
  expect(mockStores[0].write).not.toHaveBeenCalled();
  expect(mockStores[0].remove).not.toHaveBeenCalled();
});
