"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Dialog } from "@/components/ui/dialog";
import { useBarcodeFoodText, barcodeFeedback, type BarcodeFoodFeedback } from "@/i18n/barcode-food";
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
  type IntakeContext,
  type IntakeIntent,
} from "@/lib/inventory-intake-client";
import { createInventorySchema } from "@/lib/inventory";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import { useFoodBarcodeCamera } from "@/components/inventory/use-food-barcode-camera";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import { runOwnedForeground } from "@/lib/owned-request-http";
import { readBoundedJsonResponse } from "@/lib/bounded-json-response";
import { useInventoryWrites } from "@/components/inventory/InventoryRecovery";
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
  suspended = false,
  onVerifyAccess,
  onClose,
  onDone,
}: {
  initialContext?: IntakeContext;
  suspended?: boolean;
  onVerifyAccess?: () => void;
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  const { intake: sendIntake } = useInventoryWrites();
  const text = useBarcodeFoodText();
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
  const [message, setMessage] = useState<BarcodeFoodFeedback | null>(null);
  const [publicSuggestion, setPublicSuggestion] = useState<{
    rowId: string;
    product: FoodProductSummary;
  } | null>(null);
  const flight = useRef(false);
  const readingRef = useRef(false);
  const requests = useRef(new Set<AbortController>());
  const live = useRef(true);
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
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
    void readInventoryIntakeContext(request.signal)
      .then((value) => {
        if (live.current && active && !request.signal.aborted && !suspendedRef.current) setContext(value);
      })
      .catch(() => {
        if (live.current && active && !request.signal.aborted && !suspendedRef.current)
          setMessage(barcodeFeedback("contextFailed"));
      })
      .finally(() => {
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
  useEffect(() => {
    if (suspended) {
      camera.stop();
      requests.current.forEach((request) => request.abort());
    }
  }, [suspended, camera.stop]);
  const current = rows.find((row) => row.id === selected) ?? rows[0];
  function update(change: Partial<Row>) {
    if (
      suspended ||
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
      suspended ||
      readingRef.current ||
      flight.current ||
      attempts.current.size
    )
      return;
    readingRef.current = true;
    setReading(true);
    const request = new AbortController();
    requests.current.add(request);
    const currentRequest = () => live.current && !suspendedRef.current && !request.signal.aborted;
    try {
      const result = await runOwnedForeground(async (signal) => {
        const response = await fetch(
          `/api/inventory/products?barcode=${code.gtin}${publicLookup ? "&lookup=1" : ""}`,
          { cache: "no-store", credentials: "same-origin", signal },
        );
        // Access refusals do not depend on a readable error body.
        const body = response.ok
          ? await readBoundedJsonResponse(response, signal, 64 * 1024)
          : null;
        return { response, body };
      }, { signal: request.signal, timeoutMs: 10000 });
      if (!currentRequest()) return;
      if ("kind" in result) throw new Error();
      if (result.response.status === 401 || result.response.status === 403)
        onVerifyAccess?.();
      if (!result.response.ok) throw new Error();
      const data = foodProductReply.parse(result.body);
      if (
        data.barcode !== code.gtin ||
        data.context.userId !== context.userId ||
        data.context.familyId !== context.familyId
      )
        throw new Error();
      if (!currentRequest()) return;
      if (publicLookup && data.product) {
        setPublicSuggestion({ rowId, product: data.product });
        setMessage(barcodeFeedback("detailsFound"));
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
            ? barcodeFeedback("householdChanged", { name: data.product.name })
            : barcodeFeedback("householdMissing"),
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
        setMessage(barcodeFeedback("detailsMissing"));
    } catch {
      if (currentRequest())
        setMessage(barcodeFeedback("detailsUnavailable"));
    } finally {
      requests.current.delete(request);
      readingRef.current = false;
      if (live.current) setReading(false);
    }
  }
  async function add(code: FoodBarcode) {
    if (
      !context ||
      suspended ||
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
      setMessage(barcodeFeedback("alreadyReview"));
      return;
    }
    if (rowsRef.current.length >= 20) {
      setMessage(barcodeFeedback("rowLimit"));
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
    if (suspended || flight.current || attempts.current.size) return;
    camera.stop();
    requests.current.forEach((request) => request.abort());
    total.current ? onDone(total.current) : onClose();
  }
  async function save() {
    if (suspended) return;
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
      setMessage(barcodeFeedback("reviewRequired"));
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
      const result = await sendIntake(attempt.intent);
      if (result.kind === "refused" && result.accessChanged) onVerifyAccess?.();
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
        setMessage(barcodeFeedback("sourceChanged"));
      } else if (result.kind === "unknown" || attempt.uncertain) {
        attempt.uncertain = true;
        rowsRef.current = rowsRef.current.map((value) =>
          value.id === row.id ? { ...value, uncertain: true } : value,
        );
        setRows(rowsRef.current);
      } else {
        attempts.current.delete(row.id);
        setMessage(barcodeFeedback("saveRefused"));
      }
    }
    if (!attempts.current.size) await navigation.releaseBeforeNavigation();
    flight.current = false;
    setSaving(false);
    if (!failed && !rowsRef.current.length) onDone(total.current);
    else if (failed)
      setMessage(barcodeFeedback("partialResult", { confirmed: total.current, failed }));
  }
  return (
    <Dialog
      open={!suspended}
      variant="form"
      title={text("title")}
      closeLabel={text("close")}
      onClose={locked ? undefined : close}
      className="sm:max-w-2xl"
    >
      <div className="space-y-4">
        {!context && (
          <div role="status">
            <p>{text("checking")}</p>
            <button
              type="button"
              className="btn-tinted min-h-[44px]"
              onClick={() => setContextAttempt((value) => value + 1)}
            >
              {text("retry")}
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
            {text("addCodes")}
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
            {text("reviewCount", { count: rows.length })}
          </button>
        </div>
        {message && (
          <p role="status" className="text-subhead">
            {text(message.key, message.params)}
          </p>
        )}
        {unknown && (
          <p role="alert">
            {text("uncertain")}
          </p>
        )}
        <video
          ref={camera.video}
          muted
          playsInline
          hidden={!camera.active}
          className="w-full max-h-64 rounded-2xl object-cover"
          aria-label={text("cameraPreview")}
        />
        {!review ? (
          <div className="space-y-3">
            <p className="text-footnote text-label-secondary">
              {text("cameraPrivacy")}
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
                ? text("stopCamera")
                : text("startCamera")}
            </button>
            {camera.error && (
              <p role="status">
                {text("cameraUnavailable")}
              </p>
            )}
            <label className="block text-subhead">
              {text("printedCode")}
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
              {text("format")}
              <select
                value={format}
                className="input-field w-full min-h-[44px]"
                onChange={(event) =>
                  setFormat(event.target.value as FoodBarcodeFormat)
                }
                disabled={reading || locked}
              >
                <option value="auto">
                  {text("standardDigits")}
                </option>
                <option value="ean_8">EAN-8</option>
                <option value="upc_e">
                  UPC-E ·{" "}
                  {text("eightDigits")}
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
                  setMessage(barcodeFeedback("invalidCode"));
                else void add(code);
              }}
            >
              {text("addCode")}
            </button>
          </div>
        ) : current ? (
          <div className="space-y-3">
            <label className="block text-subhead">
              {text("currentItem")}
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
                {text("variableCode")}
              </p>
            )}
            {reading && (
              <p role="status">
                {text("reading")}
              </p>
            )}
            {current.lookupAvailable && !current.code.restricted && (
              <button
                type="button"
                className="btn-tinted min-h-[44px]"
                disabled={locked || reading}
                onClick={() => void metadata(current.id, current.code, true)}
              >
                {text("lookupPublic")}
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
              {text("refreshPrivate")}
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
                  {text("applyDetails")}
                </button>
                <button
                  type="button"
                  className="btn-tinted min-h-[44px]"
                  disabled={locked || reading}
                  onClick={() => setPublicSuggestion(null)}
                >
                  {text("keepDetails")}
                </button>
              </aside>
            )}
            <p className="text-footnote text-label-secondary">
              {text("lookupPrivacy")}
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
                  alt={text("productImage")}
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
                {text("include")}
              </label>
              <label className="block">
                {text("name")}
                <input
                  value={current.name}
                  maxLength={200}
                  className="input-field w-full min-h-[44px]"
                  onChange={(event) => update({ name: event.target.value })}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label>
                  {text("brand")}
                  <input
                    value={current.brand}
                    maxLength={120}
                    className="input-field w-full min-h-[44px]"
                    onChange={(event) => update({ brand: event.target.value })}
                  />
                </label>
                <label>
                  {text("packageSize")}
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
                  {text("amount")}
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
                  {text("unit")}
                  <input
                    value={current.unit}
                    maxLength={32}
                    className="input-field w-full min-h-[44px]"
                    onChange={(event) => update({ unit: event.target.value })}
                  />
                </label>
              </div>
              <label className="block">
                {text("storage")}
                <select
                  value={current.location}
                  className="input-field w-full min-h-[44px]"
                  onChange={(event) =>
                    update({ location: event.target.value as Row["location"] })
                  }
                >
                  <option value="fridge">
                    {text("fridge")}
                  </option>
                  <option value="freezer">
                    {text("freezer")}
                  </option>
                  <option value="pantry">{text("pantry")}</option>
                </select>
              </label>
              <details>
                <summary className="min-h-[44px] cursor-pointer py-2">
                  {text("dates")}
                </summary>
                <div className="grid grid-cols-2 gap-2">
                  <label>
                    {text("labelDate")}
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
                    {text("dateKind")}
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
                        {text("bestBefore")}
                      </option>
                      <option value="use_by">
                        {text("useBy")}
                      </option>
                    </select>
                  </label>
                  <label>
                    {text("purchased")}
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
                    {text("opened")}
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
                {text("remember")}
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
                  +1 {text("package")}
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
                  {text("separateLot")}
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
                  {text("removeDraft")}
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
                ? text("saving")
                : unknown
                  ? text("checkSaves")
                  : text("saveSelected")}
            </button>
          </div>
        ) : (
          <p>
            {text("empty")}
          </p>
        )}
      </div>
    </Dialog>
  );
}
