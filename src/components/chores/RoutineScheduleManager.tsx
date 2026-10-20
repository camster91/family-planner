"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { parseDateOnly } from "@/lib/dates";
import { Dialog } from "@/components/ui/dialog";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import { RoutineScheduleEditor } from "@/components/chores/RoutineScheduleEditor";
import { useRoutineScheduleText } from "@/i18n/routine-schedule";
import { useTranslation } from "@/i18n";
import { formatWeeklyDays } from "@/lib/chore-weekdays";
import { sameQueueOwner } from "@/lib/queue-owner-contract";
import { OwnedRequestRecoveryError } from "@/lib/owned-request-journal";
import { browserRoutineRecovery } from "@/lib/routine-schedule-recovery-browser";
import {
  readRoutineRecoveryContext,
  readRoutineRecoveryReview,
  readRoutineCatalog,
  readRoutineState,
  makeRoutineScheduleIntent,
  postRoutineSchedule,
} from "@/lib/routine-schedule-client";
import {
  newRoutineDraft,
  routineDraftFromState,
  routineEditorCommand,
  type RoutineEditorDraft,
} from "@/lib/routine-schedule-editor";
import {
  routineScheduleCommand,
  routineViewerDay,
} from "@/lib/routine-schedule";
import type {
  RoutineRecoveryContext,
  RoutineRecoveryEntry,
  RoutineRecoveryReview,
} from "@/lib/routine-schedule-recovery-contract";
import type { RoutineScheduleCatalog } from "@/lib/routine-schedule-view";
type Store = ReturnType<typeof browserRoutineRecovery>;
export default function RoutineScheduleManager({
  userId,
  familyId,
  initialStackId,
}: {
  userId: string;
  familyId: string;
  initialStackId?: string;
}) {
  const t = useRoutineScheduleText(),
    { locale } = useTranslation(),
    router = useRouter();
  const store = React.useRef<Store | null>(null),
    context = React.useRef<RoutineRecoveryContext | null>(null),
    epoch = React.useRef(0),
    flight = React.useRef(false),
    mounted = React.useRef(true);
  const [catalog, setCatalog] = React.useState<RoutineScheduleCatalog | null>(
      null,
    ),
    [entries, setEntries] = React.useState<RoutineRecoveryEntry[]>([]),
    [reviews, setReviews] = React.useState<
      Record<string, RoutineRecoveryReview>
    >({});
  const [authorized, setAuthorized] = React.useState(false),
    [busy, setBusy] = React.useState(true),
    [saving, setSaving] = React.useState(false),
    [notice, setNotice] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<RoutineEditorDraft | null>(null),
    [editorOpen, setEditorOpen] = React.useState(false);
  const [control, setControl] = React.useState<RoutineRecoveryEntry | null>(
      null,
    ),
    [dismiss, setDismiss] = React.useState<string | null>(null),
    [discardDraft, setDiscardDraft] = React.useState(false);
  usePendingFormNavigationController(saving);
  const available = authorized && context.current?.enabled === true;
  const blocked = busy || entries.length > 0;
  async function current() {
    const next = await readRoutineRecoveryContext();
    if (
      next.userId !== userId ||
      next.familyId !== familyId ||
      !next.owner ||
      (context.current?.owner &&
        !sameQueueOwner(context.current.owner, next.owner))
    )
      throw new OwnedRequestRecoveryError("OWNER_CHANGED");
    return next;
  }
  async function run(task: () => Promise<void>) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    const token = epoch.current;
    try {
      await task();
    } catch (caught) {
      if (mounted.current && token === epoch.current) {
        setAuthorized(false);
        setNotice(
          t(
            caught instanceof OwnedRequestRecoveryError &&
              caught.reason === "OWNER_CHANGED"
              ? "owner"
              : "storage",
          ),
        );
        if (
          caught instanceof OwnedRequestRecoveryError &&
          caught.reason === "OWNER_CHANGED"
        ) {
          setDraft(null);
          setEditorOpen(false);
          setCatalog(null);
          setEntries([]);
          setReviews({});
        }
      }
    } finally {
      flight.current = false;
      if (mounted.current) {
        if (token === epoch.current) {
          setBusy(false);
          setSaving(false);
        } else if (document.visibilityState !== "hidden") {
          setSaving(false);
          void run(load);
        }
      }
    }
  }
  async function load() {
    const token = epoch.current,
      next = await current();
    if (!store.current)
      store.current = browserRoutineRecovery({ userId, familyId });
    const saved = await store.current.initialize(),
      data = await readRoutineCatalog(next);
    const fresh = await current();
    if (!sameQueueOwner(next.owner!, fresh.owner!))
      throw new OwnedRequestRecoveryError("OWNER_CHANGED");
    if (
      !mounted.current ||
      token !== epoch.current ||
      document.visibilityState === "hidden"
    )
      return;
    context.current = fresh;
    setEntries(saved.map(({ kind, key, body }) => ({ kind, key, body })));
    setCatalog(data);
    setAuthorized(true);
    setNotice(null);
    setBusy(false);
  }
  React.useEffect(() => {
    mounted.current = true;
    void run(load);
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        epoch.current += 1;
        setAuthorized(false);
        setBusy(false);
      } else if (!flight.current) void run(load);
    };
    const focus = () => {
      if (!flight.current && document.visibilityState !== "hidden") {
        setAuthorized(false);
        void run(load);
      }
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", focus);
    return () => {
      mounted.current = false;
      epoch.current += 1;
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", focus);
    };
    // A different actor gets a fresh controller, never a migrated journal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, familyId, locale]);
  React.useEffect(() => {
    if (!draft) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [draft]);
  async function openEditor(stackId: string) {
    if (!available || blocked || draft) return;
    await run(async () => {
      const token = epoch.current,
        next = await current(),
        state = await readRoutineState(stackId, next),
        fresh = await current();
      if (!sameQueueOwner(next.owner!, fresh.owner!))
        throw new OwnedRequestRecoveryError("OWNER_CHANGED");
      if (
        !mounted.current ||
        token !== epoch.current ||
        state.config.state === "stopped"
      )
        return;
      setDraft(routineDraftFromState(state));
      setEditorOpen(true);
      setNotice(null);
    });
  }
  const initialOpened = React.useRef(false);
  React.useEffect(() => {
    if (
      authorized &&
      available &&
      initialStackId &&
      !blocked &&
      !initialOpened.current
    ) {
      initialOpened.current = true;
      void openEditor(initialStackId);
    }
  }, [authorized, available, blocked, initialStackId, openEditor]);
  async function send(entry: RoutineRecoveryEntry, recovered: boolean) {
    const token = epoch.current;
    setSaving(true);
    if (!store.current) throw new OwnedRequestRecoveryError("UNAVAILABLE");
    const result = await store.current.send(
      entry.key,
      recovered,
      (original, owner) => postRoutineSchedule(original, owner),
    );
    if (!mounted.current || token !== epoch.current) return;
    if (result.kind === "confirmed") {
      const fresh = await current();
      if (!mounted.current || token !== epoch.current) return;
      setReviews((old) => ({
        ...old,
        [entry.key]: {
          contract: "herewoven.routine-recovery.v1",
          ownerScope: fresh.owner!.scope,
          entry,
          state: "committed",
          canRetry: false,
          currentVersion: result.receipt.version,
          receipt: result.receipt,
        },
      }));
      setDraft(null);
      setEditorOpen(false);
      setControl(null);
      setNotice(t("saved"));
      const data = await readRoutineCatalog(fresh);
      await current();
      if (mounted.current && token === epoch.current) {
        setCatalog(data);
        router.refresh();
      }
    } else {
      setNotice(
        t(
          result.kind === "unknown"
            ? "uncertain"
            : result.kind === "removed"
              ? "removedResult"
              : "refused",
        ),
      );
    }
  }
  function submit(entry: RoutineRecoveryEntry) {
    if (blocked || !available) return;
    void run(async () => {
      const token = epoch.current;
      setSaving(true);
      await store.current!.stage(entry);
      if (!mounted.current || token !== epoch.current) return;
      setEntries((old) => [...old, entry]);
      await send(entry, false);
    });
  }
  function save(review: { at: Date; zone: string }) {
    if (!draft || !context.current) return;
    try {
      submit(
        makeRoutineScheduleIntent(
          routineEditorCommand(draft),
          context.current,
          review.zone,
          review.at,
        ),
      );
    } catch {
      setNotice(t("invalid"));
    }
  }
  async function prepareControl(
    stackId: string,
    action: "pause" | "resume" | "stop",
  ) {
    if (!available || blocked || draft) return;
    await run(async () => {
      const token = epoch.current,
        next = await current(),
        state = await readRoutineState(stackId, next);
      await current();
      if (!mounted.current || token !== epoch.current) return;
      setControl(
        makeRoutineScheduleIntent(
          {
            action,
            stack_id: state.stackId,
            expected_version: state.version,
            scope: "future-after-today",
          },
          next,
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        ),
      );
    });
  }
  async function inspect(entry: RoutineRecoveryEntry) {
    await run(async () => {
      const token = epoch.current,
        review = await store.current!.inspect(
          entry.key,
          readRoutineRecoveryReview,
        );
      if (mounted.current && token === epoch.current)
        setReviews((old) => ({ ...old, [entry.key]: review }));
    });
  }
  const reviewText = (state: RoutineRecoveryReview["state"]) =>
    t(
      (
        {
          ready: "ready",
          pending: "pending",
          committed: "committed",
          removed: "removedResult",
          expired: "expired",
          conflict: "conflict",
          paused: "recoveryPaused",
          unavailable: "recoveryUnavailable",
        } as const
      )[state],
    );
  function resumePassed(row: RoutineScheduleCatalog["routines"][number]) {
    return (
      row.state === "paused" &&
      row.schedule?.frequency === "once" &&
      !!row.schedule.starts_on &&
      row.schedule.starts_on <=
        routineViewerDay(
          Intl.DateTimeFormat().resolvedOptions().timeZone,
          new Date(),
        )
    );
  }
  function requestName(entry: RoutineRecoveryEntry) {
    const command = routineScheduleCommand.parse(JSON.parse(entry.body));
    return "label" in command
      ? command.label
      : (catalog?.routines.find((row) => row.stackId === command.stack_id)
          ?.label ?? t("unknownName"));
  }
  return (
    <section className="space-y-5 min-w-0">
      <Link
        href="/dashboard/chores"
        className="inline-flex min-h-[44px] items-center text-body text-label-secondary"
      >
        {t("return")}
      </Link>
      <header>
        <h1 className="text-title-1 text-label-primary">{t("title")}</h1>
        <p className="mt-2 text-body text-label-secondary">{t("intro")}</p>
      </header>
      {notice && (
        <p role="status" className="text-body text-label-primary">
          {notice}
        </p>
      )}
      {!authorized ? (
        <div className="space-y-3">
          <p className="text-body text-label-secondary">
            {t(busy ? "loading" : "error")}
          </p>
          <button
            className="btn-ghost min-h-[44px]"
            disabled={busy}
            onClick={() => void run(load)}
          >
            {t("retry")}
          </button>
          {store.current?.hasUncertainStorage() && (
            <button
              className="btn-ghost min-h-[44px]"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await store.current!.recoverStorage();
                  await load();
                })
              }
            >
              {t("recoverStorage")}
            </button>
          )}
        </div>
      ) : (
        <>
          {!available && (
            <p role="status" className="text-body text-label-secondary">
              {t("recoveryPaused")}
            </p>
          )}
          {entries.length > 0 && (
            <section
              aria-label={t("recovery")}
              className="rounded-2xl bg-[var(--surface-elevated)] p-4 space-y-4"
            >
              <h2 className="text-headline text-label-primary">
                {t("recovery")}
              </h2>
              <p className="text-footnote text-label-secondary">{t("hold")}</p>
              {entries.map((entry) => (
                <article
                  key={entry.key}
                  className="space-y-2 border-t border-[var(--surface-separator)] pt-3"
                >
                  <h3 className="text-body text-label-primary [overflow-wrap:anywhere]">
                    {requestName(entry)}
                  </h3>
                  <p className="text-footnote text-label-secondary">
                    {reviews[entry.key]
                      ? reviewText(reviews[entry.key].state)
                      : t("uncertain")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="btn-ghost min-h-[44px]"
                      disabled={busy}
                      onClick={() => void inspect(entry)}
                    >
                      {t("check")}
                    </button>
                    {reviews[entry.key]?.canRetry && (
                      <button
                        className="btn-filled min-h-[44px]"
                        disabled={busy || !available}
                        onClick={() => void run(() => send(entry, true))}
                      >
                        {t("retryOriginal")}
                      </button>
                    )}
                    <button
                      className="btn-ghost min-h-[44px]"
                      disabled={busy}
                      onClick={() => setDismiss(entry.key)}
                    >
                      {t("dismiss")}
                    </button>
                  </div>
                </article>
              ))}
            </section>
          )}
          {draft ? (
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-filled min-h-[44px]"
                disabled={busy}
                onClick={() => setEditorOpen(true)}
              >
                {t("continueDraft")}
              </button>
              <button
                className="btn-ghost min-h-[44px]"
                disabled={blocked}
                onClick={() => setDiscardDraft(true)}
              >
                {t("cancel")}
              </button>
            </div>
          ) : (
            <button
              className="btn-filled min-h-[44px]"
              disabled={!available || blocked || !catalog}
              onClick={() => {
                try {
                  setDraft(
                    newRoutineDraft(
                      userId,
                      catalog!.assignments,
                      catalog!.pointsEnabled,
                    ),
                  );
                  setEditorOpen(true);
                  setNotice(null);
                } catch {
                  setNotice(t("storage"));
                }
              }}
            >
              {t("create")}
            </button>
          )}
          {catalog && (
            <ul className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
              {catalog.routines.map((row) => (
                <li
                  key={row.stackId}
                  className="min-w-0 rounded-2xl border border-[var(--surface-separator)] p-4 space-y-2"
                >
                  <h2 className="text-headline text-label-primary [overflow-wrap:anywhere]">
                    {row.label}
                  </h2>
                  <p className="text-body text-label-secondary">
                    {t(row.state)}
                    {row.stepCount
                      ? ` · ${t("stepsCount", { count: row.stepCount })}`
                      : ""}
                  </p>
                  {row.schedule && (
                    <p className="text-footnote text-label-secondary">
                      {t(row.schedule.frequency)}
                      {row.schedule.frequency === "weekly"
                        ? ` · ${formatWeeklyDays(row.schedule.weekly_days, locale)}`
                        : ""}
                    </p>
                  )}
                  {resumePassed(row) && (
                    <p className="text-footnote text-label-secondary">
                      {t("noResume")}
                    </p>
                  )}
                  {["active", "paused"].includes(row.state) && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="btn-ghost min-h-[44px]"
                        disabled={!available || blocked || !!draft}
                        onClick={() => void openEditor(row.stackId)}
                      >
                        {t("edit")}
                      </button>
                      <button
                        className="btn-ghost min-h-[44px]"
                        disabled={
                          !available || blocked || !!draft || resumePassed(row)
                        }
                        onClick={() =>
                          void prepareControl(
                            row.stackId,
                            row.state === "active" ? "pause" : "resume",
                          )
                        }
                      >
                        {t(row.state === "active" ? "pause" : "resume")}
                      </button>
                      <button
                        className="btn-ghost min-h-[44px]"
                        disabled={!available || blocked || !!draft}
                        onClick={() => void prepareControl(row.stackId, "stop")}
                      >
                        {t("stop")}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {catalog?.routines.length === 0 && (
            <p className="text-body text-label-secondary">{t("empty")}</p>
          )}
          {catalog?.nextCursor && (
            <button
              className="btn-ghost min-h-[44px]"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const token = epoch.current,
                    next = await current(),
                    page = await readRoutineCatalog(next, catalog.nextCursor);
                  await current();
                  if (mounted.current && token === epoch.current)
                    setCatalog((old) =>
                      old
                        ? {
                            ...page,
                            routines: [...old.routines, ...page.routines],
                          }
                        : page,
                    );
                })
              }
            >
              {t("more")}
            </button>
          )}
          {draft && catalog && (
            <RoutineScheduleEditor
              open={editorOpen}
              draft={draft}
              assignments={catalog.assignments}
              pointsEnabled={catalog.pointsEnabled}
              locked={blocked || !available}
              saving={saving}
              error={notice}
              onChange={setDraft}
              onSave={save}
              onClose={() => setEditorOpen(false)}
            />
          )}
          <Dialog
            open={control !== null}
            title={
              control
                ? t(
                    routineScheduleCommand.parse(JSON.parse(control.body))
                      .action as "pause" | "resume" | "stop",
                  )
                : t("confirm")
            }
            closeLabel={t("close")}
            onClose={saving ? undefined : () => setControl(null)}
            footer={
              <button
                className="btn-filled min-h-[44px]"
                disabled={blocked || !available}
                onClick={() => control && submit(control)}
              >
                {t("confirm")}
              </button>
            }
          >
            <p className="text-body text-label-secondary">
              {control &&
                t("afterDay", {
                  day: new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeZone: "UTC",
                  }).format(
                    parseDateOnly(
                      routineScheduleCommand.parse(JSON.parse(control.body))
                        .view_day,
                    )!,
                  ),
                })}
            </p>
            <p className="text-body text-label-secondary">
              {control &&
                t(
                  routineScheduleCommand.parse(JSON.parse(control.body))
                    .action === "resume"
                    ? "resumeScope"
                    : routineScheduleCommand.parse(JSON.parse(control.body))
                          .action === "stop"
                      ? "stopScope"
                      : "scope",
                )}
            </p>
          </Dialog>
          <Dialog
            open={dismiss !== null || discardDraft}
            role="alertdialog"
            title={t(discardDraft ? "discardDraftTitle" : "dismissTitle")}
            description={t(discardDraft ? "discardDraftHint" : "dismissHint")}
            onClose={() => {
              setDismiss(null);
              setDiscardDraft(false);
            }}
            closeLabel={t("close")}
            footer={
              <button
                className="btn-filled min-h-[44px]"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (dismiss) {
                      await store.current!.dismiss(dismiss);
                      setEntries((old) =>
                        old.filter((entry) => entry.key !== dismiss),
                      );
                      setReviews((old) => {
                        const copy = { ...old };
                        delete copy[dismiss];
                        return copy;
                      });
                    }
                    setDraft(null);
                    setEditorOpen(false);
                    setControl(null);
                    setDismiss(null);
                    setDiscardDraft(false);
                  })
                }
              >
                {t("dismiss")}
              </button>
            }
          >
            {null}
          </Dialog>
        </>
      )}
    </section>
  );
}
