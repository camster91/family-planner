"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { useRecipePresentationText } from "@/i18n/recipe-presentation";
import type { RecipeOption } from "./RecipePicker";

const summary = z.object({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(200),
  servings: z.number().int().min(1).max(100).nullable(),
  prep_time: z.number().int().min(0).max(1440).nullable(),
  cook_time: z.number().int().min(0).max(1440).nullable(),
});
/** A URL carries only intent. Re-read owned canonical data; open an editor only on a tap. */
export function RecipeReuseLauncher({
  recipeId: id,
  kind,
  onUse,
  onDismiss,
}: {
  recipeId: string;
  kind: "meal" | "prep";
  onUse: (recipe: RecipeOption) => void;
  onDismiss: () => void;
}) {
  const text = useRecipePresentationText();
  const [load, setLoad] = useState<{
    id: string;
    recipe?: RecipeOption;
    error?: boolean;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!id) {
      setLoad(null);
      return;
    }
    setLoad({ id });
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      setLoad({ id, error: true });
      return;
    }
    let active = true;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 10000);
    void (async () => {
      try {
        const response = await fetch(`/api/recipes/${encodeURIComponent(id)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const recipe = summary.parse((await response.json()).recipe);
        if (recipe.id !== id) throw new Error();
        if (active) setLoad({ id, recipe });
      } catch {
        if (active) setLoad({ id, error: true });
      } finally {
        clearTimeout(deadline);
      }
    })();
    return () => {
      active = false;
      clearTimeout(deadline);
      controller.abort();
    };
  }, [id, attempt]);
  if (!id) return null;
  const recipe = load?.id === id ? load.recipe : undefined;
  const error = load?.id === id && load.error;
  return (
    <section
      className="card-apple p-4 space-y-3"
      aria-label={text("reuseLabel")}
    >
      {recipe ? (
        <>
          <p className="font-semibold break-words">{recipe.title}</p>
          <p className="text-subhead text-label-secondary">
            {text("reuseReview")}
          </p>
        </>
      ) : (
        <p role={error ? "alert" : "status"}>
          {text(error ? "reuseFailed" : "reuseLoading")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {recipe && (
          <button
            type="button"
            className="btn-filled min-h-[44px]"
            onClick={() => onUse(recipe)}
          >
            {text(kind === "prep" ? "usePrep" : "useMeal")}
          </button>
        )}
        {error && (
          <button
            type="button"
            className="btn-tinted min-h-[44px]"
            onClick={() => setAttempt((n) => n + 1)}
          >
            {text("retry")}
          </button>
        )}
        <button
          type="button"
          className="btn-tinted min-h-[44px]"
          onClick={onDismiss}
        >
          {text("dismiss")}
        </button>
      </div>
    </section>
  );
}
