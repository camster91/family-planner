"use client";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { QueueStorageRecovery } from "@/components/ui/queue-storage-recovery";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import {
  QUEUE_MAX_AGE_MS,
  type OfflineQueue,
  type QueuedOperation,
} from "@/lib/offline-queue";
import { canonicalBodySignature } from "@/lib/request-signature";
import type { DeviceClient } from "@/lib/device-client";
import {
  queueReviewResponse,
  reviewEntry,
  reviewFingerprint,
  type QueueReviewTarget,
  type QueueReviewEntry,
} from "@/lib/queue-review-contract";
import { useQueueReviewText } from "@/i18n/queue-review";

type Reviewed = {
  fingerprint: string;
  payloadSignature: string;
  target: QueueReviewTarget | null;
};
function unsafeCreate(op: QueuedOperation) {
  return (
    !("itemId" in op.payload) &&
    (Date.now() - op.createdAt > QUEUE_MAX_AGE_MS ||
      op.lastError === "EXPIRED" ||
      op.lastError === "IDEMPOTENCY_KEY_REUSED")
  );
}
function needsReview(op: QueuedOperation) {
  return op.state === "failed" || op.state === "conflict";
}
/** Names come only from current scoped canonical reads; old content is hidden until validated. */
export function RecoveredQueueChanges({
  queue,
  deviceClient,
  open: externalOpen,
  onOpenChange,
  showLauncher = true,
}: {
  queue: OfflineQueue | null;
  deviceClient?: DeviceClient;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showLauncher?: boolean;
}) {
  const { text, locale } = useQueueReviewText();
  const [localOpen, setLocalOpen] = useState(false);
  const open = externalOpen ?? localOpen;
  const setOpen = (value: boolean) =>
    onOpenChange ? onOpenChange(value) : setLocalOpen(value);
  const [ops, setOps] = useState<QueuedOperation[]>([]);
  const [reviewed, setReviewed] = useState<Record<string, Reviewed>>({});
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"retryRequested" | "discarded" | null>(
    null,
  );
  const [discard, setDiscard] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const busyRef = useRef(false);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const queueIdentity = useRef(queue);
  queueIdentity.current = queue;
  const entriesRef = useRef<QueueReviewEntry[]>([]);
  const payloadsRef = useRef(new Map<string, string>());
  usePendingFormNavigationController(busy);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current++;
    };
  }, []);
  useEffect(() => {
    busyRef.current = false;
    setBusy(false);
    setDiscard(null);
    setNotice(null);
    if (!queue) {
      setOps([]);
      return;
    }
    let current = true;
    const update = () => {
      if (!current) return;
      setOps(
        queue.usesOwnerRecovery?.() ? queue.list().filter(needsReview) : [],
      );
      if (queue.hasStorageReadError()) setReviewed({});
    };
    update();
    const unsubscribe = queue.subscribe(update);
    void queue.ready.then(update);
    return () => {
      current = false;
      unsubscribe();
    };
  }, [queue]);
  entriesRef.current = ops.map(reviewEntry);
  payloadsRef.current = new Map(
    ops.map((op) => [op.id, canonicalBodySignature(op.payload)]),
  );
  const hasReviewOps = ops.length > 0;
  useEffect(() => {
    const current = ++sequence.current;
    setReviewed({});
    const entries = entriesRef.current;
    const payloads = payloadsRef.current;
    if (!open || !queue || !hasReviewOps) {
      setLoading(false);
      return;
    }
    setFailed(false);
    setLoading(true);
    void (async () => {
      try {
        let body: unknown;
        if (deviceClient)
          body = await deviceClient.request("/api/device/queue-review", {
            method: "POST",
            body: { entries },
          });
        else {
          const response = await fetch("/api/queue/review", {
            method: "POST",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entries }),
          });
          if (!response.ok) throw new Error("Review unavailable");
          body = await response.json();
        }
        const parsed = queueReviewResponse.safeParse(body);
        if (
          !parsed.success ||
          !queue.matchesOwner?.(parsed.data.owner) ||
          parsed.data.rows.length !== entries.length ||
          new Set(parsed.data.rows.map((row) => row.id)).size !== entries.length
        )
          throw new Error("Review unavailable");
        const next: Record<string, Reviewed> = {};
        for (const row of parsed.data.rows) {
          const expected = entries.find((entry) => entry.id === row.id);
          if (!expected || row.fingerprint !== reviewFingerprint(expected))
            throw new Error("Review changed");
          next[row.id] = {
            fingerprint: row.fingerprint,
            payloadSignature: payloads.get(row.id) ?? "",
            target: row.target,
          };
        }
        if (mounted.current && sequence.current === current) setReviewed(next);
      } catch {
        if (mounted.current && sequence.current === current) setFailed(true);
      } finally {
        if (mounted.current && sequence.current === current) setLoading(false);
      }
    })();
    // Explicit open/refresh reads the current snapshot. Queue state and locale
    // changes never refetch every row; new or changed entries require refresh.
  }, [open, queue, deviceClient, reload, hasReviewOps]);
  async function act(id: string, remove: boolean) {
    if (!queue || busyRef.current) return;
    const op = queue.list().find((op) => op.id === id);
    if (!op || !needsReview(op)) return;
    const verified = reviewed[id];
    if (!remove && unsafeCreate(op)) {
      setFailed(true);
      return;
    }
    if (
      !remove &&
      (!verified?.target ||
        verified.fingerprint !== reviewFingerprint(reviewEntry(op)) ||
        verified.payloadSignature !== canonicalBodySignature(op.payload))
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setFailed(false);
    setNotice(null);
    try {
      if (remove) await queue.discard(id);
      else await queue.retry(id);
      if (!queue.isDurable() || queue.hasStorageReadError())
        throw new Error("Recovery not confirmed");
      if (mounted.current && queueIdentity.current === queue) {
        setDiscard(null);
        setNotice(remove ? "discarded" : "retryRequested");
      }
    } catch {
      if (mounted.current && queueIdentity.current === queue) setFailed(true);
    } finally {
      if (queueIdentity.current === queue) {
        busyRef.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }
  if (!queue || (!open && !ops.length)) return null;
  return (
    <>
      {showLauncher && (
        <button
          type="button"
          className="btn-secondary min-h-[44px]"
          onClick={() => {
            setOpen(true);
            setNotice(null);
          }}
        >
          {text("open")} ({ops.length.toLocaleString(locale)})
        </button>
      )}
      <Dialog
        open={open}
        title={text("title")}
        description={text("intro")}
        closeLabel={text("close")}
        onClose={
          busy
            ? undefined
            : () => {
                setOpen(false);
                setDiscard(null);
              }
        }
        variant="form"
      >
        <div className="space-y-4 min-w-0">
          <QueueStorageRecovery queue={queue} />
          {failed && <p role="alert">{text("failed")}</p>}
          {notice && <p role="status">{text(notice)}</p>}
          {loading && <p role="status">{text("loading")}</p>}
          <button
            className="btn-secondary min-h-[44px]"
            disabled={loading || busy}
            onClick={() => setReload((value) => value + 1)}
          >
            {text("refresh")}
          </button>
          {!ops.length && !queue.hasStorageReadError() && (
            <p>{text("empty")}</p>
          )}
          <ul className="space-y-3">
            {ops.map((op) => {
              const data = reviewed[op.id];
              const target =
                data &&
                data.fingerprint === reviewFingerprint(reviewEntry(op)) &&
                data.payloadSignature === canonicalBodySignature(op.payload)
                  ? data.target
                  : null;
              const tick = "itemId" in op.payload;
              const isUnsafe = unsafeCreate(op);
              return (
                <li
                  key={op.id}
                  className="rounded-[var(--radius-lg)] border border-border p-3 space-y-2 break-words"
                >
                  {target ? (
                    <>
                      <p className="font-medium">
                        {tick
                          ? target.itemName
                          : "content" in op.payload
                            ? op.payload.content
                            : text("add")}
                      </p>
                      <p className="text-muted-foreground">
                        {text("list")}: {target.listName}
                      </p>
                      {target.actorName && (
                        <p>
                          {text("by")}: {target.actorName}
                        </p>
                      )}
                      {"itemId" in op.payload && (
                        <>
                          <p>
                            {text(
                              op.payload.checked ? "markDone" : "markNotDone",
                            )}
                          </p>
                          <p className="text-muted-foreground">
                            {text(
                              target.checked ? "currentDone" : "currentNotDone",
                            )}
                          </p>
                        </>
                      )}
                    </>
                  ) : (
                    <p>
                      {text(
                        loading ? "loading" : data ? "unavailable" : "refresh",
                      )}
                    </p>
                  )}
                  {isUnsafe && <p>{text("unsafeCreate")}</p>}
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="btn-primary min-h-[44px]"
                      disabled={busy || loading || !target || isUnsafe}
                      onClick={() => void act(op.id, false)}
                    >
                      {text(busy ? "busy" : "retry")}
                    </button>
                    <button
                      className="btn-secondary min-h-[44px]"
                      disabled={busy}
                      onClick={() => setDiscard(op.id)}
                    >
                      {text("discard")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </Dialog>
      <Dialog
        open={discard !== null}
        title={text("discardTitle")}
        description={text("discardHelp")}
        closeLabel={text("close")}
        onClose={busy ? undefined : () => setDiscard(null)}
        variant="form"
        footer={
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary min-h-[44px]"
              disabled={busy}
              onClick={() => setDiscard(null)}
            >
              {text("cancel")}
            </button>
            <button
              className="btn-primary min-h-[44px]"
              disabled={
                busy || !discard || !ops.some((op) => op.id === discard)
              }
              onClick={() => discard && void act(discard, true)}
            >
              {text(busy ? "busy" : "confirmDiscard")}
            </button>
          </div>
        }
      >
        {failed && <p role="alert">{text("failed")}</p>}
      </Dialog>
    </>
  );
}
