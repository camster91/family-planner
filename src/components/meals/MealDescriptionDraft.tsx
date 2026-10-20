"use client";
import { useTranslation } from "@/i18n";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
import { ReviewedDescriptionDraft } from "@/components/capture/ReviewedDescriptionDraft";
import {
  describeMeal,
  type MealDescriptionDraft as Draft,
} from "@/lib/meal-description";
const messages = {
  en: {
    title: "Describe a meal",
    label: "Meal description",
    example: "e.g. Plan tacos for dinner on 2027-10-21 for 4 people",
    hint: "One planned meal. Use YYYY-MM-DD for a day and a number for servings. A missing day, meal type or portion count keeps the form's current value. No recipe or cook is chosen by name.",
    manual:
      "Review this description manually. Use one meal, an explicit YYYY-MM-DD day and a clear number of people, or use the fields below. Relative dates are not guessed.",
    review:
      "Check the suggested fields before applying. This fills a free-text plan only; it does not mark a meal cooked/eaten, change stock or link a saved recipe.",
    name: "Meal name",
    date: "Day",
    meal: "Meal",
    servings: "Servings",
    breakfast: "Breakfast",
    lunch: "Lunch",
    dinner: "Dinner",
    snack: "Snack",
  },
  es: {
    title: "Describir una comida",
    label: "Descripción de la comida",
    example:
      "p. ej. Planifica tacos para la cena el 2027-10-21 para 4 personas",
    hint: "Una comida planificada. Usa AAAA-MM-DD para el día y un número para las porciones. Si faltan el día, el tipo o las porciones, se conserva el valor del formulario. No se elige una receta ni un cocinero por nombre.",
    manual:
      "Revisa esta descripción a mano. Usa una comida, un día explícito AAAA-MM-DD y un número claro de personas, o los campos de abajo. No se adivinan fechas relativas.",
    review:
      "Comprueba los campos sugeridos antes de aplicar. Solo rellena un plan de texto; no marca la comida como preparada o consumida, no cambia el inventario ni vincula una receta guardada.",
    name: "Nombre de la comida",
    date: "Día",
    meal: "Comida",
    servings: "Porciones",
    breakfast: "Desayuno",
    lunch: "Almuerzo",
    dinner: "Cena",
    snack: "Merienda",
  },
};
export function MealDescriptionDraft({
  enabled,
  contextKey,
  onApply,
}: {
  enabled: boolean;
  contextKey: string;
  onApply: (draft: Draft) => void;
}) {
  const { locale } = useTranslation(),
    c = messages[locale === "es" ? "es" : "en"],
    language = useDisplayLocale();
  return (
    <ReviewedDescriptionDraft
      enabled={enabled}
      contextKey={contextKey}
      title={c.title}
      label={c.label}
      placeholder={c.example}
      hint={c.hint}
      manual={c.manual}
      review={c.review}
      testId="meal-description-draft"
      parse={describeMeal}
      onApply={onApply}
      renderFields={(draft) => (
        <dl className="grid grid-cols-1 gap-2 text-subhead sm:grid-cols-2">
          <div>
            <dt className="text-label-secondary">{c.name}</dt>
            <dd className="break-words">{draft.recipe_name}</dd>
          </div>
          {draft.date && (
            <div>
              <dt className="text-label-secondary">{c.date}</dt>
              <dd>{draft.date}</dd>
            </div>
          )}
          {draft.meal_type && (
            <div>
              <dt className="text-label-secondary">{c.meal}</dt>
              <dd>{c[draft.meal_type]}</dd>
            </div>
          )}
          {draft.servings !== undefined && (
            <div>
              <dt className="text-label-secondary">{c.servings}</dt>
              <dd>{new Intl.NumberFormat(language).format(draft.servings)}</dd>
            </div>
          )}
        </dl>
      )}
    />
  );
}
