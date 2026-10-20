"use client";
import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { useTranslation } from "@/i18n";
import {
  cookingReview,
  type CookingReviewSource,
} from "@/lib/inventory-cooking-review-contract";
import { cookingLots } from "@/lib/inventory-cooking-lots";
import type { InventoryItemDto } from "@/lib/inventory";
import type { IntakeContext } from "@/lib/inventory-intake-client";
import {
  INVENTORY_READ_SCOPE_HEADER,
  inventoryReadScopeValue,
} from "@/lib/inventory-read-scope";
import { readBoundedInventoryJson } from "@/lib/inventory-reader";
import { inventoryWriteDeadline } from "@/lib/inventory-write-deadline";
import { formatRecipeAmount, scaleRecipeAmount } from "@/lib/recipe-scaling";
const en = {
  noLines:
    "No ingredient lines are recorded. Review food directly in Inventory.",
  more: "Only the first 20 matching lots are shown. Close this sheet to review other lots in Inventory.",
  matches: "matching lots",
  title: "Review cooking stock",
  close: "Close",
  loading: "Checking recipe context…",
  failed:
    "Could not confirm this recipe and account. Try again with the original account.",
  retry: "Check again",
  hint: "Recipe amounts are a guide, not stock deductions. Choose a lot, then explicitly record the amount used in that lot’s own unit. Each change is saved separately with Undo. Planning, preparing and recording portions eaten do not change food stock.",
  live: "Current saved recipe",
  recorded: "Recipe recorded at preparation",
  portions: "Cooking portions",
  empty:
    "No matching current lot. Open Inventory to choose another item; a missing match does not mean you need to buy it.",
  linked: "Ingredient link",
  name: "Name match only",
  unknown: "Amount unknown",
  dateUnknown: "No labelled date",
  best: "Best before",
  use: "Use by",
  choose: "Review amount used",
  capped: "This inventory read is incomplete. Other lots may be available.",
  stale:
    "Finish any pending recovery and refresh Inventory before choosing a lot.",
  location: { fridge: "Fridge", freezer: "Freezer", pantry: "Pantry" },
};
const es: typeof en = {
  noLines:
    "No hay ingredientes registrados. Revisa los alimentos en Inventario.",
  more: "Solo se muestran los primeros 20 lotes. Cierra esta hoja para revisar otros en Inventario.",
  matches: "lotes coincidentes",
  title: "Revisar alimentos para cocinar",
  close: "Cerrar",
  loading: "Comprobando la receta…",
  failed:
    "No se pudo confirmar la receta y cuenta. Reintenta con la cuenta original.",
  retry: "Comprobar otra vez",
  hint: "Las cantidades de la receta son una guía. Elige un lote y registra lo usado en su propia unidad. Cada cambio se guarda por separado con Deshacer. Planificar, preparar y registrar porciones comidas no cambian el inventario.",
  live: "Receta guardada actual",
  recorded: "Receta registrada al preparar",
  portions: "Porciones para cocinar",
  empty:
    "No hay un lote coincidente actual. Abre Inventario para elegir otro; no significa que debas comprarlo.",
  linked: "Ingrediente vinculado",
  name: "Solo coincide el nombre",
  unknown: "Cantidad desconocida",
  dateUnknown: "Sin fecha de etiqueta",
  best: "Consumo preferente",
  use: "Caducidad",
  choose: "Revisar cantidad usada",
  capped: "La lectura del inventario está incompleta. Puede haber otros lotes.",
  stale:
    "Termina la recuperación pendiente y actualiza Inventario antes de elegir un lote.",
  location: {
    fridge: "Refrigerador",
    freezer: "Congelador",
    pantry: "Despensa",
  },
};
export function InventoryCookingSheet({
  source,
  context,
  items,
  capped,
  suspended,
  disabled,
  onChoose,
  onClose,
}: {
  source: CookingReviewSource;
  context: IntakeContext;
  items: InventoryItemDto[];
  capped: boolean;
  suspended: boolean;
  disabled: boolean;
  onChoose: (item: InventoryItemDto) => void;
  onClose: () => void;
}) {
  const { locale } = useTranslation(),
    c = locale === "es" ? es : en;
  const initial = React.useRef({ context, source }).current;
  const scope = inventoryReadScopeValue(context),
    originalScope = inventoryReadScopeValue(initial.context);
  const changed =
    scope !== originalScope ||
    JSON.stringify(source) !== JSON.stringify(initial.source);
  const [data, setData] = React.useState<ReturnType<
    typeof cookingReview.parse
  > | null>(null);
  const [busy, setBusy] = React.useState(false),
    [failed, setFailed] = React.useState(false);
  const generation = React.useRef(0),
    controller = React.useRef<AbortController | null>(null);
  const key = JSON.stringify(source);
  async function load() {
    if (changed || suspended) return;
    controller.current?.abort();
    const own = ++generation.current,
      request = new AbortController();
    controller.current = request;
    setBusy(true);
    setFailed(false);
    setData(null);
    const timer = setTimeout(() => request.abort(), 15000);
    try {
      const query = new URLSearchParams({
        kind: initial.source.kind,
        id: initial.source.id,
      });
      if (initial.source.kind === "recipe" && initial.source.servings)
        query.set("servings", String(initial.source.servings));
      const result = await inventoryWriteDeadline(async () => {
        const response = await fetch(`/api/inventory/cooking-review?${query}`, {
          cache: "no-store",
          signal: request.signal,
          headers: { [INVENTORY_READ_SCOPE_HEADER]: originalScope },
        });
        if (
          !response.ok ||
          response.headers.get(INVENTORY_READ_SCOPE_HEADER) !== originalScope
        )
          throw new Error();
        const value = cookingReview.parse(
          await readBoundedInventoryJson(response, request.signal, 128 * 1024),
        );
        if (
          value.userId !== initial.context.userId ||
          value.familyId !== initial.context.familyId ||
          JSON.stringify(value.source) !== JSON.stringify(initial.source)
        )
          throw new Error();
        return { kind: "ready" as const, value };
      });
      if (result.kind !== "ready") throw new Error();
      if (own === generation.current) setData(result.value);
    } catch {
      if (own === generation.current) setFailed(true);
    } finally {
      clearTimeout(timer);
      if (own === generation.current) setBusy(false);
    }
  }
  React.useEffect(() => {
    if (changed || suspended) {
      setData(null);
      setBusy(false);
    } else void load();
    return () => {
      generation.current++;
      controller.current?.abort();
    };
  }, [scope, key, suspended]);
  return (
    <Dialog
      open={!suspended && !changed}
      variant="form"
      title={c.title}
      closeLabel={c.close}
      onClose={onClose}
      testId="inventory-cooking-sheet"
    >
      <div className="space-y-4">
        <p className="text-footnote text-label-secondary">{c.hint}</p>
        {busy && <p role="status">{c.loading}</p>}
        {failed && (
          <div role="alert">
            <p>{c.failed}</p>
            <button
              className="btn-tinted min-h-[44px]"
              onClick={() => void load()}
            >
              {c.retry}
            </button>
          </div>
        )}
        {data && (
          <>
            <h3 className="text-headline break-words">{data.title}</h3>
            <p>
              {data.basis === "prepared-snapshot" ? c.recorded : c.live} ·{" "}
              {c.portions}: {data.targetServings}
            </p>
            {capped && <p role="status">{c.capped}</p>}
            {disabled && <p role="status">{c.stale}</p>}
            {data.lines.length === 0 && <p>{c.noLines}</p>}
            <div className="space-y-3">
              {data.lines.map((line) => {
                const lots = cookingLots(items, line),
                  amount = scaleRecipeAmount(
                    line.amount,
                    data.baseServings,
                    data.targetServings,
                  );
                return (
                  <details
                    key={line.id}
                    className="rounded-xl border border-[var(--surface-separator)] p-3 space-y-2"
                  >
                    <summary className="min-h-[44px] cursor-pointer py-2 font-semibold break-words">
                      {line.name} ·{" "}
                      {amount === null
                        ? "—"
                        : formatRecipeAmount(amount, line.unit, locale)}
                      {" · "}
                      {lots.length} {c.matches}
                    </summary>
                    {!lots.length && <p className="text-footnote">{c.empty}</p>}
                    {lots.length > 20 && <p>{c.more}</p>}
                    {lots.slice(0, 20).map(({ item, match }) => (
                      <div
                        key={item.id}
                        className="rounded-xl bg-[var(--surface-fill)] p-3 space-y-1"
                      >
                        <p className="break-words">
                          {item.name} · {c.location[item.location]} ·{" "}
                          {item.amount === null
                            ? c.unknown
                            : formatRecipeAmount(
                                item.amount,
                                item.unit,
                                locale,
                              )}
                        </p>
                        <p className="text-footnote">
                          {match === "linked" ? c.linked : c.name} ·{" "}
                          {item.expires_on
                            ? `${item.date_kind === "use_by" ? c.use : c.best}: ${item.expires_on}`
                            : c.dateUnknown}
                        </p>
                        <button
                          type="button"
                          className="btn-tinted min-h-[44px]"
                          disabled={disabled || busy}
                          onClick={() => onChoose(item)}
                        >
                          {c.choose}
                        </button>
                      </div>
                    ))}
                  </details>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
