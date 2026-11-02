"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { readRecipeJson } from "@/lib/recipe-read-client";
import { useRecipePresentationText } from "@/i18n/recipe-presentation";
import type { RecipeOption } from "./RecipePicker";

const summary = z.object({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(200),
  servings: z.number().int().min(1).max(100).nullable(),
  prep_time: z.number().int().min(0).max(1440).nullable(),
  cook_time: z.number().int().min(0).max(1440).nullable(),
});
/** A URL carries intent, never authority. Re-read owned canonical data before prefilling an editor. */
export function RecipeReuseLauncher({
  recipeId: id,
  kind,
  onUse,
  onDismiss,
  autoUse = false,
}: {
  recipeId: string;
  kind: "meal" | "prep";
  onUse: (recipe: RecipeOption) => void | boolean;
  /** An explicit Plan meal/Add to prep action may open its review editor directly. */
  autoUse?: boolean;
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
    void (async () => {
      try {
        const body = await readRecipeJson(
          `/api/recipes/${encodeURIComponent(id)}`,
          controller.signal,
          { timeoutMs: 10000 },
        );
        const recipe = z.object({ recipe: summary }).parse(body).recipe;
        if (recipe.id !== id) throw new Error();
        if (active) setLoad({ id, recipe });
      } catch {
        if (active) setLoad({ id, error: true });
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [id, attempt]);
  const callbacks = useRef({ onUse, onDismiss });
  callbacks.current = { onUse, onDismiss };
  const consumed = useRef<string | null>(null);
  const recipe = load?.id === id ? load.recipe : undefined;
  const error = load?.id === id && load.error;
  useEffect(() => {
    if (!autoUse || !recipe || consumed.current === id) return;
    consumed.current = id;
    // Opening an editor is not a save. Preserve the intent if the destination
    // is protecting a pending mutation or an existing draft.
    if (callbacks.current.onUse(recipe) === false) {
      consumed.current = null;
      return;
    }
    callbacks.current.onDismiss();
  }, [autoUse, recipe, id]);
  if (!id) return null;
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
            onClick={() => {
              // The destination owns the day/portion editor. Once it has the
              // canonical recipe, clear only this one-shot intent so closing
              // that editor does not reopen the same saved recipe launcher.
              if (onUse(recipe) !== false) onDismiss();
            }}
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
