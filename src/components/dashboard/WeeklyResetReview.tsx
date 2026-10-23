"use client";
import {
  usePreparationActive,
  PreparationButton,
} from "@/components/calendar/preparation/PreparationProvider";
import {
  ScheduleReviewButton,
  useScheduleReviewActive,
} from "@/components/calendar/review/ScheduleReviewProvider";
import { CALENDAR_CHANGED_EVENT } from "@/lib/calendar-planning/changes";
import * as React from "react";
import { MealPlanningReviewLinks } from "@/components/meals/planning/MealPlanningReviewLinks";
import { ResponsibilityReviewEntry } from "@/components/responsibility/ResponsibilityProvider";
import Link from "next/link";
import { Dialog } from "@/components/ui/dialog";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
import { useWeeklyResetText } from "@/i18n/weekly-reset";
import { addDaysToKey } from "@/lib/local-day-key";
import { formatDateOnly } from "@/lib/dates";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import { browserWeeklyResetRecovery } from "@/lib/weekly-reset-browser";
import {
  readWeeklyResetContext,
  readWeeklyResetView,
  readWeeklyResetStep,
  inspectWeeklyReset,
  sendWeeklyReset,
} from "@/lib/weekly-reset-client";
import {
  WEEKLY_RESET_PROTOCOL,
  weeklyResetCommand,
  type WeeklyResetView,
  type WeeklyResetScope,
  type WeeklyResetStep,
} from "@/lib/weekly-reset";
import type { WeeklyResetSummary } from "@/lib/weekly-reset-summary-contract";
import type {
  WeeklyResetRecoveryEntry,
  weeklyResetRecoveryReview,
} from "@/lib/weekly-reset-recovery";
type RecoveryReview = ReturnType<typeof weeklyResetRecoveryReview.parse>;
type Props = {
  userId: string;
  familyId: string;
  initialScope: WeeklyResetScope;
  onClose: () => void;
};
const control =
  "min-h-11 rounded-xl px-4 py-2 text-callout font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:opacity-50";
const primary = `${control} btn-filled`;
const plain = `${control} bg-[var(--surface-fill-secondary)] text-label-primary`;

export default function WeeklyResetReview({
  userId,
  familyId,
  initialScope,
  onClose,
}: Props) {
  const copy = useWeeklyResetText(),
    locale = useDisplayLocale();
  const preparationActive = usePreparationActive();
  const scheduleReviewActive = useScheduleReviewActive() || preparationActive;
  const [store] = React.useState(() =>
    browserWeeklyResetRecovery({ userId, familyId }),
  );
  const alive = React.useRef(false),
    operation = React.useRef(false),
    readEpoch = React.useRef(0);
  const heading = React.useRef<HTMLHeadingElement>(null);
  const [scope, setScope] = React.useState(initialScope);
  const [view, setView] = React.useState<WeeklyResetView | null>(null);
  const [fresh, setFresh] = React.useState(false),
    [busy, setBusy] = React.useState(true);
  const [error, setError] = React.useState(false),
    [storageError, setStorageError] = React.useState(false);
  const [enabled, setEnabled] = React.useState(false);
  const [pending, setPending] = React.useState<WeeklyResetRecoveryEntry | null>(
    null,
  );
  const pendingRef = React.useRef<WeeklyResetRecoveryEntry | null>(null);
  const storageAction = React.useRef<"stage" | "dismiss" | null>(null);
  const [review, setReview] = React.useState<RecoveryReview | null>(null);
  const [index, setIndex] = React.useState(0),
    [restart, setRestart] = React.useState(false),
    [forget, setForget] = React.useState(false);
  const [summary, setSummary] = React.useState<WeeklyResetSummary | null>(null);
  const [summaryError, setSummaryError] = React.useState(false),
    [summaryLoading, setSummaryLoading] = React.useState(false),
    [summaryAttempt, setSummaryAttempt] = React.useState(0);
  const step = view?.steps[index];
  React.useEffect(() => {
    const refresh = () => setSummaryAttempt((value) => value + 1);
    window.addEventListener(CALENDAR_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(CALENDAR_CHANGED_EVENT, refresh);
  }, []);
  function retain(entry: WeeklyResetRecoveryEntry | null) {
    pendingRef.current = entry;
    setPending(entry);
    setReview(null);
  }
  async function refresh(target: WeeklyResetScope, chooseFirst = false) {
    if (alive.current) {
      setFresh(false);
      setError(false);
    }
    const epoch = readEpoch.current;
    const current = await readWeeklyResetView({ userId, familyId }, target);
    if (!alive.current || epoch !== readEpoch.current) return;
    setView(current);
    setScope(target);
    setFresh(true);
    if (chooseFirst) {
      const first = current.steps.findIndex((row) => row.state === "pending");
      setIndex(current.complete || first < 0 ? current.steps.length : first);
    }
  }
  React.useEffect(() => {
    if (scheduleReviewActive) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [scheduleReviewActive]);
  React.useEffect(() => {
    alive.current = true;
    const epoch = ++readEpoch.current;
    void (async () => {
      try {
        const context = await readWeeklyResetContext();
        if (context.userId !== userId || context.familyId !== familyId)
          throw new Error("Owner changed");
        const rows = await store.initialize();
        if (!alive.current || readEpoch.current !== epoch) return;
        setEnabled(context.enabled);
        const entry = rows[0] ?? null;
        retain(entry);
        const command = entry
          ? weeklyResetCommand.parse(JSON.parse(entry.body))
          : null;
        await refresh(
          command
            ? { weekStart: command.weekStart, timeZone: command.timeZone }
            : initialScope,
          true,
        );
      } catch {
        if (alive.current && readEpoch.current === epoch) {
          setError(true);
          setStorageError(true);
        }
      } finally {
        if (alive.current && readEpoch.current === epoch) setBusy(false);
      }
    })();
    return () => {
      alive.current = false;
      readEpoch.current += 1;
    };
    // One controller per opening/owner. Locale does not reload or send anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, userId, familyId]);

  React.useEffect(() => {
    let current = true;
    setSummary(null);
    setSummaryError(false);
    if (!fresh || !view?.started || !step) {
      setSummaryLoading(false);
      return;
    }
    setSummaryLoading(true);
    void readWeeklyResetStep({ userId, familyId }, scope, step.id)
      .then(
        (result) => {
          if (current) setSummary(result);
        },
        () => {
          if (current) setSummaryError(true);
        },
      )
      .finally(() => {
        if (current) setSummaryLoading(false);
      });
    return () => {
      current = false;
    };
  }, [
    userId,
    familyId,
    scope.weekStart,
    scope.timeZone,
    step?.id,
    view?.started,
    fresh,
    summaryAttempt,
  ]);
  React.useEffect(() => {
    heading.current?.focus();
  }, [index, view?.started, view?.complete]);

  async function run(work: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError(false);
    try {
      await work();
    } catch {
      if (alive.current) {
        setError(true);
        if (store.hasUncertainStorage()) setStorageError(true);
      }
    } finally {
      operation.current = false;
      if (alive.current) {
        setBusy(false);
        heading.current?.focus();
      }
    }
  }
  async function dismiss(entry: WeeklyResetRecoveryEntry) {
    storageAction.current = "dismiss";
    try {
      await store.dismiss(entry.key);
    } catch (caught) {
      if (alive.current) setStorageError(true);
      throw caught;
    }
    storageAction.current = null;
  }
  async function confirmed(entry: WeeklyResetRecoveryEntry) {
    await dismiss(entry);
    if (!alive.current) return;
    retain(null);
    setStorageError(false);
    setForget(false);
    await refresh(scope, true);
  }
  async function send(entry: WeeklyResetRecoveryEntry) {
    const result = await store.send(entry.key, true, sendWeeklyReset);
    if (!alive.current) return;
    if (result.kind === "confirmed") await confirmed(entry);
    else {
      setError(true);
      setReview(null);
    }
  }
  function act(
    action: "start" | "restart" | "finish" | "set-step",
    state?: "reviewed" | "skipped",
    stepId?: WeeklyResetStep,
  ) {
    if (!view || !fresh || pendingRef.current || !enabled || storageError)
      return;
    void run(async () => {
      const command = weeklyResetCommand.parse({
        protocol: WEEKLY_RESET_PROTOCOL,
        userId,
        familyId,
        ...scope,
        issuedAt: new Date().toISOString(),
        expectedRevision: view.revision,
        action,
        ...(action === "set-step" ? { step: stepId, state } : {}),
      });
      const entry: WeeklyResetRecoveryEntry = {
        kind: "weekly-reset",
        key: newIdempotencyKey(),
        body: JSON.stringify(command),
      };
      retain(entry);
      setRestart(false);
      storageAction.current = "stage";
      try {
        await store.stage(entry);
      } catch (caught) {
        if (alive.current) setStorageError(true);
        throw caught;
      }
      storageAction.current = null;
      if (!alive.current) return;
      await send(entry);
    });
  }
  const disabled =
    busy || !fresh || pending !== null || storageError || !enabled;
  const handled =
    view?.steps.filter((row) => row.state !== "pending").length ?? 0;
  const final = view && index >= view.steps.length;
  const stateLabel = (state: "pending" | "reviewed" | "skipped") => copy[state];
  function date(value: string | null) {
    if (!value) return "";
    if (value.length === 10)
      return formatDateOnly(value, { month: "short", day: "numeric" }, locale);
    return new Intl.DateTimeFormat(locale, {
      timeZone: scope.timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  }
  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <button
        className={plain}
        disabled={busy || index === 0 || !!pending}
        onClick={() => setIndex((value) => Math.max(0, value - 1))}
      >
        {copy.back}
      </button>
      {view && !view.started ? (
        <button
          className={primary}
          disabled={disabled}
          onClick={() => act("start")}
        >
          {copy.start}
        </button>
      ) : view?.complete && final ? (
        <button className={primary} disabled={busy} onClick={onClose}>
          {copy.close}
        </button>
      ) : final ? (
        <button
          className={primary}
          disabled={disabled || handled !== view?.steps.length}
          onClick={() => act("finish")}
        >
          {busy ? copy.saving : copy.finish}
        </button>
      ) : step ? (
        <div className="flex flex-wrap gap-2">
          <button
            className={plain}
            disabled={disabled}
            onClick={() => act("set-step", "skipped", step.id)}
          >
            {copy.skip}
          </button>
          <button
            className={primary}
            disabled={disabled || summaryLoading || summaryError || !summary}
            onClick={() => act("set-step", "reviewed", step.id)}
          >
            {busy ? copy.saving : copy.mark}
          </button>
        </div>
      ) : null}
    </div>
  );
  return (
    <Dialog
      open={!scheduleReviewActive}
      title={copy.title}
      description={copy.intro}
      closeLabel={copy.close}
      onClose={onClose}
      variant="form"
      className="sm:max-w-3xl"
      footer={footer}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-callout text-label-secondary">
            {date(scope.weekStart)} – {date(addDaysToKey(scope.weekStart, 6))} ·{" "}
            {scope.timeZone}
          </p>
          <div className="flex flex-wrap gap-1">
            {view?.started && (
              <button
                className={plain}
                disabled={disabled}
                onClick={() => setRestart(true)}
              >
                {copy.restart}
              </button>
            )}
            {([-7, 7] as const).map((offset) => (
              <button
                key={offset}
                className={plain}
                disabled={busy || !!pending || storageError}
                onClick={() =>
                  void run(() =>
                    refresh(
                      {
                        ...scope,
                        weekStart: addDaysToKey(scope.weekStart, offset),
                      },
                      true,
                    ),
                  )
                }
              >
                {offset < 0 ? copy.previousWeek : copy.nextWeek}
              </button>
            ))}
          </div>
        </div>
        {busy && !view && <p role="status">{copy.loading}</p>}
        {error && (
          <div
            role="alert"
            className="rounded-xl bg-[var(--surface-fill-secondary)] p-3 text-label-primary"
          >
            <p>{copy.loadError}</p>
            <button
              className={plain}
              disabled={busy}
              onClick={() => void run(() => refresh(scope, true))}
            >
              {copy.reload}
            </button>
          </div>
        )}
        {!enabled && view && (
          <p role="status" className="text-callout text-label-secondary">
            {copy.readOnly}
          </p>
        )}
        {storageError && (
          <div
            role="alert"
            className="space-y-2 rounded-xl border border-[var(--surface-separator)] p-3"
          >
            <p>{copy.storageError}</p>
            <button
              className={plain}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const rows = store.hasUncertainStorage()
                    ? await store.recoverStorage()
                    : await store.initialize();
                  if (!alive.current) return;
                  const saved =
                    rows[0] ??
                    (storageAction.current === "stage"
                      ? pendingRef.current
                      : null);
                  if (saved && rows.length === 0) await store.stage(saved);
                  if (!alive.current) return;
                  storageAction.current = null;
                  retain(saved);
                  setStorageError(false);
                  setEnabled(store.writesAvailable());
                  const command = saved
                    ? weeklyResetCommand.parse(JSON.parse(saved.body))
                    : null;
                  await refresh(
                    command
                      ? {
                          weekStart: command.weekStart,
                          timeZone: command.timeZone,
                        }
                      : scope,
                    true,
                  );
                })
              }
            >
              {copy.repair}
            </button>
          </div>
        )}
        {pending && (
          <section
            aria-label={copy.recovery}
            className="space-y-3 rounded-xl border border-[var(--surface-separator)] p-4"
          >
            <h3 className="font-semibold">{copy.recovery}</h3>
            <p className="text-callout text-label-secondary">
              {copy.recoveryHint}
            </p>
            <p className="text-callout">
              {(() => {
                const command = weeklyResetCommand.parse(
                  JSON.parse(pending.body),
                );
                return `${command.action === "set-step" ? copy.steps[command.step] : copy.title} · ${date(command.weekStart)} · ${command.action === "set-step" ? stateLabel(command.state) : command.action === "start" ? copy.start : command.action === "restart" ? copy.restart : copy.finish}`;
              })()}
            </p>
            {review && <p role="status">{copy.states[review.state]}</p>}
            <div className="flex flex-wrap gap-2">
              <button
                className={plain}
                disabled={busy || storageError}
                onClick={() =>
                  void run(async () => {
                    const result = await store.inspect(
                      pending.key,
                      inspectWeeklyReset,
                    );
                    if (!alive.current) return;
                    setReview(result);
                    if (result.state === "committed") await confirmed(pending);
                  })
                }
              >
                {copy.check}
              </button>
              {review?.canRetry && (
                <button
                  className={primary}
                  disabled={busy || storageError}
                  onClick={() => void run(() => send(pending))}
                >
                  {copy.retry}
                </button>
              )}
              <button
                className={plain}
                disabled={busy || storageError}
                onClick={() => setForget(true)}
              >
                {copy.forget}
              </button>
            </div>
            {forget && (
              <div className="space-y-2">
                <p>{copy.forgetConfirm}</p>
                <button
                  className={plain}
                  disabled={busy}
                  onClick={() => setForget(false)}
                >
                  {copy.cancel}
                </button>
                <button
                  className={plain}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await dismiss(pending);
                      if (!alive.current) return;
                      retain(null);
                      setForget(false);
                      await refresh(scope, true);
                    })
                  }
                >
                  {copy.confirmForget}
                </button>
              </div>
            )}
          </section>
        )}
        {view && (
          <>
            <p className="text-callout text-label-secondary" aria-live="polite">
              {copy.progress(handled, view.steps.length)}
            </p>
            {!view.started ? (
              <p>{copy.startHint}</p>
            ) : (
              <div className="grid gap-5 md:grid-cols-[12rem_minmax(0,1fr)]">
                <nav aria-label={copy.final} className="hidden md:block">
                  <ol className="space-y-1">
                    {view.steps.map((row, position) => (
                      <li key={row.id}>
                        <button
                          className={`${plain} w-full text-left`}
                          aria-current={position === index ? "step" : undefined}
                          disabled={busy || !!pending}
                          onClick={() => setIndex(position)}
                        >
                          <span className="block">{copy.steps[row.id]}</span>
                          <span className="text-footnote text-label-secondary">
                            {stateLabel(row.state)}
                          </span>
                        </button>
                      </li>
                    ))}
                    <li>
                      <button
                        className={`${plain} w-full text-left`}
                        disabled={busy || !!pending}
                        onClick={() => setIndex(view.steps.length)}
                      >
                        {copy.final}
                      </button>
                    </li>
                  </ol>
                </nav>
                <section
                  className="min-w-0 space-y-4"
                  aria-busy={summaryLoading || busy}
                >
                  <h3
                    ref={heading}
                    tabIndex={-1}
                    className="text-title-2 font-semibold outline-none"
                  >
                    {view.complete && final
                      ? copy.saved
                      : final
                        ? copy.final
                        : step
                          ? copy.steps[step.id]
                          : copy.final}
                  </h3>
                  {final ? (
                    <>
                      <p>{copy.doneHint}</p>
                      <p>
                        {copy.skippedCount(
                          view.steps.filter((row) => row.state === "skipped")
                            .length,
                        )}
                      </p>
                      <ol className="space-y-2">
                        {view.steps.map((row, position) => (
                          <li key={row.id}>
                            <button
                              className={`${plain} flex w-full flex-wrap justify-between gap-2 text-left`}
                              disabled={busy || !!pending}
                              onClick={() => setIndex(position)}
                            >
                              <span>{copy.steps[row.id]}</span>
                              <span className="text-label-secondary">
                                {stateLabel(row.state)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ol>
                    </>
                  ) : (
                    <>
                      {step && (
                        <p className="text-callout text-label-secondary">
                          {stateLabel(step.state)}
                        </p>
                      )}
                      {step &&
                        ["meals", "prep", "food", "groceries"].includes(
                          step.id,
                        ) && (
                          <MealPlanningReviewLinks
                            disabled={busy || !!pending || storageError}
                            canNavigate={() =>
                              !operation.current &&
                              !pendingRef.current &&
                              storageAction.current === null
                            }
                          />
                        )}
                      {summaryLoading && <p role="status">{copy.loading}</p>}
                      {summaryError && (
                        <div role="alert">
                          <p>{copy.stepError}</p>
                          <button
                            className={plain}
                            disabled={busy}
                            onClick={() =>
                              setSummaryAttempt((value) => value + 1)
                            }
                          >
                            {copy.retryStep}
                          </button>
                        </div>
                      )}
                      {summary && (
                        <>
                          {summary.groups.map((group) => (
                            <section key={group.kind} className="space-y-2">
                              <h4 className="font-semibold">
                                {copy.groups[group.kind]}
                              </h4>
                              {group.kind === "gaps" && (
                                <Link
                                  href="/dashboard/meals"
                                  className={`${plain} inline-flex items-center`}
                                >
                                  {copy.mealPlanReview}
                                </Link>
                              )}
                              {group.total !== undefined && (
                                <p className="text-callout">
                                  {copy.groceryTotal(group.total)}
                                </p>
                              )}
                              {group.rows.length === 0 ? (
                                <p className="text-callout text-label-secondary">
                                  {group.incomplete
                                    ? copy.unknownCoverage
                                    : group.kind === "gaps"
                                      ? group.compared
                                        ? copy.noGaps
                                        : copy.noRecipes
                                      : copy.empty}
                                </p>
                              ) : (
                                <ul className="divide-y divide-[var(--surface-separator)]">
                                  {group.rows
                                    .slice(0, 3)
                                    .map((row, position) => (
                                      <li
                                        key={position}
                                        className="break-words py-3"
                                      >
                                        <p className="font-medium">
                                          {row.title || copy.unnamed}
                                        </p>
                                        {row.preparation && (
                                          <PreparationButton
                                            location={row.preparation}
                                          />
                                        )}
                                        {row.scheduleReview && (
                                          <ScheduleReviewButton
                                            scope={row.scheduleReview}
                                          />
                                        )}
                                        {row.responsibility && (
                                          <ResponsibilityReviewEntry
                                            target={row.responsibility}
                                          />
                                        )}
                                        {row.sourceTitle && (
                                          <p className="text-callout text-label-secondary">
                                            {row.sourceTitle}
                                          </p>
                                        )}
                                        {row.href && (
                                          <Link
                                            href={row.href}
                                            className={`${plain} inline-flex items-center`}
                                          >
                                            {copy.recipeReview}
                                          </Link>
                                        )}
                                        <p className="text-callout text-label-secondary">
                                          {row.dateKind
                                            ? `${copy.dateKinds[row.dateKind]}: `
                                            : ""}
                                          {date(row.when)}
                                          {row.end ? ` – ${date(row.end)}` : ""}
                                          {row.owner
                                            ? ` · ${copy.owners[row.owner]}`
                                            : ""}
                                          {row.ownerName
                                            ? ` · ${row.ownerName}`
                                            : ""}
                                          {row.subjectKind === "profile"
                                            ? ` · ${copy.profile}`
                                            : ""}
                                          {group.kind === "groceries" &&
                                          row.quantity !== undefined
                                            ? ` · ×${row.quantity}`
                                            : ""}
                                        </p>
                                        {group.kind === "prep" && (
                                          <>
                                            <p className="text-callout">
                                              {row.prepared
                                                ? copy.prepared
                                                : copy.planned}{" "}
                                              ·{" "}
                                              {row.remaining !== undefined
                                                ? copy.portions(
                                                    row.eaten ?? 0,
                                                    row.remaining,
                                                  )
                                                : copy.plannedPortions(
                                                    row.quantity ?? 0,
                                                  )}
                                            </p>
                                            <p className="text-callout text-label-secondary">
                                              {row.nextPrep
                                                ? copy.nextPrep(
                                                    date(row.nextPrep),
                                                  )
                                                : copy.noNextPrep}
                                            </p>
                                          </>
                                        )}
                                      </li>
                                    ))}
                                </ul>
                              )}
                              {(group.more || group.rows.length > 3) && (
                                <p className="text-footnote text-label-secondary">
                                  {copy.more}
                                </p>
                              )}
                            </section>
                          ))}
                          {summary.notes.map((note) => (
                            <p
                              key={note}
                              className="text-footnote text-label-secondary"
                            >
                              {copy.notes[note]}
                            </p>
                          ))}
                        </>
                      )}
                      {step && (
                        <Link
                          className={`${plain} inline-flex items-center`}
                          href={step.href}
                        >
                          {copy.openSection}
                        </Link>
                      )}
                    </>
                  )}
                </section>
              </div>
            )}
          </>
        )}
        {restart && (
          <div className="space-y-2 rounded-xl border border-[var(--surface-separator)] p-3">
            <p>{copy.restartHint}</p>
            <button
              className={plain}
              disabled={busy}
              onClick={() => setRestart(false)}
            >
              {copy.cancel}
            </button>
            <button
              className={plain}
              disabled={disabled}
              onClick={() => act("restart")}
            >
              {copy.confirmRestart}
            </button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
