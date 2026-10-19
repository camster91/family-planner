/** Explicit local recovery only. No network mutation, new request key or guessed origin. */
import {
  parseStoredQueue,
  requiresCompatibleQueueClient,
  type QueueStore,
  type QueueNamespace,
  type QueuedOperation,
} from "@/lib/offline-queue";
import { canonicalBodySignature } from "@/lib/request-signature";
import {
  RETIRED_QUEUE_ENVELOPE,
  sameQueueOwner,
  type QueueOwner,
} from "@/lib/queue-owner-contract";
import {
  reviewEntry,
  reviewFingerprint,
  matchingReviewTarget,
  queueReviewResponse,
  type QueueReviewEntry,
} from "@/lib/queue-review-contract";
import type {
  LegacyQueueDecision,
  LegacyQueuePreview,
} from "@/lib/legacy-queue-contract";
type Options = {
  stores: QueueStore[];
  namespace: QueueNamespace["kind"];
  runtime: string;
  getOwner: () => Promise<QueueOwner>;
  reviewTargets: (entries: QueueReviewEntry[]) => Promise<unknown>;
  lease: <T>(run: () => Promise<T>) => Promise<T>;
  copy: (
    request: string,
    owner: QueueOwner,
    operations: QueuedOperation[],
  ) => Promise<void>;
  copied: () => void;
  copyStarted: () => boolean;
};
export class LegacyQueueError extends Error {
  constructor(
    public readonly reason:
      "UNAVAILABLE" | "DIVERGENT" | "OWNER_CHANGED" | "UPDATE_REQUIRED",
  ) {
    super("Older saved changes could not be confirmed.");
    this.name = "LegacyQueueError";
  }
}
export function createLegacyMigration(options: Options) {
  let serial = 0;
  let preview: {
    value: LegacyQueuePreview;
    raw: Array<string | null>;
    owner: QueueOwner;
  } | null = null;
  let attempt: {
    request: string;
    decision: LegacyQueueDecision;
    raw: Array<string | null>;
    owner: QueueOwner;
    kept: QueuedOperation[];
  } | null = null;
  const fail = (reason: LegacyQueueError["reason"]): never => {
    throw new LegacyQueueError(reason);
  };
  async function probe() {
    if (!options.stores.length) return fail("UNAVAILABLE");
    const results = await Promise.allSettled(
      options.stores.map((store) => store.read()),
    );
    if (results.some((result) => result.status === "rejected"))
      return fail("UNAVAILABLE");
    return results.map(
      (result) => (result as PromiseFulfilledResult<string | null>).value,
    );
  }
  function snapshot(values: Array<string | null>) {
    const populated = values.filter((value): value is string => value !== null);
    if (new Set(populated).size > 1) return fail("DIVERGENT");
    const raw = populated[0] ?? null;
    if (raw === null || raw === RETIRED_QUEUE_ENVELOPE) return [];
    if (requiresCompatibleQueueClient(raw, options.namespace))
      return fail("UPDATE_REQUIRED");
    const parsed = parseStoredQueue(raw, options.namespace);
    if (parsed.dropped) return fail("UPDATE_REQUIRED");
    // A v1 label alone does not authorize dropping unfamiliar fields. Only
    // exact supported intent shapes can cross the migration boundary.
    const container = JSON.parse(raw) as {
      v: number;
      ops: Array<Record<string, unknown>>;
    };
    if (Object.keys(container).some((key) => key !== "v" && key !== "ops"))
      return fail("UPDATE_REQUIRED");
    const allowed = new Set([
      "id",
      "action",
      "v",
      "target",
      "payload",
      "createdAt",
      "state",
      "attempts",
      "nextAttemptAt",
      "lastError",
    ]);
    if (
      container.ops.some(
        (op, index) =>
          Object.keys(op).some((key) => !allowed.has(key)) ||
          canonicalBodySignature(op.payload) !==
            canonicalBodySignature(parsed.ops[index]?.payload),
      )
    )
      return fail("UPDATE_REQUIRED");
    return parsed.ops;
  }
  async function reviewed(owner: QueueOwner, operations: QueuedOperation[]) {
    if (!operations.length) return {};
    const entries = operations.map(reviewEntry);
    const parsed = queueReviewResponse.safeParse(
      await options.reviewTargets(entries),
    );
    if (
      !parsed.success ||
      !sameQueueOwner(parsed.data.owner, owner) ||
      parsed.data.rows.length !== entries.length ||
      new Set(parsed.data.rows.map((row) => row.id)).size !== entries.length
    )
      return fail("OWNER_CHANGED");
    const targets: LegacyQueuePreview["targets"] = {};
    for (const row of parsed.data.rows) {
      const entry = entries.find((entry) => entry.id === row.id);
      if (
        !entry ||
        row.fingerprint !== reviewFingerprint(entry) ||
        !matchingReviewTarget(entry, row.target)
      )
        return fail("DIVERGENT");
      targets[row.id] = row.target;
    }
    return targets;
  }
  async function retire(raw: Array<string | null>) {
    const before = await probe();
    if (
      before.some(
        (value, index) =>
          value !== null &&
          value !== raw[index] &&
          value !== RETIRED_QUEUE_ENVELOPE,
      )
    )
      return fail("DIVERGENT");
    for (let index = 0; index < options.stores.length; index++) {
      try {
        await options.stores[index].write(RETIRED_QUEUE_ENVELOPE);
      } catch {
        continue;
      }
      const cleaned = await Promise.allSettled(
        options.stores.map((store, other) =>
          other === index ? Promise.resolve() : store.remove(),
        ),
      );
      if (cleaned.some((result) => result.status === "rejected"))
        return fail("UNAVAILABLE");
      const verified = await probe();
      if (
        verified.some(
          (value, other) =>
            value !== (other === index ? RETIRED_QUEUE_ENVELOPE : null),
        )
      )
        return fail("DIVERGENT");
      return;
    }
    return fail("UNAVAILABLE");
  }
  return {
    async preview(): Promise<LegacyQueuePreview> {
      return options.lease(async () => {
        if (attempt) {
          if (
            !preview ||
            !sameQueueOwner(attempt.owner, await options.getOwner())
          )
            return fail("OWNER_CHANGED");
          preview.value.targets = await reviewed(
            attempt.owner,
            preview.value.operations,
          );
          return JSON.parse(
            JSON.stringify(preview.value),
          ) as LegacyQueuePreview;
        }
        const owner = await options.getOwner();
        const raw = await probe();
        const operations = snapshot(raw);
        const targets = await reviewed(owner, operations);
        if (!sameQueueOwner(owner, await options.getOwner()))
          return fail("OWNER_CHANGED");
        const value = {
          token: `${options.runtime}:${++serial}`,
          operations,
          targets,
        };
        preview = { value, raw, owner };
        return JSON.parse(JSON.stringify(value)) as LegacyQueuePreview;
      });
    },
    async migrate(decision: LegacyQueueDecision) {
      return options.lease(async () => {
        const request = canonicalBodySignature({
          token: decision.token,
          keep: [...decision.keep].sort(),
          discard: [...decision.discard].sort(),
        });
        if (attempt && attempt.request !== request) return fail("DIVERGENT");
        if (!attempt) {
          if (!preview || preview.value.token !== decision.token)
            return fail("UNAVAILABLE");
          if (!preview.value.operations.length) return fail("UNAVAILABLE");
          const ids = [...decision.keep, ...decision.discard];
          if (
            new Set(ids).size !== ids.length ||
            ids.length !== preview.value.operations.length ||
            ids.some(
              (id) => !preview!.value.operations.some((op) => op.id === id),
            )
          )
            return fail("DIVERGENT");
          const owner = await options.getOwner();
          if (!sameQueueOwner(owner, preview.owner))
            return fail("OWNER_CHANGED");
          const current = await probe();
          if (current.some((value, index) => value !== preview!.raw[index]))
            return fail("DIVERGENT");
          const kept = preview.value.operations.filter((op) =>
            decision.keep.includes(op.id),
          );
          const targets = await reviewed(owner, kept);
          if (kept.some((op) => !targets[op.id])) return fail("OWNER_CHANGED");
          attempt = {
            request,
            decision: {
              token: decision.token,
              keep: [...decision.keep],
              discard: [...decision.discard],
            },
            raw: preview.raw,
            owner,
            kept,
          };
        }
        const currentAttempt = attempt;
        if (!sameQueueOwner(currentAttempt.owner, await options.getOwner()))
          return fail("OWNER_CHANGED");
        try {
          await options.copy(
            request,
            currentAttempt.owner,
            currentAttempt.kept,
          );
        } catch (error) {
          if (!options.copyStarted()) attempt = null;
          throw error;
        }
        // A cookie/context change during copying must leave the old source
        // intact. The verified copy is held, not automatically replayed.
        if (!sameQueueOwner(currentAttempt.owner, await options.getOwner()))
          return fail("OWNER_CHANGED");
        await retire(currentAttempt.raw);
        options.copied();
        attempt = null;
        preview = null;
      });
    },
  };
}
