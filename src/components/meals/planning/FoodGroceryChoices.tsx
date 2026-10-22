"use client";
import * as React from "react";
import { useTranslation } from "@/i18n";
import { formatRecipeAmount } from "@/lib/recipe-scaling";
import type { FoodCandidate } from "@/lib/food-planning/contract";
import type { FoodEditorDraft } from "@/lib/food-planning/editor";
import type { FoodRecoveryContext } from "@/lib/food-planning/recovery-contract";
import { FoodRecordPicker } from "./FoodRecordPicker";
type Selection = FoodEditorDraft["groceries"][number];
export function FoodGroceryChoices({
  choice,
  selection,
  context,
  disabled,
  onChange,
  onFailure,
}: {
  choice: FoodCandidate;
  selection: Selection;
  context: FoodRecoveryContext;
  disabled: boolean;
  onChange: (value: Selection) => void;
  onFailure: (error: unknown) => void;
}) {
  const { locale } = useTranslation(),
    es = locale === "es",
    [page, setPage] = React.useState(0),
    last = Math.max(0, Math.ceil(choice.ingredients.length / 5) - 1),
    current = Math.min(page, last);
  return (
    <details>
      <summary className="min-h-[44px] py-3 cursor-pointer font-semibold">
        {es
          ? "Añadir ingredientes a la compra (opcional)"
          : "Add ingredients to groceries (optional)"}{" "}
        · {selection.ingredientIds.length}
      </summary>
      <div className="space-y-3">
        <p className="text-footnote text-label-secondary">
          {es
            ? "No se añade nada por defecto. Selecciona ingredientes y una lista. Se usan cantidades completas de receta, no déficits estimados; revisa las cantidades exactas antes de guardar."
            : "Nothing is added by default. Select ingredients and a list. Adds use full recipe quantities, not estimated shortfalls; review exact amounts before saving."}
        </p>
        <FoodRecordPicker
          kind="lists"
          label={es ? "Lista de destino" : "Target list"}
          emptyLabel={es ? "Elegir lista" : "Choose a list"}
          values={selection.listId ? [selection.listId] : []}
          context={context}
          disabled={disabled}
          onFailure={onFailure}
          onChange={(ids) => onChange({ ...selection, listId: ids[0] ?? "" })}
        />
        {selection.ingredientIds.length > 0 && !selection.listId && (
          <p role="status">
            {es
              ? "Elige una lista antes de revisar el guardado."
              : "Choose a list before reviewing the save."}
          </p>
        )}
        <ul className="space-y-2">
          {choice.ingredients
            .slice(current * 5, current * 5 + 5)
            .map((line) => (
              <li key={line.ingredientId}>
                <label className="flex min-h-[44px] items-center gap-3 break-words">
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={selection.ingredientIds.includes(
                      line.ingredientId,
                    )}
                    onChange={(event) =>
                      onChange({
                        ...selection,
                        ingredientIds: event.target.checked
                          ? [...selection.ingredientIds, line.ingredientId]
                          : selection.ingredientIds.filter(
                              (id) => id !== line.ingredientId,
                            ),
                      })
                    }
                  />
                  <span>
                    {line.name} ·{" "}
                    {line.required === null
                      ? es
                        ? "cantidad por revisar"
                        : "amount to review"
                      : formatRecipeAmount(line.required, line.unit, locale)}
                  </span>
                </label>
              </li>
            ))}
        </ul>
        {last > 0 && (
          <div className="flex justify-between gap-2">
            <button
              type="button"
              className="btn-secondary min-h-[44px]"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              {es ? "Anteriores" : "Previous ingredients"}
            </button>
            <span aria-live="polite">
              {current + 1}/{last + 1}
            </span>
            <button
              type="button"
              className="btn-secondary min-h-[44px]"
              disabled={current === last}
              onClick={() => setPage(current + 1)}
            >
              {es ? "Siguientes" : "Next ingredients"}
            </button>
          </div>
        )}
      </div>
    </details>
  );
}
