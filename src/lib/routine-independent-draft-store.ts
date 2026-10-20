import {
  createOwnedLocalDraftStore,
  type OwnedLocalDraftOptions,
} from "@/lib/owned-local-draft-store";
import {
  independentDraftContext,
  independentDraftEntry,
  independentDraftJournal,
  independentDraftPayload,
  independentEditorDraftSchema,
  sanitizeIndependentDraft,
  INDEPENDENT_DRAFT_CONTRACT,
  type IndependentDraftContext,
  type IndependentDraftEntry,
  type IndependentEditorDraft,
} from "@/lib/routine-independent-draft-contract";
type Options = Pick<
  OwnedLocalDraftOptions<
    IndependentDraftContext,
    IndependentDraftEntry,
    IndependentEditorDraft
  >,
  "runtime" | "resolveContext" | "candidates" | "withLease"
>;
export function createIndependentDraftStore(options: Options) {
  return createOwnedLocalDraftStore({
    ...options,
    contract: INDEPENDENT_DRAFT_CONTRACT,
    kind: "local-independent-draft",
    maxBytes: 2 * 1024 * 1024,
    context: independentDraftContext,
    entry: independentDraftEntry,
    journal: independentDraftJournal,
    payload: independentDraftPayload,
    draft: independentEditorDraftSchema,
    sanitize: sanitizeIndependentDraft,
  });
}
