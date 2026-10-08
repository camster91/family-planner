"use client";

import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import type { DeviceClient } from "@/lib/device-client";
import { getDeviceQueue } from "@/lib/offline-queue-browser";
import { QueueError, type AddGroceryOperation } from "@/lib/offline-queue";
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
  const [open, setOpen] = React.useState(false);
  const [listId, setListId] = React.useState("");
  const [content, setContent] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [ops, setOps] = React.useState<AddGroceryOperation[]>([]);
  const [durable, setDurable] = React.useState(true);
  const [online, setOnline] = React.useState(true);
  const input = React.useRef<HTMLInputElement>(null);
  const generation = React.useRef(0);
  const sending = React.useRef(false);
  const afterRef = React.useRef(afterChange);
  afterRef.current = afterChange;

  const close = React.useCallback(() => {
    generation.current++;
    setOpen(false);
    setContent("");
    setError(null);
  }, []);

  React.useEffect(() => {
    const queue = getDeviceQueue(client);
    let active = true;
    const refreshedMissingLists = new Set<string>();
    const update = () => {
      if (!active) return;
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
        setNotice("Item added to the grocery list.");
      }
      if (event.type === "auth-lost" && active) {
        close();
        setNotice(null);
      }
      if (event.type === "dropped" && active)
        setNotice(
          "Some older queued changes were removed. Check your grocery list before adding them again.",
        );
    });
    void queue.ready.then(update);
    return () => {
      active = false;
      unsubscribe();
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
      setError("Choose a grocery list and use 1 to 200 characters.");
      return;
    }
    if (!actorId) {
      setError(
        "Your name selection expired. Close this form and pick your name again.",
      );
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
        if (!op.durable)
          setNotice(
            "This add is only in memory. Keep this page open until it syncs.",
          );
        else if (queue.list().some((queued) => queued.id === op.id))
          setNotice("Add queued. Check its status below.");
      }
    } catch (failure) {
      if (generation.current !== current) return;
      setError(
        failure instanceof QueueError && failure.code === "QUEUE_FULL"
          ? "Too many changes are waiting for Wi-Fi. Your text is still here; try again after they sync."
          : "Could not queue this add. Your text is still here. Try again.",
      );
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
        setNotice(
          "Queued add removed. Check the list before adding it again; an earlier send may already have saved it.",
        );
      } else if (op.state === "pending") await queue.handleOnline();
      else await queue.retry(op.id);
    } catch {
      setNotice("Could not update the queued add. Try again.");
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={busy}
        className={neutralButtonClass}
        onClick={async () => {
          setNotice(null);
          setListId(lists.length === 1 ? lists[0].id : "");
          setContent("");
          setError(null);
          const current = generation.current;
          if (
            (!lists.length || (await prepare())) &&
            generation.current === current
          )
            setOpen(true);
        }}
      >
        Add grocery
      </button>
      {notice && <p role="status">{notice}</p>}
      {ops.length > 0 && (
        <section
          aria-label="Queued grocery adds"
          className="space-y-3 rounded-lg border border-[var(--surface-separator)] p-3"
        >
          <p>
            These items are not yet confirmed on the list. Retry here instead of
            adding the same item again.
          </p>
          {!durable && (
            <p role="alert">
              Changes are only in memory. Keep this page open until they sync.
            </p>
          )}
          {ops.map((op) => {
            const cannotRetry =
              op.lastError === "EXPIRED" ||
              op.lastError === "IDEMPOTENCY_KEY_REUSED";
            const state =
              op.state === "syncing"
                ? "Adding…"
                : op.state === "pending"
                  ? "Waiting to add when connected."
                  : op.state === "conflict"
                    ? "That list is no longer available or has changed."
                    : cannotRetry
                      ? "This add cannot safely be retried. Check the list, then remove this queued add."
                      : "Could not add this item.";
            return (
              <div
                key={op.id}
                data-testid="queued-grocery-add"
                className="space-y-2"
              >
                <p className="break-words font-medium">{op.payload.content}</p>
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
                        {op.state === "pending" ? "Try now" : "Retry add"}
                      </button>
                    )}
                    <button
                      type="button"
                      className={neutralButtonClass}
                      onClick={() => void recover(op, true)}
                    >
                      Remove queued add
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}
      <Dialog
        open={open}
        onClose={busy ? undefined : close}
        title="Add grocery"
        initialFocusRef={input}
        testId="device-grocery-add"
      >
        {!lists.length ? (
          <p>
            Create a grocery list on your personal device first. This tablet
            cannot create lists.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="device-grocery-list" className={labelClass}>
                Grocery list
              </label>
              <select
                id="device-grocery-list"
                value={listId}
                disabled={busy}
                className={inputClass}
                onChange={(e) => setListId(e.target.value)}
              >
                <option value="">Choose a list</option>
                {lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
            </div>
            {lists.length === 50 && (
              <p>
                Showing the first 50 lists. Use your personal device for other
                lists.
              </p>
            )}
            <div>
              <label htmlFor="device-grocery-content" className={labelClass}>
                Item
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
            </div>
            {!online && (
              <p role="status">
                This add will wait on this tablet and sync when connected.
              </p>
            )}
            {error && (
              <p role="alert" className={errorTextClass}>
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={busy}
                className={primaryButtonClass}
              >
                {busy ? "Queueing…" : "Add item"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={close}
                className={neutralButtonClass}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
