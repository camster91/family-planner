"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import { IndependentRoutineEditor } from "@/components/chores/IndependentRoutineEditor";
import { IndependentSavedRequestDetails } from "@/components/chores/IndependentSavedRequestDetails";
import { useRoutineScheduleText } from "@/i18n/routine-schedule";
import { useTranslation } from "@/i18n";
import { sameQueueOwner } from "@/lib/queue-owner-contract";
import { OwnedRequestRecoveryError } from "@/lib/owned-request-journal";
import { browserIndependentRecovery } from "@/lib/routine-independent-browser";
import { browserIndependentDraft } from "@/lib/routine-independent-draft-browser";
import {
  independentDraftFromState,
  independentDraftCommand,
  independentDraftMatchesCommand,
  sanitizeIndependentDraft,
  type IndependentEditorDraft,
} from "@/lib/routine-independent-draft-contract";
import {
  readIndependentRecoveryContext,
  readIndependentCatalog,
  readIndependentState,
  readIndependentRecoveryReview,
  makeIndependentRoutineIntent,
  postIndependentRoutineStep,
} from "@/lib/routine-independent-client";
import {
  readRoutineRecoveryContext,
  readRoutineCatalog,
} from "@/lib/routine-schedule-client";
import {
  routineIndependentCommand,
  type RoutineIndependentCatalog,
} from "@/lib/routine-independent";
import type {
  IndependentRecoveryContext,
  IndependentRecoveryEntry,
  IndependentRecoveryReview,
} from "@/lib/routine-independent-recovery";
import type { RoutineScheduleCatalog } from "@/lib/routine-schedule-view";
import { routineViewerDay } from "@/lib/routine-schedule";
import { formatWeeklyDays } from "@/lib/chore-weekdays";
export default function IndependentRoutineManager({
  userId,
  familyId,
  initialRootId,
}: {
  userId: string;
  familyId: string;
  initialRootId?: string;
}) {
  const t = useRoutineScheduleText(),
    { locale } = useTranslation(),
    router = useRouter();
  const context = React.useRef<IndependentRecoveryContext | null>(null),
    store = React.useRef<ReturnType<typeof browserIndependentRecovery> | null>(
      null,
    ),
    drafts = React.useRef<ReturnType<typeof browserIndependentDraft> | null>(
      null,
    );
  const epoch = React.useRef(0),
    draftEpoch = React.useRef(0),
    mounted = React.useRef(true),
    flight = React.useRef(false),
    draftRef = React.useRef<IndependentEditorDraft | null>(null),
    opened = React.useRef(false);
  const [authorized, setAuthorized] = React.useState(false),
    [busy, setBusy] = React.useState(true),
    [saving, setSaving] = React.useState(false),
    [writing, setWriting] = React.useState(false),
    [notice, setNotice] = React.useState<string | null>(null);
  const [catalog, setCatalog] =
      React.useState<RoutineIndependentCatalog | null>(null),
    [members, setMembers] = React.useState<RoutineScheduleCatalog | null>(null),
    [draft, setDraftState] = React.useState<IndependentEditorDraft | null>(
      null,
    ),
    [editorOpen, setEditorOpen] = React.useState(false);
  const [entries, setEntries] = React.useState<IndependentRecoveryEntry[]>([]),
    [reviews, setReviews] = React.useState<
      Record<string, IndependentRecoveryReview>
    >({}),
    [control, setControl] = React.useState<IndependentRecoveryEntry | null>(
      null,
    ),
    [dismiss, setDismiss] = React.useState<string | null>(null),
    [discard, setDiscard] = React.useState(false),
    [adopt, setAdopt] = React.useState(false);
  const dirty = draft !== null && !(drafts.current?.isSaved(draft) ?? false),
    available = authorized && context.current?.enabled === true,
    blocked = busy || entries.length > 0;
  function setDraft(value: IndependentEditorDraft | null) {
    draftRef.current = value;
    setDraftState(value);
  }
  function live(token: number) {
    return (
      mounted.current &&
      token === epoch.current &&
      document.visibilityState !== "hidden"
    );
  }
  usePendingFormNavigationController(
    saving || writing || (authorized && (dirty || editorOpen)),
    {
      onBack: () => {
        if (authorized && editorOpen) void closeEditor();
      },
      warnOnUnload: dirty || writing || saving,
    },
  );
  async function current() {
    const next = await readIndependentRecoveryContext();
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
      if (live(token)) {
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
          setCatalog(null);
          setMembers(null);
          setEntries([]);
          setReviews({});
          setEditorOpen(false);
          setControl(null);
        }
      }
    } finally {
      flight.current = false;
      if (live(token)) {
        setBusy(false);
        setSaving(false);
      } else if (mounted.current && document.visibilityState !== "hidden") {
        setSaving(false);
        void run(load);
      }
    }
  }
  async function load() {
    const token = epoch.current,
      next = await current();
    store.current ??= browserIndependentRecovery({ userId, familyId });
    drafts.current ??= browserIndependentDraft({ userId, familyId });
    const saved = await store.current.initialize(),
      restored = await drafts.current.initialize(),
      data = await readIndependentCatalog(next),
      base = await readRoutineRecoveryContext();
    if (
      base.userId !== userId ||
      base.familyId !== familyId ||
      !base.owner ||
      base.owner.generation !== next.owner!.generation ||
      base.owner.householdScope !== next.owner!.householdScope
    )
      throw new OwnedRequestRecoveryError("OWNER_CHANGED");
    const options = await readRoutineCatalog(base);
    let chosen = draftRef.current ?? restored;
    if (chosen) {
      chosen = sanitizeIndependentDraft(chosen, options.pointsEnabled);
      if (!drafts.current.isSaved(chosen))
        chosen = await drafts.current.write(chosen);
    }
    const fresh = await current();
    if (!sameQueueOwner(next.owner!, fresh.owner!))
      throw new OwnedRequestRecoveryError("OWNER_CHANGED");
    if (!live(token)) return;
    context.current = fresh;
    setDraft(chosen);
    setWriting(false);
    setCatalog(data);
    setMembers(options);
    setEntries(saved.map(({ kind, key, body }) => ({ kind, key, body })));
    setAuthorized(true);
    setNotice(null);
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
    // The parent route keys this controller to the actual actor and family.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, familyId, locale]);
  React.useEffect(() => {
    if (
      !authorized ||
      !draft ||
      !drafts.current ||
      drafts.current.isSaved(draft)
    ) {
      setWriting(false);
      return;
    }
    setWriting(true);
    const token = epoch.current,
      revision = draftEpoch.current,
      body = JSON.stringify(draft);
    const timer = setTimeout(() => {
      if (
        !live(token) ||
        revision !== draftEpoch.current ||
        JSON.stringify(draftRef.current) !== body
      )
        return;
      void drafts
        .current!.write(draft)
        .then((saved) => {
          if (
            live(token) &&
            revision === draftEpoch.current &&
            JSON.stringify(draftRef.current) === body
          ) {
            setDraft(saved);
            setWriting(false);
          }
        })
        .catch((caught) => {
          if (!live(token) || revision !== draftEpoch.current) return;
          setAuthorized(false);
          setWriting(false);
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
            setCatalog(null);
            setMembers(null);
            setEntries([]);
            setReviews({});
            setEditorOpen(false);
          }
        });
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, authorized]);
  async function closeEditor() {
    if (busy || saving) return;
    await run(async () => {
      const token = epoch.current;
      if (draftRef.current) {
        const saved = await drafts.current!.write(draftRef.current);
        if (live(token)) setDraft(saved);
      }
      if (live(token)) {
        setWriting(false);
        setEditorOpen(false);
      }
    });
  }
  async function clearDraft() {
    const token = epoch.current;
    draftEpoch.current += 1;
    setSaving(true);
    await drafts.current!.clear();
    draftRef.current = null;
    if (live(token)) {
      setDraftState(null);
      setWriting(false);
    }
  }
  async function openEditor(rootId: string) {
    if (!available || blocked || draft) return;
    await run(async () => {
      const token = epoch.current,
        next = await current(),
        state = await readIndependentState(rootId, next);
      await current();
      if (!live(token) || state.state === "stopped") return;
      draftEpoch.current += 1;
      const saved = await drafts.current!.begin(
        independentDraftFromState(state),
      );
      if (live(token)) {
        setDraft(saved);
        setEditorOpen(true);
      }
    });
  }
  React.useEffect(() => {
    if (
      !authorized ||
      !available ||
      blocked ||
      !initialRootId ||
      opened.current
    )
      return;
    opened.current = true;
    if (!draft) void openEditor(initialRootId);
  }, [authorized, available, blocked, initialRootId, draft]);
  async function send(entry: IndependentRecoveryEntry, recovered: boolean) {
    const token = epoch.current;
    setSaving(true);
    const result = await store.current!.send(
      entry.key,
      recovered,
      postIndependentRoutineStep,
    );
    if (!live(token)) return;
    if (result.kind === "confirmed") {
      const fresh = await current();
      if (!live(token)) return;
      setReviews((old) => ({
        ...old,
        [entry.key]: {
          contract: "herewoven.routine-independent-recovery.v1",
          ownerScope: fresh.owner!.scope,
          entry,
          state: "committed",
          canRetry: false,
          currentRevision: result.receipt.revision,
          receipt: result.receipt,
        },
      }));
      if (
        !draftRef.current ||
        independentDraftMatchesCommand(draftRef.current, JSON.parse(entry.body))
      )
        await clearDraft();
      if (!live(token)) return;
      setEditorOpen(false);
      setControl(null);
      setNotice(t("saved"));
      const data = await readIndependentCatalog(fresh);
      await current();
      if (live(token)) {
        setCatalog(data);
        router.refresh();
      }
    } else
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
  function submit(entry: IndependentRecoveryEntry) {
    if (blocked || !available) return;
    void run(async () => {
      const token = epoch.current;
      setSaving(true);
      if (draftRef.current) await drafts.current!.write(draftRef.current);
      await store.current!.stage(entry);
      if (!live(token)) return;
      setEntries((old) => [...old, entry]);
      await send(entry, false);
    });
  }
  function save(review: { at: Date; zone: string }) {
    if (!draft || !context.current) return;
    try {
      const command = independentDraftCommand(
        draft,
        context.current,
        review.at,
        review.zone,
        routineViewerDay(review.zone, review.at),
      );
      submit(
        makeIndependentRoutineIntent(
          command,
          context.current,
          review.zone,
          review.at,
        ),
      );
    } catch {
      setNotice(t("invalid"));
    }
  }
  async function prepare(rootId: string, action: "pause" | "resume" | "stop") {
    if (!available || blocked || draft) return;
    await run(async () => {
      const token = epoch.current,
        next = await current(),
        state = await readIndependentState(rootId, next);
      await current();
      if (!live(token)) return;
      setControl(
        makeIndependentRoutineIntent(
          {
            root_id: rootId,
            expected_revision: state.revision,
            action,
            scope: "future-after-today",
          },
          next,
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        ),
      );
    });
  }
  const reviewText = (state: IndependentRecoveryReview["state"]) =>
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
  const resumePassed = (row: RoutineIndependentCatalog["steps"][number]) =>
    row.state === "paused" &&
    row.schedule?.frequency === "once" &&
    !!row.schedule.starts_on &&
    row.schedule.starts_on <=
      routineViewerDay(
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        new Date(),
      );
  return (
    <section className="space-y-5 min-w-0">
      <Link
        href="/dashboard/chores/schedules"
        className="inline-flex min-h-[44px] items-center text-body text-label-secondary"
      >
        {t("returnRoutines")}
      </Link>
      <header>
        <h1 className="text-title-1 text-label-primary">
          {t("independentTitle")}
        </h1>
        <p className="mt-2 text-body text-label-secondary">
          {t("independentIntro")}
        </p>
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
          {(store.current?.hasUncertainStorage() ||
            drafts.current?.hasUncertainStorage()) && (
            <button
              className="btn-ghost min-h-[44px]"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const token = epoch.current;
                  draftEpoch.current += 1;
                  if (store.current?.hasUncertainStorage())
                    await store.current.recoverStorage();
                  if (drafts.current?.hasUncertainStorage()) {
                    const restored = await drafts.current.recoverStorage();
                    draftRef.current = restored;
                    if (!live(token)) return;
                    setDraftState(restored);
                  }
                  await load();
                })
              }
            >
              {t("recoverStorage")}
            </button>
          )}
          {drafts.current?.hasConflict() && (
            <button
              className="btn-ghost min-h-[44px]"
              disabled={busy}
              onClick={() => setAdopt(true)}
            >
              {t("loadDraft")}
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
          {draft && (
            <>
              <p role="status" className="text-footnote text-label-secondary">
                {t(dirty || writing ? "draftSaving" : "draftSaved")}
              </p>
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
                  onClick={() => setDiscard(true)}
                >
                  {t("cancel")}
                </button>
              </div>
            </>
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
                  <p className="text-body text-label-secondary">
                    {reviews[entry.key]
                      ? reviewText(reviews[entry.key].state)
                      : t("uncertain")}
                  </p>
                  <IndependentSavedRequestDetails
                    entry={entry}
                    assignments={members?.assignments ?? []}
                    pointsEnabled={members?.pointsEnabled === true}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="btn-ghost min-h-[44px]"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const token = epoch.current,
                            review = await store.current!.inspect(
                              entry.key,
                              readIndependentRecoveryReview,
                            );
                          if (live(token))
                            setReviews((old) => ({
                              ...old,
                              [entry.key]: review,
                            }));
                        })
                      }
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
          {catalog?.steps.length === 0 && (
            <p className="text-body text-label-secondary">
              {t("independentEmpty")}
            </p>
          )}
          <ul className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
            {catalog?.steps.map((row) => (
              <li
                key={row.rootId}
                className="min-w-0 rounded-2xl border border-[var(--surface-separator)] p-4 space-y-2"
              >
                <h2 className="text-headline text-label-primary [overflow-wrap:anywhere]">
                  {row.title}
                </h2>
                <p className="text-body text-label-secondary">
                  {t(row.state)}
                  {row.schedule ? ` · ${t(row.schedule.frequency)}` : ""}
                </p>
                {row.schedule?.frequency === "weekly" && (
                  <p className="text-footnote text-label-secondary">
                    {formatWeeklyDays(row.schedule.weekly_days, locale)}
                  </p>
                )}
                {resumePassed(row) && (
                  <p className="text-footnote text-label-secondary">
                    {t("noResume")}
                  </p>
                )}
                {(row.state === "active" || row.state === "paused") && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="btn-ghost min-h-[44px]"
                      disabled={!available || blocked || !!draft}
                      onClick={() => void openEditor(row.rootId)}
                    >
                      {t("edit")}
                    </button>
                    <button
                      className="btn-ghost min-h-[44px]"
                      disabled={
                        !available || blocked || !!draft || resumePassed(row)
                      }
                      onClick={() =>
                        void prepare(
                          row.rootId,
                          row.state === "active" ? "pause" : "resume",
                        )
                      }
                    >
                      {t(row.state === "active" ? "pause" : "resume")}
                    </button>
                    <button
                      className="btn-ghost min-h-[44px]"
                      disabled={!available || blocked || !!draft}
                      onClick={() => void prepare(row.rootId, "stop")}
                    >
                      {t("stop")}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {catalog?.nextCursor && (
            <button
              className="btn-ghost min-h-[44px]"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const token = epoch.current,
                    cursor = catalog.nextCursor,
                    next = await current(),
                    page = await readIndependentCatalog(next, cursor);
                  await current();
                  if (live(token))
                    setCatalog((old) =>
                      old
                        ? {
                            ...page,
                            steps: [
                              ...old.steps,
                              ...page.steps.filter(
                                (row) =>
                                  !old.steps.some(
                                    (existing) =>
                                      existing.rootId === row.rootId,
                                  ),
                              ),
                            ],
                          }
                        : page,
                    );
                })
              }
            >
              {t("more")}
            </button>
          )}
          {draft && members && (
            <IndependentRoutineEditor
              key={`${draft.rootId}:${draft.revision}`}
              open={editorOpen}
              draft={draft}
              assignments={members.assignments}
              pointsEnabled={members.pointsEnabled}
              locked={blocked || !available}
              saving={saving || busy}
              error={notice}
              onChange={setDraft}
              onClose={() => void closeEditor()}
              onSave={save}
            />
          )}
          <Dialog
            open={control !== null}
            variant="form"
            title={
              control
                ? t(
                    routineIndependentCommand.parse(JSON.parse(control.body))
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
              {t(
                control &&
                  routineIndependentCommand.parse(JSON.parse(control.body))
                    .action === "resume"
                  ? "resumeScope"
                  : control &&
                      routineIndependentCommand.parse(JSON.parse(control.body))
                        .action === "stop"
                    ? "stopScope"
                    : "scope",
              )}
            </p>
          </Dialog>
          <Dialog
            open={dismiss !== null || discard}
            role="alertdialog"
            title={t(discard ? "discardDraftTitle" : "dismissTitle")}
            description={t(
              discard
                ? "discardDraftHint"
                : draft
                  ? "dismissDraftHint"
                  : "dismissHint",
            )}
            closeLabel={t("close")}
            onClose={() => {
              setDismiss(null);
              setDiscard(false);
            }}
            footer={
              <button
                className="btn-filled min-h-[44px]"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const token = epoch.current,
                      key = dismiss;
                    await clearDraft();
                    if (!live(token)) return;
                    if (key) {
                      await store.current!.dismiss(key);
                      if (!live(token)) return;
                      setEntries((old) => old.filter((row) => row.key !== key));
                      setReviews((old) => {
                        const next = { ...old };
                        delete next[key];
                        return next;
                      });
                    }
                    setDismiss(null);
                    setDiscard(false);
                    setEditorOpen(false);
                    setControl(null);
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
      <Dialog
        open={adopt}
        role="alertdialog"
        title={t("loadDraft")}
        description={t("loadDraftHint")}
        closeLabel={t("close")}
        onClose={() => setAdopt(false)}
        footer={
          <button
            className="btn-filled min-h-[44px]"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const token = epoch.current;
                draftEpoch.current += 1;
                const restored = await drafts.current!.adoptStored();
                draftRef.current = restored;
                if (!live(token)) return;
                setDraftState(restored);
                setAdopt(false);
                await load();
              })
            }
          >
            {t("confirm")}
          </button>
        }
      >
        {null}
      </Dialog>
    </section>
  );
}
