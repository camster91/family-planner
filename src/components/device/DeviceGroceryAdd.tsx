"use client";

import * as React from "react";
import { useTranslation } from "@/i18n";
import type { GroceryMessage } from "@/i18n/grocery-controls";
import { Dialog } from "@/components/ui/dialog";
import { QueueStorageRecovery } from "@/components/ui/queue-storage-recovery";
import { RecoveredQueueChanges } from "@/components/ui/recovered-queue-changes";
import { LocalVoiceDraft } from "@/components/assistant/LocalVoiceDraft";
import type { DeviceClient } from "@/lib/device-client";
import { getDeviceQueue } from "@/lib/offline-queue-browser";
import {
  QueueError,
  type AddGroceryOperation,
  type OfflineQueue,
} from "@/lib/offline-queue";
import {
  errorTextClass,
  inputClass,
  labelClass,
  neutralButtonClass,
  primaryButtonClass,
} from "./styles";

/** Bounded, attributed grocery capture; only canonical server confirmation means saved. */
export function DeviceGroceryAdd({
  client,
  lists,
  actorId,
  prepare,
  afterChange,
}: {
  client: DeviceClient;
  lists: Array<{ id: string; name: string }>;
  actorId: string | null;
  prepare: () => Promise<boolean>;
  afterChange: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [listId, setListId] = React.useState("");
  const [content, setContent] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<GroceryMessage | null>(null);
  const [notice, setNotice] = React.useState<GroceryMessage | null>(null);
  const [ops, setOps] = React.useState<AddGroceryOperation[]>([]);
  const [queue, setQueue] = React.useState<OfflineQueue | null>(null);
  const [durable, setDurable] = React.useState(true);
  const [online, setOnline] = React.useState(true);
  const input = React.useRef<HTMLInputElement>(null);
  const generation = React.useRef(0);
  const sending = React.useRef(false);
  const preserveDraftOnClose = React.useRef(false);
  const afterRef = React.useRef(afterChange);
  afterRef.current = afterChange;

  const close = React.useCallback(() => {
    generation.current++;
    setOpen(false);
    if (!preserveDraftOnClose.current) setContent("");
    setError(null);
  }, []);

  React.useEffect(() => {
    const queue = getDeviceQueue(client);
    setQueue(queue);
    let active = true;
    const refreshedMissingLists = new Set<string>();
    const update = () => {
      if (!active) return;
      if (!queue.hasStorageReadError()) preserveDraftOnClose.current = false;
      if (queue.requiresCompatibleClient()) setNotice("compatibleClient");
      setOps(
        queue
          .list()
          .filter(
            (op): op is AddGroceryOperation =>
              op.action === "device.list-item.add",
          ),
      );
      setDurable(queue.isDurable());
      for (const op of queue.list()) {
        if (
          op.action === "device.list-item.add" &&
          op.state === "conflict" &&
          op.lastError === "NOT_FOUND" &&
          !refreshedMissingLists.has(op.id)
        ) {
          refreshedMissingLists.add(op.id);
          afterRef.current();
        }
      }
    };
    const unsubscribe = queue.subscribe((event) => {
      update();
      if (
        event.type === "synced" &&
        event.op.action === "device.list-item.add" &&
        active
      ) {
        afterRef.current();
        setNotice("deviceConfirmed");
      }
      if (event.type === "auth-lost" && active) {
        preserveDraftOnClose.current = false;
        close();
        setNotice(null);
      }
      if (event.type === "dropped" && active) setNotice("deviceDropped");
    });
    void queue.ready.then(update);
    return () => {
      active = false;
      unsubscribe();
      setQueue(null);
    };
  }, [client, close]);

  React.useEffect(() => {
    const requestGeneration = generation;
    const connection = () => setOnline(navigator.onLine !== false);
    const visibility = () => {
      if (document.hidden) {
        close();
        setNotice(null);
      }
    };
    connection();
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", close);
    return () => {
      requestGeneration.current++;
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", close);
    };
  }, [close]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending.current) return;
    const text = content.trim();
    if (
      !text ||
      text.length > 200 ||
      !lists.some((list) => list.id === listId)
    ) {
      setError("deviceValidation");
      return;
    }
    if (!actorId) {
      setError("actorExpired");
      return;
    }
    const current = generation.current;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const queue = getDeviceQueue(client);
      const op = await queue.enqueue("device.list-item.add", {
        listId,
        content: text,
        actingMemberId: actorId,
      });
      if (generation.current === current) {
        close();
        // A confirmation event may already have arrived. The queued rows below
        // represent current state, never claim a local enqueue was saved remotely.
        if (!op.durable) setNotice("devicePageOnly");
        else if (queue.list().some((queued) => queued.id === op.id))
          setNotice("deviceQueued");
      }
    } catch (failure) {
      if (generation.current !== current) return;
      if (
        failure instanceof QueueError &&
        failure.code === "STORAGE_UNAVAILABLE"
      ) {
        // Keep recovery available inside the modal and retain the draft if the
        // user closes it before the deliberate storage retry succeeds.
        preserveDraftOnClose.current = true;
        setError(null);
      } else {
        setError(
          failure instanceof QueueError && failure.code === "QUEUE_FULL"
            ? "deviceFull"
            : failure instanceof QueueError &&
                failure.code === "COMPATIBLE_CLIENT_REQUIRED"
              ? "compatibleClient"
              : "deviceQueueFailed",
        );
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const recover = async (op: AddGroceryOperation, discard: boolean) => {
    try {
      const queue = getDeviceQueue(client);
      if (discard) {
        await queue.discard(op.id);
        setNotice("deviceRemoved");
      } else if (op.state === "pending") await queue.handleOnline();
      else await queue.retry(op.id);
    } catch {
      setNotice("deviceRecoverFailed");
    }
  };

  const storageRecovery = <QueueStorageRecovery queue={queue} />;

  return (
    <>
      {!open && storageRecovery}
      <RecoveredQueueChanges queue={queue} deviceClient={client} />
      <button
        type="button"
        disabled={busy}
        className={neutralButtonClass}
        onClick={async () => {
          setNotice(null);
          setListId(lists.length === 1 ? lists[0].id : "");
          if (!preserveDraftOnClose.current) setContent("");
          setError(null);
          const current = generation.current;
          if (
            (!lists.length || (await prepare())) &&
            generation.current === current
          )
            setOpen(true);
        }}
      >
        {t("groceries.deviceTitle")}
      </button>
      {notice && <p role="status">{t(`groceries.${notice}`)}</p>}
      {ops.length > 0 && (
        <section
          aria-label={t("groceries.deviceQueuedSection")}
          className="space-y-3 rounded-lg border border-[var(--surface-separator)] p-3"
        >
          <p>{t("groceries.deviceUnconfirmedHint")}</p>
          {!durable && <p role="alert">{t("groceries.deviceMemoryHint")}</p>}
          {ops.map((op) => {
            const targetKnown = lists.some(
              (list) => list.id === op.payload.listId,
            );
            const cannotRetry =
              !targetKnown ||
              op.lastError === "EXPIRED" ||
              op.lastError === "IDEMPOTENCY_KEY_REUSED" ||
              op.lastError === "ORIGINAL_DEVICE_REQUIRED";
            const state = !targetKnown
              ? t("groceries.deviceTargetUnverified")
              : op.state === "syncing"
                ? t("groceries.adding")
                : op.state === "pending"
                  ? t("groceries.deviceWaiting")
                  : op.lastError === "ORIGINAL_DEVICE_REQUIRED"
                    ? t("groceries.originalDeviceRequired")
                    : op.lastError === "QUEUE_REVIEW_REQUIRED"
                      ? t("groceries.recoveredReview")
                      : op.lastError === "QUEUE_OWNER_CHANGED"
                        ? t("groceries.storageOwnerChanged")
                        : op.lastError === "QUEUE_STORAGE_UNCERTAIN"
                          ? t("groceries.storageUnavailable")
                          : op.state === "conflict"
                            ? t("groceries.deviceConflict")
                            : cannotRetry
                              ? t("groceries.deviceUnsafe")
                              : t("groceries.deviceFailed");
            return (
              <div
                key={op.id}
                data-testid="queued-grocery-add"
                className="space-y-2"
              >
                <p className="break-words font-medium">
                  {targetKnown
                    ? op.payload.content
                    : t("groceries.deviceUnverifiedTitle")}
                </p>
                <p>{state}</p>
                {op.state !== "syncing" && (
                  <div className="flex flex-wrap gap-3">
                    {!cannotRetry && (
                      <button
                        type="button"
                        className={neutralButtonClass}
                        disabled={!online}
                        onClick={() => void recover(op, false)}
                      >
                        {op.state === "pending"
                          ? t("groceries.tryNow")
                          : t("groceries.retryAdd")}
                      </button>
                    )}
                    <button
                      type="button"
                      className={neutralButtonClass}
                      onClick={() => void recover(op, true)}
                    >
                      {t("groceries.removeAdd")}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}
      <Dialog
        closeLabel={t("groceries.close")}
        open={open}
        onClose={busy ? undefined : close}
        title={t("groceries.deviceTitle")}
        initialFocusRef={input}
        testId="device-grocery-add"
      >
        {open && storageRecovery}
        {!lists.length ? (
          <p>{t("groceries.deviceNoLists")}</p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="device-grocery-list" className={labelClass}>
                {t("groceries.groceryList")}
              </label>
              <select
                id="device-grocery-list"
                value={listId}
                disabled={busy}
                className={inputClass}
                onChange={(e) => setListId(e.target.value)}
              >
                <option value="">{t("groceries.chooseList")}</option>
                {lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
            </div>
            {lists.length === 50 && <p>{t("groceries.firstFifty")}</p>}
            <div>
              <label htmlFor="device-grocery-content" className={labelClass}>
                {t("groceries.item")}
              </label>
              <input
                id="device-grocery-content"
                ref={input}
                value={content}
                disabled={busy}
                maxLength={200}
                autoComplete="off"
                className={inputClass}
                onChange={(e) => setContent(e.target.value)}
              />
              <LocalVoiceDraft
                enabled={open && !busy && Boolean(actorId)}
                contextKey={`${actorId}:${listId}`}
                value={content}
                maxLength={200}
                onDraft={setContent}
              />
            </div>
            {!online && <p role="status">{t("groceries.deviceOfflineHint")}</p>}
            {error && (
              <p role="alert" className={errorTextClass}>
                {t(`groceries.${error}`)}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={busy}
                className={primaryButtonClass}
              >
                {busy ? t("groceries.queueing") : t("groceries.addItem")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={close}
                className={neutralButtonClass}
              >
                {t("groceries.cancel")}
              </button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
