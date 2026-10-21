"use client";
import * as React from "react";
import { notifyPreparationChanged } from "@/lib/event-preparation/changes";
import { sameQueueOwner } from "@/lib/queue-owner-contract";
import { OwnedRequestRecoveryError } from "@/lib/owned-request-journal";
import { browserPreparationRecovery } from "@/lib/event-preparation/browser";
import {
  readPreparationContext,
  readPreparationSelection,
  previewPreparation,
  makePreparationIntent,
  inspectPreparation,
  sendPreparation,
} from "@/lib/event-preparation/client";
import { notifyCalendarChanged } from "@/lib/calendar-planning/changes";
import type { PreparationReadScope } from "@/lib/event-preparation/read-contract";
import type { PreparationCommand } from "@/lib/event-preparation/contract";
import type { preparationReadReply } from "@/lib/event-preparation/view-contract";
import type {
  PreparationRecoveryContext,
  PreparationRecoveryEntry,
  preparationRecoveryReview,
} from "@/lib/event-preparation/recovery";
type Reply = ReturnType<typeof preparationReadReply.parse>;
type Review = ReturnType<typeof preparationRecoveryReview.parse>;
export function usePreparationSession(initialScope: PreparationReadScope) {
  const alive = React.useRef(false),
    epoch = React.useRef(0),
    operation = React.useRef(false),
    ownerHeld = React.useRef(false);
  const store = React.useRef<ReturnType<
      typeof browserPreparationRecovery
    > | null>(null),
    contextRef = React.useRef<PreparationRecoveryContext | null>(null),
    viewRef = React.useRef<Reply | null>(null),
    rowsRef = React.useRef<PreparationRecoveryEntry[]>([]),
    scopeRef = React.useRef(initialScope);
  const freshRef = React.useRef(false);
  const savedStage = React.useRef<PreparationRecoveryEntry | null>(null),
    storageAction = React.useRef<"stage" | "dismiss" | null>(null);
  const [reply, setReply] = React.useState<Reply | null>(null),
    [context, setContext] = React.useState<PreparationRecoveryContext | null>(
      null,
    ),
    [entries, setEntries] = React.useState<PreparationRecoveryEntry[]>([]),
    [reviews, setReviews] = React.useState<Record<string, Review>>({});
  const [busy, setBusy] = React.useState(true),
    [fresh, setFresh] = React.useState(false),
    [error, setError] = React.useState(false),
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
  function rows(value: PreparationRecoveryEntry[]) {
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
    let next: PreparationRecoveryContext;
    try {
      next = await readPreparationContext();
    } catch (error) {
      if (current(version)) {
        viewRef.current = null;
        setReply(null);
        updateFresh(false);
      }
      throw error;
    }
    if (!current(version)) return null;
    const original = contextRef.current;
    if (
      original &&
      (next.userId !== original.userId ||
        next.familyId !== original.familyId ||
        next.role !== original.role ||
        (next.owner && original.owner
          ? !sameQueueOwner(next.owner, original.owner)
          : next.owner !== original.owner))
    ) {
      hold();
      throw new Error("Owner changed");
    }
    contextRef.current = next;
    setContext(next);
    return next;
  }
  async function load(scope: PreparationReadScope, version: number) {
    updateFresh(false);
    const owner = await freshContext(version);
    if (!current(version) || !owner) return null;
    const value = await readPreparationSelection(scope, owner);
    if (!current(version)) return null;
    const previousView = viewRef.current?.view;
    const previous = previousView?.event;
    if (
      previous &&
      (previous.sourceToken !== value.view.event.sourceToken ||
        JSON.stringify(previousView?.plan) !== JSON.stringify(value.view.plan))
    )
      setNotice("changed");
    viewRef.current = value;
    setReply(value);
    scopeRef.current = scope;
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
        if (!store.current) store.current = browserPreparationRecovery(owner);
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
    setNotice(null);
    try {
      await work(version);
    } catch (caught) {
      if (current(version)) {
        updateFresh(false);
        setError(true);
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
  async function dismiss(entry: PreparationRecoveryEntry, version: number) {
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
  async function confirmed(entry: PreparationRecoveryEntry, version: number) {
    if (!current(version)) return;
    updateFresh(false);
    viewRef.current = null;
    setReply(null);
    setNotice("proof");
    notifyCalendarChanged();
    notifyPreparationChanged();
    await dismiss(entry, version);
    if (current(version)) await load(scopeRef.current, version);
  }
  async function send(entry: PreparationRecoveryEntry, version: number) {
    if (!store.current || !current(version)) return;
    const result = await store.current.send(entry.key, true, sendPreparation);
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
  function commit(preview: Reply, command: PreparationCommand) {
    if (
      !freshRef.current ||
      rowsRef.current.length ||
      storageError ||
      !contextRef.current?.enabled ||
      !store.current ||
      viewRef.current?.view.expectedToken !== preview.view.expectedToken
    )
      return;
    void run(async (version) => {
      const entry = await makePreparationIntent(
        preview,
        command,
        contextRef.current!,
      );
      if (!current(version)) return;
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
    select: (scope: PreparationReadScope) =>
      run((version) => load(scope, version).then(() => {})),
    reload: () =>
      void run((version) => load(scopeRef.current, version).then(() => {})),
    preview: async (command: PreparationCommand, version: number) => {
      const owner = await freshContext(version);
      if (!current(version) || !owner) return null;
      updateFresh(false);
      const value = await previewPreparation(command, owner);
      if (!current(version)) return null;
      viewRef.current = value;
      setReply(value);
      updateFresh(true);
      return value;
    },
    check: (entry: PreparationRecoveryEntry) =>
      void run(async (version) => {
        const value = await store.current!.inspect(
          entry.key,
          inspectPreparation,
        );
        if (!current(version)) return;
        setReviews((previous) => ({ ...previous, [entry.key]: value }));
        if (value.state === "committed") await confirmed(entry, version);
      }),
    retry: (entry: PreparationRecoveryEntry) =>
      void run((version) => send(entry, version)),
    forget: (entry: PreparationRecoveryEntry) =>
      void run(async (version) => {
        await dismiss(entry, version);
        if (current(version)) await load(scopeRef.current, version);
      }),
    repair: () =>
      void run(async (version) => {
        const owner = await freshContext(version);
        if (!current(version) || !owner) return;
        if (!store.current) store.current = browserPreparationRecovery(owner);
        const journal = store.current;
        let recovered: PreparationRecoveryEntry[] =
          journal.hasUncertainStorage()
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
