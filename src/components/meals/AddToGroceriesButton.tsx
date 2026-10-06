"use client";

import * as React from "react";
import { Loader2, ShoppingCart, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import {
  postAddFromRecipe,
  postUndoAdd,
  summarizeAdd,
  summarizeUndo,
  undoRemainingMs,
  type AddFromRecipeRequest,
  type AddFromRecipeResult,
} from "@/lib/add-to-groceries-client";

/** Matches the server's undo window (ADR-0007 O-5), so Undo is not offered after it closes. */
const UNDO_WINDOW_MS = 10 * 60 * 1000;

type Status =
  | { kind: "idle" }
  | { kind: "adding" }
  | { kind: "added"; result: AddFromRecipeResult; notice?: string }
  | { kind: "undoing"; result: AddFromRecipeResult }
  | { kind: "undone"; message: string }
  | { kind: "error"; message: string; retryable: boolean };

export interface AddToGroceriesButtonProps extends AddFromRecipeRequest {
  /** Visible button label. */
  label?: string;
  className?: string;
  /** Prevent a new add while the meal has unsaved servings. Undo stays available. */
  disabled?: boolean;
  /** Called after a successful add (or replay), e.g. to refresh a list. */
  onAdded?: (result: AddFromRecipeResult) => void;
  /** Called after a successful undo. */
  onUndone?: () => void;
}

/**
 * "Add ingredients to groceries" for a meal or a recipe (ADR-0007 child D,
 * #253). Self-contained: it calls `POST /api/lists/items/from-recipe` with an
 * `Idempotency-Key`, keeps that key across retries of the same tap (so a
 * network retry cannot add twice), and shows the result with Undo in a
 * polite live region. Mount it wherever a recipe is shown (meal modal today,
 * recipe detail later) with `recipeId` and, for a planned meal, `mealId`.
 */
export function AddToGroceriesButton({
  recipeId,
  mealId,
  listId,
  servings,
  ingredientIds,
  label = "Add ingredients to groceries",
  className,
  disabled = false,
  onAdded,
  onUndone,
}: AddToGroceriesButtonProps) {
  const [status, setStatus] = React.useState<Status>({ kind: "idle" });
  // One key per intent: kept until the add has a definite answer.
  const pendingKey = React.useRef<string | null>(null);
  // Undo is offered only while the server would still accept it.
  const [undoOpen, setUndoOpen] = React.useState(false);
  const undoTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );
  const busy = status.kind === "adding" || status.kind === "undoing";

  const add = async () => {
    if (busy || disabled) return;
    pendingKey.current ??= newIdempotencyKey();
    setStatus({ kind: "adding" });
    const outcome = await postAddFromRecipe(
      { recipeId, mealId, listId, servings, ingredientIds },
      pendingKey.current,
    );
    if (outcome.kind === "retry") {
      setStatus({ kind: "error", message: outcome.message, retryable: true });
      return;
    }
    pendingKey.current = null;
    if (outcome.kind === "error") {
      setStatus({ kind: "error", message: outcome.message, retryable: false });
      return;
    }
    setStatus({ kind: "added", result: outcome.result });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    // A replay can arrive minutes after the add: count down to the server's
    // expiry rather than restarting the full window.
    const remaining = undoRemainingMs(outcome.result, UNDO_WINDOW_MS);
    setUndoOpen(outcome.result.createdCount > 0 && remaining > 0);
    undoTimer.current = setTimeout(() => setUndoOpen(false), remaining);
    onAdded?.(outcome.result);
  };

  const undo = async () => {
    if (status.kind !== "added") return;
    const { result } = status;
    setStatus({ kind: "undoing", result });
    const outcome = await postUndoAdd(result.requestId);
    if (!outcome.ok) {
      if (outcome.retryable) {
        // Undo is safe to repeat and the first attempt may even have landed:
        // keep the result and the Undo control so it can be tried again.
        setStatus({ kind: "added", result, notice: outcome.message });
        return;
      }
      setUndoOpen(false);
      setStatus({ kind: "error", message: outcome.message, retryable: false });
      return;
    }
    setUndoOpen(false);
    setStatus({ kind: "undone", message: summarizeUndo(outcome.result) });
    onUndone?.();
  };

  const shown =
    status.kind === "added" || status.kind === "undoing" ? status : null;
  const summary = shown ? summarizeAdd(shown.result) : null;
  const canUndo = shown !== null && undoOpen;

  return (
    <div className={cn("space-y-2", className)}>
      <button
        type="button"
        onClick={add}
        disabled={busy || disabled}
        aria-busy={status.kind === "adding"}
        className="btn-tinted w-full min-h-[44px]"
      >
        {status.kind === "adding" ? (
          <Loader2
            className="w-4 h-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : (
          <ShoppingCart className="w-4 h-4" aria-hidden="true" />
        )}
        <span>
          {status.kind === "error" && status.retryable ? "Try again" : label}
        </span>
      </button>

      <div role="status" aria-live="polite" className="empty:hidden">
        {summary && (
          <div className="rounded-xl border border-[var(--surface-separator)] bg-[var(--surface-fill)] p-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-subhead font-semibold text-label-primary break-words">
                {summary.title}
              </p>
              {summary.details.map((d) => (
                <p
                  key={d}
                  className="text-footnote text-label-secondary mt-0.5 break-words"
                >
                  {d}
                </p>
              ))}
            </div>
            {canUndo && (
              <button
                type="button"
                onClick={undo}
                disabled={busy}
                className="min-h-[44px] min-w-[44px] px-3 inline-flex items-center gap-1 rounded-lg text-subhead font-semibold text-[var(--accent)] active:bg-[var(--surface-fill)]"
              >
                <Undo2 className="w-4 h-4" aria-hidden="true" />
                Undo
              </button>
            )}
          </div>
        )}
        {status.kind === "added" && status.notice && (
          <p className="text-subhead text-[var(--danger-text)]">
            {status.notice}
          </p>
        )}
        {status.kind === "undone" && (
          <p className="text-subhead text-label-secondary">{status.message}</p>
        )}
        {status.kind === "error" && (
          <p className="text-subhead text-[var(--danger-text)]">
            {status.message}
          </p>
        )}
      </div>
    </div>
  );
}

export default AddToGroceriesButton;
