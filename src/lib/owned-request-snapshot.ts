/** Deliberate read-only discovery under the SAME lease as the domain journal.
 * Never initialize/reconcile a journal, write/retire storage, inspect receipts,
 * send requests or mark an entry retryable. Unknown outcomes stay unknown. */
import type {
  OwnedRequestJournalOptions,
  RequestRecoveryContext,
  RequestRecoveryEntry,
} from "./owned-request-journal";
import { OwnedRequestRecoveryError } from "./owned-request-journal";
import {
  ownedQueueEnvelope,
  sameQueueOwner,
  type QueueOwner,
} from "./queue-owner-contract";
import {
  withOwnedQueueLease,
  rememberQueueOwner,
} from "./owned-queue-persistence";
export async function readOwnedRequestSnapshot<
  C extends RequestRecoveryContext,
  E extends RequestRecoveryEntry,
  T,
>(
  options: Pick<
    OwnedRequestJournalOptions<C, E>,
    | "context"
    | "journal"
    | "maxBytes"
    | "matchesContext"
    | "resolveContext"
    | "candidates"
    | "withLease"
  > & {
    project: (entries: E[], context: C) => Promise<T> | T;
  },
): Promise<{ owner: QueueOwner; enabled: boolean; projection: T }> {
  const fail = (reason: OwnedRequestRecoveryError["reason"]): never => {
    throw new OwnedRequestRecoveryError(reason);
  };
  async function resolve() {
    const parsed = options.context.safeParse(await options.resolveContext());
    if (!parsed.success) return fail("UNAVAILABLE");
    if (
      !parsed.data.owner ||
      parsed.data.owner.kind !== "person" ||
      parsed.data.owner.ownerId !== parsed.data.userId
    )
      return fail("OWNER_CHANGED");
    return parsed.data as C & { owner: QueueOwner };
  }
  const initial = await resolve();
  return (options.withLease ?? withOwnedQueueLease)(initial.owner, async () => {
    const current = await resolve();
    if (
      !sameQueueOwner(initial.owner, current.owner) ||
      initial.userId !== current.userId ||
      initial.familyId !== current.familyId
    )
      return fail("OWNER_CHANGED");
    const stores = options.candidates(current.owner);
    if (!stores.length) return fail("UNAVAILABLE");
    async function probe() {
      const results = await Promise.allSettled(
        stores.map((store) => store.read()),
      );
      if (results.some((result) => result.status === "rejected"))
        return fail("UNAVAILABLE");
      return results.map(
        (result) => (result as PromiseFulfilledResult<string | null>).value,
      );
    }
    const values = await probe();
    const nonempty = values.filter((value): value is string => value !== null);
    if (new Set(nonempty).size > 1) return fail("DIVERGENT");
    let entries: E[] = [];
    const text = nonempty[0];
    if (text !== undefined) {
      if (new Blob([text]).size > options.maxBytes)
        return fail("UPDATE_REQUIRED");
      try {
        const outer = ownedQueueEnvelope.safeParse(JSON.parse(text));
        if (!outer.success) return fail("UPDATE_REQUIRED");
        if (
          outer.data.state === "retired" ||
          !sameQueueOwner(outer.data.owner, current.owner)
        )
          return fail("OWNER_CHANGED");
        const inner = options.journal.safeParse(JSON.parse(outer.data.queue));
        if (!inner.success) return fail("UPDATE_REQUIRED");
        if (
          inner.data.entries.some(
            (entry) => !options.matchesContext(entry, current),
          )
        )
          return fail("OWNER_CHANGED");
        entries = inner.data.entries;
      } catch (error) {
        if (error instanceof OwnedRequestRecoveryError) throw error;
        return fail("UPDATE_REQUIRED");
      }
    }
    const projection = await options.project(
      entries.map((entry) => ({ ...entry })),
      current,
    );
    const final = await resolve();
    if (
      !sameQueueOwner(current.owner, final.owner) ||
      current.userId !== final.userId ||
      current.familyId !== final.familyId
    )
      return fail("OWNER_CHANGED");
    // A non-cooperating writer, retirement or changed fallback store also holds
    // discovery. Never select/clean one replica or return an earlier projection.
    const after = await probe();
    if (after.some((value, index) => value !== values[index]))
      return fail("DIVERGENT");
    rememberQueueOwner(final.owner); // Content-free logout retirement inventory.
    return { owner: { ...final.owner }, enabled: final.enabled, projection };
  });
}
