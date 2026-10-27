"use client";
import * as React from "react";
import { useTranslation } from "@/i18n";
import { useFoodPlanningInputsText } from "@/i18n/food-planning-inputs";
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
  const { locale } = useTranslation();
  const text = useFoodPlanningInputsText();
  const mealLabel = (type: string) =>
    type === "breakfast"
      ? text("breakfast")
      : type === "lunch"
        ? text("lunch")
        : type === "snack"
          ? text("snack")
          : text("dinner");
  const command = review.input;
  const cook = (id: string | null | undefined) =>
    id
      ? (review.people.find((person) => person.id === id)?.name ??
        text("unavailableCook"))
      : text("noCook");
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
            ? text("breakfast")
            : meal.meal_type === "lunch"
              ? text("lunch")
              : meal.meal_type === "snack"
                ? text("snack")
                : text("dinner")}
        </p>
        <p>{cook(meal.cook_id)}</p>
        {meal.recipe_name && (
          <p className="break-words">
            {text("savedLabel")}: {meal.recipe_name}
          </p>
        )}
        {meal.notes && (
          <details>
            <summary className="min-h-[44px] py-3 cursor-pointer">
              {text("notesToSave")}
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
            ? text("freezer")
            : text("fridge")}
        </p>
        <p>
          {text("prepDay")}: {command.input.prepared_on}{" "}
          · {text("nextPrep")}:{" "}
          {command.input.next_prep_on ?? text("notSet")}
        </p>
        <details>
          <summary className="min-h-[44px] py-3 cursor-pointer">
            {dish.meals.length}{" "}
            {text("allocationsToCreate")}
          </summary>
          <DetailRows
            values={dish.meals.map((meal, i) => (
              <li key={i} className="space-y-1 break-words">
                <p>
                  {meal.date} · {mealLabel(meal.meal_type)} · {meal.servings}{" "}
                  {text("portions")}
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
          />
        </details>
      </>
    );
  }
  return (
    <section className="space-y-2 border-t border-[var(--surface-separator)] pt-3">
      <h4 className="font-semibold">
        {text("exactSaveDetails")}
      </h4>
      {body}
      {groceries && (
        <details>
          <summary className="min-h-[44px] py-3 cursor-pointer">
            {text("groceryAdd")}:{" "}
            {review.lists.find((list) => list.id === groceries.listId)?.name}
          </summary>
          <p className="text-footnote">
            {text("fullRecipeQuantities")}
          </p>
          <DetailRows
            values={groceries.ingredients.map((line) => (
              <li key={line.ingredientId} className="break-words">
                {line.name} ·{" "}
                {formatRecipeAmount(line.amount, line.unit, locale)}
              </li>
            ))}
          />
        </details>
      )}
    </section>
  );
}
function DetailRows({
  values,
}: {
  values: React.ReactNode[];
}) {
  const text = useFoodPlanningInputsText();
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
            {text("previousDetails")}
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
            {text("nextDetails")}
          </button>
        </div>
      )}
    </div>
  );
}
