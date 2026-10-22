"use client";
import * as React from "react";
import { foodAiLeaseCurrent } from "@/lib/food-planning/ai-evaluation";
import type { FoodAiSuggestion } from "@/lib/food-planning/ai-contract";
import { useTranslation } from "@/i18n";
import { FoodPlanSummary } from "./FoodPlanSummary";
/** Read suggestions stay separate from editable choices and signed save review. */
export function FoodAiProposal({
  suggestion,
  busy,
  onUse,
  onDismiss,
}: {
  suggestion: FoodAiSuggestion;
  busy: boolean;
  onUse: () => void;
  onDismiss: () => void;
}) {
  const { locale } = useTranslation(),
    es = locale === "es";
  const copy = (en: string, spanish: string) => (es ? spanish : en);
  const [leaseEnded, setLeaseEnded] = React.useState(false);
  React.useEffect(() => {
    setLeaseEnded(false);
    const timer = setTimeout(
      () => setLeaseEnded(true),
      Math.max(0, Date.parse(suggestion.original.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [suggestion.original.generatedAt, suggestion.original.expiresAt]);
  const expired = leaseEnded || !foodAiLeaseCurrent(suggestion.original);

  return (
    <section
      className="space-y-3"
      aria-label={copy("AI meal choices", "Opciones de comidas con IA")}
    >
      <h3 className="font-semibold">
        {copy("AI choices to review", "Opciones de IA para revisar")}
      </h3>
      <p className="text-footnote text-label-secondary">
        {copy(
          "Chosen from your saved household recipes. These are suggestions, not dietary or food-safety advice. Check your preferences and ingredient details. Nothing has been saved.",
          "Elegidas de las recetas guardadas de tu hogar. Son sugerencias, no consejos dietéticos ni de seguridad alimentaria. Revisa tus preferencias e ingredientes. Aún no se ha guardado nada.",
        )}
      </p>
      <p role="status">
        {suggestion.evaluation.heldSlots
          ? copy(
              `${suggestion.evaluation.heldSlots} choices need attention before saving.`,
              `${suggestion.evaluation.heldSlots} opciones necesitan revisión antes de guardar.`,
            )
          : copy(
              "Recorded checks found no holds. Review the details before saving.",
              "Las comprobaciones registradas no encontraron impedimentos. Revisa los detalles antes de guardar.",
            )}
      </p>
      {expired && (
        <p role="status">
          {copy(
            "These choices expired. Ask AI again or use Find suggestions. Your draft is kept.",
            "Estas opciones han caducado. Vuelve a preguntar a la IA o usa Buscar sugerencias. Se conserva el borrador.",
          )}
        </p>
      )}
      <FoodPlanSummary
        plan={suggestion.proposal.plan}
        mode={suggestion.proposal.sourceRequest.plan.mode}
        timeZone={suggestion.proposal.sourceRequest.plan.timeZone}
        busy={busy}
      />
      <p className="text-footnote text-label-secondary">
        {copy(
          "Use copies the recipes into your draft and refreshes the household checks. Grocery selections for changed recipes are cleared. Save still needs your separate review and confirmation. Suggestions expire after one minute.",
          "Usar copia las recetas al borrador y actualiza las comprobaciones del hogar. Se quitan las selecciones de compra de las recetas cambiadas. Guardar requiere revisión y confirmación aparte. Las sugerencias caducan al minuto.",
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-filled min-h-[44px]"
          disabled={busy || expired}
          onClick={onUse}
        >
          {copy("Use these choices", "Usar estas opciones")}
        </button>
        <button
          type="button"
          className="btn-secondary min-h-[44px]"
          disabled={busy}
          onClick={onDismiss}
        >
          {copy("Keep my choices", "Conservar mis opciones")}
        </button>
      </div>
    </section>
  );
}
