"use client";
import * as React from "react";
import { useTranslation } from "@/i18n";
import { Dialog } from "@/components/ui/dialog";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import { useInventoryWrites } from "@/components/inventory/InventoryRecovery";
import {
  readRestockReview,
  makeRestockIntent,
  undoRestock,
  type RestockIntent,
} from "@/lib/inventory-restock-client";
import {
  restockReview,
  restockReceipt,
} from "@/lib/inventory-restock-contract";
import type { IntakeContext } from "@/lib/inventory-intake-client";
const en = {
  groceryType: "Grocery",
  shoppingType: "Shopping",
  ambiguous:
    "Some lists have identical names and types. Rename them in Lists before choosing a target.",
  title: "Add a replacement",
  loading: "Checking current stock and grocery lists…",
  failed:
    "Could not confirm this review. Your fields are kept. Check again with the original account.",
  list: "Grocery list",
  choose: "Choose a list",
  name: "Item to buy",
  amount: "Amount to buy",
  unit: "Unit (optional)",
  hint: "Choose what to buy. Remaining stock and label package size do not set this quantity. No stock is changed and no list is created.",
  current: "Current source",
  review: "Review replacement",
  save: "Add replacement",
  retry: "Check the same add",
  busy: "Checking…",
  close: "Close",
  similar: "Similar open items",
  allow: "Add a separate row even if similar items exist",
  incomplete:
    "The duplicate comparison is incomplete. Review the list before allowing a separate row.",
  existing:
    "This list already has an open replacement for this stock lot. Its quantity will not be changed.",
  created: "Replacement added to the selected list.",
  skipped:
    "An open replacement was already on the list. No quantity was changed.",
  removed:
    "The original replacement row has since been removed. It was not recreated.",
  unknown:
    "The outcome is unknown. Keep these original values and retry the same request; do not start another add.",
  changed:
    "The source, list or duplicate review changed. Review again before sending a new request.",
  refused:
    "The server refused this request. Check account access and the original list.",
  openList: "Open list",
  undo: "Undo replacement",
  retryUndo: "Check the same Undo",
  undone: "Undo confirmed. Checked items were kept.",
  undoUnknown:
    "Undo could not be confirmed. Check the list. Closing this recovery does not cancel or confirm the server request.",
  leaveUndo: "Close without confirming Undo",
  noLists: "Create a grocery or shopping list in Lists, then review again.",
  cap: "Only the first 100 lists are shown. Open Lists if your target is missing.",
  lists: "Open Lists",
  offline: "A connection is required. Your reviewed fields are kept.",
};
const es: typeof en = {
  groceryType: "Alimentos",
  shoppingType: "Compras",
  ambiguous:
    "Algunas listas tienen el mismo nombre y tipo. Cámbiales el nombre en Listas antes de elegir.",
  title: "Añadir un reemplazo",
  loading: "Comprobando inventario y listas de compras…",
  failed:
    "No se pudo confirmar esta revisión. Se conservan los campos. Comprueba con la cuenta original.",
  list: "Lista de compras",
  choose: "Elige una lista",
  name: "Artículo para comprar",
  amount: "Cantidad para comprar",
  unit: "Unidad (opcional)",
  hint: "Elige qué comprar. Las existencias y el tamaño del envase no determinan esta cantidad. No cambia el inventario ni se crea una lista.",
  current: "Origen actual",
  review: "Revisar reemplazo",
  save: "Añadir reemplazo",
  retry: "Comprobar la misma solicitud",
  busy: "Comprobando…",
  close: "Cerrar",
  similar: "Artículos abiertos similares",
  allow: "Añadir otra fila aunque existan artículos similares",
  incomplete:
    "La comparación está incompleta. Revisa la lista antes de permitir otra fila.",
  existing:
    "La lista ya tiene un reemplazo abierto de este lote. No se cambiará su cantidad.",
  created: "Reemplazo añadido a la lista elegida.",
  skipped:
    "Ya había un reemplazo abierto en la lista. No se cambió ninguna cantidad.",
  removed:
    "La fila de reemplazo original se eliminó después. No se volvió a crear.",
  unknown:
    "No se conoce el resultado. Conserva estos valores originales y reintenta la misma solicitud; no inicies otra.",
  changed:
    "Cambió el origen, la lista o la comparación. Revisa de nuevo antes de enviar otra solicitud.",
  refused:
    "El servidor rechazó la solicitud. Comprueba el acceso y la lista original.",
  openList: "Abrir lista",
  undo: "Deshacer reemplazo",
  retryUndo: "Comprobar el mismo Deshacer",
  undone: "Deshacer confirmado. Se conservaron los artículos marcados.",
  undoUnknown:
    "No se pudo confirmar Deshacer. Revisa la lista. Cerrar esta recuperación no cancela ni confirma la solicitud del servidor.",
  leaveUndo: "Cerrar sin confirmar Deshacer",
  noLists: "Crea una lista de compras y revisa de nuevo.",
  cap: "Solo se muestran las primeras 100 listas. Abre Listas si falta la tuya.",
  lists: "Abrir Listas",
  offline: "Necesitas conexión. Se conservan los campos revisados.",
};
export function InventoryRestockSheet({
  itemId,
  context,
  suspended = false,
  disabled = false,
  onClose,
  onChanged,
}: {
  itemId: string;
  context?: IntakeContext;
  suspended?: boolean;
  disabled?: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { locale } = useTranslation(),
    c = locale === "es" ? es : en;
  const initial = React.useRef({ itemId, context }).current;
  const scopeChanged =
    initial.itemId !== itemId ||
    initial.context?.userId !== context?.userId ||
    initial.context?.familyId !== context?.familyId;
  const writes = useInventoryWrites();
  const [base, setBase] = React.useState<ReturnType<
    typeof restockReview.parse
  > | null>(null);
  const [reviewed, setReviewed] = React.useState<{
    list: string;
    content: string;
  } | null>(null);
  const [list, setList] = React.useState(""),
    [content, setContent] = React.useState(""),
    [amount, setAmount] = React.useState(""),
    [unit, setUnit] = React.useState("");
  const [allow, setAllow] = React.useState(false),
    [busy, setBusy] = React.useState(false),
    [unknown, setUnknown] = React.useState(false),
    [undoUnknown, setUndoUnknown] = React.useState(false);
  const [notice, setNotice] = React.useState<keyof typeof en | null>(null);
  const [result, setResult] = React.useState<ReturnType<
    typeof restockReceipt.parse
  > | null>(null);
  const attempt = React.useRef<RestockIntent | null>(null),
    flight = React.useRef(false),
    live = React.useRef(true),
    generation = React.useRef(0),
    named = React.useRef(false);
  const locked = busy || unknown || undoUnknown;
  const navigation = usePendingFormNavigationController(locked);
  const current = React.useRef({ list, content, suspended, scopeChanged });
  current.current = { list, content, suspended, scopeChanged };
  const editable =
    !locked && !result && !suspended && !scopeChanged && !disabled;
  async function review() {
    if (!initial.context || current.current.scopeChanged) {
      setNotice("failed");
      return;
    }
    if (
      !initial.context ||
      flight.current ||
      attempt.current ||
      current.current.suspended ||
      current.current.scopeChanged
    )
      return;
    const own = ++generation.current,
      chosen = current.current.list,
      text = current.current.content.trim();
    flight.current = true;
    setBusy(true);
    setReviewed(null);
    setNotice(null);
    try {
      const data = await readRestockReview(
        initial.context,
        initial.itemId,
        chosen || undefined,
        text || undefined,
      );
      if (
        !live.current ||
        generation.current !== own ||
        current.current.suspended ||
        current.current.scopeChanged
      )
        return;
      setBase(data);
      if (!named.current) {
        setContent(data.item.name);
        named.current = true;
      }
      if (chosen)
        setReviewed({ list: chosen, content: text || data.item.name });
    } catch {
      if (live.current && generation.current === own) {
        setBase(null);
        setNotice("failed");
      }
    } finally {
      flight.current = false;
      if (live.current) setBusy(false);
    }
  }
  React.useEffect(() => {
    live.current = true;
    void review();
    return () => {
      live.current = false;
    };
  }, []);
  React.useEffect(() => {
    if (suspended || scopeChanged) {
      generation.current++;
      setBase(null);
      setReviewed(null);
    }
  }, [suspended, scopeChanged]);
  function changeReview() {
    generation.current++;
    setReviewed(null);
    setAllow(false);
  }
  async function save() {
    if (
      flight.current ||
      suspended ||
      scopeChanged ||
      !initial.context ||
      (disabled && !attempt.current)
    )
      return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setNotice("offline");
      return;
    }
    if (!attempt.current) {
      if (
        !base ||
        !reviewed ||
        reviewed.list !== list ||
        reviewed.content !== content.trim()
      )
        return;
      try {
        attempt.current = makeRestockIntent(
          {
            item_id: initial.itemId,
            expected_version: base.item.version,
            list_id: list,
            content,
            amount: Number(amount),
            unit: unit.trim() || null,
            allow_similar: allow,
          },
          initial.context,
        );
      } catch {
        setNotice("changed");
        return;
      }
    }
    flight.current = true;
    setBusy(true);
    setNotice(null);
    const wasUnknown = unknown;
    try {
      const outcome = await writes.restock(attempt.current);
      if (!live.current) return;
      if (outcome.kind === "confirmed") {
        setResult(outcome.receipt);
        attempt.current = null;
        setUnknown(false);
        setNotice(outcome.receipt.created ? "created" : "skipped");
        onChanged();
      } else if (outcome.kind === "removed" || outcome.kind === "not_applied") {
        attempt.current = null;
        setUnknown(false);
        setReviewed(null);
        setNotice(outcome.kind === "removed" ? "removed" : "changed");
      } else if (outcome.kind === "unknown" || wasUnknown) {
        setUnknown(true);
        setNotice("unknown");
      } else {
        attempt.current = null;
        setNotice("refused");
      }
    } finally {
      flight.current = false;
      if (live.current) setBusy(false);
    }
  }
  async function undo() {
    if (
      !result ||
      !initial.context ||
      flight.current ||
      suspended ||
      scopeChanged
    )
      return;
    flight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await undoRestock(result.requestId, initial.context);
      if (!live.current) return;
      if (outcome.kind === "confirmed") {
        setUndoUnknown(false);
        setResult(null);
        setNotice("undone");
        onChanged();
      } else {
        setUndoUnknown(true);
        setNotice("undoUnknown");
      }
    } finally {
      flight.current = false;
      if (live.current) setBusy(false);
    }
  }
  const matches =
    !!base &&
    !!reviewed &&
    reviewed.list === list &&
    reviewed.content === content.trim();
  const duplicateOkay =
    !base ||
    !!base.existingSourceItemId ||
    (!base.similar.length && !base.comparisonIncomplete) ||
    allow;
  const validAmount =
    amount.trim() !== "" &&
    Number.isFinite(Number(amount)) &&
    Number(amount) > 0 &&
    Number(amount) <= 100000;
  const listKey = (target: { name: string; type: string }) =>
    `${target.type}:${target.name.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US")}`;
  const ambiguous = new Set(
    base?.lists
      .filter((target, index, all) =>
        all.some(
          (other, i) => i !== index && listKey(target) === listKey(other),
        ),
      )
      .map((target) => target.id),
  );
  const ambiguousTarget = ambiguous.has(list);
  const prefix = React.useId();
  return (
    <Dialog
      open={!suspended && !scopeChanged}
      title={c.title}
      variant="form"
      closeLabel={c.close}
      onClose={locked ? undefined : onClose}
      testId="inventory-restock-sheet"
    >
      <div className="space-y-4">
        <p className="text-footnote text-label-secondary">{c.hint}</p>
        {notice && (
          <p
            role={
              notice === "failed" || notice === "refused" ? "alert" : "status"
            }
          >
            {c[notice]}
          </p>
        )}
        {busy && <p role="status">{c.loading}</p>}
        {!result && notice !== "undone" && (
          <>
            <fieldset disabled={!editable} className="space-y-3">
              {base && (
                <p className="text-subhead">
                  {c.current}: {base.item.name}
                </p>
              )}
              <label className="block" htmlFor={`${prefix}-list`}>
                {c.list}
              </label>
              <select
                id={`${prefix}-list`}
                className="input-apple w-full"
                value={list}
                onChange={(event) => {
                  setList(event.target.value);
                  current.current.list = event.target.value;
                  changeReview();
                }}
              >
                <option value="">{c.choose}</option>
                {base?.lists.map((target) => (
                  <option
                    key={target.id}
                    value={target.id}
                    disabled={ambiguous.has(target.id)}
                  >
                    {target.name} ·{" "}
                    {target.type === "grocery" ? c.groceryType : c.shoppingType}
                  </option>
                ))}
              </select>
              {ambiguous.size > 0 && <p>{c.ambiguous}</p>}
              {base?.listsTruncated && <p>{c.cap}</p>}
              {base && !base.lists.length && <p>{c.noLists}</p>}
              <label className="block" htmlFor={`${prefix}-name`}>
                {c.name}
              </label>
              <input
                id={`${prefix}-name`}
                className="input-apple w-full"
                value={content}
                maxLength={200}
                onChange={(event) => {
                  named.current = true;
                  setContent(event.target.value);
                  current.current.content = event.target.value;
                  changeReview();
                }}
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={`${prefix}-amount`}>{c.amount}</label>
                  <input
                    id={`${prefix}-amount`}
                    className="input-apple w-full"
                    type="number"
                    min="0"
                    max="100000"
                    step="any"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor={`${prefix}-unit`}>{c.unit}</label>
                  <input
                    id={`${prefix}-unit`}
                    className="input-apple w-full"
                    maxLength={32}
                    value={unit}
                    onChange={(event) => setUnit(event.target.value)}
                  />
                </div>
              </div>
              {base?.existingSourceItemId && matches && <p>{c.existing}</p>}
              {matches && !!base?.similar.length && (
                <div>
                  <h3>{c.similar}</h3>
                  <ul>
                    {base.similar.map((row) => (
                      <li key={row.id} className="break-words">
                        {row.content}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {matches && base?.comparisonIncomplete && <p>{c.incomplete}</p>}
              {matches &&
                base &&
                !base.existingSourceItemId &&
                (base.similar.length > 0 || base.comparisonIncomplete) && (
                  <label className="flex min-h-[44px] items-center gap-2">
                    <input
                      type="checkbox"
                      checked={allow}
                      onChange={(event) => setAllow(event.target.checked)}
                    />
                    {c.allow}
                  </label>
                )}
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-tinted min-h-[44px]"
                disabled={locked || suspended || scopeChanged}
                onClick={() => void review()}
              >
                {c.review}
              </button>
              <button
                type="button"
                className="btn-primary min-h-[44px]"
                disabled={
                  busy ||
                  suspended ||
                  scopeChanged ||
                  (!unknown &&
                    (!editable ||
                      !matches ||
                      !duplicateOkay ||
                      !validAmount ||
                      ambiguousTarget))
                }
                onClick={() => void save()}
              >
                {busy ? c.busy : unknown ? c.retry : c.save}
              </button>
            </div>
          </>
        )}
        {result && (
          <div className="space-y-3">
            <a
              className="inline-flex min-h-[44px] items-center underline"
              href={`/dashboard/lists/${encodeURIComponent(result.listId)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {c.openList} ↗
            </a>
            {result.created &&
              (undoUnknown ||
                Date.parse(result.undoExpiresAt) > Date.now()) && (
                <button
                  type="button"
                  className="btn-tinted min-h-[44px]"
                  disabled={busy}
                  onClick={() => void undo()}
                >
                  {undoUnknown ? c.retryUndo : c.undo}
                </button>
              )}
          </div>
        )}
        {undoUnknown && (
          <button
            type="button"
            className="btn-plain min-h-[44px]"
            disabled={busy}
            onClick={() => {
              setUndoUnknown(false);
              void navigation.releaseBeforeNavigation().then(() => onClose());
            }}
          >
            {c.leaveUndo}
          </button>
        )}
        <a
          className="inline-flex min-h-[44px] items-center underline"
          href="/dashboard/lists"
          target="_blank"
          rel="noopener noreferrer"
        >
          {c.lists} ↗
        </a>
      </div>
    </Dialog>
  );
}
