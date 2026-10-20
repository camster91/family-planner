"use client";
import { useTranslation } from "@/i18n";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
import { ReviewedDescriptionDraft } from "@/components/capture/ReviewedDescriptionDraft";
import {
  describeFood,
  type FoodDescriptionDraft as Draft,
} from "@/lib/food-description";
const messages = {
  en: {
    title: "Describe food",
    label: "Food description",
    example: "e.g. Add 2 cans of beans to the pantry",
    hint: "One food at a time. Use an explicit date label and YYYY-MM-DD if including a date. Amounts and units are not converted.",
    manual:
      "This description needs manual review. Try one food with a clear quantity, or use the fields below. Relative or ambiguous dates are not guessed.",
    review:
      "Suggested fields — check them before applying. Only shown fields change; check existing amounts, storage and dates before saving.",
    name: "Name",
    amount: "Amount",
    location: "Storage",
    best_before: "Best before",
    use_by: "Use by",
    fridge: "Fridge",
    freezer: "Freezer",
    pantry: "Pantry",
  },
  es: {
    title: "Describir alimento",
    label: "Descripción del alimento",
    example: "p. ej. Añade 2 latas de frijoles a la despensa",
    hint: "Un alimento cada vez. Indica el tipo de fecha y AAAA-MM-DD si incluyes una fecha. No se convierten cantidades ni unidades.",
    manual:
      "Esta descripción necesita revisión manual. Prueba un alimento con una cantidad clara o usa los campos de abajo. No se adivinan fechas relativas ni ambiguas.",
    review:
      "Campos sugeridos: revísalos antes de aplicar. Solo cambian los campos mostrados; comprueba las cantidades, el almacenamiento y las fechas existentes antes de guardar.",
    name: "Nombre",
    amount: "Cantidad",
    location: "Almacenamiento",
    best_before: "Consumo preferente",
    use_by: "Caducidad",
    fridge: "Nevera",
    freezer: "Congelador",
    pantry: "Despensa",
  },
};
export function FoodDescriptionDraft({
  enabled,
  contextKey,
  onApply,
}: {
  enabled: boolean;
  contextKey: string;
  onApply: (draft: Draft) => void;
}) {
  const { locale } = useTranslation(),
    c = messages[locale === "es" ? "es" : "en"];
  const language = useDisplayLocale();
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
      testId="food-description-draft"
      parse={(text) => describeFood(text, locale === "es" ? "es" : "en")}
      onApply={onApply}
      renderFields={(draft) => (
        <dl className="grid grid-cols-1 gap-2 text-subhead sm:grid-cols-2">
          <div>
            <dt className="text-label-secondary">{c.name}</dt>
            <dd className="break-words">{draft.name}</dd>
          </div>
          {draft.amount !== undefined && (
            <div>
              <dt className="text-label-secondary">{c.amount}</dt>
              <dd>
                {new Intl.NumberFormat(language).format(draft.amount)}{" "}
                {draft.unit ?? ""}
              </dd>
            </div>
          )}
          {draft.location && (
            <div>
              <dt className="text-label-secondary">{c.location}</dt>
              <dd>{c[draft.location]}</dd>
            </div>
          )}
          {draft.expires_on && draft.date_kind && (
            <div>
              <dt className="text-label-secondary">{c[draft.date_kind]}</dt>
              <dd>{draft.expires_on}</dd>
            </div>
          )}
        </dl>
      )}
    />
  );
}
