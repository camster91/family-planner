"use client";

import * as React from "react";
import { runOwnedForeground } from "@/lib/owned-request-http";
import { readBoundedJsonResponse } from "@/lib/bounded-json-response";
import { CaptureDraftBoundary } from "./CaptureDraftBoundary";
import {
  captureReviewDocument,
  captureDocumentUnknowns,
  type CaptureEditableDocument,
  type CaptureReviewProvenance,
} from "@/lib/capture-document";
import type {
  CaptureTextReview,
  CaptureEventReview,
} from "@/lib/capture-review-contract";
import {
  Sparkles,
  Loader2,
  Check,
  X,
  ListPlus,
  CalendarDays,
  ClipboardList,
  Camera,
} from "lucide-react";
import { CAPTURE_CHILD_MESSAGE } from "@/lib/role-capabilities";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import { localDateTimeToISO } from "@/lib/dates";
import { useCoreTranslation } from "@/i18n/core";
import { captureMessages, type CaptureMessage } from "@/i18n/capture";
import { Dialog } from "@/components/ui/dialog";
import {
  activateCaptureRecoveryStorage,
  CAPTURE_RECOVERY_RETENTION_MS,
  clearCaptureRecoveryStorage,
  hashCaptureRequest,
  loadCaptureRecoveryState,
  saveCaptureRecovery,
  type CaptureRecoveryAction,
  type CaptureRecoveryEnvelope,
  type RecoveryStorage,
} from "@/lib/capture-recovery";

// Capture returns local wall-clock times without an offset ("2026-10-06T15:00").
// Convert them in the browser to an instant so the server (UTC) stores the time
// the family meant, as the preview shows it. Times that already carry an
// offset parse the same way.
function toInstant(value: string | undefined): string | undefined {
  if (!value) return value;
  return localDateTimeToISO(value) ?? value;
}

// Small, focused capture box. One input. Type a phrase, confirm what it understood.
// Deliberately not a chat: there is no conversation, no history, one job.

type DraftKind = CaptureTextReview["kind"];
type Draft = CaptureTextReview;
type PhotoEvent = CaptureEventReview;

class CaptureClientError extends Error {
  constructor(readonly key: CaptureMessage) {
    super(key);
    this.name = "CaptureClientError";
  }
}

function recoveryBoundaryErrorKind(
  error: unknown,
): "access" | "storage" | null {
  if (!(error instanceof CaptureClientError)) return null;
  if (error.key === "recoveryAccessUnavailable") return "access";
  if (error.key === "recoveryStorageUnavailable") return "storage";
  return null;
}

const KIND_MESSAGE: Record<DraftKind, CaptureMessage> = {
  event: "event",
  task: "task",
  listitem: "listItem",
};

const KIND_ICON: Record<DraftKind, React.ElementType> = {
  event: CalendarDays,
  task: ClipboardList,
  listitem: ListPlus,
};

function friendlyTime(
  iso: string | undefined,
  locale: "en" | "es",
  noDate: string,
): string {
  if (!iso) return noDate;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale === "es" ? "es-ES" : "en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type RecoveryIdentity = { userId: string; familyId: string };
type CaptureAvailability = "available" | "unavailable" | "retry";

function eventPayload(
  value: Pick<
    Draft | PhotoEvent,
    "title" | "start_time" | "end_time" | "location" | "event_type"
  >,
) {
  return {
    title: value.title.trim(),
    start_time: toInstant(value.start_time),
    ...(value.end_time ? { end_time: toInstant(value.end_time) } : {}),
    ...(value.location ? { location: value.location.trim() } : {}),
    event_type: value.event_type || "other",
  };
}

function recoveryActionFor(action: CaptureRecoveryAction): string {
  return action === "event.create" ? "/api/events" : "/api/capture/grocery";
}

function recoveryTitle(
  row: CaptureRecoveryEnvelope,
  calendarEvent: string,
  groceryItem: string,
): string {
  return row.title || (row.kind === "event" ? calendarEvent : groceryItem);
}

function browserRecoveryStorage(): RecoveryStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export type CaptureBoxProps = {
  /** Called after anything is saved, so the host page can re-request its data. */
  onSaved?: () => void;
  /** Keep the existing inline card available while allowing calendar to host it in a sheet. */
  presentation?: "inline" | "sheet";
  /** Sheet visibility is controlled by the host so drafts survive dismissal. */
  open?: boolean;
  /** Called by the shared Dialog when the sheet can be dismissed. */
  onClose?: () => void;
  /** Boolean only: lets an inbox host protect navigation without copying draft content. */
  onDraftStateChange?: (pending: boolean) => void;
  /** Reports the server-side setup/role gate to a launcher host. */
  onAvailabilityChange?: (availability: CaptureAvailability) => void;
};
export type CaptureExtraction = {
  /** The owned host cancels only a foreground source read, never a mutation. */
  registerReadCancellation?: (cancel: () => void) => () => void;
  begin: () => Promise<number | null>;
  accept: (
    document: CaptureEditableDocument,
    provenance: CaptureReviewProvenance,
    epoch: number,
  ) => Promise<boolean>;
  activity: (value: { busy: boolean; hasInput: boolean }) => void;
  refuse: () => void;
};
export function CaptureBox(props: CaptureBoxProps = {}) {
  return (
    <CaptureDraftBoundary
      {...props}
      renderLegacy={(overrides) => (
        <LegacyCaptureBox {...props} {...overrides} />
      )}
      renderExtractor={(extraction) => (
        <LegacyCaptureBox
          presentation="inline"
          open={props.open}
          extraction={extraction}
        />
      )}
    />
  );
}

export function LegacyCaptureBox({
  onSaved,
  presentation = "inline",
  open = true,
  onClose,
  onAvailabilityChange,
  onDraftStateChange,
  extraction,
  recoveryOnly = false,
  privacyHidden = false,
}: CaptureBoxProps & {
  extraction?: CaptureExtraction;
  recoveryOnly?: boolean;
  privacyHidden?: boolean;
} = {}) {
  const { locale, t } = useCoreTranslation();
  const msg = (key: CaptureMessage, params?: Record<string, string | number>) =>
    t(key, params, captureMessages);
  const localizeError = (error: unknown, fallback: CaptureMessage) =>
    error instanceof CaptureClientError
      ? msg(error.key)
      : error instanceof Error
        ? error.message
        : msg(fallback);
  const titleFor = (row: CaptureRecoveryEnvelope) =>
    recoveryTitle(row, msg("calendarEvent"), msg("groceryItem"));
  const extractionMounted = React.useRef(true);
  React.useEffect(() => {
    extractionMounted.current = true;
    return () => {
      extractionMounted.current = false;
    };
  }, []);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);
  const [unavailable, setUnavailable] = React.useState(false);
  const [availability, setAvailability] = React.useState<
    "loading" | CaptureAvailability
  >("loading");
  const [checkingAvailability, setCheckingAvailability] = React.useState(false);
  const availabilityController = React.useRef<AbortController | null>(null);
  const availabilityRef = React.useRef<"loading" | CaptureAvailability>(
    "loading",
  );
  const focusAfterAvailabilityRef = React.useRef(false);
  const sheetFocusPending = React.useRef(false);
  const previousSheetOpen = React.useRef(false);
  // D4 (#102): children may not use capture; the API says so via `allowed`.
  const [childBlocked, setChildBlocked] = React.useState(false);
  const [captureRole, setCaptureRole] = React.useState<
    "parent" | "teen" | null
  >(null);
  const [photoBusy, setPhotoBusy] = React.useState(false);
  const [photoEvents, setPhotoEvents] = React.useState<PhotoEvent[] | null>(
    null,
  );
  React.useEffect(() => {
    extraction?.activity({
      busy: busy || photoBusy,
      hasInput: Boolean(text.trim()),
    });
    return () => extraction?.activity({ busy: false, hasInput: false });
  }, [extraction, busy, photoBusy, text]);
  React.useEffect(() => {
    onDraftStateChange?.(draft !== null || (photoEvents?.length ?? 0) > 0);
  }, [draft, photoEvents, onDraftStateChange]);
  const [photoNote, setPhotoNote] = React.useState<string | null>(null);
  const [photoOffset, setPhotoOffset] = React.useState(0);
  React.useEffect(() => setPhotoOffset(0), [photoEvents]);
  const [recoveryOperations, setRecoveryOperations] = React.useState<
    CaptureRecoveryEnvelope[]
  >([]);
  const [recoveryBusyKey, setRecoveryBusyKey] = React.useState<string | null>(
    null,
  );
  const [recoveryMessage, setRecoveryMessage] = React.useState<string | null>(
    null,
  );
  const [recoveryStorageBlocked, setRecoveryStorageBlocked] =
    React.useState(false);
  const recoveryMutationReady = React.useRef(false);
  const receiptController = React.useRef<AbortController | null>(null);
  const recoveryRetryController = React.useRef<AbortController | null>(null);
  const recoveryEpoch = React.useRef(0);
  const recoveryGuardFailure = React.useRef<CaptureMessage>(
    "recoveryAccessUnavailable",
  );
  const recoveryErrorKind = React.useRef<"access" | "storage" | null>(null);
  const recoveryIdentity = React.useRef<RecoveryIdentity | null>(null);
  const recoveryRows = React.useRef(new Map<string, CaptureRecoveryEnvelope>());
  // Keep the in-memory proposal associated with its persisted operation so a
  // terminal receipt can retire only the stale preview that produced it. A
  // reload has no proposal object to retire; its recovery row still remains
  // authoritative and is handled by the receipt controls below.
  const operationProposals = React.useRef(new Map<string, object>());
  const retiredOperationKeys = React.useRef(new Set<string>());
  const photoEventsRef = React.useRef<PhotoEvent[] | null>(null);
  const photoWorkRef = React.useRef(0);
  const captureWorkRef = React.useRef(0);
  const readController = React.useRef<AbortController | null>(null);
  const phraseRef = React.useRef(text);
  phraseRef.current = text;
  const [reading, setReading] = React.useState(false);
  const readInterruptedText = React.useRef(msg("readInterrupted"));
  readInterruptedText.current = msg("readInterrupted");
  const cancelRead = React.useCallback(() => {
    if (!readController.current) return;
    readController.current.abort();
    readController.current = null;
    captureWorkRef.current++;
    photoWorkRef.current++;
    setReading(false);
    setBusy(false);
    setPhotoBusy(false);
    extraction?.activity({
      busy: false,
      hasInput: Boolean(phraseRef.current.trim()),
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
    setError(readInterruptedText.current);
  }, [extraction]);
  React.useEffect(
    () => extraction?.registerReadCancellation?.(cancelRead),
    [extraction, cancelRead],
  );
  React.useEffect(() => {
    if (!open || privacyHidden) cancelRead();
  }, [open, privacyHidden, cancelRead]);
  React.useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") cancelRead();
    };
    window.addEventListener("blur", cancelRead);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("blur", cancelRead);
      document.removeEventListener("visibilitychange", hidden);
      readController.current?.abort();
      readController.current = null;
      availabilityController.current?.abort();
      receiptController.current?.abort();
      receiptController.current = null;
      recoveryRetryController.current?.abort();
      recoveryRetryController.current = null;
    };
  }, [cancelRead]);
  React.useEffect(
    () => () => {
      captureWorkRef.current++;
      photoWorkRef.current++;
    },
    [],
  );
  const textInputRef = React.useRef<HTMLInputElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const inSheet = presentation === "sheet";
  photoEventsRef.current = photoEvents;
  // Proposal identity survives retries and partial batch filtering. Do not make
  // a fresh key after an uncertain response, or a repeated effect could result.
  const operations = React.useRef(
    new WeakMap<object, { key: string; at: number; body?: string }>(),
  );
  const clearRecoveryBoundary = React.useCallback(
    (userId?: string, familyId?: string): boolean => {
      const knownIdentity = recoveryIdentity.current;
      recoveryEpoch.current++;
      receiptController.current?.abort();
      receiptController.current = null;
      recoveryRetryController.current?.abort();
      recoveryRetryController.current = null;
      setRecoveryBusyKey(null);
      setRecoveryMessage(null);
      readController.current?.abort();
      readController.current = null;
      setReading(false);
      captureWorkRef.current++;
      photoWorkRef.current++;
      setBusy(false);
      setPhotoBusy(false);
      recoveryMutationReady.current = false;
      recoveryRows.current.clear();
      operationProposals.current.clear();
      retiredOperationKeys.current.clear();
      recoveryIdentity.current = null;
      setRecoveryOperations([]);
      setDraft(null);
      setPhotoEvents(null);
      setPhotoNote(null);
      setText("");
      setCaptureRole(null);
      recoveryErrorKind.current = null;
      setError(null);
      setSaved(null);
      const cleared = clearCaptureRecoveryStorage(
        browserRecoveryStorage(),
        userId ?? knownIdentity?.userId,
        familyId ?? knownIdentity?.familyId,
      );
      recoveryGuardFailure.current = cleared
        ? "recoveryAccessUnavailable"
        : "recoveryStorageUnavailable";
      setRecoveryStorageBlocked(!cleared);
      return cleared;
    },
    [],
  );
  const revokeCaptureAccess = React.useCallback(
    (userId?: string, familyId?: string, child = false): boolean => {
      const cleared = clearRecoveryBoundary(userId, familyId);
      extraction?.refuse();
      setChildBlocked(child);
      setUnavailable(!child);
      setAvailability("unavailable");
      onAvailabilityChange?.("unavailable");
      return cleared;
    },
    [clearRecoveryBoundary, onAvailabilityChange, extraction],
  );

  function operationFor(proposal: object) {
    let operation = operations.current.get(proposal);
    if (!operation) {
      operation = { key: newIdempotencyKey(), at: Date.now() };
      operations.current.set(proposal, operation);
    }
    // Server replay retention is seven days. Never silently replay an old
    // unknown operation after that window; ask the person to check the app.
    if (Date.now() - operation.at >= CAPTURE_RECOVERY_RETENTION_MS)
      throw new CaptureClientError("previewTooOld");
    return operation;
  }
  const syncRecoveryRows = React.useCallback(
    (rows: CaptureRecoveryEnvelope[]): boolean => {
      recoveryRows.current = new Map(rows.map((row) => [row.key, row]));
      setRecoveryOperations(rows);
      const identity = recoveryIdentity.current;
      if (!identity) {
        recoveryMutationReady.current = false;
        recoveryGuardFailure.current = "recoveryAccessUnavailable";
        setRecoveryStorageBlocked(true);
        return false;
      }
      const saved = saveCaptureRecovery(
        browserRecoveryStorage(),
        identity.userId,
        identity.familyId,
        rows,
      );
      recoveryMutationReady.current = saved;
      recoveryGuardFailure.current = saved
        ? "recoveryAccessUnavailable"
        : "recoveryStorageUnavailable";
      setRecoveryStorageBlocked(!saved);
      return saved;
    },
    [],
  );

  function ensureRecoveryMutationReady(): boolean {
    if (!recoveryMutationReady.current) {
      setRecoveryMessage(msg(recoveryGuardFailure.current));
      return false;
    }
    const identity = recoveryIdentity.current;
    if (!identity) {
      recoveryMutationReady.current = false;
      recoveryGuardFailure.current = "recoveryAccessUnavailable";
      setRecoveryStorageBlocked(true);
      setRecoveryMessage(msg("recoveryAccessUnavailable"));
      return false;
    }
    const saved = saveCaptureRecovery(
      browserRecoveryStorage(),
      identity.userId,
      identity.familyId,
      [...recoveryRows.current.values()],
    );
    recoveryMutationReady.current = saved;
    recoveryGuardFailure.current = saved
      ? "recoveryAccessUnavailable"
      : "recoveryStorageUnavailable";
    setRecoveryStorageBlocked(!saved);
    if (!saved) setRecoveryMessage(msg("recoveryStorageUnavailable"));
    return saved;
  }

  function rememberRecovery(row: CaptureRecoveryEnvelope) {
    const next = [...recoveryRows.current.values()].filter(
      (current) => current.key !== row.key,
    );
    next.unshift(row);
    if (!syncRecoveryRows(next))
      throw new CaptureClientError("recoveryStorageUnavailable");
  }

  function forgetRecovery(key: string) {
    syncRecoveryRows(
      [...recoveryRows.current.values()].filter((row) => row.key !== key),
    );
  }

  function retireProposal(key: string) {
    retiredOperationKeys.current.add(key);
    const proposal = operationProposals.current.get(key);
    operationProposals.current.delete(key);
    if (!proposal) return;

    // A newer text preview must survive an older receipt reconciliation.
    setDraft((current) => (current === proposal ? null : current));

    // Photo rows retain object identity through partial retries, so remove
    // precisely the terminal row and preserve every unrelated proposal.
    const currentPhotoEvents = photoEventsRef.current;
    if (currentPhotoEvents?.some((event) => event === proposal)) {
      if (currentPhotoEvents.length === 1) {
        setPhotoEvents(null);
        setPhotoNote(null);
      } else {
        setPhotoEvents((current) =>
          current ? current.filter((event) => event !== proposal) : current,
        );
      }
    }
  }

  function proposalIsRetired(proposal: object): boolean {
    const operation = operations.current.get(proposal);
    return operation ? retiredOperationKeys.current.has(operation.key) : false;
  }

  async function rememberPayload(
    action: CaptureRecoveryAction,
    operation: { key: string; at: number; body?: string },
    payload: unknown,
    title: string,
    photo: boolean,
  ): Promise<string> {
    const body = JSON.stringify(payload);
    if (operation.body && operation.body !== body)
      throw new CaptureClientError("previewChanged");
    operation.body = body;
    const requestHash = await hashCaptureRequest(action, payload);
    if (!requestHash) throw new CaptureClientError("couldNotPrepareRetry");
    const envelope: CaptureRecoveryEnvelope = {
      version: 1,
      key: operation.key,
      action,
      requestHash,
      body,
      title: title.trim().slice(0, 200),
      kind: action === "event.create" ? "event" : "listitem",
      createdAt: operation.at,
      photo,
    };
    rememberRecovery(envelope);
    return body;
  }

  async function postProposal(
    url: string,
    proposal: object,
    payload: unknown,
    title: string,
    photo = false,
  ) {
    if (!ensureRecoveryMutationReady()) {
      throw new CaptureClientError(recoveryGuardFailure.current);
    }
    const operation = operationFor(proposal);
    const action: CaptureRecoveryAction =
      url === "/api/events" ? "event.create" : "capture.grocery.add";
    const body = await rememberPayload(
      action,
      operation,
      payload,
      title,
      photo,
    );
    operationProposals.current.set(operation.key, proposal);
    if (!ensureRecoveryMutationReady()) {
      throw new CaptureClientError(recoveryGuardFailure.current);
    }
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": operation.key,
        },
        body,
      });
      if (response.status === 401 || response.status === 403) {
        revokeCaptureAccess();
        throw new CaptureClientError("recoveryAccessUnavailable");
      }
      if (response.ok && recoveryMutationReady.current) {
        forgetRecovery(operation.key);
        operationProposals.current.delete(operation.key);
      }
      return response;
    } catch (error) {
      if (error instanceof CaptureClientError) throw error;
      throw new CaptureClientError("uncertainSave");
    }
  }

  // Is capture set up on this deployment? An explicit authenticated refusal or
  // an explicit disabled/configured-off response is final for this mount. A
  // network/5xx/malformed response is transient so the launcher can recover
  // without a full page reload.
  const checkAvailability = React.useCallback(async () => {
    const recoveringFromTransientFailure = availabilityRef.current === "retry";
    availabilityController.current?.abort();
    const controller = new AbortController();
    availabilityController.current = controller;
    const current = () =>
      extractionMounted.current &&
      !controller.signal.aborted &&
      availabilityController.current === controller;
    recoveryMutationReady.current = false;
    recoveryEpoch.current++;
    receiptController.current?.abort();
    receiptController.current = null;
    recoveryRetryController.current?.abort();
    recoveryRetryController.current = null;
    setRecoveryBusyKey(null);
    setCheckingAvailability(true);
    try {
      const result = await runOwnedForeground(
        async (signal) => {
          const response = await fetch("/api/capture", {
            cache: "no-store",
            credentials: "same-origin",
            signal,
          });
          // An authenticated refusal is a privacy boundary even when a proxy or
          // expired session supplies no readable JSON error body.
          if (response.status === 401 || response.status === 403) {
            void response.body?.cancel().catch(() => undefined);
            return { kind: "reply" as const, response, body: null };
          }
          const body = await readBoundedJsonResponse(response, signal, 8192);
          return { kind: "reply" as const, response, body };
        },
        { signal: controller.signal },
      );
      if (!current()) return;
      if (result.kind !== "reply")
        throw new Error("Capture availability unavailable");
      const response = result.response;
      if (response.status === 401 || response.status === 403) {
        revokeCaptureAccess();
        return;
      }
      if (!response.ok) throw new Error("Capture availability check failed");
      const value: unknown = result.body;
      if (!value || typeof value !== "object")
        throw new Error("Unreadable capture availability");
      const data = value as {
        allowed?: unknown;
        configured?: unknown;
        userId?: unknown;
        familyId?: unknown;
        role?: unknown;
      };
      if (
        typeof data.allowed !== "boolean" ||
        typeof data.configured !== "boolean"
      ) {
        throw new Error("Incomplete capture availability");
      }
      if (!data.allowed) {
        revokeCaptureAccess(
          typeof data.userId === "string" ? data.userId : undefined,
          typeof data.familyId === "string" ? data.familyId : undefined,
          true,
        );
        return;
      }
      setCaptureRole(
        data.role === "parent" || data.role === "teen" ? data.role : null,
      );
      if (!data.configured && !recoveryOnly) {
        setRecoveryStorageBlocked(false);
        setUnavailable(true);
        setAvailability("unavailable");
        onAvailabilityChange?.("unavailable");
        return;
      }
      setChildBlocked(false);
      setUnavailable(false);
      if (recoveringFromTransientFailure)
        focusAfterAvailabilityRef.current = true;
      setAvailability("available");
      onAvailabilityChange?.("available");
      if (
        typeof data.userId !== "string" ||
        typeof data.familyId !== "string" ||
        !data.userId ||
        !data.familyId
      ) {
        recoveryGuardFailure.current = "recoveryStorageUnavailable";
        setRecoveryStorageBlocked(true);
        return;
      }
      if (extraction) return;
      const identity = { userId: data.userId, familyId: data.familyId };
      const previousIdentity = recoveryIdentity.current;
      const sameIdentity =
        previousIdentity?.userId === identity.userId &&
        previousIdentity.familyId === identity.familyId;
      const pending = sameIdentity ? [...recoveryRows.current.values()] : [];
      const storage = browserRecoveryStorage();
      if (
        !storage ||
        !activateCaptureRecoveryStorage(
          storage,
          identity.userId,
          identity.familyId,
        )
      ) {
        recoveryGuardFailure.current = "recoveryStorageUnavailable";
        setRecoveryStorageBlocked(true);
        return;
      }
      recoveryIdentity.current = identity;
      const loaded = loadCaptureRecoveryState(
        storage,
        identity.userId,
        identity.familyId,
      );
      if (!loaded.storageAvailable) {
        recoveryGuardFailure.current = "recoveryStorageUnavailable";
        setRecoveryStorageBlocked(true);
        setRecoveryOperations(pending);
        recoveryRows.current = new Map(pending.map((row) => [row.key, row]));
        return;
      }
      setRecoveryStorageBlocked(false);
      setRecoveryMessage(null);
      const persisted = loaded.rows;
      const ready = syncRecoveryRows([
        ...persisted,
        ...pending.filter(
          (row) => !persisted.some((saved) => saved.key === row.key),
        ),
      ]);
      if (ready && recoveryErrorKind.current !== null) {
        recoveryErrorKind.current = null;
        setError(null);
      }
    } catch {
      if (!current()) return;
      setAvailability("retry");
      onAvailabilityChange?.("retry");
    } finally {
      if (current()) {
        availabilityController.current = null;
        setCheckingAvailability(false);
      }
    }
  }, [
    onAvailabilityChange,
    revokeCaptureAccess,
    syncRecoveryRows,
    extraction,
    recoveryOnly,
  ]);

  React.useEffect(() => {
    void checkAvailability();
    const refresh = () => {
      if (document.visibilityState !== "hidden") void checkAvailability();
    };
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      availabilityController.current?.abort();
    };
  }, [checkAvailability]);

  React.useEffect(() => {
    availabilityRef.current = availability;
  }, [availability]);

  React.useEffect(() => {
    const sheetOpen = inSheet && open;
    if (sheetOpen && !previousSheetOpen.current)
      sheetFocusPending.current = true;
    previousSheetOpen.current = sheetOpen;
    if (!open) sheetFocusPending.current = false;
    // The owning boundary can renew access after Dialog opens. Its hidden
    // input cannot take the initial focus until that same owner is revealed.
    if (availability !== "available" || !open || privacyHidden) return;
    if (!sheetFocusPending.current && !focusAfterAvailabilityRef.current)
      return;
    const input = textInputRef.current;
    if (!input || input.disabled) return;
    sheetFocusPending.current = false;
    focusAfterAvailabilityRef.current = false;
    input.focus();
  }, [availability, open, inSheet, privacyHidden]);

  const storageRecoveryNotice = recoveryStorageBlocked ? (
    <div
      className="mt-3 rounded-lg border border-[var(--separator)] p-3"
      role="alert"
    >
      <p className="text-subhead text-[var(--danger-text)]">
        {msg("recoveryStorageUnavailable")}
      </p>
      <button
        type="button"
        className="btn-plain min-h-[44px] mt-2"
        onClick={() => void checkAvailability()}
        disabled={checkingAvailability}
      >
        {checkingAvailability ? msg("checking") : msg("retryStorage")}
      </button>
    </div>
  ) : null;

  async function checkRecovery(row: CaptureRecoveryEnvelope) {
    if (!ensureRecoveryMutationReady() || receiptController.current || recoveryRetryController.current) return;
    if (!row.requestHash) {
      forgetRecovery(row.key);
      setRecoveryMessage(msg("statusUnavailable"));
      return;
    }
    const controller = new AbortController();
    const epoch = recoveryEpoch.current;
    receiptController.current = controller;
    const current = () => receiptController.current === controller && recoveryEpoch.current === epoch && recoveryMutationReady.current;
    setRecoveryBusyKey(row.key);
    setRecoveryMessage(null);
    try {
      const result = await runOwnedForeground(async signal => {
        const response = await fetch("/api/capture/receipt", {
          headers: {
            "Idempotency-Key": row.key,
            "X-Capture-Action": row.action,
            "X-Capture-Request-Hash": row.requestHash!,
          },
          signal, credentials: "same-origin", cache: "no-store",
        });
        const data = response.status === 401 || response.status === 403
          ? null : await readBoundedJsonResponse(response, signal, 32 * 1024);
        return { kind: "reply" as const, response, data };
      }, { signal: controller.signal, timeoutMs: 15000 });
      if (!current()) return;
      if (result.kind !== "reply") throw new Error("Unconfirmed receipt read");
      const { response } = result;
      const data = result.data as { state?: string; current?: string } | null;
      if (response.status === 401 || response.status === 403) {
        revokeCaptureAccess();
      } else if (!recoveryMutationReady.current) {
        return;
      } else if (response.status === 409) {
        forgetRecovery(row.key);
        retireProposal(row.key);
        setRecoveryMessage(msg("captureChanged"));
      } else if (!response.ok) {
        setRecoveryMessage(msg("couldNotCheck"));
      } else if (data?.state === "committed" && data?.current === "present") {
        forgetRecovery(row.key);
        retireProposal(row.key);
        setSaved(msg("alreadyAdded", { title: titleFor(row) }));
        onSaved?.();
      } else if (data?.state === "committed" && data?.current === "removed") {
        forgetRecovery(row.key);
        retireProposal(row.key);
        setRecoveryMessage(msg("savedRemoved"));
      } else if (data?.state === "committed") {
        forgetRecovery(row.key);
        retireProposal(row.key);
        setRecoveryMessage(msg("savedEarlier"));
      } else if (data?.state === "pending") {
        setRecoveryMessage(msg("stillProcessing"));
      } else if (data?.state === "expired") {
        forgetRecovery(row.key);
        retireProposal(row.key);
        setRecoveryMessage(msg("captureTooOld"));
      } else if (data?.state === "absent") {
        // A missing receipt is terminal: the server can no longer prove that
        // this local envelope is the original write, so never keep offering a
        // same-key retry from an orphaned or pruned client row.
        forgetRecovery(row.key);
        retireProposal(row.key);
        setRecoveryMessage(msg("noSavedResult"));
      } else {
        setRecoveryMessage(msg("noSavedResult"));
      }
    } catch {
      if (current()) setRecoveryMessage(msg("couldNotCheck"));
    } finally {
      if (receiptController.current === controller) {
        receiptController.current = null;
        setRecoveryBusyKey(null);
      }
    }
  }

  async function retryRecovery(row: CaptureRecoveryEnvelope) {
    if (!ensureRecoveryMutationReady() || receiptController.current || recoveryRetryController.current) return;
    if (Date.now() - row.createdAt >= CAPTURE_RECOVERY_RETENTION_MS) {
      // A request may have started just before the client-side retry window
      // closed. Reconcile the authoritative receipt first so a committed
      // present/removed resource is reported truthfully instead of being
      // discarded merely because the local clock crossed the boundary.
      await checkRecovery(row);
      return;
    }
    const controller = new AbortController();
    const epoch = recoveryEpoch.current;
    recoveryRetryController.current = controller;
    const current = () => recoveryRetryController.current === controller && recoveryEpoch.current === epoch && recoveryMutationReady.current;
    setRecoveryBusyKey(row.key);
    setRecoveryMessage(null);
    try {
      const result = await runOwnedForeground(async signal => {
        const response = await fetch(recoveryActionFor(row.action), {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": row.key },
          body: row.body, signal, credentials: "same-origin", cache: "no-store",
        });
        // Status alone drives recovery; never buffer an unused replay body.
        void response.body?.cancel().catch(() => undefined);
        return { kind: "reply" as const, response };
      }, { signal: controller.signal, timeoutMs: 45000 });
      if (!current()) return;
      if (result.kind !== "reply") throw new Error("Unconfirmed capture retry");
      const { response } = result;
      if (response.status === 401 || response.status === 403) {
        revokeCaptureAccess();
      } else if (!recoveryMutationReady.current) {
        return;
      } else if (response.ok) {
        // A successful keyed replay only proves the receipt response. Read
        // the family-scoped resource state before claiming it is present; a
        // committed item may have been deleted since the original attempt.
        // Hand off the one active lane to the bounded receipt read. Its own
        // finally owns busy-state release; an older retry cannot clear it.
        recoveryRetryController.current = null;
        await checkRecovery(row);
        // Storage/authority can refuse the handoff before a check starts.
        if (!receiptController.current && !recoveryRetryController.current && recoveryEpoch.current === epoch)
          setRecoveryBusyKey(null);
      } else if (response.status === 422) {
        forgetRecovery(row.key);
        retireProposal(row.key);
        setRecoveryMessage(msg("captureChanged"));
      } else if (
        response.status === 404 &&
        row.action === "capture.grocery.add"
      ) {
        forgetRecovery(row.key);
        retireProposal(row.key);
        setRecoveryMessage(msg("groceryListChanged"));
      } else if (response.status === 409) {
        setRecoveryMessage(msg("originalProcessing"));
      } else {
        setRecoveryMessage(msg("couldNotSaveCapture"));
      }
    } catch {
      if (current()) setRecoveryMessage(msg("couldNotSaveCapture"));
    } finally {
      if (recoveryRetryController.current === controller) {
        recoveryRetryController.current = null;
        setRecoveryBusyKey(null);
      }
    }
  }

  async function interpret() {
    const phrase = text.trim();
    if (!phrase) return;
    const ownerEpoch = extraction ? await extraction.begin() : undefined;
    if (extraction && (ownerEpoch == null || !extractionMounted.current))
      return;
    if (readController.current) return;
    const controller = new AbortController();
    readController.current = controller;
    setReading(true);
    const workId = ++captureWorkRef.current;
    const current = () =>
      extractionMounted.current &&
      !controller.signal.aborted &&
      captureWorkRef.current === workId;
    setBusy(true);
    recoveryErrorKind.current = null;
    setError(null);
    setSaved(null);
    try {
      const result = await runOwnedForeground(
        async (signal) => {
          const response = await fetch("/api/capture", {
            method: "POST",
            cache: "no-store",
            credentials: "same-origin",
            signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: phrase }),
          });
          // An access refusal is authoritative even when its body is empty,
          // malformed or never finishes. Do not let decoding retain private
          // proposals/recovery after the session has lost access.
          const body =
            response.status === 401 || response.status === 403
              ? null
              : await readBoundedJsonResponse(response, signal, 256 * 1024);
          return { kind: "reply" as const, response, body };
        },
        { signal: controller.signal, timeoutMs: 45000 },
      );
      if (!current()) return;
      if (result.kind !== "reply")
        throw new CaptureClientError("readInterrupted");
      const res = result.response;
      if (res.status === 401 || res.status === 403) {
        const cleared = revokeCaptureAccess();
        setError(
          msg(
            cleared
              ? "recoveryAccessUnavailable"
              : "recoveryStorageUnavailable",
          ),
        );
        throw new CaptureClientError("recoveryAccessUnavailable");
      }
      if (!res.ok) throw new CaptureClientError("couldNotRead");
      const data = result.body as { draft?: unknown } | null;
      // Keep provider-response validation out of the eagerly mounted calendar
      // graph. The response must still pass the same strict schema before it
      // can enter the review document or recovery state.
      const { captureTextReview } =
        await import("@/lib/capture-review-contract");
      if (!current()) return;
      const parsed = captureTextReview.safeParse(data?.draft);
      if (!parsed.success) throw new CaptureClientError("couldNotRead");
      if (readController.current === controller) {
        readController.current = null;
        setReading(false);
      }
      if (extraction) {
        const reviewed = captureReviewDocument(
          { ...parsed.data, clientId: newIdempotencyKey(), quantity: "1" },
          null,
          null,
        );
        const accepted = await extraction.accept(
          reviewed,
          {
            source: "text-review",
            sourceUrl: null,
            confidence: parsed.data.confidence,
            unknowns: captureDocumentUnknowns(reviewed),
            evaluatedAt: Date.now(),
          },
          ownerEpoch!,
        );
        if (!current()) return;
        if (!accepted) throw new CaptureClientError("ownedStorageHold");
        setText("");
        return;
      }
      setPhotoEvents(null);
      setPhotoNote(null);
      setDraft(parsed.data);
    } catch (e) {
      if (!current()) return;
      recoveryErrorKind.current = recoveryBoundaryErrorKind(e);
      setError(localizeError(e, "couldNotRead"));
    } finally {
      if (readController.current === controller) {
        readController.current = null;
        if (extractionMounted.current) setReading(false);
      }
      if (current()) setBusy(false);
    }
  }

  async function confirm() {
    if (extraction || recoveryOnly || !draft) return;
    // A task proposal is not permission to create a calendar record or assign
    // a chore. Keep it for deliberate canonical chore review by a parent.
    if (draft.kind === "task") {
      setError(msg("taskNeedsReview"));
      return;
    }
    setBusy(true);
    recoveryErrorKind.current = null;
    setError(null);
    try {
      if (draft.kind === "listitem") {
        // Resolve the household default list and add the item in one keyed
        // server transaction so a lost list-resolution response cannot strand
        // a request without a durable receipt.
        const itemRes = await postProposal(
          "/api/capture/grocery",
          draft,
          { content: draft.title.trim(), quantity: 1 },
          draft.title,
        );
        if (!itemRes.ok) {
          const d = await itemRes.json().catch(() => ({}));
          throw new Error(
            typeof d.error === "string"
              ? d.error
              : d.error?.message || msg("groceryAddFailed"),
          );
        }
      } else {
        const res = await postProposal(
          "/api/events",
          draft,
          eventPayload(draft),
          draft.title,
        );
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(
            typeof d.error === "string"
              ? d.error
              : d.error?.message || msg("couldNotSave"),
          );
        }
      }
      setSaved(msg("addedTitle", { title: draft.title }));
      setDraft(null);
      setText("");
      onSaved?.();
    } catch (e) {
      recoveryErrorKind.current = recoveryBoundaryErrorKind(e);
      setError(localizeError(e, "couldNotSave"));
    } finally {
      setBusy(false);
    }
  }

  // Read a photo/screenshot and propose the events it contains.
  async function interpretPhoto(file: File) {
    const ownerEpoch = extraction ? await extraction.begin() : undefined;
    if (extraction && (ownerEpoch == null || !extractionMounted.current))
      return;
    if (readController.current) return;
    const controller = new AbortController();
    readController.current = controller;
    setReading(true);
    const workId = ++photoWorkRef.current;
    const current = () =>
      extractionMounted.current &&
      !controller.signal.aborted &&
      photoWorkRef.current === workId;
    setPhotoBusy(true);
    recoveryErrorKind.current = null;
    setError(null);
    setSaved(null);
    try {
      const result = await runOwnedForeground(
        async (signal) => {
          // This deadline also covers FileReader/image decode. An ignored abort
          // may finish decoding later, but must never start a provider request.
          const { downscaleImage } = await import("./capture-photo-helper");
          if (!current() || signal.aborted)
            throw new CaptureClientError("readInterrupted");
          const { base64, mimeType } = await downscaleImage(
            file,
            1600,
            signal,
            (key) => new CaptureClientError(key),
          );
          if (!current() || signal.aborted)
            throw new CaptureClientError("readInterrupted");
          if (signal.aborted) throw new Error("Capture read stopped");
          const response = await fetch("/api/capture", {
            method: "POST",
            cache: "no-store",
            credentials: "same-origin",
            signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageBase64: base64, mimeType }),
          });
          // An access refusal is authoritative even when its body is empty,
          // malformed or never finishes. Do not let decoding retain private
          // proposals/recovery after the session has lost access.
          const body =
            response.status === 401 || response.status === 403
              ? null
              : await readBoundedJsonResponse(response, signal, 256 * 1024);
          return { kind: "reply" as const, response, body };
        },
        { signal: controller.signal, timeoutMs: 45000 },
      );
      if (!current()) return;
      if (result.kind !== "reply")
        throw new CaptureClientError("readInterrupted");
      const res = result.response;
      if (res.status === 401 || res.status === 403) {
        const cleared = revokeCaptureAccess();
        setError(
          msg(
            cleared
              ? "recoveryAccessUnavailable"
              : "recoveryStorageUnavailable",
          ),
        );
        throw new CaptureClientError("recoveryAccessUnavailable");
      }
      if (!res.ok) throw new CaptureClientError("couldNotReadPhoto");
      const data = result.body as { image?: unknown } | null;
      // Photo extraction uses the same strict validation, loaded only when a
      // photo extraction request actually returns a provider response.
      const { capturePhotoReview } =
        await import("@/lib/capture-review-contract");
      if (!current()) return;
      const parsed = capturePhotoReview.safeParse(data?.image);
      if (!parsed.success) throw new CaptureClientError("couldNotReadPhoto");
      if (readController.current === controller) {
        readController.current = null;
        setReading(false);
      }
      if (extraction) {
        const reviewed = captureReviewDocument(
          null,
          parsed.data.events.map((event) => ({
            ...event,
            clientId: newIdempotencyKey(),
          })),
          parsed.data.note ?? null,
        );
        const accepted = await extraction.accept(
          reviewed,
          {
            source: "photo-review",
            sourceUrl: null,
            confidence: parsed.data.confidence,
            unknowns: captureDocumentUnknowns(reviewed),
            evaluatedAt: Date.now(),
          },
          ownerEpoch!,
        );
        if (!current()) return;
        if (!accepted) throw new CaptureClientError("ownedStorageHold");
        return;
      }
      setDraft(null);
      setPhotoEvents(parsed.data.events);
      setPhotoNote(parsed.data.note ?? null);
    } catch (e) {
      if (!current()) return;
      recoveryErrorKind.current = recoveryBoundaryErrorKind(e);
      setError(localizeError(e, "couldNotReadPhoto"));
    } finally {
      if (readController.current === controller) {
        readController.current = null;
        if (extractionMounted.current) setReading(false);
      }
      if (photoWorkRef.current === workId) setPhotoBusy(false);
      if (current() && fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // Add every proposed event the user has not removed. Events that fail stay
  // in the list so the person can try again or remove them.
  async function confirmPhoto() {
    if (extraction || recoveryOnly) return;
    const batch = photoEvents;
    if (!batch || batch.length === 0) return;
    const workId = ++photoWorkRef.current;
    setPhotoBusy(true);
    recoveryErrorKind.current = null;
    setError(null);
    setSaved(null);
    const total = batch.length;
    const failed: PhotoEvent[] = [];
    let added = 0;
    let processed = 0;
    let storageFailure = false;
    let accessFailure = false;
    try {
      try {
        for (const ev of batch) {
          if (proposalIsRetired(ev)) {
            processed += 1;
            continue;
          }
          const res = await postProposal(
            "/api/events",
            ev,
            eventPayload(ev),
            ev.title,
            true,
          );
          processed += 1;
          if (res.ok && !proposalIsRetired(ev)) added += 1;
          else if (!proposalIsRetired(ev)) failed.push(ev);
        }
      } catch (error) {
        // Network error: everything not yet saved counts as failed.
        failed.push(
          ...batch
            .slice(processed)
            .filter((event) => !proposalIsRetired(event)),
        );
        storageFailure =
          error instanceof CaptureClientError &&
          error.key === "recoveryStorageUnavailable";
        accessFailure =
          error instanceof CaptureClientError &&
          error.key === "recoveryAccessUnavailable";
      }

      // A successful write still needs to refresh the host even when a
      // recovery boundary cleared this preview while the batch was in flight.
      if (added > 0) onSaved?.();

      // A new photo preview or recovery boundary may have replaced this batch
      // while its request was in flight. Do not let the old completion clear
      // or overwrite the newer UI state.
      if (photoEventsRef.current !== batch) {
        // An authenticated refusal intentionally clears the private preview,
        // but a batch may already contain confirmed writes. Keep that
        // aggregate result visible in the access boundary without restoring
        // the cleared event rows.
        if (accessFailure) {
          if (added > 0) setSaved(msg("addedOf", { added, total }));
          setError(
            msg(
              added > 0
                ? "recoveryPartialFailure"
                : "recoveryAccessUnavailable",
            ),
          );
        }
        return;
      }

      const unresolved = failed.filter((event) => !proposalIsRetired(event));
      if (unresolved.length === 0) {
        if (added > 0)
          setSaved(
            msg(added === 1 ? "addedOne" : "addedMany", { count: added }),
          );
        setPhotoEvents(null);
        setPhotoNote(null);
      } else {
        setPhotoEvents(unresolved);
        if (added > 0) {
          recoveryErrorKind.current = null;
          setSaved(msg("addedOf", { added, total }));
          setError(
            storageFailure || accessFailure
              ? msg("recoveryPartialFailure")
              : msg(
                  unresolved.length === 1
                    ? "couldNotSaveOne"
                    : "couldNotSaveMany",
                  { count: unresolved.length },
                ),
          );
        } else {
          recoveryErrorKind.current = storageFailure
            ? "storage"
            : accessFailure
              ? "access"
              : null;
          setError(
            storageFailure
              ? msg("recoveryStorageUnavailable")
              : accessFailure
                ? msg("recoveryAccessUnavailable")
                : msg("couldNotSaveEvents"),
          );
        }
      }
    } finally {
      // Always release this operation's busy state, but never release a newer
      // photo read/save that started after this operation.
      if (photoWorkRef.current === workId) setPhotoBusy(false);
    }
  }

  const present = (children: React.ReactNode) => {
    const body = <div hidden={privacyHidden}>{children}</div>;
    if (!inSheet) return body;
    const canDismiss = !busy && !photoBusy && recoveryBusyKey === null;
    return (
      <Dialog
        open={open}
        title={msg("quickAdd")}
        description={msg("quickAddDescription")}
        onClose={canDismiss ? onClose : undefined}
        closeLabel={msg("closeQuickAdd")}
        initialFocusRef={textInputRef}
        variant="form"
        testId="capture-sheet"
      >
        {body}
      </Dialog>
    );
  };

  if (childBlocked) {
    return present(
      <div
        className="card-apple p-4 text-subhead text-label-secondary"
        role="note"
        data-testid="capture-child-blocked"
      >
        <p>{CAPTURE_CHILD_MESSAGE}</p>
        {storageRecoveryNotice}
      </div>,
    );
  }

  if (availability === "retry") {
    return present(
      <div
        className={inSheet ? "p-1" : "card-apple p-4"}
        data-testid="capture-availability-retry"
      >
        <p role="alert" className="text-subhead text-[var(--danger-text)]">
          {msg("availabilityRetry")}
        </p>
        <button
          type="button"
          className="btn-tinted min-h-[44px] mt-3"
          onClick={() => void checkAvailability()}
          disabled={checkingAvailability}
        >
          {checkingAvailability ? msg("checking") : msg("retry")}
        </button>
      </div>,
    );
  }

  // No AI key on this deployment or household: show nothing rather than a
  // dead end. The calendar's own "Add Event" still works, and a parent can
  // add a key in Settings.
  if (unavailable) {
    if (saved || error || recoveryStorageBlocked) {
      return present(
        <div className="card-apple p-4" data-testid="capture-access-boundary">
          {saved && (
            <p
              role="status"
              className="text-subhead text-[var(--success,#059669)]"
            >
              {saved}
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="text-subhead text-[var(--danger-text)] mt-2"
            >
              {error}
            </p>
          )}
          {recoveryStorageBlocked && storageRecoveryNotice}
        </div>,
      );
    }
    return null;
  }

  const KindIcon = draft ? KIND_ICON[draft.kind] : Sparkles;
  return present(
    <div
      className={inSheet ? "p-1" : "card-apple p-4"}
      data-testid="capture-box"
    >
      {!inSheet && !recoveryOnly && (
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-[var(--accent)]" />
          <h2 className="text-headline">{msg("quickAdd")}</h2>
        </div>
      )}

      {!recoveryOnly && (
        <>
          <div className="flex gap-2">
            <input
              ref={textInputRef}
              className="input-apple flex-1"
              placeholder={msg("quickAddPlaceholder")}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy) interpret();
              }}
              disabled={busy}
              aria-label={msg("captureInputLabel")}
            />
            <button
              className="btn-filled px-4"
              onClick={interpret}
              disabled={busy || !text.trim()}
            >
              {busy && !draft ? (
                <>
                  <Loader2
                    className="w-4 h-4 animate-spin"
                    aria-hidden="true"
                  />
                  <span className="sr-only">{msg("reading")}</span>
                </>
              ) : (
                msg("readIt")
              )}
            </button>
          </div>

          {/* Photo capture: a flyer, timetable or appointment card. */}
          <div className="mt-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) interpretPhoto(f);
              }}
              aria-label={msg("choosePhoto")}
            />
            <button
              className="btn-plain text-footnote inline-flex items-center gap-1.5"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || photoBusy}
            >
              {photoBusy ? (
                <Loader2
                  className="w-3.5 h-3.5 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Camera className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              {photoBusy ? msg("readingPhoto") : msg("takePhoto")}
            </button>
          </div>
        </>
      )}

      {reading && !extraction && (
        <button
          type="button"
          className="btn-plain min-h-11 mt-2"
          onClick={cancelRead}
        >
          {msg("cancelRead")}
        </button>
      )}

      {error && (
        <p role="alert" className="text-subhead text-[var(--danger-text)] mt-3">
          {error}
        </p>
      )}

      {saved && (
        <p
          role="status"
          className="text-subhead text-[var(--success,#059669)] mt-3 flex items-center gap-1"
        >
          <Check className="w-4 h-4" aria-hidden="true" /> {saved}
        </p>
      )}

      {recoveryOnly &&
        availability === "available" &&
        !checkingAvailability &&
        recoveryOperations.length === 0 &&
        !recoveryStorageBlocked && (
          <p role="status" className="text-footnote text-label-secondary">
            {msg("noEarlierRequests")}
          </p>
        )}
      {(recoveryOperations.length > 0 ||
        recoveryMessage ||
        recoveryStorageBlocked) && (
        <section
          className="mt-4 rounded-xl border border-[var(--separator)] p-3"
          aria-labelledby={
            recoveryOperations.length > 0 ? "capture-recovery-title" : undefined
          }
          data-testid="capture-recovery"
        >
          {storageRecoveryNotice}
          {recoveryOperations.length > 0 && (
            <>
              <h3 id="capture-recovery-title" className="text-body font-medium">
                {msg("needsAttention")}
              </h3>
              <p className="text-footnote text-label-secondary mt-1">
                {msg("previousAddHint")}
              </p>
              <ul className="mt-2 space-y-2">
                {recoveryOperations.map((row) => {
                  const busyRecovery = recoveryBusyKey === row.key;
                  return (
                    <li
                      key={row.key}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span className="text-subhead min-w-0 truncate">
                        {titleFor(row)}
                      </span>
                      <span className="flex shrink-0 gap-2">
                        <button
                          className="btn-plain min-h-[44px] px-3"
                          onClick={() => checkRecovery(row)}
                          disabled={
                            recoveryBusyKey !== null || busy || photoBusy
                          }
                          aria-label={msg("checkStatusFor", {
                            title: titleFor(row),
                          })}
                        >
                          {busyRecovery ? msg("checking") : msg("checkStatus")}
                        </button>
                        <button
                          className="btn-filled min-h-[44px] px-3"
                          onClick={() => retryRecovery(row)}
                          disabled={
                            recoveryBusyKey !== null ||
                            busy ||
                            photoBusy ||
                            !row.requestHash
                          }
                          aria-label={msg("retryFor", { title: titleFor(row) })}
                        >
                          {msg("retry")}
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {recoveryMessage && (
            <p
              role="alert"
              className="text-subhead text-[var(--danger-text)] mt-3"
            >
              {recoveryMessage}
            </p>
          )}
        </section>
      )}

      {draft && (
        <div className="mt-4 rounded-xl border border-[var(--separator)] p-3">
          <div className="flex items-center gap-2 text-label-secondary text-footnote mb-1">
            <KindIcon className="w-3.5 h-3.5" />
            {msg(KIND_MESSAGE[draft.kind])}
            {draft.confidence === "low" && (
              <span className="text-[var(--danger-text)]">
                {msg("lowConfidence")}
              </span>
            )}
          </div>

          <p className="text-body font-medium">{draft.title}</p>

          {draft.kind !== "listitem" && (
            <p className="text-subhead text-label-secondary">
              {friendlyTime(draft.start_time, locale, msg("noDate"))}
              {draft.location ? ` · ${draft.location}` : ""}
            </p>
          )}

          {draft.note && (
            <p className="text-footnote text-label-secondary mt-1">
              {draft.note}
            </p>
          )}

          {draft.kind === "task" && (
            <div className="mt-3 space-y-2">
              <p role="note" className="text-footnote text-label-secondary">
                {msg("taskNeedsReview")}
              </p>
              {captureRole === "parent" && (
                <a
                  href="/dashboard/chores/create"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-tinted min-h-[44px] inline-flex items-center"
                >
                  {msg("openChoreReview")}
                </a>
              )}
            </div>
          )}
          <div className="flex gap-2 mt-3">
            {draft.kind !== "task" && (
              <button
                className="btn-filled px-4"
                onClick={confirm}
                disabled={
                  busy ||
                  photoBusy ||
                  recoveryBusyKey !== null ||
                  recoveryStorageBlocked
                }
              >
                {busy ? (
                  <>
                    <Loader2
                      className="w-4 h-4 animate-spin"
                      aria-hidden="true"
                    />
                    <span className="sr-only">{msg("adding")}</span>
                  </>
                ) : (
                  msg("addIt")
                )}
              </button>
            )}
            <button
              className="btn-plain min-h-[44px] min-w-[44px] px-4"
              onClick={() => setDraft(null)}
              disabled={busy}
              aria-label={msg("discard")}
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {photoEvents && (
        <div className="mt-4 rounded-xl border border-[var(--separator)] p-3">
          <div className="flex items-center gap-2 text-label-secondary text-footnote mb-2">
            <Camera className="w-3.5 h-3.5" />
            {photoEvents.length === 0
              ? msg("noEventsFound")
              : msg(photoEvents.length === 1 ? "foundOne" : "foundMany", {
                  count: photoEvents.length,
                })}
          </div>

          {photoEvents.length > 0 && (
            <ul className="space-y-2">
              {photoEvents.slice(photoOffset, photoOffset + 5).map((ev, i) => (
                <li key={photoOffset + i} className="flex items-start gap-2">
                  <button
                    className="btn-plain -my-2 min-h-[44px] min-w-[44px] p-1 shrink-0"
                    aria-label={msg("removeEvent", { title: ev.title })}
                    disabled={photoBusy}
                    onClick={() =>
                      setPhotoEvents((prev) =>
                        prev ? prev.filter((current) => current !== ev) : prev,
                      )
                    }
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  <div className="min-w-0">
                    <p className="text-body">{ev.title}</p>
                    <p className="text-footnote text-label-secondary">
                      {friendlyTime(ev.start_time, locale, msg("noDate"))}
                      {ev.location ? ` · ${ev.location}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {photoEvents.length > 5 && (
            <div className="mt-3 space-y-2">
              <p className="text-footnote text-label-secondary" role="status">
                {msg("reviewWindow", {
                  start: photoOffset + 1,
                  end: Math.min(photoOffset + 5, photoEvents.length),
                  total: photoEvents.length,
                })}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-plain min-h-[44px]"
                  disabled={photoOffset === 0 || photoBusy || busy}
                  onClick={() =>
                    setPhotoOffset((value) => Math.max(0, value - 5))
                  }
                >
                  {msg("previousPreview")}
                </button>
                <button
                  type="button"
                  className="btn-plain min-h-[44px]"
                  disabled={
                    photoOffset + 5 >= photoEvents.length || photoBusy || busy
                  }
                  onClick={() => setPhotoOffset((value) => value + 5)}
                >
                  {msg("nextPreview")}
                </button>
              </div>
            </div>
          )}

          {photoNote && (
            <p className="text-footnote text-label-secondary mt-2">
              {photoNote}
            </p>
          )}

          <div className="flex gap-2 mt-3">
            {photoEvents.length > 0 && (
              <button
                className="btn-filled px-4"
                onClick={confirmPhoto}
                disabled={
                  photoBusy ||
                  busy ||
                  recoveryBusyKey !== null ||
                  recoveryStorageBlocked
                }
              >
                {photoBusy ? (
                  <>
                    <Loader2
                      className="w-4 h-4 animate-spin"
                      aria-hidden="true"
                    />
                    <span className="sr-only">{msg("adding")}</span>
                  </>
                ) : (
                  msg(photoEvents.length === 1 ? "addOne" : "addMany", {
                    count: photoEvents.length,
                  })
                )}
              </button>
            )}
            <button
              className="btn-plain px-4"
              onClick={() => {
                setPhotoEvents(null);
                setPhotoNote(null);
              }}
              disabled={photoBusy}
            >
              {msg("cancel")}
            </button>
          </div>
        </div>
      )}
    </div>,
  );
}
