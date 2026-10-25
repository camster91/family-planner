"use client";
import * as React from "react";
import Link from "next/link";
import { useDraftAwareRouter } from "@/components/layout/owned-draft-navigation";
import { useProjectOverviewText } from "@/i18n/project-overview";
export function ProjectTaskPageNav({ projectId, loaded, total, nextCursor, paged, invalid }: {
  projectId: string; loaded: number; total: number; nextCursor: string | null; paged: boolean; invalid: boolean;
}) {
  const text = useProjectOverviewText();
  const router = useDraftAwareRouter();
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const first = `/dashboard/projects/${encodeURIComponent(projectId)}`;
  function navigate(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    if (busy) return;
    setBusy(true); setFailed(false);
    void router.push(href).catch(() => setFailed(true)).finally(() => setBusy(false));
  }
  return (
    <nav aria-label={text("taskPages")} className="mb-3 space-y-2" aria-busy={busy}>
      <p className="text-footnote text-label-secondary" role={invalid ? "alert" : undefined}>
        {invalid ? text("invalidTaskPage") : !loaded && total ? text("emptyTaskPage") : text("taskPageHint", { loaded, total })}
      </p>
      <div className="flex flex-wrap gap-2">
        {(paged || invalid) && <Link href={first} onClick={(event) => navigate(event, first)}
          aria-disabled={busy} className="btn-secondary min-h-[44px]">{text("firstTasks")}</Link>}
        {nextCursor && <Link href={`${first}?tasksCursor=${encodeURIComponent(nextCursor)}`}
          onClick={(event) => navigate(event, `${first}?tasksCursor=${encodeURIComponent(nextCursor)}`)}
          aria-disabled={busy} className="btn-secondary min-h-[44px]">{text("nextTasks")}</Link>}
      </div>
      {failed && <p role="alert">{text("taskPageNavigationError")}</p>}
    </nav>
  );
}
