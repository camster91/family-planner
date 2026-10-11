"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mic, MicOff } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { useFeatures } from "@/components/providers/features-provider";
import {
  assistantReplySchema,
  assistantDestination,
  canUseAssistantAction,
  type AssistantAction,
} from "@/lib/assistant-actions";
import {
  executeAssistantAction,
  removalTargets,
  choreAssignees,
  AssistantActionError,
  type AssistantActionErrorCode,
  type RemovalTarget,
} from "./action-client";
import { WeeklyDaysPicker } from "@/components/chores/WeeklyDaysPicker";
import { useTranslation } from "@/i18n";
import {
  assistantMessages,
  type AssistantMessage,
  type VoiceErrorCode,
} from "@/i18n/assistant";
import { useVoiceDraft } from "./use-voice-draft";

type Message = { role: "user" | "assistant"; content: string };
type Report = {
  id: string;
  kind: string;
  title: string;
  status: string;
  created_at: string;
};
const target =
  "min-h-[44px] rounded-full px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)] disabled:opacity-50";
export type AssistantPanelTab = "chat" | "report" | "reports";

export type AssistantPanelProps = {
  role: string;
  pathname: string;
  tab: AssistantPanelTab | null;
  panelOpen: boolean;
  onTabChange: (tab: AssistantPanelTab | null) => void;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
};

type AssistantError =
  | { kind: "copy"; key: AssistantMessage }
  | { kind: "action"; key: AssistantActionErrorCode }
  | { kind: "voice"; key: VoiceErrorCode }
  | { kind: "raw"; message: string };

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

export default function AssistantPanel({
  role,
  pathname,
  tab,
  panelOpen,
  onTabChange,
  onClose,
  onBusyChange,
}: AssistantPanelProps) {
  const router = useRouter(),
    { features } = useFeatures();
  const { t } = useTranslation();
  const msg = (
    key: AssistantMessage,
    params?: Record<string, string | number>,
  ) => t(key, params, assistantMessages);
  const [messages, setMessages] = React.useState<Message[]>([]),
    [text, setText] = React.useState(""),
    [busy, setBusy] = React.useState(false),
    [error, setError] = React.useState<AssistantError | null>(null);
  const [action, setAction] = React.useState<AssistantAction | null>(null),
    [targets, setTargets] = React.useState<RemovalTarget[]>([]),
    [selected, setSelected] = React.useState(""),
    [deleteConfirm, setDeleteConfirm] = React.useState(false);
  const [kind, setKind] = React.useState("bug"),
    [title, setTitle] = React.useState(""),
    [details, setDetails] = React.useState(""),
    [receipt, setReceipt] = React.useState(""),
    [reports, setReports] = React.useState<Report[]>([]),
    [reportsLoading, setReportsLoading] = React.useState(false);
  const requestId = React.useRef(""),
    actionKey = React.useRef(""),
    lock = React.useRef(false),
    consumed = React.useRef(false);
  const canChat = role === "parent" || role === "teen";
  const voice = useVoiceDraft(
    panelOpen && tab === "chat" && !busy,
    (t) => setText(t),
    (code) => setError({ kind: "voice", key: code }),
  );
  React.useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  React.useEffect(() => {
    if (panelOpen && tab === "reports") void loadReports();
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
    setError(null);
    setDeleteConfirm(false);
    onTabChange(next);
  };
  async function loadReports() {
    setReportsLoading(true);
    try {
      const r = await fetch("/api/feedback", { cache: "no-store" }),
        b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setReports(b.reports ?? []);
    } catch {
      setError({ kind: "copy", key: "reportsLoadFailed" });
    } finally {
      setReportsLoading(false);
    }
  }
  const close = () => {
    if (busy) return;
    voice.stop();
    onClose();
  };
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || !text.trim() || !canChat) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setAction(null);
    setTargets([]);
    setDeleteConfirm(false);
    voice.stop();
    const next: Message[] = [
      ...messages,
      { role: "user" as const, content: text.trim() },
    ].slice(-11);
    setMessages(next);
    setText("");
    try {
      const r = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: next,
            localNow: new Date().toString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        }),
        body = await r.json();
      if (!r.ok) {
        if (typeof body.error === "string" && body.error) {
          throw new Error(body.error);
        }
        throw new AssistantCopyError("chatFailed");
      }
      const parsedReply = assistantReplySchema.safeParse(body);
      if (!parsedReply.success) throw new AssistantCopyError("replyUnreadable");
      const proposal = parsedReply.data;
      setMessages((prev) =>
        [
          ...prev,
          { role: "assistant" as const, content: proposal.reply },
        ].slice(-12),
      );
      if (
        proposal.action &&
        canUseAssistantAction(proposal.action, role, features)
      ) {
        setAction(proposal.action);
        consumed.current = false;
        actionKey.current = crypto.randomUUID();
        if (proposal.action.kind === "chore_create") {
          setTargets(await choreAssignees());
          setSelected("");
        }
        if (proposal.action.kind.endsWith("_delete")) {
          setTargets(await removalTargets(proposal.action));
          setSelected("");
        }
      }
    } catch (e) {
      setError(toAssistantError(e, "chatFailed"));
      setAction(null);
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
    if (action.kind === "open") {
      close();
      router.push(assistantDestination(action.destination));
      return;
    }
    const removing = action.kind.endsWith("_delete"),
      chosen = targets.find((t) => t.id === selected);
    if (removing && (!chosen || !deleteConfirm)) return;
    if (action.kind === "chore_create" && !chosen) return;
    lock.current = true;
    consumed.current = true;
    setBusy(true);
    setError(null);
    try {
      await executeAssistantAction(action, actionKey.current, chosen);
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
      setError(toAssistantError(e, "actionFailed"));
      setAction(null);
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
    if (!requestId.current) requestId.current = crypto.randomUUID();
    try {
      const r = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: requestId.current,
            kind,
            title,
            details,
            page: pathname,
          }),
        }),
        b = await r.json();
      if (!r.ok) {
        if (typeof b.error === "string" && b.error) throw new Error(b.error);
        throw new AssistantCopyError("reportSaveFailed");
      }
      setReceipt(b.report.id);
      setTitle("");
      setDetails("");
      requestId.current = "";
    } catch (e) {
      setError(toAssistantError(e, "reportSaveFailed"));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
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
        {error && (
          <p
            role="alert"
            className="mb-3 rounded-xl bg-surface-fill p-3 text-[var(--danger-text)] break-words"
          >
            {error.kind === "copy"
              ? msg(error.key)
              : error.kind === "action"
                ? msg(error.key)
                : error.kind === "voice"
                  ? msg(error.key)
                  : error.message}
          </p>
        )}
        {tab === "chat" && (
          <div className="space-y-4">
            <p className="text-sm text-label-secondary">{msg("chatIntro")}</p>
            <div
              role="log"
              aria-label={msg("conversation")}
              aria-live="polite"
              className="space-y-3 max-h-64 overflow-y-auto"
            >
              {messages.map((m, i) => (
                <p
                  key={i}
                  className={`rounded-2xl p-3 whitespace-pre-wrap break-words ${m.role === "user" ? "bg-accent-tint" : "bg-surface-fill"}`}
                >
                  <span className="font-semibold">
                    {m.role === "user" ? msg("you") : msg("assistant")}:{" "}
                  </span>
                  {m.content}
                </p>
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
                          </option>
                        ))}
                      </select>
                    </label>
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
                        <option value="daily">{msg("daily")}</option>
                        <option value="weekly">{msg("weekly")}</option>
                        <option value="monthly">{msg("monthly")}</option>
                      </select>
                    </label>
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
                        onChange={(e) => {
                          setSelected(e.target.value);
                          setDeleteConfirm(false);
                        }}
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
                    {selected && (
                      <label className="flex min-h-[44px] items-center gap-3">
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={deleteConfirm}
                          onChange={(e) => setDeleteConfirm(e.target.checked)}
                        />
                        {msg("confirmRemoving", {
                          title:
                            targets.find((t) => t.id === selected)?.title ?? "",
                        })}
                      </label>
                    )}
                  </>
                )}
                {action.kind === "open" && (
                  <p>{msg("open", { destination: action.destination })}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={
                      busy ||
                      (action.kind === "chore_create" &&
                        (!selected ||
                          (action.frequency === "weekly"
                            ? !action.weekdays.length
                            : !action.date))) ||
                      (action.kind.endsWith("_delete") &&
                        (!selected || !deleteConfirm))
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
                  onClick={voice.start}
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
                    setText("");
                    setError(null);
                  }}
                  className={`${target} bg-surface-fill`}
                >
                  {msg("clearChat")}
                </button>
              </div>
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
                  requestId.current = "";
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
                  requestId.current = "";
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
                  requestId.current = "";
                }}
                className="input-apple min-h-28 w-full"
              />
            </div>
            <p className="text-xs text-label-secondary">
              {msg("reportPage", { pathname })}
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
            ) : reports.length === 0 ? (
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
