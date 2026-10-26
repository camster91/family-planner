"use client";
import * as React from "react";
import { FEEDBACK_VIEW_HEADER, FEEDBACK_SUMMARY_VIEW } from "@/lib/feedback-response-contract";
import { requestOwnedJson, runOwnedForeground } from "@/lib/owned-request-http";
import { readBoundedJsonResponse } from "@/lib/bounded-json-response";
import Link from "next/link";
import { useDraftAwareRouter as useRouter } from "@/components/layout/owned-draft-navigation";
import { Mic, MicOff } from "lucide-react";
import {
  assistantResponseSchema,
  ASSISTANT_REFERENCES_PROTOCOL,
  ASSISTANT_CONFIRMATION_PROTOCOL,
  type AssistantEvidence,
} from "@/lib/assistant-reference-contract";
import { Dialog } from "@/components/ui/dialog";
import { useFeatures } from "@/components/providers/features-provider";
import {
  assistantDestination,
  canUseAssistantAction,
  type AssistantAction,
} from "@/lib/assistant-actions";
import {
  executeAssistantAction,
  removalTargets,
  previewRemovalTarget,
  choreAssignees,
  AssistantActionError,
  AssistantActionPreflightError,
  AssistantSourceRefusal,
  ActionOutcomeUnknown,
  type AssistantActionErrorCode,
  type RemovalTarget,
} from "./action-client";
import { WeeklyDaysPicker } from "@/components/chores/WeeklyDaysPicker";
import { useTranslation } from "@/i18n";
import {
  assistantMessages,
  assistantDestinationLabels,
  type AssistantMessage,
  type VoiceErrorCode,
} from "@/i18n/assistant";
import AppGuide from "./AppGuide";
import { AssistantQuickStart } from "./AssistantQuickStart";
import { MealPlanningReviewLinks } from "@/components/meals/planning/MealPlanningReviewLinks";
import { useVoiceDraft } from "./use-voice-draft";
import { LocalVoiceDraft } from "./LocalVoiceDraft";

type Message = {
  role: "user" | "assistant";
  content: string;
  evidence?: AssistantEvidence[];
};
type ChatRequest = {
  messages: Message[];
  inputText: string;
  localNow: string;
  timeZone: string;
  includeToday: boolean;
};
type TodayFreshness = {
  generatedAt: number;
  expiresAt: number;
  leaseStartedAt: number;
  leaseExpiresAt: number;
};
type Report = {
  id: string;
  kind: string;
  title: string;
  status: string;
  created_at: string;
};
function reportRows(value: unknown): Report[] | null {
  if (!value || typeof value !== "object" || !("reports" in value) || !Array.isArray(value.reports) || value.reports.length > 25) return null;
  const rows: Report[] = [];
  for (const row of value.reports) {
    if (!row || typeof row !== "object" ||
      !["id", "kind", "title", "status", "created_at"].every(key => typeof row[key] === "string") ||
      !row.id.trim() || !Number.isFinite(Date.parse(row.created_at))) return null;
    rows.push({ id: row.id, kind: row.kind, title: row.title, status: row.status, created_at: row.created_at });
  }
  return new Set(rows.map(row => row.id)).size === rows.length ? rows : null;
}
/** Provider work already has a30-second limit; leave room for server admission.
 * This bounds the caller, never proves that a timed-out provider call was free. */
async function readAssistantChat(init: RequestInit) {
  return runOwnedForeground(async signal => {
    let response: Response;
    try { response = await fetch("/api/assistant", { ...init, signal, cache: "no-store" }); }
    catch { return { kind: "network" as const }; }
    try {
      const body = await readBoundedJsonResponse(response, signal, 256 * 1024);
      return { kind: "reply" as const, response, body };
    } catch { return { kind: "unreadable" as const, response }; }
  }, { timeoutMs: 45_000 });
}
const target =
  "min-h-[44px] rounded-full px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)] disabled:opacity-50";
const ASSISTANT_TODAY_PROTOCOL = "herewoven.assistant-today.v1";
const ASSISTANT_TODAY_MAX_TTL_MS = 60_000;
export type AssistantPanelTab = "chat" | "report" | "reports";

export type AssistantPanelProps = {
  role: string;
  pathname: string;
  tab: AssistantPanelTab | null;
  panelOpen: boolean;
  onTabChange: (tab: AssistantPanelTab | null) => void;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  todayContextEnabled?: boolean;
  confirmationEnabled?: boolean;
  profileAssignmentEnabled?: boolean;
};

type AssistantError =
  | { kind: "chat"; key: AssistantMessage }
  | { kind: "copy"; key: AssistantMessage }
  | { kind: "action"; key: AssistantActionErrorCode }
  | { kind: "voice"; key: VoiceErrorCode }
  | { kind: "raw"; message: string };

type ActionRecovery = {
  error: AssistantError;
  href: string;
};

class AssistantCopyError extends Error {
  readonly key: AssistantMessage;

  constructor(key: AssistantMessage) {
    super(key);
    this.name = "AssistantCopyError";
    this.key = key;
  }
}

function toAssistantError(
  error: unknown,
  fallback: AssistantMessage,
): AssistantError {
  if (error instanceof AssistantActionError)
    return { kind: "action", key: error.code };
  if (error instanceof AssistantCopyError)
    return { kind: "copy", key: error.key };
  if (error instanceof Error) return { kind: "raw", message: error.message };
  return { kind: "copy", key: fallback };
}

function toChatError(
  error: unknown,
  fallback: AssistantMessage,
): Extract<AssistantError, { kind: "chat" }> {
  if (error instanceof AssistantCopyError)
    return { kind: "chat", key: error.key };
  return { kind: "chat", key: fallback };
}

function isChatErrorBody(
  value: unknown,
): value is { code?: unknown; error?: unknown } {
  return typeof value === "object" && value !== null;
}

function actionRecoveryPath(action: AssistantAction): string {
  if (action.kind === "open") return assistantDestination(action.destination);
  if (action.kind === "event_create" || action.kind === "event_delete")
    return "/dashboard/calendar";
  if (action.kind === "chore_create" || action.kind === "chore_delete")
    return "/dashboard/chores";
  if (action.kind === "note_create") return "/dashboard/notes";
  return "/dashboard/lists";
}

function actionRecoveryMessage(path: string): AssistantMessage {
  if (path === "/dashboard/calendar") return "checkCalendar";
  if (path === "/dashboard/chores") return "checkChores";
  if (path === "/dashboard/notes") return "checkNotes";
  return path === "/dashboard/lists" ? "checkLists" : "checkHelp";
}

function parseIsoHeader(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value)
    return null;
  return parsed;
}

function readTodayFreshness(
  headers: Headers | undefined,
  leaseStartedAt: number | null,
  responseAt: number | null,
  isVisible: boolean,
): TodayFreshness | null {
  if (
    !headers ||
    leaseStartedAt === null ||
    responseAt === null ||
    !isVisible ||
    responseAt < leaseStartedAt
  )
    return null;
  const protocol = headers.get("X-Assistant-Today-Protocol");
  if (protocol !== ASSISTANT_TODAY_PROTOCOL) return null;
  const generatedAt = parseIsoHeader(
      headers.get("X-Assistant-Today-Generated-At"),
    ),
    expiresAt = parseIsoHeader(headers.get("X-Assistant-Today-Expires-At"));
  if (generatedAt === null || expiresAt === null) return null;
  const ttl = expiresAt - generatedAt;
  if (ttl <= 0 || ttl > ASSISTANT_TODAY_MAX_TTL_MS) return null;
  const leaseExpiresAt = leaseStartedAt + ttl;
  if (responseAt >= leaseExpiresAt) return null;
  return {
    generatedAt,
    expiresAt,
    leaseStartedAt,
    leaseExpiresAt,
  };
}

export default function AssistantPanel({
  role,
  pathname,
  tab,
  panelOpen,
  onTabChange,
  onClose,
  onBusyChange,
  todayContextEnabled = false,
  confirmationEnabled = false,
  profileAssignmentEnabled = false,
}: AssistantPanelProps) {
  const router = useRouter(),
    { features } = useFeatures();
  const { t, locale } = useTranslation();
  const msg = (
    key: AssistantMessage,
    params?: Record<string, string | number>,
  ) => t(key, params, assistantMessages);
  const [messages, setMessages] = React.useState<Message[]>([]),
    [text, setText] = React.useState(""),
    [busy, setBusy] = React.useState(false),
    [error, setError] = React.useState<AssistantError | null>(null),
    [failedChat, setFailedChat] = React.useState<ChatRequest | null>(null),
    [actionRecovery, setActionRecovery] = React.useState<ActionRecovery | null>(
      null,
    ),
    [includeToday, setIncludeToday] = React.useState(false),
    [todayFreshness, setTodayFreshness] = React.useState<TodayFreshness | null>(
      null,
    ),
    [todayExpired, setTodayExpired] = React.useState(false);
  const [sourceProof, setSourceProof] = React.useState<string | undefined>();
  const [action, setAction] = React.useState<AssistantAction | null>(null),
    [targets, setTargets] = React.useState<RemovalTarget[]>([]),
    [selected, setSelected] = React.useState(""),
    [deleteConfirm, setDeleteConfirm] = React.useState(false),
    [choiceLoadFailed, setChoiceLoadFailed] = React.useState(false);
  const chosenSubject = targets.find(
    (target) => target.id === selected,
  )?.subject;
  const profileRecurrencePaused =
    chosenSubject?.kind === "profile" && !chosenSubject.recurrenceSupported;
  const [kind, setKind] = React.useState("bug"),
    [title, setTitle] = React.useState(""),
    [details, setDetails] = React.useState(""),
    [receipt, setReceipt] = React.useState(""),
    [reports, setReports] = React.useState<Report[]>([]),
    [reportsLoading, setReportsLoading] = React.useState(false),
    [reportsLoadFailed, setReportsLoadFailed] = React.useState(false);
  const reportRequest = React.useRef<{
    requestId: string;
    kind: string;
    title: string;
    details: string;
    page: string;
  } | null>(null);
  const actionKey = React.useRef(""),
    lock = React.useRef(false),
    consumed = React.useRef(false),
    textRef = React.useRef(""),
    lastTodayRequest = React.useRef<ChatRequest | null>(null),
    lastPerformanceNow = React.useRef<number | null>(null),
    visibilitySuspended = React.useRef(false),
    reportsLoadGeneration = React.useRef(0);
  const canChat = role === "parent" || role === "teen";
  const monotonicNow = () => {
    const now = performance.now();
    if (!Number.isFinite(now)) return null;
    if (lastPerformanceNow.current !== null && now < lastPerformanceNow.current)
      return null;
    lastPerformanceNow.current = now;
    return now;
  };
  const voice = useVoiceDraft(
    panelOpen && tab === "chat" && !busy,
    (t) => setText(t),
    (code) => setError({ kind: "voice", key: code }),
  );
  React.useEffect(() => {
    textRef.current = text;
  }, [text]);
  React.useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  React.useEffect(() => {
    if (!todayFreshness) {
      setTodayExpired(false);
      return;
    }
    visibilitySuspended.current = false;
    const update = () => {
      const now = monotonicNow();
      setTodayExpired(
        visibilitySuspended.current ||
          document.visibilityState !== "visible" ||
          now === null ||
          now < todayFreshness.leaseStartedAt ||
          now >= todayFreshness.leaseExpiresAt,
      );
      return now;
    };
    const now = update();
    const timer =
      now === null
        ? undefined
        : window.setTimeout(
            update,
            Math.max(0, todayFreshness.leaseExpiresAt - now),
          );
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        visibilitySuspended.current = true;
        setTodayExpired(true);
        return;
      }
      // A hidden/resumed tab must request a new projection. Do not revive the
      // old lease even when its monotonic deadline has not elapsed.
      if (visibilitySuspended.current) {
        setTodayExpired(true);
        return;
      }
      update();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [todayFreshness]);
  React.useEffect(() => {
    if (panelOpen && tab === "reports") void loadReports();
    return () => {
      reportsLoadGeneration.current += 1;
    };
  }, [panelOpen, tab]);
  React.useEffect(() => {
    if (!panelOpen) return;
    const background = document.querySelector("[data-dashboard-background]");
    const wasInert = background?.hasAttribute("inert") ?? false;
    const overflow = document.body.style.overflow;
    background?.setAttribute("inert", "");
    document.body.style.overflow = "hidden";
    return () => {
      if (!wasInert) background?.removeAttribute("inert");
      document.body.style.overflow = overflow;
    };
  }, [panelOpen]);
  const open = (next: AssistantPanelTab) => {
    if (busy) return;
    voice.stop();
    if (tab === "reports" && next !== "reports")
      reportsLoadGeneration.current += 1;
    // Tab errors belong to the tab being left. An uncertain action has its own
    // durable recovery state and is rendered again when Chat is reopened.
    setError(null);
    setDeleteConfirm(false);
    onTabChange(next);
  };
  async function loadReports() {
    const generation = ++reportsLoadGeneration.current;
    setReportsLoading(true);
    setReportsLoadFailed(false);
    try {
      const result = await requestOwnedJson("/api/feedback", { method: "GET", headers: { [FEEDBACK_VIEW_HEADER]: FEEDBACK_SUMMARY_VIEW } }, 512 * 1024);
      if (result.kind === "unknown" || !result.response.ok) throw new Error("Reports unavailable");
      const rows = reportRows(result.body);
      if (!rows) throw new Error("Invalid reports");
      if (generation !== reportsLoadGeneration.current) return;
      setReports(rows);
    } catch {
      if (generation !== reportsLoadGeneration.current) return;
      setReportsLoadFailed(true);
    } finally {
      if (generation === reportsLoadGeneration.current)
        setReportsLoading(false);
    }
  }
  const close = () => {
    if (busy) return;
    voice.stop();
    if (tab === "reports") reportsLoadGeneration.current += 1;
    onClose();
  };
  async function requestChat(
    request: ChatRequest,
    preserveDraft = false,
    reviewedAction?: AssistantAction,
  ) {
    if (lock.current || !canChat) return;
    lock.current = true;
    setBusy(true);
    if (!preserveDraft) {
      setError(null);
      setFailedChat(null);
    }
    setActionRecovery(null);
    // A source refresh holds the edited proposal until a matching fresh
    // action kind is available. Failed refreshes must not erase user edits.
    if (!reviewedAction) setAction(null);
    else {
      consumed.current = true;
      setTodayExpired(true);
    }
    setSourceProof(undefined);
    setTargets([]);
    setDeleteConfirm(false);
    setChoiceLoadFailed(false);
    voice.stop();
    const { messages: next, includeToday, localNow, timeZone } = request;
    const leaseStartedAt = includeToday ? monotonicNow() : null;
    let messageFinished = false;
    try {
      if (includeToday && leaseStartedAt === null)
        throw new AssistantCopyError("todayContextUnavailable");
      const requestBody = {
        // Server-resolved citations are presentation only, never replayed as
        // provider instructions or caller-selected record authority.
        messages: next.map(({ role, content }) => ({ role, content })),
        localNow,
        timeZone,
        ...(includeToday ? { includeToday: true } : {}),
      };
      const result = await readAssistantChat({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(includeToday
              ? { "X-Assistant-References": ASSISTANT_REFERENCES_PROTOCOL }
              : {}),
            ...(includeToday && confirmationEnabled
              ? { "X-Assistant-Confirmation": ASSISTANT_CONFIRMATION_PROTOCOL }
              : {}),
          },
          body: JSON.stringify(requestBody),
      });
      if (result.kind === "unknown") throw new AssistantCopyError("chatUnavailable");
      if (result.kind === "network") throw new AssistantCopyError("chatOffline");
      if (result.kind === "unreadable") throw new AssistantCopyError(
        result.response.ok || result.response.status < 500 ? "replyUnreadable" : "chatUnavailable",
      );
      const { response: r, body } = result;
      if (!r.ok) {
        if (r.status === 429) throw new AssistantCopyError("chatRateLimited");
        if (r.status === 413) throw new AssistantCopyError("chatTooLong");
        const errorBody = isChatErrorBody(body) ? body : null;
        if (
          errorBody?.code === "ASSISTANT_TODAY_UNAVAILABLE" ||
          errorBody?.code === "ASSISTANT_TODAY_INPUT_INVALID"
        ) {
          throw new AssistantCopyError("todayContextUnavailable");
        }
        const serverError =
          typeof errorBody?.error === "string" ? errorBody.error : "";
        if (
          errorBody?.code === "ASSISTANT_PROVIDER_NOT_CONFIGURED" ||
          serverError.toLowerCase().includes("not connected") ||
          serverError.toLowerCase().includes("ask a parent")
        ) {
          throw new AssistantCopyError("aiSetupRequired");
        }
        throw new AssistantCopyError(
          r.status >= 500 ? "chatUnavailable" : "chatFailed",
        );
      }
      const parsedReply = assistantResponseSchema.safeParse(body);
      if (!parsedReply.success) throw new AssistantCopyError("replyUnreadable");
      const responseAt = includeToday ? monotonicNow() : null;
      const freshness = includeToday
        ? readTodayFreshness(
            r.headers,
            leaseStartedAt,
            responseAt,
            document.visibilityState === "visible",
          )
        : null;
      if (includeToday && !freshness)
        throw new AssistantCopyError("todayContextUnavailable");
      const proposal = parsedReply.data;
      if (
        includeToday &&
        confirmationEnabled &&
        proposal.action &&
        proposal.action.kind !== "open" &&
        !proposal.sourceProof
      )
        throw new AssistantCopyError("todayContextUnavailable");
      if (
        reviewedAction &&
        (!proposal.action ||
          proposal.action.kind !== reviewedAction.kind ||
          !canUseAssistantAction(reviewedAction, role, features))
      )
        throw new AssistantCopyError("todayContextUnavailable");
      setSourceProof(proposal.sourceProof);
      messageFinished = true;
      setError(null);
      setFailedChat(null);
      if (!preserveDraft) setText("");
      setMessages(
        [
          ...next,
          {
            role: "assistant" as const,
            content: proposal.reply,
            ...(proposal.evidence ? { evidence: proposal.evidence } : {}),
          },
        ].slice(-12),
      );
      if (freshness) {
        setTodayFreshness(freshness);
        lastTodayRequest.current = request;
      } else {
        setTodayFreshness(null);
        lastTodayRequest.current = null;
      }
      if (
        proposal.action &&
        canUseAssistantAction(proposal.action, role, features)
      ) {
        // The proof binds the renewed source basis and action kind; it does
        // not approve a model body. Preserve deliberate human edits and still
        // require a new explicit confirmation with a new key.
        setAction(reviewedAction ?? proposal.action);
        consumed.current = false;
        actionKey.current = crypto.randomUUID();
        try {
          const choices =
            proposal.action.kind === "chore_create"
              ? await choreAssignees(profileAssignmentEnabled)
              : proposal.action.kind.endsWith("_delete")
                ? await removalTargets(proposal.action)
                : null;
          if (choices) setTargets(choices);
          setSelected("");
        } catch (e) {
          if (e instanceof ActionOutcomeUnknown) {
            // The provider reply and editable proposal are still valid. Keep
            // them in place and make recovery a GET-only choice reload.
            setChoiceLoadFailed(true);
            setTargets([]);
            setSelected("");
            // Do not overwrite a newer draft if one was entered while the
            // provider response was settling; restore only the submitted draft.
            if (textRef.current === "" || textRef.current === request.inputText)
              setText(request.inputText);
            setError(toAssistantError(e, "actionFailed"));
          } else if (e instanceof AssistantActionError) {
            // A deterministic refusal (for example, indistinguishable list
            // targets) cannot be fixed by retrying the same GET. Keep the
            // submitted draft visible and offer the canonical read-only
            // section check, matching the explicit retry path below.
            // Do not overwrite a newer draft entered while the proposal was
            // settling; restore only the submitted draft.
            if (textRef.current === "" || textRef.current === request.inputText)
              setText(request.inputText);
            const recoveryError = toAssistantError(e, "actionFailed");
            setChoiceLoadFailed(false);
            setError(recoveryError);
            setActionRecovery({
              error: recoveryError,
              href: actionRecoveryPath(proposal.action),
            });
            setAction(null);
          } else {
            throw e;
          }
        }
      }
    } catch (e) {
      if (!preserveDraft || textRef.current === request.inputText)
        setText(request.inputText);
      if (!messageFinished) setFailedChat(request);
      if (messageFinished && e instanceof AssistantActionError) {
        setError(toAssistantError(e, "actionFailed"));
      } else {
        setError(toChatError(e, "chatFailed"));
      }
      setAction(reviewedAction ?? null);
      if (reviewedAction) {
        setSourceProof(undefined);
        setTodayExpired(true);
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function retryChoiceLoad() {
    const pendingAction = action;
    if (!pendingAction || !choiceLoadFailed || lock.current) return;
    if (!canUseAssistantAction(pendingAction, role, features)) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setActionRecovery(null);
    try {
      const choices =
        pendingAction.kind === "chore_create"
          ? await choreAssignees(profileAssignmentEnabled)
          : pendingAction.kind.endsWith("_delete")
            ? await removalTargets(pendingAction)
            : null;
      if (choices) setTargets(choices);
      setSelected("");
      setDeleteConfirm(false);
      setChoiceLoadFailed(false);
    } catch (e) {
      if (e instanceof ActionOutcomeUnknown) {
        setError(toAssistantError(e, "actionFailed"));
      } else {
        // A deterministic refusal such as indistinguishable list targets must
        // still close the proposal and offer its ordinary read-only check.
        setChoiceLoadFailed(false);
        const recoveryError = toAssistantError(e, "actionFailed");
        setError(recoveryError);
        setActionRecovery({
          error: recoveryError,
          href: actionRecoveryPath(pendingAction),
        });
        setAction(null);
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function send(event: React.FormEvent) {
    event.preventDefault();
    const draft = text.trim();
    if (lock.current || !draft || !canChat) return;
    const next: Message[] = [
      ...messages,
      { role: "user" as const, content: draft },
    ].slice(-11);
    await requestChat({
      messages: next,
      inputText: text,
      localNow: new Date().toString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      includeToday: todayContextEnabled && includeToday,
    });
  }
  async function retryFailedChat() {
    const request = failedChat;
    if (!request || lock.current) return;
    await requestChat(
      request,
      true,
      todayExpired ? (action ?? undefined) : undefined,
    );
  }
  async function refreshTodayContext() {
    const request = lastTodayRequest.current;
    if (!request || lock.current) return;
    // The user may have typed a newer unsent question while the old preview
    // was open. Refresh the saved request, but keep that newer draft visible.
    await requestChat(
      {
        ...request,
        inputText: text,
        localNow: new Date().toString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      true,
      action ?? undefined,
    );
  }
  function hasValidTodayLease(): boolean {
    if (!todayFreshness) return true;
    const now = monotonicNow();
    const valid =
      !todayExpired &&
      !visibilitySuspended.current &&
      document.visibilityState === "visible" &&
      now !== null &&
      now >= todayFreshness.leaseStartedAt &&
      now < todayFreshness.leaseExpiresAt;
    if (!valid) setTodayExpired(true);
    return valid;
  }
  async function selectRemovalTarget(id: string) {
    if (lock.current || !action || !action.kind.endsWith("_delete")) return;
    setDeleteConfirm(false);
    setSelected(id);
    if (!id || !sourceProof) return;
    const reviewedAction = action;
    const reviewedProof = sourceProof;
    lock.current = true;
    setBusy(true);
    setError(null);
    setTargets((rows) =>
      rows.map((row) =>
        row.id === id
          ? { ...row, proof: undefined, itemCount: undefined }
          : row,
      ),
    );
    try {
      const target = await previewRemovalTarget(
        reviewedAction,
        id,
        reviewedProof,
      );
      setTargets((rows) => rows.map((row) => (row.id === id ? target : row)));
    } catch (error) {
      setSelected("");
      setError(toAssistantError(error, "loadChoicesFailed"));
      if (error instanceof AssistantSourceRefusal) setTodayExpired(true);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function confirm() {
    if (
      !action ||
      lock.current ||
      consumed.current ||
      !canUseAssistantAction(action, role, features)
    )
      return;
    if (!hasValidTodayLease()) return;
    if (action.kind === "open") {
      if (await router.push(assistantDestination(action.destination))) close();
      return;
    }
    const removing = action.kind.endsWith("_delete"),
      chosen = targets.find((t) => t.id === selected);
    if (
      removing &&
      (!chosen || !deleteConfirm || (sourceProof && !chosen.proof))
    )
      return;
    if (
      action.kind === "chore_create" &&
      (!chosen ||
        (chosen.subject?.kind === "profile" &&
          action.frequency !== "once" &&
          !chosen.subject.recurrenceSupported))
    )
      return;
    lock.current = true;
    consumed.current = true;
    setBusy(true);
    setError(null);
    setActionRecovery(null);
    setChoiceLoadFailed(false);
    try {
      await executeAssistantAction(
        action,
        actionKey.current,
        chosen,
        sourceProof,
      );
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: removing
            ? msg("removed", { title: chosen!.title })
            : msg("saved", {
                title: "title" in action ? action.title : "your change",
              }),
        },
      ]);
      setAction(null);
      setDeleteConfirm(false);
      router.refresh();
    } catch (e) {
      if (e instanceof AssistantSourceRefusal) {
        setError(toAssistantError(e, "actionFailed"));
        setTodayExpired(true);
        // Proven refusal has no new effect. A fresh reviewed proposal gets a
        // new key/proof; never retry an expired or unavailable basis blindly.
        return;
      }
      if (e instanceof AssistantActionPreflightError) {
        // Local validation or a canonical pre-effect refusal proves no new
        // effect. Keep edits; changed assignees require a read-only reload.
        consumed.current = false;
        if (e.code === "assigneeChanged") {
          setChoiceLoadFailed(true);
          setSelected("");
        }
        setError(toAssistantError(e, "actionFailed"));
        return;
      }
      const recoveryError = toAssistantError(e, "actionFailed");
      setError(recoveryError);
      // The action may have committed before its response was lost. Always
      // offer a read-only destination for checking the affected section, but
      // never reset consumed or offer a mutation retry from this state.
      setActionRecovery({
        error: recoveryError,
        href: actionRecoveryPath(action),
      });
      setAction(null);
      setChoiceLoadFailed(false);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function saveReport(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    // Retrying a lost response must use the exact original body, including
    // pathname, even if navigation changed while this draft remained mounted.
    reportRequest.current ??= {
      requestId: crypto.randomUUID(),
      kind,
      title,
      details,
      page: pathname,
    };
    const pendingReport = reportRequest.current;
    try {
      const result = await requestOwnedJson("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", [FEEDBACK_VIEW_HEADER]: FEEDBACK_SUMMARY_VIEW },
        body: JSON.stringify(pendingReport),
      }, 64 * 1024);
      if (result.kind === "unknown") throw new AssistantCopyError("reportSaveFailed");
      const { response: r, body } = result;
      const b = body && typeof body === "object" ? body as { error?: unknown; report?: { id?: unknown } } : null;
      if (!r.ok) {
        if (typeof b?.error === "string" && b.error) throw new Error(b.error);
        throw new AssistantCopyError("reportSaveFailed");
      }
      if (typeof b?.report?.id !== "string" || !b.report.id.trim())
        throw new AssistantCopyError("reportSaveFailed");
      setReceipt(b.report.id);
      setTitle("");
      setDetails("");
      reportRequest.current = null;
    } catch (e) {
      setError(toAssistantError(e, "reportSaveFailed"));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const displayedError =
    tab === "chat" && actionRecovery ? actionRecovery.error : error;
  return (
    <div data-person-assistant-panel>
      <Dialog
        open={panelOpen}
        onClose={busy ? undefined : close}
        closeLabel={msg("close")}
        title={
          tab === "chat"
            ? msg("titleChat")
            : tab === "report"
              ? msg("titleReport")
              : msg("titleReports")
        }
        variant="form"
        className="sm:!max-w-2xl"
      >
        <div className="flex flex-wrap gap-2 mb-4">
          {canChat && (
            <button
              disabled={busy}
              type="button"
              className={`${target} bg-surface-fill`}
              onClick={() => open("chat")}
              aria-pressed={tab === "chat"}
            >
              {msg("tabAssistant")}
            </button>
          )}
          <button
            disabled={busy}
            type="button"
            className={`${target} bg-surface-fill`}
            onClick={() => open("report")}
            aria-pressed={tab === "report"}
          >
            {msg("tabReport")}
          </button>
          <button
            disabled={busy}
            type="button"
            className={`${target} bg-surface-fill`}
            onClick={() => open("reports")}
            aria-pressed={tab === "reports"}
          >
            {msg("tabReports")}
          </button>
        </div>
        {tab === "reports" && reportsLoadFailed && (
          <p
            role="alert"
            className="mb-3 rounded-xl bg-surface-fill p-3 text-[var(--danger-text)] break-words"
          >
            {msg("reportsLoadFailed")}
          </p>
        )}
        {displayedError && (
          <div className="mb-3 space-y-2">
            <p
              role="alert"
              className="rounded-xl bg-surface-fill p-3 text-[var(--danger-text)] break-words"
            >
              {displayedError.kind === "chat" || displayedError.kind === "copy"
                ? msg(displayedError.key)
                : displayedError.kind === "action"
                  ? msg(displayedError.key)
                  : displayedError.kind === "voice"
                    ? msg(displayedError.key)
                    : displayedError.message}
            </p>
            {displayedError.kind === "chat" &&
              failedChat &&
              !["chatRateLimited", "chatTooLong"].includes(
                displayedError.key,
              ) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void retryFailedChat()}
                  className={`${target} bg-surface-fill`}
                >
                  {msg("retryChat")}
                </button>
              )}
            {tab === "chat" && actionRecovery && (
              <Link
                href={actionRecovery.href}
                onClick={() => {
                  setError(null);
                  setActionRecovery(null);
                  close();
                }}
                className={`${target} inline-flex items-center bg-surface-fill`}
              >
                {msg(actionRecoveryMessage(actionRecovery.href))}
              </Link>
            )}
            {choiceLoadFailed && action && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void retryChoiceLoad()}
                className={`${target} bg-surface-fill`}
              >
                {msg("retryChoices")}
              </button>
            )}
          </div>
        )}
        {tab === "chat" && (
          <div className="space-y-4">
            {canChat ? (
              <AssistantQuickStart
                role={role}
                features={features}
                disabled={busy}
                canNavigate={() => !lock.current}
                onNavigated={close}
                todayActions={features.meals ? (
                  <MealPlanningReviewLinks
                    disabled={busy}
                    canNavigate={() => !lock.current}
                    onNavigated={close}
                  />
                ) : undefined}
              />
            ) : (
              <AppGuide role={role} disabled={busy} canNavigate={() => !lock.current} onNavigated={close} />
            )}
            <p className="text-sm text-label-secondary">
              {msg(includeToday ? "chatIntroWithToday" : "chatIntro")}
            </p>
            {todayContextEnabled && canChat && (
              <label className="flex min-h-[44px] items-start gap-3 rounded-xl bg-surface-fill p-3">
                <input
                  type="checkbox"
                  checked={includeToday}
                  disabled={busy}
                  onChange={(event) => setIncludeToday(event.target.checked)}
                  className="mt-1 min-h-[20px] min-w-[20px]"
                />
                <span>
                  <span className="block font-semibold">
                    {msg("includeToday")}
                  </span>
                  <span className="block text-sm text-label-secondary">
                    {msg("includeTodayDescription")}
                  </span>
                </span>
              </label>
            )}
            {todayFreshness && !todayExpired && (
              <p role="status" className="text-sm text-label-secondary">
                {msg("todayContextIncluded", {
                  time: new Date(
                    todayFreshness.generatedAt,
                  ).toLocaleTimeString(),
                })}
              </p>
            )}
            {todayExpired && (
              <div className="rounded-xl bg-surface-fill p-3 space-y-2">
                <p role="status" className="text-sm text-label-secondary">
                  {msg("todayContextExpired")}
                </p>
                <button
                  type="button"
                  disabled={busy || !lastTodayRequest.current}
                  onClick={() => void refreshTodayContext()}
                  className={`${target} bg-surface-fill`}
                >
                  {msg("refreshTodayContext")}
                </button>
              </div>
            )}
            <div
              role="log"
              aria-label={msg("conversation")}
              aria-live="polite"
              className="space-y-3 max-h-64 overflow-y-auto"
            >
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`rounded-2xl p-3 whitespace-pre-wrap break-words ${m.role === "user" ? "bg-accent-tint" : "bg-surface-fill"}`}
                >
                  <p>
                    <span className="font-semibold">
                      {m.role === "user" ? msg("you") : msg("assistant")}:{" "}
                    </span>
                    {m.content}
                  </p>
                  {Boolean(m.evidence?.length) &&
                    (i === messages.length - 1 &&
                    todayFreshness &&
                    !todayExpired ? (
                      <div className="mt-2 border-t border-[var(--surface-separator)] pt-2 text-footnote">
                        <p>{msg("sourceEvidence")}</p>
                        <ul
                          className="space-y-1"
                          aria-label={msg("sourceEvidence")}
                        >
                          {m.evidence!.map((source) => (
                            <li key={source.ref}>
                              <Link
                                href={source.href}
                                className="inline-flex min-h-11 items-center underline [overflow-wrap:anywhere]"
                                onClick={(event) => {
                                  event.preventDefault();
                                  if (busy || todayExpired) return;
                                  void (async () => {
                                    if (await router.push(source.href)) close();
                                  })();
                                }}
                              >
                                {source.label}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="mt-2 text-footnote text-label-secondary">
                        {msg("sourceEvidenceExpired")}
                      </p>
                    ))}
                </div>
              ))}
            </div>
            {action && (
              <section
                aria-label={msg("reviewProposed")}
                className="rounded-2xl border border-[var(--surface-separator)] bg-surface-fill p-4 space-y-3"
              >
                <h3 className="font-semibold">
                  {msg("reviewBefore", {
                    verb: action.kind.endsWith("_delete")
                      ? msg("removing")
                      : msg("continuing"),
                  })}
                </h3>
                {"title" in action && !action.kind.endsWith("_delete") && (
                  <label className="block">
                    {msg("titleItem")}
                    <input
                      disabled={busy}
                      aria-label={msg("proposedTitle")}
                      value={action.title}
                      maxLength={200}
                      onChange={(e) =>
                        setAction({ ...action, title: e.target.value })
                      }
                      className="input-apple mt-1 w-full"
                    />
                  </label>
                )}
                {action.kind === "chore_create" && (
                  <fieldset disabled={busy} className="space-y-3">
                    <label className="block">
                      {msg("whoDoesIt")}
                      <select
                        aria-label={msg("choreAssignee")}
                        value={selected}
                        onChange={(e) => setSelected(e.target.value)}
                        className="input-apple w-full min-h-[44px]"
                      >
                        <option value="">{msg("chooseMember")}</option>
                        {targets.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.title}
                            {t.subject?.kind === "profile"
                              ? ` · ${msg("emailFreeProfile")}`
                              : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    {chosenSubject?.kind === "profile" && (
                      <p role="status" className="text-sm text-label-secondary">
                        {msg("profileAssignmentDescription")}
                      </p>
                    )}
                    <label className="block">
                      {msg("repeats")}
                      <select
                        aria-label={msg("choreFrequency")}
                        value={action.frequency}
                        onChange={(e) =>
                          setAction({
                            ...action,
                            frequency: e.target
                              .value as typeof action.frequency,
                          })
                        }
                        className="input-apple min-h-[44px] w-full"
                      >
                        <option value="once">{msg("once")}</option>
                        <option
                          value="daily"
                          disabled={profileRecurrencePaused}
                        >
                          {msg("daily")}
                        </option>
                        <option
                          value="weekly"
                          disabled={profileRecurrencePaused}
                        >
                          {msg("weekly")}
                        </option>
                        <option
                          value="monthly"
                          disabled={profileRecurrencePaused}
                        >
                          {msg("monthly")}
                        </option>
                      </select>
                    </label>
                    {profileRecurrencePaused && action.frequency !== "once" && (
                      <p role="status" className="text-sm text-label-secondary">
                        {msg("profileRecurrenceUnavailable")}
                      </p>
                    )}
                    {action.frequency === "weekly" ? (
                      <WeeklyDaysPicker
                        days={action.weekdays}
                        copy={{
                          legend: msg("repeatOn"),
                          hint: msg("weeklyHint"),
                          weekdays: {
                            0: msg("sunday"),
                            1: msg("monday"),
                            2: msg("tuesday"),
                            3: msg("wednesday"),
                            4: msg("thursday"),
                            5: msg("friday"),
                            6: msg("saturday"),
                          },
                        }}
                        onChange={(weekdays) =>
                          setAction({ ...action, weekdays })
                        }
                      />
                    ) : (
                      <label className="block">
                        {msg("date")}
                        <input
                          type="date"
                          aria-label={msg("choreDate")}
                          value={action.date ?? ""}
                          onChange={(e) =>
                            setAction({ ...action, date: e.target.value })
                          }
                          className="input-apple w-full"
                        />
                      </label>
                    )}
                    <p className="text-sm text-label-secondary">
                      {msg("pointsDetails", {
                        points: action.points,
                        difficulty: action.difficulty,
                        guidance: msg("choreGuidance"),
                      })}
                    </p>
                  </fieldset>
                )}
                {action.kind === "list_create" && (
                  <p>{msg("listType", { type: action.type })}</p>
                )}
                {action.kind === "note_create" && (
                  <label className="block">
                    {msg("note")}
                    <textarea
                      disabled={busy}
                      aria-label={msg("proposedNote")}
                      value={action.body}
                      onChange={(e) =>
                        setAction({ ...action, body: e.target.value })
                      }
                      className="input-apple mt-1 w-full"
                    />
                  </label>
                )}
                {action.kind === "event_create" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label>
                      {msg("start")}
                      <input
                        disabled={busy}
                        type="datetime-local"
                        aria-label={msg("proposedStart")}
                        value={action.start}
                        onChange={(e) =>
                          setAction({ ...action, start: e.target.value })
                        }
                        className="input-apple w-full"
                      />
                    </label>
                    <label>
                      {msg("end")}
                      <input
                        disabled={busy}
                        type="datetime-local"
                        aria-label={msg("proposedEnd")}
                        value={action.end}
                        onChange={(e) =>
                          setAction({ ...action, end: e.target.value })
                        }
                        className="input-apple w-full"
                      />
                    </label>
                    <p className="text-sm text-label-secondary sm:col-span-2">
                      {msg("eventTimeZoneLocation", {
                        location: action.location || msg("none"),
                      })}
                    </p>
                  </div>
                )}
                {action.kind === "grocery_add" && (
                  <p className="text-sm">{msg("groceryInfo")}</p>
                )}
                {action.kind.endsWith("_delete") && (
                  <>
                    <label className="block">
                      {msg("chooseExactItem")}
                      <select
                        disabled={busy}
                        aria-label={msg("itemToRemove")}
                        value={selected}
                        onChange={(e) =>
                          void selectRemovalTarget(e.target.value)
                        }
                        className="input-apple min-h-[44px] w-full"
                      >
                        <option value="">{msg("chooseItem")}</option>
                        {targets.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.title}
                            {t.detail
                              ? ` · ${new Date(t.detail).toLocaleString()}`
                              : ""}
                            {t.context ? ` · ${t.context}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="text-sm text-label-secondary">
                      {msg("deletionInfo")}
                    </p>
                    {sourceProof &&
                      selected &&
                      targets.find((t) => t.id === selected)?.proof && (
                        <div
                          role="status"
                          className="rounded-xl bg-surface-fill p-3 text-sm [overflow-wrap:anywhere]"
                        >
                          <p className="font-semibold">
                            {targets.find((t) => t.id === selected)?.title}
                          </p>
                          <p>
                            {targets.find((t) => t.id === selected)?.context}
                          </p>
                          {targets.find((t) => t.id === selected)?.itemCount !==
                            undefined && (
                            <p>
                              {msg("deleteListItemCount", {
                                count: targets.find((t) => t.id === selected)!
                                  .itemCount!,
                              })}
                            </p>
                          )}
                          <p>{msg("deleteTargetReviewed")}</p>
                        </div>
                      )}
                    {selected &&
                      (!sourceProof ||
                        targets.find((t) => t.id === selected)?.proof) && (
                        <label className="flex min-h-[44px] items-center gap-3">
                          <input
                            type="checkbox"
                            disabled={busy}
                            checked={deleteConfirm}
                            onChange={(e) => setDeleteConfirm(e.target.checked)}
                          />
                          {msg("confirmRemoving", {
                            title:
                              targets.find((t) => t.id === selected)?.title ??
                              "",
                          })}
                        </label>
                      )}
                  </>
                )}
                {action.kind === "open" && (
                  <p>
                    {msg("open", {
                      destination:
                        assistantDestinationLabels[locale][action.destination],
                    })}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={
                      busy ||
                      todayExpired ||
                      (action.kind === "chore_create" &&
                        (!selected ||
                          (profileRecurrencePaused &&
                            action.frequency !== "once") ||
                          (action.frequency === "weekly"
                            ? !action.weekdays.length
                            : !action.date))) ||
                      (action.kind.endsWith("_delete") &&
                        (!selected ||
                          !deleteConfirm ||
                          (Boolean(sourceProof) &&
                            !targets.find((t) => t.id === selected)?.proof)))
                    }
                    onClick={() => void confirm()}
                    className={`${target} bg-[var(--accent-fill)] text-white`}
                  >
                    {action.kind.endsWith("_delete")
                      ? msg("removeSelected")
                      : action.kind === "open"
                        ? msg("openSection")
                        : msg("confirmSave")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setAction(null);
                      setChoiceLoadFailed(false);
                      setDeleteConfirm(false);
                    }}
                    className={`${target} bg-surface-fill`}
                  >
                    {msg("cancelProposal")}
                  </button>
                </div>
              </section>
            )}
            <form onSubmit={send} className="space-y-2">
              <label htmlFor="assistant-message" className="font-semibold">
                {msg("yourMessage")}
              </label>
              <textarea
                id="assistant-message"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={2000}
                disabled={busy}
                className="input-apple w-full min-h-24"
                placeholder={msg("messagePlaceholder")}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={busy || !text.trim()}
                  className={`${target} bg-[var(--accent-fill)] text-white`}
                  type="submit"
                >
                  {busy ? msg("working") : msg("send")}
                </button>
                <button
                  disabled={busy || !voice.supported}
                  type="button"
                  onClick={() => {
                    if (voice.listening) {
                      voice.stop();
                      return;
                    }
                    window.dispatchEvent(
                      new Event("herewoven:voice-input-start"),
                    );
                    voice.start();
                  }}
                  aria-pressed={voice.listening}
                  className={`${target} bg-surface-fill inline-flex items-center gap-2`}
                >
                  {voice.listening ? <MicOff size={18} /> : <Mic size={18} />}{" "}
                  {voice.listening ? msg("stopVoice") : msg("voiceInput")}
                </button>
                <button
                  disabled={busy}
                  type="button"
                  onClick={() => {
                    voice.stop();
                    setMessages([]);
                    setAction(null);
                    setChoiceLoadFailed(false);
                    setText("");
                    setError(null);
                    setFailedChat(null);
                    setActionRecovery(null);
                    setTodayFreshness(null);
                    lastTodayRequest.current = null;
                  }}
                  className={`${target} bg-surface-fill`}
                >
                  {msg("clearChat")}
                </button>
              </div>
              <LocalVoiceDraft
                enabled={panelOpen && tab === "chat" && canChat && !busy}
                contextKey={`${role}:${pathname}`}
                value={text}
                onDraft={setText}
                beforeListen={voice.stop}
              />
              <p className="text-xs text-label-secondary">
                {voice.supported
                  ? msg("voiceGuidance")
                  : msg("voiceUnavailable")}{" "}
                {msg("sessionOnly")}
              </p>
            </form>
            {role === "parent" && (
              <Link
                href="/dashboard/settings?setup=ai#ai-capture"
                onClick={close}
                className="inline-flex min-h-[44px] items-center text-accent"
              >
                {msg("aiSetup")}
              </Link>
            )}
          </div>
        )}
        {tab === "report" && (
          <form onSubmit={saveReport} className="space-y-4">
            <p className="text-sm text-label-secondary">{msg("reportIntro")}</p>
            {receipt && (
              <p
                role="status"
                className="rounded-xl bg-accent-tint p-3 break-words"
              >
                {msg("reportSaved", { receipt })}
              </p>
            )}
            <label className="block">
              {msg("type")}
              <select
                disabled={busy}
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  reportRequest.current = null;
                }}
                className="input-apple min-h-[44px] w-full"
              >
                <option value="bug">{msg("bug")}</option>
                <option value="feature">{msg("feature")}</option>
              </select>
            </label>
            <label className="block">
              {msg("title")}
              <input
                disabled={busy}
                required
                minLength={3}
                maxLength={200}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  reportRequest.current = null;
                }}
                className="input-apple w-full"
              />
            </label>
            <div>
              <label htmlFor="feedback-details" className="block">
                {msg("details")}
              </label>
              <textarea
                id="feedback-details"
                disabled={busy}
                required
                minLength={10}
                maxLength={4000}
                value={details}
                onChange={(e) => {
                  setDetails(e.target.value);
                  reportRequest.current = null;
                }}
                className="input-apple min-h-28 w-full"
              />
            </div>
            <p className="text-xs text-label-secondary">
              {msg("reportPage", {
                pathname: reportRequest.current?.page ?? pathname,
              })}
            </p>
            <button
              disabled={busy}
              type="submit"
              className={`${target} bg-[var(--accent-fill)] text-white`}
            >
              {busy ? msg("saving") : msg("saveReport")}
            </button>
          </form>
        )}
        {tab === "reports" && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => void loadReports()}
              className={`${target} bg-surface-fill`}
            >
              {msg("refreshReports")}
            </button>
            {reportsLoading ? (
              <p role="status">{msg("loadingReports")}</p>
            ) : reportsLoadFailed ? null : reports.length === 0 ? (
              <p className="text-label-secondary">{msg("noSavedReports")}</p>
            ) : (
              reports.map((r) => (
                <article key={r.id} className="rounded-xl bg-surface-fill p-3">
                  <h3 className="font-semibold break-words">{r.title}</h3>
                  <p className="text-sm text-label-secondary">
                    {r.kind} · {r.status} ·{" "}
                    {new Date(r.created_at).toLocaleDateString()}
                  </p>
                  <p className="text-xs break-words">
                    {msg("receipt", { id: r.id })}
                  </p>
                </article>
              ))
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
