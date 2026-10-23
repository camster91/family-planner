"use client";
import { useTranslation } from "@/i18n";
import { useRoutineScheduleText } from "@/i18n/routine-schedule";
import { formatWeeklyDays } from "@/lib/chore-weekdays";
import { parseDateOnly } from "@/lib/dates";
import { routineScheduleCommand } from "@/lib/routine-schedule";
import type { RoutineRecoveryEntry } from "@/lib/routine-schedule-recovery-contract";
import {
  routineSubjectKey,
  type RoutineAssignmentOption,
} from "@/lib/routine-schedule-view";

/** Read-only original intent. Never rebuild a request from current catalog data. */
export function RoutineSavedRequestDetails({
  entry,
  assignments,
  pointsEnabled,
}: {
  entry: RoutineRecoveryEntry;
  assignments: RoutineAssignmentOption[];
  pointsEnabled: boolean;
}) {
  const t = useRoutineScheduleText(),
    { locale } = useTranslation();
  const command = routineScheduleCommand.parse(JSON.parse(entry.body));
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  });
  const action = command.action === "replace-future" ? "edit" : command.action;
  return (
    <details className="rounded-xl border border-[var(--surface-separator)] p-3 min-w-0">
      <summary className="min-h-[44px] cursor-pointer text-body text-label-primary">
        {t("originalDetails")}
      </summary>
      <div className="space-y-3 text-body text-label-secondary [overflow-wrap:anywhere]">
        <p>{t(action)}</p>
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
        <p>
          {command.action === "create"
            ? t("newScope")
            : t("afterDay", {
                day: date.format(parseDateOnly(command.view_day)!),
              })}
        </p>
        {"schedule" in command && (
          <>
            <p>
              {t(command.schedule.frequency)}
              {command.schedule.frequency === "weekly"
                ? ` · ${formatWeeklyDays(command.schedule.weekly_days, locale)}`
                : command.schedule.frequency === "monthly"
                  ? ` · ${t("monthDay")}: ${command.schedule.monthly_day}`
                  : ""}
            </p>
            {command.schedule.starts_on && (
              <p>
                {t("originalStart", {
                  day: date.format(parseDateOnly(command.schedule.starts_on)!),
                })}
              </p>
            )}
            {command.anchor && (
              <p>
                {t("cue")}: {command.anchor}
              </p>
            )}
            <ol className="list-decimal space-y-3 pl-6">
              {command.steps.map((step) => {
                const member = assignments.find(
                  (option) =>
                    routineSubjectKey(option.subject) ===
                    routineSubjectKey(step.subject),
                );
                return (
                  <li key={step.client_step_id}>
                    <p className="font-semibold text-label-primary">
                      {step.title}
                    </p>
                    <p>
                      {member
                        ? `${member.name} · ${t(step.subject.kind === "profile" ? "profile" : "account")}`
                        : t("originalMemberUnavailable")}
                    </p>
                    {step.description && (
                      <p className="whitespace-pre-wrap">{step.description}</p>
                    )}
                    <p>
                      {t(step.difficulty)}
                      {step.duration_minutes !== null
                        ? ` · ${step.duration_minutes} ${t("minutes")}`
                        : ""}
                    </p>
                    {pointsEnabled && step.points !== null && (
                      <p>
                        {t("points")}: {step.points}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
            {command.action === "replace-future" &&
              command.removed_steps.length > 0 && (
                <>
                  <p>{t("removed", { count: command.removed_steps.length })}</p>
                  <ul className="list-disc pl-6">
                    {command.removed_steps.map((step) => (
                      <li key={step.template_id}>
                        {t(
                          step.disposition === "unstack-future"
                            ? "unstack"
                            : "stopStep",
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
          </>
        )}
        <p>{t("originalExact")}</p>
      </div>
    </details>
  );
}
