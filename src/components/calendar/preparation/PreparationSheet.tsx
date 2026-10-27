"use client";
import * as React from "react";
import Link from "next/link";
import { Dialog } from "@/components/ui/dialog";
import { useDraftAwareRouter } from "@/components/layout/owned-draft-navigation";
import { usePreparationText } from "@/i18n/event-preparation";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
import { formatScheduleInstant } from "@/lib/calendar-planning/schedule-form";
import { dayKeyFor } from "@/lib/local-day-key";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import {
  EVENT_PREPARATION_PROTOCOL,
  preparationDueDay,
  type PreparationCommand,
  type PreparationDraftStep,
} from "@/lib/event-preparation/contract";
import { scopeForPreparationCommand } from "@/lib/event-preparation/read-contract";
import type {
  PreparationView,
  PreparationReadReply,
} from "@/lib/event-preparation/view-contract";
import type { PreparationPickerReply } from "@/lib/event-preparation/picker-contract";
import type { PreparationLocation } from "./PreparationProvider";
import { usePreparationSession } from "./usePreparationSession";
import PreparationPicker, { prepInput, prepPlain } from "./PreparationPicker";
import PreparationStepEditor from "./PreparationStepEditor";
import PreparationPending from "./PreparationPending";
type Reuse = Extract<PreparationCommand, { action: "reuse-routine" }>;
type RoutineDraft = Pick<
  Reuse,
  "stackId" | "sourceToken" | "occurrenceDay" | "steps"
>;
type Editor = {
  mode: "set" | "reuse";
  index: number;
  value: PreparationDraftStep;
};
const PAGE = 5;
export default function PreparationSheet({
  location,
  onClose,
  onOpen,
}: {
  location: PreparationLocation;
  onClose: () => void;
  onOpen: (location: PreparationLocation) => void;
}) {
  const copy = usePreparationText(),
    locale = useDisplayLocale(),
    router = useDraftAwareRouter(),
    heading = React.useRef<HTMLHeadingElement>(null),
    id = React.useId();
  const initial = React.useMemo(
    () => ({
      ...location,
      memberProtocol: 2 as const,
      choreIds: [],
      subjects: [],
      routine: null,
    }),
    [location.eventId, location.timeZone],
  );
  const session = usePreparationSession(initial),
    view = session.reply?.view;
  const [screen, setScreen] = React.useState<
    | "overview"
    | "task"
    | "routine"
    | "routine-steps"
    | "person"
    | "edit"
    | "review"
  >("overview");
  const [steps, setSteps] = React.useState<PreparationDraftStep[]>([]),
    [editor, setEditor] = React.useState<Editor | null>(null),
    [peopleKind, setPeopleKind] = React.useState<"accounts" | "profiles">(
      "accounts",
    );
  const [noRoutine, setNoRoutine] = React.useState(false);
  const [routineLabel, setRoutineLabel] = React.useState("");
  const [removedPage, setRemovedPage] = React.useState(0);
  const [routineId, setRoutineId] = React.useState<string | null>(null),
    [routineDay, setRoutineDay] = React.useState(""),
    [routine, setRoutine] = React.useState<RoutineDraft | null>(null),
    [selected, setSelected] = React.useState<string[]>([]);
  const [decision, setDecision] =
      React.useState<PreparationCommand["eventChangeDecision"]>(null),
    [page, setPage] = React.useState(0),
    [invalid, setInvalid] = React.useState(false),
    [result, setResult] = React.useState<{
      reply: PreparationReadReply;
      command: PreparationCommand;
    } | null>(null);
  const [names, setNames] = React.useState<Record<string, string>>({}),
    initialized = React.useRef(false),
    baseline = React.useRef("");
  const subjectKey = (
    subject: Extract<PreparationDraftStep, { kind: "new" }>["subject"],
  ) =>
    subject.kind === "account"
      ? `account:${subject.accountId}`
      : `profile:${subject.memberId}`;
  const dirty =
    initialized.current && JSON.stringify(steps) !== baseline.current;
  const changedEvent =
    !!view?.plan &&
    view.plan.reviewedEventSourceToken !== view.event.sourceToken;
  const blocked =
    session.busy ||
    session.storageError ||
    !!session.entries.length ||
    session.ownerHeld ||
    !session.context?.enabled ||
    (!!view && !view.event.active);
  React.useEffect(() => {
    heading.current?.focus();
    setPage(0);
    setRemovedPage(0);
    setInvalid(false);
  }, [screen]);
  const rowCount =
    screen === "routine-steps"
      ? (routine?.steps.length ?? 0)
      : screen === "review"
        ? (result?.reply.effects?.ordered.length ?? 0)
        : steps.length;
  React.useEffect(() => {
    setPage((current) =>
      Math.min(current, Math.max(0, Math.ceil(rowCount / PAGE) - 1)),
    );
  }, [rowCount]);
  React.useEffect(() => {
    setDecision(null);
    setResult(null);
  }, [view?.event.sourceToken]);
  React.useEffect(() => {
    if (!view || (initialized.current && session.notice !== "proof")) return;
    const rows: PreparationDraftStep[] = (view.plan?.links ?? []).map(
      (link) => {
        const task = view.tasks.find((task) => task.id === link.choreId);
        return {
          kind: "existing",
          choreId: link.choreId,
          sourceToken: task?.available ? task.sourceToken : "0".repeat(64),
          cue: link.cue,
          retimeTo: null,
        };
      },
    );
    initialized.current = true;
    baseline.current = JSON.stringify(rows);
    setSteps(rows);
    setRoutine(null);
    setResult(null);
    setEditor(null);
    setScreen("overview");
  }, [view?.expectedToken, session.notice]);
  React.useEffect(() => {
    if (!view) return;
    setNames((previous) => ({
      ...previous,
      ...Object.fromEntries(
        view.subjects.map((row) => [subjectKey(row.subject), row.name]),
      ),
    }));
  }, [view?.expectedToken]);
  React.useEffect(() => {
    if (!session.ownerHeld) return;
    setSteps([]);
    setNames({});
    setRoutine(null);
    setEditor(null);
    setResult(null);
    initialized.current = false;
    baseline.current = "";
  }, [session.ownerHeld]);
  function personName(
    subject: Extract<PreparationDraftStep, { kind: "new" }>["subject"],
  ) {
    return subject.kind === "profile" && !view?.profileWritesEnabled
      ? copy.unavailable
      : names[subjectKey(subject)];
  }
  function command(
    current: PreparationView,
    intended = steps,
    copyRoutine = routine,
  ): PreparationCommand {
    const base = {
      protocol: EVENT_PREPARATION_PROTOCOL,
      owner: current.owner,
      memberProtocol: current.memberProtocol,
      eventId: current.event.id,
      eventSourceToken: current.event.sourceToken,
      expectedToken: current.expectedToken,
      timeZone: current.timeZone,
      issuedAt: current.evaluatedAt,
      eventChangeDecision: decision,
    };
    return copyRoutine
      ? {
          ...base,
          action: "reuse-routine",
          ...copyRoutine,
          steps: copyRoutine.steps.filter((step) =>
            selected.includes(step.sourceId),
          ),
        }
      : { ...base, action: "set-plan", steps: intended };
  }
  function taskTitle(step: PreparationDraftStep, current = view) {
    if (step.kind === "new") return step.title || copy.newStep;
    const task = current?.tasks.find((task) => task.id === step.choreId);
    return task?.available ? task.title : copy.unavailable;
  }
  function defaultDay(current: PreparationView) {
    return dayKeyFor({ kind: "tz", timeZone: current.timeZone })(
      new Date(current.event.start),
    );
  }
  function routineHref(stackId: string, occurrenceDay: string) {
    return `/dashboard/chores/routines?${new URLSearchParams({
      stack_id: stackId,
      occurrence_date: occurrenceDay,
    })}`;
  }
  function navigateAway(
    href: string,
    event: React.MouseEvent<HTMLAnchorElement>,
  ) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    void router.push(href).then((navigated) => {
      if (navigated) session.stop();
    });
  }
  function newStep() {
    if (!view || !session.context || blocked || steps.length >= 99) return;
    const value: PreparationDraftStep = {
      kind: "new",
      clientId: newIdempotencyKey(),
      title: "",
      description: null,
      subject: { kind: "account", accountId: session.context.userId },
      points: null,
      dueDay: defaultDay(view),
      cue: null,
      difficulty: "medium",
      icon: null,
      durationMinutes: null,
    };
    setEditor({ mode: "set", index: steps.length, value });
    setScreen("edit");
  }
  function pick(item: PreparationPickerReply["items"][number]) {
    if (!view || blocked) return;
    if (item.kind === "person" && editor?.value.kind === "new") {
      setNames((value) => ({
        ...value,
        [subjectKey(item.subject)]: item.name,
      }));
      setEditor({
        ...editor,
        value: { ...editor.value, subject: item.subject },
      });
      setScreen("edit");
    } else if (item.kind === "routine") {
      setRoutineId(item.id);
      setRoutineLabel(item.label);
      setRoutineDay(defaultDay(view));
    } else if (item.kind === "task") {
      if (
        steps.some(
          (step) => step.kind === "existing" && step.choreId === item.id,
        ) ||
        steps.length >= 99
      )
        return;
      void session.run(async (version) => {
        const target = [
          ...steps,
          {
            kind: "existing" as const,
            choreId: item.id,
            sourceToken: "0".repeat(64),
            cue: null,
            retimeTo: null,
          },
        ];
        const fresh = await session.load(
          scopeForPreparationCommand(command(view, target, null)),
          version,
        );
        if (!fresh || !session.current(version)) return;
        const task = fresh.view.tasks.find((task) => task.id === item.id);
        if (!task?.available) throw new Error("Task unavailable");
        setSteps([
          ...steps,
          {
            kind: "existing",
            choreId: item.id,
            sourceToken: task.sourceToken,
            cue: null,
            retimeTo: null,
          },
        ]);
        setScreen("overview");
      });
    }
  }
  function doneEdit() {
    if (!editor) return;
    if (editor.mode === "reuse" && routine && editor.value.kind === "new") {
      const value = editor.value;
      setRoutine({
        ...routine,
        steps: routine.steps.map((step, index) =>
          index === editor.index
            ? {
                ...step,
                subject: value.subject,
                points: value.points,
                dueDay: value.dueDay,
                cue: value.cue,
              }
            : step,
        ),
      });
      setScreen("routine-steps");
    } else {
      const next = [...steps];
      next[editor.index] = editor.value;
      setSteps(next);
      setScreen("overview");
    }
    setEditor(null);
    setResult(null);
  }
  function loadRoutine() {
    if (!view || !routineId || !routineDay) return;
    setNoRoutine(false);
    void session.run(async (version) => {
      const scope = {
        ...scopeForPreparationCommand(command(view, steps, null)),
        routine: { stackId: routineId, occurrenceDay: routineDay },
      };
      const fresh = await session.load(scope, version);
      if (!fresh || !session.current(version)) return;
      const source = fresh.view.routine;
      if (!source || !source.complete) {
        setNoRoutine(true);
        return;
      }
      const copied = source.steps.flatMap((step) =>
        step.available
          ? [
              {
                sourceId: step.id,
                sourceToken: step.sourceToken,
                clientId: newIdempotencyKey(),
                subject: step.content.subject,
                points: null,
                dueDay: defaultDay(fresh.view),
                cue: null,
              },
            ]
          : [],
      );
      setRoutine({
        stackId: source.id,
        sourceToken: source.sourceToken,
        occurrenceDay: source.occurrenceDay,
        steps: copied,
      });
      setSelected(copied.map((step) => step.sourceId));
      setScreen("routine-steps");
    });
  }
  function review() {
    if (!view || blocked) return;
    setResult(null);
    void session.run(async (version) => {
      const fresh = await session.load(
        scopeForPreparationCommand(command(view)),
        version,
      );
      if (!fresh || !session.current(version)) return;
      if (fresh.view.event.sourceToken !== view.event.sourceToken)
        throw new Error("Event changed");
      const proposed = command(fresh.view),
        preview = await session.preview(proposed, version);
      if (preview && session.current(version)) {
        setResult({ reply: preview, command: proposed });
        setScreen("review");
      }
    });
  }
  function move(index: number, direction: -1 | 1) {
    const next = [...steps],
      target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setSteps(next);
    setResult(null);
  }
  function close() {
    session.stop();
    onClose();
  }
  const footer = (
    <div className="flex flex-wrap justify-between gap-2">
      <button
        type="button"
        className={prepPlain}
        onClick={() => {
          if (screen === "overview") close();
          else {
            if (screen === "review") setResult(null);
            if (screen === "person") setScreen("edit");
            else if (screen === "edit" && editor?.mode === "reuse")
              setScreen("routine-steps");
            else setScreen("overview");
          }
        }}
      >
        {screen === "overview" ? copy.close : copy.back}
      </button>
      {screen === "overview" && view && (
        <button
          type="button"
          className={prepPlain}
          disabled={blocked || !view || !initialized.current}
          onClick={review}
        >
          {copy.preview}
        </button>
      )}
      {screen === "routine-steps" && (
        <button
          type="button"
          className={prepPlain}
          disabled={
            blocked ||
            !selected.length ||
            selected.length + (view?.plan?.links.length ?? 0) > 99
          }
          onClick={review}
        >
          {copy.preview}
        </button>
      )}
      {screen === "review" && result && (
        <button
          type="button"
          className={prepPlain}
          disabled={
            blocked ||
            !session.fresh ||
            session.reply?.view.expectedToken !==
              result.reply.view.expectedToken
          }
          onClick={() => session.commit(result.reply, result.command)}
        >
          {copy.save}
        </button>
      )}
    </div>
  );
  if (session.ownerHeld)
    return (
      <Dialog
        open
        title={copy.title}
        onClose={close}
        closeLabel={copy.close}
        variant="form"
      >
        <p role="alert">{copy.ownerChanged}</p>
      </Dialog>
    );
  const summary = session.fresh ? view?.progress.state : "unknown";
  const summaryText =
    summary === "checked"
      ? copy.allDone
      : summary === "marked-done"
        ? copy.waiting
        : summary === "open"
          ? copy.openState
          : summary === "needs-review"
            ? copy.needsReview
            : summary === "not-configured"
              ? copy.notConfigured
              : copy.unknownState;
  return (
    <Dialog
      open
      title={copy.title}
      description={copy.intro}
      variant="form"
      closeLabel={copy.close}
      onClose={close}
      footer={footer}
      initialFocusRef={heading}
    >
      <div className="space-y-4">
        <h2
          ref={heading}
          tabIndex={-1}
          className="break-words text-title-3 font-semibold"
        >
          {view?.event.title ?? copy.title}
        </h2>
        {view && (
          <p className="text-footnote text-label-secondary">
            {formatScheduleInstant(view.event.start, locale, view.timeZone)}
            <br />
            {copy.zone}: {view.timeZone}
          </p>
        )}
        {session.busy && <p role="status">{copy.loading}</p>}
        {session.notice && <p role="status">{copy[session.notice]}</p>}
        {session.error && <p role="alert">{copy.error}</p>}
        {session.storageError && (
          <div role="alert">
            <p>{copy.storage}</p>
            <button
              type="button"
              className={prepPlain}
              disabled={session.busy || session.ownerHeld}
              onClick={session.repair}
            >
              {copy.repair}
            </button>
          </div>
        )}
        {session.context && !session.context.enabled && <p>{copy.paused}</p>}
        {view && !view.event.active && (
          <p role="status">{copy.unsupportedEvent}</p>
        )}
        <PreparationPending
          session={session}
          location={location}
          onOpen={onOpen}
        />
        {invalid && <p role="alert">{copy.invalid}</p>}
        {noRoutine && screen === "routine" && (
          <p role="status">{copy.noRoutine}</p>
        )}
        {screen === "overview" && view && (
          <>
            <p role="status">{summaryText}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={prepPlain}
                disabled={blocked || !view || steps.length >= 99 || !!routine}
                onClick={newStep}
              >
                {copy.add}
              </button>
              <button
                type="button"
                className={prepPlain}
                disabled={blocked || !view || steps.length >= 99 || !!routine}
                onClick={() => setScreen("task")}
              >
                {copy.existing}
              </button>
              <button
                type="button"
                className={prepPlain}
                disabled={blocked || !view || dirty || changedEvent}
                onClick={() => {
                  setRoutine(null);
                  setRoutineId(null);
                  setScreen("routine");
                }}
              >
                {copy.routine}
              </button>
              <button
                type="button"
                className={prepPlain}
                disabled={session.busy || session.ownerHeld}
                onClick={session.reload}
              >
                {copy.reload}
              </button>
            </div>
            {(dirty || routine) && (
              <p className="text-footnote">{copy.routinePending}</p>
            )}
            {routine && (
              <div className="flex gap-2">
                <button
                  type="button"
                  className={prepPlain}
                  disabled={blocked}
                  onClick={() => setScreen("routine-steps")}
                >
                  {copy.selectSteps}
                </button>
                <button
                  type="button"
                  className={prepPlain}
                  disabled={blocked}
                  onClick={() => {
                    setRoutine(null);
                    setSelected([]);
                    setResult(null);
                  }}
                >
                  {copy.cancel}
                </button>
              </div>
            )}
            {changedEvent && (
              <section className="space-y-2">
                <p>{copy.eventDecision}</p>
                <button
                  type="button"
                  className={prepPlain}
                  disabled={blocked}
                  aria-pressed={decision === "keep-dates"}
                  onClick={() => {
                    setDecision("keep-dates");
                    setSteps((current) =>
                      current.map((step) => {
                        const task =
                          step.kind === "existing"
                            ? view.tasks.find((row) => row.id === step.choreId)
                            : null;
                        const due =
                          step.kind === "new"
                            ? step.dueDay
                            : task?.available
                              ? task.dueDay
                              : null;
                        let cue = step.cue;
                        if (cue) {
                          try {
                            if (
                              preparationDueDay(
                                {
                                  ...view.event,
                                  familyId: view.owner.familyId,
                                },
                                cue,
                                view.timeZone,
                              ) !== due
                            )
                              cue = null;
                          } catch {
                            cue = null;
                          }
                        }
                        return step.kind === "existing"
                          ? { ...step, cue, retimeTo: null }
                          : { ...step, cue };
                      }),
                    );
                  }}
                >
                  {copy.keep}
                </button>
                <button
                  type="button"
                  className={prepPlain}
                  disabled={blocked}
                  aria-pressed={decision === "retime-selected"}
                  onClick={() => setDecision("retime-selected")}
                >
                  {copy.retime}
                </button>
              </section>
            )}
            <h3>{copy.steps}</h3>
            {!steps.length && <p>{copy.noSteps}</p>}
            <ol className="space-y-3">
              {steps
                .slice(page * PAGE, (page + 1) * PAGE)
                .map((step, offset) => {
                  const index = page * PAGE + offset,
                    task =
                      step.kind === "existing"
                        ? view?.tasks.find((task) => task.id === step.choreId)
                        : null;
                  const stale =
                    step.kind === "existing" &&
                    task?.available &&
                    step.sourceToken !== task.sourceToken;
                  return (
                    <li
                      key={step.kind === "new" ? step.clientId : step.choreId}
                      className="rounded-xl border border-[var(--surface-separator)] p-3"
                    >
                      <p className="break-words font-semibold">
                        {taskTitle(step)}
                      </p>
                      <p className="text-footnote">
                        {step.kind === "new"
                          ? `${copy.newStep} · ${step.dueDay}`
                          : task?.available
                            ? `${task.subjectName} · ${step.retimeTo ?? task.dueDay} · ${task.status === "verified" ? copy.checked : task.status === "completed" ? copy.waiting : copy.openState}`
                            : copy.unavailable}
                      </p>
                      {stale && <p>{copy.sourceRefresh}</p>}
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          className={prepPlain}
                          disabled={
                            blocked ||
                            (step.kind === "existing" && !task?.available)
                          }
                          onClick={() => {
                            setEditor({ mode: "set", index, value: step });
                            setScreen("edit");
                          }}
                        >
                          {copy.edit}
                        </button>
                        {stale && (
                          <button
                            type="button"
                            className={prepPlain}
                            disabled={blocked}
                            onClick={() => {
                              if (task?.available && step.kind === "existing")
                                setSteps((current) =>
                                  current.map((row, i) =>
                                    i === index
                                      ? {
                                          ...step,
                                          sourceToken: task.sourceToken,
                                          retimeTo: null,
                                        }
                                      : row,
                                  ),
                                );
                            }}
                          >
                            {copy.acknowledge}
                          </button>
                        )}
                        <button
                          type="button"
                          className={prepPlain}
                          disabled={blocked || index === 0}
                          aria-label={`${copy.up}: ${taskTitle(step)}`}
                          onClick={() => move(index, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className={prepPlain}
                          disabled={blocked || index === steps.length - 1}
                          aria-label={`${copy.down}: ${taskTitle(step)}`}
                          onClick={() => move(index, 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className={prepPlain}
                          disabled={blocked}
                          onClick={() =>
                            setSteps((current) =>
                              current.filter((_, i) => i !== index),
                            )
                          }
                        >
                          {step.kind === "new" ? copy.removeNew : copy.remove}
                        </button>
                        {step.kind === "existing" && task?.available && (
                          <Link
                            className={prepPlain}
                            href={`/dashboard/chores/edit?id=${encodeURIComponent(step.choreId)}`}
                            onClick={(event) =>
                              navigateAway(
                                `/dashboard/chores/edit?id=${encodeURIComponent(step.choreId)}`,
                                event,
                              )
                            }
                          >
                            {copy.viewTask}
                          </Link>
                        )}
                      </div>
                    </li>
                  );
                })}
            </ol>
            {steps.length > PAGE && (
              <div className="flex items-center gap-2">
                <button
                  className={prepPlain}
                  type="button"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  {copy.back}
                </button>
                <span>
                  {page + 1} / {Math.ceil(steps.length / PAGE)}
                </span>
                <button
                  className={prepPlain}
                  type="button"
                  disabled={(page + 1) * PAGE >= steps.length}
                  onClick={() => setPage(page + 1)}
                >
                  {copy.next}
                </button>
              </div>
            )}
          </>
        )}
        {(screen === "task" || screen === "routine" || screen === "person") &&
          view &&
          session.context && (
            <>
              {screen === "person" && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={prepPlain}
                    aria-pressed={peopleKind === "accounts"}
                    onClick={() => setPeopleKind("accounts")}
                  >
                    {copy.accounts}
                  </button>
                  {view?.profileWritesEnabled && (
                    <button
                      type="button"
                      className={prepPlain}
                      aria-pressed={peopleKind === "profiles"}
                      onClick={() => setPeopleKind("profiles")}
                    >
                      {copy.profiles}
                    </button>
                  )}
                </div>
              )}
              <PreparationPicker
                key={`${screen}:${peopleKind}`}
                location={location}
                context={session.context}
                kind={
                  screen === "task"
                    ? "tasks"
                    : screen === "routine"
                      ? "routines"
                      : peopleKind
                }
                onPick={pick}
                disabled={blocked}
                selectedIds={steps.flatMap((step) =>
                  step.kind === "existing" ? [step.choreId] : [],
                )}
              />
              {screen === "routine" && routineId && routineDay && (
                <div className="space-y-3">
                  <p className="font-semibold">{routineLabel}</p>
                  <Link
                    className={prepPlain}
                    href={routineHref(routineId, routineDay)}
                    onClick={(event) =>
                      navigateAway(routineHref(routineId, routineDay), event)
                    }
                  >
                    {copy.viewRoutine}
                  </Link>
                  <label htmlFor={`${id}-routine-day`}>
                    {copy.routineDay}
                    <input
                      id={`${id}-routine-day`}
                      type="date"
                      className={prepInput}
                      value={routineDay}
                      onChange={(event) => setRoutineDay(event.target.value)}
                    />
                  </label>
                  <p>{copy.routineHint}</p>
                  <button
                    type="button"
                    className={prepPlain}
                    disabled={blocked || !routineDay}
                    onClick={loadRoutine}
                  >
                    {copy.useRoutine}
                  </button>
                </div>
              )}
            </>
          )}
        {screen === "edit" && editor && view && (
          <PreparationStepEditor
            key={`${editor.mode}:${editor.index}`}
            view={view}
            value={editor.value}
            reused={editor.mode === "reuse"}
            personName={
              editor.value.kind === "new"
                ? personName(editor.value.subject)
                : undefined
            }
            disabled={blocked}
            onChange={(value) => setEditor({ ...editor, value })}
            onPerson={() => {
              setPeopleKind("accounts");
              setScreen("person");
            }}
            onDone={doneEdit}
          />
        )}
        {screen === "routine-steps" && routine && view && (
          <>
            <p>{copy.selectSteps}</p>
            <Link
              className={prepPlain}
              href={routineHref(routine.stackId, routine.occurrenceDay)}
              onClick={(event) =>
                navigateAway(
                  routineHref(routine.stackId, routine.occurrenceDay),
                  event,
                )
              }
            >
              {copy.viewRoutine}
            </Link>
            <button
              type="button"
              className={prepPlain}
              disabled={blocked}
              onClick={() => setScreen("routine")}
            >
              {copy.reload}
            </button>
            <p className="text-footnote">{copy.routineHint}</p>
            {!routine.steps.length && <p>{copy.noRoutine}</p>}
            <ul className="space-y-3">
              {routine.steps
                .slice(page * PAGE, (page + 1) * PAGE)
                .map((step, offset) => {
                  const source = view.routine?.steps.find(
                    (row) => row.id === step.sourceId,
                  );
                  return (
                    <li
                      key={step.sourceId}
                      className="rounded-xl border border-[var(--surface-separator)] p-3"
                    >
                      <label className="flex min-h-11 items-center gap-3">
                        <input
                          type="checkbox"
                          checked={selected.includes(step.sourceId)}
                          disabled={blocked}
                          onChange={(event) =>
                            setSelected((current) =>
                              event.target.checked
                                ? [...current, step.sourceId]
                                : current.filter((id) => id !== step.sourceId),
                            )
                          }
                        />
                        <span className="break-words">
                          {source?.available
                            ? source.content.title
                            : copy.unavailable}
                        </span>
                      </label>
                      <p>
                        {personName(step.subject)} · {step.dueDay}
                      </p>
                      <button
                        type="button"
                        className={prepPlain}
                        disabled={blocked || !source?.available}
                        onClick={() => {
                          if (!source?.available) return;
                          setEditor({
                            mode: "reuse",
                            index: page * PAGE + offset,
                            value: {
                              kind: "new",
                              clientId: step.clientId,
                              ...source.content,
                              subject: step.subject,
                              points: step.points,
                              dueDay: step.dueDay,
                              cue: step.cue,
                            },
                          });
                          setScreen("edit");
                        }}
                      >
                        {copy.edit}
                      </button>
                    </li>
                  );
                })}
            </ul>
            {routine.steps.length > PAGE && (
              <div className="flex gap-2">
                <button
                  type="button"
                  className={prepPlain}
                  disabled={!page}
                  onClick={() => setPage(page - 1)}
                >
                  {copy.back}
                </button>
                <span>
                  {page + 1}/{Math.ceil(routine.steps.length / PAGE)}
                </span>
                <button
                  type="button"
                  className={prepPlain}
                  disabled={(page + 1) * PAGE >= routine.steps.length}
                  onClick={() => setPage(page + 1)}
                >
                  {copy.next}
                </button>
              </div>
            )}
          </>
        )}
        {screen === "review" && view && result?.reply.effects && (
          <>
            <p>{copy.confirmHint}</p>
            <p>
              {copy.creates}: {result.reply.effects.create.length} ·{" "}
              {copy.dates}: {result.reply.effects.retime.length} ·{" "}
              {copy.changedLinks}: {result.reply.effects.detach.length}
            </p>
            <ol className="space-y-3">
              {result.reply.effects.ordered
                .slice(page * PAGE, (page + 1) * PAGE)
                .map((step, index) => {
                  const task =
                      step.kind === "existing"
                        ? result.reply.view.tasks.find(
                            (task) => task.id === step.choreId,
                          )
                        : null,
                    created =
                      step.kind === "new"
                        ? result.reply.effects!.create.find(
                            (row) => row.clientId === step.clientId,
                          )
                        : null,
                    dateChange =
                      step.kind === "existing"
                        ? result.reply.effects!.retime.find(
                            (row) => row.choreId === step.choreId,
                          )
                        : null;
                  return (
                    <li
                      key={page * PAGE + index}
                      className="rounded-xl border border-[var(--surface-separator)] p-3"
                    >
                      <p className="break-words font-semibold">
                        {created?.title ??
                          (task?.available ? task.title : copy.unavailable)}
                      </p>
                      <p>
                        {created
                          ? personName(created.subject)
                          : task?.available
                            ? task.subjectName
                            : ""}{" "}
                        ·{" "}
                        {created?.dueDay ??
                          (dateChange
                            ? `${dateChange.from} → ${dateChange.to}`
                            : task?.available
                              ? task.dueDay
                              : "")}
                      </p>
                      {step.cue && (
                        <p>
                          {step.cue.anchor === "start" ? copy.start : copy.end}{" "}
                          ·{" "}
                          {step.cue.direction === "before"
                            ? copy.before
                            : copy.after}{" "}
                          · {step.cue.minutes} {copy.minutes}
                        </p>
                      )}
                      {step.kind === "existing" && task?.available && (
                        <Link
                          className={prepPlain}
                          href={`/dashboard/chores/edit?id=${encodeURIComponent(step.choreId)}`}
                          onClick={(event) =>
                            navigateAway(
                              `/dashboard/chores/edit?id=${encodeURIComponent(step.choreId)}`,
                              event,
                            )
                          }
                        >
                          {copy.viewTask}
                        </Link>
                      )}
                    </li>
                  );
                })}
            </ol>
            {result.reply.effects.ordered.length > PAGE && (
              <div className="flex gap-2">
                <button
                  className={prepPlain}
                  type="button"
                  disabled={!page}
                  onClick={() => setPage(page - 1)}
                >
                  {copy.back}
                </button>
                <span>
                  {page + 1}/
                  {Math.ceil(result.reply.effects.ordered.length / PAGE)}
                </span>
                <button
                  className={prepPlain}
                  type="button"
                  disabled={
                    (page + 1) * PAGE >= result.reply.effects!.ordered.length
                  }
                  onClick={() => setPage(page + 1)}
                >
                  {copy.next}
                </button>
              </div>
            )}
            <details>
              <summary className="min-h-11 py-3">
                {copy.changedLinks} ({result.reply.effects.detach.length})
              </summary>
              {result.reply.effects.detach
                .slice(removedPage * PAGE, (removedPage + 1) * PAGE)
                .map((choreId) => {
                  const task = result.reply.view.tasks.find(
                    (task) => task.id === choreId,
                  );
                  return (
                    <p key={choreId}>
                      {task?.available ? task.title : copy.unavailable}
                    </p>
                  );
                })}
              {result.reply.effects.detach.length > PAGE && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={prepPlain}
                    disabled={!removedPage}
                    onClick={() => setRemovedPage(removedPage - 1)}
                  >
                    {copy.back}
                  </button>
                  <span>
                    {removedPage + 1}/
                    {Math.ceil(result.reply.effects.detach.length / PAGE)}
                  </span>
                  <button
                    type="button"
                    className={prepPlain}
                    disabled={
                      (removedPage + 1) * PAGE >=
                      result.reply.effects.detach.length
                    }
                    onClick={() => setRemovedPage(removedPage + 1)}
                  >
                    {copy.next}
                  </button>
                </div>
              )}
            </details>
          </>
        )}
      </div>
    </Dialog>
  );
}
