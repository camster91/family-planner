import type { ReactNode } from "react";
import type { Chore } from "@/types";
import { groupChoreSeries, choreCadence } from "@/lib/chore-series-groups";
import { formatRelativeDueDate } from "@/lib/dates";

type Row = Chore & { assignee: { name: string } | null };

/** Disclosure has no mutation: actions always target an expanded occurrence. */
export function RecurringChoreRows<T extends Row>({
  chores,
  now,
  locale,
  renderRow,
}: {
  chores: T[];
  now: Date;
  locale: string;
  renderRow: (chore: T, index: number) => ReactNode;
}) {
  return (
    <>
      {groupChoreSeries(chores).map((group) => {
        if (!group.repeating || group.steps.length < 2)
          return renderRow(group.steps[0], 0);
        const next = group.steps[0];
        const takesTurns =
          new Set(group.steps.map((c) => c.assigned_to)).size > 1;
        return (
          <details
            key={group.key}
            className="border-b border-[var(--surface-separator)] last:border-b-0"
          >
            <summary className="min-h-[44px] px-4 py-3 cursor-pointer text-label-primary [overflow-wrap:anywhere] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
              <span className="text-body font-medium">{next.title}</span>
              <span className="block text-footnote text-label-secondary mt-1">
                {choreCadence(next)} ·{" "}
                {takesTurns
                  ? "Takes turns"
                  : (next.assignee?.name ?? "Unassigned")}
              </span>
              <span className="block text-footnote text-label-secondary">
                Next: {formatRelativeDueDate(next.due_date, now, locale)} ·{" "}
                {group.steps.length} open dates · Expand to see dates
              </span>
            </summary>
            <div className="border-t border-[var(--surface-separator)]">
              {group.steps.map(renderRow)}
            </div>
          </details>
        );
      })}
    </>
  );
}
