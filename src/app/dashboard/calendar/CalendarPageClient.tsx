"use client";
import * as React from "react";
import { Sparkles, Undo2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { CaptureBox } from "@/components/capture/CaptureBox";
import {
  IMPORT_UNDO_WINDOW_MS,
  type ImportCommitResult,
} from "@/lib/event-import-client";
import { ImportEventsDialog } from "./ImportEventsDialog";
import { CalendarPlanner } from "./CalendarPlanner";
import type { PlanningView } from "@/lib/calendar-planning/view";
interface CalendarPageClientProps {
  events: unknown[];
  currentMonth: number;
  currentYear: number;
  initialDate?: string;
  initialView?: PlanningView;
  importEnabled?: boolean;
  canEditEvents?: boolean;
  monthFromUrl?: boolean;
}
/** Legacy month URLs remain valid; do not change this exported contract. */
export function calendarMonthHref(year: number, month: number): string {
  return `/dashboard/calendar?year=${year}&month=${month}`;
}
export default function CalendarPageClient({
  events,
  currentMonth,
  currentYear,
  initialDate,
  initialView,
  importEnabled = false,
  canEditEvents = false,
  monthFromUrl = true,
}: CalendarPageClientProps) {
  const router = useRouter();
  const [importOpen, setImportOpen] = React.useState(false);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [imported, setImported] = React.useState<{
    result: ImportCommitResult;
    at: number;
  } | null>(null);
  const refresh = () => {
    setRefreshKey((n) => n + 1);
    router.refresh();
  };
  const onImported = (result: ImportCommitResult) => {
    setImportOpen(false);
    setImported({ result, at: Date.now() });
    refresh();
  };
  return (
    <div className="pb-20">
      <CalendarPlanner
        initialDate={
          initialDate ||
          `${currentYear}-${String(currentMonth).padStart(2, "0")}-01`
        }
        initialView={initialView}
        chooseLocalToday={!monthFromUrl}
        canEditEvents={canEditEvents}
        refreshKey={`${refreshKey}:${JSON.stringify(events)}`}
      />
      <div className="px-4 my-5">
        <CaptureBox onSaved={refresh} />
      </div>
      {importEnabled && (
        <div className="px-4 mb-5">
          <button
            type="button"
            className="btn-tinted min-h-[44px]"
            onClick={() => setImportOpen(true)}
          >
            <Sparkles className="w-4 h-4" aria-hidden="true" />
            Import from text or photo
          </button>
        </div>
      )}
      {importOpen && (
        <ImportEventsDialog
          onClose={() => setImportOpen(false)}
          onDone={onImported}
        />
      )}
      {imported && (
        <ImportUndoToast
          key={imported.at}
          result={imported.result}
          addedAt={imported.at}
          onDismiss={() => setImported(null)}
          onUndone={refresh}
        />
      )}
    </div>
  );
}

export function SourceBadge({
  name,
  color,
}: {
  name: string;
  color: string | null;
}) {
  return (
    <span
      className="inline-flex max-w-[12rem] items-center gap-1.5 rounded-full bg-[var(--surface-fill)] px-2 py-0.5 text-caption-1 text-label-secondary"
      title={`Read-only. Imported from ${name}`}
    >
      <span
        aria-hidden="true"
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color ?? "var(--label-tertiary, #8e8e93)" }}
      />
      <span className="truncate">From {name}</span>
    </span>
  );
}

/**
 * "Added N events" with Undo (#270). Undo sends the import's signed undo token
 * (POST /api/calendar/import-suggestions/undo verifies it is this person's
 * import and at most 10 minutes old, then removes exactly those events), so it
 * is offered only while that window is open.
 */
export function ImportUndoToast({
  result,
  addedAt,
  onDismiss,
  onUndone,
}: {
  result: ImportCommitResult;
  /** When the page received the result; Undo closes at the earlier of this + 10 min and the server's expiry. */
  addedAt: number;
  onDismiss: () => void;
  onUndone: () => void;
}) {
  const [state, setState] = React.useState<
    | { kind: "added" }
    | { kind: "undoing" }
    | { kind: "undone"; count: number }
    | { kind: "error"; message: string }
  >({ kind: "added" });
  const closesAt = Math.min(
    addedAt + IMPORT_UNDO_WINDOW_MS,
    Date.parse(result.undoExpiresAt) || addedAt + IMPORT_UNDO_WINDOW_MS,
  );
  const [undoOpen, setUndoOpen] = React.useState(() => Date.now() < closesAt);

  React.useEffect(() => {
    const remaining = closesAt - Date.now();
    if (remaining <= 0) return;
    const t = setTimeout(() => setUndoOpen(false), remaining);
    return () => clearTimeout(t);
  }, [closesAt]);

  const undo = async () => {
    setState({ kind: "undoing" });
    try {
      const res = await fetch("/api/calendar/import-suggestions/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: result.undoToken }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok) {
        setState({
          kind: "undone",
          count: typeof body?.removedCount === "number" ? body.removedCount : 0,
        });
        setUndoOpen(false);
        onUndone();
        return;
      }
      if (res.status === 409 || res.status === 403) setUndoOpen(false);
      setState({
        kind: "error",
        message:
          typeof body?.error?.message === "string"
            ? body.error.message
            : "Could not undo. Try again.",
      });
    } catch {
      setState({
        kind: "error",
        message: "Could not undo. Check your connection and try again.",
      });
    }
  };

  const n = result.count;
  const title =
    state.kind === "undone"
      ? `Removed ${state.count} event${state.count === 1 ? "" : "s"}`
      : `Added ${n} event${n === 1 ? "" : "s"}`;

  return (
    <div
      className="fixed inset-x-4 bottom-24 z-40 mx-auto max-w-md sm:bottom-6"
      data-testid="import-toast"
    >
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 rounded-2xl border border-[var(--surface-separator)] bg-[var(--surface-elevated)] p-3 shadow-lg"
      >
        <div className="flex-1 min-w-0">
          <p className="text-subhead font-semibold text-label-primary break-words">
            {title}
          </p>
          {state.kind === "error" && (
            <p className="text-footnote text-[var(--danger-text)] break-words">
              {state.message}
            </p>
          )}
        </div>
        {undoOpen &&
          (state.kind === "added" ||
            state.kind === "undoing" ||
            state.kind === "error") && (
            <button
              type="button"
              onClick={undo}
              disabled={state.kind === "undoing"}
              className="min-h-[44px] min-w-[44px] px-3 inline-flex items-center gap-1 rounded-lg text-subhead font-semibold text-[var(--accent)] active:bg-[var(--surface-fill)]"
            >
              <Undo2 className="w-4 h-4" aria-hidden="true" />
              Undo
            </button>
          )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:bg-[var(--surface-fill)]"
        >
          <X className="w-4 h-4 text-label-tertiary" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
