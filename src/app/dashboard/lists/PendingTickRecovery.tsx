"use client";

import * as React from "react";
import { useTranslation } from "@/i18n";
import type { GroceryMessage } from "@/i18n/grocery-controls";
import { Dialog } from "@/components/ui/dialog";
import { QueueStorageRecovery } from "@/components/ui/queue-storage-recovery";
import { RecoveredQueueChanges } from "@/components/ui/recovered-queue-changes";
import { getPersonQueue } from "@/lib/person-queue-browser";
import { cn } from "@/lib/utils";
import {
  isCheckedOperation,
  type CheckedQueuedOperation,
  type OfflineQueue,
} from "@/lib/offline-queue";

function needsReview(op: { state: string }) {
  return op.state === "failed" || op.state === "conflict";
}

/**
 * Deliberate recovery independent of canonical list/item existence. No item
 * content is stored here. The card shows only while this person's queue holds
 * something to review (a waiting tick, a change needing review, unreadable or
 * incompatible saved changes), or while its dialog is open; a new family with
 * nothing queued never sees it. The list pages already load the same
 * per-person queue for ticks and adds, so watching it here sends nothing new.
 */
export default function PendingTickRecovery({
  userId,
  className,
}: {
  userId: string;
  /** Lets the host page put the card on its own gutter. */
  className?: string;
}) {
  const { t, locale } = useTranslation();
  const [open, setOpenState] = React.useState(false);
  // Once opened on this visit the card stays, so closing the dialog after the
  // last tick was discarded returns focus to "Review waiting ticks".
  const [opened, setOpened] = React.useState(false);
  const setOpen = (next: boolean) => {
    if (next) setOpened(true);
    setOpenState(next);
  };
  const [ops, setOps] = React.useState<CheckedQueuedOperation[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  // Something in the queue is worth this card (see above); false until read.
  const [hasWork, setHasWork] = React.useState(false);
  const [storageBlocked, setStorageBlocked] = React.useState(false);
  const [confirm, setConfirm] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<GroceryMessage | null>(null);
  const queueRef = React.useRef<OfflineQueue | null>(null);
  const [recoveryQueue, setRecoveryQueue] = React.useState<{
    userId: string;
    queue: OfflineQueue;
  } | null>(null);
  const busyRef = React.useRef(false);
  const generation = React.useRef(0);

  React.useEffect(() => {
    setOps([]);
    setLoaded(false);
    setHasWork(false);
    setConfirm(null);
    setMessage(null);
    const queue = getPersonQueue(userId);
    queueRef.current = queue;
    setRecoveryQueue({ userId, queue });
    let active = true;
    const current = ++generation.current;
    const update = () => {
      if (!active) return;
      const all = queue.list();
      const ticks = all.filter(
        (op): op is CheckedQueuedOperation =>
          op.action === "list-item.set-checked" && isCheckedOperation(op),
      );
      setStorageBlocked(queue.hasStorageReadError());
      if (queue.requiresCompatibleClient()) setMessage("compatibleClient");
      setOps(ticks);
      setHasWork(
        ticks.length > 0 ||
          queue.hasStorageReadError() ||
          queue.requiresCompatibleClient() ||
          Boolean(queue.usesOwnerRecovery?.() && all.some(needsReview)),
      );
    };
    const unsubscribe = queue.subscribe((event) => {
      update();
      if (active && event.type === "auth-lost") {
        setConfirm(null);
        setMessage("tickAuthLost");
      }
    });
    void queue.ready.then(() => {
      if (!active || generation.current !== current) return;
      update();
      setLoaded(true);
    });
    return () => {
      active = false;
      generation.current = current + 1;
      queueRef.current = null;
      unsubscribe();
    };
  }, [userId]);

  const run = async (id: string, discard: boolean) => {
    const queue = queueRef.current;
    if (!queue || busyRef.current) return;
    if (discard) {
      const current = queue.list().find((op) => op.id === id);
      if (!current || current.state === "syncing") return;
    }
    const current = generation.current;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      if (discard) await queue.discard(id);
      else await queue.retry(id);
      if (generation.current !== current) return;
      setConfirm(null);
      setMessage(discard ? "tickDiscarded" : "tickRetryRequested");
    } catch {
      if (generation.current === current) setMessage("tickUpdateFailed");
    } finally {
      busyRef.current = false;
      if (generation.current === current) setBusy(false);
    }
  };

  const canOpenDiscard = (id: string) => {
    if (busyRef.current) return false;
    const queue = queueRef.current;
    if (!queue) return false;
    const current = queue.list().find((op) => op.id === id);
    return Boolean(current && current.state !== "syncing");
  };

  const namedQueue =
    recoveryQueue?.userId === userId ? recoveryQueue.queue : null;
  if (!open && !opened && !(loaded && hasWork)) return null;
  if (namedQueue?.usesOwnerRecovery?.())
    return (
      <section
        className={cn("card-apple p-5 space-y-3", className)}
        aria-labelledby="pending-ticks-heading"
      >
        <h2
          id="pending-ticks-heading"
          className="text-title-3 text-label-primary"
        >
          {t("groceries.tickSection")}
        </h2>
        <button
          className="btn-secondary min-h-11"
          onClick={() => setOpen(true)}
        >
          {t("groceries.reviewTicks")}
        </button>
        <RecoveredQueueChanges
          queue={namedQueue}
          open={open}
          onOpenChange={setOpen}
          showLauncher={false}
        />
      </section>
    );

  return (
    <section
      className={cn("card-apple p-5 space-y-3", className)}
      aria-labelledby="pending-ticks-heading"
    >
      <h2
        id="pending-ticks-heading"
        className="text-title-3 text-label-primary"
      >
        {t("groceries.tickSection")}
      </h2>
      <p className="text-[15px] text-label-secondary">
        {t("groceries.tickHint")}
      </p>
      <button
        type="button"
        className="btn-secondary min-h-11"
        onClick={() => {
          setConfirm(null);
          setBusy(false);
          setMessage(
            queueRef.current?.requiresCompatibleClient()
              ? "compatibleClient"
              : null,
          );
          setOpen(true);
        }}
      >
        {t("groceries.reviewTicks")}
      </button>
      <Dialog
        closeLabel={t("groceries.close")}
        open={open}
        onClose={
          busy
            ? undefined
            : () => {
                setConfirm(null);
                setOpen(false);
              }
        }
        title={t("groceries.tickTitle")}
        description={t("groceries.tickDescription")}
      >
        <QueueStorageRecovery queue={queueRef.current} />
        {!loaded ? (
          <p role="status">{t("groceries.ticksLoading")}</p>
        ) : storageBlocked ? null : ops.length === 0 ? (
          <p role="status">
            {t(
              message === "compatibleClient"
                ? "groceries.compatibleClient"
                : "groceries.ticksEmpty",
            )}
          </p>
        ) : (
          <ul className="space-y-4">
            {ops.map((op, index) => (
              <li
                key={op.id}
                className="rounded-lg bg-surface-grouped p-3 space-y-2"
                data-testid="pending-tick-recovery-row"
              >
                <p className="font-medium text-label-primary">
                  {t("groceries.tickChange", {
                    index: index + 1,
                    action: op.payload.checked
                      ? t("groceries.tick")
                      : t("groceries.untick"),
                  })}
                </p>
                <p className="text-sm text-label-secondary">
                  {t("groceries.tickQueued", {
                    date: new Date(op.createdAt).toLocaleString(locale),
                    state:
                      op.state === "syncing"
                        ? t("groceries.sending")
                        : op.state === "failed"
                          ? t("groceries.failed")
                          : op.state === "conflict"
                            ? t("groceries.needsReview")
                            : t("groceries.waitingSync"),
                  })}
                </p>
                {op.lastError === "QUEUE_REVIEW_REQUIRED" && (
                  <p>{t("groceries.tickReviewOnList")}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {(op.state === "failed" || op.state === "conflict") &&
                    op.lastError !== "QUEUE_REVIEW_REQUIRED" && (
                      <button
                        type="button"
                        className="btn-secondary min-h-11"
                        disabled={busy}
                        onClick={() => void run(op.id, false)}
                        aria-label={t("groceries.retryChange", {
                          index: index + 1,
                        })}
                      >
                        {t("groceries.retry")}
                      </button>
                    )}
                  <button
                    type="button"
                    className="btn-secondary min-h-11 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-[var(--accent-tint)] aria-disabled:active:transform-none"
                    aria-disabled={busy || op.state === "syncing"}
                    onClick={() => {
                      if (canOpenDiscard(op.id)) setConfirm(op.id);
                    }}
                    aria-label={t("groceries.discardChange", {
                      index: index + 1,
                    })}
                  >
                    {t("groceries.discard")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p role="status" className="text-sm text-label-secondary">
          {message && !(ops.length === 0 && message === "compatibleClient")
            ? t(`groceries.${message}`)
            : ""}
        </p>
        <Dialog
          closeLabel={t("groceries.close")}
          open={confirm !== null}
          onClose={busy ? undefined : () => setConfirm(null)}
          role="alertdialog"
          title={t("groceries.discardTitle")}
          description={t("groceries.discardDescription")}
        >
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary min-h-11"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              {t("groceries.keepTick")}
            </button>
            <button
              type="button"
              className="btn-primary min-h-11"
              disabled={busy}
              onClick={() => confirm && void run(confirm, true)}
            >
              {busy ? t("groceries.discarding") : t("groceries.discardTick")}
            </button>
          </div>
        </Dialog>
      </Dialog>
    </section>
  );
}
