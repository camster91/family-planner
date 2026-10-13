"use client";
import * as React from "react";
import { MEAL_TYPES, type MealType } from "@/lib/meal-slots";
import { useBulkCookingText } from "@/i18n/bulk-cooking";
import { parseDateOnly, toDateOnlyUTC } from "@/lib/dates";

export type AllocationDraft = {
  date: string;
  meal_type: MealType;
  servings: string;
};
export function MealAllocationEditor({
  meals,
  onChange,
  preparationDay,
  available,
  disabled = false,
}: {
  meals: AllocationDraft[];
  onChange: (value: AllocationDraft[]) => void;
  preparationDay: string;
  available: number;
  disabled?: boolean;
}) {
  const tBulk = useBulkCookingText();
  const prefix = React.useId();
  const [expanded, setExpanded] = React.useState<number | null>(null);
  const update = (index: number, change: Partial<AllocationDraft>) =>
    onChange(
      meals.map((row, i) => (i === index ? { ...row, ...change } : row)),
    );
  const planned = meals.reduce((n, row) => n + Number(row.servings), 0);
  return (
    <div className="space-y-3">
      <p className="text-subhead text-label-secondary" role="status">
        {tBulk("planned", { count: planned })} ·{" "}
        {tBulk("unplanned", { count: available - planned })}
      </p>
      {meals.length === 0 && (
        <p className="text-subhead text-label-secondary">{tBulk("noMeals")}</p>
      )}
      {meals.map((meal, index) => (
        <fieldset
          key={index}
          className="rounded-xl border border-[var(--surface-separator)] p-3 min-w-0"
        >
          <legend className="sr-only">
            {tBulk("mealType")} {index + 1}
          </legend>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={disabled}
              className="min-h-[44px] flex-1 min-w-0 text-left text-subhead break-words"
              aria-expanded={expanded === index}
              onClick={() => setExpanded(expanded === index ? null : index)}
            >
              {meal.date} · {tBulk(meal.meal_type)} · {meal.servings}
            </button>
            <button
              type="button"
              disabled={disabled}
              className="btn-tinted min-h-[44px]"
              aria-label={`${tBulk("removeMeal")} ${index + 1}`}
              onClick={() => {
                onChange(meals.filter((_, i) => i !== index));
                setExpanded(null);
              }}
            >
              {tBulk("removeMeal")}
            </button>
          </div>
          {expanded === index && (
            <div className="grid grid-cols-2 gap-3 mt-2">
              <label
                className="text-subhead col-span-2"
                htmlFor={`${prefix}-${index}-date`}
              >
                {tBulk("mealDate")} {index + 1}
                <input
                  id={`${prefix}-${index}-date`}
                  type="date"
                  className="input-field w-full mt-1"
                  value={meal.date}
                  min={preparationDay}
                  disabled={disabled}
                  required
                  onChange={(e) => update(index, { date: e.target.value })}
                />
              </label>
              <label
                className="text-subhead"
                htmlFor={`${prefix}-${index}-type`}
              >
                {tBulk("mealType")} {index + 1}
                <select
                  id={`${prefix}-${index}-type`}
                  className="input-field w-full mt-1"
                  value={meal.meal_type}
                  disabled={disabled}
                  onChange={(e) =>
                    update(index, { meal_type: e.target.value as MealType })
                  }
                >
                  {MEAL_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {tBulk(type)}
                    </option>
                  ))}
                </select>
              </label>
              <label
                className="text-subhead"
                htmlFor={`${prefix}-${index}-portions`}
              >
                {tBulk("mealPortions")} {index + 1}
                <input
                  id={`${prefix}-${index}-portions`}
                  type="number"
                  className="input-field w-full mt-1"
                  min={1}
                  max={available}
                  step={1}
                  value={meal.servings}
                  disabled={disabled}
                  required
                  onChange={(e) => update(index, { servings: e.target.value })}
                />
              </label>
            </div>
          )}
        </fieldset>
      ))}
      <button
        type="button"
        className="btn-tinted min-h-[44px]"
        disabled={disabled || meals.length >= 14 || planned >= available}
        onClick={() => {
          const next = parseDateOnly(meals.at(-1)?.date ?? preparationDay);
          if (!next) return;
          if (meals.length) next.setUTCDate(next.getUTCDate() + 1);
          onChange([
            ...meals,
            {
              date: toDateOnlyUTC(next),
              meal_type: "dinner",
              servings: String(Math.min(4, available - planned)),
            },
          ]);
          setExpanded(meals.length);
        }}
      >
        {tBulk("addMeal")}
      </button>
    </div>
  );
}
