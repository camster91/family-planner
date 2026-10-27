"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import type { ChoreNotificationFocus as Focus } from "@/lib/chore-notification-focus";
import { useChoreOverviewText } from "@/i18n/chore-overview";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
import { formatDateOnly } from "@/lib/dates";
/** One read-only focused target, independent of current date/history pagination. */
export function ChoreNotificationFocus({ target, canEdit, completing = false, onComplete, onRefresh }: { target: Focus | null; canEdit: boolean; completing?: boolean; onComplete?: (id: string) => Promise<void>; onRefresh?: () => void }) {
  const text = useChoreOverviewText();
  const locale = useDisplayLocale();
  const card = useRef<HTMLElement>(null);
  useEffect(() => { card.current?.focus(); }, [target?.id]);
  const status = target ? {
    pending: "focusPending", in_progress: "focusInProgress", completed: "focusCompleted",
    verified: "focusVerified", approved: "focusVerified", overdue: "focusOverdue",
  }[target.status] as "focusPending" | "focusInProgress" | "focusCompleted" | "focusVerified" | "focusOverdue" : null;
  return <section ref={card} tabIndex={-1} aria-label={text("focusHeading")}
    className="rounded-[var(--radius-xl)] bg-[var(--surface-elevated)] border border-[var(--surface-separator)] p-4 space-y-3 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
    <p className="text-footnote text-label-secondary">{text("focusHeading")}</p>
    {target ? <>
      <h2 className="text-title-3 font-semibold [overflow-wrap:anywhere]">{target.title}</h2>
      <p className="text-footnote text-label-secondary">{text("focusDue", { date: formatDateOnly(target.dueDate, { month: "short", day: "numeric", year: "numeric" }, locale) })} · {status ? text(status) : ""}</p>
      {target.description && <details><summary className="min-h-[44px] flex items-center cursor-pointer text-subhead">{text("focusDetails")}</summary><p className="text-body whitespace-pre-wrap [overflow-wrap:anywhere]">{target.description}</p></details>}
    </> : <p role="status" className="text-body">{text("focusUnavailable")}</p>}
    <div className="flex flex-wrap gap-2">
      {onRefresh && <button type="button" className="btn-filled min-h-[44px]" onClick={onRefresh}>{text("focusRefresh")}</button>}
      {target?.canComplete && onComplete && <button type="button" className="btn-filled min-h-[44px]" disabled={completing} aria-busy={completing || undefined} onClick={() => void onComplete(target.id)}>{completing ? text("focusCompleting") : text("markComplete")}</button>}
      {target && canEdit && <Link href={`/dashboard/chores/edit?id=${target.id}`} className="btn-tinted min-h-[44px] inline-flex items-center">{text("edit")}</Link>}
      <Link href="/dashboard/chores" className="btn-plain min-h-[44px] inline-flex items-center">{text("focusAll")}</Link>
    </div>
  </section>;
}
