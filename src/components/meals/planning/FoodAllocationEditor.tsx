"use client";
import * as React from "react";
import { useTranslation } from "@/i18n";
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
  const { locale } = useTranslation(),
    es = locale === "es",
    [page, setPage] = React.useState(0),
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
        {es ? "Planificar comidas con este plato" : "Plan meals from this dish"}{" "}
        ({slot.allocations.length})
      </summary>
      <div className="space-y-3">
        <p className="text-footnote text-label-secondary">
          {es
            ? "Planificar porciones no las marca como preparadas ni consumidas. Los ingredientes de todo el plato se cuentan una sola vez."
            : "Planning portions does not mark them prepared or eaten. Ingredients are counted once for the whole dish."}
        </p>
        <p>
          {es ? "Porciones planificadas" : "Planned portions"}:{" "}
          {planned ?? (es ? "por revisar" : "needs checking")} /{" "}
          {slot.servings || (es ? "por revisar" : "needs checking")}
        </p>
        {planned !== null &&
          /^\d+$/.test(slot.servings) &&
          planned > Number(slot.servings) && (
            <p role="status">
              {es
                ? "Las comidas superan las porciones totales. Ajusta el reparto antes de guardar."
                : "Allocations exceed the whole dish. Adjust portions before saving."}
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
                {es ? "Anterior" : "Previous meal"}
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
                {es ? "Siguiente" : "Next meal"}
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                {es ? "Día de la comida" : "Meal day"}
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
                {es ? "Comida" : "Meal"}
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
                    {es ? "Desayuno" : "Breakfast"}
                  </option>
                  <option value="lunch">{es ? "Almuerzo" : "Lunch"}</option>
                  <option value="dinner">{es ? "Cena" : "Dinner"}</option>
                  <option value="snack">{es ? "Tentempié" : "Snack"}</option>
                </select>
              </label>
              <label>
                {es ? "Porciones" : "Portions"}
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
              {es ? "Usar el cocinero del plato" : "Use this dish’s cook"}
            </label>
            {!value.inheritCook && (
              <FoodRecordPicker
                key={`${slot.key}-${index}`}
                kind="people"
                label={es ? "Cocinero de esta comida" : "Cook for this meal"}
                emptyLabel={es ? "Sin cocinero asignado" : "No cook assigned"}
                values={value.cookId ? [value.cookId] : []}
                context={context}
                disabled={disabled}
                onFailure={onFailure}
                onChange={(ids) => patch({ cookId: ids[0] ?? "" })}
              />
            )}
            <label>
              {es
                ? "Notas de esta comida (opcionales)"
                : "Meal notes (optional)"}
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
              {es ? "Quitar esta comida" : "Remove this meal allocation"}
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
          {es ? "Añadir comida planificada" : "Add planned meal"}
        </button>
      </div>
    </details>
  );
}
