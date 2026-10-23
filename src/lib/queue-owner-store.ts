/** #564 ownership-aware persistence. The server opt-in is off until integrated QA. */
import {
  fallbackQueueStore,
  parseStoredQueue,
  requiresCompatibleQueueClient,
  serializeQueue,
  QueueStorageError,
  QUEUEABLE_ACTIONS,
  QUEUE_MAX_OPS,
  QueueError,
  type QueuedOperation,
  type QueueStore,
  type SendRequest,
  type SendFn,
  type QueueNamespace,
} from "@/lib/offline-queue";
import { canonicalBodySignature } from "@/lib/request-signature";
import { rememberQueueOwner } from "@/lib/owned-queue-persistence";
import { LegacyQueueError } from "@/lib/legacy-queue-error";
import type {
  LegacyQueueDecision,
  LegacyQueuePreview,
} from "@/lib/legacy-queue-contract";
import type { QueueReviewEntry } from "@/lib/queue-review-contract";
import {
  ownedQueueEnvelope,
  queueOwnerResponse,
  queueOwnerSchema,
  RETIRED_QUEUE_ENVELOPE,
  sameQueueOwner,
  QUEUE_REVIEW_REQUIRED,
  ORIGINAL_DEVICE_REQUIRED,
  type QueueOwner,
  type QueueOwnerResponse,
} from "@/lib/queue-owner-contract";

export class QueueOwnerStorageError extends QueueStorageError {
  constructor(
    public readonly reason:
      "UNAVAILABLE" | "OWNER_CHANGED" | "UPDATE_REQUIRED" | "DIVERGENT",
  ) {
    super({ cleanupFailed: true });
    this.name = "QueueOwnerStorageError";
  }
}
function envelope(text: string) {
  try {
    return ownedQueueEnvelope.safeParse(JSON.parse(text));
  } catch {
    return ownedQueueEnvelope.safeParse(null);
  }
}
type Options = {
  candidates: QueueStore[];
  persistenceLane: object;
  namespace: QueueNamespace;
  runtime: string;
  resolveOwner: () => Promise<unknown>;
  ownedCandidates?: (owner: QueueOwner) => QueueStore[];
  withLease?: <T>(owner: QueueOwner, run: () => Promise<T>) => Promise<T>;
  withLegacyLease?: <T>(run: () => Promise<T>) => Promise<T>;
  reviewLegacy?: (entries: QueueReviewEntry[]) => Promise<unknown>;
};
type LegacyMigration = {
  preview: () => Promise<LegacyQueuePreview>;
  migrate: (decision: LegacyQueueDecision) => Promise<void>;
};
/**
 * All reads/writes run through the queue's shared namespace lane. Unknown
 * storage is never empty. New runtime = review, even if only one stale copy
 * survived an unrecorded retirement: pure local bytes cannot prove otherwise.
 */
export function ownerQueueStore(options: Options) {
  const legacy = fallbackQueueStore(
    options.candidates,
    options.persistenceLane,
  );
  let negotiated: QueueOwnerResponse | null = null;
  let negotiating: Promise<QueueOwnerResponse> | null = null;
  let expected: Array<string | null> | null = null;
  let failure: QueueOwnerStorageError["reason"] | null = null;
  let retirementRequested = false;
  let pendingWrite: string | null = null;
  let retirementBase: Array<string | null> | null = null;
  let retirementAttempt: string | null = null;
  let current = -1;
  let candidates = options.candidates;
  let reviewHeld = new Set<string>();
  let legacyDetected = false;
  let migrationCopy: {
    request: string;
    baseline: Array<string | null>;
    previousAttempt: string | null;
    text: string;
  } | null = null;

  function makeEnvelope(queue: string, owner: QueueOwner) {
    const ids = new Set(
      parseStoredQueue(queue, options.namespace.kind).ops.map((op) => op.id),
    );
    return JSON.stringify({
      v: 2,
      envelope: "herewoven.queue-store.v2",
      state: "active",
      owner,
      runtime: options.runtime,
      queue,
      reviewIds: [...reviewHeld].filter((id) => ids.has(id)),
    });
  }

  function fail(reason: QueueOwnerStorageError["reason"]): never {
    failure = reason;
    throw new QueueOwnerStorageError(reason);
  }
  async function resolve(fresh = false): Promise<QueueOwnerResponse> {
    if (!fresh && negotiated) return negotiated;
    if (!fresh && negotiating) return negotiating;
    const run = (async () => {
      const parsed = queueOwnerResponse.safeParse(await options.resolveOwner());
      if (!parsed.success) return fail("UNAVAILABLE");
      const result = parsed.data;
      if (
        result.owner &&
        (result.owner.kind !== options.namespace.kind ||
          (options.namespace.kind === "person" &&
            result.owner.ownerId !== options.namespace.userId))
      )
        return fail("OWNER_CHANGED");
      if (!fresh) {
        negotiated = result;
        if (result.owner) {
          rememberQueueOwner(result.owner);
          if (options.ownedCandidates)
            candidates = options.ownedCandidates(result.owner);
        }
      }
      return result;
    })().catch((error) => {
      if (error instanceof QueueOwnerStorageError) throw error;
      return fail("UNAVAILABLE");
    });
    if (fresh) return run;
    negotiating = run;
    try {
      return await run;
    } finally {
      if (negotiating === run) negotiating = null;
    }
  }
  async function probe() {
    if (!candidates.length) return fail("UNAVAILABLE");
    // Probe all, including known failed stores. An unread retirement witness
    // must not be treated as absent because another candidate has old work.
    const values = await Promise.allSettled(
      candidates.map((store) => store.read()),
    );
    if (values.some((value) => value.status === "rejected"))
      return fail("UNAVAILABLE");
    return values.map(
      (value) => (value as PromiseFulfilledResult<string | null>).value,
    );
  }
  function consistent(values: Array<string | null>) {
    const nonempty = values.filter((value): value is string => value !== null);
    if (new Set(nonempty).size > 1) return fail("DIVERGENT");
    return nonempty[0] ?? null;
  }
  function sameSnapshot(a: Array<string | null>, b: Array<string | null>) {
    return (
      a.length === b.length && a.every((value, index) => value === b[index])
    );
  }
  async function writeAll(value: string) {
    // Bounded wraparound preserves recovered-earlier-store availability.
    // One verified journal remains; every other store must be read back empty.
    const order =
      current < 0
        ? candidates.map((_, index) => index)
        : [
            current,
            ...candidates
              .map((_, index) => index)
              .filter((index) => index !== current),
          ];
    for (const index of order) {
      try {
        await candidates[index].write(value);
      } catch {
        continue;
      }
      current = index;
      const cleanup = await Promise.allSettled(
        candidates.map((store, other) =>
          other === index ? Promise.resolve() : store.remove(),
        ),
      );
      if (cleanup.some((result) => result.status === "rejected"))
        return fail("UNAVAILABLE");
      const values = await probe();
      if (
        values.some(
          (saved, other) => saved !== (other === index ? value : null),
        )
      )
        return fail("DIVERGENT");
      expected = values;
      failure = null;
      return;
    }
    return fail("UNAVAILABLE");
  }
  function assertKnownCopies(
    values: Array<string | null>,
    baseline: Array<string | null> | null,
    attempted: string | null,
    retiring = false,
  ) {
    if (
      !baseline ||
      values.some(
        (value, index) =>
          value !== null &&
          value !== baseline[index] &&
          value !== attempted &&
          !(retiring && value === RETIRED_QUEUE_ENVELOPE),
      )
    )
      return fail("DIVERGENT");
  }
  function active(value: string, owner: QueueOwner) {
    const parsed = envelope(value);
    if (!parsed.success) return fail("UPDATE_REQUIRED");
    if (parsed.data.state !== "active") return null;
    if (!sameQueueOwner(owner, parsed.data.owner)) return fail("OWNER_CHANGED");
    if (
      requiresCompatibleQueueClient(parsed.data.queue, options.namespace.kind)
    )
      return fail("UPDATE_REQUIRED");
    const contents = parseStoredQueue(
      parsed.data.queue,
      options.namespace.kind,
    );
    if (contents.dropped) return fail("UPDATE_REQUIRED");
    reviewHeld = new Set(
      parsed.data.runtime === options.runtime
        ? (parsed.data.reviewIds ?? [])
        : contents.ops.map((op) => op.id),
    );
    return { saved: parsed.data, ops: contents.ops };
  }
  async function assertLegacyEmpty() {
    if (!options.ownedCandidates) return;
    const raw = await legacy.read();
    if (raw === null || raw === RETIRED_QUEUE_ENVELOPE) {
      legacyDetected = false;
      return;
    }
    if (requiresCompatibleQueueClient(raw, options.namespace.kind))
      return fail("UPDATE_REQUIRED");
    const parsed = parseStoredQueue(raw, options.namespace.kind);
    if (parsed.dropped) return fail("UPDATE_REQUIRED");
    if (parsed.ops.length) {
      legacyDetected = true;
      return fail("UPDATE_REQUIRED");
    }
    legacyDetected = false;
  }
  async function assertRollbackReadable(result: QueueOwnerResponse) {
    if (!options.ownedCandidates || !result.owner) return;
    for (const value of await probe()) {
      if (value === null) continue;
      const parsed = envelope(value);
      if (!parsed.success || parsed.data.state !== "retired")
        return fail("UPDATE_REQUIRED");
    }
  }
  async function withLease<T>(run: () => Promise<T>) {
    const result = await resolve();
    if (!result.enabled) return run();
    if (!options.withLease) return fail("UNAVAILABLE");
    try {
      return await options.withLease(result.owner, run);
    } catch (error) {
      if (error instanceof QueueOwnerStorageError) throw error;
      return fail("UNAVAILABLE");
    }
  }
  async function currentMigrationOwner() {
    const owner = await resolve();
    const current = await resolve(true);
    if (
      !owner.enabled ||
      !current.enabled ||
      !sameQueueOwner(owner.owner, current.owner)
    )
      return fail("OWNER_CHANGED");
    return current.owner;
  }
  function hold(op: QueuedOperation): QueuedOperation {
    return op.state === "pending" || op.state === "syncing"
      ? { ...op, state: "conflict", lastError: QUEUE_REVIEW_REQUIRED }
      : op;
  }
  function sameIntent(a: QueuedOperation, b: QueuedOperation) {
    return (
      canonicalBodySignature([a.id, a.action, a.v, a.createdAt, a.payload]) ===
      canonicalBodySignature([b.id, b.action, b.v, b.createdAt, b.payload])
    );
  }
  const canMigrateLegacy = () =>
    Boolean(
      options.ownedCandidates &&
        options.withLegacyLease &&
        options.reviewLegacy,
    );
  let migration: LegacyMigration | null = null;
  let migrationLoading: Promise<LegacyMigration> | null = null;

  /**
   * Keep the migration engine out of the initial queue graph. A failed lazy
   * load clears the in-flight promise so the explicit recovery action can
   * retry it; there is no empty/success fallback.
   */
  async function loadMigration(): Promise<LegacyMigration> {
    if (migration) return migration;
    if (!canMigrateLegacy()) return fail("UPDATE_REQUIRED");
    if (migrationLoading) return migrationLoading;

    const loading = (async () => {
      const { createLegacyMigration } = await import(
        "@/lib/legacy-queue-migration"
      );
      const created = createLegacyMigration({
        stores: options.candidates,
        namespace: options.namespace.kind,
        runtime: options.runtime,
        getOwner: currentMigrationOwner,
        reviewTargets: options.reviewLegacy!,
        lease: (run) => options.withLegacyLease!(() => withLease(run)),
        copyStarted: () => migrationCopy !== null,
        copied: () => {
          migrationCopy = null;
          legacyDetected = false;
        },
        async copy(request, owner, incoming) {
          if (retirementRequested) await store.remove();
          if (migrationCopy && migrationCopy.request !== request)
            return fail("DIVERGENT");
          if (!migrationCopy) {
            const values = await probe();
            const previousAttempt = pendingWrite;
            if (previousAttempt !== null)
              assertKnownCopies(values, expected, previousAttempt);
            const raw = previousAttempt ?? consistent(values);
            const original = raw === null ? null : active(raw, owner);
            const merged = (original?.ops ?? []).map(hold);
            for (const op of incoming) {
              const found = merged.find((saved) => saved.id === op.id);
              if (found) {
                if (!sameIntent(found, op)) return fail("DIVERGENT");
                continue;
              }
              merged.push(
                op.action === "device.list-item.add"
                  ? {
                      ...op,
                      state: "failed",
                      lastError: ORIGINAL_DEVICE_REQUIRED,
                    }
                  : hold(op),
              );
            }
            if (merged.length > QUEUE_MAX_OPS)
              throw new QueueError("QUEUE_FULL");
            reviewHeld = new Set(merged.map((op) => op.id));
            migrationCopy = {
              request,
              baseline: values,
              previousAttempt,
              text: merged.length
                ? makeEnvelope(serializeQueue(merged), owner)
                : RETIRED_QUEUE_ENVELOPE,
            };
          }
          const attempt = migrationCopy;
          const values = await probe();
          if (
            values.some(
              (value, index) =>
                value !== null &&
                value !== attempt.baseline[index] &&
                value !== attempt.previousAttempt &&
                value !== attempt.text,
            )
          )
            return fail("DIVERGENT");
          await writeAll(attempt.text);
          pendingWrite = null;
        },
      });
      migration = created;
      return created;
    })();
    migrationLoading = loading;
    try {
      return await loading;
    } finally {
      if (migrationLoading === loading) migrationLoading = null;
    }
  }

  async function migrationForRecovery(): Promise<LegacyMigration> {
    try {
      return await loadMigration();
    } catch (error) {
      if (error instanceof QueueOwnerStorageError) throw error;
      return fail("UNAVAILABLE");
    }
  }
  const store: QueueStore = {
    persistenceLane: options.persistenceLane,
    failureReason: () => failure,
    usesOwnerRecovery: () => negotiated?.enabled === true,
    legacyRecoveryAvailable: () => legacyDetected && canMigrateLegacy(),
    previewLegacy: async () => {
      const loaded = await migrationForRecovery();
      return loaded.preview();
    },
    migrateLegacy: async (decision) => {
      const loaded = await migrationForRecovery();
      try {
        await loaded.migrate(decision);
      } catch (error) {
        if (error instanceof LegacyQueueError) return fail(error.reason);
        throw error;
      }
    },
    holdsReview: (id) => reviewHeld.has(id),
    resolveReview: (id) => {
      reviewHeld.delete(id);
    },
    matchesOwner: (value) => {
      const owner = queueOwnerSchema.safeParse(value);
      return Boolean(
        owner.success &&
        negotiated?.owner &&
        sameQueueOwner(owner.data, negotiated.owner),
      );
    },
    async read() {
      const result = await resolve();
      if (!result.enabled) {
        await assertRollbackReadable(result);
        const value = await legacy.read();
        if (value !== null) {
          const parsed = envelope(value);
          if (parsed.success && parsed.data.state === "retired") return null;
          if (parsed.success) return fail("UPDATE_REQUIRED");
        }
        return value;
      }
      if (retirementRequested) {
        // Only an explicit core storage-read retry reaches this branch. It
        // completes the previously requested retirement, never reloads bytes
        // from the failed purge as live work.
        assertKnownCopies(
          await probe(),
          retirementBase,
          retirementAttempt,
          true,
        );
        await writeAll(RETIRED_QUEUE_ENVELOPE);
        retirementRequested = false;
      }
      if (pendingWrite !== null) {
        // Preserve the exact unconfirmed write across an explicit storage
        // retry. Reading an older snapshot must not replace in-memory intent.
        const attempted = pendingWrite;
        assertKnownCopies(await probe(), expected, attempted);
        await writeAll(attempted);
        pendingWrite = null;
      }
      await assertLegacyEmpty();
      const values = await probe();
      const value = consistent(values);
      current = values.findIndex((saved) => saved !== null);
      if (value === null) {
        expected = values;
        failure = null;
        return null;
      }
      const contents = active(value, result.owner);
      expected = values;
      failure = null;
      if (!contents) return null;
      if (
        contents.saved.runtime === options.runtime &&
        !contents.ops.some((op) => reviewHeld.has(op.id))
      )
        return contents.saved.queue;
      // Never auto-replay an old active snapshot after process death. Its owner
      // is still canonical, but its unrecorded cleanup intent cannot be known.
      const reviewed = contents.ops.map((op) =>
        reviewHeld.has(op.id) &&
        (op.state === "pending" || op.state === "syncing")
          ? {
              ...op,
              state: "conflict" as const,
              lastError: QUEUE_REVIEW_REQUIRED,
            }
          : op,
      );
      return serializeQueue(reviewed);
    },
    async write(queue) {
      const result = await resolve();
      if (!result.enabled) {
        await assertRollbackReadable(result);
        await legacy.write(queue);
        return;
      }
      await assertLegacyEmpty();
      if (retirementRequested || !expected) return fail("UNAVAILABLE");
      const values = await probe();
      if (!sameSnapshot(values, expected)) return fail("DIVERGENT");
      if (
        requiresCompatibleQueueClient(queue, options.namespace.kind) ||
        parseStoredQueue(queue, options.namespace.kind).dropped
      )
        return fail("UPDATE_REQUIRED");
      pendingWrite = makeEnvelope(queue, result.owner);
      await writeAll(pendingWrite);
      pendingWrite = null;
    },
    async remove() {
      // Retirement remains possible after auth loss. It carries no identity or
      // data, and is written before any success receipt. Never delete witnesses.
      if (!negotiated?.enabled) {
        await legacy.remove();
        return;
      }
      if (!retirementRequested) {
        retirementBase = expected;
        retirementAttempt = pendingWrite;
      }
      retirementRequested = true;
      pendingWrite = null;
      assertKnownCopies(await probe(), retirementBase, retirementAttempt, true);
      await writeAll(RETIRED_QUEUE_ENVELOPE);
      retirementRequested = false;
    },
  };
  async function send(request: SendRequest, delegate: SendFn) {
    const result = await resolve();
    if (!result.enabled) {
      await assertRollbackReadable(result);
      return delegate(request);
    }
    try {
      await assertLegacyEmpty();
      const current = await resolve(true);
      if (!current.enabled || !sameQueueOwner(current.owner, result.owner))
        return fail("OWNER_CHANGED");
      if (retirementRequested || !expected) return fail("UNAVAILABLE");
      const values = await probe();
      if (!sameSnapshot(values, expected)) return fail("DIVERGENT");
      const value = consistent(values);
      if (value === null) return fail("UNAVAILABLE");
      const contents = active(value, current.owner);
      if (!contents || contents.saved.runtime !== options.runtime)
        return fail("OWNER_CHANGED");
      const op = contents.ops.find((op) => op.id === request.idempotencyKey);
      if (
        !op ||
        op.state !== "pending" ||
        op.lastError === QUEUE_REVIEW_REQUIRED ||
        op.lastError === ORIGINAL_DEVICE_REQUIRED ||
        reviewHeld.has(op.id)
      )
        return fail("UNAVAILABLE");
      // The v1 reader normalizes syncing -> pending. Compare the complete
      // reviewed wire request, not just the id, before any network mutation.
      const spec = QUEUEABLE_ACTIONS[op.action] as {
        method: string;
        path: string | ((payload: NonNullable<typeof op>["payload"]) => string);
        body: (payload: NonNullable<typeof op>["payload"]) => Record<string, unknown>;
      };
      const path =
        typeof spec.path === "function" ? spec.path(op.payload) : spec.path;
      if (
        request.method !== spec.method ||
        request.path !== path ||
        canonicalBodySignature(request.body) !==
          canonicalBodySignature(spec.body(op.payload))
      )
        return fail("DIVERGENT");
      return delegate({ ...request, ownerScope: current.owner.scope });
    } catch (error) {
      if (!(error instanceof QueueOwnerStorageError)) throw error;
      return {
        status: 409,
        body: {
          error: {
            code:
              error.reason === "OWNER_CHANGED"
                ? "QUEUE_OWNER_CHANGED"
                : "QUEUE_STORAGE_UNCERTAIN",
          },
        },
      };
    }
  }
  const guardedStore: QueueStore = {
    ...store,
    read: () => withLease(() => store.read()),
    async write(value) {
      const result = await resolve();
      if (result.enabled) {
        if (retirementRequested) return fail("UNAVAILABLE");
        if (
          requiresCompatibleQueueClient(value, options.namespace.kind) ||
          parseStoredQueue(value, options.namespace.kind).dropped
        )
          return fail("UPDATE_REQUIRED");
        const attempted = makeEnvelope(value, result.owner);
        if (pendingWrite !== null && pendingWrite !== attempted)
          return fail("DIVERGENT");
        // Capture exact intent before lease acquisition too. A busy lease is a
        // failed persistence attempt, not permission to reload older bytes.
        pendingWrite = attempted;
      }
      return withLease(() => store.write(value));
    },
    async remove() {
      const result = await resolve();
      if (result.enabled && !retirementRequested) {
        retirementBase = expected;
        retirementAttempt = pendingWrite;
        retirementRequested = true;
        pendingWrite = null;
      }
      return withLease(() => store.remove());
    },
  };
  return {
    store: guardedStore,
    async send(request: SendRequest, delegate: SendFn) {
      try {
        return await withLease(() => send(request, delegate));
      } catch (error) {
        if (!(error instanceof QueueOwnerStorageError)) throw error;
        return {
          status: 409,
          body: {
            error: {
              code:
                error.reason === "OWNER_CHANGED"
                  ? "QUEUE_OWNER_CHANGED"
                  : "QUEUE_STORAGE_UNCERTAIN",
            },
          },
        };
      } finally {
        // A terminal device response can request retirement while this send
        // owns the lease. Give that exact retirement one event-driven attempt
        // after releasing the send lease; no timer or background retry loop.
        if (retirementRequested) {
          try {
            await withLease(() => store.remove());
          } catch {
            /* witness remains uncertain; never replay */
          }
        }
      }
    },
    failureReason: () => failure,
  };
}
