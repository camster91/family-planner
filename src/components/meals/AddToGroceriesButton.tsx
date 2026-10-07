"use client";

import * as React from "react";
import { z } from "zod";
import { Loader2, ShoppingCart, Undo2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
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

const reviewId = z.string().min(1).max(128);
const savedServings = z.number().int().min(1).max(100);
// Treat HTTP JSON as untrusted, including nested objects rendered by React.
const groceryReviewSchema = z
  .object({
    recipeId: reviewId,
    title: z.string().min(1).max(200),
    baseServings: savedServings,
    targetServings: savedServings,
    ingredients: z
      .array(
        z.object({
          ingredientId: reviewId,
          name: z.string().min(1).max(200),
          amount: z.number().finite().min(0).max(100000),
          unit: z.string().max(40).nullable(),
        }),
      )
      .max(100),
    lists: z
      .array(
        z.object({
          id: reviewId,
          name: z.string().min(1).max(200),
          type: z.enum(["grocery", "shopping"]),
        }),
      )
      .max(100),
    listsTruncated: z.boolean().optional(),
    defaultListId: reviewId.nullable(),
    inventory: z.discriminatedUnion("state", [
      z.object({ state: z.literal("unavailable") }),
      z.object({
        state: z.literal("available"),
        haveIngredientIds: z.array(reviewId).max(100),
        truncated: z.boolean(),
      }),
    ]),
  })
  .refine(
    (data) =>
      (data.defaultListId === null ||
        data.lists.some((list) => list.id === data.defaultListId)) &&
      new Set(data.ingredients.map((i) => i.ingredientId)).size ===
        data.ingredients.length &&
      new Set(data.lists.map((list) => list.id)).size === data.lists.length &&
      (data.inventory.state === "unavailable" ||
        data.inventory.haveIngredientIds.every((id) =>
          data.ingredients.some((i) => i.ingredientId === id),
        )),
  );
type GroceryReview = z.infer<typeof groceryReviewSchema>;

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
 * #253). Opens a read-only canonical ingredient/destination review before
 * calling `POST /api/lists/items/from-recipe`. Keeps the reviewed payload AND
 * `Idempotency-Key` across ambiguous retries, and reports the result with Undo
 * in a polite live region. Mounted by meal, recipe and inventory surfaces.
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
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [review, setReview] = React.useState<GroceryReview | null>(null);
  const [reviewError, setReviewError] = React.useState<string | null>(null);
  const [destination, setDestination] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>([]);
  const reviewSequence = React.useRef(0);
  const reviewedRequest = React.useRef<AddFromRecipeRequest | null>(null);
  const [status, setStatus] = React.useState<Status>({ kind: "idle" });
  // The payload and key are inseparable until a definite answer.
  const pending = React.useRef<{
    key: string;
    request: AddFromRecipeRequest;
  } | null>(null);
  const mutationInFlight = React.useRef(false);
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

  const closeReview = () => {
    reviewSequence.current++;
    setReviewOpen(false);
  };
  const openReview = async () => {
    if (busy || disabled) return;
    const sequence = ++reviewSequence.current;
    const intent = {
      recipeId,
      mealId,
      servings,
      listId,
      ingredientIds: ingredientIds ? [...ingredientIds] : undefined,
    };
    setReview(null);
    setReviewError(null);
    setReviewOpen(true);
    if (
      intent.servings !== undefined &&
      (!Number.isInteger(intent.servings) ||
        intent.servings < 1 ||
        intent.servings > 50)
    ) {
      setReviewError("Servings must be a whole number from 1 to 50.");
      return;
    }
    try {
      const params = new URLSearchParams({ recipeId });
      if (mealId) params.set("mealId", mealId);
      const response = await fetch(
        `/api/lists/items/from-recipe/review?${params}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Review unavailable");
      const data = groceryReviewSchema.parse(await response.json());
      if (data.recipeId !== intent.recipeId)
        throw new Error("Mismatched recipe");
      if (sequence !== reviewSequence.current) return;
      if (intent.listId && !data.lists.some((l) => l.id === intent.listId)) {
        setReviewError(
          "The chosen grocery list is unavailable. Close and choose another list.",
        );
        return;
      }
      reviewedRequest.current = intent;
      setReview({
        ...data,
        targetServings: intent.servings ?? data.targetServings,
      });
      setDestination(listId ?? data.defaultListId ?? "");
      setSelected(
        data.ingredients
          .map((i) => i.ingredientId)
          .filter((id) => !ingredientIds || ingredientIds.includes(id)),
      );
    } catch {
      if (sequence === reviewSequence.current)
        setReviewError("Could not load ingredients. Close and try again.");
    }
  };

  const add = async () => {
    if (
      mutationInFlight.current ||
      busy ||
      disabled ||
      (!pending.current && (!review || selected.length === 0))
    )
      return;
    closeReview();
    pending.current ??= {
      key: newIdempotencyKey(),
      request: {
        recipeId: reviewedRequest.current!.recipeId,
        mealId: reviewedRequest.current!.mealId,
        listId: destination || undefined,
        servings: reviewedRequest.current!.servings,
        ingredientIds: [...selected],
      },
    };
    mutationInFlight.current = true;
    setStatus({ kind: "adding" });
    const outcome = await postAddFromRecipe(
      pending.current.request,
      pending.current.key,
    );
    mutationInFlight.current = false;
    if (outcome.kind === "retry") {
      setStatus({ kind: "error", message: outcome.message, retryable: true });
      return;
    }
    pending.current = null;
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
        onClick={status.kind === "error" && status.retryable ? add : openReview}
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

      <Dialog
        open={reviewOpen}
        onClose={closeReview}
        title="Review grocery ingredients"
      >
        {!review && !reviewError && <p role="status">Loading ingredients…</p>}
        {reviewError && <p role="alert">{reviewError}</p>}
        {review && (
          <div className="space-y-4">
            <p className="font-semibold break-words">{review.title}</p>
            <p>For {review.targetServings} servings</p>
            {review.inventory.state === "unavailable" ? (
              <p>Inventory comparison unavailable. Choose what you need.</p>
            ) : (
              <p>
                Presence only, not enough-for-recipe amounts.
                {review.inventory.truncated
                  ? " Inventory scan is incomplete."
                  : ""}
              </p>
            )}
            <label className="block">
              Destination list
              <select
                aria-label="Destination list"
                className="input-apple min-h-[44px] w-full"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              >
                {review.lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
                {review.lists.length === 0 && (
                  <option value="">Create Groceries when added</option>
                )}
              </select>
            </label>
            {review.listsTruncated && (
              <p>Showing the first 100 grocery lists.</p>
            )}
            {review.ingredients.length === 0 && (
              <p>This recipe has no ingredients to add.</p>
            )}
            <div className="space-y-2">
              {review.ingredients.map((i) => (
                <label
                  key={i.ingredientId}
                  className="flex min-h-[44px] items-center gap-3 break-words"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(i.ingredientId)}
                    onChange={(e) =>
                      setSelected((ids) =>
                        e.target.checked
                          ? [...ids, i.ingredientId]
                          : ids.filter((id) => id !== i.ingredientId),
                      )
                    }
                  />
                  <span>
                    {i.name}{" "}
                    <span className="text-label-secondary">
                      {Math.round(
                        ((i.amount * review.targetServings) /
                          review.baseServings) *
                          100,
                      ) / 100}
                      {i.unit ? ` ${i.unit}` : ""}
                    </span>
                    {review.inventory.state === "available" && (
                      <span className="block text-footnote text-label-secondary">
                        {review.inventory.haveIngredientIds.includes(
                          i.ingredientId,
                        )
                          ? "Present in inventory"
                          : review.inventory.truncated
                            ? "No match in scanned inventory"
                            : "No inventory match"}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
            <button
              type="button"
              className="btn-primary min-h-[44px]"
              disabled={busy || disabled || selected.length === 0}
              onClick={add}
            >
              Add selected ingredients
            </button>
          </div>
        )}
        <button
          type="button"
          className="btn-tinted min-h-[44px] mt-3"
          onClick={closeReview}
        >
          Cancel
        </button>
      </Dialog>

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
        {status.kind === "error" && status.retryable && (
          <p className="text-subhead text-label-secondary">
            This request may already be saved. Try again checks the same
            ingredients and destination; resolve it before starting another add.
          </p>
        )}
      </div>
    </div>
  );
}

export default AddToGroceriesButton;
