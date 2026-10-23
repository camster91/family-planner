"use client";
import * as React from "react";
import { OwnedRequestRecoveryError } from "@/lib/owned-request-journal";
import { browserScheduleRecovery } from "@/lib/calendar-planning/schedule-browser";
import {
  readScheduleContext,
  readScheduleSnapshot,
  readSchedulePreview,
  makeScheduleIntent,
  inspectSchedule,
  sendSchedule,
} from "@/lib/calendar-planning/schedule-client";
import { notifyCalendarChanged } from "@/lib/calendar-planning/changes";
import type {
  ScheduleReviewScope,
  ScheduleReviewQuery,
} from "@/lib/calendar-planning/conflict-review";
import type { scheduleReadReply } from "@/lib/calendar-planning/schedule-http";
import type {
  ScheduleRecoveryContext,
  ScheduleRecoveryEntry,
  scheduleRecoveryReview,
} from "@/lib/calendar-planning/schedule-recovery";
import { ScheduleDraftError } from "@/lib/calendar-planning/schedule-form";
type Reply = ReturnType<typeof scheduleReadReply.parse>;
type Review = ReturnType<typeof scheduleRecoveryReview.parse>;
export function useScheduleReviewSession(initialScope: ScheduleReviewScope) {
  const alive = React.useRef(false),
    epoch = React.useRef(0),
    operation = React.useRef(false),
    ownerHeld = React.useRef(false);
  const store = React.useRef<ReturnType<typeof browserScheduleRecovery> | null>(
      null,
    ),
    contextRef = React.useRef<ScheduleRecoveryContext | null>(null),
    viewRef = React.useRef<Reply | null>(null),
    rowsRef = React.useRef<ScheduleRecoveryEntry[]>([]),
    scopeRef = React.useRef(initialScope);
  const freshRef = React.useRef(false);
  const savedStage = React.useRef<ScheduleRecoveryEntry | null>(null),
    storageAction = React.useRef<"stage" | "dismiss" | null>(null);
  const [reply, setReply] = React.useState<Reply | null>(null),
    [context, setContext] = React.useState<ScheduleRecoveryContext | null>(
      null,
    ),
    [entries, setEntries] = React.useState<ScheduleRecoveryEntry[]>([]),
    [reviews, setReviews] = React.useState<Record<string, Review>>({});
  const [busy, setBusy] = React.useState(true),
    [fresh, setFresh] = React.useState(false),
    [error, setError] = React.useState(false),
    [draftError, setDraftError] = React.useState(false),
    [storageError, setStorageError] = React.useState(false);
  const [notice, setNotice] = React.useState<
    "changed" | "ownerChanged" | "unknown" | "refused" | "proof" | null
  >(null);
  const updateFresh = (value: boolean) => {
    freshRef.current = value;
    setFresh(value);
  };
  const current = (version: number) =>
    alive.current && epoch.current === version;
  function rows(value: ScheduleRecoveryEntry[]) {
    rowsRef.current = value;
    setEntries(value);
  }
  function hold() {
    ownerHeld.current = true;
    viewRef.current = null;
    setReply(null);
    rows([]);
    setReviews({});
    updateFresh(false);
    setContext(null);
    setStorageError(true);
    setNotice("ownerChanged");
  }
  async function freshContext(version: number) {
    if (ownerHeld.current) throw new Error("Owner changed");
    const next = await readScheduleContext();
    if (!current(version)) return null;
    const original = contextRef.current;
    if (
      original &&
      (next.userId !== original.userId ||
        next.familyId !== original.familyId ||
        next.role !== original.role ||
        next.owner?.scope !== original.owner?.scope)
    ) {
      hold();
      throw new Error("Owner changed");
    }
    contextRef.current = next;
    setContext(next);
    return next;
  }
  async function load(scope: ScheduleReviewScope, version: number) {
    updateFresh(false);
    const owner = await freshContext(version);
    if (!current(version) || !owner) return null;
    const value = await readScheduleSnapshot(scope, owner);
    if (!current(version)) return null;
    const previous = viewRef.current?.snapshot.events.find(
        (event) => event.id === scope.targetId,
      ),
      next = value.snapshot.events.find((event) => event.id === scope.targetId);
    if (previous && next && previous.sourceToken !== next.sourceToken)
      setNotice("changed");
    viewRef.current = value;
    setReply(value);
    scopeRef.current = {
      targetId: scope.targetId,
      range: value.snapshot.range,
      timeZone: value.snapshot.timeZone,
    };
    updateFresh(true);
    return value;
  }
  React.useEffect(() => {
    alive.current = true;
    const version = ++epoch.current,
      overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    void (async () => {
      try {
        const owner = await freshContext(version);
        if (!current(version) || !owner) return;
        if (!store.current) store.current = browserScheduleRecovery(owner);
        try {
          const recovered = await store.current.initialize();
          if (current(version)) {
            rows(recovered);
            setStorageError(false);
          }
        } catch (caught) {
          if (current(version)) {
            setStorageError(true);
            if (
              caught instanceof OwnedRequestRecoveryError &&
              caught.reason === "OWNER_CHANGED"
            )
              hold();
          }
        }
        // Recovery must survive a missing or newly forbidden current event.
        if (current(version)) await load(initialScope, version);
      } catch {
        if (current(version)) setError(true);
      } finally {
        if (current(version)) setBusy(false);
      }
    })();
    return () => {
      alive.current = false;
      epoch.current++;
      document.body.style.overflow = overflow;
    };
    // Host keys the original scope. Locale changes must not recreate the journal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function run(work: (version: number) => Promise<void>) {
    if (operation.current || !alive.current || ownerHeld.current) return;
    operation.current = true;
    const version = epoch.current;
    setBusy(true);
    setError(false);
    setDraftError(false);
    setNotice(null);
    try {
      await work(version);
    } catch (caught) {
      if (current(version)) {
        updateFresh(false);
        if (caught instanceof ScheduleDraftError) setDraftError(true);
        else setError(true);
        if (store.current?.hasUncertainStorage()) setStorageError(true);
        if (
          caught instanceof OwnedRequestRecoveryError &&
          caught.reason === "OWNER_CHANGED"
        )
          hold();
      }
    } finally {
      operation.current = false;
      if (current(version)) setBusy(false);
    }
  }
  async function dismiss(entry: ScheduleRecoveryEntry, version: number) {
    if (!store.current || !current(version)) return;
    storageAction.current = "dismiss";
    try {
      await store.current.dismiss(entry.key);
    } catch (caught) {
      if (current(version)) setStorageError(true);
      throw caught;
    }
    storageAction.current = null;
    if (!current(version)) return;
    rows(rowsRef.current.filter((row) => row.key !== entry.key));
    savedStage.current = null;
    setReviews((value) => {
      const next = { ...value };
      delete next[entry.key];
      return next;
    });
  }
  async function confirmed(entry: ScheduleRecoveryEntry, version: number) {
    if (!current(version)) return;
    updateFresh(false);
    viewRef.current = null;
    setReply(null);
    setNotice("proof");
    notifyCalendarChanged();
    await dismiss(entry, version);
    if (current(version)) await load(scopeRef.current, version);
  }
  async function send(entry: ScheduleRecoveryEntry, version: number) {
    if (!store.current || !current(version)) return;
    const result = await store.current.send(entry.key, true, sendSchedule);
    if (!current(version)) return;
    if (result.kind === "confirmed") await confirmed(entry, version);
    else {
      updateFresh(false);
      setNotice(result.kind);
      setReviews((value) => {
        const next = { ...value };
        delete next[entry.key];
        return next;
      });
    }
  }
  function commit(
    preview: Reply,
    query: ScheduleReviewQuery,
    choice: { start: string; end: string },
  ) {
    if (
      !freshRef.current ||
      rowsRef.current.length ||
      storageError ||
      !contextRef.current?.enabled ||
      !store.current ||
      viewRef.current?.snapshot.snapshotToken !== preview.snapshot.snapshotToken
    )
      return;
    void run(async (version) => {
      const entry = makeScheduleIntent(
        { snapshot: preview.snapshot, evaluatedAt: preview.evaluatedAt },
        query,
        choice,
        contextRef.current!,
      );
      savedStage.current = entry;
      rows([entry]);
      storageAction.current = "stage";
      try {
        await store.current!.stage(entry);
      } catch (caught) {
        if (current(version)) setStorageError(true);
        throw caught;
      }
      storageAction.current = null;
      if (current(version)) await send(entry, version);
    });
  }
  return {
    reply,
    context,
    entries,
    reviews,
    busy,
    fresh,
    error,
    draftError,
    storageError,
    notice,
    ownerHeld: ownerHeld.current,
    current,
    run,
    load,
    commit,
    stop: () => {
      alive.current = false;
      epoch.current++;
    },
    reload: () =>
      void run((version) => load(scopeRef.current, version).then(() => {})),
    preview: async (query: ScheduleReviewQuery, version: number) => {
      const owner = await freshContext(version);
      if (!current(version) || !owner) return null;
      updateFresh(false);
      const value = await readSchedulePreview(query, owner);
      if (!current(version)) return null;
      viewRef.current = value;
      setReply(value);
      updateFresh(true);
      return value;
    },
    check: (entry: ScheduleRecoveryEntry) =>
      void run(async (version) => {
        const value = await store.current!.inspect(entry.key, inspectSchedule);
        if (!current(version)) return;
        setReviews((previous) => ({ ...previous, [entry.key]: value }));
        if (value.state === "committed") await confirmed(entry, version);
      }),
    retry: (entry: ScheduleRecoveryEntry) =>
      void run((version) => send(entry, version)),
    forget: (entry: ScheduleRecoveryEntry) =>
      void run(async (version) => {
        await dismiss(entry, version);
        if (current(version)) await load(scopeRef.current, version);
      }),
    repair: () =>
      void run(async (version) => {
        const owner = await freshContext(version);
        if (!current(version) || !owner) return;
        if (!store.current) store.current = browserScheduleRecovery(owner);
        const journal = store.current;
        let recovered: ScheduleRecoveryEntry[] = journal.hasUncertainStorage()
          ? await journal.recoverStorage()
          : await journal.initialize();
        if (!current(version)) return;
        const staged =
          storageAction.current === "stage" ? savedStage.current : null;
        if (staged && !recovered.some((row) => row.key === staged.key)) {
          await journal.stage(staged);
          if (!current(version)) return;
          recovered = [...recovered, staged];
        }
        storageAction.current = null;
        savedStage.current = null;
        rows(recovered);
        setReviews({});
        setStorageError(false);
        await load(scopeRef.current, version);
      }),
  };
}
