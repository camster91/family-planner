"use client";
import * as React from "react";
import Link from "next/link";
import { Dialog } from "@/components/ui/dialog";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
import { useDraftAwareRouter as useRouter } from "@/components/layout/owned-draft-navigation";
import { useScheduleReviewText } from "@/i18n/schedule-review";
import {
  planScheduleReview,
  type ScheduleReviewScope,
  type ScheduleReviewQuery,
  type ScheduleReviewPlan,
} from "@/lib/calendar-planning/conflict-review";
import {
  formatScheduleInstant,
  EMPTY_BUFFER_DRAFT,
  windowDraft,
  resolveScheduleDraft,
  queryForSchedule,
  type BufferDraft,
  type WindowDraft,
  type OtherBufferDraft,
} from "@/lib/calendar-planning/schedule-form";
import { useScheduleReviewSession } from "./useScheduleReviewSession";
import { BufferFields, WindowFields } from "./ScheduleReviewFields";
import SchedulePendingMoves, {
  reviewControl,
  reviewPlain,
} from "./SchedulePendingMoves";
type SearchResult = NonNullable<
  Awaited<ReturnType<ReturnType<typeof useScheduleReviewSession>["preview"]>>
> & { query: ScheduleReviewQuery };
export default function ScheduleReviewSheet({
  initialScope,
  onClose,
  onOpen,
}: {
  initialScope: ScheduleReviewScope;
  onClose: () => void;
  onOpen: (scope: ScheduleReviewScope) => void;
}) {
  const copy = useScheduleReviewText(),
    locale = useDisplayLocale(),
    session = useScheduleReviewSession(initialScope),
    router = useRouter(),
    formId = React.useId();
  const [step, setStep] = React.useState<
      "review" | "settings" | "options" | "confirm"
    >("review"),
    [buffers, setBuffers] = React.useState<BufferDraft>({
      ...EMPTY_BUFFER_DRAFT,
    }),
    [windows, setWindows] = React.useState<WindowDraft[]>(() => [
      windowDraft(initialScope),
    ]),
    [windowIndex, setWindowIndex] = React.useState(0),
    [grid, setGrid] = React.useState<ScheduleReviewQuery["gridMinutes"]>(15);
  const [others, setOthers] = React.useState<Record<string, OtherBufferDraft>>(
      {},
    ),
    [otherId, setOtherId] = React.useState<string | null>(null),
    [search, setSearch] = React.useState("");
  const [result, setResult] = React.useState<SearchResult | null>(null),
    [choice, setChoice] = React.useState<
      ScheduleReviewPlan["alternatives"][number] | null
    >(null);
  const [confirmOtherIndex, setConfirmOtherIndex] = React.useState(0);
  const heading = React.useRef<HTMLHeadingElement>(null);
  const snapshot = session.reply?.snapshot,
    target = snapshot?.events.find(
      (event) => event.id === initialScope.targetId,
    ),
    zone = snapshot?.timeZone ?? initialScope.timeZone;
  const blocked =
    session.busy ||
    session.storageError ||
    session.entries.length > 0 ||
    session.ownerHeld;
  function clearResult() {
    setResult(null);
    setChoice(null);
  }
  function reset() {
    clearResult();
    setStep("review");
  }
  React.useEffect(() => {
    heading.current?.focus();
  }, [step]);
  React.useEffect(() => {
    if (
      session.notice === "proof" ||
      session.ownerHeld ||
      (result &&
        snapshot &&
        result.snapshot.snapshotToken !== snapshot.snapshotToken)
    )
      reset();
  }, [session.notice, session.ownerHeld, snapshot?.snapshotToken, result]);
  function date(value: string) {
    return formatScheduleInstant(value, locale, zone);
  }
  function duration(start: string, end: string) {
    const value = (Date.parse(end) - Date.parse(start)) / 1000,
      hours = Math.floor(value / 3600),
      minutes = Math.floor((value % 3600) / 60),
      seconds = value % 60;
    return [
      hours ? `${hours} ${copy.hours}` : "",
      minutes ? `${minutes} ${copy.minutes}` : "",
      seconds
        ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(seconds)} ${copy.seconds}`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  function navigateAway(
    event: React.MouseEvent<HTMLAnchorElement>,
    href: string,
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
    void router.push(href).then((allowed) => {
      if (allowed) session.stop();
    });
  }
  const overview = React.useMemo(() => {
    if (!snapshot || !target || !session.reply) return null;
    try {
      return planScheduleReview(
        snapshot,
        {
          protocol: snapshot.protocol,
          owner: snapshot.owner,
          snapshotToken: snapshot.snapshotToken,
          target: { id: target.id, sourceToken: target.sourceToken },
          range: snapshot.range,
          timeZone: snapshot.timeZone,
          buffers: { preparation: 0, travelBefore: 0, travelAfter: 0 },
          otherBuffers: [],
          windows: [snapshot.range],
          gridMinutes: 15,
        },
        new Date(session.reply.evaluatedAt),
      );
    } catch {
      return null;
    }
  }, [snapshot, target, session.reply]);
  function find() {
    if (blocked || !snapshot || !target) return;
    const previousToken = target.sourceToken;
    clearResult();
    void session.run(async (version) => {
      const draft = resolveScheduleDraft(
        snapshot,
        initialScope.targetId,
        buffers,
        windows,
        others,
      );
      const fresh = await session.load(draft.scope, version);
      if (!fresh || !session.current(version)) return;
      if (
        fresh.snapshot.events.find(
          (event) => event.id === initialScope.targetId,
        )?.sourceToken !== previousToken
      ) {
        setStep("review");
        return;
      }
      const query = queryForSchedule(
          fresh.snapshot,
          initialScope.targetId,
          draft,
          grid,
        ),
        reply = await session.preview(query, version);
      if (!reply || !session.current(version)) return;
      setResult({ ...reply, query });
      setChoice(null);
      setStep("options");
    });
  }
  function bufferSummary(value: ScheduleReviewQuery["buffers"]) {
    return `${copy.preparation}: ${value.preparation} ${copy.minutes} · ${copy.travelBefore}: ${value.travelBefore} ${copy.minutes} · ${copy.travelAfter}: ${value.travelAfter} ${copy.minutes}`;
  }
  function conflictRows(rows: ScheduleReviewPlan["conflicts"]) {
    return rows.map((row) => (
      <li className="space-y-1 py-2" key={row.event.id}>
        <p className="break-words font-medium">
          {row.event.title || copy.untitled}
        </p>
        <p className="text-footnote text-label-secondary">
          {row.reason === "event-overlap" ? copy.actual : copy.bufferOnly} ·{" "}
          {copy.origins[row.event.origin]}
        </p>
        <p className="text-footnote">
          {date(row.start)} – {date(row.end)}
        </p>
      </li>
    ));
  }
  function constraints(plan: ScheduleReviewPlan) {
    return (
      <section className="space-y-2">
        <h3 className="font-semibold">
          {copy.overlaps} · {plan.conflictCount}
        </h3>
        {plan.conflicts.length === 0 ? (
          <p className="text-callout text-label-secondary">{copy.none}</p>
        ) : (
          <ul className="divide-y divide-[var(--surface-separator)]">
            {conflictRows(plan.conflicts.slice(0, 3))}
          </ul>
        )}
        {plan.conflicts.length > 3 && (
          <details>
            <summary className="min-h-11 cursor-pointer py-2">
              {copy.more}
            </summary>
            <ul className="divide-y divide-[var(--surface-separator)]">
              {conflictRows(plan.conflicts.slice(3))}
            </ul>
          </details>
        )}
        {plan.moreConflicts && <p>{copy.more}</p>}
      </section>
    );
  }
  function holds(plan: ScheduleReviewPlan) {
    return (
      plan.holds.length > 0 && (
        <div
          role="status"
          className="space-y-1 text-callout text-label-secondary"
        >
          {plan.holds.map((reason) => (
            <p key={reason}>{copy.holds[reason]}</p>
          ))}
          {plan.holds.includes("sources-unavailable") && (
            <p>{copy.sourceHint}</p>
          )}
        </div>
      )
    );
  }
  const currentOther = snapshot?.events.find((event) => event.id === otherId),
    otherDraft =
      otherId && Object.hasOwn(others, otherId) ? others[otherId] : undefined;
  const otherMatches = (snapshot?.events ?? [])
    .filter(
      (event) =>
        event.id !== target?.id &&
        event.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    )
    .slice(0, 8);
  const canConfirm =
    !blocked &&
    session.fresh &&
    session.context?.enabled &&
    session.context.role === "parent" &&
    result?.plan.canApply &&
    choice;
  const footer =
    step === "review" ? (
      <button
        type="button"
        className={`${reviewControl} btn-filled`}
        disabled={blocked || !target}
        onClick={() => setStep("settings")}
      >
        {copy.find}
      </button>
    ) : step === "settings" ? (
      <>
        <button
          type="button"
          className={reviewPlain}
          disabled={session.busy}
          onClick={() => setStep("review")}
        >
          {copy.back}
        </button>
        <button
          type="submit"
          form={formId}
          className={`${reviewControl} btn-filled`}
          disabled={blocked || !target}
        >
          {copy.find}
        </button>
      </>
    ) : step === "options" ? (
      <button
        type="button"
        className={reviewPlain}
        disabled={session.busy}
        onClick={() => {
          setChoice(null);
          setStep("settings");
        }}
      >
        {copy.back}
      </button>
    ) : (
      <>
        <button
          type="button"
          className={reviewPlain}
          disabled={session.busy}
          onClick={() => {
            setChoice(null);
            setStep("options");
          }}
        >
          {copy.back}
        </button>
        <button
          type="button"
          className={`${reviewControl} btn-filled`}
          disabled={!canConfirm}
          onClick={() => {
            if (result && choice) session.commit(result, result.query, choice);
          }}
        >
          {copy.confirm}
        </button>
      </>
    );
  return (
    <Dialog
      open
      title={copy.title}
      description={copy.intro}
      variant="form"
      closeLabel={copy.close}
      initialFocusRef={heading}
      onClose={() => {
        session.stop();
        onClose();
      }}
      footer={<div className="flex flex-wrap gap-2">{footer}</div>}
    >
      <div className="space-y-4" aria-busy={session.busy}>
        {session.busy && <p role="status">{copy.loading}</p>}
        {session.error && <p role="alert">{copy.error}</p>}
        {session.draftError && <p role="alert">{copy.draftError}</p>}
        {session.notice && <p role="status">{copy[session.notice]}</p>}
        <button
          type="button"
          className={reviewPlain}
          disabled={session.busy || session.ownerHeld}
          onClick={() => {
            reset();
            session.reload();
          }}
        >
          {copy.reload}
        </button>
        {session.storageError && (
          <section
            role="alert"
            className="space-y-2 rounded-xl border border-[var(--surface-separator)] p-3"
          >
            <p>{copy.storage}</p>
            <button
              type="button"
              className={reviewPlain}
              disabled={session.busy || session.ownerHeld}
              onClick={() => {
                reset();
                session.repair();
              }}
            >
              {copy.repair}
            </button>
          </section>
        )}
        <SchedulePendingMoves
          session={session}
          initialScope={initialScope}
          locale={locale}
          onOpen={onOpen}
          onReset={reset}
        />
        {!session.reply && session.context && !session.context.enabled && (
          <p>{copy.paused}</p>
        )}
        {snapshot && target && !session.ownerHeld && (
          <>
            <header className="space-y-1">
              <h2
                className="break-words text-headline font-semibold outline-none"
                tabIndex={-1}
                ref={heading}
              >
                {target.title || copy.untitled}
              </h2>
              <p className="text-footnote text-label-secondary">
                {copy.origins[target.origin]} · {copy.zone}: {zone}
              </p>
              <p className="text-footnote text-label-secondary">
                {copy.checked}: {date(session.reply!.evaluatedAt)}
              </p>
            </header>
            {session.context?.role !== "parent" && <p>{copy.readOnly}</p>}
            {!session.context?.enabled &&
              session.context?.role === "parent" && <p>{copy.paused}</p>}
            {step === "review" && (
              <>
                <section className="space-y-1">
                  <h3 className="font-semibold">{copy.current}</h3>
                  <p>
                    {date(target.start)} – {date(target.end)}
                  </p>
                  <p className="text-footnote">
                    {copy.duration}: {duration(target.start, target.end)}
                  </p>
                </section>
                {overview && (
                  <>
                    {constraints(overview)}
                    {holds(overview)}
                  </>
                )}
              </>
            )}
            {step === "settings" && (
              <form
                id={formId}
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  find();
                }}
              >
                <h3 className="font-semibold">{copy.buffers}</h3>
                <BufferFields
                  value={buffers}
                  disabled={blocked}
                  onChange={(value) => {
                    clearResult();
                    setBuffers(value);
                  }}
                />
                <p className="text-footnote text-label-secondary">
                  {copy.bufferHint}
                </p>
                <section className="space-y-3 rounded-2xl border border-[var(--surface-separator)] p-3">
                  <h3 className="font-semibold">
                    {copy.window} {windowIndex + 1}/{windows.length}
                  </h3>
                  <p className="text-footnote text-label-secondary">
                    {copy.windowHint} · {zone}
                  </p>
                  <WindowFields
                    value={windows[windowIndex]}
                    zone={zone}
                    locale={locale}
                    disabled={blocked}
                    onChange={(value) => {
                      clearResult();
                      setWindows((previous) =>
                        previous.map((row, index) =>
                          index === windowIndex ? value : row,
                        ),
                      );
                    }}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={reviewPlain}
                      disabled={blocked || windowIndex === 0}
                      onClick={() =>
                        setWindowIndex((index) => Math.max(0, index - 1))
                      }
                    >
                      {copy.previousWindow}
                    </button>
                    <button
                      type="button"
                      className={reviewPlain}
                      disabled={blocked || windowIndex === windows.length - 1}
                      onClick={() =>
                        setWindowIndex((index) =>
                          Math.min(windows.length - 1, index + 1),
                        )
                      }
                    >
                      {copy.nextWindow}
                    </button>
                    <button
                      type="button"
                      className={reviewPlain}
                      disabled={blocked || windows.length >= 16}
                      onClick={() => {
                        clearResult();
                        setWindows((previous) =>
                          previous.length >= 16
                            ? previous
                            : [
                                ...previous,
                                { ...(previous[windowIndex] ?? previous[0]) },
                              ],
                        );
                        setWindowIndex(windows.length);
                      }}
                    >
                      {copy.addWindow}
                    </button>
                    <button
                      type="button"
                      className={reviewPlain}
                      disabled={blocked || windows.length === 1}
                      onClick={() => {
                        clearResult();
                        setWindows((previous) =>
                          previous.length <= 1
                            ? previous
                            : previous.filter(
                                (_, index) => index !== windowIndex,
                              ),
                        );
                        setWindowIndex((index) => Math.max(0, index - 1));
                      }}
                    >
                      {copy.removeWindow}
                    </button>
                  </div>
                </section>
                <details className="space-y-3 rounded-2xl border border-[var(--surface-separator)] p-3">
                  <summary className="min-h-11 cursor-pointer py-2 font-medium">
                    {copy.otherBuffers} · {Object.keys(others).length}
                  </summary>
                  <label className="block text-footnote">
                    {copy.search}
                    <input
                      type="search"
                      maxLength={100}
                      className="input-apple mt-1 min-h-11"
                      disabled={blocked}
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </label>
                  <p className="text-footnote text-label-secondary">
                    {copy.searchHint}
                  </p>
                  <div className="space-y-1">
                    {otherMatches.map((event) => (
                      <button
                        type="button"
                        key={event.id}
                        className={`${reviewPlain} block w-full break-words text-left`}
                        disabled={
                          blocked ||
                          (!Object.hasOwn(others, event.id) &&
                            Object.keys(others).length >= 100)
                        }
                        onClick={() => {
                          clearResult();
                          setOtherId(event.id);
                          setOthers((previous) =>
                            Object.hasOwn(previous, event.id)
                              ? previous
                              : {
                                  ...previous,
                                  [event.id]: {
                                    sourceToken: event.sourceToken,
                                    buffers: { ...EMPTY_BUFFER_DRAFT },
                                  },
                                },
                          );
                        }}
                      >
                        {event.title || copy.untitled}
                      </button>
                    ))}
                  </div>
                  {otherMatches.length === 0 && (
                    <p className="text-footnote text-label-secondary">
                      {copy.noMatches}
                    </p>
                  )}
                  {Object.keys(others).length > 0 && (
                    <label className="block text-footnote">
                      {copy.otherBuffers}
                      <select
                        className="input-apple mt-1 min-h-11"
                        value={otherId ?? ""}
                        disabled={blocked}
                        onChange={(event) =>
                          setOtherId(event.target.value || null)
                        }
                      >
                        <option
                          value=""
                          className="bg-[var(--surface-grouped)] text-label-primary"
                        >
                          {copy.search}
                        </option>
                        {Object.keys(others).map((id, index) => (
                          <option
                            key={id}
                            value={id}
                            className="bg-[var(--surface-grouped)] text-label-primary"
                          >
                            {snapshot.events.find((event) => event.id === id)
                              ?.title || `${copy.otherChanged} ${index + 1}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {otherId && otherDraft && (
                    <section className="space-y-2 border-t border-[var(--surface-separator)] pt-3">
                      <h4 className="break-words font-medium">
                        {currentOther
                          ? currentOther.title || copy.untitled
                          : copy.otherChanged}
                      </h4>
                      {(!currentOther ||
                        currentOther.sourceToken !==
                          otherDraft.sourceToken) && (
                        <p role="status">{copy.otherChanged}</p>
                      )}
                      <BufferFields
                        value={otherDraft.buffers}
                        disabled={blocked}
                        onChange={(value) => {
                          clearResult();
                          setOthers((previous) => ({
                            ...previous,
                            [otherId]: { ...otherDraft, buffers: value },
                          }));
                        }}
                      />
                      {currentOther &&
                        currentOther.sourceToken !== otherDraft.sourceToken && (
                          <button
                            type="button"
                            className={reviewPlain}
                            disabled={blocked}
                            onClick={() => {
                              clearResult();
                              setOthers((previous) => ({
                                ...previous,
                                [otherId]: {
                                  ...otherDraft,
                                  sourceToken: currentOther.sourceToken,
                                },
                              }));
                            }}
                          >
                            {copy.reviewOther}
                          </button>
                        )}
                      <button
                        type="button"
                        className={reviewPlain}
                        disabled={blocked}
                        onClick={() => {
                          clearResult();
                          setOthers((previous) => {
                            const next = { ...previous };
                            delete next[otherId];
                            return next;
                          });
                          setOtherId(null);
                        }}
                      >
                        {copy.removeOther}
                      </button>
                    </section>
                  )}
                </details>
                <label className="block text-footnote">
                  {copy.grid}
                  <select
                    className="input-apple mt-1 min-h-11"
                    value={grid}
                    disabled={blocked}
                    onChange={(event) => {
                      clearResult();
                      setGrid(
                        Number(
                          event.target.value,
                        ) as ScheduleReviewQuery["gridMinutes"],
                      );
                    }}
                  >
                    {[5, 10, 15, 30, 60].map((value) => (
                      <option
                        key={value}
                        value={value}
                        className="bg-[var(--surface-grouped)] text-label-primary"
                      >
                        {value} {copy.minutes}
                      </option>
                    ))}
                  </select>
                </label>
              </form>
            )}
            {step === "options" && result && (
              <>
                <h3 className="font-semibold">{copy.options}</h3>
                {holds(result.plan)}
                {result.plan.alternatives.length === 0 ? (
                  <p>{copy.noOptions}</p>
                ) : (
                  <div className="space-y-2">
                    {result.plan.alternatives.map((option) => (
                      <button
                        type="button"
                        key={option.start}
                        className={`${reviewPlain} block w-full space-y-1 text-left`}
                        disabled={blocked}
                        onClick={() => {
                          setChoice(option);
                          setConfirmOtherIndex(0);
                          setStep("confirm");
                        }}
                      >
                        <span className="block">
                          {date(option.start)} – {date(option.end)}
                        </span>
                        {option.provisional && (
                          <span className="block text-footnote">
                            {copy.provisional}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {constraints(result.plan)}
              </>
            )}
            {step === "confirm" && result && choice && (
              <section className="space-y-3">
                <h3 className="font-semibold">{copy.preview}</h3>
                <div>
                  <h4 className="font-medium">{copy.before}</h4>
                  <p>
                    {date(result.plan.target.start)} –{" "}
                    {date(result.plan.target.end)}
                  </p>
                </div>
                <div>
                  <h4 className="font-medium">{copy.after}</h4>
                  <p>
                    {date(choice.start)} – {date(choice.end)}
                  </p>
                  <p className="text-footnote">
                    {copy.duration}: {duration(choice.start, choice.end)}
                  </p>
                </div>
                <p className="text-callout">
                  {bufferSummary(result.query.buffers)}
                </p>
                <p className="text-footnote">
                  {copy.reserved}: {date(choice.reservedStart)} –{" "}
                  {date(choice.reservedEnd)}
                </p>
                {result.query.otherBuffers.length > 0 && (
                  <details>
                    <summary className="min-h-11 cursor-pointer py-2">
                      {copy.otherBuffers} · {result.query.otherBuffers.length}
                    </summary>
                    {(() => {
                      const index = Math.min(
                          confirmOtherIndex,
                          result.query.otherBuffers.length - 1,
                        ),
                        row = result.query.otherBuffers[index];
                      return (
                        <div className="space-y-2">
                          <p className="break-words font-medium">
                            {result.snapshot.events.find(
                              (event) => event.id === row.id,
                            )?.title || copy.untitled}{" "}
                            · {index + 1}/{result.query.otherBuffers.length}
                          </p>
                          <p className="text-footnote">
                            {bufferSummary(row.buffers)}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className={reviewPlain}
                              disabled={session.busy || index === 0}
                              onClick={() =>
                                setConfirmOtherIndex((value) =>
                                  Math.max(0, value - 1),
                                )
                              }
                            >
                              {copy.previousItem}
                            </button>
                            <button
                              type="button"
                              className={reviewPlain}
                              disabled={
                                session.busy ||
                                index === result.query.otherBuffers.length - 1
                              }
                              onClick={() =>
                                setConfirmOtherIndex((value) =>
                                  Math.min(
                                    result.query.otherBuffers.length - 1,
                                    value + 1,
                                  ),
                                )
                              }
                            >
                              {copy.nextItem}
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </details>
                )}
                <p className="text-callout text-label-secondary">
                  {copy.moveHint}
                </p>
                <p className="text-footnote text-label-secondary">
                  {copy.freshHint}
                </p>
                {holds(result.plan)}
              </section>
            )}
            <Link
              className={`${reviewPlain} inline-flex items-center`}
              href="/dashboard/calendar"
              onClick={(event) => navigateAway(event, "/dashboard/calendar")}
            >
              {copy.calendar}
            </Link>
          </>
        )}
      </div>
    </Dialog>
  );
}
