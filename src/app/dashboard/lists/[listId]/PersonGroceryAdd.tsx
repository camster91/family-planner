"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { getPersonQueue } from "@/lib/offline-queue-browser";
import {
  QueueError,
  type OfflineQueue,
  type PersonGroceryAddOperation,
} from "@/lib/offline-queue";

/** Only submitted grocery text is persisted, never an unsent draft or arbitrary list fields. */
export function PersonGroceryAdd({
  userId,
  listId,
  allowNew = true,
}: {
  userId: string;
  listId: string;
  allowNew?: boolean;
}) {
  const router = useRouter();
  const refresh = React.useRef(router.refresh);
  refresh.current = router.refresh;
  const queueRef = React.useRef<OfflineQueue | null>(null);
  const submitting = React.useRef(false);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [ops, setOps] = React.useState<PersonGroceryAddOperation[]>([]);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [online, setOnline] = React.useState(true);
  const [signedOut, setSignedOut] = React.useState(false);
  const mounted = React.useRef(false);
  const generation = React.useRef(0);

  React.useEffect(() => {
    const effectGeneration = generation;
    mounted.current = true;
    generation.current++;
    submitting.current = false;
    setBusy(false);
    setText("");
    setError(null);
    setNotice(null);
    setSignedOut(false);
    const queue = getPersonQueue(userId);
    queueRef.current = queue;
    let active = true;
    const update = () => {
      if (active)
        setOps(
          queue
            .list()
            .filter(
              (o): o is PersonGroceryAddOperation =>
                o.action === "list-item.grocery-add" &&
                o.payload.listId === listId,
            ),
        );
    };
    const unsubscribe = queue.subscribe((event) => {
      if (!active) return;
      update();
      if (
        event.type === "synced" &&
        event.op.action === "list-item.grocery-add" &&
        event.op.payload.listId === listId
      ) {
        // A replay may refer to an item deleted since the original add. Do not
        // insert the old response as a new row: refresh canonical server props.
        refresh.current();
        setNotice("Grocery add confirmed. Refreshing the list.");
      }
      if (event.type === "auth-lost") {
        generation.current++;
        submitting.current = false;
        setBusy(false);
        setText("");
        setSignedOut(true);
        setNotice(null);
        setError(null);
      }
      if (event.type === "dropped")
        setNotice(
          "Some older queued changes were removed. Check your list before adding them again.",
        );
    });
    void queue.ready.then(update);
    const connection = () => setOnline(navigator.onLine !== false);
    connection();
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    return () => {
      active = false;
      mounted.current = false;
      effectGeneration.current++;
      unsubscribe();
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
    };
  }, [userId, listId]);

  const submit = async () => {
    const content = text.trim();
    if (!allowNew || signedOut || !content || submitting.current) return;
    if (content.length > 500) {
      setError("Use 1 to 500 characters.");
      return;
    }
    const queue = queueRef.current;
    if (!queue) {
      setError("The grocery queue is loading. Please try again.");
      return;
    }
    submitting.current = true;
    const submittingGeneration = generation.current;
    setBusy(true);
    setError(null);
    try {
      const op = await queue.enqueue("list-item.grocery-add", {
        listId,
        content,
      });
      if (!mounted.current || generation.current !== submittingGeneration)
        return;
      setText("");
      // An immediate send may finish before enqueue returns. Keep its confirmed
      // notice rather than replace it with a premature queued/saved claim.
      if (queue.list().some((o) => o.id === op.id))
        setNotice(
          op.durable
            ? "Grocery add queued. Check its status below."
            : "Grocery add queued in this page. Keep it open until the add is confirmed.",
        );
    } catch (caught) {
      if (mounted.current && generation.current === submittingGeneration)
        setError(
          caught instanceof QueueError && caught.code === "QUEUE_FULL"
            ? "Too many changes are waiting. Reconnect or resolve queued changes, then try again."
            : "Could not queue this add. Keep the text and try again.",
        );
    } finally {
      if (generation.current === submittingGeneration) {
        submitting.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  };

  const remove = async (id: string) => {
    const removingGeneration = generation.current;
    await queueRef.current?.discard(id);
    if (mounted.current && generation.current === removingGeneration)
      setNotice(
        "Queued add removed from this device. A previous send may have added it; check the list before adding it again.",
      );
  };

  if (!allowNew && ops.length === 0 && !notice && !signedOut) return null;
  return (
    <section aria-label="Grocery adds" className="space-y-3">
      {allowNew && !signedOut && (
        <div className="card-apple px-4 py-3">
          <div className="flex items-center gap-3">
            <Plus
              className="w-5 h-5 text-label-tertiary shrink-0"
              aria-hidden="true"
            />
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="Add an item…"
              aria-label="Add an item"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "grocery-add-error" : undefined}
              disabled={busy}
              className="min-w-0 flex-1 bg-transparent text-body text-label-primary placeholder:text-label-tertiary outline-none"
            />
            {text.trim() && (
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy}
                className="min-h-[44px] min-w-[44px] px-2 -mr-2 text-[var(--accent)] text-subhead font-medium disabled:opacity-50"
              >
                Add
              </button>
            )}
          </div>
          {error && (
            <p
              id="grocery-add-error"
              role="alert"
              className="pt-2 text-footnote text-[var(--danger-text)]"
            >
              {error}
            </p>
          )}
        </div>
      )}
      {signedOut && (
        <p className="text-subhead text-label-primary">
          Sign in again before adding groceries.{" "}
          <a
            href="/login"
            className="inline-flex min-h-[44px] items-center text-[var(--accent)] underline"
          >
            Sign in
          </a>
        </p>
      )}
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="text-footnote text-label-secondary"
        >
          <p>{notice}</p>
          {notice.startsWith("Grocery add confirmed") && (
            <button
              type="button"
              onClick={() => refresh.current()}
              className="min-h-[44px] text-[var(--accent)] underline"
            >
              Refresh list
            </button>
          )}
        </div>
      )}
      {ops.map((op) => {
        const unsafeRetry =
          op.lastError === "EXPIRED" ||
          op.lastError === "IDEMPOTENCY_KEY_REUSED";
        const failed = op.state === "failed" || op.state === "conflict";
        const status =
          op.state === "syncing"
            ? "Adding…"
            : failed
              ? unsafeRetry
                ? "Check the list before adding again; remove this queued add."
                : op.lastError === "NOT_FOUND"
                  ? "This grocery list is no longer available. Remove this queued add or retry after checking the list."
                  : "Could not confirm this add. Retry or remove it."
              : "Waiting to add";
        return (
          <div
            key={op.id}
            className="card-apple p-4"
            data-testid="queued-grocery-add"
            data-sync-state={op.state}
          >
            <p className="text-body text-label-primary break-words">
              {op.payload.content}
            </p>
            <p className="text-footnote text-label-secondary mt-1">{status}</p>
            {op.state !== "syncing" && (
              <div
                className="flex flex-wrap gap-2 mt-2"
                role="group"
                aria-label={`Sync options for queued add ${op.payload.content}`}
              >
                {!unsafeRetry && (
                  <button
                    type="button"
                    disabled={!online}
                    onClick={() => {
                      if (failed) void queueRef.current?.retry(op.id);
                      else void queueRef.current?.handleOnline();
                    }}
                    className="btn-tinted min-h-[44px] px-4 disabled:opacity-50"
                  >
                    {failed ? "Retry add" : "Try now"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void remove(op.id)}
                  className="min-h-[44px] px-4 text-label-secondary underline"
                >
                  Remove queued add
                </button>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
