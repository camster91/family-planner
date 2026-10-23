/** Browser binding for exact owned inventory recovery. No background replay. */
import { queueStoreCandidates, type StorageLike } from "@/lib/offline-queue";
import { ownedQueueLocation } from "@/lib/owned-queue-persistence";
import {
  createInventoryRecoveryStore,
  InventoryRecoveryError,
} from "@/lib/inventory-recovery-store";
import {
  readInventoryRecoveryContext,
  readInventoryRecoveryReview,
} from "@/lib/inventory-recovery-client";
import type { IntakeContext } from "@/lib/inventory-intake-client";
import { newIdempotencyKey } from "@/lib/idempotency-key";

function storage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
function database(): IDBFactory | null {
  try {
    return typeof window === "undefined" ? null : (window.indexedDB ?? null);
  } catch {
    return null;
  }
}
export function browserInventoryRecovery(original: IntakeContext) {
  const localStorage = storage(),
    indexedDB = database();
  return createInventoryRecoveryStore({
    runtime: newIdempotencyKey(),
    resolveContext: async () => {
      const context = await readInventoryRecoveryContext();
      if (
        context.userId !== original.userId ||
        context.familyId !== original.familyId
      )
        throw new InventoryRecoveryError("OWNER_CHANGED");
      return context;
    },
    candidates: (owner) =>
      queueStoreCandidates(ownedQueueLocation(owner), {
        localStorage,
        indexedDB,
      }).candidates,
    reviewRecovered: async (entry, context) =>
      (await readInventoryRecoveryReview(entry, context)).canRetry,
  });
}
