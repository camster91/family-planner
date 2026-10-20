"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Dialog } from "@/components/ui/dialog";
import { useTranslation } from "@/i18n";
import {
  normalizeFoodBarcode,
  type FoodBarcode,
  type FoodBarcodeFormat,
} from "@/lib/food-barcode";
import {
  foodProductReply,
  type FoodProductSummary,
} from "@/lib/food-product-contract";
import {
  readInventoryIntakeContext,
  makeInventoryIntakeIntent,
  postInventoryIntake,
  type IntakeContext,
  type IntakeIntent,
} from "@/lib/inventory-intake-client";
import { createInventorySchema } from "@/lib/inventory";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import { useFoodBarcodeCamera } from "@/components/inventory/use-food-barcode-camera";
import { newIdempotencyKey } from "@/lib/idempotency-key";
type Row = {
  id: string;
  code: FoodBarcode;
  name: string;
  brand: string;
  packageSize: string;
  amount: string;
  unit: string;
  location: "fridge" | "freezer" | "pantry";
  expires: string;
  dateKind: "best_before" | "use_by";
  purchased: string;
  opened: string;
  origin: "manual" | "open-food-facts";
  baseRevision: number | null;
  remember: boolean;
  include: boolean;
  lookupAvailable: boolean;
  sourceUrl: string | null;
  imageUrl: string | null;
  uncertain?: boolean;
};
/** One selected draft at a time, canonical stock only after explicit review/save. */
export function BarcodeFoodDialog({
  initialContext,
  onClose,
  onDone,
}: {
  initialContext?: IntakeContext;
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  const { locale } = useTranslation();
  const es = locale === "es";
  const text = (en: string, spanish: string) => (es ? spanish : en);
  const [context, setContext] = useState<IntakeContext | null>(
    initialContext ?? null,
  );
  const [contextAttempt, setContextAttempt] = useState(0);
  const [codeText, setCodeText] = useState("");
  const [format, setFormat] = useState<FoodBarcodeFormat>("auto");
  const [rows, setRows] = useState<Row[]>([]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [selected, setSelected] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [publicSuggestion, setPublicSuggestion] = useState<{
    rowId: string;
    product: FoodProductSummary;
  } | null>(null);
  const flight = useRef(false);
  const readingRef = useRef(false);
  const requests = useRef(new Set<AbortController>());
  const live = useRef(true);
  const attempts = useRef(
    new Map<string, { intent: IntakeIntent; uncertain: boolean }>(),
  );
  const total = useRef(0);
  const unknown = rows.some((row) => row.uncertain);
  const locked = saving || unknown;
  const navigation = usePendingFormNavigationController(locked);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      requests.current.forEach((request) => request.abort());
    };
  }, []);
  useEffect(() => {
    if (initialContext) return;
    let active = true;
    const request = new AbortController();
    requests.current.add(request);
    const timeout = setTimeout(() => request.abort(), 10000);
    void readInventoryIntakeContext(request.signal)
      .then((value) => {
        if (live.current && active) setContext(value);
      })
      .catch(() => {
        if (live.current && active)
          setMessage(
            text(
              "Could not check your household. Retry or add food manually.",
              "No pudimos comprobar tu hogar. Reintenta o añade alimentos a mano.",
            ),
          );
      })
      .finally(() => {
        clearTimeout(timeout);
        requests.current.delete(request);
      });
    return () => {
      active = false;
      request.abort();
    };
  }, [initialContext, contextAttempt]);
  const camera = useFoodBarcodeCamera((code) => {
    void add(code);
  });
  const current = rows.find((row) => row.id === selected) ?? rows[0];
  function update(change: Partial<Row>) {
    if (
      flight.current ||
      readingRef.current ||
      attempts.current.size ||
      !current
    )
      return;
    setRows((previous) =>
      previous.map((row) =>
        row.id === current.id ? { ...row, ...change } : row,
      ),
    );
    setMessage(null);
  }
  async function metadata(
    rowId: string,
    code: FoodBarcode,
    publicLookup: boolean,
    preserveDraft = false,
  ) {
    if (
      !context ||
      readingRef.current ||
      flight.current ||
      attempts.current.size
    )
      return;
    readingRef.current = true;
    setReading(true);
    const request = new AbortController();
    requests.current.add(request);
    const timeout = setTimeout(() => request.abort(), 10000);
    try {
      const response = await fetch(
        `/api/inventory/products?barcode=${code.gtin}${publicLookup ? "&lookup=1" : ""}`,
        { cache: "no-store", signal: request.signal },
      );
      if (!response.ok) throw new Error();
      const data = foodProductReply.parse(await response.json());
      if (
        data.barcode !== code.gtin ||
        data.context.userId !== context.userId ||
        data.context.familyId !== context.familyId
      )
        throw new Error();
      if (!live.current) return;
      if (publicLookup && data.product) {
        setPublicSuggestion({ rowId, product: data.product });
        setMessage(
          text(
            "Product details found. Compare them with your draft and apply them explicitly.",
            "Se encontraron datos. Compáralos con el borrador y aplícalos expresamente.",
          ),
        );
        return;
      }
      if (preserveDraft) {
        setRows((previous) =>
          previous.map((row) =>
            row.id === rowId
              ? {
                  ...row,
                  baseRevision: data.product?.revision ?? null,
                  lookupAvailable: data.publicLookupAvailable,
                }
              : row,
          ),
        );
        setMessage(
          data.product
            ? text(
                `Current household product: ${data.product.name}. Your edits are kept; review before saving again.`,
                `Producto actual del hogar: ${data.product.name}. Se conservan tus cambios; revísalos antes de guardar.`,
              )
            : text(
                "No household product is saved for this code. Your draft is kept.",
                "No hay un producto guardado para este código. Se conserva el borrador.",
              ),
        );
      } else {
        setRows((previous) =>
          previous.map((row) =>
            row.id !== rowId
              ? row
              : {
                  ...row,
                  lookupAvailable: data.publicLookupAvailable,
                  ...(data.product
                    ? {
                        name: data.product.name,
                        brand: data.product.brand ?? "",
                        packageSize: data.product.package_size ?? "",
                        origin: data.product.origin,
                        baseRevision: publicLookup
                          ? row.baseRevision
                          : data.product.revision,
                        sourceUrl: data.product.source_url,
                        imageUrl: data.product.image_url ?? null,
                      }
                    : {}),
                },
          ),
        );
      }
      if (!data.product)
        setMessage(
          text(
            "No product details found. Enter the label details below.",
            "No se encontraron datos. Introduce los datos de la etiqueta.",
          ),
        );
    } catch {
      if (live.current)
        setMessage(
          text(
            "Product details are unavailable. Your code and draft are kept; fill them in manually.",
            "Los datos no están disponibles. Se conservan el código y el borrador; complétalos a mano.",
          ),
        );
    } finally {
      clearTimeout(timeout);
      requests.current.delete(request);
      readingRef.current = false;
      if (live.current) setReading(false);
    }
  }
  async function add(code: FoodBarcode) {
    if (
      !context ||
      flight.current ||
      readingRef.current ||
      attempts.current.size
    )
      return;
    camera.stop();
    setMessage(null);
    const found = rowsRef.current.find((row) => row.code.gtin === code.gtin);
    if (found) {
      setSelected(found.id);
      setReview(true);
      setMessage(
        text(
          "Already in review. Use +1 package or Separate lot deliberately.",
          "Ya está en revisión. Usa +1 paquete o Lote separado expresamente.",
        ),
      );
      return;
    }
    if (rowsRef.current.length >= 20) {
      setMessage(
        text(
          "Review or save these 20 items before adding more.",
          "Revisa o guarda estos 20 alimentos antes de añadir más.",
        ),
      );
      return;
    }
    const id = newIdempotencyKey();
    const row: Row = {
      id,
      code,
      name: "",
      brand: "",
      packageSize: "",
      amount: "1",
      unit: "packages",
      location: "pantry",
      expires: "",
      dateKind: "best_before",
      purchased: "",
      opened: "",
      origin: "manual",
      baseRevision: null,
      remember: false,
      include: true,
      lookupAvailable: false,
      sourceUrl: null,
      imageUrl: null,
    };
    rowsRef.current = [...rowsRef.current, row];
    setRows(rowsRef.current);
    setSelected(id);
    setCodeText("");
    setReview(true);
    await metadata(id, code, false);
  }
  function close() {
    if (flight.current || attempts.current.size) return;
    camera.stop();
    requests.current.forEach((request) => request.abort());
    total.current ? onDone(total.current) : onClose();
  }
  async function save() {
    if (flight.current || readingRef.current || !context) return;
    camera.stop();
    const chosen = rowsRef.current.filter((row) => row.include);
    if (!chosen.length) return;
    const item = (row: Row) => ({
      name: row.name.trim(),
      amount: row.amount.trim() ? Number(row.amount) : null,
      unit: row.unit.trim() || null,
      location: row.location,
      expires_on: row.expires || null,
      date_kind: row.dateKind,
      purchased_on: row.purchased || null,
      opened_on: row.opened || null,
    });
    if (
      chosen.some(
        (row) =>
          !attempts.current.has(row.id) &&
          !createInventorySchema.safeParse(item(row)).success,
      )
    ) {
      setMessage(
        text(
          "Review every selected name, amount and date before saving.",
          "Revisa todos los nombres, cantidades y fechas seleccionados antes de guardar.",
        ),
      );
      return;
    }
    flight.current = true;
    setSaving(true);
    setMessage(null);
    let failed = 0;
    for (const row of chosen) {
      let attempt = attempts.current.get(row.id);
      if (!attempt) {
        attempt = {
          intent: makeInventoryIntakeIntent(
            item(row),
            context,
            newIdempotencyKey(),
            {
              barcode: row.code.gtin,
              brand: row.brand.trim() || null,
              package_size: row.packageSize.trim() || null,
              origin: row.origin,
              remember: row.remember,
              base_revision: row.baseRevision,
            },
          ),
          uncertain: false,
        };
        attempts.current.set(row.id, attempt);
      }
      const result = await postInventoryIntake(attempt.intent);
      if (result.kind === "confirmed") {
        attempts.current.delete(row.id);
        total.current++;
        rowsRef.current = rowsRef.current.filter(
          (value) => value.id !== row.id,
        );
        setRows(rowsRef.current);
        continue;
      }
      failed++;
      if (
        result.kind === "removed" ||
        (result.kind === "refused" && result.code === "PRODUCT_CHANGED")
      ) {
        attempts.current.delete(row.id);
        rowsRef.current = rowsRef.current.map((value) =>
          value.id === row.id
            ? {
                ...value,
                uncertain: false,
                ...(result.kind === "removed" ? { include: false } : {}),
              }
            : value,
        );
        setRows(rowsRef.current);
        setMessage(
          text(
            "Review the current household product or removed item before starting a new save. Your draft is kept.",
            "Revisa el producto actual o el alimento eliminado antes de otro guardado. Se conserva el borrador.",
          ),
        );
      } else if (result.kind === "unknown" || attempt.uncertain) {
        attempt.uncertain = true;
        rowsRef.current = rowsRef.current.map((value) =>
          value.id === row.id ? { ...value, uncertain: true } : value,
        );
        setRows(rowsRef.current);
      } else {
        attempts.current.delete(row.id);
        setMessage(
          text(
            "A save was refused. Check account, household and any changed private product details. Your draft is kept.",
            "Se rechazó un guardado. Revisa tu cuenta, hogar y los datos privados que hayan cambiado. Se conserva el borrador.",
          ),
        );
      }
    }
    if (!attempts.current.size) await navigation.releaseBeforeNavigation();
    flight.current = false;
    setSaving(false);
    if (!failed && !rowsRef.current.length) onDone(total.current);
    else if (failed)
      setMessage(
        text(
          `${total.current} confirmed; ${failed} need attention. Unknown rows retry the same request.`,
          `${total.current} confirmados; ${failed} necesitan revisión. Los inciertos reintentan la misma solicitud.`,
        ),
      );
  }
  return (
    <Dialog
      open
      variant="form"
      title={text("Scan food", "Escanear alimentos")}
      closeLabel={text("Close", "Cerrar")}
      onClose={locked ? undefined : close}
      className="sm:max-w-2xl"
    >
      <div className="space-y-4">
        {!context && (
          <div role="status">
            <p>{text("Checking your household…", "Comprobando tu hogar…")}</p>
            <button
              type="button"
              className="btn-tinted min-h-[44px]"
              onClick={() => setContextAttempt((value) => value + 1)}
            >
              {text("Retry", "Reintentar")}
            </button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-tinted min-h-[44px]"
            disabled={locked || reading}
            onClick={() => {
              if (flight.current || readingRef.current || attempts.current.size)
                return;
              camera.stop();
              setReview(false);
            }}
          >
            {text("Add codes", "Añadir códigos")}
          </button>
          <button
            type="button"
            className="btn-tinted min-h-[44px]"
            disabled={!rows.length || reading}
            onClick={() => {
              camera.stop();
              setReview(true);
            }}
          >
            {text(`Review (${rows.length})`, `Revisar (${rows.length})`)}
          </button>
        </div>
        {message && (
          <p role="status" className="text-subhead">
            {message}
          </p>
        )}
        {unknown && (
          <p role="alert">
            {text(
              "Some items may already be saved. Values stay locked; retry to check the same saves before closing.",
              "Puede que algunos alimentos ya estén guardados. Los valores quedan bloqueados; comprueba los mismos guardados antes de cerrar.",
            )}
          </p>
        )}
        <video
          ref={camera.video}
          muted
          playsInline
          hidden={!camera.active}
          className="w-full max-h-64 rounded-2xl object-cover"
          aria-label={text("Barcode camera preview", "Vista previa de cámara")}
        />
        {!review ? (
          <div className="space-y-3">
            <p className="text-footnote text-label-secondary">
              {text(
                "Camera frames stay on this device. Unsupported or denied camera access always has typed entry.",
                "Las imágenes de cámara permanecen en este dispositivo. Siempre puedes escribir el código si la cámara no está disponible.",
              )}
            </p>
            <button
              type="button"
              className="btn-tinted min-h-[44px]"
              disabled={!context || reading || locked}
              onClick={() => {
                if (
                  !context ||
                  flight.current ||
                  readingRef.current ||
                  attempts.current.size
                )
                  return;
                camera.active ? camera.stop() : void camera.start();
              }}
            >
              {camera.active
                ? text("Stop camera", "Detener cámara")
                : text("Start camera", "Iniciar cámara")}
            </button>
            {camera.error && (
              <p role="status">
                {text(
                  "Camera unavailable or stopped. Enter the printed code, or tap Start camera to try again.",
                  "La cámara no está disponible o se detuvo. Escribe el código o pulsa Iniciar cámara.",
                )}
              </p>
            )}
            <label className="block text-subhead">
              {text("Printed barcode", "Código impreso")}
              <input
                value={codeText}
                maxLength={40}
                inputMode="numeric"
                className="input-field w-full min-h-[44px]"
                onChange={(event) => setCodeText(event.target.value)}
                disabled={reading || locked}
              />
            </label>
            <label className="block text-subhead">
              {text("Code format", "Formato")}
              <select
                value={format}
                className="input-field w-full min-h-[44px]"
                onChange={(event) =>
                  setFormat(event.target.value as FoodBarcodeFormat)
                }
                disabled={reading || locked}
              >
                <option value="auto">
                  {text("12, 13 or 14 digits", "12, 13 o 14 dígitos")}
                </option>
                <option value="ean_8">EAN-8</option>
                <option value="upc_e">
                  UPC-E ·{" "}
                  {text("all 8 printed digits", "los 8 dígitos impresos")}
                </option>
              </select>
            </label>
            <button
              type="button"
              className="btn-filled min-h-[44px]"
              disabled={!context || reading || locked}
              onClick={() => {
                const code = normalizeFoodBarcode(codeText, format);
                if (!code)
                  setMessage(
                    text(
                      "Check every digit and format. For 8 digits choose EAN-8 or UPC-E; a code does not supply expiry or stock count.",
                      "Revisa los dígitos y el formato. Para 8 dígitos elige EAN-8 o UPC-E; el código no indica caducidad ni cantidad.",
                    ),
                  );
                else void add(code);
              }}
            >
              {text("Add code to review", "Añadir código a revisión")}
            </button>
          </div>
        ) : current ? (
          <div className="space-y-3">
            <label className="block text-subhead">
              {text("Item in review", "Alimento en revisión")}
              <select
                value={current.id}
                className="input-field min-h-[44px] w-full"
                disabled={saving || reading}
                onChange={(event) => setSelected(event.target.value)}
              >
                {rows.map((row, index) => (
                  <option value={row.id} key={row.id}>
                    {index + 1}. {row.name || row.code.code}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-footnote">
              {current.code.format} · {current.code.code}
            </p>
            {current.code.restricted && (
              <p className="text-footnote">
                {text(
                  "This may be a retailer or variable-measure code. Review it manually; no weight, price or expiry is inferred.",
                  "Puede ser un código local o de medida variable. Revísalo a mano; no se deducen peso, precio ni fecha.",
                )}
              </p>
            )}
            {reading && (
              <p role="status">
                {text(
                  "Reading product details…",
                  "Leyendo datos del producto…",
                )}
              </p>
            )}
            {current.lookupAvailable && !current.code.restricted && (
              <button
                type="button"
                className="btn-tinted min-h-[44px]"
                disabled={locked || reading}
                onClick={() => void metadata(current.id, current.code, true)}
              >
                {text(
                  "Look up with Open Food Facts",
                  "Buscar en Open Food Facts",
                )}
              </button>
            )}
            <button
              type="button"
              className="btn-tinted min-h-[44px]"
              disabled={locked || reading}
              onClick={() =>
                void metadata(current.id, current.code, false, true)
              }
            >
              {text(
                "Refresh household product; keep my edits",
                "Actualizar producto del hogar; conservar cambios",
              )}
            </button>
            {publicSuggestion?.rowId === current.id && (
              <aside className="rounded-xl bg-[var(--surface-fill)] p-3 space-y-2">
                <p className="font-semibold">{publicSuggestion.product.name}</p>
                <p>
                  {publicSuggestion.product.brand} ·{" "}
                  {publicSuggestion.product.package_size}
                </p>
                <a
                  href={
                    publicSuggestion.product.source_url ??
                    "https://world.openfoodfacts.org"
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] items-center"
                >
                  Open Food Facts · ODbL ↗
                </a>
                <button
                  type="button"
                  className="btn-tinted min-h-[44px]"
                  disabled={locked || reading}
                  onClick={() => {
                    if (
                      flight.current ||
                      readingRef.current ||
                      attempts.current.size
                    )
                      return;
                    const product = publicSuggestion.product;
                    update({
                      name: product.name,
                      brand: product.brand ?? "",
                      packageSize: product.package_size ?? "",
                      origin: product.origin,
                      sourceUrl: product.source_url,
                      imageUrl: product.image_url ?? null,
                    });
                    setPublicSuggestion(null);
                  }}
                >
                  {text(
                    "Use these details in my draft",
                    "Usar estos datos en mi borrador",
                  )}
                </button>
                <button
                  type="button"
                  className="btn-tinted min-h-[44px]"
                  disabled={locked || reading}
                  onClick={() => setPublicSuggestion(null)}
                >
                  {text("Keep my details", "Conservar mis datos")}
                </button>
              </aside>
            )}
            <p className="text-footnote text-label-secondary">
              {text(
                "Product details are suggestions. A lookup sends only the barcode. Package size is separate from your stock amount; confirm location and all dates.",
                "Los datos son sugerencias. La búsqueda envía solo el código. El tamaño del paquete es distinto de tus existencias; confirma lugar y fechas.",
              )}
            </p>
            {current.sourceUrl && (
              <a
                href={current.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center text-[var(--accent-text)]"
              >
                Open Food Facts · ODbL ↗
              </a>
            )}
            {current.imageUrl && (
              <figure>
                <Image
                  unoptimized
                  src={current.imageUrl}
                  alt={text(
                    "Product packaging from Open Food Facts",
                    "Envase del producto de Open Food Facts",
                  )}
                  width={96}
                  height={96}
                  referrerPolicy="no-referrer"
                />
                <figcaption className="text-footnote">
                  <a
                    href="https://creativecommons.org/licenses/by-sa/3.0/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open Food Facts · CC BY-SA
                  </a>
                </figcaption>
              </figure>
            )}
            <fieldset
              disabled={locked || reading}
              className="space-y-3 min-w-0"
            >
              <label className="flex min-h-[44px] items-center gap-2">
                <input
                  type="checkbox"
                  checked={current.include}
                  onChange={(event) =>
                    update({ include: event.target.checked })
                  }
                />
                {text("Include in this save", "Incluir en este guardado")}
              </label>
              <label className="block">
                {text("Food name", "Nombre del alimento")}
                <input
                  value={current.name}
                  maxLength={200}
                  className="input-field w-full min-h-[44px]"
                  onChange={(event) => update({ name: event.target.value })}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label>
                  {text("Brand", "Marca")}
                  <input
                    value={current.brand}
                    maxLength={120}
                    className="input-field w-full min-h-[44px]"
                    onChange={(event) => update({ brand: event.target.value })}
                  />
                </label>
                <label>
                  {text("Label package size", "Tamaño en la etiqueta")}
                  <input
                    value={current.packageSize}
                    maxLength={80}
                    className="input-field w-full min-h-[44px]"
                    placeholder="500 g / 6 × 200 ml"
                    onChange={(event) =>
                      update({ packageSize: event.target.value })
                    }
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label>
                  {text("Stock amount", "Cantidad disponible")}
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    step="any"
                    value={current.amount}
                    className="input-field w-full min-h-[44px]"
                    onChange={(event) => update({ amount: event.target.value })}
                  />
                </label>
                <label>
                  {text("Stock unit", "Unidad")}
                  <input
                    value={current.unit}
                    maxLength={32}
                    className="input-field w-full min-h-[44px]"
                    onChange={(event) => update({ unit: event.target.value })}
                  />
                </label>
              </div>
              <label className="block">
                {text("Storage", "Lugar")}
                <select
                  value={current.location}
                  className="input-field w-full min-h-[44px]"
                  onChange={(event) =>
                    update({ location: event.target.value as Row["location"] })
                  }
                >
                  <option value="fridge">
                    {text("Fridge", "Refrigerador")}
                  </option>
                  <option value="freezer">
                    {text("Freezer", "Congelador")}
                  </option>
                  <option value="pantry">{text("Pantry", "Despensa")}</option>
                </select>
              </label>
              <details>
                <summary className="min-h-[44px] cursor-pointer py-2">
                  {text("Dates (optional)", "Fechas (opcionales)")}
                </summary>
                <div className="grid grid-cols-2 gap-2">
                  <label>
                    {text("Label date", "Fecha de etiqueta")}
                    <input
                      type="date"
                      value={current.expires}
                      className="input-field w-full min-h-[44px]"
                      onChange={(event) =>
                        update({ expires: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    {text("Date means", "Significado")}
                    <select
                      value={current.dateKind}
                      className="input-field w-full min-h-[44px]"
                      onChange={(event) =>
                        update({
                          dateKind: event.target.value as Row["dateKind"],
                        })
                      }
                    >
                      <option value="best_before">
                        {text("Best before", "Consumo preferente")}
                      </option>
                      <option value="use_by">
                        {text("Use by", "Caducidad")}
                      </option>
                    </select>
                  </label>
                  <label>
                    {text("Purchased", "Comprado")}
                    <input
                      type="date"
                      value={current.purchased}
                      className="input-field w-full min-h-[44px]"
                      onChange={(event) =>
                        update({ purchased: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    {text("Opened", "Abierto")}
                    <input
                      type="date"
                      value={current.opened}
                      className="input-field w-full min-h-[44px]"
                      onChange={(event) =>
                        update({ opened: event.target.value })
                      }
                    />
                  </label>
                </div>
              </details>
              <label className="flex min-h-[44px] items-center gap-2">
                <input
                  type="checkbox"
                  checked={current.remember}
                  onChange={(event) =>
                    update({ remember: event.target.checked })
                  }
                />
                {text(
                  "Remember these product details privately for our household",
                  "Recordar estos datos solo para nuestro hogar",
                )}
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-tinted min-h-[44px]"
                  disabled={
                    current.unit !== "packages" ||
                    !Number.isFinite(Number(current.amount)) ||
                    Number(current.amount) >= 100000
                  }
                  onClick={() =>
                    update({ amount: String(Number(current.amount) + 1) })
                  }
                >
                  +1 {text("package", "paquete")}
                </button>
                <button
                  type="button"
                  className="btn-tinted min-h-[44px]"
                  disabled={rows.length >= 20}
                  onClick={() => {
                    if (
                      flight.current ||
                      readingRef.current ||
                      attempts.current.size
                    )
                      return;
                    const id = newIdempotencyKey();
                    setRows((previous) => [
                      ...previous,
                      {
                        ...current,
                        id,
                        amount: "1",
                        expires: "",
                        purchased: "",
                        opened: "",
                        remember: false,
                        uncertain: false,
                      },
                    ]);
                    setSelected(id);
                  }}
                >
                  {text("Separate dated lot", "Lote separado")}
                </button>
                <button
                  type="button"
                  className="btn-tinted min-h-[44px]"
                  onClick={() => {
                    if (
                      !flight.current &&
                      !readingRef.current &&
                      !attempts.current.size
                    )
                      setRows((previous) =>
                        previous.filter((row) => row.id !== current.id),
                      );
                  }}
                >
                  {text("Remove draft", "Quitar borrador")}
                </button>
              </div>
            </fieldset>
            <button
              type="button"
              className="btn-filled min-h-[44px] w-full"
              disabled={saving || reading || !rows.some((row) => row.include)}
              onClick={() => void save()}
            >
              {saving
                ? text("Saving…", "Guardando…")
                : unknown
                  ? text(
                      "Check the same saves",
                      "Comprobar los mismos guardados",
                    )
                  : text(
                      "Save selected reviewed items",
                      "Guardar alimentos revisados",
                    )}
            </button>
          </div>
        ) : (
          <p>
            {text(
              "No items in review. Add a code to start.",
              "No hay alimentos en revisión. Añade un código.",
            )}
          </p>
        )}
      </div>
    </Dialog>
  );
}
