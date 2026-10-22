"use client";
import Link from "next/link";
import { useTranslation } from "@/i18n";
import { useDraftAwareRouter } from "@/components/layout/owned-draft-navigation";
import { useFoodPlanningAccess } from "./FoodPlanningAccess";
/** Capability/role only; no local-store discovery, source reads or writes here. */
export function MealPlanningReviewLinks({
  disabled,
  canNavigate,
}: {
  disabled: boolean;
  canNavigate: () => boolean;
}) {
  const access = useFoodPlanningAccess();
  return access.personalRole ? (
    <Links
      enabled={access.enabled}
      disabled={disabled}
      canNavigate={canNavigate}
    />
  ) : null;
}
function Links({
  enabled,
  disabled,
  canNavigate,
}: {
  enabled: boolean;
  disabled: boolean;
  canNavigate: () => boolean;
}) {
  const router = useDraftAwareRouter(),
    { locale } = useTranslation(),
    es = locale === "es";
  const links = [
    ...(enabled
      ? [
          {
            href: "/dashboard/meals?foodPlan=new",
            label: es
              ? "Planificar comidas y preparación"
              : "Plan meals and prep",
          },
        ]
      : []),
    {
      href: "/dashboard/meals?foodPlan=recovery",
      label: es ? "Trabajo de comidas guardado" : "Saved meal planning work",
    },
    {
      href: "/dashboard/meals?view=bulk&bulkWork=recovery",
      label: es ? "Cocina por lotes guardada" : "Saved bulk cooking work",
    },
  ];
  return (
    <details className="rounded-xl border border-[var(--surface-separator)] p-3">
      <summary className="min-h-[44px] py-2 cursor-pointer font-semibold">
        {es ? "Planificación y trabajo guardado" : "Planning and saved work"}
      </summary>
      <p className="text-footnote text-label-secondary">
        {es
          ? "Abre la función original para continuar. No se envía nada ni se marca este paso como revisado."
          : "Open the original feature to continue. Opening it does not submit anything or mark this step reviewed."}
      </p>
      <div className="flex flex-wrap gap-2 mt-2">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="btn-tinted min-h-[44px] inline-flex items-center"
            aria-disabled={disabled}
            tabIndex={disabled ? -1 : undefined}
            onClick={(event) => {
              if (disabled || !canNavigate()) {
                event.preventDefault();
                return;
              }
              if (
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              event.preventDefault();
              void router.push(link.href);
            }}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </details>
  );
}
