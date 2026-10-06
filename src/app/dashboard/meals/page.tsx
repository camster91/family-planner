"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Plus,
  UtensilsCrossed,
  Coffee,
  Sun,
  Moon,
  ChevronRight,
  BookOpen,
  Refrigerator,
} from "lucide-react";
import { FeatureGate } from "@/components/ui/feature-gate";
import { useFeatureEnabled } from "@/components/providers/features-provider";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  RecipePicker,
  type RecipeOption,
} from "@/components/meals/RecipePicker";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
import { parseDateOnly, toDateOnlyLocal, toDateOnlyUTC } from "@/lib/dates";
import { AddToGroceriesButton } from "@/components/meals/AddToGroceriesButton";
import { useToast, useUndoToast } from "@/components/ui/toast";
import { OFFLINE_MESSAGE, responseErrorMessage } from "@/lib/fetch-error";
import {
  MEAL_LABELS as mealLabels,
  MEAL_TYPES,
  buildDayPlans,
  getWeekDates,
  mealTitle,
  recipeMeta,
  type DayPlan,
  type MealType,
  type PlannedMeal as MealSlot,
} from "@/lib/meal-slots";

const MealIcon = ({ type }: { type: MealType }) => {
  if (type === "breakfast")
    return (
      <Coffee className="w-4 h-4 text-[var(--tint-meals)]" aria-hidden="true" />
    );
  if (type === "lunch")
    return (
      <Sun className="w-4 h-4 text-[var(--tint-meals)]" aria-hidden="true" />
    );
  if (type === "dinner")
    return (
      <Moon className="w-4 h-4 text-[var(--tint-meals)]" aria-hidden="true" />
    );
  return (
    <Moon className="w-4 h-4 text-[var(--tint-meals)]" aria-hidden="true" />
  );
};

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

// Add/Edit Modal
function MealModal({
  mode,
  initial,
  defaultDate,
  defaultMealType,
  onSave,
  onDelete,
  onClose,
  saving,
}: {
  mode: "add" | "edit";
  initial?: MealSlot;
  defaultDate?: string;
  defaultMealType?: MealType;
  onSave: (data: MealSaveData) => void;
  onDelete?: () => void;
  onClose: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [date, setDate] = React.useState(
    initial?.date
      ? toDateOnlyUTC(initial.date)
      : (defaultDate ?? toDateOnlyLocal(new Date())),
  );
  const [meal_type, setMealType] = React.useState<MealType>(
    initial?.meal_type ?? defaultMealType ?? "dinner",
  );
  const [recipe_name, setRecipeName] = React.useState(
    initial?.recipe_name ?? "",
  );
  const [notes, setNotes] = React.useState(initial?.notes ?? "");
  const initialCookId = initial?.cook_id ?? null;
  const [cookId, setCookId] = React.useState(initialCookId ?? "");
  const initialServings = initial?.servings ?? null;
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
    initial?.recipe ?? null,
  );
  const titleId = React.useId();

  const handleRecipeChange = (next: RecipeOption | null) => {
    // Fill the name from the recipe unless the person already typed their own.
    if (next && (!recipe_name.trim() || recipe_name === recipe?.title))
      setRecipeName(next.title);
    setRecipe(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
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
    onSave(data);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={
        mode === "add"
          ? t("meals.addMeal")
          : recipe_name || mealLabels[meal_type]
      }
      testId="meal-modal"
      className="sm:max-w-md space-y-4"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
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
            Meal
          </label>
          <select
            id={`${titleId}-type`}
            value={meal_type}
            onChange={(e) => setMealType(e.target.value as MealType)}
            className="w-full input-apple"
          >
            {MEAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {mealLabels[t]}
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

        <RecipePicker
          value={recipe?.id ?? null}
          onChange={handleRecipeChange}
          initialRecipe={initial?.recipe ?? null}
        />
        <div>
          <label
            htmlFor={`${titleId}-cook`}
            className="text-subhead text-label-secondary mb-1 block"
          >
            Cook (optional)
          </label>
          <select
            id={`${titleId}-cook`}
            value={cookId}
            onChange={(e) => setCookId(e.target.value)}
            className="w-full input-apple min-h-[44px]"
            disabled={membersLoading || membersError || saving}
          >
            <option value="">Unassigned</option>
            {cookId && !members.some((member) => member.id === cookId) && (
              <option value={cookId}>Current cook</option>
            )}
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          {membersLoading && (
            <p role="status" className="text-footnote text-label-secondary">
              Loading household cooks…
            </p>
          )}
          {membersError && (
            <p role="status" className="text-footnote text-label-secondary">
              Could not load cooks. The current assignment will be kept.
            </p>
          )}
        </div>
        {recipe && (
          <Link
            href={`/dashboard/meals/recipes/${recipe.id}`}
            className="inline-flex min-h-[44px] items-center gap-1.5 text-subhead text-[var(--accent-text)]"
          >
            <BookOpen className="w-4 h-4" aria-hidden="true" />
            <span>View recipe</span>
          </Link>
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
            Servings (optional)
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
            disabled={saving}
          />
          <p className="text-footnote text-label-secondary">
            Leave blank if not set. Otherwise, enter 1–100.
          </p>
        </div>
        <div className="flex gap-2 pt-2">
          {mode === "edit" && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="btn-destructive flex-1 min-h-[44px]"
              disabled={saving}
            >
              {t("meals.deleteMeal")}
            </button>
          )}
          <button
            type="submit"
            className="btn-tinted flex-1 min-h-[44px]"
            disabled={saving}
          >
            {saving ? t("common.saving") : t("meals.save")}
          </button>
        </div>
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
                Save servings before adding ingredients to groceries.
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
  // Food inventory (#263) is a separate, opt-in feature; link to it when on.
  const inventoryOn = useFeatureEnabled("inventory");
  const displayLocale = useDisplayLocale();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  // Keep the existing rolling week: today plus six days, not a locale-dependent
  // weekday boundary. URL dates are calendar days, never UTC instants.
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
  const [meals, setMeals] = React.useState<MealSlot[]>([]);
  // Labels follow the viewer's locale; rebuilt when the meals or locale change.
  const week = React.useMemo(
    () => (anchor ? buildDayPlans(meals, anchor, displayLocale) : []),
    [meals, anchor, displayLocale],
  );
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Modal state
  const [modal, setModal] = React.useState<{
    mode: "add" | "edit";
    meal?: MealSlot;
    defaultDate?: string;
    defaultMealType?: MealType;
  } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const { addToast } = useToast();
  const showUndo = useUndoToast();
  const mealRequest = React.useRef({ version: 0 });
  const selectedAnchor = React.useRef<Date | null>(anchor);
  React.useLayoutEffect(() => {
    selectedAnchor.current = anchor;
    const requests = mealRequest.current;
    return () => {
      selectedAnchor.current = null;
      requests.version++;
    };
  }, [anchor]);

  // Mutation and Undo callbacks can outlive their original week. Read the
  // committed selection when refreshing, and guard both identity and order.
  const fetchMeals = React.useCallback(async () => {
    const requestAnchor = selectedAnchor.current;
    if (!requestAnchor) return;
    const request = ++mealRequest.current.version;
    const isCurrent = () =>
      request === mealRequest.current.version &&
      selectedAnchor.current === requestAnchor;
    setLoading(true);
    setError(null);
    try {
      const dates = getWeekDates(requestAnchor);
      const start = toDateOnlyLocal(dates[0]);
      const endDate = new Date(dates[dates.length - 1]);
      endDate.setDate(endDate.getDate() + 1);
      const end = toDateOnlyLocal(endDate);
      const res = await fetch(`/api/meals?start=${start}&end=${end}`);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      if (isCurrent()) setMeals(data.meals ?? []);
    } catch {
      if (isCurrent()) setError(t("meals.errorLoad"));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    void fetchMeals();
  }, [fetchMeals, anchor]);

  const openAdd = (day: DayPlan, mealType: MealType) =>
    setModal({
      mode: "add",
      defaultDate: day.dateKey,
      defaultMealType: mealType,
    });

  const openEdit = (meal: MealSlot) => setModal({ mode: "edit", meal });

  const handleSave = async (data: MealSaveData) => {
    const editing = modal?.mode === "edit" && modal.meal ? modal.meal : null;
    // Keep the dialog open on failure and say why: the server's reason (for
    // example a validation message) or the offline line.
    const failTitle = editing
      ? "Couldn't save the meal"
      : "Couldn't add the meal";
    setSaving(true);
    try {
      const res = editing
        ? await fetch(`/api/meals/${editing.id}`, {
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
              ...(data.servings !== undefined
                ? { servings: data.servings }
                : {}),
            }),
          })
        : await fetch("/api/meals", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
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
      setSaving(false);
    }
  };

  // Undo over confirm (#269): delete at once, then offer Undo, which
  // re-creates the meal with the same day, slot, name, notes, cook, recipe and
  // servings (as a new row).
  const restoreMeal = async (meal: MealSlot) => {
    try {
      const res = await fetch("/api/meals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
      if (!res.ok) throw new Error("Failed to restore");
      await fetchMeals();
    } catch {
      addToast({
        type: "error",
        title: `Couldn't put back ${mealTitle(meal)}`,
        message: "Check your connection and try again.",
      });
    }
  };

  const handleDelete = async () => {
    if (!modal?.meal) return;
    const meal = modal.meal;
    setSaving(true);
    try {
      const res = await fetch(`/api/meals/${meal.id}?id=${meal.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
      setModal(null);
      await fetchMeals();
      showUndo({
        title: `Deleted ${mealTitle(meal)}`,
        onUndo: () => void restoreMeal(meal),
      });
    } catch (err) {
      console.error(err);
      addToast({
        type: "error",
        title: t("common.error"),
        message: "The meal was not deleted. Try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto px-4 pb-20">
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
              <span>What&apos;s in the fridge</span>
            </Link>
          )}
        </div>
        <button
          type="button"
          className="btn-filled min-h-[44px] shrink-0"
          onClick={() => setModal({ mode: "add", defaultDate: startKey })}
          disabled={!anchor}
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          <span>{t("meals.addMeal")}</span>
        </button>
      </div>

      {/* Week section */}
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
              "Unsupported week"
            )}
          </h2>
          <nav
            aria-label="Meal planning weeks"
            className="flex flex-wrap gap-2"
          >
            <button
              type="button"
              className="btn-tinted min-h-[44px]"
              disabled={!previousWeek}
              onClick={() => navigateWeek(-1)}
            >
              Previous week
            </button>
            <button
              type="button"
              className="btn-tinted min-h-[44px]"
              onClick={() => navigateWeek(null)}
            >
              Current week
            </button>
            <button
              type="button"
              className="btn-tinted min-h-[44px]"
              disabled={!nextWeek}
              onClick={() => navigateWeek(1)}
            >
              Next week
            </button>
          </nav>
        </div>

        {!anchor ? (
          <p role="alert" className="text-subhead text-label-secondary">
            Choose a supported seven-day week, or return to the current week.
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
                    <div key={j} className="px-4 py-3 flex items-center gap-3">
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
            description="Check your connection and try again."
            action={
              <button
                type="button"
                className="btn-tinted min-h-[44px]"
                onClick={fetchMeals}
              >
                Try again
              </button>
            }
          />
        ) : (
          <>
            {/* One empty state: an empty week is the week of "Nothing planned"
                rows, each one the way to add that meal. No separate
                illustrated "No meals planned yet" above it. */}
            <div className="space-y-3 stagger">
              {week.map((day) => (
                <DayCard
                  key={day.dateKey}
                  day={day}
                  onAdd={openAdd}
                  onEdit={openEdit}
                />
              ))}
            </div>
          </>
        )}
      </section>

      {/* Modal */}
      {modal && (
        <MealModal
          mode={modal.mode}
          initial={modal.meal}
          defaultDate={modal.defaultDate}
          defaultMealType={modal.defaultMealType}
          onSave={handleSave}
          onDelete={modal.mode === "edit" ? handleDelete : undefined}
          onClose={() => setModal(null)}
          saving={saving}
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
  onAdd,
  onEdit,
}: {
  day: DayPlan;
  onAdd: (day: DayPlan, type: MealType) => void;
  onEdit: (meal: MealSlot) => void;
}) {
  const headingId = `meals-day-${day.dateKey}`;
  return (
    <section
      aria-labelledby={headingId}
      data-testid="meal-day"
      data-day={day.dateKey}
      className={cn(
        "card-apple overflow-hidden",
        day.isToday && "ring-2 ring-[var(--accent)] ring-offset-2",
      )}
    >
      {/* Day header */}
      <div
        className={cn(
          "px-4 py-2.5 flex items-center gap-2 border-b border-[var(--surface-separator)]",
          day.isToday ? "bg-[var(--accent-tint)]" : "bg-[var(--surface-fill)]",
        )}
      >
        <UtensilsCrossed
          className={cn(
            "w-4 h-4",
            day.isToday ? "text-[var(--accent)]" : "text-label-tertiary",
          )}
          aria-hidden="true"
        />
        <h3
          id={headingId}
          className={cn(
            "text-subhead font-semibold",
            day.isToday ? "text-[var(--accent-text)]" : "text-label-primary",
          )}
        >
          {day.isToday ? (
            <span>
              Today<span className="sr-only">, {day.longLabel}</span>
            </span>
          ) : (
            day.label
          )}
        </h3>
      </div>

      {/* Meal slots */}
      <ul className="divide-y divide-[var(--surface-separator)]">
        {day.slots.map((slot) => {
          const label = mealLabels[slot.type];
          const glyph = (
            <span className="w-8 h-8 shrink-0 rounded-full bg-[var(--tint-meals)]/10 flex items-center justify-center">
              <MealIcon type={slot.type} />
            </span>
          );
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
                  aria-label={`Add ${label.toLowerCase()}, ${day.longLabel}`}
                  className="w-full flex items-center gap-3 px-4 py-2.5 min-h-[52px] text-left active:bg-[var(--surface-fill-secondary)]"
                >
                  {glyph}
                  <span className="flex-1 min-w-0">
                    <span className="block text-body text-label-primary">
                      {label}
                    </span>
                    <span className="block text-footnote text-label-secondary">
                      Nothing planned
                    </span>
                  </span>
                  <Plus
                    className="w-5 h-5 shrink-0 text-label-tertiary"
                    aria-hidden="true"
                  />
                </button>
              </li>
            );
          }
          return slot.meals.map((meal, i) => {
            const isLast = i === slot.meals.length - 1;
            const meta = recipeMeta(meal.recipe);
            return (
              <li
                key={meal.id}
                data-testid="meal-slot"
                data-meal-type={slot.type}
                className="flex items-stretch"
              >
                <button
                  type="button"
                  onClick={() => onEdit(meal)}
                  data-testid="meal-row"
                  data-meal-id={meal.id}
                  className="flex-1 min-w-0 flex items-center gap-3 px-4 py-2.5 min-h-[52px] text-left active:bg-[var(--surface-fill-secondary)]"
                >
                  {glyph}
                  <span className="flex-1 min-w-0">
                    <span className="block text-body text-label-primary break-words">
                      {mealTitle(meal)}
                    </span>
                    <span className="block text-footnote text-label-secondary break-words">
                      {meta ? `${label} · ${meta}` : label}
                    </span>
                  </span>
                  <ChevronRight
                    className="w-4 h-4 shrink-0 text-label-tertiary"
                    aria-hidden="true"
                  />
                </button>
                {isLast && (
                  <button
                    type="button"
                    onClick={() => onAdd(day, slot.type)}
                    aria-label={`Add another ${label.toLowerCase()}, ${day.longLabel}`}
                    className="inline-flex w-12 min-h-[44px] shrink-0 items-center justify-center border-l border-[var(--surface-separator)] text-[var(--accent-text)] active:bg-[var(--surface-fill-secondary)]"
                  >
                    <Plus className="w-5 h-5" aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          });
        })}
      </ul>
    </section>
  );
}
