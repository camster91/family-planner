"use client";
import * as React from "react";
import { useTranslation } from "@/i18n";
import { formatRecipeAmount } from "@/lib/recipe-scaling";
import type { FoodReviewView } from "@/lib/food-planning/view-contract";
/** Display the command that will actually be signed/saved, not editor leftovers. */
export function FoodSaveDetails({
  review,
  choiceKey,
}: {
  review: FoodReviewView;
  choiceKey: string;
}) {
  const { locale } = useTranslation(),
    es = locale === "es",
    copy = (en: string, spanish: string) => (es ? spanish : en);
  const command = review.input;
  const cook = (id: string | null | undefined) =>
    id
      ? (review.people.find((person) => person.id === id)?.name ??
        copy("Unavailable cook", "Cocinero no disponible"))
      : copy("No cook assigned", "Sin cocinero asignado");
  const groceries = review.groceries.find((row) => row.key === choiceKey);
  let body: React.ReactNode;
  if (command.mode === "meals") {
    const meal = command.meals.find((row) => row.key === choiceKey)?.input;
    if (!meal) return null;
    body = (
      <>
        <p>
          {meal.date} ·{" "}
          {meal.meal_type === "breakfast"
            ? copy("Breakfast", "Desayuno")
            : meal.meal_type === "lunch"
              ? copy("Lunch", "Almuerzo")
              : meal.meal_type === "snack"
                ? copy("Snack", "Tentempié")
                : copy("Dinner", "Cena")}
        </p>
        <p>{cook(meal.cook_id)}</p>
        {meal.recipe_name && (
          <p className="break-words">
            {copy("Saved label", "Nombre guardado")}: {meal.recipe_name}
          </p>
        )}
        {meal.notes && (
          <details>
            <summary className="min-h-[44px] py-3 cursor-pointer">
              {copy("Notes to save", "Notas que se guardarán")}
            </summary>
            <p className="whitespace-pre-wrap break-words">{meal.notes}</p>
          </details>
        )}
      </>
    );
  } else {
    const index = command.dishKeys.indexOf(choiceKey),
      dish = command.input.dishes[index];
    if (!dish) return null;
    body = (
      <>
        <p className="font-semibold break-words">{dish.name}</p>
        <p>
          {cook(dish.cook_id)} ·{" "}
          {dish.reserve_storage === "freezer"
            ? copy("Freezer", "Congelador")
            : copy("Fridge", "Nevera")}
        </p>
        <p>
          {copy("Prep day", "Día de preparación")}: {command.input.prepared_on}{" "}
          · {copy("Next prep", "Próxima preparación")}:{" "}
          {command.input.next_prep_on ?? copy("Not set", "Sin fecha")}
        </p>
        <details>
          <summary className="min-h-[44px] py-3 cursor-pointer">
            {dish.meals.length}{" "}
            {copy("meal allocations to create", "comidas que se crearán")}
          </summary>
          <DetailRows
            values={dish.meals.map((meal, i) => (
              <li key={i} className="space-y-1 break-words">
                <p>
                  {meal.date} · {meal.meal_type} · {meal.servings}{" "}
                  {copy("portions", "porciones")}
                </p>
                <p>
                  {cook(
                    meal.cook_id !== undefined ? meal.cook_id : dish.cook_id,
                  )}
                </p>
                {meal.notes && (
                  <p className="whitespace-pre-wrap">{meal.notes}</p>
                )}
              </li>
            ))}
            es={es}
          />
        </details>
      </>
    );
  }
  return (
    <section className="space-y-2 border-t border-[var(--surface-separator)] pt-3">
      <h4 className="font-semibold">
        {copy("Exact save details", "Detalles exactos que se guardarán")}
      </h4>
      {body}
      {groceries && (
        <details>
          <summary className="min-h-[44px] py-3 cursor-pointer">
            {copy("Grocery add", "Añadir a la compra")}:{" "}
            {review.lists.find((list) => list.id === groceries.listId)?.name}
          </summary>
          <p className="text-footnote">
            {copy(
              "Full scaled recipe quantities, not estimated shortages.",
              "Cantidades completas de receta, no déficits estimados.",
            )}
          </p>
          <DetailRows
            values={groceries.ingredients.map((line) => (
              <li key={line.ingredientId} className="break-words">
                {line.name} ·{" "}
                {formatRecipeAmount(line.amount, line.unit, locale)}
              </li>
            ))}
            es={es}
          />
        </details>
      )}
    </section>
  );
}
function DetailRows({
  values,
  es,
}: {
  values: React.ReactNode[];
  es: boolean;
}) {
  const [page, setPage] = React.useState(0),
    last = Math.max(0, Math.ceil(values.length / 5) - 1),
    current = Math.min(page, last);
  return (
    <div className="space-y-2">
      <ul className="space-y-3">
        {values.slice(current * 5, current * 5 + 5)}
      </ul>
      {last > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary min-h-[44px]"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            {es ? "Anteriores" : "Previous details"}
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
            {es ? "Siguientes" : "Next details"}
          </button>
        </div>
      )}
    </div>
  );
}
