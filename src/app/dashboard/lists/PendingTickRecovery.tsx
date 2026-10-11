"use client";

import * as React from "react";
import { useTranslation } from "@/i18n";
import type { GroceryMessage } from "@/i18n/grocery-controls";
import { Dialog } from "@/components/ui/dialog";
import { getPersonQueue } from "@/lib/offline-queue-browser";
import {
  isCheckedOperation,
  type CheckedQueuedOperation,
  type OfflineQueue,
} from "@/lib/offline-queue";

/** Deliberate recovery independent of canonical list/item existence. No item content is stored here. */
export default function PendingTickRecovery({ userId }: { userId: string }) {
  const { t, locale } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [ops, setOps] = React.useState<CheckedQueuedOperation[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [confirm, setConfirm] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<GroceryMessage | null>(null);
  const queueRef = React.useRef<OfflineQueue | null>(null);
  const generation = React.useRef(0);

  React.useEffect(() => {
    if (!open) return;
    setOps([]);
    setLoaded(false);
    setConfirm(null);
    setMessage(null);
    const queue = getPersonQueue(userId);
    queueRef.current = queue;
    let active = true;
    const current = ++generation.current;
    const update = () => {
      if (!active) return;
      if (queue.requiresCompatibleClient()) setMessage("compatibleClient");
      setOps(
        queue
          .list()
          .filter(
            (op) =>
              op.action === "list-item.set-checked" && isCheckedOperation(op),
          ),
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
  }, [open, userId]);

  const run = async (id: string, discard: boolean) => {
    const queue = queueRef.current;
    if (!queue || busy) return;
    const current = generation.current;
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
      if (generation.current === current) setBusy(false);
    }
  };

  return (
    <section
      className="card-apple p-5 space-y-3"
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
          setLoaded(false);
          setOps([]);
          setConfirm(null);
          setBusy(false);
          setMessage(null);
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
        {!loaded ? (
          <p role="status">{t("groceries.ticksLoading")}</p>
        ) : ops.length === 0 ? (
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
                <div className="flex flex-wrap gap-2">
                  {(op.state === "failed" || op.state === "conflict") && (
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
                    className="btn-secondary min-h-11"
                    disabled={busy || op.state === "syncing"}
                    onClick={() => setConfirm(op.id)}
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
