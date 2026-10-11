"use client";

import * as React from "react";
import { Plus, CheckSquare, ChevronDown, Flame } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RecurringChoreRows } from "@/components/chores/RecurringChoreRows";
import { RoutineStacks } from "@/components/chores/RoutineStacks";
import { RoutineIcon } from "@/components/chores/RoutineIcon";
import { CheckboxRow } from "@/components/ui/checkbox-row";
import { ListRow } from "@/components/ui/list-row";
import { EmptyState } from "@/components/ui/empty-state";
import { MOTION } from "@/lib/brand-illustrations";
import { LargeHeader } from "@/components/ui/large-header";
import { Glyph } from "@/components/ui/glyph";
import { useToast, useUndoToast } from "@/components/ui/toast";
import {
  checkChore,
  setChoreDone,
  type CheckedChoreState,
} from "@/lib/chore-tick-client";
import { LongPressRow } from "@/components/ui/long-press-row";
import { Dialog } from "@/components/ui/dialog";
import { useLocalNow } from "@/components/ui/use-hydrated";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
import { cn } from "@/lib/utils";
import { useFeatureEnabled } from "@/components/providers/features-provider";
import { useChoreVerificationText } from "@/i18n/chore-verification";
import {
  formatDateOnly,
  formatRelativeDueDate,
  isDueToday,
  isDueWithinDays,
  snoozedDueDate,
} from "@/lib/dates";
import {
  CHORE_HISTORY_ORDER,
  CHORE_HISTORY_PAGE_SIZE,
  compareChoreOrder,
} from "@/lib/chore-paging";
import type { Chore } from "@/types";
import type { ChoreSubjectDTO } from "@/lib/chore-profile";

type FilterMode = "today" | "week" | "all";

// The open-chores heading names the range picked above, so a Week or All list
// (chores due on many days) is not labelled "Today".
const OPEN_HEADING: Record<FilterMode, string> = {
  today: "Today",
  week: "This week",
  all: "To do",
};

interface ChoresContentProps {
  chores: (Chore & {
    assignee: { name: string } | null;
    creator: { name: string } | null;
    /** Safe profile subject returned by the chores API for email-free members. */
    subject?: ChoreSubjectDTO;
    streak?: number;
  })[];
  familyMembers: { id: string; name: string; role: string; age?: number }[];
  currentUserId: string;
  userRole: string;
  /** `GET /api/chores` cursor for older verified chores not loaded yet (O-19), or null when all are here. */
  historyCursor?: string | null;
}

type BoardChore = ChoresContentProps["chores"][number];

function subjectName(chore: Pick<BoardChore, "assignee" | "subject">) {
  return chore.subject?.name ?? chore.assignee?.name ?? null;
}

/** "Morning, step 2" for a chore in a picture routine (#272), else null. */
function routineLabel(chore: {
  routine?: string | null;
  routine_order?: number | null;
}): string | null {
  if (!chore.routine) return null;
  return chore.routine_order
    ? `${chore.routine}, step ${chore.routine_order}`
    : chore.routine;
}

// Reassign dialog: the shared Dialog gives it role="dialog", a label,
// Escape to close and focus kept inside.
function ReassignModal({
  familyMembers,
  onConfirm,
  onCancel,
}: {
  familyMembers: { id: string; name: string; role: string }[];
  onConfirm: (assigneeId: string) => void;
  onCancel: () => void;
}) {
  const [selectedId, setSelectedId] = React.useState("");
  return (
    <Dialog
      open
      onClose={onCancel}
      title="Reassign chore"
      testId="reassign-dialog"
    >
      <div
        role="group"
        aria-label="Assign to"
        className="space-y-2 max-h-60 overflow-y-auto"
      >
        {familyMembers.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={selectedId === m.id}
            onClick={() => setSelectedId(m.id)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 min-h-[44px] rounded-lg text-left",
              "transition-colors duration-150",
              selectedId === m.id
                ? "bg-[var(--accent-fill)] text-white"
                : "active:bg-[var(--surface-fill-secondary)] text-label-primary",
            )}
          >
            <div
              aria-hidden="true"
              className="w-7 h-7 rounded-full bg-[var(--surface-fill-secondary)] flex items-center justify-center text-label-secondary text-footnote font-medium"
            >
              {m.name[0].toUpperCase()}
            </div>
            <span className="text-body">{m.name}</span>
            <span className="ml-auto text-footnote text-label-tertiary capitalize">
              {m.role}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2.5 min-h-[44px] rounded-xl text-body font-medium text-label-secondary active:bg-[var(--surface-fill-secondary)] transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => selectedId && onConfirm(selectedId)}
          disabled={!selectedId}
          className="flex-1 py-2.5 min-h-[44px] rounded-xl text-body font-medium bg-[var(--accent-fill)] text-white disabled:opacity-40 active:scale-95 transition-all"
        >
          Confirm
        </button>
      </div>
    </Dialog>
  );
}

export default function ChoresContent({
  chores,
  familyMembers,
  currentUserId,
  userRole,
  historyCursor = null,
}: ChoresContentProps) {
  const [view, setView] = React.useState<"chores" | "routines">("chores");
  const [filter, setFilter] = React.useState<FilterMode>("today");
  const [localChores, setLocalChores] = React.useState(chores);
  const [doneCollapsed, setDoneCollapsed] = React.useState(true);
  const { addToast } = useToast();
  const showUndo = useUndoToast();
  // Points & streaks (#248). When off, the page's server component already
  // omits each chore's points and streak; this only decides what to draw.
  const gamification = useFeatureEnabled("gamification");
  const [reassignTarget, setReassignTarget] = React.useState<string | null>(
    null,
  );
  const router = useRouter();
  const [nextCursor, setNextCursor] = React.useState(historyCursor);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [loadMoreError, setLoadMoreError] = React.useState<string | null>(null);
  // Due dates are shown in the viewer's locale ("Oct 5", "5 Oct"); stored
  // due_date values and the snooze payload stay YYYY-MM-DD.
  const displayLocale = useDisplayLocale();
  const verificationText = useChoreVerificationText();
  const verificationBusyRef = React.useRef(new Set<string>());
  const verificationDialogRef = React.useRef<string | null>(null);
  const verificationCancelRef = React.useRef<HTMLButtonElement>(null);
  const verificationReasonRef = React.useRef<HTMLTextAreaElement>(null);
  const verificationRetryRef = React.useRef<HTMLButtonElement>(null);
  const verificationFallbackRef = React.useRef<HTMLButtonElement>(null);
  const verificationFallbackConsumedRef = React.useRef(0);
  const verificationFallbackCancelledRef = React.useRef(0);
  const [verificationFallbackRequest, requestVerificationFallback] =
    React.useState(0);
  const [verificationBusyIds, setVerificationBusyIds] = React.useState(
    new Set<string>(),
  );
  const [verificationDialog, setVerificationDialog] = React.useState<{
    choreId: string;
    notes: string;
    error: string | null;
  } | null>(null);

  const scheduleVerificationFallback = React.useCallback(() => {
    window.setTimeout(() => {
      const active = document.activeElement;
      if (
        (active === document.body || !active?.isConnected) &&
        verificationFallbackRef.current?.isConnected
      ) {
        verificationFallbackRef.current.focus();
      }
    }, 0);
  }, []);

  // A successful send-back removes the opener row at the same time as the
  // dialog. Dialog's passive cleanup can only restore a connected opener, so
  // wait until that cleanup has run before focusing the stable page control.
  React.useEffect(() => {
    if (
      !verificationFallbackRequest ||
      !verificationDialog ||
      verificationFallbackRequest <= verificationFallbackConsumedRef.current
    )
      return;
    verificationFallbackCancelledRef.current = verificationFallbackRequest;
  }, [verificationDialog, verificationFallbackRequest]);

  React.useEffect(() => {
    if (
      !verificationFallbackRequest ||
      verificationDialog ||
      verificationFallbackRequest <= verificationFallbackConsumedRef.current ||
      verificationFallbackRequest === verificationFallbackCancelledRef.current
    )
      return;
    let cancelled = false;
    queueMicrotask(() => {
      if (
        cancelled ||
        verificationDialog ||
        verificationFallbackRequest === verificationFallbackCancelledRef.current
      )
        return;
      const fallback = verificationFallbackRef.current;
      if (!fallback) return;
      fallback.focus();
      verificationFallbackConsumedRef.current = verificationFallbackRequest;
    });
    return () => {
      cancelled = true;
    };
  }, [verificationDialog, verificationFallbackRequest]);

  // Keep keyboard focus on the recovery action after a failed decision. The
  // request clears its busy latch in a later render, so waiting for that
  // transition also avoids focusing the disabled button while the request is
  // still in flight.
  React.useEffect(() => {
    if (!verificationDialog?.error || verificationBusyIds.size > 0) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) verificationRetryRef.current?.focus();
    });
    return () => {
      cancelled = true;
    };
  }, [verificationBusyIds.size, verificationDialog?.error]);

  React.useEffect(() => {
    setLocalChores(chores);
    setNextCursor(historyCursor);
    setLoadMoreError(null);
  }, [chores, historyCursor]);

  // Older verified chores, one page at a time, newest first (opt-in paging,
  // O-19, `order=desc`). Rows
  // already on the page (and any local edits to them) win over the fetched copy.
  const handleLoadMore = React.useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const params = new URLSearchParams({
        status: "verified",
        limit: String(CHORE_HISTORY_PAGE_SIZE),
        cursor: nextCursor,
        order: CHORE_HISTORY_ORDER,
      });
      const response = await fetch(`/api/chores?${params}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(data.chores)) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Please try again.",
        );
      }
      const page = data.chores as ChoresContentProps["chores"];
      setLocalChores((prev) => {
        const have = new Set(prev.map((c) => c.id));
        return [...prev, ...page.filter((c) => !have.has(c.id))].sort(
          compareChoreOrder,
        );
      });
      setNextCursor(
        typeof data.nextCursor === "string" ? data.nextCursor : null,
      );
    } catch (error) {
      setLoadMoreError(
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor]);

  const handleCompleteChore = React.useCallback(
    async (choreId: string) => {
      try {
        const response = await fetch("/api/chores/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ choreId }),
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Failed to complete chore");

        const before = localChores.find((c) => c.id === choreId);
        setLocalChores((prev) =>
          prev.map((c) =>
            c.id === choreId
              ? {
                  ...c,
                  status: "completed" as const,
                  completed_at: new Date().toISOString(),
                }
              : c,
          ),
        );
        // Undo over confirm (#269): reopen through POST /api/chores/uncomplete.
        showUndo({
          title: before ? `“${before.title}” done` : "Chore done",
          onUndo: async () => {
            const result = await setChoreDone(choreId, false);
            if (!result.ok) {
              addToast({
                type: "error",
                title: "Couldn't undo",
                message: result.message,
              });
              return;
            }
            setLocalChores((prev) =>
              prev.map((c) =>
                c.id === choreId
                  ? {
                      ...c,
                      status: "pending" as const,
                      completed_at: undefined,
                    }
                  : c,
              ),
            );
          },
        });
      } catch (error) {
        addToast({
          type: "error",
          title: "Failed to complete chore",
          message: error instanceof Error ? error.message : "Please try again.",
        });
      }
    },
    [addToast, showUndo, localChores],
  );

  // A parent checks a chore a child marked done. Status changes go
  // through POST /api/chores/verify; PATCH /api/chores drops status fields, so
  // the old PATCH here silently did nothing. Optimistic, then the server's
  // state; a failure puts the row back and says why.
  const submitVerification = React.useCallback(
    async (choreId: string, decision: "approve" | "reject", notes?: string) => {
      if (verificationBusyRef.current.has(choreId)) return;
      const before = localChores.find((c) => c.id === choreId);
      if (!before) return;

      // This ref is the synchronous latch. React state alone would allow two
      // same-tick touch/keyboard activations to send duplicate POSTs.
      verificationBusyRef.current.add(choreId);
      setVerificationBusyIds((previous) => {
        const next = new Set(previous);
        next.add(choreId);
        return next;
      });
      if (decision === "reject") {
        setVerificationDialog((current) =>
          current?.choreId === choreId ? { ...current, error: null } : current,
        );
      }

      const applyServer = (state: CheckedChoreState) =>
        setLocalChores((prev) =>
          prev.map((c) =>
            c.id === choreId
              ? {
                  ...c,
                  status: state.status,
                  photo_verified: state.photo_verified,
                  verified_at: state.verified_at ?? undefined,
                  verified_notes: state.verified_notes ?? undefined,
                  completed_at: state.completed_at ?? undefined,
                }
              : c,
          ),
        );
      setLocalChores((prev) =>
        prev.map((c) =>
          c.id === choreId
            ? decision === "approve"
              ? { ...c, status: "verified" as const }
              : {
                  ...c,
                  status: "pending" as const,
                  completed_at: undefined,
                  verified_notes: notes,
                }
            : c,
        ),
      );
      try {
        const result = await checkChore(choreId, decision, notes);
        if (!result.ok) {
          // Show what the server has now (a 409 carries it); otherwise put the row back.
          if (result.chore) applyServer(result.chore);
          else
            setLocalChores((prev) =>
              prev.map((c) => (c.id === choreId ? before : c)),
            );
          if (decision === "reject") {
            // Keep the dialog and its notes mounted so network, validation and
            // conflict responses can be retried without re-entering the note.
            setVerificationDialog((current) =>
              current?.choreId === choreId
                ? { ...current, error: result.message }
                : current,
            );
          } else {
            addToast({
              type: "error",
              title: verificationText("verifyFailed", undefined),
              message: result.message,
            });
          }
          return;
        }
        if (result.chore) applyServer(result.chore);
        if (decision === "reject") {
          verificationDialogRef.current = null;
          setVerificationDialog(null);
          // A successful send-back removes the row that opened the dialog.
          // Return focus to a stable, 44px page control after Dialog's cleanup
          // has finished instead of leaving keyboard users on document.body.
          requestVerificationFallback((request) => request + 1);
        }
        addToast(
          decision === "approve"
            ? {
                type: "success",
                title: verificationText("verifiedTitle", undefined),
                message: verificationText("verifiedMessage", {
                  title: before.title,
                }),
              }
            : {
                type: "success",
                title: verificationText("sentBackTitle", undefined),
                message: verificationText("sentBackMessage", {
                  title: before.title,
                }),
              },
        );
      } finally {
        verificationBusyRef.current.delete(choreId);
        setVerificationBusyIds((previous) => {
          const next = new Set(previous);
          next.delete(choreId);
          return next;
        });
      }
    },
    [addToast, localChores, verificationText],
  );

  const closeVerificationDialog = React.useCallback(() => {
    const choreId = verificationDialogRef.current;
    if (!choreId || verificationBusyRef.current.has(choreId)) return;
    verificationDialogRef.current = null;
    setVerificationDialog(null);
    scheduleVerificationFallback();
  }, [scheduleVerificationFallback]);

  const handleCheckChore = React.useCallback(
    (choreId: string, decision: "approve" | "reject") => {
      if (
        verificationBusyRef.current.has(choreId) ||
        verificationDialogRef.current === choreId
      )
        return;
      if (decision === "reject") {
        verificationDialogRef.current = choreId;
        setVerificationDialog({ choreId, notes: "", error: null });
        return;
      }
      void submitVerification(choreId, decision);
    },
    [submitVerification],
  );

  const handleSnoozeChore = React.useCallback(
    async (choreId: string, currentDueDate: string) => {
      // due_date is date-only (UTC midnight): snoozing moves it to the next day,
      // never to a time of day.
      const newDueDay = snoozedDueDate(currentDueDate);
      try {
        const response = await fetch("/api/chores", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ choreId, due_date: newDueDay }),
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Failed to snooze chore");

        const storedDueDate: string =
          data.chore?.due_date ?? `${newDueDay}T00:00:00.000Z`;
        setLocalChores((prev) =>
          prev.map((c) =>
            c.id === choreId ? { ...c, due_date: storedDueDate } : c,
          ),
        );
        addToast({
          type: "success",
          title: "Snoozed a day",
          message: `Now due ${formatRelativeDueDate(storedDueDate, new Date(), displayLocale).replace("Tomorrow", "tomorrow")}.`,
        });
      } catch (error) {
        addToast({
          type: "error",
          title: "Failed to snooze",
          message: error instanceof Error ? error.message : "Please try again.",
        });
      }
    },
    [addToast, displayLocale],
  );

  const handleReassignChore = React.useCallback(
    async (choreId: string, assigneeId: string) => {
      try {
        const response = await fetch("/api/chores", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ choreId, assigned_to: assigneeId }),
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Failed to reassign chore");

        setLocalChores((prev) =>
          prev.map((c) =>
            c.id === choreId
              ? {
                  ...c,
                  assigned_to: assigneeId,
                  assignee:
                    familyMembers.find((m) => m.id === assigneeId) ??
                    c.assignee,
                }
              : c,
          ),
        );
        addToast({
          type: "success",
          title: "Chore reassigned",
          message: "Assignment updated.",
        });
      } catch (error) {
        addToast({
          type: "error",
          title: "Failed to reassign",
          message: error instanceof Error ? error.message : "Please try again.",
        });
      }
    },
    [addToast, familyMembers],
  );

  const handleDeleteChore = React.useCallback(
    async (choreId: string) => {
      if (!confirm("Delete this chore?")) return;
      try {
        const response = await fetch("/api/chores", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ choreId }),
        });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to delete chore");
        }
        setLocalChores((prev) => prev.filter((c) => c.id !== choreId));
        addToast({ type: "success", title: "Chore deleted" });
      } catch (error) {
        addToast({
          type: "error",
          title: "Failed to delete",
          message: error instanceof Error ? error.message : "Please try again.",
        });
      }
    },
    [addToast],
  );

  // "Today" and "Week" are the viewer's local days, unknown on the server
  // (O-31). Until hydration the day-based list is a placeholder, so the server
  // HTML and the first client render match; then the local filter applies.
  const now = useLocalNow();
  const filtered = now
    ? localChores.filter((c) => {
        if (filter === "today") return isDueToday(c.due_date, now);
        if (filter === "week") return isDueWithinDays(c.due_date, 7, now);
        return true;
      })
    : [];

  const todayChores = filtered.filter(
    (c) => c.status === "pending" || c.status === "in_progress",
  );
  // Done by a child and waiting for a parent's check (any date).
  const toCheckCount = localChores.filter(
    (c) => c.status === "completed",
  ).length;
  // Newest first, so "Load more" (older history) continues at the bottom.
  const doneChores = filtered
    .filter((c) => c.status === "completed" || c.status === "verified")
    .sort((a, b) => compareChoreOrder(b, a));

  const renderOpenChore = (chore: (typeof todayChores)[number], i: number) => {
    if (!now) return null;
    const profileOnly = chore.subject?.kind === "profile";
    const actions = [
          chore.recurrence_id
            ? {
                // Moving an occurrence onto an already-expanded date violates
                // the series' (recurrence_id, due_date) key. Until a proper
                // exception model exists, explain why this action is unavailable
                // instead of sending a request that can fail or corrupt the series.
                label: "Snooze unavailable for repeating chores",
                onClick: () => undefined,
                disabled: true,
              }
            : {
                label: "Snooze a day",
                onClick: () => handleSnoozeChore(chore.id, chore.due_date),
              },
          {
            label: "Edit",
            onClick: () => router.push(`/dashboard/chores/edit?id=${chore.id}`),
          },
          {
            label: "Reassign",
            // The action sheet hands focus back to its trigger on a
            // 0 ms timer; open the dialog after that, so the dialog
            // takes focus (and returns it to the trigger on close).
            onClick: () =>
              window.setTimeout(() => setReassignTarget(chore.id), 0),
          },
          {
            label: "Mark complete",
            onClick: () => handleCompleteChore(chore.id),
          },
          {
            label: "Delete",
            onClick: () => handleDeleteChore(chore.id),
            destructive: true,
          },
        ] as const;
    // Profile-only chores are readable on the parent board, but protocol 2 is
    // intentionally off. Do not expose legacy controls that can only return
    // MEMBER_PROTOCOL_UNAVAILABLE; paired-device actions arrive with that
    // protocol in a later vertical slice.
    const row = (
      <CheckboxRow
          checked={false}
          disabled={profileOnly}
          toggleArea="control"
          onChange={() => handleCompleteChore(chore.id)}
          title={chore.title}
          subtitle={[
            subjectName(chore),
            formatRelativeDueDate(chore.due_date, now, displayLocale),
            routineLabel(chore),
            chore.rotation_next_name
              ? `Takes turns · next: ${chore.rotation_next_name}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          glyph={
            <Glyph color="chore" size="sm">
              {chore.icon ? (
                <RoutineIcon icon={chore.icon} className="w-4 h-4 text-white" />
              ) : (
                <CheckSquare className="w-4 h-4 text-white" />
              )}
            </Glyph>
          }
          meta={
            gamification && (chore.points > 0 || (chore.streak ?? 0) >= 3) ? (
              <span className="flex items-center gap-1">
                {chore.points > 0 && (
                  <span className="text-footnote text-label-tertiary">
                    +{chore.points}
                  </span>
                )}
                {(chore.streak ?? 0) >= 3 && (
                  <span
                    className="flex items-center text-warning-text"
                    title={`${chore.streak} day streak`}
                  >
                    <Flame className="w-3 h-3 fill-brand-mustard" />
                    <span className="text-footnote">{chore.streak}</span>
                  </span>
                )}
              </span>
            ) : undefined
          }
          className={cn("pr-3", i === todayChores.length - 1 && "border-b-0")}
        />
    );
    if (profileOnly) return <div key={chore.id}>{row}</div>;
    // A visible "⋯" opens the actions (they used to be long-press only), and
    // only the check itself completes the chore, so tapping the name to edit
    // it does not tick it off.
    return (
      <LongPressRow
        key={chore.id}
        itemName={`“${chore.title}”`}
        showMenuButton
        actions={[...actions]}
      >
        {row}
      </LongPressRow>
    );
  };

  const SegmentedControl = ({
    value,
    onChange,
  }: {
    value: FilterMode;
    onChange: (v: FilterMode) => void;
  }) => (
    <div className="flex bg-[var(--surface-fill)] rounded-lg p-1 gap-1">
      {(["today", "week", "all"] as FilterMode[]).map((opt) => (
        <button
          key={opt}
          type="button"
          ref={opt === "today" ? verificationFallbackRef : undefined}
          onClick={() => onChange(opt)}
          aria-pressed={value === opt}
          className={cn(
            // 44px tall; the picked one also gets a hairline ring so it reads in dark mode.
            "flex-1 min-h-[44px] py-1.5 px-3 rounded-md text-sm font-medium transition-all duration-200",
            value === opt
              ? "bg-[var(--surface-elevated)] text-label-primary font-semibold shadow-sm ring-1 ring-[var(--surface-separator)]"
              : "text-label-secondary hover:text-label-primary",
          )}
        >
          {opt.charAt(0).toUpperCase() + opt.slice(1)}
        </button>
      ))}
    </div>
  );

  return (
    <div className="pb-20">
      <LargeHeader
        title="Chores"
        subtitle={
          now
            ? choresSubtitle(
                todayChores.length,
                userRole === "parent" ? toCheckCount : 0,
              )
            : undefined
        }
        trailing={
          <Link
            href="/dashboard/chores/create"
            className="btn-filled shrink-0"
            aria-label="Add chore"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
          </Link>
        }
        className="px-4"
      />

      <div className="px-4 mb-4">
        <SegmentedControl value={filter} onChange={setFilter} />
        <div role="group" aria-label="Chore view" className="flex gap-2 mt-3">
          {(["chores", "routines"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={cn(
                "min-h-[44px] px-4 rounded-lg text-body",
                view === option
                  ? "bg-[var(--accent-tint)] text-[var(--accent)]"
                  : "text-label-secondary",
              )}
            >
              {option === "chores" ? "Chore list" : "Routines"}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-6 px-4">
        {/* Parent-only: chores waiting for a check. First, because it is the
            parent's next action; below an "All clear!" it read as nothing to do. */}
        {userRole === "parent" &&
          (() => {
            // Every chore marked done and not yet checked (the same count the
            // home's "N chores to check" link uses), photo or not.
            const pendingVerification = localChores.filter(
              (c) => c.status === "completed",
            );
            if (pendingVerification.length === 0) return null;
            return (
              <section>
                <p className="section-header">To check</p>
                <div className="list-inset">
                  {pendingVerification.map((chore, i) => (
                    <div
                      key={chore.id}
                      className={cn(
                        "px-4 py-3 flex items-center gap-3",
                        "border-b border-[var(--surface-separator)] last:border-b-0",
                      )}
                    >
                      {chore.photo_url && (
                        <div className="w-10 h-10 rounded-[var(--radius-md)] overflow-hidden bg-[var(--surface-fill)] shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={chore.photo_url}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-body text-label-primary [overflow-wrap:anywhere]">
                          {chore.title}
                        </p>
                        <p className="text-footnote text-label-secondary">
                          {[
                            subjectName(chore)
                              ? `Assigned to ${subjectName(chore)}`
                              : null,
                            routineLabel(chore),
                            verificationText("waitingForCheck", undefined),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      {(() => {
                        const verificationBusy = verificationBusyIds.has(
                          chore.id,
                        );
                        const verificationDialogOpen =
                          verificationDialog?.choreId === chore.id;
                        const actionsDisabled =
                          verificationBusy || verificationDialogOpen;
                        return (
                          <div
                            className="flex gap-2 shrink-0"
                            aria-busy={verificationBusy || undefined}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                handleCheckChore(chore.id, "approve")
                              }
                              aria-label={verificationText("verifyAriaLabel", {
                                title: chore.title,
                              })}
                              disabled={actionsDisabled}
                              className="btn-filled text-sm py-1.5 px-3 min-h-[44px] disabled:opacity-40"
                            >
                              {verificationBusy
                                ? verificationText("verifying", undefined)
                                : verificationText("verify", undefined)}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleCheckChore(chore.id, "reject")
                              }
                              aria-label={verificationText(
                                "sendBackAriaLabel",
                                { title: chore.title },
                              )}
                              disabled={actionsDisabled}
                              className="btn-destructive text-sm py-1.5 px-3 min-h-[44px] disabled:opacity-40"
                            >
                              {verificationText("sendBack", undefined)}
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              </section>
            );
          })()}
        {!now ? (
          <section
            aria-label="Chores"
            aria-busy="true"
            data-testid="chores-pending"
          >
            <div className="h-16 rounded-[var(--radius-xl)] bg-[var(--surface-fill)]" />
          </section>
        ) : view === "routines" ? (
          <RoutineStacks
            chores={filtered}
            userRole={userRole}
            currentUserId={currentUserId}
            locale={displayLocale}
            collapseRepeats={filter !== "today"}
            onComplete={handleCompleteChore}
          />
        ) : todayChores.length > 0 ? (
          <section>
            <p className="section-header">{OPEN_HEADING[filter]}</p>
            <div className="list-inset stagger">
              {filter === "today" ? (
                todayChores.map(renderOpenChore)
              ) : (
                <RecurringChoreRows
                  chores={todayChores}
                  now={now}
                  locale={displayLocale}
                  renderRow={renderOpenChore}
                />
              )}
            </div>
          </section>
        ) : (
          <EmptyState
            icon={CheckSquare}
            glyphColor="chore"
            motion={MOTION.tea}
            title="All clear!"
            description={
              filter === "today"
                ? "No chores due today."
                : "No chores in this range."
            }
          />
        )}

        {view === "chores" && doneChores.length > 0 && (
          <section>
            <button
              type="button"
              onClick={() => setDoneCollapsed(!doneCollapsed)}
              aria-expanded={!doneCollapsed}
              className="section-header w-full text-left flex items-center justify-between pr-4"
            >
              <span>Done</span>
              <span className="flex items-center gap-1 text-label-tertiary text-xs">
                {doneChores.length}
                {filter === "all" && nextCursor ? "+" : ""}
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "w-4 h-4 transition-transform",
                    !doneCollapsed && "rotate-180",
                  )}
                />
              </span>
            </button>
            {!doneCollapsed && (
              <div className="list-inset">
                {doneChores.map((chore, i) => (
                  <ListRow
                    key={chore.id}
                    icon={CheckSquare}
                    glyphColor="chore"
                    title={chore.title}
                    subtitle={formatDateOnly(
                      chore.due_date,
                      undefined,
                      displayLocale,
                    )}
                    showChevron={false}
                    trailing={
                      gamification ? (
                        <span className="text-footnote text-label-tertiary">
                          +{chore.points}
                        </span>
                      ) : undefined
                    }
                    className={cn(i === doneChores.length - 1 && "border-b-0")}
                  />
                ))}
              </div>
            )}
            {/* Older history only shows under "All" (Today and Week are fully loaded). */}
            {!doneCollapsed && filter === "all" && nextCursor && (
              <div className="mt-3 flex flex-col items-center gap-2">
                {loadMoreError && (
                  <p
                    role="alert"
                    className="text-footnote text-[var(--danger-text)] text-center"
                  >
                    Couldn&apos;t load more chores. {loadMoreError}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  aria-busy={loadingMore}
                  className="btn-tinted min-h-[44px] disabled:opacity-40"
                >
                  {loadingMore
                    ? "Loading…"
                    : loadMoreError
                      ? "Try again"
                      : "Load more"}
                </button>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Reassign modal */}
      {reassignTarget && (
        <ReassignModal
          familyMembers={familyMembers}
          onConfirm={(assigneeId) => {
            handleReassignChore(reassignTarget, assigneeId);
            setReassignTarget(null);
          }}
          onCancel={() => setReassignTarget(null)}
        />
      )}

      {verificationDialog && (
        <Dialog
          open
          onClose={
            verificationBusyIds.has(verificationDialog.choreId)
              ? undefined
              : closeVerificationDialog
          }
          closeLabel={verificationText("close", undefined)}
          title={verificationText("dialogTitle", {
            title:
              localChores.find((c) => c.id === verificationDialog.choreId)
                ?.title ?? "",
          })}
          description={verificationText("dialogDescription", undefined)}
          initialFocusRef={verificationCancelRef}
          testId="chore-verification-dialog"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const notes = verificationDialog.notes.trim() || undefined;
              void submitVerification(
                verificationDialog.choreId,
                "reject",
                notes,
              );
            }}
            aria-busy={
              verificationBusyIds.has(verificationDialog.choreId) || undefined
            }
            className="space-y-4"
          >
            <label
              htmlFor="chore-verification-reason"
              className="block text-body font-medium text-label-primary"
            >
              {verificationText("reasonLabel", undefined)}
            </label>
            <textarea
              id="chore-verification-reason"
              ref={verificationReasonRef}
              value={verificationDialog.notes}
              onChange={(event) =>
                setVerificationDialog((current) =>
                  current ? { ...current, notes: event.target.value } : current,
                )
              }
              placeholder={verificationText("reasonPlaceholder", undefined)}
              disabled={verificationBusyIds.has(verificationDialog.choreId)}
              rows={4}
              className="w-full min-h-[112px] rounded-xl border border-[var(--surface-separator)] bg-[var(--surface-fill-secondary)] px-3 py-3 text-body text-label-primary placeholder:text-label-tertiary focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[var(--accent-text)] disabled:opacity-50"
            />
            {verificationDialog.error && (
              <p
                role="alert"
                className="rounded-lg bg-[var(--danger-fill)] px-3 py-2 text-footnote text-[var(--danger-text)]"
              >
                {verificationDialog.error}
              </p>
            )}
            <div className="flex gap-3">
              <button
                ref={verificationCancelRef}
                type="button"
                onClick={closeVerificationDialog}
                disabled={verificationBusyIds.has(verificationDialog.choreId)}
                className="flex-1 min-h-[44px] rounded-xl px-3 py-2.5 text-body font-medium text-label-secondary active:bg-[var(--surface-fill-secondary)] disabled:opacity-40"
              >
                {verificationText("cancel", undefined)}
              </button>
              <button
                ref={verificationRetryRef}
                type="submit"
                disabled={verificationBusyIds.has(verificationDialog.choreId)}
                className="btn-destructive flex-1 min-h-[44px] px-3 py-2.5 text-body font-medium disabled:opacity-40"
              >
                {verificationBusyIds.has(verificationDialog.choreId)
                  ? verificationText("sendingBack", undefined)
                  : verificationDialog.error
                    ? verificationText("tryAgain", undefined)
                    : verificationText("sendBack", undefined)}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}

function choresSubtitle(open: number, toCheck: number): string {
  const parts = [`${open} to do`];
  if (toCheck > 0) parts.push(`${toCheck} to check`);
  return parts.join(" · ");
}
