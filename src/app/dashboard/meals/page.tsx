'use client'

import * as React from 'react'
import { Plus, UtensilsCrossed, Coffee, Sun, Moon, X } from 'lucide-react'
import { CheckboxRow } from '@/components/ui/checkbox-row'
import { FeatureGate } from '@/components/ui/feature-gate'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'

type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'

interface MealSlot {
  id: string
  type: MealType
  recipe_name: string
  notes?: string | null
  cook_id?: string | null
  date: string
}

interface DayPlan {
  date: Date
  label: string
  isToday: boolean
  meals: (MealSlot | null)[]
}

const MealIcon = ({ type }: { type: MealType }) => {
  if (type === 'breakfast') return <Coffee className="w-4 h-4 text-[var(--tint-meals)]" />
  if (type === 'lunch') return <Sun className="w-4 h-4 text-[var(--tint-meals)]" />
  if (type === 'dinner') return <Moon className="w-4 h-4 text-[var(--tint-meals)]" />
  return <Moon className="w-4 h-4 text-[var(--tint-meals)]" />
}

const mealLabels: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
}

const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack']

function getWeekDays(): DayPlan[] {
  const days: DayPlan[] = []
  const today = new Date()

  for (let i = 0; i < 7; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    const isToday = i === 0

    const label = isToday
      ? 'Today'
      : d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })

    days.push({
      date: d,
      label,
      isToday,
      meals: [null, null, null],
    })
  }
  return days
}

function buildDayPlans(meals: MealSlot[]): DayPlan[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const days: DayPlan[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    const isToday = i === 0

    const label = isToday
      ? 'Today'
      : d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })

    const dayMeals = meals
      .filter(m => {
        const mDate = new Date(m.date)
        mDate.setHours(0, 0, 0, 0)
        return mDate.getTime() === d.getTime()
      })
      .sort((a, b) => {
        const order = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 }
        return (order[a.type as MealType] ?? 99) - (order[b.type as MealType] ?? 99)
      })

    const slots: (MealSlot | null)[] = []
    for (const type of MEAL_TYPES) {
      const found = dayMeals.find(m => m.type === type)
      slots.push(found ?? null)
    }

    days.push({ date: d, label, isToday, meals: slots })
  }
  return days
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
  onSave: (data: { date: string; meal_type: MealType; recipe_name: string; notes?: string }) => void
  onDelete?: () => void
  onClose: () => void
  saving: boolean
}) {
  const { t } = useTranslation()
  const [date, setDate] = React.useState(initial?.date?.split('T')[0] ?? defaultDate ?? new Date().toISOString().split('T')[0])
  const [meal_type, setMealType] = React.useState<MealType>(initial?.type ?? defaultMealType ?? 'dinner')
  const [recipe_name, setRecipeName] = React.useState(initial?.recipe_name ?? '')
  const [notes, setNotes] = React.useState(initial?.notes ?? '')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({ date, meal_type, recipe_name, notes: notes || undefined })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-[var(--surface-primary)] rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-title-3 font-display text-label-primary">
            {mode === 'add' ? t('meals.addMeal') : recipe_name || mealLabels[meal_type]}
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-full active:bg-[var(--surface-fill)]">
            <X className="w-5 h-5 text-label-tertiary" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-subhead text-label-secondary mb-1 block">{t('dashboard.due')}</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full input-apple"
              required
            />
          </div>

          <div>
            <label className="text-subhead text-label-secondary mb-1 block">Meal</label>
            <select
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
            <label className="text-subhead text-label-secondary mb-1 block">{t('meals.addRecipeName')}</label>
            <input
              type="text"
              value={recipe_name}
              onChange={e => setRecipeName(e.target.value)}
              placeholder={t('meals.addRecipeName')}
              className="w-full input-apple"
            />
          </div>

          <div>
            <label className="text-subhead text-label-secondary mb-1 block">{t('meals.addNotes')}</label>
            <textarea
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
                className="btn-destructive flex-1"
                disabled={saving}
              >
                {t('meals.deleteMeal')}
              </button>
            )}
            <button type="submit" className="btn-tinted flex-1" disabled={saving}>
              {saving ? t('common.saving') : t('meals.save')}
            </button>
          </div>
        </form>
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
  const [week, setWeek] = React.useState<DayPlan[]>(getWeekDays)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [meals, setMeals] = React.useState<MealSlot[]>([])

  // Modal state
  const [modal, setModal] = React.useState<{
    mode: 'add' | 'edit'
    meal?: MealSlot
    defaultDate?: string
    defaultMealType?: MealType
  } | null>(null)
  const [saving, setSaving] = React.useState(false)

  const fetchMeals = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/meals')
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setMeals(data.meals ?? [])
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

  const handleRowClick = (dayIndex: number, mealType: MealType, meal: MealSlot | null) => {
    if (meal) {
      setModal({ mode: 'edit', meal: { ...meal, type: mealType } })
    } else {
      const day = week[dayIndex]
      const dateStr = day.date.toISOString().split('T')[0]
      setModal({ mode: 'add', defaultDate: dateStr, defaultMealType: mealType })
    }
  }

  const handleSave = async (data: { date: string; meal_type: MealType; recipe_name: string; notes?: string }) => {
    setSaving(true)
    try {
      if (modal?.mode === 'edit' && modal.meal) {
        const res = await fetch(`/api/meals/${modal.meal.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: modal.meal.id,
            recipe_name: data.recipe_name,
            notes: data.notes,
          }),
        })
        if (!res.ok) throw new Error('Failed to update')
      } else {
        const res = await fetch('/api/meals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
        if (!res.ok) throw new Error('Failed to create')
      }
      setModal(null)
      await fetchMeals()
    } catch (err) {
      console.error(err)
      alert(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!modal?.meal) return
    if (!confirm(t('common.confirm'))) return
    setSaving(true)
    try {
      const res = await fetch(`/api/meals/${modal.meal.id}?id=${modal.meal.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      setModal(null)
      await fetchMeals()
    } catch (err) {
      console.error(err)
      alert(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-large-title font-display">{t('meals.title')}</h1>
          <p className="text-subhead text-label-secondary mt-0.5">{t('meals.subtitle')}</p>
        </div>
        <button
          type="button"
          className="btn-tinted"
          onClick={() => setModal({ mode: 'add' })}
          aria-label={t('meals.addMeal')}
        >
          <Plus className="w-4 h-4" />
          <span>{t('meals.addMeal')}</span>
        </button>
      </div>

      {/* Week section */}
      <div>
        <div className="section-header">This week</div>

        {loading ? (
          <div className="space-y-3">
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
            description={error}
            action={
              <button className="btn-tinted" onClick={fetchMeals}>
                {t('common.loading')}
              </button>
            }
          />
        ) : (
          <div className="space-y-3 stagger">
            {week.map((day, dayIndex) => (
              <div
                key={day.date.toISOString()}
                className={cn(
                  'card-apple overflow-hidden',
                  day.isToday && 'ring-2 ring-[var(--accent)] ring-offset-2'
                )}
              >
                {/* Day header */}
                <div
                  className={cn(
                    'px-4 py-2.5 flex items-center gap-2 border-b border-[var(--surface-separator)]',
                    day.isToday ? 'bg-[var(--accent-tint)]' : 'bg-[var(--surface-fill)]'
                  )}
                >
                  <UtensilsCrossed className={cn(
                    'w-4 h-4',
                    day.isToday ? 'text-[var(--accent)]' : 'text-label-tertiary'
                  )} />
                  <span className={cn(
                    'text-subhead font-semibold',
                    day.isToday ? 'text-[var(--accent)]' : 'text-label-primary'
                  )}>
                    {day.label}
                  </span>
                  {day.isToday && (
                    <span className="ml-1 text-caption-1 font-medium text-[var(--accent)] bg-[var(--accent-fill)] text-white px-1.5 py-0.5 rounded-full">
                      Today
                    </span>
                  )}
                </div>

                {/* Meal slots */}
                <div className="divide-y divide-[var(--surface-separator)]">
                  {MEAL_TYPES.map((type, typeIndex) => {
                    const meal = day.meals[typeIndex]
                    const done = !!meal?.recipe_name
                    const title = meal?.recipe_name
                      ? meal.recipe_name
                      : `— ${t('meals.empty')}`
                    const subtitle = meal?.recipe_name ? mealLabels[type] : undefined

                    return (
                      <CheckboxRow
                        key={type}
                        checked={done}
                        onChange={() => handleRowClick(dayIndex, type, meal)}
                        title={title}
                        subtitle={subtitle}
                        glyph={
                          <div className="w-8 h-8 rounded-full bg-[var(--tint-meals)]/10 flex items-center justify-center">
                            <MealIcon type={type} />
                          </div>
                        }
                        meta={day.isToday ? mealLabels[type] : undefined}
                        className="py-2.5 min-h-[48px]"
                      />
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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