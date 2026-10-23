/** Routine form adapter for shared local-only owned document transitions. */
import {
  createOwnedLocalDraftStore,
  type OwnedLocalDraftOptions,
} from "@/lib/owned-local-draft-store";
import {
  ROUTINE_DRAFT_CONTRACT,
  ROUTINE_DRAFT_MAX_BYTES,
  routineDraftContext,
  routineDraftEntry,
  routineDraftJournal,
  routineDraftPayload,
  routineEditorDraftSchema,
  sanitizeRoutineDraftPoints,
  type RoutineDraftContext,
  type RoutineDraftEntry,
} from "@/lib/routine-draft-contract";
import type { RoutineEditorDraft } from "@/lib/routine-schedule-editor";
type Options = Pick<
  OwnedLocalDraftOptions<
    RoutineDraftContext,
    RoutineDraftEntry,
    RoutineEditorDraft
  >,
  "runtime" | "resolveContext" | "candidates" | "withLease"
>;
export function createRoutineDraftStore(options: Options) {
  return createOwnedLocalDraftStore({
    ...options,
    contract: ROUTINE_DRAFT_CONTRACT,
    kind: "local-routine-draft",
    maxBytes: ROUTINE_DRAFT_MAX_BYTES,
    context: routineDraftContext,
    entry: routineDraftEntry,
    journal: routineDraftJournal,
    payload: routineDraftPayload,
    draft: routineEditorDraftSchema,
    sanitize: sanitizeRoutineDraftPoints,
  });
}
