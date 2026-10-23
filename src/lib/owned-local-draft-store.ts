/** One owned editable local document; no send/replay transport is exposed. */
import {
  createOwnedRequestJournal,
  OwnedRequestRecoveryError,
  type OwnedRequestJournalOptions,
} from "@/lib/owned-request-journal";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import type {
  RequestRecoveryContext,
  RequestRecoveryEntry,
} from "@/lib/owned-request-journal";
type Schema<T> = {
  parse(value: unknown): T;
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};
type LocalContext = RequestRecoveryContext & { pointsEnabled: boolean };
export type OwnedLocalDraftOptions<
  C extends LocalContext,
  E extends RequestRecoveryEntry,
  D extends object,
> = Pick<
  OwnedRequestJournalOptions<C, E>,
  "runtime" | "resolveContext" | "candidates" | "withLease"
> & {
  contract: string;
  kind: E["kind"];
  maxBytes: number;
  context: Schema<C>;
  entry: Schema<E>;
  journal: OwnedRequestJournalOptions<C, E>["journal"];
  draft: Schema<D>;
  payload: Schema<{ userId: string; familyId: string; draft: D }>;
  sanitize: (draft: D, pointsEnabled: boolean) => D;
};
/** One local-only document with exact CAS, explicit conflict adoption and discard epochs. */
export function createOwnedLocalDraftStore<
  C extends LocalContext,
  E extends RequestRecoveryEntry,
  D extends object,
>(options: OwnedLocalDraftOptions<C, E, D>) {
  let latest: C | null = null,
    entry: E | null = null;
  let initialized = false,
    tail = Promise.resolve();
  let documentOpen = false,
    generation = 0;
  let conflict = false;
  const journal = createOwnedRequestJournal({
    ...options,
    resolveContext: async () => {
      const next = options.context.parse(await options.resolveContext());
      latest = next;
      return next;
    },
    contract: options.contract,
    context: options.context,
    entry: options.entry,
    journal: options.journal,
    maxBytes: options.maxBytes,
    localDraftKind: options.kind,
    matchesContext: (row: E, context: C) => {
      const data = options.payload.parse(JSON.parse(row.body));
      return (
        data.userId === context.userId && data.familyId === context.familyId
      );
    },
  });
  function serial<T>(run: () => Promise<T>) {
    const result = tail.then(run).catch((caught) => {
      if (
        caught instanceof OwnedRequestRecoveryError &&
        caught.reason === "DIVERGENT"
      )
        conflict = true;
      throw caught;
    });
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  function snapshot(): D | null {
    return entry ? options.payload.parse(JSON.parse(entry.body)).draft : null;
  }
  async function write(draft: D): Promise<D> {
    if (!initialized || !latest || conflict)
      throw new OwnedRequestRecoveryError(
        conflict ? "DIVERGENT" : "UNAVAILABLE",
      );
    const cleaned = options.draft.parse(
      options.sanitize(draft, latest.pointsEnabled),
    );
    const next = options.entry.parse({
      kind: options.kind,
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
    const sanitized = options.sanitize(cleaned, latest.pointsEnabled);
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
      ? options.entry.parse({
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
    const sanitized = options.sanitize(draft, latest.pointsEnabled);
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
    begin: (draft: D) => {
      generation += 1;
      return serial(async () => {
        if (!initialized || entry || journal.hasUncertainStorage())
          throw new OwnedRequestRecoveryError("INTENT_CHANGED");
        documentOpen = true;
        return write(draft);
      });
    },
    write: (draft: D) => {
      const original = generation;
      return serial(() => {
        if (!documentOpen || original !== generation)
          throw new OwnedRequestRecoveryError("INTENT_CHANGED");
        return write(draft);
      });
    },
    isSaved: (draft: D | null) => {
      if (
        !initialized ||
        journal.hasUncertainStorage() ||
        conflict ||
        (draft !== null && !documentOpen)
      )
        return false;
      const parsed = draft ? options.draft.safeParse(draft) : null;
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
          ? options.entry.parse({
              kind: rows[0].kind,
              key: rows[0].key,
              body: rows[0].body,
            })
          : null;
        initialized = true;
        documentOpen = entry !== null;
        const draft = snapshot();
        return draft && latest
          ? write(options.sanitize(draft, latest.pointsEnabled))
          : null;
      }),
  };
}
