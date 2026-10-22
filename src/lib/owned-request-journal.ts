/** Shared exact-request journal. No background replay or domain writes. */
import type { QueueStore } from "@/lib/offline-queue";
import {
  ownedQueueEnvelope,
  RETIRED_QUEUE_ENVELOPE,
  sameQueueOwner,
  type QueueOwner,
} from "@/lib/queue-owner-contract";
import {
  rememberQueueOwner,
  withOwnedQueueLease,
} from "@/lib/owned-queue-persistence";
type Parser<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};
export type RequestRecoveryEntry = { kind: string; key: string; body: string };
export type RequestRecoveryContext = {
  enabled: boolean;
  owner: QueueOwner | null;
  userId: string;
  familyId: string;
};
export class OwnedRequestRecoveryError extends Error {
  constructor(
    public readonly reason:
      | "UNAVAILABLE"
      | "OWNER_CHANGED"
      | "DISABLED"
      | "UPDATE_REQUIRED"
      | "DIVERGENT"
      | "REVIEW_REQUIRED"
      | "CAPACITY"
      | "INTENT_CHANGED",
  ) {
    super("Saved request recovery needs attention");
    this.name = "OwnedRequestRecoveryError";
  }
}
export type OwnedRequestJournalOptions<
  C extends RequestRecoveryContext,
  E extends RequestRecoveryEntry,
> = {
  context: Parser<C>;
  entry: Parser<E>;
  journal: Parser<{ contract: string; entries: E[] }>;
  contract: string;
  maxBytes: number;
  matchesContext: (entry: E, context: C) => boolean;
  /** Opt-in for a local-only editable document. Such entries can never send. */
  localDraftKind?: E["kind"];
  error?: (
    reason: OwnedRequestRecoveryError["reason"],
  ) => OwnedRequestRecoveryError;
  runtime: string;
  resolveContext: () => Promise<unknown>;
  candidates: (owner: QueueOwner) => QueueStore[];
  withLease?: <T>(owner: QueueOwner, run: () => Promise<T>) => Promise<T>;
  /** Opt-in receipt/source inspection before every foreground send, including
   * same-controller retries. Existing domains retain recovered-only behavior. */
  reviewBeforeEverySend?: boolean;
  /** Must validate current canonical target/receipt before a deliberate recovered retry. */
  reviewRecovered?: (entry: E, context: C) => Promise<boolean>;
};
const identical = (a: Array<string | null>, b: Array<string | null>) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * Separate owner scope makes ownedQueueLocation distinct from grocery storage.
 * The outer v2 envelope intentionally reuses generation/household retirement.
 * Its inner contract is NOT a queue action or a legacy snapshot to migrate.
 */
export function createOwnedRequestJournal<
  C extends RequestRecoveryContext,
  E extends RequestRecoveryEntry,
>(options: OwnedRequestJournalOptions<C, E>) {
  const error =
    options.error ??
    ((reason: OwnedRequestRecoveryError["reason"]) =>
      new OwnedRequestRecoveryError(reason));
  const copy = (row: E): E => ({ ...row });
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(options.runtime))
    throw error("UPDATE_REQUIRED");
  let context: C | null = null;
  let stores: QueueStore[] = [];
  let baseline: Array<string | null> | null = null;
  let rows: E[] = [];
  let held = new Set<string>();
  let currentStore = -1;
  let writesEnabled = false;
  let uncertain: {
    base: Array<string | null>;
    text: string;
    entries: E[];
  } | null = null;
  let tail = Promise.resolve();
  const lease = options.withLease ?? withOwnedQueueLease;
  const fail = (reason: OwnedRequestRecoveryError["reason"]): never => {
    throw error(reason);
  };
  // Serialize this controller; cross-controller/process exclusion is the Web Lock.
  function serial<T>(run: () => Promise<T>): Promise<T> {
    const result = tail.then(run);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async function resolve() {
    let value: unknown;
    try {
      value = await options.resolveContext();
    } catch (error) {
      if (error instanceof OwnedRequestRecoveryError) throw error;
      return fail("UNAVAILABLE");
    }
    const parsed = options.context.safeParse(value);
    if (!parsed.success) return fail("UNAVAILABLE");
    const next = parsed.data;
    if (!next.owner) return fail("OWNER_CHANGED");
    if (
      context &&
      (context.userId !== next.userId ||
        context.familyId !== next.familyId ||
        !context.owner ||
        !sameQueueOwner(context.owner, next.owner))
    )
      return fail("OWNER_CHANGED");
    writesEnabled = next.enabled;
    return next as C & { owner: QueueOwner };
  }
  async function probe() {
    if (!stores.length) return fail("UNAVAILABLE");
    const result = await Promise.allSettled(
      stores.map((store) => store.read()),
    );
    if (result.some((value) => value.status === "rejected"))
      return fail("UNAVAILABLE");
    return result.map(
      (value) => (value as PromiseFulfilledResult<string | null>).value,
    );
  }
  function read(
    values: Array<string | null>,
    ownerContext: C & { owner: QueueOwner },
  ) {
    const nonempty = values.filter((value): value is string => value !== null);
    if (new Set(nonempty).size > 1) return fail("DIVERGENT");
    const text = nonempty[0];
    if (text === undefined) return [];
    if (new Blob([text]).size > options.maxBytes)
      return fail("UPDATE_REQUIRED");
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return fail("UPDATE_REQUIRED");
    }
    const outer = ownedQueueEnvelope.safeParse(raw);
    if (!outer.success) return fail("UPDATE_REQUIRED");
    if (outer.data.state === "retired") return fail("OWNER_CHANGED");
    if (!sameQueueOwner(outer.data.owner, ownerContext.owner))
      return fail("OWNER_CHANGED");
    let inner: unknown;
    try {
      inner = JSON.parse(outer.data.queue);
    } catch {
      return fail("UPDATE_REQUIRED");
    }
    const parsed = options.journal.safeParse(inner);
    if (!parsed.success) return fail("UPDATE_REQUIRED");
    if (
      parsed.data.entries.some(
        (row) => !options.matchesContext(row, ownerContext),
      )
    )
      return fail("OWNER_CHANGED");
    return parsed.data.entries;
  }
  function encode(entries: E[], owner: QueueOwner) {
    const journal = options.journal.safeParse({
      contract: options.contract,
      entries,
    });
    if (!journal.success) return fail("CAPACITY");
    const text = JSON.stringify({
      v: 2,
      envelope: "herewoven.queue-store.v2",
      state: "active",
      owner,
      runtime: options.runtime,
      queue: JSON.stringify(journal.data),
    });
    if (new Blob([text]).size > options.maxBytes) return fail("CAPACITY");
    return text;
  }
  async function save(text: string) {
    const order =
      currentStore < 0
        ? stores.map((_, index) => index)
        : [
            currentStore,
            ...stores
              .map((_, index) => index)
              .filter((index) => index !== currentStore),
          ];
    for (const index of order) {
      try {
        await stores[index].write(text);
      } catch {
        continue;
      }
      currentStore = index;
      const cleanup = await Promise.allSettled(
        stores.map((store, other) =>
          other === index ? Promise.resolve() : store.remove(),
        ),
      );
      if (cleanup.some((result) => result.status === "rejected"))
        return fail("UNAVAILABLE");
      const values = await probe();
      if (
        values.some((value, other) => value !== (other === index ? text : null))
      )
        return fail("DIVERGENT");
      baseline = values;
      return;
    }
    return fail("UNAVAILABLE");
  }
  async function checked<T>(
    run: (now: C & { owner: QueueOwner }) => Promise<T>,
    allowPaused = false,
  ) {
    const now = await resolve();
    return lease(now.owner, async () => {
      // Renew after obtaining the lease; no cached login proof authorizes work.
      const fresh = await resolve();
      if (!sameQueueOwner(now.owner, fresh.owner)) return fail("OWNER_CHANGED");
      if (!fresh.enabled && !allowPaused) return fail("DISABLED");
      if (!context || !baseline) return fail("UNAVAILABLE");
      if (uncertain) return fail("UNAVAILABLE");
      const values = await probe();
      read(values, fresh);
      if (!identical(values, baseline)) return fail("DIVERGENT");
      return run(fresh);
    });
  }
  async function persist(entries: E[], owner: QueueOwner) {
    if (!baseline) return fail("UNAVAILABLE");
    const text = encode(entries, owner);
    // Capture exact proposed transition before any physical write can fail.
    uncertain = { base: [...baseline], text, entries: entries.map(copy) };
    await save(text);
    rows = entries.map(copy);
    uncertain = null;
  }
  return {
    writesAvailable: () => writesEnabled,
    hasUncertainStorage: () => uncertain !== null,
    initialize: () =>
      serial(async () => {
        if (uncertain) return fail("UNAVAILABLE");
        const next = await resolve();
        return lease(next.owner, async () => {
          const fresh = await resolve();
          if (!sameQueueOwner(next.owner, fresh.owner))
            return fail("OWNER_CHANGED");
          stores = options.candidates(fresh.owner);
          const values = await probe();
          const entries = read(values, fresh);
          context = fresh;
          rememberQueueOwner(fresh.owner);
          baseline = values;
          currentStore = values.findIndex((value) => value !== null);
          rows = entries.map(copy);
          held = new Set(rows.map((entry) => entry.key));
          return rows.map((entry) => ({
            ...copy(entry),
            reviewRequired: true,
          }));
        });
      }),
    stage: (input: E) =>
      serial(async () => {
        const parsed = options.entry.safeParse(input);
        if (!parsed.success) return fail("INTENT_CHANGED");
        const entry = parsed.data;
        return checked(async (fresh) => {
          if (!options.matchesContext(entry, fresh))
            return fail("OWNER_CHANGED");
          const existing = rows.find((row) => row.key === entry.key);
          if (existing) {
            if (existing.kind !== entry.kind || existing.body !== entry.body)
              return fail("INTENT_CHANGED");
            return;
          }
          await persist([...rows, copy(entry)], fresh.owner);
        });
      }),
    /** Compare-and-replace a local-only draft. Network intents stay immutable. */
    replaceLocalDraft: (
      input: E,
      expectedBody: string,
      requireEnabled = false,
    ) =>
      serial(async () => {
        const parsed = options.entry.safeParse(input);
        if (
          !parsed.success ||
          !options.localDraftKind ||
          parsed.data.kind !== options.localDraftKind
        )
          return fail("INTENT_CHANGED");
        const entry = parsed.data;
        return checked(async (fresh) => {
          if (!options.matchesContext(entry, fresh))
            return fail("OWNER_CHANGED");
          const existing = rows.find((row) => row.key === entry.key);
          if (
            !existing ||
            existing.kind !== options.localDraftKind ||
            existing.body !== expectedBody
          )
            return fail("INTENT_CHANGED");
          await persist(
            rows.map((row) => (row.key === entry.key ? copy(entry) : row)),
            fresh.owner,
          );
          held.add(entry.key);
        }, !requireEnabled);
      }),
    /** Atomically freeze an editable document into a canonical network intent.
     * Keep its key and exact predecessor body; never rewrite a frozen intent.
     * Persistence (including replica verification) completes before send can run.
     */
    promoteLocalDraft: (input: E, expectedBody: string) =>
      serial(async () => {
        const parsed = options.entry.safeParse(input);
        if (
          !parsed.success ||
          !options.localDraftKind ||
          parsed.data.kind === options.localDraftKind
        )
          return fail("INTENT_CHANGED");
        const entry = parsed.data;
        return checked(async (fresh) => {
          if (!options.matchesContext(entry, fresh))
            return fail("OWNER_CHANGED");
          const existing = rows.find((row) => row.key === entry.key);
          if (
            !existing ||
            existing.kind !== options.localDraftKind ||
            existing.body !== expectedBody
          )
            return fail("INTENT_CHANGED");
          await persist(
            rows.map((row) => (row.key === entry.key ? copy(entry) : row)),
            fresh.owner,
          );
          // This controller observed the exact durable transition. A reloaded
          // controller still marks every recovered intent as requiring review.
          held.delete(entry.key);
        });
      }),
    /** Domain-verified terminal noncommit only. Retire the exact immutable
     * intent and retain its editable successor in one durable transition.
     */
    resolveToLocalDraft: (
      input: E,
      previousKey: string,
      expectedBody: string,
    ) =>
      serial(async () => {
        const parsed = options.entry.safeParse(input);
        if (
          !parsed.success ||
          !options.localDraftKind ||
          parsed.data.kind !== options.localDraftKind ||
          parsed.data.key === previousKey
        )
          return fail("INTENT_CHANGED");
        const entry = parsed.data;
        return checked(async (fresh) => {
          if (!options.matchesContext(entry, fresh))
            return fail("OWNER_CHANGED");
          const prior = rows.find((row) => row.key === previousKey);
          if (
            !prior ||
            prior.kind === options.localDraftKind ||
            prior.body !== expectedBody ||
            rows.some((row) => row.key === entry.key)
          )
            return fail("INTENT_CHANGED");
          await persist(
            rows.map((row) => (row.key === previousKey ? copy(entry) : row)),
            fresh.owner,
          );
          held.delete(previousKey);
          held.add(entry.key);
        });
      }),
    /** Explicit user recovery only; repairs solely the exact known transition. */
    recoverStorage: () =>
      serial(async () => {
        const pending = uncertain;
        if (!pending || !context) return fail("UNAVAILABLE");
        const now = await resolve();
        return lease(now.owner, async () => {
          await resolve();
          const values = await probe();
          if (
            values.some(
              (value, index) =>
                value !== null &&
                value !== pending.text &&
                value !== pending.base[index],
            )
          )
            return fail("DIVERGENT");
          if (values.includes(RETIRED_QUEUE_ENVELOPE))
            return fail("OWNER_CHANGED");
          await save(pending.text);
          rows = pending.entries.map(copy);
          uncertain = null;
          // Recovery is not proof that any request reached the server.
          rows.forEach((entry) => held.add(entry.key));
          return rows.map((entry) => ({
            ...copy(entry),
            reviewRequired: held.has(entry.key),
          }));
        });
      }),
    /** Refresh only the known exact baseline; never adopt a foreign writer. */
    snapshot: () =>
      serial(() =>
        checked(
          async () =>
            rows.map((entry) => ({
              ...copy(entry),
              reviewRequired: held.has(entry.key),
            })),
          true,
        ),
      ),
    /** User-reviewed local dismissal or confirmed completion; no server mutation. */
    dismiss: (key: string) =>
      serial(() =>
        checked(async (fresh) => {
          if (!rows.some((entry) => entry.key === key))
            return fail("INTENT_CHANGED");
          await persist(
            rows.filter((entry) => entry.key !== key),
            fresh.owner,
          );
          held.delete(key);
        }, true),
      ),
    inspect: <T>(key: string, inspect: (entry: E, context: C) => Promise<T>) =>
      serial(() =>
        checked(async (fresh) => {
          const entry = rows.find((row) => row.key === key);
          if (!entry) return fail("INTENT_CHANGED");
          const result = await inspect(copy(entry), fresh);
          await resolve();
          if (!identical(await probe(), baseline!)) return fail("DIVERGENT");
          return result;
        }, true),
      ),
    send: <T>(
      key: string,
      reviewRecovered: boolean,
      send: (entry: E, ownerScope: string) => Promise<T>,
    ) =>
      serial(() =>
        checked(async (fresh) => {
          const entry = rows.find((row) => row.key === key);
          if (!entry) return fail("INTENT_CHANGED");
          if (options.localDraftKind && entry.kind === options.localDraftKind)
            return fail("DISABLED");
          if (held.has(key) && !reviewRecovered) return fail("REVIEW_REQUIRED");
          if (
            (held.has(key) || options.reviewBeforeEverySend) &&
            (!options.reviewRecovered ||
              !(await options.reviewRecovered(copy(entry), fresh)))
          )
            return fail("REVIEW_REQUIRED");
          // A review may have awaited a network result; renew owner and storage.
          const latest = await resolve();
          if (!latest.enabled) return fail("DISABLED");
          if (!identical(await probe(), baseline!)) return fail("DIVERGENT");
          // Keep saved work even on success: only explicit confirmed dismissal removes it.
          const result = await send(copy(entry), latest.owner.scope);
          // A delayed result belongs only to the same current owner and exact
          // saved journal. Never display an old session's proof after a switch.
          await resolve();
          if (!identical(await probe(), baseline!)) return fail("DIVERGENT");
          return result;
        }),
      ),
  };
}
