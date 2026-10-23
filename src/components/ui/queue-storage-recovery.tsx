"use client";

import * as React from "react";
import type { OfflineQueue } from "@/lib/offline-queue";
import { useCoreTranslation } from "@/i18n/core";
// Ordinary, healthy queues have no older work to review. Load that review
// surface only when the canonical queue reports it; never infer an empty queue
// from unavailable storage or delay the storage-error/retry controls.
const LegacyQueueRecovery = React.lazy(() =>
  import("@/components/ui/legacy-queue-recovery").then((module) => ({
    default: module.LegacyQueueRecovery,
  })),
);

/** A deliberate read retry, never a replacement or discard of unread work. */
export function QueueStorageRecovery({
  queue,
}: {
  queue: OfflineQueue | null;
}) {
  const { t } = useCoreTranslation();
  const subscribe = React.useCallback(
    (listener: () => void) => queue?.subscribe(listener) ?? (() => {}),
    [queue],
  );
  const blocked = React.useSyncExternalStore(
    subscribe,
    () => queue?.hasStorageReadError() ?? false,
    () => false,
  );
  const reason = React.useSyncExternalStore(
    subscribe,
    () => queue?.storageFailureReason?.() ?? null,
    () => null,
  );
  const legacyAvailable = React.useSyncExternalStore(
    subscribe,
    () => queue?.legacyRecoveryAvailable?.() ?? false,
    () => false,
  );
  const [busy, setBusy] = React.useState(false);
  const generation = React.useRef(0);
  const retrying = React.useRef(false);

  React.useEffect(() => {
    const current = ++generation.current;
    retrying.current = false;
    setBusy(false);
    return () => {
      generation.current = current + 1;
    };
  }, [queue]);

  if (!queue || (!blocked && !legacyAvailable)) return null;

  const retry = async () => {
    if (retrying.current) return;
    const current = generation.current;
    retrying.current = true;
    setBusy(true);
    try {
      await queue.retryStorageRead();
    } catch {
      // Keep the existing recovery state; never expose a storage exception.
    } finally {
      if (generation.current === current) {
        retrying.current = false;
        setBusy(false);
      }
    }
  };

  return (
    <section
      className="card-apple space-y-3 p-4"
      data-testid="queue-storage-recovery"
    >
      {blocked && (
        <p role="status" className="text-subhead text-label-primary">
          {t(
            reason === "OWNER_CHANGED"
              ? "groceries.storageOwnerChanged"
              : reason === "UPDATE_REQUIRED"
                ? "groceries.storageVersionRequired"
                : "groceries.storageUnavailable",
          )}
        </p>
      )}
      {blocked && (
        <button
          type="button"
          className="btn-secondary min-h-11 max-w-full whitespace-normal text-left"
          disabled={busy}
          aria-busy={busy}
          onClick={() => void retry()}
        >
          {t(busy ? "groceries.storageRetrying" : "groceries.storageRetry")}
        </button>
      )}
      {legacyAvailable && (
        <React.Suspense fallback={<p role="status">{t("common.loading")}</p>}>
          <LegacyQueueRecovery queue={queue} />
        </React.Suspense>
      )}
    </section>
  );
}
