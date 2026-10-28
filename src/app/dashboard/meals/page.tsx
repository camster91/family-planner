"use client";
import { usePreparationActive } from "@/components/calendar/preparation/PreparationProvider";
import { FoodPlanningLauncher } from "@/components/meals/planning/FoodPlanningLauncher";

import * as React from "react";
import { preparedReuseIntent } from "@/lib/prepared-meal-reuse";
import styles from "./meals-board.module.css";
import Link from "next/link";
import { useDraftAwareRouter as useRouter } from "@/components/layout/owned-draft-navigation";
import { usePathname, useSearchParams } from "next/navigation";
import { MealContextLink } from "@/components/meals/MealContextLink";
import { MealViewNav } from "@/components/meals/MealViewNav";
import {
  mealCreateContext,
  mealCreateReceipt,
} from "@/lib/meal-create-contract";
import { useMealCreation } from "@/components/meals/use-meal-creation";
import { useBulkCookingText } from "@/i18n/bulk-cooking";
import { useMealWeek } from "@/components/meals/use-meal-week";
import { useMealWeekText } from "@/i18n/meal-week";
import { useMealsPageText } from "@/i18n/meals-page";
import { mealPrepListSchema, type MealPrepContext } from "@/lib/meal-batches";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import { Plus, UtensilsCrossed, BookOpen, Refrigerator, ChevronLeft, ChevronRight } from "lucide-react";
import { FeatureGate } from "@/components/ui/feature-gate";
import { useFeatureEnabled } from "@/components/providers/features-provider";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/Skeleton";
import type { RecipeOption } from "@/components/meals/RecipePicker";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
import { parseDateOnly, toDateOnlyLocal, toDateOnlyUTC } from "@/lib/dates";
import { AddToGroceriesButton } from "@/components/meals/AddToGroceriesButton";
import { useToast, useUndoToast } from "@/components/ui/toast";
import { OFFLINE_MESSAGE, responseErrorMessage } from "@/lib/fetch-error";
import {
  MEAL_TYPES,
  buildDayPlans,
  getWeekDates,
  mealTitle,
  formatMinutes,
  type DayPlan,
  type MealType,
  type PlannedMeal as MealSlot,
} from "@/lib/meal-slots";

// These controls are only needed after an explicit interaction or when a
// deep-link opens the corresponding view. Keep their substantial form and
// recovery graphs out of the default week planner bundle.
const MealDescriptionDraft = React.lazy(() =>
  import("@/components/meals/MealDescriptionDraft").then((module) => ({
    default: module.MealDescriptionDraft,
  })),
);
const RecipeReuseLauncher = React.lazy(() =>
  import("@/components/meals/RecipeReuseLauncher").then((module) => ({
    default: module.RecipeReuseLauncher,
  })),
);
const BulkCookingPanel = React.lazy(() =>
  import("@/components/meals/BulkCookingPanel").then((module) => ({
    default: module.BulkCookingPanel,
  })),
);
const RecipePicker = React.lazy(() =>
  import("@/components/meals/RecipePicker").then((module) => ({
    default: module.RecipePicker,
  })),
);

interface MealSaveData {
  date: string;
  meal_type: MealType;
  recipe_name: string;
  /** Edit sends null for blank notes so clearing them saves; add omits them. */
  notes?: string | null;
  /** Sent only when a recipe is picked (add) or the link changed (edit); null unlinks. */
  recipe_id?: string | null;
  cook_id?: string | null;
  servings?: number | null;
}

type MealDeleteOwner = {
  userId: string;
  familyId: string;
  generation: number;
  state: "present" | "missing";
};
type MealDeleteRecovery = {
  meal: MealSlot;
  scope: MealPrepContext;
  owner: MealDeleteOwner;
  key: string;
  issuedAt: string;
};

const MEAL_DELETE_REQUEST_TIMEOUT_MS = 10_000;

function mealDeleteRequestSignal() {
  if (typeof AbortSignal.timeout === "function")
    return AbortSignal.timeout(MEAL_DELETE_REQUEST_TIMEOUT_MS);
  // Older WebViews (and older jsdom) do not expose AbortSignal.timeout yet.
  // Keep the request bounded there too rather than silently dropping the
  // deadline on the fridge/tablet clients.
  const controller = new AbortController();
  const timer = globalThis.setTimeout(
    () => controller.abort(),
    MEAL_DELETE_REQUEST_TIMEOUT_MS,
  );
  if (typeof timer === "object" && timer !== null && "unref" in timer)
    (timer as unknown as { unref: () => void }).unref();
  return controller.signal;
}

// Add/Edit Modal
function MealModal({
  mode,
  initial,
  defaultDate,
  defaultMealType,
  defaultRecipe,
  onSave,
  onCreated,
  onDelete,
  onClose,
  saving,
  isMealMutationPending,
}: {
  mode: "add" | "edit";
  initial?: MealSlot;
  defaultDate?: string;
  defaultMealType?: MealType;
  defaultRecipe?: RecipeOption;
  onSave: (data: MealSaveData) => void;
  onCreated: () => void;
  onDelete?: () => void;
  onClose: () => void;
  saving: boolean;
  isMealMutationPending: () => boolean;
}) {
  const { t } = useTranslation();
  const text = useMealsPageText();
  const creation = useMealCreation(mode === "add", onCreated);
  const tBulk = useBulkCookingText();
  const [date, setDate] = React.useState(
    initial?.date
      ? toDateOnlyUTC(initial.date)
      : (defaultDate ?? toDateOnlyLocal(new Date())),
  );
  const [meal_type, setMealType] = React.useState<MealType>(
    initial?.meal_type ?? defaultMealType ?? "dinner",
  );
  const [recipe_name, setRecipeName] = React.useState(
    initial?.recipe_name ?? defaultRecipe?.title ?? "",
  );
  const [notes, setNotes] = React.useState(initial?.notes ?? "");
  const initialCookId = initial?.cook_id ?? null;
  const [cookId, setCookId] = React.useState(initialCookId ?? "");
  const initialServings =
    initial?.servings ??
    (defaultRecipe?.servings && defaultRecipe.servings <= 100
      ? defaultRecipe.servings
      : null);
  const [servings, setServings] = React.useState(
    initialServings === null ? "" : String(initialServings),
  );
  const servingsChanged =
    (servings === "" ? null : Number(servings)) !== initialServings;
  const [members, setMembers] = React.useState<{ id: string; name: string }[]>(
    [],
  );
  const [membersLoading, setMembersLoading] = React.useState(true);
  const [membersError, setMembersError] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    fetch("/api/family/members")
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load cooks");
        const data = await res.json();
        if (active) setMembers(data.members ?? []);
      })
      .catch(() => {
        if (active) setMembersError(true);
      })
      .finally(() => {
        if (active) setMembersLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  // Optional recipe link (ADR-0007). A free-text meal never sends recipe_id.
  const initialRecipeId = initial?.recipe_id ?? initial?.recipe?.id ?? null;
  const [recipe, setRecipe] = React.useState<RecipeOption | null>(
    initial?.recipe ?? defaultRecipe ?? null,
  );
  const titleId = React.useId();
  const [recipeCreating, setRecipeCreating] = React.useState(false);
  const recipeMutationPending = React.useRef(false);
  const handleRecipeCreatingChange = React.useCallback((pending: boolean) => {
    recipeMutationPending.current = pending;
    setRecipeCreating(pending);
  }, []);
  const busy = saving || recipeCreating || creation.locked;
  const isBusy = () =>
    recipeMutationPending.current ||
    isMealMutationPending() ||
    creation.isPending();
  const handleClose = () => {
    if (!isBusy()) onClose();
  };
  const handleDelete = () => {
    if (!isBusy()) onDelete?.();
  };

  const handleRecipeChange = (next: RecipeOption | null) => {
    // Fill the name from the recipe unless the person already typed their own.
    if (next && (!recipe_name.trim() || recipe_name === recipe?.title))
      setRecipeName(next.title);
    setRecipe(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || isBusy()) return;
    const data: MealSaveData = {
      date,
      meal_type,
      recipe_name: recipe && !recipe_name.trim() ? recipe.title : recipe_name,
      notes: notes.trim() ? notes : mode === "edit" ? null : undefined,
    };
    const recipeId = recipe?.id ?? null;
    if (mode === "add" ? recipeId !== null : recipeId !== initialRecipeId)
      data.recipe_id = recipeId;
    const nextCookId = cookId || null;
    if (mode === "add" ? nextCookId !== null : nextCookId !== initialCookId)
      data.cook_id = nextCookId;
    const nextServings = servings === "" ? null : Number(servings);
    if (
      mode === "add" ? nextServings !== null : nextServings !== initialServings
    )
      data.servings = nextServings;
    if (mode === "add") {
      void creation.save(data);
    } else onSave(data);
  };

  return (
    <Dialog
      open
      onClose={busy ? undefined : handleClose}
      title={
        mode === "add"
          ? t("meals.addMeal")
          : recipe_name || text(meal_type)
      }
      testId="meal-modal"
      className="sm:max-w-md space-y-4"
    >
      {mode === "add" && !creation.ready && (
        <p role={creation.contextError ? "alert" : "status"}>
          {creation.contextError
            ? text("householdFailed")
            : text("checkingHousehold")}
        </p>
      )}
      {mode === "add" && creation.contextError && (
        <button
          type="button"
          className="btn-tinted min-h-[44px]"
          onClick={creation.reloadContext}
        >
          {text("retry")}
        </button>
      )}
      {creation.error && <p role="alert">{creation.error}</p>}
      {creation.unknown && (
        <a
          href="/dashboard/meals"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] items-center text-[var(--accent-text)]"
        >
          {text("reviewOtherTab")}{" "}
          ↗
        </a>
      )}
      {creation.unknown && (
        <button
          type="button"
          className="btn-tinted min-h-[44px]"
          disabled={creation.busy}
          onClick={() => void creation.retry()}
        >
          {text("checkSave")}
        </button>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <fieldset
          disabled={busy || (mode === "add" && !creation.ready)}
          className="space-y-4 min-w-0"
        >
          {mode === "add" && !recipe && (
            <React.Suspense
              fallback={
                <p role="status" className="text-footnote text-label-secondary">
                  {t("common.loading")}
                </p>
              }
            >
              <MealDescriptionDraft
                enabled={!busy && creation.ready}
                contextKey={creation.contextKey}
                onApply={(draft) => {
                  if (busy || isBusy() || recipe || !creation.ready) return;
                  setRecipeName(draft.recipe_name);
                  if (draft.date) setDate(draft.date);
                  if (draft.meal_type) setMealType(draft.meal_type);
                  if (draft.servings !== undefined)
                    setServings(String(draft.servings));
                }}
              />
            </React.Suspense>
          )}
          {initial?.batch_id && (
            <p className="text-subhead text-label-secondary">
              {tBulk("detachNotice")}
            </p>
          )}
          <div>
            <label
              htmlFor={`${titleId}-date`}
              className="text-subhead text-label-secondary mb-1 block"
            >
              {t("meals.date")}
            </label>
            <input
              id={`${titleId}-date`}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full input-apple"
              required
            />
          </div>

          <div>
            <label
              htmlFor={`${titleId}-type`}
              className="text-subhead text-label-secondary mb-1 block"
            >
              {text("meal")}
            </label>
            <select
              id={`${titleId}-type`}
              value={meal_type}
              onChange={(e) => setMealType(e.target.value as MealType)}
              className="w-full input-apple"
            >
              {MEAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {text(t)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor={`${titleId}-name`}
              className="text-subhead text-label-secondary mb-1 block"
            >
              {t("meals.addRecipeName")}
            </label>
            <input
              id={`${titleId}-name`}
              type="text"
              value={recipe_name}
              onChange={(e) => setRecipeName(e.target.value)}
              placeholder={t("meals.addRecipeName")}
              className="w-full input-apple"
            />
          </div>

          <React.Suspense
            fallback={
              <p role="status" className="text-footnote text-label-secondary">
                {t("common.loading")}
              </p>
            }
          >
            <RecipePicker
              value={recipe?.id ?? null}
              onChange={handleRecipeChange}
              initialRecipe={initial?.recipe ?? defaultRecipe ?? null}
              onCreatingChange={handleRecipeCreatingChange}
              disabled={saving || creation.locked}
              isMutationPending={() =>
                isMealMutationPending() || creation.isPending()
              }
            />
          </React.Suspense>
          <div>
            <label
              htmlFor={`${titleId}-cook`}
              className="text-subhead text-label-secondary mb-1 block"
            >
              {text("cook")}
            </label>
            <select
              id={`${titleId}-cook`}
              value={cookId}
              onChange={(e) => setCookId(e.target.value)}
              className="w-full input-apple min-h-[44px]"
              disabled={membersLoading || membersError || saving}
            >
              <option value="">{text("unassigned")}</option>
              {cookId && !members.some((member) => member.id === cookId) && (
                <option value={cookId}>{text("currentCook")}</option>
              )}
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
            {membersLoading && (
              <p role="status" className="text-footnote text-label-secondary">
                {text("loadingCooks")}
              </p>
            )}
            {membersError && (
              <p role="status" className="text-footnote text-label-secondary">
                {text("cooksFailed")}
              </p>
            )}
          </div>
          {recipe && (
            <MealContextLink day={date}
              href={`/dashboard/meals/recipes/${recipe.id}`}
              className="inline-flex min-h-[44px] items-center gap-1.5 text-subhead text-[var(--accent-text)]"
            >
              <BookOpen className="w-4 h-4" aria-hidden="true" />
              <span>{text("viewRecipe")}</span>
            </MealContextLink>
          )}

          <div>
            <label
              htmlFor={`${titleId}-notes`}
              className="text-subhead text-label-secondary mb-1 block"
            >
              {t("meals.addNotes")}
            </label>
            <textarea
              id={`${titleId}-notes`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("meals.addNotes")}
              className="w-full input-apple resize-none"
              rows={2}
            />
          </div>

          <div>
            <label
              htmlFor={`${titleId}-servings`}
              className="text-subhead text-label-secondary mb-1 block"
            >
              {text("servings")}
            </label>
            <input
              id={`${titleId}-servings`}
              type="number"
              min="1"
              max="100"
              step="1"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
              className="w-full input-apple min-h-[44px]"
              disabled={busy}
            />
            <p className="text-footnote text-label-secondary">
              {text("servingsHint")}
            </p>
          </div>
          <div className="flex gap-2 pt-2">
            {mode === "edit" && onDelete && (
              <button
                type="button"
                onClick={handleDelete}
                className="btn-destructive flex-1 min-h-[44px]"
                disabled={busy}
              >
                {t("meals.deleteMeal")}
              </button>
            )}
            <button
              type="submit"
              className="btn-tinted flex-1 min-h-[44px]"
              disabled={busy}
            >
              {saving || creation.busy ? t("common.saving") : t("meals.save")}
            </button>
          </div>
        </fieldset>
      </form>

      {/* Groceries use the saved meal, never unsaved recipe/servings drafts. */}
      {mode === "edit" &&
        initial?.id &&
        initial.recipe_id &&
        (recipe?.id ?? null) === initial.recipe_id && (
          <div className="space-y-2">
            <AddToGroceriesButton
              recipeId={initial.recipe_id}
              mealId={initial.id}
              disabled={servingsChanged}
            />
            {servingsChanged && (
              <p role="status" className="text-footnote text-label-secondary">
                {text("saveServings")}
              </p>
            )}
          </div>
        )}
    </Dialog>
  );
}

export default function MealsPage() {
  return (
    <FeatureGate featureKey="meals">
      <React.Suspense fallback={<Skeleton className="h-24 w-full" />}>
        <MealsPageInner />
      </React.Suspense>
    </FeatureGate>
  );
}

// The API validates both date-only query bounds; the end is exclusive.
// A valid start alone is insufficient when start + seven days exceeds its range.
function supportedMealWeek(start: string): Date | null {
  if (!parseDateOnly(start)) return null;
  const [year, month, day] = start.split("-").map(Number);
  const anchor = new Date(year, month - 1, day, 12);
  const end = new Date(anchor);
  end.setDate(end.getDate() + 7);
  return parseDateOnly(toDateOnlyLocal(end)) ? anchor : null;
}

function MealsPageInner() {
  const { t } = useTranslation();
  const text = useMealsPageText();
  const tWeek = useMealWeekText();
  // Food inventory (#263) is a separate, opt-in feature; link to it when on.
  const inventoryOn = useFeatureEnabled("inventory");
  const displayLocale = useDisplayLocale();
  const searchParams = useSearchParams();
  const reuseRecipeId = searchParams.get("recipe");
  const preparedReuse = preparedReuseIntent(searchParams);
  const preparationActive = usePreparationActive();
  const pathname = usePathname();
  const router = useRouter();
  // Keep the existing rolling week: today plus six days, not a locale-dependent
  // weekday boundary. URL dates are calendar days, never UTC instants.
  const dismissReuse = () => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("recipe");
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, {
      scroll: false,
    });
  };
  const dismissPreparedReuse = () => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("preparedSession");
    next.delete("preparedBatch");
    void router.replace(`${pathname}${next.size ? `?${next}` : ""}`, {
      scroll: false,
    });
  };
  const bulkContext = React.useRef<MealPrepContext | null>(null);
  const view = searchParams.get("view") === "bulk" ? "bulk" : "week";
  const requestedStart = searchParams.get("start");
  const startKey = requestedStart ?? toDateOnlyLocal(new Date());
  const anchor = React.useMemo(() => supportedMealWeek(startKey), [startKey]);
  const adjacentWeek = (offset: number) => {
    if (!anchor) return null;
    const next = new Date(anchor);
    next.setDate(next.getDate() + offset * 7);
    const key = toDateOnlyLocal(next);
    return supportedMealWeek(key) ? key : null;
  };
  const previousWeek = adjacentWeek(-1);
  const nextWeek = adjacentWeek(1);
  const navigateWeek = (offset: number | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (offset === null) params.delete("start");
    else {
      const next = adjacentWeek(offset);
      if (!next) return;
      params.set("start", next);
    }
    const query = params.toString();
    router.push(`${pathname}${query ? `?${query}` : ""}`);
  };
  const {
    meals,
    loading,
    error,
    hasMore,
    loadingMore,
    moreFailed,
    pageCount,
    refresh: fetchMeals,
    loadMore,
  } = useMealWeek(anchor, t("meals.errorLoad"));
  // DayCards unmount during canonical reloads after save/delete/Undo. Keep
  // dated disclosure preferences here so those reloads do not hide the result.
  const [expandedDays, setExpandedDays] = React.useState<
    Record<string, boolean>
  >({});
  const toggleDay = (dateKey: string) =>
    setExpandedDays((days) => ({ ...days, [dateKey]: !days[dateKey] }));
  // Labels follow the viewer's locale; rebuilt when the meals or locale change.
  const week = React.useMemo(
    () => (anchor ? buildDayPlans(meals, anchor, displayLocale) : []),
    [meals, anchor, displayLocale],
  );
  // Modal state
  const [modal, setModal] = React.useState<{
    mode: "add" | "edit";
    meal?: MealSlot;
    defaultDate?: string;
    defaultMealType?: MealType;
    defaultRecipe?: RecipeOption;
  } | null>(null);
  const [saving, setSaving] = React.useState(false);
  // Nested recipe handlers can run before React commits the saving state.
  const mealMutationPending = React.useRef(false);
  const isMealMutationPending = React.useCallback(
    () => mealMutationPending.current,
    [],
  );
  const { addToast, removeToast } = useToast();
  const showUndo = useUndoToast();
  const [deleteRecovery, setDeleteRecovery] =
    React.useState<MealDeleteRecovery | null>(null);
  const [deleteRecoveryBusy, setDeleteRecoveryBusy] = React.useState(false);
  // Canonical reloads retain the explicit loaded depth of the selected week.
  // The hook renews range identity for mutation/Undo callbacks that outlive it.
  const openAdd = (day: DayPlan, mealType: MealType) =>
    setModal({
      mode: "add",
      defaultDate: day.dateKey,
      defaultMealType: mealType,
    });

  const openEdit = (meal: MealSlot) => setModal({ mode: "edit", meal });

  const handleSave = async (data: MealSaveData) => {
    if (mealMutationPending.current || modal?.mode !== "edit" || !modal.meal)
      return;
    mealMutationPending.current = true;
    const editing = modal.meal;
    // Keep the dialog open on failure and say why: the server's reason (for
    // example a validation message) or the offline line.
    const failTitle = text("saveFailed");
    setSaving(true);
    try {
      const res = await fetch(`/api/meals/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing.id,
          date: data.date,
          meal_type: data.meal_type,
          recipe_name: data.recipe_name,
          notes: data.notes,
          ...(data.recipe_id !== undefined
            ? { recipe_id: data.recipe_id }
            : {}),
          ...(data.cook_id !== undefined ? { cook_id: data.cook_id } : {}),
          ...(data.servings !== undefined ? { servings: data.servings } : {}),
        }),
      });
      if (!res.ok) {
        addToast({
          type: "error",
          title: failTitle,
          message: await responseErrorMessage(res),
        });
        return;
      }
      setModal(null);
      await fetchMeals();
    } catch {
      addToast({ type: "error", title: failTitle, message: OFFLINE_MESSAGE });
    } finally {
      mealMutationPending.current = false;
      setSaving(false);
    }
  };

  // Undo over confirm (#269): delete at once, then offer Undo, which
  // re-creates the meal with the same day, slot, name, notes, cook, recipe and
  // servings (as a new row).
  const restoreMeal = async (
    meal: MealSlot,
    scope?: MealPrepContext,
    key?: string,
    issuedAt?: string,
  ) => {
    try {
      if (meal.batch_id) {
        if (!scope || !key || typeof meal.servings !== "number")
          throw new Error("Batch context unavailable");
        const res = await fetch("/api/meals/bulk/actions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": key,
          },
          body: JSON.stringify({
            action: "allocate",
            expected_family_id: scope.familyId,
            expected_user_id: scope.userId,
            batch_id: meal.batch_id,
            ...(meal.batch_allocation_key
              ? { restore_allocation_key: meal.batch_allocation_key }
              : {}),
            meals: [
              {
                date: toDateOnlyUTC(meal.date),
                meal_type: meal.meal_type,
                servings: meal.servings,
                ...(meal.recipe_name?.trim()
                  ? { recipe_name: meal.recipe_name }
                  : {}),
                notes: meal.notes ?? null,
                cook_id: meal.cook_id ?? null,
              },
            ],
          }),
        });
        if (!res.ok) throw new Error("Could not restore allocation");
        removeToast(`meal-restore-${meal.id}`);
        await fetchMeals();
        return;
      }
      if (!scope || !key || !issuedAt)
        throw new Error("Original restore context unavailable");
      const res = await fetch("/api/meals/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({
          protocol: "herewoven.meal-create.v1",
          expected_user_id: scope.userId,
          expected_family_id: scope.familyId,
          issued_at: issuedAt,
          date: toDateOnlyUTC(meal.date),
          meal_type: meal.meal_type,
          recipe_name: meal.recipe_name ?? "",
          ...(meal.notes ? { notes: meal.notes } : {}),
          ...(meal.cook_id ? { cook_id: meal.cook_id } : {}),
          ...((meal.recipe_id ?? meal.recipe?.id)
            ? { recipe_id: meal.recipe_id ?? meal.recipe?.id }
            : {}),
          ...(typeof meal.servings === "number"
            ? { servings: meal.servings }
            : {}),
        }),
      });
      if (!res.ok || !mealCreateReceipt.safeParse(await res.json()).success)
        throw new Error("Failed to restore");
      removeToast(`meal-restore-${meal.id}`);
      await fetchMeals();
    } catch {
      addToast({
        type: "error",
        id: `meal-restore-${meal.id}`,
        title: text("restoreUnconfirmed", {
          name: mealTitle(meal, text("untitled")),
        }),
        message: text("restoreHint"),
        duration: 0,
        action: {
          label: text("checkRestore"),
          onClick: () => void restoreMeal(meal, scope, key, issuedAt),
        },
      });
    }
  };

  const readMealDeleteOwner = (body: unknown, mealId: string) => {
    if (!body || typeof body !== "object") return null;
    const value = body as {
      meal?: { id?: unknown };
      context?: { userId?: unknown; familyId?: unknown; generation?: unknown };
      state?: unknown;
    };
    const generation = value.context?.generation;
    if (
      (value.state !== "present" && value.state !== "missing") ||
      value.meal?.id !== mealId ||
      typeof value.context?.userId !== "string" ||
      typeof value.context.familyId !== "string" ||
      !Number.isSafeInteger(generation) ||
      (generation as number) < 0
    )
      return null;
    return {
      userId: value.context.userId,
      familyId: value.context.familyId,
      generation: generation as number,
      state: value.state,
    } satisfies MealDeleteOwner;
  };

  const reconcileMealDelete = async (recovery: MealDeleteRecovery) => {
    if (deleteRecoveryBusy) return;
    setDeleteRecoveryBusy(true);
    try {
      const params = new URLSearchParams({
        id: recovery.meal.id,
        expected_user_id: recovery.owner.userId,
        expected_family_id: recovery.owner.familyId,
        expected_generation: String(recovery.owner.generation),
      });
      let response: Response;
      let body: unknown = null;
      try {
        response = await fetch(
          `/api/meals/${encodeURIComponent(recovery.meal.id)}?${params}`,
          {
            cache: "no-store",
            signal: mealDeleteRequestSignal(),
          },
        );
        body = await response.json().catch(() => null);
      } catch {
        setDeleteRecovery(recovery);
        setModal(null);
        return;
      }

      // A successful, explicit missing result from this exact, original-owner
      // read is the only positive proof that the delete committed. A legacy
      // HTTP 404, malformed body, or present result remains uncertain because
      // the DELETE may still arrive later; never offer a second retry there.
      const read = readMealDeleteOwner(body, recovery.meal.id);
      if (
        response.ok &&
        read?.state === "missing" &&
        read.userId === recovery.owner.userId &&
        read.familyId === recovery.owner.familyId &&
        read.generation === recovery.owner.generation
      ) {
        setDeleteRecovery(null);
        setModal(null);
        await fetchMeals();
        showUndo({
          title: text("deleted", {
            name: mealTitle(recovery.meal, text("untitled")),
          }),
          onUndo: () =>
            void restoreMeal(
              recovery.meal,
              recovery.scope,
              recovery.key,
              recovery.issuedAt,
            ),
        });
        return;
      }

      // A malformed/foreign/current-owner response stays in the same explicit
      // unknown state, including the old route's generic 404 response.
      setDeleteRecovery(recovery);
      setModal(null);
    } finally {
      setDeleteRecoveryBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!modal?.meal || mealMutationPending.current) return;
    // Do not let an unresolved delete be replaced by another destructive
    // request; the recovery banner must retain the original target/key/body.
    if (deleteRecovery) {
      setModal(null);
      return;
    }
    mealMutationPending.current = true;
    const meal = modal.meal;
    let recovery: MealDeleteRecovery | null = null;
    let deleteIssued = false;
    setSaving(true);
    try {
      const ownerParams = new URLSearchParams({ id: meal.id });
      const ownerResponse = await fetch(
        `/api/meals/${encodeURIComponent(meal.id)}?${ownerParams}`,
        { cache: "no-store", signal: mealDeleteRequestSignal() },
      );
      if (!ownerResponse.ok)
        throw new Error("Meal context unavailable");
      const owner = readMealDeleteOwner(
        await ownerResponse.json().catch(() => null),
        meal.id,
      );
      if (!owner || owner.state !== "present")
        throw new Error("Meal context unavailable");
      let undoScope = bulkContext.current ?? undefined;
      if (meal.batch_id && !undoScope) {
        const contextResponse = await fetch("/api/meals/bulk", {
          cache: "no-store",
          signal: mealDeleteRequestSignal(),
        });
        if (!contextResponse.ok) throw new Error("Batch context unavailable");
        undoScope = mealPrepListSchema.parse(
          await contextResponse.json(),
        ).context;
      }
      if (!meal.batch_id) {
        const contextResponse = await fetch("/api/meals/create", {
          cache: "no-store",
          signal: mealDeleteRequestSignal(),
        });
        if (!contextResponse.ok) throw new Error("Meal context unavailable");
        undoScope = mealCreateContext.parse(await contextResponse.json());
      }
      if (
        !undoScope ||
        undoScope.userId !== owner.userId ||
        undoScope.familyId !== owner.familyId
      )
        throw new Error("Meal context changed");
      const undoKey = newIdempotencyKey();
      const undoIssuedAt = new Date().toISOString();
      recovery = {
        meal,
        scope: undoScope,
        owner,
        key: undoKey,
        issuedAt: undoIssuedAt,
      };
      deleteIssued = true;
      const deleteParams = new URLSearchParams({
        id: meal.id,
        expected_user_id: owner.userId,
        expected_family_id: owner.familyId,
        expected_generation: String(owner.generation),
      });
      const res = await fetch(
        `/api/meals/${encodeURIComponent(meal.id)}?${deleteParams}`,
        {
        method: "DELETE",
          signal: mealDeleteRequestSignal(),
        },
      );
      if (!res.ok) {
        if (res.status === 404) {
          setModal(null);
          await fetchMeals();
          addToast({
            type: "info",
            title: text("alreadyGone", {
              name: mealTitle(meal, text("untitled")),
            }),
          });
          return;
        }
        if (res.status >= 500) {
          await reconcileMealDelete(recovery);
          return;
        }
        throw new Error("Failed to delete");
      }
      setModal(null);
      await fetchMeals();
      showUndo({
        title: text("deleted", { name: mealTitle(meal, text("untitled")) }),
        onUndo: () =>
          void restoreMeal(meal, undoScope, undoKey, undoIssuedAt),
      });
    } catch (err) {
      if (recovery && deleteIssued) {
        // A transport failure after the server may have committed is not a
        // normal delete failure. Exact reconciliation decides only the
        // committed-absence case; all other results remain held/unknown.
        await reconcileMealDelete(recovery);
        return;
      }
      console.error(err);
      addToast({
        type: "error",
        title: t("common.error"),
        message: text("deleteFailed"),
      });
    } finally {
      mealMutationPending.current = false;
      setSaving(false);
    }
  };

  return (
    <div className={cn(styles.page, "space-y-6 mx-auto px-4 pb-20")}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-large-title font-display">{t("meals.title")}</h1>
          <p className="text-subhead text-label-secondary mt-0.5">
            {t("meals.subtitle")}
          </p>
          {inventoryOn && (
            <Link
              href="/dashboard/inventory"
              className="inline-flex min-h-[44px] items-center gap-1.5 text-subhead text-[var(--accent-text)]"
            >
              <Refrigerator className="w-4 h-4" aria-hidden="true" />
              <span>{text("fridge")}</span>
            </Link>
          )}
        </div>
        {view === "week" && (
          <button
            type="button"
            className="btn-filled min-h-[44px] shrink-0"
            onClick={() => setModal({ mode: "add", defaultDate: startKey })}
            disabled={!anchor}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>{t("meals.addMeal")}</span>
          </button>
        )}
      </div>

      {deleteRecovery && (
        <div
          role="alert"
          className="rounded-xl border border-[var(--danger)] bg-[var(--surface-grouped)] p-4 space-y-2"
        >
          <p className="text-subhead">
            {text("deleteUnknown", {
              name: mealTitle(deleteRecovery.meal, text("untitled")),
            })}
          </p>
          <button
            type="button"
            className="btn-tinted min-h-[44px]"
            disabled={deleteRecoveryBusy}
            onClick={() => void reconcileMealDelete(deleteRecovery)}
          >
            {deleteRecoveryBusy ? text("checkingDelete") : text("checkDelete")}
          </button>
        </div>
      )}

      <MealViewNav active={view === "bulk" ? "prep" : "plan"} />
      <FoodPlanningLauncher
        day={anchor ? startKey : toDateOnlyLocal(new Date())}
        mode={view === "bulk" ? "prep" : "meals"}
        onSaved={() => {
          void fetchMeals();
        }}
      />
      {view === "week" && reuseRecipeId && anchor && !modal && (
        <React.Suspense
          fallback={
            <p role="status" className="text-footnote text-label-secondary">
              {t("common.loading")}
            </p>
          }
        >
          <RecipeReuseLauncher
            recipeId={reuseRecipeId}
            onDismiss={dismissReuse}
            kind="meal"
            onUse={(recipe) => {
              if (mealMutationPending.current) return;
              setModal({
                mode: "add",
                defaultDate: startKey,
                defaultRecipe: recipe,
              });
            }}
          />
        </React.Suspense>
      )}

      {view === "bulk" && (
        <div>
          <React.Suspense
            fallback={
              <p role="status" className="text-footnote text-label-secondary">
                {t("common.loading")}
              </p>
            }
          >
            <BulkCookingPanel
              reuseRecipeId={reuseRecipeId}
              onDismissReuse={dismissReuse}
              preparedReuse={preparedReuse}
              recoveryRequested={searchParams.get("bulkWork") === "recovery"}
              personalRecoveryAllowed={
                searchParams.get("mode") !== "fridge" && !preparationActive
              }
              onDismissPreparedReuse={dismissPreparedReuse}
              defaultDay={anchor ? startKey : toDateOnlyLocal(new Date())}
              refreshKey={meals}
              onMealsChanged={() => void fetchMeals()}
              onContext={(scope) => {
                bulkContext.current = scope;
              }}
            />
          </React.Suspense>
        </div>
      )}
      {/* Week section */}
      {view === "week" && (
        <section aria-labelledby="meals-week-heading">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
            <h2
              id="meals-week-heading"
              className="section-header"
              aria-live="polite"
            >
              {anchor ? (
                <>
                  {anchor.toLocaleDateString(displayLocale, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                  {" – "}
                  {getWeekDates(anchor)[6].toLocaleDateString(displayLocale, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </>
              ) : (
                text("unsupportedWeek")
              )}
            </h2>
            <nav
              aria-label={text("weeks")}
              className="flex items-center gap-2"
            >
              <button
                type="button"
                className="btn-tinted min-h-[44px] min-w-[44px] px-3"
                aria-label={text("previousWeek")}
                disabled={!previousWeek}
                onClick={() => navigateWeek(-1)}
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn-tinted min-h-[44px]"
                onClick={() => navigateWeek(null)}
              >
                {text("currentWeek")}
              </button>
              <button
                type="button"
                className="btn-tinted min-h-[44px] min-w-[44px] px-3"
                aria-label={text("nextWeek")}
                disabled={!nextWeek}
                onClick={() => navigateWeek(1)}
              >
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </nav>
          </div>

          {!anchor ? (
            <p role="alert" className="text-subhead text-label-secondary">
              {text("weekHint")}
            </p>
          ) : loading ? (
            <div
              className="space-y-3"
              role="status"
              aria-label={t("meals.loading")}
            >
              {[0, 1, 2].map((i) => (
                <div key={i} className="card-apple overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-[var(--surface-separator)]">
                    <Skeleton className="h-4 w-32" />
                  </div>
                  <div className="divide-y divide-[var(--surface-separator)]">
                    {[0, 1, 2].map((j) => (
                      <div
                        key={j}
                        className="px-4 py-3 flex items-center gap-3"
                      >
                        <Skeleton className="h-9 w-9 rounded-full" />
                        <Skeleton className="h-4 flex-1" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <EmptyState
              icon={UtensilsCrossed}
              glyphColor="meals"
              title={t("meals.errorLoad")}
              description={text("connectionHint")}
              action={
                <button
                  type="button"
                  className="btn-tinted min-h-[44px]"
                  onClick={fetchMeals}
                >
                  {text("retry")}
                </button>
              }
            />
          ) : (
            <>
              {/* One empty state: an empty week is the week of "Nothing planned"
                rows, each one the way to add that meal. No separate
                illustrated "No meals planned yet" above it. */}
              {hasMore && (
                <p role="status" className="text-subhead text-label-secondary">
                  {tWeek("partial")}
                </p>
              )}
              <div className={styles.board}>
                {week.map((day) => (
                  <DayCard
                    key={day.dateKey}
                    day={day}
                    incomplete={hasMore}
                    expanded={expandedDays[day.dateKey] ?? false}
                    onToggle={() => toggleDay(day.dateKey)}
                    onAdd={openAdd}
                    onEdit={openEdit}
                  />
                ))}
              </div>
              {(hasMore || pageCount > 1) && (
                <div className="mt-4 space-y-2">
                  {moreFailed && (
                    <p
                      role="alert"
                      className="text-subhead text-label-secondary"
                    >
                      {tWeek("moreFailed")}
                    </p>
                  )}
                  <button
                    type="button"
                    className="btn-tinted min-h-[44px]"
                    aria-disabled={loadingMore || !hasMore}
                    onClick={() => {
                      if (!loadingMore && hasMore) void loadMore();
                    }}
                  >
                    {tWeek(
                      loadingMore
                        ? "loading"
                        : hasMore
                          ? "loadMore"
                          : "complete",
                    )}
                  </button>
                  <p role="status" className="sr-only">
                    {tWeek("loaded", { count: meals.length })}
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* Modal */}
      {modal && (
        <MealModal
          mode={modal.mode}
          initial={modal.meal}
          defaultDate={modal.defaultDate}
          defaultMealType={modal.defaultMealType}
          defaultRecipe={modal.defaultRecipe}
          onSave={handleSave}
          onCreated={() => {
            setModal(null);
            void fetchMeals();
          }}
          onDelete={modal.mode === "edit" ? handleDelete : undefined}
          onClose={() => setModal(null)}
          saving={saving}
          isMealMutationPending={isMealMutationPending}
        />
      )}
    </div>
  );
}

/**
 * One day of the week. Every meal in a slot gets its own row (O-1, gap
 * 2.4.1); an empty slot is one "add" row. Meal type is always written out,
 * never shown by icon alone.
 */
function DayCard({
  day,
  incomplete,
  expanded,
  onToggle,
  onAdd,
  onEdit,
}: {
  day: DayPlan;
  incomplete: boolean;
  expanded: boolean;
  onToggle: () => void;
  onAdd: (day: DayPlan, type: MealType) => void;
  onEdit: (meal: MealSlot) => void;
}) {
  const tBulk = useBulkCookingText();
  const text = useMealsPageText();
  const tWeek = useMealWeekText();
  const headingId = `meals-day-${day.dateKey}`;
  const otherId = `${headingId}-other`;

  const otherSlots = day.slots.filter((slot) => slot.type !== "dinner");
  const otherCount = otherSlots.reduce(
    (count, slot) => count + slot.meals.length,
    0,
  );
  const otherLabel = `${tWeek("otherMeals")}${
    otherCount > 0
      ? ` · ${otherCount}${incomplete ? "+" : ""}`
      : incomplete
        ? " · …"
        : ""
  }`;
  const renderSlots = (slots: DayPlan["slots"]) => (
    <ul className="divide-y divide-[var(--surface-separator)]">
      {slots.map((slot) => {
        const label = text(slot.type);
        if (slot.meals.length === 0) {
          return (
            <li
              key={slot.type}
              data-testid="meal-slot"
              data-meal-type={slot.type}
            >
              <button
                type="button"
                onClick={() => onAdd(day, slot.type)}
                aria-label={text("addMeal", {
                  meal: label.toLowerCase(),
                  day: day.longLabel,
                })}
                className={styles.emptySlot}
              >
                <span>
                  <span className={styles.slotLabel}>{label}</span>
                  <span className={styles.meta}>
                    {tWeek(incomplete ? "notLoaded" : "nothingPlanned")}
                  </span>
                </span>
                <Plus className="w-5 h-5 shrink-0" aria-hidden="true" />
              </button>
            </li>
          );
        }
        return slot.meals.map((meal, i) => {
          const prep = formatMinutes(meal.recipe?.prep_time);
          const meta = meal.recipe
            ? prep
              ? text("recipePrep", { time: prep })
              : text("recipe")
            : null;
          return (
            <li
              key={meal.id}
              data-testid="meal-slot"
              data-meal-type={slot.type}
              className={styles.meal}
            >
              <button
                type="button"
                onClick={() => onEdit(meal)}
                data-testid="meal-row"
                data-meal-id={meal.id}
                className={styles.mealAction}
              >
                <span className={styles.slotLabel}>{label}</span>
                <span className={styles.mealTitle}>{mealTitle(meal, text("untitled"))}</span>
                {meal.batch_id && (
                  <span className={styles.meta}>{tBulk("fromBatch")}</span>
                )}
                {meta && (
                  <span className={styles.meta}>{`${label} · ${meta}`}</span>
                )}
              </button>
              {i === slot.meals.length - 1 && (
                <button
                  type="button"
                  onClick={() => onAdd(day, slot.type)}
                  aria-label={text("addAnother", {
                    meal: label.toLowerCase(),
                    day: day.longLabel,
                  })}
                  className={styles.addAnother}
                >
                  <Plus className="w-5 h-5" aria-hidden="true" />
                </button>
              )}
            </li>
          );
        });
      })}
    </ul>
  );
  return (
    <section
      aria-labelledby={headingId}
      data-testid="meal-day"
      data-day={day.dateKey}
      className={cn(
        "card-apple",
        styles.day,
        day.isToday && "ring-2 ring-[var(--accent)] ring-offset-2",
      )}
    >
      {/* The selected date remains visible, including on Today. */}
      <div
        className={cn(
          "px-4 py-2.5 flex items-center gap-2 border-b border-[var(--surface-separator)]",
          day.isToday ? "bg-[var(--accent-tint)]" : "bg-[var(--surface-fill)]",
        )}
      >
        <h3
          id={headingId}
          className={cn(
            "text-subhead font-semibold",
            day.isToday ? "text-[var(--accent-text)]" : "text-label-primary",
          )}
        >
          {day.isToday ? (
            <span>
              {text("today")}<span className={styles.dateLabel}>{day.longLabel}</span>
            </span>
          ) : (
            day.label
          )}
        </h3>
      </div>

      {renderSlots(day.slots.filter((slot) => slot.type === "dinner"))}
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={otherId}
        aria-label={`${otherLabel}, ${day.longLabel}`}
        className={styles.disclosure}
        onClick={onToggle}
      >
        <span>{otherLabel}</span>
        <span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>
      <div id={otherId} hidden={!expanded}>
        {expanded && renderSlots(otherSlots)}
      </div>
    </section>
  );
}
