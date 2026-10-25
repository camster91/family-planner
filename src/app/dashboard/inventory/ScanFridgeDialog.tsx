"use client";

/**
 * "Scan fridge" (#265): take or choose a photo, let the vision model suggest
 * items (POST /api/inventory/scan, which writes nothing), review and edit the
 * suggestions, then add the ticked ones through the ordinary
 * versioned POST /api/inventory/intake, one at a time.
 *
 * Retries never duplicate: each row carries one `Idempotency-Key` for its
 * whole life, so a create that committed but lost its response is replayed on
 * retry instead of adding a second row, and rows that were added leave the
 * list, so "Add" after a partial failure only sends what is left.
 *
 * Built on the shared `Dialog` (aria-modal, focus moved in, Tab kept inside,
 * focus restored to the Scan button on close). Focus also moves to the new
 * content whenever the step changes. Escape, the Close button and "done" all
 * go through `close()`, which reports items already added (reload + notice).
 *
 * Suggestions are untrusted model text: they are only ever rendered as React
 * text and input values. Confidence is shown in words, never colour alone.
 */
import * as React from "react";
import { z } from "zod";
import {
  FOOD_PHOTO_PROTOCOL,
  foodPhotoReply,
  type FoodPhotoMode,
  type FoodPhotoItem,
} from "@/lib/food-photo-contract";
import { Camera, Loader2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import { runOwnedForeground } from "@/lib/owned-request-http";
import { readBoundedJsonResponse } from "@/lib/bounded-json-response";
import {
  readInventoryIntakeContext,
  makeInventoryIntakeIntent,
  type IntakeContext,
  type IntakeIntent,
  type IntakeOutcome,
} from "@/lib/inventory-intake-client";
import { createInventorySchema } from "@/lib/inventory";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import { useInventoryWrites } from "@/components/inventory/InventoryRecovery";
import { INVENTORY_LOCATIONS, type InventoryLocation } from "@/lib/inventory";
import type { ScanSuggestion } from "@/lib/inventory-scan";
import { PRODUCT_BRAND } from "@/lib/brand";
import {
  inventoryFeedback as feedback,
  inventoryFeedbackEnglish,
  photoAddedFeedback,
  partialScanFeedback,
  type InventoryFeedback,
} from "@/i18n/inventory";
import { InventoryText, useInventoryCopy } from "./inventory-copy";

/** Must match INVENTORY_SCAN_MAX_BYTES in src/lib/inventory-scan.ts (kept literal to stay out of the server module). */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/** Longest edge sent to the provider; larger photos are downscaled in the browser when it can decode them. */
const MAX_EDGE = 1568;
const suggestionsResponse = z.object({
  items: z
    .array(
      z
        .object({
          name: z.string().min(1).max(80),
          amount: z.number().finite().min(0).max(100000).nullable(),
          unit: z.string().max(32).nullable(),
          location: z.enum(INVENTORY_LOCATIONS).nullable(),
          confidence: z.number().min(0).max(1),
        })
        .strict(),
    )
    .max(50),
});

interface Row {
  key: string;
  include: boolean;
  name: string;
  amount: string;
  unit: string;
  location: InventoryLocation;
  expiresOn: string;
  dateKind: "best_before" | "use_by";
  document: boolean;
  packageSize: string;
  printedDate: {
    text: string;
    candidate: string | null;
    kind: "best_before" | "use_by" | null;
  } | null;
  confidence: number;
  error: InventoryFeedback | null;
  /** Sent with every create attempt of this row, so an in-doubt create is replayed, not repeated. */
  idempotencyKey: string;
  uncertain?: boolean;
}

type Phase =
  | { step: "pick" }
  | { step: "scanning" }
  | { step: "review" }
  | { step: "error"; message: InventoryFeedback };

export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return "Likely";
  if (confidence >= 0.5) return "Check this";
  return "Unsure";
}

function toRows(
  items: (ScanSuggestion | FoodPhotoItem)[],
  document = false,
): Row[] {
  return items.map((item, i) => ({
    key: `s${i}`,
    include: !document && item.confidence >= 0.5,
    name: item.name,
    amount: item.amount === null ? "" : String(item.amount),
    unit: item.unit ?? "",
    location: item.location ?? "fridge",
    expiresOn: "",
    dateKind: "best_before",
    document,
    packageSize: "package_size" in item ? (item.package_size ?? "") : "",
    printedDate:
      "date_text" in item && item.date_text
        ? {
            text: item.date_text,
            candidate: item.date_candidate,
            kind: item.date_kind,
          }
        : null,
    confidence: item.confidence,
    error: null,
    idempotencyKey: newIdempotencyKey(),
  }));
}

/** Downscale to MAX_EDGE as JPEG where the browser can decode the photo; otherwise send it unchanged. */
async function prepareImage(file: Blob): Promise<Blob> {
  if (
    typeof createImageBitmap !== "function" ||
    typeof document === "undefined"
  )
    return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (
      scale === 1 &&
      file.size <= 4 * 1024 * 1024 &&
      /^image\/(jpeg|png|webp)$/.test(file.type)
    ) {
      bitmap.close?.();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

function scanError(res: Response, body: unknown): InventoryFeedback {
  let message: string | null = null;
  const err = body && typeof body === "object" && "error" in body ? body.error : null;
  if (typeof err === "string") message = err;
  else if (err && typeof err === "object" && "message" in err && typeof err.message === "string") message = err.message;
  if (res.status === 404) return feedback("scanUnavailable");
  if (res.status === 403)
    return message !== null ? { raw: message } : feedback("scanForbidden");
  if ([400, 413, 415, 429, 502].includes(res.status) && message)
    return { raw: message };
  return feedback("scanFailed");
}

export function ScanFridgeDialog({
  initialContext,
  suspended = false,
  onVerifyAccess,
  canCaptureDocuments = false,
  onClose,
  onDone,
  onFeedback,
}: {
  initialContext?: IntakeContext;
  suspended?: boolean;
  onVerifyAccess?: () => void;
  canCaptureDocuments?: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  /** Opt-in semantic feedback; legacy consumers still receive their original English string. */
  onFeedback?: (message: InventoryFeedback) => void;
}) {
  const copy = useInventoryCopy();
  const { intake: sendIntake } = useInventoryWrites();
  const report = (message: InventoryFeedback) =>
    onFeedback
      ? onFeedback(message)
      : onDone(inventoryFeedbackEnglish(message));
  const [phase, setPhase] = React.useState<Phase>({ step: "pick" });
  const [rows, setRows] = React.useState<Row[]>([]);
  const [captureMode, setCaptureMode] = React.useState<
    FoodPhotoMode | "fridge"
  >("fridge");
  const [receiptReady, setReceiptReady] = React.useState(false);
  const [dropped, setDropped] = React.useState(0);
  const [reviewPage, setReviewPage] = React.useState(0);
  const page = Math.min(reviewPage, Math.max(0, rows.length - 1));
  const visibleRows =
    captureMode === "fridge" ? rows : rows.slice(page, page + 1);
  const [adding, setAdding] = React.useState(false);
  const [addError, setAddError] = React.useState<InventoryFeedback | null>(
    null,
  );
  const [addedCount, setAddedCount] = React.useState(0);
  const addedCountRef = React.useRef(0);
  const [context, setContext] = React.useState<IntakeContext | null>(
    initialContext ?? null,
  );
  const [contextFailed, setContextFailed] = React.useState(false);
  const [contextAttempt, setContextAttempt] = React.useState(0);
  const attempts = React.useRef(
    new Map<string, { intent: IntakeIntent; uncertain: boolean }>(),
  );
  const addingRef = React.useRef(false);
  const scanningRef = React.useRef(false);
  const photoRequest = React.useRef<AbortController | null>(null);
  const photoGeneration = React.useRef(0);
  const live = React.useRef(true);
  const suspendedRef = React.useRef(suspended);
  const saveEpoch = React.useRef(0);
  if (suspendedRef.current !== suspended) {
    saveEpoch.current++;
    suspendedRef.current = suspended;
  }
  React.useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      saveEpoch.current++;
      photoGeneration.current++;
      photoRequest.current?.abort();
    };
  }, []);
  React.useEffect(() => {
    if (!suspended) return;
    photoGeneration.current++;
    photoRequest.current?.abort();
    scanningRef.current = false;
    setPhase((previous) =>
      previous.step === "scanning"
        ? { step: "error", message: feedback("scanNetwork") }
        : previous,
    );
  }, [suspended]);
  const uncertain = rows.some((row) => row.uncertain);
  const navigation = usePendingFormNavigationController(adding || uncertain);
  React.useEffect(() => {
    if (initialContext) return;
    let active = true;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 10000);
    setContext(null);
    setContextFailed(false);
    void readInventoryIntakeContext(controller.signal)
      .then((scope) => {
        if (active) setContext(scope);
      })
      .catch(() => {
        if (active) setContextFailed(true);
      })
      .finally(() => clearTimeout(deadline));
    return () => {
      active = false;
      clearTimeout(deadline);
      controller.abort();
    };
  }, [contextAttempt, initialContext]);

  const titleId = React.useId();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const pickButtonRef = React.useRef<HTMLButtonElement | null>(null);
  // Focus target of the current step. Dialog focuses the first one on open;
  // after that, focus follows every step change so it never falls to <body>.
  const stepFocusRef = React.useRef<HTMLElement | null>(null);
  const setStepFocus = React.useCallback((el: HTMLElement | null) => {
    if (el) stepFocusRef.current = el;
  }, []);
  const opened = React.useRef(false);
  React.useEffect(() => {
    if (!opened.current) {
      opened.current = true;
      return;
    }
    stepFocusRef.current?.focus();
  }, [phase]);

  const pickAgain = () => {
    if (addingRef.current || attempts.current.size > 0 || scanningRef.current)
      return;
    setPhase({ step: "pick" });
    setReceiptReady(false);
    setRows([]);
    setAddError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (
      !file ||
      suspended ||
      !context ||
      (captureMode === "receipt" && !receiptReady) ||
      addingRef.current ||
      attempts.current.size > 0 ||
      scanningRef.current
    )
      return;
    if (captureMode === "receipt") setReceiptReady(false);
    scanningRef.current = true;
    const own = ++photoGeneration.current;
    const request = new AbortController();
    const current = () => own === photoGeneration.current && live.current && !suspendedRef.current && !request.signal.aborted;
    photoRequest.current = request;
    setPhase({ step: "scanning" });
    setAddError(null);
    try {
      const result = await runOwnedForeground(async (signal) => {
        const image = await prepareImage(file);
        // Late decoding must never start an upload after its foreground deadline.
        if (!current() || signal.aborted) throw new Error("Retired photo preparation");
        if (image.size > MAX_UPLOAD_BYTES) return { kind: "large" as const };
        const form = new FormData();
        form.append("image", image, "food.jpg");
        if (captureMode !== "fridge") {
          form.append("protocol", FOOD_PHOTO_PROTOCOL);
          form.append("capture_mode", captureMode);
          form.append("expected_user_id", context.userId);
          form.append("expected_family_id", context.familyId);
        }
        const res = await fetch("/api/inventory/scan", {
          method: "POST", body: form, cache: "no-store",
          credentials: "same-origin", signal,
        });
        if (!current() || signal.aborted) throw new Error("Retired photo response");
        // An access refusal is useful without waiting for an error body.
        const body = [401, 403].includes(res.status) ? null
          : await readBoundedJsonResponse(res, signal, 256 * 1024).catch(error => {
              if (res.ok) throw error;
              return null;
            });
        return { kind: "reply" as const, res, body };
      }, { signal: request.signal, timeoutMs: 60000 });
      if (!current()) return;
      if (result.kind === "unknown") {
        setPhase({ step: "error", message: feedback("scanNetwork") });
        return;
      }
      if (result.kind === "large") {
        setPhase({ step: "error", message: feedback("photoLarge") });
        return;
      }
      const { res, body: response } = result;
      if (!res.ok) {
        if ([401, 403].includes(res.status)) onVerifyAccess?.();
        const message = scanError(res, response);
        if (current()) setPhase({ step: "error", message });
        return;
      }
      if (captureMode === "fridge") {
        const parsed = suggestionsResponse
          .extend({ dropped: z.number().int().nonnegative().optional() })
          .safeParse(response);
        if (!parsed.success) {
          setPhase({ step: "error", message: feedback("scanFailed") });
          return;
        }
        setRows(toRows(parsed.data.items));
        setDropped(parsed.data.dropped ?? 0);
      } else {
        const parsed = foodPhotoReply.safeParse(response);
        if (!parsed.success || parsed.data.capture_mode !== captureMode) {
          setPhase({ step: "error", message: feedback("scanFailed") });
          return;
        }
        setRows(toRows(parsed.data.items, true));
        setDropped(parsed.data.dropped);
      }
      setReviewPage(0);
      setPhase({ step: "review" });
    } catch {
      if (current())
        setPhase({ step: "error", message: feedback("scanNetwork") });
    } finally {
      if (current()) {
        photoRequest.current = null;
        scanningRef.current = false;
        if (inputRef.current) inputRef.current.value = "";
      }
    }
  };

  const update = (key: string, patch: Partial<Row>) =>
    setRows((prev) =>
      prev.map((r) =>
        r.key === key && !addingRef.current && !attempts.current.has(key)
          ? { ...r, ...patch, error: null }
          : r,
      ),
    );

  const selected = rows.filter((r) => r.include);

  const addSelected = async () => {
    if (suspended || addingRef.current || !context) return;
    setAddError(null);
    const selectedRows = rows.filter((row) => row.include);
    if (!selectedRows.length) return;
    let invalid = false;
    for (const row of selectedRows) {
      if (attempts.current.has(row.key)) continue;
      const item = createInventorySchema.safeParse({
        name: row.name.trim(),
        location: row.location,
        amount: row.amount.trim() === "" ? null : Number(row.amount),
        unit: row.unit.trim() || null,
        expires_on: row.expiresOn || null,
        date_kind: row.dateKind,
      });
      if (!item.success || row.packageSize.length > 80) {
        invalid = true;
        setRows((previous) =>
          previous.map((value) =>
            value.key === row.key
              ? {
                  ...value,
                  error: feedback(
                    !row.name.trim()
                      ? "enterName"
                      : row.amount.trim() !== "" &&
                          (!Number.isFinite(Number(row.amount)) ||
                            Number(row.amount) < 0 ||
                            Number(row.amount) > 100000)
                        ? "amountInvalid"
                        : "fixRows",
                  ),
                }
              : value,
          ),
        );
      }
    }
    if (invalid) {
      setAddError(feedback("fixRows"));
      return;
    }
    addingRef.current = true;
    setAdding(true);
    let failed = 0;
    const epoch = saveEpoch.current;
    const currentSave = () => live.current && !suspendedRef.current && saveEpoch.current === epoch;
    const keepUncertain = (rowKey: string, attempt: { intent: IntakeIntent; uncertain: boolean }) => {
      attempt.uncertain = true;
      if (live.current) setRows(previous => previous.map(value => value.key === rowKey
        ? { ...value, uncertain: true, error: feedback("intakeUnknown") } : value));
    };
    try {
      for (const row of selectedRows) {
        if (!currentSave()) return;
        let attempt = attempts.current.get(row.key);
        if (!attempt) {
          attempt = {
            intent: makeInventoryIntakeIntent(
              {
                name: row.name.trim(),
                location: row.location,
                amount: row.amount.trim() === "" ? null : Number(row.amount),
                unit: row.unit.trim() || null,
                expires_on: row.expiresOn || null,
                date_kind: row.dateKind,
              },
              context,
              row.idempotencyKey,
              undefined,
              row.document
                ? { package_size: row.packageSize.trim() || null }
                : undefined,
            ),
            uncertain: false,
          };
          attempts.current.set(row.key, attempt);
        }
        let outcome: IntakeOutcome;
        try {
          outcome = await sendIntake(attempt.intent);
        } catch {
          outcome = { kind: "unknown" };
        }
        if (!currentSave()) {
          keepUncertain(row.key, attempt);
          return;
        }
        const accessChanged = outcome.kind === "refused" && outcome.accessChanged;
        if (accessChanged) onVerifyAccess?.();
        if (outcome.kind === "confirmed") {
          attempts.current.delete(row.key);
          addedCountRef.current++;
          setAddedCount(addedCountRef.current);
          setRows((previous) =>
            previous.filter((value) => value.key !== row.key),
          );
          continue;
        }
        failed++;
        if (outcome.kind === "removed") {
          attempts.current.delete(row.key);
          setRows((previous) =>
            previous.map((value) =>
              value.key === row.key
                ? {
                    ...value,
                    include: false,
                    uncertain: false,
                    idempotencyKey: newIdempotencyKey(),
                    error: feedback("intakeRemoved"),
                  }
                : value,
            ),
          );
          continue;
        }
        if (outcome.kind === "unknown" || attempt.uncertain) {
          keepUncertain(row.key, attempt);
        } else {
          attempts.current.delete(row.key);
          setRows((previous) =>
            previous.map((value) =>
              value.key === row.key
                ? {
                    ...value,
                    idempotencyKey: newIdempotencyKey(),
                    error: feedback("intakeRefused"),
                  }
                : value,
            ),
          );
        }
        if (accessChanged) return;
      }
      if (!currentSave()) return;
      const total = addedCountRef.current;
      if (!attempts.current.size) {
        const released = await navigation.releaseBeforeNavigation();
        if (!released || !currentSave()) return;
      }
      if (!failed) report(photoAddedFeedback(total));
      else setAddError(partialScanFeedback(total, failed));
    } finally {
      addingRef.current = false;
      if (live.current) setAdding(false);
    }
  };

  /** The only way out (Escape or Close): report anything already added so the page reloads. */
  const close = () => {
    if (addingRef.current || attempts.current.size > 0) return;
    photoGeneration.current++;
    photoRequest.current?.abort();
    if (addedCountRef.current > 0)
      report(photoAddedFeedback(addedCountRef.current));
    else onClose();
  };

  return (
    <Dialog
      open={!suspended}
      onClose={adding || uncertain ? undefined : close}
      title={copy(canCaptureDocuments ? "foodPhotoTitle" : "scanTitle")}
      closeLabel={copy("close")}
      testId="scan-dialog"
      className="sm:max-w-xl"
      initialFocusRef={pickButtonRef}
    >
      <div
        aria-busy={phase.step === "scanning" || adding}
        className="space-y-4"
      >
        {!context && (
          <p role={contextFailed ? "alert" : "status"}>
            {copy(
              contextFailed ? "intakeContextFailed" : "intakeContextLoading",
            )}
          </p>
        )}
        {contextFailed && (
          <button
            type="button"
            className="btn-tinted min-h-[44px]"
            onClick={() => setContextAttempt((value) => value + 1)}
          >
            {copy("intakeRetryContext")}
          </button>
        )}
        {uncertain && (
          <p role="status" className="text-footnote">
            {copy("intakeUnknown")}
          </p>
        )}

        {/* The file input stays mounted (visually hidden) so "Take or choose a photo" works from every step. */}
        <input
          ref={inputRef}
          id={`${titleId}-photo`}
          data-testid="scan-file-input"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onFile}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />

        {phase.step === "pick" && (
          <div className="space-y-4">
            {canCaptureDocuments && (
              <fieldset className="space-y-2">
                <legend className="text-subhead font-semibold">
                  {copy("foodPhotoMode")}
                </legend>
                <div className="grid grid-cols-3 gap-2">
                  {(["fridge", "package", "receipt"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={captureMode === mode}
                      className={cn(
                        "min-h-[44px] rounded-xl border p-2 text-subhead",
                        captureMode === mode
                          ? "border-[var(--accent)] bg-[var(--accent-tint)]"
                          : "border-[var(--surface-separator)]",
                      )}
                      onClick={() => {
                        setCaptureMode(mode);
                        setReceiptReady(false);
                      }}
                    >
                      {copy(
                        mode === "fridge"
                          ? "foodPhotoFridge"
                          : mode === "package"
                            ? "foodPhotoPackage"
                            : "foodPhotoReceipt",
                      )}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            <p className="text-body text-label-primary">
              {copy(
                captureMode === "fridge"
                  ? "scanIntro"
                  : captureMode === "package"
                    ? "foodPhotoPackageIntro"
                    : "foodPhotoReceiptIntro",
              )}
            </p>
            {captureMode === "receipt" && (
              <label className="flex min-h-[44px] items-center gap-3 text-subhead">
                <input
                  type="checkbox"
                  checked={receiptReady}
                  onChange={(event) => setReceiptReady(event.target.checked)}
                />
                {copy("foodPhotoRedacted")}
              </label>
            )}
            <p
              className="text-footnote text-label-secondary"
              data-testid="scan-privacy-note"
            >
              {copy("scanPrivacy", {
                provider: "Anthropic",
                brand: PRODUCT_BRAND.name,
              })}
            </p>
            <button
              ref={(el) => {
                pickButtonRef.current = el;
                setStepFocus(el);
              }}
              type="button"
              className="btn-tinted w-full min-h-[44px]"
              disabled={
                !context ||
                adding ||
                uncertain ||
                (captureMode === "receipt" && !receiptReady)
              }
              onClick={() => inputRef.current?.click()}
            >
              <Camera className="w-4 h-4" aria-hidden="true" />
              <span>{copy("pickPhoto")}</span>
            </button>
          </div>
        )}

        {phase.step === "scanning" && (
          <div
            ref={setStepFocus}
            tabIndex={-1}
            role="status"
            data-testid="scan-loading"
            className="flex items-center gap-3 py-6 justify-center text-body text-label-primary outline-none"
          >
            <Loader2
              className="w-5 h-5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            <span>{copy("scanning")}</span>
          </div>
        )}

        {phase.step === "error" && (
          <div className="space-y-4">
            <p
              role="alert"
              className="text-body text-[var(--danger-text)]"
              data-testid="scan-error"
            >
              <InventoryText feedback={phase.message} />
            </p>
            <button
              ref={setStepFocus}
              type="button"
              className="btn-tinted w-full min-h-[44px]"
              disabled={!context || adding || uncertain}
              onClick={() =>
                captureMode === "receipt"
                  ? pickAgain()
                  : inputRef.current?.click()
              }
            >
              <Camera className="w-4 h-4" aria-hidden="true" />
              <span>{copy("tryPhoto")}</span>
            </button>
          </div>
        )}

        {phase.step === "review" &&
          (rows.length === 0 ? (
            <div className="space-y-4">
              <p
                ref={setStepFocus}
                tabIndex={-1}
                className="text-body text-label-primary outline-none"
                role="status"
              >
                {copy(addedCount > 0 ? "scanAllAdded" : "scanEmpty")}
              </p>
              <button
                type="button"
                className="btn-tinted w-full min-h-[44px]"
                disabled={!context || adding || uncertain}
                onClick={() =>
                  captureMode === "receipt"
                    ? pickAgain()
                    : inputRef.current?.click()
                }
              >
                <Camera className="w-4 h-4" aria-hidden="true" />
                <span>
                  {copy(addedCount > 0 ? "anotherPhoto" : "tryPhoto")}
                </span>
              </button>
            </div>
          ) : (
            <>
              <p
                ref={setStepFocus}
                tabIndex={-1}
                role="status"
                data-testid="scan-found"
                className="text-subhead text-label-secondary outline-none"
              >
                {copy(rows.length === 1 ? "foundOne" : "foundMany", {
                  count: rows.length,
                })}
              </p>
              {captureMode !== "fridge" && (
                <p className="text-footnote text-label-secondary">
                  {copy("foodPhotoReview")}
                </p>
              )}
              {dropped > 0 && (
                <p role="status" className="text-footnote">
                  {copy("foodPhotoDropped", { count: dropped })}
                </p>
              )}
              <ul className="space-y-3" aria-label={copy("suggested")}>
                {visibleRows.map((row, i) => (
                  <SuggestionRow
                    key={row.key}
                    row={row}
                    index={captureMode === "fridge" ? i : page + i}
                    idBase={titleId}
                    disabled={adding || !!row.uncertain}
                    onChange={update}
                  />
                ))}
              </ul>
              {captureMode !== "fridge" && rows.length > 1 && (
                <nav
                  aria-label={copy("foodPhotoPages")}
                  className="flex items-center justify-between gap-2"
                >
                  <button
                    type="button"
                    className="btn-plain min-h-[44px]"
                    disabled={adding || page === 0}
                    onClick={() => setReviewPage(page - 1)}
                  >
                    {copy("foodPhotoPrevious")}
                  </button>
                  <span role="status" className="text-footnote">
                    {copy("foodPhotoPage", {
                      page: page + 1,
                      total: rows.length,
                    })}
                  </span>
                  <button
                    type="button"
                    className="btn-plain min-h-[44px]"
                    disabled={adding || page + 1 >= rows.length}
                    onClick={() => setReviewPage(page + 1)}
                  >
                    {copy("foodPhotoNext")}
                  </button>
                </nav>
              )}
              <div className="sticky -bottom-6 -mx-6 -mb-6 border-t border-[var(--surface-separator)] bg-[var(--surface-elevated)] px-6 py-4 space-y-2">
                {addError && (
                  <p
                    role="alert"
                    className="text-subhead text-[var(--danger-text)]"
                  >
                    <InventoryText feedback={addError} />
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-plain min-h-[44px] flex-1 min-w-[10rem]"
                    onClick={pickAgain}
                    disabled={adding || uncertain || !context}
                  >
                    {copy("anotherPhoto")}
                  </button>
                  <button
                    type="button"
                    className="btn-filled min-h-[44px] flex-1 min-w-[10rem]"
                    onClick={addSelected}
                    disabled={adding || !context || selected.length === 0}
                    data-testid="scan-add"
                  >
                    {adding
                      ? copy("adding")
                      : copy(selected.length === 1 ? "addOne" : "addMany", {
                          count: selected.length,
                        })}
                  </button>
                </div>
              </div>
            </>
          ))}
      </div>
    </Dialog>
  );
}

function SuggestionRow({
  row,
  index,
  idBase,
  disabled,
  onChange,
}: {
  row: Row;
  index: number;
  idBase: string;
  disabled: boolean;
  onChange: (key: string, patch: Partial<Row>) => void;
}) {
  const copy = useInventoryCopy();
  const id = `${idBase}-row${index}`;
  const label = copy(
    (
      {
        Likely: "likely",
        "Check this": "checkConfidence",
        Unsure: "unsure",
      } as const
    )[confidenceLabel(row.confidence) as "Likely" | "Check this" | "Unsure"],
  );
  return (
    <li
      data-testid="scan-suggestion"
      className={cn(
        "rounded-xl border p-3 space-y-3",
        row.error
          ? "border-[var(--danger-text)]"
          : "border-[var(--surface-separator)]",
        !row.include && "border-dashed",
      )}
    >
      <div className="flex items-center gap-3">
        <label className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center -m-2 cursor-pointer">
          <input
            type="checkbox"
            checked={row.include}
            onChange={(e) => onChange(row.key, { include: e.target.checked })}
            disabled={disabled}
            className="h-5 w-5 accent-[var(--accent)]"
            aria-label={copy("includeName", {
              name: row.name || copy("itemNumber", { count: index + 1 }),
            })}
          />
        </label>
        <div className="flex-1 min-w-0">
          <label htmlFor={`${id}-name`} className="sr-only">
            {copy("name")}
          </label>
          <input
            id={`${id}-name`}
            type="text"
            value={row.name}
            onChange={(e) => onChange(row.key, { name: e.target.value })}
            maxLength={200}
            disabled={disabled}
            className="w-full input-apple"
          />
        </div>
        <span
          className="shrink-0 rounded-full bg-[var(--surface-fill)] px-2 py-0.5 text-footnote font-semibold text-label-secondary"
          data-testid="scan-confidence"
        >
          {label}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <label
            htmlFor={`${id}-amount`}
            className="text-footnote text-label-secondary block mb-1"
          >
            {copy("amount")}
          </label>
          <input
            id={`${id}-amount`}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={row.amount}
            onChange={(e) => onChange(row.key, { amount: e.target.value })}
            disabled={disabled}
            className="w-full input-apple"
          />
        </div>
        <div>
          <label
            htmlFor={`${id}-unit`}
            className="text-footnote text-label-secondary block mb-1"
          >
            {copy("unit")}
          </label>
          <input
            id={`${id}-unit`}
            type="text"
            value={row.unit}
            onChange={(e) => onChange(row.key, { unit: e.target.value })}
            maxLength={32}
            disabled={disabled}
            className="w-full input-apple"
          />
        </div>
        <div>
          <label
            htmlFor={`${id}-location`}
            className="text-footnote text-label-secondary block mb-1"
          >
            {copy("where")}
          </label>
          <select
            id={`${id}-location`}
            value={row.location}
            onChange={(e) =>
              onChange(row.key, {
                location: e.target.value as InventoryLocation,
              })
            }
            disabled={disabled}
            className="w-full input-apple min-h-[44px]"
          >
            {INVENTORY_LOCATIONS.map((loc) => (
              <option key={loc} value={loc}>
                {copy(loc)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor={`${id}-expires`}
            className="text-footnote text-label-secondary block mb-1"
          >
            {copy("packDate")}
          </label>
          <input
            id={`${id}-expires`}
            type="date"
            value={row.expiresOn}
            onChange={(e) => onChange(row.key, { expiresOn: e.target.value })}
            disabled={disabled}
            className="w-full input-apple min-h-[44px]"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor={`${id}-date-kind`}
          className="text-footnote text-label-secondary block mb-1"
        >
          {copy("foodPhotoDateKind")}
        </label>
        <select
          id={`${id}-date-kind`}
          disabled={disabled}
          value={row.dateKind}
          onChange={(event) =>
            onChange(row.key, {
              dateKind: event.target.value as Row["dateKind"],
            })
          }
          className="input-apple min-h-[44px] w-full"
        >
          <option value="best_before">{copy("best_before")}</option>
          <option value="use_by">{copy("use_by")}</option>
        </select>
        <p className="text-footnote text-label-secondary">
          {copy(
            row.dateKind === "use_by" ? "useBySafety" : "bestBeforeQuality",
          )}
        </p>
      </div>
      {row.document && (
        <div className="space-y-2 rounded-xl bg-[var(--surface-fill)] p-3">
          <label htmlFor={`${id}-package`} className="text-footnote block">
            {copy("packageSize")}
          </label>
          <input
            id={`${id}-package`}
            value={row.packageSize}
            maxLength={80}
            disabled={disabled}
            onChange={(event) =>
              onChange(row.key, { packageSize: event.target.value })
            }
            className="input-apple w-full"
          />
          <p className="text-footnote text-label-secondary">
            {copy("packageNotStock")}
          </p>
          {row.printedDate && (
            <>
              <p className="text-footnote break-words">
                {copy("foodPhotoPrinted")}: {row.printedDate.text}
              </p>
              {row.printedDate.candidate && row.printedDate.kind ? (
                <button
                  type="button"
                  disabled={disabled}
                  className="btn-tinted min-h-[44px]"
                  onClick={() =>
                    onChange(row.key, {
                      expiresOn: row.printedDate!.candidate!,
                      dateKind: row.printedDate!.kind!,
                    })
                  }
                >
                  {copy("foodPhotoUseDate", {
                    date: row.printedDate.candidate,
                    kind: copy(row.printedDate.kind),
                  })}
                </button>
              ) : (
                <p className="text-footnote">{copy("foodPhotoUnclearDate")}</p>
              )}
            </>
          )}
        </div>
      )}

      {row.error && (
        <p
          className="text-footnote text-[var(--danger-text)]"
          data-testid="scan-row-error"
        >
          <InventoryText feedback={row.error} />
        </p>
      )}
    </li>
  );
}
