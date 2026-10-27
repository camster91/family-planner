"use client";
import * as React from "react";
import { useFoodPlanningInputsText } from "@/i18n/food-planning-inputs";
import type { FoodEditorSlot } from "@/lib/food-planning/editor";
import type { FoodRecoveryContext } from "@/lib/food-planning/recovery-contract";
import { FoodRecordPicker } from "./FoodRecordPicker";
const field = "input-apple min-h-[44px] w-full";
export function FoodAllocationEditor({
  slot,
  prepDay,
  context,
  disabled,
  onChange,
  onFailure,
}: {
  slot: FoodEditorSlot;
  prepDay: string;
  context: FoodRecoveryContext;
  disabled: boolean;
  onChange: (allocations: FoodEditorSlot["allocations"]) => void;
  onFailure: (error: unknown) => void;
}) {
  const text = useFoodPlanningInputsText();
  const [page, setPage] = React.useState(0),
    index = Math.min(page, Math.max(0, slot.allocations.length - 1)),
    value = slot.allocations[index];
  const quantitiesKnown = slot.allocations.every(
      (row) => /^\d+$/.test(row.servings) && Number(row.servings) > 0,
    ),
    planned = quantitiesKnown
      ? slot.allocations.reduce((sum, row) => sum + Number(row.servings), 0)
      : null;
  const patch = (next: Partial<NonNullable<typeof value>>) =>
    onChange(
      slot.allocations.map((row, i) =>
        i === index ? { ...row, ...next } : row,
      ),
    );
  return (
    <details>
      <summary className="min-h-[44px] py-3 cursor-pointer font-semibold">
        {text("planFromDish")}{" "}
        ({slot.allocations.length})
      </summary>
      <div className="space-y-3">
        <p className="text-footnote text-label-secondary">
          {text("portionsBoundary")}
        </p>
        <p>
          {text("plannedPortions")}:{" "}
          {planned ?? text("needsChecking")} /{" "}
          {slot.servings || text("needsChecking")}
        </p>
        {planned !== null &&
          /^\d+$/.test(slot.servings) &&
          planned > Number(slot.servings) && (
            <p role="status">
              {text("allocationsExceed")}
            </p>
          )}
        {value && (
          <>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="btn-secondary min-h-[44px]"
                disabled={disabled || index === 0}
                onClick={() => setPage(index - 1)}
              >
                {text("previousMeal")}
              </button>
              <span aria-live="polite">
                {index + 1}/{slot.allocations.length}
              </span>
              <button
                type="button"
                className="btn-secondary min-h-[44px]"
                disabled={disabled || index + 1 === slot.allocations.length}
                onClick={() => setPage(index + 1)}
              >
                {text("nextMeal")}
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                {text("mealDay")}
                <input
                  type="date"
                  className={field}
                  min={prepDay || undefined}
                  value={value.date}
                  disabled={disabled}
                  onChange={(event) => patch({ date: event.target.value })}
                />
              </label>
              <label>
                {text("meal")}
                <select
                  className={field}
                  value={value.mealType}
                  disabled={disabled}
                  onChange={(event) =>
                    patch({
                      mealType: event.target.value as typeof value.mealType,
                    })
                  }
                >
                  <option value="breakfast">
                    {text("breakfast")}
                  </option>
                  <option value="lunch">{text("lunch")}</option>
                  <option value="dinner">{text("dinner")}</option>
                  <option value="snack">{text("snack")}</option>
                </select>
              </label>
              <label>
                {text("portions")}
                <input
                  type="number"
                  className={field}
                  min="1"
                  max="50"
                  step="1"
                  value={value.servings}
                  disabled={disabled}
                  onChange={(event) => patch({ servings: event.target.value })}
                />
              </label>
            </div>
            <label className="flex min-h-[44px] items-center gap-2">
              <input
                type="checkbox"
                disabled={disabled}
                checked={value.inheritCook}
                onChange={(event) =>
                  patch({ inheritCook: event.target.checked })
                }
              />
              {text("inheritCook")}
            </label>
            {!value.inheritCook && (
              <FoodRecordPicker
                key={`${slot.key}-${index}`}
                kind="people"
                label={text("mealCook")}
                emptyLabel={text("noCook")}
                values={value.cookId ? [value.cookId] : []}
                context={context}
                disabled={disabled}
                onFailure={onFailure}
                onChange={(ids) => patch({ cookId: ids[0] ?? "" })}
              />
            )}
            <label>
              {text("mealNotes")}
              <textarea
                className={field}
                maxLength={2000}
                value={value.notes}
                disabled={disabled}
                onChange={(event) => patch({ notes: event.target.value })}
              />
            </label>
            <button
              type="button"
              className="btn-secondary min-h-[44px]"
              disabled={disabled}
              onClick={() =>
                onChange(slot.allocations.filter((_, i) => i !== index))
              }
            >
              {text("removeAllocation")}
            </button>
          </>
        )}
        <button
          type="button"
          className="btn-secondary min-h-[44px]"
          disabled={disabled || slot.allocations.length >= 14}
          onClick={() => {
            onChange([
              ...slot.allocations,
              {
                date: prepDay,
                mealType: "dinner",
                servings: "1",
                cookId: "",
                inheritCook: true,
                notes: "",
              },
            ]);
            setPage(slot.allocations.length);
          }}
        >
          {text("addAllocation")}
        </button>
      </div>
    </details>
  );
}
