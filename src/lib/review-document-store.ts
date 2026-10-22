/** Owned review-document lifecycle. No provider calls or automatic replay.
 * Domain hosts supply canonical transport and read-only receipt inspection.
 */
import {
  createOwnedRequestJournal,
  OwnedRequestRecoveryError,
  type OwnedRequestJournalOptions,
} from "@/lib/owned-request-journal";
import {
  REVIEW_DOCUMENT_CONTRACT,
  REVIEW_DOCUMENT_MAX_BYTES,
  REVIEW_EDIT_TTL_MS,
  REVIEW_SUBMISSION_TTL_MS,
  reviewDocumentContext,
  reviewDocumentEntry,
  reviewDocumentJournal,
  reviewDocumentPayload,
  type ReviewDocumentContext,
  type ReviewDocumentEntry,
  type ReviewDocumentPayload,
  type ReviewExactRequest,
} from "@/lib/review-document-contract";

type Options = Pick<
  OwnedRequestJournalOptions<ReviewDocumentContext, ReviewDocumentEntry>,
  "runtime" | "resolveContext" | "candidates" | "withLease"
> & { now: () => number };
export type ReviewReceiptState =
  | { state: "committed"; current: "present" | "removed" | "unknown" }
  | {
      state: "absent" | "pending" | "expired" | "duplicate-source";
    }
  | { state: "refused"; reason?: "source-exists" | "source-check-unavailable" };
export type ReviewVerifiedRefusal = {
  requestKey: string;
  requestBody: string;
  code: "RECIPE_SOURCE_EXISTS" | "RECIPE_SOURCE_CHECK_UNAVAILABLE";
};
type Editing = Extract<ReviewDocumentPayload, { phase: "editing" }>;
function payload(entry: ReviewDocumentEntry) {
  return reviewDocumentPayload.parse(JSON.parse(entry.body));
}
function entryFor(
  key: string,
  document: ReviewDocumentPayload,
): ReviewDocumentEntry {
  return reviewDocumentEntry.parse({
    key,
    kind:
      document.phase === "editing"
        ? "editable-review-document"
        : "submitted-review-document",
    body: JSON.stringify(reviewDocumentPayload.parse(document)),
  });
}
const fail = (): never => {
  throw new OwnedRequestRecoveryError("INTENT_CHANGED");
};

export function createReviewDocumentStore(options: Options) {
  let reviewed: { key: string; body: string } | null = null;
  const journal = createOwnedRequestJournal({
    ...options,
    context: reviewDocumentContext,
    entry: reviewDocumentEntry,
    journal: reviewDocumentJournal,
    contract: REVIEW_DOCUMENT_CONTRACT,
    maxBytes: REVIEW_DOCUMENT_MAX_BYTES,
    localDraftKind: "editable-review-document",
    matchesContext: (entry, context) => {
      const document = payload(entry);
      return (
        context.adopted &&
        document.userId === context.userId &&
        document.familyId === context.familyId &&
        document.draft.domain === context.domain
      );
    },
    // A recovered intent needs explicit receipt review in sendExact below.
    // Do not authorize it simply because its JSON is structurally valid.
    reviewRecovered: async (entry) =>
      reviewed?.key === entry.key && reviewed.body === entry.body,
  });
  let tail = Promise.resolve();
  function serial<T>(run: () => Promise<T>): Promise<T> {
    const result = tail.then(run);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  function fresh(document: ReviewDocumentPayload) {
    const now = options.now();
    if (
      !Number.isSafeInteger(now) ||
      now < document.updatedAt ||
      now >= document.expiresAt
    )
      throw new OwnedRequestRecoveryError("REVIEW_REQUIRED");
    return now;
  }
  async function exact(key: string, expectedBody: string) {
    return journal.inspect(key, async (entry) => {
      if (entry.body !== expectedBody) return fail();
      return payload(entry);
    });
  }
  return {
    initialize: () => serial(() => journal.initialize()),
    refresh: () => serial(() => journal.snapshot()),
    recoverStorage: () => serial(() => journal.recoverStorage()),
    hasUncertainStorage: journal.hasUncertainStorage,
    /** Expired work stays inspectable; no silent pruning or replacement. */
    read: (key: string) =>
      serial(() =>
        journal.inspect(key, async (entry) => ({
          entry,
          document: payload(entry),
        })),
      ),
    begin: (key: string, document: Editing) =>
      serial(async () => {
        fresh(document);
        const entry = entryFor(key, document);
        await journal.stage(entry);
        return entry;
      }),
    save: (
      key: string,
      expectedBody: string,
      draft: Editing["draft"],
      provenance: Editing["provenance"],
    ) =>
      serial(async () => {
        const previous = await exact(key, expectedBody);
        if (
          previous.phase !== "editing" ||
          previous.draft.domain !== draft.domain
        )
          return fail();
        const now = fresh(previous);
        const entry = entryFor(key, {
          ...previous,
          draft,
          provenance,
          updatedAt: now,
        });
        await journal.replaceLocalDraft(entry, expectedBody, true);
        return entry;
      }),
    freeze: (
      key: string,
      expectedBody: string,
      requests: ReviewExactRequest[],
    ) =>
      serial(async () => {
        const previous = await exact(key, expectedBody);
        if (previous.phase !== "editing") return fail();
        const now = fresh(previous);
        const entry = entryFor(key, {
          ...previous,
          phase: "submitted",
          updatedAt: now,
          frozenAt: now,
          expiresAt: now + REVIEW_SUBMISSION_TTL_MS,
          requests,
        });
        await journal.promoteLocalDraft(entry, expectedBody);
        return entry;
      }),
    /** Inspect every original request. This never edits, resends or retires it. */
    inspectReceipts: (
      key: string,
      expectedBody: string,
      inspect: (
        request: ReviewExactRequest,
        context: ReviewDocumentContext,
      ) => Promise<ReviewReceiptState>,
    ) =>
      serial(() =>
        journal.inspect(key, async (entry, context) => {
          if (entry.body !== expectedBody) return fail();
          const document = payload(entry);
          if (document.phase !== "submitted") return fail();
          const results: ReviewReceiptState[] = [];
          for (const request of document.requests)
            results.push(await inspect(request, context));
          return results;
        }),
      ),
    /** Deliberate exact retry only. Each attempt renews owner/gate/storage;
     * receipt reads finish before transport, then authority renews once more.
     * Unknown/pending/expired/refused outcomes leave the entire document frozen.
     */
    sendExact: <T>(
      key: string,
      expectedBody: string,
      requestKey: string,
      inspect: (
        request: ReviewExactRequest,
        context: ReviewDocumentContext,
      ) => Promise<ReviewReceiptState>,
      transport: (
        request: ReviewExactRequest,
        context: ReviewDocumentContext,
      ) => Promise<T>,
    ) =>
      serial(async () => {
        const { proof, context } = await journal.inspect(
          key,
          async (entry, context) => {
            if (entry.body !== expectedBody) return fail();
            const document = payload(entry);
            if (document.phase !== "submitted") return fail();
            fresh(document);
            const request = document.requests.find(
              (row) => row.key === requestKey,
            );
            if (!request) return fail();
            return { proof: await inspect(request, context), context };
          },
        );
        // A committed receipt, including a deleted record, never becomes a new
        // create. An absent receipt allows the SAME key only within its lease.
        if (proof.state !== "absent")
          return { sent: false as const, receipt: proof };
        reviewed = { key, body: expectedBody };
        try {
          return await journal.send(key, true, async (entry) => {
            if (entry.body !== expectedBody) return fail();
            const document = payload(entry);
            if (document.phase !== "submitted") return fail();
            fresh(document);
            const request = document.requests.find(
              (row) => row.key === requestKey,
            );
            if (!request) return fail();
            return {
              sent: true as const,
              result: await transport(request, context),
            };
          });
        } finally {
          reviewed = null;
        }
      }),
    discardEditable: (key: string, expectedBody: string) =>
      serial(async () => {
        if ((await exact(key, expectedBody)).phase !== "editing") return fail();
        await journal.dismiss(key);
      }),
    /** A domain host may release only a freshly observed terminal refusal,
     * rechecked against a canonical terminal noncommit receipt for this exact request. Plain
     * absence, a lost reply or an expired lease is never sufficient to rekey.
     */
    releaseRefused: (
      key: string,
      expectedBody: string,
      newDocumentKey: string,
      verify: (
        request: ReviewExactRequest,
        context: ReviewDocumentContext,
      ) => Promise<ReviewVerifiedRefusal | null>,
    ) =>
      serial(async () => {
        const refused = await journal.inspect(key, async (entry, context) => {
          if (entry.body !== expectedBody) return fail();
          const document = payload(entry);
          if (document.phase !== "submitted") return fail();
          fresh(document);
          for (const request of document.requests) {
            const proof = await verify(request, context);
            if (
              !proof ||
              proof.requestKey !== request.key ||
              proof.requestBody !== request.body ||
              (proof.code !== "RECIPE_SOURCE_EXISTS" &&
                proof.code !== "RECIPE_SOURCE_CHECK_UNAVAILABLE")
            )
              return false;
          }
          if (
            document.requests.some((request) => request.key === newDocumentKey)
          )
            return fail();
          return document;
        });
        if (!refused) return null;
        const successor = entryFor(
          newDocumentKey,
          newReviewDocument(
            refused,
            refused.draft,
            refused.provenance,
            options.now(),
          ),
        );
        await journal.resolveToLocalDraft(successor, key, expectedBody);
        return successor;
      }),
    /** Explicit completion review, not an automatic success cleanup. Removed
     * and unknown current records stay visible for a separate user decision.
     */
    retireConfirmed: (
      key: string,
      expectedBody: string,
      inspect: (
        request: ReviewExactRequest,
        context: ReviewDocumentContext,
      ) => Promise<ReviewReceiptState>,
    ) =>
      serial(async () => {
        const complete = await journal.inspect(key, async (entry, context) => {
          if (entry.body !== expectedBody) return fail();
          const document = payload(entry);
          if (document.phase !== "submitted") return fail();
          for (const request of document.requests) {
            const result = await inspect(request, context);
            if (result.state !== "committed" || result.current !== "present")
              return false;
          }
          return true;
        });
        if (!complete) return false;
        await journal.dismiss(key);
        return true;
      }),
  };
}

export function newReviewDocument(
  owner: Pick<ReviewDocumentContext, "userId" | "familyId">,
  draft: Editing["draft"],
  provenance: Editing["provenance"],
  now: number,
): Editing {
  const parsed = reviewDocumentPayload.parse({
    userId: owner.userId,
    familyId: owner.familyId,
    draft,
    provenance,
    phase: "editing",
    createdAt: now,
    updatedAt: now,
    expiresAt: now + REVIEW_EDIT_TTL_MS,
  });
  if (parsed.phase !== "editing") return fail();
  return parsed;
}
