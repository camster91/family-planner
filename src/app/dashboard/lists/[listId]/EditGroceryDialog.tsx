"use client";

import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { newIdempotencyKey } from "@/lib/idempotency-key";

export type EditableGrocery = {
  id: string;
  content: string;
  quantity: number;
  updated_at: string;
};
type Intent = {
  body: {
    itemId: string;
    content: string;
    quantity: number;
    expectedUpdatedAt: string;
  };
  key: string;
};

/** Online field edits stay in memory. An uncertain retry keeps the exact intent. */
export function EditGroceryDialog({
  initial,
  current,
  online,
  onClose,
  onRefresh,
}: {
  initial: EditableGrocery;
  current: EditableGrocery | null;
  online: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [content, setContent] = React.useState(initial.content);
  const [quantity, setQuantity] = React.useState(String(initial.quantity));
  const [version, setVersion] = React.useState(initial.updated_at);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const [denied, setDenied] = React.useState(false);
  const [uncertain, setUncertain] = React.useState(false);
  const intent = React.useRef<Intent | null>(null);
  const busy = React.useRef(false);
  const mounted = React.useRef(true);
  const fieldId = React.useId();
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const changed = Boolean(current && current.updated_at !== version);
  const missing = current === null;
  const blocked = denied || missing || ((conflict || changed) && !uncertain);

  const close = () => {
    if (busy.current) return;
    if (uncertain) onRefresh();
    onClose();
  };
  const useCurrent = () => {
    if (!current || busy.current || denied || !changed) return;
    setContent(current.content);
    setQuantity(String(current.quantity));
    setVersion(current.updated_at);
    setConflict(false);
    setUncertain(false);
    setError(null);
    intent.current = null;
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy.current || blocked) return;
    if (!online || navigator.onLine === false) {
      setError(
        "You’re offline. Connect before saving. Your draft stays here while this window is open.",
      );
      return;
    }
    if (!intent.current) {
      const count = Number(quantity);
      const text = content.trim();
      if (
        !text ||
        text.length > 500 ||
        !Number.isInteger(count) ||
        count < 1 ||
        count > 9999
      ) {
        setError(
          "Enter a name from 1 to 500 characters and a whole-number quantity from 1 to 9999.",
        );
        return;
      }
      try {
        intent.current = {
          key: newIdempotencyKey(),
          body: {
            itemId: initial.id,
            content: text,
            quantity: count,
            expectedUpdatedAt: version,
          },
        };
      } catch {
        setError(
          "Couldn’t prepare a safe save. Keep this draft and try again.",
        );
        return;
      }
    }
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/lists/items/edit", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": intent.current.key,
        },
        body: JSON.stringify(intent.current.body),
      });
      const body = await response.json().catch(() => null);
      if (!mounted.current) return;
      if (response.ok && body?.success === true) {
        // A replay can contain an older row. Always reload canonical props.
        onRefresh();
        onClose();
        return;
      }
      if (response.status === 401 || response.status === 403) {
        setDenied(true);
        setUncertain(false);
        setError(
          "You no longer have access to save this item. Close this window and sign in again.",
        );
      } else if (
        response.status === 409 ||
        response.status === 404 ||
        response.status === 422
      ) {
        setConflict(true);
        setUncertain(false);
        setError(
          response.status === 404
            ? "This item was removed. Refresh the list; this draft won’t add it back."
            : "This item changed. Refresh the list and review the current values before saving again.",
        );
        onRefresh();
      } else if (
        response.status >= 500 ||
        [408, 425, 429].includes(response.status) ||
        response.ok
      ) {
        setUncertain(true);
        setError(
          "We couldn’t confirm the save. Retry the same change, or close and check the list.",
        );
      } else {
        intent.current = null;
        setUncertain(false);
        setError(
          "Couldn’t save these values. Review the name and quantity, then try again.",
        );
      }
    } catch {
      if (mounted.current) {
        setUncertain(true);
        setError(
          "We couldn’t confirm the save. Retry the same change, or close and check the list.",
        );
      }
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  };
  const frozen = pending || uncertain || denied || missing;
  return (
    <Dialog
      open
      title="Edit grocery item"
      description="Change the name and quantity. Saving needs a connection."
      onClose={pending ? undefined : close}
    >
      <form onSubmit={(event) => void save(event)} className="space-y-4">
        <div>
          <label
            htmlFor={`${fieldId}-name`}
            className="block text-subhead font-semibold text-label-primary"
          >
            Item name
          </label>
          <input
            id={`${fieldId}-name`}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            disabled={frozen}
            maxLength={500}
            className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--separator)] bg-[var(--surface-fill)] px-3 text-label-primary"
          />
        </div>
        <div>
          <label
            htmlFor={`${fieldId}-quantity`}
            className="block text-subhead font-semibold text-label-primary"
          >
            Quantity
          </label>
          <input
            id={`${fieldId}-quantity`}
            type="number"
            min={1}
            max={9999}
            step={1}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            disabled={frozen}
            className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--separator)] bg-[var(--surface-fill)] px-3 text-label-primary"
          />
        </div>
        {!online && (
          <p role="status" className="text-subhead text-label-secondary">
            You’re offline. Connect before saving.
          </p>
        )}
        {missing ? (
          <p role="alert" className="text-subhead text-label-secondary">
            This item is no longer on the list. Close this window to continue.
          </p>
        ) : (
          (changed || conflict) &&
          !denied && (
            <div className="rounded-xl bg-[var(--surface-fill)] p-3 text-subhead text-label-secondary">
              <p>This item changed. Your draft is still above.</p>
              <p className="mt-2 break-words">
                Current list: {current.content} · quantity {current.quantity}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={pending}
                  className="btn-tinted min-h-[44px] px-3"
                >
                  Refresh list
                </button>
                <button
                  type="button"
                  onClick={useCurrent}
                  disabled={pending || !changed}
                  className="btn-tinted min-h-[44px] px-3"
                >
                  Use current values
                </button>
              </div>
            </div>
          )
        )}
        {error && (
          <p role="alert" className="text-subhead text-label-secondary">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={pending || blocked || !online}
            className="btn-tinted min-h-[44px] px-4"
          >
            {pending ? "Saving…" : uncertain ? "Retry save" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={close}
            disabled={pending}
            className="min-h-[44px] px-4 text-subhead text-label-secondary"
          >
            {uncertain ? "Close and check list" : "Cancel"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
