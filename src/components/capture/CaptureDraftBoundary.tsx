"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import { useRoutineLinkNavigation } from "@/components/chores/useRoutineLinkNavigation";
import { useCaptureDraftText } from "@/i18n/capture-drafts";
import {
  browserReviewDocument,
  readReviewDocumentContext,
} from "@/lib/review-document-browser";
import {
  reviewDocumentPayload,
  type ReviewDocumentContext,
  type ReviewDocumentEntry,
} from "@/lib/review-document-contract";
import {
  captureRequestDrafts,
  type CaptureEditableDocument,
  type CaptureReviewProvenance,
} from "@/lib/capture-document";
import {
  newReviewDocument,
  type ReviewReceiptState,
} from "@/lib/review-document-store";
import { inspectReviewDocumentReceipt } from "@/lib/review-document-receipts";
import { submitReviewDocumentRequest } from "@/lib/review-document-submit";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import { sameQueueOwner } from "@/lib/queue-owner-contract";
import { OwnedRequestRecoveryError } from "@/lib/owned-request-journal";
import { CaptureDraftFields } from "./CaptureDraftFields";
import type { CaptureBoxProps, CaptureExtraction } from "./CaptureBox";
type Phase = "loading" | "legacy" | "choose" | "editing" | "submitted" | "hold";
const empty = (): CaptureEditableDocument => ({
  domain: "capture",
  rows: [],
  note: "",
});
const manual = (): CaptureReviewProvenance => ({
  source: "manual",
  sourceUrl: null,
  confidence: "unknown",
  unknowns: [],
  evaluatedAt: null,
});
const unpack = (entry: ReviewDocumentEntry) =>
  reviewDocumentPayload.parse(JSON.parse(entry.body));
const fingerprint = (
  draft: CaptureEditableDocument,
  provenance: CaptureReviewProvenance,
) => JSON.stringify({ draft, provenance });

/** Owns only review documents. Extraction and old recovery stay in their
 * original component; all effects use canonical handlers through exact submits.
 */
export function CaptureDraftBoundary(
  props: CaptureBoxProps & {
    renderLegacy: (
      overrides: Partial<CaptureBoxProps> & {
        recoveryOnly?: boolean;
        privacyHidden?: boolean;
      },
    ) => React.ReactNode;
    renderExtractor: (extraction: CaptureExtraction) => React.ReactNode;
  },
) {
  const text = useCaptureDraftText(),
    router = useRouter();
  const textRef = React.useRef(text);
  textRef.current = text;
  const callbacks = React.useRef(props);
  callbacks.current = props;
  const context = React.useRef<ReviewDocumentContext | null>(null);
  const store = React.useRef<ReturnType<typeof browserReviewDocument> | null>(
    null,
  );
  const entry = React.useRef<ReviewDocumentEntry | null>(null);
  const latest = React.useRef(empty()),
    provenance = React.useRef(manual()),
    acknowledged = React.useRef("");
  const initialized = React.useRef(false),
    mounted = React.useRef(false),
    epoch = React.useRef(0),
    flight = React.useRef(false),
    idle = React.useRef(Promise.resolve());
  const savingOnly = React.useRef(false);
  const previousOpen = React.useRef(props.open !== false);
  const phaseRef = React.useRef<Phase>("loading"),
    authorized = React.useRef(false);
  const activity = React.useRef({ busy: false, hasInput: false });
  const [phase, setPhaseState] = React.useState<Phase>("loading"),
    [visible, setVisible] = React.useState(false);
  const [draft, setDraftState] = React.useState(empty),
    [dirty, setDirty] = React.useState(false),
    [busy, setBusy] = React.useState(false);
  const [extracting, setExtracting] = React.useState(false),
    [hasInput, setHasInput] = React.useState(false),
    [notice, setNotice] = React.useState<string | null>(null);
  const [resultOffset, setResultOffset] = React.useState(0);
  const [focusRow, setFocusRow] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<
      Array<ReviewReceiptState | null>
    >([]),
    [showLegacy, setShowLegacy] = React.useState(false);
  function setPhase(next: Phase) {
    phaseRef.current = next;
    setPhaseState(next);
  }
  function live(token: number) {
    return (
      mounted.current &&
      epoch.current === token &&
      document.visibilityState !== "hidden"
    );
  }
  function install(saved: ReviewDocumentEntry) {
    const document = unpack(saved);
    if (document.draft.domain !== "capture")
      throw new OwnedRequestRecoveryError("OWNER_CHANGED");
    latest.current = document.draft;
    provenance.current = document.provenance;
    acknowledged.current = fingerprint(document.draft, document.provenance);
    setDraftState(document.draft);
    setFocusRow(document.draft.rows[0]?.clientId ?? null);
    setDirty(false);
    setResultOffset(0);
  }
  function reset() {
    entry.current = null;
    latest.current = empty();
    provenance.current = manual();
    acknowledged.current = "";
    setDraftState(latest.current);
    setFocusRow(null);
    setDirty(false);
    setResults([]);
    setResultOffset(0);
  }
  async function current() {
    const next = await readReviewDocumentContext("capture"),
      prior = context.current;
    if (
      (next.adopted && !next.owner) ||
      (prior &&
        (prior.userId !== next.userId ||
          prior.familyId !== next.familyId ||
          prior.role !== next.role ||
          prior.adopted !== next.adopted ||
          (prior.adopted &&
            (!prior.owner ||
              !next.owner ||
              !sameQueueOwner(prior.owner, next.owner)))))
    )
      throw new OwnedRequestRecoveryError("OWNER_CHANGED");
    context.current = next;
    return next;
  }
  async function run(
    task: (token: number) => Promise<void>,
    draftOnly = false,
  ) {
    if (flight.current) return false;
    flight.current = true;
    savingOnly.current = draftOnly;
    setBusy(true);
    let release!: () => void;
    idle.current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const token = epoch.current;
    try {
      await task(token);
      return live(token);
    } catch (error) {
      if (live(token)) {
        const changed =
          error instanceof OwnedRequestRecoveryError &&
          error.reason === "OWNER_CHANGED";
        setNotice(
          changed
            ? textRef.current.owner
            : error instanceof OwnedRequestRecoveryError &&
                error.reason === "REVIEW_REQUIRED"
              ? textRef.current.expired
              : textRef.current.storage,
        );
        if (changed) {
          authorized.current = false;
          setVisible(false);
          setPhase("hold");
          reset();
          setShowLegacy(false);
          callbacks.current.onAvailabilityChange?.("unavailable");
        }
      }
      return false;
    } finally {
      flight.current = false;
      savingOnly.current = false;
      release();
      if (mounted.current) {
        setBusy(false);
        if (token !== epoch.current && document.visibilityState !== "hidden")
          void run(load);
      }
    }
  }
  async function load(token: number) {
    if (
      new URLSearchParams(window.location.search)
        .getAll("mode")
        .includes("fridge") ||
      window.location.pathname.startsWith("/device")
    )
      throw new OwnedRequestRecoveryError("OWNER_CHANGED");
    const next = await current();
    if (!next.adopted) {
      if (live(token)) {
        setPhase("legacy");
        setVisible(callbacks.current.open !== false);
        authorized.current = callbacks.current.open !== false;
      }
      return;
    }
    store.current ??= browserReviewDocument(next);
    const rows = initialized.current
      ? await store.current.refresh()
      : await store.current.initialize();
    initialized.current = true;
    await current();
    if (!live(token)) return;
    entry.current = rows[0] ?? null;
    if (entry.current && unpack(entry.current).phase === "submitted") {
      install(entry.current);
      setPhase("submitted");
    } else if (
      phaseRef.current === "loading" ||
      phaseRef.current === "hold" ||
      phaseRef.current === "submitted"
    ) {
      setPhase(entry.current ? "choose" : "editing");
      if (!entry.current) reset();
    } else setDraftState(latest.current);
    setVisible(callbacks.current.open !== false);
    authorized.current = callbacks.current.open !== false;
    setNotice(null);
    // Recovery remains reachable even without an extraction provider.
    callbacks.current.onAvailabilityChange?.("available");
  }
  React.useEffect(() => {
    mounted.current = true;
    void run(load);
    const hide = () => {
      epoch.current++;
      authorized.current = false;
      setVisible(false);
    };
    const refresh = () => {
      if (document.visibilityState !== "hidden") {
        authorized.current = false;
        setVisible(false);
        void run(load);
      }
    };
    const visibility = () =>
      document.visibilityState === "hidden" ? hide() : refresh();
    window.addEventListener("blur", hide);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mounted.current = false;
      epoch.current++;
      window.removeEventListener("blur", hide);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
      document.removeEventListener("visibilitychange", visibility);
    };
    // The original authenticated person/namespace owns this controller forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  React.useEffect(() => {
    const open = props.open !== false;
    if (previousOpen.current === open) return;
    previousOpen.current = open;
    epoch.current++;
    authorized.current = false;
    setVisible(false);
    if (open && !flight.current) void run(load);
    // The original controller is renewed; hidden views never inherit authority.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);
  function change(value: CaptureEditableDocument) {
    if (
      !authorized.current ||
      phaseRef.current !== "editing" ||
      !context.current?.enabled ||
      (flight.current && !savingOnly.current) ||
      Boolean(store.current?.hasUncertainStorage()) ||
      activity.current.busy
    )
      return;
    latest.current = value;
    setDraftState(value);
    setDirty(fingerprint(value, provenance.current) !== acknowledged.current);
    if (!store.current?.hasUncertainStorage()) setNotice(null);
  }
  async function flush(value = latest.current, source = provenance.current) {
    if (!entry.current && !value.rows.length && !value.note) return;
    const next = await current();
    if (entry.current && fingerprint(value, source) === acknowledged.current) {
      await store.current!.read(entry.current.key);
      return;
    }
    if (!next.enabled) throw new OwnedRequestRecoveryError("DISABLED");
    const saved = entry.current;
    entry.current = saved
      ? await store.current!.save(saved.key, saved.body, value, source)
      : await store.current!.begin(
          newIdempotencyKey(),
          newReviewDocument(next, value, source, Date.now()),
        );
    acknowledged.current = fingerprint(value, source);
  }
  React.useEffect(() => {
    if (
      !dirty ||
      busy ||
      (!visible && props.open !== false) ||
      notice ||
      phase !== "editing"
    )
      return;
    const timer = window.setTimeout(() => {
      void run(async (token) => {
        await flush();
        if (live(token))
          setDirty(
            fingerprint(latest.current, provenance.current) !==
              acknowledged.current,
          );
      }, true);
    }, 500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, busy, visible, notice, phase, props.open]);
  const extraction = React.useMemo<CaptureExtraction>(
    () => ({
      begin: async () => {
        if (flight.current) await idle.current;
        if (
          !mounted.current ||
          document.visibilityState === "hidden" ||
          phaseRef.current !== "editing"
        )
          return null;
        // Native camera/file pickers background the window before delivering a
        // file. Renew after returning instead of silently losing that selection.
        if (!authorized.current && !(await run(load))) return null;
        if (
          (latest.current.rows.length > 0 || latest.current.note) &&
          !window.confirm(textRef.current.replaceReview)
        )
          return null;
        return authorized.current &&
          context.current?.enabled &&
          !store.current?.hasUncertainStorage()
          ? epoch.current
          : null;
      },
      accept: async (value, source, token) => {
        if (flight.current) await idle.current;
        if (
          !live(token) ||
          !authorized.current ||
          phaseRef.current !== "editing"
        )
          return false;
        if (value.rows.length === 0) {
          setNotice(textRef.current.emptyRead);
          return true;
        }
        return run(async (work) => {
          await flush(value, source);
          latest.current = value;
          provenance.current = source;
          if (!live(work)) return;
          setDraftState(value);
          setFocusRow(value.rows[0]?.clientId ?? null);
          setDirty(false);
          setNotice(null);
        });
      },
      refuse: () => {
        epoch.current++;
        authorized.current = false;
        setVisible(false);
        if (!flight.current && mounted.current) void run(load);
      },
      activity: (value) => {
        activity.current = value;
        if (mounted.current) {
          setExtracting(value.busy);
          setHasInput(value.hasInput);
        }
      },
      // Methods use current refs; keep the extractor's provider effects stable.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }),
    [],
  );
  const legacyAvailability = React.useCallback(
    (value: "available" | "unavailable" | "retry") => {
      if (value === "unavailable") extraction.refuse();
    },
    [extraction],
  );
  React.useEffect(() => {
    callbacks.current.onDraftStateChange?.(
      draft.rows.length > 0 ||
        phase === "submitted" ||
        activity.current.hasInput,
    );
  }, [draft, phase, extracting, hasInput]);
  const navigation = usePendingFormNavigationController(
    props.open !== false &&
      phase !== "legacy" &&
      (dirty ||
        extracting ||
        hasInput ||
        (props.presentation === "sheet" && props.open !== false)),
    {
      warnOnUnload: dirty || extracting || activity.current.hasInput,
      onBack: () => {
        void close();
      },
    },
  );
  async function close(href?: string) {
    if (activity.current.busy) return;
    if (flight.current) await idle.current;
    if (!authorized.current || !visible) return;
    if (phaseRef.current === "choose" && dirty) {
      setNotice(text.resolveConflict);
      return;
    }
    if (activity.current.hasInput && !window.confirm(text.leaveInput)) return;
    await run(async (token) => {
      if (phaseRef.current === "editing") {
        await flush();
        if (live(token)) setDirty(false);
      }
      if (
        !live(token) ||
        !(await navigation.releaseBeforeNavigation()) ||
        !live(token)
      )
        return;
      if (href) router.push(href);
      else if (callbacks.current.onClose) callbacks.current.onClose();
      else router.back();
    });
  }
  useRoutineLinkNavigation(
    props.open !== false &&
      phase !== "legacy" &&
      (dirty || extracting || hasInput),
    async (href) => {
      await close(href);
    },
  );
  async function restore() {
    if (dirty && !window.confirm(text.restoreReplace)) return;
    await run(async (token) => {
      const saved = entry.current;
      if (!saved) return;
      const read = await store.current!.read(saved.key);
      if (read.entry.body !== saved.body || read.document.phase !== "editing")
        throw new OwnedRequestRecoveryError("INTENT_CHANGED");
      if (live(token)) {
        install(saved);
        setPhase("editing");
        setNotice(null);
      }
    });
  }
  async function discard() {
    await run(async (token) => {
      const saved = entry.current;
      if (!saved) return;
      await store.current!.discardEditable(saved.key, saved.body);
      // Clear refs even if backgrounding won the render race; never resurrect it.
      reset();
      if (live(token)) {
        setPhase("editing");
        setNotice(null);
      }
    });
  }
  async function recover() {
    await run(async (token) => {
      if (!store.current) {
        await load(token);
        return;
      }
      const rows = store.current.hasUncertainStorage()
        ? await store.current.recoverStorage()
        : await store.current.initialize();
      initialized.current = true;
      await current();
      if (!live(token)) return;
      entry.current = rows[0] ?? null;
      setResults([]);
      setNotice(null);
      setVisible(true);
      authorized.current = true;
      if (entry.current) {
        if (unpack(entry.current).phase === "submitted") {
          install(entry.current);
          setPhase("submitted");
        } else setPhase("choose");
      } else {
        reset();
        setPhase("editing");
      }
    });
  }
  async function inspect(token: number) {
    const saved = entry.current;
    if (!saved) return;
    const states = await store.current!.inspectReceipts(
      saved.key,
      saved.body,
      inspectReviewDocumentReceipt,
    );
    if (live(token)) {
      setResults(states);
      if (states.some((result) => result.state === "committed"))
        callbacks.current.onSaved?.();
    }
  }
  async function send(token: number) {
    const saved = entry.current;
    if (!saved) return;
    const document = unpack(saved);
    if (document.phase !== "submitted") return;
    const states: Array<ReviewReceiptState | null> = document.requests.map(
      () => null,
    );
    let changed = false;
    for (let index = 0; index < document.requests.length; index++) {
      if (!live(token)) break;
      const request = document.requests[index];
      const result = await store.current!.sendExact(
        saved.key,
        saved.body,
        request.key,
        inspectReviewDocumentReceipt,
        (intent, context) =>
          submitReviewDocumentRequest(intent, context, document.expiresAt),
      );
      if (!live(token)) break;
      if (!result.sent) {
        states[index] = result.receipt;
        if (result.receipt.state === "committed") changed = true;
      } else if (result.result.kind === "reply" && result.result.response.ok) {
        states[index] = await store.current!.inspectReceipt(
          saved.key,
          saved.body,
          request.key,
          inspectReviewDocumentReceipt,
        );
        if (states[index]?.state === "committed") changed = true;
      } else {
        setNotice(text.uncertain);
        break;
      }
      if (!live(token)) break;
      setResults([...states]);
      if (
        states[index]?.state === "pending" ||
        states[index]?.state === "refused" ||
        states[index]?.state === "expired"
      )
        break;
    }
    if (live(token) && changed) callbacks.current.onSaved?.();
  }
  async function confirm() {
    if (flight.current) await idle.current;
    if (
      !authorized.current ||
      phaseRef.current !== "editing" ||
      activity.current.busy ||
      !context.current?.enabled
    )
      return;
    if (activity.current.hasInput && !window.confirm(text.unreadInput)) return;
    const snapshot = latest.current,
      source = provenance.current;
    let requests: ReturnType<typeof captureRequestDrafts>;
    try {
      requests = captureRequestDrafts(snapshot);
    } catch {
      setNotice(
        snapshot.rows.some((row) => row.kind === "task")
          ? text.taskHint
          : text.invalid,
      );
      return;
    }
    await run(async (token) => {
      await flush(snapshot, source);
      const saved = entry.current!;
      entry.current = await store.current!.freeze(
        saved.key,
        saved.body,
        requests.map((request) => ({ ...request, key: newIdempotencyKey() })),
      );
      if (!live(token)) return;
      setPhase("submitted");
      setDirty(false);
      setResults([]);
      setNotice(null);
      await send(token);
    });
  }
  async function finish(acknowledgeRemoved = false) {
    await run(async (token) => {
      const saved = entry.current;
      if (!saved) return;
      if (
        !(await store.current!.retireConfirmed(
          saved.key,
          saved.body,
          inspectReviewDocumentReceipt,
          { acknowledgeRemoved },
        ))
      ) {
        await inspect(token);
        return;
      }
      reset();
      if (live(token)) {
        setPhase("editing");
        setNotice(null);
        callbacks.current.onSaved?.();
      }
    });
  }
  function add(kind: "event" | "listitem") {
    if (latest.current.rows.length >= 20) return;
    const clientId = newIdempotencyKey();
    change({
      ...latest.current,
      rows: [
        ...latest.current.rows,
        {
          clientId,
          kind,
          title: "",
          startTime: "",
          endTime: "",
          location: "",
          eventType: "other",
          listName: "",
          quantity: "1",
        },
      ],
    });
    if (latest.current.rows.some((row) => row.clientId === clientId))
      setFocusRow(clientId);
  }
  function receiptLabel(value: ReviewReceiptState | null) {
    if (!value) return text.unknown;
    if (value.state === "committed")
      return value.current === "present"
        ? text.present
        : value.current === "removed"
          ? text.removed
          : text.opaque;
    return value.state === "absent"
      ? text.absent
      : value.state === "pending"
        ? text.pending
        : value.state === "expired"
          ? text.receiptExpired
          : text.refused;
  }
  if (phase === "legacy")
    return props.renderLegacy({ privacyHidden: !visible });
  const disabled =
    (busy && !savingOnly.current) ||
    extracting ||
    !visible ||
    !context.current?.enabled ||
    Boolean(store.current?.hasUncertainStorage());
  const savedDocument = entry.current ? unpack(entry.current) : null;
  const requestCount =
    savedDocument?.phase === "submitted" ? savedDocument.requests.length : 0;
  const allKnown =
    results.length > 0 &&
    results.length === requestCount &&
    results.every(
      (result) => result?.state === "committed" && result.current !== "unknown",
    );
  const hasRemoved = results.some(
    (result) => result?.state === "committed" && result.current === "removed",
  );
  const content = (
    <div className="space-y-4" data-testid="capture-owned-review">
      {!visible && <p role="status">{text.checking}</p>}
      {notice && (
        <p
          role={notice === text.emptyRead ? "status" : "alert"}
          className="text-footnote text-[var(--danger-text)]"
        >
          {notice}
        </p>
      )}
      <div hidden={!visible} className="space-y-4">
        {!context.current?.enabled && <p role="status">{text.paused}</p>}
        {phase === "choose" && (
          <div className="space-y-2">
            <p>{text.found}</p>
            <button
              type="button"
              className="btn-tinted min-h-11"
              disabled={busy}
              onClick={() => void restore()}
            >
              {text.restore}
            </button>
            <button
              type="button"
              className="btn-plain min-h-11"
              disabled={busy}
              onClick={() => {
                if (window.confirm(text.discardConfirm)) void discard();
              }}
            >
              {text.discard}
            </button>
          </div>
        )}
        {phase === "editing" && (
          <>
            <p className="text-footnote text-label-secondary">
              {text.saveHint}
            </p>
            {provenance.current.source !== "manual" &&
              (provenance.current.confidence === "low" ||
                provenance.current.confidence === "unknown") && (
                <p role="note" className="text-footnote text-label-secondary">
                  {text.lowConfidence}
                </p>
              )}

            <fieldset disabled={disabled}>
              {props.renderExtractor(extraction)}
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-plain min-h-11"
                disabled={disabled || draft.rows.length >= 20}
                onClick={() => add("event")}
              >
                {text.manualEvent}
              </button>
              <button
                type="button"
                className="btn-plain min-h-11"
                disabled={disabled || draft.rows.length >= 20}
                onClick={() => add("listitem")}
              >
                {text.manualGrocery}
              </button>
            </div>
            <CaptureDraftFields
              value={draft}
              onChange={change}
              disabled={disabled}
              parent={context.current?.role === "parent"}
              focusClientId={focusRow}
            />
            {(draft.rows.length > 0 || entry.current) && (
              <>
                <p role="status" className="text-footnote text-label-secondary">
                  {dirty || busy ? text.saving : text.saved}
                </p>
                <p className="text-footnote text-label-secondary">
                  {text.batchHint}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-filled min-h-11"
                    disabled={disabled || !draft.rows.length}
                    onClick={() => void confirm()}
                  >
                    {draft.rows.length === 1 &&
                    draft.rows[0].kind === "listitem"
                      ? text.groceryConfirm
                      : text.confirm}
                  </button>
                  {entry.current && (
                    <button
                      type="button"
                      className="btn-plain min-h-11"
                      disabled={busy || extracting}
                      onClick={() => {
                        if (window.confirm(text.discardConfirm)) void discard();
                      }}
                    >
                      {text.discard}
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        )}
        {phase === "submitted" && (
          <div className="space-y-3">
            <p>{text.frozen}</p>
            <ol className="space-y-2">
              {draft.rows
                .slice(resultOffset, resultOffset + 5)
                .map((row, index) => (
                  <li key={row.clientId} className="text-subhead">
                    <span className="font-medium">{row.title}</span>
                    <p
                      role="status"
                      className="text-footnote text-label-secondary"
                    >
                      {receiptLabel(results[resultOffset + index] ?? null)}
                    </p>
                  </li>
                ))}
            </ol>
            {draft.rows.length > 5 && (
              <div className="flex flex-wrap items-center gap-2">
                <span role="status" className="text-footnote">
                  {resultOffset + 1}–
                  {Math.min(resultOffset + 5, draft.rows.length)} /{" "}
                  {draft.rows.length}
                </span>
                <button
                  type="button"
                  className="btn-plain min-h-11"
                  disabled={resultOffset === 0}
                  onClick={() =>
                    setResultOffset((value) => Math.max(0, value - 5))
                  }
                >
                  {text.previous}
                </button>
                <button
                  type="button"
                  className="btn-plain min-h-11"
                  disabled={resultOffset + 5 >= draft.rows.length}
                  onClick={() => setResultOffset((value) => value + 5)}
                >
                  {text.next}
                </button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-tinted min-h-11"
                disabled={busy}
                onClick={() => void run(inspect)}
              >
                {text.check}
              </button>
              <button
                type="button"
                className="btn-tinted min-h-11"
                disabled={busy || !context.current?.enabled}
                onClick={() => void run(send)}
              >
                {text.retry}
              </button>
              {allKnown && (
                <button
                  type="button"
                  className="btn-plain min-h-11"
                  disabled={busy}
                  onClick={() => void finish(hasRemoved)}
                >
                  {hasRemoved ? text.finishRemoved : text.finish}
                </button>
              )}
            </div>
          </div>
        )}
        <details
          onToggle={(event) => {
            if (event.currentTarget.open) setShowLegacy(true);
          }}
        >
          <summary className="min-h-11 cursor-pointer content-center text-subhead">
            {text.legacy}
          </summary>
          <p className="text-footnote text-label-secondary">
            {text.legacyHint}
          </p>
          {showLegacy &&
            props.renderLegacy({
              presentation: "inline",
              recoveryOnly: true,
              onAvailabilityChange: legacyAvailability,
              onDraftStateChange: undefined,
              onClose: undefined,
            })}
        </details>
      </div>
      {(notice || !visible) && (
        <button
          type="button"
          className="btn-tinted min-h-11"
          disabled={busy}
          onClick={() => void recover()}
        >
          {text.recover}
        </button>
      )}
    </div>
  );
  if (props.presentation === "sheet")
    return (
      <Dialog
        open={props.open ?? true}
        title={text.title}
        onClose={
          !busy && !extracting
            ? () => {
                void close();
              }
            : undefined
        }
        closeLabel={text.close}
        variant="form"
      >
        {content}
      </Dialog>
    );
  return (
    <section aria-label={text.title} className="card-apple p-4">
      {content}
    </section>
  );
}
