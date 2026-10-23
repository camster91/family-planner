"use client";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import { QueueError, type OfflineQueue } from "@/lib/offline-queue";
import type { LegacyQueuePreview } from "@/lib/legacy-queue-contract";
import { useLegacyQueueText } from "@/i18n/legacy-queue";
type Choice = "keep" | "discard" | "leave";
/** The old payload is never rendered until its canonical current target is validated. */
export function LegacyQueueRecovery({ queue }: { queue: OfflineQueue }) {
  const { text, locale } = useLegacyQueueText();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<LegacyQueuePreview | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<"failed" | "capacity" | null>(null);
  const [moved, setMoved] = useState(false);
  const [page, setPage] = useState(0);
  const action = useRef(false);
  const identity = useRef(queue);
  identity.current = queue;
  const generation = useRef(0);
  usePendingFormNavigationController(busy);
  useEffect(() => {
    generation.current++;
    action.current = false;
    setPreview(null);
    setChoices({});
    setFrozen(false);
    setOpen(false);
    setConfirm(false);
    setBusy(false);
    setLoading(false);
    setError(null);
    setMoved(false);
    setPage(0);
    return () => {
      generation.current++;
    };
  }, [queue]);
  async function load() {
    if (action.current) return;
    const current = ++generation.current;
    action.current = true;
    setOpen(true);
    setLoading(true);
    setError(null);
    setMoved(false);
    try {
      const result = await queue.previewLegacy();
      if (identity.current !== queue || generation.current !== current) return;
      setChoices((previous) =>
        preview?.token === result.token
          ? previous
          : Object.fromEntries(
              result.operations.map((op) => [
                op.id,
                result.targets[op.id] ? "keep" : "leave",
              ]),
            ),
      );
      setPreview(result);
      setPage(0);
    } catch {
      if (identity.current === queue && generation.current === current) {
        setError("failed");
        setPreview((previous) =>
          previous ? { ...previous, targets: {} } : null,
        );
      }
    } finally {
      if (identity.current === queue && generation.current === current) {
        action.current = false;
        setLoading(false);
      }
    }
  }
  const operations = preview?.operations ?? [];
  const keep = operations
    .filter((op) => choices[op.id] === "keep")
    .map((op) => op.id);
  const discard = operations
    .filter((op) => choices[op.id] === "discard")
    .map((op) => op.id);
  const left = operations.length - keep.length - discard.length;
  const ready = Boolean(
    preview &&
    operations.length &&
    !left &&
    (frozen || keep.every((id) => preview.targets[id])),
  );
  async function move() {
    if (!preview || !ready || action.current) return;
    const current = generation.current;
    action.current = true;
    setBusy(true);
    setError(null);
    try {
      await queue.migrateLegacy({ token: preview.token, keep, discard });
      if (identity.current === queue && generation.current === current) {
        setMoved(true);
        setPreview(null);
        setFrozen(false);
        setConfirm(false);
      }
    } catch (cause) {
      if (identity.current === queue && generation.current === current) {
        const full = cause instanceof QueueError && cause.code === "QUEUE_FULL";
        setFrozen(!full);
        setError(full ? "capacity" : "failed");
      }
    } finally {
      if (identity.current === queue && generation.current === current) {
        action.current = false;
        setBusy(false);
      }
    }
  }
  const pages = Math.max(1, Math.ceil(operations.length / 5));
  const counts = (
    <p>
      {text("kept")}: {keep.length.toLocaleString(locale)} · {text("discarded")}
      : {discard.length.toLocaleString(locale)} · {text("unresolved")}:{" "}
      {left.toLocaleString(locale)}
    </p>
  );
  return (
    <>
      <button
        className="btn-secondary min-h-[44px]"
        disabled={busy || loading}
        onClick={() => void load()}
      >
        {text("open")}
      </button>
      <Dialog
        open={open}
        title={text("title")}
        description={text("intro")}
        variant="form"
        closeLabel={text("close")}
        onClose={
          busy
            ? undefined
            : () => {
                setOpen(false);
                setConfirm(false);
              }
        }
        footer={
          <div className="space-y-3">
            {counts}
            <button
              className="btn-primary min-h-[44px] w-full"
              disabled={!ready || busy || loading || moved}
              onClick={() => setConfirm(true)}
            >
              {text(busy ? "busy" : "move")}
            </button>
          </div>
        }
      >
        <div className="space-y-4 min-w-0">
          {loading && <p role="status">{text("loading")}</p>}
          {error && <p role="alert">{text(error)}</p>}
          {moved && <p role="status">{text("moved")}</p>}
          {frozen && <p>{text("locked")}</p>}
          <button
            className="btn-secondary min-h-[44px]"
            disabled={busy || loading}
            onClick={() => void load()}
          >
            {text("refresh")}
          </button>
          {preview && !operations.length && <p>{text("empty")}</p>}
          <ol start={page * 5 + 1} className="space-y-3">
            {operations.slice(page * 5, page * 5 + 5).map((op) => {
              const target = !loading ? preview?.targets[op.id] : null;
              return (
                <li
                  key={op.id}
                  className="rounded-[var(--radius-lg)] border border-border p-3 space-y-2 break-words"
                >
                  {target ? (
                    <>
                      <p className="font-medium">
                        {"itemId" in op.payload
                          ? target.itemName
                          : op.payload.content}
                      </p>
                      <p>
                        {target.listName}
                        {target.actorName ? ` · ${target.actorName}` : ""}
                      </p>
                      <p>
                        {text(
                          "itemId" in op.payload
                            ? op.payload.checked
                              ? "tick"
                              : "untick"
                            : "add",
                        )}
                      </p>
                      {op.action === "device.list-item.add" && (
                        <p>{text("original")}</p>
                      )}
                    </>
                  ) : (
                    <p>{text(loading ? "loading" : "missing")}</p>
                  )}
                  <label className="block space-y-2">
                    <span>{text("choice")}</span>
                    <select
                      className="input-field w-full"
                      value={choices[op.id] ?? "leave"}
                      disabled={busy || loading || frozen}
                      onChange={(event) =>
                        setChoices((current) => ({
                          ...current,
                          [op.id]: event.target.value as Choice,
                        }))
                      }
                    >
                      <option value="leave">{text("leave")}</option>
                      <option value="keep" disabled={!target}>
                        {text("keep")}
                      </option>
                      <option value="discard">{text("discard")}</option>
                    </select>
                  </label>
                </li>
              );
            })}
          </ol>
          {operations.length > 5 && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="btn-secondary min-h-[44px]"
                disabled={page === 0 || busy}
                onClick={() => setPage((value) => value - 1)}
              >
                {text("previous")}
              </button>
              <span>
                {text("page")} {(page + 1).toLocaleString(locale)} {text("of")}{" "}
                {pages.toLocaleString(locale)}
              </span>
              <button
                className="btn-secondary min-h-[44px]"
                disabled={page + 1 >= pages || busy}
                onClick={() => setPage((value) => value + 1)}
              >
                {text("next")}
              </button>
            </div>
          )}
        </div>
      </Dialog>
      <Dialog
        open={confirm}
        title={text("confirm")}
        description={text("confirmHelp")}
        variant="form"
        closeLabel={text("close")}
        onClose={busy ? undefined : () => setConfirm(false)}
        footer={
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary min-h-[44px]"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              {text("cancel")}
            </button>
            <button
              className="btn-primary min-h-[44px]"
              disabled={busy || !ready}
              onClick={() => void move()}
            >
              {text(busy ? "busy" : "move")}
            </button>
          </div>
        }
      >
        {counts}
        {error && <p role="alert">{text(error)}</p>}
        {frozen && <p>{text("locked")}</p>}
      </Dialog>
    </>
  );
}
