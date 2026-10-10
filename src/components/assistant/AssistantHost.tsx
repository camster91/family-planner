"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { Sparkles, MessageSquareWarning, Mic, MicOff } from "lucide-react";
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
  type RemovalTarget,
} from "./action-client";
import { WeeklyDaysPicker } from "@/components/chores/WeeklyDaysPicker";
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
export default function AssistantHost({ role }: { role: string }) {
  const pathname = usePathname(),
    params = useSearchParams(),
    router = useRouter(),
    { features } = useFeatures();
  const [tab, setTab] = React.useState<"chat" | "report" | "reports" | null>(
    null,
  );
  const [messages, setMessages] = React.useState<Message[]>([]),
    [text, setText] = React.useState(""),
    [busy, setBusy] = React.useState(false),
    [error, setError] = React.useState("");
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
  const canChat = role === "parent" || role === "teen",
    hidden = params.get("mode") === "fridge" || pathname.startsWith("/device");
  const [launcherSuppressed, setLauncherSuppressed] = React.useState(false);

  // The fixed launchers sit above the mobile tab bar, but a browser can still
  // scroll a focused form control underneath them (for example, a Settings
  // input near the bottom of a long section). Temporarily tuck the launchers
  // away while an editable control outside this assistant panel is focused.
  // Keep the nodes mounted so dialog focus restoration and launcher state stay
  // intact when the control blurs.
  React.useEffect(() => {
    const isEditableControl = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target instanceof HTMLInputElement) {
        return ![
          "button",
          "checkbox",
          "file",
          "image",
          "radio",
          "reset",
          "submit",
        ].includes(target.type);
      }
      return (
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.matches(
          "[contenteditable]:not([contenteditable='false']), [role='textbox']",
        )
      );
    };
    const isOutsideAssistant = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return !target.closest(
        "[data-person-assistant], [data-person-assistant-panel]",
      );
    };
    const onFocusIn = (event: FocusEvent) => {
      if (isEditableControl(event.target) && isOutsideAssistant(event.target)) {
        setLauncherSuppressed(true);
      }
    };
    const onFocusOut = () => {
      queueMicrotask(() => {
        const active = document.activeElement;
        if (!isEditableControl(active) || !isOutsideAssistant(active)) {
          setLauncherSuppressed(false);
        }
      });
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);
  const voice = useVoiceDraft(
    tab === "chat" && !hidden && !busy,
    (t) => setText(t),
    setError,
  );
  React.useEffect(() => {
    if (hidden) setTab(null);
  }, [hidden]);
  const panelOpen = tab !== null;
  React.useEffect(() => {
    if (!panelOpen || hidden) return;
    const background = document.querySelector("[data-dashboard-background]");
    const wasInert = background?.hasAttribute("inert") ?? false;
    const overflow = document.body.style.overflow;
    background?.setAttribute("inert", "");
    document.body.style.overflow = "hidden";
    return () => {
      if (!wasInert) background?.removeAttribute("inert");
      document.body.style.overflow = overflow;
    };
  }, [panelOpen, hidden]);
  const open = (next: "chat" | "report" | "reports") => {
    if (busy) return;
    voice.stop();
    setError("");
    setDeleteConfirm(false);
    setTab(next);
    if (next === "reports") void loadReports();
  };
  async function loadReports() {
    setReportsLoading(true);
    try {
      const r = await fetch("/api/feedback", { cache: "no-store" }),
        b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setReports(b.reports ?? []);
    } catch {
      setError("Could not load your reports. Try again.");
    } finally {
      setReportsLoading(false);
    }
  }
  const close = () => {
    if (busy) return;
    voice.stop();
    setTab(null);
  };
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || !text.trim() || !canChat) return;
    lock.current = true;
    setBusy(true);
    setError("");
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
      if (!r.ok) throw new Error(body.error || "Chat failed.");
      const parsedReply = assistantReplySchema.safeParse(body);
      if (!parsedReply.success)
        throw new Error(
          "The AI reply was unreadable. Try rephrasing your message.",
        );
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
      setError(e instanceof Error ? e.message : "Chat failed.");
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
    setError("");
    try {
      await executeAssistantAction(action, actionKey.current, chosen);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: removing
            ? `Removed “${chosen!.title}”.`
            : `Saved “${"title" in action ? action.title : "your change"}”.`,
        },
      ]);
      setAction(null);
      setDeleteConfirm(false);
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Action failed. Check the app before retrying.",
      );
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
    setError("");
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
      if (!r.ok) throw new Error(b.error);
      setReceipt(b.report.id);
      setTitle("");
      setDetails("");
      requestId.current = "";
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save. Retry this draft.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (hidden) return null;
  return (
    <>
      <div
        data-person-assistant
        data-launchers-suppressed={launcherSuppressed ? "true" : undefined}
        aria-hidden={launcherSuppressed ? "true" : undefined}
        className={`fixed bottom-[calc(var(--phone-tab-bar-height,4rem)+1rem)] left-4 z-30 flex max-w-[calc(100vw-2rem)] flex-wrap gap-2 transition-opacity motion-reduce:transition-none md:bottom-5 md:left-6 ${launcherSuppressed ? "invisible pointer-events-none opacity-0" : ""}`}
      >
        <button
          type="button"
          tabIndex={launcherSuppressed ? -1 : undefined}
          onClick={() => open("report")}
          disabled={busy}
          className={`${target} md:min-h-[56px] border border-[var(--surface-separator)] bg-[var(--surface-elevated)] text-label-primary shadow-lg inline-flex items-center gap-2`}
        >
          <MessageSquareWarning size={20} aria-hidden="true" />
          Report / Suggest
        </button>
        {canChat && (
          <button
            type="button"
            tabIndex={launcherSuppressed ? -1 : undefined}
            onClick={() => open("chat")}
            disabled={busy}
            className={`${target} md:min-h-[56px] bg-[var(--accent-fill)] text-white shadow-lg inline-flex items-center gap-2`}
          >
            <Sparkles size={20} aria-hidden="true" />
            AI assistant
          </button>
        )}
      </div>
      <div data-person-assistant-panel>
        <Dialog
          open={tab !== null}
          onClose={busy ? undefined : close}
          title={
            tab === "chat"
              ? "AI assistant"
              : tab === "report"
                ? "Report a bug or suggest a feature"
                : "My reports"
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
                Assistant
              </button>
            )}
            <button
              disabled={busy}
              type="button"
              className={`${target} bg-surface-fill`}
              onClick={() => open("report")}
              aria-pressed={tab === "report"}
            >
              Report / Suggest
            </button>
            <button
              disabled={busy}
              type="button"
              className={`${target} bg-surface-fill`}
              onClick={() => open("reports")}
              aria-pressed={tab === "reports"}
            >
              My reports
            </button>
          </div>
          {error && (
            <p
              role="alert"
              className="mb-3 rounded-xl bg-surface-fill p-3 text-[var(--danger-text)] break-words"
            >
              {error}
            </p>
          )}
          {tab === "chat" && (
            <div className="space-y-4">
              <p className="text-sm text-label-secondary">
                Ask to add an event, chore, list, grocery item or note; remove
                an event, chore or list; or open another section. Changes need
                your review. Chat text goes to your household’s configured AI
                provider. Household records are not attached.
              </p>
              <div
                role="log"
                aria-label="Assistant conversation"
                aria-live="polite"
                className="space-y-3 max-h-64 overflow-y-auto"
              >
                {messages.map((m, i) => (
                  <p
                    key={i}
                    className={`rounded-2xl p-3 whitespace-pre-wrap break-words ${m.role === "user" ? "bg-accent-tint" : "bg-surface-fill"}`}
                  >
                    <span className="font-semibold">
                      {m.role === "user" ? "You" : "Assistant"}:{" "}
                    </span>
                    {m.content}
                  </p>
                ))}
              </div>
              {action && (
                <section
                  aria-label="Review proposed action"
                  className="rounded-2xl border border-[var(--surface-separator)] bg-surface-fill p-4 space-y-3"
                >
                  <h3 className="font-semibold">
                    Review before{" "}
                    {action.kind.endsWith("_delete")
                      ? "removing"
                      : "continuing"}
                  </h3>
                  {"title" in action && !action.kind.endsWith("_delete") && (
                    <label className="block">
                      Title / item
                      <input
                        disabled={busy}
                        aria-label="Proposed title"
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
                        Who does it?
                        <select
                          aria-label="Chore assignee"
                          value={selected}
                          onChange={(e) => setSelected(e.target.value)}
                          className="input-apple w-full min-h-[44px]"
                        >
                          <option value="">Choose a family member…</option>
                          {targets.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        Repeats
                        <select
                          aria-label="Chore frequency"
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
                          <option value="once">Once</option>
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                        </select>
                      </label>
                      {action.frequency === "weekly" ? (
                        <WeeklyDaysPicker
                          days={action.weekdays}
                          onChange={(weekdays) =>
                            setAction({ ...action, weekdays })
                          }
                        />
                      ) : (
                        <label className="block">
                          Date
                          <input
                            type="date"
                            aria-label="Chore date"
                            value={action.date ?? ""}
                            onChange={(e) =>
                              setAction({ ...action, date: e.target.value })
                            }
                            className="input-apple w-full"
                          />
                        </label>
                      )}
                      <p className="text-sm text-label-secondary">
                        {action.points} points · {action.difficulty}. Use Chores
                        for pictures, rotations and routine stacks.
                      </p>
                    </fieldset>
                  )}
                  {action.kind === "list_create" && (
                    <p>List type: {action.type}</p>
                  )}
                  {action.kind === "note_create" && (
                    <label className="block">
                      Note
                      <textarea
                        disabled={busy}
                        aria-label="Proposed note"
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
                        Start
                        <input
                          disabled={busy}
                          type="datetime-local"
                          aria-label="Proposed start"
                          value={action.start}
                          onChange={(e) =>
                            setAction({ ...action, start: e.target.value })
                          }
                          className="input-apple w-full"
                        />
                      </label>
                      <label>
                        End
                        <input
                          disabled={busy}
                          type="datetime-local"
                          aria-label="Proposed end"
                          value={action.end}
                          onChange={(e) =>
                            setAction({ ...action, end: e.target.value })
                          }
                          className="input-apple w-full"
                        />
                      </label>
                      <p className="text-sm text-label-secondary sm:col-span-2">
                        Times without an offset use your device’s time zone.
                        Location: {action.location || "None"}
                      </p>
                    </div>
                  )}
                  {action.kind === "grocery_add" && (
                    <p className="text-sm">
                      Adds to your household’s grocery list when there is
                      exactly one. Choose a list in Lists when you have several.
                    </p>
                  )}
                  {action.kind.endsWith("_delete") && (
                    <>
                      <label className="block">
                        Choose the exact item
                        <select
                          disabled={busy}
                          aria-label="Item to remove"
                          value={selected}
                          onChange={(e) => {
                            setSelected(e.target.value);
                            setDeleteConfirm(false);
                          }}
                          className="input-apple min-h-[44px] w-full"
                        >
                          <option value="">Choose an item…</option>
                          {targets.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.title}
                              {t.detail
                                ? ` · ${new Date(t.detail).toLocaleString()}`
                                : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="text-sm text-label-secondary">
                        Deletion is permanent. Deleting a list also removes its
                        items. Repeating chores: only the selected occurrence is
                        removed.
                      </p>
                      {selected && (
                        <label className="flex min-h-[44px] items-center gap-3">
                          <input
                            type="checkbox"
                            disabled={busy}
                            checked={deleteConfirm}
                            onChange={(e) => setDeleteConfirm(e.target.checked)}
                          />
                          I confirm removing “
                          {targets.find((t) => t.id === selected)?.title}”
                        </label>
                      )}
                    </>
                  )}
                  {action.kind === "open" && <p>Open {action.destination}</p>}
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
                        ? "Remove selected item"
                        : action.kind === "open"
                          ? "Open section"
                          : "Confirm and save"}
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
                      Cancel proposal
                    </button>
                  </div>
                </section>
              )}
              <form onSubmit={send} className="space-y-2">
                <label htmlFor="assistant-message" className="font-semibold">
                  Your message
                </label>
                <textarea
                  id="assistant-message"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={2000}
                  disabled={busy}
                  className="input-apple w-full min-h-24"
                  placeholder="Add school pickup tomorrow at 3 for 30 minutes"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    disabled={busy || !text.trim()}
                    className={`${target} bg-[var(--accent-fill)] text-white`}
                    type="submit"
                  >
                    {busy ? "Working…" : "Send"}
                  </button>
                  <button
                    disabled={busy || !voice.supported}
                    type="button"
                    onClick={voice.start}
                    aria-pressed={voice.listening}
                    className={`${target} bg-surface-fill inline-flex items-center gap-2`}
                  >
                    {voice.listening ? <MicOff size={18} /> : <Mic size={18} />}{" "}
                    {voice.listening ? "Stop voice" : "Voice input"}
                  </button>
                  <button
                    disabled={busy}
                    type="button"
                    onClick={() => {
                      voice.stop();
                      setMessages([]);
                      setAction(null);
                      setText("");
                      setError("");
                    }}
                    className={`${target} bg-surface-fill`}
                  >
                    Clear chat
                  </button>
                </div>
                <p className="text-xs text-label-secondary">
                  {voice.supported
                    ? "Voice uses your browser’s speech service. Review the transcript, then Send."
                    : "Voice is unavailable in this browser; typing works."}{" "}
                  Chat stays only in this open app session.
                </p>
              </form>
              {role === "parent" && (
                <Link
                  href="/dashboard/settings?setup=ai#ai-capture"
                  onClick={close}
                  className="inline-flex min-h-[44px] items-center text-accent"
                >
                  Household AI setup in Settings
                </Link>
              )}
            </div>
          )}
          {tab === "report" && (
            <form onSubmit={saveReport} className="space-y-4">
              <p className="text-sm text-label-secondary">
                Save a private bug report or feature suggestion. Avoid passwords
                and private family details. No screenshot is attached
                automatically.
              </p>
              {receipt && (
                <p
                  role="status"
                  className="rounded-xl bg-accent-tint p-3 break-words"
                >
                  Report saved privately. Receipt: {receipt}. Status: received,
                  awaiting review.
                </p>
              )}
              <label className="block">
                Type
                <select
                  disabled={busy}
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value);
                    requestId.current = "";
                  }}
                  className="input-apple min-h-[44px] w-full"
                >
                  <option value="bug">Bug / fix</option>
                  <option value="feature">Feature suggestion</option>
                </select>
              </label>
              <label className="block">
                Title
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
              <label className="block">
                What happened or what would help?
                <textarea
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
              </label>
              <p className="text-xs text-label-secondary">
                Page: {pathname}. Reports stay private in the app; nothing is
                posted publicly.
              </p>
              <button
                disabled={busy}
                type="submit"
                className={`${target} bg-[var(--accent-fill)] text-white`}
              >
                {busy ? "Saving…" : "Save report"}
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
                Refresh reports
              </button>
              {reportsLoading ? (
                <p role="status">Loading reports…</p>
              ) : reports.length === 0 ? (
                <p className="text-label-secondary">
                  No saved reports to show.
                </p>
              ) : (
                reports.map((r) => (
                  <article
                    key={r.id}
                    className="rounded-xl bg-surface-fill p-3"
                  >
                    <h3 className="font-semibold break-words">{r.title}</h3>
                    <p className="text-sm text-label-secondary">
                      {r.kind} · {r.status} ·{" "}
                      {new Date(r.created_at).toLocaleDateString()}
                    </p>
                    <p className="text-xs break-words">Receipt: {r.id}</p>
                  </article>
                ))
              )}
            </div>
          )}
        </Dialog>
      </div>
    </>
  );
}
