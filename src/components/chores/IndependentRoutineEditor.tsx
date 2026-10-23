"use client";
import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { WeeklyDaysPicker } from "@/components/chores/WeeklyDaysPicker";
import { RoutineIconPicker } from "@/components/chores/RoutineIconPicker";
import { useRoutineScheduleText } from "@/i18n/routine-schedule";
import { useTranslation } from "@/i18n";
import {
  routineSubjectKey,
  type RoutineAssignmentOption,
} from "@/lib/routine-schedule-view";
import {
  independentDraftCommand,
  type IndependentEditorDraft,
} from "@/lib/routine-independent-draft-contract";
import {
  routineViewerDay,
  firstRoutineOccurrence,
} from "@/lib/routine-schedule";
import { parseDateOnly } from "@/lib/dates";
const input = "input-field w-full min-w-0 min-h-[44px]";
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-2 text-body text-label-primary">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function IndependentRoutineEditor({
  open,
  draft,
  assignments,
  pointsEnabled,
  locked,
  saving,
  error,
  onChange,
  onClose,
  onSave,
}: {
  open: boolean;
  draft: IndependentEditorDraft;
  assignments: RoutineAssignmentOption[];
  pointsEnabled: boolean;
  locked: boolean;
  saving: boolean;
  error: string | null;
  onChange: (draft: IndependentEditorDraft) => void;
  onClose: () => void;
  onSave: (review: { at: Date; zone: string }) => void;
}) {
  const t = useRoutineScheduleText(),
    { locale } = useTranslation(),
    id = React.useId();
  const [review, setReview] = React.useState<{ at: Date; zone: string } | null>(
      null,
    ),
    [invalid, setInvalid] = React.useState(false);
  const choices = assignments.filter(
    (option) => draft.schedule.frequency === "once" || option.canRepeat,
  );
  const member = choices.find(
    (option) =>
      draft.content.subject &&
      routineSubjectKey(option.subject) ===
        routineSubjectKey(draft.content.subject),
  );
  React.useEffect(() => {
    if (open)
      document.getElementById(`${id}-${review ? "review" : "title"}`)?.focus();
  }, [open, review, id]);
  function patch(content: Partial<IndependentEditorDraft["content"]>) {
    onChange({ ...draft, content: { ...draft.content, ...content } });
  }
  function next() {
    const at = new Date(),
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      independentDraftCommand(
        draft,
        { userId: "review-only", familyId: "review-only" },
        at,
        zone,
        routineViewerDay(zone, at),
      );
      if (!member) throw new Error("Member unavailable");
      setInvalid(false);
      setReview({ at, zone });
    } catch {
      setInvalid(true);
    }
  }
  function firstDay() {
    if (!review) return "";
    try {
      const today = routineViewerDay(review.zone, review.at),
        tomorrow = parseDateOnly(today)!;
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      return new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(
        parseDateOnly(
          firstRoutineOccurrence(
            draft.schedule,
            today,
            tomorrow.toISOString().slice(0, 10),
          ),
        )!,
      );
    } catch {
      return t("invalid");
    }
  }
  return (
    <Dialog
      open={open}
      variant="form"
      title={t("independentEdit")}
      description={t("scope")}
      onClose={saving ? undefined : onClose}
      closeLabel={t("close")}
      footer={
        <div className="flex flex-wrap justify-between gap-3">
          <button
            type="button"
            className="btn-ghost min-h-[44px]"
            disabled={saving}
            onClick={() => (review ? setReview(null) : onClose())}
          >
            {t(review ? "back" : "close")}
          </button>
          <button
            type="submit"
            form={id}
            className="btn-filled min-h-[44px]"
            disabled={locked}
          >
            {t(review ? "independentSave" : "review")}
          </button>
        </div>
      }
    >
      <form
        id={id}
        className="space-y-5 min-w-0"
        onSubmit={(event) => {
          event.preventDefault();
          if (review) onSave(review);
          else next();
        }}
      >
        {error && (
          <p role="alert" className="text-body text-label-primary">
            {error}
          </p>
        )}
        {invalid && (
          <p role="alert" className="text-body text-label-primary">
            {t("invalid")}
          </p>
        )}
        {draft.state === "paused" && (
          <p className="text-body text-label-secondary">{t("pausedEdit")}</p>
        )}
        {review ? (
          <div
            id={`${id}-review`}
            tabIndex={-1}
            className="space-y-3 text-body text-label-primary [overflow-wrap:anywhere]"
          >
            <h3 className="text-headline">{draft.content.title}</h3>
            <p>{member?.name ?? t("unavailable")}</p>
            <p>{t(draft.schedule.frequency)}</p>
            <p>{t("firstDay", { day: firstDay() })}</p>
            {draft.anchor && <p>{draft.anchor}</p>}
            {draft.content.description && (
              <p className="whitespace-pre-wrap">{draft.content.description}</p>
            )}
            <p>
              {t(draft.content.difficulty)}
              {draft.content.duration_minutes !== null
                ? ` · ${draft.content.duration_minutes} ${t("minutes")}`
                : ""}
            </p>
            {pointsEnabled && draft.content.points !== null && (
              <p>
                {t("points")}: {draft.content.points}
              </p>
            )}
            <p>{t("scope")}</p>
          </div>
        ) : (
          <fieldset disabled={locked} className="space-y-5 min-w-0">
            <Field label={t("titleField")}>
              <input
                id={`${id}-title`}
                value={draft.content.title}
                maxLength={200}
                onChange={(e) => patch({ title: e.target.value })}
                className={input}
              />
            </Field>
            <Field label={t("member")}>
              <select
                className={input}
                value={
                  draft.content.subject
                    ? routineSubjectKey(draft.content.subject)
                    : ""
                }
                onChange={(e) =>
                  patch({
                    subject:
                      choices.find(
                        (option) =>
                          routineSubjectKey(option.subject) === e.target.value,
                      )?.subject ?? null,
                  })
                }
              >
                <option value="">{t("choose")}</option>
                {draft.content.subject && !member && (
                  <option
                    value={routineSubjectKey(draft.content.subject)}
                    disabled
                  >
                    {t("unavailable")}
                  </option>
                )}
                {choices.map((option) => (
                  <option
                    key={routineSubjectKey(option.subject)}
                    value={routineSubjectKey(option.subject)}
                  >
                    {option.name} ·{" "}
                    {t(
                      option.subject.kind === "profile" ? "profile" : "account",
                    )}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("frequency")}>
              <select
                className={input}
                value={draft.schedule.frequency}
                onChange={(e) => {
                  const frequency = e.target
                    .value as IndependentEditorDraft["schedule"]["frequency"];
                  onChange({
                    ...draft,
                    schedule: {
                      ...draft.schedule,
                      frequency,
                      weekly_days:
                        frequency === "weekly" ? [new Date().getDay()] : [],
                      monthly_day:
                        frequency === "monthly" ? new Date().getDate() : null,
                    },
                  });
                }}
              >
                {(["once", "daily", "weekly", "monthly"] as const).map(
                  (frequency) => (
                    <option key={frequency} value={frequency}>
                      {t(frequency)}
                    </option>
                  ),
                )}
              </select>
            </Field>
            {draft.schedule.frequency === "weekly" && (
              <WeeklyDaysPicker
                days={draft.schedule.weekly_days}
                onChange={(weekly_days) =>
                  onChange({
                    ...draft,
                    schedule: { ...draft.schedule, weekly_days },
                  })
                }
              />
            )}
            {draft.schedule.frequency === "monthly" && (
              <Field label={t("monthDay")}>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={draft.schedule.monthly_day ?? ""}
                  className={input}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      schedule: {
                        ...draft.schedule,
                        monthly_day:
                          e.target.value === "" ? null : Number(e.target.value),
                      },
                    })
                  }
                />
              </Field>
            )}
            <Field label={t("start")}>
              <input
                type="date"
                className={input}
                value={draft.schedule.starts_on ?? ""}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    schedule: {
                      ...draft.schedule,
                      starts_on: e.target.value || null,
                    },
                  })
                }
              />
            </Field>
            <details className="rounded-xl border border-[var(--surface-separator)] p-3">
              <summary className="cursor-pointer min-h-[44px] text-body text-label-primary">
                {t("details")}
              </summary>
              <div className="space-y-4">
                <Field label={t("cue")}>
                  <input
                    maxLength={200}
                    className={input}
                    value={draft.anchor}
                    onChange={(e) =>
                      onChange({ ...draft, anchor: e.target.value })
                    }
                  />
                </Field>
                <p className="text-footnote text-label-secondary">
                  {t("cueHint")}
                </p>
                <Field label={t("description")}>
                  <textarea
                    rows={3}
                    maxLength={1000}
                    className={input}
                    value={draft.content.description ?? ""}
                    onChange={(e) =>
                      patch({ description: e.target.value || null })
                    }
                  />
                </Field>
                <Field label={t("duration")}>
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    className={input}
                    value={draft.content.duration_minutes ?? ""}
                    onChange={(e) =>
                      patch({
                        duration_minutes:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label={t("difficulty")}>
                  <select
                    className={input}
                    value={draft.content.difficulty}
                    onChange={(e) =>
                      patch({
                        difficulty: e.target
                          .value as IndependentEditorDraft["content"]["difficulty"],
                      })
                    }
                  >
                    {(["easy", "medium", "hard"] as const).map((difficulty) => (
                      <option key={difficulty} value={difficulty}>
                        {t(difficulty)}
                      </option>
                    ))}
                  </select>
                </Field>
                {pointsEnabled && (
                  <Field label={t("points")}>
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      className={input}
                      value={draft.content.points ?? ""}
                      onChange={(e) =>
                        patch({
                          points:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                    />
                  </Field>
                )}
                <RoutineIconPicker
                  value={draft.content.icon}
                  onChange={(icon) => patch({ icon })}
                  idPrefix={id}
                />
              </div>
            </details>
          </fieldset>
        )}
        <p className="text-footnote text-label-secondary">{t("draftKept")}</p>
      </form>
    </Dialog>
  );
}
