/** One owned editable local document; no send/replay transport is exposed. */
import {
  createOwnedRequestJournal,
  OwnedRequestRecoveryError,
  type OwnedRequestJournalOptions,
} from "@/lib/owned-request-journal";
import { newIdempotencyKey } from "@/lib/idempotency-key";
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
  OwnedRequestJournalOptions<RoutineDraftContext, RoutineDraftEntry>,
  "runtime" | "resolveContext" | "candidates" | "withLease"
>;
export function createRoutineDraftStore(options: Options) {
  let latest: RoutineDraftContext | null = null,
    entry: RoutineDraftEntry | null = null;
  let initialized = false,
    tail = Promise.resolve();
  let documentOpen = false,
    generation = 0;
  let conflict = false;
  const journal = createOwnedRequestJournal({
    ...options,
    resolveContext: async () => {
      const next = routineDraftContext.parse(await options.resolveContext());
      latest = next;
      return next;
    },
    contract: ROUTINE_DRAFT_CONTRACT,
    context: routineDraftContext,
    entry: routineDraftEntry,
    journal: routineDraftJournal,
    maxBytes: ROUTINE_DRAFT_MAX_BYTES,
    localDraftKind: "local-routine-draft",
    matchesContext: (row: RoutineDraftEntry, context: RoutineDraftContext) => {
      const data = routineDraftPayload.parse(JSON.parse(row.body));
      return (
        data.userId === context.userId && data.familyId === context.familyId
      );
    },
  });
  function serial<T>(run: () => Promise<T>) {
    const result = tail.then(run);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  function snapshot(): RoutineEditorDraft | null {
    return entry
      ? routineDraftPayload.parse(JSON.parse(entry.body)).draft
      : null;
  }
  async function write(draft: RoutineEditorDraft): Promise<RoutineEditorDraft> {
    if (!initialized || !latest || conflict)
      throw new OwnedRequestRecoveryError(
        conflict ? "DIVERGENT" : "UNAVAILABLE",
      );
    const cleaned = routineEditorDraftSchema.parse(
      sanitizeRoutineDraftPoints(draft, latest.pointsEnabled),
    );
    const next = routineDraftEntry.parse({
      kind: "local-routine-draft",
      key: entry?.key ?? newIdempotencyKey(),
      body: JSON.stringify({
        userId: latest.userId,
        familyId: latest.familyId,
        draft: cleaned,
      }),
    });
    if (!entry) await journal.stage(next);
    else if (entry.body !== next.body)
      await journal.replaceLocalDraft(next, entry.body);
    else await journal.inspect(entry.key, async () => undefined);
    entry = next;
    // Context renewed inside the write may have disabled Points & streaks.
    // Purge those local values before any restored draft can reach a component.
    const sanitized = sanitizeRoutineDraftPoints(cleaned, latest.pointsEnabled);
    if (JSON.stringify(sanitized) !== JSON.stringify(cleaned))
      return write(sanitized);
    return cleaned;
  }
  async function initialize(acceptChanged: boolean) {
    const known = entry?.body ?? null;
    const entries = await journal.initialize();
    if (initialized && !acceptChanged && (entries[0]?.body ?? null) !== known) {
      conflict = true;
      throw new OwnedRequestRecoveryError("DIVERGENT");
    }
    entry = entries[0]
      ? routineDraftEntry.parse({
          kind: entries[0].kind,
          key: entries[0].key,
          body: entries[0].body,
        })
      : null;
    conflict = false;
    initialized = true;
    documentOpen = entry !== null;
    const draft = snapshot();
    if (!draft || !latest) return null;
    const sanitized = sanitizeRoutineDraftPoints(draft, latest.pointsEnabled);
    return JSON.stringify(draft) === JSON.stringify(sanitized)
      ? draft
      : write(sanitized);
  }
  return {
    initialize: () => serial(() => initialize(false)),
    adoptStored: () => {
      generation += 1;
      return serial(() => initialize(true));
    },
    hasConflict: () => conflict,
    begin: (draft: RoutineEditorDraft) => {
      generation += 1;
      return serial(async () => {
        if (!initialized || entry || journal.hasUncertainStorage())
          throw new OwnedRequestRecoveryError("INTENT_CHANGED");
        documentOpen = true;
        return write(draft);
      });
    },
    write: (draft: RoutineEditorDraft) => {
      const original = generation;
      return serial(() => {
        if (!documentOpen || original !== generation)
          throw new OwnedRequestRecoveryError("INTENT_CHANGED");
        return write(draft);
      });
    },
    isSaved: (draft: RoutineEditorDraft | null) => {
      if (
        !initialized ||
        journal.hasUncertainStorage() ||
        conflict ||
        (draft !== null && !documentOpen)
      )
        return false;
      const parsed = draft ? routineEditorDraftSchema.safeParse(draft) : null;
      return (
        (!draft || parsed?.success === true) &&
        JSON.stringify(parsed?.success ? parsed.data : null) ===
          JSON.stringify(snapshot())
      );
    },
    clear: () => {
      generation += 1;
      documentOpen = false;
      return serial(async () => {
        if (!initialized || journal.hasUncertainStorage() || conflict)
          throw new OwnedRequestRecoveryError(
            conflict ? "DIVERGENT" : "UNAVAILABLE",
          );
        if (entry) {
          const expected = entry;
          await journal.inspect(expected.key, async (row) => {
            if (row.body !== expected.body)
              throw new OwnedRequestRecoveryError("DIVERGENT");
          });
          await journal.dismiss(expected.key);
          entry = null;
        }
      });
    },
    hasUncertainStorage: journal.hasUncertainStorage,
    recoverStorage: () =>
      serial(async () => {
        const rows = await journal.recoverStorage();
        entry = rows[0]
          ? routineDraftEntry.parse({
              kind: rows[0].kind,
              key: rows[0].key,
              body: rows[0].body,
            })
          : null;
        initialized = true;
        documentOpen = entry !== null;
        const draft = snapshot();
        return draft && latest
          ? write(sanitizeRoutineDraftPoints(draft, latest.pointsEnabled))
          : null;
      }),
  };
}
