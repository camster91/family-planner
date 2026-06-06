'use client'

import * as React from 'react'
import { Plus, UtensilsCrossed, Coffee, Sun, Moon } from 'lucide-react'
import { CheckboxRow } from '@/components/ui/checkbox-row'
import { FeatureGate } from '@/components/ui/feature-gate'
import { cn } from '@/lib/utils'

type MealType = 'breakfast' | 'lunch' | 'dinner'

interface MealSlot {
  id: string
  type: MealType
  name: string
  done: boolean
}

interface DayPlan {
  date: Date
  label: string
  isToday: boolean
  meals: MealSlot[]
}

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
      meals: [
        { id: `${i}-breakfast`, type: 'breakfast', name: '', done: false },
        { id: `${i}-lunch`, type: 'lunch', name: '', done: false },
        { id: `${i}-dinner`, type: 'dinner', name: '', done: false },
      ],
    })
  }
  return days
}

const MealIcon = ({ type }: { type: MealType }) => {
  if (type === 'breakfast') return <Coffee className="w-4 h-4 text-[var(--tint-meals)]" />
  if (type === 'lunch') return <Sun className="w-4 h-4 text-[var(--tint-meals)]" />
  return <Moon className="w-4 h-4 text-[var(--tint-meals)]" />
}

const mealLabels: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
}

export default function MealsPage() {
  return (
    <FeatureGate featureKey="meals">
      <MealsPageInner />
    </FeatureGate>
  )
}

function MealsPageInner() {
  const [week, setWeek] = React.useState<DayPlan[]>(getWeekDays)

  const toggleMeal = (dayIndex: number, mealId: string) => {
    setWeek(prev => prev.map((day, di) => {
      if (di !== dayIndex) return day
      return {
        ...day,
        meals: day.meals.map(m => m.id === mealId ? { ...m, done: !m.done } : m),
      }
    }))
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-large-title font-display">Meals</h1>
          <p className="text-subhead text-label-secondary mt-0.5">Plan your week&apos;s meals</p>
        </div>
        <button
          type="button"
          className="btn-tinted"
          aria-label="Add meal plan"
        >
          <Plus className="w-4 h-4" />
          <span>Add Meal</span>
        </button>
      </div>

      {/* Week section */}
      <div>
        <div className="section-header">This week</div>
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
                  <span className="ml-1 text-caption-1 font-medium text-[var(--accent)] bg-[var(--accent)] text-white px-1.5 py-0.5 rounded-full">
                    Today
                  </span>
                )}
              </div>

              {/* Meal slots */}
              <div className="divide-y divide-[var(--surface-separator)]">
                {day.meals.map((meal) => (
                  <CheckboxRow
                    key={meal.id}
                    checked={meal.done}
                    onChange={() => toggleMeal(dayIndex, meal.id)}
                    title={meal.name || `${mealLabels[meal.type]} — tap to add`}
                    subtitle={meal.name ? mealLabels[meal.type] : undefined}
                    glyph={
                      <div className="w-8 h-8 rounded-full bg-[var(--tint-meals)]/10 flex items-center justify-center">
                        <MealIcon type={meal.type} />
                      </div>
                    }
                    meta={day.isToday ? mealLabels[meal.type] : undefined}
                    className="py-2.5 min-h-[48px]"
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}