'use client'

import * as React from 'react'
import Link from 'next/link'
import { Plus, UtensilsCrossed, Coffee, Sun, Moon, X, ChevronRight, BookOpen, Refrigerator } from 'lucide-react'
import { FeatureGate } from '@/components/ui/feature-gate'
import { useFeatureEnabled } from '@/components/providers/features-provider'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/Skeleton'
import { RecipePicker, type RecipeOption } from '@/components/meals/RecipePicker'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'
import { toDateOnlyLocal, toDateOnlyUTC } from '@/lib/dates'
import { AddToGroceriesButton } from '@/components/meals/AddToGroceriesButton'
import { useToast, useUndoToast } from '@/components/ui/toast'
import { OFFLINE_MESSAGE, responseErrorMessage } from '@/lib/fetch-error'
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
} from '@/lib/meal-slots'

const MealIcon = ({ type }: { type: MealType }) => {
  if (type === 'breakfast') return <Coffee className="w-4 h-4 text-[var(--tint-meals)]" aria-hidden="true" />
  if (type === 'lunch') return <Sun className="w-4 h-4 text-[var(--tint-meals)]" aria-hidden="true" />
  if (type === 'dinner') return <Moon className="w-4 h-4 text-[var(--tint-meals)]" aria-hidden="true" />
  return <Moon className="w-4 h-4 text-[var(--tint-meals)]" aria-hidden="true" />
}

interface MealSaveData {
  date: string
  meal_type: MealType
  recipe_name: string
  notes?: string
  /** Sent only when a recipe is picked (add) or the link changed (edit); null unlinks. */
  recipe_id?: string | null
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
  mode: 'add' | 'edit'
  initial?: MealSlot
  defaultDate?: string
  defaultMealType?: MealType
  onSave: (data: MealSaveData) => void
  onDelete?: () => void
  onClose: () => void
  saving: boolean
}) {
  const { t } = useTranslation()
  const [date, setDate] = React.useState(initial?.date ? toDateOnlyUTC(initial.date) : defaultDate ?? toDateOnlyLocal(new Date()))
  const [meal_type, setMealType] = React.useState<MealType>(initial?.meal_type ?? defaultMealType ?? 'dinner')
  const [recipe_name, setRecipeName] = React.useState(initial?.recipe_name ?? '')
  const [notes, setNotes] = React.useState(initial?.notes ?? '')
  // Optional recipe link (ADR-0007). A free-text meal never sends recipe_id.
  const initialRecipeId = initial?.recipe_id ?? initial?.recipe?.id ?? null
  const [recipe, setRecipe] = React.useState<RecipeOption | null>(initial?.recipe ?? null)
  const titleId = React.useId()

  const handleRecipeChange = (next: RecipeOption | null) => {
    // Fill the name from the recipe unless the person already typed their own.
    if (next && (!recipe_name.trim() || recipe_name === recipe?.title)) setRecipeName(next.title)
    setRecipe(next)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const data: MealSaveData = {
      date,
      meal_type,
      recipe_name: recipe && !recipe_name.trim() ? recipe.title : recipe_name,
      notes: notes || undefined,
    }
    const recipeId = recipe?.id ?? null
    if (mode === 'add' ? recipeId !== null : recipeId !== initialRecipeId) data.recipe_id = recipeId
    onSave(data)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="meal-modal"
        className="relative bg-[var(--surface-elevated)] rounded-2xl shadow-xl w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto p-5 space-y-4"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id={titleId} className="min-w-0 break-words text-title-3 font-display text-label-primary">
            {mode === 'add' ? t('meals.addMeal') : recipe_name || mealLabels[meal_type]}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:bg-[var(--surface-fill)]"
          >
            <X className="w-5 h-5 text-label-tertiary" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor={`${titleId}-date`} className="text-subhead text-label-secondary mb-1 block">{t('dashboard.due')}</label>
            <input
              id={`${titleId}-date`}
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full input-apple"
              required
            />
          </div>

          <div>
            <label htmlFor={`${titleId}-type`} className="text-subhead text-label-secondary mb-1 block">Meal</label>
            <select
              id={`${titleId}-type`}
              value={meal_type}
              onChange={e => setMealType(e.target.value as MealType)}
              className="w-full input-apple"
            >
              {MEAL_TYPES.map(t => (
                <option key={t} value={t}>{mealLabels[t]}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={`${titleId}-name`} className="text-subhead text-label-secondary mb-1 block">{t('meals.addRecipeName')}</label>
            <input
              id={`${titleId}-name`}
              type="text"
              value={recipe_name}
              onChange={e => setRecipeName(e.target.value)}
              placeholder={t('meals.addRecipeName')}
              className="w-full input-apple"
            />
          </div>

          <RecipePicker value={recipe?.id ?? null} onChange={handleRecipeChange} initialRecipe={initial?.recipe ?? null} />
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
            <label htmlFor={`${titleId}-notes`} className="text-subhead text-label-secondary mb-1 block">{t('meals.addNotes')}</label>
            <textarea
              id={`${titleId}-notes`}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={t('meals.addNotes')}
              className="w-full input-apple resize-none"
              rows={2}
            />
          </div>

          <div className="flex gap-2 pt-2">
            {mode === 'edit' && onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="btn-destructive flex-1 min-h-[44px]"
                disabled={saving}
              >
                {t('meals.deleteMeal')}
              </button>
            )}
            <button type="submit" className="btn-tinted flex-1 min-h-[44px]" disabled={saving}>
              {saving ? t('common.saving') : t('meals.save')}
            </button>
          </div>
        </form>

        {/* Only for the saved link: after the picker changes, the add would use
            the old recipe, so the action waits until the new choice is saved. */}
        {mode === 'edit' && initial?.id && initial.recipe_id && (recipe?.id ?? null) === initial.recipe_id && (
          <AddToGroceriesButton recipeId={initial.recipe_id} mealId={initial.id} />
        )}
      </div>
    </div>
  )
}

export default function MealsPage() {
  return (
    <FeatureGate featureKey="meals">
      <MealsPageInner />
    </FeatureGate>
  )
}

function MealsPageInner() {
  const { t } = useTranslation()
  // Food inventory (#263) is a separate, opt-in feature; link to it when on.
  const inventoryOn = useFeatureEnabled('inventory')
  const [week, setWeek] = React.useState<DayPlan[]>(() => buildDayPlans([]))
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // Modal state
  const [modal, setModal] = React.useState<{
    mode: 'add' | 'edit'
    meal?: MealSlot
    defaultDate?: string
    defaultMealType?: MealType
  } | null>(null)
  const [saving, setSaving] = React.useState(false)
  const { addToast } = useToast()
  const showUndo = useUndoToast()

  const fetchMeals = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const dates = getWeekDates()
      const start = toDateOnlyLocal(dates[0])
      const endDate = new Date(dates[dates.length - 1])
      endDate.setDate(endDate.getDate() + 1)
      const end = toDateOnlyLocal(endDate)
      const res = await fetch(`/api/meals?start=${start}&end=${end}`)
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setWeek(buildDayPlans(data.meals ?? []))
    } catch {
      setError(t('meals.errorLoad'))
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    fetchMeals()
  }, [fetchMeals])

  const openAdd = (day: DayPlan, mealType: MealType) =>
    setModal({ mode: 'add', defaultDate: day.dateKey, defaultMealType: mealType })

  const openEdit = (meal: MealSlot) => setModal({ mode: 'edit', meal })

  const handleSave = async (data: MealSaveData) => {
    const editing = modal?.mode === 'edit' && modal.meal ? modal.meal : null
    // Keep the dialog open on failure and say why: the server's reason (for
    // example a validation message) or the offline line.
    const failTitle = editing ? "Couldn't save the meal" : "Couldn't add the meal"
    setSaving(true)
    try {
      const res = editing
        ? await fetch(`/api/meals/${editing.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: editing.id,
              date: data.date,
              meal_type: data.meal_type,
              recipe_name: data.recipe_name,
              notes: data.notes,
              ...(data.recipe_id !== undefined ? { recipe_id: data.recipe_id } : {}),
            }),
          })
        : await fetch('/api/meals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          })
      if (!res.ok) {
        addToast({ type: 'error', title: failTitle, message: await responseErrorMessage(res) })
        return
      }
      setModal(null)
      await fetchMeals()
    } catch {
      addToast({ type: 'error', title: failTitle, message: OFFLINE_MESSAGE })
    } finally {
      setSaving(false)
    }
  }

  // Undo over confirm (#269): delete at once, then offer Undo, which
  // re-creates the meal with the same day, slot, name, notes, cook, recipe and
  // servings (as a new row).
  const restoreMeal = async (meal: MealSlot) => {
    try {
      const res = await fetch('/api/meals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: toDateOnlyUTC(meal.date),
          meal_type: meal.meal_type,
          recipe_name: meal.recipe_name ?? '',
          ...(meal.notes ? { notes: meal.notes } : {}),
          ...(meal.cook_id ? { cook_id: meal.cook_id } : {}),
          ...(meal.recipe_id ?? meal.recipe?.id ? { recipe_id: meal.recipe_id ?? meal.recipe?.id } : {}),
          ...(typeof meal.servings === 'number' ? { servings: meal.servings } : {}),
        }),
      })
      if (!res.ok) throw new Error('Failed to restore')
      await fetchMeals()
    } catch {
      addToast({ type: 'error', title: `Couldn't put back ${mealTitle(meal)}`, message: 'Check your connection and try again.' })
    }
  }

  const handleDelete = async () => {
    if (!modal?.meal) return
    const meal = modal.meal
    setSaving(true)
    try {
      const res = await fetch(`/api/meals/${meal.id}?id=${meal.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      setModal(null)
      await fetchMeals()
      showUndo({ title: `Deleted ${mealTitle(meal)}`, onUndo: () => void restoreMeal(meal) })
    } catch (err) {
      console.error(err)
      addToast({ type: 'error', title: t('common.error'), message: 'The meal was not deleted. Try again.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-large-title font-display">{t('meals.title')}</h1>
          <p className="text-subhead text-label-secondary mt-0.5">{t('meals.subtitle')}</p>
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
          className="btn-tinted min-h-[44px]"
          onClick={() => setModal({ mode: 'add' })}
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          <span>{t('meals.addMeal')}</span>
        </button>
      </div>

      {/* Week section */}
      <section aria-labelledby="meals-week-heading">
        <h2 id="meals-week-heading" className="section-header">This week</h2>

        {loading ? (
          <div className="space-y-3" role="status" aria-label={t('meals.loading')}>
            {[0, 1, 2].map(i => (
              <div key={i} className="card-apple overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[var(--surface-separator)]">
                  <Skeleton className="h-4 w-32" />
                </div>
                <div className="divide-y divide-[var(--surface-separator)]">
                  {[0, 1, 2].map(j => (
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
            title={t('meals.errorLoad')}
            description="Check your connection and try again."
            action={
              <button type="button" className="btn-tinted min-h-[44px]" onClick={fetchMeals}>
                Try again
              </button>
            }
          />
        ) : (
          <div className="space-y-3 stagger">
            {week.map(day => (
              <DayCard key={day.dateKey} day={day} onAdd={openAdd} onEdit={openEdit} />
            ))}
          </div>
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
          onDelete={modal.mode === 'edit' ? handleDelete : undefined}
          onClose={() => setModal(null)}
          saving={saving}
        />
      )}
    </div>
  )
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
  day: DayPlan
  onAdd: (day: DayPlan, type: MealType) => void
  onEdit: (meal: MealSlot) => void
}) {
  const headingId = `meals-day-${day.dateKey}`
  return (
    <section
      aria-labelledby={headingId}
      data-testid="meal-day"
      data-day={day.dateKey}
      className={cn('card-apple overflow-hidden', day.isToday && 'ring-2 ring-[var(--accent)] ring-offset-2')}
    >
      {/* Day header */}
      <div
        className={cn(
          'px-4 py-2.5 flex items-center gap-2 border-b border-[var(--surface-separator)]',
          day.isToday ? 'bg-[var(--accent-tint)]' : 'bg-[var(--surface-fill)]'
        )}
      >
        <UtensilsCrossed
          className={cn('w-4 h-4', day.isToday ? 'text-[var(--accent)]' : 'text-label-tertiary')}
          aria-hidden="true"
        />
        <h3
          id={headingId}
          className={cn('text-subhead font-semibold', day.isToday ? 'text-[var(--accent-text)]' : 'text-label-primary')}
        >
          {day.isToday ? <span>Today<span className="sr-only">, {day.longLabel}</span></span> : day.label}
        </h3>
      </div>

      {/* Meal slots */}
      <ul className="divide-y divide-[var(--surface-separator)]">
        {day.slots.map(slot => {
          const label = mealLabels[slot.type]
          const glyph = (
            <span className="w-8 h-8 shrink-0 rounded-full bg-[var(--tint-meals)]/10 flex items-center justify-center">
              <MealIcon type={slot.type} />
            </span>
          )
          if (slot.meals.length === 0) {
            return (
              <li key={slot.type} data-testid="meal-slot" data-meal-type={slot.type}>
                <button
                  type="button"
                  onClick={() => onAdd(day, slot.type)}
                  aria-label={`Add ${label.toLowerCase()}, ${day.longLabel}`}
                  className="w-full flex items-center gap-3 px-4 py-2.5 min-h-[52px] text-left active:bg-[var(--surface-fill-secondary)]"
                >
                  {glyph}
                  <span className="flex-1 min-w-0">
                    <span className="block text-body text-label-primary">{label}</span>
                    <span className="block text-footnote text-label-secondary">Nothing planned</span>
                  </span>
                  <Plus className="w-5 h-5 shrink-0 text-label-tertiary" aria-hidden="true" />
                </button>
              </li>
            )
          }
          return slot.meals.map((meal, i) => {
            const isLast = i === slot.meals.length - 1
            const meta = recipeMeta(meal.recipe)
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
                    <span className="block text-body text-label-primary break-words">{mealTitle(meal)}</span>
                    <span className="block text-footnote text-label-secondary break-words">
                      {meta ? `${label} · ${meta}` : label}
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 shrink-0 text-label-tertiary" aria-hidden="true" />
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
            )
          })
        })}
      </ul>
    </section>
  )
}
