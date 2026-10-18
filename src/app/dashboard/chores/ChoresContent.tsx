"use client";

import * as React from "react";
import { Plus, CheckSquare, ChevronDown, Flame } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RecurringChoreRows } from "@/components/chores/RecurringChoreRows";
import { ChoreViewControls, type ChorePresentation } from "@/components/chores/ChoreViewControls";
import { useChoreOverviewText } from "@/i18n/chore-overview";
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
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import { useChoreVerificationText } from "@/i18n/chore-verification";
import { useProfileSetupText } from "@/i18n/profile-setup";
import {
  choreFormMessages,
  type ChoreFormMessage,
} from "@/i18n/chore-forms";
import { useTranslation } from "@/i18n";
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
import type {
  ChoreSubjectDTO,
  ProfileChoreActionAvailability,
} from "@/lib/chore-profile";

type FilterMode = "today" | "week" | "all";

function isActiveRepeatingChore(chore: Chore): boolean {
  const frequency = chore.recurrence_frequency ?? chore.frequency;
  return Boolean(
    chore.recurrence_id &&
      frequency &&
      frequency !== "once",
  );
}

interface ChoresContentProps {
  chores: (Chore & {
    assignee: { name: string } | null;
    creator: { name: string } | null;
    /** Safe profile subject returned by the chores API for email-free members. */
    subject?: ChoreSubjectDTO;
    /** Per-row compatibility state for profile-only actions. */
    actionAvailability?: ProfileChoreActionAvailability;
    streak?: number;
  })[];
  familyMembers: { id: string; name: string; role: string; age?: number }[];
  currentUserId: string;
  userRole: string;
  familyId?: string;
  /** `GET /api/chores` cursor for older verified chores not loaded yet (O-19), or null when all are here. */
  historyCursor?: string | null;
}

type BoardChore = ChoresContentProps["chores"][number];

/**
 * Keep the durable subject discriminator authoritative even when the profile
 * is no longer readable. An absent `subject` means the profile is unavailable,
 * not that the row can be treated as an unassigned account chore.
 */
function isProfileOnlyChore(
  chore: Pick<
    BoardChore,
    "assigned_to" | "assigned_member_id" | "member_subject_erased"
  >,
) {
  return (
    chore.assigned_to === null &&
    (chore.assigned_member_id != null || chore.member_subject_erased === true)
  );
}

function subjectName(chore: Pick<BoardChore, "assignee" | "subject">) {
  return chore.subject?.name ?? chore.assignee?.name ?? null;
}

function isPausedProfileChore(
  chore: Pick<BoardChore, "subject" | "actionAvailability">,
) {
  return (
    chore.subject?.kind === "profile" &&
    chore.actionAvailability?.state === "paused"
  );
}

/** "Morning, step 2" for a chore in a picture routine (#272), else null. */
function routineLabel(chore: {
  routine?: string | null;
  routine_order?: number | null;
}, text: ReturnType<typeof useChoreOverviewText>): string | null {
  if (!chore.routine) return null;
  return chore.routine_order
    ? text("routineStep", { routine: chore.routine, order: chore.routine_order })
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
  const overviewText = useChoreOverviewText();
  const profileText = useProfileSetupText();
  const [selectedId, setSelectedId] = React.useState("");
  return (
    <Dialog
      open
      onClose={onCancel}
      title={overviewText("reassignTitle")}
      closeLabel={overviewText("close")}
      testId="reassign-dialog"
    >
      <div
        role="group"
        aria-label={overviewText("assignTo")}
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
              className={cn("w-7 h-7 shrink-0 rounded-full bg-[var(--surface-fill-secondary)] flex items-center justify-center text-footnote font-medium", selectedId === m.id ? "text-inherit" : "text-label-secondary")}
            >
              {m.name[0].toUpperCase()}
            </div>
            <span className="min-w-0 flex-1 text-body [overflow-wrap:anywhere]">{m.name}</span>
            <span className={cn("ml-auto max-w-[45%] shrink-0 text-right text-footnote [overflow-wrap:anywhere]", selectedId === m.id ? "text-inherit" : "text-label-tertiary")}>
              {m.role === "parent" ? profileText("roleParent") : m.role === "teen" ? profileText("roleTeen") : m.role === "child" ? profileText("roleChild") : m.role}
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
          {overviewText("cancel")}
        </button>
        <button
          type="button"
          onClick={() => selectedId && onConfirm(selectedId)}
          disabled={!selectedId}
          className="flex-1 py-2.5 min-h-[44px] rounded-xl text-body font-medium bg-[var(--accent-fill)] text-white disabled:opacity-40 active:scale-95 transition-all"
        >
          {overviewText("confirm")}
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
  familyId,
  historyCursor = null,
}: ChoresContentProps) {
  const [view, setView] = React.useState<"chores" | "routines">("chores");
  const [filter, setFilter] = React.useState<FilterMode>("today");
  const [seriesMode, setSeriesMode] = React.useState(false);
  const overviewText = useChoreOverviewText();
  const presentation: ChorePresentation = view === "routines" ? "routines" : seriesMode ? "series" : filter;
  const changePresentation = (next: ChorePresentation) => {
    setSeriesMode(next === "series");
    setView(next === "routines" ? "routines" : "chores");
    if (next !== "routines") setFilter(next === "series" ? "all" : next);
  };
  const [localChores, setLocalChores] = React.useState(chores);
  const [doneCollapsed, setDoneCollapsed] = React.useState(true);
  const { addToast } = useToast();
  const showUndo = useUndoToast();
  const { t } = useTranslation();
  const profileText = useProfileSetupText();
  const message = React.useCallback(
    (key: ChoreFormMessage, params?: Record<string, string | number>) =>
      t(key, params, choreFormMessages),
    [t],
  );
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
  const verificationFallbackRef = React.useRef<HTMLButtonElement | null>(null);
  const deleteFallbackRef = React.useRef<HTMLButtonElement | null>(null);
  const deletePendingRef = React.useRef<string | null>(null);
  const deleteCancelRef = React.useRef<HTMLButtonElement>(null);
  const deleteRetryRef = React.useRef<HTMLButtonElement>(null);
  const deleteRefreshRef = React.useRef<HTMLButtonElement>(null);
  const deleteFallbackConsumedRef = React.useRef(0);
  const verificationFallbackConsumedRef = React.useRef(0);
  const verificationFallbackCancelledRef = React.useRef(0);
  const [verificationFallbackRequest, requestVerificationFallback] =
    React.useState(0);
  const [deleteFallbackRequest, requestDeleteFallback] = React.useState(0);
  const [verificationBusyIds, setVerificationBusyIds] = React.useState(
    new Set<string>(),
  );
  const [verificationDialog, setVerificationDialog] = React.useState<{
    choreId: string;
    notes: string;
    error: string | null;
  } | null>(null);
  const [deleteDialog, setDeleteDialog] = React.useState<{
    choreId: string;
    error: string | null;
    notFound: boolean;
    pending: boolean;
  } | null>(null);
  // Keep the destructive confirmation on the current route while the DELETE
  // or its explicit recovery readback is pending. The shared controller owns
  // the browser Back sentinel and prevents a stale page transition from
  // unmounting this dialog before the request settles.
  usePendingFormNavigationController(Boolean(deleteDialog?.pending));

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

  // A DELETE failure leaves the target and its confirmation mounted. Move
  // focus to the explicit recovery action after the request latch clears.
  React.useEffect(() => {
    if (!deleteDialog?.error || deleteDialog.pending) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      (deleteDialog.notFound ? deleteRefreshRef : deleteRetryRef).current?.focus();
    });
    return () => {
      cancelled = true;
    };
  }, [deleteDialog?.error, deleteDialog?.notFound, deleteDialog?.pending]);

  // The action sheet unmounts its opener before the confirmation dialog opens.
  // After a close or successful removal, return focus to the stable filter
  // control rather than leaving keyboard users on document.body.
  React.useEffect(() => {
    if (
      !deleteFallbackRequest ||
      deleteDialog ||
      deleteFallbackRequest <= deleteFallbackConsumedRef.current
    )
      return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      deleteFallbackRef.current?.focus();
      deleteFallbackConsumedRef.current = deleteFallbackRequest;
    });
    return () => {
      cancelled = true;
    };
  }, [deleteDialog, deleteFallbackRequest]);

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
          typeof data.error === "string" ? data.error : overviewText("retryMessage"),
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
        error instanceof Error ? error.message : overviewText("retryMessage"),
      );
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, overviewText]);

  const handleCompleteChore = React.useCallback(
    async (choreId: string) => {
      const target = localChores.find((c) => c.id === choreId);
      // A rollback can arrive while an action sheet or a routine view is
      // still mounted. Treat the server's paused capability as authoritative
      // even if a stale child callback fires before the next render.
      if (target && isPausedProfileChore(target)) return;
      try {
        const response = await fetch("/api/chores/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ choreId }),
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || overviewText("completeFailed"));

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
          title: before ? overviewText("doneTitle", { title: before.title }) : overviewText("choreDone"),
          onUndo: async () => {
            const result = await setChoreDone(choreId, false);
            if (!result.ok) {
              addToast({
                type: "error",
                title: overviewText("undoFailed"),
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
          title: overviewText("completeFailed"),
          message: error instanceof Error ? error.message : overviewText("retryMessage"),
        });
      }
    },
    [addToast, showUndo, localChores, overviewText],
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
      if (isPausedProfileChore(before)) return;

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
      const chore = localChores.find((c) => c.id === choreId);
      if (!chore || isPausedProfileChore(chore)) return;
      if (decision === "reject") {
        verificationDialogRef.current = choreId;
        setVerificationDialog({ choreId, notes: "", error: null });
        return;
      }
      void submitVerification(choreId, decision);
    },
    [localChores, submitVerification],
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
          throw new Error(data.error || overviewText("snoozeRequestFailed"));

        const storedDueDate: string =
          data.chore?.due_date ?? `${newDueDay}T00:00:00.000Z`;
        setLocalChores((prev) =>
          prev.map((c) =>
            c.id === choreId ? { ...c, due_date: storedDueDate } : c,
          ),
        );
        addToast({
          type: "success",
          title: overviewText("snoozed"),
          message: overviewText("snoozedMessage", { date: formatRelativeDueDate(storedDueDate, new Date(), displayLocale, { today: overviewText("today"), tomorrow: overviewText("tomorrowInSentence") }) }),
        });
      } catch (error) {
        addToast({
          type: "error",
          title: overviewText("snoozeFailed"),
          message: error instanceof Error ? error.message : overviewText("retryMessage"),
        });
      }
    },
    [addToast, displayLocale, overviewText],
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
          throw new Error(data.error || overviewText("reassignRequestFailed"));

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
          title: overviewText("reassigned"),
          message: overviewText("reassignedMessage"),
        });
      } catch (error) {
        addToast({
          type: "error",
          title: overviewText("reassignFailed"),
          message: error instanceof Error ? error.message : overviewText("retryMessage"),
        });
      }
    },
    [addToast, familyMembers, overviewText],
  );

  const openDeleteDialog = React.useCallback((choreId: string) => {
    if (deletePendingRef.current) return;
    setDeleteDialog({ choreId, error: null, notFound: false, pending: false });
  }, []);

  const closeDeleteDialog = React.useCallback(() => {
    if (deletePendingRef.current) return;
    setDeleteDialog(null);
    requestDeleteFallback((request) => request + 1);
  }, []);

  const submitDelete = React.useCallback(
    async (choreId: string) => {
      if (deletePendingRef.current === choreId) return;
      if (!localChores.some((chore) => chore.id === choreId)) return;

      // React state is asynchronous; this ref closes the same-tick keyboard
      // and touch race before a second DELETE can be sent.
      deletePendingRef.current = choreId;
      setDeleteDialog((current) =>
        current?.choreId === choreId
          ? { ...current, error: null, notFound: false, pending: true }
          : current,
      );
      try {
        const response = await fetch("/api/chores", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ choreId }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const mapped =
            response.status === 404
              ? message("deleteOccurrenceNotFound")
              : data.code === "RECURRING_SERIES_REQUIRES_STOP"
                ? userRole === "parent"
                  ? message("recurringSeriesRequiresStop")
                  : message("recurringSeriesParentOnly")
                : data.code === "RECURRING_ANCHOR_RETAINS_HISTORY"
                  ? message("recurringAnchorRetainsHistory")
                  : message("deleteOccurrenceRefused");
          setDeleteDialog((current) =>
            current?.choreId === choreId
              ? {
                  ...current,
                  error: mapped,
                  notFound: response.status === 404,
                  pending: false,
                }
              : current,
          );
          return;
        }
        setLocalChores((prev) => prev.filter((c) => c.id !== choreId));
        setDeleteDialog(null);
        requestDeleteFallback((request) => request + 1);
        addToast({ type: "success", title: message("deleteOccurrenceSuccess") });
      } catch {
        setDeleteDialog((current) =>
          current?.choreId === choreId
            ? {
                ...current,
                error: message("deleteOccurrenceUnknown"),
                notFound: false,
                pending: false,
              }
            : current,
        );
      } finally {
        deletePendingRef.current = null;
      }
    },
    [addToast, localChores, message, userRole],
  );

  const refreshAfterDeleteMiss = React.useCallback(
    async (choreId: string) => {
      if (deletePendingRef.current === choreId) return;
      deletePendingRef.current = choreId;
      setDeleteDialog((current) =>
        current?.choreId === choreId
          ? { ...current, error: null, pending: true }
          : current,
      );
      try {
        const response = await fetch(
          `/api/chores?id=${encodeURIComponent(choreId)}`,
          { cache: "no-store" },
        );
        if (response.status === 404) {
          setLocalChores((prev) => prev.filter((c) => c.id !== choreId));
          setDeleteDialog(null);
          requestDeleteFallback((request) => request + 1);
          addToast({
            type: "info",
            title: message("deleteOccurrenceGone"),
          });
          return;
        }
        setDeleteDialog((current) =>
          current?.choreId === choreId
            ? {
                ...current,
                error: response.ok
                  ? message("deleteOccurrenceStillExists")
                  : message("deleteOccurrenceRefreshFailed"),
                notFound: false,
                pending: false,
              }
            : current,
        );
      } catch {
        setDeleteDialog((current) =>
          current?.choreId === choreId
            ? {
                ...current,
                error: message("deleteOccurrenceRefreshFailed"),
                notFound: false,
                pending: false,
              }
            : current,
        );
      } finally {
        deletePendingRef.current = null;
      }
    },
    [addToast, message],
  );

  // "Today" and "Week" are the viewer's local days, unknown on the server
  // (O-31). Until hydration the day-based list is a placeholder, so the server
  // HTML and the first client render match; then the local filter applies.
  const now = useLocalNow();
  const filtered = now
    ? localChores.filter((c) => {
        if (filter === "today") return isDueToday(c.due_date, now);
        if (filter === "week") return isDueWithinDays(c.due_date, 7, now);
        return !seriesMode || isActiveRepeatingChore(c);
      })
    : [];

  const routineRows = filtered.filter(c => c.routine?.trim() || c.routine_stack_id);
  const showInlineRoutines = view === "chores" && !seriesMode && filter !== "all" && routineRows.length > 0;
  const routineIds = new Set(showInlineRoutines ? routineRows.map(c => c.id) : []);
  const choreById = new Map(localChores.map(c => [c.id, c]));
  const todayChores = filtered.filter(
    (c) => c.status === "pending" || c.status === "in_progress",
  );
  const listChores = todayChores.filter(c => !routineIds.has(c.id));
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
    const profileOnly = isProfileOnlyChore(chore);
    const profilePaused = isPausedProfileChore(chore);
    const profileUnavailable = profileOnly && chore.subject?.kind !== "profile";
    const ownerLabel = profileUnavailable
      ? profileText("profileTargetRefresh")
      : subjectName(chore);
    const actions = [
          chore.recurrence_id
            ? {
                // Moving an occurrence onto an already-expanded date violates
                // the series' (recurrence_id, due_date) key. Until a proper
                // exception model exists, explain why this action is unavailable
                // instead of sending a request that can fail or corrupt the series.
                label: overviewText("snoozeUnavailable"),
                onClick: () => undefined,
                disabled: true,
              }
            : {
                label: overviewText("snooze"),
                onClick: () => handleSnoozeChore(chore.id, chore.due_date),
              },
          {
            label: overviewText("edit"),
            onClick: () => router.push(`/dashboard/chores/edit?id=${chore.id}`),
          },
          ...(userRole === "parent" && isActiveRepeatingChore(chore)
            ? [
                {
                  label: message("stopRepeating"),
                  onClick: () =>
                    router.push(
                      `/dashboard/chores/edit?id=${encodeURIComponent(chore.id)}&stop=1`,
                    ),
                },
              ]
            : []),
          {
            label: overviewText("reassign"),
            // The action sheet hands focus back to its trigger on a
            // 0 ms timer; open the dialog after that, so the dialog
            // takes focus (and returns it to the trigger on close).
            onClick: () =>
              window.setTimeout(() => setReassignTarget(chore.id), 0),
          },
          {
            label: overviewText("markComplete"),
            onClick: () => handleCompleteChore(chore.id),
          },
          {
            label: message("deleteOccurrence"),
            onClick: () => openDeleteDialog(chore.id),
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
          disabled={profileOnly || profilePaused}
          toggleArea="control"
          onChange={() => handleCompleteChore(chore.id)}
          title={chore.title}
          subtitle={[
            ownerLabel,
            formatRelativeDueDate(chore.due_date, now, displayLocale, { today: overviewText("today"), tomorrow: overviewText("tomorrow") }),
            profilePaused
              ? profileText("profileTargetRecurrencePaused")
              : null,
            routineLabel(chore, overviewText),
            chore.rotation_next_name
              ? overviewText("rotationNext", { name: chore.rotation_next_name })
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
                    title={overviewText("dayStreak", { count: chore.streak ?? 0 })}
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

  return (
    <div className="pb-20">
      <LargeHeader
        title={overviewText("title")}
        subtitle={
          now
            ? choresSubtitle(
                todayChores.length,
                userRole === "parent" ? toCheckCount : 0,
                overviewText,
              )
            : undefined
        }
        trailing={
          <Link
            href="/dashboard/chores/create"
            className="btn-filled shrink-0"
            aria-label={overviewText("add")}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>{overviewText("add")}</span>
          </Link>
        }
        className="px-4"
      />

      <div className="px-4 mb-4">
        <ChoreViewControls value={presentation} range={filter}
          onChange={changePresentation} onRangeChange={setFilter}
          todayRef={node => { verificationFallbackRef.current = node; deleteFallbackRef.current = node; }} />
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
                <p className="section-header">{overviewText("toCheck")}</p>
                <div className="list-inset">
                  {pendingVerification.map((chore, i) => {
                    const profileUnavailable =
                      isProfileOnlyChore(chore) &&
                      chore.subject?.kind !== "profile";
                    const profilePaused = isPausedProfileChore(chore);
                    const ownerLabel = profileUnavailable
                      ? profileText("profileTargetRefresh")
                      : subjectName(chore)
                        ? overviewText("assignedTo", { name: subjectName(chore) ?? "" })
                        : null;
                    return (
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
                              ownerLabel,
                              routineLabel(chore, overviewText),
                              profilePaused
                                ? profileText("profileTargetRecurrencePaused")
                                : verificationText("waitingForCheck", undefined),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        {!profileUnavailable && !profilePaused && (() => {
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
                    );
                  })}
                </div>
              </section>
            );
          })()}
        <div className={cn(showInlineRoutines && listChores.length > 0 ? "grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-2 items-start" : "space-y-6")}>
        {!now ? (
          <section
            aria-label={overviewText("title")}
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
            familyId={familyId}
            locale={displayLocale}
            collapseRepeats={filter !== "today"}
            onComplete={handleCompleteChore}
          />
        ) : listChores.length > 0 ? (
          <section>
            <p className="section-header">{overviewText(seriesMode ? "series" : filter === "today" ? "now" : filter === "week" ? "thisWeek" : "toDo")}</p>
            <div className="list-inset stagger">
              {filter === "today" ? (
                listChores.map(renderOpenChore)
              ) : (
                <RecurringChoreRows
                  chores={listChores}
                  now={now}
                  locale={displayLocale}
                  renderRow={renderOpenChore}
                />
              )}
            </div>
          </section>
        ) : showInlineRoutines ? null : (
          <EmptyState
            icon={CheckSquare}
            glyphColor="chore"
            motion={MOTION.tea}
            title={overviewText("empty")}
            description={
              overviewText(seriesMode ? "noSeries" : filter === "today" ? "emptyToday" : "emptyRange")
            }
          />
        )}
        {now && showInlineRoutines && <details key={filter} open={filter === "today"} className="min-w-0 rounded-[var(--radius-xl)] border border-[var(--surface-separator)]">
          <summary className="min-h-[44px] cursor-pointer px-4 py-3 text-headline text-label-primary">{overviewText("routinePanel")}</summary>
          <div className="p-3 pt-0">
            <RoutineStacks chores={routineRows} userRole={userRole} currentUserId={currentUserId} familyId={familyId}
              locale={displayLocale} collapseRepeats={filter !== "today"} showBuilder={false}
              onComplete={handleCompleteChore}
              renderOpenRow={id => { const chore = choreById.get(id); return chore ? renderOpenChore(chore, 0) : null; }} />
          </div>
        </details>}
        </div>

        {view === "chores" && doneChores.length > 0 && (
          <section>
            <button
              type="button"
              onClick={() => setDoneCollapsed(!doneCollapsed)}
              aria-expanded={!doneCollapsed}
              className="section-header w-full text-left flex items-center justify-between pr-4"
            >
              <span>{overviewText("done")}</span>
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
                    {overviewText("loadMoreFailed")} {loadMoreError}
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
                    ? overviewText("loading")
                    : loadMoreError
                      ? overviewText("tryAgain")
                      : overviewText("loadMore")}
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

      {deleteDialog && (
        <Dialog
          open
          role="alertdialog"
          onClose={deleteDialog.pending ? undefined : closeDeleteDialog}
          closeLabel={message("deleteOccurrenceCancel")}
          title={message("deleteOccurrenceConfirm")}
          description={message("deleteOccurrenceDescription")}
          initialFocusRef={deleteCancelRef}
          testId="chore-delete-dialog"
        >
          <div aria-busy={deleteDialog.pending || undefined}>
            {deleteDialog.error && (
              <p
                role="alert"
                className="mb-4 rounded-lg bg-[var(--danger-fill)] px-3 py-2 text-footnote text-[var(--danger-text)]"
              >
                {deleteDialog.error}
              </p>
            )}
            <div className="flex gap-3">
              <button
                ref={deleteCancelRef}
                type="button"
                onClick={closeDeleteDialog}
                disabled={deleteDialog.pending}
                className="flex-1 min-h-[44px] rounded-xl px-3 py-2.5 text-body font-medium text-label-secondary active:bg-[var(--surface-fill-secondary)] disabled:opacity-40"
              >
                {message("deleteOccurrenceCancel")}
              </button>
              <button
                ref={
                  deleteDialog.notFound ? deleteRefreshRef : deleteRetryRef
                }
                type="button"
                onClick={() =>
                  deleteDialog.notFound
                    ? void refreshAfterDeleteMiss(deleteDialog.choreId)
                    : void submitDelete(deleteDialog.choreId)
                }
                disabled={deleteDialog.pending}
                className="btn-destructive flex-1 min-h-[44px] px-3 py-2.5 text-body font-medium disabled:opacity-40"
              >
                {deleteDialog.pending
                  ? message("deleteOccurrencePending")
                  : deleteDialog.notFound
                    ? message("deleteOccurrenceRefresh")
                    : deleteDialog.error
                      ? message("deleteOccurrenceTryAgain")
                      : message("deleteOccurrenceButton")}
              </button>
            </div>
          </div>
        </Dialog>
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

function choresSubtitle(open: number, toCheck: number, text: ReturnType<typeof useChoreOverviewText>): string {
  const parts = [text("openCount", { count: open })];
  if (toCheck > 0) parts.push(text("checkCount", { count: toCheck }));
  return parts.join(" · ");
}
