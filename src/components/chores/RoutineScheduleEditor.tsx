"use client";
import * as React from "react";
import { useTranslation } from "@/i18n";
import { toDateOnlyLocal, parseDateOnly } from "@/lib/dates";
import { formatWeeklyDays } from "@/lib/chore-weekdays";
import {
  firstRoutineOccurrence,
  routineViewerDay,
} from "@/lib/routine-schedule";
import { Dialog } from "@/components/ui/dialog";
import { WeeklyDaysPicker } from "@/components/chores/WeeklyDaysPicker";
import { RoutineIconPicker } from "@/components/chores/RoutineIconPicker";
import { useRoutineScheduleText } from "@/i18n/routine-schedule";
import { ROUTINE_NAME_MAX } from "@/lib/routine-icons";
import {
  newRoutineStep,
  removeRoutineEditorStep,
  restoreRoutineEditorStep,
  type RoutineEditorDraft,
  type RoutineEditorStep,
} from "@/lib/routine-schedule-editor";
import {
  routineSubjectKey,
  type RoutineAssignmentOption,
} from "@/lib/routine-schedule-view";
import type { RoutineSharedSchedule } from "@/lib/routine-schedule";
const input = "input-field w-full min-w-0 min-h-[44px]";
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0 space-y-2 text-body text-label-primary">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function RoutineScheduleEditor({
  open,
  draft,
  assignments,
  pointsEnabled,
  locked,
  saving,
  error,
  onChange,
  onSave,
  onClose,
}: {
  open: boolean;
  draft: RoutineEditorDraft;
  assignments: RoutineAssignmentOption[];
  pointsEnabled: boolean;
  locked: boolean;
  saving: boolean;
  error: string | null;
  onChange: (draft: RoutineEditorDraft) => void;
  onSave: (review: { at: Date; zone: string }) => void;
  onClose: () => void;
}) {
  const t = useRoutineScheduleText(),
    { locale } = useTranslation();
  const [stage, setStage] = React.useState(0),
    [selected, setSelected] = React.useState(0),
    [localError, setLocalError] = React.useState(false);
  const reviewed = React.useRef<{ at: Date; zone: string } | null>(null);
  const formId = React.useId();
  React.useEffect(() => {
    if (!open) return;
    const selector =
      stage === 0
        ? "[data-routine-name]"
        : stage === 1
          ? "[data-routine-step-title]"
          : "[data-routine-review]";
    document
      .getElementById(formId)
      ?.querySelector<HTMLElement>(selector)
      ?.focus();
  }, [open, stage, formId]);
  function reviewFirstDay() {
    if (!reviewed.current) return "";
    try {
      const day = routineViewerDay(reviewed.current.zone, reviewed.current.at),
        floor = parseDateOnly(day)!;
      if (draft.stackId) floor.setUTCDate(floor.getUTCDate() + 1);
      const first = firstRoutineOccurrence(
        draft.schedule,
        day,
        floor.toISOString().slice(0, 10),
      );
      return new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(parseDateOnly(first)!);
    } catch {
      return t("invalid");
    }
  }

  const index = Math.min(selected, draft.steps.length - 1),
    step = draft.steps[index];
  const choices = assignments.filter(
    (option) => draft.schedule.frequency === "once" || option.canRepeat,
  );
  const assignmentName = (option: RoutineAssignmentOption) =>
    `${option.name} · ${t(option.subject.kind === "profile" ? "profile" : "account")} · ${t(option.role === "parent" ? "parent" : option.role === "teen" ? "teen" : option.role === "child" || option.role === "kid" ? "child" : "memberRole")}`;
  const subjectName = (subject: RoutineEditorStep["subject"]) => {
    const option = assignments.find(
      (option) =>
        subject &&
        routineSubjectKey(option.subject) === routineSubjectKey(subject),
    );
    return option ? assignmentName(option) : t("unavailable");
  };
  function updateStep(patch: Partial<RoutineEditorStep>) {
    onChange({
      ...draft,
      steps: draft.steps.map((row, position) =>
        position === index ? { ...row, ...patch } : row,
      ),
    });
  }
  function changeFrequency(frequency: RoutineSharedSchedule["frequency"]) {
    onChange({
      ...draft,
      schedule: {
        ...draft.schedule,
        frequency,
        weekly_days: frequency === "weekly" ? [new Date().getDay()] : [],
        monthly_day: frequency === "monthly" ? new Date().getDate() : null,
      },
    });
  }
  function next() {
    const valid =
      stage === 0
        ? draft.label.trim().length > 0 &&
          (draft.schedule.frequency !== "weekly" ||
            draft.schedule.weekly_days.length > 0)
        : draft.steps.every(
            (row) =>
              row.title.trim() &&
              (row.duration_minutes === null ||
                (Number.isInteger(row.duration_minutes) &&
                  row.duration_minutes >= 1 &&
                  row.duration_minutes <= 1440)) &&
              (row.points === null ||
                (Number.isInteger(row.points) &&
                  row.points >= 0 &&
                  row.points <= 1000)) &&
              row.subject &&
              choices.some(
                (option) =>
                  routineSubjectKey(option.subject) ===
                  routineSubjectKey(row.subject!),
              ),
          );
    setLocalError(!valid);
    if (valid) {
      if (stage === 1)
        reviewed.current = {
          at: new Date(),
          zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
      setStage(stage + 1);
    }
  }
  function move(offset: number) {
    const steps = [...draft.steps],
      target = index + offset;
    if (target < 0 || target >= steps.length) return;
    [steps[index], steps[target]] = [steps[target], steps[index]];
    onChange({ ...draft, steps });
    setSelected(target);
  }
  function remove(disposition?: "unstack-future" | "stop-future") {
    onChange(removeRoutineEditorStep(draft, index, disposition));
    setSelected(Math.max(0, index - 1));
  }
  return (
    <Dialog
      open={open}
      title={draft.stackId ? t("edit") : t("create")}
      variant="form"
      closeLabel={t("close")}
      onClose={saving ? undefined : onClose}
      description={t(draft.stackId ? "scope" : "newScope")}
      footer={
        <div className="flex flex-wrap justify-between gap-3">
          <button
            type="button"
            className="btn-ghost min-h-[44px]"
            disabled={saving}
            onClick={() => (stage ? setStage(stage - 1) : onClose())}
          >
            {t(stage ? "back" : "close")}
          </button>
          <button
            type="submit"
            form={formId}
            className="btn-filled min-h-[44px]"
            disabled={locked}
          >
            {t(stage < 2 ? "next" : "save")}
          </button>
        </div>
      }
    >
      <form
        id={formId}
        className="space-y-5 min-w-0"
        onSubmit={(event) => {
          event.preventDefault();
          if (stage < 2) next();
          else if (reviewed.current) onSave(reviewed.current);
        }}
      >
        <ol
          className="flex gap-3 text-footnote text-label-secondary"
          aria-label={t("review")}
        >
          {["basics", "steps", "review"].map((key, position) => (
            <li
              key={key}
              aria-current={position === stage ? "step" : undefined}
              className={
                position === stage ? "font-semibold text-label-primary" : ""
              }
            >
              {position + 1}. {t(key as "basics" | "steps" | "review")}
            </li>
          ))}
        </ol>
        {(error || localError) && (
          <p role="alert" className="text-body text-label-primary">
            {error ?? t("invalid")}
          </p>
        )}
        <fieldset disabled={locked} className="min-w-0 space-y-5">
          <legend className="sr-only">
            {t(stage === 0 ? "basics" : stage === 1 ? "steps" : "review")}
          </legend>
          {stage === 0 && (
            <>
              <Field label={t("name")}>
                <input
                  data-routine-name
                  className={input}
                  value={draft.label}
                  maxLength={ROUTINE_NAME_MAX}
                  required
                  onChange={(e) =>
                    onChange({ ...draft, label: e.target.value })
                  }
                />
              </Field>
              <Field label={t("cue")}>
                <input
                  className={input}
                  value={draft.anchor}
                  maxLength={200}
                  onChange={(e) =>
                    onChange({ ...draft, anchor: e.target.value })
                  }
                />
                <span className="block text-footnote text-label-secondary">
                  {t("cueHint")}
                </span>
              </Field>
              <Field label={t("frequency")}>
                <select
                  className={input}
                  value={draft.schedule.frequency}
                  onChange={(e) =>
                    changeFrequency(
                      e.target.value as RoutineSharedSchedule["frequency"],
                    )
                  }
                >
                  {(["once", "daily", "weekly", "monthly"] as const).map(
                    (value) => (
                      <option key={value} value={value}>
                        {t(value)}
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
                    className={input}
                    type="number"
                    min={1}
                    max={31}
                    required
                    value={draft.schedule.monthly_day ?? ""}
                    onChange={(e) =>
                      onChange({
                        ...draft,
                        schedule: {
                          ...draft.schedule,
                          monthly_day: Number(e.target.value),
                        },
                      })
                    }
                  />
                  <span className="block text-footnote text-label-secondary">
                    {t("monthHint")}
                  </span>
                </Field>
              )}
              <Field label={t("start")}>
                <input
                  className={input}
                  type="date"
                  min={draft.stackId ? undefined : toDateOnlyLocal(new Date())}
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
                <span className="block text-footnote text-label-secondary">
                  {t("startHint")}
                </span>
              </Field>
            </>
          )}
          {stage === 1 && (
            <>
              <ol
                aria-label={t("steps")}
                tabIndex={0}
                className="grid max-h-40 min-w-0 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2"
              >
                {draft.steps.map((row, position) => (
                  <li key={row.client_step_id}>
                    <button
                      type="button"
                      aria-pressed={position === index}
                      className="btn-ghost min-h-[44px] max-w-full [overflow-wrap:anywhere]"
                      onClick={() => setSelected(position)}
                    >
                      {position + 1}. {row.title || t("untitled")}
                    </button>
                  </li>
                ))}
              </ol>
              <h3 className="text-headline text-label-primary">
                {t("step", { number: index + 1 })}
              </h3>
              <Field label={t("titleField")}>
                <input
                  data-routine-step-title
                  className={input}
                  required
                  maxLength={200}
                  value={step.title}
                  onChange={(e) => updateStep({ title: e.target.value })}
                />
              </Field>
              <Field label={t("member")}>
                <select
                  className={input}
                  required
                  value={step.subject ? routineSubjectKey(step.subject) : ""}
                  onChange={(e) =>
                    updateStep({
                      subject:
                        choices.find(
                          (option) =>
                            routineSubjectKey(option.subject) ===
                            e.target.value,
                        )?.subject ?? null,
                    })
                  }
                >
                  <option value="">{t("choose")}</option>
                  {step.subject &&
                    !choices.some(
                      (option) =>
                        routineSubjectKey(option.subject) ===
                        routineSubjectKey(step.subject!),
                    ) && (
                      <option value={routineSubjectKey(step.subject)} disabled>
                        {t("unavailable")}
                      </option>
                    )}
                  {choices.map((option) => (
                    <option
                      key={routineSubjectKey(option.subject)}
                      value={routineSubjectKey(option.subject)}
                    >
                      {assignmentName(option)}
                    </option>
                  ))}
                </select>
              </Field>
              {choices.length < assignments.length && (
                <p className="text-footnote text-label-secondary">
                  {t("unavailableRepeat")}
                </p>
              )}
              {!choices.length && (
                <p role="status" className="text-footnote text-label-secondary">
                  {t("noMembers")}
                </p>
              )}
              <Field label={t("duration")}>
                <input
                  className={input}
                  type="number"
                  min={1}
                  max={1440}
                  value={step.duration_minutes ?? ""}
                  onChange={(e) =>
                    updateStep({
                      duration_minutes: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                />
              </Field>
              <details className="rounded-xl border border-[var(--surface-separator)] p-3">
                <summary className="min-h-[44px] cursor-pointer text-body text-label-primary">
                  {t("details")}
                </summary>
                <div className="space-y-4 pt-3">
                  <Field label={t("description")}>
                    <textarea
                      className={input}
                      value={step.description ?? ""}
                      maxLength={1000}
                      onChange={(e) =>
                        updateStep({ description: e.target.value || null })
                      }
                    />
                  </Field>
                  <Field label={t("difficulty")}>
                    <select
                      className={input}
                      value={step.difficulty}
                      onChange={(e) =>
                        updateStep({
                          difficulty: e.target
                            .value as RoutineEditorStep["difficulty"],
                        })
                      }
                    >
                      {(["easy", "medium", "hard"] as const).map((value) => (
                        <option key={value} value={value}>
                          {t(value)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {pointsEnabled && (
                    <Field label={t("points")}>
                      <input
                        className={input}
                        type="number"
                        min={0}
                        max={1000}
                        value={step.points ?? ""}
                        onChange={(e) =>
                          updateStep({
                            points: e.target.value
                              ? Number(e.target.value)
                              : null,
                          })
                        }
                      />
                    </Field>
                  )}
                  <RoutineIconPicker
                    value={step.icon}
                    onChange={(icon) => updateStep({ icon })}
                    idPrefix={`routine-${step.client_step_id}`}
                  />
                </div>
              </details>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-ghost min-h-[44px]"
                  aria-label={t("up", { title: step.title || t("untitled") })}
                  disabled={index === 0}
                  onClick={() => move(-1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn-ghost min-h-[44px]"
                  aria-label={t("down", { title: step.title || t("untitled") })}
                  disabled={index === draft.steps.length - 1}
                  onClick={() => move(1)}
                >
                  ↓
                </button>
                {!step.template_id ? (
                  <button
                    type="button"
                    className="btn-ghost min-h-[44px]"
                    disabled={draft.steps.length <= 1}
                    onClick={() => remove()}
                  >
                    {t("remove")}
                  </button>
                ) : (
                  <label className="min-w-0">
                    <span className="sr-only">{t("removeScope")}</span>
                    <select
                      className={input}
                      disabled={draft.steps.length <= 1}
                      value=""
                      onChange={(e) => {
                        if (e.target.value)
                          remove(
                            e.target.value as "unstack-future" | "stop-future",
                          );
                      }}
                    >
                      <option value="">{t("removeScope")}</option>
                      <option value="unstack-future">{t("unstack")}</option>
                      <option value="stop-future">{t("stopStep")}</option>
                    </select>
                  </label>
                )}
              </div>
              <button
                type="button"
                className="btn-ghost min-h-[44px]"
                disabled={draft.steps.length >= 99}
                onClick={() => {
                  onChange({
                    ...draft,
                    steps: [
                      ...draft.steps,
                      newRoutineStep(step.subject, pointsEnabled),
                    ],
                  });
                  setSelected(draft.steps.length);
                }}
              >
                {t("addStep")}
              </button>
            </>
          )}
          {stage === 2 && (
            <div className="space-y-4 text-body text-label-primary [overflow-wrap:anywhere]">
              <h3 data-routine-review tabIndex={-1} className="text-headline">
                {draft.label}
              </h3>
              <p>
                {t(draft.schedule.frequency)}
                {draft.schedule.frequency === "weekly"
                  ? ` · ${formatWeeklyDays(draft.schedule.weekly_days, locale)}`
                  : ""}
              </p>
              {draft.state === "paused" ? (
                <p>{t("pausedEdit")}</p>
              ) : (
                <p>{t("firstDay", { day: reviewFirstDay() })}</p>
              )}
              {draft.anchor && <p>{draft.anchor}</p>}
              <ol
                aria-label={t("review")}
                tabIndex={0}
                className="max-h-60 overflow-y-auto list-decimal space-y-3 pl-5"
              >
                {draft.steps.map((row) => (
                  <li key={row.client_step_id}>
                    <p>{row.title}</p>
                    <p className="text-footnote text-label-secondary">
                      {subjectName(row.subject)}
                      {row.duration_minutes
                        ? ` · ${row.duration_minutes} ${t("minutes")}`
                        : ""}
                    </p>
                  </li>
                ))}
              </ol>
              {draft.removed.length > 0 && (
                <section className="space-y-2">
                  <p>{t("removed", { count: draft.removed.length })}</p>
                  <ul>
                    {draft.removed.map((row) => (
                      <li key={row.template_id} className="space-y-1">
                        <p>
                          {row.step.title} ·{" "}
                          {t(
                            row.disposition === "unstack-future"
                              ? "unstack"
                              : "stopStep",
                          )}
                        </p>
                        <button
                          type="button"
                          className="btn-ghost min-h-[44px]"
                          onClick={() =>
                            onChange(
                              restoreRoutineEditorStep(draft, row.template_id),
                            )
                          }
                        >
                          {t("restore")}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <p className="text-footnote text-label-secondary">
                {t(draft.stackId ? "scope" : "newScope")}
              </p>
            </div>
          )}
        </fieldset>
        <p className="text-footnote text-label-secondary">{t("draftKept")}</p>
      </form>
    </Dialog>
  );
}
