"use client";
/**
 * Recipe detail (ADR-0007, #252): title, times, servings, ingredients,
 * description and instructions from `GET /api/recipes/[id]`.
 *
 * Presentational only; the route page loads the data and owns loading, error
 * and not-found states. Long titles and ingredient names wrap (no truncation).
 */
import * as React from "react";
import { Clock, Users } from "lucide-react";
import { formatRecipeAmount } from "@/lib/recipe-scaling";
import { publicRecipeUrl } from "@/lib/recipe-discovery";
import { formatMinutes } from "@/lib/meal-slots";
import { useTranslation } from "@/i18n";
import { useRecipePresentationText } from "@/i18n/recipe-presentation";

export interface RecipeDetailData {
  id: string;
  title: string;
  source_url?: string | null;
  favorite?: boolean;
  revision?: number;
  updated_at?: string;
  description: string | null;
  instructions: string | null;
  prep_time: number | null;
  cook_time: number | null;
  servings: number | null;
  ingredients: Array<{
    id: string;
    amount: number;
    unit: string | null;
    note: string | null;
    ingredient: { id: string; name: string; unit: string | null };
  }>;
}

export function RecipeDetail({
  recipe,
  actions,
}: {
  recipe: RecipeDetailData;
  actions?: React.ReactNode;
}) {
  const { locale } = useTranslation();
  const text = useRecipePresentationText();
  const sourceMatch = /^Source: (https:\/\/[^\n]+)\n/.exec(
    recipe.description ?? "",
  );
  const sourceUrl = recipe.source_url
    ? publicRecipeUrl(recipe.source_url)
    : sourceMatch
      ? publicRecipeUrl(sourceMatch[1])
      : null;
  const description =
    sourceMatch && sourceUrl
      ? recipe.description?.slice(sourceMatch[0].length)
      : recipe.description;
  const prep = formatMinutes(recipe.prep_time);
  const cook = formatMinutes(recipe.cook_time);
  const facts: Array<{ label: string; value: string; servings?: boolean }> = [];
  if (prep) facts.push({ label: text("prep"), value: prep });
  if (cook) facts.push({ label: text("cook"), value: cook });
  if (recipe.servings)
    facts.push({
      label: text("serves"),
      value: new Intl.NumberFormat(locale).format(recipe.servings),
      servings: true,
    });

  return (
    <article
      className="space-y-5"
      data-testid="recipe-detail"
      aria-labelledby="recipe-title"
    >
      <header className="space-y-2">
        <h1
          id="recipe-title"
          className="text-large-title font-display break-words"
        >
          {recipe.title}
        </h1>
        {description && (
          <p className="text-body text-label-secondary break-words whitespace-pre-line">
            {description}
          </p>
        )}
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center text-[var(--accent-text)] break-all"
          >
            {text("original")} ·{" "}
            {new URL(sourceUrl).hostname} ↗
          </a>
        )}
        {facts.length > 0 && (
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-subhead text-label-secondary">
            {facts.map((f) => (
              <div key={f.label} className="flex items-center gap-1.5">
                {f.servings ? (
                  <Users className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <Clock className="w-4 h-4" aria-hidden="true" />
                )}
                <dt>{f.label}</dt>
                <dd className="font-semibold text-label-primary">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </header>

      {actions}

      <section aria-labelledby="recipe-ingredients">
        <h2 id="recipe-ingredients" className="section-header">
          {text("ingredients")}
        </h2>
        {recipe.ingredients.length === 0 ? (
          <p className="card-apple p-4 text-subhead text-label-secondary">
            {text("noIngredients")}
          </p>
        ) : (
          <ul
            className="card-apple divide-y divide-[var(--surface-separator)]"
            data-testid="recipe-ingredients"
          >
            {recipe.ingredients.map((line) => {
              const amount = formatRecipeAmount(line.amount, line.unit, locale);
              return (
                <li
                  key={line.id}
                  className="flex min-h-[44px] items-baseline gap-3 px-4 py-2.5"
                >
                  <span className="min-w-0 flex-1 break-words text-body text-label-primary">
                    {line.ingredient.name}
                    {line.note && (
                      <span className="text-label-secondary">
                        , {line.note}
                      </span>
                    )}
                  </span>
                  {amount && (
                    <span className="shrink-0 text-subhead tabular-nums text-label-secondary">
                      {amount}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {recipe.instructions && (
        <section aria-labelledby="recipe-instructions">
          <h2 id="recipe-instructions" className="section-header">
            {text("method")}
          </h2>
          <p className="card-apple p-4 text-body text-label-primary break-words whitespace-pre-line">
            {recipe.instructions}
          </p>
        </section>
      )}
    </article>
  );
}
