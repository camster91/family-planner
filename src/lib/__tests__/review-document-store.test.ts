/** Authored source cases. Execution deferred to the consolidated QA pass. */
import {
  createReviewDocumentStore,
  newReviewDocument,
} from "../review-document-store";
import {
  reviewDocumentContext,
  reviewDocumentPayload,
  REVIEW_DOCUMENT_CONTRACT,
  type ReviewExactRequest,
} from "../review-document-contract";
import type { QueueStore } from "../offline-queue";

const baseContext = reviewDocumentContext.parse({
  contract: REVIEW_DOCUMENT_CONTRACT,
  domain: "recipe",
  userId: "fixture-parent",
  familyId: "fixture-family",
  enabled: true,
  adopted: true,
  role: "parent",
  owner: {
    kind: "person",
    ownerId: "fixture-parent",
    generation: 0,
    scope: "a".repeat(64),
    householdScope: "b".repeat(64),
  },
});
const documentKey = "fixture_document_key";
const requestKey = "fixture_recipe_request";
const originalBody =
  '{"creation_protocol":"herewoven.recipe-create.v1", "title":"Family soup","servings":4}';
const requests = [
  { key: requestKey, action: "recipe.create" as const, body: originalBody },
];
const provenance = {
  source: "recipe-link" as const,
  sourceUrl: "https://example.com/soup",
  confidence: "unknown" as const,
  unknowns: ["servings"],
  evaluatedAt: null,
};
function fixture() {
  let value: string | null = null;
  let context = baseContext;
  let now = 100000;
  let throwAfterWrite = false;
  const storage: QueueStore = {
    read: async () => value,
    write: async (text) => {
      value = text;
      if (throwAfterWrite) throw new Error("fixture quota after write");
    },
    remove: async () => {
      value = null;
    },
  };
  const build = () =>
    createReviewDocumentStore({
      runtime: "fixture_review_runtime",
      now: () => now,
      resolveContext: async () => context,
      candidates: () => [storage],
      withLease: async (_owner, run) => run(),
    });
  return {
    build,
    text: () => value,
    pause: () => {
      context = { ...context, enabled: false };
    },
    switchOwner: () => {
      context = { ...context, owner: { ...context.owner!, generation: 1 } };
    },
    tick: (amount: number) => {
      now += amount;
    },
    failWrite: (enabled: boolean) => {
      throwAfterWrite = enabled;
    },
    draft: () =>
      newReviewDocument(
        baseContext,
        {
          domain: "recipe",
          title: "",
          description: "",
          instructions: "",
          servings: "",
          prep: "1.",
          cook: "-",
          sourceUrl: provenance.sourceUrl,
          sourceCopy: false,
          lines: [
            {
              clientId: "fixture-line",
              name: "Flour",
              amount: "1/2",
              unit: "cup",
              note: "",
              ingredientId: null,
              originalName: null,
            },
          ],
        },
        provenance,
        now,
      ),
  };
}
describe("owned review documents", () => {
  it("does not adopt another controller's write during an ordinary refresh", async () => {
    const f = fixture(),
      first = f.build(),
      second = f.build();
    await first.initialize();
    await second.initialize();
    await first.begin(documentKey, f.draft());
    await expect(second.refresh()).rejects.toMatchObject({
      reason: "DIVERGENT",
    });
    expect((await first.refresh())[0].key).toBe(documentKey);
  });
  it("requires exact terminal noncommit proof before releasing a rejected create", async () => {
    const f = fixture(),
      store = f.build();
    await store.initialize();
    const editable = await store.begin(documentKey, f.draft());
    const frozen = await store.freeze(documentKey, editable.body, requests);
    expect(
      await store.releaseRefused(
        documentKey,
        frozen.body,
        "fixture_successor_key",
        async () => null,
      ),
    ).toBeNull();
    expect(
      await store.releaseRefused(
        documentKey,
        frozen.body,
        "fixture_successor_key",
        async (request) => ({
          requestKey: request.key,
          requestBody: request.body + " ",
          code: "RECIPE_SOURCE_EXISTS",
        }),
      ),
    ).toBeNull();
    expect((await store.read(documentKey)).entry.body).toBe(frozen.body);
    expect(
      await store.releaseRefused(
        documentKey,
        frozen.body,
        "fixture_successor_key",
        async (request) => ({
          requestKey: request.key,
          requestBody: request.body,
          code: "RECIPE_SOURCE_EXISTS",
        }),
      ),
    ).toMatchObject({
      key: "fixture_successor_key",
      kind: "editable-review-document",
    });
    expect((await store.refresh())[0].key).toBe("fixture_successor_key");
  });

  it("restores all unfinished fields without coercing or shortening", async () => {
    const f = fixture(),
      store = f.build();
    await store.initialize();
    const draft = f.draft();
    await store.begin(documentKey, draft);
    const recovered = f.build();
    const rows = await recovered.initialize();
    expect(rows).toHaveLength(1);
    expect(rows[0].reviewRequired).toBe(true);
    expect((await recovered.read(documentKey)).document).toEqual(draft);
  });

  it("freezes exact body/key before transport and refuses subsequent form edits", async () => {
    const f = fixture(),
      store = f.build();
    await store.initialize();
    const draft = f.draft();
    const editable = await store.begin(documentKey, draft);
    const frozen = await store.freeze(documentKey, editable.body, requests);
    const transport = jest.fn(async (request: ReviewExactRequest) => {
      expect(f.text()).toContain("submitted-review-document");
      expect(request.body).toBe(originalBody);
      expect(request.key).toBe(requestKey);
      throw new Error("fixture disconnected after server write");
    });
    await expect(
      store.sendExact(
        documentKey,
        frozen.body,
        requestKey,
        async () => ({ state: "absent" }),
        transport,
      ),
    ).rejects.toThrow();
    await expect(
      store.save(documentKey, frozen.body, draft.draft, provenance),
    ).rejects.toMatchObject({ reason: "INTENT_CHANGED" });
    await expect(
      store.discardEditable(documentKey, frozen.body),
    ).rejects.toMatchObject({ reason: "INTENT_CHANGED" });
    expect((await store.read(documentKey)).entry.body).toBe(frozen.body);
  });

  it("recovered exact retry needs a receipt check; deleted results never recreate", async () => {
    const f = fixture(),
      store = f.build();
    await store.initialize();
    const editable = await store.begin(documentKey, f.draft());
    const frozen = await store.freeze(documentKey, editable.body, requests);
    const recovered = f.build();
    await recovered.initialize();
    const transport = jest.fn(async () => "saved");
    const result = await recovered.sendExact(
      documentKey,
      frozen.body,
      requestKey,
      async () => ({ state: "committed", current: "removed" }),
      transport,
    );
    expect(result).toEqual({
      sent: false,
      receipt: { state: "committed", current: "removed" },
    });
    expect(transport).not.toHaveBeenCalled();
    expect(
      await recovered.retireConfirmed(documentKey, frozen.body, async () => ({
        state: "committed",
        current: "removed",
      })),
    ).toBe(false);
    await recovered.sendExact(
      documentKey,
      frozen.body,
      requestKey,
      async () => ({ state: "absent" }),
      transport,
    );
    expect(transport).toHaveBeenCalledWith(requests[0], baseContext);
    expect((await recovered.read(documentKey)).entry.body).toBe(frozen.body);
  });

  it("holds uncertain freeze writes until exact storage recovery", async () => {
    const f = fixture(),
      store = f.build();
    await store.initialize();
    const editable = await store.begin(documentKey, f.draft());
    f.failWrite(true);
    await expect(
      store.freeze(documentKey, editable.body, requests),
    ).rejects.toThrow();
    expect(store.hasUncertainStorage()).toBe(true);
    const transport = jest.fn();
    await expect(
      store.sendExact(
        documentKey,
        editable.body,
        requestKey,
        async () => ({ state: "absent" }),
        transport,
      ),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
    f.failWrite(false);
    const rows = await store.recoverStorage();
    expect(rows[0].kind).toBe("submitted-review-document");
    expect(rows[0].reviewRequired).toBe(true);
  });

  it("keeps historical frozen work readable while paused, but refuses sends", async () => {
    const f = fixture(),
      store = f.build();
    await store.initialize();
    const editable = await store.begin(documentKey, f.draft());
    const frozen = await store.freeze(documentKey, editable.body, requests);
    f.pause();
    const recovered = f.build();
    await recovered.initialize();
    expect((await recovered.read(documentKey)).entry.body).toBe(frozen.body);
    const transport = jest.fn();
    await expect(
      recovered.sendExact(
        documentKey,
        frozen.body,
        requestKey,
        async () => ({ state: "absent" }),
        transport,
      ),
    ).rejects.toMatchObject({ reason: "DISABLED" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("renews owner after receipt inspection and before transport", async () => {
    const f = fixture(),
      store = f.build();
    await store.initialize();
    const editable = await store.begin(documentKey, f.draft());
    const frozen = await store.freeze(documentKey, editable.body, requests);
    const transport = jest.fn();
    await expect(
      store.sendExact(
        documentKey,
        frozen.body,
        requestKey,
        async () => {
          f.switchOwner();
          return { state: "absent" };
        },
        transport,
      ),
    ).rejects.toMatchObject({ reason: "OWNER_CHANGED" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("retains expired submissions for inspection without retrying or rekeying", async () => {
    const f = fixture(),
      store = f.build();
    await store.initialize();
    const editable = await store.begin(documentKey, f.draft());
    const frozen = await store.freeze(documentKey, editable.body, requests);
    f.tick(24 * 60 * 60 * 1000);
    const transport = jest.fn();
    await expect(
      store.sendExact(
        documentKey,
        frozen.body,
        requestKey,
        async () => ({ state: "absent" }),
        transport,
      ),
    ).rejects.toMatchObject({ reason: "REVIEW_REQUIRED" });
    expect(transport).not.toHaveBeenCalled();
    expect((await store.read(documentKey)).entry.body).toBe(frozen.body);
  });

  it("refuses unkeyed-protocol recipe bodies, unknown private fields and oversized forms", () => {
    const f = fixture(),
      draft = f.draft();
    const frozen = {
      ...draft,
      phase: "submitted",
      frozenAt: draft.updatedAt,
      expiresAt: draft.updatedAt + 1000,
      requests: [{ ...requests[0], body: '{"title":"soup"}' }],
    };
    expect(reviewDocumentPayload.safeParse(frozen).success).toBe(false);
    expect(
      reviewDocumentPayload.safeParse({
        ...draft,
        rawProviderOutput: "private",
      }).success,
    ).toBe(false);
    expect(
      reviewDocumentPayload.safeParse({
        ...draft,
        draft: { ...draft.draft, instructions: "x".repeat(20001) },
      }).success,
    ).toBe(false);
  });
});
