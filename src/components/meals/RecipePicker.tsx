"use client";

/**
 * Recipe picker for the meal modal (ADR-0007, #252).
 *
 * Lists the household's recipes from `GET /api/recipes` and lets a parent or
 * teen create one inline (`POST /api/recipes`, O-7). "No recipe" keeps the
 * meal free text, exactly as before recipes existed.
 *
 * It renders inside the meal modal's <form>, so the inline create is not a
 * nested form: its button is type="button" and Enter in its fields creates
 * the recipe instead of submitting the meal.
 */
import * as React from "react";
import { readRecipePickerPage } from "@/lib/recipe-picker-client";
import { Plus } from "lucide-react";
import type { MealRecipeSummary } from "@/lib/meal-slots";
import { useTranslation } from "@/i18n";
import { useRecipePresentationText } from "@/i18n/recipe-presentation";

// Creating a recipe is an explicit secondary action. Keep the full recipe
// editor out of the picker chunk until that action is chosen.
const RecipeQuickCreate = React.lazy(() =>
  import("./RecipeEditor").then((module) => ({
    default: module.RecipeEditor,
  })),
);

export type RecipeOption = MealRecipeSummary;

type LoadState = "loading" | "ready" | "error";

export function RecipePicker({
  value,
  onChange,
  canCreate = true,
  initialRecipe,
  onCreatingChange,
  disabled = false,
  isMutationPending,
}: {
  /** Selected recipe id, or null for a free-text meal. */
  value: string | null;
  onChange: (recipe: RecipeOption | null) => void;
  /** Parents and teens may create recipes (O-7); the API enforces it. */
  canCreate?: boolean;
  /** The meal's current recipe, shown even before (or if) the list loads. */
  initialRecipe?: RecipeOption | null;
  /** Pending create blocks the owning meal form and dismissal. */
  onCreatingChange?: (pending: boolean) => void;
  /** Owning meal save/delete blocks selection and inline creation. */
  disabled?: boolean;
  /** Read synchronous ownership even from a pre-mutation event handler. */
  isMutationPending?: () => boolean;
}) {
  const { t } = useTranslation();
  const text = useRecipePresentationText();
  const selectId = React.useId();
  const statusId = React.useId();
  const [recipes, setRecipes] = React.useState<RecipeOption[]>(() =>
    initialRecipe ? [initialRecipe] : [],
  );
  const [state, setState] = React.useState<LoadState>("loading");
  const [creating, setCreating] = React.useState(false);

  const [query, setQuery] = React.useState("");
  const [page, setPage] = React.useState<{ offset: number; trail: number[] }>({ offset: 0, trail: [] });
  const [nextOffset, setNextOffset] = React.useState<number | null>(null);
  const [retry, setRetry] = React.useState(0);
  const [pinnedRecipe, setPinnedRecipe] = React.useState(initialRecipe ?? null);
  const sequence = React.useRef(0);
  const searchInputId = React.useId();

  React.useEffect(() => {
    const generation = ++sequence.current;
    const controller = new AbortController();
    setState("loading");
    // Debounce typing without downloading the rest of the household library.
    const timer = setTimeout(() => {
      void readRecipePickerPage(query.trim(), page.offset, controller.signal)
        .then((result) => {
          if (generation !== sequence.current) return;
          setRecipes(result.recipes);
          setNextOffset(result.nextOffset);
          setState("ready");
        }).catch(() => {
          if (generation === sequence.current) setState("error");
        });
    }, query ? 250 : 0);
    return () => {
      sequence.current++;
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, page.offset, retry]);

  const selectedRecipe = recipes.find((recipe) => recipe.id === value) ??
    (pinnedRecipe?.id === value ? pinnedRecipe : null) ??
    (initialRecipe?.id === value ? initialRecipe : null);
  const options = selectedRecipe && !recipes.some((recipe) => recipe.id === selectedRecipe.id)
    ? [selectedRecipe, ...recipes] : recipes;

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (disabled || isMutationPending?.()) return;
    const id = e.target.value;
    const recipe = id ? (options.find((r) => r.id === id) ?? null) : null;
    setPinnedRecipe(recipe);
    onChange(recipe);
  };

  const handleCreated = (recipe: RecipeOption) => {
    setRecipes((prev) =>
      [...prev.filter((r) => r.id !== recipe.id), recipe].sort((a, b) =>
        a.title.localeCompare(b.title),
      ),
    );
    setPinnedRecipe(recipe);
    setCreating(false);
    onChange(recipe);
  };

  let status: React.ReactNode = null;
  if (state === "loading") status = text("pickerLoading");
  else if (state === "error")
    status = text("pickerFailed");
  else if (recipes.length === 0 && query.trim()) status = text("pickerNoMatches");
  else if (recipes.length === 0)
    status = canCreate
      ? text("pickerEmptyCreate")
      : text("pickerEmpty");

  return (
    <div className="space-y-2" data-testid="recipe-picker">
      <label
        htmlFor={selectId}
        className="text-subhead text-label-secondary mb-1 block"
      >
        {text("pickerLabel")}
      </label>
      <input
        id={searchInputId}
        type="search"
        aria-label={text("pickerSearch")}
        placeholder={text("pickerSearch")}
        value={query}
        maxLength={120}
        disabled={disabled}
        onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}
        onChange={(event) => {
          if (disabled || isMutationPending?.()) return;
          if (selectedRecipe) setPinnedRecipe(selectedRecipe);
          setQuery(event.target.value);
          setPage({ offset: 0, trail: [] });
          setState("loading");
        }}
        className="input-apple min-h-[44px] w-full"
      />
      <div className="flex gap-2">
        <select
          id={selectId}
          value={value ?? ""}
          onChange={handleSelect}
          disabled={disabled}
          aria-describedby={status ? statusId : undefined}
          className="min-w-0 flex-1 input-apple min-h-[44px]"
        >
          <option value="">{text("noRecipe")}</option>
          {options.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </select>
        {canCreate && !creating && (
          <button
            type="button"
            className="btn-tinted min-h-[44px] shrink-0"
            disabled={disabled}
            onClick={() => {
              if (disabled || isMutationPending?.()) return;
              setCreating(true);
            }}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>{text("newRecipe")}</span>
          </button>
        )}
      </div>
      {status && (
        <div className="flex flex-wrap items-center gap-2">
          <p
            id={statusId}
            role="status"
            className="text-footnote text-label-secondary"
          >
            {status}
          </p>
          {state === "error" && (
            <button
              type="button"
              onClick={() => {
                if (disabled || isMutationPending?.()) return;
                setState("loading");
                setRetry((previous) => previous + 1);
              }}
              disabled={disabled}
              className="min-h-[44px] px-3 text-subhead text-[var(--accent-text)] underline-offset-2 hover:underline"
            >
              {text("retry")}
            </button>
          )}
        </div>
      )}
      {(page.trail.length > 0 || nextOffset !== null) && (
        <div className="flex flex-wrap gap-2" aria-label={text("pickerPages")} role="group">
          <button type="button" className="btn-tinted min-h-[44px]"
            disabled={disabled || state !== "ready" || page.trail.length === 0}
            onClick={() => {
              if (disabled || isMutationPending?.() || state !== "ready" || !page.trail.length) return;
              if (selectedRecipe) setPinnedRecipe(selectedRecipe);
              setState("loading");
              setPage({ offset: page.trail[page.trail.length - 1], trail: page.trail.slice(0, -1) });
            }}>{text("pickerPrevious")}</button>
          <button type="button" className="btn-tinted min-h-[44px]"
            disabled={disabled || state !== "ready" || nextOffset === null}
            onClick={() => {
              if (disabled || isMutationPending?.() || state !== "ready" || nextOffset === null) return;
              if (selectedRecipe) setPinnedRecipe(selectedRecipe);
              setState("loading");
              setPage({ offset: nextOffset, trail: [...page.trail, page.offset] });
            }}>{text("pickerNext")}</button>
        </div>
      )}
      {creating && (
        <React.Suspense
          fallback={
            <p role="status" className="text-footnote text-label-secondary">
              {t("common.loading")}
            </p>
          }
        >
          <RecipeQuickCreate
            onCreated={handleCreated}
            onCancel={() => setCreating(false)}
            onSavingChange={onCreatingChange}
            disabled={disabled}
            isMutationPending={isMutationPending}
          />
        </React.Suspense>
      )}
    </div>
  );
}
