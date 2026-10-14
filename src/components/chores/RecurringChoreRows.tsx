import type { ReactNode } from "react";
import type { Chore } from "@/types";
import type {
  ChoreSubjectDTO,
  ProfileChoreActionAvailability,
} from "@/lib/chore-profile";
import { groupChoreSeries, choreCadence } from "@/lib/chore-series-groups";
import { formatRelativeDueDate } from "@/lib/dates";
import { profileSetupMessages } from "@/i18n/profile-setup";

type Row = Chore & {
  assignee: { name: string } | null;
  /** Safe display-only subject for an email-free household member. */
  subject?: ChoreSubjectDTO;
  /** Per-row compatibility state for profile-only actions. */
  actionAvailability?: ProfileChoreActionAvailability;
};

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
        const profileUnavailable =
          next.subject?.kind !== "profile" &&
          next.assigned_to === null &&
          (next.assigned_member_id != null ||
            next.member_subject_erased === true);
        const takesTurns =
          new Set(group.steps.map((c) => c.assigned_to)).size > 1;
        const profilePaused = group.steps.some(
          (c) => c.actionAvailability?.state === "paused",
        );
        return (
          <details
            key={group.key}
            className="border-b border-[var(--surface-separator)] last:border-b-0"
          >
            <summary className="min-h-[44px] px-4 py-3 cursor-pointer text-label-primary [overflow-wrap:anywhere] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
              <span className="text-body font-medium">{next.title}</span>
              <span className="block text-footnote text-label-secondary mt-1">
                {choreCadence(next)} ·{" "}
                {profileUnavailable
                  ? profileSetupMessages[locale.startsWith("es") ? "es" : "en"]
                      .profileTargetRefresh
                  : profilePaused
                    ? profileSetupMessages[
                        locale.startsWith("es") ? "es" : "en"
                      ].profileTargetRecurrencePaused
                    : takesTurns
                    ? "Takes turns"
                    : (next.subject?.name ??
                      next.assignee?.name ??
                      "Unassigned")}
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
