/**
 * Recipe detail (ADR-0007, #252): title, times, servings, ingredients,
 * description and instructions from `GET /api/recipes/[id]`.
 *
 * Presentational only; the route page loads the data and owns loading, error
 * and not-found states. Long titles and ingredient names wrap (no truncation).
 */
import * as React from 'react'
import { Clock, Users } from 'lucide-react'
import { formatAmount } from '@/lib/grocery-display'
import { publicRecipeUrl } from '@/lib/recipe-discovery'
import { formatMinutes } from '@/lib/meal-slots'

export interface RecipeDetailData {
  id: string
  title: string
  description: string | null
  instructions: string | null
  prep_time: number | null
  cook_time: number | null
  servings: number | null
  ingredients: Array<{
    id: string
    amount: number
    unit: string | null
    note: string | null
    ingredient: { id: string; name: string; unit: string | null }
  }>
}

export function RecipeDetail({ recipe, actions }: { recipe: RecipeDetailData; actions?: React.ReactNode }) {
  const sourceMatch = /^Source: (https:\/\/[^\n]+)\n/.exec(recipe.description ?? '')
  const sourceUrl = sourceMatch ? publicRecipeUrl(sourceMatch[1]) : null
  const description = sourceUrl ? recipe.description?.slice(sourceMatch![0].length) : recipe.description
  const prep = formatMinutes(recipe.prep_time)
  const cook = formatMinutes(recipe.cook_time)
  const facts: Array<{ label: string; value: string }> = []
  if (prep) facts.push({ label: 'Prep', value: prep })
  if (cook) facts.push({ label: 'Cook', value: cook })
  if (recipe.servings) facts.push({ label: 'Serves', value: String(recipe.servings) })

  return (
    <article className="space-y-5" data-testid="recipe-detail" aria-labelledby="recipe-title">
      <header className="space-y-2">
        <h1 id="recipe-title" className="text-large-title font-display break-words">
          {recipe.title}
        </h1>
        {description && (
          <p className="text-body text-label-secondary break-words whitespace-pre-line">{description}</p>
        )}
        {sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center text-[var(--accent-text)] break-all">Original recipe · {new URL(sourceUrl).hostname} ↗</a>}
        {facts.length > 0 && (
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-subhead text-label-secondary">
            {facts.map((f) => (
              <div key={f.label} className="flex items-center gap-1.5">
                {f.label === 'Serves' ? (
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
          Ingredients
        </h2>
        {recipe.ingredients.length === 0 ? (
          <p className="card-apple p-4 text-subhead text-label-secondary">No ingredients listed for this recipe.</p>
        ) : (
          <ul className="card-apple divide-y divide-[var(--surface-separator)]" data-testid="recipe-ingredients">
            {recipe.ingredients.map((line) => {
              const amount = formatAmount(line.amount, line.unit)
              return (
                <li key={line.id} className="flex min-h-[44px] items-baseline gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 break-words text-body text-label-primary">
                    {line.ingredient.name}
                    {line.note && <span className="text-label-secondary">, {line.note}</span>}
                  </span>
                  {amount && <span className="shrink-0 text-subhead tabular-nums text-label-secondary">{amount}</span>}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {recipe.instructions && (
        <section aria-labelledby="recipe-instructions">
          <h2 id="recipe-instructions" className="section-header">
            Method
          </h2>
          <p className="card-apple p-4 text-body text-label-primary break-words whitespace-pre-line">
            {recipe.instructions}
          </p>
        </section>
      )}
    </article>
  )
}
