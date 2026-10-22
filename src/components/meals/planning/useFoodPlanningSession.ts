"use client";
import type { FoodApplyReceipt } from "@/lib/food-planning/apply-contract";
import * as React from "react";
import { browserFoodRecovery } from "@/lib/food-planning/browser";
import {
  readFoodRecoveryContext,
  readFoodPreview,
  readFoodWriteReview,
  makeFoodIntent,
  sendFoodIntent,
  inspectFoodIntent,
  FoodOwnerChanged,
} from "@/lib/food-planning/client";
import {
  foodDraftEntry,
  foodDraftPayload,
  foodEditorDraft,
  foodDraftQuery,
  foodDraftCommand,
  newFoodDraft,
  type FoodEditorDraft,
} from "@/lib/food-planning/editor";
import type {
  FoodRecoveryContext,
  FoodJournalEntry,
} from "@/lib/food-planning/recovery-contract";
import type {
  FoodPreviewView,
  FoodReviewView,
} from "@/lib/food-planning/view-contract";
import { OwnedRequestRecoveryError } from "@/lib/owned-request-journal";
import { sameQueueOwner } from "@/lib/queue-owner-contract";
import { newIdempotencyKey } from "@/lib/idempotency-key";
type LocalEntry = Extract<FoodJournalEntry, { kind: "local-food-draft" }>;
type Inspection = Awaited<ReturnType<typeof inspectFoodIntent>>;
export function useFoodPlanningSession(onSaved: () => void) {
  const store = React.useRef<ReturnType<typeof browserFoodRecovery> | null>(
      null,
    ),
    contextRef = React.useRef<FoodRecoveryContext | null>(null),
    local = React.useRef<LocalEntry | null>(null),
    draftRef = React.useRef<FoodEditorDraft | null>(null);
  const alive = React.useRef(false),
    reviewDraftStamp = React.useRef<string | null>(null);
  const epoch = React.useRef(0),
    operation = React.useRef(false),
    flushTail = React.useRef<Promise<unknown>>(Promise.resolve()),
    callbacks = React.useRef(onSaved);
  callbacks.current = onSaved;
  const [, refreshSavedState] = React.useState(0);
  const [context, setContext] = React.useState<FoodRecoveryContext | null>(
      null,
    ),
    [draft, setDraft] = React.useState<FoodEditorDraft | null>(null),
    [rows, setRows] = React.useState<FoodJournalEntry[]>([]),
    [preview, setPreview] = React.useState<FoodPreviewView | null>(null),
    [review, setReview] = React.useState<FoodReviewView | null>(null),
    [inspections, setInspections] = React.useState<Record<string, Inspection>>(
      {},
    ),
    [confirmed, setConfirmed] = React.useState<
      Record<string, FoodApplyReceipt>
    >({}),
    [busy, setBusy] = React.useState(false),
    [issue, setIssue] = React.useState<
      "load" | "owner" | "storage" | "invalid" | "unknown" | "held" | null
    >(null);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      epoch.current++;
      operation.current = false;
    };
  }, []);
  const showDraft = React.useCallback((value: FoodEditorDraft | null) => {
    draftRef.current = value;
    setDraft(value);
  }, []);
  const failed = React.useCallback(
    (error: unknown) => {
      if (
        (error instanceof OwnedRequestRecoveryError &&
          error.reason === "OWNER_CHANGED") ||
        error instanceof FoodOwnerChanged
      ) {
        epoch.current++;
        operation.current = false;
        setBusy(false);
        store.current = null;
        setContext(null);
        contextRef.current = null;
        setRows([]);
        setPreview(null);
        setReview(null);
        setInspections({});
        setConfirmed({});
        showDraft(null);
        local.current = null;
        setIssue("owner");
      } else
        setIssue(
          store.current?.hasUncertainStorage()
            ? "storage"
            : error instanceof OwnedRequestRecoveryError
              ? "held"
              : "invalid",
        );
    },
    [showDraft],
  );
  async function perform(run: (current: () => boolean) => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setIssue(null);
    const stamp = epoch.current;
    try {
      await run(() => alive.current && epoch.current === stamp);
    } catch (error) {
      if (epoch.current === stamp) failed(error);
    } finally {
      if (alive.current && epoch.current === stamp) {
        operation.current = false;
        setBusy(false);
      }
    }
  }
  async function fresh() {
    const stamp = epoch.current;
    const next = await readFoodRecoveryContext(),
      old = contextRef.current;
    if (!alive.current || epoch.current !== stamp)
      throw new Error("Food operation ended");
    if (
      !old?.owner ||
      !next.owner ||
      !sameQueueOwner(old.owner, next.owner) ||
      old.userId !== next.userId ||
      old.familyId !== next.familyId
    )
      throw new OwnedRequestRecoveryError("OWNER_CHANGED");
    contextRef.current = next;
    setContext(next);
    return next;
  }
  async function synchronize(adoptDraft: boolean) {
    if (!store.current) throw new Error("Food recovery unavailable");
    const stamp = epoch.current,
      selected = store.current;
    const entries = await selected.snapshot();
    if (!alive.current || epoch.current !== stamp || store.current !== selected)
      return;
    setRows(entries);
    const editable =
      entries.find(
        (row): row is LocalEntry => row.kind === "local-food-draft",
      ) ?? null;
    local.current = editable;
    if (adoptDraft)
      showDraft(
        editable
          ? foodDraftPayload.parse(JSON.parse(editable.body)).draft
          : null,
      );
  }
  const flush = React.useCallback(() => {
    const next = flushTail.current.then(async () => {
      if (!draftRef.current) return;
      const entry = local.current,
        ctx = contextRef.current,
        journal = store.current;
      if (!entry || !ctx || !journal) throw new Error("Food draft unavailable");
      const body = JSON.stringify(
        foodDraftPayload.parse({
          userId: ctx.userId,
          familyId: ctx.familyId,
          draft: draftRef.current,
        }),
      );
      if (body !== entry.body) {
        const changed = foodDraftEntry.parse({ ...entry, body });
        const stamp = epoch.current;
        await journal.replaceLocalDraft(changed, entry.body);
        if (alive.current && epoch.current === stamp) {
          local.current = changed;
          refreshSavedState((value) => value + 1);
        }
      }
    });
    flushTail.current = next.catch(() => undefined);
    return next;
  }, []);
  React.useEffect(() => {
    if (!draft || busy || issue === "owner" || issue === "storage") return;
    const stamp = epoch.current,
      timer = setTimeout(() => {
        void flush().catch((error) => {
          if (epoch.current === stamp) failed(error);
        });
      }, 1000);
    return () => clearTimeout(timer);
  }, [draft, busy, flush, issue, failed]);
  async function load() {
    await perform(async (current) => {
      setPreview(null);
      setReview(null);
      reviewDraftStamp.current = null;
      const next = await readFoodRecoveryContext();
      if (!current()) return;
      if (!next.owner) throw new OwnedRequestRecoveryError("OWNER_CHANGED");
      if (
        contextRef.current?.owner &&
        !sameQueueOwner(contextRef.current.owner, next.owner)
      )
        throw new OwnedRequestRecoveryError("OWNER_CHANGED");
      const journal = store.current ?? browserFoodRecovery(next),
        entries = await journal.initialize();
      if (!current()) return;
      store.current = journal;
      contextRef.current = next;
      setContext(next);
      setRows(entries);
      setInspections({});
      setConfirmed({});
      local.current =
        entries.find(
          (row): row is LocalEntry => row.kind === "local-food-draft",
        ) ?? null;
      showDraft(
        local.current
          ? foodDraftPayload.parse(JSON.parse(local.current.body)).draft
          : null,
      );
    });
  }
  function change(next: FoodEditorDraft) {
    if (
      operation.current ||
      !contextRef.current?.enabled ||
      store.current?.hasUncertainStorage()
    )
      return;
    reviewDraftStamp.current = null;
    showDraft(foodEditorDraft.parse(next));
    setPreview(null);
    setReview(null);
    setIssue(null);
  }
  async function start(day: string, mode: FoodEditorDraft["mode"]) {
    await perform(async (current) => {
      const ctx = await fresh();
      if (!ctx.enabled || !store.current || local.current)
        throw new Error("Food editing paused");
      const value = newFoodDraft(
          day,
          Intl.DateTimeFormat().resolvedOptions().timeZone,
          mode,
        ),
        entry = foodDraftEntry.parse({
          kind: "local-food-draft",
          key: newIdempotencyKey(),
          body: JSON.stringify({
            userId: ctx.userId,
            familyId: ctx.familyId,
            draft: value,
          }),
        });
      await store.current.stage(entry);
      if (!current()) return;
      local.current = entry;
      showDraft(value);
      await synchronize(false);
    });
  }
  async function previewDraft() {
    await perform(async (current) => {
      await flush();
      const value = draftRef.current;
      if (!value) return;
      const ctx = await fresh(),
        result = await readFoodPreview(foodDraftQuery(value), ctx);
      if (current()) {
        setPreview(result);
        setReview(null);
      }
    });
  }
  async function reviewDraft() {
    await perform(async (current) => {
      setReview(null);
      reviewDraftStamp.current = null;
      await flush();
      if (!draftRef.current || !preview) throw new Error("Preview required");
      const ctx = await fresh(),
        result = await readFoodWriteReview(
          foodDraftCommand(draftRef.current, preview, ctx),
          ctx,
        );
      if (current()) {
        reviewDraftStamp.current = JSON.stringify(draftRef.current);
        setReview(result);
      }
    });
  }
  async function inspect(key: string) {
    await perform(async (current) => {
      if (!store.current) return;
      const result = await store.current.inspect(key, async (entry, ctx) => {
        if (entry.kind !== "food-plan") throw new Error("Not a request");
        return inspectFoodIntent(entry, ctx);
      });
      if (!current()) return;
      setInspections((old) => ({ ...old, [key]: result }));
      if (result.state === "committed" && result.receipt) {
        setConfirmed((old) => ({ ...old, [key]: result.receipt! }));
        callbacks.current();
      }
    });
  }
  async function send(key: string, recovered: boolean, current: () => boolean) {
    if (!store.current) throw new Error("Food recovery unavailable");
    const result = await store.current.send(
      key,
      recovered,
      async (entry, scope) => {
        if (entry.kind !== "food-plan") throw new Error("Not a request");
        const ctx = await fresh();
        if (ctx.owner?.scope !== scope)
          throw new OwnedRequestRecoveryError("OWNER_CHANGED");
        return sendFoodIntent(entry, ctx);
      },
    );
    if (!current()) return;
    if (result.kind === "confirmed") {
      setConfirmed((old) => ({ ...old, [key]: result.receipt }));
      callbacks.current();
    } else setIssue("unknown");
    if (current()) await synchronize(false);
  }
  async function confirm() {
    await perform(async (current) => {
      await flush();
      if (
        !store.current ||
        !local.current ||
        !review ||
        !draftRef.current ||
        JSON.stringify(draftRef.current) !== reviewDraftStamp.current ||
        Date.now() >= Date.parse(review.expiresAt)
      )
        throw new Error("Refresh review");
      const ctx = await fresh();
      if (review.input.mode === "prep" && !ctx.canPrep)
        throw new Error("Prep verification required");
      const entry = makeFoodIntent(review.input, ctx, local.current.key);
      await store.current.promoteLocalDraft(entry, local.current.body);
      if (!current()) return;
      local.current = null;
      showDraft(null);
      setPreview(null);
      setReview(null);
      await synchronize(false);
      await send(entry.key, false, current);
    });
  }
  async function retry(key: string) {
    await perform((current) => send(key, true, current));
  }
  async function dismiss(key: string) {
    await perform(async (current) => {
      const discardingDraft = local.current?.key === key;
      if (!discardingDraft) await flush();
      await store.current?.dismiss(key);
      if (discardingDraft) {
        setPreview(null);
        setReview(null);
        reviewDraftStamp.current = null;
      }
      setConfirmed((old) => {
        const next = { ...old };
        delete next[key];
        return next;
      });
      if (current()) {
        setInspections((old) => {
          const next = { ...old };
          delete next[key];
          return next;
        });
        await synchronize(true);
      }
    });
  }
  async function repair() {
    await perform(async (current) => {
      const wanted = draftRef.current;
      await store.current?.recoverStorage();
      if (current()) {
        await synchronize(false);
        if (local.current && wanted) {
          showDraft(wanted);
          await flush();
        } else showDraft(null);
        reviewDraftStamp.current = null;
        setPreview(null);
        setReview(null);
      }
    });
  }
  async function prepareLeave() {
    if (operation.current || !alive.current) return false;
    const stamp = epoch.current;
    try {
      await flush();
      await store.current?.snapshot();
      return (
        alive.current &&
        epoch.current === stamp &&
        !store.current?.hasUncertainStorage()
      );
    } catch (error) {
      if (alive.current && epoch.current === stamp) failed(error);
      return false;
    }
  }
  const dirty =
    !!draft &&
    !!context &&
    JSON.stringify(
      foodDraftPayload.parse({
        userId: context.userId,
        familyId: context.familyId,
        draft,
      }),
    ) !== local.current?.body;
  return {
    context,
    draft,
    dirty,
    rows,
    preview,
    review,
    inspections,
    confirmed,
    busy,
    issue,
    load,
    start,
    change,
    previewDraft,
    reviewDraft,
    confirm,
    inspect,
    retry,
    dismiss,
    repair,
    prepareLeave,
  };
}
