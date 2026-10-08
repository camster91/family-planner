"use client";

import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { DeviceApiError, type DeviceClient } from "@/lib/device-client";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import {
  errorTextClass,
  inputClass,
  labelClass,
  neutralButtonClass,
  primaryButtonClass,
} from "./styles";

type AddOperation = {
  key: string;
  listId: string;
  content: string;
  actingMemberId: string;
};

/** Online-only capture using the existing, attribution-only device write route. */
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
  const [operation, setOperation] = React.useState<AddOperation | null>(null);
  const [online, setOnline] = React.useState(true);
  const input = React.useRef<HTMLInputElement>(null);
  const generation = React.useRef(0);
  const sending = React.useRef(false);

  const close = React.useCallback(() => {
    generation.current++;
    setOpen(false);
    setContent("");
    setOperation(null);
    setError(null);
  }, []);

  React.useEffect(() => {
    const requestGeneration = generation;
    const connection = () => setOnline(navigator.onLine);
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
    if (!navigator.onLine) {
      setError("Connect to Wi-Fi to add this item. Nothing is queued.");
      return;
    }
    const text = content.trim();
    if (
      !operation &&
      (!text || text.length > 200 || !lists.some((list) => list.id === listId))
    ) {
      setError("Choose a grocery list and use 1 to 200 characters.");
      return;
    }
    if (!operation && !actorId) {
      setError(
        "Your name selection expired. Close this form and pick your name again.",
      );
      return;
    }
    const request = operation ?? {
      key: newIdempotencyKey(),
      listId,
      content: text,
      actingMemberId: actorId!,
    };
    const current = generation.current;
    setOperation(request);
    setError(null);
    sending.current = true;
    setBusy(true);
    try {
      await client.request(
        `/api/device/lists/${encodeURIComponent(request.listId)}/items`,
        {
          method: "POST",
          headers: { "Idempotency-Key": request.key },
          body: {
            content: request.content,
            actingMemberId: request.actingMemberId,
          },
        },
      );
      afterChange();
      if (generation.current === current) {
        close();
        setNotice("Item added to the grocery list.");
      }
    } catch (failure) {
      if (generation.current !== current) return;
      if (failure instanceof DeviceApiError && failure.terminal) {
        close();
        return;
      }
      // An uncertain response may follow a committed write. Keep the exact
      // body, actor and key for Retry; never silently make a second operation.
      const definitive =
        failure instanceof DeviceApiError &&
        failure.status >= 400 &&
        failure.status < 500 &&
        failure.status !== 409;
      if (definitive) setOperation(null);
      setError(
        definitive
          ? failure.message || "Could not add this item."
          : "Could not confirm the add. Retry checks the same request. Closing discards this draft; check the list before adding it again.",
      );
    } finally {
      sending.current = false;
      setBusy(false);
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
          setOperation(null);
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
      <Dialog
        open={open}
        onClose={close}
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
                disabled={busy || Boolean(operation)}
                className={inputClass}
                onChange={(event) => setListId(event.target.value)}
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
                disabled={busy || Boolean(operation)}
                maxLength={200}
                autoComplete="off"
                className={inputClass}
                onChange={(event) => setContent(event.target.value)}
              />
            </div>
            {!online && (
              <p role="status">
                Connect to Wi-Fi to add this item. Nothing is queued.
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
                disabled={busy || !online}
                className={primaryButtonClass}
              >
                {busy ? "Adding…" : operation ? "Retry add" : "Add item"}
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
