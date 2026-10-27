"use client";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useRecipeDetailText } from "@/i18n/recipe-detail";
import { RecipeDetail, type RecipeDetailData } from "./RecipeDetail";
import { scaleRecipeAmount } from "@/lib/recipe-scaling";
/** Local preview only. The canonical recipe and cooked evidence are never edited. */
export function RecipeCookingView({
  recipe,
  actions,
  disabled = false,
}: {
  recipe: RecipeDetailData;
  disabled?: boolean;
  actions?: (servings: number | undefined) => ReactNode;
}) {
  const text = useRecipeDetailText();
  const control = useId();
  const base =
    recipe.servings &&
    Number.isInteger(recipe.servings) &&
    recipe.servings >= 1 &&
    recipe.servings <= 100
      ? recipe.servings
      : null;
  const [targetText, setTarget] = useState(base ? String(base) : "");
  useEffect(() => {
    setTarget(base ? String(base) : "");
  }, [recipe.id, recipe.updated_at, recipe.revision, base]);
  const target = /^\d{1,3}$/.test(targetText) ? Number(targetText) : 0;
  const valid = base !== null && target >= 1 && target <= 100;
  const detail =
    valid && base !== null && base !== target
      ? {
          ...recipe,
          servings: target,
          ingredients: recipe.ingredients.map((line) => ({
            ...line,
            amount: scaleRecipeAmount(line.amount, base, target) ?? line.amount,
          })),
        }
      : recipe;
  return (
    <div className="space-y-4">
      {base !== null && (
        <section
          className="card-apple p-4 space-y-2"
          aria-labelledby={`${control}-label`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <label
              id={`${control}-label`}
              htmlFor={control}
              className="text-subhead font-semibold"
            >
              {text("cookingPortions")}
            </label>
            <input
              id={control}
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              step={1}
              disabled={disabled}
              value={targetText}
              onChange={(event) => setTarget(event.target.value)}
              className="input-field min-h-[44px] w-24"
              aria-invalid={!valid}
              aria-describedby={`${control}-help`}
            />
            <button
              type="button"
              className="btn-tinted min-h-[44px]"
              disabled={disabled || targetText === String(base)}
              onClick={() => setTarget(String(base))}
            >
              {text("cookingOriginal", { count: base })}
            </button>
          </div>
          <p
            id={`${control}-help`}
            className="text-footnote text-label-secondary"
          >
            {text(valid ? "cookingPreview" : "cookingInvalid")}
          </p>
        </section>
      )}
      <RecipeDetail
        recipe={detail}
        actions={actions?.(valid ? target : undefined)}
      />
    </div>
  );
}
