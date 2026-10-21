"use client";
import * as React from "react";
import {
  preparationDueDay,
  preparationDraftStep,
  type PreparationDraftStep,
  type PreparationCue,
} from "@/lib/event-preparation/contract";
import type { PreparationView } from "@/lib/event-preparation/view-contract";
import { usePreparationText } from "@/i18n/event-preparation";
import { prepInput, prepPlain } from "./PreparationPicker";
export default function PreparationStepEditor({
  value,
  view,
  personName,
  reused,
  onChange,
  onPerson,
  onDone,
  disabled,
}: {
  value: PreparationDraftStep;
  view: PreparationView;
  personName?: string;
  reused: boolean;
  onChange: (step: PreparationDraftStep) => void;
  onPerson: () => void;
  onDone: () => void;
  disabled: boolean;
}) {
  const copy = usePreparationText(),
    id = React.useId(),
    [invalid, setInvalid] = React.useState(false);
  const task =
    value.kind === "existing"
      ? view.tasks.find((task) => task.id === value.choreId)
      : null;
  const current = task?.available ? task : null;
  const dateEditable = value.kind === "new" || !!current?.dateEditable;
  const dueDay =
    value.kind === "new"
      ? value.dueDay
      : (value.retimeTo ?? current?.dueDay ?? "");
  function changeDay(day: string) {
    onChange(
      value.kind === "new"
        ? { ...value, dueDay: day }
        : { ...value, retimeTo: day },
    );
  }
  function cue(next: PreparationCue | null) {
    if (!next) {
      onChange({ ...value, cue: null });
      return;
    }
    try {
      const day = preparationDueDay(
        { ...view.event, familyId: view.owner.familyId },
        next,
        view.timeZone,
      );
      if (!dateEditable && day !== dueDay) {
        setInvalid(true);
        return;
      }
      onChange(
        value.kind === "new"
          ? { ...value, cue: next, dueDay: day }
          : {
              ...value,
              cue: next,
              retimeTo: day === current?.dueDay ? null : day,
            },
      );
      setInvalid(false);
    } catch {
      setInvalid(true);
    }
  }
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!preparationDraftStep.safeParse(value).success) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        onDone();
      }}
    >
      {value.kind === "new" ? (
        <>
          <label className="block" htmlFor={`${id}-title`}>
            {copy.titleLabel}
            <input
              id={`${id}-title`}
              className={prepInput}
              value={value.title}
              readOnly={reused}
              disabled={disabled}
              maxLength={200}
              required
              onChange={(event) =>
                onChange({ ...value, title: event.target.value })
              }
            />
          </label>
          <div>
            <span className="block">{copy.assignee}</span>
            <button
              type="button"
              className={`${prepPlain} w-full text-left`}
              disabled={disabled}
              onClick={onPerson}
            >
              {personName ?? copy.selectPerson}
            </button>
          </div>
        </>
      ) : (
        <p className="break-words font-semibold">
          {current?.title ?? copy.unavailable}
        </p>
      )}
      <label className="block" htmlFor={`${id}-day`}>
        {copy.day}
        <input
          id={`${id}-day`}
          className={prepInput}
          type="date"
          value={dueDay}
          required
          disabled={disabled || !dateEditable || !!value.cue}
          onChange={(event) => changeDay(event.target.value)}
        />
      </label>
      {!dateEditable && <p className="text-footnote">{copy.locked}</p>}
      <details>
        <summary className="min-h-11 cursor-pointer py-3">{copy.cue}</summary>
        <div className="space-y-3">
          <label className="block" htmlFor={`${id}-anchor`}>
            {copy.cue}
            <select
              id={`${id}-anchor`}
              className={prepInput}
              disabled={disabled}
              value={value.cue?.anchor ?? "fixed"}
              onChange={(event) =>
                cue(
                  event.target.value === "fixed"
                    ? null
                    : {
                        anchor: event.target.value as "start" | "end",
                        direction: value.cue?.direction ?? "before",
                        minutes: value.cue?.minutes ?? 0,
                      },
                )
              }
            >
              <option
                className="bg-[var(--surface-background)] text-label-primary"
                value="fixed"
              >
                {copy.fixed}
              </option>
              <option
                className="bg-[var(--surface-background)] text-label-primary"
                value="start"
                disabled={!dateEditable}
              >
                {copy.start}
              </option>
              <option
                className="bg-[var(--surface-background)] text-label-primary"
                value="end"
                disabled={!dateEditable}
              >
                {copy.end}
              </option>
            </select>
          </label>
          {value.cue && (
            <div className="grid grid-cols-2 gap-3">
              <label htmlFor={`${id}-direction`}>
                {copy.cue}
                <select
                  id={`${id}-direction`}
                  className={prepInput}
                  value={value.cue.direction}
                  disabled={disabled || !dateEditable}
                  onChange={(event) =>
                    cue({
                      ...value.cue!,
                      direction: event.target.value as "before" | "after",
                    })
                  }
                >
                  <option
                    className="bg-[var(--surface-background)] text-label-primary"
                    value="before"
                  >
                    {copy.before}
                  </option>
                  <option
                    className="bg-[var(--surface-background)] text-label-primary"
                    value="after"
                  >
                    {copy.after}
                  </option>
                </select>
              </label>
              <label htmlFor={`${id}-minutes`}>
                {copy.minutes}
                <input
                  id={`${id}-minutes`}
                  className={prepInput}
                  type="number"
                  min={0}
                  max={525600}
                  value={value.cue.minutes}
                  disabled={disabled || !dateEditable}
                  onChange={(event) =>
                    cue({ ...value.cue!, minutes: Number(event.target.value) })
                  }
                />
              </label>
            </div>
          )}
          <p className="text-footnote">{copy.cueHint}</p>
        </div>
      </details>
      {value.kind === "new" && !reused && (
        <details>
          <summary className="min-h-11 cursor-pointer py-3">
            {copy.advanced}
          </summary>
          <div className="space-y-3">
            <label className="block" htmlFor={`${id}-description`}>
              {copy.description}
              <textarea
                id={`${id}-description`}
                className={prepInput}
                maxLength={1000}
                value={value.description ?? ""}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...value,
                    description: event.target.value || null,
                  })
                }
              />
            </label>
            <label className="block" htmlFor={`${id}-duration`}>
              {copy.duration}
              <input
                id={`${id}-duration`}
                className={prepInput}
                type="number"
                min={1}
                max={1440}
                value={value.durationMinutes ?? ""}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...value,
                    durationMinutes:
                      event.target.value === ""
                        ? null
                        : Number(event.target.value),
                  })
                }
              />
            </label>
            <fieldset>
              <legend>{copy.difficulty}</legend>
              <div className="flex flex-wrap gap-2">
                {(["easy", "medium", "hard"] as const).map((level) => (
                  <button
                    key={level}
                    className={prepPlain}
                    type="button"
                    aria-pressed={value.difficulty === level}
                    disabled={disabled}
                    onClick={() => onChange({ ...value, difficulty: level })}
                  >
                    {copy[level]}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        </details>
      )}
      {value.kind === "new" && view.pointsEnabled && (
        <label className="block" htmlFor={`${id}-points`}>
          {copy.points}
          <input
            id={`${id}-points`}
            className={prepInput}
            type="number"
            min={0}
            max={1000}
            disabled={disabled}
            value={value.points ?? ""}
            onChange={(event) =>
              onChange({
                ...value,
                points:
                  event.target.value === "" ? null : Number(event.target.value),
              })
            }
          />
        </label>
      )}
      {invalid && <p role="alert">{copy.invalid}</p>}
      <button className={prepPlain} disabled={disabled}>
        {copy.done}
      </button>
    </form>
  );
}
