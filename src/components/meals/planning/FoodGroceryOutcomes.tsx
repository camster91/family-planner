"use client";
import * as React from "react";
import Link from "next/link";
import { useDraftAwareRouter } from "@/components/layout/owned-draft-navigation";
import { useTranslation } from "@/i18n";
import { formatScheduleInstant } from "@/lib/calendar-planning/schedule-form";
import type {
  FoodGroceryOutcomes,
  FoodGroceryUndo,
} from "@/lib/food-planning/grocery-outcomes-contract";
export function FoodGroceryOutcomesView({
  outcome,
  undos,
  readError,
  busy,
  onRead,
  onUndo,
}: {
  outcome?: FoodGroceryOutcomes;
  undos?: Record<string, FoodGroceryUndo | "unknown">;
  readError?: boolean;
  busy: boolean;
  onRead: () => void;
  onUndo: (id: string) => void;
}) {
  const router = useDraftAwareRouter();
  const { locale } = useTranslation(),
    es = locale === "es";
  const [position, setPosition] = React.useState(0);
  const index = Math.min(
    position,
    Math.max(0, (outcome?.outcomes.length ?? 1) - 1),
  );
  const row = outcome?.outcomes[index],
    result = row?.result;
  const undo = row && undos?.[row.requestId];
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!result) return;
    setNow(Date.now());
    const remaining = Date.parse(result.undoExpiresAt) - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(remaining + 1, 2147483647),
    );
    return () => clearTimeout(timer);
  }, [result]);
  return (
    <section
      className="space-y-3 border-t border-[var(--separator)] pt-3"
      aria-label={es ? "Resultados de la compra" : "Grocery results"}
    >
      <button
        type="button"
        className="btn-secondary min-h-[44px]"
        disabled={busy}
        onClick={onRead}
      >
        {es ? "Comprobar resultados de la compra" : "Read grocery results"}
      </button>
      {readError && (
        <p role="status">
          {es
            ? "No se pudieron comprobar los detalles. El guardado de las comidas sigue confirmado."
            : "Details could not be checked. The meal save is still confirmed."}
        </p>
      )}
      {row && (
        <>
          <p className="text-footnote text-label-secondary">
            {es
              ? "Recibo del añadido original, no el contenido actual de la lista. Deshacer solo afecta a esta compra, no a las comidas ni a la sesión."
              : "Original add receipt, not the list’s current contents. Undo affects this grocery add only, not meals or the prep session."}
          </p>
          {result ? (
            <>
              <p className="font-semibold break-words">{result.listName}</p>
              <p>
                {es ? "Añadidos" : "Added"}: {result.createdCount} ·{" "}
                {es ? "Ya estaban abiertos" : "Already open on list"}:{" "}
                {result.alreadyOnListCount}
              </p>
              {(result.possibleDuplicates.length > 0 ||
                result.possibleDuplicatesTruncated) && (
                <p>
                  {es
                    ? "Posibles coincidencias con texto libre"
                    : "Possible free-text lookalikes"}
                  : {result.possibleDuplicates.length}
                  {result.possibleDuplicatesTruncated ? "+" : ""}.{" "}
                  {es
                    ? "No se combinaron artículos. Revisa la lista."
                    : "No items were merged. Review the list."}
                </p>
              )}
              <p className="text-footnote">
                {es ? "Deshacer hasta" : "Undo until"}:{" "}
                {formatScheduleInstant(result.undoExpiresAt, locale, "UTC")}
              </p>
              {undo === "unknown" && (
                <p role="status">
                  {es
                    ? "Resultado de deshacer sin confirmar. Puede haber terminado. Solo reintenta el mismo añadido; los artículos marcados se conservan."
                    : "Undo result unconfirmed; it may have finished. Retry this same add only. Checked items are preserved."}
                </p>
              )}
              {undo && undo !== "unknown" && (
                <p role="status">
                  {undo.result.kind === "done"
                    ? `${es ? "Esta respuesta confirma eliminados" : "This response confirms removed"}: ${undo.result.removedCount} · ${es ? "Marcados conservados" : "Checked items kept"}: ${undo.result.keptCheckedCount}`
                    : undo.result.code === "UNDO_WINDOW_EXPIRED"
                      ? es
                        ? "El plazo terminó. Revisa la lista por si un intento anterior hizo cambios."
                        : "The Undo window closed. Review the list for any earlier changes."
                      : es
                        ? "No se pudo deshacer ahora. Los cambios de intentos anteriores siguen sin comprobar."
                        : "Undo was refused now. Earlier attempts may still have changed the list."}
                </p>
              )}
              {now < Date.parse(result.undoExpiresAt) &&
                result.createdCount > 0 &&
                (!undo ||
                  undo === "unknown" ||
                  undo.result.kind === "refused") && (
                  <button
                    type="button"
                    className="btn-secondary min-h-[44px]"
                    disabled={busy}
                    onClick={() => onUndo(row.requestId)}
                  >
                    {undo === "unknown"
                      ? es
                        ? "Reintentar el mismo deshacer"
                        : "Retry same Undo"
                      : es
                        ? "Deshacer este añadido"
                        : "Undo this grocery add"}
                  </button>
                )}
            </>
          ) : (
            <p>
              {es
                ? "Detalles del añadido no disponibles; no significa que fallara."
                : "Add details unavailable; this does not mean the add failed."}
            </p>
          )}
          <Link
            className="btn-secondary min-h-[44px] inline-flex"
            href={`/dashboard/lists/${encodeURIComponent(row.listId)}`}
            onClick={(event) => {
              event.preventDefault();
              if (!busy)
                void router.push(
                  `/dashboard/lists/${encodeURIComponent(row.listId)}`,
                );
            }}
          >
            {es ? "Abrir lista" : "Open list"}
          </Link>
          {outcome!.outcomes.length > 1 && (
            <div className="flex justify-between items-center gap-2">
              <button
                type="button"
                className="btn-secondary min-h-[44px]"
                disabled={busy || index === 0}
                onClick={() => setPosition(index - 1)}
              >
                {es ? "Anterior" : "Previous add"}
              </button>
              <span aria-live="polite">
                {index + 1}/{outcome!.outcomes.length}
              </span>
              <button
                type="button"
                className="btn-secondary min-h-[44px]"
                disabled={busy || index + 1 === outcome!.outcomes.length}
                onClick={() => setPosition(index + 1)}
              >
                {es ? "Siguiente" : "Next add"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
