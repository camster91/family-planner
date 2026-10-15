"use client";

import * as React from "react";
import type { OfflineQueue } from "@/lib/offline-queue";
import { useTranslation } from "@/i18n";

/** A deliberate read retry, never a replacement or discard of unread work. */
export function QueueStorageRecovery({ queue }: { queue: OfflineQueue | null }) {
  const { t } = useTranslation();
  const subscribe = React.useCallback(
    (listener: () => void) => queue?.subscribe(listener) ?? (() => {}),
    [queue],
  );
  const blocked = React.useSyncExternalStore(
    subscribe,
    () => queue?.hasStorageReadError() ?? false,
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

  if (!queue || !blocked) return null;

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
      <p role="status" className="text-subhead text-label-primary">
        {t("groceries.storageUnavailable")}
      </p>
      <button
        type="button"
        className="btn-secondary min-h-11 max-w-full whitespace-normal text-left"
        disabled={busy}
        aria-busy={busy}
        onClick={() => void retry()}
      >
        {t(busy ? "groceries.storageRetrying" : "groceries.storageRetry")}
      </button>
    </section>
  );
}
