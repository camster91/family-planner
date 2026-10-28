"use client";

import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import { useOwnedDraftExit } from "@/components/layout/owned-draft-navigation";
import { useChoreVerificationText, type ChoreVerificationMessage } from "@/i18n/chore-verification";
import { makeOwnedChoreCheckIntent, readOwnedChoreCheck, sendOwnedChoreCheck,
  type OwnedChoreCheckIntent, type OwnedChoreRead } from "@/lib/chore-check-command-client";
import { CHORE_CHECK_COMMAND_PROTOCOL, sameChoreCheckSnapshot,
  type ChoreCheckOwner } from "@/lib/chore-check-command-shared";
import type { CheckedChoreState } from "@/lib/chore-tick-client";

type Current = Extract<OwnedChoreRead, { kind: "current" }>;
/** One mounted, original-parent review. Unknown writes retain exact intent until
 * explicit replacement after a different version, or deliberate local discard.
 * No persistent journal or cancellation/rollback claim on close/navigation.
 */
export function OwnedChoreReview({ owner, choreId, initialDecision, onSaved, onClose }: {
  owner: ChoreCheckOwner; choreId: string; initialDecision: "approve" | "reject";
  onSaved: (state: CheckedChoreState) => void; onClose: () => void;
}) {
  const text = useChoreVerificationText();
  const [source, setSource] = React.useState<Current | null>(null);
  const [latest, setLatest] = React.useState<Current | null>(null);
  const [notes, setNotes] = React.useState("");
  const [decision, setDecision] = React.useState(initialDecision);
  const [intent, setIntent] = React.useState<OwnedChoreCheckIntent | null>(null);
  const intentRef = React.useRef<OwnedChoreCheckIntent | null>(null);
  const [message, setMessage] = React.useState<ChoreVerificationMessage>("reviewLoading");
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [saved, setSaved] = React.useState(false);
  const [retired, setRetired] = React.useState(false);
  const [leaving, setLeaving] = React.useState(false);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const noteId = React.useId();
  const live = React.useRef(false);
  const sequence = React.useRef(0);
  const request = React.useRef<AbortController | null>(null);
  const closeRequest = React.useRef<() => void>(() => {});
  const navigation = usePendingFormNavigationController(true, {
    onBack: () => closeRequest.current(), warnOnUnload: Boolean(notes || intent || busy),
  });
  useOwnedDraftExit(true, async () => {
    setMessage("reviewNavigation");
    if (!busyRef.current) setLeaving(true);
    return false;
  }, navigation.releaseBeforeNavigation);

  const finish = async () => {
    if (busyRef.current) return;
    if (await navigation.releaseBeforeNavigation() && live.current) onClose();
  };
  closeRequest.current = () => {
    if (busyRef.current) return;
    if (!saved && (notes || intentRef.current)) setLeaving(true);
    else void finish();
  };
  React.useEffect(() => {
    live.current = true;
    return () => { live.current = false; sequence.current++; request.current?.abort(); busyRef.current = false; };
  }, []);
  const inspect = React.useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setLeaving(false);
    const epoch = ++sequence.current;
    const controller = new AbortController(); request.current = controller;
    try {
      const result = await readOwnedChoreCheck(owner, choreId, controller.signal);
      if (!live.current || epoch !== sequence.current) return;
      if (result.kind !== "current") {
        if (result.kind === "held" && ["CHORE_CHECK_OWNER_CHANGED", "FORBIDDEN", "UNAUTHORIZED"].includes(result.code)) {
          setRetired(true); setMessage("reviewOwnerChanged");
        } else setMessage("reviewUnavailable");
        return;
      }
      const original = intentRef.current;
      if (!original) {
        setSource(result); setLatest(null);
        setMessage(result.chore?.status === "completed" && result.version ? "waitingForCheck" : "reviewNotCompleted");
      } else if (result.version && sameChoreCheckSnapshot(original.expected, result.version)) {
        setLatest(null); setMessage("reviewSame");
      } else {
        setLatest(result); setMessage("reviewChanged");
      }
    } finally {
      if (live.current && epoch === sequence.current) { busyRef.current = false; setBusy(false); request.current = null; }
    }
  }, [owner, choreId]);
  React.useEffect(() => { void inspect(); }, [inspect]);

  const submit = async () => {
    if (busyRef.current || retired || saved || !source?.version || source.chore?.status !== "completed") return;
    let original = intentRef.current;
    if (!original) {
      try { original = makeOwnedChoreCheckIntent({ protocol: CHORE_CHECK_COMMAND_PROTOCOL, owner, choreId,
        expected: source.version, decision, ...(decision === "reject" ? { verificationNotes: notes.trim() } : {}) }); }
      catch { setMessage("reviewUnavailable"); return; }
      intentRef.current = original; setIntent(original);
    }
    busyRef.current = true; setBusy(true); setLatest(null); setLeaving(false);
    const epoch = ++sequence.current;
    const controller = new AbortController(); request.current = controller;
    try {
      const result = await sendOwnedChoreCheck(original, controller.signal);
      if (!live.current || epoch !== sequence.current) return;
      if (result.kind === "accepted") {
        setSaved(true); setMessage("reviewSaved");
        if (result.chore) onSaved(result.chore);
      } else if (result.kind === "held" && ["CHORE_CHECK_OWNER_CHANGED", "FORBIDDEN", "UNAUTHORIZED"].includes(result.code)) {
        setRetired(true); setMessage("reviewOwnerChanged");
      } else setMessage(result.kind === "unknown" ? "reviewUnknown" : "reviewHeld");
    } finally {
      if (live.current && epoch === sequence.current) { busyRef.current = false; setBusy(false); request.current = null; }
    }
  };
  const replaceReview = () => {
    if (busyRef.current || !latest?.version || latest.chore?.status !== "completed" || !intentRef.current
        || sameChoreCheckSnapshot(intentRef.current.expected, latest.version)) return;
    // Explicitly retire the old CAS attempt only after a distinct current version.
    intentRef.current = null; setIntent(null); setSource(latest); setLatest(null); setMessage("waitingForCheck");
  };
  const shown = latest ?? source;
  const canWrite = !retired && !saved && source?.chore?.status === "completed" && Boolean(source.version);
  return <Dialog open title={text("reviewTitle")} description={text("reviewDescription")}
    onClose={busy ? undefined : () => closeRequest.current()} closeLabel={text("close")}
    initialFocusRef={cancelRef} variant="form" testId="owned-chore-review"
    footer={<div className="flex flex-wrap gap-2">
      <button ref={cancelRef} type="button" className="btn-tinted min-h-[44px]" disabled={busy}
        onClick={() => closeRequest.current()}>{text("close")}</button>
      {!saved && !retired && <button type="button" className="btn-tinted min-h-[44px]" disabled={busy}
        onClick={() => void inspect()}>{text(busy ? "reviewReading" : "reviewRead")}</button>}
      {canWrite && !latest && <button type="button" className="btn-filled min-h-[44px]" disabled={busy}
        onClick={() => void submit()}>{text(busy ? (decision === "approve" ? "verifying" : "sendingBack") : intent ? "reviewOriginal" : decision === "approve" ? "verify" : "sendBack")}</button>}
    </div>}>
    <div className="space-y-4" aria-busy={busy || undefined}>
      <p role="status" aria-live="polite" className="text-body">{text(message)}</p>
      {!retired && shown?.chore && <>
        <h3 className="text-title-3 font-semibold [overflow-wrap:anywhere]">{shown.chore.title}</h3>
        {typeof shown.chore.description === "string" && shown.chore.description && <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-label-secondary">{shown.chore.description}</p>}
        {latest && <p className="text-footnote">{text(latest.chore?.status === "completed" && latest.version ? "reviewChanged" : "reviewNotCompleted")}</p>}
      </>}
      {!retired && canWrite && <fieldset disabled={busy || Boolean(intent)} className="space-y-3 disabled:opacity-60">
        <legend className="sr-only">{text("reviewTitle")}</legend>
        <div className="flex flex-wrap gap-2">{(["approve", "reject"] as const).map(value => <button key={value} type="button"
          aria-pressed={decision === value} className="btn-tinted min-h-[44px]" onClick={() => setDecision(value)}>{text(value === "approve" ? "verify" : "sendBack")}</button>)}</div>
        {decision === "reject" && <div><label htmlFor={noteId} className="block text-subhead">{text("reasonLabel")}</label>
          <textarea id={noteId} value={notes} maxLength={500} rows={3} className="input-field mt-2 w-full" placeholder={text("reasonPlaceholder")}
            onChange={event => setNotes(event.target.value)} /></div>}
      </fieldset>}
      {!retired && latest?.version && latest.chore?.status === "completed" && <button type="button" className="btn-filled min-h-[44px]" disabled={busy}
        onClick={replaceReview}>{text("reviewLatest")}</button>}
      {leaving && <div className="space-y-3 rounded-xl border border-[var(--surface-separator)] p-3" role="alert">
        <p>{text("reviewLeaveWarning")}</p><div className="flex flex-wrap gap-2">
          <button type="button" className="btn-tinted min-h-[44px]" onClick={() => setLeaving(false)}>{text("reviewKeep")}</button>
          <button type="button" className="btn-destructive min-h-[44px]" disabled={busy} onClick={() => void finish()}>{text("reviewLeave")}</button>
        </div>
      </div>}
    </div>
  </Dialog>;
}
