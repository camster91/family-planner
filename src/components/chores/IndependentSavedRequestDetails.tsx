"use client";
import { useTranslation } from "@/i18n";
import { useRoutineScheduleText } from "@/i18n/routine-schedule";
import { routineIndependentCommand } from "@/lib/routine-independent";
import type { IndependentRecoveryEntry } from "@/lib/routine-independent-recovery";
import {
  routineSubjectKey,
  type RoutineAssignmentOption,
} from "@/lib/routine-schedule-view";
import { formatWeeklyDays } from "@/lib/chore-weekdays";
export function IndependentSavedRequestDetails({
  entry,
  assignments,
  pointsEnabled,
}: {
  entry: IndependentRecoveryEntry;
  assignments: RoutineAssignmentOption[];
  pointsEnabled: boolean;
}) {
  const t = useRoutineScheduleText(),
    { locale } = useTranslation(),
    command = routineIndependentCommand.parse(JSON.parse(entry.body));
  const member =
    "content" in command
      ? assignments.find(
          (option) =>
            routineSubjectKey(option.subject) ===
            routineSubjectKey(command.content.subject),
        )
      : null;
  return (
    <details className="rounded-xl border border-[var(--surface-separator)] p-3 min-w-0">
      <summary className="min-h-[44px] cursor-pointer text-body text-label-primary">
        {t("originalDetails")}
      </summary>
      <div className="space-y-3 text-body text-label-secondary [overflow-wrap:anywhere]">
        <p>
          {t(command.action === "replace-future" ? "edit" : command.action)}
        </p>
        <p>
          {t("originalReviewed", {
            at: new Intl.DateTimeFormat(locale, {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: command.view_zone,
            }).format(new Date(command.issued_at)),
            zone: command.view_zone,
          })}
        </p>
        <p>{t("afterDay", { day: command.view_day })}</p>
        {"content" in command && (
          <>
            <h3 className="font-semibold text-label-primary">
              {command.content.title}
            </h3>
            <p>
              {member
                ? `${member.name} · ${t(command.content.subject.kind === "profile" ? "profile" : "account")}`
                : t("originalMemberUnavailable")}
            </p>
            <p>
              {t(command.schedule.frequency)}
              {command.schedule.frequency === "weekly"
                ? ` · ${formatWeeklyDays(command.schedule.weekly_days, locale)}`
                : command.schedule.frequency === "monthly"
                  ? ` · ${t("monthDay")}: ${command.schedule.monthly_day}`
                  : ""}
            </p>
            {command.schedule.starts_on && (
              <p>{t("originalStart", { day: command.schedule.starts_on })}</p>
            )}
            {command.anchor && <p>{command.anchor}</p>}
            {command.content.description && (
              <p className="whitespace-pre-wrap">
                {command.content.description}
              </p>
            )}
            <p>
              {t(command.content.difficulty)}
              {command.content.duration_minutes !== null
                ? ` · ${command.content.duration_minutes} ${t("minutes")}`
                : ""}
            </p>
            {pointsEnabled && command.content.points !== null && (
              <p>
                {t("points")}: {command.content.points}
              </p>
            )}
          </>
        )}
        <p>{t("originalExact")}</p>
      </div>
    </details>
  );
}
