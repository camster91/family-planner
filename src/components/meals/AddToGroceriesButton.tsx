"use client";

import * as React from "react";
import { z } from "zod";
import { useRecipeGroceriesText, type RecipeGroceriesMessage } from "@/i18n/recipe-groceries";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
import { useBulkCookingText } from "@/i18n/bulk-cooking";
import { Loader2, ShoppingCart, Undo2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import {
  postAddFromRecipe,
  postUndoAdd,
  summarizeAdd,
  summarizeUndo,
  undoRemainingMs,
  type AddFromRecipeRequest,
  type AddFromRecipeResult,
  type UndoAddResult,
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
    batchPrepared: z.boolean().optional(),
    defaultListId: reviewId.nullable(),
    inventory: z.discriminatedUnion("state", [
      z.object({ state: z.literal("unavailable") }),
      z.object({
        state: z.literal("available"),
        haveIngredientIds: z.array(reviewId).max(100),
        truncated: z.boolean(),
        matching: z.literal("presence_only").optional(),
        matches: z
          .array(
            z.object({
              ingredientId: reviewId,
              kind: z.enum(["linked", "name"]),
            }),
          )
          .max(100)
          .optional(),
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
        )) &&
      (data.inventory.state === "unavailable" ||
        !data.inventory.matches ||
        (new Set(data.inventory.matches.map((match) => match.ingredientId))
          .size === data.inventory.matches.length &&
          data.inventory.matches.every(
            (match) =>
              data.inventory.state === "available" &&
              data.inventory.haveIngredientIds.includes(match.ingredientId),
          ))),
  );
type GroceryReview = z.infer<typeof groceryReviewSchema>;

type Status =
  | { kind: "idle" }
  | { kind: "adding" }
  | { kind: "added"; result: AddFromRecipeResult; notice?: string }
  | { kind: "undoing"; result: AddFromRecipeResult }
  | { kind: "undone"; result: UndoAddResult }
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
  /** Owning reader can freeze its preview/edits while exact recovery is pending. */
  onPendingChange?: (pending: boolean) => void;
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
  batchId,
  listId,
  servings,
  ingredientIds,
  label,
  className,
  disabled = false,
  onAdded,
  onUndone,
  onPendingChange,
}: AddToGroceriesButtonProps) {
  const tBulk = useBulkCookingText();
  const text = useRecipeGroceriesText();
  const locale = useDisplayLocale();
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const summaryCopy = { text, number };
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [review, setReview] = React.useState<GroceryReview | null>(null);
  const [reviewError, setReviewError] = React.useState<
    RecipeGroceriesMessage | { kind: "prepared-batch" } | null
  >(null);
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
  const uncertainAdd = React.useRef(false);
  const uncertainUndo = React.useRef(false);
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
  const [owned, setOwned] = React.useState(false);
  const ownedRef = React.useRef(false);
  const ownerCallback = React.useRef(onPendingChange);
  ownerCallback.current = onPendingChange;
  const navigation = usePendingFormNavigationController(owned);
  const own = (active: boolean) => {
    ownedRef.current = active;
    setOwned(active);
    ownerCallback.current?.(active);
  };
  const release = async () => {
    await navigation.releaseBeforeNavigation();
    own(false);
  };

  const closeReview = () => {
    reviewSequence.current++;
    setReviewOpen(false);
  };
  const openReview = async () => {
    if (busy || disabled || mutationInFlight.current || ownedRef.current)
      return;
    const sequence = ++reviewSequence.current;
    const intent = {
      recipeId,
      mealId,
      batchId,
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
        intent.servings > 100)
    ) {
      setReviewError("servingsInvalid");
      return;
    }
    try {
      const params = new URLSearchParams({ recipeId });
      if (mealId) params.set("mealId", mealId);
      if (batchId) params.set("batchId", batchId);
      const response = await fetch(
        `/api/lists/items/from-recipe/review?${params}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Review unavailable");
      const data = groceryReviewSchema.parse(await response.json());
      if (data.recipeId !== intent.recipeId)
        throw new Error("Mismatched recipe");
      if (sequence !== reviewSequence.current) return;
      if (data.batchPrepared) {
        setReviewError({ kind: "prepared-batch" });
        return;
      }
      if (intent.listId && !data.lists.some((l) => l.id === intent.listId)) {
        setReviewError(
          "listUnavailable",
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
        setReviewError("loadFailed");
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
        batchId: reviewedRequest.current!.batchId,
        listId: destination || undefined,
        servings: reviewedRequest.current!.servings,
        ingredientIds: [...selected],
      },
    };
    mutationInFlight.current = true;
    own(true);
    setStatus({ kind: "adding" });
    const outcome = await postAddFromRecipe(
      pending.current.request,
      pending.current.key,
    );
    if (
      outcome.kind === "retry" ||
      (outcome.kind === "error" && uncertainAdd.current)
    ) {
      uncertainAdd.current = true;
      mutationInFlight.current = false;
      setStatus({ kind: "error", message: outcome.message, retryable: true });
      return;
    }
    pending.current = null;
    uncertainAdd.current = false;
    await release();
    if (outcome.kind === "error") {
      setStatus({ kind: "error", message: outcome.message, retryable: false });
      mutationInFlight.current = false;
      return;
    }
    setStatus({ kind: "added", result: outcome.result });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    // A replay can arrive minutes after the add: count down to the server's
    // expiry rather than restarting the full window.
    const remaining = undoRemainingMs(outcome.result, UNDO_WINDOW_MS);
    setUndoOpen(outcome.result.createdCount > 0 && remaining > 0);
    undoTimer.current = setTimeout(() => setUndoOpen(false), remaining);
    mutationInFlight.current = false;
    onAdded?.(outcome.result);
  };

  const undo = async () => {
    if (status.kind !== "added" || mutationInFlight.current) return;
    mutationInFlight.current = true;
    own(true);
    const { result } = status;
    setStatus({ kind: "undoing", result });
    const outcome = await postUndoAdd(result.requestId);
    if (!outcome.ok) {
      if (outcome.retryable || uncertainUndo.current) {
        uncertainUndo.current = true;
        // Undo is safe to repeat and the first attempt may even have landed:
        // keep the result and the Undo control so it can be tried again.
        setStatus({ kind: "added", result, notice: outcome.message });
        mutationInFlight.current = false;
        return;
      }
      await release();
      setUndoOpen(false);
      setStatus({ kind: "error", message: outcome.message, retryable: false });
      mutationInFlight.current = false;
      return;
    }
    uncertainUndo.current = false;
    setUndoOpen(false);
    await release();
    setStatus({ kind: "undone", result: outcome.result });
    mutationInFlight.current = false;
    onUndone?.();
  };

  const shown =
    status.kind === "added" || status.kind === "undoing" ? status : null;
  const summary = shown ? summarizeAdd(shown.result, summaryCopy) : null;
  const canUndo = shown !== null && (undoOpen || owned);

  return (
    <div className={cn("space-y-2", className)}>
      <button
        type="button"
        onClick={status.kind === "error" && status.retryable ? add : openReview}
        disabled={
          busy ||
          disabled ||
          (owned && !(status.kind === "error" && status.retryable))
        }
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
          {status.kind === "error" && status.retryable ? text("retry") : label ?? text("add")}
        </span>
      </button>

      <Dialog
        open={reviewOpen}
        onClose={closeReview}
        title={text("title")}
        closeLabel={text("close")}
      >
        {!review && !reviewError && <p role="status">{text("loading")}</p>}
        {reviewError && (
          <p role="alert">
            {typeof reviewError === "string"
              ? text(reviewError)
              : tBulk("preparedGroceries")}
          </p>
        )}
        {review && (
          <div className="space-y-4">
            <p className="font-semibold break-words">{review.title}</p>
            <p>{text("servings", { count: number(review.targetServings) })}</p>
            {review.inventory.state === "unavailable" ? (
              <p>{tBulk("stockComparisonUnavailable")}</p>
            ) : (
              <p>
                {tBulk("stockPresenceOnly")}
                {review.inventory.truncated ? ` ${tBulk("stockPartial")}` : ""}
              </p>
            )}
            <label className="block">
              {text("destination")}
              <select
                aria-label={text("destination")}
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
                  <option value="">{text("createList")}</option>
                )}
              </select>
            </label>
            {review.listsTruncated && (
              <p>{text("firstLists")}</p>
            )}
            {review.ingredients.length === 0 && (
              <p>{text("empty")}</p>
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
                      {number(Math.round(
                        ((i.amount * review.targetServings) /
                          review.baseServings) *
                          100,
                      ) / 100)}
                      {i.unit ? ` ${i.unit}` : ""}
                    </span>
                    {review.inventory.state === "available" && (
                      <span className="block text-footnote text-label-secondary">
                        {review.inventory.haveIngredientIds.includes(
                          i.ingredientId,
                        )
                          ? review.inventory.matches?.find(
                              (match) => match.ingredientId === i.ingredientId,
                            )?.kind === "linked"
                            ? tBulk("stockLinked")
                            : review.inventory.matches?.find(
                                  (match) =>
                                    match.ingredientId === i.ingredientId,
                                )?.kind === "name"
                              ? tBulk("stockNameMatch")
                              : tBulk("stockPresent")
                          : review.inventory.truncated
                            ? tBulk("stockNoMatchPartial")
                            : tBulk("stockNoMatch")}
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
              {text("addSelected")}
            </button>
          </div>
        )}
        <button
          type="button"
          className="btn-tinted min-h-[44px] mt-3"
          onClick={closeReview}
        >
          {text("cancel")}
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
                {text("undo")}
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
          <p className="text-subhead text-label-secondary">{summarizeUndo(status.result, summaryCopy)}</p>
        )}
        {status.kind === "error" && (
          <p className="text-subhead text-[var(--danger-text)]">
            {status.message}
          </p>
        )}
        {status.kind === "error" && status.retryable && (
          <p className="text-subhead text-label-secondary">
            {text("uncertain")}
          </p>
        )}
      </div>
    </div>
  );
}

export default AddToGroceriesButton;
