"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { useTranslation } from "@/i18n";
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
  const { locale } = useTranslation();
  const es = locale === "es";
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
      aria-label={es ? "Reutilizar receta guardada" : "Reuse saved recipe"}
    >
      {recipe ? (
        <>
          <p className="font-semibold break-words">{recipe.title}</p>
          <p className="text-subhead text-label-secondary">
            {es
              ? "Revisa el día y las porciones antes de guardar. Se usa la misma receta guardada."
              : "Review the day and portions before saving. This uses the same saved recipe."}
          </p>
        </>
      ) : (
        <p role={error ? "alert" : "status"}>
          {error
            ? es
              ? "No pudimos cargar esta receta. Puede no estar disponible en tu hogar actual."
              : "We could not load this recipe. It may be unavailable in your current household."
            : es
              ? "Cargando receta guardada…"
              : "Loading saved recipe…"}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {recipe && (
          <button
            type="button"
            className="btn-filled min-h-[44px]"
            onClick={() => onUse(recipe)}
          >
            {kind === "prep"
              ? es
                ? "Usar en una preparación"
                : "Use in a prep session"
              : es
                ? "Planificar esta receta"
                : "Plan this recipe"}
          </button>
        )}
        {error && (
          <button
            type="button"
            className="btn-tinted min-h-[44px]"
            onClick={() => setAttempt((n) => n + 1)}
          >
            {es ? "Reintentar" : "Try again"}
          </button>
        )}
        <button
          type="button"
          className="btn-tinted min-h-[44px]"
          onClick={onDismiss}
        >
          {es ? "Descartar" : "Dismiss"}
        </button>
      </div>
    </section>
  );
}
