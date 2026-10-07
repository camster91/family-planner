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
import { Plus } from "lucide-react";
import type { MealRecipeSummary } from "@/lib/meal-slots";
import { RecipeEditor as RecipeQuickCreate } from "./RecipeEditor";

export type RecipeOption = MealRecipeSummary;

const RECIPE_LIST_LIMIT = 200;
/** 50 pages of 200: far beyond any household, still finite. */
const RECIPE_MAX_PAGES = 50;

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
  const selectId = React.useId();
  const statusId = React.useId();
  const [recipes, setRecipes] = React.useState<RecipeOption[]>(() =>
    initialRecipe ? [initialRecipe] : [],
  );
  const [state, setState] = React.useState<LoadState>("loading");
  const [creating, setCreating] = React.useState(false);

  const load = React.useCallback(async () => {
    setState("loading");
    try {
      // Follow `nextOffset` so every recipe is pickable, bounded so a runaway
      // server cannot loop forever.
      const list: RecipeOption[] = [];
      let offset: number | null = 0;
      for (let page = 0; offset !== null && page < RECIPE_MAX_PAGES; page++) {
        const res = await fetch(
          `/api/recipes?limit=${RECIPE_LIST_LIMIT}&offset=${offset}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          recipes?: RecipeOption[];
          nextOffset?: number | null;
        };
        if (Array.isArray(data.recipes)) list.push(...data.recipes);
        offset =
          typeof data.nextOffset === "number" && data.nextOffset > offset
            ? data.nextOffset
            : null;
      }
      setRecipes((prev) => {
        // Keep a selected recipe visible even if it falls outside the first page.
        const extra = prev.filter(
          (r) => r.id === value && !list.some((l) => l.id === r.id),
        );
        return [...list, ...extra];
      });
      setState("ready");
    } catch {
      setState("error");
    }
    // `value` is read only to keep the current choice visible after a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (disabled || isMutationPending?.()) return;
    const id = e.target.value;
    onChange(id ? (recipes.find((r) => r.id === id) ?? null) : null);
  };

  const handleCreated = (recipe: RecipeOption) => {
    setRecipes((prev) =>
      [...prev.filter((r) => r.id !== recipe.id), recipe].sort((a, b) =>
        a.title.localeCompare(b.title),
      ),
    );
    setCreating(false);
    onChange(recipe);
  };

  let status: React.ReactNode = null;
  if (state === "loading") status = "Loading recipes…";
  else if (state === "error")
    status = "Couldn’t load recipes. You can still save the meal by name.";
  else if (recipes.length === 0)
    status = canCreate
      ? "No recipes yet. Create one with “New recipe”."
      : "No recipes yet.";

  return (
    <div className="space-y-2" data-testid="recipe-picker">
      <label
        htmlFor={selectId}
        className="text-subhead text-label-secondary mb-1 block"
      >
        Recipe (optional)
      </label>
      <div className="flex gap-2">
        <select
          id={selectId}
          value={value ?? ""}
          onChange={handleSelect}
          disabled={disabled}
          aria-describedby={status ? statusId : undefined}
          className="min-w-0 flex-1 input-apple min-h-[44px]"
        >
          <option value="">No recipe (just a name)</option>
          {recipes.map((r) => (
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
            <span>New recipe</span>
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
              onClick={() => void load()}
              className="min-h-[44px] px-3 text-subhead text-[var(--accent-text)] underline-offset-2 hover:underline"
            >
              Try again
            </button>
          )}
        </div>
      )}
      {creating && (
        <RecipeQuickCreate
          onCreated={handleCreated}
          onCancel={() => setCreating(false)}
          onSavingChange={onCreatingChange}
          disabled={disabled}
          isMutationPending={isMutationPending}
        />
      )}
    </div>
  );
}

export { RecipeEditor as RecipeQuickCreate } from "./RecipeEditor";
