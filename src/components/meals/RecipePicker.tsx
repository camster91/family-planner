'use client'

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
import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { MealRecipeSummary } from '@/lib/meal-slots'

export type RecipeOption = MealRecipeSummary

const RECIPE_LIST_LIMIT = 200

type LoadState = 'loading' | 'ready' | 'error'

export function RecipePicker({
  value,
  onChange,
  canCreate = true,
  initialRecipe,
}: {
  /** Selected recipe id, or null for a free-text meal. */
  value: string | null
  onChange: (recipe: RecipeOption | null) => void
  /** Parents and teens may create recipes (O-7); the API enforces it. */
  canCreate?: boolean
  /** The meal's current recipe, shown even before (or if) the list loads. */
  initialRecipe?: RecipeOption | null
}) {
  const selectId = React.useId()
  const statusId = React.useId()
  const [recipes, setRecipes] = React.useState<RecipeOption[]>(() => (initialRecipe ? [initialRecipe] : []))
  const [state, setState] = React.useState<LoadState>('loading')
  const [creating, setCreating] = React.useState(false)

  const load = React.useCallback(async () => {
    setState('loading')
    try {
      const res = await fetch(`/api/recipes?limit=${RECIPE_LIST_LIMIT}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { recipes?: RecipeOption[] }
      const list = Array.isArray(data.recipes) ? data.recipes : []
      setRecipes((prev) => {
        // Keep a selected recipe visible even if it falls outside the first page.
        const extra = prev.filter((r) => r.id === value && !list.some((l) => l.id === r.id))
        return [...list, ...extra]
      })
      setState('ready')
    } catch {
      setState('error')
    }
    // `value` is read only to keep the current choice visible after a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value
    onChange(id ? recipes.find((r) => r.id === id) ?? null : null)
  }

  const handleCreated = (recipe: RecipeOption) => {
    setRecipes((prev) => [...prev.filter((r) => r.id !== recipe.id), recipe].sort((a, b) => a.title.localeCompare(b.title)))
    setCreating(false)
    onChange(recipe)
  }

  let status: React.ReactNode = null
  if (state === 'loading') status = 'Loading recipes…'
  else if (state === 'error') status = 'Couldn’t load recipes. You can still save the meal by name.'
  else if (recipes.length === 0) status = canCreate ? 'No recipes yet. Create one with “New recipe”.' : 'No recipes yet.'

  return (
    <div className="space-y-2" data-testid="recipe-picker">
      <label htmlFor={selectId} className="text-subhead text-label-secondary mb-1 block">
        Recipe (optional)
      </label>
      <div className="flex gap-2">
        <select
          id={selectId}
          value={value ?? ''}
          onChange={handleSelect}
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
            onClick={() => setCreating(true)}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>New recipe</span>
          </button>
        )}
      </div>
      {status && (
        <div className="flex flex-wrap items-center gap-2">
          <p id={statusId} role="status" className="text-footnote text-label-secondary">
            {status}
          </p>
          {state === 'error' && (
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
      {creating && <RecipeQuickCreate onCreated={handleCreated} onCancel={() => setCreating(false)} />}
    </div>
  )
}

interface IngredientDraft {
  key: number
  name: string
  amount: string
  unit: string
}

function toMinutes(value: string): number | null | 'invalid' {
  const trimmed = value.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  if (!Number.isInteger(n) || n < 0 || n > 24 * 60) return 'invalid'
  return n
}

/**
 * Inline "new recipe" panel: title, prep and cook minutes, ingredient lines.
 * Exported for tests.
 */
export function RecipeQuickCreate({
  onCreated,
  onCancel,
}: {
  onCreated: (recipe: RecipeOption) => void
  onCancel: () => void
}) {
  const baseId = React.useId()
  const titleRef = React.useRef<HTMLInputElement>(null)
  const nextKey = React.useRef(1)
  const [title, setTitle] = React.useState('')
  const [prep, setPrep] = React.useState('')
  const [cook, setCook] = React.useState('')
  const [lines, setLines] = React.useState<IngredientDraft[]>([{ key: 0, name: '', amount: '1', unit: '' }])
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    titleRef.current?.focus()
  }, [])

  const updateLine = (key: number, patch: Partial<IngredientDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const addLine = () => setLines((prev) => [...prev, { key: nextKey.current++, name: '', amount: '1', unit: '' }])

  const removeLine = (key: number) => setLines((prev) => prev.filter((l) => l.key !== key))

  const submit = async () => {
    if (saving) return
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setError('Give the recipe a name.')
      titleRef.current?.focus()
      return
    }
    const prepMinutes = toMinutes(prep)
    const cookMinutes = toMinutes(cook)
    if (prepMinutes === 'invalid' || cookMinutes === 'invalid') {
      setError('Times must be whole minutes, up to 1440.')
      return
    }
    const ingredients: { name: string; amount: number; unit?: string }[] = []
    for (const line of lines) {
      const name = line.name.trim()
      if (!name) continue
      const amount = Number(line.amount.trim() || '1')
      if (!Number.isFinite(amount) || amount < 0) {
        setError(`Amount for “${name}” must be a number.`)
        return
      }
      const unit = line.unit.trim()
      ingredients.push(unit ? { name, amount, unit } : { name, amount })
    }

    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: cleanTitle,
          ...(prepMinutes !== null ? { prep_time: prepMinutes } : {}),
          ...(cookMinutes !== null ? { cook_time: cookMinutes } : {}),
          ...(ingredients.length > 0 ? { ingredients } : {}),
        }),
      })
      const data = (await res.json().catch(() => null)) as { recipe?: RecipeOption; error?: unknown } | null
      if (!res.ok || !data?.recipe) {
        setError(typeof data?.error === 'string' ? data.error : 'Couldn’t save the recipe. Try again.')
        return
      }
      const r = data.recipe
      onCreated({ id: r.id, title: r.title, prep_time: r.prep_time, cook_time: r.cook_time, servings: r.servings })
    } catch {
      setError('Couldn’t save the recipe. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  // Enter in a field creates the recipe instead of submitting the meal form.
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <fieldset
      className="space-y-3 rounded-xl border border-[var(--surface-separator)] p-3"
      data-testid="recipe-quick-create"
      disabled={saving}
    >
      <legend className="px-1 text-subhead font-semibold text-label-primary">New recipe</legend>

      <div>
        <label htmlFor={`${baseId}-title`} className="text-subhead text-label-secondary mb-1 block">
          Recipe name
        </label>
        <input
          ref={titleRef}
          id={`${baseId}-title`}
          type="text"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onKeyDown}
          className="w-full input-apple min-h-[44px]"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={`${baseId}-prep`} className="text-subhead text-label-secondary mb-1 block">
            Prep (min)
          </label>
          <input
            id={`${baseId}-prep`}
            type="number"
            inputMode="numeric"
            min={0}
            max={1440}
            value={prep}
            onChange={(e) => setPrep(e.target.value)}
            onKeyDown={onKeyDown}
            className="w-full input-apple min-h-[44px]"
          />
        </div>
        <div>
          <label htmlFor={`${baseId}-cook`} className="text-subhead text-label-secondary mb-1 block">
            Cook (min)
          </label>
          <input
            id={`${baseId}-cook`}
            type="number"
            inputMode="numeric"
            min={0}
            max={1440}
            value={cook}
            onChange={(e) => setCook(e.target.value)}
            onKeyDown={onKeyDown}
            className="w-full input-apple min-h-[44px]"
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-subhead text-label-secondary">Ingredients (optional)</p>
        {lines.map((line, i) => (
          <div key={line.key} role="group" aria-label={`Ingredient ${i + 1}`} className="flex items-end gap-2">
            <div className="w-16 shrink-0">
              <label htmlFor={`${baseId}-amt-${line.key}`} className="text-caption-1 text-label-secondary block">
                Amount
              </label>
              <input
                id={`${baseId}-amt-${line.key}`}
                type="text"
                inputMode="decimal"
                value={line.amount}
                onChange={(e) => updateLine(line.key, { amount: e.target.value })}
                onKeyDown={onKeyDown}
                className="w-full input-apple min-h-[44px]"
              />
            </div>
            <div className="w-16 shrink-0">
              <label htmlFor={`${baseId}-unit-${line.key}`} className="text-caption-1 text-label-secondary block">
                Unit
              </label>
              <input
                id={`${baseId}-unit-${line.key}`}
                type="text"
                maxLength={32}
                value={line.unit}
                onChange={(e) => updateLine(line.key, { unit: e.target.value })}
                onKeyDown={onKeyDown}
                className="w-full input-apple min-h-[44px]"
              />
            </div>
            <div className="min-w-0 flex-1">
              <label htmlFor={`${baseId}-name-${line.key}`} className="text-caption-1 text-label-secondary block">
                Ingredient
              </label>
              <input
                id={`${baseId}-name-${line.key}`}
                type="text"
                maxLength={200}
                value={line.name}
                onChange={(e) => updateLine(line.key, { name: e.target.value })}
                onKeyDown={onKeyDown}
                className="w-full input-apple min-h-[44px]"
              />
            </div>
            <button
              type="button"
              onClick={() => removeLine(line.key)}
              aria-label={`Remove ingredient ${i + 1}`}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-label-secondary active:bg-[var(--surface-fill)]"
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addLine}
          className="inline-flex min-h-[44px] items-center gap-1 px-1 text-subhead text-[var(--accent-text)]"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          Add ingredient
        </button>
      </div>

      {error && (
        <p role="alert" className="text-footnote text-[var(--danger-text)]">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="btn-plain flex-1 min-h-[44px]">
          Cancel
        </button>
        <button type="button" onClick={() => void submit()} className="btn-tinted flex-1 min-h-[44px]">
          {saving ? 'Saving…' : 'Save recipe'}
        </button>
      </div>
    </fieldset>
  )
}
